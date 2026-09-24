#!/usr/bin/env python3
"""Agent Core v2 - Cloudflare edge QA for the /v2/* rate-limit coverage change.

Checks, against the public hostname (through Cloudflare, never the origin directly):
  1. normal authenticated machine traffic still works
  2. unauthenticated traffic still gets the application 401 (edge does not mask it)
  3. a burst above 100 req / 10 s per IP on /v2/* is blocked at the edge (429)
  4. traffic recovers after the mitigation window
  5. /v1/* and /control keep their previous edge behaviour

Edge blocks and application rate limits are distinguished by response body:
the edge returns a Cloudflare block (error code 1015 / HTML challenge) while the
application returns JSON {"error":"RATE_LIMITED"}.

Usage: python3 ops/v2-edge-qa.py [--host agent.raemanagemju.net] [--out ~/agent-core/logs/v2-edge-qa.jsonl]
"""
from __future__ import annotations

import argparse
import json
import os
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ENV_FILE = Path(os.path.expanduser("~/.config/agent-core/agent-core.env"))
RESULTS: list[dict] = []


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_FILE.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    return env


ENV = load_env()
KEYS: dict[str, str] = json.loads(ENV.get("AGENT_CORE_PROJECT_KEYS", "{}"))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Cloudflare Access answers with 302; the harness must observe the redirect itself."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, D102
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def call(host: str, path: str, body=None, project: str | None = None, timeout: float = 25.0) -> tuple[int, str, float, dict]:
    url = f"https://{host}{path}"
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 method="POST" if body is not None else "GET")
    req.add_header("content-type", "application/json")
    req.add_header("user-agent", "AgentCore-EdgeQA/1.0")
    if project:
        req.add_header("x-agent-project", project)
        req.add_header("x-agent-project-token", KEYS[project])
    started = time.time()
    try:
        with OPENER.open(req, timeout=timeout) as resp:
            raw, status, headers = resp.read().decode("utf-8", "replace"), resp.status, dict(resp.headers)
    except urllib.error.HTTPError as exc:
        raw, status, headers = exc.read().decode("utf-8", "replace"), exc.code, dict(exc.headers)
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc), (time.time() - started) * 1000, {}
    return status, raw, (time.time() - started) * 1000, headers


def classify(status: int, raw: str, headers: dict) -> str:
    if status == 429:
        if "RATE_LIMITED" in raw:
            return "APPLICATION_429"
        return "EDGE_429"
    if status == 0:
        return "TRANSPORT_ERROR"
    if status == 200:
        return "OK"
    if status in (401, 403):
        return f"HTTP_{status}"
    if "cloudflare" in raw.lower() or "cf-mitigated" in {k.lower() for k in headers}:
        return "EDGE_BLOCK"
    return f"HTTP_{status}"


