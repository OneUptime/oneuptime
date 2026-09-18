/*
 * ---------------------------------------------------------------------------
 * The outcome taxonomy of a code-fix run, at the point where the pipeline
 * decides what to tell the user.
 *
 * Three things can come out of the code agent and they are NOT the same:
 *
 *   1. the agent ran, understood the code and found nothing worth changing —
 *      a legitimate NEGATIVE RESULT;
 *   2. the agent ran and changed files — a PULL REQUEST;
 *   3. the agent could not run at all: the server was unreachable, the run's
 *      LLM budget was exhausted, it timed out, it was aborted — a FAILURE.
 *
 * (1) and (3) used to be the same branch. `!agentResult.success ||
 * filesModified.length === 0` returned null for both, and the caller reports
 * null as NoFixFound. So an outage — the one thing an operator most needs to
 * see — was rendered as "the AI looked at your bug and decided there was
 * nothing to fix". That is worse than a red run: it is a confident,
 * wrong-shaped answer that nobody investigates, and it quietly suppresses the
 * error rate the whole feature is judged on.
 *
 * These tests pin all three outcomes on BOTH pipeline bases, because the two
 * handlers are near-identical copies and a fix applied to one does not reach
 * the other.
 * ---------------------------------------------------------------------------
 */

import ExceptionPullRequestTaskHandler from "../../TaskHandlers/ExceptionPullRequestTaskHandler";
import SubjectPullRequestTaskHandler from "../../TaskHandlers/SubjectPullRequestTaskHandler";
import {
  TaskContext,
  TaskResult,
} from "../../TaskHandlers/TaskHandlerInterface";
import BackendAPI, {
  CodeRepositoryInfo,
  ExceptionDetails,
  SubjectTaskDetails,
} from "../../Utils/BackendAPI";
import TaskLogger from "../../Utils/TaskLogger";
import WorkspaceManager, { WorkspaceInfo } from "../../Utils/WorkspaceManager";
import RepositoryManager, { CloneResult } from "../../Utils/RepositoryManager";
import PullRequestCreator, {
  PullRequestOptions,
  PullRequestResult,
} from "../../Utils/PullRequestCreator";
import BuildVerification from "../../Utils/BuildVerification";
import { CodeAgentFactory } from "../../CodeAgents/Index";
import {
  CodeAgent,
  CodeAgentResult,
} from "../../CodeAgents/CodeAgentInterface";
import FixVerificationStatus from "Common/Types/AI/FixVerificationStatus";
import ObjectID from "Common/Types/ObjectID";

const repository: CodeRepositoryInfo = {
  id: "repo-id",
  name: "checkout",
  repositoryHostedAt: "GitHub",
  organizationName: "acme",
  repositoryName: "checkout",
  // Deliberately STALE: the clone below reports a different branch.
  mainBranchName: "master",
  setupCommand: null,
  buildCommand: null,
  testCommand: null,
  servicePathInRepository: null,
  gitHubAppInstallationId: "installation-id",
};

const exceptionDetails: ExceptionDetails = {
  exception: {
    id: "exception-id",
    message: "TypeError: cannot read property 'id' of undefined",
    stackTrace: "at Checkout.process (src/checkout.ts:42:11)",
    exceptionType: "TypeError",
    fingerprint: "fingerprint",
  },
  service: { id: "service-id", name: "checkout", description: "" },
};

const subjectTaskDetails: SubjectTaskDetails = {
  subjectType: "incident",
  subjectTitle: "Checkout latency spike",
  analysisMarkdown: "## Analysis",
  serviceName: "checkout",
  repositories: [repository],
  resolutionError: null,
  traceId: null,
  performanceFindings: [],
  spanSummaries: [],
} as unknown as SubjectTaskDetails;

function buildLogger(): TaskLogger {
  return {
    info: jest.fn().mockResolvedValue(undefined),
    debug: jest.fn().mockResolvedValue(undefined),
    warning: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn().mockResolvedValue(undefined),
    logProcessOutput: jest.fn().mockResolvedValue(undefined),
  } as unknown as TaskLogger;
}

function buildBackendAPI(): BackendAPI {
  return {
    getExceptionDetails: jest.fn().mockResolvedValue(exceptionDetails),
    getCodeRepositories: jest.fn().mockResolvedValue([repository]),
    getSubjectTaskDetails: jest.fn().mockResolvedValue(subjectTaskDetails),
    getRepositoryToken: jest.fn().mockResolvedValue({
      token: "ghs_token_for_this_run_1234567890",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      repositoryUrl: "https://github.com/acme/checkout.git",
      organizationName: "acme",
      repositoryName: "checkout",
    }),
    recordPullRequest: jest
      .fn()
      .mockResolvedValue({ success: true, pullRequestId: "pr-id" }),
  } as unknown as BackendAPI;
}

