import CodeTaskOutcomeReader, {
  CodeTaskOutcomeRead,
  MAX_DIFF_FILES,
  MAX_DIFF_LENGTH,
  MAX_FILE_PATCH_LENGTH,
  MAX_OUTCOME_FILES,
  MAX_OUTCOME_SUMMARY_LENGTH,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskOutcomeReader";
import { CodeTaskFileStatus } from "../../../../../Types/AI/CodeTask";
import { describe, expect, test } from "@jest/globals";

/*
 * What a Runner says a turn ended with is kept on the run and shown in the
 * conversation, so nothing of it is taken on trust: each field is checked,
 * unknown ones dropped, and every text capped.
 */

function read(raw: unknown): CodeTaskOutcomeRead {
  const outcome: CodeTaskOutcomeRead | null = CodeTaskOutcomeReader.read(raw);

  if (!outcome) {
    throw new Error("Expected an outcome.");
  }

  return outcome;
}

describe("CodeTaskOutcomeReader.read", () => {
  test("a Runner that reports no outcome leaves the turn as an older Runner's", () => {
    for (const raw of [undefined, null, "done", 42, [], true]) {
      expect(CodeTaskOutcomeReader.read(raw)).toBeNull();
    }
  });

  test("keeps the reply, the files, the branch and the pull request", () => {
    expect(
      read({
        summary: "Added a retry with backoff.\n\n- `src/api/users.ts`",
        filesChanged: [
          {
            path: "src/api/users.ts",
            status: "Modified",
            additions: 12,
            deletions: 3,
          },
          {
            path: "src/api/retry.ts",
            previousPath: "src/api/backoff.ts",
            status: "Renamed",
            additions: 0,
            deletions: 0,
          },
        ],
        branchName: "oneuptime-task-42-1a2b3c4d",
        pullRequestNumber: 17,
        pullRequestUrl: "https://github.com/acme/api/pull/17",
        openedPullRequest: true,
        needsInput: false,
        somethingElse: "dropped",
      }),
    ).toEqual({
      outcome: {
        summary: "Added a retry with backoff.\n\n- `src/api/users.ts`",
        filesChanged: [
          {
            path: "src/api/users.ts",
            status: CodeTaskFileStatus.Modified,
            additions: 12,
            deletions: 3,
          },
          {
            path: "src/api/retry.ts",
            previousPath: "src/api/backoff.ts",
            status: CodeTaskFileStatus.Renamed,
            additions: 0,
            deletions: 0,
          },
        ],
        branchName: "oneuptime-task-42-1a2b3c4d",
        pullRequestNumber: 17,
        pullRequestUrl: "https://github.com/acme/api/pull/17",
        openedPullRequest: true,
      },
      changes: null,
      needsInput: false,
    });
  });

  test("a question is only a question when the Runner says exactly so", () => {
    expect(read({ summary: "Which table?", needsInput: true }).needsInput).toBe(
      true,
    );
    expect(read({ summary: "x", needsInput: "true" }).needsInput).toBe(false);
    expect(read({ summary: "x" }).needsInput).toBe(false);
  });

  test("anything malformed is dropped rather than kept", () => {
    const outcome: CodeTaskOutcomeRead = read({
      summary: 42,
      filesChanged: [
        null,
        "src/a.ts",
        { path: "" },
        { path: "src/b.ts", status: "Exploded", additions: -4, deletions: 1.5 },
      ],
      branchName: "   ",
      pullRequestNumber: -1,
      pullRequestUrl: "javascript:alert(1)",
      openedPullRequest: "yes",
    });

    expect(outcome.outcome).toEqual({
      summary: "",
      filesChanged: [
        {
          path: "src/b.ts",
          status: CodeTaskFileStatus.Modified,
          additions: 0,
          deletions: 0,
        },
      ],
    });
  });

  test.each([
    "file:///etc/passwd",
    "data:text/html,hi",
    `https://github.com/${"a".repeat(3000)}`,
    "not a url",
  ])(
    "a pull request address that is not a web address is dropped (%j)",
    (url: string) => {
      expect(
        read({ pullRequestUrl: url }).outcome.pullRequestUrl,
      ).toBeUndefined();
    },
  );

  test("a long reply and a long list of files are capped", () => {
    const outcome: CodeTaskOutcomeRead = read({
      summary: "s".repeat(MAX_OUTCOME_SUMMARY_LENGTH + 10),
      filesChanged: Array.from(
        { length: MAX_OUTCOME_FILES + 20 },
        (_value: unknown, index: number) => {
          return { path: `src/${index}.ts`, additions: 1, deletions: 0 };
        },
      ),
    });

    expect(outcome.outcome.summary.startsWith("s".repeat(100))).toBe(true);
    expect(outcome.outcome.summary.endsWith("… (truncated)")).toBe(true);
    expect(outcome.outcome.filesChanged).toHaveLength(MAX_OUTCOME_FILES);
  });
});

describe("the diff a turn committed", () => {
  test("keeps each file's patch, and a binary file as no patch", () => {
    const outcome: CodeTaskOutcomeRead = read({
      summary: "",
      changes: {
        files: [
          {
            path: "src/a.ts",
            status: "Modified",
            additions: 1,
            deletions: 1,
            patch: "@@ -1 +1 @@\n-old\n+new",
          },
          {
            path: "logo.png",
            status: "Added",
            additions: 0,
            deletions: 0,
            patch: null,
          },
        ],
        isTruncated: false,
      },
    });

    expect(outcome.changes).toEqual({
      files: [
        {
          path: "src/a.ts",
          status: CodeTaskFileStatus.Modified,
          additions: 1,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-old\n+new",
        },
        {
          path: "logo.png",
          status: CodeTaskFileStatus.Added,
          additions: 0,
          deletions: 0,
          patch: null,
        },
      ],
      isTruncated: false,
    });
  });

  test("a file's patch is cut at its limit, and says so", () => {
    const outcome: CodeTaskOutcomeRead = read({
      changes: {
        files: [
          {
            path: "src/big.ts",
            patch: "+".repeat(MAX_FILE_PATCH_LENGTH + 500),
          },
        ],
      },
    });

    expect(outcome.changes!.files[0]!.patch).toHaveLength(
      MAX_FILE_PATCH_LENGTH,
    );
    expect(outcome.changes!.files[0]!.isPatchTruncated).toBe(true);
    expect(outcome.changes!.isTruncated).toBe(true);
  });

  test("the whole diff stays within its budget, however many files it has", () => {
    const outcome: CodeTaskOutcomeRead = read({
      changes: {
        files: Array.from(
          { length: MAX_DIFF_FILES + 5 },
          (_value: unknown, index: number) => {
            return {
              path: `src/${index}.ts`,
              patch: "+".repeat(MAX_FILE_PATCH_LENGTH),
            };
          },
        ),
      },
    });

    const total: number = outcome.changes!.files.reduce(
      (sum: number, file: { patch: string | null }): number => {
        return sum + (file.patch?.length || 0);
      },
      0,
    );

    expect(outcome.changes!.files).toHaveLength(MAX_DIFF_FILES);
    expect(total).toBeLessThanOrEqual(MAX_DIFF_LENGTH);
    expect(outcome.changes!.isTruncated).toBe(true);
  });

  test("a diff that is not a list of files is no diff", () => {
    expect(read({ changes: { files: "all of them" } }).changes).toBeNull();
    expect(read({ changes: [] }).changes).toBeNull();
    expect(read({ changes: null }).changes).toBeNull();
  });

  /*
   * A production review is the server's to write: a Runner's report can
   * never put one on a turn, whatever it sends.
   */
  test("a Runner cannot report a production review", () => {
    const outcome: CodeTaskOutcomeRead = read({
      summary: "Done.",
      filesChanged: [],
      productionReview: {
        exceptions: [{ type: "Forged" }],
        posting: "Review",
      },
    });

    expect(outcome.outcome.productionReview).toBeUndefined();
    expect(JSON.stringify(outcome)).not.toContain("Forged");
  });
});
