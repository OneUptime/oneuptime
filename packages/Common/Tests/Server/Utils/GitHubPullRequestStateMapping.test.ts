import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import { describe, expect, test } from "@jest/globals";

/*
 * State mapping for the AI-agent PR outcome sync (gate G11 instrumentation).
 * GitHub reports merged PRs as state "closed" with merged_at set — the
 * mapping must check merged first, or every merge counts as a plain close
 * and the fix-acceptance baseline undercounts forever.
 */

describe("GitHubUtil.mapGitHubPullRequestToState", () => {
  test("merged_at set means Merged even though state is closed", () => {
    expect(
      GitHubUtil.mapGitHubPullRequestToState({
        state: "closed",
        merged_at: "2026-07-13T10:00:00Z",
      }),
    ).toBe(PullRequestState.Merged);
  });

  test("merged boolean true means Merged", () => {
    expect(
      GitHubUtil.mapGitHubPullRequestToState({
        state: "closed",
        merged: true,
        merged_at: null,
      }),
    ).toBe(PullRequestState.Merged);
  });

  test("closed without merged_at means Closed (rejected fix)", () => {
    expect(
      GitHubUtil.mapGitHubPullRequestToState({
        state: "closed",
        merged_at: null,
        merged: false,
      }),
    ).toBe(PullRequestState.Closed);
  });

  test("open PR stays Open", () => {
    expect(
      GitHubUtil.mapGitHubPullRequestToState({
        state: "open",
        merged_at: null,
      }),
    ).toBe(PullRequestState.Open);
  });
});

/*
 * A merged fix is in production once a recorded deploy contains the commit
 * GitHub merged it as: merge_commit_sha, the squash or merge commit.
 */
describe("GitHubUtil.readPullRequestMerge", () => {
  const SHA: string = "6dcb09b5b57875f334f61aebed695e2e4193db5e";

  test("a merged pull request's commit and time", () => {
    expect(
      GitHubUtil.readPullRequestMerge({
        state: "closed",
        merged: true,
        merged_at: "2026-10-20T09:58:00Z",
        merge_commit_sha: SHA,
      }),
    ).toEqual({
      state: PullRequestState.Merged,
      mergeCommitSha: SHA,
      mergedAt: new Date("2026-10-20T09:58:00Z"),
    });
  });

  test("an open or closed pull request has neither, whatever GitHub sends", () => {
    // GitHub sends a test-merge commit for an open pull request.
    expect(
      GitHubUtil.readPullRequestMerge({
        state: "open",
        merge_commit_sha: SHA,
      }),
    ).toEqual({ state: PullRequestState.Open });
    expect(
      GitHubUtil.readPullRequestMerge({
        state: "closed",
        merged_at: null,
        merge_commit_sha: SHA,
      }),
    ).toEqual({ state: PullRequestState.Closed });
  });

  test("a commit that is not a SHA, or a time that is not one, is left out", () => {
    expect(
      GitHubUtil.readPullRequestMerge({
        state: "closed",
        merged: true,
        merged_at: "yesterday",
        merge_commit_sha: "main; rm -rf /",
      }),
    ).toEqual({ state: PullRequestState.Merged });
  });
});
