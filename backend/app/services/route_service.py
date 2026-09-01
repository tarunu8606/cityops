from itertools import islice

import networkx as nx
from sqlalchemy import text


def get_existing_route_edges(engine) -> dict[int, set[tuple[int, int]]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT rp.route_id, rp.stop_id "
                "FROM route_points rp "
                "JOIN routes r ON r.id = rp.route_id "
                "WHERE r.status = 'ACTIVE' "
                "ORDER BY rp.route_id, rp.sequence_order"
            )
        ).mappings()

        stops_by_route: dict[int, list[int]] = {}
        for row in rows:
            stops_by_route.setdefault(row["route_id"], []).append(row["stop_id"])

    return {
        route_id: {(stops[i], stops[i + 1]) for i in range(len(stops) - 1)}
        for route_id, stops in stops_by_route.items()
    }


def _overlap_severity(overlap_pct: float) -> str:
    if overlap_pct <= 10:
        return "MINIMAL"
    if overlap_pct <= 30:
        return "LOW"
    if overlap_pct <= 60:
        return "MODERATE"
    if overlap_pct <= 85:
        return "HIGH"
    return "CRITICAL"


def generate_candidates(
    G: nx.DiGraph,
    engine,
    origin_stop_id: int,
    destination_stop_id: int,
    k: int = 3,
    pool_size: int | None = None,
) -> list[dict]:
    # Search a wider pool of raw shortest_simple_paths than we return: the
    # first few are near-duplicates of the single fastest route (same
    # corridor, minor detours), so scoring only k of them barely explores
    # the tradeoff space. Score a bigger pool, then keep the top k.
    if pool_size is None:
        pool_size = max(k * 2, 8)

    route_edges = get_existing_route_edges(engine)
    all_active_edges: set[tuple[int, int]] = set()
    all_served_stops: set[int] = set()
    for edges in route_edges.values():
        all_active_edges |= edges
        for u, v in edges:
            all_served_stops.add(u)
            all_served_stops.add(v)

    paths = nx.shortest_simple_paths(
        G, origin_stop_id, destination_stop_id, weight="travel_time_min"
    )

    candidates = []
    for path in islice(paths, pool_size):
        path_edges = [(path[i], path[i + 1]) for i in range(len(path) - 1)]

        distance_km = sum(G[u][v]["distance_km"] for u, v in path_edges)
        travel_time_min = sum(G[u][v]["travel_time_min"] for u, v in path_edges)

        shared_edges = sum(1 for e in path_edges if e in all_active_edges)
        overlap_pct = (shared_edges / len(path_edges)) * 100 if path_edges else 0.0

        new_stops = sum(1 for s in path if s not in all_served_stops)
        coverage_gain_pct = (new_stops / len(path)) * 100 if path else 0.0

        route_score = (
            100
            - (0.4 * overlap_pct + 0.3 * (travel_time_min / 60 * 10))
            + 0.3 * coverage_gain_pct
        )

        candidates.append(
            {
                "stop_ids": path,
                "stop_names": [G.nodes[s]["name"] for s in path],
                "distance_km": round(distance_km, 2),
                "travel_time_min": round(travel_time_min, 2),
                "overlap_pct": round(overlap_pct, 2),
                "coverage_gain_pct": round(coverage_gain_pct, 2),
                "overlap_severity": _overlap_severity(overlap_pct),
                "route_score": round(route_score, 2),
            }
        )

    candidates.sort(key=lambda c: c["route_score"], reverse=True)
    candidates = candidates[:k]
    for rank, c in enumerate(candidates, start=1):
        c["rank"] = rank
        c["is_recommended"] = rank == 1

    return candidates
