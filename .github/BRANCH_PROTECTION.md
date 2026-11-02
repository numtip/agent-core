# Branch protection on `main`

Ruleset **`protect-main`** (id `26361513`) · enforcement `active` · covers `~DEFAULT_BRANCH` · no cost, available
on a public repo.

| Rule | Setting |
|---|---|
| `deletion` | `main` cannot be deleted |
| `non_fast_forward` | force-push is refused |
| `pull_request` | changes must come through a PR · required approvals **0** (the owner merges own PRs) · allowed methods `squash`, `merge` |
| `required_status_checks` | the GitHub Actions check named **`test`** must pass · `strict` off, so a green run on the PR head is enough (no forced rebase) |

## Emergency bypass (PR-only, admin role)

`bypass_actors: [{actor_id: 5, actor_type: RepositoryRole, bypass_mode: pull_request}]` → the repository **admin**
role may merge a pull request without waiting for — or despite — the required `test` check. It **cannot** push a
commit straight to `main`: the `pull_request` rule still refuses that, which keeps CI from being skipped by a push.

That is the whole emergency channel now: a hotfix still travels through a PR (so the change is reviewable and
recorded), it just does not have to wait for a green run. If a genuine "get this file in right now" case appears,
the admin lifts the ruleset briefly and restores it — an explicit, visible act.

History: the ruleset first shipped with `bypass_mode: always`, which let the admin (and therefore any token
belonging to the owner, including an agent using it) push directly to `main`. Verified by a real push
(`194f589..179ddd0`) and then narrowed to `pull_request` on 2026-11-02 so no automated workflow can bypass CI.


## Verify / operate

```bash
gh api repos/numtip/agent-core/rulesets --jq '.[] | "\(.id) \(.name) \(.enforcement)"'
gh api repos/numtip/agent-core/rules/branches/main --jq '.[].type'
gh api repos/numtip/agent-core/rulesets/26361513 --jq '{bypass_actors, current_user_can_bypass}'
```

Expected: the four rule types above, `current_user_can_bypass: "pull_requests_only"` for the admin role,
`"never"` for everyone else, and `bypass_mode: "pull_request"` on the actor.

## Rollback

```bash
gh api -X DELETE repos/numtip/agent-core/rulesets/26361513
```

Removes all protection immediately; branches, commits and CI are untouched.
