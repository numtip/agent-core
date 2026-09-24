# Agent Core v2 — V2-8 Benchmark Report

Host `10.1.254.237` · runtime `0.6.0` · source `bf0803000ff7f2d3254cc8dbbf6ebc5aabd0980a`
Deployed release `~/agent-core/releases/bf08030-h1` · executed 2026-09-25 02:03–02:04 (+07)
Harness: `ops/v2-benchmark.py --reps 3` · Raw: `docs/evidence/v2-8/benchmark-results.jsonl`,
`docs/evidence/v2-8/benchmark-summary.json`

---

## 1. Environment

- Loopback origin `127.0.0.1:8787` (production service), plus two short-lived isolated instances:
  `8799` (dbplant policy path with a temporary `route` scope) and `8800` (deliberately broken
  provider endpoint). Both were terminated after the run (`leftover_listeners: none`).
- Real project identities and the real OpenRouter/Jev credential were used; no credential value is
  present in the recorded data.

## 2. Sample count

15 cases × 3 repetitions = **45 samples**, all executed (no skipped or fabricated fields;
unavailable values are `null` or `NOT_AVAILABLE`).

## 3. Results

| ID | Case | Project | Operation | Observed route / outcome | p50 (ms) | Runs |
|---|---|---|---|---|---|---|
| BENCH-01 | deterministic validation | goffice2026 | READ | `deterministic.runtime` | 2.5 | 3/3 PASS |
| BENCH-02 | complex reasoning | goffice2026 | READ | `model.frontier` | 2.3 | 3/3 PASS |
| BENCH-03 | coding route | goffice2026 | READ | `model.frontier` | 1.9 | 3/3 PASS |
| BENCH-04 | VPS/operations route | goffice2026 | READ | `agent.hermes` | 2.0 | 3/3 PASS |
| BENCH-05 | context-heavy governance | goffice2026 | READ | receipt, reduction 0.51 | 4.6 | 3/3 PASS |
| BENCH-06 | gateway handoff | handbook | READ | `HANDOFF` (executed false) | 2.1 | 3/3 PASS |
| BENCH-07 | browser read plan | handbook | READ | `READY` + receipt | 2.8 | 3/3 PASS |
| BENCH-08 | browser navigate plan | handbook | READ | `READY` | 4.9 | 3/3 PASS |
| BENCH-09 | blocked production write | goffice2026 | WRITE | `APPROVAL_REQUIRED` | 4.1 | 3/3 PASS |
| BENCH-10 | blocked destructive action | goffice2026 | DESTRUCTIVE | `APPROVAL_REQUIRED` | 2.6 | 3/3 PASS |
| BENCH-11 | supervisor retry | goffice2026 | READ | `RETRY` (module level) | 5.4 | 3/3 PASS |
| BENCH-12 | QA verification decision | goffice2026 | READ | live Jev `REVIEW`/`EXECUTE`/`FALLBACK` | 360.3 | 3/3 PASS |
| BENCH-13 | dbplant write protection | dbplant | WRITE | `APPROVAL_REQUIRED DBPLANT_READ_ONLY_DEFAULT` | 3.5 | 3/3 PASS |
| BENCH-14 | auth scope mismatch | 52clips | READ | `403 PROJECT_MISMATCH` | 1.9 | 3/3 PASS |
| BENCH-15 | provider fallback | goffice2026 | READ | 200 `FALLBACK` (fallback=true) | 4.1 | 3/3 PASS |

## 4. Summary metrics (measured, not estimated)

| Metric | Value |
|---|---|
| Cases / samples | 15 / 45 |
| Pass / fail | **45 / 0** |
| Pass rate (task completion) | 1.00 |
| Routing success rate (cases with an explicit route or decision) | 0.87 |
| Fallback rate | 0.067 |
| Retry rate | 0.067 |
| Policy block count (prod write / destructive / dbplant) | 9 |
| Context reduction ratio (BENCH-05) | 0.5105 |
| Browser success rate (BENCH-07, BENCH-08) | 1.00 |
| Provider failure rate (BENCH-15, deliberately broken endpoint) | 1.00 |
| Latency p50 | **2.8 ms** |
| Latency p95 | **353.3 ms** |
| Latency min / max | 1.1 ms / 363.5 ms |
| Cost per task | `NOT_AVAILABLE` |

## 5. Interpretation

- Control-plane decisions (auth, routing, policy, governance, contracts) are **sub-5 ms** in p50 —
  the plane is deterministic and local.
- The p95 is set almost entirely by the single live provider case (BENCH-12 ≈ 353 ms per call),
  which matches the independently measured Jev latency of 352–736 ms in live QA
  (`docs/V2_LIVE_QA_REPORT.md` §8). p95 therefore describes the provider round-trip, not internal
  overhead.
- The 0.87 “routing success rate” counts cases whose response carries an explicit route/decision;
  the auth-mismatch, context-governor, supervisor-module and `403` cases legitimately have no route
  field, so the metric is a coverage indicator rather than a failure signal — no case failed.
- The 0.067 fallback and retry rates each come from exactly one case by design (fallback path and
  retry path are single cases), not from instability.

## 6. Cost

OpenRouter usage metadata is returned per decision (`usage.cost` on the provider side) but no
authoritative per-task aggregation endpoint is wired into the runtime, so
`COST_PER_TASK=NOT_AVAILABLE`. The single observed provider cost of one decision call during the
readiness consult was 8.68e-05 USD — recorded here as a data point, **not** as a per-task estimate.

## 7. Limitations

1. 45 samples across 15 cases: p50/p95 are indicative, not statistically strong (explicitly flagged
   in the generated summary as well).
2. dbplant policy cases run on a short-lived isolated instance with a temporary `route` scope
   because the production dbplant identity deliberately cannot reach the gateway.
3. The provider-failure case uses a deliberately broken endpoint on an isolated instance; it does
   not simulate a partial/timeout response from the real provider.
4. The supervisor case runs at module level — v0.6.0 exposes no supervisor HTTP route.
5. No load or concurrency testing was performed (single-threaded sequential harness), so the
   reported latencies are idle-system numbers.
6. Cost per task is not measurable with the current wiring.
