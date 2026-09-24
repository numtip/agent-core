#!/usr/bin/env python3
"""Agent Core v2 - V2-8 reproducible benchmark suite (BENCH-01 .. BENCH-15).

Runs against the live loopback origin (8787) plus two short-lived isolated instances
(8799 dbplant policy path, 8800 broken provider for the fallback case). No secret is printed.

Usage: python3 ops/v2-benchmark.py [--reps 3] [--out ~/agent-core/logs/v2-benchmark.jsonl]
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import statistics
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
         timeout: float = 40.0) -> tuple[int, object, float]:
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
        parsed = raw[:4000]
    return status, parsed, latency


def start_instance(port: int, overrides: dict[str, str], audit: Path) -> subprocess.Popen:
    env = dict(os.environ)
    env.update(BASE_ENV)
    env.update({"AGENT_CORE_HOST": "127.0.0.1", "AGENT_CORE_PORT": str(port), "AGENT_CORE_AUDIT_LOG": str(audit)})
    env.update(overrides)
    log = open(TMP / f"bench-instance-{port}.log", "a")
    proc = subprocess.Popen(["node", str(RELEASE / "dist/src/server.js")], env=env, stdout=log, stderr=log, start_new_session=True)
    for _ in range(60):
        status, _b, _l = call(f"http://127.0.0.1:{port}", "GET", "/v1/health", timeout=2)
        if status == 200:
            return proc
        if proc.poll() is not None:
            raise RuntimeError(f"bench instance {port} exited ({proc.returncode})")
        time.sleep(0.5)
    raise RuntimeError(f"bench instance {port} never became healthy")


def supervisor_latency() -> tuple[str, float]:
    script = (
        "import { supervise } from '"
        + str(RELEASE / "dist/src/supervisor.js")
        + "';"
        + "const t=process.hrtime.bigint();"
        + "const r=supervise({project:'goffice2026',task_id:'bench',phase:'VERIFYING',goal:'g',attempts:1,max_attempts:3,"
        + "blocked:false,dependency_ready:true,qa_status:'FAIL',operation:'READ',active_agents:[],completed_subgoals:[],pending_subgoals:[]});"
        + "const ms=Number(process.hrtime.bigint()-t)/1e6;console.log(JSON.stringify({decision:r.decision,ms}));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30)
    payload = json.loads(out.stdout.strip().splitlines()[-1])
    return payload["decision"], payload["ms"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reps", type=int, default=3)
    parser.add_argument("--out", default=os.path.expanduser("~/agent-core/logs/v2-benchmark.jsonl"))
    parser.add_argument("--summary", default=os.path.expanduser("~/agent-core/logs/v2-benchmark-summary.json"))
    args = parser.parse_args()
    TMP.mkdir(parents=True, exist_ok=True)

    scopes = json.loads(BASE_ENV.get("AGENT_CORE_PROJECT_SCOPES", "{}"))
    scopes_dbplant = dict(scopes, dbplant=["decision", "route", "context"])
    procs: list[subprocess.Popen] = []
    procs.append(start_instance(8799, {"AGENT_CORE_PROJECT_SCOPES": json.dumps(scopes_dbplant, separators=(",", ":"))}, TMP / "bench-audit-8799.jsonl"))
    procs.append(start_instance(8800, {"OPENROUTER_DECISIONS_URL": "http://127.0.0.1:9/dead", "OPENROUTER_TIMEOUT_MS": "1200"}, TMP / "bench-audit-8800.jsonl"))
    procs.append(start_instance(8801, {"PLAYWRIGHT_MCP_EXECUTION_ENABLED": "false"}, TMP / "bench-audit-8801.jsonl"))
    procs.append(start_instance(8802, {"PLAYWRIGHT_MCP_EXECUTION_ENABLED": "true",
                                       "PLAYWRIGHT_MCP_ENDPOINT": "http://127.0.0.1:9/dead-mcp",
                                       "PLAYWRIGHT_MCP_TIMEOUT_MS": "3000"}, TMP / "bench-audit-8802.jsonl"))

    live = "http://127.0.0.1:8787"
    iso = "http://127.0.0.1:8799"
    broken = "http://127.0.0.1:8800"
    flags_off = "http://127.0.0.1:8801"
    mcp_down = "http://127.0.0.1:8802"
    ctx_items = [
        {"id": f"item-{i}",
         "text": ("deployment artifact and checksum detail for the release pipeline " * 55) if i % 4 == 0
                 else f"note {i} about unrelated operational chatter",
         "kind": "log" if i % 3 == 0 else "note", "importance": 0.2 + (i % 5) / 10, "age_turns": i}
        for i in range(40)
    ] + [{"id": "req", "text": "Requirement: keep Agent Core loopback-only.", "protected_reasons": ["EXPLICIT_REQUIREMENT"]}]

    cases: list[dict] = []

    def add_case(case_id, description, project, operation, runner, evaluate, expectation_label, *_ignored):
        cases.append({"id": case_id, "description": description, "project": project, "operation": operation,
                      "expectation": expectation_label, "runner": runner, "evaluate": evaluate})

    add_case("BENCH-01", "deterministic validation route", "goffice2026", "READ",
             lambda: call(live, "POST", "/v2/route", {"project": "goffice2026", "task": "validate manifest and verify checksums",
                                                      "complexity": "deterministic", "cost_preference": "lowest"},
                          "goffice2026", KEYS["goffice2026"]),
             lambda s, b: (b.get("selected") or {}).get("id") == "deterministic.runtime", "deterministic.runtime")
    add_case("BENCH-02", "complex reasoning route", "goffice2026", "READ",
             lambda: call(live, "POST", "/v2/route", {"project": "goffice2026", "task": "analyze architecture tradeoffs",
                                                      "complexity": "complex", "preferred_tags": ["reasoning"]},
                          "goffice2026", KEYS["goffice2026"]),
             lambda s, b: (b.get("selected") or {}).get("id") == "model.frontier", "model.frontier")
    add_case("BENCH-03", "coding route", "goffice2026", "READ",
             lambda: call(live, "POST", "/v2/route", {"project": "goffice2026", "task": "refactor repo code and add tests",
                                                      "complexity": "complex", "preferred_tags": ["coding"]},
                          "goffice2026", KEYS["goffice2026"]),
             lambda s, b: (b.get("selected") or {}).get("id") in {"agent.cursor", "agent.codex", "model.frontier"},
             "agent.cursor|agent.codex|model.frontier")
    add_case("BENCH-04", "VPS/operations route", "goffice2026", "READ",
             lambda: call(live, "POST", "/v2/route", {"project": "goffice2026", "task": "deploy service on vps",
                                                      "required_tags": ["vps"]}, "goffice2026", KEYS["goffice2026"]),
             lambda s, b: (b.get("selected") or {}).get("id") == "agent.hermes", "agent.hermes")
    add_case("BENCH-05", "context-heavy governance", "goffice2026", "READ",
             lambda: call(live, "POST", "/v2/context/govern", {"project": "goffice2026", "task_id": "bench-ctx",
                                                               "query": "deployment artifact checksum", "items": ctx_items,
                                                               "max_items": 12}, "goffice2026", KEYS["goffice2026"]),
             lambda s, b: bool((b.get("receipt") or {}).get("reduction_ratio") is not None), "receipt with reduction ratio")
    add_case("BENCH-06", "gateway handoff contract", "handbook", "READ",
             lambda: call(live, "POST", "/v2/execute", {"project": "handbook", "task": "read page", "operation": "READ",
                                                        "capability_id": "mcp.playwright"}, "handbook", KEYS["handbook"]),
             lambda s, b: b.get("disposition") == "HANDOFF" and b.get("executed") is False, "HANDOFF")
    add_case("BENCH-07", "browser read plan", "handbook", "READ",
             lambda: call(live, "POST", "/v2/browser/plan", {"project": "handbook", "task_id": "bench-brw-1",
                                                             "url": "https://example.com/", "action": "BROWSER_READ"},
                          "handbook", KEYS["handbook"]),
             lambda s, b: b.get("disposition") == "READY" and bool((b.get("receipt") or {}).get("receipt_id")), "READY+receipt")
    add_case("BENCH-08", "browser navigate plan", "handbook", "READ",
             lambda: call(live, "POST", "/v2/browser/plan", {"project": "handbook", "task_id": "bench-brw-2",
                                                             "url": "https://example.com/page", "action": "BROWSER_NAVIGATE"},
                          "handbook", KEYS["handbook"]),
             lambda s, b: b.get("disposition") == "READY", "READY")
    add_case("BENCH-09", "blocked production write", "goffice2026", "WRITE",
             lambda: call(live, "POST", "/v2/execute", {"project": "goffice2026", "task": "publish production content",
                                                        "operation": "WRITE", "environment": "production"},
                          "goffice2026", KEYS["goffice2026"]),
             lambda s, b: b.get("disposition") == "APPROVAL_REQUIRED" and b.get("executed") is False, "APPROVAL_REQUIRED")
    add_case("BENCH-10", "blocked destructive action", "goffice2026", "DESTRUCTIVE",
             lambda: call(live, "POST", "/v2/execute", {"project": "goffice2026", "task": "drop database table",
                                                        "operation": "DESTRUCTIVE"}, "goffice2026", KEYS["goffice2026"]),
             lambda s, b: b.get("disposition") == "APPROVAL_REQUIRED", "APPROVAL_REQUIRED")

    def bench_supervisor():
        decision, ms = supervisor_latency()
        return 200, {"decision": decision}, ms

    add_case("BENCH-11", "supervisor retry decision", "goffice2026", "READ",
             bench_supervisor, lambda s, b: b.get("decision") == "RETRY", "RETRY")
    add_case("BENCH-12", "QA verification decision (live Jev)", "goffice2026", "READ",
             lambda: call(live, "POST", "/v1/qa", {"project": "goffice2026", "task_id": f"bench-{uuid.uuid4().hex[:6]}",
                                                   "decision_type": "QA_DISPOSITION",
                                                   "state": {"tests": 57, "build": "pass", "warnings": 2},
                                                   "question": {"type": "noul", "instructions": "Is the release verified?",
                                                                "true_when": "tests and build pass", "false_when": "any failure"},
                                                   "fallback_result": "REVIEW"}, "goffice2026", KEYS["goffice2026"]),
             lambda s, b: s == 200 and b.get("disposition") in {"EXECUTE", "REVIEW", "FALLBACK"},
             "EXECUTE|REVIEW|FALLBACK")
    add_case("BENCH-13", "dbplant write protection", "dbplant", "WRITE",
             lambda: call(iso, "POST", "/v2/execute", {"project": "dbplant", "task": "update production row",
                                                       "operation": "WRITE"}, "dbplant", KEYS["dbplant"]),
             lambda s, b: b.get("disposition") == "APPROVAL_REQUIRED" and b.get("reason") == "DBPLANT_READ_ONLY_DEFAULT",
             "APPROVAL_REQUIRED/DBPLANT_READ_ONLY_DEFAULT")
    add_case("BENCH-14", "auth scope mismatch", "52clips", "READ",
             lambda: call(live, "POST", "/v2/route", {"project": "dbplant", "task": "stolen identity"},
                          "52clips", KEYS["52clips"]),
             lambda s, b: s == 403 and b.get("error") == "PROJECT_MISMATCH", "403 PROJECT_MISMATCH")
    add_case("BENCH-15", "provider fallback", "goffice2026", "READ",
             lambda: call(broken, "POST", "/v1/decision", {"project": "goffice2026", "task_id": f"bench-{uuid.uuid4().hex[:6]}",
                                                           "decision_type": "TASK_ROUTE", "state": {"x": 1},
                                                           "question": {"type": "noul", "instructions": "proceed?",
                                                                        "true_when": "ready", "false_when": "not ready"},
                                                           "fallback_result": "REVIEW"},
                          "goffice2026", KEYS["goffice2026"], 30.0),
             lambda s, b: s == 200 and b.get("disposition") == "FALLBACK" and b.get("fallback") is True,
             "FALLBACK(fallback=true)")
    add_case("BENCH-16", "live browser execution (READ via MCP)", "handbook", "READ",
             lambda: call(live, "POST", "/v2/browser/execute",
                          {"project": "handbook", "task_id": f"bench-brw-{uuid.uuid4().hex[:6]}",
                           "url": "https://example.com/", "action": "BROWSER_READ"}, "handbook", KEYS["handbook"], 90.0),
             lambda s, b: s == 200 and b.get("disposition") == "EXECUTED" and b.get("executed") is True
                          and bool(((b.get("receipt") or {}).get("mcp") or {}).get("session_id")),
             "EXECUTED executed=true with MCP session")
    add_case("BENCH-17", "kill switch off (no live execution)", "handbook", "READ",
             lambda: call(flags_off, "POST", "/v2/browser/execute",
                          {"project": "handbook", "task_id": "bench-flag-off", "url": "https://example.com/",
                           "action": "BROWSER_READ"}, "handbook", KEYS["handbook"]),
             lambda s, b: s == 200 and b.get("executed") is False and b.get("reason") == "MCP_EXECUTION_DISABLED",
             "READY executed=false / MCP_EXECUTION_DISABLED")
    add_case("BENCH-18", "MCP runtime down (clean failure)", "handbook", "READ",
             lambda: call(mcp_down, "POST", "/v2/browser/execute",
                          {"project": "handbook", "task_id": "bench-mcp-down", "url": "https://example.com/",
                           "action": "BROWSER_READ"}, "handbook", KEYS["handbook"], 30.0),
             lambda s, b: s == 503 and b.get("error") == "MCP_UNAVAILABLE" and b.get("executed") is False,
             "503 MCP_UNAVAILABLE executed=false")

    runs: list[dict] = []
    try:
        for case in cases:
            for rep in range(1, args.reps + 1):
                started = time.time()
                status, body, latency = case["runner"]()
                body = body if isinstance(body, dict) else {"raw": str(body)[:200]}
                try:
                    ok = bool(case["evaluate"](status, body))
                    expected = case["expectation"]
                except Exception as exc:  # noqa: BLE001
                    ok, expected = False, f"evaluation error: {exc}"
                receipt = body.get("receipt") or {}
                run = {
                    "benchmark_id": case["id"],
                    "rep": rep,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    "project": case["project"],
                    "operation": case["operation"],
                    "description": case["description"],
                    "route": ((body.get("selected") or {}).get("id") if isinstance(body.get("selected"), dict) else None)
                             or body.get("decision") or body.get("disposition"),
                    "policy": body.get("reason") or (body.get("policy") or {}).get("disposition"),
                    "confidence": body.get("confidence"),
                    "fallback": body.get("fallback"),
                    "retry_count": None,
                    "latency_ms": round(latency, 1),
                    "context_original_chars": receipt.get("original_chars"),
                    "context_output_chars": receipt.get("output_chars"),
                    "context_reduction_ratio": receipt.get("reduction_ratio"),
                    "browser_result": body.get("disposition") if case["id"] in {"BENCH-07", "BENCH-08"} else None,
                    "http_status": status,
                    "expected": expected,
                    "outcome": "PASS" if ok else "FAIL",
                }
                runs.append(run)
                print(f"[{run['outcome']}] {case['id']} rep{rep} {run['latency_ms']:7.1f}ms "
                      f"route={run['route']} policy={run['policy']}")

        # summary
        passed = [r for r in runs if r["outcome"] == "PASS"]
        failed = [r for r in runs if r["outcome"] == "FAIL"]
        latencies = sorted(r["latency_ms"] for r in runs)
        def pct(p: float) -> float:
            if not latencies:
                return 0.0
            index = min(len(latencies) - 1, int(round(p * (len(latencies) - 1))))
            return latencies[index]
        by_case = {}
        for run in runs:
            by_case.setdefault(run["benchmark_id"], []).append(run)
        context_runs = [r for r in runs if r.get("context_reduction_ratio") is not None]
        provider_runs = [r for r in runs if r["benchmark_id"] == "BENCH-15"]
        policy_blocks = [r for r in runs if r["policy"] in
                         {"PRODUCTION_WRITE_REQUIRES_APPROVAL", "DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL",
                          "DBPLANT_READ_ONLY_DEFAULT"}]
        summary = {
            "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "source_sha": os.environ.get("AGENT_CORE_SOURCE_SHA") or BASE_ENV.get("AGENT_CORE_SOURCE_SHA", "unknown"),
            "release": str(os.readlink(os.path.expanduser("~/agent-core/current"))),
            "runtime_version": (call(live, "GET", "/v1/health")[1] or {}).get("version"),
            "sample_count": len(runs),
            "cases": len(cases),
            "pass": len(passed),
            "fail": len(failed),
            "pass_rate": round(len(passed) / len(runs), 4) if runs else 0,
            "routing_success_rate": round(len([r for r in runs if r["route"]]) / len(runs), 4),
            "fallback_rate": round(len([r for r in runs if r["fallback"] is True]) / len(runs), 4),
            "retry_rate": round(len([r for r in runs if r["route"] == "RETRY"]) / len(runs), 4),
            "policy_block_count": len(policy_blocks),
            "context_reduction_ratio": round(statistics.mean(r["context_reduction_ratio"] for r in context_runs), 4) if context_runs else None,
            "browser_success_rate": round(
                len([r for r in runs if r["benchmark_id"] in {"BENCH-07", "BENCH-08"} and r["outcome"] == "PASS"])
                / max(1, len([r for r in runs if r["benchmark_id"] in {"BENCH-07", "BENCH-08"}])), 4),
            "task_completion_rate": round(len(passed) / len(runs), 4) if runs else 0,
            "provider_failure_rate": round(
                len([r for r in provider_runs if r["fallback"] is True]) / max(1, len(provider_runs)), 4),
            "latency_ms": {"p50": pct(0.5), "p95": pct(0.95), "min": latencies[0] if latencies else None,
                           "max": latencies[-1] if latencies else None},
            "per_case": {case_id: {"runs": len(items), "pass": len([i for i in items if i["outcome"] == "PASS"]),
                                   "p50_ms": statistics.median(i["latency_ms"] for i in items)}
                         for case_id, items in by_case.items()},
            "cost_per_task": "NOT_AVAILABLE",
            "limitations": [
                f"{len(runs)} samples total across {len(cases)} cases; p95 is indicative only at this sample size",
                "dbplant policy cases run on a short-lived isolated instance with a temporary route scope",
                "provider fallback case uses a deliberately broken endpoint on an isolated instance",
                "supervisor case runs at module level (no HTTP route in v0.6.0)",
            ],
        }
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "a") as fh:
            for run in runs:
                fh.write(json.dumps(run, ensure_ascii=False) + "\n")
        Path(args.summary).write_text(json.dumps(summary, indent=2, ensure_ascii=False))

        print("\n=== BENCHMARK SUMMARY ===")
        print(json.dumps({k: v for k, v in summary.items() if k != "per_case"}, indent=2))
        print(f"results_file={args.out}\nsummary_file={args.summary}")
    finally:
        # bounded cleanup: TERM, wait, then KILL so no temporary instance can linger
        for proc in procs:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except Exception:  # noqa: BLE001
                proc.terminate()
        for proc in procs:
            try:
                proc.wait(timeout=10)
            except Exception:  # noqa: BLE001
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except Exception:  # noqa: BLE001
                    proc.kill()
                try:
                    proc.wait(timeout=5)
                except Exception:  # noqa: BLE001
                    pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
