import AIAgentTaskAPI from "../../../Server/API/AIAgentTaskAPI";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIAgentTaskStatus from "../../../Types/AI/AIAgentTaskStatus";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /ai-agent-task/update-task-status, for a run a Runner closes with a
 * long message (issue #6144).
 *
 * A Runner that could not clone an Azure DevOps Server repository reported
 * Error with git's message - the whole command line and its output, over
 * 500 characters. The route wrote it into AIRun.errorMessage, varchar(500),
 * through the status transition's raw UPDATE, and Postgres refused it: the
 * request failed, the run stayed Running until the stale-run sweeper failed
 * it without saying why, and the Runner's retries met the same refusal. The
 * transition now holds the message to its column, so the run is closed, with
 * the message's beginning, the first time.
 *
 * Unlike AIAgentTaskUpdateStatus.test.ts, the transition here is the real
 * one, over a stand-in for its query builder: what it would write is what is
 * checked.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    redirect: jest.fn(),
  };
});

const UPDATE_STATUS_ROUTE: string = "/ai-agent-task/update-task-status";

// What a Runner before this fix reported for the run, give or take.
const RUNNER_MESSAGE: string = `Command failed: git -c http.followRedirects=false -c http.curloptResolve=tfs.example.com:443:10.20.30.40 clone --single-branch --branch main -- https://deploy@tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter /tmp/oneuptime-ai-agent/task-1793957521407-0cb53341-6e6e-47e9-9758-651b60a8ee11-d20e88de/DefaultCollection-ScriptVault-_git__InstantAccessReporter\nCloning into '/tmp/oneuptime-ai-agent/task-1793957521407-0cb53341-6e6e-47e9-9758-651b60a8ee11-d20e88de/DefaultCollection-ScriptVault-_git__InstantAccessReporter'...\nfatal: Authentication failed for 'https://tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter/'`;

describe("POST /ai-agent-task/update-task-status with a message longer than the run keeps", () => {
  let projectId: ObjectID;
  let runId: ObjectID;
  let written: Array<Record<string, unknown>>;
  let appendEventSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentTaskAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    runId = ObjectID.generate();
    written = [];

    jest.spyOn(CodeFixAgentAuth, "checkCredential").mockResolvedValue(
      credentialCheckProving({
        id: ObjectID.generate(),
        projectId: projectId,
        source: CodeFixAgentSource.Runner,
      }),
    );

    jest
      .spyOn(AIRunService, "findOneById")
      .mockImplementation(async (): Promise<AIRun | null> => {
        const run: AIRun = new AIRun();
        run.id = runId;
        run.projectId = projectId;
        run.status = AIRunStatus.Running;
        return run;
      });

    /*
     * The real transition, over a query builder that keeps what it was
     * asked to write and refuses, as Postgres does, a value longer than
     * errorMessage's varchar(500).
     */
    const builder: Record<string, unknown> = {
      update: () => {
        return builder;
      },
      set: (values: Record<string, unknown>) => {
        written.push(values);
        return builder;
      },
      where: () => {
        return builder;
      },
      andWhere: () => {
        return builder;
      },
      execute: async () => {
        const values: Record<string, unknown> = written[written.length - 1]!;
        const message: unknown = values["errorMessage"];

        if (
          typeof message === "string" &&
          message.length > ColumnLength.LongText
        ) {
          throw new Error(
            "QueryFailedError: value too long for type character varying(500)",
          );
        }

        return { affected: 1 };
      },
    };

    jest.spyOn(AIRunService, "getRepository").mockReturnValue({
      createQueryBuilder: () => {
        return builder;
      },
    } as never);

    appendEventSpy = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function report(body: JSONObject): Promise<jest.Mock> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      body: {
        aiAgentId: ObjectID.generate().toString(),
        aiAgentKey: "runner-key",
        taskId: runId.toString(),
        ...body,
      },
      headers: {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    const next: jest.Mock = jest.fn();

    await mockRouter
      .match("POST", UPDATE_STATUS_ROUTE)
      .handlerFunction(req, res, next as unknown as NextFunction);

    return next;
  }

  test("the run is closed as Error the first time, with the message cut to its column", async () => {
    const next: jest.Mock = await report({
      status: AIAgentTaskStatus.Error,
      statusMessage: RUNNER_MESSAGE,
    });

    expect(next).not.toHaveBeenCalled();
    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock.calls,
    ).toHaveLength(1);
    expect(
      (Response.sendErrorResponse as unknown as jest.Mock).mock.calls,
    ).toHaveLength(0);

    expect(written).toHaveLength(1);
    expect(written[0]!["status"]).toBe(AIRunStatus.Error);

    const stored: string = written[0]!["errorMessage"] as string;

    expect(stored.length).toBe(ColumnLength.LongText);
    expect(RUNNER_MESSAGE.startsWith(stored)).toBe(true);
  });

  test("the run's trail still closes with RunFailed, carrying the whole message", async () => {
    await report({
      status: AIAgentTaskStatus.Error,
      statusMessage: RUNNER_MESSAGE,
    });

    expect(appendEventSpy).toHaveBeenCalledTimes(1);

    const event: {
      eventType: AIRunEventType;
      resultSummary?: { message?: string };
    } = appendEventSpy.mock.calls[0]![0];

    expect(event.eventType).toBe(AIRunEventType.RunFailed);
    expect(event.resultSummary?.message).toBe(RUNNER_MESSAGE);
  });

  test("a long reason for no fix closes the run as NoFixFound the same way", async () => {
    const reason: string = `No change was needed: ${"the code already handles this case. ".repeat(40)}`;

    const next: jest.Mock = await report({
      status: AIAgentTaskStatus.NoFixFound,
      statusMessage: reason,
    });

    expect(next).not.toHaveBeenCalled();
    expect(written[0]!["status"]).toBe(AIRunStatus.NoFixFound);
    expect((written[0]!["errorMessage"] as string).length).toBe(
      ColumnLength.LongText,
    );
  });

  test("a message that fits is kept whole", async () => {
    const message: string =
      "tfs.example.com refused the credentials OneUptime signed in with, so DefaultCollection/ScriptVault/_git/InstantAccessReporter could not be cloned.";

    await report({ status: AIAgentTaskStatus.Error, statusMessage: message });

    expect(written[0]!["errorMessage"]).toBe(message);
  });
});
