import json

from app.agents.route_agent import run_route_agent
from app.db import get_engine
from app.services.graph_service import build_graph


def main():
    engine = get_engine()
    G = build_graph(engine)

    result1 = run_route_agent(
        G, engine, scenario_id=1, origin_stop_id=1, destination_stop_id=22
    )
    print("=== Scenario 1 ===")
    print(json.dumps(result1, indent=2))

    result2 = run_route_agent(
        G, engine, scenario_id=2, origin_stop_id=28, destination_stop_id=15
    )
    print("\n=== Scenario 2 ===")
    print(json.dumps(result2, indent=2))


if __name__ == "__main__":
    main()
