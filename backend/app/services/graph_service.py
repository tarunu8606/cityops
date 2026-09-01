import networkx as nx
from sqlalchemy import text


def build_graph(engine) -> nx.DiGraph:
    graph = nx.DiGraph()

    with engine.connect() as conn:
        stops = conn.execute(
            text("SELECT id, name, lat, lon, is_major_hub FROM stops")
        ).mappings()
        for stop in stops:
            graph.add_node(
                stop["id"],
                name=stop["name"],
                lat=float(stop["lat"]),
                lon=float(stop["lon"]),
                is_major_hub=stop["is_major_hub"],
            )

        segments = conn.execute(
            text(
                "SELECT from_stop_id, to_stop_id, distance_km, travel_time_min "
                "FROM road_segments"
            )
        ).mappings()
        for seg in segments:
            graph.add_edge(
                seg["from_stop_id"],
                seg["to_stop_id"],
                distance_km=float(seg["distance_km"]),
                travel_time_min=float(seg["travel_time_min"]),
            )

    return graph
