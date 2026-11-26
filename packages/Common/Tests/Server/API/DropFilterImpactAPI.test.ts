import { mockRouter } from "./Helpers";
// Loading the API registers its routes on the stand-in router.
import { DROP_FILTER_IMPACT_PERMISSIONS } from "../../../Server/API/DropFilterImpactAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import * as DropFilterImpactModule from "../../../Server/Utils/Telemetry/DropFilterImpact";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  DROP_FILTER_IMPACT_API_PATHS,
  DropFilterImpact,
  DropFilterImpactAction,
  getEmptyDropFilterImpact,
} from "../../../Types/Telemetry/DropFilterImpact";
import { TelemetryFieldSignal } from "../../../Types/Telemetry/TelemetryFieldReaders";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

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
    sendErrorResponse: jest.fn(),
  };
});

/*
 * WHAT A DROP OR SAMPLE FILTER BEING WRITTEN WOULD TAKE, ASKED OF THE
 * SERVER (Server/API/DropFilterImpactAPI, #10436).
 *
 * One route per signal, each for whoever may create or edit that signal's
 * drop filters - a person or an API key - and only them: a filter's query
 * is a question about what the records hold, so a role that may only read
 * drop filters is refused before anything is read. The impact itself is
 * stood in for here; it is tested in DropFilterImpact.test.ts and, counted
 * in a real ClickHouse, in DropFilterCountClickhouseIntegration.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111436",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333436");

function tenantPermissions(
  permissions: Array<Permission>,
): Dictionary<UserTenantAccessPermission> {
  return {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: permissions.map((permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    },
  };
}

function buildProps(
  permissions: Array<Permission>,
  userType: UserType = UserType.User,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    ...(userType === UserType.User ? { userId: USER_ID } : {}),
    userType,
    userTenantAccessPermission: tenantPermissions(permissions),
  };
}

// A request as getUserMiddleware leaves it, for the guards to read.
function requestOf(data: {
  permissions: Array<Permission>;
  userType?: UserType | undefined;
  body?: unknown;
}): ExpressRequest {
  return {
    params: {},
    query: {},
    headers: {},
    body: data.body ?? {},
    userType: data.userType ?? UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: tenantPermissions(data.permissions),
  } as unknown as ExpressRequest;
}

type RouteOf = (typeof mockRouter.routes)[number];

function routeOf(signal: TelemetryFieldSignal): RouteOf {
  return mockRouter.match("POST", DROP_FILTER_IMPACT_API_PATHS[signal]);
}

// Whether the route's permission guard lets the request through.
async function isLetThrough(
  signal: TelemetryFieldSignal,
  request: ExpressRequest,
): Promise<{ isLetThrough: boolean; refusal: unknown }> {
  const guard: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> = routeOf(signal).middlewares[2] as never;
  const next: jest.Mock = jest.fn();
  const refuse: jest.Mock = Response.sendErrorResponse as unknown as jest.Mock;
  const before: number = refuse.mock.calls.length;

  await guard(request, {} as ExpressResponse, next as unknown as NextFunction);

  return {
    isLetThrough: next.mock.calls.length === 1,
    refusal:
      refuse.mock.calls.length > before
        ? refuse.mock.calls[refuse.mock.calls.length - 1]![2]
        : undefined,
  };
}

interface RouteCall {
  thrown: unknown;
  answer: JSONObject | undefined;
}

async function call(
  signal: TelemetryFieldSignal,
  body: unknown,
): Promise<RouteCall> {
  const next: jest.Mock = jest.fn();
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const before: number = send.mock.calls.length;

  await routeOf(signal).handlerFunction(
    requestOf({ permissions: [], body }),
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return {
    thrown: next.mock.calls[0]?.[0],
    answer:
      send.mock.calls.length > before
        ? (send.mock.calls[send.mock.calls.length - 1]![2] as JSONObject)
        : undefined,
  };
}

function nothingTaken(signal: TelemetryFieldSignal): DropFilterImpact {
  return getEmptyDropFilterImpact({
    signal,
    action: DropFilterImpactAction.Drop,
    keepPercentage: 0,
    timeLimitInSeconds: 10,
  });
}

let propsSpy: jest.SpyInstance;
let impactSpy: jest.SpyInstance;

beforeEach(() => {
  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(buildProps([Permission.CreateProjectLogDropFilter]));
  impactSpy = jest
    .spyOn(DropFilterImpactModule, "findDropFilterImpact")
    .mockImplementation(
      async (data: {
        request: { signal: TelemetryFieldSignal };
      }): Promise<DropFilterImpact> => {
        return nothingTaken(data.request.signal);
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the routes", () => {
  test.each(["log", "trace"] as Array<TelemetryFieldSignal>)(
    "%s: a POST that finds who is asking, wants them signed in or holding an API key, then checks the permission",
    (signal: TelemetryFieldSignal) => {
      const route: RouteOf = routeOf(signal);

      expect(route.middlewares).toHaveLength(3);
      expect(route.middlewares[0]).toBe(UserMiddleware.getUserMiddleware);
      expect(route.middlewares[1]).toBe(
        UserMiddleware.requireUserAuthentication,
      );
    },
  );

  test("each signal's route takes the permissions that create or edit its drop filters, as the model declares them", () => {
    expect([...DROP_FILTER_IMPACT_PERMISSIONS.log].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CreateProjectLogDropFilter,
        Permission.EditProjectLogDropFilter,
      ].sort(),
    );
    expect([...DROP_FILTER_IMPACT_PERMISSIONS.trace].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CreateProjectTraceDropFilter,
        Permission.EditProjectTraceDropFilter,
      ].sort(),
    );
  });
});

describe("who may ask", () => {
  test.each(DROP_FILTER_IMPACT_PERMISSIONS.log)(
    "the log route lets in %s",
    async (permission: Permission) => {
      expect(
        (await isLetThrough("log", requestOf({ permissions: [permission] })))
          .isLetThrough,
      ).toBe(true);
    },
  );

  test.each(DROP_FILTER_IMPACT_PERMISSIONS.trace)(
    "the trace route lets in %s",
    async (permission: Permission) => {
      expect(
        (await isLetThrough("trace", requestOf({ permissions: [permission] })))
          .isLetThrough,
      ).toBe(true);
    },
  );

  test("an API key that may create log drop filters asks too: Terraform and scripts are not left out", async () => {
    expect(
      (
        await isLetThrough(
          "log",
          requestOf({
            permissions: [Permission.CreateProjectLogDropFilter],
            userType: UserType.API,
          }),
        )
      ).isLetThrough,
    ).toBe(true);
  });

  test("one who may only read drop filters, or read logs, is refused", async () => {
    const answer: { isLetThrough: boolean; refusal: unknown } =
      await isLetThrough(
        "log",
        requestOf({
          permissions: [
            Permission.ReadProjectLogDropFilter,
            Permission.ReadTelemetryServiceLog,
            Permission.TelemetryViewer,
          ],
        }),
      );

    expect(answer.isLetThrough).toBe(false);
    expect(answer.refusal).toBeInstanceOf(NotAuthorizedException);
  });

  test("a trace drop filter's permission is no log drop filter's", async () => {
    expect(
      (
        await isLetThrough(
          "log",
          requestOf({ permissions: [Permission.CreateProjectTraceDropFilter] }),
        )
      ).isLetThrough,
    ).toBe(false);
    expect(
      (
        await isLetThrough(
          "trace",
          requestOf({ permissions: [Permission.EditProjectLogDropFilter] }),
        )
      ).isLetThrough,
    ).toBe(false);
  });

  test("a block row of the permission is no grant of it", async () => {
    const request: ExpressRequest = requestOf({ permissions: [] });

    (
      request as unknown as {
        userTenantAccessPermission: Dictionary<UserTenantAccessPermission>;
      }
    ).userTenantAccessPermission[PROJECT_ID.toString()]!.permissions = [
      {
        _type: "UserPermission",
        permission: Permission.CreateProjectLogDropFilter,
        labelIds: [],
        isBlockPermission: true,
      },
    ];

    expect((await isLetThrough("log", request)).isLetThrough).toBe(false);
  });

  test("nobody signed in is told to sign in, not refused", async () => {
    const next: jest.Mock = jest.fn();
    const refuse: jest.Mock =
      Response.sendErrorResponse as unknown as jest.Mock;

    await (
      routeOf("log").middlewares[1] as unknown as (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => Promise<void>
    )(
      { userType: UserType.Public } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(refuse.mock.calls[refuse.mock.calls.length - 1]![2]).toBeInstanceOf(
      NotAuthenticatedException,
    );
  });
});

describe("what it answers", () => {
  test("asks for the impact with the caller's own permissions, of their project, the signal its route's", async () => {
    const result: RouteCall = await call("trace", {
      filterQuery: "name LIKE 'healthcheck'",
      action: "sample",
      samplePercentage: 10,
      name: "Health checks",
    });

    expect(result.thrown).toBeUndefined();
    expect(result.answer).toEqual(nothingTaken("trace"));

    const asked: Parameters<
      typeof DropFilterImpactModule.findDropFilterImpact
    >[0] = impactSpy.mock.calls[0]![0];

    expect(asked.projectId).toEqual(PROJECT_ID);
    expect(asked.request).toEqual({
      signal: "trace",
      filterQuery: "name LIKE 'healthcheck'",
      action: "sample",
      samplePercentage: 10,
      name: "Health checks",
    });
    // Never as OneUptime itself: what it names and counts is the caller's.
    expect(asked.props.isRoot).toBeFalsy();
    expect(asked.props.userId).toEqual(USER_ID);
  });

  test("an API key's props are handed on as they are", async () => {
    propsSpy.mockResolvedValue(
      buildProps([Permission.CreateProjectLogDropFilter], UserType.API),
    );

    const result: RouteCall = await call("log", {
      filterQuery: "severityText = 'Debug'",
    });

    expect(result.thrown).toBeUndefined();
    expect(
      (
        impactSpy.mock.calls[0]![0] as {
          props: DatabaseCommonInteractionProps;
        }
      ).props.userType,
    ).toBe(UserType.API);
  });

  test.each([
    [{}, "Filter query is required"],
    [{ filterQuery: "   " }, "Filter query is required"],
    [{ filterQuery: "severityText = 'Debug'", action: "delete" }, "action"],
    [
      { filterQuery: "severityText = 'Debug'", action: "sample" },
      "Sample percentage is required",
    ],
    [
      {
        filterQuery: "severityText = 'Debug'",
        action: "sample",
        samplePercentage: 100,
      },
      "between 1 and 99",
    ],
  ] as Array<[unknown, string]>)(
    "refuses %p before it reads anything, saying what it takes",
    async (body: unknown, says: string) => {
      const result: RouteCall = await call("log", body);

      expect(result.thrown).toBeInstanceOf(BadDataException);
      expect(String((result.thrown as Error).message)).toContain(says);
      expect(impactSpy).not.toHaveBeenCalled();
    },
  );
});
