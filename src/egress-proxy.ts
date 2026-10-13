import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { connect, isIP, type Socket } from "node:net";
import { checkHost, systemLookup, type LookupAll } from "./net-guard.js";

/**
 * Browser egress proxy (run Playwright MCP with `--proxy-server http://127.0.0.1:<port>`).
 *
 * The app-level URL guard only sees the URL it is asked to open. Redirects, page subresources,
 * script-initiated fetches and DNS rebinding are only enforceable where the connection is made,
 * so this proxy resolves each host itself, refuses any non-public answer, and connects to the
 * exact address it checked (no second resolution => no rebinding window). Fails closed.
 */
export type EgressDecision = { host: string; port: number; allowed: boolean; reason: string };

export type EgressProxyOptions = {
  lookup?: LookupAll;
  allowedPorts?: number[];
  connectTimeoutMs?: number;
  onDecision?: (decision: EgressDecision) => void;  // never receives paths, headers or bodies
};

const HOP_BY_HOP = ["proxy-authorization", "proxy-connection", "connection", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"];

function parseAuthority(authority: string): { host: string; port: number } | null {
  const m = authority.match(/^\[([^\]]+)\]:(\d+)$/) ?? authority.match(/^([^:]+):(\d+)$/);
  if (!m) return null;
  const port = Number(m[2]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? { host: m[1].toLowerCase(), port } : null;
}

export function createEgressProxy(options: EgressProxyOptions = {}): Server {
  const lookup = options.lookup ?? systemLookup;
  const allowedPorts = new Set(options.allowedPorts ?? [80, 443]);
  const timeout = options.connectTimeoutMs ?? 10_000;
  const report = (d: EgressDecision) => options.onDecision?.(d);

  async function resolve(host: string, port: number): Promise<{ address: string } | { reason: string }> {
    if (!allowedPorts.has(port)) return { reason: "PORT_NOT_ALLOWED" };
    if (host === "localhost" || host.endsWith(".localhost")) return { reason: "BLOCKED_ADDRESS" };
    const check = await checkHost(host, lookup);
    if (!check.ok) return { reason: check.reason };
    return { address: check.addresses[0] };
  }

  const server = createServer(async (req: IncomingMessage, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== "http:") {
      res.writeHead(400).end();
      return;
    }
    const host = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const port = Number(target.port || 80);
    const decision = await resolve(host, port);
    if ("reason" in decision) {
      report({ host, port, allowed: false, reason: decision.reason });
      res.writeHead(403, { "x-egress-deny": decision.reason }).end();
      return;
    }
    report({ host, port, allowed: true, reason: "PUBLIC" });
    const headers = { ...req.headers };
    for (const h of HOP_BY_HOP) delete headers[h];
    headers.host = target.host;
    const upstream = httpRequest({
      host: decision.address, port, method: req.method, path: `${target.pathname}${target.search}`,
      headers, setHost: false, timeout,
    }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });

  server.on("connect", async (req: IncomingMessage, client: Socket, head: Buffer) => {
    client.on("error", () => client.destroy());
    const authority = parseAuthority(req.url ?? "");
    if (!authority) {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const decision = await resolve(authority.host, authority.port);
    if ("reason" in decision) {
      report({ host: authority.host, port: authority.port, allowed: false, reason: decision.reason });
      client.end(`HTTP/1.1 403 Forbidden\r\nx-egress-deny: ${decision.reason}\r\n\r\n`);
      return;
    }
    report({ host: authority.host, port: authority.port, allowed: true, reason: "PUBLIC" });
    const upstream = connect({ host: decision.address, port: authority.port, family: isIP(decision.address) });
    upstream.setTimeout(timeout, () => upstream.destroy());
    upstream.once("connect", () => {
      upstream.setTimeout(0);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    client.on("close", () => upstream.destroy());
  });

  // WebSocket/other upgrades over plain HTTP are not proxied.
  server.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"));
  return server;
}
