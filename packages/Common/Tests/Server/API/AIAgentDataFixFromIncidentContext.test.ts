import AIAgentDataAPI from "../../../Server/API/AIAgentDataAPI";
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

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentDataAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    taskId = ObjectID.generate();

    jest.spyOn(CodeFixAgentAuth, "checkCredential").mockResolvedValue(
      credentialCheckProving({
        id: ObjectID.generate(),
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
    ): Promise<SpyInstance<
      typeof CodeRepositoryService.resolveRepositoryForException
    >> {
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
  });
});
