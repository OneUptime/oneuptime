/*
 * The read-only git commands the code agent's tools run themselves (issue
 * #6441): git grep, ls-files, status, diff, log, show and blame. They run on
 * a global Runner too, so what each run may NOT do is pinned here against a
 * real git: see no Runner secret, reach no network, run no program the
 * repository names, and stop at its timeout and its output limit. A
 * failure is an answer - an exit code and its message - never a throw.
 */

import GitReadCommand, { GitReadResult } from "../../Utils/GitReadCommand";
import {
  git,
  makeRepository,
  makeTemporaryDirectory,
  removeTemporaryDirectories,
  writeFile,
} from "../CodeAgents/Tools/ToolTestRepository";
import fs from "fs";
import path from "path";

function run(
  cwd: string,
  args: Array<string>,
  options?: { timeoutMs?: number; maxOutputBytes?: number; indexFile?: string },
): Promise<GitReadResult> {
  return GitReadCommand.run({
    cwd,
    args,
    timeoutMs: options?.timeoutMs ?? 30_000,
    maxOutputBytes: options?.maxOutputBytes ?? 16 * 1024 * 1024,
    indexFile: options?.indexFile,
  });
}

// The environment a program git starts sees: git's own, as an alias shows it.
async function environmentSeen(
  cwd: string,
  options?: { indexFile?: string },
): Promise<Map<string, string>> {
  const result: GitReadResult = await run(
    cwd,
    ["-c", "alias.showenv=!env", "showenv"],
    options,
  );
  expect(result.exitCode).toBe(0);

  const environment: Map<string, string> = new Map();

  for (const line of result.stdout.split("\n")) {
    const separator: number = line.indexOf("=");

    if (separator > 0) {
      environment.set(
        line.substring(0, separator),
        line.substring(separator + 1),
      );
    }
  }

  return environment;
}

const SAVED_ENVIRONMENT: Array<string> = [
  "ONEUPTIME_RUNNER_KEY",
  "ONEUPTIME_RUNNER_ID",
  "GIT_ASKPASS",
  "ONEUPTIME_GIT_ACCESS_TOKEN",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_EXTERNAL_DIFF",
];
const savedEnvironment: Map<string, string | undefined> = new Map();

beforeEach(() => {
  for (const name of SAVED_ENVIRONMENT) {
    savedEnvironment.set(name, process.env[name]);
  }
});

afterEach(() => {
  for (const [name, value] of savedEnvironment) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

afterAll(() => {
  removeTemporaryDirectories();
});

describe("an answer, never a throw", () => {
  test("a command that works gives its output and exit code 0", async () => {
    const root: string = makeRepository({
      "src/a.ts": "export const a = 1;\n",
    });

    const result: GitReadResult = await run(root, ["ls-files"]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: "src/a.ts\n",
      stderr: "",
      timedOut: false,
      outputLimitReached: false,
    });
  });

  test("git grep finding nothing exits 1, with no output - told apart from a bad pattern (128)", async () => {
    const root: string = makeRepository({
      "src/a.ts": "export const a = 1;\n",
    });

    const nothing: GitReadResult = await run(root, [
      "grep",
      "-n",
      "-e",
      "nowhere",
      "--",
    ]);
    expect(nothing.exitCode).toBe(1);
    expect(nothing.stdout).toBe("");

    const bad: GitReadResult = await run(root, [
      "grep",
      "-n",
      "-E",
      "-e",
      "(unclosed",
      "--",
    ]);
    expect(bad.exitCode).toBe(128);
    expect(bad.stderr).toMatch(/parenthes|unmatched|missing \)/i);
  });

  test("a folder that is not a repository exits 128 and says so", async () => {
    const folder: string = makeTemporaryDirectory(
      "oneuptime-not-a-repository-",
    );

    const result: GitReadResult = await run(folder, ["status", "--porcelain"]);

    expect(result.exitCode).toBe(128);
    expect(result.stderr).toContain("not a git repository");
  });

  test("a folder that does not exist is an answer too", async () => {
    const result: GitReadResult = await run(
      path.join(makeTemporaryDirectory("oneuptime-gone-"), "missing"),
      ["status"],
    );

    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("ENOENT");
  });
});

