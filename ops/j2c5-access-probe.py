#!/usr/bin/env python3
"""J2-C5 read-only Cloudflare Access readiness probe. Prints NO secret values."""
import json
import os
import urllib.error
import urllib.request


def _required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"REFUSING: set {name} (not stored in Git)")
    return value

TOKEN_FILE = os.path.expanduser("~/.config/agent-core/cloudflare.token")
CF = os.environ.get("CF_API_BASE", "https://api.cloudflare.com/client/v4")
ACC = _required_env("CF_ACCOUNT_ID")

tok = open(TOKEN_FILE).read().strip()
print(f"cf token file: mode={oct(os.stat(TOKEN_FILE).st_mode)[-3:]} size={os.path.getsize(TOKEN_FILE)}")


def api(path, method="GET"):
    req = urllib.request.Request(CF + path, method=method)
    req.add_header("authorization", f"Bearer {tok}")
    req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}
    except Exception as e:  # noqa
        return 0, {"error": f"{type(e).__name__}: {e}"}


def brief(body):
    if isinstance(body, dict) and body.get("errors"):
        return f"errors={json.dumps(body['errors'])[:160]}"
    return "ok"


s, b = api("/user/tokens/verify")
print(f"\n[1] token verify: HTTP {s} {brief(b)}")

s, b = api(f"/accounts/{ACC}/access/apps")
apps = b.get("result", []) if s == 200 else []
print(f"\n[2] access apps: HTTP {s} count={len(apps)}")
for a in sorted(apps, key=lambda x: x.get("domain", "")):
    dom = a.get("domain", "")
    paths = a.get("self_hosted_domains", a.get("domain", ""))
    print(f"  - {a.get('name') or '-':38s} id={a.get('id')} domain={dom} session={a.get('session_duration')}")

MACHINE = _required_env("CF_MACHINE_APP_ID")
s, b = api(f"/accounts/{ACC}/access/apps/{MACHINE}/policies")
pols = b.get("result", []) if s == 200 else []
print(f"\n[3] MACHINE API policies: HTTP {s} count={len(pols)}")
for p in pols:
    print(f"  - name={p.get('name')!r} id={p.get('id')} decision={p.get('decision')} "
          f"precedence={p.get('precedence')} include={json.dumps(p.get('include'))} "
          f"exclude={json.dumps(p.get('exclude'))} require={json.dumps(p.get('require'))}")

s_tokens, b = api(f"/accounts/{ACC}/access/service_tokens")
toks = b.get("result", []) if s_tokens == 200 else []
print(f"\n[4] service tokens: HTTP {s_tokens} count={len(toks) if s_tokens == 200 else 'n/a'} {brief(b)}")
for t in toks:
    print(f"  - name={t.get('name')} id={t.get('id')} expires={t.get('expires_at')}")

s, b = api(f"/accounts/{ACC}/access/service_tokens/00000000-0000-0000-0000-000000000000")
print(f"\n[5] permission probe (read one token by uuid): HTTP {s} {brief(b)}")

# compatibility: who could depend on the broad selector today?
if s_tokens != 200:
    print(f"\n[6] COMPAT: UNKNOWN — service-token inventory unavailable (HTTP {s_tokens}); "
          "cannot conclude who the broad selector admits")
else:
    print(f"\n[6] COMPAT: service tokens that exist = {len(toks)} "
          f"=> broad selector 'any_valid_service_token' currently admits "
          f"{'NOBODY' if not toks else f'{len(toks)} token(s)'}")

# live edge behaviour
def live(method, url, headers=None):
    req = urllib.request.Request(url, method=method)
    # Cloudflare returns error 1010 to clients with no/odd User-Agent; use a normal one.
    req.add_header("user-agent", "Mozilla/5.0 (X11; Linux x86_64)")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read(200).decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(200).decode(errors="replace")
    except Exception as e:  # noqa
        return 0, f"{type(e).__name__}"


print("\n[7] live edge probes (via public hostname from 237)")
EDGE = os.environ.get("AGENT_CORE_EDGE_BASE", "https://agent.raemanagemju.net")
for name, m, u in [("/v1/health", "GET", f"{EDGE}/v1/health"),
                   ("/v1/decision unauth", "POST", f"{EDGE}/v1/decision"),
                   ("/control unauth", "GET", f"{EDGE}/control")]:
    s, body = live(m, u)
    kind = "ACCESS" if "Cloudflare Access" in body else ("APP" if body.strip().startswith("{") else "?")
    print(f"  {name:22s} HTTP {s} layer={kind} body[:80]={body[:80]!r}")
