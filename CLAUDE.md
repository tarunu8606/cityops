# CityOps — Smart Scheduling & Route Management for City Bus Networks

Hackathon project (15-hour build). This file is the source of truth for
architecture, schema, API shapes, agent/tool contracts, and the phase plan.
Keep it in sync with the code — if something here turns out to be wrong in
practice, edit this file in the same commit that changes the code.

## Core principle (non-negotiable)

**Agents propose, deterministic Python decides.** No LLM call is ever the
source of truth for a number or a yes/no. Rest-hour checks, overlap %,
availability, and conflict detection all live in `backend/app/services/` as
plain Python. Agents only call those functions as tools and reason over the
structured result they return. No agent or tool writes to the DB directly —
every proposed assignment is passed through `validation_service` and only
committed if it passes.

## Pipeline (one sentence)

Seed data → deterministic graph/scheduling services compute routes,
availability, rest compliance, and conflicts → an LLM agent proposes
assignments by calling those services as tools → `validation_service`
re-checks every proposal against the same deterministic rules → only
validated assignments are committed to the DB → frontend reads committed
state plus any flagged conflicts.

## Tech stack

- Backend: FastAPI (API layer not yet rebuilt — see Phase plan) + SQLAlchemy
  Core (raw `text()` queries, no ORM) + **PostgreSQL 16**, running in a
  Docker container named `cityops-db` (`postgres:16` image, db `cityops`,
  user `postgres`, password `cityops123`), mapped to **host port 5433**
  (not 5432 — a native Windows PostgreSQL service already owns 5432 on this
  machine; see Run instructions).
- Schema and seed data are plain SQL files under `backend/app/data/sql/`,
  applied directly with `psql` — not a Python seeder. Synthetic Coimbatore
  transit data: 38 stops, 160 road segment rows (see Graph model note on
  duplicate corridor), 10 routes, buses, crew, duties, etc.
- Route graph: NetworkX `DiGraph`, built in-memory from `stops` +
  `road_segments` via `graph_service.build_graph(engine)`.
- Frontend: plain HTML/CSS/JS (fetch calls), no build step — not started yet.
- Agent: Claude via the Anthropic API, tool-calling against wrapped service
  functions (see Agent & Tool Contracts) — not started yet.

## Folder structure

Current actual state (CRUD API/models/routers from the first Phase 1 pass
were deliberately removed — they were premature; the schema underneath them
changed completely. They get rebuilt against the schema below once the
route/scheduling engines are further along):

```
backend/
  app/
    db.py                    # get_engine() -> SQLAlchemy engine, reads DATABASE_URL
    data/sql/
      01_schema.sql           # DDL for all 12 tables
      02_seed.sql              # synthetic Coimbatore seed data
      cityops_coimbatore.sql   # 01 + 02 combined, same content
    services/
      graph_service.py        # build_graph(engine) -> networkx.DiGraph
      route_service.py        # get_existing_route_edges(), generate_candidates()
      (validation_service.py, scheduling_service.py — not built yet)
    (routers/, agents/, main.py, models.py, schemas.py — not built yet,
     will be added back once the API layer is rebuilt against this schema)
  test_graph.py               # verification script for graph_service
  test_routes.py              # verification script for route_service
  requirements.txt
frontend/                     # not started
CLAUDE.md
KICKOFF_PROMPT.md
```

## Data model

Full 12-table PostgreSQL schema, defined in `backend/app/data/sql/01_schema.sql`
(seed in `02_seed.sql`, combined in `cityops_coimbatore.sql`). Synthetic
Coimbatore transit network — 38 stops, 160 road-segment rows, 10 routes.

- **stops** — id, name, lat, lon, is_major_hub, is_relief_point
- **road_segments** — directed edge between two stops: from_stop_id,
  to_stop_id, distance_km, travel_time_min. 80 undirected corridors stored
  as 160 directed rows (both directions inserted separately).
- **routes** — id, code (e.g. `CBE01`), origin/destination stop, distance,
  travel time, operating window, frequency, status (`ACTIVE` | `PROPOSED` |
  `SUSPENDED` | `RETIRED`)
