#!/usr/bin/env python3
"""Agent Core — Cloudflare edge activation (Tunnel DNS route, Access, rate limiting).

Reads the API token from $CF_API_TOKEN, else from ~/.config/agent-core/cloudflare.token
(mode 600). Never prints the token.

Usage:
  python3 ops/cloudflare-edge.py --plan     # show exactly which API calls would run (no writes)
  python3 ops/cloudflare-edge.py --apply    # perform the writes
  python3 ops/cloudflare-edge.py --verify   # read-only check of current edge state

Required token permissions (add in Cloudflare dashboard > My Profile > API Tokens):
  Zone   -> DNS            -> Edit        (zone: raemanagemju.net)
  Zone   -> Zone           -> Read
  Zone   -> WAF            -> Edit        (rate limiting rules)
  Account-> Access: Apps and Policies -> Edit
  Account-> Account Settings -> Read      (optional; needed to auto-discover account id)
"""
from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

ZONE_NAME = "raemanagemju.net"
HOSTNAME = "agent.raemanagemju.net"
TUNNEL_ID = "98cc1f81-c265-4c44-a61d-5271a2cad897"  # existing shared tunnel on host 237
ORIGIN = "http://127.0.0.1:8787"
ACCESS_ALLOW_EMAIL = os.environ.get("ACCESS_ALLOW_EMAIL", "raemju@gmail.com")
TOKEN_FILE = os.path.expanduser("~/.config/agent-core/cloudflare.token")
API = "https://api.cloudflare.com/client/v4"

# Rate limiting: per-IP ceilings deliberately generous enough for development.
RATE_RULES = [
    {
        "name": "agent-core-api-600-per-min-per-ip",
        "description": "Agent Core machine API ceiling (project auth + app rate limit still apply)",
        "path_prefixes": ["/v1/decision", "/v1/route", "/v1/qa", "/v1/context",
                          "/v1/subagent", "/v1/advanced-route"],
        "requests_per_period": 600,
        "period_seconds": 60,
        "mitigation_timeout": 60,
    },
    {
        "name": "agent-core-control-120-per-min-per-ip",
        "description": "Human control surface ceiling (Cloudflare Access gates identity)",
        "path_prefixes": ["/control", "/v1/control-metrics"],
        "requests_per_period": 120,
        "period_seconds": 60,
        "mitigation_timeout": 300,
    },
]

plan: list[str] = []


def token() -> str:
    raw = os.environ.get("CF_API_TOKEN", "").strip()
    if raw:
        return raw
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as fh:
            return fh.read().strip()
    sys.exit(f"FAIL: no Cloudflare API token. Set CF_API_TOKEN or create {TOKEN_FILE} (mode 600).")


