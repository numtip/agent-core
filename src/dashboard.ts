export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Core Control Center</title>
<style>body{font-family:system-ui,sans-serif;margin:40px;max-width:1000px;background:#111;color:#eee}.card{border:1px solid #333;border-radius:12px;padding:20px;margin:16px 0;background:#181818}code{color:#9fd}small{color:#aaa}</style>
</head><body><h1>Agent Core Control Center</h1>
<p>Private operational surface. Production access must remain behind Cloudflare Access.</p>
<div class="card"><h2>Health</h2><pre id="health">Loading…</pre></div>
<div class="card"><h2>Metrics</h2><pre id="metrics">Loading…</pre></div>
<small>Phase 8 MVP — API-backed observability, not a public dashboard.</small>
<script>async function load(id,url){try{const r=await fetch(url,{credentials:"same-origin"});document.getElementById(id).textContent=JSON.stringify(await r.json(),null,2)}catch(e){document.getElementById(id).textContent=String(e)}}load("health","/v1/health");load("metrics","/v1/control-metrics");</script>
</body></html>`;
}