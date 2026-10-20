import CommonAPI from "../../../Server/API/CommonAPI";
import AIAgentTaskPullRequestService from "../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../Server/Services/AIRunService";
import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import FixProductionStatus from "../../../Types/AI/FixProductionStatus";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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

/*
 * The exception page's AI panel reads its tasks from get-ai-agent-task. A
 * fix task now also says what production showed once the fix shipped: the
 * production verdict of the run's merged pull request (the one whose status
 * changed last), read as root once the caller is known to read the
 * exception. A failure to read it costs the line, never the panel.
 */

const ROUTE: string =
  "/telemetry-exception/get-ai-agent-task/:telemetryExceptionId";
const EXCEPTION_ID: ObjectID = ObjectID.generate();
const FIX_RUN_ID: ObjectID = ObjectID.generate();
const TEST_RUN_ID: ObjectID = ObjectID.generate();

function run(id: ObjectID, taskType: CodeFixTaskType): JSONObject {
  return {
    id,
    _id: id.toString(),
    status: AIRunStatus.Completed,
    codeFixTaskType: taskType,
    createdAt: new Date("2026-10-18T09:00:00.000Z"),
  };
}

let sent: Array<JSONObject>;
let findPullRequests: SpyInstance<typeof AIAgentTaskPullRequestService.findBy>;

async function getTasks(): Promise<Array<JSONObject>> {
  const req: ExpressRequest = {
    params: { telemetryExceptionId: EXCEPTION_ID.toString() },
    headers: {},
    query: {},
    body: {},
  } as unknown as ExpressRequest;
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter
    .match("GET", ROUTE)
    .handlerFunction(req, {} as ExpressResponse, next);

  expect(next).not.toHaveBeenCalled();
  return sent[0]!["aiAgentTasks"] as Array<JSONObject>;
}

describe("GET get-ai-agent-task: the production verdict of a fix", () => {
  beforeAll(async () => {
    mockRouter.routes.length = 0;
    const module: { default: new () => unknown } = await import(
      "../../../Server/API/TelemetryExceptionAPI"
    );
    new module.default();
  });

  beforeEach(() => {
    sent = [];
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({ userId: ObjectID.generate() });
    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue({ _id: EXCEPTION_ID.toString() } as never);
    jest
      .spyOn(AIRunService, "getLatestCodeFixRunPerTaskType")
      .mockResolvedValue([
        run(FIX_RUN_ID, CodeFixTaskType.FixException),
        run(TEST_RUN_ID, CodeFixTaskType.WriteRegressionTest),
      ] as never);
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(((
      _req: ExpressRequest,
      _res: ExpressResponse,
      json: JSONObject,
    ) => {
      sent.push(json);
    }) as never);
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
    findPullRequests = jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockResolvedValue([
        {
          aiRunId: FIX_RUN_ID,
          pullRequestUrl: "https://github.com/acme/checkout/pull/482",
          productionStatus: FixProductionStatus.Verified,
          productionStatusAt: new Date("2026-10-20T10:00:00.000Z"),
          productionSummary:
            "No occurrence in the 24 hours since version 2.3.2 shipped the fix; before the fix it happened 21 times in 7 days.",
          deployedAt: new Date("2026-10-19T09:00:00.000Z"),
          deployedVersion: "2.3.2",
          deployedCommitSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
        },
        // An older pull request of the same run: not the one shown.
        {
          aiRunId: FIX_RUN_ID,
          productionStatus: FixProductionStatus.Watching,
          productionStatusAt: new Date("2026-10-19T10:00:00.000Z"),
        },
      ] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a fix task carries the verdict of its pull request whose status changed last", async () => {
    const tasks: Array<JSONObject> = await getTasks();

    expect(tasks[0]!["production"]).toEqual({
      status: FixProductionStatus.Verified,
      // A row from before the checks were told apart is an exception fix.
      check: "Exception",
      summary:
        "No occurrence in the 24 hours since version 2.3.2 shipped the fix; before the fix it happened 21 times in 7 days.",
      statusAt: new Date("2026-10-20T10:00:00.000Z"),
      deployedAt: new Date("2026-10-19T09:00:00.000Z"),
      deployedVersion: "2.3.2",
      deployedCommitSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
      pullRequestUrl: "https://github.com/acme/checkout/pull/482",
    });
    // A task with no merged fix has no verdict.
    expect(tasks[1]).not.toHaveProperty("production");
  });

  test("reads only these runs' pull requests that have a verdict, newest first, as root", async () => {
    await getTasks();

    const call: JSONObject = findPullRequests.mock
      .calls[0]![0] as unknown as JSONObject;
    const query: JSONObject = call["query"] as JSONObject;

    expect(JSON.stringify(query["aiRunId"])).toContain(FIX_RUN_ID.toString());
    expect(JSON.stringify(query["aiRunId"])).toContain(TEST_RUN_ID.toString());
    expect(query["productionStatus"]).toBeDefined();
    expect(call["sort"]).toEqual({ productionStatusAt: "DESC" });
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("a verdict that cannot be read costs its line, not the panel", async () => {
    findPullRequests.mockRejectedValue(new Error("Postgres is down"));

    const tasks: Array<JSONObject> = await getTasks();

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).not.toHaveProperty("production");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("production verdicts"),
    );
  });

  test("an exception the caller cannot read reads no verdict", async () => {
    (TelemetryExceptionService.findOneById as jest.Mock).mockResolvedValue(
      null as never,
    );
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await mockRouter.match("GET", ROUTE).handlerFunction(
      {
        params: { telemetryExceptionId: EXCEPTION_ID.toString() },
        headers: {},
        query: {},
        body: {},
      } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(findPullRequests).not.toHaveBeenCalled();
  });
});
