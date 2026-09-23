#!/usr/bin/env python3
"""Agent Core — add the public hostname to a REMOTE-MANAGED Cloudflare Tunnel.

Why this exists: on this host cloudflared runs with `--config /etc/cloudflared/config.yml`
*and* the tunnel has a remote configuration in the Cloudflare dashboard. The remote
configuration wins (verified 2026-09-23: the connector logged
`INF Updated to new configuration ... version=5` containing only hermes/handbook/catch-all),
so editing the local file has no effect on routing.

Requires a token with:  Account -> Cloudflare Tunnel -> Edit  (and Read)

Usage:
  python3 ops/cloudflare-tunnel-remote.py --plan    # show the exact ingress diff
  python3 ops/cloudflare-tunnel-remote.py --apply   # write it (backup saved first)
  python3 ops/cloudflare-tunnel-remote.py --verify  # read-only state dump
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "54b79895714df72e9b76b99452813c79")
TUNNEL_ID = "98cc1f81-c265-4c44-a61d-5271a2cad897"
HOSTNAME = "agent.raemanagemju.net"
ORIGIN = "http://127.0.0.1:8787"
TOKEN_FILE = os.path.expanduser("~/.config/agent-core/cloudflare.token")
BACKUP_DIR = os.path.expanduser("~/backups")
API = "https://api.cloudflare.com/client/v4"


def token() -> str:
    raw = os.environ.get("CF_API_TOKEN", "").strip()
    if raw:
        return raw
    if os.path.exists(TOKEN_FILE):
        return open(TOKEN_FILE).read().strip()
    sys.exit(f"FAIL: no token (set CF_API_TOKEN or create {TOKEN_FILE})")


def api(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
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
            return exc.code, {}


def show_ingress(ingress: list[dict]) -> None:
    for i, r in enumerate(ingress):
        print(f"  [{i}] hostname={r.get('hostname', '-')} path={r.get('path', '-')} "
              f"service={r.get('service')}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()
    if not any([args.plan, args.apply, args.verify]):
        args.plan = True

    path = f"/accounts/{ACCOUNT_ID}/cfd_tunnel/{TUNNEL_ID}/configurations"
    st, res = api("GET", path)
    if st != 200:
        print(f"GET remote tunnel configuration -> http={st}")
        errs = res.get("errors") or []
        print("  errors:", errs or res)
        print("\n  The token needs: Account -> Cloudflare Tunnel -> Edit/Read.")
        print("  Without it, add the public hostname in the dashboard instead:")
        print("    Zero Trust > Networks > Tunnels > 98cc1f81-... > Public Hostnames >")
        print(f"    Add: subdomain 'agent', domain raemanagemju.net, HTTP 127.0.0.1:8787")
        return

    result = res.get("result") or {}
    cfg = result.get("config") or {}
    ingress = cfg.get("ingress") or []
    print(f"remote configuration version={result.get('version')} source={result.get('source')}")
    print("current ingress:")
    show_ingress(ingress)

    if args.verify:
        hit = [r for r in ingress if str(r.get("hostname", "")).startswith("agent.")]
        print(f"\n{HOSTNAME} present: {bool(hit)} {hit}")
        return

    if any(str(r.get("hostname", "")) == HOSTNAME for r in ingress):
        print(f"\n{HOSTNAME} is already in the remote ingress — nothing to do")
        return

    new_ingress, inserted = [], False
    for r in ingress:
        if not inserted and r.get("service") == "http_status:404":
            new_ingress.append({"hostname": HOSTNAME, "service": ORIGIN})
            inserted = True
        new_ingress.append(r)
    if not inserted:
        new_ingress.append({"hostname": HOSTNAME, "service": ORIGIN})

    print("\nproposed ingress:")
    show_ingress(new_ingress)

    if args.plan:
        print("\n(dry run) re-run with --apply to write it")
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, f"tunnel-remote-config-{time.strftime('%Y%m%d_%H%M%S')}.json")
    with open(backup, "w") as fh:
        json.dump(result, fh, indent=2)
    print(f"\nbackup written: {backup}")

    payload = {"config": {**cfg, "ingress": new_ingress}}
    st, res = api("PUT", path, payload)
    print(f"PUT configuration -> http={st} success={res.get('success')}")
    if st != 200:
        print("  errors:", res.get("errors"))
        return

    st, res = api("GET", path)
    after = ((res.get("result") or {}).get("config") or {}).get("ingress") or []
    print(f"verified: version={(res.get('result') or {}).get('version')}")
    show_ingress(after)
    print("\nrollback: python3 ops/cloudflare-tunnel-remote.py --restore "
          f"{os.path.basename(backup)}  (or paste the backup JSON back via the dashboard)")


if __name__ == "__main__":
    main()
