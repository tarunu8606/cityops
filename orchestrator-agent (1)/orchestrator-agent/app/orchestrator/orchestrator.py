from sqlalchemy.exc import SQLAlchemyError
from ..agents.route_agent import run_route_agent
from ..agents.crew_agent import AICrewAgent, fetch_live_data_from_db
from ..services.graph_service import build_graph
from .validator import resolve_stop, validate_scenario, create_or_get_scenario, validate_agent_outputs, determine_status
from .combiner import combine


def _scenario_route_id(route_result):
    # Route candidates are generated from the graph and are not persisted as routes here.
    # Do not invent a route_id mapping for Crew Agent, whose current implementation expects real DB IDs.
    return None


def orchestrate(request, engine):
    agent_errors = []
    origin = resolve_stop(engine, request.origin)
    destination = resolve_stop(engine, request.destination)
    if not origin or not destination:
        missing = request.origin if not origin else request.destination
        return {
            "status": "APPROVAL_REQUIRED",
            "scenario_id": request.scenario_id,
            "request": request.model_dump(),
            "validation": {"valid": False, "errors": [f"Stop not found: {missing}"]},
            "conflicts": [], "unresolved_escalations": [], "fallback_options": [],
            "final_combined_recommendation": None, "agent_errors": [],
        }

    scenario_check = validate_scenario(engine, request.scenario_id, origin["id"], destination["id"])
    if not scenario_check["valid"]:
        return {
            "status": "APPROVAL_REQUIRED",
            "scenario_id": request.scenario_id,
            "request": request.model_dump(),
            "validation": scenario_check,
            "conflicts": [], "unresolved_escalations": [], "fallback_options": [],
            "final_combined_recommendation": None, "agent_errors": [],
        }

    try:
        scenario_id = create_or_get_scenario(engine, request, origin["id"], destination["id"])
    except SQLAlchemyError as exc:
        return {
            "status": "AGENT_ERROR",
            "scenario_id": request.scenario_id,
            "request": request.model_dump(),
            "validation": {"valid": False, "errors": [f"Scenario creation failed: {exc}"]},
            "conflicts": [], "unresolved_escalations": [], "fallback_options": [],
            "final_combined_recommendation": None, "agent_errors": [],
        }

    graph = build_graph(engine)
    route_result = None
    try:
        route_result = run_route_agent(graph, engine, scenario_id, origin["id"], destination["id"])
    except Exception as exc:
        agent_errors.append({"agent": "route", "error": str(exc)})

    # The existing Crew Agent is conflict-driven and currently reads all OPEN conflicts,
    # AVAILABLE crew and AVAILABLE buses. We invoke it as-is and never fabricate route_id mappings.
    crew_result = None
    try:
        conflicts, crew, buses = fetch_live_data_from_db()
        if conflicts:
            crew_agent = AICrewAgent()
            crew_result = crew_agent.resolve_conflicts(conflicts, crew, buses)
        else:
            crew_result = {"status": "success", "proposed_actions": [], "unresolved_escalations": [], "resolved_conflicts": []}
    except Exception as exc:
        agent_errors.append({"agent": "crew", "error": str(exc)})

    output_validation = validate_agent_outputs(route_result, crew_result)
    unresolved = []
    if crew_result:
        unresolved.extend(crew_result.get("unresolved_escalations", []))

    status = determine_status(agent_errors, crew_result, output_validation, unresolved)
    final = combine(route_result, crew_result, output_validation, unresolved, agent_errors, request)

    return {
        "status": status,
        "scenario_id": scenario_id,
        "request": request.model_dump(),
        "route_result": route_result,
        "crew_result": crew_result,
        "validation": output_validation,
        "conflicts": crew_result.get("resolved_conflicts", []) if crew_result else [],
        "unresolved_escalations": unresolved,
        "fallback_options": [],
        "final_combined_recommendation": final,
        "agent_errors": agent_errors,
    }
