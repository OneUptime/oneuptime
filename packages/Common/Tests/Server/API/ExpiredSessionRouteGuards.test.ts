import { mockRouter } from "./Helpers";
import AIBillingRouter from "../../../Server/API/AIBillingAPI";
import AlertAPI from "../../../Server/API/AlertAPI";
import BillingAPI from "../../../Server/API/BillingAPI";
import BillingInvoiceAPI from "../../../Server/API/BillingInvoiceAPI";
import BillingPaymentMethodAPI from "../../../Server/API/BillingPaymentMethodAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import IncidentEpisodeAPI from "../../../Server/API/IncidentEpisodeAPI";
import NotificationRouter from "../../../Server/API/NotificationAPI";
import ProjectAPI from "../../../Server/API/ProjectAPI";
import ScheduledMaintenanceAPI from "../../../Server/API/ScheduledMaintenanceAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import UserCallAPI from "../../../Server/API/UserCallAPI";
import UserEmailAPI from "../../../Server/API/UserEmailAPI";
import UserIncomingCallNumberAPI from "../../../Server/API/UserIncomingCallNumberAPI";
import UserMicrosoftTeamsAPI from "../../../Server/API/UserMicrosoftTeamsAPI";
import UserSlackAPI from "../../../Server/API/UserSlackAPI";
import UserSmsAPI from "../../../Server/API/UserSmsAPI";
import UserTotpAuthAPI from "../../../Server/API/UserTotpAuthAPI";
import UserWebAuthnAPI from "../../../Server/API/UserWebAuthnAPI";
import UserWebhookAPI from "../../../Server/API/UserWebhookAPI";
import UserWhatsAppAPI from "../../../Server/API/UserWhatsAppAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
} from "../../../Server/Middleware/VerificationCodeRateLimit";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
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
 * Every custom route that gained UserMiddleware.requireUserAuthentication in
 * the expired-session fix, in one table.
 *
 * THE BUG
 *
 * A customer left the Dashboard open for more than 15 minutes, clicked a
 * button, and was told "You are not authorized to access this project's
 * data." The access-token cookie's maxAge is the JWT's own lifetime, so the
 * browser had dropped it and the request arrived with no token at all.
 * getUserMiddleware does not refuse that request - it marks it UserType.Public
 * and calls next(), because some routes are meant to be anonymous - and each
 * of these handlers then refused it in its own words: a 422, a 400, or worse,
 * a root read that answered with nothing. The browser client only refreshes
 * the session and replays the request on a 401, so every one of those
 * surfaced as a hard error instead of a silent refresh.
 *
 * THE FIX, AS IT APPEARS ON THE ROUTER
 *
 * requireUserAuthentication sits IMMEDIATELY after getUserMiddleware on each
 * of these routes. Immediately, because:
 *
 *   - before getUserMiddleware there is no userType to look at, so it would
 *     refuse everybody;
 *   - on the verification-code routes the VerificationCodeRateLimit limiter
 *     must come AFTER it. The limiter spends item and IP budgets as soon as
 *     it runs, so running it first would let a stale tab burn a user's
 *     attempts on requests that were going to be refused anyway, and a
 *     limited request would be answered with a 429 - also not a cue to
 *     refresh.
 *
 * WHY A TABLE
 *
 * Twenty-odd routes across nineteen files, each an independent one-line
 * registration. Dropping the guard from one of them breaks nothing that the
 * route's own tests would notice - they call the handler directly - and the
 * symptom only appears for a user whose tab has been idle for a quarter of an
 * hour. So each route is named here, located on the router the API class (or
 * module) actually registered it on, and its middleware list is asserted by
 * identity.
 *
 * Then the chain is RUN for every route with the request an idle tab really
 * sends: no cookie, no API key, but the tenantid header the Dashboard always
 * attaches. getUserMiddleware is the real one, so the test also proves the
 * premise - that such a request reaches the guard as Public rather than
 * being refused earlier - and the guard must answer it with a 401 before the
 * limiter or the handler is reached.
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
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const AUTHENTICATION_REQUIRED_MESSAGE: string =
  "Authentication required. Please log in to access this resource.";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ROW_ID: string = "33333333-3333-4333-8333-333333333333";

