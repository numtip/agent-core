import { createEgressProxy } from "./egress-proxy.js";

const host = process.env.EGRESS_PROXY_HOST ?? "127.0.0.1";
const port = Number(process.env.EGRESS_PROXY_PORT ?? 8792);
if (host !== "127.0.0.1" && host !== "::1") throw new Error("EGRESS_PROXY_HOST must be a loopback address");

const server = createEgressProxy({
  onDecision: (d) => { if (!d.allowed) console.log(JSON.stringify({ egress: "deny", host: d.host, port: d.port, reason: d.reason })); },
});
server.listen(port, host, () => console.log(JSON.stringify({ egress: "listening", host, port })));
