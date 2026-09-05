from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from .db import get_engine
from .orchestrator.models import OrchestrateRequest, OrchestrateResponse
from .orchestrator.orchestrator import orchestrate

load_dotenv()

app = FastAPI(title="CityOps Operations Orchestrator", version="1.0.0")

# Next.js dev server (both localhost and 127.0.0.1, in case the browser
# resolves it either way).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = get_engine()


@app.get("/health")
def health():
    return {"status": "ok", "service": "orchestrator-agent"}


@app.get("/dashboard/stats")
def dashboard_stats():
    with engine.connect() as conn:
        active_routes = conn.execute(text("SELECT COUNT(*) FROM routes")).scalar_one()
        open_conflicts = conn.execute(
            text("SELECT COUNT(*) FROM conflicts WHERE status = 'OPEN'")
        ).scalar_one()
        buses_in_service = conn.execute(
            text("SELECT COUNT(*) FROM buses WHERE status = 'IN_SERVICE'")
        ).scalar_one()
    return {
        "active_routes": active_routes,
        "open_conflicts": open_conflicts,
        "buses_in_service": buses_in_service,
    }


@app.post("/agents/orchestrate", response_model=OrchestrateResponse)
def orchestrate_endpoint(request: OrchestrateRequest):
    try:
        return orchestrate(request, engine)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Orchestration failed: {exc}") from exc
