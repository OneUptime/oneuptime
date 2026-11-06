import ManualAPI from "../../../FeatureSet/Workflow/API/Manual";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import RunWorkflow from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import CommonAPI from "Common/Server/API/CommonAPI";
import Queue from "Common/Server/Infrastructure/Queue";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import { WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE } from "Common/Types/Workflow/WorkflowArchive";
import {
  MAX_TRIGGER_VALUES_LENGTH,
  WORKFLOW_RUN_CANNOT_RUN_AGAIN_MESSAGE,
} from "Common/Types/Workflow/WorkflowRunAgain";
import { WORKFLOW_RUN_REFUSED_MESSAGE } from "Common/Types/Workflow/WorkflowRunPermissions";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #5944, on the server: every run keeps what it started with, and POST
 * /workflow/manual/run-again/:workflowLogId starts a new run with it.
 *
 * Running a workflow executes its steps as root, so the load-bearing assertion
 * in every refusal below is that addWorkflowToQueue was never called, as it is
 * for Run Workflow (ManualWorkflowRunAuth.test.ts).
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface RegisteredRoute {
  method: string;
  uri: string;
  handler: RouterFunction;
}

const mockRoutes: Array<RegisteredRoute> = [];

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  type RegisterFunction = (
    method: string,
  ) => (uri: string, _middleware: unknown, handler: RouterFunction) => void;

  const register: RegisterFunction = (method: string) => {
    return (uri: string, _middleware: unknown, handler: RouterFunction) => {
      mockRoutes.push({ method: method, uri: uri, handler: handler });
    };
  };

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): Record<string, unknown> => {
        return {
          get: register("GET"),
          post: register("POST"),
          put: register("PUT"),
          delete: register("DELETE"),
        };
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

const RUN_AGAIN_ROUTE: string = "/run-again/:workflowLogId";

const PROJECT_ID: ObjectID = new ObjectID(
  "c8000000-0000-4000-8000-0000000000a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "c8000000-0000-4000-8000-0000000000a2",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "c8000000-0000-4000-8000-0000000000b1",
);
const RUN_ID: ObjectID = new ObjectID("c8000000-0000-4000-8000-0000000000c1");
const USER_ID: ObjectID = new ObjectID("c8000000-0000-4000-8000-0000000000d1");

const PAYLOAD: JSONObject = {
  "request-headers": { "x-event": "ticket.created" },
  "request-body": { z: 1, a: { nested: [1, 2, 3] } },
};

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

type UserPropsFunction = (data: {
  permissions: Array<Permission>;
  isMasterAdmin?: boolean | undefined;
}) => DatabaseCommonInteractionProps;

const userProps: UserPropsFunction = (data: {
  permissions: Array<Permission>;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps => {
  const access: Dictionary<UserTenantAccessPermission> = {};

  access[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: data.permissions.map(
      (permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
        };
      },
    ),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: data.isMasterAdmin ? UserType.MasterAdmin : UserType.User,
    userTenantAccessPermission: access,
    ...(data.isMasterAdmin ? { isMasterAdmin: true } : {}),
  };
};

type RunRowFunction = (values?: {
  projectId?: ObjectID | undefined;
  triggerValues?: string | undefined;
}) => WorkflowLog;

const runRow: RunRowFunction = (
  values: {
    projectId?: ObjectID | undefined;
    triggerValues?: string | undefined;
  } = {},
): WorkflowLog => {
  const run: WorkflowLog = new WorkflowLog();
  run.projectId = values.projectId || PROJECT_ID;
  run.workflowId = WORKFLOW_ID;
  run.triggerValues = Object.prototype.hasOwnProperty.call(
    values,
    "triggerValues",
  )
    ? (values.triggerValues as string)
    : JSON.stringify(PAYLOAD);
  return run;
};

type WorkflowRowFunction = (values?: {
  isEnabled?: boolean | undefined;
  isArchived?: boolean | undefined;
}) => Workflow;

const workflowRow: WorkflowRowFunction = (
  values: {
    isEnabled?: boolean | undefined;
    isArchived?: boolean | undefined;
  } = {},
): Workflow => {
  const workflow: Workflow = new Workflow();
  workflow._id = WORKFLOW_ID.toString();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = values.isEnabled !== false;
  workflow.isArchived = Boolean(values.isArchived);
  workflow.graph = { nodes: [], edges: [] };
  return workflow;
};

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /workflow/manual/run-again/:workflowLogId", () => {
  let readRun: RecordedSpy & { mockResolvedValue: (value: unknown) => unknown };
  let queueRun: RecordedSpy;
  let readProps: { mockResolvedValue: (value: unknown) => unknown };

  beforeAll(() => {
    mockRoutes.length = 0;
    new ManualAPI();
  });

  beforeEach(() => {
    readProps = jest.spyOn(
      CommonAPI,
      "getDatabaseCommonInteractionProps",
    ) as never;
    readProps.mockResolvedValue(
      userProps({ permissions: [Permission.EditWorkflow] }),
    );
    readRun = jest.spyOn(WorkflowLogService, "findOneById") as never;
    readRun.mockResolvedValue(runRow());
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow() as never);
    jest
      .spyOn(WorkflowService as never, "findOneUpdatableById")
      .mockResolvedValue(workflowRow() as never);
    queueRun = jest
      .spyOn(QueueWorkflow, "addWorkflowToQueue")
      .mockResolvedValue(undefined) as unknown as RecordedSpy;
    (Response.sendJsonObjectResponse as unknown as jest.Mock).mockReset();
  });

  type CallRouteFunction = (
    workflowLogId?: string | undefined,
  ) => Promise<unknown>;

  const callRoute: CallRouteFunction = async (
    workflowLogId: string | undefined = RUN_ID.toString(),
  ): Promise<unknown> => {
    const route: RegisteredRoute | undefined = mockRoutes.find(
      (candidate: RegisteredRoute): boolean => {
        return candidate.method === "POST" && candidate.uri === RUN_AGAIN_ROUTE;
      },
    );

    let thrown: unknown = undefined;

    await route!.handler(
      {
        params: workflowLogId ? { workflowLogId: workflowLogId } : {},
        query: {},
        body: {},
        headers: {},
      } as unknown as ExpressRequest,
      {
        send: jest.fn(),
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as ExpressResponse,
      ((err: unknown): void => {
        thrown = err;
      }) as unknown as NextFunction,
    );

    return thrown;
  };

  describe("the route", () => {
    test("is a POST, so no link on another site starts a run", () => {
      expect(
        mockRoutes
          .filter((route: RegisteredRoute): boolean => {
            return route.uri === RUN_AGAIN_ROUTE;
          })
          .map((route: RegisteredRoute): string => {
            return route.method;
          }),
      ).toEqual(["POST"]);
    });

    test("asks for a run", async () => {
      const route: RegisteredRoute = mockRoutes.find(
        (candidate: RegisteredRoute): boolean => {
          return candidate.uri === RUN_AGAIN_ROUTE;
        },
      ) as RegisteredRoute;

      const response: { sent: unknown } = { sent: undefined };

      (
        Response.sendErrorResponse as unknown as jest.Mock
      ).mockImplementationOnce(
        (_req: unknown, _res: unknown, err: unknown): void => {
          response.sent = err;
        },
      );

      await route.handler(
        { params: {}, query: {}, body: {}, headers: {} } as never,
        {} as never,
        jest.fn() as never,
      );

      expect(response.sent).toBeInstanceOf(BadDataException);
      expect(queueRun.mock.calls).toHaveLength(0);
    });
  });

  describe("starts a new run", () => {
    test("with what the run started with, as the person who asked", async () => {
      expect(await callRoute()).toBeUndefined();

      expect(queueRun.mock.calls).toHaveLength(1);

      const run: Record<string, unknown> = queueRun.mock.calls[0]![0] as never;

      expect(String(run["workflowId"])).toBe(WORKFLOW_ID.toString());
      expect(run["returnValues"]).toEqual(PAYLOAD);
      expect(String(run["startedByUserId"])).toBe(USER_ID.toString());
    });

    test("of the whole workflow: it does not name one step", async () => {
      await callRoute();

      const run: Record<string, unknown> = queueRun.mock.calls[0]![0] as never;

      expect(run["runOnlyComponentId"]).toBeUndefined();
    });

    test("and says it was scheduled", async () => {
      await callRoute();

      expect(
        (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
          .calls[0]?.[2],
      ).toEqual({ status: "Scheduled" });
    });

    test("and says nothing of the values", async () => {
      await callRoute();

      expect(
        JSON.stringify(
          (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
            .calls[0]?.[2],
        ),
      ).not.toContain("ticket.created");
    });

    test("for someone who runs workflows without changing them", async () => {
      readProps.mockResolvedValue(
        userProps({ permissions: [Permission.WorkflowMember] }),
      );

      expect(await callRoute()).toBeUndefined();
      expect(queueRun.mock.calls).toHaveLength(1);
    });

    test("reads the run as OneUptime: nobody else may read what it started with", async () => {
      await callRoute();

      const read: Record<string, unknown> = readRun.mock.calls[0]![0] as never;

      expect(read["props"]).toEqual({ isRoot: true });
      expect(read["select"]).toEqual({
        projectId: true,
        workflowId: true,
        triggerValues: true,
      });
    });
  });

  describe("refuses", () => {
    type ExpectRefusedFunction = (
      thrown: unknown,
      type: new (...args: Array<never>) => Error,
    ) => void;

    const expectRefused: ExpectRefusedFunction = (
      thrown: unknown,
      type: new (...args: Array<never>) => Error,
    ): void => {
      expect(thrown).toBeInstanceOf(type);
      expect(queueRun.mock.calls).toHaveLength(0);
    };

    test("someone signed in to nothing", async () => {
      readProps.mockResolvedValue({ userType: UserType.Public });

      expectRefused(await callRoute(), NotAuthenticatedException);
    });

    test("before reading anything, so the route says nothing of what exists", async () => {
      readProps.mockResolvedValue({ userType: UserType.Public });

      await callRoute();

      expect(readRun.mock.calls).toHaveLength(0);
    });

    test("a run of another project and one that does not exist, alike", async () => {
      readRun.mockResolvedValue(runRow({ projectId: OTHER_PROJECT_ID }));
      const another: unknown = await callRoute();

      readRun.mockResolvedValue(null);
      const nowhere: unknown = await callRoute();

      expect(queueRun.mock.calls).toHaveLength(0);
      expect(another).toBeTruthy();
      expect(String((another as Error).message)).toBe(
        String((nowhere as Error).message),
      );
      expect((another as Error).constructor).toBe(
        (nowhere as Error).constructor,
      );
    });

    test("someone who may not run the workflow, in the server's own words", async () => {
      readProps.mockResolvedValue(
        userProps({ permissions: [Permission.WorkflowViewer] }),
      );

      const thrown: unknown = await callRoute();

      expectRefused(thrown, NotAuthorizedException);
      expect((thrown as Error).message).toBe(WORKFLOW_RUN_REFUSED_MESSAGE);
    });

    test("someone whose grant does not reach this workflow", async () => {
      jest
        .spyOn(WorkflowService as never, "findOneUpdatableById")
        .mockResolvedValue(null as never);

      expectRefused(await callRoute(), NotAuthorizedException);
    });

    test.each([
      ["kept nothing: a test of one step or an older run", undefined],
      ["kept an empty text", ""],
      ["kept something that is no JSON", "{not json"],
      ["kept something that is no set of values", "[1,2]"],
    ])("a run that %s", async (_name: string, stored: string | undefined) => {
      readRun.mockResolvedValue(runRow({ triggerValues: stored }));

      const thrown: unknown = await callRoute();

      expectRefused(thrown, BadDataException);
      expect((thrown as Error).message).toBe(
        WORKFLOW_RUN_CANNOT_RUN_AGAIN_MESSAGE,
      );
    });

    test("says so only to someone who may run the workflow", async () => {
      readProps.mockResolvedValue(
        userProps({ permissions: [Permission.WorkflowViewer] }),
      );
      readRun.mockResolvedValue(runRow({ triggerValues: undefined }));

      expect(await callRoute()).toBeInstanceOf(NotAuthorizedException);
    });

    test("what the queue refuses, as the queue words it", async () => {
      (
        QueueWorkflow.addWorkflowToQueue as unknown as jest.Mock<any>
      ).mockRejectedValue(
        new BadDataException(WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE),
      );

      expect(((await callRoute()) as Error).message).toBe(
        WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE,
      );
    });
  });
});

describe("what a run's log row keeps", () => {
  let createLog: RecordedSpy;
  let addJob: RecordedSpy;

  type AskFunction = (data: {
    returnValues?: JSONObject | undefined;
    runOnlyComponentId?: string | undefined;
    startedByUserId?: ObjectID | undefined;
    callChain?: Array<string> | undefined;
  }) => Promise<void>;

  const ask: AskFunction = async (data: {
    returnValues?: JSONObject | undefined;
    runOnlyComponentId?: string | undefined;
    startedByUserId?: ObjectID | undefined;
    callChain?: Array<string> | undefined;
  }): Promise<void> => {
    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: data.returnValues || PAYLOAD,
      ...(data.runOnlyComponentId
        ? { runOnlyComponentId: data.runOnlyComponentId }
        : {}),
      ...(data.startedByUserId
        ? { startedByUserId: data.startedByUserId }
        : {}),
      ...(data.callChain ? { callChain: data.callChain } : {}),
    });
  };

  type WrittenFunction = () => WorkflowLog;

  const written: WrittenFunction = (): WorkflowLog => {
    return (createLog.mock.calls[0]![0] as { data: WorkflowLog }).data;
  };

  beforeEach(() => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow() as never);
    jest
      .spyOn(ProjectService, "isProjectBlocked")
      .mockResolvedValue(false as never);
    jest.spyOn(ProjectService as never, "getCurrentPlan").mockResolvedValue({
      plan: null,
      isSubscriptionUnpaid: false,
    } as never);

    const created: WorkflowLog = new WorkflowLog();
    created._id = RUN_ID.toString();

    createLog = jest
      .spyOn(WorkflowLogService as never, "create")
      .mockResolvedValue(created as never) as unknown as RecordedSpy;
    addJob = jest
      .spyOn(Queue as never, "addJob")
      .mockResolvedValue({} as never) as unknown as RecordedSpy;
  });

  test("what the run started with, as text, its keys in their order", async () => {
    await ask({ returnValues: { z: 1, a: 2, m: { y: 1, b: 2 } } });

    expect(written().triggerValues).toBe('{"z":1,"a":2,"m":{"y":1,"b":2}}');
    expect(written().canRunAgain).toBe(true);
  });

  test("the same values the job carries, so the new run starts the same", async () => {
    await ask({});

    const job: JSONObject = addJob.mock.calls[0]![3] as JSONObject;

    expect(JSON.parse(written().triggerValues as string)).toEqual(job["data"]);
  });

  test("a run with no values can still be run again", async () => {
    await ask({ returnValues: {} });

    expect(written().triggerValues).toBe("{}");
    expect(written().canRunAgain).toBe(true);
  });

  test("a value Postgres would not take in jsonb is only text here", async () => {
    await ask({ returnValues: { body: "a\u0000b \ud83d" } });

    expect(JSON.parse(written().triggerValues as string)).toEqual({
      body: "a\u0000b \ud83d",
    });
  });

  test("nothing for a test of one step, which is run again from the step", async () => {
    await ask({ runOnlyComponentId: "step-1", returnValues: {} });

    expect(written().triggerValues).toBeUndefined();
    expect(written().canRunAgain).toBe(false);
  });

  test("nothing for a run that starts with too much, and the run still goes", async () => {
    await ask({
      returnValues: { body: "x".repeat(MAX_TRIGGER_VALUES_LENGTH) },
    });

    expect(written().triggerValues).toBeUndefined();
    expect(written().canRunAgain).toBe(false);
    expect(addJob.mock.calls).toHaveLength(1);
  });

  test("whoever started it: a webhook, a person, another workflow", async () => {
    await ask({ callChain: ["c8000000-0000-4000-8000-0000000000e1"] });

    expect(written().canRunAgain).toBe(true);
  });

  test("a run refused for the plan's limit: the delivery is not lost", async () => {
    jest.spyOn(ProjectService as never, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Free,
      isSubscriptionUnpaid: false,
    } as never);

    await ask({});

    expect(addJob.mock.calls).toHaveLength(0);
    expect(written().canRunAgain).toBe(true);
    expect(written().triggerValues).toBe(JSON.stringify(PAYLOAD));
  });

  test("a run refused for an unpaid subscription, likewise", async () => {
    jest.spyOn(ProjectService as never, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: true,
    } as never);

    await ask({});

    expect(addJob.mock.calls).toHaveLength(0);
    expect(written().canRunAgain).toBe(true);
  });

  test("registering a schedule writes no row, so keeps nothing", async () => {
    jest
      .spyOn(QueueWorkflow as never, "resolveScheduleCron")
      .mockResolvedValue({ cron: "*/5 * * * *", error: null } as never);
    jest
      .spyOn(QueueWorkflow as never, "reconcileSchedule")
      .mockResolvedValue(undefined as never);

    await QueueWorkflow.addWorkflowToQueue(
      { workflowId: WORKFLOW_ID, returnValues: {} },
      "*/5 * * * *",
    );

    expect(createLog.mock.calls).toHaveLength(0);
  });

  describe("the new run", () => {
    type AskAgainFunction = () => Promise<void>;

    const askAgain: AskAgainFunction = async (): Promise<void> => {
      await ask({ startedByUserId: USER_ID });
    };

    test("is an ordinary run while the workflow is on, with who started it", async () => {
      await askAgain();

      expect(written().isTestRun).toBe(false);
      expect(String(written().startedByUserId)).toBe(USER_ID.toString());
    });

    test("is a test run while the workflow is off", async () => {
      jest
        .spyOn(WorkflowService as never, "findOneById")
        .mockResolvedValue(workflowRow({ isEnabled: false }) as never);
      jest
        .spyOn(UserService as never, "findOneById")
        .mockResolvedValue(null as never);

      await askAgain();

      expect(written().isTestRun).toBe(true);
    });

    test("is refused while the workflow is archived", async () => {
      jest
        .spyOn(WorkflowService as never, "findOneById")
        .mockResolvedValue(workflowRow({ isArchived: true }) as never);

      await expect(askAgain()).rejects.toThrow(
        WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE,
      );
      expect(addJob.mock.calls).toHaveLength(0);
    });

    test("can be run again itself", async () => {
      await askAgain();

      expect(written().canRunAgain).toBe(true);
      expect(written().triggerValues).toBe(JSON.stringify(PAYLOAD));
    });
  });
});

