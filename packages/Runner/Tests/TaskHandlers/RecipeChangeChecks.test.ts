/*
 * ---------------------------------------------------------------------------
 * Which recipes have the code agent build and test its change before it
 * finishes, the way the repository says to (its AGENTS.md first,
 * RepositoryInstructions).
 *
 * Every recipe that changes code does - that is what replaced the Setup,
 * Build and Test commands Code's repository settings used to ask for. Two
 * do not (CodeAgentTask.skipsChangeChecks):
 *
 *   - a review, which changes nothing;
 *   - a regression test, written to FAIL until its bug is fixed: told to
 *     "fix what fails", the agent would undo the test the task exists for.
 *     It is out of the verification loop for the same reason
 *     (runsVerification).
 *
 * Git, GitHub and the code agent are stubbed: what is pinned is the task the
 * agent is handed.
 * ---------------------------------------------------------------------------
 */

import FixExceptionTaskHandler from "../../TaskHandlers/FixExceptionTaskHandler";
import FixFromIncidentTaskHandler from "../../TaskHandlers/FixFromIncidentTaskHandler";
import FixPerformanceTaskHandler from "../../TaskHandlers/FixPerformanceTaskHandler";
import GitHubPullRequestReviewTaskHandler from "../../TaskHandlers/GitHubPullRequestReviewTaskHandler";
import ImproveInstrumentationTaskHandler from "../../TaskHandlers/ImproveInstrumentationTaskHandler";
import WriteRegressionTestTaskHandler from "../../TaskHandlers/WriteRegressionTestTaskHandler";
import {
  BaseTaskHandler,
  TaskContext,
} from "../../TaskHandlers/TaskHandlerInterface";
import BackendAPI, {
  CodeRepositoryInfo,
  ExceptionDetails,
  GitHubTaskDetails,
  SubjectTaskDetails,
} from "../../Utils/BackendAPI";
import TaskLogger from "../../Utils/TaskLogger";
import WorkspaceManager from "../../Utils/WorkspaceManager";
import RepositoryManager from "../../Utils/RepositoryManager";
import { CodeAgentFactory } from "../../CodeAgents/Index";
import {
  CodeAgent,
  CodeAgentResult,
  CodeAgentTask,
} from "../../CodeAgents/CodeAgentInterface";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

const HEAD_BRANCH: string = "feature/null-price";

const REPOSITORY: CodeRepositoryInfo = {
  id: "repo-id",
  name: "cart",
  repositoryHostedAt: "GitHub",
  organizationName: "acme",
  repositoryName: "cart",
  mainBranchName: "main",
  setupCommand: null,
  buildCommand: null,
  testCommand: null,
  servicePathInRepository: null,
  gitHubAppInstallationId: "installation-id",
};

const EXCEPTION_DETAILS: ExceptionDetails = {
  exception: {
    id: "exception-id",
    message: "TypeError: Cannot read properties of undefined (reading 'price')",
    stackTrace: "    at total (/app/src/cart/total.ts:12:5)",
    exceptionType: "TypeError",
    fingerprint: "fingerprint",
  },
  service: { id: "service-id", name: "cart-api", description: "" },
};

function subjectDetails(
  subjectType: SubjectTaskDetails["subjectType"],
): SubjectTaskDetails {
  return {
    subjectType,
    subjectTitle: "Checkout latency spike",
    analysisMarkdown: "## Analysis\nThe cart total query runs once per item.",
    serviceName: "cart-api",
    repositories: [REPOSITORY],
    resolutionError: null,
    traceId:
      subjectType === "trace" ? "4bf92f3577b34da6a3ce929d0e0e4736" : null,
    performanceFindings: [],
    spanSummaries: [],
  };
}

const REVIEW_DETAILS: GitHubTaskDetails = {
  taskType: CodeFixTaskType.GitHubPullRequestReview,
  commandType: "Review",
  instruction: "",
  triggeredByLogin: "octocat",
  repository: {
    id: "repo-id",
    name: "cart",
    organizationName: "acme",
    repositoryName: "cart",
    mainBranchName: "main",
    setupCommand: null,
    buildCommand: null,
    testCommand: null,
  },
  issue: null,
  pullRequest: {
    number: 42,
    title: "Guard a missing price",
    body: "Adds a null check.",
    htmlUrl: "https://github.com/acme/cart/pull/42",
    headRefName: HEAD_BRANCH,
    isFromFork: false,
    headSha: "abc1234",
    baseRefName: "main",
    authorLogin: "contributor",
    changedFilesCount: 1,
    additions: 3,
    deletions: 1,
  },
  files: [],
  filesTruncated: false,
  comments: [],
};

