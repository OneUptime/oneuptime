import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import RumSessionReplayViewService from "../../../Server/Services/RumSessionReplayViewService";
import RumSessionService from "../../../Server/Services/RumSessionService";
import RumSessionChunkService from "../../../Server/Services/RumSessionChunkService";
import ExceptionInstanceService from "../../../Server/Services/ExceptionInstanceService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import SessionReplayIdentity from "../../../Server/Utils/SessionReplay/SessionReplayIdentity";
import SessionReplayReadService from "../../../Server/Utils/SessionReplay/SessionReplayReadService";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_READ,
  SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH,
  SESSION_REPLAY_LIST_SEARCH_MAX_WINDOW_DAYS,
  SESSION_REPLAY_MAX_SESSION_MS,
} from "../../../Types/Rum/SessionReplay";
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
const INGEST_STATUS_ROUTE: string =
  "/telemetry/rum/session-replay/ingest-status";
const VIEWS_ROUTE: string = "/telemetry/rum/session-replay/views";

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
  let exceptionQuerySpy: jest.SpyInstance;
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

    /*
     * The exception -> replay lookup consults the exception instance
     * table for live sessions before it reads headers. Empty by default;
     * the for-exception suite overrides it where the side index matters.
     */
    exceptionQuerySpy = jest
      .spyOn(ExceptionInstanceService, "executeQuery")
      .mockResolvedValue(fakeResultSet([]) as never);

    SessionReplayReadService.clearActivitySummaryCache();
    SessionReplayReadService.setPublishedRecorderVersionProvider(null);

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
    test("all seven routes are registered and every one carries the three-middleware guard", () => {
      for (const uri of [
        LIST_ROUTE,
        MANIFEST_ROUTE,
        CHUNKS_ROUTE,
        HEARTBEAT_ROUTE,
        VIEWS_ROUTE,
        FOR_EXCEPTION_ROUTE,
        INGEST_STATUS_ROUTE,
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

      for (const uri of [
        MANIFEST_ROUTE,
        CHUNKS_ROUTE,
        HEARTBEAT_ROUTE,
        VIEWS_ROUTE,
      ]) {
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

    test("the chunk query filters on the application resolved from the header", async () => {
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

      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          { chunkIndex: 0, servedPayload: "[1]", isServed: 1 },
        ]) as never,
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

      expect(chunkQuerySpy).toHaveBeenCalledTimes(1);

      const statement: Statement = chunkQuerySpy.mock.calls[0]![0] as Statement;
      expect(statement.query).toContain("rumApplicationId = ");
      expect(Object.values(statement.query_params)).toContain(
        applicationAId.toString(),
      );
      expect(Object.values(statement.query_params)).not.toContain(
        applicationBId.toString(),
      );
    });

    /*
     * A caller-supplied rumApplicationId is a DISAMBIGUATOR: it narrows
     * which header row is read, and the application THAT row names is
     * what gets authorized. Naming an application the session was never
     * recorded under finds no header, so it cannot widen access.
     */
    test("a caller-supplied rumApplicationId only narrows the header read and is authorized on its own merits", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
      });

      mockProps(principal.databaseProps);
      /* No header exists under application B, whatever the body says. */
      headerQuerySpy.mockResolvedValue(fakeResultSet([]) as never);
      mockApplication({ id: applicationAId, labelIds: [] });

      const result: CallResult = await callRoute({
        uri: CHUNKS_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          tabId: "tab-1",
          chunkIndexes: [0],
          rumApplicationId: applicationBId.toString(),
        },
      });

      const headerStatement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;
      expect(headerStatement.query).toContain("rumApplicationId = ");
      expect(Object.values(headerStatement.query_params)).toContain(
        applicationBId.toString(),
      );

      expect(result.thrownToNext).toBeInstanceOf(NotFoundException);
      expect(chunkQuerySpy).not.toHaveBeenCalled();
    });

    test("a malformed disambiguator is a bad request", async () => {
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
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1", rumApplicationId: "nope" },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(headerQuerySpy).not.toHaveBeenCalled();
      expect(recordViewSpy).not.toHaveBeenCalled();
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

    /*
     * Watching implies listing.
     *
     * RumSession's table read ACL contains ReadRumSessionReplayPayload for a
     * reason it states outright: a role granted only the watch permission
     * could fetch payloads - the payload routes authorize on it alone - while
     * being 401'd on the manifest and the list, which is an incoherent grant
     * rather than a safer one. The list guard did not mirror it, so the
     * natural support-engineer role ("Watch Session Replays" + "Read RUM
     * Application") got a permission error on the session list and a silently
     * missing "Watch what the user saw" card on every exception page.
     */
    test("a caller with only the watch permission can still list sessions", async () => {
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

      const result: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      expect(result.deniedWith).toBeUndefined();
      expect(headerQuerySpy).toHaveBeenCalledTimes(1);
    });

    test("a Viewer still cannot list sessions", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.Viewer],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      const result: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      expect(result.deniedWith).toBeInstanceOf(NotAuthorizedException);
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });

    /*
     * The identity filter takes the end-user REFERENCE a person can see in
     * the list, and the server derives the digest with the same per-project
     * HMAC the ingest used. It used to take the digest itself - a value
     * displayed nowhere in the product and computed by no endpoint - so
     * every input a human could plausibly type returned nothing.
     */
    test("an end-user reference is hashed server side before it reaches the query", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        /* Holds the narrower identity permission - see the gate test below. */
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          filters: { identifiedUserRef: "jane@example.com" },
        },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;

      const expectedKey: string = SessionReplayIdentity.buildUserKey({
        projectId: projectId,
        userRef: "jane@example.com",
      });

      const bound: string = JSON.stringify(statement.query_params);

      /* The raw reference must never reach the query. */
      expect(bound).not.toContain("jane@example.com");
      expect(bound).toContain(expectedKey);
    });

    /*
     * The identity FILTER is gated by the same ACL as the identity COLUMN.
     *
     * Without this, a caller deliberately denied the label could still ask
     * "does jane@example.com have sessions here" and read every other field
     * of the answer - a dictionary attack that de-anonymises the list one
     * candidate at a time, and hands back identifiedUserKey as a stable
     * pseudonym to join against the route filter. It only became reachable
     * once the ingest started populating the column; before that the
     * predicate matched nothing whoever asked.
     */
    test("a caller without the identity permission cannot filter by end user", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        /* Can list, deliberately excluded from SESSION_REPLAY_IDENTITY_PERMISSIONS. */
        permissions: [Permission.TelemetryAdmin],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          filters: { identifiedUserRef: "jane@example.com" },
        },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;

      const expectedKey: string = SessionReplayIdentity.buildUserKey({
        projectId: projectId,
        userRef: "jane@example.com",
      });

      /* Neither the reference nor its digest may reach the query. */
      const bound: string = JSON.stringify(statement.query_params);

      expect(bound).not.toContain("jane@example.com");
      expect(bound).not.toContain(expectedKey);

      /*
       * aggIdentifiedUserKey is always a SELECT alias; what must be absent
       * is the HAVING predicate over it.
       */
      expect(statement.query).not.toContain("aggIdentifiedUserKey =");
    });

    /*
     * A filter the server cannot honour must be refused, not dropped. The
     * silent-drop shape returns the WHOLE project's sessions with a 200 and
     * gives the caller no way to tell that the person they asked about was
     * not the one being answered about.
     */
    test("an unusable end-user reference is refused, not silently ignored", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      const result: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          filters: { identifiedUserRef: "z".repeat(4096) },
        },
      });

      expect(result.deniedWith).toBeInstanceOf(BadDataException);
      expect(headerQuerySpy).not.toHaveBeenCalled();
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

    test("the frustration filter is applied SERVER-side, over the argMax aliases", async () => {
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
        body: {
          rumApplicationId: applicationAId.toString(),
          filters: { hasFrustration: true },
        },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;

      /*
       * The old client-side version filtered only the fetched page, so a
       * project whose frustrated sessions sat on page 2 showed an empty
       * list under a label that promised otherwise. The aliases matter
       * too: raw columns would sum across ReplacingMergeTree versions.
       */
      expect(statement.query).toContain(
        "(aggRageClickCount + aggDeadClickCount + aggErrorClickCount + aggRefreshRageCount) > 0",
      );
    });

    /*
     * `false` means "sessions with NO frustration signals" and must be
     * honoured, not dropped. The route admits any boolean and hasError /
     * isFinalized beside it both honour false, so accepting the value and
     * ignoring it returned the whole unfiltered list with a 200 and no
     * indication why. The Dashboard never sends it, so this branch has no
     * producer and this is its only cover.
     */
    test("hasFrustration false selects the clean sessions rather than being dropped", async () => {
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
        body: {
          rumApplicationId: applicationAId.toString(),
          filters: { hasFrustration: false },
        },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;

      expect(statement.query).toContain(
        "(aggRageClickCount + aggDeadClickCount + aggErrorClickCount + aggRefreshRageCount) = 0",
      );
      expect(statement.query).not.toContain(
        "(aggRageClickCount + aggDeadClickCount + aggErrorClickCount + aggRefreshRageCount) > 0",
      );
    });

    function ownerPrincipal(): {
      request: JSONObject;
      databaseProps: DatabaseCommonInteractionProps;
    } {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      return principal;
    }

    test("the new quick filters, url prefix and tags reach the query as HAVING predicates", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = ownerPrincipal();

      await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          filters: {
            hasIdentifiedUser: true,
            isPlayable: true,
            hasTraces: true,
            urlPrefix: "/checkout",
            tags: { build: "1.2.3", ignored: 4 },
          },
        },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;
      const having: string = statement.query.substring(
        statement.query.indexOf("HAVING 1 = 1"),
      );

      expect(having).toContain("aggIdentifiedUserKey != ''");
      expect(having).toContain("aggIsFinalized = 0 OR aggChunkCount > 0");
      expect(having).toContain("aggTraceCount > 0");
      expect(having).toContain("arrayExists(r -> startsWith(r, ");
      expect(having).toContain("mapContains(aggTags, ");

      const bound: Array<unknown> = Object.values(statement.query_params);
      expect(bound).toContain("/checkout");
      expect(bound).toContain("build");
      expect(bound).toContain("1.2.3");
      /* A non-string tag value is not a filter. */
      expect(bound).not.toContain("ignored");
    });

    test("search is bound into the query, and names the label only for an identity-permitted caller", async () => {
      const owner: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = ownerPrincipal();

      await callRoute({
        uri: LIST_ROUTE,
        request: owner.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          startTime: "2026-08-01T00:00:00.000Z",
          endTime: "2026-08-08T00:00:00.000Z",
          filters: { search: "jane" },
        },
      });

      const permitted: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;
      expect(permitted.query).toContain(
        "positionCaseInsensitiveUTF8(aggIdentifiedUserLabel, ",
      );
      expect(permitted.query).not.toContain("'jane'");
      expect(Object.values(permitted.query_params)).toContain("jane");

      jest.clearAllMocks();

      const telemetryAdmin: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.TelemetryAdmin],
      });

      mockProps(telemetryAdmin.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      await callRoute({
        uri: LIST_ROUTE,
        request: telemetryAdmin.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          startTime: "2026-08-01T00:00:00.000Z",
          endTime: "2026-08-08T00:00:00.000Z",
          filters: { search: "jane" },
        },
      });

      const gated: Statement = headerQuerySpy.mock.calls[0]![0] as Statement;
      expect(gated.query).toContain("startsWith(sessionId, ");
      expect(gated.query).not.toContain("identifiedUserLabel");
    });

    test("a search longer than the cap is refused before any query", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = ownerPrincipal();

      const result: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          filters: {
            search: "x".repeat(SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH + 1),
          },
        },
      });

      expect(result.deniedWith).toBeInstanceOf(BadDataException);
      expect(result.deniedWith?.message).toContain(
        `${SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH}`,
      );
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });

    test("a search over a window wider than the cap says to narrow the range, distinctly", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = ownerPrincipal();

      const endTime: Date = new Date("2026-08-08T00:00:00.000Z");
      const startTime: Date = new Date(
        endTime.getTime() -
          (SESSION_REPLAY_LIST_SEARCH_MAX_WINDOW_DAYS + 1) *
            24 *
            60 *
            60 *
            1000,
      );

      const result: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          filters: { search: "acme" },
        },
      });

      expect(result.deniedWith).toBeInstanceOf(BadDataException);
      expect(result.deniedWith?.message).toMatch(/narrow the range/i);
      expect(result.deniedWith?.message).toContain(
        `${SESSION_REPLAY_LIST_SEARCH_MAX_WINDOW_DAYS} days`,
      );
      expect(headerQuerySpy).not.toHaveBeenCalled();

      /* The same window WITHOUT a search is fine. */
      jest.clearAllMocks();
      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      const unsearched: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        },
      });

      expect(unsearched.deniedWith).toBeUndefined();
      expect(headerQuerySpy).toHaveBeenCalledTimes(1);
    });

    test("an unknown sortBy is a bad request", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = ownerPrincipal();

      const result: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          sortBy: "payloadBytes",
        },
      });

      expect(result.deniedWith).toBeInstanceOf(BadDataException);
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });

    test("sortBy orders the query and the next cursor carries the sort key", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = ownerPrincipal();

      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          { sessionId: "a", aggErrorCount: 9, aggStartTime: 3 },
          { sessionId: "b", aggErrorCount: 4, aggStartTime: 2 },
        ]) as never,
      );

      const result: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          sortBy: "errorCount",
          limit: 1,
        },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;
      expect(statement.query).toContain(
        "ORDER BY aggErrorCount DESC, sessionId DESC",
      );

      expect((result.jsonBody as JSONObject)["nextCursor"]).toEqual({
        sortBy: "errorCount",
        sortValue: 9,
        sessionId: "a",
      });
    });

    test("the newest-first list still emits and accepts the legacy cursor shape", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = ownerPrincipal();

      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          { sessionId: "a", aggStartTime: 1700000002000 },
          { sessionId: "b", aggStartTime: 1700000001000 },
        ]) as never,
      );

      const firstPage: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString(), limit: 1 },
      });

      expect((firstPage.jsonBody as JSONObject)["nextCursor"]).toEqual({
        startTimeUnixMs: 1700000002000,
        sessionId: "a",
      });

      jest.clearAllMocks();
      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          limit: 1,
          cursor: { startTimeUnixMs: 1700000002000, sessionId: "a" },
        },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;
      expect(statement.query).toMatch(
        /AND \(aggStartTime < \{p\d+:Double\} OR \(aggStartTime = \{p\d+:Double\} AND sessionId < \{p\d+:String\}\)\)/,
      );
      expect(Object.values(statement.query_params)).toContain("a");
    });

    test("a cursor from another ordering, or a malformed one, is refused", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = ownerPrincipal();

      const mismatched: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          sortBy: "durationMs",
          cursor: { sortBy: "errorCount", sortValue: 3, sessionId: "a" },
        },
      });

      expect(mismatched.thrownToNext).toBeInstanceOf(BadDataException);

      jest.clearAllMocks();
      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      const malformed: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          cursor: { nonsense: true },
        },
      });

      expect(malformed.deniedWith).toBeInstanceOf(BadDataException);
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });

    test.each([2.5, 0, -1, "20"])(
      "limit %p is a bad request rather than a ClickHouse error",
      async (limit: unknown) => {
        const principal: {
          request: JSONObject;
          databaseProps: DatabaseCommonInteractionProps;
        } = ownerPrincipal();

        const result: CallResult = await callRoute({
          uri: LIST_ROUTE,
          request: principal.request,
          body: {
            rumApplicationId: applicationAId.toString(),
            limit: limit as number,
          },
        });

        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expect((result.thrownToNext as Exception).message).toContain("limit");
        expect(headerQuerySpy).not.toHaveBeenCalled();
      },
    );

    test("an unparseable startTime, or a window that ends before it starts, is a bad request", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = ownerPrincipal();

      const garbage: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          startTime: "yesterday-ish",
        },
      });

      expect(garbage.thrownToNext).toBeInstanceOf(BadDataException);
      expect(headerQuerySpy).not.toHaveBeenCalled();

      jest.clearAllMocks();
      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [] });

      const inverted: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: {
          rumApplicationId: applicationAId.toString(),
          startTime: "2026-08-08T00:00:00.000Z",
          endTime: "2026-08-01T00:00:00.000Z",
        },
      });

      expect(inverted.deniedWith).toBeInstanceOf(BadDataException);
      expect(inverted.deniedWith?.message).toContain("startTime");
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });

    test("projects the new list columns, with traits only for an identity-permitted caller", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = ownerPrincipal();

      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            sessionId: "a",
            applicationId: applicationAId.toString(),
            aggStartTime: 1700000000000,
            aggEndTime: 1700000090000,
            aggRoutes: ["/a", "/b"],
            aggTraceCount: 2,
            aggExceptionGroupCount: 1,
            aggClickCount: 12,
            aggActiveMs: 50000,
            aggFirstErrorOffsetMs: 3000,
            aggExpiresAt: 1700604800000,
            aggTags: { env: "prod" },
            aggIdentifiedUserLabel: "jane@example.com",
            aggIdentifiedUserTraits: { plan: "pro" },
          },
        ]) as never,
      );

      const result: CallResult = await callRoute({
        uri: LIST_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      const sessions: Array<JSONObject> = (result.jsonBody as JSONObject)[
        "sessions"
      ] as unknown as Array<JSONObject>;
      const row: JSONObject = sessions[0]!;

      expect(row["routes"]).toEqual(["/a", "/b"]);
      expect(row["traceCount"]).toBe(2);
      expect(row["exceptionGroupCount"]).toBe(1);
      expect(row["clickCount"]).toBe(12);
      expect(row["activeMs"]).toBe(50000);
      expect(row["firstErrorOffsetMs"]).toBe(3000);
      expect(row["expiresAtUnixMs"]).toBe(1700604800000);
      expect(row["tags"]).toEqual({ env: "prod" });
      expect(row["startTimeUnixMs"]).toBe(1700000000000);
      expect(row["endTimeUnixMs"]).toBe(1700000090000);
      expect(row["identifiedUserLabel"]).toBe("jane@example.com");
      expect(row["identifiedUserTraits"]).toEqual({ plan: "pro" });
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
            errorCount: 2,
            rageClickCount: 1,
            deadClickCount: 4,
            errorClickCount: 6,
            refreshRageCount: 5,
            routeCount: 3,
          },
          {
            tabId: "tab-1",
            chunkIndex: 3,
            chunkStartOffsetMs: 45000,
            chunkEndOffsetMs: 60000,
            eventCount: 100,
            hasFullSnapshot: false,
            chunkPayloadBytes: 1024,
            errorCount: 0,
            rageClickCount: 0,
            deadClickCount: 0,
            errorClickCount: 0,
            refreshRageCount: 0,
            routeCount: 0,
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

      /*
       * The signal counters must be projected: the player's error,
       * frustration and route timeline lanes and the "next error" jump are
       * fed exclusively by these per-chunk columns. Dropping one from the
       * SELECT silently blanks a lane — it parses as 0 client-side.
       */
      for (const counterColumn of [
        "errorCount",
        "rageClickCount",
        "deadClickCount",
        "errorClickCount",
        "refreshRageCount",
        "routeCount",
      ]) {
        expect(statement.query).toContain(counterColumn);
      }

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
       * Every counter gets a DISTINCT nonzero value, asserted individually:
       * the client parses missing keys to 0, so a counter dropped from the
       * SELECT (or two counters cross-wired in the row mapping) fails
       * loudly here instead of silently blanking a timeline lane.
       */
      const manifestChunks: Array<JSONObject> = tabs[0]![
        "chunks"
      ] as unknown as Array<JSONObject>;
      expect(manifestChunks[0]!["errorCount"]).toBe(2);
      expect(manifestChunks[0]!["rageClickCount"]).toBe(1);
      expect(manifestChunks[0]!["deadClickCount"]).toBe(4);
      expect(manifestChunks[0]!["errorClickCount"]).toBe(6);
      expect(manifestChunks[0]!["refreshRageCount"]).toBe(5);
      expect(manifestChunks[0]!["routeCount"]).toBe(3);
      expect(manifestChunks[1]!["errorCount"]).toBe(0);

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

      expect(result.thrownToNext).toBeInstanceOf(NotFoundException);
      expect((result.thrownToNext as Exception).message).toMatch(/^not-found:/);
      expect(recordViewSpy).not.toHaveBeenCalled();
    });

    /*
     * A link from an incident a week later must say "expired on <date>",
     * not "not found": the two need different actions from the reader.
     * The retention-filtered header read finds nothing, so a second read
     * without the filter answers when the row aged out - and only dates
     * and the application id, never a row's content.
     */
    test("an expired session is a distinguishable 404 that names the expiry", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);
      headerQuerySpy
        .mockResolvedValueOnce(fakeResultSet([]) as never)
        .mockResolvedValueOnce(
          fakeResultSet([
            {
              applicationId: applicationAId.toString(),
              expiresAtUnixMs: Date.UTC(2026, 7, 8),
              startTimeUnixMs: Date.UTC(2026, 7, 1),
            },
          ]) as never,
        );

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-old" },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotFoundException);
      const message: string = (result.thrownToNext as Exception).message;
      expect(message).toMatch(/^expired:/);
      expect(message).toContain("2026-08-08");
      expect(message).toContain("7-day retention");

      const expiryStatement: Statement = headerQuerySpy.mock
        .calls[1]![0] as Statement;
      expect(expiryStatement.query).not.toContain("retentionDate >= now()");
      expect(recordViewSpy).not.toHaveBeenCalled();
    });

    test("projects the clock, expiry, tags and engagement counters on the header, and the per-tab first offset", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.TelemetryAdmin],
      });

      mockProps(principal.databaseProps);
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            ...buildHeaderRow({
              sessionId: "session-1",
              projectId: projectId,
              rumApplicationId: applicationAId,
            }),
            aggClientReportedStart: 1699999999500,
            aggTags: { build: "1.2.3" },
            aggExpiresAt: 1700604800000,
            aggClickCount: 41,
            aggCustomEventCount: 3,
            aggActiveMs: 36000,
            aggFirstErrorOffsetMs: 12000,
            aggAttributes: { "recorder.capabilities": "click-events,tags" },
          },
        ]) as never,
      );
      mockApplication({ id: applicationAId, labelIds: [] });
      mockRecordedView();

      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            tabId: "tab-2",
            chunkIndex: 0,
            chunkStartOffsetMs: 134000,
            chunkEndOffsetMs: 150000,
            eventCount: 10,
            hasFullSnapshot: 1,
            chunkPayloadBytes: 10,
            clickCount: 2,
            url: "https://example.com/help",
          },
        ]) as never,
      );

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      const body: JSONObject = result.jsonBody as JSONObject;
      const header: JSONObject = body["header"] as JSONObject;

      expect(header["startTimeUnixMs"]).toBe(1700000000000);
      expect(header["endTimeUnixMs"]).toBe(1700000060000);
      expect(header["clientReportedStartUnixMs"]).toBe(1699999999500);
      expect(header["tags"]).toEqual({ build: "1.2.3" });
      expect(header["expiresAtUnixMs"]).toBe(1700604800000);
      expect(header["clickCount"]).toBe(41);
      expect(header["customEventCount"]).toBe(3);
      expect(header["activeMs"]).toBe(36000);
      expect(header["firstErrorOffsetMs"]).toBe(12000);
      expect(header["recorderCapabilities"]).toEqual(["click-events", "tags"]);

      const tabs: Array<JSONObject> = body[
        "tabs"
      ] as unknown as Array<JSONObject>;
      expect(tabs[0]!["firstChunkStartOffsetMs"]).toBe(134000);
      const chunks: Array<JSONObject> = tabs[0]![
        "chunks"
      ] as unknown as Array<JSONObject>;
      expect(chunks[0]!["clickCount"]).toBe(2);
      expect(chunks[0]!["url"]).toBe("https://example.com/help");
    });

    /*
     * The identity columns carry the narrowest ACL in the schema. A
     * TelemetryAdmin can watch a recording but is deliberately excluded
     * from SESSION_REPLAY_IDENTITY_PERMISSIONS, so no statement issued on
     * their behalf may even NAME identifiedUserLabel or the traits map.
     */
    test("omits identifiedUserLabel and traits, and never names them, without the identity permission", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.TelemetryAdmin],
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

      for (const call of headerQuerySpy.mock.calls) {
        const statement: Statement = call[0] as Statement;
        expect(statement.query).not.toContain("identifiedUserLabel");
        expect(statement.query).not.toContain("identifiedUserTraits");
      }

      const header: JSONObject = (result.jsonBody as JSONObject)[
        "header"
      ] as JSONObject;
      expect(header["identifiedUserLabel"]).toBeUndefined();
      expect(header["identifiedUserTraits"]).toBeUndefined();
    });

    test("includes identifiedUserLabel and traits, read by a separate application-pinned statement, with the identity permission", async () => {
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
      headerQuerySpy.mockImplementation(async (statement: Statement) => {
        if (statement.query.includes("identifiedUserTraits")) {
          return fakeResultSet([
            {
              aggIdentifiedUserLabel: "jane@example.com",
              aggIdentifiedUserTraits: { plan: "pro" },
            },
          ]);
        }

        return fakeResultSet([
          buildHeaderRow({
            sessionId: "session-1",
            projectId: projectId,
            rumApplicationId: applicationAId,
          }),
        ]);
      });
      mockApplication({ id: applicationAId, labelIds: [labelAId] });
      mockRecordedView();

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      const identityStatements: Array<Statement> = headerQuerySpy.mock.calls
        .map((call: Array<unknown>): Statement => {
          return call[0] as Statement;
        })
        .filter((statement: Statement): boolean => {
          return statement.query.includes("identifiedUserLabel");
        });

      expect(identityStatements).toHaveLength(1);
      expect(identityStatements[0]!.query).toContain(
        "argMax(identifiedUserTraits, version) AS aggIdentifiedUserTraits",
      );
      expect(identityStatements[0]!.query).toContain("rumApplicationId = ");
      expect(Object.values(identityStatements[0]!.query_params)).toContain(
        applicationAId.toString(),
      );

      /* The header read itself still never names them. */
      const headerStatement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;
      expect(headerStatement.query).not.toContain("identifiedUserLabel");

      const header: JSONObject = (result.jsonBody as JSONObject)[
        "header"
      ] as JSONObject;
      expect(header["identifiedUserLabel"]).toBe("jane@example.com");
      expect(header["identifiedUserTraits"]).toEqual({ plan: "pro" });
    });

    test("omits the identity columns when the identity grant is scoped to a different application", async () => {
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
      /* B carries label A too so the payload read is allowed... */
      mockApplication({ id: applicationBId, labelIds: [labelAId] });
      mockRecordedView();

      const allowed: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });
      expect(allowed.thrownToNext).toBeUndefined();

      /* ...whereas with only a foreign label the whole read is refused. */
      jest.clearAllMocks();
      mockProps(principal.databaseProps);
      mockSessionHeader(applicationBId);
      mockApplication({ id: applicationBId, labelIds: [labelBId] });

      const refused: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      expect(refused.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      for (const call of headerQuerySpy.mock.calls) {
        expect((call[0] as Statement).query).not.toContain(
          "identifiedUserLabel",
        );
      }
    });

    /*
     * Live polling. The player re-fetches the manifest every 30s while a
     * session is recording; each poll is the same viewing, and one audit
     * row per VIEW is the contract the E2E pins.
     */
    test("isRefresh with the caller's own viewId for this session skips the audit write and echoes the id", async () => {
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

      const viewId: ObjectID = ObjectID.generate();
      mockOwnView({ viewId: viewId, rumApplicationId: applicationAId });

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          isRefresh: true,
          viewId: viewId.toString(),
        },
      });

      expect(recordViewSpy).not.toHaveBeenCalled();
      expect((result.jsonBody as JSONObject)["viewId"]).toBe(viewId.toString());

      /* Ownership AND the session are in the lookup's own predicate. */
      const lookupArgs: JSONObject = viewFindOneBySpy.mock
        .calls[0]![0] as JSONObject;
      const query: JSONObject = lookupArgs["query"] as JSONObject;
      expect((query["viewedByUserId"] as ObjectID).toString()).toBe(
        userId.toString(),
      );
      expect(query["sessionId"]).toBe("session-1");
      expect(query["_id"]).toBe(viewId.toString());
    });

    test("isRefresh with a viewId that is not the caller's own for this session records a fresh view", async () => {
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
      const freshViewId: ObjectID = mockRecordedView();

      /* The row is somebody else's, or for another session: no match. */
      viewFindOneBySpy.mockResolvedValue(null);

      const result: CallResult = await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          isRefresh: true,
          viewId: ObjectID.generate().toString(),
        },
      });

      expect(recordViewSpy).toHaveBeenCalledTimes(1);
      expect((result.jsonBody as JSONObject)["viewId"]).toBe(
        freshViewId.toString(),
      );
    });

    test("isRefresh with a view row for a different application than the one authorized records a fresh view", async () => {
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

      const viewId: ObjectID = ObjectID.generate();
      mockOwnView({ viewId: viewId, rumApplicationId: applicationBId });

      await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          isRefresh: true,
          viewId: viewId.toString(),
        },
      });

      expect(recordViewSpy).toHaveBeenCalledTimes(1);
    });

    test("a malformed linkedIncidentId is dropped from the audit row rather than failing the read", async () => {
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

      const incidentId: ObjectID = ObjectID.generate();

      await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          linkedIncidentId: "not-a-uuid",
          linkedExceptionFingerprint: "fp-1",
        },
      });

      const dropped: JSONObject = recordViewSpy.mock.calls[0]![0] as JSONObject;
      expect(dropped["linkedIncidentId"]).toBeUndefined();
      expect(dropped["linkedExceptionFingerprint"]).toBe("fp-1");

      jest.clearAllMocks();
      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });
      mockRecordedView();

      await callRoute({
        uri: MANIFEST_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          linkedIncidentId: incidentId.toString(),
        },
      });

      const kept: JSONObject = recordViewSpy.mock.calls[0]![0] as JSONObject;
      expect((kept["linkedIncidentId"] as ObjectID).toString()).toBe(
        incidentId.toString(),
      );
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

    /*
     * The cap has to bound the bytes this endpoint actually returns.
     * `payloadBytes` is the POST-GZIP wire size the recorder uploaded,
     * while the `payload` column holds the DECOMPRESSED JSON that is
     * served. Measuring the former let 8 chunks that pass a 8 MiB check
     * decompress into tens of megabytes of response. It is measured in
     * the SAME statement that ships the bytes, so the column is
     * decompressed once per page rather than once for a pre-check and
     * again for the read.
     */
    test("measures the stored (decompressed) size in the one statement that ships the bytes", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = payloadPrincipal();

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          { chunkIndex: 0, servedPayload: "[1]", isServed: 1 },
        ]) as never,
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

      expect(chunkQuerySpy).toHaveBeenCalledTimes(1);

      const statement: Statement = chunkQuerySpy.mock.calls[0]![0] as Statement;

      expect(statement.query).toContain("length(payload)");
      expect(statement.query).not.toContain("toFloat64(payloadBytes)");
    });

    /*
     * A page that does not fit is answered with the prefix that does -
     * never with a refusal. The old 400 ("Request fewer chunks") was
     * reachable by the player's own page plan, because it plans against
     * the wire size the manifest exposes while the cap is on decompressed
     * bytes, and the player had no recovery for it.
     */
    test("serves the prefix of whole chunks that fits, names the rest, and never refuses", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = payloadPrincipal();

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      const fatPayload: string = "a".repeat(5 * 1024 * 1024);

      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          { chunkIndex: 0, servedPayload: fatPayload, isServed: 1 },
          { chunkIndex: 1, servedPayload: fatPayload, isServed: 1 },
          { chunkIndex: 2, servedPayload: "", isServed: 0 },
        ]) as never,
      );

      const result: CallResult = await callRoute({
        uri: CHUNKS_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          tabId: "tab-1",
          chunkIndexes: [0, 1, 2],
        },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.deniedWith).toBeUndefined();

      const buffer: Buffer = result.sentBuffer as unknown as Buffer;
      expect(buffer.readUInt32LE(0)).toBe(0);
      expect(buffer.readUInt32LE(4)).toBe(fatPayload.length);
      expect(buffer.length).toBe(8 + fatPayload.length);
      expect(result.headers["X-OneUptime-Replay-Omitted-Chunks"]).toBe("1,2");
    });

    /*
     * A full snapshot between (cap - 8 bytes) and the cap - or one that
     * re-serialised slightly larger than the ingest inflate cap - used
     * to fail EVERY fetch, so playback of that tab dead-ended at it. A
     * lone chunk is bounded by the ingest cap already.
     */
    test("a single chunk at or over the read cap is still served", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = payloadPrincipal();

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      const edgePayload: string = "a".repeat(8 * 1024 * 1024);

      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          { chunkIndex: 0, servedPayload: edgePayload, isServed: 1 },
        ]) as never,
      );

      const result: CallResult = await callRoute({
        uri: CHUNKS_ROUTE,
        request: principal.request,
        body: {
          sessionId: "session-1",
          tabId: "tab-1",
          chunkIndexes: [0],
        },
      });

      expect(result.thrownToNext).toBeUndefined();
      const buffer: Buffer = result.sentBuffer as unknown as Buffer;
      expect(buffer.length).toBe(8 + edgePayload.length);
      expect(
        result.headers["X-OneUptime-Replay-Omitted-Chunks"],
      ).toBeUndefined();
    });

    /*
     * A 480-chunk session is 60 chunk pages. Each used to re-run the
     * header GROUP BY and re-load the application's labels; now the
     * chunk route serves both from a 30s cache the manifest refreshes.
     * The label DECISION is still made per request against the caller's
     * permissions.
     */
    test("consecutive chunk pages reuse the resolved header and application", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = payloadPrincipal();

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          { chunkIndex: 0, servedPayload: "[1]", isServed: 1 },
        ]) as never,
      );

      for (const chunkIndex of [0, 1, 2]) {
        await callRoute({
          uri: CHUNKS_ROUTE,
          request: principal.request,
          body: {
            sessionId: "session-1",
            tabId: "tab-1",
            chunkIndexes: [chunkIndex],
          },
        });
      }

      expect(chunkQuerySpy).toHaveBeenCalledTimes(3);
      expect(headerQuerySpy).toHaveBeenCalledTimes(1);
      expect(findOneBySpy).toHaveBeenCalledTimes(1);

      /*
       * A revoked grant takes effect on the very next page: the cached
       * data is re-checked against the caller's current permissions.
       */
      const viewer: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplayPayload],
        labelIds: [labelBId],
      });

      mockProps(viewer.databaseProps);

      const refused: CallResult = await callRoute({
        uri: CHUNKS_ROUTE,
        request: viewer.request,
        body: {
          sessionId: "session-1",
          tabId: "tab-1",
          chunkIndexes: [3],
        },
      });

      expect(refused.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(chunkQuerySpy).toHaveBeenCalledTimes(3);
    });

    test("returns length-prefixed binary frames and de-duplicates by version", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = payloadPrincipal();

      mockProps(principal.databaseProps);
      mockSessionHeader(applicationAId);
      mockApplication({ id: applicationAId, labelIds: [] });

      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          { chunkIndex: 0, servedPayload: "[1]", isServed: 1 },
          { chunkIndex: 1, servedPayload: "[22]", isServed: 1 },
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
        .calls[0]![0] as Statement;
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

    /*
     * secondsWatched is time WATCHED, cumulative and monotonic. The one
     * ownership lookup also carries the row's current figure, so the
     * service is told what it already holds and a heartbeat that does not
     * advance costs no write; the response echoes the figure on record.
     */
    test("hands the service the row's current figure and never reports a lower one", async () => {
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
      const view: RumSessionReplayView = new RumSessionReplayView();
      view.id = viewId;
      view.projectId = projectId;
      view.rumApplicationId = applicationAId;
      view.viewedByUserId = userId;
      view.secondsWatched = 90;
      viewFindOneBySpy.mockResolvedValue(view);

      const result: CallResult = await callRoute({
        uri: HEARTBEAT_ROUTE,
        request: principal.request,
        body: { viewId: viewId.toString(), secondsWatched: 44 },
      });

      const args: JSONObject = recordSecondsWatchedSpy.mock
        .calls[0]![0] as JSONObject;
      expect(args["secondsWatched"]).toBe(30);
      expect(args["currentSecondsWatched"]).toBe(90);
      expect((result.jsonBody as JSONObject)["secondsWatched"]).toBe(90);

      /* The lookup selects the figure so no second read is needed. */
      const lookupArgs: JSONObject = viewFindOneBySpy.mock
        .calls[0]![0] as JSONObject;
      expect((lookupArgs["select"] as JSONObject)["secondsWatched"]).toBe(true);
    });
  });

  describe("views", () => {
    test("lists who watched, pinned to the authorized application, for a payload-permitted caller", async () => {
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

      const view: RumSessionReplayView = new RumSessionReplayView();
      view.id = ObjectID.generate();
      view.viewedAt = new Date("2026-08-01T10:00:00.000Z");
      view.secondsWatched = 45;
      view.accessReason = "incident triage";
      view.viewedByUserId = userId;

      const getViewsSpy: jest.SpyInstance = jest
        .spyOn(RumSessionReplayViewService, "getViewsForSession")
        .mockResolvedValue([view]);

      const result: CallResult = await callRoute({
        uri: VIEWS_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      const args: JSONObject = getViewsSpy.mock.calls[0]![0] as JSONObject;
      expect((args["rumApplicationId"] as ObjectID).toString()).toBe(
        applicationAId.toString(),
      );
      expect(args["sessionId"]).toBe("session-1");

      const views: Array<JSONObject> = (result.jsonBody as JSONObject)[
        "views"
      ] as unknown as Array<JSONObject>;
      expect(views).toHaveLength(1);
      expect(views[0]!["secondsWatched"]).toBe(45);
      expect(views[0]!["accessReason"]).toBe("incident triage");
      expect(views[0]!["viewedAt"]).toBe("2026-08-01T10:00:00.000Z");
      expect(views[0]!["viewedByUserId"]).toBe(userId.toString());
      /* Listing who watched is not itself a view. */
      expect(recordViewSpy).not.toHaveBeenCalled();
    });

    test("a caller with only the list permission cannot see who watched", async () => {
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
        uri: VIEWS_ROUTE,
        request: principal.request,
        body: { sessionId: "session-1" },
      });

      expect(result.deniedWith).toBeInstanceOf(NotAuthorizedException);
      expect(headerQuerySpy).not.toHaveBeenCalled();
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

    test("projects the frustration counters and masking mode the replay card renders", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);

      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            sessionId: "session-9",
            applicationId: applicationAId.toString(),
            aggStartTime: "2026-07-30 10:00:00.000",
            aggEndTime: "2026-07-30 10:01:00.000",
            aggDurationMs: 60000,
            aggHasError: 1,
            aggErrorCount: 2,
            aggRageClickCount: 3,
            aggDeadClickCount: 4,
            aggErrorClickCount: 6,
            aggRefreshRageCount: 5,
            aggMaskingMode: "MaskAllText",
            aggTriggerReason: "error",
            aggEntryUrl: "https://shop.example.com/checkout",
            aggBrowserName: "Chrome",
            aggOsName: "macOS",
            aggDeviceType: "desktop",
            aggIsFinalized: 1,
          },
        ]) as never,
      );

      const result: CallResult = await callRoute({
        uri: FOR_EXCEPTION_ROUTE,
        request: principal.request,
        body: { fingerprint: "fp-1" },
      });

      /*
       * The card's signals line ("3 rage clicks before the error") and its
       * up-front masking disclosure are fed exclusively by these aliases.
       * The client parses a missing key to 0/"", so dropping one from the
       * SELECT silently degrades the card — it must fail here instead.
       */
      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;

      for (const alias of [
        "aggRageClickCount",
        "aggDeadClickCount",
        "aggErrorClickCount",
        "aggRefreshRageCount",
        "aggMaskingMode",
      ]) {
        expect(statement.query).toContain(alias);
      }

      const sessions: Array<JSONObject> = result.jsonBody?.[
        "sessions"
      ] as unknown as Array<JSONObject>;

      expect(sessions).toHaveLength(1);
      expect(sessions[0]!["rumApplicationId"]).toBe(applicationAId.toString());
      expect(sessions[0]!["rageClickCount"]).toBe(3);
      expect(sessions[0]!["deadClickCount"]).toBe(4);
      expect(sessions[0]!["errorClickCount"]).toBe(6);
      expect(sessions[0]!["refreshRageCount"]).toBe(5);
      expect(sessions[0]!["maskingMode"]).toBe("MaskAllText");
    });

    /*
     * RumSession is partitioned by day. Without a window the lookup
     * scanned every partition the project ever wrote, on every exception
     * page load; a 30-day default covers every retention tier a recording
     * can still be played under.
     */
    test("applies a default window when the caller gives none", async () => {
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
      expect(statement.query).toContain("startTime >= ");
      expect(statement.query).toContain("startTime <= ");
    });

    test("derives the window from the error's own time when the caller sends it", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);

      const errorTimeUnixMs: number = Date.UTC(2026, 7, 5, 12, 0, 0);

      await callRoute({
        uri: FOR_EXCEPTION_ROUTE,
        request: principal.request,
        body: { fingerprint: "fp-1", errorTimeUnixMs: errorTimeUnixMs },
      });

      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;
      const bound: Array<unknown> = Object.values(statement.query_params);

      /*
       * The bound DateTime64 strings carry the window: the start sits one
       * maximum session length (plus padding) before the error.
       */
      const earliestStart: Date = new Date(
        errorTimeUnixMs - SESSION_REPLAY_MAX_SESSION_MS - 5 * 60 * 1000,
      );
      const boundStrings: Array<string> = bound.filter(
        (value: unknown): value is string => {
          return typeof value === "string";
        },
      );
      expect(
        boundStrings.some((value: string): boolean => {
          return value.startsWith(
            earliestStart.toISOString().substring(0, 19).replace("T", " "),
          );
        }),
      ).toBe(true);
    });

    /*
     * The header's fingerprint list is written by the finalizer, 10+
     * minutes after the session goes quiet - which is the whole incident
     * from the reporter's point of view. The exception instance table
     * knows the session id from the moment the error is ingested, so a
     * live session is found through it.
     */
    test("finds a live session through the exception instances before the finalizer has run", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);
      exceptionQuerySpy.mockResolvedValue(
        fakeResultSet([{ sessionId: "live-session" }]) as never,
      );

      await callRoute({
        uri: FOR_EXCEPTION_ROUTE,
        request: principal.request,
        body: { fingerprint: "fp-1" },
      });

      const instanceStatement: Statement = exceptionQuerySpy.mock
        .calls[0]![0] as Statement;
      expect(instanceStatement.query).toContain("fingerprint = ");
      expect(instanceStatement.query).toContain("sessionId != ''");

      const headerStatement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;
      expect(headerStatement.query).toContain("OR sessionId IN (");
      expect(Object.values(headerStatement.query_params)).toContainEqual([
        "live-session",
      ]);
    });

    test("a pinned sessionId and a non-integer limit are handled before the query", async () => {
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
        body: { fingerprint: "fp-1", sessionId: "s-9" },
      });

      expect(exceptionQuerySpy).not.toHaveBeenCalled();
      const statement: Statement = headerQuerySpy.mock
        .calls[0]![0] as Statement;
      expect(statement.query).toContain("AND sessionId = ");
      expect(Object.values(statement.query_params)).toContain("s-9");

      jest.clearAllMocks();
      mockProps(principal.databaseProps);

      const bad: CallResult = await callRoute({
        uri: FOR_EXCEPTION_ROUTE,
        request: principal.request,
        body: { fingerprint: "fp-1", limit: 2.5 },
      });

      expect(bad.thrownToNext).toBeInstanceOf(BadDataException);
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });
  });

  describe("ingest-status", () => {
    function mockConfiguredApplication(): void {
      const application: RumApplication = new RumApplication();
      application.id = applicationAId;
      application.projectId = projectId;
      application.labels = [];
      application.appIdentifier = "checkout-web";
      application.isSessionReplayEnabled = true;
      application.sessionReplayAllowedOrigins = ["https://shop.example.com"];
      application.sessionReplaySamplePercentage = 25;
      application.sessionReplayMonthlyBudgetInGB = 2;

      findOneBySpy.mockResolvedValue(application);
      findBySpy.mockResolvedValue([application]);
    }

    function mockProject(isAllowed: boolean): void {
      const project: Project = new Project();
      project.id = projectId;
      project.isSessionReplayAllowed = isAllowed;

      jest.spyOn(ProjectService, "findOneBy").mockResolvedValue(project);
    }

    test("a label-scoped caller whose labels do not reach the application is refused before any disclosure", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ReadRumSessionReplay],
        labelIds: [labelBId],
      });

      mockProps(principal.databaseProps);
      mockApplication({ id: applicationAId, labelIds: [labelAId] });
      mockProject(true);

      const result: CallResult = await callRoute({
        uri: INGEST_STATUS_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(result.jsonBody).toBeUndefined();
    });

    test("an application outside this tenant is refused identically to a missing one", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);
      findOneBySpy.mockResolvedValue(null);
      mockProject(true);

      const result: CallResult = await callRoute({
        uri: INGEST_STATUS_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(result.jsonBody).toBeUndefined();
    });

    test("returns the switches, health timestamps and budget figures the panel renders", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);
      mockConfiguredApplication();
      mockProject(true);

      const result: CallResult = await callRoute({
        uri: INGEST_STATUS_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      const body: JSONObject = result.jsonBody as JSONObject;

      expect(body["isProjectAllowed"]).toBe(true);
      expect(body["isApplicationEnabled"]).toBe(true);
      expect(body["appIdentifier"]).toBe("checkout-web");
      expect(body["allowedOrigins"]).toEqual(["https://shop.example.com"]);
      expect(body["samplePercentage"]).toBe(25);
      expect(body["monthlyBudgetInGB"]).toBe(2);
      expect(body["lastChunkReceivedAt"]).toBeNull();
      expect(body["budgetExceededAt"]).toBeNull();
      /*
       * Jest runs without Redis, so the usage readers answer null —
       * "unknown", which the panel must render as unknown, never as 0.
       * The daily limit is config, not a counter, so it is always known.
       */
      expect(body["projectBytesUsedToday"]).toBeNull();
      expect(body["applicationBytesUsedThisMonth"]).toBeNull();
      expect(body["dailyByteLimit"]).toBeGreaterThan(0);
    });

    /*
     * The full RecordingHealthStatus. Every counter that could not be
     * read is null - the diagnosis renders "unknown" - and every
     * timestamp is ISO or null. Jest runs without Redis, so the refusal
     * and drop counters are the null case here; the activity summary is
     * ClickHouse and is mocked.
     */
    test("carries the policy, liveness stamps and activity summary, with unreadable counters as null", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);

      const application: RumApplication = new RumApplication();
      application.id = applicationAId;
      application.projectId = projectId;
      application.labels = [];
      application.appIdentifier = "checkout-web";
      application.isSessionReplayEnabled = true;
      application.sessionReplayAllowedOrigins = [];
      application.sessionReplaySamplePercentage = 100;
      application.sessionReplayRetentionInDays = 14;
      application.lastSeenAt = new Date("2026-08-05T09:14:00.000Z");
      (application as unknown as JSONObject)["sessionReplayConsentMode"] =
        "NotRequired";
      (application as unknown as JSONObject)["sessionReplayMaskingMode"] =
        "MaskAllText";
      findOneBySpy.mockResolvedValue(application);
      mockProject(true);

      headerQuerySpy
        .mockResolvedValueOnce(
          fakeResultSet([{ sessionCount: 143, unplayableCount: 3 }]) as never,
        )
        .mockResolvedValueOnce(
          fakeResultSet([
            { lastStartUnixMs: Date.UTC(2026, 7, 5, 9, 0) },
          ]) as never,
        );

      const result: CallResult = await callRoute({
        uri: INGEST_STATUS_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      const body: JSONObject = result.jsonBody as JSONObject;

      expect(body["consentMode"]).toBe("NotRequired");
      expect(body["maskingMode"]).toBe("MaskAllText");
      expect(body["retentionInDays"]).toBe(14);
      expect(body["lastConfigFetchAt"]).toBe("2026-08-05T09:14:00.000Z");
      expect(body["lastSessionStartedAt"]).toBe("2026-08-05T09:00:00.000Z");
      expect(body["sessionsLast24h"]).toBe(143);
      expect(body["playableSessionsLast24h"]).toBe(140);
      /* No recorder manifest reader registered, no Redis: unknown, not 0. */
      expect(body["publishedRecorderVersion"]).toBeNull();
      expect(body["refusalsLast24h"]).toBeNull();
      expect(body["dropsLast24h"]).toBeNull();
      /* The pre-existing fields are untouched. */
      expect(body["isProjectAllowed"]).toBe(true);
      expect(body["appIdentifier"]).toBe("checkout-web");
    });

    test("reports the published recorder version from the registered reader, and never-seen stamps as null", async () => {
      const principal: {
        request: JSONObject;
        databaseProps: DatabaseCommonInteractionProps;
      } = buildPrincipal({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps(principal.databaseProps);
      mockConfiguredApplication();
      mockProject(true);

      SessionReplayReadService.setPublishedRecorderVersionProvider(
        (): string | null => {
          return "3.1.0";
        },
      );

      /* The activity summary read fails: unknown, never zero. */
      headerQuerySpy.mockRejectedValue(
        new Error("clickhouse timeout") as never,
      );

      const result: CallResult = await callRoute({
        uri: INGEST_STATUS_ROUTE,
        request: principal.request,
        body: { rumApplicationId: applicationAId.toString() },
      });

      const body: JSONObject = result.jsonBody as JSONObject;

      expect(body["publishedRecorderVersion"]).toBe("3.1.0");
      expect(body["lastConfigFetchAt"]).toBeNull();
      expect(body["lastSessionStartedAt"]).toBeNull();
      expect(body["sessionsLast24h"]).toBeNull();
      expect(body["playableSessionsLast24h"]).toBeNull();
      expect(body["retentionInDays"]).toBeNull();
    });
  });
});
