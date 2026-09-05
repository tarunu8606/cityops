export type OverlapSeverity = "MINIMAL" | "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export type Candidate = {
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

export type Scenario = {
  status: string;
  scenario_id: number;
  origin: string;
  destination: string;
  candidates: Candidate[];
  agent_recommendation: { candidate_code: string; reasoning: string };
};

export type Stop = { name: string; lat: number; lon: number };
export type StopsLookup = Record<string, Stop>;

// Shape of orchestrate_response.route_result.candidates[] from the live
// backend — deliberately NOT the same field names as Candidate above (path
// vs stop_ids, estimated_travel_time_min vs travel_time_min, no
// stop_names). Adapted into Candidate by fetchScenario() below so no
// rendering code anywhere has to know the difference.
type LiveCandidate = {
  distance_km: number;
  estimated_travel_time_min: number;
  overlap_pct: number;
  coverage_gain_pct: number;
  overlap_severity: OverlapSeverity;
  route_score: number;
  rank: number;
  is_recommended: boolean;
  candidate_code: string;
  path: number[];
};

type OrchestrateResponse = {
  status: string;
  scenario_id: number;
  route_result: {
    status: string;
    scenario_id: number;
    origin: string;
    destination: string;
    candidates: LiveCandidate[];
    agent_recommendation: { candidate_code: string; reasoning: string };
  } | null;
};

// 127.0.0.1, not "localhost" — on this machine, Chromium resolves
// "localhost" to the IPv6 loopback (::1) first, which the backend isn't
// listening on and which hangs instead of failing fast on Windows. Forcing
// IPv4 sidesteps it entirely.
export const ORCHESTRATOR_URL = "http://127.0.0.1:8001/agents/orchestrate";

// Same origin/destination/timestamps already proven against the live
// backend — prefilled form defaults on both /map and /simulation. Neither
// page auto-submits them; the user still has to click "Find Routes".
export const DEFAULT_ORIGIN_ID = "28"; // Kovaipudur
export const DEFAULT_DESTINATION_ID = "15"; // Peelamedu
export const DEFAULT_START_TIME = "2026-09-02T06:00";
export const DEFAULT_END_TIME = "2026-09-02T21:00";

export async function fetchStops(): Promise<StopsLookup> {
  const res = await fetch("/mock/stops.json");
  return res.json() as Promise<StopsLookup>;
}

export async function fetchScenario(params: {
  originName: string;
  destinationName: string;
  startTime: string; // datetime-local value, no seconds
  endTime: string;
  stops: StopsLookup;
}): Promise<Scenario> {
  const res = await fetch(ORCHESTRATOR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origin: params.originName,
      destination: params.destinationName,
      start_time: `${params.startTime}:00`,
      end_time: `${params.endTime}:00`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Orchestrator returned ${res.status}: ${body}`);
  }

  const orchestrateResponse = (await res.json()) as OrchestrateResponse;
  const routeResult = orchestrateResponse.route_result;
  if (!routeResult || routeResult.status !== "success") {
    throw new Error(
      "Orchestrator responded but route_result was missing or unsuccessful"
    );
  }

  return {
    status: routeResult.status,
    scenario_id: routeResult.scenario_id,
    origin: routeResult.origin,
    destination: routeResult.destination,
    agent_recommendation: routeResult.agent_recommendation,
    candidates: routeResult.candidates.map((c) => ({
      stop_ids: c.path,
      stop_names: c.path.map((id) => params.stops[String(id)]?.name ?? `Stop ${id}`),
      distance_km: c.distance_km,
      travel_time_min: c.estimated_travel_time_min,
      overlap_pct: c.overlap_pct,
      coverage_gain_pct: c.coverage_gain_pct,
      overlap_severity: c.overlap_severity,
      route_score: c.route_score,
      rank: c.rank,
      is_recommended: c.is_recommended,
      candidate_code: c.candidate_code,
    })),
  };
}