type HttpMethod = "GET" | "POST" | "PUT";

type GuardedRoute = {
  method: HttpMethod;

  // Relative to /api, exactly as the router registers it.
  uri: string;

  // Where the route is registered, for the test names.
  registeredBy: string;

  // Set only for the routes that also carry a verification-code limiter.
  limiter?: VerificationCodeRateLimitBucket | undefined;
};

const GUARDED_ROUTES: Array<GuardedRoute> = [
  // Credit top-ups.
  {
    method: "POST",
    uri: "/notification/recharge",
    registeredBy: "NotificationAPI",
  },
  { method: "POST", uri: "/ai/recharge", registeredBy: "AIBillingAPI" },

  // "Send a test message" buttons on the user's notification settings.
  { method: "POST", uri: "/user-slack/test", registeredBy: "UserSlackAPI" },
  {
    method: "POST",
    uri: "/user-microsoft-teams/test",
    registeredBy: "UserMicrosoftTeamsAPI",
  },
  { method: "POST", uri: "/user-webhook/test", registeredBy: "UserWebhookAPI" },

  // Security key enrolment.
  {
    method: "POST",
    uri: "/user-webauthn/generate-registration-options",
    registeredBy: "UserWebAuthnAPI",
  },
  {
    method: "POST",
    uri: "/user-webauthn/verify-registration",
    registeredBy: "UserWebAuthnAPI",
  },

  // Contact-method verification, each behind a verification-code limiter.
  {
    method: "POST",
    uri: "/user-incoming-call-number/verify",
    registeredBy: "UserIncomingCallNumberAPI",
    limiter: VerificationCodeRateLimitBucket.Verify,
  },
  {
    method: "POST",
    uri: "/user-incoming-call-number/resend-verification-code",
    registeredBy: "UserIncomingCallNumberAPI",
    limiter: VerificationCodeRateLimitBucket.Resend,
  },
  {
    method: "POST",
    uri: "/user-sms/verify",
    registeredBy: "UserSmsAPI",
    limiter: VerificationCodeRateLimitBucket.Verify,
  },
  {
    method: "POST",
    uri: "/user-sms/resend-verification-code",
    registeredBy: "UserSmsAPI",
    limiter: VerificationCodeRateLimitBucket.Resend,
  },
  {
    method: "POST",
    uri: "/user-call/verify",
    registeredBy: "UserCallAPI",
    limiter: VerificationCodeRateLimitBucket.Verify,
  },
  {
    method: "POST",
    uri: "/user-call/resend-verification-code",
    registeredBy: "UserCallAPI",
    limiter: VerificationCodeRateLimitBucket.Resend,
  },
  {
    method: "POST",
    uri: "/user-email/verify",
    registeredBy: "UserEmailAPI",
    limiter: VerificationCodeRateLimitBucket.Verify,
  },
  {
    method: "POST",
    uri: "/user-email/resend-verification-code",
    registeredBy: "UserEmailAPI",
    limiter: VerificationCodeRateLimitBucket.Resend,
  },
  {
    method: "POST",
    uri: "/user-whatsapp/verify",
    registeredBy: "UserWhatsAppAPI",
    limiter: VerificationCodeRateLimitBucket.Verify,
  },
  {
    method: "POST",
    uri: "/user-whatsapp/resend-verification-code",
    registeredBy: "UserWhatsAppAPI",
    limiter: VerificationCodeRateLimitBucket.Resend,
  },

  // Authenticator app enrolment.
  {
    method: "POST",
    uri: "/user-totp-auth/validate",
    registeredBy: "UserTotpAuthAPI",
  },

  // Team membership.
  {
    method: "POST",
    uri: "/team-member/is-user-registered",
    registeredBy: "TeamMemberAPI",
  },
  {
    method: "POST",
    uri: "/team-member/remove-user-from-project",
    registeredBy: "TeamMemberAPI",
  },
  {
    method: "POST",
    uri: "/team-member/:id/leave",
    registeredBy: "TeamMemberAPI",
  },

  // Billing.
  {
    method: "POST",
    uri: "/billing-payment-methods/setup",
    registeredBy: "BillingPaymentMethodAPI",
  },
  {
    method: "POST",
    uri: "/billing-payment-methods/set-default",
    registeredBy: "BillingPaymentMethodAPI",
  },
  {
    method: "GET",
    uri: "/billing/pay-as-you-go-status",
    registeredBy: "BillingAPI",
  },
  {
    method: "GET",
    uri: "/billing/customer-balance",
    registeredBy: "BillingAPI",
  },
  {
    method: "POST",
    uri: "/billing-invoices/pay",
    registeredBy: "BillingInvoiceAPI",
  },
  {
    method: "PUT",
    uri: "/project/:id/change-plan",
    registeredBy: "ProjectAPI",
  },

  // "Generate with AI" buttons.
  {
    method: "POST",
    uri: "/incident/generate-postmortem-from-ai/:incidentId",
    registeredBy: "IncidentAPI",
  },
  {
    method: "POST",
    uri: "/incident/generate-note-from-ai/:incidentId",
    registeredBy: "IncidentAPI",
  },
  {
    method: "POST",
    uri: "/alert/generate-note-from-ai/:alertId",
    registeredBy: "AlertAPI",
  },
  {
    method: "POST",
    uri: "/incident-episode/generate-postmortem-from-ai/:episodeId",
    registeredBy: "IncidentEpisodeAPI",
  },
  {
    method: "POST",
    uri: "/scheduled-maintenance/generate-note-from-ai/:scheduledMaintenanceId",
    registeredBy: "ScheduledMaintenanceAPI",
  },
];

