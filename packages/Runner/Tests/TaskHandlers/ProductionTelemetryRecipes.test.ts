/*
 * ---------------------------------------------------------------------------
 * The recipes that query production, and what they ask of the data.
 *
 * Production telemetry is offered to four recipes: a review of a pull
 * request, and the fixes of an exception, a slow trace and an investigated
 * incident. Each one hands the code agent its task with productionTelemetry
 * set - the agent then asks the server what it may read - and a prompt that
 * says what to look for and how to report it:
 *
 *   - the review: exceptions thrown in the changed code in the last 7 days,
 *     hot or slow endpoints the diff touches, incidents linked to the
 *     changed files and the service's deploy regressions, under a
 *     Production context heading, each point cited - and no heading at all
 *     when the data shows nothing;
 *   - the fixes: the traces, logs and metrics around the subject, before and
 *     while the change is written, cited in the pull request's description.
 *
 * Every other recipe leaves it off. Git, GitHub and the code agent are
 * stubbed: what is pinned is the task and the prompt the agent is handed.
 * ---------------------------------------------------------------------------
 */

import FixExceptionTaskHandler from "../../TaskHandlers/FixExceptionTaskHandler";
import FixFromIncidentTaskHandler from "../../TaskHandlers/FixFromIncidentTaskHandler";
import FixPerformanceTaskHandler from "../../TaskHandlers/FixPerformanceTaskHandler";
import GitHubPullRequestReviewTaskHandler from "../../TaskHandlers/GitHubPullRequestReviewTaskHandler";
import ImproveExceptionHandlingTaskHandler from "../../TaskHandlers/ImproveExceptionHandlingTaskHandler";
import ImproveInstrumentationTaskHandler from "../../TaskHandlers/ImproveInstrumentationTaskHandler";
import ImproveLoggingTaskHandler from "../../TaskHandlers/ImproveLoggingTaskHandler";
import ImproveTracingTaskHandler from "../../TaskHandlers/ImproveTracingTaskHandler";
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
import ProductionTelemetryPrompt from "../../Utils/ProductionTelemetryPrompt";
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
  files: [
    {
      filename: "src/cart/total.ts",
      status: "modified",
      additions: 3,
      deletions: 1,
      patch: "@@ -10,3 +10,5 @@\n+if (!item.price) {\n+  return 0;\n+}",
    },
  ],
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

/*
 * Git and the workspace stubbed, and an agent that reads and changes
 * nothing: the run ends as "no fix found" (or posts a review) after the
 * agent was handed its task, which is what is captured.
 */
function stubAgent(): jest.Mock {
  const executeTask: jest.Mock = jest.fn().mockResolvedValue({
    success: true,
    filesModified: [],
    summary: "## Verdict\nThe null check is right.",
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
    workspacePath: "/tmp/oneuptime-recipes",
    taskId: "task-id",
    createdAt: new Date(0),
  });
  jest.spyOn(WorkspaceManager, "deleteWorkspace").mockResolvedValue(undefined);
  jest.spyOn(RepositoryManager.prototype, "cloneRepository").mockResolvedValue({
    repositoryPath: "/tmp/oneuptime-recipes/cart",
    baseBranch: HEAD_BRANCH,
  } as never);
  jest
    .spyOn(RepositoryManager.prototype, "createBranch")
    .mockResolvedValue(undefined);

  return executeTask;
}

// What the agent was handed by a run of the handler.
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

