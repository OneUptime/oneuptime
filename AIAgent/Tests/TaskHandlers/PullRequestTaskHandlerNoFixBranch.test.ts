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

/*
 * The branch under test is the tail of execute(): zero pull requests came out
 * of the repository loop, and the handler decides whether that is an Error or
 * a plain "no fix found" result. Everything upstream of that decision (git,
 * the code agent, GitHub) is stubbed — the seam is processRepository, whose
 * two interesting outcomes are "returned no PR url" and "threw".
 *
 * Why this matters: both outcomes used to be reported as Error, which put a
 * red pill and an inflated error rate on runs where the agent had simply read
 * the code and found nothing worth changing.
 */

/*
 * processRepository is private on both handlers, so a subclass cannot
 * override it — this is the typed seam jest.spyOn writes through instead.
 */
interface ProcessRepositorySeam {
  processRepository: (...args: Array<unknown>) => Promise<string | null>;
}

const repository: CodeRepositoryInfo = {
  id: "repo-id",
  name: "checkout",
  repositoryHostedAt: "GitHub",
  organizationName: "acme",
  repositoryName: "checkout",
  mainBranchName: "main",
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
  service: {
    id: "service-id",
    name: "checkout",
    description: "",
  },
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
};

const workspace: WorkspaceInfo = {
  workspacePath: "/tmp/workspace",
  taskId: "task-id",
  createdAt: new Date(0),
};

// A TaskLogger that records nothing — the handlers log on every step.
function buildLogger(): TaskLogger {
  return {
    info: jest.fn().mockResolvedValue(undefined),
    debug: jest.fn().mockResolvedValue(undefined),
    warning: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
  } as unknown as TaskLogger;
}

function buildContext(backendAPI: BackendAPI): TaskContext {
  return {
    taskId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    taskType: "FixException",
    exceptionId: "exception-id",
    logger: buildLogger(),
    backendAPI,
    startedAt: new Date(0),
  };
}

