import { mockRouter } from "./Helpers";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import GuidedSetupRunAPI from "../../../Server/API/GuidedSetupRunAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import GuidedSetupRunService from "../../../Server/Services/GuidedSetupRunService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import {
  GuidedSetupKey,
  GuidedSetupResourceStatus,
  GuidedSetupRunState,
} from "../../../Types/GuidedSetup/GuidedSetupRun";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A guided setup's run over HTTP (#7253), through the real handlers and
 * guards with the service answered here: a member reads and changes only
 * their own run, of a setup that keeps one; nobody else's is ever named.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SOMEBODY_ELSE: string = "33333333-3333-4333-8333-333333333333";
const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface RegisteredRoute {
  method: string;
  uri: string;
  middlewares: Array<RouterFunction>;
  handlerFunction: RouterFunction;
}

const RUN_URI: string = "/guided-setup-run/:setup";
const FORGET_URI: string = "/guided-setup-run/:setup/forget";

const RUN: GuidedSetupRunState = {
  values: { monitorId: MONITOR_ID },
  resources: {
    monitor: {
      status: GuidedSetupResourceStatus.Created,
      recordId: MONITOR_ID,
      at: "2026-11-20T10:00:00.000Z",
    },
  },
  revision: 2,
  updatedAt: "2026-11-20T10:00:00.000Z",
};

function memberProps(
  permissions: Array<Permission>,
  overrides?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
      } as UserPermission;
    }),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    ...overrides,
  };
}

function routeFor(method: string, uri: string): RegisteredRoute {
  const route: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === method && candidate.uri === uri;
  });

  if (!route) {
    throw new Error(`No ${method} route for ${uri}`);
  }

  return route;
}

let props: DatabaseCommonInteractionProps;
let getRun: jest.SpyInstance;
let changeRun: jest.SpyInstance;
let forgetRun: jest.SpyInstance;
let sendJson: jest.SpyInstance;

