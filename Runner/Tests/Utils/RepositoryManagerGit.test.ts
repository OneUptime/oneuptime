/*
 * ---------------------------------------------------------------------------
 * Integration tests for RepositoryManager and GitCredentials against REAL git.
 *
 * These drive actual repositories on disk — local bare remotes cloned over
 * file:// — rather than asserting on mocked argv. That choice is deliberate:
 * the defects this file pins are all cases where the arguments looked
 * perfectly reasonable and git disagreed at runtime. Asserting "we passed
 * --all" would have kept passing through every one of them.
 *
 * The four things under test, and why each one costs a pull request when it
 * breaks:
 *
 *   1. THE TOKEN MUST NOT REACH DISK OR ARGV. Clone used to embed it in the
 *      remote URL, which persists it to .git/config — the repository the code
 *      agent then reads for thirty minutes with read_file and run_command —
 *      and puts it in every git error message, which the pipeline forwards to
 *      the server as the run's status where it is stored and displayed.
 *   2. THE PULL REQUEST'S BASE MUST BE WHAT WAS CLONED. It used to come from
 *      a stored column, so a stale value produced a PR whose diff is every
 *      commit between two branches instead of the fix.
 *   3. GIT MUST NOT WEDGE THE RUNNER. The code-fix loop is strictly serial:
 *      one hung git command stalls every queued fix for the project.
 *   4. THE COMMIT MUST BE THE AGENT'S CHANGE, NOTHING ELSE — not build
 *      output, and not whatever a repository hook decided to rewrite.
 * ---------------------------------------------------------------------------
 */

import RepositoryManager, {
  CloneResult,
  RepositoryConfig,
} from "../../Utils/RepositoryManager";
import GitCredentials, {
  GitCredentialHandle,
} from "../../Utils/GitCredentials";
import SecretRedactor from "../../Utils/SecretRedactor";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const TOKEN: string = "ghs_testtoken0123456789abcdefghijklmnop";

/*
 * These tests drive real `git` against real repositories on disk. jest's
 * 5-second default is comfortably enough on an idle machine and nowhere near
 * enough on a loaded CI runner — exactly the flake nobody can reproduce
 * locally, and a timed-out test leaves its git child running.
 */
jest.setTimeout(120000);

const temporaryPaths: Array<string> = [];

function makeTempDir(prefix: string): string {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(dir);
  return dir;
}

function git(cwd: string, args: Array<string>): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd },
  }).toString();
}

/*
 * A bare repository standing in for GitHub, with a non-obvious default branch
 * name so nothing can pass by accidentally defaulting to "main".
 */
function makeOriginRepository(data: {
  defaultBranch: string;
  extraBranches?: Array<string>;
}): string {
  const work: string = makeTempDir("oneuptime-origin-work-");
  const bare: string = makeTempDir("oneuptime-origin-bare-");

  git(bare, ["init", "-q", "--bare", "-b", data.defaultBranch, "."]);

  git(work, ["init", "-q", "-b", data.defaultBranch, "."]);
  git(work, ["config", "user.email", "origin@oneuptime.com"]);
  git(work, ["config", "user.name", "Origin"]);
  git(work, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(work, "README.md"), "# origin\n");
  fs.mkdirSync(path.join(work, "src"), { recursive: true });
  fs.writeFileSync(path.join(work, "src", "checkout.ts"), "export const a = 1;\n");
  git(work, ["add", "-A"]);
  git(work, ["commit", "-q", "-m", "baseline"]);
  git(work, ["remote", "add", "origin", bare]);
  git(work, ["push", "-q", "-u", "origin", data.defaultBranch]);

  for (const branch of data.extraBranches || []) {
    git(work, ["checkout", "-q", "-b", branch]);
    fs.writeFileSync(path.join(work, `${branch}.txt`), `${branch}\n`);
    git(work, ["add", "-A"]);
    git(work, ["commit", "-q", "-m", `work on ${branch}`]);
    git(work, ["push", "-q", "origin", branch]);
    git(work, ["checkout", "-q", data.defaultBranch]);
  }

  return bare;
}

function configFor(originPath: string, baseBranch?: string): RepositoryConfig {
  return {
    organizationName: "acme",
    repositoryName: "checkout",
    token: TOKEN,
    repositoryUrl: `file://${originPath}`,
    ...(baseBranch ? { baseBranch } : {}),
  };
}

afterEach(() => {
  SecretRedactor.clearRegistered();
});

