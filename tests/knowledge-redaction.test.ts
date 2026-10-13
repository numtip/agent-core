import { describe, expect, it } from "vitest";
import { redactKnowledgeText, shouldBlockPrivateObservation } from "../src/knowledge-redaction.js";
import { queryKnowledgeFabric } from "../src/knowledge-fabric.js";

describe("knowledge redaction", () => {
  it("blocks private-marked observations", () => {
    expect(shouldBlockPrivateObservation("note <private> token leak")).toBe(true);
    const result = queryKnowledgeFabric({
      project: "agent-core",
      query: "x",
      evidence: [{ id: "p1", text: "secret <private> data", kind: "observation", importance: 1, filtered: true }],
    });
    expect(result.disposition).toBe("FALLBACK");
    if (result.disposition !== "FALLBACK") throw new Error("expected FALLBACK");
    expect(result.reason).toBe("EVIDENCE_BLOCKED_OR_FILTERED");
  });

  it("redacts bearer tokens before governing context", () => {
    const redaction = redactKnowledgeText("Use Bearer abc.def.ghi for debug only");
    expect(redaction.redacted).toBe(true);
    expect(redaction.text).toContain("[REDACTED:bearer]");
    const result = queryKnowledgeFabric({
      project: "agent-core",
      query: "x",
      evidence: [{ id: "t1", text: "Use Bearer abc.def.ghi for debug only", importance: 1, filtered: true }],
    });
    expect(result.disposition).toBe("CONTEXT_READY");
    if (result.disposition !== "CONTEXT_READY") throw new Error("expected CONTEXT_READY");
    expect(result.provenance[0]?.redacted).toBe(true);
    expect(result.context.bundle[0]?.text).toContain("[REDACTED:bearer]");
  });
});
