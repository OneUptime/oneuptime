/*
 * ---------------------------------------------------------------------------
 * Who opens a fix's pull request, for every recipe that opens one (#8916):
 * BaseTaskHandler.finishPushedChange, through openPullRequest.
 *
 *   - Where the token's answer says OneUptime opens it, the Runner asks
 *     OneUptime (BackendAPI.openPullRequest), which opens and records it: the
 *     token, which may only push, opens nothing, and the Runner records
 *     nothing of its own.
 *   - Where it says nothing - an older server, or a Git server only this
 *     Runner reaches - the Runner opens it with the token and records it, as
 *     it always did.
 *   - A repository with no pull requests (a Git server) gets its branch, and
 *     nobody is asked anything.
 * ---------------------------------------------------------------------------
 */

import {
  BaseTaskHandler,
  TaskContext,
  TaskResult,
} from "../../TaskHandlers/TaskHandlerInterface";
import BackendAPI, { RepositoryToken } from "../../Utils/BackendAPI";
import PullRequestOpener from "../../Utils/PullRequestOpener";
import PullRequestCreator, {
  PullRequestResult,
} from "../../Utils/PullRequestCreator";
import RepositoryManager from "../../Utils/RepositoryManager";
import TaskLogger from "../../Utils/TaskLogger";
import { VerificationOutcome } from "../../Utils/BuildVerification";
import FixVerificationStatus from "Common/Types/AI/FixVerificationStatus";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import ObjectID from "Common/Types/ObjectID";

const TASK_ID: string = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const REPOSITORY_ID: string = "6650f0b1-a1b2-4c3d-8e5f-607180000002";
const BRANCH: string = "oneuptime-fix-exception-7a1b2c3d";

const VERIFICATION: VerificationOutcome = {
  status: FixVerificationStatus.Passed,
  summary: "npm test passed",
  repairAttemptsUsed: 0,
  repairSummaries: [],
  repairPaths: [],
};

// A recipe as small as can be: it only finishes a change already pushed.
class FinishingHandler extends BaseTaskHandler {
  public readonly taskType: string = "Finishing";
  public readonly name: string = "Finishing Handler";

  public async execute(): Promise<TaskResult> {
    return this.createSuccessResult("done");
  }

  public async finish(
    context: TaskContext,
    token: RepositoryToken,
    body: string = "## Exception Fix",
  ): Promise<string | null> {
    return await this.finishPushedChange(context, {
      repositoryId: REPOSITORY_ID,
      token,
      repositoryManager: {
        getLastCommitChanges: jest.fn().mockResolvedValue({
          files: [],
          diff: "",
          isTruncated: false,
        }),
      } as unknown as RepositoryManager,
      repositoryPath: "/tmp/does-not-matter",
      baseBranch: "main",
      headBranch: BRANCH,
      title: "fix: resolve TypeError in checkout",
      body,
      summary: "Guarded the cart.",
      verification: VERIFICATION,
    });
  }
}

interface Harness {
  context: TaskContext;
  openPullRequest: jest.Mock;
  recordPullRequest: jest.Mock;
}

function setUp(): Harness {
  const logger: TaskLogger = {
    info: jest.fn().mockResolvedValue(undefined),
    debug: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
    warning: jest.fn().mockResolvedValue(undefined),
  } as unknown as TaskLogger;

  const openPullRequest: jest.Mock = jest.fn().mockResolvedValue({
    id: 9001,
    number: 12,
    htmlUrl: "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
    title: "fix: resolve TypeError in checkout",
    isNew: true,
  });
  const recordPullRequest: jest.Mock = jest
    .fn()
    .mockResolvedValue({ success: true, pullRequestId: "row" });

  return {
    context: {
      taskId: new ObjectID(TASK_ID),
      projectId: ObjectID.generate(),
      taskType: "FixException",
      logger,
      backendAPI: {
        openPullRequest,
        recordPullRequest,
      } as unknown as BackendAPI,
      startedAt: new Date(0),
      unrecordedPullRequests: [],
    },
    openPullRequest,
    recordPullRequest,
  };
}

function gitLabToken(
  overrides: Partial<RepositoryToken> = {},
): RepositoryToken {
  return {
    token: "glpat-project-token-900",
    expiresAt: new Date(Date.now() + 3600_000),
    repositoryUrl: "https://gitlab.example.com/acme/checkout.git",
    organizationName: "acme",
    repositoryName: "checkout",
    codeHost: {
      type: CodeRepositoryType.GitLab,
      hostUrl: "https://gitlab.example.com",
      apiUrl: "https://gitlab.example.com/api/v4",
      webUrl: "https://gitlab.example.com/acme/checkout",
      username: "oauth2",
      projectId: "4217",
      hasPullRequests: true,
    },
    ...overrides,
  };
}

let openWithToken: jest.SpyInstance;
let createOnGitHub: jest.SpyInstance;

