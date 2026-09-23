#!/usr/bin/env python3
"""Agent Core — local (loopback) production QA harness.
Reads secrets from the protected env file; never prints secret values.
Usage: python3 qa-local.py [base_url]
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787"
ENV_FILE = os.path.expanduser("~/.config/agent-core/agent-core.env")
AUDIT = os.path.expanduser("~/agent-core/logs/audit.jsonl")

env: dict[str, str] = {}
for line in open(ENV_FILE):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k] = v

KEYS = json.loads(env.get("AGENT_CORE_PROJECT_KEYS", "{}"))
SCOPES = json.loads(env.get("AGENT_CORE_PROJECT_SCOPES", "{}"))
OPENROUTER_KEY = env.get("OPENROUTER_API_KEY", "")

results: list[tuple[str, bool, str]] = []


def call(method: str, path: str, project: str | None = None, token: str | None = None,
         body: dict | None = None) -> tuple[int, str]:
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if project:
        req.add_header("x-agent-project", project)
    if token:
        req.add_header("x-agent-project-token", token)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


decision_body = {
    "project": "52clips",
    "task_id": "PROD-SMOKE-001",
    "decision_type": "NEXT_ACTION",
    "state": {"visual": "ready", "audio": "ready", "subtitle": "missing"},
    "question": {
        "type": "choice",
        "instructions": "Choose the next safe production action.",
        "criteria": {
            "GENERATE_SUBTITLE": "Required subtitle is missing.",
            "READY_FOR_QA": "All required production assets are present.",
            "HUMAN_REVIEW": "State is ambiguous.",
        },
    },
    "fallback_result": "HUMAN_REVIEW",
}

print("== 1. health (unauthenticated) ==")
code, body = call("GET", "/v1/health")
try:
    h = json.loads(body)
except Exception:
    h = {}
check("health 200", code == 200, f"http={code}")
check("health payload", h.get("status") == "ok" and h.get("service") == "agent-core"
      and h.get("auth_required") is True,
      json.dumps({k: h.get(k) for k in ("status", "service", "version", "auth_required",
                                        "provider_configured", "jev_model")}))

print("== 2. listening socket ==")
out = subprocess.run(["ss", "-lntp"], capture_output=True, text=True).stdout
line = next((l for l in out.splitlines() if ":8787" in l), "")
check("bound to 127.0.0.1:8787 only", "127.0.0.1:8787" in line and "0.0.0.0:8787" not in line,
      line.strip() or "no listener found")

print("== 3. authz ==")
code, _ = call("POST", "/v1/decision", body=decision_body)
check("unauthenticated protected request -> 401", code == 401, f"http={code}")
code, body = call("POST", "/v1/decision", project="52clips", token="invalid-token-value",
                  body=decision_body)
check("invalid token -> 401", code == 401, f"http={code}")
mismatch = dict(decision_body, project="handbook")
code, body = call("POST", "/v1/decision", project="52clips", token=KEYS.get("52clips", ""),
                  body=mismatch)
check("cross-project body/header mismatch -> 403", code == 403, f"http={code} {body[:60]}")
qa_body = dict(decision_body, project="dbplant", task_id="SCOPE-TEST")
code, body2 = call("POST", "/v1/qa", project="dbplant", token=KEYS.get("dbplant", ""),
                   body=qa_body)
check("wrong scope (dbplant -> qa) -> 403", code == 403 and "FORBIDDEN" in body2,
      f"http={code} {body2[:60]}")

print("== 4. provider/fallback behaviour ==")
if OPENROUTER_KEY:
    code, body3 = call("POST", "/v1/decision", project="52clips", token=KEYS.get("52clips", ""),
                       body=decision_body)
    try:
        r = json.loads(body3)
    except Exception:
        r = {}
    check("live decision reachable (key configured)", code == 200 and "confidence" in r,
          f"http={code} result={r.get('result')} conf={r.get('confidence')} "
          f"disp={r.get('disposition')} fallback={r.get('fallback')}")
else:
    code, body3 = call("POST", "/v1/decision", project="52clips", token=KEYS.get("52clips", ""),
                       body=decision_body)
    try:
        r = json.loads(body3)
    except Exception:
        r = {}
    check("provider unavailable + fallback_result -> safe FALLBACK",
          code == 200 and r.get("fallback") is True and r.get("result") == "HUMAN_REVIEW",
          f"http={code} result={r.get('result')} reason={r.get('reason_code')} "
          f"disposition={r.get('disposition')}")
    no_fb = {k: v for k, v in decision_body.items() if k != "fallback_result"}
    no_fb["task_id"] = "PROD-SMOKE-002"
    code, body4 = call("POST", "/v1/decision", project="52clips", token=KEYS.get("52clips", ""),
                       body=no_fb)
    check("provider unavailable + no fallback -> 503 DECISION_UNAVAILABLE",
          code == 503 and "DECISION_UNAVAILABLE" in body4, f"http={code} {body4[:80]}")

print("== 5. deterministic endpoints ==")
ctx_body = {"project": "handbook", "query": "handbook deployment runbook",
            "candidates": [{"id": "a", "path": "docs/deploy.md", "text": "handbook deployment runbook steps"}],
            "limit": 5}
code, body5 = call("POST", "/v1/context", project="handbook", token=KEYS.get("handbook", ""),
                   body=ctx_body)
check("/v1/context with context scope -> 200", code == 200, f"http={code} {body5[:80]}")
code, body6 = call("GET", "/v1/projects", project="52clips", token=KEYS.get("52clips", ""))
check("/v1/projects with metrics scope -> 200", code == 200, f"http={code}")
code, body7 = call("GET", "/v1/projects", project="dbplant", token=KEYS.get("dbplant", ""))
check("/v1/projects without metrics scope -> 403", code == 403, f"http={code} {body7[:60]}")

print("== 6. rate limit (max=%s window=%sms) ==" % (env.get("AGENT_CORE_RATE_LIMIT_MAX"),
                                                    env.get("AGENT_CORE_RATE_LIMIT_WINDOW_MS")))
limit = int(env.get("AGENT_CORE_RATE_LIMIT_MAX", "100"))
seen_429 = 0
last = 0
for i in range(limit + 5):
    b = dict(ctx_body, task_id=f"RL-{i}")
    last, _ = call("POST", "/v1/context", project="52clips", token=KEYS.get("52clips", ""), body=b)
    if last == 429:
        seen_429 += 1
check("rate limit -> 429 RATE_LIMITED after threshold", seen_429 > 0,
      f"429_count={seen_429} last_http={last} requests={limit + 5}")

print("== 7. audit log ==")
lines = []
if os.path.exists(AUDIT):
    lines = [json.loads(x) for x in open(AUDIT) if x.strip()]
check("audit log present", len(lines) > 0, f"{AUDIT} events={len(lines)}")
required = ["project", "route", "decision_type", "result", "confidence", "latency_ms",
            "fallback", "provider_request_id", "timestamp"]
sample = next((e for e in reversed(lines) if e.get("decision_type")), None)
missing = [f for f in required if sample is None or f not in sample]
check("audit event has required fields", not missing, f"missing={missing}")
text = open(AUDIT).read() if lines else ""
leaks = [p for p, t in KEYS.items() if t and t in text]
check("audit contains no project tokens", not leaks, f"leaked_projects={leaks}")
check("audit contains no OpenRouter key",
      not OPENROUTER_KEY or OPENROUTER_KEY not in text, "scanned")
check("audit contains no Authorization header",
      "authorization" not in text.lower() and "bearer " not in text.lower(), "scanned")

print("== 8. control center at origin ==")
code, body8 = call("GET", "/control")
check("/control serves dashboard at origin (edge must gate it)", code == 200 and "<html" in body8.lower(),
      f"http={code} bytes={len(body8)}")
code, body9 = call("GET", "/v1/control-metrics")
check("/v1/control-metrics reachable at origin (edge must gate it)", code == 200, f"http={code}")

passed = sum(1 for _, ok, _ in results if ok)
print(f"\nTOTAL {passed}/{len(results)} PASS")
for name, ok, _ in results:
    if not ok:
        print("FAILED:", name)
