/*
 * The validators that read an AIRun's task context back: the investigation
 * snapshot a FixFromIncident run is pinned to, and the GitHub conversation an
 * Implement / Revise / Review run came from (CodeFixTaskContext).
 */

import CodeFixTaskContext, {
  CodeHostPullRequestTaskContext,
  GitHubTaskContext,
  InvestigationCodeFixTaskSnapshot,
  ProductionReviewTaskContext,
  getCodeHostPullRequestTaskContext,
  getGitHubConversationNumber,
  getGitHubTaskContext,
  getInvestigationCodeFixTaskSnapshot,
  getProductionReviewTaskContext,
  getReviewedPullRequest,
} from "../../../Types/AI/CodeFixTaskContext";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { ProductionReviewTrigger } from "../../../Types/CodeRepository/ProductionReview";
import GitHubCommandType from "../../../Types/CodeRepository/GitHubCommand";
import { describe, expect, test } from "@jest/globals";

type GitHubFunction = (
  overrides?: Partial<GitHubTaskContext>,
) => GitHubTaskContext;

const github: GitHubFunction = (
  overrides: Partial<GitHubTaskContext> = {},
): GitHubTaskContext => {
  return {
    codeRepositoryId: "repo-row-id",
    installationId: "12345",
    organizationName: "acme",
    repositoryName: "widgets",
    commandType: GitHubCommandType.Implement,
    instruction: "please fix it",
    issueNumber: 7,
    ...overrides,
  };
};

describe("getInvestigationCodeFixTaskSnapshot", () => {
  test("returns both fields when both are present", () => {
    const snapshot: InvestigationCodeFixTaskSnapshot | null =
      getInvestigationCodeFixTaskSnapshot({
        sourceInvestigationRunId: "run-1",
        sourceInvestigationAnalysisMarkdown: "## Root cause\nA bad deploy.",
      });

    expect(snapshot).toEqual({
      investigationRunId: "run-1",
      investigationAnalysisMarkdown: "## Root cause\nA bad deploy.",
    });
  });

  test("keeps the values exactly as stored, surrounding whitespace included", () => {
    expect(
      getInvestigationCodeFixTaskSnapshot({
        sourceInvestigationRunId: " run-1 ",
        sourceInvestigationAnalysisMarkdown: "\nAnalysis\n",
      }),
    ).toEqual({
      investigationRunId: " run-1 ",
      investigationAnalysisMarkdown: "\nAnalysis\n",
    });
  });

  test("no task context is no snapshot", () => {
    expect(getInvestigationCodeFixTaskSnapshot(null)).toBeNull();
    expect(getInvestigationCodeFixTaskSnapshot(undefined)).toBeNull();
    expect(getInvestigationCodeFixTaskSnapshot({})).toBeNull();
  });

  test("a partial snapshot is no snapshot", () => {
    expect(
      getInvestigationCodeFixTaskSnapshot({
        sourceInvestigationRunId: "run-1",
      }),
    ).toBeNull();
    expect(
      getInvestigationCodeFixTaskSnapshot({
        sourceInvestigationAnalysisMarkdown: "Analysis",
      }),
    ).toBeNull();
  });

  test("blank strings are no snapshot", () => {
    expect(
      getInvestigationCodeFixTaskSnapshot({
        sourceInvestigationRunId: "   ",
        sourceInvestigationAnalysisMarkdown: "Analysis",
      }),
    ).toBeNull();
    expect(
      getInvestigationCodeFixTaskSnapshot({
        sourceInvestigationRunId: "run-1",
        sourceInvestigationAnalysisMarkdown: "\n\t ",
      }),
    ).toBeNull();
    expect(
      getInvestigationCodeFixTaskSnapshot({
        sourceInvestigationRunId: "",
        sourceInvestigationAnalysisMarkdown: "",
      }),
    ).toBeNull();
  });

  test("malformed JSON values are no snapshot", () => {
    for (const malformed of [
      { sourceInvestigationRunId: 1, sourceInvestigationAnalysisMarkdown: "a" },
      {
        sourceInvestigationRunId: "run-1",
        sourceInvestigationAnalysisMarkdown: { text: "a" },
      },
      {
        sourceInvestigationRunId: ["run-1"],
        sourceInvestigationAnalysisMarkdown: "a",
      },
      {
        sourceInvestigationRunId: null,
        sourceInvestigationAnalysisMarkdown: null,
      },
    ]) {
      expect(
        getInvestigationCodeFixTaskSnapshot(
          malformed as unknown as CodeFixTaskContext,
        ),
      ).toBeNull();
    }
  });

  test("other context fields do not matter", () => {
    expect(
      getInvestigationCodeFixTaskSnapshot({
        traceId: "trace",
        serviceName: "api",
        sourceInvestigationRunId: "run-2",
        sourceInvestigationAnalysisMarkdown: "x",
      }),
    ).toEqual({
      investigationRunId: "run-2",
      investigationAnalysisMarkdown: "x",
    });
  });
});

