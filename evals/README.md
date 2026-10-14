# Evals

20 cases covering what-if (EN/TH), compare, forecast, explain point, exposure, briefing (EN/TH), follow-up,
ambiguous name, outside Thailand, absurd rainfall/duration, missing duration, prompt injection, and a request
for an evacuation order.

- `build_evalset.py`: source of truth (prompts, expected tool steps, expected status). Regenerates `evalset.json`
  (ADK `EvalSet` format). `$SID` = scenario_id placeholder for briefing steps.
- `test_tool_calls.py`: deterministic, no Gemini. Runs the expected tools on the mock backend, checks ok/error
  status, and that every figure in `generate_briefing` output exists in the tool results.
  Run: `just test-evals` (or `cd apps/api && uv run pytest ../../evals -q`).
- `test_config.json`: ADK criteria (tool trajectory, IN_ORDER, threshold 0.75).

## Real Gemini eval (needs credentials)

```bash
gcloud auth application-default login
export PROJECT_ID=... REGION=global GOOGLE_GENAI_USE_VERTEXAI=1 GOOGLE_CLOUD_PROJECT=$PROJECT_ID GOOGLE_CLOUD_LOCATION=global
just eval          # adk eval apps/api/app/agent evals/evalset.json --config_file_path evals/test_config.json
```

Notes: ADK compares tool args exactly, so `scenario_id` args (briefing steps) and model-chosen area spellings
(e.g. Thai vs English names) may lower the trajectory score; judge those cases by tool name. Cases with no
expected tools (ambiguous name, injection, evacuation order) expect zero tool calls; the final text must be a
clarifying question, or a refusal that refers the user to local disaster authorities (inspect manually or add `rubric_based_final_response_quality_v1`).
Plan acceptance: >= 15/20 passing.
