import networkx as nx

from app.db import get_engine
from app.services.graph_service import build_graph


def main():
    engine = get_engine()
    graph = build_graph(engine)

    print(f"Nodes: {graph.number_of_nodes()} (expect 38)")
    print(f"Edges: {graph.number_of_edges()} (expect 160)")
    print(f"Strongly connected: {nx.is_strongly_connected(graph)} (expect True)")

    path = nx.shortest_path(graph, source=1, target=22, weight="travel_time_min")
    names = [graph.nodes[n]["name"] for n in path]
    print(f"Shortest path 1 -> 22 (by travel time): {' -> '.join(names)}")


if __name__ == "__main__":
    main()
