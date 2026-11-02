# ADR 0004: Adopt kepano/obsidian-skills `obsidian-markdown` + `defuddle` as SKILL capabilities

**Status:** Accepted (owner-approved, autonomous execution) · **Date:** 2026-11-02 · **Scope:** Hermes runtime skill registry + `src/capability-registry.ts` (registry entry only — no route, no service change)

## Context

Hermes already had a filesystem-first `obsidian` skill (read/list/search/create notes) but no
authoritative reference for Obsidian Flavored Markdown syntax, and no HTML→Markdown extractor other
than the built-in `web_extract` tool. `kepano/obsidian-skills` (Steph Ango, MIT) supplies both as
**documentation-only** skills — markdown instructions, no executable payload.

The owner approved adopting `obsidian-markdown` and `defuddle` and registering them in agent-core so
the capability registry stops being blind to skills the Hermes runtime actually loads.

## Decision

1. **Install with the native Hermes installer, not by hand.** `hermes skills install` runs the
   `skills-guard` security scan, quarantines first, records a scan hash, and resolves the source to an
   exact commit — a manual copy gives none of that.
   - `skills-sh/kepano/obsidian-skills/skills/obsidian-markdown` → `note-taking/obsidian-markdown/`
     (SKILL.md + `references/{CALLOUTS,EMBEDS,PROPERTIES}.md`)
   - `skills-sh/kepano/obsidian-skills/skills/defuddle` → `note-taking/defuddle/` (SKILL.md)
2. **Pin the upstream commit:** `3ccff5338ea700537839b21900aa5358a0402c98` (2026-09-15,
   `Merge pull request #143`). The installer resolved to exactly this commit. `diff -r` against a fresh
   clone at that commit: `obsidian-markdown` **IDENTICAL**; `defuddle` differs by the single pinned
   install line described in point 3, nothing else.
3. **Pin the CLI dependency.** `defuddle` is a global npm CLI (`defuddle@0.19.6`, MIT, 27 packages
   installed, 0 vulnerabilities via `npm audit`, no OSV.dev advisory). Upstream's SKILL.md documented
   an **unpinned** `npm install -g defuddle`, which the scanner flagged as `MEDIUM supply_chain`
   (`unpinned_npm_install`). One line in the vendored copy is changed to `npm install -g defuddle@0.19.6`;
   a re-scan reports **SAFE with no findings**. This is the only local delta from upstream and it is
   recorded in the capability metadata (`upstream_delta`).
4. **Register two capabilities, not a new engine.** `src/capability-registry.ts` gains the first
   `kind: "SKILL"` entries (the enum already existed):

   | id | kind | operations | risk | status | priority |
   |---|---|---|---|---|---|
   | `skill.obsidian-markdown` | SKILL | READ, WRITE | LOW | ACTIVE | 70 |
   | `skill.defuddle` | SKILL | READ, EXTERNAL | LOW | ACTIVE | 65 |

   Both `projects: ["*"]` like the existing `knowledge.*` handoff entries — no new project identity,
   no new adapter, no duplicate retrieval engine. `authority: CONTEXT_ONLY`, `payload: markdown-only`,
   `vault_write_requires_explicit_request: true` (the owner's no-unauthorized-vault-writes rule is
   restated in the registry so a routing client cannot lose it).

## Policy mapping (what "L0/L1" means here)

There is **no `L0`/`L1` symbol anywhere in this repository** (`grep -rn '\bL0\b|\bL1\b' src docs *.md`
→ 0 hits) and no document named "AI-OS Blueprint v4.1" on this host. The governing documents that do
exist are `BLUEPRINT.md`, `docs/AGENT_CORE_V2_BLUEPRINT.md` and `ARCHITECTURE.md`. So the policy
guarantees were verified against the mechanisms that actually run:

- **Operation gate** — `capabilitySchema.operations`; a capability can only be routed for an operation
  it declares. `skill.defuddle` declares no `WRITE`/`DESTRUCTIVE`.
- **Hard policy** — `evaluateHardPolicy()` (`src/policy.ts`): secret targets → `DENY`, production
  non-READ → `ASK`, `DESTRUCTIVE` → `ASK`.
- **Project scope** — `projects` array + `CapabilityRegistry.candidates()` filtering.
- **Status gate** — `PLANNED` capabilities are excluded unless `include_planned` is set; `DISABLED`
  never routes.

Verified live through the real HTTP surface (in-process inject against this branch, port 8787 config,
no service restarted): `GET /v2/capabilities` → 14 capabilities, 2 `SKILL`; `GET
/v2/capabilities/skill.defuddle` → 200; `POST /v2/capabilities/search {query:"defuddle"}` → 1 hit;
`POST /v2/route {operation:"READ", kinds:["SKILL"]}` → `ROUTE skill.defuddle`; same for WRITE →
`skill.obsidian-markdown`; the same WRITE with `environment:"production"` → `HUMAN_REVIEW`; `READ`
with `targets:[".env"]` → `DENY SECRET_OR_CREDENTIAL_TARGET`. Full transcript in
`docs/evidence/skills-adoption-2026-11-02.md`.

## Consequences

- Hermes gains accurate Obsidian-syntax guidance (callouts, embeds, properties, block refs, Mermaid)
  and a token-cheaper extraction path; agent-core can now *route* to skills instead of pretending the
  registry is the whole world.
- One new global npm package on this host (`defuddle@0.19.6`, pinned). If it disappears the skill's
  readiness is unaffected — the skill is documentation and the CLI is an on-demand tool.
- Vendored skill content will drift from upstream until someone re-runs `hermes skills update`. The
  pinned commit in metadata is the change-detection anchor.
- No production deployment, no service restart, no vault write: this ADR ships a registry entry, a test
  and docs. Activation of the running service (`releases/5ae20af`) is a separate, owner-approved gate.

## Rollback

1. `hermes skills uninstall obsidian-markdown defuddle` (removes the runtime skills) — or leave them; they are inert without the registry entry.
2. `git revert <this commit>` on `feat/skills-obsidian-adoption` — drops both registry entries and the test. Registry-only change, so no runtime state to unwind.
3. `npm uninstall -g defuddle` to remove the CLI.

## Open gates

- The running service is **not** restarted; the entries reach production only when a release is cut
  from `main` after merge (owner approval required).
- "AI-OS Blueprint v4.1" could not be located on this host — needs the owner to point at it before it
  can be cited as the authority for any future ADR.