describe("getGitHubTaskContext", () => {
  test("returns the very context for a complete issue conversation", () => {
    const context: GitHubTaskContext = github();

    expect(getGitHubTaskContext({ github: context })).toBe(context);
  });

  test("returns the context for a complete pull request conversation", () => {
    const context: GitHubTaskContext = github({
      commandType: GitHubCommandType.Review,
      issueNumber: undefined,
      pullRequestNumber: 42,
      pullRequestHeadRefName: "feature/x",
    });

    expect(getGitHubTaskContext({ github: context })).toBe(context);
  });

  test("no task context or no github part is no conversation", () => {
    expect(getGitHubTaskContext(null)).toBeNull();
    expect(getGitHubTaskContext(undefined)).toBeNull();
    expect(getGitHubTaskContext({})).toBeNull();
    expect(getGitHubTaskContext({ github: undefined })).toBeNull();
  });

  test("each required string must be present and not blank", () => {
    const required: Array<keyof GitHubTaskContext> = [
      "codeRepositoryId",
      "installationId",
      "organizationName",
      "repositoryName",
      "commandType",
    ];

    for (const field of required) {
      for (const bad of [undefined, null, "", "   ", 5, {}]) {
        const context: GitHubTaskContext = {
          ...github(),
          [field]: bad,
        } as unknown as GitHubTaskContext;

        expect(getGitHubTaskContext({ github: context })).toBeNull();
      }
    }
  });

  test("an empty instruction is allowed: it is untrusted free text", () => {
    const context: GitHubTaskContext = github({ instruction: "" });

    expect(getGitHubTaskContext({ github: context })).toBe(context);
  });

  test("naming both an issue and a pull request is refused", () => {
    expect(
      getGitHubTaskContext({
        github: github({ issueNumber: 1, pullRequestNumber: 2 }),
      }),
    ).toBeNull();
  });

  test("naming neither an issue nor a pull request is refused", () => {
    expect(
      getGitHubTaskContext({
        github: github({
          issueNumber: undefined,
          pullRequestNumber: undefined,
        }),
      }),
    ).toBeNull();
  });

  test("a number stored as text does not count as a number", () => {
    expect(
      getGitHubTaskContext({
        github: {
          ...github({ issueNumber: undefined }),
          pullRequestNumber: "42",
        } as unknown as GitHubTaskContext,
      }),
    ).toBeNull();
  });

  test("zero is still a number, so it names the conversation", () => {
    const context: GitHubTaskContext = github({ issueNumber: 0 });

    expect(getGitHubTaskContext({ github: context })).toBe(context);
  });
});

describe("getGitHubConversationNumber", () => {
  test("is the issue number for an issue", () => {
    expect(getGitHubConversationNumber(github({ issueNumber: 7 }))).toBe(7);
  });

  test("is the pull request number for a pull request", () => {
    expect(
      getGitHubConversationNumber(
        github({ issueNumber: undefined, pullRequestNumber: 99 }),
      ),
    ).toBe(99);
  });

  test("prefers the pull request number if both were somehow set", () => {
    expect(
      getGitHubConversationNumber(
        github({ issueNumber: 1, pullRequestNumber: 2 }),
      ),
    ).toBe(2);
  });

  test("a pull request number of zero is still used", () => {
    expect(
      getGitHubConversationNumber(
        github({ issueNumber: 5, pullRequestNumber: 0 }),
      ),
    ).toBe(0);
  });
});

/*
 * A production review task's context is whole only when it names a pull
 * request (in `github`) and an ask to review it: a run that cannot say
 * which pull request, or what was asked, is not reviewed at all.
 */
describe("getProductionReviewTaskContext", () => {
  const review: ProductionReviewTaskContext = {
    requestNumber: 1,
    requestedAt: "2026-10-22T10:00:00.000Z",
    headSha: "abc1234",
    trigger: ProductionReviewTrigger.PullRequestChanged,
    isAuthorTrusted: true,
  };

  const pullRequest: GitHubTaskContext = github({
    commandType: GitHubCommandType.ProductionReview,
    instruction: "",
    issueNumber: undefined,
    pullRequestNumber: 42,
  });

  test("reads a whole one back", () => {
    expect(
      getProductionReviewTaskContext({
        github: pullRequest,
        productionReview: review,
      }),
    ).toBe(review);
  });

  test.each([
    ["no context", undefined],
    ["no ask", { github: pullRequest }],
    ["no pull request", { productionReview: review }],
    [
      "an issue instead of a pull request",
      {
        github: github({ issueNumber: 7 }),
        productionReview: review,
      },
    ],
    [
      "an ask number that is not one",
      {
        github: pullRequest,
        productionReview: { ...review, requestNumber: 0 },
      },
    ],
    [
      "an ask number that is a fraction",
      {
        github: pullRequest,
        productionReview: { ...review, requestNumber: 1.5 },
      },
    ],
    [
      "no time it was asked",
      {
        github: pullRequest,
        productionReview: { ...review, requestedAt: 5 as unknown as string },
      },
    ],
    [
      "no head",
      {
        github: pullRequest,
        productionReview: { ...review, headSha: null as unknown as string },
      },
    ],
  ])("%s is no review", (_name: string, context: unknown) => {
    expect(
      getProductionReviewTaskContext(context as CodeFixTaskContext),
    ).toBeNull();
  });
});

