import { mockRouter } from "./Helpers";
import "../../../Server/API/MonitorTemplateChangeAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MonitorTemplateChangeRunner from "../../../Server/Utils/Monitor/MonitorTemplateChangeRunner";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import MonitorTemplateChange from "../../../Models/DatabaseModels/MonitorTemplateChange";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import {
  MonitorTemplateChangeKind,
  MonitorTemplateChangeOutcome,
  MonitorTemplateChangeStatus,
} from "../../../Types/Monitor/MonitorTemplateChange";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * A change of many monitors' template, over HTTP (issues #11260, #11266).
 * Its changes are internal rows read as root, so these handlers are the
 * gate: a person signed in to the project (never anonymous, never a project
 * API key - a change acts as a person), who may see the project's monitors;
 * the rest - editing monitors, deleting a template - is the runner's to
 * check with the person's own permissions, and has its own suite.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Monitor/MonitorTemplateChangeRunner", () => {
  const actual: {
    default: {
      toView: unknown;
      assertCanSeeChanges: unknown;
    };
  } = jest.requireActual(
    "../../../Server/Utils/Monitor/MonitorTemplateChangeRunner",
  );

  return {
    __esModule: true,
    default: {
      start: jest.fn(),
      stop: jest.fn(),
      retry: jest.fn(),
      findChange: jest.fn(),
      findActiveChangesOfTemplate: jest.fn(),
      // What the Dashboard is told is the real view, and who may see it.
      toView: actual.default.toView,
      assertCanSeeChanges: actual.default.assertCanSeeChanges,
    },
  };
});

jest.mock("../../../Server/Utils/Billing/CallerPlan", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../Server/Utils/Billing/CallerPlan",
  );
  const CallerPlanWithTestProps: Record<string, unknown> = Object.create(
    actual.default,
  );
  CallerPlanWithTestProps["withPlan"] = jest.fn(async (props: unknown) => {
    return props;
  });

  return { __esModule: true, default: CallerPlanWithTestProps };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000021",
);
const ME: ObjectID = new ObjectID("bb000000-0000-4000-8000-000000000021");
const CHANGE_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000000021",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "dd000000-0000-4000-8000-000000000021",
);

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  };

  return {
    tenantId: PROJECT_ID,
    userId: ME,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
  };
}

let callerProps: DatabaseCommonInteractionProps;

interface RegisteredRoute {
  method: string;
  uri: string;
  middleware: unknown;
  middlewares: Array<unknown>;
  handlerFunction: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => void | Promise<void>;
}

function route(method: string, uri: string): RegisteredRoute {
  const found: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === method && candidate.uri === uri;
  });

  if (!found) {
    throw new Error(`No ${method} ${uri}`);
  }

  return found;
}