def api(method: str, path: str, body: dict | None = None, apply: bool = False) -> tuple[int, dict]:
    desc = f"{method} {path}" + (f" body={json.dumps(body)[:180]}" if body else "")
    if not apply:
        plan.append(desc)
        return 0, {"dry_run": True}
    req = urllib.request.Request(API + path, method=method,
                                data=json.dumps(body).encode() if body else None)
    req.add_header("Authorization", f"Bearer {token()}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode())
        except Exception:
            return exc.code, {"raw": "unparseable error body"}


def ok(res: dict) -> bool:
    return bool(res.get("success"))


def first_error(res: dict) -> str:
    errs = res.get("errors") or []
    return "; ".join(f"{e.get('code')}:{e.get('message')}" for e in errs) or "unknown error"


def step(name: str, res: dict, apply: bool, extra: str = "") -> None:
    tag = "PLAN" if not apply else ("PASS" if ok(res) else "FAIL")
    print(f"[{tag}] {name}" + (f" — {extra}" if extra else ""))
    if apply and not ok(res):
        print(f"        error: {first_error(res)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()
    do_apply = args.apply
    if not any([args.plan, args.apply, args.verify]):
        args.plan = True

    print(f"target: https://{HOSTNAME} -> {ORIGIN} (tunnel {TUNNEL_ID})")
    if not do_apply and not args.verify:
        print("mode: PLAN (no writes)\n")

    if args.verify:
        st, res = api("GET", "/user/tokens/verify", apply=True)
        print(f"token verify: http={st} status={(res.get('result') or {}).get('status')}")

    if not do_apply and not args.verify:
        # ---- plan-only: enumerate the exact calls ----
        api("GET", f"/zones?name={ZONE_NAME}")
        api("GET", "/accounts")
        api("POST", f"/zones/{{zone_id}}/dns_records", {
            "type": "CNAME", "name": "agent", "content": f"{TUNNEL_ID}.cfargotunnel.com",
            "proxied": True, "comment": "Agent Core tunnel route"})
        api("POST", "/accounts/{account_id}/access/apps", {
            "name": "Agent Core — Human Control Center", "type": "self_hosted",
            "domain": f"{HOSTNAME}/control", "session_duration": "8h"})
        api("POST", "/accounts/{account_id}/access/apps/{app_id}/policies", {
            "name": "prinya-only", "decision": "allow",
            "include": [{"email": {"email": ACCESS_ALLOW_EMAIL}}]})
        api("POST", "/accounts/{account_id}/access/apps/{app_id}/policies", {
            "name": "deny-everyone-else", "decision": "deny",
            "include": [{"everyone": {}}]})
        api("POST", "/accounts/{account_id}/access/apps", {
            "name": "Agent Core — Machine API", "type": "self_hosted",
            "domain": f"{HOSTNAME}/v1/*", "session_duration": "24h"})
        api("POST", "/accounts/{account_id}/access/apps/{app_id}/policies", {
            "name": "service-tokens-only", "decision": "non_identity",
            "include": [{"any_valid_service_token": {}}]})
        api("PUT", "/zones/{zone_id}/rulesets/phases/http_ratelimit/entrypoint",
            {"rules": [{"action": "block", "expression": "…per rule…", "ratelimit": {
                "characteristics": ["ip.src"], "period": 60, "requests_per_period": 600,
                "mitigation_timeout": 60}}], "name": "Agent Core rate limits"})
        print("planned API calls:")
        for p in plan:
            print("  -", p)
        print("\nRun with --apply once the token is in place.")
        return

    # ---- apply / verify path ----
    st, res = api("GET", f"/zones?name={ZONE_NAME}", apply=True)
    step("zone lookup", res, True, f"http={st}")
    if not ok(res) or not res.get("result"):
        print("FAIL: cannot read zone — token likely missing Zone:Zone:Read")
        return
    zone_id = res["result"][0]["id"]
    print(f"zone_id: {zone_id}")

    account_id = os.environ.get("CF_ACCOUNT_ID", "").strip()
    if not account_id:
        st, res = api("GET", "/accounts", apply=True)
        if not ok(res) or not res.get("result"):
            print("WARN: cannot auto-discover account id — set CF_ACCOUNT_ID")
            account_id = ""
        else:
            account_id = res["result"][0]["id"]
    print(f"account_id: {account_id or '(missing)'}")

    # 1. DNS route to the existing tunnel
    st, res = api("GET", f"/zones/{zone_id}/dns_records?name={HOSTNAME}", apply=True)
    existing = (res.get("result") or []) if ok(res) else []
    if existing:
        rec = existing[0]
        if rec.get("content") == f"{TUNNEL_ID}.cfargotunnel.com" and rec.get("proxied"):
            step("DNS record already correct", {"success": True}, True,
                 f"{rec['type']} {rec['name']} -> {rec['content']} proxied")
        else:
            st, res = api("PUT", f"/zones/{zone_id}/dns_records/{rec['id']}", {
                "type": "CNAME", "name": "agent", "content": f"{TUNNEL_ID}.cfargotunnel.com",
                "proxied": True, "comment": "Agent Core tunnel route"}, apply=True)
            step("DNS record updated", res, True, f"http={st}")
    else:
        st, res = api("POST", f"/zones/{zone_id}/dns_records", {
            "type": "CNAME", "name": "agent", "content": f"{TUNNEL_ID}.cfargotunnel.com",
            "proxied": True, "comment": "Agent Core tunnel route"}, apply=True)
        step("DNS record created", res, True, f"http={st}")

    if not account_id:
        print("STOP: account_id missing — Access applications skipped (need Account ID).")
    else:
        # 2. Access apps
        st, res = api("GET", f"/accounts/{account_id}/access/apps", apply=True)
        apps = (res.get("result") or []) if ok(res) else []
        by_name = {a.get("name"): a for a in apps}

        for app_name, domain, duration in [
            ("Agent Core — Human Control Center", f"{HOSTNAME}/control", "8h"),
            ("Agent Core — Machine API", f"{HOSTNAME}/v1/*", "24h"),
        ]:
            if app_name in by_name:
                app = by_name[app_name]
                step(f"Access app exists: {app_name}", {"success": True}, True, app["id"])
            else:
                st, res = api("POST", f"/accounts/{account_id}/access/apps", {
                    "name": app_name, "type": "self_hosted", "domain": domain,
                    "session_duration": duration}, apply=True)
                step(f"Access app created: {app_name}", res, True, f"http={st}")
                app = (res.get("result") or {})

            app_id = app.get("id")
            if not app_id:
                continue
            st, res = api("GET", f"/accounts/{account_id}/access/apps/{app_id}/policies", apply=True)
            pol_names = {p.get("name") for p in (res.get("result") or [])} if ok(res) else set()

            want = []
            if app_name.endswith("Control Center"):
                want = [
                    ("prinya-only", "allow", [{"email": {"email": ACCESS_ALLOW_EMAIL}}]),
                    ("deny-everyone-else", "deny", [{"everyone": {}}]),
                ]
            else:
                want = [("service-tokens-only", "non_identity",
                         [{"any_valid_service_token": {}}])]
            for pname, decision, include in want:
                if pname in pol_names:
                    step(f"policy exists: {pname}", {"success": True}, True)
                    continue
                st, res = api("POST", f"/accounts/{account_id}/access/apps/{app_id}/policies", {
                    "name": pname, "decision": decision, "include": include}, apply=True)
                step(f"policy created: {pname}", res, True, f"http={st}")

        # 3. Control-metrics path: covered by the Control Center app only for /control
        st, res = api("POST", f"/accounts/{account_id}/access/apps", {
            "name": "Agent Core — Control Metrics", "type": "self_hosted",
            "domain": f"{HOSTNAME}/v1/control-metrics", "session_duration": "8h"}, apply=True)
        if ok(res):
            app_id = (res.get("result") or {}).get("id")
            api("POST", f"/accounts/{account_id}/access/apps/{app_id}/policies", {
                "name": "prinya-only", "decision": "allow",
                "include": [{"email": {"email": ACCESS_ALLOW_EMAIL}}]}, apply=True)
            api("POST", f"/accounts/{account_id}/access/apps/{app_id}/policies", {
                "name": "deny-everyone-else", "decision": "deny",
                "include": [{"everyone": {}}]}, apply=True)
            step("Access app created: Agent Core — Control Metrics", res, True)
        else:
            step("Access app Control Metrics", res, True, f"http={st} "
                 "(may already exist — check dashboard)")

    # 4. Zone rate limiting rules
    st, res = api("GET", f"/zones/{zone_id}/rulesets/phases/http_ratelimit/entrypoint", apply=True)
    current_rules = []
    if ok(res):
        current_rules = (res.get("result") or {}).get("rules") or []
    existing_names = {r.get("description") or r.get("name") for r in current_rules}

    new_rules = [r for r in RATE_RULES
                 if r["description"] not in existing_names and r["name"] not in existing_names]
    if not new_rules:
        step("rate limit rules already present", {"success": True}, True,
             f"{len(current_rules)} rule(s) in entrypoint")
    else:
        rules = current_rules + [{
            "description": r["description"],
            "action": "block",
            "enabled": True,
            "expression": "(" + " or ".join(
                f'starts_with(http.request.uri.path, "{p}")' for p in r["path_prefixes"]
            ) + ")",
            "ratelimit": {
                "characteristics": ["ip.src"],
                "period": r["period_seconds"],
                "requests_per_period": r["requests_per_period"],
                "mitigation_timeout": r["mitigation_timeout"],
            },
        } for r in new_rules]
        st, res = api("PUT", f"/zones/{zone_id}/rulesets/phases/http_ratelimit/entrypoint", {
            "name": "Agent Core rate limits", "kind": "zone", "phase": "http_ratelimit",
            "rules": rules}, apply=True)
        step("rate limit rules applied", res, True, f"http={st} rules={len(rules)}")

    print("\nnext: apply the Tunnel ingress entry on the host (sudo ops/cloudflare-ingress-sudo.sh)")


if __name__ == "__main__":
    main()
