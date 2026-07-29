/* eslint-disable no-loop-func */
import { describe, expect, test, beforeEach } from "@jest/globals";
import { mockRouter } from "./Helpers";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import AlertAPI from "../../../Server/API/AlertAPI";
import ScheduledMaintenanceAPI from "../../../Server/API/ScheduledMaintenanceAPI";
import IncidentEpisodeAPI from "../../../Server/API/IncidentEpisodeAPI";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";

/*
 * End-to-end regression for the "generate from AI" endpoints on Incident,
 * Alert, Scheduled Maintenance and Incident Episode.
 *
 * These handlers roll their own permission check instead of going through
 * BaseAPI. They used to read props.userTenantAccessPermission["permissions"]
 * - but that dictionary is keyed by PROJECT ID, so the lookup always produced
 * undefined and every caller who was not a master admin was rejected,
 * including Project Owners. The handlers are invoked directly off the mock
 * router here so the real permission logic runs.
 */

type MockedModule = {
  __esModule: boolean;
  default: Dictionary<unknown>;
};

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
    sendEntityArrayResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: jest.fn(async () => {
        return { plan: null, isSubscriptionUnpaid: false };
      }),
      updateLastActive: jest.fn(async () => {
        return undefined;
      }),
      getRequireSsoForLogin: jest.fn(async () => {
        return false;
      }),
    },
  };
});

/*
 * Every resource lookup succeeds - these tests are about the permission
 * gate that runs before the lookup, not about the lookup itself.
 */
function mockResourceService(): MockedModule {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(async () => {
        return {
          _id: ObjectID.generate().toString(),
          projectId: ObjectID.generate(),
        };
      }),
    },
  };
}

jest.mock("../../../Server/Services/IncidentService", () => {
  return mockResourceService();
});
jest.mock("../../../Server/Services/AlertService", () => {
  return mockResourceService();
});
jest.mock("../../../Server/Services/ScheduledMaintenanceService", () => {
  return mockResourceService();
});
jest.mock("../../../Server/Services/IncidentEpisodeService", () => {
  return mockResourceService();
});

jest.mock("../../../Server/Services/AIService", () => {
  return {
    __esModule: true,
    default: {
      executeWithLogging: jest.fn(async () => {
        return { content: "generated-content", llmLog: {} };
      }),
    },
  };
});

function mockContextBuilder(formatMethodNames: Array<string>): MockedModule {
  const builder: Dictionary<unknown> = {
    buildIncidentContext: jest.fn(async () => {
      return {};
    }),
    buildAlertContext: jest.fn(async () => {
      return {};
    }),
    buildScheduledMaintenanceContext: jest.fn(async () => {
      return {};
    }),
    buildEpisodeContext: jest.fn(async () => {
      return {};
    }),
  };

  for (const methodName of formatMethodNames) {
    builder[methodName] = jest.fn(() => {
      return { messages: [{ role: "user", content: "context" }] };
    });
  }

  return { __esModule: true, default: builder };
}

jest.mock("../../../Server/Utils/AI/IncidentAIContextBuilder", () => {
  return mockContextBuilder([
    "formatIncidentContextForPostmortem",
    "formatIncidentContextForNote",
  ]);
});
jest.mock("../../../Server/Utils/AI/AlertAIContextBuilder", () => {
  return mockContextBuilder(["formatAlertContextForNote"]);
});
jest.mock(
  "../../../Server/Utils/AI/ScheduledMaintenanceAIContextBuilder",
  () => {
    return mockContextBuilder(["formatScheduledMaintenanceContextForNote"]);
  },
);
jest.mock("../../../Server/Utils/AI/IncidentEpisodeAIContextBuilder", () => {
  return mockContextBuilder(["formatEpisodeContextForPostmortem"]);
});

/*
 * The API classes register their routes on the shared mockRouter as a side
 * effect of construction, so build them once and then look handlers up by uri.
 */
