import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { checkHost, isBlockedAddress, type LookupAll } from "../src/net-guard.js";
import { planBrowserAction } from "../src/browser-control.js";
import { createEgressProxy, type EgressDecision } from "../src/egress-proxy.js";

describe("net-guard address classification", () => {
  it.each([
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1",
    "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.7", "203.0.113.9",
    "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::7f00:1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a01:fe",
    "64:ff9b::a00:1", "2001::1", "2001:db8::1", "2002:a00:1::", "fc00::1", "fd12:3456::1", "fe80::1",
    "fe80::1%eth0", "fec0::1", "ff02::1", "[::1]", "not-an-ip",
  ])("%s is blocked", (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "93.184.215.14", "100.63.255.255", "100.128.0.1", "172.32.0.1", "2606:4700::1111", "2a00:1450::1"])(
    "%s is public", (ip) => expect(isBlockedAddress(ip)).toBe(false));

  it("rejects mixed DNS answers and DNS failure", async () => {
    const mixed: LookupAll = async () => [{ address: "8.8.8.8", family: 4 }, { address: "fd00::1", family: 6 }];
    expect(await checkHost("a.example", mixed)).toEqual({ ok: false, reason: "DNS_RESOLVES_TO_BLOCKED_ADDRESS" });
    expect(await checkHost("a.example", async () => [])).toEqual({ ok: false, reason: "DNS_RESOLUTION_FAILED" });
    expect(await checkHost("a.example", async () => { throw new Error("SERVFAIL"); })).toEqual({ ok: false, reason: "DNS_RESOLUTION_FAILED" });
  });
});

describe("browser URL guard: literal and encoding bypasses", () => {
  it.each([
    "http://127.1/", "http://0x7f.0.0.1/", "http://2130706433/", "http://017700000001/", "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/", "http://[fe80::1]/", "http://localhost./", "http://printer.local/", "http://db.internal/",
    "http://[64:ff9b::a00:1]/", "http://100.100.100.100/",
  ])("%s is denied", (url) => {
    const plan = planBrowserAction({ project: "handbook", url, action: "BROWSER_READ" });
    expect(plan.disposition).toBe("DENY");
  });
});

describe("egress proxy (fail-closed, pinned resolution)", () => {
  const decisions: EgressDecision[] = [];
  const answers: Record<string, string[]> = {
    "rebind.test": ["93.184.215.14", "10.0.0.5"],
    "internal.test": ["192.168.1.10"],
    "v6internal.test": ["fd00::5"],
  };
  const lookup: LookupAll = async (host) => {
    const a = answers[host];
    if (!a) throw new Error("ENOTFOUND");
    return a.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  const proxy = createEgressProxy({ lookup, onDecision: (d) => decisions.push(d) });
  let port = 0;
  beforeAll(async () => { await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r)); port = (proxy.address() as AddressInfo).port; });
  afterAll(async () => { await new Promise<void>((r) => proxy.close(() => r())); });

  function tunnel(authority: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const s = connect(port, "127.0.0.1", () => s.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
      let buf = "";
      s.on("data", (d) => { buf += d; if (buf.includes("\r\n\r\n")) { s.destroy(); resolve(buf.split("\r\n")[0]); } });
      s.on("error", reject);
      s.on("close", () => resolve(buf.split("\r\n")[0]));
    });
  }

  function plain(url: string): Promise<{ status: number; deny: string | undefined }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, method: "GET", path: url, headers: { host: new URL(url).host } }, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, deny: res.headers["x-egress-deny"] as string | undefined });
      });
      req.on("error", reject);
      req.end();
    });
  }

  it.each([
    ["rebind.test:443", "DNS_RESOLVES_TO_BLOCKED_ADDRESS"],
    ["internal.test:443", "DNS_RESOLVES_TO_BLOCKED_ADDRESS"],
    ["v6internal.test:443", "DNS_RESOLVES_TO_BLOCKED_ADDRESS"],
    ["unknown.test:443", "DNS_RESOLUTION_FAILED"],
    ["10.1.254.237:443", "BLOCKED_ADDRESS"],
    ["[::1]:443", "BLOCKED_ADDRESS"],
    ["localhost:443", "BLOCKED_ADDRESS"],
    ["93.184.215.14:22", "PORT_NOT_ALLOWED"],
  ])("CONNECT %s -> 403 %s", async (authority, reason) => {
    expect(await tunnel(authority)).toBe("HTTP/1.1 403 Forbidden");
    expect(decisions.at(-1)).toMatchObject({ allowed: false, reason });
  });

  it("plain-HTTP redirect target on a private address is refused", async () => {
    expect(await plain("http://169.254.169.254/latest/meta-data/?token=abc")).toEqual({ status: 403, deny: "BLOCKED_ADDRESS" });
    expect(await plain("http://internal.test/admin")).toEqual({ status: 403, deny: "DNS_RESOLVES_TO_BLOCKED_ADDRESS" });
  });

  it("decision reports carry host/port only, never paths or queries", () => {
    const serialized = JSON.stringify(decisions);
    expect(serialized).not.toContain("meta-data");
    expect(serialized).not.toContain("token=abc");
    expect(serialized).not.toContain("/admin");
  });
});