function buildContext(backendAPI: BackendAPI): TaskContext {
  return {
    taskId: new ObjectID("11111111-2222-4333-8444-555555555555"),
    projectId: ObjectID.generate(),
    taskType: "FixException",
    exceptionId: "exception-id",
    logger: buildLogger(),
    backendAPI,
    startedAt: new Date(0),
  };
}

// A code agent whose single task result is scripted by the test.
function buildAgent(result: CodeAgentResult): CodeAgent {
  return {
    name: "Scripted",
    initialize: jest.fn().mockResolvedValue(undefined),
    executeTask: jest.fn().mockResolvedValue(result),
    onProgress: jest.fn(),
    isAvailable: jest.fn().mockResolvedValue(true),
    abort: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  } as unknown as CodeAgent;
}

class TestExceptionHandler extends ExceptionPullRequestTaskHandler {
  public readonly taskType: string = "FixException";
  public readonly name: string = "Test Exception Handler";
  protected readonly branchPrefix: string = "test-fix-";
  protected readonly noActionMessage: string = "No fixes were applied";
  protected buildPrompt(): string {
    return "prompt";
  }
  protected buildCommitMessage(): string {
    return "commit";
  }
  protected buildPullRequestTitle(): string {
    return "title";
  }
  protected buildPullRequestBody(): string {
    return "body";
  }
}

class TestSubjectHandler extends SubjectPullRequestTaskHandler {
  public readonly taskType: string = "ImproveInstrumentation";
  public readonly name: string = "Test Subject Handler";
  protected readonly branchPrefix: string = "test-instr-";
  protected readonly noActionMessage: string = "No changes were needed";
  protected readonly noRepositoryMessage: string = "No repository";
  protected buildPrompt(): string {
    return "prompt";
  }
  protected buildCommitMessage(): string {
    return "commit";
  }
  protected buildPullRequestTitle(): string {
    return "title";
  }
  protected buildPullRequestBody(): string {
    return "body";
  }
}

// Everything below processRepository's decision point is stubbed out.
function stubPipeline(data: {
  agentResult: CodeAgentResult;
  clonedBaseBranch?: string;
}): { createPullRequest: jest.Mock } {
  const createPullRequest: jest.Mock = jest.fn().mockResolvedValue({
    id: 1,
    number: 7,
    url: "https://api.github.com/repos/acme/checkout/pulls/7",
    htmlUrl: "https://github.com/acme/checkout/pull/7",
    state: "open",
    title: "title",
  } as PullRequestResult);

  jest.spyOn(WorkspaceManager, "createWorkspace").mockResolvedValue({
    workspacePath: "/tmp/workspace",
    taskId: "task",
    createdAt: new Date(0),
  } as WorkspaceInfo);
  jest.spyOn(WorkspaceManager, "deleteWorkspace").mockResolvedValue(undefined);

  jest.spyOn(RepositoryManager.prototype, "cloneRepository").mockResolvedValue({
    workingDirectory: "/tmp/workspace",
    repositoryPath: "/tmp/workspace/acme__checkout",
    baseBranch: data.clonedBaseBranch || "main",
  } as CloneResult);
  jest
    .spyOn(RepositoryManager.prototype, "createBranch")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RepositoryManager.prototype, "addPaths")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RepositoryManager.prototype, "commitChanges")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RepositoryManager.prototype, "pushBranch")
    .mockResolvedValue(undefined);

  jest.spyOn(BuildVerification, "verifyWithRepairs").mockResolvedValue({
    status: FixVerificationStatus.Skipped,
    summary: "Not verified.",
    repairAttemptsUsed: 0,
    repairSummaries: [],
    repairPaths: [],
  });

  jest
    .spyOn(PullRequestCreator.prototype, "createPullRequest")
    .mockImplementation(createPullRequest as never);

  jest
    .spyOn(CodeAgentFactory, "createDefaultAgent")
    .mockReturnValue(buildAgent(data.agentResult));

  return { createPullRequest };
}

afterEach(() => {
  jest.restoreAllMocks();
});

interface HandlerCase {
  label: string;
  build: () => {
    handler: ExceptionPullRequestTaskHandler | SubjectPullRequestTaskHandler;
  };
}