function buildContext(): TaskContext {
  const backendAPI: BackendAPI = {
    getExceptionDetails: jest.fn().mockResolvedValue(EXCEPTION_DETAILS),
    getCodeRepositories: jest.fn().mockResolvedValue([REPOSITORY]),
    getRepositoryToken: jest.fn().mockResolvedValue({
      token: "ghs_test",
      expiresAt: new Date(0),
      repositoryUrl: "https://github.com/acme/cart.git",
      organizationName: "acme",
      repositoryName: "cart",
    }),
    getGitHubTaskDetails: jest.fn().mockResolvedValue(REVIEW_DETAILS),
    postGitHubReview: jest.fn().mockResolvedValue({
      reviewUrl: "https://github.com/acme/cart/pull/42#pullrequestreview-1",
      inlineCommentsRequested: 0,
    }),
  } as unknown as BackendAPI;

  return {
    taskId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    taskType: "FixException",
    exceptionId: "exception-id",
    logger: {
      info: jest.fn().mockResolvedValue(undefined),
      debug: jest.fn().mockResolvedValue(undefined),
      warning: jest.fn().mockResolvedValue(undefined),
      error: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
      logProcessOutput: jest.fn(),
    } as unknown as TaskLogger,
    backendAPI,
    startedAt: new Date(0),
  };
}

// An agent that changes nothing, with git and the workspace stubbed.
function stubAgent(): jest.Mock {
  const executeTask: jest.Mock = jest.fn().mockResolvedValue({
    success: true,
    filesModified: [],
    summary: "## Verdict\nNothing to change.",
    logs: [],
  } as CodeAgentResult);

  const agent: CodeAgent = {
    name: "InHouse",
    initialize: jest.fn().mockResolvedValue(undefined),
    executeTask: executeTask,
    onProgress: jest.fn(),
    isAvailable: jest.fn().mockResolvedValue(true),
    abort: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  } as unknown as CodeAgent;

  jest.spyOn(CodeAgentFactory, "createDefaultAgent").mockReturnValue(agent);
  jest.spyOn(WorkspaceManager, "createWorkspace").mockResolvedValue({
    workspacePath: "/tmp/oneuptime-change-checks",
    taskId: "task-id",
    createdAt: new Date(0),
  });
  jest.spyOn(WorkspaceManager, "deleteWorkspace").mockResolvedValue(undefined);
  jest.spyOn(RepositoryManager.prototype, "cloneRepository").mockResolvedValue({
    repositoryPath: "/tmp/oneuptime-change-checks/cart",
    baseBranch: HEAD_BRANCH,
  } as never);
  jest
    .spyOn(RepositoryManager.prototype, "createBranch")
    .mockResolvedValue(undefined);

  return executeTask;
}

async function taskHandedToAgent(
  handler: BaseTaskHandler,
  details?: SubjectTaskDetails,
): Promise<CodeAgentTask> {
  const executeTask: jest.Mock = stubAgent();
  const context: TaskContext = buildContext();

  if (details) {
    (
      context.backendAPI as unknown as { getSubjectTaskDetails: jest.Mock }
    ).getSubjectTaskDetails = jest.fn().mockResolvedValue(details);
  }

  await handler.execute(context);

  expect(executeTask).toHaveBeenCalledTimes(1);

  return executeTask.mock.calls[0]![0] as CodeAgentTask;
}

describe("the recipes that build and test their change the repository's way", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an exception fix does", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new FixExceptionTaskHandler(),
    );

    expect(task.skipsChangeChecks).toBeUndefined();
  });

  test("a performance fix does", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new FixPerformanceTaskHandler(),
      subjectDetails("trace"),
    );

    expect(task.skipsChangeChecks).toBeUndefined();
  });

  test("a fix from an incident does", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new FixFromIncidentTaskHandler(),
      subjectDetails("incident"),
    );

    expect(task.skipsChangeChecks).toBeUndefined();
  });

  test("an instrumentation improvement does", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new ImproveInstrumentationTaskHandler(),
      subjectDetails("incident"),
    );

    expect(task.skipsChangeChecks).toBeUndefined();
  });

  test("a regression test does not: it is written to fail until the bug is fixed", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new WriteRegressionTestTaskHandler(),
    );

    expect(task.skipsChangeChecks).toBe(true);
  });

  test("a review does not: it changes nothing", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new GitHubPullRequestReviewTaskHandler(),
    );

    expect(task.skipsChangeChecks).toBe(true);
  });
});
