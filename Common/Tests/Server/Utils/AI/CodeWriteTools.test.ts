/*
 * Index MUST be imported before CodeWriteTools. The toolbox sits in an import
 * cycle (tool -> service -> ... -> ObservabilityAssistant -> AIToolbox), so
 * loading a tool module first re-enters Index before its tools array is
 * assigned and leaves undefined holes in it. Production always enters through
 * Index (ChatAgentRunner -> AIToolbox), which is the order reproduced here;
 * the integrity test below fails loudly if that ever stops holding.
 */
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  CommitCodeToBranchTool,
  OpenCodePullRequestTool,
} from "../../../../Server/Utils/AI/Toolbox/CodeWriteTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import AIAgentTaskPullRequestService from "../../../../Server/Services/AIAgentTaskPullRequestService";
import GitHubUtil from "../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeRepositoryModel from "../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The chat agent reads telemetry an attacker can influence (a log line or an
 * exception message is whatever the monitored app threw) and can now turn it
 * into code. AISentinelVision.md's defense is structural: a human reviews
 * before anything merges.
 *
 * That defense reduces to ONE invariant, and these tests exist to make it
 * impossible to regress silently:
 *
 *   A chat-authored commit NEVER lands on the default branch, and never on a
 *   protected branch.
 *
 * Everything else here (caps, validation) is secondary to that.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true, userId: ObjectID.generate() },
};

const REPO_ID: ObjectID = ObjectID.generate();

function buildRepository(): CodeRepositoryModel {
  const repository: CodeRepositoryModel = new CodeRepositoryModel();
  repository._id = REPO_ID.toString();
  repository.name = "checkout";
  repository.organizationName = "acme";
  repository.repositoryName = "checkout";
  repository.mainBranchName = "main";
  repository.repositoryHostedAt = CodeRepositoryType.GitHub;
  repository.gitHubAppInstallationId = "12345";
  return repository;
}

const CHANGES: Array<{ filePath: string; content: string }> = [
  { filePath: "src/billing/charge.ts", content: "export const a = 1;\n" },
];

beforeEach(() => {
  jest
    .spyOn(CodeRepositoryService, "findBy")
    .mockResolvedValue([buildRepository()] as never);
  jest.spyOn(GitHubUtil, "getDefaultBranchName").mockResolvedValue("main");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the default-branch invariant", () => {
  test("commit_code_to_branch REFUSES the repository's default branch", async () => {
    const commitSpy: jest.SpiedFunction<typeof GitHubUtil.commitFilesToBranch> =
      jest.spyOn(GitHubUtil, "commitFilesToBranch");

    await expect(
      CommitCodeToBranchTool.execute(
        {
          branchName: "main",
          commitMessage: "fix",
          changes: CHANGES,
        },
        ctx,
      ),
    ).rejects.toThrow(/default branch .* may never commit to it/);

    // The refusal must happen BEFORE any write is attempted.
    expect(commitSpy).not.toHaveBeenCalled();
  });

  /*
   * mainBranchName is a copy made at import time and drifts. GitHub's answer
   * is the authority — otherwise a repo that renamed main -> trunk would let
   * chat write straight to trunk.
   */
  test("refuses GitHub's real default branch even when our stored column disagrees", async () => {
    jest.spyOn(GitHubUtil, "getDefaultBranchName").mockResolvedValue("trunk");
    const commitSpy: jest.SpiedFunction<typeof GitHubUtil.commitFilesToBranch> =
      jest.spyOn(GitHubUtil, "commitFilesToBranch");

    await expect(
      CommitCodeToBranchTool.execute(
        { branchName: "trunk", commitMessage: "fix", changes: CHANGES },
        ctx,
      ),
    ).rejects.toThrow(/default branch/);

    expect(commitSpy).not.toHaveBeenCalled();
  });

  test("the default-branch refusal is case-insensitive", async () => {
    await expect(
      CommitCodeToBranchTool.execute(
        { branchName: "MAIN", commitMessage: "fix", changes: CHANGES },
        ctx,
      ),
    ).rejects.toThrow(/default branch/);
  });

  test("commit_code_to_branch REFUSES a protected branch", async () => {
    jest.spyOn(GitHubUtil, "getBranch").mockResolvedValue({
      name: "release",
      headSha: "abc123",
      isProtected: true,
    });
    const commitSpy: jest.SpiedFunction<typeof GitHubUtil.commitFilesToBranch> =
      jest.spyOn(GitHubUtil, "commitFilesToBranch");

    await expect(
      CommitCodeToBranchTool.execute(
        { branchName: "release", commitMessage: "fix", changes: CHANGES },
        ctx,
      ),
    ).rejects.toThrow(/is protected/);

    expect(commitSpy).not.toHaveBeenCalled();
  });

  test("open_code_pull_request never targets the default branch as its head", async () => {
    jest.spyOn(GitHubUtil, "createBranch").mockResolvedValue(true);
    jest.spyOn(GitHubUtil, "commitFilesToBranch").mockResolvedValue({
      commitSha: "c1",
      branchName: "x",
      htmlUrl: "u",
    });
    jest.spyOn(AIAgentTaskPullRequestService, "countBy").mockResolvedValue({
      toNumber: () => {
        return 0;
      },
    } as never);
    jest
      .spyOn(AIAgentTaskPullRequestService, "create")
      .mockResolvedValue({} as never);

    const prSpy: jest.SpiedFunction<
      typeof GitHubUtil.createPullRequestWithToken
    > = jest.spyOn(GitHubUtil, "createPullRequestWithToken").mockResolvedValue({
      pullRequestId: 1,
      pullRequestNumber: 7,
      state: PullRequestState.Open,
    } as never);

    await OpenCodePullRequestTool.execute(
      { title: "Fix charge", description: "why", changes: CHANGES },
      ctx,
    );

    const call: { baseBranchName: string; headBranchName: string } = prSpy.mock
      .calls[0]![0] as { baseBranchName: string; headBranchName: string };

    // Base is the default branch (we merge INTO it); head must never be.
    expect(call.baseBranchName).toBe("main");
    expect(call.headBranchName).not.toBe("main");
    expect(call.headBranchName).toContain("oneuptime-ai/");
  });
});

