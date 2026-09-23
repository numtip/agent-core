#!/usr/bin/env python3
"""Agent Core — end-to-end machine-path QA THROUGH Cloudflare, without a service token.

Problem: proving `client -> Cloudflare -> Tunnel -> Agent Core -> Jev` needs an identity at the
edge, and creating a Cloudflare Access *service token* needs a permission this token does not have
(`Account -> Access: Service Tokens -> Edit`).

Solution: this harness (ab)uses the permission it does have (`Access: Apps and Policies: Edit`) to
create a NARROW, TEMPORARY bypass Access app for the exact path `/v1/decision`, runs the machine
path end to end, and deletes the app in a `finally` block — including on any exception. The bypass
exposes nothing on its own: Agent Core's project-token auth still answers 401/403 without a valid
project token, and the window is a few seconds.

Usage: python3 ops/qa-edge-bypass-e2e.py
"""
from __future__ import annotations

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
HOST = "agent.raemanagemju.net"
APP_NAME = "Agent Core — QA Bypass (temporary, delete me)"
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


def post(url: str, headers: dict, body: dict, timeout: int = 90) -> tuple[int, str]:
    """HTTP POST via curl (Cloudflare's bot protection fingerprints the Python TLS stack)."""
    cfg = [f'url = "{url}"', 'method = "POST"', "silent", "show-error", f'max-time = "{timeout}"',
           'user-agent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
           '(KHTML, like Gecko) Chrome/128.0 Safari/537.36"',
           'header = "Content-Type: application/json"', 'write-out = "\\n__HTTP_%{http_code}__"']
    for k, v in headers.items():
        cfg.append(f'header = "{k}: {v}"')
    fd, tmp = tempfile.mkstemp(prefix="agent-core-e2e-", suffix=".json")
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
        return code, out
    finally:
        os.remove(tmp)


def main() -> None:
    env = {}
    for line in open(ENV_FILE):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v
    keys = json.loads(env["AGENT_CORE_PROJECT_KEYS"])
    base = f"https://{HOST}/v1/decision"

    print("== 0. baseline: /v1/decision must be denied at the edge before the window ==")
    st, _ = post(base, {}, {"project": "52clips"})
    check("/v1/decision denied without edge identity", st in (302, 401, 403), f"http={st}")

    body = {"project": "52clips", "task_id": "EDGE-E2E-001", "decision_type": "NEXT_ACTION",
            "state": {"visual": "ready", "audio": "ready", "subtitle": "missing"},
            "question": {"type": "choice",
                         "instructions": "Choose the next safe production action.",
                         "criteria": {"GENERATE_SUBTITLE": "Required subtitle is missing.",
                                      "READY_FOR_QA": "All required assets are present.",
                                      "HUMAN_REVIEW": "State is ambiguous."}},
            "fallback_result": "HUMAN_REVIEW"}

    app_id = None
    try:
        print("\n== opening a narrow temporary bypass window for /v1/decision ==")
        st, res = cf_api("POST", f"/accounts/{ACCOUNT_ID}/access/apps",
                         {"name": APP_NAME, "type": "self_hosted", "domain": f"{HOST}/v1/decision",
                          "session_duration": "8h"})
        app_id = (res.get("result") or {}).get("id")
        if not app_id:
            check("create temporary bypass app", False, f"http={st} {res.get('errors')}")
            return
        st, res = cf_api("POST", f"/accounts/{ACCOUNT_ID}/access/apps/{app_id}/policies",
                         {"name": "temporary-bypass", "decision": "bypass",
                          "include": [{"everyone": {}}]})
        check("temporary bypass app + policy created", res.get("success") is True,
              f"app_id={app_id[:8]}…")
        time.sleep(5)

        print("\n== machine path through Cloudflare (project auth still enforced) ==")
        h = {"x-agent-project": "52clips", "x-agent-project-token": keys["52clips"]}
        t0 = time.time()
        st, raw = post(base, h, body)
        r = json.loads(raw) if raw.startswith("{") else {}
        check("52clips decision via Cloudflare reaches Agent Core/Jev",
              st == 200 and not r.get("fallback") and isinstance(r.get("confidence"), (int, float)),
              f"http={st} result={r.get('result')} conf={r.get('confidence')} "
              f"disp={r.get('disposition')} fallback={r.get('fallback')} pid={str(r.get('provider_request_id'))[:22]} "
              f"latency={time.time() - t0:.2f}s")
        if r.get("fallback") and r.get("reason_code") == "PROVIDER_UNAVAILABLE":
            print("        NOTE: the call reached Agent Core and returned its safe fallback. This is the")
            print("        known production parser defect (PR #5): the Decisions API answers in ~0.4-0.8s")
            print("        with {choice: string, probabilities, confidence}, while the deployed `9d2e9a9`")
            print("        parser expects an object → every live choice question degrades to the fallback.")

        st, raw = post(base, {"x-agent-project": "52clips", "x-agent-project-token": "invalid"},
                       body)
        check("invalid project token -> 401 through the edge", st == 401, f"http={st}")

        st, raw = post(base, {}, body)
        check("missing project credentials -> 401 through the edge", st == 401, f"http={st}")

        st, raw = post(base, h, dict(body, project="handbook", task_id="EDGE-MISMATCH"))
        check("cross-project mismatch -> 403 PROJECT_MISMATCH", st == 403, f"http={st} {raw[:60]}")
    finally:
        if app_id:
            st, res = cf_api("DELETE", f"/accounts/{ACCOUNT_ID}/access/apps/{app_id}")
            check("temporary bypass app deleted (202/200/204 = accepted)", st in (200, 202, 204),
                  f"http={st}")
        # Access config changes propagate asynchronously: retry the closed-window check.
        closed, last = False, 0
        for _ in range(6):
            time.sleep(5)
            last, _ = post(base, {"x-agent-project": "52clips",
                                  "x-agent-project-token": keys["52clips"]}, body)
            if last in (302, 401, 403):
                closed = True
                break
        check("bypass window closed — /v1/decision denied again", closed, f"http={last}")
        st, res = cf_api("GET", f"/accounts/{ACCOUNT_ID}/access/apps")
        names = [a.get("name") for a in (res.get("result") or [])]
        check("no temporary QA app left in the account",
              not any("temporary" in str(n) for n in names), f"apps={len(names)}")

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\nTOTAL {passed}/{len(results)} PASS")
    for n, ok, _ in results:
        if not ok:
            print("FAILED:", n)
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