describe("what a run sees", () => {
  test("no Runner secret, no credential helper, and no repository but the one it runs in", async () => {
    const root: string = makeRepository({ "src/a.ts": "a\n" });
    const elsewhere: string = makeRepository({ "elsewhere.ts": "b\n" });

    process.env["ONEUPTIME_RUNNER_KEY"] = "runner-key-never-seen";
    process.env["ONEUPTIME_RUNNER_ID"] = "runner-id-never-seen";
    process.env["GIT_ASKPASS"] = "/usr/local/bin/askpass-never-seen";
    process.env["ONEUPTIME_GIT_ACCESS_TOKEN"] = "token-never-seen";
    process.env["GIT_DIR"] = path.join(elsewhere, ".git");
    process.env["GIT_WORK_TREE"] = elsewhere;
    process.env["GIT_INDEX_FILE"] = path.join(elsewhere, ".git", "index");
    process.env["GIT_EXTERNAL_DIFF"] = "/usr/local/bin/diff-never-run";

    const environment: Map<string, string> = await environmentSeen(root);
    const seen: string = Array.from(environment.values()).join("\n");

    for (const value of [
      "runner-key-never-seen",
      "runner-id-never-seen",
      "askpass-never-seen",
      "token-never-seen",
      "diff-never-run",
    ]) {
      expect(seen).not.toContain(value);
    }

    expect(environment.get("ONEUPTIME_RUNNER_KEY")).toBeUndefined();
    expect(environment.get("GIT_ASKPASS")).toBeUndefined();
    expect(environment.get("GIT_INDEX_FILE")).toBeUndefined();

    // GIT_DIR and GIT_WORK_TREE are gone: the run reads its own repository.
    expect((await run(root, ["ls-files"])).stdout).toBe("src/a.ts\n");
  });

  test("no prompt, no pager, no lock taken and no lazy fetch", async () => {
    const root: string = makeRepository({ "src/a.ts": "a\n" });

    const environment: Map<string, string> = await environmentSeen(root);

    expect(environment.get("GIT_TERMINAL_PROMPT")).toBe("0");
    expect(environment.get("GIT_OPTIONAL_LOCKS")).toBe("0");
    expect(environment.get("GIT_PAGER")).toBe("cat");
    expect(environment.get("PAGER")).toBe("cat");
    expect(environment.get("GIT_NO_LAZY_FETCH")).toBe("1");
  });

  test("an index file of its own is the one it reads", async () => {
    const root: string = makeRepository({
      "src/a.ts": "a\n",
      "src/b.ts": "b\n",
    });
    const ownIndex: string = path.join(
      makeTemporaryDirectory("oneuptime-own-index-"),
      "index",
    );

    // An index that holds no file: ls-files with it lists nothing.
    expect(
      (await environmentSeen(root, { indexFile: ownIndex })).get(
        "GIT_INDEX_FILE",
      ),
    ).toBe(ownIndex);
    expect(
      (await run(root, ["ls-files"], { indexFile: ownIndex })).stdout,
    ).toBe("");
    expect((await run(root, ["ls-files"])).stdout).toBe("src/a.ts\nsrc/b.ts\n");
  });

  test("paths are shown as written, not quoted in octal", async () => {
    const root: string = makeRepository({ "docs/café.md": "menu\n" });

    expect((await run(root, ["ls-files"])).stdout).toBe("docs/café.md\n");
  });

  test("text in many chunks comes back whole, characters split between chunks included", async () => {
    const content: string = `${"é😀 ".repeat(200_000)}\n`;
    const root: string = makeRepository({ "big.txt": content });

    const result: GitReadResult = await run(root, ["show", "HEAD:big.txt"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(content);
  });
});

describe("what a run may not do", () => {
  test("reach another repository: every transport is refused, the local one included", async () => {
    const root: string = makeRepository({ "a.ts": "a\n" });
    const other: string = makeRepository({ "b.ts": "b\n" });

    const local: GitReadResult = await run(root, ["ls-remote", other]);
    expect(local.exitCode).not.toBe(0);
    expect(local.stderr).toContain("transport 'file' not allowed");
    expect(local.stdout).toBe("");

    const remote: GitReadResult = await run(root, [
      "ls-remote",
      "https://example.invalid/repository.git",
    ]);
    expect(remote.exitCode).not.toBe(0);
    expect(remote.stderr).toContain("transport 'https' not allowed");
  });

  test("run the file-system monitor the repository names", async () => {
    const root: string = makeRepository({ "a.ts": "a\n" });
    const marker: string = path.join(
      makeTemporaryDirectory("oneuptime-fsmonitor-"),
      "ran",
    );
    const hook: string = path.join(root, ".git", "fsmonitor-hook.sh");
    fs.writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, {
      mode: 0o755,
    });
    git(root, ["config", "core.fsmonitor", hook]);

    const result: GitReadResult = await run(root, ["status", "--porcelain"]);

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);

    // The hook is real: git without the override runs it.
    git(root, ["status", "--porcelain"]);
    expect(fs.existsSync(marker)).toBe(true);
  });

  test("print past its output limit: it is stopped there, and says so", async () => {
    const root: string = makeRepository({
      "big.txt": "x".repeat(4 * 1024 * 1024),
    });

    const result: GitReadResult = await run(root, ["show", "HEAD:big.txt"], {
      maxOutputBytes: 100_000,
    });

    expect(result.outputLimitReached).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.stdout).toBe("x".repeat(100_000));
  });

  test("run past its time: it is stopped, and a program it left holding the output does not hold the answer", async () => {
    const root: string = makeRepository({ "a.ts": "a\n" });
    const startedAt: number = Date.now();

    const result: GitReadResult = await run(
      root,
      ["-c", "alias.wait=!sleep 6", "wait"],
      { timeoutMs: 300 },
    );

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    // The timeout, then a moment for the last output: far from the six seconds.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  test("write the repository's index: git status leaves it as it was", async () => {
    const root: string = makeRepository({ "a.ts": "a\n" });
    const index: string = path.join(root, ".git", "index");
    // An index that is stale for a.ts: its time changed, its content not.
    const later: Date = new Date(Date.now() + 60_000);
    writeFile(root, "a.ts", "a\n");
    fs.utimesSync(path.join(root, "a.ts"), later, later);
    const before: Buffer = fs.readFileSync(index);

    const result: GitReadResult = await run(root, ["status", "--porcelain"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.readFileSync(index).equals(before)).toBe(true);
  });
});