type RecordedRoute = ReturnType<typeof mockRouter.match>;

type RouterFunction = RecordedRoute["handlerFunction"];

type FindRouteFunction = (route: GuardedRoute) => RecordedRoute;

const findRoute: FindRouteFunction = (route: GuardedRoute): RecordedRoute => {
  return mockRouter.match(route.method, route.uri);
};

/*
 * Every limiter the API classes were built with, mapped to its bucket.
 * getMiddleware returns a fresh closure per route, so this is the only way to
 * tell "the limiter" apart from any other function by identity.
 */
const limiterBuckets: Map<unknown, VerificationCodeRateLimitBucket> = new Map<
  unknown,
  VerificationCodeRateLimitBucket
>();

beforeAll(() => {
  const realGetMiddleware: typeof VerificationCodeRateLimit.getMiddleware =
    VerificationCodeRateLimit.getMiddleware.bind(VerificationCodeRateLimit);

  const capture: jest.SpyInstance = jest
    .spyOn(VerificationCodeRateLimit, "getMiddleware")
    .mockImplementation(((bucket: VerificationCodeRateLimitBucket) => {
      const limiter: ReturnType<
        typeof VerificationCodeRateLimit.getMiddleware
      > = realGetMiddleware(bucket);
      limiterBuckets.set(limiter, bucket);
      return limiter;
    }) as never);

  /*
   * NotificationAPI and AIBillingAPI register at import time on a module-level
   * router, so their routes are already on the recorder. mockRouter.routes is
   * therefore NOT cleared here.
   */
  new UserSlackAPI();
  new UserMicrosoftTeamsAPI();
  new UserWebhookAPI();
  new UserWebAuthnAPI();
  new UserIncomingCallNumberAPI();
  new UserSmsAPI();
  new UserCallAPI();
  new UserEmailAPI();
  new UserWhatsAppAPI();
  new UserTotpAuthAPI();
  new TeamMemberAPI();
  new BillingPaymentMethodAPI();
  new BillingAPI();
  new BillingInvoiceAPI();
  new ProjectAPI();
  new IncidentAPI();
  new IncidentEpisodeAPI();
  new AlertAPI();
  new ScheduledMaintenanceAPI();

  capture.mockRestore();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the harness", () => {
  /*
   * The two module-level routers are the ones most likely to be recorded
   * somewhere other than here, so prove they are the recorder before
   * trusting anything the table says about them.
   */
  test("the module-level routers are the recorder this file reads", () => {
    expect(NotificationRouter).toBe(mockRouter);
    expect(AIBillingRouter).toBe(mockRouter);
  });

  test("captured a limiter for each verification-code route", () => {
    const limiterRoutes: Array<GuardedRoute> = GUARDED_ROUTES.filter(
      (route: GuardedRoute): boolean => {
        return Boolean(route.limiter);
      },
    );

    expect(limiterRoutes).toHaveLength(10);
    expect(limiterBuckets.size).toBeGreaterThanOrEqual(limiterRoutes.length);
  });

  /*
   * mockRouter.match returns the FIRST registration of a method and path, so
   * a second registration of the same route - one with the guard, one
   * without - would hide behind it. Each must be registered exactly once.
   */
  test.each(GUARDED_ROUTES)(
    "$method $uri ($registeredBy) is registered exactly once",
    (route: GuardedRoute) => {
      const registrations: Array<RecordedRoute> = mockRouter.routes.filter(
        (recorded: RecordedRoute): boolean => {
          return recorded.method === route.method && recorded.uri === route.uri;
        },
      );

      expect(registrations).toHaveLength(1);
    },
  );
});

