import type { ReaAllowlistProfile } from "./types.js";
import { REA_LOCAL_ALLOWLIST, type ReaAllowlistedTool } from "./allowlist.js";

export function getActiveAllowlist(profile: ReaAllowlistProfile | undefined): ReaAllowlistedTool[] {
  const p = profile ?? "v1";
  if (p === "v2") return REA_LOCAL_ALLOWLIST;
  return REA_LOCAL_ALLOWLIST.filter((t) => t.minimumProfile === "v1");
}

export function getActiveAllowlistIds(profile: ReaAllowlistProfile | undefined): Set<string> {
  return new Set(getActiveAllowlist(profile).map((t) => t.id));
}
