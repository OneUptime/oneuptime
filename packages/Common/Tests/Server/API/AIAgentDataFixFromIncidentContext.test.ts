import AIAgentDataAPI, {
  getPrivateSubjectNeedsNewerRunnerMessage,
} from "../../../Server/API/AIAgentDataAPI";
import RunnerCodeFixCapability, {
  SUBJECT_IS_PRIVATE_FIELD,
} from "../../../Types/Runner/RunnerCodeFixCapability";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import IncidentService from "../../../Server/Services/IncidentService";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
import PostedRootCause from "../../../Server/Utils/AI/SRE/PostedRootCause";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskContext from "../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    redirect: jest.fn(),
  };
});

const DETAILS_ROUTE: string = "/ai-agent-data/get-instrumentation-task-details";
const PINNED_ANALYSIS: string =
  "## Pinned root cause\n\nA repository code change fixes regression A.";

function jsonResponse(): JSONObject | undefined {
  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return sendJson.mock.calls[0]?.[2] as JSONObject | undefined;
}

function thrownError(): Error | undefined {
  const sendError: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;

  return sendError.mock.calls[0]?.[2] as Error | undefined;
}

describe("FixFromIncident task-details investigation snapshot", () => {
  let projectId: ObjectID;
  let taskId: ObjectID;
  // The agent asking, which claimed the run and works on it.
  let workerId: ObjectID;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentDataAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    taskId = ObjectID.generate();
    workerId = ObjectID.generate();

    jest.spyOn(CodeFixAgentAuth, "checkCredential").mockResolvedValue(
      credentialCheckProving({
        id: workerId,
        projectId,
        source: CodeFixAgentSource.AIAgent,
      }),
    );
    jest
      .spyOn(CodeFixAgentAuth, "deniesAccessToProject")
      .mockReturnValue(false);
    jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function fixRun(data: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    taskContext?: CodeFixTaskContext | undefined;
    taskType?: CodeFixTaskType | undefined;
  }): AIRun {
    return {
      id: taskId,
      projectId,
      runType: AIRunType.CodeFix,
      status: AIRunStatus.Running,
      aiAgentId: workerId,
      codeFixTaskType: data.taskType || CodeFixTaskType.FixFromIncident,
      triggeredByIncidentId: data.incidentId,
      triggeredByAlertId: data.alertId,
      taskContext: data.taskContext,
    } as unknown as AIRun;
  }

  function snapshot(runId: ObjectID): CodeFixTaskContext {
    return {
      sourceInvestigationRunId: runId.toString(),
      sourceInvestigationAnalysisMarkdown: PINNED_ANALYSIS,
    };
  }

  async function callRoute(): Promise<void> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      body: {
        aiAgentId: ObjectID.generate().toString(),
        aiAgentKey: "agent-key",
        taskId: taskId.toString(),
      },
      headers: {},
    } as unknown as ExpressRequest;
    const res: ExpressResponse = {} as ExpressResponse;
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await mockRouter
      .match("POST", DETAILS_ROUTE)
      .handlerFunction(req, res, next);
  }

  test("incident task serves its frozen analysis without re-reading a newer report", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(
        fixRun({ incidentId, taskContext: snapshot(ObjectID.generate()) }),
      );
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      title: "Checkout failures",
      monitors: [{ name: "checkout-api" }],
    } as unknown as Incident);
    const getForIncident: SpyInstance<typeof PostedRootCause.getForIncident> =
      jest.spyOn(PostedRootCause, "getForIncident");

    await callRoute();

    expect(thrownError()).toBeUndefined();
    expect(getForIncident).not.toHaveBeenCalled();
    expect(jsonResponse()).toEqual(
      expect.objectContaining({
        subjectType: "incident",
        analysisMarkdown: PINNED_ANALYSIS,
      }),
    );
  });

  test("alert task serves its frozen analysis without re-reading a newer report", async () => {
    const alertId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(
        fixRun({ alertId, taskContext: snapshot(ObjectID.generate()) }),
      );
    jest.spyOn(AlertService, "findOneById").mockResolvedValue({
      title: "Latency alert",
      monitor: { name: "checkout-api" },
    } as unknown as Alert);
    const getForAlert: SpyInstance<typeof PostedRootCause.getForAlert> =
      jest.spyOn(PostedRootCause, "getForAlert");

    await callRoute();

    expect(thrownError()).toBeUndefined();
    expect(getForAlert).not.toHaveBeenCalled();
    expect(jsonResponse()).toEqual(
      expect.objectContaining({
        subjectType: "alert",
        analysisMarkdown: PINNED_ANALYSIS,
      }),
    );
  });

  test.each([
    ["missing", undefined],
    [
      "missing analysis",
      { sourceInvestigationRunId: ObjectID.generate().toString() },
    ],
    [
      "missing run id",
      { sourceInvestigationAnalysisMarkdown: PINNED_ANALYSIS },
    ],
  ] as Array<[string, CodeFixTaskContext | undefined]>)(
    "%s incident snapshot fails closed without consulting any report",
    async (_label: string, taskContext: CodeFixTaskContext | undefined) => {
      const incidentId: ObjectID = ObjectID.generate();
      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValue(fixRun({ incidentId, taskContext }));
      const getForIncident: SpyInstance<typeof PostedRootCause.getForIncident> =
        jest.spyOn(PostedRootCause, "getForIncident");

      await callRoute();

      expect(jsonResponse()).toBeUndefined();
      expect(getForIncident).not.toHaveBeenCalled();
      expect(thrownError()).toBeInstanceOf(BadDataException);
      expect(thrownError()?.message).toMatch(/pinned investigation analysis/i);
    },
  );

  test("a missing alert snapshot also fails closed without consulting any report", async () => {
    const alertId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(fixRun({ alertId }));
    const getForAlert: SpyInstance<typeof PostedRootCause.getForAlert> =
      jest.spyOn(PostedRootCause, "getForAlert");

    await callRoute();

    expect(jsonResponse()).toBeUndefined();
    expect(getForAlert).not.toHaveBeenCalled();
    expect(thrownError()).toBeInstanceOf(BadDataException);
  });

  test("other subject recipes retain the latest posted-report lookup", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const latestAnalysis: string = "## Latest subject report";
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(
      fixRun({
        incidentId,
        taskType: CodeFixTaskType.ImproveInstrumentation,
      }),
    );
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      title: "Checkout failures",
      monitors: [],
    } as unknown as Incident);
    const getForIncident: SpyInstance<typeof PostedRootCause.getForIncident> =
      jest
        .spyOn(PostedRootCause, "getForIncident")
        .mockResolvedValue(latestAnalysis);

    await callRoute();

    expect(getForIncident).toHaveBeenCalledWith(incidentId);
    expect(jsonResponse()?.["analysisMarkdown"]).toBe(latestAnalysis);
  });

  /*
   * A pull request the auto remediation rules opened is opened in one of the
   * repositories they allow (taskContext.allowedCodeRepositoryIds, stored
   * when it was queued): when the run starts, its repository is resolved
   * among those alone - every connected one when the rules named none.
   */
  describe("the repository it starts in", () => {
    const CHECKOUT_REPO: string = "c1111111-1111-4111-8111-111111111111";

    async function startWith(
      taskContext: CodeFixTaskContext,
    ): Promise<
      SpyInstance<typeof CodeRepositoryService.resolveRepositoryForException>
    > {
      const incidentId: ObjectID = ObjectID.generate();
      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValue(fixRun({ incidentId, taskContext }));
      jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
        title: "Checkout failures",
        monitors: [{ name: "checkout-api" }],
      } as unknown as Incident);
      const resolve: SpyInstance<
        typeof CodeRepositoryService.resolveRepositoryForException
      > = jest
        .spyOn(CodeRepositoryService, "resolveRepositoryForException")
        .mockResolvedValue(null);

      await callRoute();

      return resolve;
    }

    test("among the repositories the rules allowed when it was queued", async () => {
      const resolve: SpyInstance<
        typeof CodeRepositoryService.resolveRepositoryForException
      > = await startWith({
        ...snapshot(ObjectID.generate()),
        allowedCodeRepositoryIds: [CHECKOUT_REPO],
      });

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve.mock.calls[0]![0]).toEqual({
        projectId,
        stackTrace: null,
        serviceName: "checkout-api",
        allowance: {
          isEveryRepository: false,
          repositoryIds: [CHECKOUT_REPO],
        },
      });
    });

    test("a run that names none it may use - no rule narrowed it - may start in any connected repository", async () => {
      const resolve: SpyInstance<
        typeof CodeRepositoryService.resolveRepositoryForException
      > = await startWith(snapshot(ObjectID.generate()));

      expect(resolve.mock.calls[0]![0].allowance).toEqual(
        EVERY_CODE_REPOSITORY,
      );
    });

    test("an empty list allows none: it is never read as every repository", async () => {
      const resolve: SpyInstance<
        typeof CodeRepositoryService.resolveRepositoryForException
      > = await startWith({
        ...snapshot(ObjectID.generate()),
        allowedCodeRepositoryIds: [],
      });

      expect(resolve.mock.calls[0]![0].allowance).toEqual(NO_CODE_REPOSITORY);
    });

    /*
     * A fix a person opened with Open fix pull request (#11209): queued in
     * the repository decided for them - their pick, or the one the
     * monitor's name resolved to among those they may use - and started
     * there alone, however the repositories changed since.
     */
    test("a fix a person opened: in the repository decided for them alone", async () => {
      const resolve: SpyInstance<
        typeof CodeRepositoryService.resolveRepositoryForException
      > = await startWith({
        ...snapshot(ObjectID.generate()),
        pickedCodeRepositoryId: CHECKOUT_REPO,
      });

      expect(resolve.mock.calls[0]![0]).toEqual({
        projectId,
        stackTrace: null,
        serviceName: "checkout-api",
        allowance: {
          isEveryRepository: false,
          repositoryIds: [CHECKOUT_REPO],
        },
      });
    });

    test("the person's repository is held to, whatever list a rule wrote beside it", async () => {
      const resolve: SpyInstance<
        typeof CodeRepositoryService.resolveRepositoryForException
      > = await startWith({
        ...snapshot(ObjectID.generate()),
        pickedCodeRepositoryId: CHECKOUT_REPO.toUpperCase(),
        allowedCodeRepositoryIds: [ObjectID.generate().toString()],
      });

      expect(resolve.mock.calls[0]![0].allowance).toEqual({
        isEveryRepository: false,
        repositoryIds: [CHECKOUT_REPO],
      });
    });
  });

  /*
   * IMPROVE LOGGING / TRACING (#11209): the run a person asked for from a
   * service's page is queued in the repository decided for them, and starts
   * there alone - the service's name is matched against that one repository
   * only. It used to be resolved among every connected repository again
   * when it started.
   */
  describe("an improvement's repository when it starts", () => {
    const LEDGER_REPO: string = "c2222222-2222-4222-8222-222222222222";

    async function startImprovement(
      taskType: CodeFixTaskType,
      taskContext: CodeFixTaskContext,
    ): Promise<
      SpyInstance<typeof CodeRepositoryService.resolveRepositoryForException>
    > {
      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValue(fixRun({ taskType, taskContext }));
      const resolve: SpyInstance<
        typeof CodeRepositoryService.resolveRepositoryForException
      > = jest
        .spyOn(CodeRepositoryService, "resolveRepositoryForException")
        .mockResolvedValue(null);

      await callRoute();

      return resolve;
    }

    test.each([CodeFixTaskType.ImproveLogging, CodeFixTaskType.ImproveTracing])(
      "%s a person asked for: matched against the repository decided for them alone",
      async (taskType: CodeFixTaskType) => {
        const resolve: SpyInstance<
          typeof CodeRepositoryService.resolveRepositoryForException
        > = await startImprovement(taskType, {
          telemetryServiceId: ObjectID.generate().toString(),
          serviceName: "checkout",
          pickedCodeRepositoryId: LEDGER_REPO,
        });

        expect(resolve).toHaveBeenCalledTimes(1);
        expect(resolve.mock.calls[0]![0]).toEqual({
          projectId,
          stackTrace: null,
          serviceName: "checkout",
          allowance: {
            isEveryRepository: false,
            repositoryIds: [LEDGER_REPO],
          },
        });
      },
    );

    test("one queued before the rule: any connected repository, as it was", async () => {
      const resolve: SpyInstance<
        typeof CodeRepositoryService.resolveRepositoryForException
      > = await startImprovement(CodeFixTaskType.ImproveLogging, {
        telemetryServiceId: ObjectID.generate().toString(),
        serviceName: "checkout",
      });

      expect(resolve.mock.calls[0]![0].allowance).toEqual(
        EVERY_CODE_REPOSITORY,
      );
    });

    test("nothing resolves there: the run is told why, with no repository", async () => {
      await startImprovement(CodeFixTaskType.ImproveTracing, {
        telemetryServiceId: ObjectID.generate().toString(),
        serviceName: "checkout",
        pickedCodeRepositoryId: LEDGER_REPO,
      });

      expect(jsonResponse()).toEqual(
        expect.objectContaining({
          subjectType: "service",
          repositories: [],
        }),
      );
      expect(String(jsonResponse()?.["resolutionError"])).toMatch(
        /^Could not resolve a repository for this task/,
      );
    });
  });

  /*
   * A FIX ABOUT A PRIVATE INCIDENT OR ALERT (#9165): the Runner writes its
   * pull request, which everyone with access to the repository reads. The
   * details say the record is private - and are handed only to a Runner
   * that keeps it out of what it writes there
   * (keepsPrivateRecordsOutOfPullRequests). An older one would write the
   * record's title and the analysis into the pull request: it is refused,
   * saying to update it, and gets nothing of the record.
   */
  describe("a private incident's or alert's fix", () => {
    async function callAs(capabilities: Array<string> | null): Promise<void> {
      const req: ExpressRequest = {
        params: {},
        query: {},
        body: {
          aiAgentId: ObjectID.generate().toString(),
          aiAgentKey: "agent-key",
          taskId: taskId.toString(),
          ...(capabilities ? { codeFixCapabilities: capabilities } : {}),
        },
        headers: {},
      } as unknown as ExpressRequest;

      await mockRouter
        .match("POST", DETAILS_ROUTE)
        .handlerFunction(
          req,
          {} as ExpressResponse,
          jest.fn() as unknown as NextFunction,
        );
    }

    function privateSubject(
      kind: "incident" | "alert",
      isPrivate: boolean,
    ): void {
      const subjectId: ObjectID = ObjectID.generate();

      jest.spyOn(AIRunService, "findOneById").mockResolvedValue(
        fixRun({
          ...(kind === "incident"
            ? { incidentId: subjectId }
            : { alertId: subjectId }),
          taskContext: snapshot(ObjectID.generate()),
        }),
      );
      jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
        title: "Checkout outage at Acme Bank",
        isPrivate,
        monitors: [{ name: "checkout-api" }],
      } as unknown as Incident);
      jest.spyOn(AlertService, "findOneById").mockResolvedValue({
        title: "Acme Bank latency alert",
        isPrivate,
        monitor: { name: "checkout-api" },
      } as unknown as Alert);
    }

    test.each(["incident", "alert"] as const)(
      "a Runner that keeps the record out is told the %s is private",
      async (kind: "incident" | "alert") => {
        privateSubject(kind, true);

        await callAs([
          RunnerCodeFixCapability.ServerOpensPullRequests,
          RunnerCodeFixCapability.KeepsPrivateRecordsOutOfPullRequests,
        ]);

        expect(thrownError()).toBeUndefined();
        expect(jsonResponse()).toEqual(
          expect.objectContaining({
            subjectType: kind,
            [SUBJECT_IS_PRIVATE_FIELD]: true,
            analysisMarkdown: PINNED_ANALYSIS,
          }),
        );
      },
    );

    test.each(["incident", "alert"] as const)(
      "an older Runner is refused a private %s's fix, saying to update it, and gets nothing of it",
      async (kind: "incident" | "alert") => {
        privateSubject(kind, true);

        for (const capabilities of [
          null,
          [RunnerCodeFixCapability.ServerOpensPullRequests],
        ]) {
          (Response.sendErrorResponse as unknown as jest.Mock).mockClear();
          (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

          await callAs(capabilities);

          expect(jsonResponse()).toBeUndefined();
          expect(thrownError()).toBeInstanceOf(BadDataException);
          expect(thrownError()?.message).toBe(
            getPrivateSubjectNeedsNewerRunnerMessage(kind),
          );
          expect(thrownError()?.message).toContain("Update the Runner");
          expect(thrownError()?.message).not.toContain("Acme Bank");
        }
      },
    );

    test("a public record's fix is handed to any Runner, said not to be private", async () => {
      privateSubject("incident", false);

      await callAs(null);

      expect(thrownError()).toBeUndefined();
      expect(jsonResponse()).toEqual(
        expect.objectContaining({
          [SUBJECT_IS_PRIVATE_FIELD]: false,
          subjectTitle: "Checkout outage at Acme Bank",
        }),
      );
    });
  });
});
