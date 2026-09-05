import * as maplibregl from "maplibre-gl";
import { GRAY, TEAL } from "./theme";
import type { Scenario, StopsLookup } from "./orchestrate";

export const sourceIdFor = (code: string) => `route-source-${code}`;
export const layerIdFor = (code: string) => `route-line-${code}`;
export const recommendedStopsSourceId = (scenarioId: number) =>
  `recommended-stops-${scenarioId}`;
export const recommendedStopsLayerId = (scenarioId: number) =>
  `recommended-stops-layer-${scenarioId}`;

/**
 * Draws every candidate in `scenario` onto `map`, additively — skips any
 * source/layer id that already exists, so calling this again for a
 * previously-drawn scenario (e.g. a React StrictMode re-run) is a no-op,
 * and calling it for a *new* scenario never touches what an earlier one
 * drew. That's what lets routes accumulate across searches on both /map
 * and /simulation: every id here is scoped by candidate_code (which
 * embeds scenario_id) or scenario_id directly, so nothing can collide
 * across searches.
 *
 * Recommended candidate is drawn last (teal, solid, on top); others gray
 * dashed underneath. Every drawn line gets a click-to-identify popup
 * (candidate_code + origin -> destination) — the way an old search's route
 * stays individually identifiable once it's no longer the one showing in
 * a sidebar or HUD.
 */
export function drawScenarioOnMap(
  map: maplibregl.Map,
  scenario: Scenario,
  stops: StopsLookup
) {
  const toLngLat = (stopId: number): [number, number] => {
    const stop = stops[String(stopId)];
    return [stop.lon, stop.lat];
  };

  const ordered = [...scenario.candidates].sort(
    (a, b) => Number(a.is_recommended) - Number(b.is_recommended)
  );

  for (const candidate of ordered) {
    const sourceId = sourceIdFor(candidate.candidate_code);
    const layerId = layerIdFor(candidate.candidate_code);
    if (map.getSource(sourceId)) continue;

    map.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: { candidate_code: candidate.candidate_code },
        geometry: {
          type: "LineString",
          coordinates: candidate.stop_ids.map(toLngLat),
        },
      },
    });

    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": candidate.is_recommended ? TEAL : GRAY,
        "line-width": candidate.is_recommended ? 5 : 3,
        "line-opacity": candidate.is_recommended ? 1 : 0.85,
        ...(candidate.is_recommended
          ? {}
          : { "line-dasharray": [2, 2] as [number, number] }),
      },
    });

    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("click", layerId, (e) => {
      new maplibregl.Popup({ closeButton: true })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font:12px system-ui,sans-serif;line-height:1.4">` +
            `<strong>${candidate.candidate_code}</strong><br/>` +
            `${scenario.origin} → ${scenario.destination}` +
            `</div>`
        )
        .addTo(map);
    });
  }

  const recommended = scenario.candidates.find((c) => c.is_recommended);
  const stopsSourceId = recommendedStopsSourceId(scenario.scenario_id);
  const stopsLayerId = recommendedStopsLayerId(scenario.scenario_id);
  if (recommended && !map.getSource(stopsSourceId)) {
    map.addSource(stopsSourceId, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: recommended.stop_ids.map((stopId) => ({
          type: "Feature",
          properties: { name: stops[String(stopId)].name },
          geometry: { type: "Point", coordinates: toLngLat(stopId) },
        })),
      },
    });

    map.addLayer({
      id: stopsLayerId,
      type: "circle",
      source: stopsSourceId,
      paint: {
        "circle-radius": 5,
        "circle-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-stroke-color": TEAL,
      },
    });
  }
}
