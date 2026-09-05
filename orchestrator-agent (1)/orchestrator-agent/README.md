# CityOps 2.0 - Operations Orchestrator Agent

Standalone backend folder for the third component of CityOps: the Operations Orchestrator.

## Responsibility

Frontend -> Orchestrator -> Route Agent + Crew Agent -> validation -> unified JSON -> frontend.

The orchestrator follows the project rule:

**Algorithms calculate. Agents reason. Validators enforce.**

It does not perform final operational writes. Agent proposals remain `PROPOSED_ONLY` until a separate approval/write flow is implemented.

## Included

- FastAPI entry point
- Orchestrator workflow
- Route Agent adapter based on the current Route Agent implementation
- Crew Agent copied from the current implementation
- NetworkX graph service
- Deterministic route candidate service
- Stop/scenario validation
- Unified response combiner
- Environment template

## Start

1. Create and activate a virtual environment.
2. Install dependencies:

```cmd
pip install -r requirements.txt
```

3. Copy `.env.example` to `.env` and set your PostgreSQL/AI values.
4. Make sure the existing CityOps PostgreSQL database is running.
5. Start:

```cmd
uvicorn app.main:app --reload --port 8000
```

## Request

`POST /agents/orchestrate`

```json
{
  "origin": "Gandhipuram",
  "destination": "Neelambur",
  "start_time": "14:00",
  "end_time": "18:00",
  "scenario_id": null
}
```

## Important integration note

The current Crew Agent is not scenario-aware. It reads all OPEN conflicts, AVAILABLE crew and AVAILABLE buses from PostgreSQL. This project intentionally calls that implementation as-is rather than inventing scenario filtering.

The current Route Agent produces candidate codes such as `SC1-R1`. Those codes are not silently mapped to database `route_id` values. The orchestrator therefore does not fabricate a Crew Agent assignment using a route candidate code.

## Database

The orchestrator expects the existing CityOps 12-table schema, including `stops`, `road_segments`, `routes`, `route_points`, `buses`, `crew`, `duties`, `assignments`, `conflicts`, and `scenarios`.
