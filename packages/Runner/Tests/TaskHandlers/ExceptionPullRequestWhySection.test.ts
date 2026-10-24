/*
 * ---------------------------------------------------------------------------
 * "Whenever a PR is created it should connect to why it was created" - the
 * maintainer. An exception's AI pull request says, under its heading, why it
 * was opened - the finding OneUptime made (a new or rising exception the
 * Exceptions AI section found), with a link to it - and links the exception
 * in OneUptime. The server tells the Runner both with the exception's
 * details, for the task the Runner claimed (getExceptionDetails, taskId); a
 * task a person started on the exception's page, or an older server, says
 * only what it can - or nothing, and the body is as it always was.
 * ---------------------------------------------------------------------------
 */

import ExceptionPullRequestTaskHandler from "../../TaskHandlers/ExceptionPullRequestTaskHandler";
import FixExceptionTaskHandler from "../../TaskHandlers/FixExceptionTaskHandler";
import ImproveExceptionHandlingTaskHandler from "../../TaskHandlers/ImproveExceptionHandlingTaskHandler";
import { TaskContext } from "../../TaskHandlers/TaskHandlerInterface";
import BackendAPI, {
  CodeRepositoryInfo,
  ExceptionDetails,
} from "../../Utils/BackendAPI";
import BuildVerification from "../../Utils/BuildVerification";
import PullRequestCreator, {
  PullRequestOptions,
  PullRequestResult,
} from "../../Utils/PullRequestCreator";
import RepositoryManager, { CloneResult } from "../../Utils/RepositoryManager";
import TaskLogger from "../../Utils/TaskLogger";
import WorkspaceManager, { WorkspaceInfo } from "../../Utils/WorkspaceManager";
import { CodeAgentFactory } from "../../CodeAgents/Index";
import { CodeAgent } from "../../CodeAgents/CodeAgentInterface";
import FixVerificationStatus from "Common/Types/AI/FixVerificationStatus";
import ObjectID from "Common/Types/ObjectID";

const TASK_ID: string = "5240eeee-0000-4000-8000-0000000000f1";
const EXCEPTION_URL: string =
  "https://oneuptime.example/dashboard/5240eeee-0000-4000-8000-000000000001/exceptions/5240eeee-0000-4000-8000-0000000000e1";
const FINDING_URL: string =
  "https://oneuptime.example/dashboard/5240eeee-0000-4000-8000-000000000001/exceptions/ai/insights/5240eeee-0000-4000-8000-0000000000d1";

const BASE: ExceptionDetails = {
  exception: {
    id: "exception-id",
    message: "TypeError: Cannot read properties of undefined (reading 'id')",
    stackTrace: "    at getOrder (/app/src/orders.ts:42:17)",
    exceptionType: "TypeError",
    fingerprint: "fingerprint",
  },
  service: { id: "service-id", name: "checkout", description: "" },
};

function details(overrides: Partial<ExceptionDetails> = {}): ExceptionDetails {
  return {
    ...BASE,
    ...overrides,
    exception: { ...BASE.exception, ...(overrides.exception || {}) },
  };
}

const STARTED_BY_ONEUPTIME: ExceptionDetails = details({
  exception: { ...BASE.exception, url: EXCEPTION_URL },
  startedBy: {
    finding: "New exception in checkout: TypeError",
    findingUrl: FINDING_URL,
    isStartedByOneUptime: true,
  },
});

