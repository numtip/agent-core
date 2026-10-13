#!/usr/bin/env node
const [command, ...args] = process.argv.slice(2);
const baseUrl = process.env.AGENT_PLATFORM_URL ?? "http://127.0.0.1:8787";
const project = process.env.AGENT_PROJECT ?? "";
const token = process.env.AGENT_PROJECT_TOKEN ?? "";

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (project) headers.set("x-agent-project", project);
  if (token) headers.set("x-agent-project-token", token);
  const response = await fetch(baseUrl + path, { ...init, headers });
  const body = await response.text();
  if (!response.ok) throw new Error("HTTP " + response.status + ": " + body);
  return body ? JSON.parse(body) : null;
}

async function main() {
  if (command === "health") { console.log(JSON.stringify(await request("/v1/health"),null,2)); return; }
  if (command === "doctor") {
    const health = await request("/v1/health");
    console.log(JSON.stringify({ endpoint:baseUrl, project:project||null, token_configured:Boolean(token), health },null,2));
    return;
  }
  if (["decision","route","qa"].includes(command ?? "")) {
    const raw = args.join(" ");
    if (!raw) throw new Error("Provide a JSON request body.");
    console.log(JSON.stringify(await request("/v1/" + command,{method:"POST",body:raw}),null,2));
    return;
  }
  const v2Post: Record<string, string> = {
    "cap-search": "/v2/capabilities/search",
    "v2-route": "/v2/route",
    "v2-execute": "/v2/execute",
    "knowledge-query": "/v2/knowledge/query",
    "context-govern": "/v2/context/govern",
  };
  if (command && command in v2Post) {
    const raw = args.join(" ");
    if (!raw) throw new Error("Provide a JSON request body.");
    console.log(JSON.stringify(await request(v2Post[command], { method: "POST", body: raw }), null, 2));
    return;
  }
  if (command === "capabilities") {
    console.log(JSON.stringify(await request("/v2/capabilities"), null, 2));
    return;
  }
  console.error("Usage: agent <health|doctor|capabilities|decision|route|qa|cap-search|v2-route|v2-execute|knowledge-query|context-govern> [JSON]");
  process.exitCode = 2;
}
main().catch((error)=>{ console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; });