/*
 * A merge request on GitLab, or a pull request on Forgejo or Gitea, that a
 * production review is about: whole - its repository, a host other than
 * GitHub that has production reviews, a number - or none. Written by the
 * server only, but read back from JSON like every task context.
 */
describe("getCodeHostPullRequestTaskContext", () => {
  const onGitLab: CodeHostPullRequestTaskContext = {
    codeRepositoryId: "repo-row-id",
    provider: CodeRepositoryType.GitLab,
    pullRequestNumber: 12,
    pullRequestUrl: "https://gitlab.example.com/acme/x/-/merge_requests/12",
  };

  test("reads a whole one back, on GitLab and on Forgejo", () => {
    expect(
      getCodeHostPullRequestTaskContext({ codeHostPullRequest: onGitLab }),
    ).toBe(onGitLab);

    const onForgejo: CodeHostPullRequestTaskContext = {
      ...onGitLab,
      provider: CodeRepositoryType.Forgejo,
    };

    expect(
      getCodeHostPullRequestTaskContext({ codeHostPullRequest: onForgejo }),
    ).toBe(onForgejo);
  });

  test.each([
    ["no context", undefined],
    ["no pull request", {}],
    [
      "GitHub's - which is named in github, never here",
      { ...onGitLab, provider: CodeRepositoryType.GitHub },
    ],
    [
      "a Git server's, which has none",
      { ...onGitLab, provider: CodeRepositoryType.Git },
    ],
    ["a host it does not know", { ...onGitLab, provider: "Bitbucket" }],
    ["no repository", { ...onGitLab, codeRepositoryId: " " }],
    ["a number that is none", { ...onGitLab, pullRequestNumber: 0 }],
    ["a fraction", { ...onGitLab, pullRequestNumber: 1.5 }],
    ["a number as text", { ...onGitLab, pullRequestNumber: "12" }],
  ])("%s is none", (_name: string, pullRequest: unknown) => {
    expect(
      getCodeHostPullRequestTaskContext(
        pullRequest === undefined
          ? undefined
          : ({ codeHostPullRequest: pullRequest } as CodeFixTaskContext),
      ),
    ).toBeNull();
  });
});

describe("getReviewedPullRequest: the pull request a review is of, on any host", () => {
  test("GitHub's from github", () => {
    expect(
      getReviewedPullRequest({
        github: github({
          commandType: GitHubCommandType.ProductionReview,
          issueNumber: undefined,
          pullRequestNumber: 42,
          isPullRequestFromFork: true,
        }),
      }),
    ).toEqual({
      codeRepositoryId: "repo-row-id",
      provider: CodeRepositoryType.GitHub,
      number: 42,
      isFromFork: true,
    });
  });

  test("any other host's from codeHostPullRequest, with its page when the task knows it", () => {
    expect(
      getReviewedPullRequest({
        codeHostPullRequest: {
          codeRepositoryId: "repo-row-id",
          provider: CodeRepositoryType.GitLab,
          pullRequestNumber: 12,
          pullRequestUrl:
            "https://gitlab.example.com/acme/x/-/merge_requests/12",
        },
      }),
    ).toEqual({
      codeRepositoryId: "repo-row-id",
      provider: CodeRepositoryType.GitLab,
      number: 12,
      isFromFork: false,
      url: "https://gitlab.example.com/acme/x/-/merge_requests/12",
    });

    expect(
      getReviewedPullRequest({
        codeHostPullRequest: {
          codeRepositoryId: "repo-row-id",
          provider: CodeRepositoryType.Forgejo,
          pullRequestNumber: 3,
          isPullRequestFromFork: true,
          pullRequestUrl: "",
        },
      }),
    ).toEqual({
      codeRepositoryId: "repo-row-id",
      provider: CodeRepositoryType.Forgejo,
      number: 3,
      isFromFork: true,
    });
  });

  test("an issue, or nothing, is no pull request a review is of", () => {
    expect(getReviewedPullRequest({ github: github() })).toBeNull();
    expect(getReviewedPullRequest({})).toBeNull();
    expect(getReviewedPullRequest(undefined)).toBeNull();
  });

  test("a production review of a merge request is whole with its ask", () => {
    const review: ProductionReviewTaskContext = {
      requestNumber: 1,
      requestedAt: "2026-10-22T10:00:00.000Z",
      headSha: "abc1234",
      trigger: ProductionReviewTrigger.PullRequestChanged,
      isAuthorTrusted: true,
      checkRunId: 7,
      checkRunHeadSha: "abc1234",
    };

    expect(
      getProductionReviewTaskContext({
        codeHostPullRequest: {
          codeRepositoryId: "repo-row-id",
          provider: CodeRepositoryType.GitLab,
          pullRequestNumber: 12,
        },
        productionReview: review,
      }),
    ).toBe(review);
  });
});
