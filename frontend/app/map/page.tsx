"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre v6 loads its tile-parsing worker as a separate ESM chunk that
// Next's webpack build doesn't resolve automatically (the map silently never
// finishes loading — no tiles, no error). Point it at a static copy instead
// of the node_modules path; see public/maplibre/README.md for how these two
// files are kept in sync.
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const TEAL = "#0E7A85";
const GRAY = "#94A3B8";
const AMBER = "#F59E0B";

const COIMBATORE_CENTER: [number, number] = [76.9558, 11.0168];
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

type OverlapSeverity = "MINIMAL" | "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

type Candidate = {
  stop_ids: number[];
  stop_names: string[];
  distance_km: number;
  travel_time_min: number;
  overlap_pct: number;
  coverage_gain_pct: number;
  overlap_severity: OverlapSeverity;
  route_score: number;
  rank: number;
  is_recommended: boolean;
  candidate_code: string;
};

type Scenario = {
  status: string;
  scenario_id: number;
  origin: string;
  destination: string;
  candidates: Candidate[];
  agent_recommendation: { candidate_code: string; reasoning: string };
};

type Stop = { name: string; lat: number; lon: number };
type StopsLookup = Record<string, Stop>;

const isWarnSeverity = (severity: OverlapSeverity) =>
  severity === "MODERATE" || severity === "HIGH" || severity === "CRITICAL";

const sourceIdFor = (code: string) => `route-source-${code}`;
const layerIdFor = (code: string) => `route-line-${code}`;

export default function MapPage() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [stops, setStops] = useState<StopsLookup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [activeCode, setActiveCode] = useState<string | null>(null);

  // Load mock data.
  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/mock/scenario.json").then((res) => res.json() as Promise<Scenario>),
      fetch("/mock/stops.json").then((res) => res.json() as Promise<StopsLookup>),
    ]).then(([scenarioData, stopsData]) => {
      if (cancelled) return;
      setScenario(scenarioData);
      setStops(stopsData);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Init the map once on mount.
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: COIMBATORE_CENTER,
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    const handleLoad = () => setMapReady(true);
    map.on("load", handleLoad);

    return () => {
      map.off("load", handleLoad);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Draw candidate routes + recommended-route stop markers once the map and
  // data are both ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !scenario || !stops) return;

    const toLngLat = (stopId: number): [number, number] => {
      const stop = stops[String(stopId)];
      return [stop.lon, stop.lat];
    };

    // Draw non-recommended candidates first so the recommended one paints
    // on top of them.
    const ordered = [...scenario.candidates].sort(
      (a, b) => Number(a.is_recommended) - Number(b.is_recommended)
    );

    for (const candidate of ordered) {
      const sourceId = sourceIdFor(candidate.candidate_code);
      const layerId = layerIdFor(candidate.candidate_code);

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
    }

    const recommended = scenario.candidates.find((c) => c.is_recommended);
    if (recommended) {
      map.addSource("recommended-stops", {
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
        id: "recommended-stops-layer",
        type: "circle",
        source: "recommended-stops",
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-stroke-color": TEAL,
        },
      });
    }
  }, [mapReady, scenario, stops]);

  // Sync the active (clicked) candidate's line styling and stacking order.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !scenario) return;

    for (const candidate of scenario.candidates) {
      const layerId = layerIdFor(candidate.candidate_code);
      if (!map.getLayer(layerId)) continue;

      const isActive = activeCode === candidate.candidate_code;
      const baseWidth = candidate.is_recommended ? 5 : 3;

      map.setPaintProperty(
        layerId,
        "line-width",
        isActive ? baseWidth + 2 : baseWidth
      );
      map.setPaintProperty(
        layerId,
        "line-opacity",
        activeCode ? (isActive ? 1 : 0.3) : candidate.is_recommended ? 1 : 0.85
      );

      if (isActive) {
        map.moveLayer(layerId);
      }
    }

    if (map.getLayer("recommended-stops-layer")) {
      map.moveLayer("recommended-stops-layer");
    }
  }, [activeCode, mapReady, scenario]);

  return (
    <div className="flex h-screen w-full bg-[#F7F8FA]">
      <div className="relative h-full w-[70%]">
        <div ref={mapContainerRef} className="h-full w-full" />
      </div>

      <div className="h-full w-[30%] overflow-y-auto border-l border-slate-200 p-5">
        {!scenario || !stops ? (
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : (
          <>
            <header className="mb-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Candidate routes
              </p>
              <h1 className="mt-1 text-lg font-semibold text-slate-800">
                {scenario.origin} <span className="text-slate-400">→</span>{" "}
                {scenario.destination}
              </h1>
            </header>

            <div className="flex flex-col gap-3">
              {scenario.candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.candidate_code}
                  candidate={candidate}
                  active={activeCode === candidate.candidate_code}
                  onClick={() =>
                    setActiveCode((prev) =>
                      prev === candidate.candidate_code
                        ? null
                        : candidate.candidate_code
                    )
                  }
                />
              ))}
            </div>

            <div className="mt-5 rounded-lg bg-[#0E7A85]/5 p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#0E7A85]">
                AI Insight
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">
                {scenario.agent_recommendation.reasoning}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  active,
  onClick,
}: {
  candidate: Candidate;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border-l-4 bg-white p-4 text-left shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition ${
        candidate.is_recommended ? "border-l-[#0E7A85]" : "border-l-transparent"
      } ${active ? "ring-2 ring-[#0E7A85]" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">
          {candidate.candidate_code}
        </span>
        {candidate.is_recommended && (
          <span className="rounded-full bg-[#0E7A85]/10 px-2 py-0.5 text-xs font-medium text-[#0E7A85]">
            Recommended
          </span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-y-1 text-xs text-slate-500">
        <span>Score</span>
        <span className="text-right font-medium text-slate-700">
          {candidate.route_score}
        </span>
        <span>Distance</span>
        <span className="text-right font-medium text-slate-700">
          {candidate.distance_km} km
        </span>
        <span>Travel time</span>
        <span className="text-right font-medium text-slate-700">
          {candidate.travel_time_min} min
        </span>
      </div>

      <div className="mt-3">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            isWarnSeverity(candidate.overlap_severity)
              ? "text-[#92400E]"
              : "text-slate-500"
          }`}
          style={{
            backgroundColor: isWarnSeverity(candidate.overlap_severity)
              ? `${AMBER}26`
              : "#F1F5F9",
          }}
        >
          {candidate.overlap_pct}% overlap · {candidate.overlap_severity}
        </span>
      </div>
    </button>
  );
}
