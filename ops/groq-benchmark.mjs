#!/usr/bin/env node
/**
 * Local Groq inference benchmark (3 tasks) against Agent Core /v2/inference/complete.
 * Usage (never log secrets):
 *   node --env-file=.env ops/groq-benchmark.mjs
 *
 * Requires AGENT_CORE running locally and project token with `inference` scope.
 */

const baseUrl = process.env.AGENT_PLATFORM_URL ?? "http://127.0.0.1:8787";
const project = process.env.AGENT_PROJECT ?? "agent-core";
const token = process.env.AGENT_PROJECT_TOKEN ?? "";

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["x-agent-project"] = project;
    headers["x-agent-project-token"] = token;
  }
  return headers;
}

const tasks = [
  {
    id: "summarize-policy",
    messages: [
      {
        role: "user",
        content:
          "In one sentence, explain why Agent Core keeps Jev on OpenRouter while Groq is optional."
      }
    ],
    max_tokens: 120
  },
  {
    id: "classify-risk",
    messages: [
      {
        role: "user",
        content:
          'Classify this action as LOW, MEDIUM, or HIGH risk and reply JSON only: {"risk":"...","reason":"..."} — Action: read-only Hermes memory search for prior decisions.'
      }
    ],
    max_tokens: 160
  },
  {
    id: "route-hint",
    messages: [
      {
        role: "user",
        content:
          "Reply with one capability id from Agent Core v2 that is READ-only and suitable for Hermes memory handoff."
      }
    ],
    max_tokens: 64
  }
];

async function runTask(task) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/v2/inference/complete`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      project,
      task_id: `groq-bench-${task.id}`,
      messages: task.messages,
      max_tokens: task.max_tokens,
      temperature: 0,
      provider_preference: "auto"
    })
  });

  const latency_ms = Date.now() - started;
  const body = await response.json().catch(() => ({}));

  return {
    task_id: task.id,
    http_status: response.status,
    latency_ms,
    ok: response.ok,
    provider: body.provider ?? null,
    fallback: Boolean(body.fallback),
    model: body.model ?? null,
    estimated_cost_usd: body.estimated_cost_usd ?? null,
    budget_remaining_usd: body.budget?.remaining_usd ?? null,
    content_preview:
      typeof body.content === "string" ? body.content.slice(0, 240) : null,
    error: body.error ?? null
  };
}

async function main() {
  const health = await fetch(`${baseUrl}/v1/health`).then((r) => r.json());
  console.log(
    JSON.stringify(
      {
        phase: "preflight",
        groq_inference_enabled: health.groq_inference_enabled ?? false,
        groq_model: health.groq_model ?? null,
        jev_provider_configured: health.provider_configured ?? false
      },
      null,
      2
    )
  );

  const results = [];
  for (const task of tasks) {
    results.push(await runTask(task));
  }

  const budget = await fetch(`${baseUrl}/v2/inference/budget`, {
    headers: authHeaders()
  }).then((r) => r.json());

  const summary = {
    phase: "benchmark",
    tasks: results.length,
    passed: results.filter((r) => r.ok).length,
    total_estimated_cost_usd: results.reduce(
      (sum, r) => sum + (Number(r.estimated_cost_usd) || 0),
      0
    ),
    budget,
    results
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.passed === summary.tasks ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
