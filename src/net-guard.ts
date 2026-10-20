import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

/**
 * Egress address policy shared by the browser URL guard, the post-navigation check and the
 * egress proxy. Anything that is not a globally routable unicast address is blocked, and every
 * uncertain outcome (unparseable host, DNS failure, empty answer) is treated as blocked.
 */
// Separate lists: a BlockList also matches IPv4 input against IPv6 rules via its ::ffff: form,
// so a mapped-range rule in a shared list would block every IPv4 address.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked4.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 96],            // unspecified, loopback and deprecated IPv4-compatible forms
  ["::ffff:0:0", 96],    // IPv4-mapped: never needed for a public target
  ["64:ff9b::", 96], ["64:ff9b:1::", 48], // NAT64 can embed private IPv4
  ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], // discard, IETF/Teredo, docs, 6to4
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked6.addSubnet(net, prefix, "ipv6");

export function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** True when `address` is an IP literal outside globally routable unicast space. */
export function isBlockedAddress(address: string): boolean {
  const ip = stripBrackets(address).split("%")[0].toLowerCase();
  const family = isIP(ip);
  if (family === 4) return blocked4.check(ip, "ipv4");
  if (family === 6) return blocked6.check(ip, "ipv6");
  return true;
}

export type LookupResult = { address: string; family: number };
export type LookupAll = (hostname: string) => Promise<LookupResult[]>;

export const systemLookup: LookupAll = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export type HostCheck =
  | { ok: true; addresses: string[] }
  | { ok: false; reason: "BLOCKED_ADDRESS" | "DNS_RESOLUTION_FAILED" | "DNS_RESOLVES_TO_BLOCKED_ADDRESS" };

/** Resolve `hostname` and require every answer to be public. Fails closed. */
export async function checkHost(hostname: string, lookup: LookupAll = systemLookup): Promise<HostCheck> {
  const host = stripBrackets(hostname).toLowerCase();
  if (isIP(host)) return isBlockedAddress(host) ? { ok: false, reason: "BLOCKED_ADDRESS" } : { ok: true, addresses: [host] };
  let answers: LookupResult[];
  try {
    answers = await lookup(host);
  } catch {
    return { ok: false, reason: "DNS_RESOLUTION_FAILED" };
  }
  if (!answers.length) return { ok: false, reason: "DNS_RESOLUTION_FAILED" };
  if (answers.some((a) => isBlockedAddress(a.address))) return { ok: false, reason: "DNS_RESOLVES_TO_BLOCKED_ADDRESS" };
  return { ok: true, addresses: answers.map((a) => a.address) };
}
