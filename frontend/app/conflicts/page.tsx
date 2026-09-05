"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const AMBER = "#F59E0B";
// A red-orange, not a dark-theme red — stays legible and "warning-family"
// on a light card instead of reading as an alarm klaxon.
const CRITICAL_RED = "#E5484D";

type ProposedAction = {
  route_id: number;
  crew_id: number;
  bus_id: number;
  assignment_mode: string;
  resolution_type: string;
  resolution_status: string;
  attempt_number: number;
  ai_reasoning: string;
};

type Escalation = {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  related_route_id: number;
  description: string;
};

type ResolvedConflict = {
  conflict_id: number;
  status: string;
  resolution_note: string;
};

type CrewResult = {
  status: string;
  proposed_actions: ProposedAction[];
  unresolved_escalations: Escalation[];
  resolved_conflicts: ResolvedConflict[];
};

type LastDuty = {
  route_code: string;
  start_time: string;
  end_time: string;
  status: string;
};

type Driver = {
  crew_id: number;
  name: string;
  role: string;
  license_type: string;
  qualified_routes: string[];
  utilization_pct: number;
  last_duty: LastDuty;
};

type FeedItem =
  | { kind: "proposed"; key: string; data: ProposedAction }
  | { kind: "escalation"; key: string; data: Escalation };

const humanize = (s: string) =>
  s
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

const formatDuty = (duty: LastDuty) => {
  const start = new Date(duty.start_time);
  const end = new Date(duty.end_time);
  const time = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${duty.route_code} · ${time(start)}–${time(end)} · ${humanize(duty.status)}`;
};

export default function ConflictsPage() {
  const [crewResult, setCrewResult] = useState<CrewResult | null>(null);
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [activeDriverId, setActiveDriverId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/mock/conflicts.json").then((res) => res.json() as Promise<CrewResult>),
      fetch("/mock/crew.json").then((res) => res.json() as Promise<Driver[]>),
    ]).then(([crew, drivers]) => {
      setCrewResult(crew);
      setDrivers(drivers);
    });
  }, []);

  useEffect(() => {
    if (activeDriverId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveDriverId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeDriverId]);

  const driverById = useMemo(() => {
    const map = new Map<number, Driver>();
    for (const d of drivers ?? []) map.set(d.crew_id, d);
    return map;
  }, [drivers]);

  const activeDriver =
    activeDriverId !== null ? driverById.get(activeDriverId) ?? null : null;

  if (!crewResult || !drivers) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }

  // Feed = union of proposed_actions + unresolved_escalations. resolved_conflicts
  // is part of the real crew_result shape (kept in the mock for fidelity) but
  // isn't rendered here — this feed is specifically "what needs attention now."
  const feed: FeedItem[] = [
    ...crewResult.proposed_actions.map(
      (a, i): FeedItem => ({ kind: "proposed", key: `proposed-${i}`, data: a })
    ),
    ...crewResult.unresolved_escalations.map(
      (e, i): FeedItem => ({ kind: "escalation", key: `escalation-${i}`, data: e })
    ),
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#F7F8FA] p-6 sm:p-8">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Crew Resolution
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-800">Conflicts</h1>
      </header>

      <div className="flex max-w-3xl flex-col gap-3">
        {feed.map((item, i) => (
          <motion.div
            key={item.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.06, ease: "easeOut" }}
            whileHover={{
              y: -2,
              boxShadow: "0 8px 20px rgba(15,23,42,0.12)",
              transition: { duration: 0.15, ease: "easeInOut" },
            }}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
          >
            {item.kind === "proposed" ? (
              <ProposedActionCard
                action={item.data}
                driver={driverById.get(item.data.crew_id) ?? null}
                onDriverClick={() => setActiveDriverId(item.data.crew_id)}
              />
            ) : (
              <EscalationCard escalation={item.data} />
            )}
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {activeDriver && (
          <DriverModal
            driver={activeDriver}
            onClose={() => setActiveDriverId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ProposedActionCard({
  action,
  driver,
  onDriverClick,
}: {
  action: ProposedAction;
  driver: Driver | null;
  onDriverClick: () => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: `${AMBER}26`, color: "#92400E" }}
        >
          Proposed · {humanize(action.resolution_type)}
        </span>
        <span className="text-xs text-slate-400">Route {action.route_id}</span>
        <span className="text-xs text-slate-400">·</span>
        <span className="text-xs text-slate-400">Bus {action.bus_id}</span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-slate-700">
        {action.ai_reasoning}
      </p>

      <button
        type="button"
        onClick={onDriverClick}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition-all duration-150 ease-in-out hover:border-[#0E7A85]/40 hover:bg-[#0E7A85]/5 hover:text-[#0E7A85]"
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: "#0E7A85" }}
        />
        {driver ? driver.name : `Crew ${action.crew_id}`}
      </button>
    </div>
  );
}

function EscalationCard({ escalation }: { escalation: Escalation }) {
  const critical = escalation.severity === "HIGH" || escalation.severity === "CRITICAL";
  const color = critical ? CRITICAL_RED : AMBER;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: `${color}26`,
            color: critical ? "#9A1F24" : "#92400E",
          }}
        >
          Escalation · {escalation.severity}
        </span>
        <span className="text-xs text-slate-400">{humanize(escalation.type)}</span>
        <span className="text-xs text-slate-400">·</span>
        <span className="text-xs text-slate-400">
          Route {escalation.related_route_id}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">
        {escalation.description}
      </p>
    </div>
  );
}

function DriverModal({
  driver,
  onClose,
}: {
  driver: Driver;
  onClose: () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{driver.name}</h2>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              {humanize(driver.role)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-y-3 text-sm">
          <dt className="text-slate-400">License</dt>
          <dd className="text-right font-medium text-slate-700">
            {humanize(driver.license_type)}
          </dd>

          <dt className="text-slate-400">Utilization</dt>
          <dd className="text-right font-medium text-slate-700">
            {driver.utilization_pct.toFixed(0)}%
          </dd>

          <dt className="text-slate-400">Qualified routes</dt>
          <dd className="text-right font-medium text-slate-700">
            {driver.qualified_routes.join(", ")}
          </dd>

          <dt className="text-slate-400">Last duty</dt>
          <dd className="text-right font-medium text-slate-700">
            {formatDuty(driver.last_duty)}
          </dd>
        </dl>
      </motion.div>
    </motion.div>
  );
}