afterAll(() => {
  for (const target of temporaryPaths) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("GitCredentials", () => {
  /*
   * The whole point of the askpass indirection: the secret travels in the
   * environment of one git child process, and the file on disk is a two-line
   * shell script that reads it. If the token were IN the script, this design
   * would be strictly worse than the URL it replaced.
   */
  test("the askpass helper on disk contains no secret", async () => {
    const handle: GitCredentialHandle = await GitCredentials.create(TOKEN);

    try {
      const scriptPath: string = handle.env["GIT_ASKPASS"] as string;
      const script: string = fs.readFileSync(scriptPath, "utf-8");

      expect(script).not.toContain(TOKEN);
      expect(script.startsWith("#!/bin/sh")).toBe(true);
    } finally {
      await handle.dispose();
    }
  });

  test("the helper is executable, 0700, and outside any repository workspace", async () => {
    const handle: GitCredentialHandle = await GitCredentials.create(TOKEN);

    try {
      const scriptPath: string = handle.env["GIT_ASKPASS"] as string;
      const mode: number = fs.statSync(scriptPath).mode & 0o777;

      expect(mode).toBe(0o700);
      expect(scriptPath.startsWith(GitCredentials.getBaseDir())).toBe(true);
      // Not inside the per-task workspace the code agent is handed.
      expect(scriptPath).not.toContain("oneuptime-ai-agent");
    } finally {
      await handle.dispose();
    }
  });

  // The mechanism has to actually work, not just look plausible.
  test("running the helper with the run's environment prints the token", async () => {
    const handle: GitCredentialHandle = await GitCredentials.create(TOKEN);

    try {
      const printed: string = execFileSync(
        handle.env["GIT_ASKPASS"] as string,
        ["Password for 'https://x-access-token@github.com':"],
        { env: handle.env, encoding: "utf-8" },
      ).toString();

      expect(printed).toBe(TOKEN);
    } finally {
      await handle.dispose();
    }
  });

  test("dispose removes the helper and is safe to call twice", async () => {
    const handle: GitCredentialHandle = await GitCredentials.create(TOKEN);
    const scriptPath: string = handle.env["GIT_ASKPASS"] as string;

    await handle.dispose();
    expect(fs.existsSync(scriptPath)).toBe(false);

    await expect(handle.dispose()).resolves.toBeUndefined();
  });

  test("GIT_TERMINAL_PROMPT=0 so a refused credential fails instead of hanging", async () => {
    const handle: GitCredentialHandle = await GitCredentials.create(TOKEN);

    try {
      expect(handle.env["GIT_TERMINAL_PROMPT"]).toBe("0");
    } finally {
      await handle.dispose();
    }
  });

  describe("buildRemoteUrl", () => {
    /*
     * This URL is what gets written into .git/config, where the code agent
     * can read it. It must be harmless there.
     */
    test("carries the username but never the token", () => {
      const url: string = GitCredentials.buildRemoteUrl({
        repositoryUrl: "https://github.com/acme/checkout.git",
        organizationName: "acme",
        repositoryName: "checkout",
      });

      expect(url).toContain("x-access-token@");
      expect(url).not.toContain(TOKEN);
      expect(url).toContain("github.com/acme/checkout.git");
    });

    test("strips a password a caller's URL already carried", () => {
      const url: string = GitCredentials.buildRemoteUrl({
        repositoryUrl: `https://x-access-token:${TOKEN}@github.com/acme/checkout.git`,
        organizationName: "acme",
        repositoryName: "checkout",
      });

      expect(url).not.toContain(TOKEN);
    });

    test("falls back to github.com when no URL is stored", () => {
      expect(
        GitCredentials.buildRemoteUrl({
          organizationName: "acme",
          repositoryName: "checkout",
        }),
      ).toBe("https://x-access-token@github.com/acme/checkout.git");
    });
  });

  test("cleanupOrphans reaps helpers a killed Runner left behind", async () => {
    const handle: GitCredentialHandle = await GitCredentials.create(TOKEN);
    const scriptPath: string = handle.env["GIT_ASKPASS"] as string;

    // Simulate the process dying before dispose() ran.
    expect(fs.existsSync(scriptPath)).toBe(true);

    const removed: number = await GitCredentials.cleanupOrphans();

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(scriptPath)).toBe(false);
  });
});

describe("cloneRepository", () => {
  test("clones into a directory named for the repository and reports the path", async () => {
    const origin: string = makeOriginRepository({ defaultBranch: "trunk" });
    const workDir: string = makeTempDir("oneuptime-work-");

    const result: CloneResult = await new RepositoryManager().cloneRepository(
      configFor(origin, "trunk"),
      workDir,
    );

    expect(fs.existsSync(path.join(result.repositoryPath, "README.md"))).toBe(
      true,
    );
    expect(result.workingDirectory).toBe(workDir);
    expect(path.dirname(result.repositoryPath)).toBe(workDir);
  });

  /*
   * The credential must not survive the clone. This is the check that would
   * have caught the original design: .git/config is inside the workspace the
   * code agent is given, and `cat .git/config` is a single tool call.
   */
  test("no credential is left anywhere in the cloned repository", async () => {
    const origin: string = makeOriginRepository({ defaultBranch: "main" });
    const workDir: string = makeTempDir("oneuptime-work-");

    const result: CloneResult = await new RepositoryManager().cloneRepository(
      configFor(origin, "main"),
      workDir,
    );

    const gitConfig: string = fs.readFileSync(
      path.join(result.repositoryPath, ".git", "config"),
      "utf-8",
    );

    expect(gitConfig).not.toContain(TOKEN);

    // And nothing else under .git either — FETCH_HEAD, logs, packed refs.
    const found: Array<string> = [];
    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          try {
            if (fs.readFileSync(full, "utf-8").includes(TOKEN)) {
              found.push(full);
            }
          } catch {
            // Binary or unreadable — nothing to assert.
          }
        }
      }
    };
    walk(path.join(result.repositoryPath, ".git"));

    expect(found).toEqual([]);
  });

  /*
   * The base branch is resolved from what git actually checked out. A record
   * whose mainBranchName went stale must not decide the pull request's base.
   */
  test("reports the branch it actually checked out as the base", async () => {
    const origin: string = makeOriginRepository({
      defaultBranch: "trunk",
      extraBranches: ["develop"],
    });
    const workDir: string = makeTempDir("oneuptime-work-");

    const result: CloneResult = await new RepositoryManager().cloneRepository(
      configFor(origin, "develop"),
      workDir,
    );

    expect(result.baseBranch).toBe("develop");
    expect(fs.existsSync(path.join(result.repositoryPath, "develop.txt"))).toBe(
      true,
    );
  });

  test("with no base branch requested, falls back to the remote's own default", async () => {
    const origin: string = makeOriginRepository({ defaultBranch: "trunk" });
    const workDir: string = makeTempDir("oneuptime-work-");

    const result: CloneResult = await new RepositoryManager().cloneRepository(
      configFor(origin),
      workDir,
    );

    // NOT "main" — the remote's real default is what the PR must target.
    expect(result.baseBranch).toBe("trunk");
  });

  /*
   * A stale mainBranchName must not cost the run. Falling back to the
   * remote's own default is strictly better than failing: the fix still gets
   * attempted, and the pull request targets what was actually checked out.
   */
  test("a base branch that no longer exists falls back to the remote's default", async () => {
    const origin: string = makeOriginRepository({ defaultBranch: "main" });
    const workDir: string = makeTempDir("oneuptime-work-");

    const result: CloneResult = await new RepositoryManager().cloneRepository(
      // The repository was renamed from master to main; the record is stale.
      configFor(origin, "master"),
      workDir,
    );

    expect(result.baseBranch).toBe("main");
    expect(fs.existsSync(path.join(result.repositoryPath, "README.md"))).toBe(
      true,
    );
  });

  /*
   * A run can resolve two repositories that share a name across different
   * organizations. Deriving the directory from the URL made the second clone
   * fail on a non-empty directory, losing that repository's fix entirely.
   */
  test("two repositories with the same name share one workspace without colliding", async () => {
    const originA: string = makeOriginRepository({ defaultBranch: "main" });
    const originB: string = makeOriginRepository({ defaultBranch: "main" });
    const workDir: string = makeTempDir("oneuptime-work-");
    const manager: RepositoryManager = new RepositoryManager();

    const a: CloneResult = await manager.cloneRepository(
      { ...configFor(originA, "main"), organizationName: "acme" },
      workDir,
    );
    const b: CloneResult = await manager.cloneRepository(
      { ...configFor(originB, "main"), organizationName: "beta" },
      workDir,
    );

    expect(a.repositoryPath).not.toBe(b.repositoryPath);
    expect(fs.existsSync(path.join(b.repositoryPath, "README.md"))).toBe(true);
  });

  /*
   * A failed clone must not put the credential in the thrown message: the
   * task handler puts that message straight into the run's status, which the
   * server stores and the dashboard renders.
   */
  test("a clone failure rejects with a message carrying no credential", async () => {
    const workDir: string = makeTempDir("oneuptime-work-");

    await expect(
      new RepositoryManager().cloneRepository(
        {
          organizationName: "acme",
          repositoryName: "checkout",
          token: TOKEN,
          repositoryUrl: `file://${path.join(workDir, "does-not-exist")}`,
        },
        workDir,
      ),
    ).rejects.toThrow();

    try {
      await new RepositoryManager().cloneRepository(
        {
          organizationName: "acme",
          repositoryName: "checkout",
          token: TOKEN,
          repositoryUrl: `file://${path.join(workDir, "does-not-exist")}`,
        },
        workDir,
      );
    } catch (error) {
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });
});

