import AIAgentDataAPI from "../../../Server/API/AIAgentDataAPI";
import { DashboardClientUrl } from "../../../Server/EnvironmentConfig";
import AIRunService from "../../../Server/Services/AIRunService";
import ServiceService from "../../../Server/Services/ServiceService";
import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import ExceptionFixStartedBy from "../../../Server/Utils/AI/CodeFix/ExceptionFixStartedBy";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
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

/*
 * The exception's details a Runner reads for an exception's AI task
 * (POST /ai-agent-data/get-exception-details) carry where the exception is
 * in OneUptime and - for the task the Runner claimed, when a finding
 * started it - why it was started, so its pull request can say so. An
 * older Runner sends no task id, and reads the details as it always did -
 * while it holds a fix of this exception, as every worker must.
 */

const DETAILS_ROUTE: string = "/ai-agent-data/get-exception-details";

function jsonResponse(): JSONObject | undefined {
  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return sendJson.mock.calls[0]?.[2] as JSONObject | undefined;
}

describe("get-exception-details: where the exception is, and why its task was started", () => {
  let projectId: ObjectID;
  let exceptionId: ObjectID;
  let workerId: ObjectID;
  let readStartedBy: SpyInstance<typeof ExceptionFixStartedBy.read>;
  let findHeldRun: SpyInstance<typeof AIRunService.findOneBy>;

  // The fix of this exception the worker claimed and still works on.
  function heldRun(): AIRun {
    const run: AIRun = new AIRun();
    run.id = ObjectID.generate();
    run.projectId = projectId;
    run.runType = AIRunType.CodeFix;
    run.status = AIRunStatus.Running;
    run.aiAgentId = workerId;
    run.triggeredByTelemetryExceptionId = exceptionId;
    return run;
  }

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentDataAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    exceptionId = ObjectID.generate();
    workerId = ObjectID.generate();

    jest.spyOn(CodeFixAgentAuth, "checkCredential").mockResolvedValue(
      credentialCheckProving({
        id: workerId,
        projectId,
        source: CodeFixAgentSource.AIAgent,
      }),
    );
    // The run the request names, and the one a request that names none holds.
    jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
      return heldRun();
    });
    findHeldRun = jest
      .spyOn(AIRunService, "findOneBy")
      .mockImplementation(async () => {
        return heldRun();
      });
    jest
      .spyOn(CodeFixAgentAuth, "deniesAccessToProject")
      .mockReturnValue(false);
    jest.spyOn(TelemetryExceptionService, "findOneById").mockResolvedValue({
      _id: exceptionId.toString(),
      id: exceptionId,
      projectId,
      message: "Cannot read properties of undefined (reading 'id')",
      stackTrace: "    at getOrder (/app/src/orders.ts:42:17)",
      exceptionType: "TypeError",
      fingerprint: "abc",
    } as unknown as TelemetryException);
    jest.spyOn(ServiceService, "findOneById").mockResolvedValue(null);
    readStartedBy = jest
      .spyOn(ExceptionFixStartedBy, "read")
      .mockResolvedValue({
        finding: "New exception in checkout: TypeError",
        findingUrl: "https://oneuptime.example/dashboard/finding",
        isStartedByOneUptime: true,
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function callRoute(taskId?: unknown): Promise<void> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      body: {
        aiAgentId: ObjectID.generate().toString(),
        aiAgentKey: "agent-key",
        exceptionId: exceptionId.toString(),
        ...(taskId === undefined ? {} : { taskId }),
      },
      headers: {},
    } as unknown as ExpressRequest;
    const res: ExpressResponse = {} as ExpressResponse;
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await mockRouter
      .match("POST", DETAILS_ROUTE)
      .handlerFunction(req, res, next);
  }

  test("for the task the Runner claimed: why it was started, read for that task of this exception", async () => {
    const taskId: ObjectID = ObjectID.generate();

    await callRoute(taskId.toString());

    expect(readStartedBy).toHaveBeenCalledTimes(1);

    const asked: JSONObject = readStartedBy.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(String(asked["taskId"])).toBe(taskId.toString());
    expect(String(asked["exceptionId"])).toBe(exceptionId.toString());
    expect(String(asked["projectId"])).toBe(projectId.toString());

    const response: JSONObject = jsonResponse()!;

    expect(response["startedBy"]).toEqual({
      finding: "New exception in checkout: TypeError",
      findingUrl: "https://oneuptime.example/dashboard/finding",
      isStartedByOneUptime: true,
    });
    expect((response["exception"] as JSONObject)["url"]).toBe(
      `${DashboardClientUrl.toString()}/${projectId.toString()}/exceptions/${exceptionId.toString()}`,
    );
  });

  test("an older Runner sends no task id: the details as they were, and the exception's page", async () => {
    await callRoute();

    expect(readStartedBy).not.toHaveBeenCalled();

    const response: JSONObject = jsonResponse()!;

    expect(response["startedBy"]).toBeNull();
    expect((response["exception"] as JSONObject)["url"]).toBe(
      `${DashboardClientUrl.toString()}/${projectId.toString()}/exceptions/${exceptionId.toString()}`,
    );
    expect((response["exception"] as JSONObject)["exceptionType"]).toBe(
      "TypeError",
    );
  });

  test("an older Runner is held to a fix of this exception it claimed and still works on", async () => {
    await callRoute();

    expect(findHeldRun).toHaveBeenCalledTimes(1);

    const query: JSONObject = (
      findHeldRun.mock.calls[0]![0] as unknown as { query: JSONObject }
    ).query;

    expect(String(query["projectId"])).toBe(projectId.toString());
    expect(query["runType"]).toBe(AIRunType.CodeFix);
    expect(query["status"]).toBe(AIRunStatus.Running);
    expect(String(query["aiAgentId"])).toBe(workerId.toString());
    expect(String(query["triggeredByTelemetryExceptionId"])).toBe(
      exceptionId.toString(),
    );
  });

  test("an older Runner that holds no fix of this exception is told nothing of it", async () => {
    findHeldRun.mockResolvedValue(null);

    await callRoute();

    expect(jsonResponse()).toBeUndefined();
    expect(
      (
        (Response.sendErrorResponse as unknown as jest.Mock).mock
          .calls[0]![2] as Error
      ).message,
    ).toBe("Exception not found");
  });

  test("a task the worker does not hold, or one of another exception, is told nothing", async () => {
    const shapes: Array<(run: AIRun) => void> = [
      (run: AIRun): void => {
        run.aiAgentId = ObjectID.generate();
      },
      (run: AIRun): void => {
        run.status = AIRunStatus.Completed;
      },
      (run: AIRun): void => {
        run.triggeredByTelemetryExceptionId = ObjectID.generate();
      },
    ];

    for (const shape of shapes) {
      jest.clearAllMocks();
      jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
        const run: AIRun = heldRun();
        shape(run);
        return run;
      });

      await callRoute(ObjectID.generate().toString());

      expect(jsonResponse()).toBeUndefined();
      expect(readStartedBy).not.toHaveBeenCalled();
    }
  });

  test("a task id that is not one is never read", async () => {
    for (const taskId of ["not-an-id", 42, { _id: "x" }, ""]) {
      jest.clearAllMocks();

      await callRoute(taskId);

      expect(readStartedBy).not.toHaveBeenCalled();
      expect(jsonResponse()!["startedBy"]).toBeNull();
    }
  });

  test("a task no finding started says nothing of why", async () => {
    readStartedBy.mockResolvedValueOnce(null);

    await callRoute(ObjectID.generate().toString());

    expect(jsonResponse()!["startedBy"]).toBeNull();
  });
});
