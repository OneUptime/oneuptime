import CommonAPI from "../../../Server/API/CommonAPI";
import ProjectService from "../../../Server/Services/ProjectService";
import TelemetrySourceMapService from "../../../Server/Services/TelemetrySourceMapService";
import SourceMapResolver, {
  MAX_FRAMES_PER_RESOLVE_REQUEST,
  MAX_FRAMES_TO_RESOLVE,
} from "../../../Server/Utils/Telemetry/SourceMapResolver";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  MinifiedStackFrame,
  ResolveStackTraceResult,
} from "../../../Types/Telemetry/SourceMap";
import UserType from "../../../Types/UserType";
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
 * ---------------------------------------------------------------------------
 * POST /telemetry/exceptions/resolve-stack-trace — the frames-array cap
 * ---------------------------------------------------------------------------
 *
 * The handler takes a caller-supplied `frames` array and hands it to
 * SourceMapResolver.sanitizeMinifiedStackFrames, which never throws and never
 * truncates: it walks every element and returns one output frame per object it
 * sees. Downstream, resolveFramesForService only *resolves* the first
 * MAX_FRAMES_TO_RESOLVE frames, but it still copies the whole array into the
 * response. So before this cap existed, the only bound on the work (and the
 * response size) a single request could ask for was the body-size limit —
 * ~200k frames of `{}` fit inside a few megabytes of JSON.
 *
 * MAX_FRAMES_PER_RESOLVE_REQUEST closes that. The cases below pin the three
 * things that make it correct rather than merely present: it is a `>` bound
 * (a full 10000-frame trace still resolves), it sits AFTER the Array.isArray
 * guard (so a non-array keeps its own precise error), and it sits BEFORE
 * sanitize (so an oversized array is refused instead of being quietly walked
 * end to end and reduced to []).
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

const telemetryRouter: JSONObject = {
  get: recordRoute("get"),
  post: recordRoute("post"),
  put: recordRoute("put"),
  delete: recordRoute("delete"),
} as unknown as JSONObject;

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return telemetryRouter;
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

const RESOLVE_ROUTE: string = "/telemetry/exceptions/resolve-stack-trace";

type FindRouteFunction = (uri: string) => RecordedRoute;