describe("branch, commit and push", () => {
  async function clonedRepository(defaultBranch: string = "main"): Promise<{
    origin: string;
    repositoryPath: string;
    config: RepositoryConfig;
    manager: RepositoryManager;
  }> {
    const origin: string = makeOriginRepository({ defaultBranch });
    const workDir: string = makeTempDir("oneuptime-work-");
    const config: RepositoryConfig = configFor(origin, defaultBranch);
    const manager: RepositoryManager = new RepositoryManager();
    const result: CloneResult = await manager.cloneRepository(config, workDir);

    return { origin, repositoryPath: result.repositoryPath, config, manager };
  }

  test("creates the branch, commits the staged change and pushes it to the remote", async () => {
    const { origin, repositoryPath, config, manager } =
      await clonedRepository();

    await manager.createBranch(repositoryPath, "oneuptime-fix-abc12345");
    fs.writeFileSync(
      path.join(repositoryPath, "src", "checkout.ts"),
      "export const a = 2;\n",
    );
    await manager.addPaths(repositoryPath, ["src/checkout.ts"]);
    await manager.commitChanges(repositoryPath, "fix: resolve TypeError");
    await manager.pushBranch(repositoryPath, "oneuptime-fix-abc12345", config);

    const remoteBranches: string = git(origin, ["branch", "--list"]);
    expect(remoteBranches).toContain("oneuptime-fix-abc12345");

    const pushedFile: string = git(origin, [
      "show",
      "oneuptime-fix-abc12345:src/checkout.ts",
    ]);
    expect(pushedFile).toContain("export const a = 2;");
  });

  test("pushing does not write the token into the remote URL", async () => {
    const { repositoryPath, config, manager } = await clonedRepository();

    await manager.createBranch(repositoryPath, "fix-branch");
    fs.writeFileSync(path.join(repositoryPath, "new.ts"), "export const b = 1;\n");
    await manager.addPaths(repositoryPath, ["new.ts"]);
    await manager.commitChanges(repositoryPath, "add file");
    await manager.pushBranch(repositoryPath, "fix-branch", config);

    const gitConfig: string = fs.readFileSync(
      path.join(repositoryPath, ".git", "config"),
      "utf-8",
    );

    expect(gitConfig).not.toContain(TOKEN);
  });

  /*
   * REGRESSION. `npm ci` in a setup command installs husky, which points
   * core.hooksPath at the repository's committed hooks. Those hooks then run
   * inside OUR commit: a lint-staged hook rewrites the files being committed,
   * and a failing pre-commit hook aborts the fix outright — after the clone,
   * the agent run and the verification loop. The repository's hooks are its
   * CI's business, and its CI will run them on the pull request.
   */
  test("a hostile pre-commit hook cannot abort or rewrite the fix commit", async () => {
    const { repositoryPath, manager } = await clonedRepository();

    const hooksDir: string = path.join(repositoryPath, ".githooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, "pre-commit"),
      "#!/bin/sh\necho 'refusing everything' >&2\nexit 1\n",
      { mode: 0o755 },
    );
    git(repositoryPath, ["config", "core.hooksPath", ".githooks"]);

    await manager.createBranch(repositoryPath, "fix-branch");
    fs.writeFileSync(
      path.join(repositoryPath, "src", "checkout.ts"),
      "export const a = 3;\n",
    );
    await manager.addPaths(repositoryPath, ["src/checkout.ts"]);

    await expect(
      manager.commitChanges(repositoryPath, "fix: applied despite hooks"),
    ).resolves.toBeUndefined();

    expect(git(repositoryPath, ["log", "-1", "--pretty=%s"])).toContain(
      "fix: applied despite hooks",
    );
  });

  test("hasStagedChanges distinguishes a real change from an empty commit", async () => {
    const { repositoryPath, manager } = await clonedRepository();

    await manager.createBranch(repositoryPath, "fix-branch");
    expect(await manager.hasStagedChanges(repositoryPath)).toBe(false);

    fs.writeFileSync(path.join(repositoryPath, "added.ts"), "export const c = 1;\n");
    await manager.addPaths(repositoryPath, ["added.ts"]);

    expect(await manager.hasStagedChanges(repositoryPath)).toBe(true);
  });
});

