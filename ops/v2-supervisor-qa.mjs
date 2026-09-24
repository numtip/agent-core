// Agent Core v2 - supervisor QA (module level).
//
// The supervisor is not exposed over HTTP in v0.6.0 (no /v2/supervisor route); V2-8 verifies the
// decision matrix by importing the built module directly. Usage:
//   node ops/v2-supervisor-qa.mjs [--out results.jsonl]
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { supervise } from "../dist/src/supervisor.js";

const here = dirname(fileURLToPath(import.meta.url));
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex > -1 ? process.argv[outIndex + 1] : resolve(here, "../logs/v2-supervisor-qa.jsonl");

const base = {
  project: "goffice2026",
  task_id: "v28-supervisor",
  phase: "RUNNING",
  goal: "verify supervisor decisions",
  attempts: 0,
  max_attempts: 3,
  blocked: false,
  dependency_ready: true,
  qa_status: "UNKNOWN",
  operation: "READ",
  active_agents: [],
  completed_subgoals: [],
  pending_subgoals: [],
};

const cases = [
  ["N1-normal-continuation", { ...base, pending_subgoals: ["write-report"], active_agents: ["agent.hermes"] }, "CONTINUE"],
  ["N2-delegation-candidate", { ...base, pending_subgoals: ["research", "qa"], active_agents: [] }, "DELEGATE"],
  ["N3-missing-dependency", { ...base, blocked: true, dependency_ready: false }, "WAIT_FOR_DEPENDENCY"],
  ["N4-retry-with-budget", { ...base, phase: "VERIFYING", qa_status: "FAIL", attempts: 1, max_attempts: 3 }, "RETRY"],
  ["N5-retry-budget-exhausted", { ...base, phase: "VERIFYING", qa_status: "FAIL", attempts: 3, max_attempts: 3 }, "ESCALATE"],
  ["N6-completed-not-verified", { ...base, phase: "RUNNING", pending_subgoals: [] }, "VERIFY"],
  ["N7-success-verified", { ...base, phase: "COMPLETED", qa_status: "PASS" }, "STOP_SUCCESS"],
  ["N8-irrecoverable-failure", { ...base, phase: "FAILED", last_error: "build failed" }, "STOP_FAILURE"],
  ["N9-destructive-escalation", { ...base, operation: "DESTRUCTIVE" }, "ESCALATE"],
  ["N10-approval-phase-escalation", { ...base, phase: "APPROVAL_REQUIRED" }, "ESCALATE"],
];

mkdirSync(dirname(outPath), { recursive: true });
let failures = 0;
for (const [caseName, request, expected] of cases) {
  const result = supervise(request);
  const status = result.decision === expected ? "PASS" : "FAIL";
  if (status === "FAIL") failures += 1;
  const entry = {
    case: caseName,
    phase: "N",
    timestamp: new Date().toISOString(),
    project: request.project,
    operation: request.operation,
    expected: expected,
    observed: `${result.decision} (${result.reason})`,
    status,
    evidence: {
      decision: result.decision,
      reason: result.reason,
      next_phase: result.next_phase,
      retry_allowed: result.retry_allowed,
      remaining_attempts: result.remaining_attempts,
      receipt: result.receipt,
      transport: "module-import (no HTTP route in v0.6.0)",
    },
  };
  appendFileSync(outPath, JSON.stringify(entry) + "\n");
  console.log(`[${status}] ${caseName.padEnd(30)} ${result.decision} (${result.reason})`);
}
console.log(`supervisor_cases=${cases.length} failures=${failures} results_file=${outPath}`);
process.exit(failures ? 1 : 0);
