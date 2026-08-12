/*
 * ---------------------------------------------------------------------------
 * Unit tests for CodeAgentWorkspaceGuard.evaluateCommand — the rail that keeps
 * the code agent's shell out of the repository's git state.
 *
 * The pipeline owns git: it cuts the branch, decides what to stage, writes the
 * commit and pushes. It also decides "did the agent change anything" by
 * looking at the working tree. So a model that helpfully runs `git commit`
 * does not merely duplicate work — it leaves a CLEAN tree behind, the run
 * reports no changes, and the fix is discarded without anyone seeing it. A
 * `git checkout .` erases the fix outright; a `git push` puts a branch on the
 * customer's remote that no pull request points at.
 *
 * The system prompt already tells the model not to do this. These tests exist
 * because an instruction is not a control.
 *
 * What this is NOT: a sandbox. Shell is too expressive to filter
 * adversarially, and the tests below say so explicitly where it matters. The
 * containment boundary is elsewhere — the workspace is ephemeral, the
 * credential is not in it, and nothing merges without a human. This guard
 * stops a well-meaning model taking an obvious wrong turn, and the read-only
 * git the agent genuinely needs stays available.
 * ---------------------------------------------------------------------------
 */

import CodeAgentWorkspaceGuard, {
  CommandGuardDecision,
} from "../../../../Server/Utils/AI/CodeFix/CodeAgentWorkspaceGuard";

function evaluate(command: string): CommandGuardDecision {
  return CodeAgentWorkspaceGuard.evaluateCommand(command);
}

describe("commands the agent must be able to run", () => {
  /*
   * Building and testing IS the point of run_command — the verification loop
   * depends on the agent being able to check its own work. A guard that broke
   * these would be worse than no guard, because the agent would stop
   * self-checking and the pull requests would get worse.
   */
  test.each([
    "npm test",
    "npm ci && npm run build",
    "yarn jest src/checkout.test.ts",
    "pytest -q",
    "go build ./...",
    "make lint",
    "ls -la src",
    "cat package.json",
    "grep -rn 'checkout' src",
    'node -e "console.log(1)"',
    "./gradlew test --no-daemon",
  ])("allows %s", (command: string) => {
    expect(evaluate(command).allowed).toBe(true);
  });

  /*
   * Read-only git is how an agent orients itself in an unfamiliar repository:
   * what changed, what the history says, who touched this line. Refusing it
   * would make the agent worse at the job without making anything safer.
   */
  test.each([
    "git status",
    "git diff",
    "git diff --staged",
    "git log --oneline -20",
    "git show HEAD",
    "git grep -n TODO",
    "git blame src/checkout.ts",
    "git ls-files",
    "git rev-parse HEAD",
    "git describe --tags",
  ])("allows read-only git: %s", (command: string) => {
    expect(evaluate(command).allowed).toBe(true);
  });
});

describe("git commands that would destroy or bypass the pipeline", () => {
  /*
   * `commit` and `checkout`/`reset` are the two that silently lose the fix:
   * both leave a clean working tree, which the pipeline reads as "the agent
   * changed nothing" — so the run reports no fix found and the work is gone.
   */
  test.each([
    "git commit -m 'fix'",
    "git commit -am wip",
    "git push",
    "git push origin HEAD",
    "git push --force",
    "git reset --hard",
    "git checkout .",
    "git checkout -- src/checkout.ts",
    "git switch main",
    "git restore src/checkout.ts",
    "git stash",
    "git clean -fd",
    "git rebase main",
    "git merge origin/main",
    "git cherry-pick abc123",
    "git revert HEAD",
    "git apply patch.diff",
    "git remote set-url origin https://example.com",
    "git config user.email nobody@example.com",
  ])("refuses %s", (command: string) => {
    const decision: CommandGuardDecision = evaluate(command);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBeTruthy();
  });

  /*
   * The refusal is handed straight back to the model as the tool result, so
   * it has to teach rather than just deny — otherwise the model retries the
   * same command and burns the run's LLM budget doing it.
   */
  test("the refusal explains what to do instead", () => {
    const reason: string = evaluate("git commit -m x").reason || "";

    expect(reason).toContain("write_file");
    // It says what IS still available, so the agent does not stop using git entirely.
    expect(reason.toLowerCase()).toContain("read-only git");
  });
});

describe("the forms a model actually emits", () => {
  /*
   * Models chain commands constantly ("run the tests and then commit"). A
   * guard that only inspects the first word of the string would wave every
   * one of these through.
   */
  test.each([
    "npm test && git commit -am 'fix'",
    "npm test ; git push",
    "npm test || git reset --hard",
    "cd src && git checkout .",
    "npm run build\ngit commit -m done",
    "echo start; npm test; git push origin fix",
  ])("sees the git in a chained command: %s", (command: string) => {
    expect(evaluate(command).allowed).toBe(false);
  });

  test("sees git inside a subshell or command substitution", () => {
    expect(evaluate("(git push)").allowed).toBe(false);
    expect(evaluate("echo $(git commit -m x)").allowed).toBe(false);
    expect(evaluate("echo `git push`").allowed).toBe(false);
  });

  test("sees git behind a leading environment assignment", () => {
    expect(evaluate("GIT_AUTHOR_NAME=x git commit -m y").allowed).toBe(false);
    expect(
      evaluate("GIT_AUTHOR_NAME=x GIT_AUTHOR_EMAIL=y@z git push").allowed,
    ).toBe(false);
  });

  test("sees git invoked by absolute path or quoted", () => {
    expect(evaluate("/usr/bin/git push").allowed).toBe(false);
    expect(evaluate('"git" commit -m x').allowed).toBe(false);
  });

  /*
   * git's own global options come BEFORE the subcommand, and two of them
   * consume the following token. `git -C sub push` must not read as
   * subcommand "-C".
   */
  test("skips git's global options to find the real subcommand", () => {
    expect(evaluate("git -C packages/api push").allowed).toBe(false);
    expect(evaluate("git -c user.name=x commit -m y").allowed).toBe(false);
    expect(evaluate("git --git-dir .git push").allowed).toBe(false);
    expect(evaluate("git --no-pager log -5").allowed).toBe(true);
    expect(evaluate("git -C packages/api status").allowed).toBe(true);
  });

  test("is case-insensitive about the subcommand", () => {
    expect(evaluate("git PUSH").allowed).toBe(false);
  });
});

describe("what the guard deliberately does not claim", () => {
  /*
   * Stated as a test so nobody mistakes this for a security boundary later.
   * A determined adversary reaches git through an alias, a wrapper script, a
   * variable, or a language runtime — and that is fine, because this guard is
   * not what makes the harness safe. The real boundary is that the workspace
   * is ephemeral and credential-free, and that a human merges.
   */
  test("an aliased or indirect invocation is not caught — this is a rail, not a sandbox", () => {
    expect(evaluate("g=git; $g push").allowed).toBe(true);
    expect(
      evaluate("node -e \"require('child_process').execSync('git push')\"")
        .allowed,
    ).toBe(true);
  });

  test("a command merely mentioning git in text is allowed", () => {
    // The word appears, but nothing invokes git.
    expect(evaluate("echo 'do not run git push here'").allowed).toBe(true);
    expect(evaluate("grep -rn 'git commit' docs/").allowed).toBe(true);
  });

  test("an empty or whitespace command is allowed (the caller rejects it first)", () => {
    expect(evaluate("").allowed).toBe(true);
    expect(evaluate("   ").allowed).toBe(true);
  });
});
