# Code-fix harness audit

An end-to-end audit of the pipeline that clones a customer's repository, lets
an LLM edit it, verifies the result and opens a pull request:

```
PollCodeFixWork  →  TaskHandler  →  RepositoryManager (clone, branch)
                                 →  InHouseCodeAgent  (the tool loop)
                                 →  BuildVerification (setup/build/test + repair)
                                 →  RepositoryManager (stage, commit, push)
                                 →  PullRequestCreator (open the PR)
```

Scope: `Runner/` (the worker), plus the pure guards it shares in
`Common/Server/Utils/AI/CodeFix/`. The server-side control plane
(`Common/Server/API/AIAgentDataAPI.ts`, the GitHub token minting in
`Common/Server/Utils/CodeRepository/GitHub/GitHub.ts`) was audited but is
**not** changed here — see [Not fixed here](#not-fixed-here).

Every finding below was reproduced against the real thing (real git
repositories, real `execFile` behaviour, a scripted tool loop) before being
fixed, and every fix has a regression test that was confirmed to **fail**
against the pre-fix code.

---

## Fixed

### 1. The GitHub token reached logs, the database and the model — critical

`RepositoryManager` embedded the installation token in the clone/push URL.
Three consequences, all reachable in an ordinary run:

- **Into the database and the dashboard.** Node's `execFile` puts the whole
  command line into the rejected `Error`'s message. Verified:

  ```
  Command failed: git clone https://x-access-token:ghs_…@github.com/acme/app.git
  fatal: Authentication failed for 'https://github.com/acme/app.git/'
  ```

  The task handler pushes that message into `errors[]`, which becomes the
  run's `statusMessage`, which the server stores and the dashboard renders.
  Any failed clone or push published a live credential.
- **Into the workspace the model reads.** `git clone` persists the
  authenticated URL to `.git/config`. The code agent then works in that
  repository for up to thirty minutes with `read_file` and `run_command`, so
  a single `cat .git/config` hands the token to the model — and from there
  to the transcript that is shipped to the server.
- **Into `ps`.** Anything on the Runner host could read it out of argv.

**Fix.** `Runner/Utils/GitCredentials.ts`: authentication moves to a
`GIT_ASKPASS` helper. The remote URL carries the username only, the token
travels in the environment of the individual git child process (never
`process.env`, which the agent's `run_command` inherits), and the helper
script itself contains no secret — it echoes an environment variable and
lives 0700 outside the workspace. `Runner/Utils/SecretRedactor.ts` is the
defence in depth: it redacts run-registered secrets, environment secrets,
URL credentials and well-known token shapes out of every string leaving the
process — git errors, command output, and the log/transcript stream.

### 2. Renames, spaces and new directories aborted the pull request — high

`git status` output was parsed with `line.substring(3)` in three places. Three
real repository states defeat that, and every parsed path is handed to
`git add`, which exits 128 on a pathspec it cannot resolve — aborting the
repository with the fix written, verified, and then thrown away.

Reproduced against real git; the old parser returned:

| Repository state | Old parser produced | `git add` result |
|---|---|---|
| `git mv src/checkout.ts src/checkout-renamed.ts` | `src/checkout.ts -> src/checkout-renamed.ts` | fatal: pathspec did not match |
| a file named `a file with spaces.ts` | `"a file with spaces.ts"` (quotes included) | fatal: pathspec did not match |
| a new `generated/deep/` directory | `generated/` | over-stages the whole directory |

`BuildVerification.listDirtyPaths` had the same defect in a subtler form: it
split the `-z` stream on NUL and sliced three characters off **every** record,
including a rename's bare source-path record — turning `src/old.ts` into
`/old.ts`, which git rejects as "outside repository".

**Fix.** `Runner/Utils/GitPorcelain.ts` — one parser, always
`--porcelain -uall -z`, renames consume their source record, both sides of a
rename are staged.

### 3. A failed agent was reported as "no fix found" — high

```ts
if (!agentResult.success || agentResult.filesModified.length === 0) {
  return null;                       // → the run reports NoFixFound
}
```

`success: false` is only ever a hard failure: the server was unreachable, the
run's LLM budget was exhausted, it timed out, it was aborted. All of it was
presented to the user as *"the AI looked at your bug and decided there was
nothing to fix"* — a confident, wrong-shaped answer nobody investigates, which
also suppresses the error rate the feature is judged on.

**Fix.** A hard failure throws (→ `Error`, with the real cause in the
message); only a clean run with an empty diff returns null (→ `NoFixFound`).
Applied to both pipeline bases.

### 4. `write_file` with no `content` silently emptied a source file — high

`const content: string = (args["content"] as string) ?? "";` — a completion cut
off mid `tool_use` (the per-call cap is 16,384 output tokens) arrives as a
well-formed `write_file` whose `content` never made it. The file was truncated
to zero bytes, the model was told *"Wrote 0 characters"*, and the empty file
flowed on as a legitimate edit. For a repository with no build/test commands
configured, verification is `Skipped` and nothing catches it — the pull request
deletes the contents of a source file.

**Fix.** A non-string `content` is refused with an explanation. An explicit
`""` still works. A 2 MB per-file cap stops a looping model filling the disk.

### 5. The pull request targeted a stale base branch — high

The base came from the stored `mainBranchName` column, while the clone checked
out whatever the remote actually had. When the column is stale (renamed
default branch, a record that predates the change) GitHub either rejects the
base or — worse — accepts it and the pull request's diff becomes every commit
between the two branches instead of the fix.

**Fix.** `cloneRepository` reports the branch it actually checked out;
the PR and the recorded `baseRefName` both use that.

### 6. The agent could destroy its own work with git — high

`run_command` ran arbitrary shell with no guard. `git commit` leaves a **clean
working tree**, and the pipeline decides "did the agent change anything" from
the working tree — so a model that helpfully committed its own work made the
run report no changes and the fix was discarded silently. `git checkout .`
erased it outright; `git push` would put a branch on the customer's remote
with no pull request pointing at it.

**Fix.** `CodeAgentWorkspaceGuard.evaluateCommand` refuses repository-mutating
git (`push`, `commit`, `reset`, `checkout`, `stash`, `rebase`, …) across
chained commands, subshells, env-prefixed invocations and `git -C`. Read-only
git stays available. This is a rail against a well-meaning model, **not** a
sandbox — the code and its tests say so explicitly.

### 7. Build output was committed as part of the fix — high

`filesModified` was "everything dirty after the tool loop", which includes
whatever a `run_command` produced. An agent that ran a build to check its work
put every non-ignored artifact of that build into the customer's pull request.

**Fix.** The agent tracks what it authored (`write_file`) and what appeared
while a command was running, and reports the difference. A file the model
wrote is always kept, even if a command rewrote it afterwards.

### 8. A hung git command wedged every queued fix — high

No git invocation passed `timeoutInMS`, and the code-fix loop is strictly
serial. One stalled clone (unreachable host mid-transfer, pathological
repository) stalls every queued fix for the project until the container
restarts. The 30-minute agent timeout does not cover the clone that precedes
it.

**Fix.** Per-operation timeouts: 10 min clone, 5 min push, 60 s for everything
else.

### 9. Repository hooks ran inside the fix commit — medium

A `setupCommand` of `npm ci` installs husky, which points `core.hooksPath` at
the repository's committed hooks. Those hooks then ran inside *our* commit: a
`lint-staged` hook rewrites the files being committed, a failing `pre-commit`
hook aborts the fix outright — after the clone, the agent run and the
verification loop.

**Fix.** `git commit --no-verify`. The repository's hooks are its CI's
business, and its CI runs them on the pull request.

### 10. A leaked timer per task, forever — medium

`TaskLogger` starts a repeating flush timer in its constructor; only
`dispose()` stops it, and the loop called `flush()`. Every task the Runner had
ever processed left a live interval behind, each waking every five seconds and
POSTing to the server on behalf of a run that finished hours ago.

**Fix.** `dispose()` in a `finally`, alongside clearing the run's registered
secret.

### 11. Abandoned workspaces accumulated forever — medium

`cleanupOldWorkspaces` matched `/task-[^-]+-(\d+)-[^-]+/` against a directory
named `task-<taskId>-<timestamp>-<uid>` — but a task id is a **UUID**, so the
hyphen-free field the pattern needed never existed. The sweeper reaped
nothing, ever; its own tests passed because they hand-wrote fixture names that
happened to fit. Every workspace a killed Runner left behind (a full clone
each) stayed on disk for the life of the volume.

**Fix.** The timestamp leads the directory name, the sweeper is actually
called at startup, and the regression test builds its fixture through
`createWorkspace` with a real UUID.

### 12. Smaller ones

| Finding | Fix |
|---|---|
| `deleteWorkspace`'s `startsWith(base)` also accepted siblings (`/tmp/oneuptime-ai-agent-backup`) | separator-anchored, matching `resolveWorkspacePath` |
| `discardChanges` used `git checkout .`, which leaves staged changes and untracked files | `reset --hard` + `clean -fd` |
| A PR body over GitHub's 65,536-char limit 422'd **after** the branch was pushed | truncated with a visible marker |
| A path deleted by a build step made `git add` fatal | vanished paths filtered, tracked deletions still staged |
| `run_command` inherited `ONEUPTIME_RUNNER_KEY`, and the command is composed by a model reading untrusted repository content | stripped from the child environment |
| `update-task-status(InProgress)` failing skipped a **claimed** run with no backoff, burning through the queue | sleep before the next claim |
| Two repositories with the same name across orgs collided in one workspace | org-qualified clone directory |
| Clone fetched every branch | `--single-branch` on the branch being fixed |

---

## Not fixed here

Confirmed by adversarial verification, but server-side and a different trust
boundary — each needs its own change and its own review:

1. **`/ai-agent-data/get-repository-token` has no run binding.** It authorizes
   on a bare agent credential with no check that the caller claimed the run,
   and `AIAgent` rows are self-issuable by any `ProjectMember`. A
   low-privileged member can mint a live GitHub token.
2. **The installation token is not scoped to the repository.** `GitHub.ts`
   sends `permissions` but no `repository_ids`, so the token minted to fix one
   repository is valid for **every** repository in the installation, with
   `contents:write`.
3. **The open-PR cap is check-then-act**, so concurrent runs can exceed it.
4. **`recordPullRequest` accepts terminal and unowned runs.**
5. **A PR the sync job can never reach stays open forever**, deadlocking the
   cap.
6. **The installation token is never refreshed.** It expires in an hour; a
   30-minute agent run plus a 15-minute-per-command verification loop can
   outlive it, so the push fails at the very end with everything done.

Also worth a follow-up, non-security:

- **`ExceptionPullRequestTaskHandler` and `SubjectPullRequestTaskHandler` are
  ~90% duplicates.** Every fix in this audit had to be applied twice. They
  should share one `processRepository`.
- **No retry/backoff on the GitHub API** (5xx, secondary rate limits).
- **`findExistingPullRequest`, `updatePullRequest`, `addLabels`,
  `requestReviewers` are dead code.** Nothing dedupes or updates an existing
  PR, so a retried run pushes to a branch that already exists.
- **Nothing shows the reviewer the diff**, and no self-review pass runs before
  the PR opens.
- **The agent has no edit/patch tool** — every change is a whole-file rewrite,
  which is the root cause of finding 4 and costs output tokens on every edit.
- **Message history is never pruned**, so a long run re-uploads its whole
  transcript on every turn.

---

## Test coverage added

| File | What it pins |
|---|---|
| `Runner/Tests/Utils/GitPorcelain.test.ts` | rename/copy record pairing, verbatim paths, dedup, no mangled paths |
| `Runner/Tests/Utils/SecretRedactor.test.ts` | registered + env + pattern redaction, ordering, label preservation, idempotence, ordinary output untouched |
| `Runner/Tests/Utils/RepositoryManagerGit.test.ts` | real clones: no credential anywhere under `.git`, base-branch resolution and stale-branch fallback, same-name repos, hostile pre-commit hook, rename/space/new-dir staging, discard |
| `Runner/Tests/Utils/VerificationDirtyPaths.test.ts` | the repair loop's path diff against real repository states — renames, quoted paths, deletions, gitignored output, and that every path it emits is one `git add` accepts |
| `Runner/Tests/Utils/TaskLoggerRedaction.test.ts` | redaction of messages, tool arguments and tool results on the way to the server; buffering, batching, and never failing the run |
| `Runner/Tests/Utils/PullRequestCreatorApi.test.ts` | GitHub error reporting (the `errors` array, not "Validation Failed"), lookup/update, decoration never failing the run, and the title/body privacy boundary |
| `Runner/Tests/Utils/PullRequestBodyLimit.test.ts` | GitHub's body limit |
| `Runner/Tests/CodeAgents/InHouseCodeAgentTools.test.ts` | scripted tool loop against a real repo: write_file refusals, git guard, build-artifact exclusion, secret redaction, env stripping, grandchild lifetime |
| `Runner/Tests/CodeAgents/InHouseCodeAgentLoop.test.ts` | the loop as a control system: budget wind-down (calls and output tokens), the provider's tool-call/result pairing contract, truncation, timeout, abort, hard-failure reporting |
| `Runner/Tests/TaskHandlers/CodeAgentOutcomeTaxonomy.test.ts` | failure vs no-fix vs PR, on **both** pipeline bases; PR base from the clone |
| `Runner/Tests/TaskHandlers/MultiRepositoryOutcomes.test.ts` | how N repositories collapse into one run status, including partial success carrying its failures |
| `Runner/Tests/Jobs/CodeFixTaskLifecycle.test.ts` | logger disposal, secret clearing, outcome mapping |
| `Common/Tests/Server/Utils/AI/CodeAgentCommandGuard.test.ts` | the git rail, including what it deliberately does not claim |
| `Common/Tests/Server/Utils/AI/CodeAgentWriteLimits.test.ts` | the write and tool-output caps, and workspace escape against the paths a model actually emits |

Runner: **280 → 508** tests. Common: **+79**.

Every regression test in this set was confirmed to **fail** against the pre-fix
code before the fix was accepted — by reverting each guard in turn and
re-running. One of them (`TaskLoggerRedaction`) caught a real defect in the
redactor written for this audit: the URL-credential pattern pass was
overwriting the informative `[redacted:repository-token]` label with the
anonymous marker.
