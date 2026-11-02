import { describe, expect, it } from "vitest";
import { CapabilityRegistry, capabilitySchema, createDefaultCapabilityRegistry } from "../src/capability-registry.js";
import { evaluateHardPolicy } from "../src/policy.js";

const registry = createDefaultCapabilityRegistry();

describe("SKILL capabilities", () => {
  it("registers both adopted skills as kind SKILL and ACTIVE", () => {
    for (const id of ["skill.obsidian-markdown", "skill.defuddle"]) {
      const capability = registry.get(id);
      expect(capability?.kind).toBe("SKILL");
      expect(capability?.status).toBe("ACTIVE");
      expect(capability?.risk).toBe("LOW");
    }
  });

  it("pins the upstream commit and the CLI version", () => {
    expect(registry.get("skill.obsidian-markdown")?.metadata.upstream_commit).toBe("3ccff5338ea700537839b21900aa5358a0402c98");
    expect(registry.get("skill.defuddle")?.metadata.cli_version_pinned).toBe("0.19.6");
  });

  it("declares no mutating operation at all", () => {
    // The router does not branch on kind, so a declared WRITE would be routable for every project.
    for (const id of ["skill.obsidian-markdown", "skill.defuddle"]) {
      const operations = registry.get(id)?.operations ?? [];
      expect(operations).not.toContain("WRITE");
      expect(operations).not.toContain("DESTRUCTIVE");
    }
    expect(registry.get("skill.obsidian-markdown")?.operations).toEqual(["READ"]);
    expect(registry.get("skill.defuddle")?.operations).toEqual(["READ", "EXTERNAL"]);
  });

  it("routes to every project scope but only for declared operations", () => {
    const readIds = registry.candidates({ project: "goffice2026", operation: "READ" }).map((c) => c.id);
    expect(readIds).toEqual(expect.arrayContaining(["skill.obsidian-markdown", "skill.defuddle"]));

    const externalIds = registry.candidates({ project: "goffice2026", operation: "EXTERNAL" }).map((c) => c.id);
    expect(externalIds).toContain("skill.defuddle");
    expect(externalIds).not.toContain("skill.obsidian-markdown");

    const writeIds = registry.candidates({ project: "goffice2026", operation: "WRITE" }).map((c) => c.id);
    expect(writeIds).not.toContain("skill.obsidian-markdown");
    expect(writeIds).not.toContain("skill.defuddle");
  });

  it("rejects a SKILL that declares WRITE or DESTRUCTIVE at schema level", () => {
    for (const operation of ["WRITE", "DESTRUCTIVE"] as const) {
      const attempt = capabilitySchema.safeParse({
        id: "skill.bad",
        kind: "SKILL",
        description: "should not exist",
        operations: ["READ", operation]
      });
      expect(attempt.success).toBe(false);
      expect(JSON.stringify(attempt.error?.issues)).toContain(`SKILL_OPERATION_FORBIDDEN:skill.bad:${operation}`);
    }
  });

  it("enforces the prohibition through register() and upsert(), not only via the default registry", () => {
    const registry = new CapabilityRegistry([]);
    const base = { id: "skill.rogue", kind: "SKILL" as const, description: "rogue", operations: ["WRITE" as const] };
    expect(() => registry.register(base)).toThrow(/SKILL_OPERATION_FORBIDDEN/);
    expect(() => registry.upsert(base)).toThrow(/SKILL_OPERATION_FORBIDDEN/);
    expect(registry.get("skill.rogue")).toBeUndefined();
  });

  it("still allows a SKILL that only reads or reaches the network", () => {
    const registry = new CapabilityRegistry([]);
    expect(registry.register({ id: "skill.ok", kind: "SKILL", description: "ok", operations: ["READ", "EXTERNAL"] }).id).toBe("skill.ok");
  });

  it("keeps the hard policy as the only write gate, not the skill metadata", () => {
    expect(evaluateHardPolicy({ project: "goffice2026", operation: "WRITE", environment: "production" }).disposition).toBe("ASK");
    expect(evaluateHardPolicy({ project: "goffice2026", operation: "READ", targets: ["obsidian-vault/notes/x.md"] }).disposition).toBe("ALLOW");
    expect(evaluateHardPolicy({ project: "goffice2026", operation: "READ", targets: [".env"] }).disposition).toBe("DENY");
  });
});
