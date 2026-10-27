/*
 * What a turn of a request from Code changed, read from its commit with real
 * git: each file, how (added, modified, deleted, renamed), by how many
 * lines, and its diff - the conversation's "files changed" and the diff a
 * reviewer opens. File names are read from git's -z output field by field
 * and passed after `--`, so a name with spaces, or one that looks like a
 * flag, is just a name; a binary file has no patch; a secret the Runner
 * knows never leaves in a patch.
 */

import RepositoryManager, {
  MAX_FILE_PATCH_LENGTH,
} from "../../Utils/RepositoryManager";
import SecretRedactor from "../../Utils/SecretRedactor";
import {
  CodeTaskChanges,
  CodeTaskFileDiff,
  CodeTaskFileStatus,
} from "Common/Types/AI/CodeTask";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

jest.setTimeout(120000);

const TOKEN: string = "ghs_patchsecret0123456789abcdefghijklmno";

const temporaryPaths: Array<string> = [];

function git(cwd: string, args: Array<string>): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd },
  });
}

function makeRepository(): string {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-commit-changes-"),
  );
  temporaryPaths.push(dir);

  git(dir, ["init", "-q", "-b", "main", "."]);
  git(dir, ["config", "user.email", "tests@oneuptime.com"]);
  git(dir, ["config", "user.name", "Runner Tests"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "keep.ts"), "export const a = 1;\n");
  fs.writeFileSync(
    path.join(dir, "src", "gone.ts"),
    "export const gone = 1;\n",
  );
  fs.writeFileSync(
    path.join(dir, "src", "old-name.ts"),
    Array.from({ length: 20 }, (_value: unknown, index: number) => {
      return `export const line${index} = ${index};`;
    }).join("\n") + "\n",
  );
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "baseline"]);

  return dir;
}

function byPath(changes: CodeTaskChanges): Map<string, CodeTaskFileDiff> {
  return new Map(
    changes.files.map((file: CodeTaskFileDiff): [string, CodeTaskFileDiff] => {
      return [file.path, file];
    }),
  );
}

afterEach(() => {
  SecretRedactor.clearRegistered();
});

