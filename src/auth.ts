import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { RuntimeConfig } from "./config.js";
import { findProject } from "./projects.js";

export type ProjectIdentity = { project: string; scopes: string[] };

declare module "fastify" {
  interface FastifyRequest { projectIdentity?: ProjectIdentity; }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function resolveProjectScopes(config: RuntimeConfig, project: string): string[] {
  if (Object.hasOwn(config.projectScopes, project)) {
    return config.projectScopes[project] ?? [];
  }
  return findProject(project)?.defaultScopes ?? [];
}

export function authenticateProject(config: RuntimeConfig, request: FastifyRequest): ProjectIdentity | null {
  if (!config.authRequired) return null;
  const project = String(request.headers["x-agent-project"] ?? "");
  const token = String(request.headers["x-agent-project-token"] ?? "");
  if (!project || !token) return null;
  const expected = config.projectKeys[project];
  if (!expected || !safeEqual(token, expected)) return null;
  return { project, scopes: resolveProjectScopes(config, project) };
}

export function hasScope(identity: ProjectIdentity | undefined, scope: string): boolean {
  return Boolean(identity?.scopes.includes(scope) || identity?.scopes.includes("*"));
}