#!/usr/bin/env python3
"""Agent Core v2 - isolated-instance QA (no impact on the production origin).

Two temporary loopback instances are started from the deployed release:

  8799  real Jev provider, dbplant temporarily granted the `route` scope
        -> dbplant gateway/policy path + end-to-end control-plane flow (Phase K/R)
  8800  deliberately broken provider endpoint
        -> provider failure / fallback / timeout behaviour (Phase V)

The production instance on 8787 is never touched, and no credential value is printed.
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
import uuid
from pathlib import Path

ENV_FILE = Path(os.path.expanduser("~/.config/agent-core/agent-core.env"))
RELEASE = Path(os.path.expanduser("~/agent-core/current"))
TMP = Path(os.path.expanduser("~/agent-core/logs/qa-tmp"))
RESULTS: list[dict] = []


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env


BASE_ENV = load_env()
KEYS: dict[str, str] = json.loads(BASE_ENV.get("AGENT_CORE_PROJECT_KEYS", "{}"))


def call(base: str, method: str, path: str, body=None, project: str | None = None, token: str | None = None,
         timeout: float = 30.0) -> tuple[int, object, float]:
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header("content-type", "application/json")
    if project:
        req.add_header("x-agent-project", project)
    if token:
        req.add_header("x-agent-project-token", token)
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw, status = resp.read().decode("utf-8", "replace"), resp.status
    except urllib.error.HTTPError as exc:
        raw, status = exc.read().decode("utf-8", "replace"), exc.code
    except Exception as exc:  # noqa: BLE001
        return 0, {"error": type(exc).__name__, "message": str(exc)}, (time.time() - started) * 1000
    latency = (time.time() - started) * 1000
    try:
        parsed: object = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        parsed = raw
    return status, parsed, latency


def record(case: str, phase: str, expected: str, observed: str, status: str, evidence: dict,
           project: str | None = None, operation: str | None = None, latency_ms: float | None = None,
           extra: dict | None = None) -> None:
    entry = {"case": case, "phase": phase, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
             "project": project, "operation": operation, "expected": expected, "observed": observed,
             "status": status, "latency_ms": round(latency_ms, 1) if latency_ms is not None else None,
             "evidence": evidence}
    if extra:
        entry.update(extra)
    RESULTS.append(entry)
    print(f"[{status:5}] {case:36} {observed}")


def start_instance(port: int, overrides: dict[str, str], audit: Path) -> subprocess.Popen:
    env = dict(os.environ)
    env.update({k: v for k, v in BASE_ENV.items()})
    env["AGENT_CORE_HOST"] = "127.0.0.1"
    env["AGENT_CORE_PORT"] = str(port)
    env["AGENT_CORE_AUDIT_LOG"] = str(audit)
    env.update(overrides)
    log = open(TMP / f"instance-{port}.log", "a")
    proc = subprocess.Popen(["node", str(RELEASE / "dist/src/server.js")], env=env, stdout=log, stderr=log,
                            start_new_session=True)
    for _ in range(60):
        status, _body, _ = call(f"http://127.0.0.1:{port}", "GET", "/v1/health", timeout=2)
        if status == 200:
            return proc
        if proc.poll() is not None:
            raise RuntimeError(f"instance on {port} exited with {proc.returncode}, see {TMP}/instance-{port}.log")
        time.sleep(0.5)
    raise RuntimeError(f"instance on {port} did not become healthy")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.expanduser("~/agent-core/logs/v2-qa-isolated.jsonl"))
    args = parser.parse_args()
    TMP.mkdir(parents=True, exist_ok=True)
    procs: list[subprocess.Popen] = []

    scopes = json.loads(BASE_ENV.get("AGENT_CORE_PROJECT_SCOPES", "{}"))
    scopes["dbplant"] = ["decision", "route", "context"]  # temporary elevation, isolated instance only

    try:
        # ---------------- instance A: real provider, dbplant route scope ----------------
        audit_a = TMP / "audit-8799.jsonl"
        procs.append(start_instance(8799, {"AGENT_CORE_PROJECT_SCOPES": json.dumps(scopes, separators=(",", ":"))}, audit_a))
        base = "http://127.0.0.1:8799"
        dbplant_token = KEYS["dbplant"]

        k = [
            ("K3-dbplant-write", {"project": "dbplant", "task": "update row", "operation": "WRITE",
                                  "capability_id": "tool.git"}, "APPROVAL_REQUIRED/DBPLANT_READ_ONLY_DEFAULT"),
            ("K4-dbplant-destructive", {"project": "dbplant", "task": "drop table", "operation": "DESTRUCTIVE"},
             "APPROVAL_REQUIRED"),
            ("K5-dbplant-read", {"project": "dbplant", "task": "read report", "operation": "READ",
                                 "capability_id": "deterministic.runtime"}, "no execution (contract only)"),
            ("K9-dbplant-generic-agent", {"project": "dbplant", "task": "run shell on vps", "operation": "READ",
                                          "capability_id": "agent.hermes"}, "no bypass of dbplant policy"),
            ("K10-dbplant-prod-write", {"project": "dbplant", "task": "write production table", "operation": "WRITE",
                                        "environment": "production"}, "APPROVAL_REQUIRED"),
            ("K11-dbplant-secret-target", {"project": "dbplant", "task": "read secret", "operation": "READ",
                                           "targets": ["/var/lib/dbplant/credentials.json"]}, "APPROVAL_REQUIRED/SECRET"),
            ("K12-dbplant-browser", {"project": "dbplant", "task": "browse", "operation": "READ",
                                     "capability_id": "mcp.playwright"}, "403 FORBIDDEN (browser scope not granted to dbplant)"),
        ]
        for case, payload, expectation in k:
            status, body, latency = call(base, "POST", "/v2/execute", payload, project="dbplant", token=dbplant_token)
            body = body if isinstance(body, dict) else {"raw": body}
            disposition, executed, reason = body.get("disposition"), body.get("executed"), body.get("reason")
            if case == "K5-dbplant-read":
                ok = status == 200 and executed is False
            elif case == "K9-dbplant-generic-agent":
                ok = status == 200 and executed is False and disposition in {"HANDOFF", "READY_LOCAL", "APPROVAL_REQUIRED"}
            elif case == "K12-dbplant-browser":
                ok = status == 403 and body.get("scope") == "browser"
            elif case == "K11-dbplant-secret-target":
                ok = status == 200 and disposition == "APPROVAL_REQUIRED" and reason == "SECRET_OR_CREDENTIAL_TARGET"
            else:
                ok = status == 200 and disposition == "APPROVAL_REQUIRED" and executed is False
            record(case, "K", expectation, f"{status} disposition={disposition} executed={executed} reason={reason}",
                   "PASS" if ok else "FAIL",
                   {"disposition": disposition, "executed": executed, "reason": reason,
                    "execution_mode": (body.get("execution") or {}).get("mode")},
                   project="dbplant", operation=payload.get("operation"), latency_ms=latency)

        # ---------------- Phase R: end-to-end control plane ----------------
        # 1 auth boundary -> 2 registry -> 3 router -> 4 policy/gateway -> 5 governor -> 6 provider -> 7 audit
        status_unauth, _, _ = call(base, "POST", "/v2/route", {"project": "dbplant", "task": "x"})
        status_reg, reg, _ = call(base, "GET", "/v2/capabilities", project="dbplant", token=dbplant_token)
        status_route, route, lat_route = call(base, "POST", "/v2/route",
                                              {"project": "dbplant", "task": "validate sql export checksums",
                                               "complexity": "deterministic", "cost_preference": "lowest"},
                                              project="dbplant", token=dbplant_token)
        status_exec, exec_body, _ = call(base, "POST", "/v2/execute",
                                         {"project": "dbplant", "task": "publish production report", "operation": "WRITE",
                                          "environment": "production"}, project="dbplant", token=dbplant_token)
        status_ctx, ctx_body, _ = call(base, "POST", "/v2/context/govern",
                                       {"project": "dbplant", "query": "sql export verification",
                                        "items": [{"id": "a", "text": "SQL export checksum verification steps", "importance": 0.9},
                                                  {"id": "b", "text": "unrelated chatter " * 40, "age_turns": 200, "importance": 0.1}]},
                                       project="dbplant", token=dbplant_token)
        status_jev, jev, lat_jev = call(base, "POST", "/v1/decision",
                                        {"project": "dbplant", "task_id": f"e2e-{uuid.uuid4().hex[:6]}",
                                         "decision_type": "QA_DISPOSITION", "state": {"rows": 12000, "checksum_match": True},
                                         "question": {"type": "choice", "instructions": "Approve the SQL export?",
                                                      "criteria": {"APPROVE": "checksums match", "REJECT": "mismatch"}}},
                                        project="dbplant", token=dbplant_token)
        chain = {
            "1_auth_401_without_identity": status_unauth == 401,
            "2_capability_registry": status_reg == 200 and len((reg or {}).get("capabilities", [])) == 7,
            "3_unified_router": status_route == 200 and ((route or {}).get("selected") or {}).get("id") == "deterministic.runtime",
            "4_policy_before_execution": status_exec == 200 and (exec_body or {}).get("disposition") == "APPROVAL_REQUIRED",
            "5_context_governor": status_ctx == 200 and bool((ctx_body or {}).get("receipt")),
            "6_provider_decision": status_jev == 200 and (jev or {}).get("decision_type") == "QA_DISPOSITION",
        }
        record("R1-end-to-end-chain", "R", "auth->registry->router->policy->governor->provider all enforced",
               json.dumps({k: v for k, v in chain.items()}, sort_keys=False),
               "PASS" if all(chain.values()) else "FAIL", chain, project="dbplant")

        time.sleep(0.5)
        events = []
        if audit_a.exists():
            for line in audit_a.read_text().splitlines():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        actions = sorted({e.get("action", "") for e in events})
        audit_chain = {
            "UNIFIED_ROUTE": "UNIFIED_ROUTE" in actions,
            "GATEWAY_INTERCEPT": "GATEWAY_INTERCEPT" in actions,
            "CONTEXT_GOVERN": "CONTEXT_GOVERN" in actions,
            "JEV_DECISION": "QA_DISPOSITION" in actions,
            "no_token_leak": not any(KEYS["dbplant"] in json.dumps(e) for e in events),
        }
        record("R2-end-to-end-audit", "R", "audit row per control-plane layer, no secrets",
               json.dumps(audit_chain), "PASS" if all(audit_chain.values()) else "FAIL",
               {"actions": actions, "checks": audit_chain, "events": len(events)}, project="dbplant")

        status_metrics, m, _ = call(base, "GET", "/v1/control-metrics")
        counters = (m or {}).get("counters", {}) if isinstance(m, dict) else {}
        wanted = {"v2_routes", "gateway_requests", "context_governor_requests", "policy_blocks", "decisions"}
        record("R3-end-to-end-metrics", "R", "counters for every layer",
               f"{status_metrics} counters={sorted(counters.keys())}",
               "PASS" if status_metrics == 200 and wanted.issubset(set(counters)) else "FAIL",
               {"counters": counters}, project="dbplant")

        # ---------------- instance B: broken provider ----------------
        audit_b = TMP / "audit-8800.jsonl"
        procs.append(start_instance(8800, {
            "OPENROUTER_DECISIONS_URL": "http://127.0.0.1:9/dead-endpoint",
            "OPENROUTER_TIMEOUT_MS": "1200",
        }, audit_b))
        base_b = "http://127.0.0.1:8800"
        token = KEYS["goffice2026"]

        payload_nofb = {"project": "goffice2026", "task_id": "v28-fail-1", "decision_type": "TASK_ROUTE", "state": {"x": 1},
                        "question": {"type": "noul", "instructions": "proceed?", "true_when": "ok", "false_when": "no"}}
        status, body, latency = call(base_b, "POST", "/v1/decision", payload_nofb, project="goffice2026", token=token)
        record("V1-provider-unreachable-no-fallback", "V", "503 DECISION_UNAVAILABLE (explicit, not swallowed)",
               f"{status} {body if isinstance(body, dict) else str(body)[:120]}",
               "PASS" if status == 503 and isinstance(body, dict) and body.get("error") == "DECISION_UNAVAILABLE" else "FAIL",
               {"body": body}, project="goffice2026", latency_ms=latency)

        payload_fb = dict(payload_nofb, task_id="v28-fail-2", fallback_result="REVIEW")
        status, body, latency = call(base_b, "POST", "/v1/decision", payload_fb, project="goffice2026", token=token)
        body = body if isinstance(body, dict) else {"raw": body}
        record("V2-provider-unreachable-with-fallback", "V", "200 FALLBACK disposition, fallback=true",
               f"{status} disposition={body.get('disposition')} fallback={body.get('fallback')} reason={body.get('reason_code')}",
               "PASS" if status == 200 and body.get("disposition") == "FALLBACK" and body.get("fallback") is True else "FAIL",
               {"disposition": body.get("disposition"), "reason_code": body.get("reason_code"),
                "confidence": body.get("confidence")}, project="goffice2026", latency_ms=latency)

        status_health, health, _ = call(base_b, "GET", "/v1/health")
        record("V3-degraded-but-alive", "V", "service stays up and health stays honest",
               f"{status_health} provider_configured={(health or {}).get('provider_configured')}",
               "PASS" if status_health == 200 else "FAIL", {"health": health}, project="goffice2026")

        status, body, _ = call(base_b, "POST", "/v2/execute",
                               {"project": "goffice2026", "task": "bad capability", "capability_id": "no.such.cap"},
                               project="goffice2026", token=token)
        record("V4-invalid-capability", "V", "UNAVAILABLE (explicit contract)",
               f"{status} {(body or {}).get('disposition') if isinstance(body, dict) else body}",
               "PASS" if status == 200 and isinstance(body, dict) and body.get("disposition") == "UNAVAILABLE" else "FAIL",
               {"body": body}, project="goffice2026")

    finally:
        for proc in procs:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except Exception:  # noqa: BLE001
                proc.terminate()
        for proc in procs:
            try:
                proc.wait(timeout=10)
            except Exception:  # noqa: BLE001
                pass

    out = Path(args.out)
    with out.open("a") as fh:
        for entry in RESULTS:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    failed = [r["case"] for r in RESULTS if r["status"] == "FAIL"]
    print(f"\nisolated_cases={len(RESULTS)} pass={len(RESULTS)-len(failed)} fail={len(failed)}")
    if failed:
        print("FAILED:", ", ".join(failed))
    print(f"results_file={out}")
    # verify both temporary instances are gone
    leftover = subprocess.run(["bash", "-lc", "ss -lntp | grep -E ':(8799|8800) ' || true"],
                              capture_output=True, text=True).stdout.strip()
    print("leftover_listeners:", leftover or "none")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
