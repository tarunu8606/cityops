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

- Backend: FastAPI + SQLAlchemy + SQLite (file DB, zero setup).
- Frontend: plain HTML/CSS/JS (fetch calls), no build step — fastest path
  to a working demo and easiest to debug backend/frontend integration as a
  beginner. Revisit only if the demo needs more UI complexity than this
  can hold.
- Agent: Claude via the Anthropic API, tool-calling against wrapped service
  functions (see Agent & Tool Contracts).

## Folder structure

```
backend/
  app/
    main.py                # FastAPI app, mounts routers
    db.py                  # engine/session setup
    models.py              # SQLAlchemy ORM models
    schemas.py              # Pydantic request/response models
    seed.py                 # seed data script
    routers/
      stops.py routes.py buses.py crew.py trips.py
      engine.py            # route overlap, shortest path, conflicts
      schedule.py           # fallback deterministic scheduler endpoint
      agent.py              # agent-assisted scheduling endpoint
    services/
      graph_service.py       # builds stop graph, shortest path, route overlap %
      validation_service.py  # rest check, conflict check — single source of truth
      scheduling_service.py  # deterministic fallback greedy scheduler
    agents/
      tools.py               # tool schemas wrapping service functions
      scheduler_agent.py     # Claude tool-calling loop, proposes assignments
  tests/
    test_graph_service.py
    test_validation_service.py
    test_scheduling_service.py
  requirements.txt
frontend/
  index.html
  app.js
  style.css
CLAUDE.md
KICKOFF_PROMPT.md
```

## Data model

- **Stop**: id, name, lat, lng
- **Route**: id, name, stop_sequence (ordered list of stop ids, stored as
  JSON or a join table `route_stops(route_id, stop_id, sequence_index)`)
- **Bus**: id, plate_number, capacity, status (`active` | `maintenance`)
- **Crew**: id, name, role (`driver`), phone
- **Trip**: id, route_id, bus_id, driver_id, start_time (datetime),
  end_time (datetime), date

Kept deliberately flat: a Trip is the unit of scheduling — one bus, one
driver, one route, one time window. No separate assignment table; the trip
row *is* the assignment. Simplest thing that can demo conflicts and rest
violations.

## Graph model

Nodes = stops. Edges = consecutive stop pairs within each route's
stop_sequence, weighted by an estimated travel time (minutes) between the
two stops. Built in-memory in `graph_service.py` from the DB on each
request (small dataset — no need to persist or cache for a hackathon demo).

Used for:
- **Shortest path** between two stops (Dijkstra) — for a "reroute if this
  route is disrupted" demo.
- **Route overlap %** between two routes — Jaccard similarity of their stop
  sets (`|shared stops| / |union of stops|`) — flags redundant/competing
  routes.

## Deterministic rules (services/)

- `validation_service.check_rest(driver_id, candidate_trip) -> RestCheckResult`
  Minimum rest = 8 hours between the end of a driver's latest trip and the
  start of the candidate trip (and vice versa for a trip inserted earlier).
  Returns `{ok: bool, rest_hours: float, conflicting_trip_id: int | None}`.
- `validation_service.check_conflict(candidate_trip) -> ConflictCheckResult`
  A bus or driver cannot be on two trips with overlapping
  `[start_time, end_time]` windows. Returns
  `{ok: bool, conflicts: [{type: "bus"|"driver", trip_id: int}]}`.
- `validation_service.validate_trip(candidate_trip) -> ValidationResult`
  Runs both checks above; this is the single gate every write must pass
  through, whether the caller is a human via CRUD, the fallback scheduler,
  or the agent.
- `graph_service.route_overlap(route_a_id, route_b_id) -> float` (0–1)
- `graph_service.shortest_path(from_stop_id, to_stop_id) -> {path: [stop_id], minutes: float}`
- `scheduling_service.generate_schedule(demand) -> {trips: [...], unassigned: [...]}`
  Greedy deterministic fallback: for each requested (route, time window),
  pick the first available bus and driver that pass `validate_trip`; if
  none available, add to `unassigned`. Always produces a result, even if
  incomplete — this is the safety net if the agent path fails or times out.

## API map (FastAPI)

