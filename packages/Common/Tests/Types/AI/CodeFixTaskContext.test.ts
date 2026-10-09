/*
 * The validators that read an AIRun's task context back: the investigation
 * snapshot a FixFromIncident run is pinned to, and the GitHub conversation an
 * Implement / Revise / Review run came from (CodeFixTaskContext).
 */

import CodeFixTaskContext, {
  GitHubTaskContext,
  InvestigationCodeFixTaskSnapshot,
  getGitHubConversationNumber,
  getGitHubTaskContext,
  getInvestigationCodeFixTaskSnapshot,
} from "../../../Types/AI/CodeFixTaskContext";
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