// Minimal concrete subclasses — the wording hooks are irrelevant to the branch.
class TestExceptionHandler extends ExceptionPullRequestTaskHandler {
  public readonly taskType: string = "FixException";
  public readonly name: string = "Test Exception Handler";
  protected readonly branchPrefix: string = "test/";
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
  public readonly taskType: string = "FixFromIncident";
  public readonly name: string = "Test Subject Handler";
  protected readonly branchPrefix: string = "test/";
  protected readonly noActionMessage: string =
    "No changes could be applied to any repository";
  protected readonly noRepositoryMessage: string = "No repository resolved";

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

describe("Pull-request task handlers: the no-pull-request branch", () => {
  beforeEach(() => {
    jest
      .spyOn(WorkspaceManager, "createWorkspace")
      .mockResolvedValue(workspace);
    jest.spyOn(WorkspaceManager, "deleteWorkspace").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("ExceptionPullRequestTaskHandler", () => {
    function buildBackendAPI(): BackendAPI {
      return {
        getExceptionDetails: jest.fn().mockResolvedValue(exceptionDetails),
        getCodeRepositories: jest.fn().mockResolvedValue([repository]),
      } as unknown as BackendAPI;
    }

    test("no pull requests and no repository errors: reports noFixFound, NOT an error", async () => {
      const handler: TestExceptionHandler = new TestExceptionHandler();

      // The agent ran fine and simply proposed nothing.
      jest
        .spyOn(handler as unknown as ProcessRepositorySeam, "processRepository")
        .mockResolvedValue(null);

      const result: TaskResult = await handler.execute(
        buildContext(buildBackendAPI()),
      );

      expect(result.success).toBe(false);
      expect(result.data?.["noFixFound"]).toBe(true);
      // The isError flag is what makes the caller throw and report Error.
      expect(result.data?.["isError"]).toBeUndefined();
      expect(result.message).toBe("No fixes could be applied to any repository");
    });

    test("no pull requests but a repository threw: reports an error carrying the failure", async () => {
      const handler: TestExceptionHandler = new TestExceptionHandler();

      jest
        .spyOn(handler as unknown as ProcessRepositorySeam, "processRepository")
        .mockRejectedValue(new Error("clone failed: permission denied"));

      const result: TaskResult = await handler.execute(
        buildContext(buildBackendAPI()),
      );

      expect(result.success).toBe(false);
      expect(result.data?.["isError"]).toBe(true);
      expect(result.data?.["noFixFound"]).toBeUndefined();
      // The message names the repository and the underlying failure.
      expect(result.message).toContain(
        "No fixes could be applied to any repository",
      );
      expect(result.message).toContain("acme/checkout");
      expect(result.message).toContain("clone failed: permission denied");
    });

    test("one repository failing and another proposing a PR is still a success", async () => {
      const handler: TestExceptionHandler = new TestExceptionHandler();
      const secondRepository: CodeRepositoryInfo = {
        ...repository,
        id: "repo-id-2",
        repositoryName: "billing",
      };

      const backendAPI: BackendAPI = {
        getExceptionDetails: jest.fn().mockResolvedValue(exceptionDetails),
        getCodeRepositories: jest
          .fn()
          .mockResolvedValue([repository, secondRepository]),
      } as unknown as BackendAPI;

      jest
        .spyOn(handler as unknown as ProcessRepositorySeam, "processRepository")
        .mockRejectedValueOnce(new Error("clone failed"))
        .mockResolvedValueOnce("https://github.com/acme/billing/pull/1");

      const result: TaskResult = await handler.execute(buildContext(backendAPI));

      expect(result.success).toBe(true);
      expect(result.pullRequestsCreated).toBe(1);
      expect(result.data?.["noFixFound"]).toBeUndefined();
      expect(result.data?.["isError"]).toBeUndefined();
      // The partial failure is still reported alongside the PR.
      expect(result.data?.["errors"]).toEqual([
        expect.stringContaining("clone failed"),
      ]);
    });

    test("no repository resolved is an error, not a no-fix result", async () => {
      const handler: TestExceptionHandler = new TestExceptionHandler();

      const backendAPI: BackendAPI = {
        getExceptionDetails: jest.fn().mockResolvedValue(exceptionDetails),
        getCodeRepositories: jest.fn().mockResolvedValue([]),
      } as unknown as BackendAPI;

      const result: TaskResult = await handler.execute(buildContext(backendAPI));

      expect(result.data?.["isError"]).toBe(true);
      expect(result.data?.["noFixFound"]).toBeUndefined();
    });
  });

  describe("SubjectPullRequestTaskHandler", () => {
    function buildBackendAPI(): BackendAPI {
      return {
        getSubjectTaskDetails: jest.fn().mockResolvedValue(subjectTaskDetails),
      } as unknown as BackendAPI;
    }

    test("no pull requests and no repository errors: reports noFixFound, NOT an error", async () => {
      const handler: TestSubjectHandler = new TestSubjectHandler();

      jest
        .spyOn(handler as unknown as ProcessRepositorySeam, "processRepository")
        .mockResolvedValue(null);

      const result: TaskResult = await handler.execute(
        buildContext(buildBackendAPI()),
      );

      expect(result.success).toBe(false);
      expect(result.data?.["noFixFound"]).toBe(true);
      expect(result.data?.["isError"]).toBeUndefined();
      expect(result.message).toBe(
        "No changes could be applied to any repository",
      );
    });

    test("no pull requests but a repository threw: reports an error carrying the failure", async () => {
      const handler: TestSubjectHandler = new TestSubjectHandler();

      jest
        .spyOn(handler as unknown as ProcessRepositorySeam, "processRepository")
        .mockRejectedValue(new Error("push rejected"));

      const result: TaskResult = await handler.execute(
        buildContext(buildBackendAPI()),
      );

      expect(result.success).toBe(false);
      expect(result.data?.["isError"]).toBe(true);
      expect(result.data?.["noFixFound"]).toBeUndefined();
      expect(result.message).toContain("acme/checkout");
      expect(result.message).toContain("push rejected");
    });
  });
});