const REGISTERED_APIS: Array<unknown> = [
  new IncidentAPI(),
  new AlertAPI(),
  new ScheduledMaintenanceAPI(),
  new IncidentEpisodeAPI(),
];

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

function getHandlerByUriSuffix(uriSuffix: string): RouteHandler {
  const matches: Array<{ uri: string; handlerFunction: unknown }> =
    mockRouter.routes.filter((route: { method: string; uri: string }) => {
      return route.method === "POST" && route.uri.endsWith(uriSuffix);
    });

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one POST route ending in ${uriSuffix}, found ${matches.length}`,
    );
  }

  return matches[0]!.handlerFunction as RouteHandler;
}

function buildTenantPermission(
  projectId: ObjectID,
  permissions: Array<Permission>,
): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
      };
    }),
  };
}

function buildRequest(data: {
  params: Dictionary<string>;
  tenantId?: ObjectID | undefined;
  userId?: ObjectID | undefined;
  userTenantAccessPermission?:
    | Dictionary<UserTenantAccessPermission>
    | undefined;
  userType?: UserType | undefined;
}): ExpressRequest {
  return {
    params: data.params,
    body: {},
    headers: {},
    tenantId: data.tenantId,
    userId: data.userId,
    userAuthorization: data.userId ? { userId: data.userId } : undefined,
    userTenantAccessPermission: data.userTenantAccessPermission,
    userType: data.userType,
  } as unknown as ExpressRequest;
}

type RouteCase = {
  title: string;
  uriSuffix: string;
  params: Dictionary<string>;
  /* A route-specific permission that should be accepted. */
  grantedPermission: Permission;
  /* The denial message this route throws when the permission is missing. */
  deniedMessage: string;
};

const ROUTE_CASES: Array<RouteCase> = [
  {
    title: "Incident postmortem",
    uriSuffix: "/generate-postmortem-from-ai/:incidentId",
    params: { incidentId: ObjectID.generate().toString() },
    grantedPermission: Permission.EditProjectIncident,
    deniedMessage:
      "You do not have permission to generate postmortem for this incident.",
  },
  {
    title: "Incident note",
    uriSuffix: "/generate-note-from-ai/:incidentId",
    params: { incidentId: ObjectID.generate().toString() },
    grantedPermission: Permission.CreateIncidentInternalNote,
    deniedMessage:
      "You do not have permission to generate notes for this incident.",
  },
  {
    title: "Alert note",
    uriSuffix: "/generate-note-from-ai/:alertId",
    params: { alertId: ObjectID.generate().toString() },
    grantedPermission: Permission.CreateAlertInternalNote,
    deniedMessage:
      "You do not have permission to generate notes for this alert.",
  },
  {
    title: "Scheduled Maintenance note",
    uriSuffix: "/generate-note-from-ai/:scheduledMaintenanceId",
    params: { scheduledMaintenanceId: ObjectID.generate().toString() },
    grantedPermission: Permission.CreateScheduledMaintenanceInternalNote,
    deniedMessage:
      "You do not have permission to generate notes for this scheduled maintenance.",
  },
  {
    title: "Incident Episode postmortem",
    uriSuffix: "/generate-postmortem-from-ai/:episodeId",
    params: { episodeId: ObjectID.generate().toString() },
    grantedPermission: Permission.EditIncidentEpisode,
    deniedMessage:
      "You do not have permission to generate postmortem for this episode.",
  },
];

beforeEach(() => {
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
});

describe("AI generation route registration", () => {
  test("all four API classes registered their routes", () => {
    expect(REGISTERED_APIS.length).toBe(4);

    for (const routeCase of ROUTE_CASES) {
      expect(typeof getHandlerByUriSuffix(routeCase.uriSuffix)).toBe(
        "function",
      );
    }
  });
});

for (const routeCase of ROUTE_CASES) {
  describe(`${routeCase.title} - AI generation permission check`, () => {
    test("a Project Owner of the tenant project is allowed through", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const next: jest.Mock = jest.fn();

      await getHandlerByUriSuffix(routeCase.uriSuffix)(
        buildRequest({
          params: routeCase.params,
          tenantId: projectId,
          userId: ObjectID.generate(),
          userTenantAccessPermission: {
            [projectId.toString()]: buildTenantPermission(projectId, [
              Permission.ProjectOwner,
            ]),
          },
        }),
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );

      /*
       * The regression: before the fix this reached next() with
       * "You do not have permission ..." even for a Project Owner.
       */
      expect(next).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    });

    test("the route-specific permission is also accepted", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const next: jest.Mock = jest.fn();

      await getHandlerByUriSuffix(routeCase.uriSuffix)(
        buildRequest({
          params: routeCase.params,
          tenantId: projectId,
          userId: ObjectID.generate(),
          userTenantAccessPermission: {
            [projectId.toString()]: buildTenantPermission(projectId, [
              Permission.ProjectMember,
              routeCase.grantedPermission,
            ]),
          },
        }),
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );

      expect(next).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    });

    test("a project member without the required permission is rejected", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const next: jest.Mock = jest.fn();

      await getHandlerByUriSuffix(routeCase.uriSuffix)(
        buildRequest({
          params: routeCase.params,
          tenantId: projectId,
          userId: ObjectID.generate(),
          userTenantAccessPermission: {
            [projectId.toString()]: buildTenantPermission(projectId, [
              Permission.ProjectMember,
            ]),
          },
        }),
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );

      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);

      const thrown: unknown = next.mock.calls[0]![0];
      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as BadDataException).message).toContain(
        routeCase.deniedMessage,
      );
    });

    test("a missing tenantid header reports a missing project id, not a permission error", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const next: jest.Mock = jest.fn();

      await getHandlerByUriSuffix(routeCase.uriSuffix)(
        buildRequest({
          params: routeCase.params,
          tenantId: undefined,
          userId: ObjectID.generate(),
          userTenantAccessPermission: {
            [projectId.toString()]: buildTenantPermission(projectId, [
              Permission.ProjectOwner,
            ]),
          },
        }),
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );

      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);

      const thrown: unknown = next.mock.calls[0]![0];
      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as BadDataException).message).toBe(
        "Project ID is required",
      );
    });

    test("permissions held on a DIFFERENT project do not grant access", async () => {
      const requestedProjectId: ObjectID = ObjectID.generate();
      const otherProjectId: ObjectID = ObjectID.generate();
      const next: jest.Mock = jest.fn();

      await getHandlerByUriSuffix(routeCase.uriSuffix)(
        buildRequest({
          params: routeCase.params,
          tenantId: requestedProjectId,
          userId: ObjectID.generate(),
          userTenantAccessPermission: {
            [otherProjectId.toString()]: buildTenantPermission(otherProjectId, [
              Permission.ProjectOwner,
            ]),
          },
        }),
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );

      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]![0]).toBeInstanceOf(NotAuthorizedException);
    });

    test("an unauthenticated caller carrying only a tenantid header is rejected", async () => {
      const next: jest.Mock = jest.fn();

      await getHandlerByUriSuffix(routeCase.uriSuffix)(
        buildRequest({
          params: routeCase.params,
          tenantId: ObjectID.generate(),
          userId: undefined,
          userTenantAccessPermission: undefined,
        }),
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );

      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]![0]).toBeInstanceOf(NotAuthorizedException);
    });

    test("a master admin keeps the bypass it had before the fix", async () => {
      const next: jest.Mock = jest.fn();

      await getHandlerByUriSuffix(routeCase.uriSuffix)(
        buildRequest({
          params: routeCase.params,
          tenantId: undefined,
          userId: ObjectID.generate(),
          userTenantAccessPermission: undefined,
          userType: UserType.MasterAdmin,
        }),
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );

      expect(next).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    });
  });
}
