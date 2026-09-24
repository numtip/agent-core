# Agent Core v2 — V2-8 Benchmark Report

Host `10.1.254.237` · runtime `0.6.0` · source `fca4f8f48660af9965c938cc3c0955cdf4d3aef7` (merged `main`)
Deployed release `~/agent-core/releases/fca4f8f` · executed 2026-09-25 02:26 (+07)
Harness: `ops/v2-benchmark.py --reps 3` · Raw: `docs/evidence/v2-8/v2-benchmark.jsonl`,
`docs/evidence/v2-8/v2-benchmark-summary.json`

---

## 1. Environment

- Production loopback origin `127.0.0.1:8787` (release deployed from merged `main`).
- Four short-lived isolated instances: `8799` (dbplant policy path with a temporary `route` scope),
  `8800` (broken provider endpoint), `8801` (kill switch off), `8802` (MCP endpoint unreachable).
  All were terminated after the run (`leftover_listeners: none`); cleanup escalates TERM → KILL.
- Real project identities and the real OpenRouter/Jev credential were used; no credential value is
  present in the recorded data.

## 2. Sample count

18 cases × 3 repetitions = **54 samples**, all executed. Unavailable values are `null` or
`NOT_AVAILABLE` — no field is invented.

## 3. Results

| ID | Case | Project | Operation | Observed | p50 (ms) | Runs |
|---|---|---|---|---|---|---|
| BENCH-01 | deterministic validation | goffice2026 | READ | `deterministic.runtime` | 2.7 | 3/3 PASS |
| BENCH-02 | complex reasoning | goffice2026 | READ | `model.frontier` | 1.7 | 3/3 PASS |
| BENCH-03 | coding route | goffice2026 | READ | `model.frontier` | 1.8 | 3/3 PASS |
| BENCH-04 | VPS/operations route | goffice2026 | READ | `agent.hermes` | 2.2 | 3/3 PASS |
| BENCH-05 | context-heavy governance | goffice2026 | READ | receipt, reduction 0.51 | 4.3 | 3/3 PASS |
| BENCH-06 | gateway handoff | handbook | READ | `HANDOFF` (executed false) | 1.8 | 3/3 PASS |
| BENCH-07 | browser read plan | handbook | READ | `READY` + receipt | 1.6 | 3/3 PASS |
| BENCH-08 | browser navigate plan | handbook | READ | `READY` | 1.7 | 3/3 PASS |
| BENCH-09 | blocked production write | goffice2026 | WRITE | `APPROVAL_REQUIRED` | 1.7 | 3/3 PASS |
| BENCH-10 | blocked destructive action | goffice2026 | DESTRUCTIVE | `APPROVAL_REQUIRED` | 1.8 | 3/3 PASS |
| BENCH-11 | supervisor retry | goffice2026 | READ | `RETRY` (module level) | 5.0 | 3/3 PASS |
| BENCH-12 | QA verification decision | goffice2026 | READ | live Jev `REVIEW`/`EXECUTE`/`FALLBACK` | 324.0 | 3/3 PASS |
| BENCH-13 | dbplant write protection | dbplant | WRITE | `APPROVAL_REQUIRED DBPLANT_READ_ONLY_DEFAULT` | 3.4 | 3/3 PASS |
| BENCH-14 | auth scope mismatch | 52clips | READ | `403 PROJECT_MISMATCH` | 2.0 | 3/3 PASS |
| BENCH-15 | provider fallback | goffice2026 | READ | 200 `FALLBACK (fallback=true)` | 4.1 | 3/3 PASS |
| **BENCH-16** | **live browser execution (MCP)** | handbook | READ | `EXECUTED executed=true` + MCP session | **946.0** | 3/3 PASS |
| **BENCH-17** | **kill switch off** | handbook | READ | `READY executed=false / MCP_EXECUTION_DISABLED` | 3.4 | 3/3 PASS |
| **BENCH-18** | **MCP runtime down** | handbook | READ | `503 MCP_UNAVAILABLE executed=false` | 5.9 | 3/3 PASS |

## 4. Summary metrics (measured)

| Metric | Value |
|---|---|
| Cases / samples | 18 / 54 |
| Pass / fail | **54 / 0** |
| Pass rate (task completion) | 1.00 |
| Routing success rate (cases carrying a route/decision field) | 0.833 |
| Fallback rate | 0.0556 |
| Retry rate | 0.0556 |
| Policy block count (prod write / destructive / dbplant) | 9 |
| Context reduction ratio (BENCH-05) | 0.5105 |
| Browser success rate (planning cases BENCH-07/08) | 1.00 |
| Provider failure rate (BENCH-15, deliberate) | 1.00 |
| Latency p50 | **2.2 ms** |
| Latency p95 | **716.4 ms** |
| Latency min / max | 1.1 ms / 980.0 ms |
| Cost per task | `NOT_AVAILABLE` |

## 5. Interpretation

- Local control-plane work (auth, routing, policy, governance, contracts) stays at **~1.6–5 ms p50**.
- Two provider-bound cases dominate the tail: BENCH-12 (live Jev, ~324 ms p50) and BENCH-16
  (live browser execution through MCP: navigate + snapshot, ~946 ms p50). p95 (716 ms) is a blend of
  those two; it describes external latency, not internal overhead.
- The browser execution path adds no measurable overhead of its own: the deny/approval cases
  (localhost, integer IP, injection, submit, destructive) return their dispositions in ~1.5–5 ms
  because the transport is never invoked, and the kill-switch/MCP-down cases answer in 3–6 ms with an
  explicit contract.
- `routing success rate` 0.833 is a coverage indicator (the auth-mismatch, context-governor,
  supervisor-module and 403 cases legitimately carry no route field); no case failed.
- The 0.0556 fallback and retry rates come from exactly one deliberate case each.

## 6. Cost

`COST_PER_TASK=NOT_AVAILABLE` — the runtime does not aggregate provider usage per task. Observed
provider metadata for single decision calls: 3.9e-05 – 8.7e-05 USD per call in the Jev decision log;
recorded as data points, not as a per-task estimate.

## 7. Limitations

1. 54 samples across 18 cases: p50/p95 are indicative, not statistically strong.
2. dbplant, provider-failure, kill-switch and MCP-down cases run on short-lived isolated instances
   (production identity deliberately cannot reach the gateway for dbplant).
3. The supervisor case runs at module level — v0.6.0 has no supervisor HTTP route.
4. Browser execution is measured against a single lightweight page (`example.com`); heavier pages
   would increase BENCH-16 latency.
5. No load or concurrency testing in this suite (the edge burst test lives in `ops/v2-edge-qa.py`).
6. Cost per task is not measurable with the current wiring.
