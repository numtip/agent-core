#!/usr/bin/env node
// Isolated live QA for the browser hardening (session lifecycle, egress proxy, app pipeline).
// Starts its OWN temporary services on spare ports with SYNTHETIC credentials, never touches
// the production runtime (8787/8791) and tears everything down. Requires `npm run build` first.
//
//   PLAYWRIGHT_MCP_CLI=/path/to/@playwright/mcp/cli.js node ops/v2-browser-hardening-qa.mjs [out.jsonl]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const { PlaywrightMcpClient } = await import(join(ROOT, "dist/src/mcp-playwright.js"));
const { createEgressProxy } = await import(join(ROOT, "dist/src/egress-proxy.js"));
const MCP_CLI = process.env.PLAYWRIGHT_MCP_CLI;
if (!MCP_CLI) throw new Error("set PLAYWRIGHT_MCP_CLI to the @playwright/mcp cli.js path");

const PORTS = { page: 18080, app: 18787, mcpPlain: 18791, proxy: 18792, mcpProxied: 18793 };
const OUT = process.argv[2] ?? null;
const SYNTH_TOKEN = `synthetic-${Math.random().toString(36).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "ac-browser-qa-"));
const children = [];
const results = [];

function record(id, ok, observed, extra = {}) {
  const row = { case: id, status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", observed, ...extra, timestamp: new Date().toISOString() };
  results.push(row);
  console.log(`[${row.status}] ${id} — ${observed}`);
  if (OUT) appendFileSync(OUT, JSON.stringify(row) + "\n");
}

async function waitPort(port, path = "/") {
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(500) }); return; } catch { await sleep(250); }
  }
  throw new Error(`port ${port} did not come up`);
}

function startMcp(port, extra) {
  const args = [MCP_CLI, "--headless", "--isolated", "--no-sandbox", "--browser", "chromium", "--host", "127.0.0.1",
    "--port", String(port), "--allowed-hosts", `127.0.0.1:${port}`, "--output-dir", join(tmp, `out-${port}`), ...extra];
  const child = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "ignore"] });
  children.push(child);
  return child;
}

const formPage = `<!doctype html><title>QA form</title><label>Name <input id="name" aria-label="Name"></label>`;
const pageServer = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(req.url === "/form" ? formPage : "<title>loopback canary</title>LOOPBACK-CANARY");
});

const decisions = [];
const proxy = createEgressProxy({ onDecision: (d) => decisions.push(d) });

try {
  for (const port of Object.values(PORTS)) {
    const busy = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) }).then(() => true, (e) => e?.cause?.code !== "ECONNREFUSED");
    if (busy) throw new Error(`port ${port} already in use — refusing to run against an unknown service`);
  }
  await new Promise((r) => pageServer.listen(PORTS.page, "127.0.0.1", r));
  await new Promise((r) => proxy.listen(PORTS.proxy, "127.0.0.1", r));
  startMcp(PORTS.mcpPlain, []);
  startMcp(PORTS.mcpProxied, ["--proxy-server", `http://127.0.0.1:${PORTS.proxy}`]);
  await waitPort(PORTS.mcpPlain, "/mcp");
  await waitPort(PORTS.mcpProxied, "/mcp");

  // ---- S: session lifecycle against a real Playwright MCP (--isolated) ----
  const plain = new PlaywrightMcpClient({ enabled: true, endpoint: `http://127.0.0.1:${PORTS.mcpPlain}/mcp`, timeoutMs: 30000 });
  const formUrl = `http://127.0.0.1:${PORTS.page}/form`;
  const refOf = (text) => (text.match(/textbox "Name" \[ref=(e\d+)\]/) ?? [])[1] ?? null;

  {
    const s = await plain.openSession();
    await s.call("browser_navigate", { url: formUrl });
    const snap = await s.call("browser_snapshot", {});
    const ref = refOf(snap.text);
    await s.close();
    // Old behaviour: navigate and type in two separate sessions.
    await plain.callTool("browser_navigate", { url: formUrl });
    const typed = await plain.callTool("browser_type", { element: "Name", target: ref ?? "e1", text: "x" });
    record("S1-split-sessions-cannot-type", typed.isError === true,
      `type in a fresh session isError=${typed.isError} (ref from earlier session=${ref})`);
  }
  {
    const s = await plain.openSession();
    await s.call("browser_navigate", { url: formUrl });
    const snap = await s.call("browser_snapshot", {});
    const ref = refOf(snap.text);
    const typed = await s.call("browser_type", { element: "Name", target: ref, text: "hello-qa" });
    const value = await s.call("browser_evaluate", { function: "() => document.getElementById('name').value" });
    const sid = s.id;
    await s.close();
    record("S2-single-session-navigate-type", !typed.isError && value.text.includes("hello-qa"),
      `ref=${ref} typeError=${typed.isError} valueSeen=${value.text.includes("hello-qa")}`);
    const after = await fetch(`http://127.0.0.1:${PORTS.mcpPlain}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": sid },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "browser_snapshot", arguments: {} } }),
    });
    record("S3-closed-session-is-gone", after.status >= 400, `reuse of closed session id -> HTTP ${after.status}`);
  }
  {
    const a = await plain.openSession();
    const b = await plain.openSession();
    await a.call("browser_navigate", { url: formUrl });
    await a.call("browser_evaluate", { function: "() => { localStorage.setItem('k','session-a'); document.cookie='c=session-a'; return 1; }" });
    await b.call("browser_navigate", { url: formUrl });
    const seen = await b.call("browser_evaluate", { function: "() => (localStorage.getItem('k') ?? 'none') + '|' + document.cookie" });
    await a.close(); await b.close();
    record("S4-sessions-isolated", !seen.text.includes("session-a"), `session B sees: ${seen.text.match(/"([^"]*)"/)?.[1] ?? seen.text.slice(0, 40)}`);
  }

  // ---- E: egress proxy in front of a real browser ----
  const proxied = new PlaywrightMcpClient({ enabled: true, endpoint: `http://127.0.0.1:${PORTS.mcpProxied}/mcp`, timeoutMs: 30000 });
  const nav = async (url) => {
    const s = await proxied.openSession();
    try { return await s.call("browser_navigate", { url }); } finally { await s.close(); }
  };
  const denied = (host) => decisions.some((d) => d.host === host && !d.allowed);

  const pub = await nav("https://example.com/");
  record("E1-public-via-proxy", !pub.isError && /Page URL: https:\/\/example\.com/.test(pub.text),
    `isError=${pub.isError} ${pub.text.match(/Page URL: \S+/)?.[0] ?? pub.text.slice(0, 80).replace(/\n/g, " ")}`);
  for (const [id, url, host] of [
    ["E2-private-http", "http://10.255.255.1/", "10.255.255.1"],
    ["E3-metadata-https", "https://169.254.169.254/", "169.254.169.254"],
    ["E4-loopback-not-bypassed", `http://127.0.0.1:${PORTS.page}/canary`, "127.0.0.1"],
  ]) {
    const r = await nav(url);
    record(id, denied(host) && !r.text.includes("LOOPBACK-CANARY"), `proxyDenied=${denied(host)} isError=${r.isError}`);
  }
  {
    const s = await proxied.openSession();
    await s.call("browser_navigate", { url: "https://example.com/" });
    const r = await s.call("browser_evaluate", { function: "() => fetch('https://10.255.255.2/', {mode:'no-cors'}).then(() => 'reached', () => 'blocked')" });
    await s.close();
    record("E5-subresource-fetch-blocked", r.text.includes("blocked") && denied("10.255.255.2"), `page script fetch -> ${r.text.match(/"(\w+)"/)?.[1]} proxyDenied=${denied("10.255.255.2")}`);
  }

  // ---- A: full app pipeline (synthetic config) -> proxied MCP ----
  const env = {
    PATH: process.env.PATH, HOME: tmp, AGENT_CORE_ENV: "production", AGENT_CORE_HOST: "127.0.0.1", AGENT_CORE_PORT: String(PORTS.app),
    AGENT_CORE_AUTH_REQUIRED: "true", AGENT_CORE_AUDIT_LOG: join(tmp, "audit.jsonl"),
    AGENT_CORE_PROJECT_KEYS: JSON.stringify({ handbook: SYNTH_TOKEN, "52clips": `${SYNTH_TOKEN}-m` }),
    AGENT_CORE_PROJECT_SCOPES: JSON.stringify({ handbook: ["browser"], "52clips": ["metrics"] }),
    PLAYWRIGHT_MCP_EXECUTION_ENABLED: "true", PLAYWRIGHT_MCP_ENDPOINT: `http://127.0.0.1:${PORTS.mcpProxied}/mcp`,
  };
  let appLog = "";
  const app = spawn(process.execPath, [join(ROOT, "dist/src/server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(app);
  app.stdout.on("data", (d) => { appLog += d; });
  app.stderr.on("data", (d) => { appLog += d; });
  await waitPort(PORTS.app, "/v1/health");
  const exec = async (body, headers = { "x-agent-project": "handbook", "x-agent-project-token": SYNTH_TOKEN }) => {
    const r = await fetch(`http://127.0.0.1:${PORTS.app}/v2/browser/execute`, { method: "POST", headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ project: "handbook", task_id: "QA", action: "BROWSER_READ", ...body }) });
    return { status: r.status, body: await r.json() };
  };
  const a1 = await exec({ url: "https://example.com/" });
  record("A1-app-read-public", a1.body.disposition === "EXECUTED", `HTTP ${a1.status} ${a1.body.disposition}`);
  const a2 = await exec({ url: "http://10.1.254.237/" });
  record("A2-app-private-literal", a2.body.disposition === "DENY", `HTTP ${a2.status} ${a2.body.disposition} ${a2.body.reason}`);
  const a3 = await exec({ url: "https://httpbin.org/redirect-to?url=http%3A%2F%2F169.254.169.254%2Flatest%2F" });
  const reachable = a3.body.disposition !== "DENY" || a3.body.reason !== "DNS_RESOLUTION_FAILED";
  // Either the proxy kills the redirected request (navigation error) or the post-navigation
  // check denies it; both are fail-closed as long as nothing executed and nothing leaked.
  record("A3-app-redirect-to-metadata",
    reachable ? a3.body.executed === false && denied("169.254.169.254") && !JSON.stringify(a3.body).includes("ami-id") : null,
    `HTTP ${a3.status} ${a3.body.disposition} ${a3.body.reason ?? ""} executed=${a3.body.executed} proxyDenied=${denied("169.254.169.254")}`);

  // End-to-end INPUT on a public page: READ to learn the ref, then INPUT (no submit) in a new request.
  const wiki = await exec({ url: "https://httpbin.org/forms/post" });
  const snap = wiki.body.result?.text ?? "";
  const ref = (snap.match(/searchbox(?: "[^"]*")? \[ref=(e\d+)\]/) ?? snap.match(/textbox(?: "[^"]*")? \[ref=(e\d+)\]/))?.[1] ?? null;
  if (wiki.body.disposition !== "EXECUTED" || !ref) {
    record("A6-app-input-public", null, `public test page unavailable or no textbox (disposition=${wiki.body.disposition})`);
  } else {
    const typed = await exec({ url: "https://httpbin.org/forms/post", action: "BROWSER_INPUT", element_ref: ref, input_text: "agent core qa" });
    record("A6-app-input-public", typed.body.disposition === "EXECUTED" && typed.body.result?.typed?.input_chars === 13,
      `ref=${ref} ${typed.body.disposition} is_error=${typed.body.result?.is_error}` +
      (typed.body.result?.is_error ? ` error=${String(typed.body.result.text).replace(/\s+/g, " ").slice(0, 200)}` : ""));
    const bad = await exec({ url: "https://httpbin.org/forms/post", action: "BROWSER_INPUT", element_ref: "e9999", input_text: "x" });
    record("A7-app-input-unknown-ref", bad.body.reason === "ELEMENT_REF_NOT_FOUND", `${bad.body.disposition} ${bad.body.reason}`);
  }
  const ctl = await fetch(`http://127.0.0.1:${PORTS.app}/control`);
  const ctlTok = await fetch(`http://127.0.0.1:${PORTS.app}/v1/control-metrics`, { headers: { "x-agent-project": "52clips", "x-agent-project-token": `${SYNTH_TOKEN}-m` } });
  record("A4-control-origin-auth", ctl.status === 503 && ctlTok.status === 200, `/control no creds (no Access config) -> ${ctl.status}; metrics token -> ${ctlTok.status}`);
  await sleep(300);
  record("A5-no-token-in-app-log", appLog.length > 0 && !appLog.includes(SYNTH_TOKEN), `app log bytes=${appLog.length} token_present=${appLog.includes(SYNTH_TOKEN)}`);
} catch (error) {
  record("HARNESS", false, error instanceof Error ? error.message : String(error));
} finally {
  for (const c of children) c.kill("SIGTERM");
  await new Promise((r) => proxy.close(() => r()));
  await new Promise((r) => pageServer.close(() => r()));
  await sleep(500);
  rmSync(tmp, { recursive: true, force: true });
  const fail = results.filter((r) => r.status === "FAIL").length;
  const skip = results.filter((r) => r.status === "SKIP").length;
  console.log(`\nTOTAL ${results.length - fail - skip}/${results.length} PASS, ${skip} SKIP, ${fail} FAIL`);
  if (OUT) writeFileSync(OUT + ".summary.json", JSON.stringify({ pass: results.length - fail - skip, skip, fail, total: results.length }, null, 2));
  process.exit(fail ? 1 : 0);
}
