export type OperationKind = "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL";
export type PolicyInput = { project: string; operation: OperationKind; targets?: string[]; environment?: "local"|"preview"|"production" };
export type PolicyResult = { disposition: "ALLOW"|"ASK"|"DENY"; reason: string };

function isSecretTarget(target:string): boolean {
  const value=target.toLowerCase().replaceAll("\\","/");
  const base=value.split("/").at(-1) ?? value;
  return base === ".env" || base.startsWith(".env.") || base.endsWith(".pem") || base.endsWith(".key") || base === "id_rsa" || base === "id_ed25519" || value.includes("credential") || value.includes("secret");
}

export function evaluateHardPolicy(input: PolicyInput): PolicyResult {
  const targets = input.targets ?? [];
  if (targets.some(isSecretTarget)) return { disposition:"DENY", reason:"SECRET_OR_CREDENTIAL_TARGET" };
  if (input.project === "dbplant" && input.operation !== "READ") return { disposition:"ASK", reason:"DBPLANT_READ_ONLY_DEFAULT" };
  if (input.environment === "production" && input.operation !== "READ") return { disposition:"ASK", reason:"PRODUCTION_WRITE_REQUIRES_APPROVAL" };
  if (input.operation === "DESTRUCTIVE") return { disposition:"ASK", reason:"DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL" };
  return { disposition:"ALLOW", reason:"POLICY_ALLOWED" };
}