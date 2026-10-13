import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { buildApp } from "../src/app.js";
import type { RuntimeConfig } from "../src/config.js";
import type { JevProvider } from "../src/providers/jev.js";
import { AuditLogger } from "../src/telemetry.js";

// Synthetic values only; the assertions prove none of them is ever echoed.
const PROJECT_TOKEN = "synthetic-project-token-9f1c2e";
const WRONG_TOKEN = "synthetic-wrong-token-77aa31";
const PROVIDER_KEY = "synthetic-provider-key-b04d";
const CF_ASSERTION = "eyJhbGciOiJSUzI1NiJ9.synthetic-assertion.sig";
const CF_SECRET = "synthetic-cf-client-secret-55";

class Capture extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer, _enc: string, cb: () => void) { this.chunks.push(chunk.toString()); cb(); }
  get text() { return this.chunks.join(""); }
}

class MemoryAudit extends AuditLogger {
  lines: string[] = [];
  constructor() { super(null); }
  async write(event: Parameters<AuditLogger["write"]>[0]) { this.lines.push(JSON.stringify(event)); }
}

function config(): RuntimeConfig {
  return {
    env: "test", host: "127.0.0.1", port: 8787, openRouterApiKey: PROVIDER_KEY, openRouterDecisionsUrl: "https://example.invalid",
    jevModel: "~typesafe/jev-latest", requestTimeoutMs: 1000, confidenceExecute: 0.85, confidenceReview: 0.6,
    authRequired: true, projectKeys: { "52clips": PROJECT_TOKEN }, projectScopes: { "52clips": ["decision", "metrics"] },
    rateLimitMax: 1000, rateLimitWindowMs: 60000, auditLogPath: null, playwrightMcpExecutionEnabled: false,
    playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp", playwrightMcpTimeoutMs: 5000,
    cfAccessTeamDomain: "https://synthetic-team.cloudflareaccess.com", cfAccessAudiences: ["aud"],
  };
}

const body = {
  project: "52clips", task_id: "REDACT-1", decision_type: "NEXT_ACTION", state: { a: 1 },
  question: { type: "choice", instructions: "pick", criteria: { A: "a", B: "b" } }, fallback_result: "A",
};

describe("secrets never reach logs, audit or responses", () => {
  it("valid, invalid and provider-failure paths", async () => {
    const log = new Capture();
    const audit = new MemoryAudit();
    const failingProvider = { decide: async () => { throw new Error("provider down"); } } as unknown as JevProvider;
    const app = buildApp({ config: config(), provider: failingProvider, audit, logStream: log,
      jwksFetch: (async () => { throw new Error("no network in test"); }) as unknown as typeof fetch });
    const responses: string[] = [];
    const send = async (headers: Record<string, string>, url = "/v1/decision", method: "GET" | "POST" = "POST") => {
      const res = await app.inject({ method, url, headers: { ...headers, "cf-access-client-secret": CF_SECRET, cookie: `CF_Authorization=${CF_ASSERTION}` }, payload: method === "POST" ? body : undefined });
      responses.push(res.body);
      return res.statusCode;
    };
    expect(await send({ "x-agent-project": "52clips", "x-agent-project-token": PROJECT_TOKEN })).toBe(200);
    expect(await send({ "x-agent-project": "52clips", "x-agent-project-token": WRONG_TOKEN })).toBe(401);
    expect(await send({ "x-agent-project": "52clips", "x-agent-project-token": PROJECT_TOKEN, authorization: `Bearer ${PROVIDER_KEY}` })).toBe(200);
    expect(await send({ "cf-access-jwt-assertion": CF_ASSERTION }, "/v1/control-metrics", "GET")).toBe(401);
    await app.close();

    const everything = [log.text, ...audit.lines, ...responses].join("\n");
    expect(log.text.length).toBeGreaterThan(0);
    for (const secret of [PROJECT_TOKEN, WRONG_TOKEN, PROVIDER_KEY, CF_ASSERTION, CF_SECRET]) {
      expect(everything).not.toContain(secret);
    }
  });
});
