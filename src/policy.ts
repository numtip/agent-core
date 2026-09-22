export type OperationKind = "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL";
export type PolicyInput = { project: string; operation: OperationKind; targets?: string[]; environment?: "local"|"preview"|"production" };
export type PolicyResult = { disposition: "ALLOW"|"ASK"|"DENY"; reason: string };

const secretPatterns = [/(^|\\/)\\.env(?:\\.|$)/i,/\\.pem$/i,/\\.key$/i,/id_(rsa|ed25519)$/i,/credentials?/i,/secrets?/i];

export function evaluateHardPolicy(input: PolicyInput): PolicyResult {
  const targets = input.targets ?? [];
  if (targets.some((target)=>secretPatterns.some((pattern)=>pattern.test(target)))) return { disposition:"DENY", reason:"SECRET_OR_CREDENTIAL_TARGET" };
  if (input.project === "dbplant" && input.operation !== "READ") return { disposition:"ASK", reason:"DBPLANT_READ_ONLY_DEFAULT" };
  if (input.environment === "production" && input.operation !== "READ") return { disposition:"ASK", reason:"PRODUCTION_WRITE_REQUIRES_APPROVAL" };
  if (input.operation === "DESTRUCTIVE") return { disposition:"ASK", reason:"DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL" };
  return { disposition:"ALLOW", reason:"POLICY_ALLOWED" };
}