describe("what a run keeps, at rest", () => {
  type ServiceWithEncryption = {
    encrypt: (row: WorkflowLog) => Promise<WorkflowLog>;
    decrypt: (row: WorkflowLog) => Promise<WorkflowLog>;
  };

  type RowHoldingFunction = (text: string) => WorkflowLog;

  const rowHolding: RowHoldingFunction = (text: string): WorkflowLog => {
    const row: WorkflowLog = new WorkflowLog();
    row.triggerValues = text;
    return row;
  };

  const service: ServiceWithEncryption =
    WorkflowLogService as unknown as ServiceWithEncryption;

  test("is ciphertext, with nothing of the payload to read", async () => {
    const kept: string = JSON.stringify(PAYLOAD);
    const stored: WorkflowLog = await service.encrypt(rowHolding(kept));

    expect(stored.triggerValues).not.toBe(kept);
    expect(stored.triggerValues).not.toContain("ticket.created");
  });

  test("comes back exactly as it was, its keys in their order", async () => {
    const kept: string = '{"z":1,"a":{"nested":"a\\u0000b"},"m":"🚀"}';
    const stored: WorkflowLog = await service.encrypt(rowHolding(kept));
    const read: WorkflowLog = await service.decrypt(
      rowHolding(stored.triggerValues as string),
    );

    expect(read.triggerValues).toBe(kept);
  });
});

