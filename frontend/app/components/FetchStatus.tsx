"use client";

import { ORCHESTRATOR_URL } from "../lib/orchestrate";

export default function FetchStatus({
  error,
  loading,
  loadingLabel = "Loading live route data…",
}: {
  error: string | null;
  loading: boolean;
  loadingLabel?: string;
}) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-semibold">Couldn&apos;t load route data</p>
        <p className="mt-1 text-red-600">{error}</p>
        <p className="mt-2 text-xs text-red-500">
          Is the orchestrator running on {ORCHESTRATOR_URL}?
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#0E7A85]" />
        {loadingLabel}
      </div>
    );
  }

  return null;
}
