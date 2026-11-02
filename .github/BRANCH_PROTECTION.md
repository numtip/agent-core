# Branch protection on `main`

Ruleset **`protect-main`** (id `26361513`) · enforcement `active` · covers `~DEFAULT_BRANCH` · no cost, available
on a public repo.

| Rule | Setting |
|---|---|
| `deletion` | `main` cannot be deleted |
| `non_fast_forward` | force-push is refused |
| `pull_request` | changes must come through a PR · required approvals **0** (the owner merges own PRs) · allowed methods `squash`, `merge` |
| `required_status_checks` | the GitHub Actions check named **`test`** must pass · `strict` off, so a green run on the PR head is enough (no forced rebase) |

## Emergency bypass (owner only)

`bypass_actors: [{actor_id: 5, actor_type: RepositoryRole, bypass_mode: always}]` → the repository **admin** role
may bypass every rule in this ruleset: push a hotfix straight to `main`, force-push, or merge a PR with red
checks.

Deliberate trade-off: `bypass_mode: always` is what makes a genuine emergency push possible. Anyone with admin
on this repository is also the person entitled to break the build, so the channel is not a widening of trust —
but it does mean a direct push to `main` skips the `test` gate and must be justified in the commit message.
Narrow it to `pull_requests_only` if the emergency case is "merge without waiting for CI" rather than "push a
file right now".

## Verify / operate

```bash
gh api repos/numtip/agent-core/rulesets --jq '.[] | "\(.id) \(.name) \(.enforcement)"'
gh api repos/numtip/agent-core/rules/branches/main --jq '.[].type'
gh api repos/numtip/agent-core/rulesets/26361513 --jq '{bypass_actors, current_user_can_bypass}'
```

Expected: the four rule types above, `current_user_can_bypass: "always"` for the owner, `"never"` for everyone
else.

## Rollback

```bash
gh api -X DELETE repos/numtip/agent-core/rulesets/26361513
```

Removes all protection immediately; branches, commits and CI are untouched.