describe("the recipes that ask for production telemetry", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a review asks, with the production context section in its prompt", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new GitHubPullRequestReviewTaskHandler(),
    );

    expect(task.productionTelemetry).toBe(true);
    expect(task.prompt).toContain(ProductionTelemetryPrompt.forReview());
  });

  test("an exception fix asks, with its checks in its prompt", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new FixExceptionTaskHandler(),
    );

    expect(task.productionTelemetry).toBe(true);
    expect(task.prompt).toContain(
      ProductionTelemetryPrompt.forFix("exception"),
    );
  });

  test("a performance fix asks, with its checks in its prompt", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new FixPerformanceTaskHandler(),
      subjectDetails("trace"),
    );

    expect(task.productionTelemetry).toBe(true);
    expect(task.prompt).toContain(
      ProductionTelemetryPrompt.forFix("performance"),
    );
  });

  test("a fix from an incident asks, with its checks in its prompt", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new FixFromIncidentTaskHandler(),
      subjectDetails("incident"),
    );

    expect(task.productionTelemetry).toBe(true);
    expect(task.prompt).toContain(ProductionTelemetryPrompt.forFix("incident"));
  });

  test("a regression test, built on the same pipeline as a fix, does not", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new WriteRegressionTestTaskHandler(),
    );

    expect(task.productionTelemetry).toBeUndefined();
    expect(task.prompt).not.toContain("## Production telemetry");
  });

  test("an instrumentation improvement, built on the same pipeline as a fix from an incident, does not", async () => {
    const task: CodeAgentTask = await taskHandedToAgent(
      new ImproveInstrumentationTaskHandler(),
      subjectDetails("incident"),
    );

    expect(task.productionTelemetry).toBeUndefined();
    expect(task.prompt).not.toContain("## Production telemetry");
  });

  test.each([
    ["ImproveExceptionHandling", new ImproveExceptionHandlingTaskHandler()],
    ["ImproveLogging", new ImproveLoggingTaskHandler()],
    ["ImproveTracing", new ImproveTracingTaskHandler()],
  ])("%s does not ask", (_name: string, handler: BaseTaskHandler) => {
    expect(
      (handler as unknown as { usesProductionTelemetry: boolean })
        .usesProductionTelemetry,
    ).toBe(false);
  });
});

describe("what the review asks of production", () => {
  const section: string = ProductionTelemetryPrompt.forReview();

  test("the four checks, each with its tool", () => {
    expect(section).toContain("**Exceptions in the changed code.**");
    expect(section).toContain(
      "`find_production_exceptions` with the paths of the changed files",
    );
    expect(section).toContain("last 7 days");
    expect(section).toContain("**Hot or slow endpoints.**");
    expect(section).toContain("`query_traces` with `nameSearchText`");
    expect(section).toContain("**Incidents.**");
    expect(section).toContain("`find_production_incidents`");
    expect(section).toContain("**Deploy regressions.**");
    expect(section).toContain("`recent_deploys`");
  });

  test("every point cited, and no section at all when the data shows nothing", () => {
    expect(section).toContain("**Production context** heading");
    expect(section).toContain("the tool, the numbers and the window");
    expect(section).toContain("Write only what the data supports.");
    expect(section).toContain("leave the heading out altogether");
    expect(section).toContain("never write that production looks fine");
    expect(section).toContain("never pad");
  });

  test("a run with no telemetry skips it", () => {
    expect(section).toContain(
      "If none of these tools is in your tool list, OneUptime holds no telemetry",
    );
  });
});

describe("what a fix asks of production", () => {
  test.each([
    [
      "an exception",
      "exception",
      ["`find_production_exceptions`", "`search_logs`", "`get_trace`"],
    ],
    [
      "a slow trace",
      "performance",
      ["`query_traces`", "`get_trace`", "`query_metrics`"],
    ],
    [
      "an incident",
      "incident",
      ["`recent_deploys`", "`search_logs`", "`find_production_incidents`"],
    ],
  ])(
    "a fix of %s reads the telemetry around its subject",
    (_label: string, subject: string, tools: Array<string>) => {
      const section: string = ProductionTelemetryPrompt.forFix(
        subject as "exception" | "performance" | "incident",
      );

      expect(section).toContain("Before you write the change");
      expect(section).toContain("use what you find while you write it");

      for (const tool of tools) {
        expect(section).toContain(tool);
      }
    },
  );

  test("the summary cites what was queried, and claims nothing it did not show", () => {
    const section: string = ProductionTelemetryPrompt.forFix("exception");

    expect(section).toContain(
      "say what you queried and what it showed - the tool, the numbers and the window",
    );
    expect(section).toContain(
      "Claim nothing about production that a query did not show.",
    );
  });
});
