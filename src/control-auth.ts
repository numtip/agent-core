import { createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * Origin-side verification of the `Cf-Access-Jwt-Assertion` header that Cloudflare Access adds
 * to every request it admits. This does not replace Access at the edge; it makes the origin
 * refuse control-plane requests that did not come through it. Every failure is a rejection.
 */
export type CfAccessOptions = {
  teamDomain: string;           // e.g. https://<team>.cloudflareaccess.com
  audiences: string[];          // Access application AUD tag(s)
  fetchImpl?: typeof fetch;
  now?: () => number;           // ms
  cacheTtlMs?: number;
  clockSkewSec?: number;
};

export type JwtCheck = { valid: true; email: string | null } | { valid: false; reason: string };

type Jwk = JsonWebKey & { kid?: string };

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function normaliseTeamDomain(raw: string): string {
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  if (url.protocol !== "https:") throw new Error("Cloudflare Access team domain must be https");
  return `https://${url.host}`;
}

export class CfAccessVerifier {
  private readonly team: string;
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private lastRefreshAttempt = 0;

  constructor(private readonly options: CfAccessOptions) {
    this.team = normaliseTeamDomain(options.teamDomain);
    if (!options.audiences.length) throw new Error("Cloudflare Access audience is required");
  }

  private now() { return (this.options.now ?? Date.now)(); }

  private async refresh(): Promise<void> {
    this.lastRefreshAttempt = this.now();
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${this.team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`JWKS HTTP ${response.status}`);
    const body = (await response.json()) as { keys?: Jwk[] };
    const next = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kid && jwk.kty === "RSA") next.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
    }
    if (!next.size) throw new Error("JWKS contained no RSA keys");
    this.keys = next;
    this.fetchedAt = this.now();
  }

  private async keyFor(kid: string): Promise<KeyObject | null> {
    const ttl = this.options.cacheTtlMs ?? 10 * 60_000;
    const stale = this.now() - this.fetchedAt > ttl;
    const unknownKid = !this.keys.has(kid) && this.now() - this.lastRefreshAttempt > 30_000;
    if (stale || unknownKid) await this.refresh();
    return this.keys.get(kid) ?? null;
  }

  async verify(token: string | undefined): Promise<JwtCheck> {
    if (!token) return { valid: false, reason: "MISSING_ASSERTION" };
    const parts = token.split(".");
    if (parts.length !== 3) return { valid: false, reason: "MALFORMED" };
    const header = b64urlJson(parts[0]);
    const claims = b64urlJson(parts[1]);
    if (!header || !claims) return { valid: false, reason: "MALFORMED" };
    if (header.alg !== "RS256" || typeof header.kid !== "string") return { valid: false, reason: "UNSUPPORTED_ALG" };

    let key: KeyObject | null;
    try {
      key = await this.keyFor(header.kid);
    } catch {
      return { valid: false, reason: "JWKS_UNAVAILABLE" };
    }
    if (!key) return { valid: false, reason: "UNKNOWN_KID" };

    const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
    if (!verify("RSA-SHA256", signed, key, Buffer.from(parts[2], "base64url"))) return { valid: false, reason: "BAD_SIGNATURE" };

    const nowSec = Math.floor(this.now() / 1000);
    const skew = this.options.clockSkewSec ?? 60;
    if (claims.iss !== this.team) return { valid: false, reason: "BAD_ISSUER" };
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.some((a) => typeof a === "string" && this.options.audiences.includes(a))) return { valid: false, reason: "BAD_AUDIENCE" };
    if (typeof claims.exp !== "number" || claims.exp + skew < nowSec) return { valid: false, reason: "EXPIRED" };
    if (typeof claims.nbf === "number" && claims.nbf - skew > nowSec) return { valid: false, reason: "NOT_YET_VALID" };
    return { valid: true, email: typeof claims.email === "string" ? claims.email : null };
  }
}
