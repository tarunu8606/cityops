# Kickoff prompt

Original kickoff instructions from the user for the CityOps hackathon build.
Preserved verbatim as a reference for how we agreed to work — see CLAUDE.md
for the actual architecture/schema/plan that was drafted from this.

---

Read CLAUDE.md in this repo fully before doing anything else — it has the
full architecture, schema, API map, agent/tool contracts, graph model,
rules, and phase plan for this hackathon project (CityOps: Smart Scheduling
& Route Management for City Bus Networks). Treat it as the source of truth
instead of asking me to re-explain the spec.

CONTEXT: This is a 15-hour hackathon build. I'm new to agent-based systems,
FastAPI, graph algorithms, and frontend/backend integration at this scale —
teach me briefly as we go, but don't lecture; a couple of sentences of "why"
per step is enough. I've already got Claude Code + GitHub authorized in
this VS Code window.

HOW WE WORK — read this carefully, it's not optional:

1. Work in the phase order from CLAUDE.md: foundation -> route engine ->
   scheduling engine -> fallback -> agents -> frontend -> integration ->
   demo polish. Do not jump ahead to agents or frontend before the
   deterministic backend (route overlap, rest validation, conflict
   detection) actually works and is tested.
2. One phase at a time. At the end of each phase: tell me exactly what you
   built, how to run it, how to test it, and what output to expect. Then
   STOP and wait for me to say "done" or give feedback before starting the
   next phase. Do not silently continue into the next phase.
3. Never let an agent/LLM call be the source of truth for a calculation
   (rest hours, overlap %, availability, conflicts, scores). Those live in
   plain Python in services/. Agents only call those functions as tools and
   reason over the structured result. This is non-negotiable — flag it if
   you ever find yourself tempted to have the LLM "just compute" a number.
4. Agents propose, validators decide. No agent or tool should write
   directly to the database — every proposed assignment goes through
   validation_service before a commit. If you build a tool that writes to
   the DB without going through the validator, stop and fix it before
   moving on.
5. Init git now if it isn't already, commit after every working phase with
   a short message, and push to GitHub after phases that leave the app in a
   demoable state. Don't wait until the end to start committing.
6. Keep CLAUDE.md up to date: if you deviate from the schema, API shapes,
   or agent tool contracts documented there because something in practice
   needed to change, edit CLAUDE.md immediately so it reflects reality —
   don't let it drift out of sync with the code.
7. Bias toward the simplest version that demonstrably works over the
   "more correct" architecture. If a shortcut breaks the demo pipeline,
   don't take it; if it just makes the code less elegant, take it.

TOKEN / CONTEXT EFFICIENCY — please follow these so we don't burn the
context window or the session budget:

- Don't re-paste file contents back to me in chat "to confirm" — I can
  read the files in the editor. Just tell me the file path and a one-line
  summary of what changed.
- Don't re-read files you just wrote in the same turn to "verify" them —
  trust the write/edit result.
- When a phase is done and committed, suggest whether we should keep going
  in this same session or whether I should run /compact or start a fresh
  Claude Code session for the next phase (long sessions dilute your
  attention on the original spec — better to reset between major phases
  once things are committed to git and CLAUDE.md is current).
- Prefer small, scoped diffs per request over regenerating whole files.
- If you need to explore the existing code, use targeted searches, not
  a full repo dump.
- Summarize test/run output for me instead of pasting raw logs unless
  something failed and the detail matters.

Note: CLAUDE.md did not already exist when this prompt was given — it was
drafted from this prompt's description of the project rather than read
pre-written, per the user's explicit choice when asked.
