import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { buildApp } from "../src/app.js";
import type { RuntimeConfig } from "../src/config.js";
import type { JevProvider } from "../src/providers/jev.js";

const TEAM = "https://synthetic-team.cloudflareaccess.com";
const AUD = "synthetic-aud-tag";
const provider = { decide: async () => ({ result: "x", confidence: 0.9, providerRequestId: "x" }) } as unknown as JevProvider;

const good = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rogue = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...good.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const jwksFetch = (async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })) as unknown as typeof fetch;
const brokenJwks = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;

function jwt(claims: Record<string, unknown>, key: KeyObject = good.privateKey, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${enc(header)}.${enc(claims)}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), key).toString("base64url")}`;
}
const now = () => Math.floor(Date.now() / 1000);
const validClaims = () => ({ iss: TEAM, aud: [AUD], exp: now() + 300, nbf: now() - 10, email: "ops@example.invalid" });

function config(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    env: "test", host: "127.0.0.1", port: 8787, openRouterApiKey: "k", openRouterDecisionsUrl: "https://example.invalid",
    jevModel: "~typesafe/jev-latest", requestTimeoutMs: 1000, confidenceExecute: 0.85, confidenceReview: 0.6,
    authRequired: true, projectKeys: { "52clips": "synthetic-52", dbplant: "synthetic-db" },
    projectScopes: { "52clips": ["metrics"], dbplant: ["decision"] }, rateLimitMax: 1000, rateLimitWindowMs: 60000,
    auditLogPath: null, playwrightMcpExecutionEnabled: false, playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
    playwrightMcpTimeoutMs: 5000, cfAccessTeamDomain: TEAM, cfAccessAudiences: [AUD],
    ...overrides,
  };
}

async function get(url: string, headers: Record<string, string> = {}, cfg = config(), fetchImpl = jwksFetch) {
  const app = buildApp({ config: cfg, provider, jwksFetch: fetchImpl });
  const res = await app.inject({ method: "GET", url, headers });
  await app.close();
  return res;
}

describe("origin auth for /control and /v1/control-metrics", () => {
  for (const url of ["/control", "/v1/control-metrics"]) {
    it(`${url}: valid Access assertion -> 200`, async () => {
      expect((await get(url, { "cf-access-jwt-assertion": jwt(validClaims()) })).statusCode).toBe(200);
    });
    it(`${url}: no credentials -> 401`, async () => {
      expect((await get(url)).statusCode).toBe(401);
    });
  }

  it.each([
    ["wrong signing key", () => jwt(validClaims(), rogue.privateKey), "BAD_SIGNATURE"],
    ["wrong audience", () => jwt({ ...validClaims(), aud: ["other-app"] }), "BAD_AUDIENCE"],
    ["wrong issuer", () => jwt({ ...validClaims(), iss: "https://evil.cloudflareaccess.com" }), "BAD_ISSUER"],
    ["expired", () => jwt({ ...validClaims(), exp: now() - 3600 }), "EXPIRED"],
    ["not yet valid", () => jwt({ ...validClaims(), nbf: now() + 3600 }), "NOT_YET_VALID"],
    ["alg none", () => jwt(validClaims(), good.privateKey, { alg: "none", kid: "k1" }), "UNSUPPORTED_ALG"],
    ["HS256 confusion", () => jwt(validClaims(), good.privateKey, { alg: "HS256", kid: "k1" }), "UNSUPPORTED_ALG"],
    ["unknown kid", () => jwt(validClaims(), good.privateKey, { alg: "RS256", kid: "k9" }), "UNKNOWN_KID"],
    ["garbage", () => "a.b", "MALFORMED"],
  ])("%s -> 401", async (_name, make, reason) => {
    const res = await get("/v1/control-metrics", { "cf-access-jwt-assertion": make() });
    expect(res.statusCode).toBe(401);
    expect(res.json().reason).toBe(reason);
  });

  it("JWKS unreachable -> 401 (fail closed)", async () => {
    const res = await get("/control", { "cf-access-jwt-assertion": jwt(validClaims()) }, config(), brokenJwks);
    expect(res.statusCode).toBe(401);
    expect(res.json().reason).toBe("JWKS_UNAVAILABLE");
  });

  it("cf-access mode without team/aud configured -> 503, never open", async () => {
    const res = await get("/control", {}, config({ cfAccessTeamDomain: undefined, cfAccessAudiences: [] }));
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("CONTROL_AUTH_NOT_CONFIGURED");
  });

  it("'disabled' is ignored while auth is required", async () => {
    expect((await get("/control", {}, config({ controlAuthMode: "disabled" }))).statusCode).toBe(401);
  });

  it("project mode rejects Access assertions and accepts metrics-scoped tokens", async () => {
    const cfg = config({ controlAuthMode: "project" });
    expect((await get("/control", { "cf-access-jwt-assertion": jwt(validClaims()) }, cfg)).statusCode).toBe(401);
    expect((await get("/control", { "x-agent-project": "52clips", "x-agent-project-token": "synthetic-52" }, cfg)).statusCode).toBe(200);
  });

  it("project token: metrics scope 200, other scope 403, bad token 401", async () => {
    expect((await get("/v1/control-metrics", { "x-agent-project": "52clips", "x-agent-project-token": "synthetic-52" })).statusCode).toBe(200);
    expect((await get("/v1/control-metrics", { "x-agent-project": "dbplant", "x-agent-project-token": "synthetic-db" })).statusCode).toBe(403);
    expect((await get("/v1/control-metrics", { "x-agent-project": "52clips", "x-agent-project-token": "wrong" })).statusCode).toBe(401);
  });

  it("a bad project token cannot fall through to a valid Access assertion check", async () => {
    const res = await get("/control", { "x-agent-project": "52clips", "x-agent-project-token": "wrong", "cf-access-jwt-assertion": jwt(validClaims()) });
    expect(res.statusCode).toBe(401);
  });

  it("development (authRequired=false) stays open", async () => {
    expect((await get("/control", {}, config({ authRequired: false }))).statusCode).toBe(200);
  });

  it("health stays public", async () => {
    expect((await get("/v1/health")).statusCode).toBe(200);
  });
});
