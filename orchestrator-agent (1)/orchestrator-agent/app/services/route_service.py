from itertools import islice
import networkx as nx
from sqlalchemy import text


def _existing_route_edges(engine):
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT rp1.stop_id AS from_stop_id, rp2.stop_id AS to_stop_id
                FROM route_points rp1
                JOIN route_points rp2
                  ON rp2.route_id = rp1.route_id
                 AND rp2.sequence_order = rp1.sequence_order + 1
                JOIN routes r ON r.id = rp1.route_id
                WHERE r.status IS NULL OR UPPER(r.status) NOT IN ('CANCELLED', 'INACTIVE')
            """)
        ).mappings().all()
    return {(r["from_stop_id"], r["to_stop_id"]) for r in rows}


def _path_edges(path):
    return set(zip(path, path[1:]))


def generate_candidates(G, engine, origin_stop_id, destination_stop_id, k=3, pool_size=None):
    if origin_stop_id not in G or destination_stop_id not in G:
        raise ValueError("Origin or destination stop does not exist in the graph")

    existing = _existing_route_edges(engine)
    requested_pool = pool_size or max(k * 5, 10)
    paths = list(islice(
        nx.shortest_simple_paths(G, origin_stop_id, destination_stop_id, weight="travel_time_min"),
        requested_pool,
    ))
    if not paths:
        raise ValueError("No route path exists between the selected stops")

    total_existing = max(len(existing), 1)
    raw = []
    for path in paths:
        edges = _path_edges(path)
        distance = sum(G[u][v]["distance_km"] for u, v in edges)
        travel = sum(G[u][v]["travel_time_min"] for u, v in edges)
        shared = len(edges & existing)
        overlap_pct = round(shared / max(len(edges), 1) * 100, 2)
        coverage_gain_pct = round((len(edges - existing) / total_existing) * 100, 2)
        overlap_severity = (
            "HIGH" if overlap_pct >= 60 else "MEDIUM" if overlap_pct >= 30 else "LOW"
        )
        route_score = round(
            (distance * 1.0) + (overlap_pct * 0.15) - (coverage_gain_pct * 0.35), 2
        )
        raw.append({
            "distance_km": round(distance, 2),
            "estimated_travel_time_min": round(travel, 2),
            "overlap_pct": overlap_pct,
            "coverage_gain_pct": coverage_gain_pct,
            "overlap_severity": overlap_severity,
            "route_score": route_score,
            "path": path,
        })

    raw.sort(key=lambda x: x["route_score"])
    candidates = []
    for rank, item in enumerate(raw[:k], start=1):
        candidates.append({
            **{key: value for key, value in item.items() if key != "path"},
            "rank": rank,
            "is_recommended": rank == 1,
            "path": item["path"],
        })
    return candidates
