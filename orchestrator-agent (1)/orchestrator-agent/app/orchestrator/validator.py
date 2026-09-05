from datetime import datetime
from sqlalchemy import text

from ..db import next_id


STATUS_PRIORITY = {
    "AGENT_ERROR": 5,
    "ESCALATION_REQUIRED": 4,
    "APPROVAL_REQUIRED": 3,
    "SUCCESS_WITH_WARNINGS": 2,
    "SUCCESS": 1,
}


def _parse_time(value):
    for fmt in ("%H:%M", "%H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    raise ValueError(f"Unsupported time format: {value}")


def resolve_stop(engine, name):
    with engine.connect() as conn:
        row = conn.execute(text("SELECT id, name FROM stops WHERE LOWER(name) = LOWER(:name) LIMIT 1"), {"name": name}).mappings().first()
    return dict(row) if row else None


def validate_scenario(engine, scenario_id, origin_id, destination_id):
    if scenario_id is None:
        return {"valid": True, "exists": False}
    with engine.connect() as conn:
        row = conn.execute(text("SELECT id, origin_stop_id, destination_stop_id, status FROM scenarios WHERE id = :id"), {"id": scenario_id}).mappings().first()
    if not row:
        return {"valid": False, "exists": False, "reason": "Scenario not found"}
    valid = row["origin_stop_id"] == origin_id and row["destination_stop_id"] == destination_id
    return {"valid": valid, "exists": True, "scenario": dict(row), "reason": None if valid else "Scenario origin/destination does not match request"}


def create_or_get_scenario(engine, request, origin_id, destination_id):
    if request.scenario_id is not None:
        return request.scenario_id
    with engine.begin() as conn:
        scenario_id = next_id(conn, "scenarios")
        row = conn.execute(text("""
            INSERT INTO scenarios (id, name, description, origin_stop_id, destination_stop_id, proposed_start_time, proposed_end_time, status, created_at)
            VALUES (:id, :name, :description, :origin, :destination, :start_time, :end_time, 'PROPOSED', CURRENT_TIMESTAMP)
            RETURNING id
        """), {
            "id": scenario_id,
            "name": f"{request.origin}-{request.destination} proposal",
            "description": "Created by the CityOps Operations Orchestrator",
            "origin": origin_id,
            "destination": destination_id,
            "start_time": request.start_time,
            "end_time": request.end_time,
        }).scalar_one()
    return row


def validate_agent_outputs(route_result, crew_result):
    errors = []
    if route_result is not None:
        if route_result.get("status") != "success":
            errors.append("Route Agent returned an error status")
        for c in route_result.get("candidates", []):
            required = {"candidate_code", "distance_km", "overlap_pct", "coverage_gain_pct", "route_score", "rank", "is_recommended"}
            missing = sorted(required - set(c))
            if missing:
                errors.append(f"Route candidate missing fields: {missing}")
    if crew_result is not None and crew_result.get("status") != "success":
        errors.append("Crew Agent returned an error status")
    return {"valid": not errors, "errors": errors}


def determine_status(agent_errors, crew_result, validation, unresolved):
    if agent_errors:
        return "AGENT_ERROR"
    if unresolved:
        return "ESCALATION_REQUIRED"
    if not validation.get("valid", False):
        return "APPROVAL_REQUIRED"
    if crew_result and crew_result.get("proposed_actions"):
        return "APPROVAL_REQUIRED"
    warnings = []
    if crew_result:
        warnings = crew_result.get("unresolved_escalations", [])
    return "SUCCESS_WITH_WARNINGS" if warnings else "SUCCESS"
