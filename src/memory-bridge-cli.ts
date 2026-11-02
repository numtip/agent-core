import { basename, resolve } from "node:path";
import { agentCoreKnowledgeQuery, startMemoryBridge } from "./memory-bridge.js";

/**
 * Starts the read-only MCP bridge.
 *
 * Fail-closed rules:
 *  - the vault path must exist and be readable;
 *  - binding to anything other than loopback requires an inbound bearer token, so this can never become a
 *    new public unauthenticated endpoint by accident;
 *  - the Agent Core project token is read from the environment only, never from argv or a file in git.
 */

const env = process.env;
const vaultPath = env.MEMORY_BRIDGE_VAULT_PATH ?? env.OBSIDIAN_VAULT_PATH ?? "";
const projectId = env.MEMORY_BRIDGE_PROJECT ?? "";
const projectToken = env.MEMORY_BRIDGE_PROJECT_TOKEN ?? "";
const agentCoreUrl = env.AGENT_CORE_URL ?? "http://127.0.0.1:8787";
const host = env.MEMORY_BRIDGE_HOST ?? "127.0.0.1";
const port = Number(env.MEMORY_BRIDGE_PORT ?? "8792");
const bearerToken = env.MEMORY_BRIDGE_BEARER_TOKEN ?? null;
// Citations need a non-empty url (OpenAI creates citation metadata only then). Without a public https base the
// honest user-openable target is the Obsidian deep link for that note — set MEMORY_BRIDGE_CITATION_BASE to
// override it with an https base once the vault is served read-only.
const citationBase =
  env.MEMORY_BRIDGE_CITATION_BASE ??
  `obsidian://open?vault=${encodeURIComponent(basename(resolve(vaultPath || ".")))}&file=`;

function fail(message: string): never {
  console.error(JSON.stringify({ level: "error", component: "memory-bridge", message }));
  process.exit(1);
}

if (!vaultPath) fail("MISSING_VAULT_PATH: set MEMORY_BRIDGE_VAULT_PATH or OBSIDIAN_VAULT_PATH");
if (!projectId || !projectToken) fail("MISSING_PROJECT_IDENTITY: set MEMORY_BRIDGE_PROJECT and MEMORY_BRIDGE_PROJECT_TOKEN");
const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
if (!isLoopback && !bearerToken) fail("PUBLIC_BIND_REQUIRES_BEARER_TOKEN");
if (!Number.isInteger(port) || port < 1 || port > 65535) fail("INVALID_PORT");

const app = await startMemoryBridge({
  vaultPath,
  projectId,
  projectToken,
  knowledgeQuery: agentCoreKnowledgeQuery(agentCoreUrl),
  bearerToken,
  citationBase,
  host,
  port
});

console.log(
  JSON.stringify({
    level: "info",
    component: "memory-bridge",
    message: "LISTENING",
    url: `http://${host}:${port}/mcp`,
    healthz: `http://${host}:${port}/healthz`,
    agent_core: agentCoreUrl,
    project: projectId,
    auth: bearerToken ? "bearer" : "loopback-only",
    read_only: true
  })
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
