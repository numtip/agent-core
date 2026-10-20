import { randomUUID } from "node:crypto";

/**
 * Minimal Playwright MCP client (streamable HTTP transport).
 *
 * The control plane deliberately owns this client: browser actions are only reached through
 * `/v2/browser/execute`, which first runs authentication, project scope, hard policy, the
 * browser URL/SSRF guard, the prompt-injection guard and the approval gates. This module never
 * decides policy — it only transports an already-approved action and reports honestly.
 */

export type McpToolResult = {
  tool: string;
  isError: boolean;
  text: string;
  latency_ms: number;
  session_id: string | null;
};

export class McpUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "McpUnavailableError";
  }
}

export class McpToolError extends Error {
  constructor(message: string, public readonly detail?: string) {
    super(message);
    this.name = "McpToolError";
  }
}

/**
 * One MCP session = one isolated browser context on a server started with `--isolated`.
 * Multi-step actions (navigate then type) must run inside the same session; the session is
 * closed by the caller so no context outlives the request.
 */
export type McpSession = {
  readonly id: string | null;
  call(tool: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
};

export type McpPlaywrightClient = {
  callTool(tool: string, args: Record<string, unknown>, timeoutMs?: number): Promise<McpToolResult>;
  openSession(timeoutMs?: number): Promise<McpSession>;
  isEnabled(): boolean;
  endpoint(): string;
};

/** Final URL reported by Playwright MCP after navigation ("- Page URL: <url>"), or null. */
export function parsePageUrl(text: string): string | null {
  const match = text.match(/^- Page URL: (\S+)\s*$/m);
  return match ? match[1] : null;
}

type SseMessage = { result?: unknown; error?: { code?: number; message?: string } };

function parseSseBody(body: string): SseMessage {
  const lines = body.split("\n");
  const payloads: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) payloads.push(trimmed.slice(5).trim());
  }
  const candidates = payloads.length ? payloads : [body.trim()];
  for (const candidate of candidates) {
    if (!candidate || candidate === "[DONE]") continue;
    try {
      const parsed = JSON.parse(candidate) as SseMessage;
      if (parsed.result !== undefined || parsed.error !== undefined) return parsed;
    } catch {
      // keep scanning: the body may mix SSE frames and keep-alive comments
    }
  }
  return {};
}

export type McpClientOptions = {
  enabled: boolean;
  endpoint: string;
  timeoutMs: number;
};

export class PlaywrightMcpClient implements McpPlaywrightClient {
  constructor(private readonly options: McpClientOptions) {}

  isEnabled(): boolean {
    return this.options.enabled;
  }

  endpoint(): string {
    return this.options.endpoint;
  }

  private async post(body: Record<string, unknown>, sessionId: string | null, timeoutMs: number): Promise<{ headers: Headers; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new McpUnavailableError(`MCP endpoint returned HTTP ${response.status}`, text.slice(0, 300));
      }
      return { headers: response.headers, text };
    } catch (error) {
      if (error instanceof McpUnavailableError) throw error;
      const reason = error instanceof Error && error.name === "AbortError"
        ? `MCP request timed out after ${timeoutMs} ms`
        : `MCP transport error: ${error instanceof Error ? error.message : String(error)}`;
      throw new McpUnavailableError(reason, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async callTool(tool: string, args: Record<string, unknown>, timeoutMs = this.options.timeoutMs): Promise<McpToolResult> {
    const session = await this.openSession(timeoutMs);
    try {
      return await session.call(tool, args);
    } finally {
      await session.close();
    }
  }

  async openSession(timeoutMs = this.options.timeoutMs): Promise<McpSession> {
    if (!this.options.enabled) {
      throw new McpUnavailableError("MCP execution is disabled (PLAYWRIGHT_MCP_EXECUTION_ENABLED=false)");
    }
    const init = await this.post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "agent-core", version: "0.6.0" },
      },
    }, null, timeoutMs);
    const sessionId = init.headers.get("mcp-session-id");
    const initMessage = parseSseBody(init.text);
    if (initMessage.error) throw new McpUnavailableError(`MCP initialize failed: ${initMessage.error.message ?? "unknown"}`);

    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId, timeoutMs).catch(() => undefined);

    let nextId = 2;
    let closed = false;
    return {
      id: sessionId,
      call: async (tool, args) => {
        if (closed) throw new McpUnavailableError("MCP session already closed");
        const started = Date.now();
        const call = await this.post({
          jsonrpc: "2.0",
          id: nextId++,
          method: "tools/call",
          params: { name: tool, arguments: args },
        }, sessionId, timeoutMs);
        const message = parseSseBody(call.text);
        if (message.error) throw new McpToolError(`MCP tool ${tool} failed`, message.error.message);
        const result = (message.result ?? {}) as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
        const text = (result.content ?? []).map((part) => part.text ?? `[${part.type ?? "unknown"}]`).join("\n");
        return { tool, isError: result.isError === true, text, latency_ms: Date.now() - started, session_id: sessionId };
      },
      close: async () => {
        if (closed) return;
        closed = true;
        if (sessionId) await this.closeSession(sessionId, timeoutMs);
      },
    };
  }

  private async closeSession(sessionId: string, timeoutMs: number): Promise<void> {
    try {
      await fetch(this.options.endpoint, {
        method: "DELETE",
        headers: { "mcp-session-id": sessionId },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // best effort: the server also expires abandoned sessions
    }
  }
}

/** Test/boot helper: a client that always fails, used when the runtime is not configured. */
export class DisabledMcpClient implements McpPlaywrightClient {
  constructor(private readonly reason = "MCP execution disabled", private readonly url = "not-configured") {}
  isEnabled(): boolean { return false; }
  endpoint(): string { return this.url; }
  async callTool(): Promise<McpToolResult> { throw new McpUnavailableError(this.reason); }
  async openSession(): Promise<McpSession> { throw new McpUnavailableError(this.reason); }
}

export function newReceiptId(): string {
  return `mcp_${randomUUID()}`;
}
