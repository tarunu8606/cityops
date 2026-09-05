"use client";

type StopOption = { id: string; name: string };

export default function RouteSearchBar({
  stopOptions,
  originId,
  destinationId,
  startTime,
  endTime,
  onOriginChange,
  onDestinationChange,
  onStartTimeChange,
  onEndTimeChange,
  canSearch,
  loading,
  onSubmit,
}: {
  stopOptions: StopOption[];
  originId: string;
  destinationId: string;
  startTime: string;
  endTime: string;
  onOriginChange: (id: string) => void;
  onDestinationChange: (id: string) => void;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  canSearch: boolean;
  loading: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-white px-5 py-3">
      <Field label="From">
        <select
          value={originId}
          onChange={(e) => onOriginChange(e.target.value)}
          className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-[#0E7A85] focus:outline-none"
        >
          <option value="">Select stop…</option>
          {stopOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="To">
        <select
          value={destinationId}
          onChange={(e) => onDestinationChange(e.target.value)}
          className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-[#0E7A85] focus:outline-none"
        >
          <option value="">Select stop…</option>
          {stopOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Start Time">
        <input
          type="datetime-local"
          value={startTime}
          onChange={(e) => onStartTimeChange(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-[#0E7A85] focus:outline-none"
        />
      </Field>

      <Field label="End Time">
        <input
          type="datetime-local"
          value={endTime}
          onChange={(e) => onEndTimeChange(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-[#0E7A85] focus:outline-none"
        />
      </Field>

      {originId && destinationId && originId === destinationId && (
        <p className="text-xs text-red-600">Origin and destination must differ.</p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSearch || loading}
        className="ml-auto rounded-lg bg-[#0E7A85] px-4 py-2 text-sm font-semibold text-white transition-all duration-150 ease-in-out hover:bg-[#0c6871] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
      >
        {loading ? "Finding Routes…" : "Find Routes"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