afterAll(() => {
  for (const target of temporaryPaths) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("RepositoryManager.getLastCommitChanges", () => {
  test("reads each file the last commit added, changed, removed or moved, with its diff", async () => {
    const repository: string = makeRepository();

    fs.writeFileSync(
      path.join(repository, "src", "keep.ts"),
      "export const a = 2;\nexport const b = 3;\n",
    );
    fs.rmSync(path.join(repository, "src", "gone.ts"));
    fs.renameSync(
      path.join(repository, "src", "old-name.ts"),
      path.join(repository, "src", "new-name.ts"),
    );
    fs.writeFileSync(path.join(repository, "src", "added.ts"), "export {};\n");
    git(repository, ["add", "-A"]);
    git(repository, ["commit", "-q", "-m", "the turn's change"]);

    const changes: CodeTaskChanges =
      await new RepositoryManager().getLastCommitChanges(repository);
    const files: Map<string, CodeTaskFileDiff> = byPath(changes);

    expect(changes.isTruncated).toBe(false);
    expect(Array.from(files.keys()).sort()).toEqual([
      "src/added.ts",
      "src/gone.ts",
      "src/keep.ts",
      "src/new-name.ts",
    ]);

    expect(files.get("src/keep.ts")).toMatchObject({
      status: CodeTaskFileStatus.Modified,
      additions: 2,
      deletions: 1,
    });
    expect(files.get("src/keep.ts")!.patch).toBe(
      "@@ -1 +1,2 @@\n-export const a = 1;\n+export const a = 2;\n+export const b = 3;",
    );

    expect(files.get("src/added.ts")).toMatchObject({
      status: CodeTaskFileStatus.Added,
      additions: 1,
      deletions: 0,
    });
    expect(files.get("src/gone.ts")).toMatchObject({
      status: CodeTaskFileStatus.Deleted,
      additions: 0,
      deletions: 1,
    });
    expect(files.get("src/gone.ts")!.patch).toContain(
      "-export const gone = 1;",
    );
    expect(files.get("src/new-name.ts")).toMatchObject({
      status: CodeTaskFileStatus.Renamed,
      previousPath: "src/old-name.ts",
    });
  });

  test("a binary file is counted without a patch", async () => {
    const repository: string = makeRepository();

    fs.writeFileSync(
      path.join(repository, "logo.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01, 0x02, 0xff]),
    );
    git(repository, ["add", "-A"]);
    git(repository, ["commit", "-q", "-m", "a logo"]);

    const changes: CodeTaskChanges =
      await new RepositoryManager().getLastCommitChanges(repository);

    expect(changes.files).toEqual([
      {
        path: "logo.png",
        status: CodeTaskFileStatus.Added,
        additions: 0,
        deletions: 0,
        patch: null,
      },
    ]);
  });

  test("a name with spaces, or one that looks like a flag, is only a name", async () => {
    const repository: string = makeRepository();

    fs.writeFileSync(path.join(repository, "my notes.md"), "hello\n");
    fs.writeFileSync(path.join(repository, "--output=x"), "not a flag\n");
    git(repository, ["add", "-A"]);
    git(repository, ["commit", "-q", "-m", "odd names"]);

    const files: Map<string, CodeTaskFileDiff> = byPath(
      await new RepositoryManager().getLastCommitChanges(repository),
    );

    expect(files.get("my notes.md")?.patch).toBe("@@ -0,0 +1 @@\n+hello");
    expect(files.get("--output=x")?.patch).toBe("@@ -0,0 +1 @@\n+not a flag");
    expect(fs.existsSync(path.join(repository, "x"))).toBe(false);
  });

  test("a secret the Runner knows is taken out of every patch", async () => {
    const repository: string = makeRepository();
    SecretRedactor.register(TOKEN, "repository-token");

    fs.writeFileSync(
      path.join(repository, "src", "keep.ts"),
      `export const token = "${TOKEN}";\n`,
    );
    git(repository, ["add", "-A"]);
    git(repository, ["commit", "-q", "-m", "oops"]);

    const changes: CodeTaskChanges =
      await new RepositoryManager().getLastCommitChanges(repository);

    expect(JSON.stringify(changes)).not.toContain(TOKEN);
  });

  test("a huge file's patch is cut, and says so", async () => {
    const repository: string = makeRepository();

    fs.writeFileSync(
      path.join(repository, "src", "big.ts"),
      `${"x".repeat(200)}\n`.repeat(MAX_FILE_PATCH_LENGTH / 50),
    );
    git(repository, ["add", "-A"]);
    git(repository, ["commit", "-q", "-m", "big"]);

    const changes: CodeTaskChanges =
      await new RepositoryManager().getLastCommitChanges(repository);

    expect(changes.files[0]!.patch!.length).toBe(MAX_FILE_PATCH_LENGTH);
    expect(changes.files[0]!.isPatchTruncated).toBe(true);
    expect(changes.isTruncated).toBe(true);
  });

  test("a repository it cannot read reports no changes rather than failing the turn", async () => {
    const notARepository: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-not-a-repo-"),
    );
    temporaryPaths.push(notARepository);

    expect(
      await new RepositoryManager().getLastCommitChanges(notARepository),
    ).toEqual({ files: [], isTruncated: false });
  });
});

describe("reading git's -z output", () => {
  const NUL: string = String.fromCharCode(0);

  test("numstat: counts, renames and binary files", () => {
    expect(
      RepositoryManager.parseNumstat(
        [
          "3\t1\tsrc/a.ts",
          "0\t0\t",
          "src/old.ts",
          "src/new.ts",
          "-\t-\tlogo.png",
          "",
        ].join(NUL),
      ),
    ).toEqual([
      { path: "src/a.ts", additions: 3, deletions: 1, isBinary: false },
      {
        path: "src/new.ts",
        previousPath: "src/old.ts",
        additions: 0,
        deletions: 0,
        isBinary: false,
      },
      { path: "logo.png", additions: 0, deletions: 0, isBinary: true },
    ]);
  });

  test("name-status: each letter, and a move", () => {
    const statuses: Map<string, CodeTaskFileStatus> =
      RepositoryManager.parseNameStatus(
        [
          "M",
          "a.ts",
          "A",
          "b.ts",
          "D",
          "c.ts",
          "R087",
          "old.ts",
          "new.ts",
          "",
        ].join(NUL),
      );

    expect(Object.fromEntries(statuses)).toEqual({
      "a.ts": CodeTaskFileStatus.Modified,
      "b.ts": CodeTaskFileStatus.Added,
      "c.ts": CodeTaskFileStatus.Deleted,
      "new.ts": CodeTaskFileStatus.Renamed,
    });
  });

  test("a patch is read from its first hunk", () => {
    expect(
      RepositoryManager.hunksOf(
        "diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n\n",
      ),
    ).toBe("@@ -1 +1 @@\n-a\n+b");
    expect(RepositoryManager.hunksOf("Binary files differ\n")).toBe("");
  });

  test("takes time in line with the output, however it is built", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        RepositoryManager.parseNumstat(`${"\t".repeat(400_000)}x`);
        RepositoryManager.parseNumstat(NUL.repeat(400_000));
        RepositoryManager.parseNameStatus(
          `${"R".repeat(200_000)}${NUL.repeat(200_000)}`,
        );
        RepositoryManager.hunksOf(`${"\n".repeat(400_000)}@@`);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
