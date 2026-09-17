import UserWebAuthnAPI from "../../../Server/API/UserWebAuthnAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
} from "../../../Server/Middleware/IdentityRateLimit";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import Response from "../../../Server/Utils/Response";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * POST /user-webauthn/generate-authentication-options -- the one route on this
 * API that nobody is signed in for.
 *
 * It has to be anonymous. It is where the challenge a security key signs comes
 * from, and it is needed BEFORE there is any assertion that could prove who is
 * asking. But it was also unmetered, and those are different things: it takes
 * an email address, and for that address it WRITES a challenge to the user's
 * row. Unmetered, one request is one free database write against any address
 * the caller cares to name, as fast as the process will answer.
 *
 * WHAT THIS FILE GUARDS
 *
 *   1. THE LIMITER IS ACTUALLY ON THE ROUTE. Asserted by identity against
 *      `IdentityRateLimit.getMiddleware`, not by counting middlewares -- a
 *      route that grew some other middleware would keep the count at one.
 *
 *   2. IT IS ON *THIS* ROUTE AND NOT THE OTHERS. The two registration routes
 *      are already behind UserMiddleware and are not anonymous; putting a
 *      limiter keyed on an email in front of them would meter a route whose
 *      body carries no email at all, so every signed-in user would share one
 *      bucket.
 *
 *   3. IT USES ITS OWN BUCKET. This route is the step immediately BEFORE
 *      /verify-webauthn-auth, which spends the TwoFactor bucket. Sharing one
 *      pool would mean every challenge a user asked for spent an attempt they
 *      had not yet made -- and, worse, a user who had just exhausted the
 *      shared budget failing at their key could not obtain a fresh challenge
 *      to try again with. The step that exists to enable an attempt must not
 *      be spendable by the attempts it enables. That is the same reasoning
 *      that gives the backup-code route its own counter.
 *
 *   4. THE HANDLER STILL RUNS BEHIND IT. A limiter wired in front of a
 *      handler that no longer works is not an improvement.
 *
 * WHAT IS MOCKED. `UserWebAuthnService.generateAuthenticationOptions` only, so
 * nothing touches Postgres. `IdentityRateLimit` itself is NOT mocked: the
 * assertions here are about which middleware is mounted and which budget it
 * was given, both of which are answered without Redis. What the limiter DOES
 * once it is running -- the two counters, the fail-closed 503 -- belongs to
 * App/Tests/FeatureSet/Identity/IdentityRateLimit.test.ts and is not repeated.
 * ---------------------------------------------------------------------------
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
    setNoCacheHeaders: jest.fn(),
  };
});

const AUTHENTICATION_OPTIONS_ROUTE: string =
  "/user-webauthn/generate-authentication-options";

const REGISTRATION_OPTIONS_ROUTE: string =
  "/user-webauthn/generate-registration-options";

const VERIFY_REGISTRATION_ROUTE: string = "/user-webauthn/verify-registration";

const OPTIONS_FROM_THE_SERVICE: {
  options: unknown;
  challenge: string;
  userId: string;
} = {
  options: { rpId: "example.com", allowCredentials: [] },
  challenge: "a-challenge",
  userId: "44444444-4444-4444-8444-444444444444",
};

/*
 * Captured at module load, before anything spies on it. The route stores the
 * function `getMiddleware` RETURNED at construction time, so comparing against
 * a spy installed later would compare against the wrong object.
 */
let mountedMiddleware: unknown = null;

type CallRouteResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

type CallRouteFunction = (body?: unknown) => Promise<CallRouteResult>;