describe("open_code_pull_request", () => {
  function mockHappyPath(): void {
    jest.spyOn(GitHubUtil, "createBranch").mockResolvedValue(true);
    jest.spyOn(GitHubUtil, "commitFilesToBranch").mockResolvedValue({
      commitSha: "c1",
      branchName: "x",
      htmlUrl: "u",
    });
    jest.spyOn(AIAgentTaskPullRequestService, "countBy").mockResolvedValue({
      toNumber: () => {
        return 0;
      },
    } as never);
    jest
      .spyOn(AIAgentTaskPullRequestService, "create")
      .mockResolvedValue({} as never);
    jest.spyOn(GitHubUtil, "createPullRequestWithToken").mockResolvedValue({
      pullRequestId: 1,
      pullRequestNumber: 7,
      state: PullRequestState.Open,
    } as never);
  }

  test("opens a DRAFT pull request and says it is not merged", async () => {
    mockHappyPath();

    const result: ToolExecutionResult = await OpenCodePullRequestTool.execute(
      { title: "Fix charge", description: "why", changes: CHANGES },
      ctx,
    );

    const prCall: { isDraft: boolean } = (
      GitHubUtil.createPullRequestWithToken as unknown as jest.Mock
    ).mock.calls[0][0];
    expect(prCall.isDraft).toBe(true);

    expect(result.dataForLlm).toContain("DRAFT");
    expect(result.dataForLlm).toContain("NOT merged");
    expect(result.dataForLlm).toContain("/pull/7");
  });

  /*
   * Chat PRs are recorded as AIAgentTaskPullRequest rows so the same per-repo
   * cap the autonomous agent obeys can see them. If they were not recorded,
   * chat would be an uncapped way to flood the review queue the cap protects.
   */
  test("records the PR so it counts against the open-PR cap", async () => {
    mockHappyPath();

    await OpenCodePullRequestTool.execute(
      { title: "Fix charge", description: "why", changes: CHANGES },
      ctx,
    );

    const created: {
      data: { codeRepositoryId: ObjectID; headRefName: string };
    } = (AIAgentTaskPullRequestService.create as unknown as jest.Mock).mock
      .calls[0][0];

    expect(created.data.codeRepositoryId.toString()).toBe(REPO_ID.toString());
    expect(created.data.headRefName).toContain("oneuptime-ai/");
  });

  test("refuses when the repository is at its open-PR cap", async () => {
    mockHappyPath();
    jest.spyOn(AIAgentTaskPullRequestService, "countBy").mockResolvedValue({
      toNumber: () => {
        return 5;
      },
    } as never);

    const branchSpy: jest.SpiedFunction<typeof GitHubUtil.createBranch> =
      jest.spyOn(GitHubUtil, "createBranch");

    await expect(
      OpenCodePullRequestTool.execute(
        { title: "Fix charge", description: "why", changes: CHANGES },
        ctx,
      ),
    ).rejects.toThrow(/open AI fix pull request cap/);

    // Rejected before creating a branch — no orphan branches from a capped repo.
    expect(branchSpy).not.toHaveBeenCalled();
  });
});

