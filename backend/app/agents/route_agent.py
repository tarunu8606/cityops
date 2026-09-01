import json
import os

from dotenv import load_dotenv
from openai import OpenAI

from ..services.route_service import generate_candidates

load_dotenv()

SYSTEM_PROMPT = (
    "You are a route planning agent for a bus network. You are given "
    "pre-computed, validated candidate routes with distance, overlap, "
    "coverage, and score already calculated. Do not invent or recalculate "
    "any numbers. Pick the best candidate based on the provided route_score "
    "and is_recommended flag, and write a 1-2 sentence plain-English "
    "justification citing the actual numbers given."
)


def _fallback_reasoning(recommended: dict) -> str:
    return (
        f"Candidate {recommended['candidate_code']} is recommended based on "
        f"its route_score of {recommended['route_score']} "
        f"(overlap {recommended['overlap_pct']}%, "
        f"coverage gain {recommended['coverage_gain_pct']}%)."
    )


def run_route_agent(
    G, engine, scenario_id: int, origin_stop_id: int, destination_stop_id: int
) -> dict:
    # Deterministic tool call — the agent never computes distance, overlap,
    # coverage, or score itself, only reasons over what this returns.
    candidates = generate_candidates(G, engine, origin_stop_id, destination_stop_id)

    for c in candidates:
        c["candidate_code"] = f"SC{scenario_id}-R{c['rank']}"

    recommended = next(c for c in candidates if c["is_recommended"])

    try:
        client = OpenAI(
            api_key=os.environ["GROQ_API_KEY"],
            base_url="https://api.groq.com/openai/v1",
        )
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(candidates)},
            ],
        )
        reasoning_text = response.choices[0].message.content or _fallback_reasoning(
            recommended
        )
    except Exception:
        reasoning_text = _fallback_reasoning(recommended)

    return {
        "status": "success",
        "scenario_id": scenario_id,
        "origin": G.nodes[origin_stop_id]["name"],
        "destination": G.nodes[destination_stop_id]["name"],
        "candidates": candidates,
        "agent_recommendation": {
            "candidate_code": recommended["candidate_code"],
            "reasoning": reasoning_text,
        },
    }
