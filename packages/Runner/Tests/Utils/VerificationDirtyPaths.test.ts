/*
 * ---------------------------------------------------------------------------
 * BuildVerification.listDirtyPaths against real repository states.
 *
 * This is the function that decides which files a REPAIR pass added, and its
 * answer is handed directly to `git add`. That makes it one of two places
 * where a mis-parsed path does not degrade the pull request but DESTROYS it:
 * `git add` exits 128 on a pathspec it cannot resolve, the exception
 * propagates out of processRepository, and the repository is abandoned with
 * the fix written, verified, and never committed.
 *
 * The specific defect these pin: `git status --porcelain -z` writes a rename
 * as TWO NUL-terminated fields — `R  <new>` then a bare `<old>` carrying no
 * status prefix. The previous implementation split on NUL and sliced three
 * characters off EVERY field, so the source path `src/old.ts` came back as
 * `/old.ts` — which git rejects outright as "outside repository". The old
 * code's own comment claimed that second field was "dropped"; it was not, it
 * was mangled and then passed to `git add`.
 *
 * A rename during a repair pass is not exotic. "Extract this into its own
 * module" and "this file is misnamed" are among the most ordinary things a
 * repair prompt produces.
 * ---------------------------------------------------------------------------
 */

import BuildVerification from "../../Utils/BuildVerification";
import RepositoryManager from "../../Utils/RepositoryManager";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

jest.setTimeout(120000);

const temporaryPaths: Array<string> = [];

function git(repositoryPath: string, args: Array<string>): string {
  return execFileSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf-8",
  }).toString();
}