describe("middleware order on every guarded route", () => {
  test.each(GUARDED_ROUTES)(
    "$method $uri ($registeredBy) resolves the session, then requires it",
    (route: GuardedRoute) => {
      const middlewares: Array<RouterFunction> = findRoute(route).middlewares;

      expect(middlewares[0]).toBe(UserMiddleware.getUserMiddleware);
      expect(middlewares[1]).toBe(UserMiddleware.requireUserAuthentication);

      // Exactly once: a second copy further down would mean a mis-edit.
      expect(
        middlewares.filter((middleware: RouterFunction): boolean => {
          return (
            (middleware as unknown) ===
            (UserMiddleware.requireUserAuthentication as unknown)
          );
        }),
      ).toHaveLength(1);

      // The guard is middleware, never the handler itself.
      expect(findRoute(route).handlerFunction).not.toBe(
        UserMiddleware.requireUserAuthentication,
      );
    },
  );

  const limiterRoutes: Array<GuardedRoute> = GUARDED_ROUTES.filter(
    (route: GuardedRoute): boolean => {
      return Boolean(route.limiter);
    },
  );

  test.each(limiterRoutes)(
    "$method $uri ($registeredBy) runs its $limiter limiter only after the guard",
    (route: GuardedRoute) => {
      const middlewares: Array<RouterFunction> = findRoute(route).middlewares;

      const guardIndex: number = middlewares.indexOf(
        UserMiddleware.requireUserAuthentication as unknown as RouterFunction,
      );

      const limiterIndexes: Array<number> = middlewares
        .map((middleware: RouterFunction, index: number): number => {
          return limiterBuckets.has(middleware) ? index : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        });

      expect(guardIndex).toBe(1);
      expect(limiterIndexes).toEqual([2]);
      expect(limiterBuckets.get(middlewares[2])).toBe(route.limiter);
    },
  );

  test.each(
    GUARDED_ROUTES.filter((route: GuardedRoute): boolean => {
      return !route.limiter;
    }),
  )(
    "$method $uri ($registeredBy) carries no verification-code limiter",
    (route: GuardedRoute) => {
      const middlewares: Array<RouterFunction> = findRoute(route).middlewares;

      expect(
        middlewares.some((middleware: RouterFunction): boolean => {
          return limiterBuckets.has(middleware);
        }),
      ).toBe(false);
    },
  );
});

type ChainResult = {
  // Index of the middleware that answered instead of calling next(), or -1.
  stoppedAt: number;
  reachedHandler: boolean;
  sentError: Exception | undefined;
  sendErrorCallCount: number;
  request: OneUptimeRequest;
};

type RunChainFunction = (data: {
  route: GuardedRoute;
  request: Dictionary<unknown>;
  runHandler?: boolean | undefined;
}) => Promise<ChainResult>;

/*
 * Runs the recorded middlewares in order, from getUserMiddleware, the way
 * Express would, and stops at the first one that answers instead of calling
 * next(). The handler is only invoked when asked for and only if every
 * middleware let the request through.
 */
