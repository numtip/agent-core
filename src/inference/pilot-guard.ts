import type { RuntimeConfig } from "../config.js";

export type GroqPilotActivation = "dev-only" | "blocked";

export function groqPilotActivation(config: RuntimeConfig): GroqPilotActivation {
  const raw = process.env.GROQ_PILOT_ACTIVATION?.toLowerCase();
  if (raw === "blocked") return "blocked";
  if (config.env === "production") return "blocked";
  return "dev-only";
}

export function isGroqPilotRouteAllowed(config: RuntimeConfig): boolean {
  if (groqPilotActivation(config) === "blocked") return false;
  return config.env === "development" || config.env === "test";
}

export function groqPilotBlockReason(config: RuntimeConfig): string {
  if (config.env === "production") {
    return "Groq inference pilot is BLOCKED on production (VPS activation not approved)";
  }
  if (groqPilotActivation(config) === "blocked") {
    return "Groq inference pilot activation is BLOCKED by GROQ_PILOT_ACTIVATION";
  }
  if (config.env !== "development" && config.env !== "test") {
    return "Groq inference pilot allows development/test environments only";
  }
  return "Groq inference pilot is not available";
}
