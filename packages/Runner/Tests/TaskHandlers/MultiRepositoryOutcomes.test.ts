/*
 * ---------------------------------------------------------------------------
 * What a run reports when it spans more than one repository.
 *
 * A single exception's stack trace can resolve to several connected
 * repositories, and the pipeline processes each one in turn, deliberately
 * continuing past a failure so that one bad repository cannot cost the fixes
 * in the others. That design decision creates a reporting problem this file
 * pins down: with N repositories there are 2^N outcomes, and the run has to
 * collapse them into ONE status that is not a lie.
 *
 * The rules being enforced:
 *
 *   - ANY pull request means the run SUCCEEDED, but the failures that
 *     happened alongside it must still be carried in the result. A run that
 *     opened one PR and blew up on two repositories, reported as a clean
 *     success with no detail, is how a silently half-broken integration goes
 *     unnoticed for weeks.
 *   - NO pull request but real failures is an ERROR, with every repository's
 *     failure named — not one representative message.
 *   - NO pull request and no failures is NoFixFound: the agent looked and
 *     found nothing. That is a result, not a fault.
 *
 * The seam is processRepository, which is private on both handlers — so a
 * subclass cannot override it and jest.spyOn writes through the typed seam
 * below instead. Everything under it (git, the agent, GitHub) is out of
 * scope here; this file is only about the collapse.
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
import ObjectID from "Common/Types/ObjectID";

// The private seam both handlers route every repository through.
interface ProcessRepositorySeam {
  processRepository: (...args: Array<unknown>) => Promise<string | null>;
}

function buildRepository(name: string): CodeRepositoryInfo {
  return {
    id: `${name}-id`,
    name,
    repositoryHostedAt: "GitHub",
    organizationName: "acme",
    repositoryName: name,
    mainBranchName: "main",
    setupCommand: null,
    buildCommand: null,
    testCommand: null,
    servicePathInRepository: null,
    gitHubAppInstallationId: "installation-id",
  };
}

const repositories: Array<CodeRepositoryInfo> = [
  buildRepository("checkout"),
  buildRepository("payments"),
  buildRepository("shipping"),
];

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
  repositories,
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
    getCodeRepositories: jest.fn().mockResolvedValue(repositories),
    getSubjectTaskDetails: jest.fn().mockResolvedValue(subjectTaskDetails),
  } as unknown as BackendAPI;
}

function buildContext(): TaskContext {
  return {
    taskId: new ObjectID("11111111-2222-4333-8444-555555555555"),
    projectId: ObjectID.generate(),
    taskType: "FixException",
    exceptionId: "exception-id",
    logger: buildLogger(),
    backendAPI: buildBackendAPI(),
    startedAt: new Date(0),
  };
}

class TestExceptionHandler extends ExceptionPullRequestTaskHandler {
  public readonly taskType: string = "FixException";
  public readonly name: string = "Test Exception Handler";
  protected readonly branchPrefix: string = "test-fix-";
  protected readonly noActionMessage: string =
    "No fixes could be applied to any repository";
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

/*
 * Script one outcome per repository, in the order the handler visits them.
 * A string is a pull-request URL, null is "nothing to change", and an Error
 * is a repository that blew up.
 */
function scriptRepositories(
  handler: ExceptionPullRequestTaskHandler | SubjectPullRequestTaskHandler,
  outcomes: Array<string | null | Error>,
): jest.SpyInstance {
  let index: number = 0;

  return jest
    .spyOn(
      handler as unknown as ProcessRepositorySeam,
      "processRepository" as never,
    )
    .mockImplementation((async (): Promise<string | null> => {
      const outcome: string | null | Error = outcomes[index++] as
        | string
        | null
        | Error;

      if (outcome instanceof Error) {
        throw outcome;
      }

      return outcome;
    }) as never);
}

