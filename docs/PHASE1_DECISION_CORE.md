# Phase 1 — Jev Decision Core

## Scope

Phase 1 implements the smallest production-shaped decision service:

- Fastify HTTP runtime
- `GET /v1/health`
- `POST /v1/decision`
- `POST /v1/route`
- `POST /v1/qa`
- OpenRouter Jev Decisions adapter
- choice / noul / score question support
- strict request validation with Zod
- confidence policy
- caller-declared safe fallback
- provider timeout handling
- tests with simulated OpenRouter responses
- CI build/test workflow

## Jev transport

The provider uses OpenRouter's alpha Decisions endpoint:

```text
POST https://openrouter.ai/api/alpha/decisions
```

The default model is intentionally fixed in code/config to:

```text
~typesafe/jev-latest
```

There is no `OPENROUTER_MODEL_JEV` environment variable. This keeps project configuration small and lets Agent Core own model-version policy.

## Example request

```json
{
  "project": "52clips",
  "task_id": "GO-15",
  "decision_type": "NEXT_ACTION",
  "state": {
    "visual": "ready",
    "audio": "ready",
    "subtitle": "missing"
  },
  "question": {
    "type": "choice",
    "instructions": "Choose the next safe production action.",
    "criteria": {
      "GENERATE_SUBTITLE": "Required subtitle is missing.",
      "READY_FOR_QA": "All required production assets are present.",
      "HUMAN_REVIEW": "State is ambiguous or requires manual review."
    }
  },
  "fallback_result": "HUMAN_REVIEW"
}
```

Possible response:

```json
{
  "decision_type": "NEXT_ACTION",
  "result": "GENERATE_SUBTITLE",
  "confidence": 0.96,
  "reason_code": null,
  "fallback": false,
  "disposition": "EXECUTE",
  "provider_request_id": "..."
}
```

## Confidence policy

Default:

- `>= 0.85`: `EXECUTE`
- `0.60–0.84`: `REVIEW`
- `< 0.60`: caller-declared `FALLBACK` when provided, otherwise `REVIEW`

Provider failure:

- use `fallback_result` when supplied
- otherwise return HTTP 503 / `DECISION_UNAVAILABLE`

These values are provisional and must be calibrated from pilot telemetry.

## Important safety rule

A decision with `disposition=EXECUTE` is only eligible for the next policy stage. It is **not** authorization to execute a destructive or production action.

Hard policy and human approval gates remain authoritative.

## Local run

```bash
cp .env.example .env
# Set OPENROUTER_API_KEY in the runtime environment.
npm install
npm test
npm run build
npm run dev
```

The service binds to `127.0.0.1:8787` by default.
