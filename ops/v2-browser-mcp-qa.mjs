// Agent Core v2 - Playwright MCP live transport proof (Phase P of V2-8).
//
// Speaks the MCP stdio transport to the installed @playwright/mcp server:
//   initialize -> tools/list -> browser_navigate (public) -> browser_evaluate (title)
//   -> browser_navigate (loopback, must be refused by the transport blocklist)
// Results are appended as JSONL so the V2-8 report can cite raw evidence.
//
// Usage: node ops/v2-browser-mcp-qa.mjs [--out /path/results.jsonl] [--headless]
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = outIndex > -1 ? args[outIndex + 1] : resolve(process.env.HOME, "agent-core/logs/v2-browser-mcp.jsonl");
const serverPath = resolve(process.env.HOME, "agent-core/mcp-playwright/node_modules/@playwright/mcp/cli.js");

const results = [];
function record(caseName, expected, observed, status, evidence = {}) {
  const entry = { case: caseName, phase: "P", timestamp: new Date().toISOString(), expected, observed, status, evidence };
  results.push(entry);
  console.log(`[${status}] ${caseName.padEnd(34)} ${observed}`);
}

const server = spawn("node", [
  serverPath,
  "--headless",
  "--isolated",
  "--no-sandbox",
  "--browser", "chromium",
  "--blocked-origins", "http://127.0.0.1:*;http://localhost:*;http://[::1]:*;http://169.254.169.254:*",
  "--timeout-navigation", "30000",
], { stdio: ["pipe", "pipe", "pipe"] });

let stderr = "";
server.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

let nextId = 1;
const pending = new Map();
let buffer = "";

server.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve: resolvePromise } = pending.get(message.id);
      pending.delete(message.id);
      resolvePromise(message);
    }
  }
});

function rpc(method, params, timeoutMs = 60000) {
  const id = nextId++;
  return new Promise((resolvePromise, rejectPromise) => {
    pending.set(id, { resolve: resolvePromise });
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); rejectPromise(new Error(`timeout waiting for ${method}`)); }
    }, timeoutMs).unref();
  });
}
function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function toolText(response) {
  const content = response?.result?.content ?? [];
  return content.map((part) => part.text ?? `[${part.type}]`).join("\n").slice(0, 600);
}
function toolFailed(response) {
  return Boolean(response?.error) || response?.result?.isError === true;
}

try {
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "agent-core-v2-qa", version: "0.6.0" },
  });
  record("P1-mcp-initialize", "initialize handshake",
    `server=${init?.result?.serverInfo?.name} v${init?.result?.serverInfo?.version}`,
    init?.result?.serverInfo ? "PASS" : "FAIL",
    { serverInfo: init?.result?.serverInfo, protocolVersion: init?.result?.protocolVersion });
  notify("notifications/initialized", {});

  const tools = await rpc("tools/list", {});
  const names = (tools?.result?.tools ?? []).map((tool) => tool.name);
  record("P2-tools-list", "browser tool surface exposed",
    `${names.length} tools: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""}`,
    names.includes("browser_navigate") ? "PASS" : "FAIL", { tool_count: names.length, tools: names.slice(0, 30) });

  const nav = await rpc("tools/call", { name: "browser_navigate", arguments: { url: "https://example.com/" } }, 90000);
  const navText = toolText(nav);
  record("P3-browser-navigate-public", "real browser navigates a public page",
    toolFailed(nav) ? `tool error: ${navText.slice(0, 120)}` : `ok: ${navText.slice(0, 90).replace(/\s+/g, " ")}`,
    !toolFailed(nav) ? "PASS" : "FAIL", { response_excerpt: navText.slice(0, 400) });

  const title = await rpc("tools/call", { name: "browser_evaluate", arguments: { function: "() => document.title" } }, 60000);
  const titleText = toolText(title);
  record("P4-browser-evaluate-title", "DOM evaluated in the live page (Example Domain)",
    toolFailed(title) ? `tool error: ${titleText.slice(0, 120)}` : titleText.slice(0, 120).replace(/\s+/g, " "),
    /Example Domain/i.test(titleText) ? "PASS" : "FAIL", { response_excerpt: titleText.slice(0, 300) });

  const loopback = await rpc("tools/call", { name: "browser_navigate", arguments: { url: "http://127.0.0.1:8097/" } }, 60000);
  const loopbackText = toolText(loopback);
  const blocked = toolFailed(loopback) || /block|denied|ERR_|not allowed/i.test(loopbackText);
  record("P5-loopback-blocked-by-transport", "loopback target refused by the browser runtime",
    blocked ? `refused: ${loopbackText.slice(0, 140).replace(/\s+/g, " ")}` : `UNEXPECTEDLY ALLOWED: ${loopbackText.slice(0, 120)}`,
    blocked ? "PASS" : "FAIL", { response_excerpt: loopbackText.slice(0, 400) });

  const metadata = await rpc("tools/call", { name: "browser_navigate", arguments: { url: "http://169.254.169.254/latest/meta-data/" } }, 60000);
  const metadataText = toolText(metadata);
  const metadataBlocked = toolFailed(metadata) || /block|denied|ERR_|not allowed|refus/i.test(metadataText);
  record("P6-metadata-endpoint-blocked", "cloud metadata endpoint refused by the browser runtime",
    metadataBlocked ? `refused: ${metadataText.slice(0, 140).replace(/\s+/g, " ")}` : `UNEXPECTEDLY ALLOWED: ${metadataText.slice(0, 120)}`,
    metadataBlocked ? "PASS" : "FAIL", { response_excerpt: metadataText.slice(0, 400) });

  const bad = await rpc("tools/call", { name: "browser_navigate", arguments: { url: "file:///etc/passwd" } }, 60000);
  const badText = toolText(bad);
  record("P7-file-scheme-blocked", "file:// navigation refused (no unrestricted file access flag)",
    toolFailed(bad) || /block|denied|not allowed|refus/i.test(badText) ? "refused" : "ALLOWED",
    toolFailed(bad) || /block|denied|not allowed|refus/i.test(badText) ? "PASS" : "FAIL",
    { response_excerpt: badText.slice(0, 300) });
} catch (error) {
  record("P0-transport-error", "MCP stdio transport usable", String(error?.message ?? error), "FAIL", { stderr: stderr.slice(-600) });
} finally {
  server.stdin.end();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  server.kill("SIGTERM");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
}

mkdirSync(dirname(outPath), { recursive: true });
for (const entry of results) appendFileSync(outPath, JSON.stringify(entry) + "\n");

const { execSync } = await import("node:child_process");
const orphans = execSync(
  "ps -eo pid,args | grep -E 'headless_shell|chrome-linux64/chrome' | grep -v grep | grep -v 'v2-browser-mcp-qa' || true",
  { encoding: "utf8" }
).trim();
record("P8-no-orphan-browser", "no runaway/orphan browser processes after the session",
  orphans ? `orphans: ${orphans.split("\n").length} process(es)` : "none", orphans ? "FAIL" : "PASS", { orphans: orphans.slice(0, 300) });
appendFileSync(outPath, JSON.stringify(results[results.length - 1]) + "\n");

const failures = results.filter((entry) => entry.status === "FAIL");
console.log(`mcp_cases=${results.length} pass=${results.length - failures.length} fail=${failures.length}`);
console.log(`results_file=${outPath}`);
if (stderr.trim() && failures.length) console.log("server_stderr_tail:", stderr.trim().split("\n").slice(-5).join(" | "));
process.exit(failures.length ? 1 : 0);
