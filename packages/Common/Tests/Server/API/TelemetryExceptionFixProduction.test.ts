import CommonAPI from "../../../Server/API/CommonAPI";
import AIAgentTaskPullRequestService from "../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../Server/Services/AIRunService";
import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import CodeTaskListRows, {
  CodeTaskRepliesRead,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskListRows";
import CodeTaskThread from "../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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

const PROJECT_ID: ObjectID = ObjectID.generate();
const READER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: PROJECT_ID,
};

let sent: Array<JSONObject>;
let findPullRequests: SpyInstance<typeof AIAgentTaskPullRequestService.findBy>;
let hiddenFrom: SpyInstance<typeof CodeTaskThread.findTasksHiddenFrom>;
let readReplies: SpyInstance<typeof CodeTaskListRows.readReplies>;
// Each task's newest later turn, by the task's id (lower case).
let replies: Map<string, CodeTaskRepliesRead>;

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
      .mockResolvedValue(READER);
    jest.spyOn(TelemetryExceptionService, "findOneById").mockResolvedValue({
      _id: EXCEPTION_ID.toString(),
      projectId: PROJECT_ID,
    } as never);
    // The reader may read both tasks, unless a test says otherwise.
    hiddenFrom = jest
      .spyOn(CodeTaskThread, "findTasksHiddenFrom")
      .mockResolvedValue(new Set<string>());
    // No task has a later turn, unless a test says otherwise.
    replies = new Map<string, CodeTaskRepliesRead>();
    readReplies = jest
      .spyOn(CodeTaskListRows, "readReplies")
      .mockImplementation(async () => {
        return replies;
      });
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

  /*
   * A task a reply carried a private incident or alert into, which the
   * caller may not open, is read as its own page reads it: the panel learns
   * its type - the exception's fix is there - and nothing of how it stands:
   * no id, state, words, time, verdict, pull request or link.
   */
  test("a task hidden from the caller: its type, and nothing of it", async () => {
    hiddenFrom.mockResolvedValue(
      new Set<string>([FIX_RUN_ID.toString().toLowerCase()]),
    );

    const tasks: Array<JSONObject> = await getTasks();

    expect(tasks[0]).toEqual({
      taskType: CodeFixTaskType.FixException,
      isHidden: true,
    });
    expect(JSON.stringify(sent[0])).not.toContain(FIX_RUN_ID.toString());
    expect(JSON.stringify(sent[0])).not.toContain("pull/482");
    // The other task is the caller's to read, as before.
    expect(tasks[1]).toEqual(
      expect.objectContaining({
        _id: TEST_RUN_ID.toString(),
        status: AIRunStatus.Completed,
        taskType: CodeFixTaskType.WriteRegressionTest,
      }),
    );
    // Asked of these runs, for the caller, in the exception's project.
    expect(hiddenFrom).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      taskIds: [FIX_RUN_ID, TEST_RUN_ID],
      reader: READER,
    });
    // No verdict is read for a hidden task.
    const query: JSONObject = (
      findPullRequests.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;
    expect(JSON.stringify(query["aiRunId"])).not.toContain(
      FIX_RUN_ID.toString(),
    );
    expect(sent[0]!["aiAgentTask"]).toEqual({
      taskType: CodeFixTaskType.FixException,
      isHidden: true,
    });
  });

  test("a hidden task at work is not said to be: the legacy answer keeps it too", async () => {
    (
      AIRunService.getLatestCodeFixRunPerTaskType as jest.Mock
    ).mockResolvedValue([
      { ...run(FIX_RUN_ID, CodeFixTaskType.FixException), status: "Running" },
      run(TEST_RUN_ID, CodeFixTaskType.WriteRegressionTest),
    ] as never);
    hiddenFrom.mockResolvedValue(
      new Set<string>([FIX_RUN_ID.toString().toLowerCase()]),
    );

    await getTasks();

    expect(sent[0]!["hasActiveTask"]).toBe(false);
    expect(JSON.stringify(sent[0])).not.toContain("Running");

    // The same task, not hidden, is at work.
    sent = [];
    hiddenFrom.mockResolvedValue(new Set<string>());

    await getTasks();

    expect(sent[0]!["hasActiveTask"]).toBe(true);
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

/*
 * #9812: a fix of the exception that failed, asked again from Code (Try
 * again), is a later turn of the same task, with the same recipe and the
 * exception - and a reply someone sends in Code is a later turn too. The
 * panel names the task, as its link and the check on whether the caller
 * may see it read it, and says how the task stands: by its newest turn.
 */
describe("GET get-ai-agent-task: a task by its newest turn", () => {
  const TASK_ID: ObjectID = ObjectID.generate();
  const ASKED_AGAIN_ID: ObjectID = ObjectID.generate();
  const REPLY_ID: ObjectID = ObjectID.generate();

  function laterTurn(
    id: ObjectID,
    overrides: Partial<Record<string, unknown>> = {},
  ): AIRun {
    const turn: AIRun = new AIRun();
    turn.id = id;
    turn.codeTaskId = TASK_ID;
    turn.status = AIRunStatus.Running;
    turn.createdAt = new Date("2026-10-19T09:00:00.000Z");
    Object.assign(turn, overrides);
    return turn;
  }

  beforeAll(async () => {
    mockRouter.routes.length = 0;
    const module: { default: new () => unknown } = await import(
      "../../../Server/API/TelemetryExceptionAPI"
    );
    new module.default();
  });

  beforeEach(() => {
    sent = [];
    replies = new Map<string, CodeTaskRepliesRead>();
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(READER);
    jest.spyOn(TelemetryExceptionService, "findOneById").mockResolvedValue({
      _id: EXCEPTION_ID.toString(),
      projectId: PROJECT_ID,
    } as never);
    hiddenFrom = jest
      .spyOn(CodeTaskThread, "findTasksHiddenFrom")
      .mockResolvedValue(new Set<string>());
    readReplies = jest
      .spyOn(CodeTaskListRows, "readReplies")
      .mockImplementation(async () => {
        return replies;
      });
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(((
      _req: ExpressRequest,
      _res: ExpressResponse,
      json: JSONObject,
    ) => {
      sent.push(json);
    }) as never);
    findPullRequests = jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the fix asked again is named by its task, and works as it works", async () => {
    // The exception's latest fix is the turn Try again asked.
    jest
      .spyOn(AIRunService, "getLatestCodeFixRunPerTaskType")
      .mockResolvedValue([
        laterTurn(ASKED_AGAIN_ID, {
          codeFixTaskType: CodeFixTaskType.FixException,
        }),
      ] as never);
    replies.set(TASK_ID.toString().toLowerCase(), {
      count: 1,
      newest: laterTurn(ASKED_AGAIN_ID),
    });

    const tasks: Array<JSONObject> = await getTasks();

    expect(tasks[0]).toEqual(
      expect.objectContaining({
        _id: TASK_ID.toString(),
        status: AIRunStatus.Running,
        taskType: CodeFixTaskType.FixException,
      }),
    );
    expect(JSON.stringify(sent[0])).not.toContain(ASKED_AGAIN_ID.toString());
    expect(sent[0]!["hasActiveTask"]).toBe(true);

    // Whether the caller may see it, and its turns, are asked of the task.
    expect(hiddenFrom).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      taskIds: [TASK_ID],
      reader: READER,
    });
    expect(
      (readReplies.mock.calls[0]![0] as { taskIds: Array<ObjectID> }).taskIds,
    ).toEqual([TASK_ID]);
  });

  test("a reply sent in Code after the fix failed: the task works, and nothing offers a second fix", async () => {
    const failed: JSONObject = {
      ...run(TASK_ID, CodeFixTaskType.FixException),
      status: AIRunStatus.Error,
      errorMessage: "The build failed.",
    };
    jest
      .spyOn(AIRunService, "getLatestCodeFixRunPerTaskType")
      .mockResolvedValue([failed] as never);
    replies.set(TASK_ID.toString().toLowerCase(), {
      count: 1,
      newest: laterTurn(REPLY_ID, {
        codeFixTaskType: CodeFixTaskType.CodeRequest,
      }),
    });

    const tasks: Array<JSONObject> = await getTasks();

    expect(tasks[0]!["_id"]).toBe(TASK_ID.toString());
    expect(tasks[0]!["status"]).toBe(AIRunStatus.Running);
    // The failed turn's words are no longer how it stands.
    expect(tasks[0]!["statusMessage"]).toBeUndefined();
    // Still the exception's fix: its recipe is the task's.
    expect(tasks[0]!["taskType"]).toBe(CodeFixTaskType.FixException);
    expect(sent[0]!["hasActiveTask"]).toBe(true);
  });

  test("the newest turn failing says why, in its own words", async () => {
    jest
      .spyOn(AIRunService, "getLatestCodeFixRunPerTaskType")
      .mockResolvedValue([run(TASK_ID, CodeFixTaskType.FixException)] as never);
    replies.set(TASK_ID.toString().toLowerCase(), {
      count: 2,
      newest: laterTurn(REPLY_ID, {
        status: AIRunStatus.Error,
        errorMessage: "The Runner went offline.",
      }),
    });

    const tasks: Array<JSONObject> = await getTasks();

    expect(tasks[0]!["status"]).toBe(AIRunStatus.Error);
    expect(tasks[0]!["statusMessage"]).toBe("The Runner went offline.");
    expect(sent[0]!["hasActiveTask"]).toBe(false);
  });

  test("the verdict is the pull request's the newest turn opened", async () => {
    jest
      .spyOn(AIRunService, "getLatestCodeFixRunPerTaskType")
      .mockResolvedValue([
        { ...run(TASK_ID, CodeFixTaskType.FixException), status: "Error" },
      ] as never);
    replies.set(TASK_ID.toString().toLowerCase(), {
      count: 1,
      newest: laterTurn(ASKED_AGAIN_ID, { status: AIRunStatus.Completed }),
    });
    findPullRequests.mockResolvedValue([
      {
        aiRunId: ASKED_AGAIN_ID,
        pullRequestUrl: "https://github.com/acme/checkout/pull/483",
        productionStatus: FixProductionStatus.Verified,
        productionStatusAt: new Date("2026-10-21T10:00:00.000Z"),
      },
    ] as never);

    const tasks: Array<JSONObject> = await getTasks();

    expect(tasks[0]!["status"]).toBe(AIRunStatus.Completed);
    expect(tasks[0]!["production"]).toEqual(
      expect.objectContaining({
        status: FixProductionStatus.Verified,
        pullRequestUrl: "https://github.com/acme/checkout/pull/483",
      }),
    );

    // Read of the task's turns: the one found, and its newest.
    const query: JSONObject = (
      findPullRequests.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;
    expect(JSON.stringify(query["aiRunId"])).toContain(TASK_ID.toString());
    expect(JSON.stringify(query["aiRunId"])).toContain(
      ASKED_AGAIN_ID.toString(),
    );
  });

  test("a task hidden from the caller reads none of its turns", async () => {
    jest
      .spyOn(AIRunService, "getLatestCodeFixRunPerTaskType")
      .mockResolvedValue([
        laterTurn(ASKED_AGAIN_ID, {
          codeFixTaskType: CodeFixTaskType.FixException,
        }),
      ] as never);
    hiddenFrom.mockResolvedValue(
      new Set<string>([TASK_ID.toString().toLowerCase()]),
    );

    const tasks: Array<JSONObject> = await getTasks();

    expect(tasks[0]).toEqual({
      taskType: CodeFixTaskType.FixException,
      isHidden: true,
    });
    expect(
      (readReplies.mock.calls[0]![0] as { taskIds: Array<ObjectID> }).taskIds,
    ).toEqual([]);
    expect(sent[0]!["hasActiveTask"]).toBe(false);
  });
});