const callRoute: CallRouteFunction = async (
  body?: unknown,
): Promise<CallRouteResult> => {
  const req: OneUptimeRequest = {
    params: {},
    query: {},
    body:
      body === undefined ? { data: { email: "someone@example.com" } } : body,
    headers: {},
  } as unknown as OneUptimeRequest;

  const res: OneUptimeResponse = {
    send: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as OneUptimeResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", AUTHENTICATION_OPTIONS_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
};

let generateSpy: jest.SpyInstance;

beforeAll(() => {
  mockRouter.routes.length = 0;

  /*
   * Record what `getMiddleware` hands back while the API class is being
   * constructed, so the mounted function can be compared by identity.
   */
  const realGetMiddleware: typeof IdentityRateLimit.getMiddleware =
    IdentityRateLimit.getMiddleware.bind(IdentityRateLimit);

  const capture: jest.SpyInstance = getJestSpyOn(
    IdentityRateLimit,
    "getMiddleware",
  );

  capture.mockImplementation((bucket: unknown): unknown => {
    const middleware: unknown = realGetMiddleware(
      bucket as IdentityRateLimitBucket,
    );
    mountedMiddleware = middleware;
    return middleware;
  });

  new UserWebAuthnAPI();

  capture.mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();

  generateSpy = getJestSpyOn(
    UserWebAuthnService,
    "generateAuthenticationOptions",
  );
  generateSpy.mockResolvedValue(OPTIONS_FROM_THE_SERVICE as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /user-webauthn/generate-authentication-options", () => {
  describe("the limiter in front of it", () => {
    test("has one middleware, and it is the identity rate limiter", () => {
      const route: { middlewares: Array<unknown> } = mockRouter.match(
        "post",
        AUTHENTICATION_OPTIONS_ROUTE,
      );

      expect(route.middlewares).toHaveLength(1);
      expect(route.middlewares[0]).toBe(mountedMiddleware);
    });

    test("is not the user middleware", () => {
      /*
       * Stated explicitly because the obvious "fix" for an anonymous route is
       * to authenticate it, and that would break every sign-in: the challenge
       * has to be obtainable before the assertion that proves who is asking.
       */
      const route: { middlewares: Array<unknown> } = mockRouter.match(
        "post",
        AUTHENTICATION_OPTIONS_ROUTE,
      );

      expect(route.middlewares).not.toContain(UserMiddleware.getUserMiddleware);
    });

    test("spends its own budget, not the two-factor one", () => {
      /*
       * The budgets are separate objects, so identity is the assertion. If
       * this route shared the TwoFactor bucket, a user would get five real
       * sign-in attempts instead of ten -- each challenge spending an attempt
       * they had not made yet -- and a user who had just spent the budget
       * failing at their key could not get a fresh challenge to retry with.
       */
      expect(
        IdentityRateLimit.getBucketConfig(
          IdentityRateLimitBucket.WebAuthnChallenge,
        ),
      ).not.toBe(
        IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.TwoFactor),
      );
    });

    test("does not silently fall through to the login budget", () => {
      /*
       * `getBucketConfig` ends in an unguarded `return LOGIN_BUCKET`, so a
       * bucket added to the enum without a matching branch gets the password
       * budget and nothing anywhere complains. That is a one-line mistake
       * with no other symptom.
       */
      expect(
        IdentityRateLimit.getBucketConfig(
          IdentityRateLimitBucket.WebAuthnChallenge,
        ),
      ).not.toBe(
        IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.Login),
      );
    });

    test("is more generous per account than the routes that check a credential", () => {
      /*
       * Nothing is being guessed here -- the route accepts no credential and
       * can refuse nobody -- and abandoning a prompt is ordinary: a user who
       * touches the wrong key, closes the dialog or reloads asks for another
       * challenge each time. The per-address ceiling is what bounds the
       * writes; the per-account number just must not be so tight that normal
       * fumbling locks someone out of their own sign-in.
       */
      const challengeBudget: { perAccountLimit: number; perIpLimit: number } =
        IdentityRateLimit.getBucketConfig(
          IdentityRateLimitBucket.WebAuthnChallenge,
        );

      const twoFactorBudget: { perAccountLimit: number } =
        IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.TwoFactor);

      expect(challengeBudget.perAccountLimit).toBeGreaterThan(
        twoFactorBudget.perAccountLimit,
      );
      expect(challengeBudget.perIpLimit).toBeGreaterThan(0);
    });
  });

  describe("the routes that are NOT metered this way", () => {
    test.each([
      ["registration options", REGISTRATION_OPTIONS_ROUTE],
      ["verify registration", VERIFY_REGISTRATION_ROUTE],
    ])(
      "%s stays behind the user middleware alone",
      (_name: string, uri: string) => {
        /*
         * Both are authenticated, and neither carries an email in its body --
         * so the limiter's account key would collapse to the same value for
         * every caller and one user's enrolment attempts would throttle
         * everybody's.
         */
        const route: { middlewares: Array<unknown> } = mockRouter.match(
          "post",
          uri,
        );

        expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
      },
    );
  });

  describe("the handler behind the limiter", () => {
    test("still answers with the options for the submitted email", async () => {
      const result: CallRouteResult = await callRoute();

      expect(result.nextCallCount).toBe(0);
      expect(generateSpy).toHaveBeenCalledTimes(1);
      expect((generateSpy.mock.calls[0]![0] as { email: string }).email).toBe(
        "someone@example.com",
      );
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    });

    test("still refuses a request with no email", async () => {
      const result: CallRouteResult = await callRoute({ data: {} });

      expect(result.nextCallCount).toBe(1);
      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(generateSpy).not.toHaveBeenCalled();
    });

    test("still refuses a request with no data at all", async () => {
      const result: CallRouteResult = await callRoute({});

      expect(result.nextCallCount).toBe(1);
      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(generateSpy).not.toHaveBeenCalled();
    });
  });
});
