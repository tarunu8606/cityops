def combine(route_result, crew_result, validation, unresolved, agent_errors, request):
    recommendation = None
    if route_result:
        recommendation = {
            "route": route_result.get("agent_recommendation"),
            "candidate": next((c for c in route_result.get("candidates", []) if c.get("is_recommended")), None),
        }
    if crew_result:
        recommendation = recommendation or {}
        recommendation["crew"] = {
            "proposed_actions": crew_result.get("proposed_actions", []),
            "resolution_count": len(crew_result.get("resolved_conflicts", [])),
        }

    return {
        "request": request.model_dump(),
        "route_recommendation": recommendation.get("route") if recommendation else None,
        "recommended_route_candidate": recommendation.get("candidate") if recommendation else None,
        "crew_proposals": crew_result.get("proposed_actions", []) if crew_result else [],
        "unresolved_escalations": unresolved,
        "agent_errors": agent_errors,
        "validation": validation,
        "decision": "PROPOSED_ONLY",
        "database_write_performed": False,
    }
