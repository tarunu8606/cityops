# CityOps

**Smart scheduling and route management for a city bus network — built in a 24-hour hackathon, with a hard rule: no AI model is ever allowed to be the source of truth for a number.**

Coimbatore's synthetic transit network (38 stops, 160 road segments, 10 routes, 26 crew, 16 buses) gets a route-recommendation engine, a crew-conflict resolver, and a live map/simulation frontend — with two LLMs doing the reasoning and exactly zero arithmetic.

---

## The one rule everything else follows

> **Agents propose, deterministic Python decides.**

Every "smart" number in this system — route distance, corridor overlap, crew rest-hour compliance, coverage gain, a route's recommendation score — is computed by plain Python (NetworkX graph algorithms, SQL aggregates, arithmetic) *before* any LLM sees it. The LLMs never calculate anything. They're handed a JSON blob of already-computed facts and asked to do exactly one job: explain, in a sentence or two, why the deterministic answer is the deterministic answer.

This wasn't a nice-to-have constraint added after the fact — it's the reason the architecture looks the way it does. `route_agent.py` calls `route_service.generate_candidates()` (pure graph math) and only then asks Groq to justify the winner. `crew_agent.py` calls a live Postgres query for open conflicts and available crew, and only then asks Gemini to propose reassignments — and every proposal still has to pass through a validator before it's treated as real. If an LLM call fails outright, the system doesn't break; it falls back to a templated explanation built from the same numbers, because the *decision* was never the LLM's to make in the first place.

## Architecture

```
┌─────────────────────────────┐
│   Next.js frontend           │   picker → fetch → render
│   (map / simulation /        │
│    dashboard / conflicts)    │
└──────────────┬───────────────┘
               │ POST /agents/orchestrate
               ▼
┌─────────────────────────────────────────────────────┐
│  FastAPI orchestrator                                 │
│                                                        │
│   validator.py  →  resolve stops, validate scenario   │
│   route_agent.py → graph_service + route_service      │
│                     (NetworkX, pure math) → Groq       │
│                     (justify only)                     │
│   crew_agent.py  → live SQL for conflicts/crew/buses   │
│                     → Gemini (propose only)            │
│   combiner.py    → assembles the final response         │
│                                                        │
│   Nothing here writes to the DB. Ever.                │
└──────────────────────────┬────────────────────────────┘
                            ▼
                    PostgreSQL 16 (Docker)
                    12 tables, hand-seeded,
                    synthetic Coimbatore data
```

Two separate LLM providers is not an accident of taste — it's what actually happened. The route agent was built against Groq first; the crew agent was built independently (twice, in fact — see [Field notes](#field-notes-things-that-actually-broke)) against Gemini. Rather than force a consolidation under a hackathon clock, both stayed, because the core principle doesn't care which LLM is doing the explaining — it only cares that neither one is doing the deciding.

## Tech stack, and why

**Backend**
| Choice | Why |
|---|---|
| FastAPI | Fast to stand up, typed request/response models, free `/docs` |
| SQLAlchemy Core, raw `text()` SQL — **no ORM** | The schema uses hand-assigned integer primary keys with no sequences (see below); an ORM would fight that decision at every insert. Raw SQL just says what it means. |
| PostgreSQL 16 in Docker | Needed real array columns (`route_candidates.stop_ids INTEGER[]`) and a proper `TIMESTAMP` type — SQLite's type coercion would have hidden real bugs instead of surfacing them |
| NetworkX | The actual route-finding is a real graph problem (`nx.shortest_simple_paths` over a weighted `DiGraph`) — reimplementing k-shortest-paths by hand wasn't a good use of hackathon hours |
| Groq (route agent) / Gemini (crew agent) | See above — two independently-built agents, never consolidated, because the architecture doesn't require them to match |