describe("change validation (all of this is untrusted LLM output)", () => {
  test("rejects a path traversal", async () => {
    await expect(
      OpenCodePullRequestTool.execute(
        {
          title: "t",
          description: "d",
          changes: [{ filePath: "../../etc/passwd", content: "x" }],
        },
        ctx,
      ),
    ).rejects.toThrow(/not a valid repository-relative path/);
  });

  test("rejects the same file written twice in one commit", async () => {
    await expect(
      OpenCodePullRequestTool.execute(
        {
          title: "t",
          description: "d",
          changes: [
            { filePath: "a.ts", content: "1" },
            { filePath: "a.ts", content: "2" },
          ],
        },
        ctx,
      ),
    ).rejects.toThrow(/appears twice/);
  });

  test("rejects more than the per-commit file cap", async () => {
    const many: Array<{ filePath: string; content: string }> = Array.from(
      { length: 11 },
      (_v: unknown, i: number) => {
        return { filePath: `f${i}.ts`, content: "x" };
      },
    );

    await expect(
      OpenCodePullRequestTool.execute(
        { title: "t", description: "d", changes: many },
        ctx,
      ),
    ).rejects.toThrow(/at most 10 files/);
  });

  test("rejects an empty changes array", async () => {
    await expect(
      OpenCodePullRequestTool.execute(
        { title: "t", description: "d", changes: [] },
        ctx,
      ),
    ).rejects.toThrow(/changes is required/);
  });

  test("rejects a change whose content is not a string", async () => {
    await expect(
      OpenCodePullRequestTool.execute(
        {
          title: "t",
          description: "d",
          changes: [{ filePath: "a.ts", content: 42 }],
        },
        ctx,
      ),
    ).rejects.toThrow(/needs a content string/);
  });

  // An empty file body is legitimate; getString would wrongly reject it.
  test("allows an empty string as a new file's contents", async () => {
    jest.spyOn(GitHubUtil, "getBranch").mockResolvedValue({
      name: "feature",
      headSha: "abc",
      isProtected: false,
    });
    const commitSpy: jest.SpiedFunction<typeof GitHubUtil.commitFilesToBranch> =
      jest.spyOn(GitHubUtil, "commitFilesToBranch").mockResolvedValue({
        commitSha: "c1",
        branchName: "feature",
        htmlUrl: "u",
      });

    await CommitCodeToBranchTool.execute(
      {
        branchName: "feature",
        commitMessage: "add placeholder",
        changes: [{ filePath: "a.ts", content: "" }],
      },
      ctx,
    );

    expect(commitSpy).toHaveBeenCalled();
  });

  test("strips a leading slash rather than failing", async () => {
    jest.spyOn(GitHubUtil, "getBranch").mockResolvedValue({
      name: "feature",
      headSha: "abc",
      isProtected: false,
    });
    const commitSpy: jest.SpiedFunction<typeof GitHubUtil.commitFilesToBranch> =
      jest.spyOn(GitHubUtil, "commitFilesToBranch").mockResolvedValue({
        commitSha: "c1",
        branchName: "feature",
        htmlUrl: "u",
      });

    await CommitCodeToBranchTool.execute(
      {
        branchName: "feature",
        commitMessage: "m",
        changes: [{ filePath: "/src/a.ts", content: "x" }],
      },
      ctx,
    );

    const call: { changes: Array<{ filePath: string }> } = commitSpy.mock
      .calls[0]![0] as { changes: Array<{ filePath: string }> };
    expect(call.changes[0]!.filePath).toBe("src/a.ts");
  });
});

describe("permission-mode gating", () => {
  /*
   * Both tools must be classified as mutations, or ReadOnly conversations
   * would be offered code-writing tools and AskForApproval would run them
   * with no approval card.
   */
  test("both code-write tools are registered as mutations", () => {
    expect(AIToolbox.isMutationTool("open_code_pull_request")).toBe(true);
    expect(AIToolbox.isMutationTool("commit_code_to_branch")).toBe(true);
  });

  test("the tool registry has no undefined entries", () => {
    /*
     * A cycle that loads a tool module before Index leaves undefined holes in
     * the tools array, which breaks getToolByName for EVERY tool, not just the
     * new ones. Cheap guard against a whole-toolbox outage.
     */
    const tools: Array<unknown> = AIToolbox.getTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(
      tools.filter((tool: unknown) => {
        return !tool;
      }),
    ).toEqual([]);
  });

  test("read-only code tools are NOT mutations", () => {
    expect(AIToolbox.isMutationTool("read_code_file")).toBe(false);
    expect(AIToolbox.isMutationTool("find_code_for_exception")).toBe(false);
  });

  test("the approval card names the action concretely", () => {
    expect(
      OpenCodePullRequestTool.buildActionTitle!({ title: "Fix charge bug" }),
    ).toBe("Open draft pull request: Fix charge bug");

    expect(
      CommitCodeToBranchTool.buildActionTitle!({
        branchName: "feature/x",
        changes: [{ filePath: "a.ts", content: "" }],
      }),
    ).toBe("Commit 1 file to feature/x");
  });
});