CRUD (GET/POST minimum, PUT for status updates):
- `/stops`, `/routes`, `/buses`, `/crew`, `/trips`

Engine (read-only, deterministic):
- `GET /engine/route-overlap?route_a=&route_b=`
- `GET /engine/shortest-path?from_stop=&to_stop=`
- `GET /engine/conflicts` — list all current rest/overlap violations in the DB
- `POST /engine/validate-trip` — body is a candidate trip, returns ValidationResult (no write)

Scheduling:
- `POST /schedule/generate` — body is demand (list of route+time windows),
  runs the deterministic fallback scheduler, returns proposed trips
  (not yet committed) plus unassigned demand.
- `POST /schedule/commit` — body is a list of trips (from either the
  fallback scheduler or the agent), validates each via
  `validation_service.validate_trip`, commits the ones that pass, returns
  `{committed: [...], rejected: [{trip, reason}]}`.

Agent:
- `POST /agent/schedule` — body is demand, same shape as `/schedule/generate`.
  Runs the Claude tool-calling loop (agent proposes trips by calling
  `check_rest`/`check_conflict`/`route_overlap` as tools), then pipes the
  result through the *same* `/schedule/commit` validation path before
  returning. The agent never writes to the DB itself.

## Agent & tool contracts

Tools exposed to the agent (thin wrappers in `agents/tools.py` around the
service functions, JSON in/out, no side effects except the ones explicitly
listed):
- `get_available_buses(start_time, end_time) -> [bus]`
- `get_available_drivers(start_time, end_time) -> [driver]`
- `check_rest(driver_id, start_time, end_time) -> RestCheckResult`
- `check_conflict(bus_id, driver_id, start_time, end_time) -> ConflictCheckResult`
- `route_overlap(route_a_id, route_b_id) -> float`
- `propose_trip(route_id, bus_id, driver_id, start_time, end_time)` — this
  is the ONLY tool that looks like a write, and it does not touch the DB:
  it appends to an in-memory proposal list returned to the caller at the
  end of the agent run. Actual commit only happens via
  `/schedule/commit` → `validation_service.validate_trip`.

If the agent proposes something invalid, `/schedule/commit` rejects it and
reports why — the agent does not get to override validation by asserting a
number is fine.

## Seed data (for demo)

~6 routes, ~15 stops, ~6 buses, ~8 crew (drivers). One driver is
deliberately double-booked with back-to-back trips ~6 hours apart
(below the 8-hour minimum) so `/engine/conflicts` and the rest-check demo
have something real to show without needing to fabricate data live.

## Phase plan

1. **Foundation** — backend skeleton, DB schema, seed data, basic CRUD API.
2. **Route engine** — `graph_service`: graph build, shortest path, route overlap %.
3. **Scheduling engine** — `scheduling_service` + `validation_service`
   (rest check, conflict check), `/schedule/generate`, `/schedule/commit`.
4. **Fallback** — hardening the deterministic scheduler so it always
   returns a usable result (this is largely done as part of phase 3, but
   gets its own pass to test edge cases: no available bus, no available
   driver, all conflicts).
5. **Agents** — `agents/tools.py`, `agents/scheduler_agent.py`, `/agent/schedule`.
6. **Frontend** — plain HTML/JS views for routes/stops map (list, not
   literal map, unless time allows), trip table, conflict list, "generate
   schedule" trigger.
7. **Integration** — wire frontend to all endpoints, end-to-end demo path.
8. **Demo polish** — seed data tuning, error states, README run instructions.

Work strictly in this order. Do not start agents or frontend before the
deterministic backend (route overlap, rest validation, conflict detection)
is built and tested.

## Run instructions

Backend (from repo root):

```
cd backend
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt   # Windows; use .venv/bin/pip on macOS/Linux
./.venv/Scripts/python -m app.seed                # populates backend/cityops.db, safe to re-run (skips if already seeded)
./.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Then visit `http://127.0.0.1:8000/docs` for interactive API docs, or:

```
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/stops
curl http://127.0.0.1:8000/routes
curl http://127.0.0.1:8000/trips
```

`backend/cityops.db` and `backend/.venv/` are gitignored — each teammate seeds
their own local DB.