beforeEach(() => {
  props = memberProps([Permission.ProjectMember]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  getRun = jest.spyOn(GuidedSetupRunService, "getRun").mockResolvedValue(RUN);
  changeRun = jest
    .spyOn(GuidedSetupRunService, "changeRun")
    .mockResolvedValue(RUN);
  forgetRun = jest
    .spyOn(GuidedSetupRunService, "forgetRun")
    .mockResolvedValue(undefined);
  sendJson = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function call(data: {
  method: string;
  uri: string;
  setup: unknown;
  body?: unknown;
  query?: JSONObject;
}): Promise<unknown> {
  const next: jest.Mock = jest.fn();

  await routeFor(data.method, data.uri).handlerFunction(
    {
      query: data.query || {},
      params: { setup: data.setup },
      headers: {},
      body: data.body,
    } as never,
    {} as never,
    next as unknown as NextFunction,
  );

  return next.mock.calls[0]?.[0];
}

function sentBody(): JSONObject {
  return sendJson.mock.calls[0]![2] as JSONObject;
}

describe("the routes", () => {
  test("are one bare router: a read and two changes, each behind the user middleware", () => {
    expect(GuidedSetupRunAPI).toBe(mockRouter);

    for (const [method, uri] of [
      ["GET", RUN_URI],
      ["POST", RUN_URI],
      ["POST", FORGET_URI],
    ] as Array<[string, string]>) {
      expect(routeFor(method, uri).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
      ]);
    }
  });
});

describe("GET /guided-setup-run/:setup", () => {
  test("answers a member with their own run of the setup", async () => {
    expect(
      await call({ method: "GET", uri: RUN_URI, setup: "website_down" }),
    ).toBeUndefined();

    expect(getRun).toHaveBeenCalledTimes(1);
    expect(getRun.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
      setup: GuidedSetupKey.WebsiteDown,
    });
    expect(sentBody()).toEqual({
      setup: "website_down",
      run: {
        values: { monitorId: MONITOR_ID },
        resources: {
          monitor: {
            status: "created",
            recordId: MONITOR_ID,
            at: "2026-11-20T10:00:00.000Z",
          },
        },
        revision: 2,
        updatedAt: "2026-11-20T10:00:00.000Z",
      },
    });
  });

  test("a setup with no run answers none", async () => {
    getRun.mockResolvedValue(null);

    await call({ method: "GET", uri: RUN_URI, setup: "on_call" });

    expect(sentBody()).toEqual({ setup: "on_call", run: null });
  });

  test("whatever the address asks for, it is the caller's own run that is read", async () => {
    await call({
      method: "GET",
      uri: RUN_URI,
      setup: "status_page",
      query: { userId: SOMEBODY_ELSE, projectId: OTHER_PROJECT_ID.toString() },
    });

    expect(getRun.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
      setup: GuidedSetupKey.StatusPage,
    });
  });

  test("a viewer keeps a run of their own too: the setup decides what they may make", async () => {
    props = memberProps([Permission.Viewer]);

    expect(
      await call({ method: "GET", uri: RUN_URI, setup: "telemetry" }),
    ).toBeUndefined();
    expect(getRun).toHaveBeenCalledTimes(1);
  });

  test("an expired session is a 401, so the browser refreshes it and sends again", async () => {
    props = {
      tenantId: PROJECT_ID,
      userType: UserType.Public,
    } as DatabaseCommonInteractionProps;

    expect(
      await call({ method: "GET", uri: RUN_URI, setup: "website_down" }),
    ).toBeInstanceOf(NotAuthenticatedException);
    expect(getRun).not.toHaveBeenCalled();
  });

  test("somebody who is not a member of the project - one who left it, say - reads nothing", async () => {
    props = memberProps([Permission.ProjectOwner], {
      tenantId: OTHER_PROJECT_ID,
    });

    expect(
      await call({ method: "GET", uri: RUN_URI, setup: "website_down" }),
    ).toBeInstanceOf(NotAuthorizedException);
    expect(getRun).not.toHaveBeenCalled();
  });

  test("a setup that keeps no run is refused, in a sentence", async () => {
    for (const setup of ["example_setup", "", undefined, "WEBSITE_DOWN"]) {
      const error: unknown = await call({
        method: "GET",
        uri: RUN_URI,
        setup: setup,
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toMatch(/^[A-Z].*\.$/);
    }

    expect(getRun).not.toHaveBeenCalled();
  });
});

describe("POST /guided-setup-run/:setup", () => {
  test("merges the change into the caller's own run, and answers the run as it now stands", async () => {
    expect(
      await call({
        method: "POST",
        uri: RUN_URI,
        setup: "website_down",
        body: {
          values: { monitorId: MONITOR_ID, testSkipped: null },
          resources: { monitor: { status: "created", recordId: MONITOR_ID } },
        },
      }),
    ).toBeUndefined();

    expect(changeRun).toHaveBeenCalledTimes(1);
    expect(changeRun.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
      setup: GuidedSetupKey.WebsiteDown,
    });
    expect(changeRun.mock.calls[0]![1]).toEqual({
      values: { monitorId: MONITOR_ID, testSkipped: null },
      resources: {
        monitor: {
          status: GuidedSetupResourceStatus.Created,
          recordId: MONITOR_ID,
        },
      },
    });
    expect(sentBody()["run"]).not.toBeNull();
  });

  test("a body that names another person changes the caller's run, never theirs", async () => {
    await call({
      method: "POST",
      uri: RUN_URI,
      setup: "on_call",
      body: { userId: SOMEBODY_ELSE, values: { policyId: MONITOR_ID } },
    });

    expect(changeRun.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
      setup: GuidedSetupKey.OnCall,
    });
  });

  test("a change a run cannot keep is refused before anything is written", async () => {
    for (const body of [
      "monitorId",
      { values: { monitorId: 3 } },
      { resources: { monitor: { status: "made" } } },
    ]) {
      expect(
        await call({
          method: "POST",
          uri: RUN_URI,
          setup: "website_down",
          body: body,
        }),
      ).toBeInstanceOf(BadDataException);
    }

    expect(changeRun).not.toHaveBeenCalled();
  });

  test("a change that left nothing in the run answers none", async () => {
    changeRun.mockResolvedValue(null);

    await call({
      method: "POST",
      uri: RUN_URI,
      setup: "website_down",
      body: { values: { monitorId: null } },
    });

    expect(sentBody()).toEqual({ setup: "website_down", run: null });
  });

  test("nobody outside the project changes a run of it", async () => {
    props = memberProps([Permission.ProjectOwner], {
      tenantId: OTHER_PROJECT_ID,
    });

    expect(
      await call({
        method: "POST",
        uri: RUN_URI,
        setup: "website_down",
        body: { values: { monitorId: MONITOR_ID } },
      }),
    ).toBeInstanceOf(NotAuthorizedException);
    expect(changeRun).not.toHaveBeenCalled();
  });
});

describe("POST /guided-setup-run/:setup/forget", () => {
  test("deletes the caller's own run, and answers none", async () => {
    expect(
      await call({ method: "POST", uri: FORGET_URI, setup: "status_page" }),
    ).toBeUndefined();

    expect(forgetRun).toHaveBeenCalledTimes(1);
    expect(forgetRun.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
      setup: GuidedSetupKey.StatusPage,
    });
    expect(sentBody()).toEqual({ setup: "status_page", run: null });
  });

  test("an expired session forgets nothing", async () => {
    props = {
      tenantId: PROJECT_ID,
      userType: UserType.Public,
    } as DatabaseCommonInteractionProps;

    expect(
      await call({ method: "POST", uri: FORGET_URI, setup: "website_down" }),
    ).toBeInstanceOf(NotAuthenticatedException);
    expect(forgetRun).not.toHaveBeenCalled();
  });
});
