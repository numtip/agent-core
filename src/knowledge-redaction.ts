export type RedactionResult = {
  text: string;
  redacted: boolean;
  blocked: boolean;
  reasons: string[];
};

const PRIVATE_MARKERS = [/<private>/i, /\[private\]/i, /DO NOT SYNC/i];
const SECRET_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "bearer", pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
  { id: "openrouter_key", pattern: /sk-or-v1-[A-Za-z0-9]+/gi },
  { id: "groq_key", pattern: /gsk_[A-Za-z0-9]+/gi },
  { id: "openai_key", pattern: /sk-[A-Za-z0-9]{20,}/gi },
  { id: "agent_token", pattern: /AGENT_(?:PROJECT_)?TOKEN\s*=\s*\S+/gi },
  { id: "pem_block", pattern: /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g },
  { id: "ghp_pat", pattern: /ghp_[A-Za-z0-9]{20,}/gi },
];

export function shouldBlockPrivateObservation(text: string): boolean {
  return PRIVATE_MARKERS.some((pattern) => pattern.test(text));
}

export function redactKnowledgeText(text: string): RedactionResult {
  if (shouldBlockPrivateObservation(text)) {
    return { text: "", redacted: true, blocked: true, reasons: ["PRIVATE_MARKER"] };
  }

  let output = text;
  const reasons: string[] = [];
  for (const rule of SECRET_PATTERNS) {
    if (rule.pattern.test(output)) {
      reasons.push(rule.id);
      output = output.replace(rule.pattern, `[REDACTED:${rule.id}]`);
    }
  }

  return { text: output, redacted: reasons.length > 0, blocked: false, reasons };
}
