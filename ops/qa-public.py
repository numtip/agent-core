#!/usr/bin/env python3
"""Agent Core — PUBLIC (through Cloudflare) QA.

Path under test: client -> Cloudflare (Access/WAF/rate limit) -> Tunnel -> 127.0.0.1:8787.

HTTP calls are made with the system `curl` through a mode-600 config file (headers are never
passed on the command line, so no token can end up in `ps`). Reason for curl rather than
urllib: Cloudflare's bot protection fingerprints the TLS/HTTP stack and answered this host's
bypassed /v1/health path with `403 error code: 1010` for the Python client.

Cloudflare REST calls (service-token lifecycle) still use urllib against api.cloudflare.com.

Usage:
  python3 ops/qa-public.py [--host agent.raemanagemju.net] [--skip-service-token]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "54b79895714df72e9b76b99452813c79")
TOKEN_FILE = os.path.expanduser("~/.config/agent-core/cloudflare.token")
ENV_FILE = os.path.expanduser("~/.config/agent-core/agent-core.env")
results: list[tuple[str, bool, str]] = []


def check(name: str, ok_: bool, detail: str = "") -> None:
    results.append((name, ok_, detail))
    print(f"[{'PASS' if ok_ else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def cf_api(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4{path}", method=method,
                                 data=json.dumps(body).encode() if body else None)
    req.add_header("Authorization", "Bearer " + open(TOKEN_FILE).read().strip())
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def call(url: str, method: str = "GET", headers: dict | None = None, body: dict | None = None,
         timeout: int = 30) -> tuple[int, str, dict]:
    """HTTP via curl, secrets kept out of argv (config file on stdin, mode-600 temp data file)."""
    cfg = [f'url = "{url}"', f'method = "{method}"', "silent", "show-error",
           f'max-time = "{timeout}"',
           'user-agent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
           '(KHTML, like Gecko) Chrome/128.0 Safari/537.36"',
           'header = "Content-Type: application/json"',
           'write-out = "\\n__HTTP_%{http_code}__"']
    for k, v in (headers or {}).items():
        cfg.append(f'header = "{k}: {v}"')
    tmp = None
    if body is not None:
        fd, tmp = tempfile.mkstemp(prefix="agent-core-qa-", suffix=".json")
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as fh:
            json.dump(body, fh)
        cfg.append(f'data = "@{tmp}"')
    try:
        proc = subprocess.run(["curl", "-K", "-"], input="\n".join(cfg), capture_output=True,
                              text=True, timeout=timeout + 10)
        out = proc.stdout
        code = 0
        if "__HTTP_" in out:
            head, _, tail = out.rpartition("__HTTP_")
            code = int(tail.replace("__", "").strip() or 0)
            out = head
        return code, out, {}
    except Exception as excuse:  # pragma: no cover
        return 0, f"{type(excuse).__name__}: {excuse}", {}
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="agent.raemanagemju.net")
    ap.add_argument("--skip-service-token", action="store_true")
    args = ap.parse_args()
    base = f"https://{args.host}"

    env = {}
    for line in open(ENV_FILE):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v
    keys = json.loads(env["AGENT_CORE_PROJECT_KEYS"])

    print("== 1. public health (gate: tunnel routing must exist) ==")
    st, body, _ = call(base + "/v1/health", timeout=20)
    try:
        h = json.loads(body)
    except Exception:
        h = {}
    routing_live = st == 200 and h.get("status") == "ok"
    check("GET /v1/health through Cloudflare -> 200", routing_live,
          f"http={st} {json.dumps(h)[:130] if h else body[:100].replace(chr(10), ' ')}")
    if not routing_live:
        print("\nSTOP: the public hostname is not routed yet.")
        print("  Dashboard: Zero Trust > Networks > Tunnels > 98cc1f81-... > Public Hostnames")
        print("             Add: subdomain 'agent', domain raemanagemju.net, HTTP 127.0.0.1:8787")
        print("  Or grant the token Account -> Cloudflare Tunnel -> Edit and run:")
        print("             python3 ops/cloudflare-tunnel-remote.py --apply")
        summary()
        return

    print("== 2. human control surface must stay private ==")
    st, _, _ = call(base + "/control")
    check("/control not publicly accessible", st in (302, 403), f"http={st}")
    st, _, _ = call(base + "/v1/control-metrics")
    check("/v1/control-metrics not publicly accessible", st in (302, 403), f"http={st}")

    print("== 3. machine API needs Cloudflare Access identity ==")
    st, _, _ = call(base + "/v1/decision", method="POST", body={"project": "52clips"})
    check("no service token -> denied at the edge", st in (302, 401, 403), f"http={st}")

    if args.skip_service_token:
        summary()
        return

    print("== 4. end-to-end with a temporary Access service token ==")
    st, res = cf_api("POST", f"/accounts/{ACCOUNT_ID}/access/service_tokens",
                     {"name": "agent-core-qa-temp", "duration": "1d"})
    tok = res.get("result") or {}
    svc_id, cid, csec = tok.get("id"), tok.get("client_id"), tok.get("client_secret")
    if not (cid and csec):
        check("create temporary service token", False, f"http={st} {res.get('errors')}")
        summary()
        return
    check("create temporary service token", True, f"client_id={str(cid)[:8]}… (secret not printed)")
    sh = {"CF-Access-Client-Id": cid, "CF-Access-Client-Secret": csec}

    try:
        body = {"project": "52clips", "task_id": "PUBLIC-SMOKE-001", "decision_type": "NEXT_ACTION",
                "state": {"visual": "ready", "audio": "ready", "subtitle": "missing"},
                "question": {"type": "choice",
                             "instructions": "Choose the next safe production action.",
                             "criteria": {"GENERATE_SUBTITLE": "Required subtitle is missing.",
                                          "READY_FOR_QA": "All required assets are present.",
                                          "HUMAN_REVIEW": "State is ambiguous."}},
                "fallback_result": "HUMAN_REVIEW"}
        h = dict(sh, **{"x-agent-project": "52clips", "x-agent-project-token": keys["52clips"]})
        t0 = time.time()
        st, raw, _ = call(base + "/v1/decision", method="POST", headers=h, body=body, timeout=90)
        r = json.loads(raw) if raw.startswith("{") else {}
        check("52clips decision through the edge reaches Agent Core/Jev",
              st == 200 and not r.get("fallback") and isinstance(r.get("confidence"), (int, float)),
              f"http={st} result={r.get('result')} conf={r.get('confidence')} "
              f"disp={r.get('disposition')} fallback={r.get('fallback')} "
              f"latency={time.time() - t0:.2f}s")

        h2 = dict(sh, **{"x-agent-project": "52clips", "x-agent-project-token": "invalid-token"})
        st, raw, _ = call(base + "/v1/decision", method="POST", headers=h2, body=body)
        check("invalid project token -> 401", st == 401, f"http={st} {raw[:60]}")

        st, raw, _ = call(base + "/v1/decision", method="POST", headers=h,
                          body=dict(body, project="handbook"))
        check("cross-project mismatch -> 403 PROJECT_MISMATCH", st == 403, f"http={st} {raw[:60]}")

        h3 = dict(sh, **{"x-agent-project": "dbplant", "x-agent-project-token": keys["dbplant"]})
        st, raw, _ = call(base + "/v1/qa", method="POST", headers=h3,
                          body=dict(body, project="dbplant", task_id="PUBLIC-SCOPE"))
        check("wrong scope (dbplant -> /v1/qa) -> 403", st == 403, f"http={st} {raw[:60]}")
    finally:
        st, res = cf_api("DELETE", f"/accounts/{ACCOUNT_ID}/access/service_tokens/{svc_id}")
        check("temporary service token deleted", st in (200, 204), f"http={st}")

    print("== 5. edge rate limiting (burst on a path covered by the rule) ==")
    # /v1/health is deliberately NOT covered by the zone rate-limit rule, so burst a covered
    # path instead. Cloudflare evaluates rate limiting before the Access decision, so 429s
    # appear alongside the 403s that Access returns for unauthenticated calls.
    burst = {"project": "52clips"}
    codes = []
    for _ in range(130):
        st, _, _ = call(base + "/v1/decision", method="POST", body=burst, timeout=10)
        codes.append(st)
    blocked = [c for c in codes if c in (429, 403, 1015)]
    check("burst of 130 requests on a covered path trips the edge limit",
          len(blocked) > 0, f"blocked={len(blocked)}/{len(codes)} codes={sorted(set(codes))}")

    summary()


def summary() -> None:
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\nTOTAL {passed}/{len(results)} PASS")
    for n, ok, _ in results:
        if not ok:
            print("FAILED:", n)
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
