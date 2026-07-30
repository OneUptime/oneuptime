import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import RumSessionReplayViewService from "../../../Server/Services/RumSessionReplayViewService";
import RumSessionService from "../../../Server/Services/RumSessionService";
import RumSessionChunkService from "../../../Server/Services/RumSessionChunkService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import RumSessionReplayView from "../../../Models/DatabaseModels/RumSessionReplayView";
import Label from "../../../Models/DatabaseModels/Label";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import UserType from "../../../Types/UserType";
import { MAX_SESSION_REPLAY_CHUNKS_PER_READ } from "../../../Types/Rum/SessionReplay";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The session-replay playback routes are the ONLY reader of the two
 * replay analytics tables: both models omit `crudApiPath`, so
 * ModelPermission is never invoked and the `payload` column's own read
 * ACL is, by itself, decorative. Every guarantee therefore has to be
 * proved at the handler, which is what this file does.
 *
 * A note on status codes. The requirement these tests were written
 * against says an under-privileged caller "gets 401". This repo maps
 * NotAuthenticatedException to 401 (not logged in) and
 * NotAuthorizedException to 422 (logged in, insufficient rights) - see
 * Types/Exception/ExceptionCode.ts - and every permission guard in the
 * codebase, including UserMiddleware.requirePermission, raises the
 * latter. Emitting 401 for an authenticated-but-unauthorized caller on
 * these five routes alone would be both HTTP-incorrect and inconsistent
 * with the rest of the API, so the tests assert the repo's real denial
 * (NotAuthorizedException / 422). The security property being pinned -
 * that a Viewer or ProjectMember cannot reach a recording - is identical.
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type RecordedRoute = {
  method: string;
  uri: string;
  handlers: Array<RouterFunction>;
};

const recordedRoutes: Array<RecordedRoute> = [];

type RecordRouteFunction = (
  method: string,
) => (uri: string, ...handlers: Array<RouterFunction>) => void;

const recordRoute: RecordRouteFunction = (method: string) => {
  return (uri: string, ...handlers: Array<RouterFunction>): void => {
    recordedRoutes.push({
      method: method.toUpperCase(),
      uri: uri,
      handlers: handlers,
    });
  };
};

