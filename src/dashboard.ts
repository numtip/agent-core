export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Core v2 Control Center</title>
<style>
body{font-family:system-ui,sans-serif;margin:40px;max-width:1200px;background:#111;color:#eee}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.card{border:1px solid #333;border-radius:12px;padding:18px;background:#181818}code{color:#9fd}small{color:#aaa}.ok{color:#9f9}.gate{color:#fd9}pre{white-space:pre-wrap;overflow-wrap:anywhere}
</style>
</head><body>
<h1>Agent Core v2 Control Center</h1>
<p>Private operational surface. Production access must remain behind Cloudflare Access.</p>
<div class="grid">
  <div class="card"><h2>Unified Router</h2><p class="ok">ACTIVE</p><small>Capability registry + policy-first routing</small></div>
  <div class="card"><h2>Gateway</h2><p class="ok">ACTIVE</p><small>Progressive disclosure + execution contracts</small></div>
  <div class="card"><h2>Context Governor</h2><p class="ok">ACTIVE</p><small>KEEP / COMPRESS / DROP / PIN</small></div>
  <div class="card"><h2>Knowledge Fabric</h2><p class="gate">OPENWIKI HANDOFF</p><small>Read-only evidence retrieval; context-only authority</small></div>
  <div class="card"><h2>Browser Control</h2><p class="gate">HANDOFF</p><small>Policy-controlled Playwright MCP; live transport externally gated</small></div>
  <div class="card"><h2>Supervisor</h2><p class="ok">ACTIVE</p><small>Retry, verify, delegate, wait, escalate, stop</small></div>
</div>
<div class="card"><h2>Health</h2><pre id="health">Loading…</pre></div>
<div class="card"><h2>Metrics</h2><pre id="metrics">Loading…</pre></div>
<small>Control Center v2 — observability and control-plane status, not a public dashboard.</small>
<script>async function load(id,url){try{const r=await fetch(url,{credentials:"same-origin"});document.getElementById(id).textContent=JSON.stringify(await r.json(),null,2)}catch(e){document.getElementById(id).textContent=String(e)}}load("health","/v1/health");load("metrics","/v1/control-metrics");</script>
</body></html>`;
}
