# Platform Status

## Code implementation

| Phase | Status | Notes |
|---|---|---|
| 0 Architecture Foundation | COMPLETE | Blueprint, architecture, security, API foundation |
| 1 Jev Decision Core | COMPLETE | Jev Decisions API adapter, confidence/fallback, tests |
| 2 VPS + Cloudflare package | CODE COMPLETE | Docker/systemd/Tunnel templates, auth, rate limit; live activation requires infrastructure credentials |
| 3 52Clips Pilot | READY TO ACTIVATE | Adapter and platform decision types ready; live project connection requires project runtime access |
| 4 Shared Client | COMPLETE | CLI health/doctor/decision/route/qa |
| 5 Existing Project Adapters | COMPLETE | 52Clips, attendance, handbook, goffice2026, dbplant profiles |
| 6 Context Intelligence | COMPLETE v1 | Deterministic bounded candidate ranking; avoids whole-repo default |
| 7 Advanced Routing | COMPLETE v1 | sensitivity/cost routing, hard-policy gate, subagent dedupe |
| 8 Control Center | COMPLETE v1 | private API-backed control-center surface |

## External activation state

Production activation is intentionally **not claimed** until both are available to the execution environment:

- authorized VPS access
- authorized Cloudflare account/Tunnel configuration

No repository code or CI result can substitute for that live infrastructure verification.

## VPS activation progress — 2026-09-23

See [PRODUCTION_ACTIVATION_REPORT.md](PRODUCTION_ACTIVATION_REPORT.md) for full evidence.

| Layer | State |
|---|---|
| Code gates on `main` @ `9d2e9a9` (install, audit, 20 tests, build) | PASS |
| Runtime on VPS `ubantu24` (10.1.254.237) | ACTIVE — systemd user unit `agent-core.service`, `127.0.0.1:8787` only |
| Local production QA (`ops/qa-local.py`) | PASS — 20/20 (health, 401, 403 scope/project, fallback, 503, 429, audit, control surface) |
| Project identities (5) | PROVISIONED host-side, secrets never in Git |
| OpenRouter/Jev live decisions | **LIVE IN PRODUCTION** — parser fix promoted (release `188de03`, PR #5 merged), live QA 13/13: choice `GENERATE_SUBTITLE` conf 0.99, noul conf 0.98, score label conf 0.98, latency 0.56–0.95 s |
| Cloudflare Tunnel / DNS / Access / WAF | **LIVE** — public hostname routed, 4 Access apps, 1 zone rate-limit rule; edge QA: health 200, `/control` 302, unauthenticated 403, burst → 429, machine path 9/9 PASS |
| 52Clips pilot connectivity | **PROVEN through the edge** — a real `52clips` decision returned `GENERATE_SUBTITLE` conf 0.97 through Cloudflare; a permanent Cloudflare service token for the pilot is not minted yet (needs `Account → Access: Service Tokens → Edit`, or creation in the dashboard) |

Release history: `188de03` (current, includes the response-shape fix) ← `9d2e9a9` (previous, kept for
rollback: `ln -sfn releases/9d2e9a9 ~/agent-core/current && systemctl --user restart agent-core.service`).

Runtime note: the tunnel on this host is **remote-managed** — `/etc/cloudflared/config.yml` is used
for credentials only, and the dashboard's public-hostname list decides routing (see report §7.1).

Runtime method currently deviates from `deploy/README.md` (user-space instead of
`/opt/agent-core` + `/etc/agent-core`) because `sudo` on this host requires an interactive
password. Migration is a documented follow-up step, not a completed one.
