#!/usr/bin/env python3
"""Diagnose the J2-C6 positive case: call /v1/decision for rae-attendance-v2 (loopback on 237)
and print the full response so fallback/reason_code/provider evidence is visible."""
import json
import os
import time
import urllib.error
import urllib.request

ENV = os.path.expanduser("~/.config/agent-core/agent-core.env")
kv = dict(l.split("=", 1) for l in open(ENV) if "=" in l and not l.strip().startswith("#"))
tok = json.loads(kv["AGENT_CORE_PROJECT_KEYS"])["rae-attendance-v2"]

BODY = {
    "project": "rae-attendance-v2", "task_id": "J2C6-POS-DIAG", "decision_type": "NEXT_ACTION",
    "state": {"simulated": True, "unit_tests": "green", "schema_contract": "aligned",
              "open_questions": "1"},
    "question": {"type": "choice", "instructions": "Simulated QA state only.",
                 "criteria": {"START_MIGRATION_PLAN": "Contract aligned and tests green.",
                              "REQUEST_HUMAN_REVIEW": "An open question needs a human.",
                              "BLOCK": "Contract mismatch."}},
    "fallback_result": "REQUEST_HUMAN_REVIEW",
}

for attempt in (1, 2):
    req = urllib.request.Request("http://127.0.0.1:8787/v1/decision", method="POST",
                                 data=json.dumps(BODY).encode())
    req.add_header("content-type", "application/json")
    req.add_header("x-agent-project", "rae-attendance-v2")
    req.add_header("x-agent-project-token", tok)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            code, text = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        code, text = e.code, e.read().decode()
    ms = round((time.time() - t0) * 1000)
    print(f"attempt {attempt}: HTTP {code} ({ms} ms)")
    try:
        d = json.loads(text)
        print("  ", json.dumps({k: d.get(k) for k in ("result", "confidence", "disposition",
                                                       "fallback", "reason_code", "provider_request_id")}))
    except Exception:
        print("  raw:", text[:300])
    time.sleep(1)
