import AIAgentDataAPI from "../../../Server/API/AIAgentDataAPI";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import IncidentService from "../../../Server/Services/IncidentService";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
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
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

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

const TASK_DETAILS_ROUTE: string =
  "/ai-agent-data/get-instrumentation-task-details";

describe("FixFromIncident task-details investigation context", () => {
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

    jest.spyOn(CodeFixAgentAuth, "resolveAgentIdentity").mockResolvedValue({
      id: ObjectID.generate(),
      projectId,
      source: CodeFixAgentSource.AIAgent,
    });
    jest
      .spyOn(CodeFixAgentAuth, "deniesAccessToProject")
      .mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function fixRun(data: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    sourceInvestigationRunId?: ObjectID | undefined;
    sourceInvestigationAnalysisMarkdown?: string | undefined;
  }): AIRun {
    const run: AIRun = new AIRun();
    run.id = taskId;
    run.projectId = projectId;
    run.runType = AIRunType.CodeFix;
    run.codeFixTaskType = CodeFixTaskType.FixFromIncident;

    if (data.incidentId) {
      run.triggeredByIncidentId = data.incidentId;
    }

    if (data.alertId) {
      run.triggeredByAlertId = data.alertId;
    }

    if (
      data.sourceInvestigationRunId ||
      data.sourceInvestigationAnalysisMarkdown
    ) {
      run.taskContext = {
        ...(data.sourceInvestigationRunId
          ? {
              sourceInvestigationRunId:
                data.sourceInvestigationRunId.toString(),
            }
          : {}),
        ...(data.sourceInvestigationAnalysisMarkdown
          ? {
              sourceInvestigationAnalysisMarkdown:
                data.sourceInvestigationAnalysisMarkdown,
            }
          : {}),
      };
    }

    return run;
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
      .match("POST", TASK_DETAILS_ROUTE)
      .handlerFunction(req, res, next);
  }

  function jsonResponse(): JSONObject | undefined {
    const sendJsonObjectResponse: jest.Mock =
      Response.sendJsonObjectResponse as unknown as jest.Mock;

    return sendJsonObjectResponse.mock.calls[0]?.[2] as JSONObject | undefined;
  }

  test("new incident task uses its frozen analysis without re-reading the feed", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const sourceInvestigationRunId: ObjectID = ObjectID.generate();
    const frozenAnalysis: string = "# Frozen incident analysis";
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(
      fixRun({
        incidentId,
        sourceInvestigationRunId,
        sourceInvestigationAnalysisMarkdown: frozenAnalysis,
      }),
    );

    const incident: Incident = new Incident();
    incident.title = "Database incident";
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);
    const getForIncident: jest.SpyInstance = jest.spyOn(
      PostedRootCause,
      "getForIncident",
    );
    jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue(null);

    await callRoute();

    expect(getForIncident).not.toHaveBeenCalled();
    expect(jsonResponse()).toEqual(
      expect.objectContaining({
        subjectType: "incident",
        analysisMarkdown: frozenAnalysis,
      }),
    );
  });

  test("source-id-only incident task reads the exact investigation for upgrade compatibility", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const sourceInvestigationRunId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(fixRun({ incidentId, sourceInvestigationRunId }));

    const incident: Incident = new Incident();
    incident.title = "Database incident";
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);
    const getForIncident: jest.SpyInstance = jest
      .spyOn(PostedRootCause, "getForIncident")
      .mockResolvedValue(null);

    await callRoute();

    expect(getForIncident).toHaveBeenCalledWith(incidentId, {
      aiRunId: sourceInvestigationRunId,
    });
  });

  test("legacy incident task falls back to the unscoped subject analysis", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(fixRun({ incidentId }));

    const incident: Incident = new Incident();
    incident.title = "Legacy incident";
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);
    const getForIncident: jest.SpyInstance = jest
      .spyOn(PostedRootCause, "getForIncident")
      .mockResolvedValue(null);

    await callRoute();

    expect(getForIncident).toHaveBeenCalledTimes(1);
    expect(getForIncident).toHaveBeenCalledWith(incidentId, undefined);
  });

  test("new alert task uses its frozen analysis without re-reading the feed", async () => {
    const alertId: ObjectID = ObjectID.generate();
    const sourceInvestigationRunId: ObjectID = ObjectID.generate();
    const frozenAnalysis: string = "# Frozen alert analysis";
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(
      fixRun({
        alertId,
        sourceInvestigationRunId,
        sourceInvestigationAnalysisMarkdown: frozenAnalysis,
      }),
    );

    const alert: Alert = new Alert();
    alert.title = "Latency alert";
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);
    const getForAlert: jest.SpyInstance = jest.spyOn(
      PostedRootCause,
      "getForAlert",
    );
    jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockResolvedValue(null);

    await callRoute();

    expect(getForAlert).not.toHaveBeenCalled();
    expect(jsonResponse()).toEqual(
      expect.objectContaining({
        subjectType: "alert",
        analysisMarkdown: frozenAnalysis,
      }),
    );
  });

  test("source-id-only alert task reads the exact investigation for upgrade compatibility", async () => {
    const alertId: ObjectID = ObjectID.generate();
    const sourceInvestigationRunId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(fixRun({ alertId, sourceInvestigationRunId }));

    const alert: Alert = new Alert();
    alert.title = "Latency alert";
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);
    const getForAlert: jest.SpyInstance = jest
      .spyOn(PostedRootCause, "getForAlert")
      .mockResolvedValue(null);

    await callRoute();

    expect(getForAlert).toHaveBeenCalledWith(alertId, {
      aiRunId: sourceInvestigationRunId,
    });
  });

  test("legacy alert task falls back to the unscoped subject analysis", async () => {
    const alertId: ObjectID = ObjectID.generate();
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(fixRun({ alertId }));

    const alert: Alert = new Alert();
    alert.title = "Legacy alert";
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);
    const getForAlert: jest.SpyInstance = jest
      .spyOn(PostedRootCause, "getForAlert")
      .mockResolvedValue(null);

    await callRoute();

    expect(getForAlert).toHaveBeenCalledTimes(1);
    expect(getForAlert).toHaveBeenCalledWith(alertId, undefined);
  });
});