describe("a scheduled run, whose row the runner writes when it fires", () => {
  test("keeps what it started with", async () => {
    jest
      .spyOn(WorkflowService as never, "findOneById")
      .mockResolvedValue(workflowRow() as never);
    jest
      .spyOn(ProjectService, "isProjectBlocked")
      .mockResolvedValue(false as never);

    const created: WorkflowLog = new WorkflowLog();
    created.id = RUN_ID;

    const createLog: RecordedSpy = jest
      .spyOn(WorkflowLogService as never, "create")
      .mockResolvedValue(created as never) as unknown as RecordedSpy;
    jest
      .spyOn(WorkflowLogService as never, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(WorkflowLogService as never, "findOneById")
      .mockResolvedValue(new WorkflowLog() as never);

    const runner: RunWorkflow = new RunWorkflow();

    // The row is what is under test: the run stops right after it is written.
    jest
      .spyOn(runner, "makeRunStack")
      .mockRejectedValue(new Error("stop here") as never);

    await runner
      .runWorkflow({
        arguments: { fired: "by schedule" },
        workflowId: WORKFLOW_ID,
        workflowLogId: null,
        timeout: 5_000,
      })
      .catch(() => {
        return undefined;
      });

    const row: WorkflowLog = (
      createLog.mock.calls[0]![0] as {
        data: WorkflowLog;
      }
    ).data;

    expect(row.canRunAgain).toBe(true);
    expect(row.triggerValues).toBe('{"fired":"by schedule"}');
  });
});
