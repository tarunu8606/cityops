"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "../lib/maplibreSetup";
import { AMBER } from "../lib/theme";
import {
  DEFAULT_DESTINATION_ID,
  DEFAULT_END_TIME,
  DEFAULT_ORIGIN_ID,
  DEFAULT_START_TIME,
  fetchScenario,
  fetchStops,
  type Candidate,
  type Scenario,
  type StopsLookup,
} from "../lib/orchestrate";
import {
  drawScenarioOnMap,
  layerIdFor,
  recommendedStopsLayerId,
} from "../lib/mapDraw";
import RouteSearchBar from "../components/RouteSearchBar";
import FetchStatus from "../components/FetchStatus";

const COIMBATORE_CENTER: [number, number] = [76.9558, 11.0168];
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

// Client-side only, computed at search time against every prior search's
// recommended route (see coveredSegmentsRef) — additive to the backend's
// own overlap_pct/route_score/is_recommended, never replacing them.
type AnnotatedCandidate = Candidate & {
  networkOverlapPct?: number;
  newSegmentCount?: number;
  isBestNetworkFit?: boolean;
};

type AnnotatedScenario = Omit<Scenario, "candidates"> & {
  candidates: AnnotatedCandidate[];
};

const isWarnSeverity = (severity: Candidate["overlap_severity"]) =>
  severity === "MODERATE" || severity === "HIGH" || severity === "CRITICAL";

// Undirected edge key — a corridor between two stops counts as "the same
// segment" regardless of which direction a route travels it.
const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const segmentsFor = (stopIds: number[]): string[] => {
  const segs: string[] = [];
  for (let i = 0; i < stopIds.length - 1; i++) {
    segs.push(edgeKey(stopIds[i], stopIds[i + 1]));
  }
  return segs;
};

export default function MapPage() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Accumulated stop-to-stop segments belonging to every search's
  // recommended candidate so far — grows across searches, only reset by a
  // full page refresh. Read (for the new search's comparison) and written
  // (folding in the new recommended candidate) in handleFindRoutes.
  const coveredSegmentsRef = useRef<Set<string>>(new Set());

  const [stops, setStops] = useState<StopsLookup | null>(null);
  const [scenario, setScenario] = useState<AnnotatedScenario | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [originId, setOriginId] = useState(DEFAULT_ORIGIN_ID);
  const [destinationId, setDestinationId] = useState(DEFAULT_DESTINATION_ID);
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);

  // Load the stop lookup on mount — static city geography for the pickers
  // and for drawing coordinates, not agent output, so this alone is fine
  // to auto-load. The orchestrator itself is only ever called from the
  // "Find Routes" button below.
  useEffect(() => {
    let cancelled = false;
    fetchStops().then((data) => {
      if (!cancelled) setStops(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopOptions = useMemo(() => {
    if (!stops) return [];
    return Object.entries(stops)
      .map(([id, s]) => ({ id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [stops]);

  const canSearch =
    !!stops && !!originId && !!destinationId && originId !== destinationId && !!startTime && !!endTime;

  async function handleFindRoutes() {
    if (!stops || !canSearch) return;
    setLoading(true);
    setError(null);

    try {
      const result = await fetchScenario({
        originName: stops[originId].name,
        destinationName: stops[destinationId].name,
        startTime,
        endTime,
        stops,
      });

      // Coverage-aware overlap check against every prior search's
      // recommended route, computed client-side — purely additive, never
      // touches the backend's own overlap_pct/route_score/is_recommended.
      const covered = coveredSegmentsRef.current;
      const annotated: AnnotatedCandidate[] = result.candidates.map((c) => {
        const segs = segmentsFor(c.stop_ids);
        const existing = segs.filter((s) => covered.has(s)).length;
        const newSegmentCount = segs.length - existing;
        const networkOverlapPct = segs.length > 0 ? (existing / segs.length) * 100 : 0;
        return { ...c, networkOverlapPct, newSegmentCount };
      });
      const maxNew = Math.max(...annotated.map((c) => c.newSegmentCount ?? 0));
      const bestFitCount = annotated.filter((c) => c.newSegmentCount === maxNew).length;
      const finalCandidates = annotated.map((c) => ({
        ...c,
        isBestNetworkFit: maxNew > 0 && bestFitCount === 1 && c.newSegmentCount === maxNew,
      }));

      // Fold this search's recommended candidate into the accumulated
      // network for the *next* search's comparison — after computing this
      // one's own stats, so a search is never compared against itself.
      const recommendedCandidate = finalCandidates.find((c) => c.is_recommended);
      if (recommendedCandidate) {
        for (const seg of segmentsFor(recommendedCandidate.stop_ids)) {
          covered.add(seg);
        }
      }

      setActiveCode(null);
      setScenario({ ...result, candidates: finalCandidates });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

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

  // Draw this search's candidate routes + recommended-route stop markers
  // additively — every prior search's layers are left untouched, so routes
  // accumulate on the map across searches. Only a full page refresh (which
  // remounts the map from scratch) clears it. Each source/layer id is
  // scoped by candidate_code / scenario_id, which is unique per search, so
  // nothing here can collide with a previous search's ids.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !scenario || !stops) return;
    drawScenarioOnMap(map, scenario, stops);
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

    const stopsLayerId = recommendedStopsLayerId(scenario.scenario_id);
    if (map.getLayer(stopsLayerId)) {
      map.moveLayer(stopsLayerId);
    }
  }, [activeCode, mapReady, scenario]);

  return (
    <div className="flex h-full w-full flex-col bg-[#F7F8FA]">
      <RouteSearchBar
        stopOptions={stopOptions}
        originId={originId}
        destinationId={destinationId}
        startTime={startTime}
        endTime={endTime}
        onOriginChange={setOriginId}
        onDestinationChange={setDestinationId}
        onStartTimeChange={setStartTime}
        onEndTimeChange={setEndTime}
        canSearch={canSearch}
        loading={loading}
        onSubmit={handleFindRoutes}
      />

      <div className="flex min-h-0 flex-1">
        <div className="relative h-full w-[70%]">
          <div ref={mapContainerRef} className="h-full w-full" />
        </div>

        <div className="h-full w-[30%] overflow-y-auto border-l border-slate-200 p-5">
          <FetchStatus error={error} loading={loading} />
          {!error && !loading && !scenario && (
            <div className="p-6 text-sm text-slate-500">
              Choose a from/to stop and time window, then click{" "}
              <span className="font-medium text-slate-700">Find Routes</span>.
            </div>
          )}
          {!error && !loading && scenario && (
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
    </div>
  );
}

function CandidateCard({
  candidate,
  active,
  onClick,
}: {
  candidate: AnnotatedCandidate;
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">
          {candidate.candidate_code}
        </span>
        <div className="flex items-center gap-1.5">
          {candidate.isBestNetworkFit && (
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
              Best network fit
            </span>
          )}
          {candidate.is_recommended && (
            <span className="rounded-full bg-[#0E7A85]/10 px-2 py-0.5 text-xs font-medium text-[#0E7A85]">
              Recommended
            </span>
          )}
        </div>
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

      {candidate.networkOverlapPct !== undefined && (
        <p className="mt-2 text-xs text-slate-500">
          {candidate.networkOverlapPct.toFixed(0)}% overlaps existing network ·{" "}
          {candidate.newSegmentCount}{" "}
          {candidate.newSegmentCount === 1 ? "new segment" : "new segments"} added
        </p>
      )}
    </button>
  );
}
