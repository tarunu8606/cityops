from typing import Any, Optional
from pydantic import BaseModel, Field


class OrchestrateRequest(BaseModel):
    origin: str
    destination: str
    start_time: str
    end_time: str
    scenario_id: Optional[int] = None


class AgentError(BaseModel):
    agent: str
    error: str


class OrchestrateResponse(BaseModel):
    status: str
    scenario_id: Optional[int] = None
    request: dict[str, Any]
    route_result: Optional[dict[str, Any]] = None
    crew_result: Optional[dict[str, Any]] = None
    validation: dict[str, Any] = Field(default_factory=dict)
    conflicts: list[dict[str, Any]] = Field(default_factory=list)
    unresolved_escalations: list[dict[str, Any]] = Field(default_factory=list)
    fallback_options: list[dict[str, Any]] = Field(default_factory=list)
    final_combined_recommendation: Optional[dict[str, Any]] = None
    agent_errors: list[AgentError] = Field(default_factory=list)
