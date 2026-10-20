# Obsidian handoff — 2026-10-21 (manual)

**Approved path per** `vault/30-Systems/AI-OS/MEMORY_CONTRACT.md`: durable project state belongs in Obsidian (`/home/prinyaroot/obsidian-vault`). No Hermes `hermes_memory` write or vault automation was run in this closeout.

**Suggested destination:** `30-Systems/AI-OS/` or `10-Projects/agent-core/` — one note titled `Agent Core Groq staging 2026-10-21`.

**Paste summary (facts only):**

- GitHub `main` @ `41195f6` — Groq inference pilot merged (PR #38); production VPS still `dbe20a5` on `:8787`.
- Isolated Groq **staging** on VPS 237: `127.0.0.1:8788`, unit `agent-core-groq-staging.service`, **not** production activation.
- Hermes skill `integrations/agent-core-groq-inference` — CONTEXT_ONLY HTTP to Agent Core staging.
- Open: PR #39 governance (ADR 0002 draft); orphan ports `18881–18888` optional cleanup.
- Repo source of truth: `docs/memory/2026-10-21.md`, `docs/STATUS.md` (Groq section).

Delete this handoff file after the note exists in Obsidian, or link the Obsidian path in `CURRENT_STATE.md`.
