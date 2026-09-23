#!/usr/bin/env python3
"""Agent Core — LIVE OpenRouter/Jev smoke QA.

Checks the real Decisions API contract, the same calls through an Agent Core instance,
and provider failure classification. Never prints secret values and never sources the
env file through a shell (JSON maps must not be quote-stripped).

Usage:
  python3 ops/qa-live.py                       # against http://127.0.0.1:8787 (production unit)
  python3 ops/qa-live.py --app http://127.0.0.1:8788   # against a staging instance
  python3 ops/qa-live.py --no-staging          # skip the temporary timeout instance
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

ENV_FILE = os.path.expanduser("~/.config/agent-core/agent-core.env")
DECISIONS = "https://openrouter.ai/api/alpha/decisions"
SERVER = "/home/prinyaroot/agent-core/current/dist/src/server.js"
results: list[tuple[str, bool, str]] = []


def check(name: str, ok_: bool, detail: str = "") -> None:
    results.append((name, ok_, detail))
    print(f"[{'PASS' if ok_ else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in open(ENV_FILE):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v
    return env


ENV = load_env()
KEYS = json.loads(ENV["AGENT_CORE_PROJECT_KEYS"])
KEY = ENV.get("OPENROUTER_API_KEY", "")


def post(url: str, body: dict, token: str | None = None, project: str | None = None,
         project_token: str | None = None, timeout: int = 300) -> tuple[int, str, float]:
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if project:
        req.add_header("x-agent-project", project)
    if project_token:
        req.add_header("x-agent-project-token", project_token)
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode(), time.time() - start
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode(), time.time() - start
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}", time.time() - start


CHOICE_Q = {"type": "choice", "instructions": "Choose the next safe production action.",
            "criteria": {"GENERATE_SUBTITLE": "Required subtitle is missing.",
                         "READY_FOR_QA": "All required assets are present.",
                         "HUMAN_REVIEW": "State is ambiguous."}}
NOUL_Q = {"type": "noul", "instructions": "Is the subtitle track ready to publish?",
          "true_when": "The subtitle file exists and passed QA.",
          "false_when": "The subtitle file is missing or failed QA."}
SCORE_Q = {"type": "score", "instructions": "Rate pilot readiness.",
           "levels": ["not started", "partial", "fully ready"]}


def decision_body(q: dict, tag: str) -> dict:
    return {"project": "52clips", "task_id": f"PROD-SMOKE-{tag}", "decision_type": "NEXT_ACTION",
            "state": {"visual": "ready", "audio": "ready", "subtitle": "missing"},
            "question": q, "fallback_result": "HUMAN_REVIEW"}


def direct(q: dict, label: str) -> tuple[int, dict, float]:
    st, raw, dt = post(DECISIONS, {"model": "~typesafe/jev-latest",
                                   "state": {"visual": "ready", "subtitle": "missing"},
                                   "questions": {"decision": q}}, token=KEY)
    try:
        return st, json.loads(raw), dt
    except Exception:
        return st, {"raw": raw[:200]}, dt


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", default="http://127.0.0.1:8787")
    ap.add_argument("--no-staging", action="store_true")
    args = ap.parse_args()

    print(f"== 1. Decisions API contract (direct, model ~typesafe/jev-latest) ==")
    st, payload, dt = direct(CHOICE_Q, "choice")
    ans = (payload.get("answers") or {}).get("decision") or {}
    probs = ans.get("probabilities") or {}
    check("OpenRouter decisions API reachable", st == 200, f"http={st} latency={dt:.2f}s")
    check("choice contract: {choice: string, probabilities: map, confidence: number}",
          isinstance(ans.get("choice"), str) and isinstance(probs, dict)
          and isinstance(ans.get("confidence"), (int, float)),
          f"model={payload.get('model')} choice={ans.get('choice')} "
          f"confidence={ans.get('confidence')} probs_are_0_1="
          f"{bool(probs) and all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in probs.values())}")
    check("provider request id present", bool(payload.get("id")), str(payload.get("id"))[:28])

    st, payload, dt = direct(NOUL_Q, "noul")
    ans = (payload.get("answers") or {}).get("decision") or {}
    check("noul contract: {noul: probability}", isinstance(ans.get("noul"), (int, float)),
          f"http={st} noul={ans.get('noul')} latency={dt:.2f}s")

    st, payload, dt = direct({"type": "score", "instructions": "Rate pilot readiness.",
                              "criteria": ["not started", "partial", "fully ready"]}, "score")
    ans = (payload.get("answers") or {}).get("decision") or {}
    check("score contract: {score, legend, probabilities, confidence}",
          isinstance(ans.get("score"), (int, float)) and isinstance(ans.get("legend"), dict)
          and isinstance(ans.get("confidence"), (int, float)),
          f"http={st} score={ans.get('score')} legend={ans.get('legend')} "
          f"confidence={ans.get('confidence')} latency={dt:.2f}s")

    print(f"\n== 2. Live decisions through Agent Core ({args.app}) ==")
    for label, q in (("choice", CHOICE_Q), ("noul", NOUL_Q), ("score", SCORE_Q)):
        st, raw, dt = post(args.app + "/v1/decision", decision_body(q, label.upper()),
                           project="52clips", project_token=KEYS["52clips"], timeout=300)
        try:
            r = json.loads(raw)
        except Exception:
            r = {"raw": raw[:150]}
        ok_ = st == 200 and not r.get("fallback") and isinstance(r.get("confidence"), (int, float))
        check(f"live Jev {label} PASS through Agent Core", ok_,
              f"http={st} result={r.get('result')} conf={r.get('confidence')} "
              f"disp={r.get('disposition')} reason={r.get('reason_code')} "
              f"fallback={r.get('fallback')} latency={dt:.2f}s")
        check(f"confidence in 0..1 ({label})",
              isinstance(r.get("confidence"), (int, float)) and 0 <= r["confidence"] <= 1,
              f"conf={r.get('confidence')}")

    print("\n== 3. provider failure classification ==")
    st_bad, raw_bad, _ = post(DECISIONS, {"model": "~typesafe/jev-latest", "state": {"probe": "auth"},
                                          "questions": {"decision": {"type": "choice",
                                                                     "instructions": "probe",
                                                                     "criteria": {"A": "a", "B": "b"}}}},
                              token="sk-or-v1-invalid-key-classification-probe", timeout=60)
    check("authentication failure -> HTTP 401/403 (not treated as generic failure)",
          st_bad in (401, 403), f"http={st_bad} {raw_bad[:80]}")
    st_net, raw_net, _ = post("https://127.0.0.1:9/alpha/decisions", {"model": "x"}, token=KEY,
                              timeout=15)
    check("network failure -> transport error (no HTTP status)", st_net == 0,
          f"{raw_net[:70]}")

    if not args.no_staging:
        print("\n== 4. timeout fails safely (temporary instance, production untouched) ==")
        stage_env = dict(os.environ)
        stage_env.update({k: v for k, v in ENV.items()})
        stage_env["AGENT_CORE_PORT"] = "8788"
        stage_env["AGENT_CORE_HOST"] = "127.0.0.1"
        stage_env["OPENROUTER_TIMEOUT_MS"] = "1"
        stage_env["AGENT_CORE_AUDIT_LOG"] = "/tmp/agent-core-timeout-audit.jsonl"
        proc = subprocess.Popen(["node", SERVER], env=stage_env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            time.sleep(3)
            st, raw, dt = post("http://127.0.0.1:8788/v1/decision", decision_body(CHOICE_Q, "TIMEOUT"),
                               project="52clips", project_token=KEYS["52clips"], timeout=30)
            r = json.loads(raw)
            check("timeout + fallback_result -> safe FALLBACK",
                  st == 200 and r.get("fallback") is True
                  and r.get("reason_code") == "PROVIDER_UNAVAILABLE",
                  f"http={st} result={r.get('result')} reason={r.get('reason_code')} "
                  f"latency={dt:.2f}s")
            nb = decision_body(CHOICE_Q, "TIMEOUT-NOFB")
            nb.pop("fallback_result")
            st_n, raw_n, _ = post("http://127.0.0.1:8788/v1/decision", nb, project="52clips",
                                  project_token=KEYS["52clips"], timeout=30)
            check("timeout + no fallback -> 503 DECISION_UNAVAILABLE",
                  st_n == 503 and "DECISION_UNAVAILABLE" in raw_n, f"http={st_n}")
        finally:
            proc.send_signal(signal.SIGTERM)
            time.sleep(1)
            if proc.poll() is None:
                proc.kill()
            for path in ("/tmp/agent-core-timeout-audit.jsonl",):
                if os.path.exists(path):
                    os.remove(path)

    passed = sum(1 for _, o, _ in results if o)
    print(f"\nTOTAL {passed}/{len(results)} PASS")
    for n, o, _ in results:
        if not o:
            print("FAILED:", n)
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