beforeEach(() => {
  jest.spyOn(WorkspaceManager, "createWorkspace").mockResolvedValue({
    workspacePath: "/tmp/workspace",
    taskId: "task",
    createdAt: new Date(0),
  } as WorkspaceInfo);
  jest.spyOn(WorkspaceManager, "deleteWorkspace").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface HandlerCase {
  label: string;
  build: () => ExceptionPullRequestTaskHandler | SubjectPullRequestTaskHandler;
}

const HANDLERS: Array<HandlerCase> = [
  {
    label: "ExceptionPullRequestTaskHandler",
    build: () => {
      return new TestExceptionHandler();
    },
  },
  {
    label: "SubjectPullRequestTaskHandler",
    build: () => {
      return new TestSubjectHandler();
    },
  },
];

describe.each(HANDLERS)("$label", (handlerCase: HandlerCase) => {
  const build: HandlerCase["build"] = handlerCase.build;

  test("every repository is visited, even after one throws", async () => {
    const handler: ReturnType<typeof build> = build();
    const spy: jest.SpyInstance = scriptRepositories(handler, [
      new Error("clone failed"),
      "https://github.com/acme/payments/pull/2",
      null,
    ]);

    await handler.execute(buildContext());

    expect(spy).toHaveBeenCalledTimes(3);
  });

  test("all three open a pull request: success with all three urls", async () => {
    const handler: ReturnType<typeof build> = build();
    scriptRepositories(handler, [
      "https://github.com/acme/checkout/pull/1",
      "https://github.com/acme/payments/pull/2",
      "https://github.com/acme/shipping/pull/3",
    ]);

    const result: TaskResult = await handler.execute(buildContext());

    expect(result.success).toBe(true);
    expect(result.pullRequestsCreated).toBe(3);
    expect(result.pullRequestUrls).toHaveLength(3);
    expect(result.data?.["errors"]).toBeUndefined();
  });

  /*
   * The partial case, and the one most likely to be mis-reported. A run that
   * opened a pull request DID succeed — but reporting it as a clean success
   * with no trace of the two repositories that blew up is how a half-broken
   * integration stays invisible.
   */
  test("one success and two failures is a success that still carries both failures", async () => {
    const handler: ReturnType<typeof build> = build();
    scriptRepositories(handler, [
      new Error("clone failed: repository not found"),
      "https://github.com/acme/payments/pull/2",
      new Error("push rejected: protected branch"),
    ]);

    const result: TaskResult = await handler.execute(buildContext());

    expect(result.success).toBe(true);
    expect(result.pullRequestsCreated).toBe(1);

    const errors: Array<string> = result.data?.["errors"] as Array<string>;

    expect(errors).toHaveLength(2);
    // Each failure names the repository it belongs to.
    expect(errors[0]).toContain("acme/checkout");
    expect(errors[0]).toContain("repository not found");
    expect(errors[1]).toContain("acme/shipping");
    expect(errors[1]).toContain("protected branch");
  });

  test("a success alongside a no-change repository reports no errors", async () => {
    const handler: ReturnType<typeof build> = build();
    scriptRepositories(handler, [
      "https://github.com/acme/checkout/pull/1",
      null,
      null,
    ]);

    const result: TaskResult = await handler.execute(buildContext());

    expect(result.success).toBe(true);
    expect(result.pullRequestsCreated).toBe(1);
    expect(result.data?.["errors"]).toBeUndefined();
  });

  test("no pull requests and only failures is an Error naming every one", async () => {
    const handler: ReturnType<typeof build> = build();
    scriptRepositories(handler, [
      new Error("clone failed"),
      new Error("agent could not complete"),
      new Error("push rejected"),
    ]);

    const result: TaskResult = await handler.execute(buildContext());

    expect(result.success).toBe(false);
    expect(result.data?.["isError"]).toBe(true);
    expect(result.data?.["noFixFound"]).toBeUndefined();
    expect(result.message).toContain("clone failed");
    expect(result.message).toContain("agent could not complete");
    expect(result.message).toContain("push rejected");
  });

  /*
   * A failure in ONE repository still makes the whole run an error when
   * nothing else produced a pull request — otherwise a genuine outage in the
   * only repository that mattered is reported as "nothing to fix".
   */
  test("one failure and the rest finding nothing is still an Error", async () => {
    const handler: ReturnType<typeof build> = build();
    scriptRepositories(handler, [null, new Error("clone failed"), null]);

    const result: TaskResult = await handler.execute(buildContext());

    expect(result.success).toBe(false);
    expect(result.data?.["isError"]).toBe(true);
  });

  test("every repository finding nothing is NoFixFound, not an error", async () => {
    const handler: ReturnType<typeof build> = build();
    scriptRepositories(handler, [null, null, null]);

    const result: TaskResult = await handler.execute(buildContext());

    expect(result.success).toBe(false);
    expect(result.data?.["noFixFound"]).toBe(true);
    expect(result.data?.["isError"]).toBeUndefined();
  });

  /*
   * The workspace holds a full clone per repository. Leaving it behind on the
   * failure path is how a Runner fills its disk, so cleanup belongs in a
   * finally — not on the happy path.
   */
  test("the workspace is deleted whether the run succeeds or fails", async () => {
    const deleteSpy: jest.SpyInstance = jest.spyOn(
      WorkspaceManager,
      "deleteWorkspace",
    );

    const successHandler: ReturnType<typeof build> = build();
    scriptRepositories(successHandler, ["https://github.com/x/y/pull/1"]);
    await successHandler.execute(buildContext());

    const failureHandler: ReturnType<typeof build> = build();
    scriptRepositories(failureHandler, [new Error("boom")]);
    await failureHandler.execute(buildContext());

    expect(deleteSpy).toHaveBeenCalledTimes(2);
    expect(deleteSpy).toHaveBeenCalledWith("/tmp/workspace");
  });

  test("a non-Error throw is still reported, not swallowed", async () => {
    const handler: ReturnType<typeof build> = build();

    jest
      .spyOn(
        handler as unknown as ProcessRepositorySeam,
        "processRepository" as never,
      )
      .mockImplementation((() => {
        // A rejected promise carrying a plain string.
        return Promise.reject("something threw a string");
      }) as never);

    const result: TaskResult = await handler.execute(buildContext());

    expect(result.success).toBe(false);
    expect(result.data?.["isError"]).toBe(true);
    expect(result.message).toContain("something threw a string");
  });
});

describe("ExceptionPullRequestTaskHandler specifics", () => {
  test("a run carrying no exception fails clearly instead of calling the API with undefined", async () => {
    const context: TaskContext = buildContext();
    delete (context as { exceptionId?: string }).exceptionId;

    const result: TaskResult = await new TestExceptionHandler().execute(
      context,
    );

    expect(result.success).toBe(false);
    expect(result.data?.["isError"]).toBe(true);
    expect(result.message).toContain("requires a telemetry exception");
  });

  test("no resolved repository is an actionable error, not a silent no-op", async () => {
    const context: TaskContext = buildContext();
    (
      context.backendAPI.getCodeRepositories as unknown as jest.Mock
    ).mockResolvedValue([]);

    const result: TaskResult = await new TestExceptionHandler().execute(
      context,
    );

    expect(result.success).toBe(false);
    expect(result.data?.["isError"]).toBe(true);
    // The message tells the operator what to actually do about it.
    expect(result.message).toContain("GitHub App");
  });
});

describe("SubjectPullRequestTaskHandler specifics", () => {
  /*
   * The server knows WHY it could not resolve a repository for this subject
   * (no name match, more than one candidate). Preferring its guidance over
   * the handler's generic message is what makes the run actionable.
   */
  test("the server's resolution guidance is preferred over the generic message", async () => {
    const context: TaskContext = buildContext();
    (
      context.backendAPI.getSubjectTaskDetails as unknown as jest.Mock
    ).mockResolvedValue({
      ...subjectTaskDetails,
      repositories: [],
      resolutionError:
        "No connected repository matches the service 'checkout', and the project has 4 repositories.",
    });

    const result: TaskResult = await new TestSubjectHandler().execute(context);

    expect(result.success).toBe(false);
    expect(result.data?.["isError"]).toBe(true);
    expect(result.message).toContain("the project has 4 repositories");
  });

  test("without server guidance it falls back to the recipe's own message", async () => {
    const context: TaskContext = buildContext();
    (
      context.backendAPI.getSubjectTaskDetails as unknown as jest.Mock
    ).mockResolvedValue({
      ...subjectTaskDetails,
      repositories: [],
      resolutionError: null,
    });

    const result: TaskResult = await new TestSubjectHandler().execute(context);

    expect(result.message).toBe("No repository");
  });
});
