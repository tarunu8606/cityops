"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import * as turf from "@turf/turf";
import type { Feature, LineString } from "geojson";
import { motion } from "framer-motion";
import "maplibre-gl/dist/maplibre-gl.css";
import "../lib/maplibreSetup";
import { TEAL } from "../lib/theme";
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
import { drawScenarioOnMap } from "../lib/mapDraw";
import RouteSearchBar from "../components/RouteSearchBar";
import FetchStatus from "../components/FetchStatus";

const COIMBATORE_CENTER: [number, number] = [76.9558, 11.0168];
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

// Demo pace, not real-time — the real travel_time_min (tens of real
// minutes) would make for an unwatchable demo. The distance/overlap/
// coverage numbers shown are still the real precomputed values; only the
// replay speed of the marker moving along the route is compressed.
const SIMULATION_DURATION_MS = 9000;

function createBusElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "28px";
  el.style.height = "28px";
  el.style.borderRadius = "9999px";
  el.style.background = "#ffffff";
  el.style.border = `2px solid ${TEAL}`;
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.fontSize = "14px";
  el.style.lineHeight = "1";
  el.style.boxShadow = "0 2px 6px rgba(15,23,42,0.3)";
  el.textContent = "🚌";
  return el;
}

export default function SimulationPage() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  // Combined bounds across every search so far — extended (never reset) on
  // each new route, so fitBounds always frames everything accumulated on
  // the map, not just the newest route (which could leave an older one
  // off-screen, or vice versa).
  const boundsRef = useRef<maplibregl.LngLatBounds | null>(null);

  const [stops, setStops] = useState<StopsLookup | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0); // 0..1 along the route
  const [isPlaying, setIsPlaying] = useState(false);

  const [originId, setOriginId] = useState(DEFAULT_ORIGIN_ID);
  const [destinationId, setDestinationId] = useState(DEFAULT_DESTINATION_ID);
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);

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
    setIsPlaying(false);
    setProgress(0);

    try {
      const result = await fetchScenario({
        originName: stops[originId].name,
        destinationName: stops[destinationId].name,
        startTime,
        endTime,
        stops,
      });
      setScenario(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const recommended: Candidate | null = useMemo(
    () => scenario?.candidates.find((c) => c.is_recommended) ?? null,
    [scenario]
  );

  const { line, lineLengthKm, coords } = useMemo(() => {
    if (!recommended || !stops) {
      return { line: null as Feature<LineString> | null, lineLengthKm: 0, coords: [] as [number, number][] };
    }
    const pathCoords: [number, number][] = recommended.stop_ids.map((id) => {
      const s = stops[String(id)];
      return [s.lon, s.lat];
    });
    const ln = turf.lineString(pathCoords);
    return { line: ln, lineLengthKm: turf.length(ln, { units: "kilometers" }), coords: pathCoords };
  }, [recommended, stops]);

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
  // additively — identical accumulation behavior to /map, via the same
  // shared function. Every prior search's layers are left untouched; only
  // a full page refresh clears the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !scenario || !stops) return;
    drawScenarioOnMap(map, scenario, stops);
  }, [mapReady, scenario, stops]);

  // The bus marker tracks only the *latest* search's recommended route —
  // older searches stay as static lines (drawn above) with no marker of
  // their own. Re-runs once per search since `recommended`/`coords` are
  // both derived from `scenario`, which changes once per search.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !recommended || coords.length === 0) return;

    markerRef.current?.remove();
    const marker = new maplibregl.Marker({ element: createBusElement(), anchor: "center" })
      .setLngLat(coords[0])
      .addTo(map);
    markerRef.current = marker;

    return () => {
      marker.remove();
    };
  }, [mapReady, recommended, coords]);

  // Fit the view to *everything* drawn so far (this search's route plus
  // every earlier one), so a new route can never push an old one off
  // screen or vice versa.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || coords.length === 0) return;

    if (!boundsRef.current) {
      boundsRef.current = new maplibregl.LngLatBounds(coords[0], coords[0]);
    }
    for (const c of coords) {
      boundsRef.current.extend(c);
    }
    map.fitBounds(boundsRef.current, { padding: 80, duration: 500 });
  }, [mapReady, coords]);

  // Move the bus marker along the precomputed line as progress changes.
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || !line || lineLengthKm <= 0) return;
    const dist = Math.min(Math.max(progress, 0), 1) * lineLengthKm;
    const point = turf.along(line, dist, { units: "kilometers" });
    const [lon, lat] = point.geometry.coordinates;
    marker.setLngLat([lon, lat]);
  }, [progress, line, lineLengthKm]);

  // Playback loop.
  useEffect(() => {
    if (!isPlaying) {
      lastTsRef.current = null;
      return;
    }
    const tick = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;
      setProgress((p) => {
        const next = p + dt / SIMULATION_DURATION_MS;
        if (next >= 1) {
          setIsPlaying(false);
          return 1;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  const handlePlayPause = () => {
    if (!isPlaying && progress >= 1) setProgress(0);
    setIsPlaying((p) => !p);
  };

  const playLabel = isPlaying ? "Pause" : progress >= 1 ? "Replay" : "Play";

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

      <div className="relative min-h-0 flex-1">
        <div ref={mapContainerRef} className="h-full w-full" />

        {(error || loading) && (
          <div className="absolute left-6 top-6 z-10 w-80">
            <FetchStatus error={error} loading={loading} loadingLabel="Finding a route to simulate…" />
          </div>
        )}

        {!error && !loading && !recommended && (
          <div className="absolute left-6 top-6 z-10 rounded-lg border border-slate-200 bg-white/90 p-4 text-sm text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
            Choose a from/to stop and time window, then click{" "}
            <span className="font-medium text-slate-700">Find Routes</span> to simulate a bus
            along the recommended route.
          </div>
        )}

        {recommended && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="absolute bottom-6 left-6 z-10 w-80 rounded-xl border border-white/40 bg-white/70 p-4 shadow-lg backdrop-blur-md"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-[#0E7A85]">
              Route Simulation · {recommended.candidate_code}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {scenario?.origin} → {scenario?.destination}
            </p>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  Distance
                </p>
                <p className="mt-0.5 whitespace-nowrap text-xs font-semibold text-slate-800 sm:text-sm">
                  {(progress * recommended.distance_km).toFixed(1)}
                  <span className="text-slate-400"> /{recommended.distance_km.toFixed(1)}km</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  Route Overlap
                </p>
                <p className="mt-0.5 text-sm font-semibold text-slate-800">
                  {recommended.overlap_pct.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  Coverage Gain
                </p>
                <p className="mt-0.5 text-sm font-semibold text-slate-800">
                  {recommended.coverage_gain_pct.toFixed(1)}%
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <motion.button
                type="button"
                onClick={handlePlayPause}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.12, ease: "easeInOut" }}
                className="shrink-0 rounded-lg bg-[#0E7A85] px-3 py-1.5 text-xs font-semibold text-white"
              >
                {playLabel}
              </motion.button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={progress}
                onChange={(e) => {
                  setIsPlaying(false);
                  setProgress(Number(e.target.value));
                }}
                className="w-full accent-[#0E7A85]"
                aria-label="Scrub route progress"
              />
            </div>

            <p className="mt-3 text-[10px] italic text-slate-500">
              Simulated replay of precomputed route data — not live tracking.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