**Frontend**
| Choice | Why |
|---|---|
| Next.js 16 (App Router) + TypeScript | The map view needed a real component framework once MapLibre entered the picture — "no build step" stopped being realistic the moment interactive maps did |
| Tailwind CSS v4 | Fast iteration on a light design system (`#F7F8FA` / teal `#0E7A85` / amber `#F59E0B`) shared across five screens |
| MapLibre GL JS + Turf.js | Real vector-tile maps (no API key needed — [OpenFreeMap](https://openfreemap.org)) and real geometry (`turf.along()` for the bus animation) instead of faked pixel math |
| Framer Motion | Consistent entrance/hover/transition language across five screens that were built in five separate passes — the animation vocabulary is what makes them read as one app |

## The data

12 tables, seeded once as raw SQL (not a Python seeder — see `backend/app/data/sql/`), all hand-assigned IDs rather than `SERIAL` columns. That design choice is deliberate (every table needs a *specific*, reproducible ID for demo purposes) and it's also exactly what caused [bug #3 below](#field-notes-things-that-actually-broke).

The seed data has a quirk worth knowing about before you go looking for a bug that isn't one: stop 15 (Peelamedu) ↔ stop 20 (Singanallur) is listed **twice** in `road_segments`, in both directions, with identical weights. The SQL table correctly has 160 rows; a `NetworkX` `DiGraph` can't hold parallel edges, so the graph collapses to **158**. `test_graph.py` asserts 158, not 160, on purpose.

## Field notes: things that actually broke

The interesting part of a hackathon build isn't the happy path — it's what you find when you actually run the thing instead of assuming it works. In order of "how long it took to figure out":

**The map that loaded everything except the map.** MapLibre GL v6 loads its tile-parsing logic as a separate ESM worker chunk at runtime. Next's webpack build silently doesn't resolve it — no console error, no failed network request, just a basemap that never paints. Confirmed with an isolated static-HTML repro (blank without the worker file, full Coimbatore streets with it) before landing the real fix: `maplibregl.setWorkerUrl(...)` pointed at a committed static copy of the two files MapLibre actually needs.

**Windows doesn't treat `localhost` the way you'd think.** Twice, independently: once when Postgres was reachable on `127.0.0.1:5433` but the app hung indefinitely on `localhost:5433` (Chromium/Node resolve `localhost` to the IPv6 loopback `::1` first; nothing was listening there, and Windows hangs that connection instead of refusing it fast); once again when the frontend's `fetch()` to the FastAPI backend did the exact same thing on port 8001. Both fixed the same way: address the IPv4 loopback explicitly instead of fighting Windows' dual-stack behavior.

**A primary key with no way to generate itself.** Every table uses `INTEGER PRIMARY KEY` with no default and no sequence — by design, so the seed data can be exact. First live write through the orchestrator (`create_or_get_scenario`) discovered the natural consequence: nothing computes a new ID for a *new* row. Fixed with a small, deliberately reusable `next_id(conn, table)` helper (`SELECT COALESCE(MAX(id), 0) + 1`, run inside the same transaction as the insert) — written once, for the first table that needed it, so the next table that hits this doesn't have to rediscover it.

**The model got deprecated mid-project.** `llama-3.3-70b-versatile` — the model the route agent was built against — was decommissioned by Groq partway through the build. Caught it via `client.models.list()` rather than guessing, and moved to `openai/gpt-oss-120b`, which was actually faster in testing.

**Two independent rewrites of the same agent.** A teammate built a crew-conflict agent (`hacktronics/crew_agent.py`) as its own standalone FastAPI microservice with its own Postgres container. Independently, a more defensive version existed in this repo's own `orchestrator-agent/app/agents/crew_agent.py` — same idea, but it validates before letting the LLM guess at IDs, escalates instead of fabricating, and never returns `None`. The second one shipped; the first stayed in its own folder, explicitly out of the repo's dependency graph, as a reminder that "it works" and "it's the one we're keeping" aren't always the same review.

**A secret that almost made it into git.** While wiring up the real backend, its `.env` — containing live Gemini and Groq API keys — turned out to be sitting untracked with no `.gitignore` protecting it. A blind `git add -A` would have put both keys into git history permanently. Caught before staging, fixed with a `.gitignore` scoped to that folder, and verified with `git diff --cached --name-only | grep .env` that the fix actually worked — not assumed.

## What's real, and what's honestly not

This project is fussy about the difference on purpose:

- **Route recommendations, overlap %, coverage gain, rest-hour and conflict detection** — all real, computed by `graph_service`/`route_service`/the validator against live Postgres data.
- **The bus "simulation" on `/simulation`** — Turf.js interpolating a marker along a *real* precomputed route at a compressed, watchable speed. It says so, out loud, in the UI: *"Simulated replay of precomputed route data — not live tracking."* It was never going to be presented as anything else.
- **The dashboard's "Best network fit" badge** — a client-side-only comparison of a new route's stop-to-stop segments against every previously-searched route's recommended path, additive to (never replacing) the backend's own `is_recommended` flag. Two different questions, two different badges, on purpose.
- **Three of the dashboard's five KPI tiles** were placeholders for exactly as long as `/dashboard/stats` didn't exist yet — clearly marked `// TODO` in the source the whole time, not silently faked as real.

## Project structure

```
backend/                    # Phase 1–2 scaffold: graph_service, route_service, route_agent
                             # (superseded by orchestrator-agent's more complete rebuild)
orchestrator-agent (1)/      # the real, running backend
  orchestrator-agent/
    app/
      main.py                 # FastAPI app, CORS, /dashboard/stats, /agents/orchestrate
      db.py                    # engine + next_id() helper
      agents/
        route_agent.py          # Groq — justifies route_service's pick
        crew_agent.py            # Gemini — proposes crew/bus reassignments
      orchestrator/
        orchestrator.py          # ties both agents + validation together
        validator.py             # stop/scenario resolution, output validation
        combiner.py              # assembles the final response
      services/
        graph_service.py         # NetworkX DiGraph over the Coimbatore stop graph
        route_service.py         # k-shortest-paths candidate generation + scoring
frontend/
  app/
    page.tsx                    # landing screen (dark glass, its own design language)
    dashboard/, conflicts/, map/, simulation/
    lib/                         # shared: orchestrate.ts (fetch+adapter), mapDraw.ts, theme.ts
    components/                  # shared: RouteSearchBar, FetchStatus
hacktronics (1)/              # teammate's independent crew-agent build — not wired in
CLAUDE.md                    # running architecture doc, kept in sync with the code as it evolved
```

## Running it locally

```bash
# Postgres (Docker, host port 5433 — a native Windows Postgres service already owns 5432)
docker start cityops-db
docker exec -i cityops-db psql -U postgres -d cityops < backend/app/data/sql/01_schema.sql
docker exec -i cityops-db psql -U postgres -d cityops < backend/app/data/sql/02_seed.sql

# Backend
cd "orchestrator-agent (1)/orchestrator-agent"
python -m venv .venv && ./.venv/Scripts/pip install -r requirements.txt
cp .env.example .env   # fill in GEMINI_API_KEY and GROQ_API_KEY
./.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8001

# Frontend
cd frontend
npm install
npm run dev   # http://localhost:3000
```

Full architecture notes, schema details, and the phase-by-phase build log live in [`CLAUDE.md`](CLAUDE.md).
