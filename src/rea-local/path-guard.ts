import { realpathSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";

export type PathGuardResult =
  | { ok: true; canonicalPath: string }
  | { ok: false; reason: string };

function normalizeWindowsPath(input: string): string {
  return normalize(input.replace(/\//g, "\\"));
}

export function canonicalPathWithinRoots(inputPath: string, roots: string[]): PathGuardResult {
  if (!inputPath || typeof inputPath !== "string") return { ok: false, reason: "PATH_MISSING" };
  if (inputPath.includes("\0")) return { ok: false, reason: "PATH_INVALID" };
  if (!isAbsolute(inputPath)) return { ok: false, reason: "PATH_NOT_ABSOLUTE" };

  const normalized = normalizeWindowsPath(inputPath);
  if (normalized.startsWith("\\\\")) return { ok: false, reason: "UNC_PATH_BLOCKED" };
  if (normalized.split("\\").includes("..")) return { ok: false, reason: "PATH_TRAVERSAL" };

  let canonicalTarget: string;
  try {
    canonicalTarget = realpathSync.native(normalized);
  } catch {
    return { ok: false, reason: "PATH_NOT_FOUND" };
  }

  for (const root of roots) {
    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync.native(resolve(root));
    } catch {
      continue;
    }
    const rel = relative(canonicalRoot.toLowerCase(), canonicalTarget.toLowerCase());
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      return { ok: true, canonicalPath: canonicalTarget };
    }
  }

  return { ok: false, reason: "PATH_OUTSIDE_WORKSPACE" };
}

export function isUnderSyntheticSample(canonicalPath: string, workspaceRoot: string): boolean {
  let root: string;
  try {
    root = realpathSync.native(resolve(workspaceRoot));
  } catch {
    return false;
  }
  const sampleDir = resolve(root, "inbox", "synthetic-app");
  let canonicalSample: string;
  try {
    canonicalSample = realpathSync.native(sampleDir);
  } catch {
    return false;
  }
  const rel = relative(canonicalSample.toLowerCase(), canonicalPath.toLowerCase());
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
