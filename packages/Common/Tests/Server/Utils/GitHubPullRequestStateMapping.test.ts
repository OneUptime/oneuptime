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
