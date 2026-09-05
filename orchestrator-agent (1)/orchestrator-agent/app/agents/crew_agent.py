import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from google import genai
from google.genai import types


class AICrewAgent:
    def __init__(self, model_name=None):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable is missing!")
        self.client = genai.Client(api_key=api_key)
        self.model_name = model_name or os.getenv("CREW_MODEL", "gemini-3.6-flash")

    def resolve_conflicts(self, unassigned_conflicts, unutilized_crew, available_buses):
        if not unassigned_conflicts:
            return {"status": "success", "proposed_actions": [], "unresolved_escalations": [], "resolved_conflicts": []}

        prompt = f"""
        You are the CityOps 2.0 AI Crew Agent.
        Your task is to resolve all current scheduling conflicts that the deterministic algorithm could not staff.

        CURRENT CONFLICTS:
        {json.dumps(unassigned_conflicts, indent=2, default=str)}

        AVAILABLE UNUTILIZED CREW:
        {json.dumps(unutilized_crew, indent=2, default=str)}

        AVAILABLE BUSES:
        {json.dumps(available_buses, indent=2, default=str)}

        OPERATIONAL RULES:
        1. You may reassign a CONDUCTOR to drive ONLY IF they possess a 'HEAVY_MOTOR' license.
        2. Every proposed assignment must include a valid crew_id, bus_id, and route_id from the provided lists.
        3. If unutilized_crew or available_buses is empty and a conflict cannot be staffed, do not guess IDs. Move that conflict into unresolved_escalations with type 'RESOURCE_SHORTAGE' and severity 'CRITICAL'.
        4. Use assignment_mode ('LINKED' or 'UNLINKED') and resolution_type ('NORMAL_ASSIGNMENT', 'RESERVE_CREW', 'DUTY_SWAP', 'DELAY_TRIP', 'REDUCE_FREQUENCY').
        5. Set resolution_status to 'PROPOSED'.
        6. In resolved_conflicts, use status 'PROPOSED_RESOLUTION'.

        OUTPUT FORMAT:
        Return a raw JSON object matching this structure:
        {{
          "proposed_actions": [
            {{"route_id": integer, "crew_id": integer, "bus_id": integer, "assignment_mode": string, "resolution_type": string, "resolution_status": string, "attempt_number": integer, "ai_reasoning": string}}
          ],
          "unresolved_escalations": [
            {{"type": string, "severity": string, "related_route_id": integer, "description": string}}
          ],
          "resolved_conflicts": [
            {{"conflict_id": integer, "status": "PROPOSED_RESOLUTION", "resolution_note": string}}
          ]
        }}
        """
        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json")
            )
            result = json.loads(response.text)
            result["status"] = "success"
            return result
        except Exception as e:
            return {
                "status": "error",
                "error": f"Crew allocation generation failed: {str(e)}",
                "proposed_actions": [],
                "unresolved_escalations": [],
                "resolved_conflicts": [],
            }


def fetch_live_data_from_db():
    db_host = os.getenv("DB_HOST", "cityops_postgres")
    db_name = os.getenv("DB_NAME", "cityops")
    db_user = os.getenv("DB_USER", "cityops")
    db_password = os.getenv("DB_PASSWORD", "cityops_password")
    db_port = os.getenv("DB_PORT", "5432")
    try:
        connection = psycopg2.connect(host=db_host, database=db_name, user=db_user, password=db_password, port=db_port, cursor_factory=RealDictCursor)
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM conflicts WHERE status = 'OPEN';")
        conflicts = cursor.fetchall()
        cursor.execute("SELECT * FROM crew WHERE status = 'AVAILABLE';")
        crew = cursor.fetchall()
        cursor.execute("SELECT * FROM buses WHERE status = 'AVAILABLE';")
        buses = cursor.fetchall()
        cursor.close(); connection.close()
        return list(conflicts), list(crew), list(buses)
    except Exception as e:
        print(f"Database connection error: {e}")
        return [], [], []