const HANDLERS: Array<HandlerCase> = [
  {
    label: "ExceptionPullRequestTaskHandler",
    build: () => {
      return { handler: new TestExceptionHandler() };
    },
  },
  {
    label: "SubjectPullRequestTaskHandler",
    build: () => {
      return { handler: new TestSubjectHandler() };
    },
  },
];

describe.each(HANDLERS)("$label", (handlerCase: HandlerCase) => {
  const build: HandlerCase["build"] = handlerCase.build;

  test("a clean run that changed nothing is NoFixFound, not an error", async () => {
    stubPipeline({
      agentResult: {
        success: true,
        filesModified: [],
        summary:
          "The exception is expected input validation; no change needed.",
        logs: [],
        exitCode: 0,
      },
    });

    const result: TaskResult = await build().handler.execute(
      buildContext(buildBackendAPI()),
    );

    expect(result.success).toBe(false);
    expect(result.data?.["noFixFound"]).toBe(true);
    expect(result.data?.["isError"]).toBeUndefined();
  });

  /*
   * REGRESSION. Each of these is the agent reporting that it could not do the
   * work at all. Every one of them used to be reported to the user as
   * "no fix found".
   */
  test.each([
    [
      "the LLM budget was exhausted",
      "This fix run has reached its LLM call budget",
    ],
    ["the agent timed out", "Code agent timed out after 1800 seconds"],
    [
      "the server was unreachable",
      "Failed to get LLM completion: ECONNREFUSED",
    ],
    ["the run was aborted", "Task was aborted"],
  ])(
    "a hard agent failure (%s) is an Error, not NoFixFound",
    async (_label: string, agentError: string) => {
      stubPipeline({
        agentResult: {
          success: false,
          filesModified: [],
          summary: "",
          logs: [],
          error: agentError,
          exitCode: 1,
        },
      });

      const result: TaskResult = await build().handler.execute(
        buildContext(buildBackendAPI()),
      );

      expect(result.success).toBe(false);
      expect(result.data?.["isError"]).toBe(true);
      expect(result.data?.["noFixFound"]).toBeUndefined();
      // The operator gets the actual cause, not a euphemism.
      expect(result.message).toContain(agentError);
    },
  );

  test("a successful run with changes opens a pull request", async () => {
    const { createPullRequest } = stubPipeline({
      agentResult: {
        success: true,
        filesModified: ["src/checkout.ts"],
        summary: "Guarded the undefined access.",
        logs: [],
        exitCode: 0,
      },
    });

    const result: TaskResult = await build().handler.execute(
      buildContext(buildBackendAPI()),
    );

    expect(result.success).toBe(true);
    expect(result.pullRequestsCreated).toBe(1);
    expect(createPullRequest).toHaveBeenCalledTimes(1);
  });

  /*
   * REGRESSION. The pull request's base used to come from the stored
   * mainBranchName column. When that column is stale — the repository was
   * renamed from master to main, or the record predates a default-branch
   * change — GitHub either rejects the base outright or, worse, accepts it
   * and produces a pull request whose diff is every commit between the two
   * branches instead of the fix. The base must be what git actually checked
   * out.
   */
  test("the pull request targets the branch that was cloned, not the stored column", async () => {
    const { createPullRequest } = stubPipeline({
      agentResult: {
        success: true,
        filesModified: ["src/checkout.ts"],
        summary: "Fixed.",
        logs: [],
        exitCode: 0,
      },
      // The repository record above says "master".
      clonedBaseBranch: "main",
    });

    await build().handler.execute(buildContext(buildBackendAPI()));

    const options: PullRequestOptions = createPullRequest.mock
      .calls[0]?.[0] as PullRequestOptions;

    expect(options.baseBranch).toBe("main");
    expect(options.baseBranch).not.toBe(repository.mainBranchName);
  });

  test("the recorded pull request carries the same base the PR was opened against", async () => {
    stubPipeline({
      agentResult: {
        success: true,
        filesModified: ["src/checkout.ts"],
        summary: "Fixed.",
        logs: [],
        exitCode: 0,
      },
      clonedBaseBranch: "trunk",
    });

    const backendAPI: BackendAPI = buildBackendAPI();
    await build().handler.execute(buildContext(backendAPI));

    const recorded: { baseRefName: string } = (
      backendAPI.recordPullRequest as unknown as jest.Mock
    ).mock.calls[0]?.[0];

    expect(recorded.baseRefName).toBe("trunk");
  });
});
