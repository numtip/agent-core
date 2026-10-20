import type { InferenceCompleteRequest } from "./schemas.js";

/** Conservative token estimate (~2 chars/token) used as the pre-dispatch maximum. */
export function estimatePromptTokens(request: InferenceCompleteRequest): number {
  let chars = 0;
  for (const message of request.messages) {
    chars += message.content.length + message.role.length + 8;
  }
  return Math.max(64, Math.ceil(chars / 2));
}

/** Hard cap so reserved completion cost cannot be exceeded by the provider call. */
export function capCompletionTokens(requested: number | undefined, cap: number): number {
  const limit = Math.max(16, Math.floor(cap));
  const value = requested ?? Math.min(512, limit);
  return Math.min(Math.max(16, value), limit);
}