- **route_points** — ordered stop sequence per route (route_id, stop_id, sequence_order)
- **route_overlap_scores** — precomputed pairwise route overlap (this table
  holds cached/demo values; the real computation still has to be
  deterministic Python per the core principle — see Deterministic rules)
- **scenarios** / **route_candidates** — "what if we added a route between
  X and Y" exploration: a scenario has several ranked candidate paths with
  overlap %, coverage gain, and a score. `route_candidates.stop_ids` is a
  Postgres `INTEGER[]` (ordered path) — deliberately not normalized into a
  join table, since it only needs to be read back to draw on a map.
- **buses** — id, registration_no, bus_type, capacity, status, availability window
- **crew** — id, name, role (`DRIVER` | `CONDUCTOR`), status,
  availability window, qualified_routes (comma-separated route codes —
  deliberately denormalized, hackathon shortcut, not a join table),
  max_duty_duration_min, max_continuous_driving_min, required_rest_min,
  required_break_min
- **duties** — the unit of scheduling: crew_id, bus_id, route_id, trip_id
  (a **logical** id only — there is no `trips` table, so it carries no FK),
  start_time, end_time, assignment_type (`NORMAL` | `RELIEF` | `STANDBY`),
  start/end/relief stop, break_duration_min, status. This is what earlier
  drafts of this doc called a "Trip" — renamed and enriched.
- **assignments** — an attempt to fill a duty with a specific crew/bus,
  with outcome (`ACCEPTED` | `REJECTED` | `PENDING`) and rejection_reason —
  an audit trail of assignment attempts, not just the final state.
- **conflicts** — type (`REST_VIOLATION` | `DUTY_OVERLAP` |
  `QUALIFICATION_FAILURE` | `BUS_DOUBLE_BOOKING` | `UNASSIGNED_DUTY` |
  `ROUTE_OVERLAP`), severity, status (`OPEN` | `RESOLVED`). Seed data
  includes a few pre-canned conflicts for demo purposes; once
  `validation_service` exists, it must be able to derive the same
  conflicts from `duties` directly — the table is a record/cache, not the
  source of truth.

## Graph model

Nodes = `stops` (id, name, lat, lon, is_major_hub as attributes). Edges =
`road_segments`, directed, weighted by `distance_km` and `travel_time_min`.
Built in-memory as a `networkx.DiGraph` by
`graph_service.build_graph(engine)` — queries `stops` and `road_segments`
directly, no caching (small dataset, cheap to rebuild).

**Known data quirk:** the seed data duplicates one corridor — stop 15
("Peelamedu") ↔ stop 20 ("Singanallur") appears twice in each direction in
`road_segments` (rows 51/91 and 52/92, identical weights). The SQL table
correctly has 160 rows, but a `DiGraph` can't hold parallel edges, so
`build_graph` collapses those duplicates and reports **158** edges. This is
expected — not a bug in `graph_service` — verified in `test_graph.py`.

Used for:
- **Shortest path** between two stops (`nx.shortest_path`, weighted by
  `travel_time_min`) — exercised in `test_graph.py`.
- **Candidate route generation** for a new corridor between two stops —
  `route_service.generate_candidates(G, engine, origin, destination, k)`
  (see Deterministic rules). Supersedes the originally-planned standalone
  `graph_service.route_overlap()`/`shortest_path()` functions — overlap
  and path-finding are combined into candidate generation since that's the
  actual product need (scenario exploration, not a bare overlap number).

## Deterministic rules (services/)

**Status: not yet implemented against the new schema** — the function
signatures below are the target design (updated to `crew`/`duty`
terminology to match the current schema) but only `graph_service.build_graph`
actually exists right now. Build these in the Scheduling engine phase.

- `validation_service.check_rest(crew_id, candidate_duty) -> RestCheckResult`
  Minimum rest = `crew.required_rest_min` between the end of a crew
  member's latest duty and the start of the candidate duty (and vice versa
  for a duty inserted earlier). Returns
  `{ok: bool, rest_minutes: float, conflicting_duty_id: int | None}`.
