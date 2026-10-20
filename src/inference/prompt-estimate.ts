import type { InferenceCompleteRequest } from "./schemas.js";

/** Conservative token estimate (~4 chars/token) for budget pre-check. */
export function estimatePromptTokens(request: InferenceCompleteRequest): number {
  let chars = 0;
  for (const message of request.messages) {
    chars += message.content.length + message.role.length + 8;
  }
  const estimated = Math.ceil(chars / 3);
  return Math.min(Math.max(estimated, 64), 200_000);
}