def record(case: str, expected: str, observed: str, status: str, evidence: dict) -> None:
    entry = {"case": case, "phase": "O2", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
             "expected": expected, "observed": observed, "status": status, "evidence": evidence}
    RESULTS.append(entry)
    print(f"[{status:5}] {case:34} {observed}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="agent.raemanagemju.net")
    parser.add_argument("--out", default=os.path.expanduser("~/agent-core/logs/v2-edge-qa.jsonl"))
    parser.add_argument("--burst", type=int, default=160)
    parser.add_argument("--workers", type=int, default=24)
    args = parser.parse_args()
    host = args.host

    # 1. normal authenticated machine traffic
    status, raw, latency, headers = call(host, "/v2/route", {"project": "goffice2026", "task": "validate checksums",
                                                             "complexity": "deterministic"}, "goffice2026")
    cls = classify(status, raw, headers)
    record("O2-1-normal-auth-traffic", "200 OK through the edge", f"{status} {cls} ({latency:.0f} ms)",
           "PASS" if cls == "OK" else "FAIL",
           {"status": status, "classification": cls, "latency_ms": round(latency, 1), "cf_ray": headers.get("cf-ray")})

    # 2. unauthenticated traffic is still rejected by the application (not masked by the edge)
    status, raw, latency, headers = call(host, "/v2/route", {"project": "goffice2026", "task": "x"})
    cls = classify(status, raw, headers)
    record("O2-2-unauth-still-401", "401 UNAUTHORIZED from the application", f"{status} {cls}",
           "PASS" if cls == "HTTP_401" else "FAIL", {"status": status, "classification": cls, "body": raw[:120]})

    # 3. pre-burst baseline on the v2 surface + legacy surfaces
    status_v1, _, _, _ = call(host, "/v1/health")
    record("O2-3-v1-health-unaffected", "200 (health is not inside the rule)",
           f"{status_v1}", "PASS" if status_v1 == 200 else "FAIL", {"status": status_v1})

    # 4. burst above the per-IP threshold on /v2/* (concurrent, so the 10 s window is actually exceeded)
    projects = ["goffice2026", "handbook", "52clips", "attendance-report-generator"]
    collected: list[tuple[int, str, dict]] = []
    lock = threading.Lock()
    started = time.time()

    def worker(index: int) -> None:
        project = projects[index % len(projects)]
        body = {"project": project, "task": f"edge burst probe {index}"}
        status, raw, _latency, headers = call(host, "/v2/route", body, project, timeout=15)
        with lock:
            collected.append((status, raw, headers))

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(worker, range(args.burst)))
    elapsed = time.time() - started

    codes: dict[str, int] = {}
    first_edge_block = None
    ordered: list[int] = []
    for idx, (status, raw, headers) in enumerate(collected):
        cls = classify(status, raw, headers)
        codes[cls] = codes.get(cls, 0) + 1
        if cls == "EDGE_429":
            ordered.append(idx)
    edge_blocks = codes.get("EDGE_429", 0)
    first_edge_block = (min(ordered) + 1) if ordered else None
    app_limits = codes.get("APPLICATION_429", 0)
    record("O2-4-burst-blocked-at-edge", "edge 429 above 100 requests / 10 s per IP",
           f"edge_429={edge_blocks} app_429={app_limits} requests={args.burst} "
           f"workers={args.workers} elapsed={elapsed:.1f}s codes={codes}",
           "PASS" if edge_blocks > 0 else "FAIL",
           {"edge_429": edge_blocks, "application_429": app_limits, "burst_requests": args.burst,
            "workers": args.workers, "elapsed_s": round(elapsed, 2), "classifications": codes,
            "first_edge_block_index": first_edge_block})

    # 5. recovery after the mitigation window (10 s)
    print("... waiting 15 s for the edge mitigation window to expire")
    time.sleep(15)
    status, raw, latency, headers = call(host, "/v2/route", {"project": "goffice2026", "task": "post-window probe"},
                                         "goffice2026")
    cls = classify(status, raw, headers)
    record("O2-5-recovery-after-window", "200 OK after the mitigation window", f"{status} {cls} ({latency:.0f} ms)",
           "PASS" if cls == "OK" else "FAIL", {"status": status, "classification": cls})

    # 6. legacy surfaces unchanged
    status_control, raw_control, _, headers_control = call(host, "/control")
    record("O2-6-control-still-access-protected", "302 to Cloudflare Access",
           f"{status_control} location={headers_control.get('location', '')[:60]}",
           "PASS" if status_control == 302 else "FAIL", {"status": status_control,
                                                         "location": headers_control.get("location", "")[:120]})
    status_v1b, raw_v1b, latency_v1b, headers_v1b = call(host, "/v1/route",
                                                          {"project": "goffice2026", "task": "legacy v1 probe",
                                                           "decision_type": "TASK_ROUTE", "state": {"x": 1},
                                                           "question": {"type": "noul", "instructions": "ok?",
                                                                        "true_when": "yes", "false_when": "no"},
                                                           "fallback_result": "REVIEW"}, "goffice2026", timeout=40)
    cls_v1 = classify(status_v1b, raw_v1b, headers_v1b)
    # /v1/* sits behind the Cloudflare Access "Machine API" application, which requires an
    # Access service token (non_identity policy) in addition to the project token. That is the
    # pre-existing behaviour and must stay unchanged by this change set.
    record("O2-7-v1-still-access-protected", "403 without a Cloudflare Access service token (Access unchanged)",
           f"{status_v1b} {cls_v1}", "PASS" if status_v1b == 403 else "FAIL",
           {"status": status_v1b, "classification": cls_v1, "cf_ray": headers_v1b.get("cf-ray")})

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a") as fh:
        for entry in RESULTS:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    failed = [r["case"] for r in RESULTS if r["status"] == "FAIL"]
    print(f"\nedge_cases={len(RESULTS)} pass={len(RESULTS)-len(failed)} fail={len(failed)}")
    if failed:
        print("FAILED:", ", ".join(failed))
    print(f"results_file={out}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