const runChain: RunChainFunction = async (data: {
  route: GuardedRoute;
  request: Dictionary<unknown>;
  runHandler?: boolean | undefined;
}): Promise<ChainResult> => {
  const recorded: RecordedRoute = findRoute(data.route);

  const req: OneUptimeRequest = {
    params: {},
    query: {},
    body: {},
    cookies: {},
    ...data.request,
  } as unknown as OneUptimeRequest;

  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  let stoppedAt: number = -1;

  for (let index: number = 0; index < recorded.middlewares.length; index++) {
    const next: jest.Mock = jest.fn();

    await recorded.middlewares[index]!(
      req as ExpressRequest,
      res,
      next as unknown as NextFunction,
    );

    if (next.mock.calls.length === 0) {
      stoppedAt = index;
      break;
    }
  }

  const reachedHandler: boolean = stoppedAt === -1;

  if (reachedHandler && data.runHandler) {
    await recorded.handlerFunction(
      req as ExpressRequest,
      res,
      jest.fn() as unknown as NextFunction,
    );
  }

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    stoppedAt: stoppedAt,
    reachedHandler: reachedHandler,
    sentError: errorCalls[0]?.[2] as Exception | undefined,
    sendErrorCallCount: errorCalls.length,
    request: req,
  };
};

/*
 * What a Dashboard tab sends once its access-token cookie has expired: the
 * tenantid header it always attaches, no cookie, no Authorization header, no
 * apikey. The params fill every route parameter in the table with a
 * well-formed id so nothing fails on the path before it fails on the session.
 */
const EXPIRED_SESSION_REQUEST: Dictionary<unknown> = {
  headers: { tenantid: PROJECT_ID, "user-agent": "jest" },
  params: {
    id: PROJECT_ID,
    incidentId: ROW_ID,
    alertId: ROW_ID,
    episodeId: ROW_ID,
    scheduledMaintenanceId: ROW_ID,
  },
  body: { itemId: ROW_ID, code: "123456", userId: USER_ID.toString() },
};

describe("an expired session on every guarded route", () => {
  let consumeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    /*
     * getUserMiddleware records the tenant's last-active time fire-and-forget
     * whenever a tenantid header is present. Stubbed so the anonymous request
     * never reaches Postgres.
     */
    jest
      .spyOn(ProjectService, "updateLastActive")
      .mockResolvedValue(undefined as never);

    /*
     * If the guard ever slips behind a limiter, the limiter would run here.
     * Stubbed so that shows up as a spent-budget assertion failure rather
     * than as a Redis connection error.
     */
    consumeSpy = jest
      .spyOn(VerificationCodeRateLimit, "consume")
      .mockResolvedValue({ outcome: "allowed" } as never);
  });

  test.each(GUARDED_ROUTES)(
    "$method $uri ($registeredBy) answers 401 at the guard, before anything else runs",
    async (route: GuardedRoute) => {
      const result: ChainResult = await runChain({
        route: route,
        request: EXPIRED_SESSION_REQUEST,
      });

      // The premise: getUserMiddleware let the request through as Public.
      expect(result.request.userType).toBe(UserType.Public);

      // The fix: the guard, at index 1, answered it.
      expect(result.stoppedAt).toBe(1);
      expect(result.reachedHandler).toBe(false);
      expect(result.sendErrorCallCount).toBe(1);
      expect(result.sentError).toBeInstanceOf(NotAuthenticatedException);
      expect(result.sentError?.code).toBe(
        ExceptionCode.NotAuthenticatedException,
      );
      expect(result.sentError?.message).toBe(AUTHENTICATION_REQUIRED_MESSAGE);

      // Nothing downstream spent anything.
      expect(consumeSpy).not.toHaveBeenCalled();
    },
  );

  /*
   * The same request without the tenantid header - a call the page makes
   * before a project is selected - must get the same 401, not a
   * "project required" answer.
   */
  test.each(GUARDED_ROUTES)(
    "$method $uri ($registeredBy) answers 401 even without a tenant",
    async (route: GuardedRoute) => {
      const result: ChainResult = await runChain({
        route: route,
        request: { ...EXPIRED_SESSION_REQUEST, headers: {} },
      });

      expect(result.stoppedAt).toBe(1);
      expect(result.sentError).toBeInstanceOf(NotAuthenticatedException);
    },
  );
});

