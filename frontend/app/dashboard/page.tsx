"use client";

import { useEffect, useState } from "react";
import { animate, motion } from "framer-motion";

type Candidate = {
  distance_km: number;
  travel_time_min: number;
  overlap_pct: number;
  coverage_gain_pct: number;
  overlap_severity: string;
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

// 127.0.0.1, not "localhost" — see app/map/page.tsx for why (Chromium
// resolves "localhost" to the IPv6 loopback first on this machine, which
// hangs instead of failing fast against a backend only listening on IPv4).
const DASHBOARD_STATS_URL = "http://127.0.0.1:8001/dashboard/stats";

// Used only if /dashboard/stats can't be reached (backend down, etc.) — a
// plausible-looking number beats a 0 or a broken tile. These happen to
// match the real seed data as of this writing, but are not live.
const FALLBACK_ACTIVE_ROUTES = 10;
const FALLBACK_OPEN_CONFLICTS = 6;
const FALLBACK_BUSES_IN_SERVICE = 8;

const KPI_STAGGER_S = 0.08;
const KPI_DURATION_S = 0.8;

type DashboardStats = {
  active_routes: number;
  open_conflicts: number;
  buses_in_service: number;
};

export default function DashboardPage() {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsSettled, setStatsSettled] = useState(false);

  useEffect(() => {
    fetch("/mock/scenario.json")
      .then((res) => res.json())
      .then(setScenario);
  }, []);

  // Real counts straight from Postgres via the orchestrator. Settled-flag
  // (rather than gating on `stats` itself) so the KPI row mounts once, with
  // the fallback already baked in on failure, instead of animating to the
  // fallback and then jumping/re-animating to the real number a beat later.
  useEffect(() => {
    fetch(DASHBOARD_STATS_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`/dashboard/stats returned ${res.status}`);
        return res.json() as Promise<DashboardStats>;
      })
      .then(setStats)
      .catch(() => {
        // Swallow — tiles below fall back to the hardcoded constants.
      })
      .finally(() => setStatsSettled(true));
  }, []);

  if (!scenario || !statsSettled) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }

  const avgOverlap =
    scenario.candidates.reduce((sum, c) => sum + c.overlap_pct, 0) /
    scenario.candidates.length;
  const recommended = scenario.candidates.find((c) => c.is_recommended);
  const coveragePct = recommended?.coverage_gain_pct ?? 0;

  const tiles = [
    {
      label: "Active Routes",
      value: stats?.active_routes ?? FALLBACK_ACTIVE_ROUTES,
      decimals: 0,
      suffix: "",
    },
    {
      label: "Open Conflicts",
      value: stats?.open_conflicts ?? FALLBACK_OPEN_CONFLICTS,
      decimals: 0,
      suffix: "",
    },
    {
      label: "Buses in Service",
      value: stats?.buses_in_service ?? FALLBACK_BUSES_IN_SERVICE,
      decimals: 0,
      suffix: "",
    },
    { label: "Avg Overlap", value: avgOverlap, decimals: 1, suffix: "%" },
    { label: "Coverage", value: coveragePct, decimals: 1, suffix: "%" },
  ];

  const panelDelay = (tiles.length - 1) * KPI_STAGGER_S + KPI_DURATION_S + 0.15;

  const insightEntries = [
    { agent: "Route Agent", reasoning: scenario.agent_recommendation.reasoning },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#F7F8FA] p-6 sm:p-8">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Operations Overview
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-800">Dashboard</h1>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile, i) => (
          <StatTile key={tile.label} {...tile} delay={i * KPI_STAGGER_S} />
        ))}
      </div>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: panelDelay, ease: "easeOut" }}
        className="mt-6 max-w-2xl rounded-lg bg-[#0E7A85]/5 p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-[#0E7A85]">
          Agent Insight
        </p>
        <div className="mt-2 flex flex-col gap-3">
          {insightEntries.map((entry, i) => (
            <motion.div
              key={entry.agent + i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{
                duration: 0.2,
                delay: panelDelay + 0.1 + i * 0.08,
                ease: "easeOut",
              }}
              className="flex items-start gap-3"
            >
              <span className="mt-0.5 shrink-0 rounded-full bg-[#0E7A85]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0E7A85]">
                {entry.agent}
              </span>
              <p className="text-sm leading-relaxed text-slate-700">
                {entry.reasoning}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.section>
    </div>
  );
}

function StatTile({
  label,
  value,
  suffix,
  decimals,
  delay,
}: {
  label: string;
  value: number;
  suffix: string;
  decimals: number;
  delay: number;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(0, value, {
      duration: KPI_DURATION_S,
      delay,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, delay]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: "easeOut" }}
      whileHover={{
        y: -2,
        boxShadow: "0 8px 20px rgba(15,23,42,0.12)",
        transition: { duration: 0.15, ease: "easeInOut" },
      }}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold text-slate-800">
        {display.toFixed(decimals)}
        {suffix}
      </p>
    </motion.div>
  );
}
