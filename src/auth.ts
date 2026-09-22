import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { RuntimeConfig } from "./config.js";

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

export function authenticateProject(config: RuntimeConfig, request: FastifyRequest): ProjectIdentity | null {
  if (!config.authRequired) return null;
  const project = String(request.headers["x-agent-project"] ?? "");
  const token = String(request.headers["x-agent-project-token"] ?? "");
  if (!project || !token) return null;
  const expected = config.projectKeys[project];
  if (!expected || !safeEqual(token, expected)) return null;
  return { project, scopes: config.projectScopes[project] ?? ["decision","route","qa","context","metrics"] };
}

export function hasScope(identity: ProjectIdentity | undefined, scope: string): boolean {
  return Boolean(identity?.scopes.includes(scope) || identity?.scopes.includes("*"));
}