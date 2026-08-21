# Git workflow

This repository uses Conventional Commits and local Git hooks for fast feedback.
Remote CI repeats both Conventional Commit validation and the automated-tool
name rule for every commit introduced by a pull request or protected-branch
push. It remains the authoritative enforcement layer because local hooks can be
disabled or bypassed.

## Install the hooks

Install development dependencies from a Git checkout:

```powershell
pnpm install --frozen-lockfile
```

The `prepare` script installs Husky only when `.git` exists. It exits successfully
for source archives, production-only installs, CI with `CI=true`, and installations
with `HUSKY=0`. Restore or initialize the intended repository before expecting the
hooks to run. Verify an installation with:

```powershell
git config --get core.hooksPath
```

Husky normally reports `.husky/_`. Node and npm must be available to terminal and
GUI Git clients. Husky can load version-manager initialization from
`~/.config/husky/init.sh` on macOS/Linux or
`%USERPROFILE%\.config\husky\init.sh` on Windows.

## Repository provenance

The distributed source archive did not include Git metadata. On 2026-08-14 the
owner authorized initializing this checkout as the authoritative GitHub
repository. The initial import is a provenance boundary; it does not recreate
missing commits or attribute historical phase notes to a person. From this
point forward, Conventional Commits, hooks, CI, and protected-branch policy
govern published history.

## Commit messages

Use this structure:

```text
type(optional-scope): imperative summary

Optional body explaining why the change is needed and its operational impact.

Optional trailers
```

Examples:

```text
feat(vfs): add heading-aware search results
fix(cli): reject missing documentation roots
docs: document the stdio launcher configuration
chore(release): prepare 1.0.0
```

The accepted types come from `@commitlint/config-conventional`: `build`, `chore`,
`ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, and `test`.
Headers are limited to 100 characters. Bodies and footers require a blank line
before them and use a 100-character line limit.

The `commit-msg` hook rejects automated-tool names anywhere in the visible commit
message, including explicit attribution in `Co-authored-by` and `Signed-off-by`
trailers. It does not rewrite Git author/committer metadata, and it permits
ordinary human coauthors and sign-offs. Authorship must remain factual.
Tool assistance, when disclosure is useful, belongs in pull-request or review
notes rather than commit history or fabricated authorship metadata.

The `pre-commit` hook also rejects automated-tool names in the pending Git
author or committer identity. Remote CI repeats that check against each commit
object. Configure an accountable human identity or an explicitly approved
service account; never rewrite a real author's identity merely to make history
look cleaner.

Validate a message without creating a commit:

```powershell
pnpm exec commitlint --edit path\to\commit-message.txt
node scripts/git-hooks/reject-agent-attribution.mjs path\to\commit-message.txt
```

Run the repository-owned gate regression tests without Git metadata:

```powershell
pnpm run test:git-hooks
```

## Local gates

| Hook         | Gate                                                 | Boundary                                                        |
| ------------ | ---------------------------------------------------- | --------------------------------------------------------------- |
| `pre-commit` | Git identity plus lint-staged Oxlint/Prettier checks | Checks pending identity and staged paths; does not format files |
| `commit-msg` | commitlint and automated-attribution check           | Validates the proposed message only                             |
| `pre-push`   | lint, typecheck, and tests                           | Omits SEA builds and cold-start benchmarks                      |

`lint-staged --fail-on-changes` converts any unexpected task mutation into a
failure. Partially staged files may be temporarily isolated by lint-staged and are
restored before it exits; the configured tasks themselves are read-only. Run
`pnpm run format` deliberately, review the diff, and stage the result separately.

Do not make `--no-verify` a routine workflow. An emergency bypass requires the
same checks to be run manually and the reason recorded in the review. Server-side
branch protection and CI must repeat release-critical gates because client hooks
are not a trust boundary.

## History rewrite safety playbook

Use this playbook only for future published history after repository topology,
remotes, and ownership have been verified. The initial import is intentionally
not a history rewrite: there is no earlier Git object database to clean up.
Never create a replacement repository merely to make an old history rewrite
appear possible.

History rewriting changes commit identifiers and disrupts collaborators. Obtain
the repository owner's approval, freeze merges and pushes, notify every affected
collaborator, and use a dedicated clean worktree. Do not rewrite published tags or
release commits without explicit release-owner approval.

### 1. Capture topology and backups

Fetch first, confirm the target branch and a clean worktree, then record both the
local and remote tips:

```powershell
git fetch --all --prune --tags
git status --short
git branch --show-current
git log --oneline --decorate --graph --all -n 50

$rewriteStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupBranch = "backup/pre-history-rewrite-$rewriteStamp"
$backupTag = "backup-pre-history-rewrite-$rewriteStamp"
$remoteBeforeRewrite = git rev-parse refs/remotes/origin/main
$localBeforeRewrite = git rev-parse HEAD

git branch $backupBranch $localBeforeRewrite
git tag -a $backupTag $localBeforeRewrite -m "Backup before history rewrite $rewriteStamp"
git bundle create "..\Sumi-Docs-MCP-$rewriteStamp.bundle" --all
git bundle verify "..\Sumi-Docs-MCP-$rewriteStamp.bundle"
```

Store the bundle outside the worktree and retain the printed SHA values in the
change record. A local branch and tag make rollback convenient; the bundle is the
independent recovery artifact. Do not push backup refs containing sensitive data
to a public remote.

### 2. Choose the rewrite model

Use `git rebase -i <base>` only when the affected range is intentionally linear.
Use `git rebase -i --rebase-merges <base>` when meaningful merge topology must be
preserved. Inspect the graph before choosing; flattening merges is not cosmetic.

Use `reword` for message-only cleanup. Use `fixup` or `squash` only when combining
commits is semantically correct. Do not squash commits from different real authors
without their approval because that can discard attribution. Rewording preserves
the original author while changing the committer and commit ID. Never override
`GIT_AUTHOR_*`, use `--reset-author`, or replace a person's identity with a tool.

Remove nonconforming automated-agent `Co-authored-by` or `Signed-off-by` trailers
from commit messages while retaining all factual human attribution. Normalize the
remaining subject and body to the repository's Conventional Commit rules.

Abort an in-progress rewrite when evidence or scope becomes uncertain:

```powershell
git rebase --abort
```

### 3. Validate the rewritten range

Review authors, committers, signatures, topology, and semantic changes. A history
rewrite invalidates existing commit signatures; decide with the release owner
whether rewritten commits or tags must be re-signed.

```powershell
git log --format=fuller --decorate --graph
git range-diff <base>...$backupBranch <base>...HEAD
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm run example:smoke
pnpm pack --dry-run
```

Use the project-required Node version. Run SEA build, executable smoke test, and
cold-start benchmark as separate release gates when the rewrite is part of a
release. Do not treat a message-only range-diff as a substitute for tests.

### 4. Publish with a lease and verify

Fetch immediately before the maintenance window starts, then keep the collaboration
freeze in place. If `origin/main` no longer equals `$remoteBeforeRewrite`, stop and
re-plan. Push with an explicit lease tied to the previously observed remote SHA:

```powershell
git push --force-with-lease=refs/heads/main:$remoteBeforeRewrite origin HEAD:main
git ls-remote --exit-code origin refs/heads/main
git rev-parse HEAD
```

The SHA returned by `ls-remote` must equal local `HEAD`. Raw `--force` is not an
acceptable substitute. Re-enable branch protections and collaboration only after
remote refs, release tags, CI, and required checks have been verified.

### 5. Roll back if verification fails

Before publishing, return to the backup ref in a clean dedicated worktree. After a
published rewrite, freeze collaboration again and restore the backup ref with a new
explicit `--force-with-lease` whose expected value is the verified rewritten remote
SHA. Use placeholders deliberately rather than copying an unverified command:

```text
git push --force-with-lease=refs/heads/main:<rewritten-remote-sha> \
  origin <backup-ref>:refs/heads/main
```

Verify the remote ref and CI again. If local refs are unavailable, recover them
from the verified bundle in a separate directory. Retain backup refs and the bundle
until every collaborator has reconciled their local branches and the owner closes
the maintenance record.