function makeRepository(): string {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-verify-paths-"),
  );
  temporaryPaths.push(dir);

  git(dir, ["init", "-q", "-b", "main", "."]);
  git(dir, ["config", "user.email", "tests@oneuptime.com"]);
  git(dir, ["config", "user.name", "Runner Tests"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src", "checkout.ts"),
    "export const a = 1;\n",
  );
  fs.writeFileSync(path.join(dir, "README.md"), "# app\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "baseline"]);

  return dir;
}

afterAll(() => {
  for (const target of temporaryPaths) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("listDirtyPaths", () => {
  test("a clean tree is empty", async () => {
    await expect(
      BuildVerification.listDirtyPaths(makeRepository()),
    ).resolves.toEqual([]);
  });

  test("a modified tracked file and a new untracked file both appear", async () => {
    const dir: string = makeRepository();

    fs.appendFileSync(path.join(dir, "src", "checkout.ts"), "// edited\n");
    fs.writeFileSync(path.join(dir, "src", "new.ts"), "export const b = 2;\n");

    const paths: Array<string> = await BuildVerification.listDirtyPaths(dir);

    expect(paths.sort()).toEqual(["src/checkout.ts", "src/new.ts"]);
  });

  /*
   * REGRESSION. The rename case, end to end: both sides must come back, and
   * neither may be mangled.
   */
  test("a rename yields both real paths and no mangled fragment", async () => {
    const dir: string = makeRepository();

    git(dir, ["mv", "src/checkout.ts", "src/checkout-service.ts"]);

    const paths: Array<string> = await BuildVerification.listDirtyPaths(dir);

    expect(paths.sort()).toEqual([
      "src/checkout-service.ts",
      "src/checkout.ts",
    ]);
    // The shape the old parser produced from the bare source-path record.
    expect(
      paths.every((entry: string) => {
        return !entry.startsWith("/");
      }),
    ).toBe(true);
  });

  /*
   * The assertion that actually matters: whatever comes out of here must be
   * something `git add` accepts. Anything else aborts the repository.
   */
  test("every path it returns is one git will accept as a pathspec", async () => {
    const dir: string = makeRepository();

    git(dir, ["mv", "src/checkout.ts", "src/renamed.ts"]);
    fs.writeFileSync(path.join(dir, "a file with spaces.ts"), "x\n");
    fs.writeFileSync(path.join(dir, 'quote"inside.ts'), "y\n");
    fs.mkdirSync(path.join(dir, "generated", "deep"), { recursive: true });
    fs.writeFileSync(path.join(dir, "generated", "deep", "out.ts"), "z\n");
    fs.rmSync(path.join(dir, "README.md"));

    const paths: Array<string> = await BuildVerification.listDirtyPaths(dir);

    await expect(
      new RepositoryManager().addPaths(dir, paths),
    ).resolves.toBeUndefined();

    const staged: Array<string> = git(dir, [
      "diff",
      "--cached",
      "--name-only",
      "-z",
    ])
      .split("\0")
      .filter((entry: string) => {
        return entry.length > 0;
      });

    expect(staged).toContain("a file with spaces.ts");
    expect(staged).toContain('quote"inside.ts');
    expect(staged).toContain("generated/deep/out.ts");
    expect(staged).toContain("src/renamed.ts");
    // The deletion of the removed file is staged too.
    expect(staged).toContain("README.md");
  });

  // -uall: the file inside a new directory, not the collapsed directory.
  test("a new directory is expanded to its files", async () => {
    const dir: string = makeRepository();

    fs.mkdirSync(path.join(dir, "dist", "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist", "assets", "app.js"), "built\n");
    fs.writeFileSync(path.join(dir, "dist", "index.html"), "<html>\n");

    const paths: Array<string> = await BuildVerification.listDirtyPaths(dir);

    expect(paths.sort()).toEqual(["dist/assets/app.js", "dist/index.html"]);
    expect(paths).not.toContain("dist/");
  });

  test("gitignored build output is invisible, as git intends", async () => {
    const dir: string = makeRepository();

    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n*.log\n");
    git(dir, ["add", "--", ".gitignore"]);
    git(dir, ["commit", "-q", "-m", "ignore build output"]);

    fs.mkdirSync(path.join(dir, "node_modules", "left-pad"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(dir, "node_modules", "left-pad", "index.js"),
      "module.exports = 1;\n",
    );
    fs.writeFileSync(path.join(dir, "build.log"), "noise\n");
    fs.writeFileSync(path.join(dir, "src", "fix.ts"), "export const c = 3;\n");

    const paths: Array<string> = await BuildVerification.listDirtyPaths(dir);

    expect(paths).toEqual(["src/fix.ts"]);
  });

  test("a staged change counts as dirty", async () => {
    const dir: string = makeRepository();

    fs.writeFileSync(
      path.join(dir, "src", "staged.ts"),
      "export const d = 4;\n",
    );
    git(dir, ["add", "--", "src/staged.ts"]);

    await expect(BuildVerification.listDirtyPaths(dir)).resolves.toEqual([
      "src/staged.ts",
    ]);
  });

  /*
   * The repair loop calls this around every pass and must never let a broken
   * repository take the run down — the verification loop's whole contract is
   * that it never throws.
   */
  test("a directory that is not a repository resolves empty instead of throwing", async () => {
    const notARepository: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-not-a-repo-"),
    );
    temporaryPaths.push(notARepository);

    await expect(
      BuildVerification.listDirtyPaths(notARepository),
    ).resolves.toEqual([]);
  });

  test("a path that does not exist at all resolves empty instead of throwing", async () => {
    await expect(
      BuildVerification.listDirtyPaths("/nonexistent/path/for/tests"),
    ).resolves.toEqual([]);
  });
});

describe("the repair-pass diff this feeds", () => {
  /*
   * The caller stages `agentPaths ∪ repairPaths`. This is the arithmetic that
   * makes that correct: the baseline is taken AFTER the verification commands
   * ran, so command output is already in it and only the repair agent's own
   * edits fall out of the difference.
   */
  test("only what changed after the baseline is attributed to the repair", async () => {
    const dir: string = makeRepository();

    // What the build emitted, before the repair pass runs.
    fs.writeFileSync(path.join(dir, "build-output.log"), "noise\n");

    const beforeRepair: Set<string> = new Set<string>(
      await BuildVerification.listDirtyPaths(dir),
    );

    // What the repair agent then did, including a rename.
    fs.writeFileSync(
      path.join(dir, "src", "repair.ts"),
      "export const e = 5;\n",
    );
    git(dir, ["mv", "src/checkout.ts", "src/checkout-fixed.ts"]);

    const repairPaths: Array<string> = (
      await BuildVerification.listDirtyPaths(dir)
    ).filter((entry: string) => {
      return !beforeRepair.has(entry);
    });

    expect(repairPaths.sort()).toEqual([
      "src/checkout-fixed.ts",
      "src/checkout.ts",
      "src/repair.ts",
    ]);
    expect(repairPaths).not.toContain("build-output.log");

    // And every one of them stages cleanly.
    await expect(
      new RepositoryManager().addPaths(dir, repairPaths),
    ).resolves.toBeUndefined();
  });
});
