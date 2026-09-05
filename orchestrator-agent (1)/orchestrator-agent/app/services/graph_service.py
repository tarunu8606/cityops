import networkx as nx
from sqlalchemy import text


def build_graph(engine):
    """Build the deterministic route graph from stops and road_segments."""
    graph = nx.DiGraph()
    with engine.connect() as conn:
        stops = conn.execute(text("SELECT id, name, lat, lon FROM stops")).mappings().all()
        segments = conn.execute(
            text("""
                SELECT id, from_stop_id, to_stop_id, distance_km, travel_time_min
                FROM road_segments
            """)
        ).mappings().all()

    for stop in stops:
        graph.add_node(
            stop["id"],
            name=stop["name"],
            lat=stop.get("lat"),
            lon=stop.get("lon"),
        )

    for segment in segments:
        graph.add_edge(
            segment["from_stop_id"],
            segment["to_stop_id"],
            id=segment["id"],
            distance_km=float(segment["distance_km"]),
            travel_time_min=float(segment["travel_time_min"]),
        )

    return graph
