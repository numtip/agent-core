import { describe, expect, it } from "vitest";
import { createDefaultCapabilityRegistry } from "../src/capability-registry.js";
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

  it("declares no destructive or write operation for defuddle", () => {
    expect(registry.get("skill.defuddle")?.operations).toEqual(["READ", "EXTERNAL"]);
  });

  it("routes to every project scope but only for declared operations", () => {
    const readIds = registry.candidates({ project: "goffice2026", operation: "READ" }).map((c) => c.id);
    expect(readIds).toEqual(expect.arrayContaining(["skill.obsidian-markdown", "skill.defuddle"]));

    const externalIds = registry.candidates({ project: "goffice2026", operation: "EXTERNAL" }).map((c) => c.id);
    expect(externalIds).toContain("skill.defuddle");
    expect(externalIds).not.toContain("skill.obsidian-markdown");
  });

  it("keeps vault writes under the hard policy gate instead of bypassing it", () => {
    expect(evaluateHardPolicy({ project: "goffice2026", operation: "WRITE", environment: "production" }).disposition).toBe("ASK");
    expect(evaluateHardPolicy({ project: "goffice2026", operation: "READ", targets: ["obsidian-vault/notes/x.md"] }).disposition).toBe("ALLOW");
    expect(evaluateHardPolicy({ project: "goffice2026", operation: "READ", targets: [".env"] }).disposition).toBe("DENY");
  });
});
