# Evidence — SKILL capabilities adoption (obsidian-markdown · defuddle)

Date: 2026-11-02 · Branch: `feat/skills-obsidian-adoption` · Host: VPS 237 (`ubantu24`)
Companion: `docs/adr/0004-skill-capabilities-obsidian-skills.md`

Every command below was executed on this host; outputs are pasted as returned.

## A. Pin verification

```
obsidian-markdown: IDENTICAL to kepano/obsidian-skills@3ccff5338ea700537839b21900aa5358a0402c98
defuddle: DIFFERS from upstream ->
  10c10
  < If not installed: `npm install -g defuddle`
  ---
  > If not installed: `npm install -g defuddle@0.19.6`
```

The only local delta is the deliberate CLI pin (upstream documents an unpinned global install, which
the scanner flags).

## B. Security scan (native installer, `skills-guard-v10`)

```
Scan: obsidian-markdown (skills-sh/kepano/obsidian-skills/skills/obsidian-markdown/community)
  Verdict: SAFE   Decision: ALLOWED
  hash sha256:fadec7d09cb25db59882c5a8ffafd723643d8337f2a031ba09b89b9600753fcc
Scan: defuddle (skills-sh/kepano/obsidian-skills/skills/defuddle/community)
  Verdict: SAFE   Decision: ALLOWED
  hash sha256:47b357051774ddc99a56e5ddafe7cb1f95d67fff540939312d4380763a21235e
```

Pre-pin, the defuddle scan reported `MEDIUM supply_chain — unpinned_npm_install (SKILL.md:10)`.
Post-pin re-scan (`hermes skills audit`, 2026-11-02T10:37): `SAFE`, no findings.

## C. CLI dependency

```
defuddle: 0.19.6 (/home/prinyaroot/.nvm/versions/node/v22.22.2/bin/defuddle)
OSV.dev advisories for defuddle 0.19.6: {}
npm audit: {'critical': 0, 'high': 0, 'moderate': 0, 'low': 0, 'total': 0}   # 27 packages
```

## D. Skill QA — 30/30 checks (`test_skills.py`, scratch, vault untouched)

```
PASS file {SKILL.md, references/CALLOUTS.md, references/EMBEDS.md, references/PROPERTIES.md, defuddle/SKILL.md}
PASS reference links resolvable
PASS frontmatter parses + tags/aliases/cssclasses props
PASS wikilink / wikilink with display text / block ref + block id
PASS callout (typed) / foldable callout / embed note-image-pdf
PASS nested tag / highlight / inline math / comment %%..%% / footnote ref+def
PASS gfm table / mermaid fenced / task list
PASS defuddle exit 0 / returns clean text not html (156 chars on example.com)
PASS defuddle metadata property (-p title -> "Example Domain")
PASS defuddle real article (33,330 chars from en.wikipedia.org/wiki/Markdown)
PASS vault has notes (147) / KB note found / KB note readable (11,273 chars)
PASS vault untouched (read-only) — 50 note hashes before == after, 0 changed
RESULT: ALL PASS
```

Read-only retrieval target used: `30-Systems/ESXi-Audit-Bridge/ESXI-AUDIT-BRIDGE-KB.md`.

## E. Repository gates

```
npx tsc -p tsconfig.json --noEmit   -> clean (no output)
npx vitest run                      -> Test Files 31 passed | 3 skipped (34)
                                       Tests 273 passed | 3 skipped (276)
npx vitest run tests/skill-capabilities.test.ts -> 5 passed
```

## F. Live routing evidence (in-process Fastify inject, this branch, no service restarted)

```
GET /v2/capabilities -> 200 | total: 14 | SKILL:
  [{"id":"skill.obsidian-markdown","ops":["READ"],"status":"ACTIVE"},
   {"id":"skill.defuddle","ops":["READ","EXTERNAL"],"status":"ACTIVE"}]
GET /v2/capabilities/skill.defuddle -> 200 skill.defuddle

search q=defuddle               -> 200 | ids: ["skill.defuddle"]
search q=callout                -> 200 | ids: ["skill.obsidian-markdown"]
route READ     kinds=[SKILL]    -> 200 | disposition: ROUTE         | ids: ["skill.defuddle"]
route EXTERNAL kinds=[SKILL]    -> 200 | disposition: ROUTE         | ids: ["skill.defuddle"]
route WRITE    kinds=[SKILL]    -> 200 | disposition: NO_MATCH      | ids: []
route WRITE + environment=production + preferred_tags=[obsidian]
                                -> 200 | disposition: HUMAN_REVIEW  | ids: []
route READ targets=[".env"]     -> 200 | disposition: HUMAN_REVIEW  | policy: DENY SECRET_OR_CREDENTIAL_TARGET
```

Interpretation: project scope (`goffice2026`) reaches both skills for read/extraction work; **no `SKILL`
capability can be selected for a `WRITE`** — the entries declare none — so authorising a write still
requires a capability that actually declares `WRITE`, and the production-write and secret-target hard
policies keep gating that path. Note `search` matches the whole query string as one substring, so
multi-word queries return 0 — existing engine behaviour, unchanged by this work.

Revision note: the first revision of this branch declared `READ, WRITE` on `skill.obsidian-markdown` and
a live probe showed `route WRITE` selecting it — i.e. a context-only style guide would have been the
capability authorising a write for every project. Fixed to `READ` before merge; the probe above is the
post-fix run.

## G. Not verified / open

- Production service (`releases/5ae20af`, `127.0.0.1:8787`) was **not** restarted or redeployed.
- No `L0`/`L1` symbol exists in this repository, and no "AI-OS Blueprint v4.1" document was found on
  this host; policy guarantees were verified against `src/policy.ts`, the capability operation gate and
  the status gate instead.
- Vault was read only. No note was created, edited or deleted during this work.