describe("credentialed callers get past the guard on every route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /*
   * requireUserAuthentication is presence-only. Signed-in users obviously,
   * but also project API keys and master admins: automation that already
   * calls these routes with a key must keep working, and whatever the handler
   * then decides about a key is the handler's business, unchanged by this
   * fix.
   */
  const callers: Array<[string, Dictionary<unknown>]> = [
    [
      "a signed-in user",
      {
        userType: UserType.User,
        userAuthorization: { userId: USER_ID } as JSONWebTokenData,
      },
    ],
    ["a project API key", { userType: UserType.API }],
    [
      "a master admin",
      {
        userType: UserType.MasterAdmin,
        userAuthorization: {
          userId: USER_ID,
          isMasterAdmin: true,
        } as JSONWebTokenData,
      },
    ],
  ];

  test.each(GUARDED_ROUTES)(
    "$method $uri ($registeredBy) admits a user, an API key and a master admin",
    async (route: GuardedRoute) => {
      const guard: RouterFunction = findRoute(route).middlewares[1]!;

      for (const [label, caller] of callers) {
        const next: jest.Mock = jest.fn();

        await guard(
          { headers: {}, ...caller } as unknown as ExpressRequest,
          {} as ExpressResponse,
          next as unknown as NextFunction,
        );

        expect({ caller: label, nextCalls: next.mock.calls }).toEqual({
          caller: label,
          nextCalls: [[]],
        });
      }

      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    },
  );
});

/*
 * One route driven end to end, handler included: POST
 * /team-member/remove-user-from-project, because it is destructive and
 * because its handler has its own "Not authenticated" check that answers with
 * a 422. If the guard were missing, the chain would fall through to that
 * handler and the answer would be the 422 - exactly the kind of refusal the
 * browser client does not recover from.
 */
describe("POST /team-member/remove-user-from-project with an expired session", () => {
  const ROUTE: GuardedRoute = {
    method: "POST",
    uri: "/team-member/remove-user-from-project",
    registeredBy: "TeamMemberAPI",
  };

  let deleteBySpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    jest
      .spyOn(ProjectService, "updateLastActive")
      .mockResolvedValue(undefined as never);

    deleteBySpy = jest
      .spyOn(TeamMemberService, "deleteBy")
      .mockResolvedValue(1 as never);
  });

  test("is refused with a 401 and deletes nothing", async () => {
    const result: ChainResult = await runChain({
      route: ROUTE,
      request: {
        headers: { tenantid: PROJECT_ID },
        body: { userId: USER_ID.toString() },
      },
      runHandler: true,
    });

    expect(result.reachedHandler).toBe(false);
    expect(deleteBySpy).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(Response.sendErrorResponse).toHaveBeenCalledWith(
      result.request,
      expect.anything(),
      expect.any(NotAuthenticatedException),
    );
    expect(result.sentError?.code).toBe(401);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  /*
   * The contrast that makes the assertion above meaningful: the same request
   * with the guard skipped reaches the handler, which refuses it with its
   * own 422. That is the answer an expired session used to get.
   */
  test("would have been a 422 from the handler without the guard", async () => {
    const recorded: RecordedRoute = findRoute(ROUTE);

    const req: OneUptimeRequest = {
      params: {},
      query: {},
      cookies: {},
      headers: { tenantid: PROJECT_ID },
      body: { userId: USER_ID.toString() },
    } as unknown as OneUptimeRequest;

    const res: ExpressResponse = {
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    // getUserMiddleware only, then straight to the handler.
    await recorded.middlewares[0]!(
      req as ExpressRequest,
      res,
      jest.fn() as unknown as NextFunction,
    );

    await recorded.handlerFunction(
      req as ExpressRequest,
      res,
      jest.fn() as unknown as NextFunction,
    );

    const sent: Exception = (Response.sendErrorResponse as unknown as jest.Mock)
      .mock.calls[0]![2] as Exception;

    expect(sent.code).toBe(ExceptionCode.NotAuthorizedException);
    expect(deleteBySpy).not.toHaveBeenCalled();
  });
});