describe("the why section of an exception's AI pull request", () => {
  test("OneUptime started it on its own: what it found, with links to the finding and the exception", () => {
    expect(
      ExceptionPullRequestTaskHandler.buildWhySection(STARTED_BY_ONEUPTIME),
    ).toBe(
      [
        "### Why this pull request",
        "",
        `OneUptime found this in your production telemetry and started this task on its own: **New exception in checkout: TypeError** ([see what it found](${FINDING_URL})).`,
        "",
        `[Open the exception in OneUptime](${EXCEPTION_URL})`,
        "",
        "",
      ].join("\n"),
    );
  });

  test("a person asked from the finding: what OneUptime found, not that it started it", () => {
    const section: string = ExceptionPullRequestTaskHandler.buildWhySection(
      details({
        startedBy: {
          finding: "Rising exception in checkout: TypeError",
          findingUrl: FINDING_URL,
          isStartedByOneUptime: false,
        },
      }),
    );

    expect(section.split("\n")[2]).toBe(
      `OneUptime found this in your production telemetry: **Rising exception in checkout: TypeError** ([see what it found](${FINDING_URL})).`,
    );
    expect(section).not.toContain("on its own");
  });

  test("a task started on the exception's own page: only the link to the exception", () => {
    expect(
      ExceptionPullRequestTaskHandler.buildWhySection(
        details({ exception: { ...BASE.exception, url: EXCEPTION_URL } }),
      ),
    ).toBe(`[Open the exception in OneUptime](${EXCEPTION_URL})\n\n`);
  });

  test("an older server says neither: nothing", () => {
    expect(ExceptionPullRequestTaskHandler.buildWhySection(BASE)).toBe("");
    expect(
      ExceptionPullRequestTaskHandler.buildWhySection(
        details({ startedBy: null }),
      ),
    ).toBe("");
  });

  test("the finding is placed as text: what would turn it into Markdown is escaped, and it stays on one line", () => {
    const section: string = ExceptionPullRequestTaskHandler.buildWhySection(
      details({
        startedBy: {
          finding: "**Pwned** [click](https://evil.example)\n# Heading",
          findingUrl: FINDING_URL,
          isStartedByOneUptime: true,
        },
      }),
    );
    const sentence: string = section.split("\n")[2]!;

    // The heading, a blank line, the one sentence - and the gap below it.
    expect(section.split("\n")).toEqual([
      "### Why this pull request",
      "",
      sentence,
      "",
      "",
    ]);
    expect(sentence).not.toContain("**Pwned**");
    expect(sentence).not.toContain("[click](https://evil.example)");
    expect(sentence).toContain("\\*\\*Pwned\\*\\*");
  });

  test("a link that is not a web address is left out", () => {
    const section: string = ExceptionPullRequestTaskHandler.buildWhySection(
      details({
        exception: { ...BASE.exception, url: "javascript:alert(1)" },
        startedBy: {
          finding: "New exception in checkout: TypeError",
          findingUrl: "javascript:alert(1)",
          isStartedByOneUptime: true,
        },
      }),
    );

    expect(section).not.toContain("javascript:");
    expect(section).not.toContain("see what it found");
    expect(section).not.toContain("Open the exception in OneUptime");
    expect(section.split("\n")[2]).toBe(
      "OneUptime found this in your production telemetry and started this task on its own: **New exception in checkout: TypeError**.",
    );
  });

  test("an empty finding: the sentence alone, with its link", () => {
    expect(
      ExceptionPullRequestTaskHandler.buildWhySection(
        details({
          startedBy: {
            finding: "  ",
            findingUrl: FINDING_URL,
            isStartedByOneUptime: true,
          },
        }),
      ).split("\n")[2],
    ).toBe(
      `OneUptime found this in your production telemetry and started this task on its own ([see what it found](${FINDING_URL})).`,
    );
  });
});

describe("where the why section goes in the body", () => {
  const why: string =
    ExceptionPullRequestTaskHandler.buildWhySection(STARTED_BY_ONEUPTIME);

  test("under the body's heading, before everything else", () => {
    expect(
      ExceptionPullRequestTaskHandler.withWhySection(
        "## Exception Fix\n\nThis pull request was generated.\n\n### Exception Details",
        STARTED_BY_ONEUPTIME,
      ),
    ).toBe(
      `## Exception Fix\n\n${why}This pull request was generated.\n\n### Exception Details`,
    );
  });

  test("above everything, in a body with no heading; after a heading that is all there is", () => {
    expect(
      ExceptionPullRequestTaskHandler.withWhySection(
        "Generated.",
        STARTED_BY_ONEUPTIME,
      ),
    ).toBe(`${why}Generated.`);
    expect(
      ExceptionPullRequestTaskHandler.withWhySection(
        "## Exception Fix",
        STARTED_BY_ONEUPTIME,
      ),
    ).toBe(`## Exception Fix\n\n${why}`);
  });

  test("nothing to say: the body as it was", () => {
    const body: string = "## Exception Fix\n\nThis pull request was generated.";

    expect(ExceptionPullRequestTaskHandler.withWhySection(body, BASE)).toBe(
      body,
    );
  });
});

/*
 * Through a whole run of the real recipes: the Runner asks for the details
 * of the task it claimed, and the pull request it opens says why.
 */