async function call(
  method: string,
  uri: string,
  data: {
    params?: Dictionary<string>;
    body?: JSONObject;
    query?: Dictionary<string>;
  } = {},
): Promise<{ thrown: unknown; payload: Record<string, unknown> | undefined }> {
  const next: jest.Mock = jest.fn();
  const sender: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  sender.mockClear();

  await route(method, uri).handlerFunction(
    {
      params: data.params || {},
      query: data.query || {},
      body: data.body || {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const last: Array<unknown> | undefined =
    sender.mock.calls[sender.mock.calls.length - 1];

  return {
    thrown: next.mock.calls[0]?.[0],
    payload: last ? (last[2] as Record<string, unknown>) : undefined,
  };
}

function changeRow(
  overrides: Partial<MonitorTemplateChange> = {},
): MonitorTemplateChange {
  const row: MonitorTemplateChange = new MonitorTemplateChange();
  row.id = CHANGE_ID;
  row.projectId = PROJECT_ID;
  row.monitorTemplateId = TEMPLATE_ID;
  row.monitorTemplateName = "WB Ping Monitor Template v2";
  row.status = MonitorTemplateChangeStatus.Running;
  row.settings = {
    kind: MonitorTemplateChangeKind.Link,
    applyTemplateSettings: true,
  };
  row.monitorIds = ["m1", "m2", "m3"];
  row.results = {
    processedCount: 2,
    lines: [
      {
        monitorId: "m2",
        monitorName: "core-sw-02",
        outcome: MonitorTemplateChangeOutcome.Skipped,
        reason: "Another type.",
      },
    ],
  };
  row.progress = {
    total: 3,
    processed: 2,
    changed: 1,
    skipped: 1,
  };
  row.createdByUserId = ME;
  row.createdAt = new Date("2026-11-27T09:00:00Z");
  Object.assign(row, overrides);
  return row;
}

const ROUTES: Array<[string, string]> = [
  ["POST", "/monitor-template-change/start"],
  ["GET", "/monitor-template-change/change/:changeId"],
  ["GET", "/monitor-template-change/template/:monitorTemplateId/active"],
  ["POST", "/monitor-template-change/change/:changeId/stop"],
  ["POST", "/monitor-template-change/change/:changeId/retry"],
];

const IDS: Dictionary<string> = {
  changeId: CHANGE_ID.toString(),
  monitorTemplateId: TEMPLATE_ID.toString(),
};

beforeEach(() => {
  callerProps = propsWith([Permission.ProjectOwner]);
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return callerProps;
    });
  (MonitorTemplateChangeRunner.findChange as jest.Mock).mockResolvedValue(
    changeRow(),
  );
  (MonitorTemplateChangeRunner.start as jest.Mock).mockResolvedValue(
    changeRow({ status: MonitorTemplateChangeStatus.Queued }),
  );
  (MonitorTemplateChangeRunner.stop as jest.Mock).mockResolvedValue(
    changeRow({ stopRequestedAt: new Date() }),
  );
  (MonitorTemplateChangeRunner.retry as jest.Mock).mockResolvedValue(
    changeRow({ status: MonitorTemplateChangeStatus.Queued }),
  );
  (
    MonitorTemplateChangeRunner.findActiveChangesOfTemplate as jest.Mock
  ).mockResolvedValue([changeRow()]);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("who may call the change API", () => {
  test("every route reads the session through the user middleware, and every write is refused while Monitors is off", () => {
    for (const [method, uri] of ROUTES) {
      const registered: RegisteredRoute = route(method, uri);

      expect(registered.middleware).toBe(UserMiddleware.getUserMiddleware);

      // The product's switch sits between the session and the handler.
      expect(registered.middlewares).toHaveLength(method === "GET" ? 1 : 2);
    }
  });

  test.each(ROUTES)(
    "%s %s answers a caller with no session with 401",
    async (method: string, uri: string) => {
      callerProps = { userType: UserType.Public };

      const { thrown } = await call(method, uri, { params: IDS });

      expect(thrown).toBeInstanceOf(NotAuthenticatedException);
      expect(MonitorTemplateChangeRunner.start).not.toHaveBeenCalled();
      expect(MonitorTemplateChangeRunner.findChange).not.toHaveBeenCalled();
    },
  );

  test.each(ROUTES)(
    "%s %s refuses a project API key: a change acts as a person",
    async (method: string, uri: string) => {
      callerProps = {
        ...propsWith([Permission.ProjectOwner]),
        userId: undefined,
        userType: UserType.API,
      };

      const { thrown } = await call(method, uri, { params: IDS });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      expect(MonitorTemplateChangeRunner.start).not.toHaveBeenCalled();
    },
  );

  test("seeing a change needs the right to read the project's monitors", async () => {
    callerProps = propsWith([Permission.ReadNetworkDevice]);

    for (const uri of [
      "/monitor-template-change/change/:changeId",
      "/monitor-template-change/template/:monitorTemplateId/active",
    ]) {
      const { thrown } = await call("GET", uri, { params: IDS });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      expect((thrown as Error).message).toBe(
        "You may not see this project's monitors, so you cannot see changes of their template.",
      );
    }

    callerProps = propsWith([Permission.ReadProjectMonitor]);

    const { thrown } = await call(
      "GET",
      "/monitor-template-change/change/:changeId",
      { params: IDS },
    );

    expect(thrown).toBeUndefined();
  });
});

describe("what the change API does", () => {
  test("start hands the person's request to the runner as sent, and answers the change as it stands", async () => {
    const body: JSONObject = {
      monitorTemplateId: TEMPLATE_ID.toString(),
      settings: {
        kind: MonitorTemplateChangeKind.Link,
        applyTemplateSettings: true,
      },
      monitorIds: ["m1", "m2", "m3"],
    };

    const { thrown, payload } = await call(
      "POST",
      "/monitor-template-change/start",
      { body: body },
    );

    expect(thrown).toBeUndefined();
    expect(MonitorTemplateChangeRunner.start).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: callerProps,
      monitorTemplateId: TEMPLATE_ID.toString(),
      settings: body["settings"],
      monitorIds: body["monitorIds"],
      allLinkedToTemplate: undefined,
    });

    const change: Record<string, unknown> = payload!["change"] as Record<
      string,
      unknown
    >;

    expect(change["id"]).toBe(CHANGE_ID.toString());
    expect(change["monitorTemplateName"]).toBe("WB Ping Monitor Template v2");
    expect(change["progress"]).toMatchObject({ total: 3, processed: 2 });
  });

  test("start answers the runner's refusal as it comes", async () => {
    (MonitorTemplateChangeRunner.start as jest.Mock).mockRejectedValue(
      new BadDataException("Select the monitors to change, then try again."),
    );

    const { thrown } = await call("POST", "/monitor-template-change/start", {
      body: { settings: { kind: "link" } },
    });

    expect((thrown as Error).message).toBe(
      "Select the monitors to change, then try again.",
    );
  });

  test("a change reads with a page of its lines, or every line when asked", async () => {
    await call("GET", "/monitor-template-change/change/:changeId", {
      params: IDS,
      query: { lines: "all" },
    });

    expect(MonitorTemplateChangeRunner.findChange).toHaveBeenCalledWith({
      changeId: CHANGE_ID,
      projectId: PROJECT_ID,
    });

    const { payload } = await call(
      "GET",
      "/monitor-template-change/change/:changeId",
      { params: IDS },
    );

    const change: Record<string, unknown> = payload!["change"] as Record<
      string,
      unknown
    >;

    expect(change["lines"]).toEqual([
      {
        monitorId: "m2",
        monitorName: "core-sw-02",
        outcome: MonitorTemplateChangeOutcome.Skipped,
        reason: "Another type.",
      },
    ]);
  });

  test("a template's active changes are listed, newest first, as views", async () => {
    const { payload } = await call(
      "GET",
      "/monitor-template-change/template/:monitorTemplateId/active",
      { params: IDS },
    );

    expect(
      MonitorTemplateChangeRunner.findActiveChangesOfTemplate,
    ).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      monitorTemplateId: TEMPLATE_ID,
    });
    expect(
      (payload!["changes"] as Array<Record<string, unknown>>).map(
        (change: Record<string, unknown>) => {
          return change["id"];
        },
      ),
    ).toEqual([CHANGE_ID.toString()]);
  });

  test("stop and retry act as the person, on the change named", async () => {
    await call("POST", "/monitor-template-change/change/:changeId/stop", {
      params: IDS,
    });

    expect(MonitorTemplateChangeRunner.stop).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: callerProps,
      changeId: CHANGE_ID,
    });

    await call("POST", "/monitor-template-change/change/:changeId/retry", {
      params: IDS,
    });

    expect(MonitorTemplateChangeRunner.retry).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      props: callerProps,
      changeId: CHANGE_ID,
    });
  });

  test("a change named by something that is no id is refused, and nothing is read", async () => {
    const { thrown } = await call(
      "GET",
      "/monitor-template-change/change/:changeId",
      { params: { changeId: "../../etc" } },
    );

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(MonitorTemplateChangeRunner.findChange).not.toHaveBeenCalled();
  });
});