- `validation_service.check_conflict(candidate_duty) -> ConflictCheckResult`
  A bus or crew member cannot be on two duties with overlapping
  `[start_time, end_time]` windows. Returns
  `{ok: bool, conflicts: [{type: "bus"|"crew", duty_id: int}]}`.
- `validation_service.validate_duty(candidate_duty) -> ValidationResult`
  Runs both checks above; this is the single gate every write must pass
  through, whether the caller is a human via CRUD, the fallback scheduler,
  or the agent.
- `graph_service.build_graph(engine) -> networkx.DiGraph` — **implemented**,
  see Graph model.
- `route_service.get_existing_route_edges(engine) -> dict[route_id, set[(from_stop, to_stop)]]` —
  **implemented**. Directed consecutive-stop-pairs per ACTIVE route, from `route_points`.
- `route_service.generate_candidates(G, engine, origin_stop_id, destination_stop_id, k=3) -> list[dict]` —
  **implemented**. Uses `nx.shortest_simple_paths` (k-shortest by
  `travel_time_min`) to propose up to `k` candidate paths for a new
  corridor. Per candidate: `distance_km`/`travel_time_min` (summed edge
  weights), `overlap_pct` (% of the candidate's edges that already exist
  in some ACTIVE route's edge set), `coverage_gain_pct` (% of the
  candidate's stops not already served by any ACTIVE route),
  `overlap_severity` (bucketed from `overlap_pct`: ≤10 MINIMAL, ≤30 LOW,
  ≤60 MODERATE, ≤85 HIGH, >85 CRITICAL), and
  `route_score = 100 - (0.4*overlap_pct + 0.3*(travel_time_min/60*10)) + 0.3*coverage_gain_pct`
  (simple weighted formula, flagged for tuning later). Candidates are
  ranked by `route_score` descending; rank 1 gets `is_recommended=true`.
  Verified in `test_routes.py` against scenarios 1 and 2 from the seed
  data — computed candidates land in the same ballpark as the hand-seeded
  `route_candidates` rows (best candidate picks the lowest-overlap,
  best-coverage path in both cases) but aren't expected to match exactly,
  since the seed rows are hand-authored demo data, not generated by this
  algorithm.
- `scheduling_service.generate_schedule(demand) -> {duties: [...], unassigned: [...]}`
  Greedy deterministic fallback: for each requested (route, time window),
  pick the first available bus and crew member that pass `validate_duty`;
  if none available, add to `unassigned`. Always produces a result, even
  if incomplete — this is the safety net if the agent path fails or times out.

## API map (FastAPI)

**Status: not built yet** — removed along with the rest of the Phase-1
CRUD scaffold when the schema changed; rebuild against the tables above
once the API layer resumes. Target shape (`trip` renamed to `duty`
throughout to match the schema):

CRUD (GET/POST minimum, PUT for status updates):
- `/stops`, `/routes`, `/buses`, `/crew`, `/duties`

Engine (read-only, deterministic):
- `GET /engine/route-overlap?route_a=&route_b=`
- `GET /engine/shortest-path?from_stop=&to_stop=`
- `GET /engine/conflicts` — list all current rest/overlap violations in the DB
- `POST /engine/validate-duty` — body is a candidate duty, returns ValidationResult (no write)

Scheduling:
- `POST /schedule/generate` — body is demand (list of route+time windows),
  runs the deterministic fallback scheduler, returns proposed duties
  (not yet committed) plus unassigned demand.
- `POST /schedule/commit` — body is a list of duties (from either the
  fallback scheduler or the agent), validates each via
  `validation_service.validate_duty`, commits the ones that pass, returns
  `{committed: [...], rejected: [{duty, reason}]}`.

Agent:
- `POST /agent/schedule` — body is demand, same shape as `/schedule/generate`.
  Runs the Claude tool-calling loop (agent proposes duties by calling
  `check_rest`/`check_conflict`/`route_overlap` as tools), then pipes the
  result through the *same* `/schedule/commit` validation path before
  returning. The agent never writes to the DB itself.

## Agent & tool contracts

**Status: not built yet.** Tools exposed to the agent (thin wrappers in
`agents/tools.py` around the service functions, JSON in/out, no side
effects except the ones explicitly listed):
- `get_available_buses(start_time, end_time) -> [bus]`
- `get_available_crew(start_time, end_time) -> [crew]`
- `check_rest(crew_id, start_time, end_time) -> RestCheckResult`
- `check_conflict(bus_id, crew_id, start_time, end_time) -> ConflictCheckResult`
- `route_overlap(route_a_id, route_b_id) -> float`
- `propose_duty(route_id, bus_id, crew_id, start_time, end_time)` — this
  is the ONLY tool that looks like a write, and it does not touch the DB:
  it appends to an in-memory proposal list returned to the caller at the
  end of the agent run. Actual commit only happens via
  `/schedule/commit` → `validation_service.validate_duty`.

If the agent proposes something invalid, `/schedule/commit` rejects it and
reports why — the agent does not get to override validation by asserting a
number is fine.

## Seed data (for demo)

Synthetic Coimbatore transit network in `backend/app/data/sql/02_seed.sql`:
38 stops, 160 road-segment rows (158 unique directed edges — see Graph
model quirk note), 10 routes, 6 route overlap scores, 2 scenarios with 6
route candidates, 16 buses, 26 crew, 10 duties, 5 assignments, and 7
pre-seeded conflict rows (including a `REST_VIOLATION` and a
`BUS_DOUBLE_BOOKING`) for demo purposes — once `validation_service` exists
it should be able to re-derive these same conflicts from `duties` directly.

## Phase plan

1. **Foundation** — ~~backend skeleton, DB schema, seed data, basic CRUD
   API~~ — **redone**: schema migrated from the original flat
   SQLite/Trip design to the 12-table PostgreSQL schema above; CRUD API
   removed until it can be rebuilt against the new schema. DB connection
   (`app/db.py`) and seed data (raw SQL, not a Python seeder) are done.
2. **Route engine** — `graph_service.build_graph` **done** (verified via
   `test_graph.py`: 38 nodes, 158 edges, strongly connected, shortest-path
   works). `route_service.generate_candidates` **done** (verified via
   `test_routes.py` against scenarios 1 & 2 from the seed data).
3. **Scheduling engine** — `scheduling_service` + `validation_service`
   (rest check, conflict check), `/schedule/generate`, `/schedule/commit`.
4. **Fallback** — hardening the deterministic scheduler so it always
   returns a usable result (edge cases: no available bus, no available
   crew, all conflicts).
5. **Agents** — `agents/tools.py`, `agents/scheduler_agent.py`, `/agent/schedule`.
6. **Frontend** — plain HTML/JS views for routes/stops map (list, not
   literal map, unless time allows), duty table, conflict list, "generate
   schedule" trigger.
7. **Integration** — wire frontend to all endpoints, end-to-end demo path.
8. **Demo polish** — seed data tuning, error states, README run instructions.

Work strictly in this order. Do not start agents or frontend before the
deterministic backend (route overlap, rest validation, conflict detection)
is built and tested.

## Run instructions

Postgres (Docker container `cityops-db`, already created — host port
**5433**, not 5432, because a native Windows PostgreSQL service on this
machine already owns 5432):

```
docker start cityops-db          # if not already running
docker exec -i cityops-db psql -U postgres -d cityops < backend/app/data/sql/01_schema.sql
docker exec -i cityops-db psql -U postgres -d cityops < backend/app/data/sql/02_seed.sql
```

(Data lives in a Docker named volume, so it survives container
restarts/recreation as long as the volume isn't removed.)

Backend (from repo root):

```
cd backend
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt   # Windows; use .venv/bin/pip on macOS/Linux
./.venv/Scripts/python test_graph.py
```

Expected `test_graph.py` output:

```
Nodes: 38 (expect 38)
Edges: 158 (expect 160)   <- 158 is correct, see Graph model quirk note
Strongly connected: True (expect True)
Shortest path 1 -> 22 (by travel time): Gandhipuram -> Coimbatore Junction -> Ramanathapuram -> Ondipudur -> Neelambur
```

`DATABASE_URL` env var overrides the default connection string
(`postgresql://postgres:cityops123@localhost:5433/cityops`) if needed.
`backend/.venv/` is gitignored — each teammate creates their own.
