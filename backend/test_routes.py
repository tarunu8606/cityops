from sqlalchemy import text

from app.db import get_engine
from app.services.graph_service import build_graph
from app.services.route_service import generate_candidates


def print_candidates(label, candidates):
    print(f"\n--- {label}: generated candidates ---")
    for c in candidates:
        print(
            f"rank={c['rank']} recommended={c['is_recommended']} "
            f"score={c['route_score']} overlap={c['overlap_pct']}% "
            f"({c['overlap_severity']}) coverage_gain={c['coverage_gain_pct']}% "
            f"dist={c['distance_km']}km time={c['travel_time_min']}min "
            f"path={' -> '.join(c['stop_names'])}"
        )


def print_seeded(engine, label, scenario_id):
    print(f"\n--- {label}: seeded route_candidates (scenario_id={scenario_id}) ---")
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT candidate_code, rank, is_recommended, route_score, "
                "overlap_pct, overlap_severity, coverage_gain_pct, "
                "distance_km, estimated_travel_time_min "
                "FROM route_candidates WHERE scenario_id = :sid ORDER BY rank"
            ),
            {"sid": scenario_id},
        ).mappings()
        for row in rows:
            print(
                f"{row['candidate_code']} rank={row['rank']} "
                f"recommended={row['is_recommended']} score={row['route_score']} "
                f"overlap={row['overlap_pct']}% ({row['overlap_severity']}) "
                f"coverage_gain={row['coverage_gain_pct']}% "
                f"dist={row['distance_km']}km time={row['estimated_travel_time_min']}min"
            )


def main():
    engine = get_engine()
    G = build_graph(engine)

    scenario1 = generate_candidates(
        G, engine, origin_stop_id=1, destination_stop_id=22, k=3
    )
    print_candidates("Scenario 1 (Gandhipuram -> Neelambur)", scenario1)
    print_seeded(engine, "Scenario 1", scenario_id=1)

    scenario2 = generate_candidates(
        G, engine, origin_stop_id=28, destination_stop_id=15, k=3
    )
    print_candidates("Scenario 2 (Kovaipudur -> Peelamedu)", scenario2)
    print_seeded(engine, "Scenario 2", scenario_id=2)


if __name__ == "__main__":
    main()