describe("an exception's AI pull request, opened", () => {
  const REPOSITORY: CodeRepositoryInfo = {
    id: "repo-id",
    name: "checkout",
    repositoryHostedAt: "GitHub",
    organizationName: "acme",
    repositoryName: "checkout",
    mainBranchName: "main",
    setupCommand: null,
    buildCommand: null,
    testCommand: null,
    servicePathInRepository: null,
    gitHubAppInstallationId: "installation-id",
  };

  function stubPipeline(): jest.Mock {
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
    jest
      .spyOn(WorkspaceManager, "deleteWorkspace")
      .mockResolvedValue(undefined);
    jest
      .spyOn(RepositoryManager.prototype, "cloneRepository")
      .mockResolvedValue({
        workingDirectory: "/tmp/workspace",
        repositoryPath: "/tmp/workspace/acme__checkout",
        baseBranch: "main",
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

    const agent: CodeAgent = {
      name: "Scripted",
      initialize: jest.fn().mockResolvedValue(undefined),
      executeTask: jest.fn().mockResolvedValue({
        success: true,
        filesModified: ["src/orders.ts"],
        summary: "Guarded the undefined order.",
        logs: [],
        exitCode: 0,
      }),
      onProgress: jest.fn(),
      isAvailable: jest.fn().mockResolvedValue(true),
      abort: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined),
    } as unknown as CodeAgent;

    jest.spyOn(CodeAgentFactory, "createDefaultAgent").mockReturnValue(agent);

    return createPullRequest;
  }

  function context(exceptionDetails: ExceptionDetails): TaskContext {
    const backendAPI: BackendAPI = {
      getExceptionDetails: jest.fn().mockResolvedValue(exceptionDetails),
      getCodeRepositories: jest.fn().mockResolvedValue([REPOSITORY]),
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

    return {
      taskId: new ObjectID(TASK_ID),
      projectId: ObjectID.generate(),
      taskType: "FixException",
      exceptionId: "exception-id",
      logger: {
        info: jest.fn().mockResolvedValue(undefined),
        debug: jest.fn().mockResolvedValue(undefined),
        warning: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
        flush: jest.fn().mockResolvedValue(undefined),
        dispose: jest.fn().mockResolvedValue(undefined),
        logProcessOutput: jest.fn().mockResolvedValue(undefined),
      } as unknown as TaskLogger,
      backendAPI,
      startedAt: new Date(0),
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [
      "a fix",
      (): ExceptionPullRequestTaskHandler => {
        return new FixExceptionTaskHandler();
      },
      "## Exception Fix",
    ],
    [
      "better handling",
      (): ExceptionPullRequestTaskHandler => {
        return new ImproveExceptionHandlingTaskHandler();
      },
      "## Error Handling Improvement",
    ],
  ])(
    "%s: the details of the claimed task are asked for, and the body says why under its heading",
    async (
      _label: string,
      build: () => ExceptionPullRequestTaskHandler,
      heading: string,
    ) => {
      const createPullRequest: jest.Mock = stubPipeline();
      const taskContext: TaskContext = context(STARTED_BY_ONEUPTIME);

      await build().execute(taskContext);

      expect(
        (taskContext.backendAPI.getExceptionDetails as unknown as jest.Mock)
          .mock.calls[0],
      ).toEqual(["exception-id", TASK_ID]);
      expect(createPullRequest).toHaveBeenCalledTimes(1);

      const body: string = (
        createPullRequest.mock.calls[0]?.[0] as PullRequestOptions
      ).body;
      const lines: Array<string> = body.split("\n");

      expect(lines[0]).toBe(heading);
      expect(lines[1]).toBe("");
      expect(lines[2]).toBe("### Why this pull request");
      expect(body).toContain(`([see what it found](${FINDING_URL}))`);
      expect(body).toContain(
        `[Open the exception in OneUptime](${EXCEPTION_URL})`,
      );
      // The rest of the body is all still there, after it.
      expect(body.indexOf("### Exception Details")).toBeGreaterThan(
        body.indexOf("### Why this pull request"),
      );
      expect(body).toContain("Nothing is merged automatically.");
    },
  );

  test("from an older server: the body as it always was", async () => {
    const createPullRequest: jest.Mock = stubPipeline();

    await new FixExceptionTaskHandler().execute(context(BASE));

    const body: string = (
      createPullRequest.mock.calls[0]?.[0] as PullRequestOptions
    ).body;

    expect(body).not.toContain("### Why this pull request");
    expect(body).not.toContain("Open the exception in OneUptime");
    expect(body.split("\n")[2]).toBe(
      "This pull request was automatically generated by OneUptime AI Agent to fix an exception.",
    );
  });
});
