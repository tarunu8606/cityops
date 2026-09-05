# Scoring formulas — how a recommendation actually gets computed

This is the literal arithmetic behind every number the route agent and the frontend show — `distance_km`, `overlap_pct`, `coverage_gain_pct`, `route_score`, `is_recommended`, and the frontend's own "Best network fit" badge. Every formula here runs in plain Python (or plain TypeScript, for the one frontend-only section) — never inside an LLM call, per the project's core rule (see [README](README.md)). Verified directly against the running source, not written from memory, on 2026-09-05.

Source of truth: [`orchestrator-agent (1)/orchestrator-agent/app/services/route_service.py`](<orchestrator-agent (1)/orchestrator-agent/app/services/route_service.py>).

## 1. Candidate paths: widen the pool before scoring

```python
requested_pool = pool_size or max(k * 5, 10)
paths = nx.shortest_simple_paths(G, origin, destination, weight="travel_time_min")[:requested_pool]
```

`nx.shortest_simple_paths` yields paths in increasing order of total travel time. The first `k` of them alone tend to be near-duplicate detours around the same fastest corridor — barely exploring the actual tradeoff space between speed, overlap, and coverage. So the pool searched is `max(k*5, 10)` paths (for the default `k=3`, that's 15), *all* of them scored, and only the best `k` kept.

## 2. Per-candidate raw numbers

For each candidate path, `edges` is the set of directed consecutive stop-pairs it visits: `{(stop[0], stop[1]), (stop[1], stop[2]), ...}`.

```python
distance_km   = sum(G[u][v]["distance_km"]     for u, v in edges)
travel_time   = sum(G[u][v]["travel_time_min"] for u, v in edges)
```

Both are plain sums of the real road-segment weights on the graph — not straight-line distance, and not recalculated anywhere downstream.

## 3. Overlap % — how much of *this candidate* already exists

```python
existing = {directed edges already used by any non-CANCELLED/INACTIVE route}
shared   = len(edges & existing)
overlap_pct = round(shared / max(len(edges), 1) * 100, 2)
```

Reads as: *"of this candidate's own edges, what fraction are already part of some other route?"* `existing` is pulled fresh from `route_points` every call — it is not a cached table.

One thing worth being precise about: `existing` is built from **directed** edges (a route's stop sequence gives `A→B`, not `A→B` *and* `B→A`), so a candidate that reuses a corridor in the *reverse* direction of an existing route does **not** count as overlap here. (The frontend's own client-side check, §7 below, makes the opposite choice — deliberately, for a different question.)

## 4. Coverage gain % — this is *not* "% of new stops"

```python
total_existing = max(len(existing), 1)   # size of the whole existing-route edge set
coverage_gain_pct = round((len(edges - existing) / total_existing) * 100, 2)
```

This is easy to misread, so spelling it out: it's **not** "what fraction of this candidate's stops are new." It's *"how many of this candidate's brand-new edges are added, as a fraction of the size of the entire existing route network."* A short candidate that runs entirely through unserved territory can post a fairly small coverage-gain number simply because the *existing* network (the denominator) is large — that's expected, not a bug.

## 5. Overlap severity — three buckets, not five

```python
overlap_severity = (
    "HIGH"   if overlap_pct >= 60 else
    "MEDIUM" if overlap_pct >= 30 else
    "LOW"
)
```

(An earlier design draft in `CLAUDE.md` sketched a five-bucket MINIMAL/LOW/MODERATE/HIGH/CRITICAL scheme for a different, now-superseded `route_service.py`. The version actually running — and the one every screenshot in this repo's history was taken against — uses these three.)

## 6. Route score — **lower is better**

```python
route_score = round(
    (distance_km * 1.0) + (overlap_pct * 0.15) - (coverage_gain_pct * 0.35),
    2,
)
```

This is the one place people's intuition most often trips up: **a lower `route_score` is the better candidate.** Distance and overlap both push the score *up* (bad); coverage gain pulls it *down* (good). Candidates are sorted ascending and rank 1 — the *lowest* score — is the winner:

```python
raw.sort(key=lambda x: x["route_score"])
candidates = raw[:k]
candidates[0]["is_recommended"] = True   # rank 1 only
```

This is exactly why a real AI Insight response reads like *"the only route flagged as recommended... **despite its lower route_score (10.25)** compared to the other options"* — the agent isn't confused; a lower number really is the right pick here, and it's just saying so plainly.

## 7. Frontend-only: client-side "network coverage" check

This runs entirely in the browser, in `frontend/app/map/page.tsx` — it never touches the backend, and it never changes `overlap_pct`, `route_score`, or `is_recommended`. It answers a different, additive question: *"compared to every route this browser session has already searched and accepted, how much of this new candidate is actually new pavement?"*

```typescript
const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);   // undirected, deliberately —
                                                                    // see the note in §3 above
const segmentsFor = (stopIds) => stopIds consecutive pairs, as edgeKey strings;

// covered = accumulated edge set from every prior search's recommended candidate
const existingCount   = segmentsFor(candidate.stop_ids).filter(s => covered.has(s)).length;
const newSegmentCount = segmentsFor(candidate.stop_ids).length - existingCount;
const networkOverlapPct = existingCount / segmentsFor(candidate.stop_ids).length * 100;
```

After a search's own three candidates are scored this way, only its **recommended** candidate's edges get folded into `covered`, for the *next* search's comparison:

```typescript
const maxNew = Math.max(...candidates.map(c => c.newSegmentCount));
const isBestNetworkFit = maxNew > 0 && exactlyOneCandidateHasMaxNew;
```

"Best network fit" is only ever awarded when one candidate strictly leads — a genuine tie between candidates correctly produces *no* badge, rather than picking a winner arbitrarily.

## 8. Crew agent: a proposal, not a formula

Worth being honest that not everything here is arithmetic. `crew_agent.py`'s conflict resolution has no scoring formula at all — it hands Gemini the real list of `OPEN` conflicts, `AVAILABLE` crew, and `AVAILABLE` buses (straight from Postgres) along with hard constraints ("a conductor may only be reassigned to drive if they hold a `HEAVY_MOTOR` license," "every proposed `crew_id`/`bus_id` must come from the provided lists — never invent one," "if nothing available can staff a conflict, escalate it, don't guess") and asks it to propose reassignments. There's a real gate (every ID gets checked against what was actually offered) but no numeric score to compute — the LLM's job here is closer to constraint-satisfaction-by-reasoning than to arithmetic, which is exactly why it's validated rather than scored.

## 9. How the final on-screen status is decided

One last piece of "how we conclude the answer" — the overall response `status`, in `orchestrator/validator.py`:

```python
def determine_status(agent_errors, crew_result, validation, unresolved):
    if agent_errors:                                   return "AGENT_ERROR"
    if unresolved:                                      return "ESCALATION_REQUIRED"
    if not validation["valid"]:                          return "APPROVAL_REQUIRED"
    if crew_result and crew_result["proposed_actions"]:   return "APPROVAL_REQUIRED"
    if crew_result and crew_result["unresolved_escalations"]: return "SUCCESS_WITH_WARNINGS"
    return "SUCCESS"
```

Checked top-to-bottom, first match wins. Notably: **any** crew proposal at all — even a perfectly valid one — forces `APPROVAL_REQUIRED`, never a bare `SUCCESS`. Nothing the agents propose is ever presented as already-decided; a human approval step is structurally unavoidable, not just a UI convention.
