import { describe, expect, test } from "@jest/globals";
import UnifiedDiff from "../../../../../Server/Utils/CodeRepository/CodeHost/UnifiedDiff";
import {
  CodeHostChangedFile,
  CodeHostChangedFiles,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * A git diff - what Forgejo and Gitea answer for a pull request's .diff -
 * read file by file, in the shape GitHub's pull request files have: the
 * name (and the one before a rename), what happened, lines added and
 * removed, and the hunks from the first "@@" on. The diffs below are what
 * `git diff` prints for each kind of change, so a production review reads
 * a Forgejo pull request the way it reads a GitHub one.
 */

const MODIFIED: string = [
  "diff --git a/src/billing/charge.ts b/src/billing/charge.ts",
  "index 3b18e51..a1c9f02 100644",
  "--- a/src/billing/charge.ts",
  "+++ b/src/billing/charge.ts",
  "@@ -40,2 +40,5 @@ export function chargeCard(card) {",
  "-  const id = card.id;",
  "+  if (!card) {",
  "+    throw new Error('no card');",
  "+  }",
  "+  const id = card.id;",
  "   return id;",
].join("\n");

const ADDED: string = [
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "index 0000000..d00491f",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,2 @@",
  "+export const a = 1;",
  "+export const b = 2;",
].join("\n");

const DELETED: string = [
  "diff --git a/src/old.ts b/src/old.ts",
  "deleted file mode 100644",
  "index 9daeafb..0000000",
  "--- a/src/old.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-export const old = 1;",
].join("\n");

const RENAMED: string = [
  "diff --git a/src/a.ts b/src/b.ts",
  "similarity index 90%",
  "rename from src/a.ts",
  "rename to src/b.ts",
  "index 3b18e51..a1c9f02 100644",
  "--- a/src/a.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1 @@",
  "-export const a = 1;",
  "+export const a = 2;",
].join("\n");

const RENAMED_ONLY: string = [
  "diff --git a/docs/a.md b/docs/b.md",
  "similarity index 100%",
  "rename from docs/a.md",
  "rename to docs/b.md",
].join("\n");

const BINARY: string = [
  "diff --git a/assets/logo.png b/assets/logo.png",
  "index 3b18e51..a1c9f02 100644",
  "Binary files a/assets/logo.png and b/assets/logo.png differ",
].join("\n");

const MODE_ONLY: string = [
  "diff --git a/bin/run.sh b/bin/run.sh",
  "old mode 100644",
  "new mode 100755",
].join("\n");

function only(diff: string): CodeHostChangedFile {
  const read: CodeHostChangedFiles = UnifiedDiff.splitFiles(diff, 300);

  expect(read.files).toHaveLength(1);
  expect(read.hasMore).toBe(false);

  return read.files[0]!;
}

describe("UnifiedDiff.splitFiles", () => {
  test("a changed file: its name, its counts, and its hunks from the first @@ on", () => {
    expect(only(MODIFIED)).toEqual({
      filename: "src/billing/charge.ts",
      previousFilename: null,
      status: "modified",
      additions: 4,
      deletions: 1,
      patch: [
        "@@ -40,2 +40,5 @@ export function chargeCard(card) {",
        "-  const id = card.id;",
        "+  if (!card) {",
        "+    throw new Error('no card');",
        "+  }",
        "+  const id = card.id;",
        "   return id;",
      ].join("\n"),
    });
  });

  test("an added file, and a removed one, as GitHub names them", () => {
    expect(only(ADDED)).toMatchObject({
      filename: "src/new.ts",
      status: "added",
      additions: 2,
      deletions: 0,
    });
    expect(only(DELETED)).toMatchObject({
      filename: "src/old.ts",
      status: "removed",
      additions: 0,
      deletions: 1,
      patch: "@@ -1 +0,0 @@\n-export const old = 1;",
    });
  });

  test("a renamed file keeps the name it had - changed or not", () => {
    expect(only(RENAMED)).toMatchObject({
      filename: "src/b.ts",
      previousFilename: "src/a.ts",
      status: "renamed",
      additions: 1,
      deletions: 1,
    });
    expect(only(RENAMED_ONLY)).toEqual({
      filename: "docs/b.md",
      previousFilename: "docs/a.md",
      status: "renamed",
      additions: 0,
      deletions: 0,
      patch: null,
    });
  });

  test("a binary file, and a file whose mode alone changed, have no hunks", () => {
    expect(only(BINARY)).toEqual({
      filename: "assets/logo.png",
      previousFilename: null,
      status: "modified",
      additions: 0,
      deletions: 0,
      patch: null,
    });
    expect(only(MODE_ONLY)).toMatchObject({
      filename: "bin/run.sh",
      status: "modified",
      patch: null,
    });
  });

  test("several files, in the diff's order; a diff written on Windows reads the same", () => {
    const diff: string = [MODIFIED, ADDED, DELETED, RENAMED].join("\n");
    const read: CodeHostChangedFiles = UnifiedDiff.splitFiles(diff, 300);

    expect(
      read.files.map((file: CodeHostChangedFile): string => {
        return `${file.status} ${file.filename}`;
      }),
    ).toEqual([
      "modified src/billing/charge.ts",
      "added src/new.ts",
      "removed src/old.ts",
      "renamed src/b.ts",
    ]);

    expect(UnifiedDiff.splitFiles(diff.split("\n").join("\r\n"), 300)).toEqual(
      read,
    );
  });

  test("as many files as asked for, and whether there are more", () => {
    const diff: string = [MODIFIED, ADDED, DELETED].join("\n");

    const two: CodeHostChangedFiles = UnifiedDiff.splitFiles(diff, 2);

    expect(two.files).toHaveLength(2);
    expect(two.hasMore).toBe(true);

    const three: CodeHostChangedFiles = UnifiedDiff.splitFiles(diff, 3);

    expect(three.files).toHaveLength(3);
    expect(three.hasMore).toBe(false);

    expect(UnifiedDiff.splitFiles(diff, 0)).toEqual({
      files: [],
      hasMore: true,
    });
  });

  test("text before the first file - a mail's header, a commit message - is not a file", () => {
    const read: CodeHostChangedFiles = UnifiedDiff.splitFiles(
      [
        "From 1a2b3c Mon Sep 17 00:00:00 2001",
        "Subject: [PATCH] fix: guard the card",
        "",
        "---",
        MODIFIED,
      ].join("\n"),
      300,
    );

    expect(read.files).toHaveLength(1);
    expect(read.files[0]!.filename).toBe("src/billing/charge.ts");
  });

  test("an empty or missing diff has no files", () => {
    expect(UnifiedDiff.splitFiles("", 300)).toEqual({
      files: [],
      hasMore: false,
    });
    expect(UnifiedDiff.splitFiles(undefined as unknown as string, 300)).toEqual(
      { files: [], hasMore: false },
    );
  });

  test("a line removed that reads like a header is counted, never read as one", () => {
    const file: CodeHostChangedFile = only(
      [
        "diff --git a/notes.md b/notes.md",
        "--- a/notes.md",
        "+++ b/notes.md",
        "@@ -1,2 +1,2 @@",
        "--- a/old heading",
        "+++ b/new heading",
      ].join("\n"),
    );

    expect(file).toMatchObject({
      filename: "notes.md",
      additions: 1,
      deletions: 1,
    });
  });

  test("paths git quotes are read back: escapes, and bytes of UTF-8", () => {
    expect(
      only(
        [
          'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
          "new file mode 100644",
          "--- /dev/null",
          '+++ "b/caf\\303\\251.ts"',
          "@@ -0,0 +1 @@",
          "+x",
        ].join("\n"),
      ).filename,
    ).toBe("café.ts");

    expect(UnifiedDiff.readHeaderPath('"a/tab\\there.ts"')).toBe(
      "tab\there.ts",
    );
    expect(UnifiedDiff.readHeaderPath("b/src/x.ts\t2026-10-30 10:00")).toBe(
      "src/x.ts",
    );
    expect(UnifiedDiff.readHeaderPath("/dev/null")).toBeNull();
    expect(UnifiedDiff.unquote('say \\"hi\\" \\\\ \\n')).toBe('say "hi" \\ \n');
  });

  test("a path with a space in it, named only by the header, is read from its end", () => {
    expect(
      only(
        [
          "diff --git a/my notes.md b/my notes.md",
          "old mode 100644",
          "new mode 100755",
        ].join("\n"),
      ).filename,
    ).toBe("my notes.md");
  });

  /*
   * The diff is whatever the pull request's author wrote: 400,000 lines of
   * the worst a reader meets - each a file header - read in time in line
   * with the text. A pass that went back over what it read would take
   * minutes here.
   */
  test("a diff of a hundred thousand files is read in time in line with its length", () => {
    const header: string =
      "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n";
    const diff: string = header.repeat(100000);

    const timed: FastestRun<CodeHostChangedFiles> = fastestRun({
      run: (): CodeHostChangedFiles => {
        return UnifiedDiff.splitFiles(diff, 300);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result.files).toHaveLength(300);
    expect(timed.result.hasMore).toBe(true);
  });

  test("one hunk of 400,000 changed lines is counted in time in line with it", () => {
    const diff: string = `diff --git a/big.txt b/big.txt\n--- a/big.txt\n+++ b/big.txt\n@@ -1,200000 +1,200000 @@\n${"-a\n+b\n".repeat(200000)}`;

    const timed: FastestRun<CodeHostChangedFiles> = fastestRun({
      run: (): CodeHostChangedFiles => {
        return UnifiedDiff.splitFiles(diff, 300);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result.files[0]).toMatchObject({
      additions: 200000,
      deletions: 200000,
    });
  });
});