beforeEach(() => {
  openWithToken = jest.spyOn(PullRequestOpener.prototype, "open");
  createOnGitHub = jest.spyOn(
    PullRequestCreator.prototype,
    "createPullRequest",
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("where the token's answer says OneUptime opens the pull request", () => {
  test("the Runner asks OneUptime, with the run, the repository and the branch it pushed - and opens and records nothing itself", async () => {
    const harness: Harness = setUp();

    const url: string | null = await new FinishingHandler().finish(
      harness.context,
      gitLabToken({ opensPullRequestOnServer: true }),
    );

    expect(url).toBe(
      "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
    );
    expect(harness.openPullRequest).toHaveBeenCalledWith({
      taskId: TASK_ID,
      codeRepositoryId: REPOSITORY_ID,
      headRefName: BRANCH,
      baseRefName: "main",
      title: "fix: resolve TypeError in checkout",
      body: "## Exception Fix",
      runnerVerificationStatus: FixVerificationStatus.Passed,
      runnerVerificationSummary: "npm test passed",
    });
    expect(openWithToken).not.toHaveBeenCalled();
    expect(createOnGitHub).not.toHaveBeenCalled();
    expect(harness.recordPullRequest).not.toHaveBeenCalled();
    expect(harness.context.unrecordedPullRequests).toEqual([]);
  });

  test("on GitHub too: the push-only token never meets GitHub's pull request API", async () => {
    const harness: Harness = setUp();

    await new FinishingHandler().finish(harness.context, {
      token: "ghs_push_only",
      expiresAt: new Date(Date.now() + 3600_000),
      repositoryUrl: "https://github.com/acme/checkout.git",
      organizationName: "acme",
      repositoryName: "checkout",
      opensPullRequestOnServer: true,
    });

    expect(harness.openPullRequest).toHaveBeenCalledTimes(1);
    expect(createOnGitHub).not.toHaveBeenCalled();
  });

  test("a description is bounded before it is sent, as a pull request takes it", async () => {
    const harness: Harness = setUp();

    await new FinishingHandler().finish(
      harness.context,
      gitLabToken({ opensPullRequestOnServer: true }),
      "x".repeat(PullRequestCreator.MAX_BODY_LENGTH + 100),
    );

    const sent: { body: string } = harness.openPullRequest.mock
      .calls[0]![0] as { body: string };

    expect(sent.body).toHaveLength(PullRequestCreator.MAX_BODY_LENGTH);
  });

  test("OneUptime's refusal fails the change with its words", async () => {
    const harness: Harness = setUp();
    harness.openPullRequest.mockRejectedValue(
      new Error(
        "OneUptime opens a pull request only from the branch this task pushed",
      ),
    );

    await expect(
      new FinishingHandler().finish(
        harness.context,
        gitLabToken({ opensPullRequestOnServer: true }),
      ),
    ).rejects.toThrow("only from the branch this task pushed");
    expect(harness.recordPullRequest).not.toHaveBeenCalled();
    expect(openWithToken).not.toHaveBeenCalled();
  });
});

describe("where the token's answer says nothing - an older server", () => {
  test("the Runner opens it with the token and records it, as it always did", async () => {
    const harness: Harness = setUp();
    openWithToken.mockResolvedValue({
      id: 31,
      number: 4,
      url: "https://gitlab.example.com/acme/checkout/-/merge_requests/4",
      htmlUrl: "https://gitlab.example.com/acme/checkout/-/merge_requests/4",
      state: "open",
      title: "fix: resolve TypeError in checkout",
    } as PullRequestResult);

    const url: string | null = await new FinishingHandler().finish(
      harness.context,
      gitLabToken(),
    );

    expect(url).toBe(
      "https://gitlab.example.com/acme/checkout/-/merge_requests/4",
    );
    expect(harness.openPullRequest).not.toHaveBeenCalled();
    expect(openWithToken).toHaveBeenCalledTimes(1);
    expect(harness.recordPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        codeRepositoryId: REPOSITORY_ID,
        pullRequestNumber: 4,
        headRefName: BRANCH,
        baseRefName: "main",
      }),
    );
  });
});

describe("a repository with no pull requests (a Git server)", () => {
  test("gets its branch, and nobody is asked to open anything", async () => {
    const harness: Harness = setUp();

    const url: string | null = await new FinishingHandler().finish(
      harness.context,
      gitLabToken({
        // A server never says it opens one for a Git server: it has none.
        opensPullRequestOnServer: true,
        codeHost: {
          type: CodeRepositoryType.Git,
          hostUrl: "https://git.example.com",
          apiUrl: null,
          webUrl: null,
          username: "deploy",
          projectId: null,
          hasPullRequests: false,
        },
      }),
    );

    expect(url).toBeNull();
    expect(harness.openPullRequest).not.toHaveBeenCalled();
    expect(openWithToken).not.toHaveBeenCalled();
    expect(harness.context.pushedBranches).toHaveLength(1);
  });
});