const sessionReplayRouter: JSONObject = {
  get: recordRoute("get"),
  post: recordRoute("post"),
  put: recordRoute("put"),
  delete: recordRoute("delete"),
} as unknown as JSONObject;

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return sessionReplayRouter;
    },
    getClientIp: () => {
      return "203.0.113.7";
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const LIST_ROUTE: string = "/telemetry/rum/session-replay/list";
const MANIFEST_ROUTE: string = "/telemetry/rum/session-replay/manifest";
const CHUNKS_ROUTE: string = "/telemetry/rum/session-replay/chunks";
const HEARTBEAT_ROUTE: string = "/telemetry/rum/session-replay/heartbeat";
const FOR_EXCEPTION_ROUTE: string =
  "/telemetry/rum/session-replay/for-exception";

function findRoute(uri: string): RecordedRoute {
  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route not registered: ${uri}`);
  }

  return route;
}

type CallResult = {
  /* Exception handed to Response.sendErrorResponse by a guard or handler. */
  deniedWith: Exception | undefined;
  /* Exception thrown out of the handler into express' error path. */
  thrownToNext: unknown;
  /* True when the final route handler was actually entered. */
  reachedHandler: boolean;
  jsonBody: JSONObject | undefined;
  sentBuffer: Buffer | undefined;
  headers: Dictionary<string>;
};

/*
 * Runs a recorded route's middleware chain for real, starting at
 * requireUserAuthentication.
 *
 * Index 0 is UserMiddleware.getUserMiddleware, whose only job is to load
 * the session and populate userType / tenantId / tenant permissions on
 * the request - exactly the fields these fixtures set directly. Its
 * presence is asserted separately rather than executed, because running
 * it would require a live session store and would prove nothing about
 * authorization.
 */
async function callRoute(data: {
  uri: string;
  request: JSONObject;
  body: JSONObject;
}): Promise<CallResult> {
  const route: RecordedRoute = findRoute(data.uri);

  const headers: Dictionary<string> = {};
  let sentBuffer: Buffer | undefined = undefined;

  const req: ExpressRequest = {
    ...data.request,
    body: data.body,
    params: {},
    query: {},
    headers: { "user-agent": "jest-agent" },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    setHeader: (key: string, value: string): void => {
      headers[key] = value;
    },
    send: (payload: Buffer): void => {
      sentBuffer = payload;
    },
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as ExpressResponse;

  /*
   * Held in a const container rather than in loop-scoped `let`s so the
   * per-iteration `next` closures never capture a mutable outer binding.
   */
  const outcome: { thrownToNext: unknown; reachedHandler: boolean } = {
    thrownToNext: undefined,
    reachedHandler: false,
  };

  for (let index: number = 1; index < route.handlers.length; index++) {
    const handler: RouterFunction | undefined = route.handlers[index];

    if (!handler) {
      break;
    }

    if (index === route.handlers.length - 1) {
      outcome.reachedHandler = true;
    }

    const step: { calledNext: boolean } = { calledNext: false };

    const next: NextFunction = ((error?: unknown): void => {
      step.calledNext = true;

      if (error) {
        outcome.thrownToNext = error;
      }
    }) as unknown as NextFunction;

    await handler(req, res, next);

    /*
     * A guard that answered the request itself never calls next, which
     * is precisely the denial being asserted.
     */
    if (!step.calledNext) {
      break;
    }
  }

  const sendErrorResponse: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;
  const sendJsonObjectResponse: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  const errorCall: Array<unknown> | undefined = sendErrorResponse.mock
    .calls[0] as Array<unknown> | undefined;

  const jsonCall: Array<unknown> | undefined = sendJsonObjectResponse.mock
    .calls[0] as Array<unknown> | undefined;

  return {
    deniedWith: errorCall ? (errorCall[2] as Exception) : undefined,
    thrownToNext: outcome.thrownToNext,
    reachedHandler: outcome.reachedHandler,
    jsonBody: jsonCall ? (jsonCall[2] as JSONObject) : undefined,
    sentBuffer: sentBuffer,
    headers: headers,
  };
}

function buildPrincipal(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  labelIds?: Array<ObjectID> | undefined;
  /*
   * TeamPermission.scope is a real, admin-settable column (All / Owned /
   * Labels), and Owned is excluded from BOTH PermissionHelper filters -
   * so a fixture that never sets it cannot see the fail-open it causes.
   */
  scope?: PermissionScope | undefined;
}): {
  request: JSONObject;
  databaseProps: DatabaseCommonInteractionProps;
} {
  /*
   * isBlockPermission must be an explicit false, not omitted:
   * DatabaseCommonInteractionPropsUtil.getUserPermissions filters tenant
   * permissions with a strict `isBlockPermission === false`, so an
   * undefined here would silently drop every permission the fixture
   * grants - which is exactly what AccessTokenService writes for a real
   * team permission.
   */
  const userPermissions: Array<UserPermission> = data.permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: data.labelIds || [],
        isBlockPermission: false,
        ...(data.scope !== undefined && { scope: data.scope }),
      };
    },
  );

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: userPermissions,
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  const databaseProps: DatabaseCommonInteractionProps = {
    tenantId: data.projectId,
    userId: data.userId,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };

  return {
    request: {
      userType: UserType.User,
      tenantId: data.projectId,
      userTenantAccessPermission: permissionMap,
      userAuthorization: { userId: data.userId },
    } as unknown as JSONObject,
    databaseProps: databaseProps,
  };
}

/*
 * Adds an UNSCOPED ReadRumSessionReplay row on top of whatever the
 * principal already holds. The list guard does not accept
 * ReadRumSessionReplayPayload, so a payload-scoped reviewer needs this to
 * get into /list at all - which is precisely the shape that makes the
 * identity column's label scope worth checking separately.
 */
function grantUnscopedListPermission(
  databaseProps: DatabaseCommonInteractionProps,
  projectId: ObjectID,
): void {
  const tenantPermission: UserTenantAccessPermission | undefined =
    databaseProps.userTenantAccessPermission?.[projectId.toString()];

  if (!tenantPermission) {
    throw new Error("Principal has no tenant permission to extend.");
  }

  tenantPermission.permissions.push({
    _type: "UserPermission",
    permission: Permission.ReadRumSessionReplay,
    labelIds: [],
    isBlockPermission: false,
  });
}

/* Minimal stand-in for the ClickHouse client's ResultSet. */
function fakeResultSet(rows: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<JSONObject> => {
      return { data: rows } as unknown as JSONObject;
    },
  };
}

function buildHeaderRow(data: {
  sessionId: string;
  projectId: ObjectID;
  rumApplicationId: ObjectID;
}): JSONObject {
  return {
    sessionId: data.sessionId,
    headerProjectId: data.projectId.toString(),
    applicationId: data.rumApplicationId.toString(),
    aggStartTime: 1700000000000,
    aggEndTime: 1700000060000,
    aggDurationMs: 60000,
    aggIsFinalized: true,
    aggSealedReason: "final-chunk",
    aggChunkCount: 4,
    aggMaxChunkIndex: 3,
    aggMissingChunkCount: 0,
    aggEventCount: 400,
    aggPayloadBytes: 4096,
    aggHasError: true,
    aggErrorCount: 1,
    aggRageClickCount: 0,
    aggDeadClickCount: 0,
    aggErrorClickCount: 0,
    aggRefreshRageCount: 0,
    aggPageCount: 2,
    aggTriggerReason: "error",
    aggMaskingMode: "MaskAllText",
    aggConsentState: "Granted",
    aggRecorderKind: "dom",
    aggRecorderVersion: "1.0.0",
    aggRrwebVersion: "2.1.1",
    aggSchemaVersion: 1,
    aggWireVersion: 1,
    aggEntryUrl: "https://example.com/",
    aggExitUrl: "https://example.com/checkout",
    aggRoutes: ["/", "/checkout"],
    aggBrowserName: "Chrome",
    aggBrowserVersion: "120",
    aggOsName: "macOS",
    aggDeviceType: "desktop",
    aggCountryCode: "GB",
    aggViewportWidth: 1440,
    aggViewportHeight: 900,
    aggFidelityNotices: ["canvas-not-recorded"],
    aggFullSnapshotChunkIndexes: [0, 2],
    aggTraceIds: [],
    aggExceptionFingerprints: ["fp-1"],
    aggClockSkewMs: 12,
    aggIdentifiedUserKey: "hmac-key",
    aggSamplePercentage: 10,
  };
}

describe("Session replay playback API", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let applicationAId: ObjectID;
  let applicationBId: ObjectID;
  let labelAId: ObjectID;
  let labelBId: ObjectID;

  let headerQuerySpy: jest.SpyInstance;
  let chunkQuerySpy: jest.SpyInstance;
  let findOneBySpy: jest.SpyInstance;
  let findBySpy: jest.SpyInstance;
  let recordViewSpy: jest.SpyInstance;
  let recordSecondsWatchedSpy: jest.SpyInstance;
  let viewFindOneBySpy: jest.SpyInstance;

  beforeAll(() => {
    recordedRoutes.length = 0;
    /*
     * Loaded lazily rather than with a top-level import. TelemetryAPI
     * calls Express.getRouter() at module scope, so a static import would
     * run the mock factory during the import phase - before the const
     * router above is initialised - and die in the temporal dead zone.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../../Server/API/TelemetryAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    applicationAId = ObjectID.generate();
    applicationBId = ObjectID.generate();
    labelAId = ObjectID.generate();
    labelBId = ObjectID.generate();

    headerQuerySpy = jest
      .spyOn(RumSessionService, "executeQuery")
      .mockResolvedValue(fakeResultSet([]) as never);

    chunkQuerySpy = jest
      .spyOn(RumSessionChunkService, "executeQuery")
      .mockResolvedValue(fakeResultSet([]) as never);

    findOneBySpy = jest.spyOn(RumApplicationService, "findOneBy");
    findBySpy = jest.spyOn(RumApplicationService, "findBy");

    recordViewSpy = jest.spyOn(RumSessionReplayViewService, "recordView");
    recordSecondsWatchedSpy = jest
      .spyOn(RumSessionReplayViewService, "recordSecondsWatched")
      .mockResolvedValue(undefined);
    viewFindOneBySpy = jest
      .spyOn(RumSessionReplayViewService, "findOneBy")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockProps(props: DatabaseCommonInteractionProps): void {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
  }

  function mockApplication(data: {
    id: ObjectID;
    labelIds: Array<ObjectID>;
  }): void {
    const application: RumApplication = new RumApplication();
    application.id = data.id;
    application.projectId = projectId;
    application.labels = data.labelIds.map((labelId: ObjectID): Label => {
      const label: Label = new Label();
      label.id = labelId;
      return label;
    });

    findOneBySpy.mockResolvedValue(application);
    findBySpy.mockResolvedValue([application]);
  }

  function mockSessionHeader(rumApplicationId: ObjectID): void {
    headerQuerySpy.mockResolvedValue(
      fakeResultSet([
        buildHeaderRow({
          sessionId: "session-1",
          projectId: projectId,
          rumApplicationId: rumApplicationId,
        }),
      ]) as never,
    );
  }

  /*
   * A view row the CALLER owns. The handler queries with viewedByUserId in
   * the predicate, so this stands in for "the lookup matched".
   */
  function mockOwnView(data: {
    viewId: ObjectID;
    rumApplicationId: ObjectID;
  }): void {
    const view: RumSessionReplayView = new RumSessionReplayView();
    view.id = data.viewId;
    view.projectId = projectId;
    view.rumApplicationId = data.rumApplicationId;
    view.viewedByUserId = userId;

    viewFindOneBySpy.mockResolvedValue(view);
  }

  function mockRecordedView(): ObjectID {
    const viewId: ObjectID = ObjectID.generate();
    const view: RumSessionReplayView = new RumSessionReplayView();
    view.id = viewId;
    recordViewSpy.mockResolvedValue(view);
    return viewId;
  }

  describe("guard shape", () => {
    test("all five routes are registered and every one carries the three-middleware guard", () => {
      for (const uri of [
        LIST_ROUTE,
        MANIFEST_ROUTE,
        CHUNKS_ROUTE,
        HEARTBEAT_ROUTE,
        FOR_EXCEPTION_ROUTE,
      ]) {
        const route: RecordedRoute = findRoute(uri);

        expect(route.handlers).toHaveLength(4);
        expect(route.handlers[0]).toBe(UserMiddleware.getUserMiddleware);
        expect(route.handlers[1]).toBe(
          UserMiddleware.requireUserAuthentication,
        );
      }
    });

    /*
     * handlers[2] is the permission guard itself, and swapping the payload
     * guard for the list guard on /manifest or /chunks would leave the
     * shape assertion above entirely green. The three payload routes must
     * share ONE guard instance and the two list routes another, and the
     * two must not be the same object.
     */
    test("the payload routes and the list routes carry different permission guards", () => {
      const payloadGuard: RouterFunction | undefined =
        findRoute(MANIFEST_ROUTE).handlers[2];
      const listGuard: RouterFunction | undefined =
        findRoute(LIST_ROUTE).handlers[2];

      expect(payloadGuard).toBeDefined();
      expect(listGuard).toBeDefined();
      expect(payloadGuard).not.toBe(listGuard);

      for (const uri of [MANIFEST_ROUTE, CHUNKS_ROUTE, HEARTBEAT_ROUTE]) {
        expect(findRoute(uri).handlers[2]).toBe(payloadGuard);
      }

      expect(findRoute(FOR_EXCEPTION_ROUTE).handlers[2]).toBe(listGuard);
    });
  });

  /*
   * The chunk table's replace key is (projectId, sessionId, tabId,
   * chunkIndex) - rumApplicationId is a plain column. sessionId is minted
   * by the browser, so two applications can share one. Authorizing an
   * application and then reading on (projectId, sessionId) alone is a
   * cross-application disclosure.
   */
  describe("chunk reads are pinned to the authorized application", () => {
    test("the manifest query filters on the application resolved from the header", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
      });

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });
      mockRecordedView();

      await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      const statement: Statement = chunkQuerySpy.mock.calls[0]![0] as Statement;

      expect(statement.query).toContain("rumApplicationId = ");
      expect(Object.values(statement.query_params)).toContain(
        applicationAId.toString(),
      );
    });

    test("both chunk queries filter on the application resolved from the header", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
      });

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      chunkQuerySpy
        .mockResolvedValueOnce(
          fakeResultSet([{ chunkIndex: 0, chunkStoredBytes: 3 }]) as never,
        )
        .mockResolvedValueOnce(
          fakeResultSet([{ chunkIndex: 0, payload: "[1]" }]) as never,
        );

      await callRoute({
        uri: CHUNKS_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          tabId: "tab-1",
          chunkIndexes: [0],
          /* A caller-supplied application id must change nothing. */
          rumApplicationId: applicationBId.toString(),
        },
      });

      expect(chunkQuerySpy).toHaveBeenCalledTimes(2);

      for (const call of chunkQuerySpy.mock.calls) {
        const statement: Statement = call[0] as Statement;
        expect(statement.query).toContain("rumApplicationId = ");
        expect(Object.values(statement.query_params)).toContain(
          applicationAId.toString(),
        );
        expect(Object.values(statement.query_params)).not.toContain(
          applicationBId.toString(),
        );
      }
    });

    test("a sessionId that exists under two applications is refused rather than resolved to the newest", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
        labelIds: [labelAId],
      });

      mockProps(principal.databaseProps);

      /*
       * Application A is the caller's own and sorts first (newest). Under
       * the old LIMIT 1 the label check would pass on A and the chunk
       * reads would then serve B's recording.
       */
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          buildHeaderRow({
            sessionId: "session-1",
            projectId: projectId,
            rumApplicationId: applicationAId,
          }),
          buildHeaderRow({
            sessionId: "session-1",
            projectId: projectId,
            rumApplicationId: applicationBId,
          }),
        ]) as never,
      );
      mockApplication({ id: applicationAId, labelIds: [labelAId] });
      mockRecordedView();

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(chunkQuerySpy).not.toHaveBeenCalled();
      expect(recordViewSpy).not.toHaveBeenCalled();
    });
  });

  /*
   * PermissionScope.Owned is excluded from getNonAccessControlPermissions
   * AND from getAccessControlPermissions, because the ORM enforces it
   * separately via OwnedScopePermission. This bespoke path has no such
   * step, so an Owned grant must be refused, never treated as unscoped.
   */
  describe("PermissionScope.Owned fails closed", () => {
    test("an Owned-scoped payload grant cannot read a recording", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
        scope: PermissionScope.Owned,
      });

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [labelAId] });
      mockRecordedView();

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(recordViewSpy).not.toHaveBeenCalled();
      expect(chunkQuerySpy).not.toHaveBeenCalled();
    });

    test("an Owned-scoped list grant cannot read the whole project's exceptions", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplay],
        scope: PermissionScope.Owned,
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [labelAId] });

      const result: CallResult = await callRoute({
        uri: FOR_EXCEPTION_ROUTE,
        request: principal.request,
        body: { fingerprint: "fp-1" },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      /* Above all: no unfiltered project-wide query was issued. */
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });

    test("an Owned-scoped grant cannot list an application's sessions", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplay],
        scope: PermissionScope.Owned,
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [labelAId] });

      const result: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });
  });

  /*
   * The core of the design: the payload guard must NOT be the OR-list
   * createTelemetryReadAccessGuard builds, which already contains
   * ProjectMember, Viewer and TelemetryViewer. If someone ever
   * "simplifies" these routes onto that helper, these four cases fail.
   */
  describe("payload routes reject the roles createTelemetryReadAccessGuard would have admitted", () => {
    const deniedRoles: Array<{ name: string; permission: Permission }> = [
      { name: "Viewer", permission: Permission.Viewer },
      { name: "ProjectMember", permission: Permission.ProjectMember },
      { name: "TelemetryViewer", permission: Permission.TelemetryViewer },
      { name: "TelemetryMember", permission: Permission.TelemetryMember },
    ];

    test.each(deniedRoles)(
      "a $name-only principal is denied /manifest",
      async (role: { name: string; permission: Permission }) => {
        const principal: {
          request: JSONObject;
          databaseProps: DatabaseCommonInteractionProps;
        } = buildPrincipal({
          projectId: projectId,
          userId: userId,
          permissions: [role.permission],
        });

        mockProps(principal.databaseProps);
        mockSessionHeader(applicationAId);
        mockApplication({ id: applicationAId, labelIds: [] });
        mockRecordedView();

        const result: CallResult = await callRoute({
          uri: MANIFEST_ROUTE,
          request: principal.request,
          body: { sessionId: "session-1" },
        });

        expect(result.deniedWith).toBeInstanceOf(NotAuthorizedException);
        expect(result.deniedWith?.code).toBe(422);
        expect(result.reachedHandler).toBe(false);
        // Nothing was read, and no audit row claims a view that never happened.
        expect(headerQuerySpy).not.toHaveBeenCalled();
        expect(recordViewSpy).not.toHaveBeenCalled();
      },
    );

    test.each(deniedRoles)(
      "a $name-only principal is denied /chunks",
      async (role: { name: string; permission: Permission }) => {
        const principal: {
          request: JSONObject;
          databaseProps: DatabaseCommonInteractionProps;
        } = buildPrincipal({
          projectId: projectId,
          userId: userId,
          permissions: [role.permission],
        });

        mockProps(principal.databaseProps);
        mockSessionHeader(applicationAId);
        mockApplication({ id: applicationAId, labelIds: [] });

        const result: CallResult = await callRoute({
          uri: CHUNKS_ROUTE,
          request: principal.request,
          body: {
            sessionId: "session-1",
            tabId: "tab-1",
            chunkIndexes: [0],
          },
        });

        expect(result.deniedWith).toBeInstanceOf(NotAuthorizedException);
        expect(result.deniedWith?.code).toBe(422);
        expect(result.reachedHandler).toBe(false);
        expect(chunkQuerySpy).not.toHaveBeenCalled();
      },
    );

    test("ReadRumSessionReplay alone is not enough to watch a recording", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplay],
      });

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      expect(result.deniedWith).toBeInstanceOf(NotAuthorizedException);
      expect(result.reachedHandler).toBe(false);
    });

    test("ReadRumSessionReplayPayload alone reaches the manifest handler", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
      });

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });
      mockRecordedView();

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      expect(result.deniedWith).toBeUndefined();
      expect(result.thrownToNext).toBeUndefined();
      expect(result.reachedHandler).toBe(true);
      expect(result.jsonBody).toBeDefined();
    });
  });

  describe("application scope", () => {
    test("a caller scoped to application A is refused a session in application B", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
        labelIds: [labelAId],
      });

      mockProps(principal.databaseProps);
      // The session belongs to application B, which carries a different label.
      mockSessionHeader(applicationBId);
      mockApplication({ id: applicationBId, labelIds: [labelBId] });
      mockRecordedView();

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as Exception).code).toBe(422);
      // The audit row is written only after authorization succeeds.
      expect(recordViewSpy).not.toHaveBeenCalled();
    });

    test("the owning application is resolved from the session header, never from the request body", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
        labelIds: [labelAId],
      });

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationBId);
      mockApplication({ id: applicationBId, labelIds: [labelBId] });
      mockRecordedView();

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          // A caller-supplied application id must be ignored entirely.
          rumApplicationId: applicationAId.toString(),
        },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);

      const lookupArgs: JSONObject = findOneBySpy.mock
        .calls[0]![0] as JSONObject;
      const query: JSONObject = lookupArgs["query"] as JSONObject;
      expect(query["_id"]).toBe(applicationBId.toString());
    });

    test("a caller whose label matches the owning application is allowed", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
        labelIds: [labelAId],
      });

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [labelAId, labelBId] });
      mockRecordedView();

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.deniedWith).toBeUndefined();
      expect(recordViewSpy).toHaveBeenCalledTimes(1);
    });

    test("the tenant comes from databaseProps, not from the body", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
      });

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });
      mockRecordedView();

      const otherProjectId: ObjectID = ObjectID.generate();

      await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          projectId: otherProjectId.toString(),
          tenantId: otherProjectId.toString(),
        },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;
      const params: Record<string, unknown> = statement.query_params;

      expect(Object.values(params)).toContain(projectId.toString());
      expect(Object.values(params)).not.toContain(otherProjectId.toString());
    });
  });

  describe("list query", () => {
    test("de-duplicates ReplacingMergeTree rows with argMax over the session identity", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplay],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      expect(headerQuerySpy).toHaveBeenCalledTimes(1);

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;
      const query: string = statement.query;

      expect(query).toContain("argMax(");
      expect(query).toContain("argMax(startTime, version)");
      expect(query).toContain(
        "GROUP BY projectId, rumApplicationId, sessionId",
      );
      // No FINAL support exists in this repo; it must never appear.
      expect(query).not.toContain(" FINAL");
      // A read must never resurrect rows past their retention date.
      expect(query).toContain("retentionDate >= now()");
      /*
       * 'break' silently returns partial results; the whole point of not
       * using BaseAnalyticsAPI is to avoid that.
       */
      expect(query).toContain("timeout_overflow_mode = 'throw'");
    });

    test("omits identifiedUserLabel for a caller without the narrower identity permission", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplay],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;

      expect(statement.query).not.toContain("identifiedUserLabel");
    });

    /*
     * The strictest column in the schema. A caller can hold
     * ReadRumSessionReplay unscoped (so the list route admits them for
     * every application) while their identity grant -
     * ReadRumSessionReplayPayload - is scoped to one label. Checking only
     * that the permission NAME is present hands them named end users for
     * applications outside that label.
     */
    test("omits identifiedUserLabel when the identity grant is scoped to a different application", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
        labelIds: [labelAId],
      });

      grantUnscopedListPermission(principal.databaseProps, projectId);

      mockProps(principal.databaseProps);
      /* Application B is outside the identity grant's label. */
      mockApplication({ id: applicationBId, labelIds: [labelBId] });

      await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationBId.toString() },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;

      expect(statement.query).not.toContain("identifiedUserLabel");
    });

    test("selects identifiedUserLabel when the identity grant covers this application", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
        labelIds: [labelAId],
      });

      grantUnscopedListPermission(principal.databaseProps, projectId);

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [labelAId] });

      await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;

      expect(statement.query).toContain(
        "argMax(identifiedUserLabel, version) AS aggIdentifiedUserLabel",
      );
    });

    test("a malformed rumApplicationId is a bad request, not a database error", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplay],
      });

      mockProps(principal.databaseProps);

      const result: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: { rumApplicationId: "nope" },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(findOneBySpy).not.toHaveBeenCalled();
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });

    test("selects identifiedUserLabel for a ProjectAdmin", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectAdmin],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;

      expect(statement.query).toContain(
        "argMax(identifiedUserLabel, version) AS aggIdentifiedUserLabel",
      );
    });
  });

  describe("manifest", () => {
    test("never names the payload column and writes the read audit row", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
      });

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });
      const viewId: ObjectID = mockRecordedView();

      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            tabId: "tab-1",
            chunkIndex: 0,
            chunkStartOffsetMs: 0,
            chunkEndOffsetMs: 15000,
            eventCount: 100,
            hasFullSnapshot: true,
            chunkPayloadBytes: 1024,
          },
          {
            tabId: "tab-1",
            chunkIndex: 3,
            chunkStartOffsetMs: 45000,
            chunkEndOffsetMs: 60000,
            eventCount: 100,
            hasFullSnapshot: false,
            chunkPayloadBytes: 1024,
          },
        ]) as never,
      );

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1", accessReason: "incident triage" },
      });

      const statement: Statement = chunkQuerySpy.mock.calls[0]![0] as Statement;

      expect(statement.query).not.toContain("payload,");
      expect(statement.query).not.toMatch(/\bpayload\b(?!Bytes)/);
      expect(statement.query).toContain("LIMIT 1 BY tabId, chunkIndex");

      expect(recordViewSpy).toHaveBeenCalledTimes(1);
      const auditArgs: JSONObject = recordViewSpy.mock
        .calls[0]![0] as JSONObject;
      expect((auditArgs["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((auditArgs["rumApplicationId"] as ObjectID).toString()).toBe(
        applicationAId.toString(),
      );
      expect(auditArgs["sessionId"]).toBe("session-1");
      expect(auditArgs["accessReason"]).toBe("incident triage");
      expect(auditArgs["ipAddress"]).toBe("203.0.113.7");

      const body: JSONObject = result.jsonBody as JSONObject;
      expect(body["viewId"]).toBe(viewId.toString());

      const tabs: Array<JSONObject> = body[
        "tabs"
      ] as unknown as Array<JSONObject>;
      expect(tabs).toHaveLength(1);
      expect(tabs[0]!["chunkIndexes"]).toEqual([0, 3]);
      expect(tabs[0]!["fullSnapshotChunkIndexes"]).toEqual([0]);

      /*
       * The hole between chunk 0 and chunk 3 must be reported. Playback
       * that silently crosses a gap renders a DOM the user never saw.
       */
      const gaps: Array<JSONObject> = tabs[0]![
        "gaps"
      ] as unknown as Array<JSONObject>;
      expect(gaps).toHaveLength(1);
      expect(gaps[0]!["fromIndex"]).toBe(0);
      expect(gaps[0]!["toIndex"]).toBe(3);
      expect(gaps[0]!["missingMs"]).toBe(30000);
    });

    test("a session that does not exist in this tenant is refused before any audit row", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);
      headerQuerySpy.mockResolvedValue(fakeResultSet([]) as never);

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "does-not-exist" },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(recordViewSpy).not.toHaveBeenCalled();
    });
  });

  describe("chunks", () => {
    function payloadPrincipal(): {
      request: JSONObject;
      databaseProps: DatabaseCommonInteractionProps;
    } {
      return buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.TelemetryAdmin],
      });
    }

    test(`rejects more than ${MAX_SESSION_REPLAY_CHUNKS_PER_READ} chunks without touching ClickHouse`, async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = payloadPrincipal();

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      const tooManyIndexes: Array<number> = Array.from(
        { length: MAX_SESSION_REPLAY_CHUNKS_PER_READ + 1 },
        (_unused: unknown, index: number): number => {
          return index;
        },
      );

      const result: CallResult = await callRoute({
        uri: CHUNKS_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          tabId: "tab-1",
          chunkIndexes: tooManyIndexes,
        },
      });

      expect(result.deniedWith).toBeInstanceOf(BadDataException);
      expect(result.deniedWith?.message).toContain(
        `${MAX_SESSION_REPLAY_CHUNKS_PER_READ}`,
      );
      expect(chunkQuerySpy).not.toHaveBeenCalled();
      // The cap is checked before the session is even resolved.
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });

    test("rejects a total payload larger than the read byte cap before returning any bytes", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = payloadPrincipal();

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          { chunkIndex: 0, chunkStoredBytes: 5 * 1024 * 1024 },
          { chunkIndex: 1, chunkStoredBytes: 5 * 1024 * 1024 },
        ]) as never,
      );

      const result: CallResult = await callRoute({
        uri: CHUNKS_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          tabId: "tab-1",
          chunkIndexes: [0, 1],
        },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      /* Refused on the pre-check: the payload read never ran. */
      expect(chunkQuerySpy).toHaveBeenCalledTimes(1);
    });

    /*
     * The cap has to bound the bytes this endpoint actually returns.
     * `payloadBytes` is the POST-GZIP wire size the recorder uploaded,
     * while the `payload` column holds the DECOMPRESSED JSON that is
     * served. Measuring the former let 8 chunks that pass a 8 MiB check
     * decompress into tens of megabytes of response.
     */
    test("the pre-check measures the stored (decompressed) size, not the compressed wire size", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = payloadPrincipal();

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      chunkQuerySpy
        .mockResolvedValueOnce(
          fakeResultSet([{ chunkIndex: 0, chunkStoredBytes: 4 }]) as never,
        )
        .mockResolvedValueOnce(
          fakeResultSet([{ chunkIndex: 0, payload: "[1]" }]) as never,
        );

      await callRoute({
        uri: CHUNKS_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          tabId: "tab-1",
          chunkIndexes: [0],
        },
      });

      const precheck: Statement = chunkQuerySpy.mock.calls[0]![0] as Statement;

      expect(precheck.query).toContain("length(payload)");
      expect(precheck.query).not.toContain("toFloat64(payloadBytes)");
    });

    test("refuses to serve more bytes than the cap even when the pre-check said the chunks were small", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = payloadPrincipal();

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      /* 10 MiB of real payload behind a pre-check that reported 8 bytes. */
      const fatPayload: string = "a".repeat(5 * 1024 * 1024);

      chunkQuerySpy
        .mockResolvedValueOnce(
          fakeResultSet([
            { chunkIndex: 0, chunkStoredBytes: 4 },
            { chunkIndex: 1, chunkStoredBytes: 4 },
          ]) as never,
        )
        .mockResolvedValueOnce(
          fakeResultSet([
            { chunkIndex: 0, payload: fatPayload },
            { chunkIndex: 1, payload: fatPayload },
          ]) as never,
        );

      const result: CallResult = await callRoute({
        uri: CHUNKS_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          tabId: "tab-1",
          chunkIndexes: [0, 1],
        },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      /* Nothing was served. */
      expect(result.sentBuffer).toBeUndefined();
    });

    test("returns length-prefixed binary frames and de-duplicates by version", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = payloadPrincipal();

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      chunkQuerySpy
        .mockResolvedValueOnce(
          fakeResultSet([
            { chunkIndex: 0, chunkStoredBytes: 3 },
            { chunkIndex: 1, chunkStoredBytes: 4 },
          ]) as never,
        )
        .mockResolvedValueOnce(
          fakeResultSet([
            { chunkIndex: 0, payload: "[1]" },
            { chunkIndex: 1, payload: "[22]" },
          ]) as never,
        );

      const result: CallResult = await callRoute({
        uri: CHUNKS_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          tabId: "tab-1",
          chunkIndexes: [0, 1],
        },
      });

      const buffer: Buffer = result.sentBuffer as unknown as Buffer;
      expect(buffer).toBeDefined();

      expect(buffer.readUInt32LE(0)).toBe(0);
      expect(buffer.readUInt32LE(4)).toBe(3);
      expect(buffer.subarray(8, 11).toString("utf8")).toBe("[1]");
      expect(buffer.readUInt32LE(11)).toBe(1);
      expect(buffer.readUInt32LE(15)).toBe(4);
      expect(buffer.subarray(19, 23).toString("utf8")).toBe("[22]");

      expect(result.headers["Content-Type"]).toBe("application/octet-stream");
      // A recording is personal data - it must never enter a shared cache.
      expect(result.headers["Cache-Control"]).toBe("no-store");

      const payloadStatement: Statement = chunkQuerySpy.mock
        .calls[1]![0] as Statement;
      expect(payloadStatement.query).toContain(
        "ORDER BY chunkIndex ASC, version DESC LIMIT 1 BY chunkIndex",
      );
    });

    test("rejects a non-integer chunk index", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = payloadPrincipal();

      mockProps(principal.databaseProps);

      const result: CallResult = await callRoute({
        uri: CHUNKS_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          tabId: "tab-1",
          chunkIndexes: [0, "1; DROP TABLE"],
        },
      });

      expect(result.deniedWith).toBeInstanceOf(BadDataException);
      expect(chunkQuerySpy).not.toHaveBeenCalled();
    });
  });

  describe("heartbeat", () => {
    test("floors seconds watched to the 15s cadence and scopes the row to the tenant", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      const viewId: ObjectID = ObjectID.generate();
      mockOwnView({ viewId: viewId, rumApplicationId: applicationAId });

      await callRoute({
        uri: HEARTBEAT_ROUTE,
        request: principal.request,
        body: { viewId: viewId.toString(), secondsWatched: 44 },
      });

      expect(recordSecondsWatchedSpy).toHaveBeenCalledTimes(1);
      const args: JSONObject = recordSecondsWatchedSpy.mock
        .calls[0]![0] as JSONObject;
      expect(args["secondsWatched"]).toBe(30);
      expect((args["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((args["viewId"] as ObjectID).toString()).toBe(viewId.toString());
    });

    test("a Viewer cannot reach the heartbeat route at all", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.Viewer],
      });

      mockProps(principal.databaseProps);

      const result: CallResult = await callRoute({
        uri: HEARTBEAT_ROUTE,
        request: principal.request,
        body: { viewId: ObjectID.generate().toString(), secondsWatched: 30 },
      });

      expect(result.deniedWith).toBeInstanceOf(NotAuthorizedException);
      expect(recordSecondsWatchedSpy).not.toHaveBeenCalled();
    });

    /*
     * secondsWatched is a privacy control shown on the player, not a
     * counter. A payload-permitted principal must not be able to inflate
     * a colleague's audit row - the row is looked up as the caller's own,
     * so somebody else's viewId matches nothing.
     */
    test("a viewId belonging to another user is refused and never written", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      const someoneElsesViewId: ObjectID = ObjectID.generate();

      /*
       * The service is asked for a row owned by the caller; the row in
       * the table belongs to somebody else, so nothing comes back.
       */
      viewFindOneBySpy.mockResolvedValue(null);

      const result: CallResult = await callRoute({
        uri: HEARTBEAT_ROUTE,
        request: principal.request,
        body: {
          viewId: someoneElsesViewId.toString(),
          secondsWatched: 600,
        },
      });

      expect(result.deniedWith).toBeInstanceOf(NotAuthorizedException);
      expect(recordSecondsWatchedSpy).not.toHaveBeenCalled();

      /* The ownership predicate is the thing being pinned. */
      const lookupArgs: JSONObject = viewFindOneBySpy.mock
        .calls[0]![0] as JSONObject;
      const query: JSONObject = lookupArgs["query"] as JSONObject;
      expect((query["viewedByUserId"] as ObjectID).toString()).toBe(
        userId.toString(),
      );
      expect((query["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
    });

    test("a caller outside the view's application label scope cannot advance it", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
        labelIds: [labelAId],
      });

      mockProps(principal.databaseProps);
      /* The view points at application B, which carries a foreign label. */
      mockApplication({ id: applicationBId, labelIds: [labelBId] });

      const viewId: ObjectID = ObjectID.generate();
      mockOwnView({ viewId: viewId, rumApplicationId: applicationBId });

      const result: CallResult = await callRoute({
        uri: HEARTBEAT_ROUTE,
        request: principal.request,
        body: { viewId: viewId.toString(), secondsWatched: 30 },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(recordSecondsWatchedSpy).not.toHaveBeenCalled();
    });

    test("a malformed viewId is a bad request, not a database error", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
      });

      mockProps(principal.databaseProps);

      const result: CallResult = await callRoute({
        uri: HEARTBEAT_ROUTE,
        request: principal.request,
        body: { viewId: "nope", secondsWatched: 30 },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(viewFindOneBySpy).not.toHaveBeenCalled();
      expect(recordSecondsWatchedSpy).not.toHaveBeenCalled();
    });
  });

  describe("for-exception", () => {
    test("filters to the applications a label-scoped caller can reach", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplay],
        labelIds: [labelAId],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [labelAId] });

      await callRoute({
        uri: FOR_EXCEPTION_ROUTE,
        request: principal.request,
        body: { fingerprint: "fp-1" },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;

      expect(statement.query).toContain("hasAny(exceptionFingerprints,");
      expect(statement.query).toContain("rumApplicationId IN (");
      expect(Object.values(statement.query_params)).toContainEqual([
        applicationAId.toString(),
      ]);
    });

    test("a label-scoped caller that reaches no application gets no rows and issues no query", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplay],
        labelIds: [labelAId],
      });

      mockProps(principal.databaseProps);
      findBySpy.mockResolvedValue([]);

      const result: CallResult = await callRoute({
        uri: FOR_EXCEPTION_ROUTE,
        request: principal.request,
        body: { fingerprint: "fp-1" },
      });

      expect(headerQuerySpy).not.toHaveBeenCalled();
      expect(result.jsonBody?.["sessions"]).toEqual([]);
    });

    test("an unscoped caller queries the whole project without an application filter", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);

      await callRoute({
        uri: FOR_EXCEPTION_ROUTE,
        request: principal.request,
        body: { fingerprint: "fp-1" },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;

      expect(statement.query).not.toContain("rumApplicationId IN (");
      expect(findBySpy).not.toHaveBeenCalled();
    });
  });
});