describe("getChangedFiles against real repository states", () => {
  async function dirtyRepository(): Promise<{
    repositoryPath: string;
    manager: RepositoryManager;
  }> {
    const origin: string = makeOriginRepository({ defaultBranch: "main" });
    const workDir: string = makeTempDir("oneuptime-work-");
    const manager: RepositoryManager = new RepositoryManager();
    const result: CloneResult = await manager.cloneRepository(
      configFor(origin, "main"),
      workDir,
    );

    return { repositoryPath: result.repositoryPath, manager };
  }

  /*
   * The end-to-end version of the GitPorcelain unit tests: these exact shapes
   * used to produce pathspecs `git add` rejects with exit 128, aborting the
   * repository with the fix already written.
   */
  test("a rename, a spaced path and a new directory all come back stageable", async () => {
    const { repositoryPath, manager } = await dirtyRepository();

    git(repositoryPath, ["mv", "src/checkout.ts", "src/checkout-renamed.ts"]);
    fs.writeFileSync(path.join(repositoryPath, "a file with spaces.ts"), "x\n");
    fs.mkdirSync(path.join(repositoryPath, "generated", "deep"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(repositoryPath, "generated", "deep", "new.ts"),
      "y\n",
    );

    const changed: Array<string> = await manager.getChangedFiles(
      repositoryPath,
    );

    expect(changed).toContain("src/checkout-renamed.ts");
    expect(changed).toContain("src/checkout.ts");
    expect(changed).toContain("a file with spaces.ts");
    // -uall: the file, not the collapsed directory.
    expect(changed).toContain("generated/deep/new.ts");
    expect(changed).not.toContain("generated/");

    // The real proof: git accepts every one of them as a pathspec.
    await expect(
      manager.addPaths(repositoryPath, changed),
    ).resolves.toBeUndefined();

    const staged: Array<string> = git(repositoryPath, [
      "diff",
      "--cached",
      "--name-only",
    ])
      .split("\n")
      .filter((line: string) => {
        return line.length > 0;
      });

    expect(staged).toContain("a file with spaces.ts");
    expect(staged).toContain("generated/deep/new.ts");
  });

  test("a clean tree reports nothing changed", async () => {
    const { repositoryPath, manager } = await dirtyRepository();

    expect(await manager.getChangedFiles(repositoryPath)).toEqual([]);
    expect(await manager.hasChanges(repositoryPath)).toBe(false);
  });
});

describe("discardChanges", () => {
  /*
   * REGRESSION. `git checkout .` restores tracked files from the INDEX, so it
   * leaves staged changes staged and untracked files in place — a "discard"
   * that discards nothing once anything has been staged.
   */
  test("discards staged changes and untracked files, not just unstaged edits", async () => {
    const origin: string = makeOriginRepository({ defaultBranch: "main" });
    const workDir: string = makeTempDir("oneuptime-work-");
    const manager: RepositoryManager = new RepositoryManager();
    const { repositoryPath }: CloneResult = await manager.cloneRepository(
      configFor(origin, "main"),
      workDir,
    );

    fs.writeFileSync(
      path.join(repositoryPath, "src", "checkout.ts"),
      "export const a = 99;\n",
    );
    fs.writeFileSync(path.join(repositoryPath, "untracked.ts"), "junk\n");
    await manager.addPaths(repositoryPath, ["src/checkout.ts"]);

    await manager.discardChanges(repositoryPath);

    expect(await manager.getChangedFiles(repositoryPath)).toEqual([]);
    expect(
      fs.readFileSync(path.join(repositoryPath, "src", "checkout.ts"), "utf-8"),
    ).toContain("export const a = 1;");
    expect(fs.existsSync(path.join(repositoryPath, "untracked.ts"))).toBe(false);
  });
});