const findRoute: FindRouteFunction = (uri: string): RecordedRoute => {
  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route not registered: ${uri}`);
  }

  return route;
};

type CallResult = {
  /* Exception handed to Response.sendErrorResponse by a guard or the handler. */
  deniedWith: Exception | undefined;
  /* Exception thrown out of the handler into express' error path. */
  thrownToNext: unknown;
  /* True when the final route handler was actually entered. */
  reachedHandler: boolean;
  jsonBody: JSONObject | undefined;
};

/*
 * Runs the recorded route's middleware chain for real, starting at
 * requireUserAuthentication. Index 0 is getUserMiddleware, whose only job is
 * to populate the session fields these fixtures set directly — running it
 * would need a live session store and would prove nothing about the cap.
 */
type CallRouteFunction = (data: {
  request: JSONObject;
  body: unknown;
}) => Promise<CallResult>;

const callRoute: CallRouteFunction = async (data: {
  request: JSONObject;
  body: unknown;
}): Promise<CallResult> => {
  const route: RecordedRoute = findRoute(RESOLVE_ROUTE);

  const req: ExpressRequest = {
    ...data.request,
    body: data.body,
    params: {},
    query: {},
    headers: { "user-agent": "jest-agent" },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    setHeader: (): void => {
      // no-op
    },
    send: (): void => {
      // no-op
    },
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as ExpressResponse;

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

    // A guard (or the handler) that answered the request never calls next.
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
  };
};

type BuildPrincipalFunction = (data: {
  projectId: ObjectID;
  userId: ObjectID;
}) => JSONObject;

const buildPrincipal: BuildPrincipalFunction = (data: {
  projectId: ObjectID;
  userId: ObjectID;
}): JSONObject => {
  /*
   * isBlockPermission must be an explicit false: getUserPermissions filters
   * tenant permissions with a strict `=== false`, so undefined would silently
   * drop the permission this fixture grants and every case below would fail
   * at the guard instead of exercising the handler.
   */
  const userPermissions: Array<UserPermission> = [
    Permission.ReadTelemetryException,
  ].map((permission: Permission): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
    };
  });

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: userPermissions,
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  return {
    userType: UserType.User,
    tenantId: data.projectId,
    userTenantAccessPermission: permissionMap,
    userAuthorization: { userId: data.userId },
  } as unknown as JSONObject;
};

/*
 * Well-formed frames. Every one is a distinct object so nothing about the
 * cap can be an artifact of array element identity.
 */
type MakeFramesFunction = (count: number) => Array<JSONObject>;

const makeFrames: MakeFramesFunction = (count: number): Array<JSONObject> => {
  return Array.from(
    { length: count },
    (_unused: unknown, index: number): JSONObject => {
      return {
        functionName: `minified${index}`,
        fileName: "https://app.example.com/assets/main.abc123.js",
        lineNumber: 1,
        columnNumber: index,
        inApp: true,
      };
    },
  );
};

/*
 * Elements sanitize throws away entirely (null, primitives, nested arrays):
 * a payload of these sanitizes to [] no matter how long it is, which is
 * exactly the shape that has to be rejected on length rather than quietly
 * accepted as an empty resolve.
 */
type MakeJunkFramesFunction = (count: number) => Array<unknown>;

const makeJunkFrames: MakeJunkFramesFunction = (
  count: number,
): Array<unknown> => {
  return Array.from({ length: count }, (_unused: unknown, index: number) => {
    if (index % 3 === 0) {
      return null;
    }

    if (index % 3 === 1) {
      return "not-a-frame";
    }

    return [index];
  });
};

const EMPTY_RESULT: ResolveStackTraceResult = {
  frames: [],
  resolvedCount: 0,
  sourceMapCount: 0,
  sourceMapsSkippedForSize: 0,
};

const TOO_MANY_FRAMES_MESSAGE: string = `frames must contain at most ${MAX_FRAMES_PER_RESOLVE_REQUEST} stack frames.`;
const NOT_AN_ARRAY_MESSAGE: string = "frames must be an array of stack frames";

describe("POST /telemetry/exceptions/resolve-stack-trace frames cap", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let serviceId: ObjectID;

  interface Spy {
    mock: { calls: Array<Array<unknown>> };
    mockResolvedValue: (value: ResolveStackTraceResult) => unknown;
    mockRejectedValue: (value: unknown) => unknown;
  }

  let resolveFramesForService: Spy;
  let sanitizeMinifiedStackFrames: Spy;

  beforeAll(() => {
    recordedRoutes.length = 0;
    /*
     * Loaded lazily rather than with a top-level import: TelemetryAPI calls
     * Express.getRouter() at module scope, so a static import would run the
     * mock factory before `telemetryRouter` is initialised and die in the
     * temporal dead zone.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../../Server/API/TelemetryAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    serviceId = ObjectID.generate();

    /*
     * CI runs the Common suite with BILLING_ENABLED=true (see test-setup.sh),
     * so getDatabaseCommonInteractionProps resolves the caller's plan through
     * ProjectService.getCurrentPlan. These fixtures use a project that never
     * exists in the database, so the real lookup throws and the handler's
     * catch swallows the request before it reaches the frames guard. Billing
     * is orthogonal to the cap, so stub the plan lookup and let the rest run.
     */
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false });

    resolveFramesForService = jest.spyOn(
      TelemetrySourceMapService,
      "resolveFramesForService" as never,
    ) as unknown as Spy;
    resolveFramesForService.mockResolvedValue(EMPTY_RESULT);

    /*
     * Spied, not stubbed: the real implementation still runs, so the cases
     * that assert what the handler forwards are exercising real sanitize
     * output while the call log proves whether sanitize ran at all.
     */
    sanitizeMinifiedStackFrames = jest.spyOn(
      SourceMapResolver,
      "sanitizeMinifiedStackFrames" as never,
    ) as unknown as Spy;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type CallFunction = (body: unknown) => Promise<CallResult>;

  const call: CallFunction = (body: unknown): Promise<CallResult> => {
    return callRoute({
      request: buildPrincipal({ projectId: projectId, userId: userId }),
      body: body,
    });
  };

  type BodyWithFramesFunction = (frames: unknown) => JSONObject;

  const bodyWithFrames: BodyWithFramesFunction = (
    frames: unknown,
  ): JSONObject => {
    return {
      serviceId: serviceId.toString(),
      serviceVersion: "1.4.2",
      frames: frames,
    } as JSONObject;
  };

  type ForwardedFramesFunction = () => Array<MinifiedStackFrame>;

  const forwardedFrames: ForwardedFramesFunction =
    (): Array<MinifiedStackFrame> => {
      const argument: JSONObject = resolveFramesForService.mock
        .calls[0]![0] as JSONObject;

      return argument["frames"] as unknown as Array<MinifiedStackFrame>;
    };

  describe("route registration", () => {
    test("the route is registered as POST behind the exception-read guard chain", () => {
      const route: RecordedRoute = findRoute(RESOLVE_ROUTE);

      expect(route.uri).toBe(RESOLVE_ROUTE);
      // getUserMiddleware, requireUserAuthentication, requirePermission, handler.
      expect(route.handlers).toHaveLength(4);
    });
  });

  describe("the limit itself", () => {
    test("MAX_FRAMES_PER_RESOLVE_REQUEST is 10000", () => {
      expect(MAX_FRAMES_PER_RESOLVE_REQUEST).toBe(10000);
    });

    /*
     * The two bounds do different jobs and must not be confused for each
     * other: MAX_FRAMES_TO_RESOLVE is how many frames get *resolved* against
     * a map, this one is how many a caller may *submit*. If the request cap
     * ever slid down to the resolve cap, browsers that send deep async traces
     * would start getting 400s instead of a partially-resolved trace, so the
     * gap between them is deliberate and worth pinning.
     */
    test("the request cap sits far above the per-request resolve cap", () => {
      expect(MAX_FRAMES_PER_RESOLVE_REQUEST).toBeGreaterThan(
        MAX_FRAMES_TO_RESOLVE,
      );
      expect(MAX_FRAMES_PER_RESOLVE_REQUEST).toBeGreaterThanOrEqual(
        MAX_FRAMES_TO_RESOLVE * 10,
      );
    });
  });

  describe("accepted sizes", () => {
    test("a single frame resolves", async () => {
      const result: CallResult = await call(bodyWithFrames(makeFrames(1)));

      expect(result.deniedWith).toBeUndefined();
      expect(resolveFramesForService.mock.calls).toHaveLength(1);
      expect(forwardedFrames()).toHaveLength(1);
    });

    test("one frame under the cap is accepted", async () => {
      const result: CallResult = await call(
        bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST - 1)),
      );

      expect(result.deniedWith).toBeUndefined();
      expect(resolveFramesForService.mock.calls).toHaveLength(1);
      expect(forwardedFrames()).toHaveLength(
        MAX_FRAMES_PER_RESOLVE_REQUEST - 1,
      );
    });

    /*
     * The boundary. The guard is a `>` comparison, so a trace of exactly the
     * cap is a legal request; an off-by-one here would reject the very
     * payload the constant advertises as the maximum.
     */
    test("exactly MAX_FRAMES_PER_RESOLVE_REQUEST frames is accepted, not rejected by the cap", async () => {
      const result: CallResult = await call(
        bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST)),
      );

      expect(result.deniedWith).toBeUndefined();
      expect(result.thrownToNext).toBeUndefined();
      expect(resolveFramesForService.mock.calls).toHaveLength(1);
    });

    /*
     * And it is accepted in full. sanitize does not truncate, and the handler
     * does not either — which is precisely why the cap has to exist at this
     * layer rather than being left to a downstream slice.
     */
    test("an at-cap request forwards all 10000 frames — nothing truncates on the way through", async () => {
      await call(bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST)));

      expect(forwardedFrames()).toHaveLength(MAX_FRAMES_PER_RESOLVE_REQUEST);
      expect(forwardedFrames()).not.toHaveLength(MAX_FRAMES_TO_RESOLVE);
    });

    test("an empty frames array is accepted — the cap only bounds the top end", async () => {
      const result: CallResult = await call(bodyWithFrames([]));

      expect(result.deniedWith).toBeUndefined();
      expect(resolveFramesForService.mock.calls).toHaveLength(1);
      expect(forwardedFrames()).toHaveLength(0);
    });

    test("an accepted request returns the resolver's result to the caller", async () => {
      const resolved: ResolveStackTraceResult = {
        frames: [],
        resolvedCount: 3,
        sourceMapCount: 2,
        sourceMapsSkippedForSize: 1,
      };
      resolveFramesForService.mockResolvedValue(resolved);

      const result: CallResult = await call(
        bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST)),
      );

      expect(result.jsonBody).toMatchObject({
        resolvedCount: 3,
        sourceMapCount: 2,
        sourceMapsSkippedForSize: 1,
      });
    });

    test("the accepted request is scoped to the caller's tenant and body service", async () => {
      await call(bodyWithFrames(makeFrames(10)));

      const argument: JSONObject = resolveFramesForService.mock
        .calls[0]![0] as JSONObject;

      expect((argument["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((argument["serviceId"] as ObjectID).toString()).toBe(
        serviceId.toString(),
      );
      expect(argument["serviceVersion"]).toBe("1.4.2");
    });
  });

  describe("rejected sizes", () => {
    /*
     * One over the boundary. This is the case the cap exists for, and the
     * only place the off-by-one can be caught from the outside.
     */
    test("one frame over the cap is rejected with a BadDataException", async () => {
      const result: CallResult = await call(
        bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST + 1)),
      );

      expect(result.deniedWith).toBeInstanceOf(BadDataException);
      expect(resolveFramesForService.mock.calls).toHaveLength(0);
    });

    /*
     * The message has to name the limit: the caller is a build tool or a
     * browser SDK batching frames, and "too many frames" without the number
     * gives it nothing to clamp to.
     */
    test("the rejection message names the limit", async () => {
      const result: CallResult = await call(
        bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST + 1)),
      );

      expect(result.deniedWith?.message).toBe(TOO_MANY_FRAMES_MESSAGE);
      expect(result.deniedWith?.message).toContain(
        String(MAX_FRAMES_PER_RESOLVE_REQUEST),
      );
    });

    test("a wildly oversized array is rejected the same way, not merely trimmed", async () => {
      const result: CallResult = await call(
        bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST * 2)),
      );

      expect(result.deniedWith).toBeInstanceOf(BadDataException);
      expect(result.deniedWith?.message).toBe(TOO_MANY_FRAMES_MESSAGE);
      expect(resolveFramesForService.mock.calls).toHaveLength(0);
    });

    test("no response body is produced for a rejected request", async () => {
      const result: CallResult = await call(
        bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST + 1)),
      );

      expect(result.jsonBody).toBeUndefined();
      expect(result.thrownToNext).toBeUndefined();
    });
  });

  describe("guard ordering: the cap runs AFTER the Array.isArray check", () => {
    /*
     * A non-array `frames` must keep its own precise error. If the length
     * check were hoisted above the type check it would read `.length` off
     * whatever the caller sent — and a string, or any array-like object,
     * has a length — so a plainly malformed body would come back complaining
     * about a limit it never approached.
     */
    test("a non-array frames value gets the array error, not the length error", async () => {
      const result: CallResult = await call(bodyWithFrames({ zero: "frame" }));

      expect(result.deniedWith).toBeInstanceOf(BadDataException);
      expect(result.deniedWith?.message).toBe(NOT_AN_ARRAY_MESSAGE);
      expect(resolveFramesForService.mock.calls).toHaveLength(0);
    });

    test("an array-like object longer than the cap still gets the array error", async () => {
      const result: CallResult = await call(
        bodyWithFrames({ length: MAX_FRAMES_PER_RESOLVE_REQUEST + 1 }),
      );

      expect(result.deniedWith?.message).toBe(NOT_AN_ARRAY_MESSAGE);
      expect(result.deniedWith?.message).not.toBe(TOO_MANY_FRAMES_MESSAGE);
    });

    test("a string longer than the cap still gets the array error", async () => {
      const result: CallResult = await call(
        bodyWithFrames("f".repeat(MAX_FRAMES_PER_RESOLVE_REQUEST + 1)),
      );

      expect(result.deniedWith?.message).toBe(NOT_AN_ARRAY_MESSAGE);
      expect(result.deniedWith?.message).not.toBe(TOO_MANY_FRAMES_MESSAGE);
    });

    test("a missing frames field gets the array error", async () => {
      const result: CallResult = await call({
        serviceId: serviceId.toString(),
        serviceVersion: "1.4.2",
      });

      expect(result.deniedWith?.message).toBe(NOT_AN_ARRAY_MESSAGE);
      expect(resolveFramesForService.mock.calls).toHaveLength(0);
    });

    test("a null frames field gets the array error", async () => {
      const result: CallResult = await call(bodyWithFrames(null));

      expect(result.deniedWith?.message).toBe(NOT_AN_ARRAY_MESSAGE);
    });
  });

  describe("guard ordering: the cap runs BEFORE sanitize", () => {
    /*
     * The regression this ordering fixes. sanitize walks every element and
     * silently drops the ones that are not objects, so an oversized array of
     * pure junk sanitizes to [] — and a cap placed after sanitize would see
     * a length of 0, wave the request through, and only then have done the
     * per-element work the cap was supposed to prevent. The caller would get
     * a cheerful empty resolve for a payload the server should have refused.
     */
    test("an oversized array of junk is rejected on length, not silently sanitized to []", async () => {
      const result: CallResult = await call(
        bodyWithFrames(makeJunkFrames(MAX_FRAMES_PER_RESOLVE_REQUEST + 1)),
      );

      expect(result.deniedWith).toBeInstanceOf(BadDataException);
      expect(result.deniedWith?.message).toBe(TOO_MANY_FRAMES_MESSAGE);
      expect(resolveFramesForService.mock.calls).toHaveLength(0);
    });

    test("sanitize is never invoked for an oversized array", async () => {
      await call(
        bodyWithFrames(makeJunkFrames(MAX_FRAMES_PER_RESOLVE_REQUEST + 1)),
      );

      expect(sanitizeMinifiedStackFrames.mock.calls).toHaveLength(0);
    });

    test("sanitize is never invoked for an oversized array of well-formed frames either", async () => {
      await call(
        bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST + 1)),
      );

      expect(sanitizeMinifiedStackFrames.mock.calls).toHaveLength(0);
    });

    /*
     * The other half of the ordering: under the cap, sanitize still runs and
     * still does its filtering. The guard bounds the work; it does not
     * replace the type coercion.
     */
    test("an under-cap array of junk does reach sanitize and comes out empty", async () => {
      const result: CallResult = await call(
        bodyWithFrames(makeJunkFrames(MAX_FRAMES_PER_RESOLVE_REQUEST)),
      );

      expect(result.deniedWith).toBeUndefined();
      expect(sanitizeMinifiedStackFrames.mock.calls).toHaveLength(1);
      expect(forwardedFrames()).toHaveLength(0);
    });

    test("an at-cap mixed array forwards only the object frames sanitize kept", async () => {
      const mixed: Array<unknown> = [
        ...makeFrames(4),
        ...makeJunkFrames(MAX_FRAMES_PER_RESOLVE_REQUEST - 4),
      ];

      const result: CallResult = await call(bodyWithFrames(mixed));

      expect(result.deniedWith).toBeUndefined();
      expect(forwardedFrames()).toHaveLength(4);
    });
  });

  describe("guard ordering: serviceId and serviceVersion are checked first", () => {
    /*
     * The identity checks stay in front of the cap. A request that is both
     * oversized and missing its serviceId is not a limits problem — telling
     * the caller about the frame limit would send them off trimming a trace
     * when the actual defect is an unset field, and they would hit the same
     * wall again with a shorter payload.
     */
    test("an oversized request missing serviceId is refused for serviceId", async () => {
      const result: CallResult = await call({
        serviceVersion: "1.4.2",
        frames: makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST + 1),
      } as unknown as JSONObject);

      expect(result.deniedWith?.message).toBe("serviceId is required");
      expect(result.deniedWith?.message).not.toBe(TOO_MANY_FRAMES_MESSAGE);
      expect(resolveFramesForService.mock.calls).toHaveLength(0);
    });

    test("an oversized request with a non-string serviceId is refused for serviceId", async () => {
      const result: CallResult = await call({
        serviceId: 42,
        serviceVersion: "1.4.2",
        frames: makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST + 1),
      } as unknown as JSONObject);

      expect(result.deniedWith?.message).toBe("serviceId is required");
    });

    test("an oversized request missing serviceVersion is refused for serviceVersion", async () => {
      const result: CallResult = await call({
        serviceId: serviceId.toString(),
        frames: makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST + 1),
      } as unknown as JSONObject);

      expect(result.deniedWith?.message).toBe("serviceVersion is required");
      expect(result.deniedWith?.message).not.toBe(TOO_MANY_FRAMES_MESSAGE);
    });

    /*
     * And the tenant check stays in front of everything: an unscoped request
     * must never get as far as reporting anything about its payload.
     */
    test("an oversized request without a tenant is refused for the project, not the frames", async () => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({
          tenantId: undefined,
          userType: UserType.User,
        } as unknown as DatabaseCommonInteractionProps);

      const result: CallResult = await call(
        bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST + 1)),
      );

      expect(result.deniedWith?.message).toBe("Invalid Project ID");
      expect(resolveFramesForService.mock.calls).toHaveLength(0);
    });
  });

  describe("the cap is a request guard, not an error handler", () => {
    /*
     * A rejected request answers the caller directly; it must not fall
     * through to express' error path, which would turn a 400 into a 500.
     */
    test("an oversized request is answered, not thrown to next", async () => {
      const result: CallResult = await call(
        bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST + 1)),
      );

      expect(result.thrownToNext).toBeUndefined();
      expect(result.deniedWith).toBeDefined();
    });

    // A failure below the guard still goes to next, as it always did.
    test("a resolver failure on an accepted request still reaches the error handler", async () => {
      resolveFramesForService.mockRejectedValue(
        new Error("clickhouse said no"),
      );

      const result: CallResult = await call(
        bodyWithFrames(makeFrames(MAX_FRAMES_PER_RESOLVE_REQUEST)),
      );

      expect(result.thrownToNext).toBeDefined();
      expect(result.jsonBody).toBeUndefined();
    });
  });
});
