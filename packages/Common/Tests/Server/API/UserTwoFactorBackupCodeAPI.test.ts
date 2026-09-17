import UserTwoFactorBackupCodeAPI from "../../../Server/API/UserTwoFactorBackupCodeAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import UserTwoFactorBackupCodeService, {
  TwoFactorBackupCodeStatus,
} from "../../../Server/Services/UserTwoFactorBackupCodeService";
import TwoFactorBackupCode from "../../../Server/Utils/TwoFactorBackupCode";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import MailService from "../../../Server/Services/MailService";
import UserService from "../../../Server/Services/UserService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import Dictionary from "../../../Types/Dictionary";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The two self-service routes a signed-in user drives from their profile page:
 * POST /user-two-factor-backup-code/generate and
 * GET  /user-two-factor-backup-code/status.
 *
 * WHAT THIS FILE GUARDS
 *
 * Three failure modes, all of which leave the suite green if nobody asserts
 * them here.
 *
 *   1. THE OWNER IS TAKEN FROM THE TOKEN, NOT FROM THE REQUEST. There is no
 *      `:userId` in either path today, which is what makes both routes safe --
 *      but "safe because there is no parameter to abuse" is a property that
 *      evaporates the moment somebody adds one, or reaches for
 *      `req.body["userId"]` to make the admin page reuse the endpoint. Two
 *      matrices below therefore send a DIFFERENT user id in the params, the
 *      query and the body at once and assert the service was still called with
 *      the id off the access token. Generate is destructive -- it throws away
 *      every code the caller was holding -- so a route steered by its own body
 *      would let any signed-in user strip a stranger's recovery codes with one
 *      request, and the victim would find out at the next sign-in they could
 *      not complete.
 *
 *   2. THE PLAINTEXT CODES NEVER REACH THE LOGGER. `regenerateForUser` returns
 *      the only copy of the codes that will ever exist, and the handler logs a
 *      line right next to it. Widening that line to "regenerated codes: ..."
 *      while debugging is a one-word edit that puts sign-in credentials into
 *      stdout, the recent-log buffer and telemetry at once, and no other test
 *      in the repository would notice.
 *
 *   3. `replacedCodeCount` IS READ BEFORE THE OLD SET IS DESTROYED. Read
 *      afterwards it reports the size of the set that was just MINTED, so the
 *      page tells a user "10 codes replaced" whether or not they had any --
 *      and the first-time user who had none is told they have just invalidated
 *      a list they should go and find.
 *
 * WHAT IS MOCKED, AND WHAT IS DELIBERATELY NOT
 *
 * `UserTwoFactorBackupCodeService` is spied on at the singleton, so nothing
 * touches Postgres and the plaintext codes are fixed strings this file can
 * search the logger output for.
 *
 * `TwoFactorBackupCode` is NOT mocked. `formatForDisplay` is the thing the
 * generate route's contract with the page is made of -- the hyphen is what
 * makes a ten character run transcribable off a screen -- and a stubbed
 * formatter would make the assertion about it circular.
 *
 * `Response` is mocked so payloads can be read off the call, and `logger` is
 * spied on rather than silenced so its arguments can be inspected.
 *
 * SIBLING FILES, SO NOTHING HERE IS DUPLICATED
 *
 *  - Common/Tests/Server/Utils/TwoFactorBackupCode.test.ts owns the alphabet,
 *    the code space, the HMAC construction and normalization. The ONLY thing
 *    this file borrows from that module is `formatForDisplay`, and only as the
 *    route's output contract.
 *  - Common/Tests/Server/Services/UserTwoFactorBackupCodeService.test.ts owns
 *    minting, the single conditional UPDATE that makes a code single-use, and
 *    the counting queries. Both service methods are stubbed here.
 *  - Common/Tests/Server/Services/UserTwoFactorBackupCodeAdminSurface.test.ts
 *    owns the UserService side: the reset that must take the codes with it,
 *    and `unusedTwoFactorBackupCodeCount` on the authentication status.
 *  - App/Tests/FeatureSet/Identity/BackupCodeLoginVerification.test.ts owns
 *    POST /verify-backup-code -- the SPENDING of a code. Nothing about login
 *    is exercised from here.
 *  - Common/Tests/Server/API/UserTwoFactorAuthAdminAPI.test.ts owns the
 *    master-admin routes that drive somebody ELSE's two factor auth, and
 *    Common/Tests/Server/API/UserTotpAuthAPI.test.ts owns the other
 *    self-service two factor route -- including the ownership check it needs
 *    BECAUSE it takes a record id from the body, which is the design the two
 *    routes here avoid having to get right.
 *
 * What is left, and what this file is entirely about, is the two HTTP handlers
 * around all of that.
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
    sendFileByPath: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const GENERATE_ROUTE: string = "/user-two-factor-backup-code/generate";
const STATUS_ROUTE: string = "/user-two-factor-backup-code/status";

const CALLER_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

/*
 * The id an attacker puts in the body, the params and the query hoping the
 * handler reads one of them instead of the token.
 */
const SOMEBODY_ELSE_ID: string = "22222222-2222-4222-8222-222222222222";

/*
 * What the service hands back. Fixed rather than generated so the logger
 * assertion has an exact needle to search for -- a random code would make
 * "the codes were not logged" depend on a string this file cannot pin down.
 *
 * Ten of them because that is the real set size, but the count is the
 * service's business: the route maps over whatever it is given.
 */
const PLAINTEXT_CODES: Array<string> = [
  "2W9XKQ4M7B",
  "H3TRZ5D8NC",
  "P6JVG2YK4S",
  "B8NQ7MXW3T",
  "F5RD9CZH2K",
  "T4KY6BVN8P",
  "M2XS5GQJ7W",
  "C9HB3NPR6D",
  "Z7VM4TKG5X",
  "K3PC8WYS9N",
];

/*
 * The shape the page renders as-is: two groups of five over the backup code
 * alphabet, joined by the hyphen that makes a ten character run transcribable
 * off a screen. Written out as a literal here rather than derived from
 * `formatForDisplay`, so that a formatter reduced to the identity function
 * fails the assertion instead of agreeing with itself.
 */
const DISPLAY_FORM: RegExp = /^[0-9A-Z]{5}-[0-9A-Z]{5}$/;

const PREVIOUS_SET_GENERATED_AT: Date = new Date("2026-01-02T03:04:05.678Z");
const NEW_SET_GENERATED_AT: Date = new Date("2026-08-25T09:10:11.222Z");

/*
 * What the user was holding before they pressed the button: a partly spent set
 * of four. Both numbers are deliberately NOT ten, so a handler that reported
 * the size of the new set instead of the old one is visible in the assertion
 * rather than coincidentally equal to it.
 */
const PREVIOUS_STATUS: TwoFactorBackupCodeStatus = {
  total: 4,
  unused: 1,
  generatedAt: PREVIOUS_SET_GENERATED_AT,
};

const FRESH_STATUS: TwoFactorBackupCodeStatus = {
  total: PLAINTEXT_CODES.length,
  unused: PLAINTEXT_CODES.length,
  generatedAt: NEW_SET_GENERATED_AT,
};

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

type CallRouteOptions = {
  method: string;
  route: string;
  params?: Dictionary<string> | undefined;
  query?: Dictionary<string> | undefined;
  body?: Dictionary<unknown> | undefined;

  /*
   * Spliced onto the request in place of the default signed-in caller. An
   * EMPTY object is a request with no `userAuthorization` property at all,
   * which is what reaches the handler if the middleware in front of it is ever
   * removed.
   */
  authorization?: Dictionary<unknown> | undefined;
};

type CallRouteFunction = (data: CallRouteOptions) => Promise<RouteCallResult>;

const callRoute: CallRouteFunction = async (
  data: CallRouteOptions,
): Promise<RouteCallResult> => {
  const req: OneUptimeRequest = {
    params: data.params || {},
    query: data.query || {},
    body: data.body || {},
    headers: {},
    ...(data.authorization || { userAuthorization: { userId: CALLER_ID } }),
  } as unknown as OneUptimeRequest;

  const res: OneUptimeResponse = {
    send: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as OneUptimeResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match(data.method, data.route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
};

type AsMockFunction = (fn: unknown) => jest.Mock;

const asMock: AsMockFunction = (fn: unknown): jest.Mock => {
  return fn as unknown as jest.Mock;
};

type SentJsonObjectFunction = () => JSONObject;

const sentJsonObject: SentJsonObjectFunction = (): JSONObject => {
  const call: Array<unknown> | undefined = asMock(
    Response.sendJsonObjectResponse,
  ).mock.calls[0];

  return (call?.[2] as JSONObject) || {};
};

type ServiceCallArgument = { userId: ObjectID };

type FirstServiceArgumentFunction = (
  spy: jest.SpyInstance,
) => ServiceCallArgument;

const firstServiceArgument: FirstServiceArgumentFunction = (
  spy: jest.SpyInstance,
): ServiceCallArgument => {
  return spy.mock.calls[0]![0] as ServiceCallArgument;
};

/*
 * Every level, not just `info`. The handler logs through `info` today, but a
 * future `logger.debug("codes", codes)` added while chasing a support ticket
 * is exactly the edit this guard exists to catch, and it would not go through
 * `info`.
 */
type LoggerLevel = "info" | "warn" | "error" | "debug" | "trace";

const LOGGER_LEVELS: Array<LoggerLevel> = [
  "info",
  "warn",
  "error",
  "debug",
  "trace",
];

let loggerSpies: Array<jest.SpyInstance> = [];

type StringifyLogArgumentFunction = (value: unknown) => string;

const stringifyLogArgument: StringifyLogArgumentFunction = (
  value: unknown,
): string => {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) || String(value);
  } catch {
    return String(value);
  }
};

/*
 * Everything the handler passed to the logger, flattened into one string so a
 * code can be searched for wherever it might have been smuggled -- a template
 * literal, a second attributes argument, or an object nested inside one.
 */
type LoggerHaystackFunction = () => string;

const loggerHaystack: LoggerHaystackFunction = (): string => {
  const lines: Array<string> = [];

  for (const spy of loggerSpies) {
    for (const call of spy.mock.calls) {
      lines.push(
        (call as Array<unknown>)
          .map((argument: unknown): string => {
            return stringifyLogArgument(argument);
          })
          .join(" "),
      );
    }
  }

  return lines.join("\n");
};

type LoggerCallCountFunction = () => number;

const loggerCallCount: LoggerCallCountFunction = (): number => {
  return loggerSpies.reduce((total: number, spy: jest.SpyInstance): number => {
    return total + spy.mock.calls.length;
  }, 0);
};

/*
 * A signed-in caller trying to aim either route at somebody else, through
 * every channel a handler could plausibly read an id from. The assertion is
 * always the same: the service saw the TOKEN's id.
 */
type ImpersonationAttempt = {
  params: Dictionary<string>;
  query: Dictionary<string>;
  body: Dictionary<unknown>;
};

const IMPERSONATION_ATTEMPTS: Array<[string, ImpersonationAttempt]> = [
  [
    "a userId in the body",
    { params: {}, query: {}, body: { userId: SOMEBODY_ELSE_ID } },
  ],
  [
    "a userId in the route params",
    { params: { userId: SOMEBODY_ELSE_ID }, query: {}, body: {} },
  ],
  [
    "a userId in the query string",
    { params: {}, query: { userId: SOMEBODY_ELSE_ID }, body: {} },
  ],
  [
    "an id and a _id as well as a userId",
    {
      params: { id: SOMEBODY_ELSE_ID, userId: SOMEBODY_ELSE_ID },
      query: { _id: SOMEBODY_ELSE_ID },
      body: {
        id: SOMEBODY_ELSE_ID,
        _id: SOMEBODY_ELSE_ID,
        userId: SOMEBODY_ELSE_ID,
      },
    },
  ],
  [
    "a props.isRoot smuggled alongside the userId",
    {
      params: {},
      query: {},
      body: { userId: SOMEBODY_ELSE_ID, props: { isRoot: true } },
    },
  ],
];

/*
 * Requests that must not reach the service at all. `userAuthorization` is put
 * there by UserMiddleware; every shape below is what the handler sees if that
 * middleware is removed, short-circuited, or fails open -- and the handler is
 * the second lock, so it has to refuse rather than build an ObjectID out of
 * nothing.
 */
const UNAUTHENTICATED_REQUESTS: Array<[string, Dictionary<unknown>]> = [
  ["the userAuthorization property is absent entirely", {}],
  ["userAuthorization is undefined", { userAuthorization: undefined }],
  ["userAuthorization is null", { userAuthorization: null }],
  ["userAuthorization carries no userId", { userAuthorization: {} }],
  [
    "userAuthorization.userId is undefined",
    { userAuthorization: { userId: undefined } },
  ],
  ["userAuthorization.userId is null", { userAuthorization: { userId: null } }],
  [
    "userAuthorization.userId is an empty string",
    { userAuthorization: { userId: "" } },
  ],
];

let getStatusSpy: jest.SpyInstance;
let regenerateSpy: jest.SpyInstance;
let sendMailSpy: jest.SpyInstance;
let findUserSpy: jest.SpyInstance;

/* The address the notification is expected to reach. */
const OWNER_EMAIL: string = "owner@example.com";

/*
 * Let the DETACHED notification run.
 *
 * `notifyCodesRegenerated` is fired without being awaited, so that an
 * unreachable mail server cannot fail a regeneration whose response carries
 * the only copy of the new codes. That also puts it out of reach of a plain
 * `await` on the handler, so the queue has to be drained explicitly rather
 * than relied on to have drained by luck.
 */
type FlushDetachedWorkFunction = () => Promise<void>;

const flushDetachedWork: FlushDetachedWorkFunction =
  async (): Promise<void> => {
    for (let tick: number = 0; tick < 10; tick++) {
      await Promise.resolve();
    }
  };

beforeAll(() => {
  mockRouter.routes.length = 0;
  new UserTwoFactorBackupCodeAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  getStatusSpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "getStatusForUser",
  );
  getStatusSpy.mockResolvedValue(PREVIOUS_STATUS as never);

  regenerateSpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "regenerateForUser",
  );
  regenerateSpy.mockResolvedValue(PLAINTEXT_CODES as never);

  /*
   * The regeneration notification reads the owner's address and mails it.
   * Stubbed rather than left real because there is no database and no SMTP
   * here -- and because an un-stubbed detached failure would surface as an
   * unhandled rejection in an unrelated test.
   */
  findUserSpy = getJestSpyOn(UserService, "findOneById");
  findUserSpy.mockImplementation(async (): Promise<User> => {
    const user: User = new User();
    user.email = new Email(OWNER_EMAIL);
    return user;
  });

  sendMailSpy = getJestSpyOn(MailService, "sendMail");
  sendMailSpy.mockResolvedValue(undefined as never);

  getJestSpyOn(DatabaseConfig, "getHost").mockImplementation(
    async (): Promise<Hostname> => {
      return new Hostname("localhost");
    },
  );

  getJestSpyOn(DatabaseConfig, "getHttpProtocol").mockImplementation(
    async (): Promise<Protocol> => {
      return Protocol.HTTP;
    },
  );

  loggerSpies = LOGGER_LEVELS.map((level: LoggerLevel): jest.SpyInstance => {
    return getJestSpyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserTwoFactorBackupCodeAPI route registration", () => {
  test("registers both routes", () => {
    /*
     * A typo in either path is not a compile error. It is a 404 the profile
     * page surfaces as an unexplained failure the first time somebody tries to
     * find out whether they have any recovery codes.
     */
    const violations: Array<string> = [];

    if (
      !mockRouter.routes.some((route: { method: string; uri: string }) => {
        return route.method === "POST" && route.uri === GENERATE_ROUTE;
      })
    ) {
      violations.push(`POST ${GENERATE_ROUTE} is not registered`);
    }

    if (
      !mockRouter.routes.some((route: { method: string; uri: string }) => {
        return route.method === "GET" && route.uri === STATUS_ROUTE;
      })
    ) {
      violations.push(`GET ${STATUS_ROUTE} is not registered`);
    }

    expect(violations).toEqual([]);
  });

  test("generate is a POST and not a GET", () => {
    /*
     * Generating throws away every code the user is currently holding. As a
     * GET, a browser prefetch or a link crawler would silently void a list
     * somebody printed -- a lockout with no user action behind it.
     */
    expect(() => {
      return mockRouter.match("GET", GENERATE_ROUTE);
    }).toThrow();
  });

  test("both routes put UserMiddleware.getUserMiddleware in front of the handler", () => {
    /*
     * This is the middleware that puts `userAuthorization` on the request.
     * Without it the handler's own check would be the only lock, and while
     * that check does refuse an anonymous caller, the codes route would then
     * be answering unauthenticated traffic all the way down to the point of
     * refusal. Asserted by IDENTITY rather than by counting: swapping it for a
     * different middleware keeps the count at one.
     */
    const violations: Array<string> = [];

    const routes: Array<[string, string]> = [
      ["POST", GENERATE_ROUTE],
      ["GET", STATUS_ROUTE],
    ];

    for (const [method, uri] of routes) {
      const route: {
        middlewares: Array<unknown>;
        middleware: unknown;
        handlerFunction: unknown;
      } = mockRouter.match(method, uri);

      if (route.middlewares.length !== 1) {
        violations.push(
          `${method} ${uri} has ${route.middlewares.length} middlewares, expected exactly 1`,
        );
      }

      if (route.middleware !== UserMiddleware.getUserMiddleware) {
        violations.push(
          `${method} ${uri} is not gated by UserMiddleware.getUserMiddleware`,
        );
      }

      if (route.handlerFunction === UserMiddleware.getUserMiddleware) {
        violations.push(
          `${method} ${uri} registered the middleware as its handler -- the handler is missing`,
        );
      }

      if (typeof route.handlerFunction !== "function") {
        violations.push(`${method} ${uri} has no handler function`);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("POST /user-two-factor-backup-code/generate", () => {
  test("returns the plaintext codes the service minted", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: GENERATE_ROUTE,
    });

    const payload: JSONObject = sentJsonObject();

    expect(result.nextCallCount).toBe(0);
    expect(payload["codes"]).toEqual(
      PLAINTEXT_CODES.map((code: string): string => {
        return TwoFactorBackupCode.formatForDisplay(code);
      }),
    );
  });

  test("hands back every code, in order, with none dropped", async () => {
    /*
     * The response is the ONLY copy. A map that quietly lost one -- a filter
     * that crept in, a slice for a "preview" -- means the user prints nine
     * codes and the tenth exists only as a digest nobody can ever satisfy.
     */
    await callRoute({ method: "POST", route: GENERATE_ROUTE });

    const codes: Array<string> = sentJsonObject()["codes"] as Array<string>;

    expect(codes).toHaveLength(PLAINTEXT_CODES.length);
    expect(
      codes.map((code: string): string => {
        return code.replace("-", "");
      }),
    ).toEqual(PLAINTEXT_CODES);
  });

  test("formats every code for display rather than shipping the raw run", async () => {
    /*
     * The hyphen is the whole reason `formatForDisplay` exists: a ten
     * character run is transcribed wrongly off a screen, and these get typed
     * back in months later off a piece of paper. Asserted against a literal
     * pattern rather than by calling the formatter again, so that a formatter
     * reduced to the identity function fails here instead of agreeing with
     * itself.
     */
    await callRoute({ method: "POST", route: GENERATE_ROUTE });

    const codes: Array<string> = sentJsonObject()["codes"] as Array<string>;

    const violations: Array<string> = [];

    codes.forEach((code: string, index: number): void => {
      if (!DISPLAY_FORM.test(code)) {
        violations.push(`code ${index} is not in the display form: ${code}`);
      }

      if (code === PLAINTEXT_CODES[index]) {
        violations.push(
          `code ${index} was sent unformatted -- formatForDisplay was not applied`,
        );
      }
    });

    expect(violations).toEqual([]);
    expect(codes.length).toBeGreaterThan(0);
  });

  test("regenerates for the caller on the access token", async () => {
    await callRoute({ method: "POST", route: GENERATE_ROUTE });

    expect(regenerateSpy).toHaveBeenCalledTimes(1);
    expect(firstServiceArgument(regenerateSpy).userId.toString()).toBe(
      CALLER_ID.toString(),
    );
  });

  test.each(IMPERSONATION_ATTEMPTS)(
    "regenerates for the token's user even when the request carries %s",
    async (_label: string, attempt: ImpersonationAttempt): Promise<void> => {
      /*
       * The destructive direction of the ownership rule. A handler that read
       * an id off the request would let any signed-in user throw away a
       * stranger's recovery codes, and the victim only finds out at the sign-in
       * they can no longer complete.
       */
      await callRoute({
        method: "POST",
        route: GENERATE_ROUTE,
        params: attempt.params,
        query: attempt.query,
        body: attempt.body,
      });

      const violations: Array<string> = [];

      if (regenerateSpy.mock.calls.length !== 1) {
        violations.push(
          `regenerateForUser was called ${regenerateSpy.mock.calls.length} times, expected exactly 1`,
        );
      }

      const suppliedUserId: string =
        firstServiceArgument(regenerateSpy).userId.toString();

      if (suppliedUserId === SOMEBODY_ELSE_ID) {
        violations.push(
          "regenerateForUser was aimed at the id supplied by the request",
        );
      }

      if (suppliedUserId !== CALLER_ID.toString()) {
        violations.push(
          `regenerateForUser was called with ${suppliedUserId}, expected the token's ${CALLER_ID.toString()}`,
        );
      }

      const statusUserId: string =
        firstServiceArgument(getStatusSpy).userId.toString();

      if (statusUserId !== CALLER_ID.toString()) {
        violations.push(
          `getStatusForUser was called with ${statusUserId}, expected the token's ${CALLER_ID.toString()}`,
        );
      }

      expect(violations).toEqual([]);
    },
  );

  test("passes exactly a userId to the service and nothing else", async () => {
    /*
     * `regenerateForUser` also takes a `count`. Forwarded from the body, a
     * caller could ask for one code -- an account with a single recovery code
     * is one bad sign-in away from needing an administrator -- or for a number
     * large enough to make the request a write amplification lever.
     */
    await callRoute({
      method: "POST",
      route: GENERATE_ROUTE,
      body: { count: 1, userId: SOMEBODY_ELSE_ID, props: { isRoot: true } },
    });

    expect(Object.keys(firstServiceArgument(regenerateSpy))).toEqual([
      "userId",
    ]);
  });

  test("regenerates exactly once per request", async () => {
    /*
     * Two calls would mean the codes returned to the user are from the FIRST
     * set and the codes in the database are from the second -- every code the
     * page just displayed already invalid.
     */
    await callRoute({ method: "POST", route: GENERATE_ROUTE });

    expect(regenerateSpy).toHaveBeenCalledTimes(1);
    expect(asMock(Response.sendJsonObjectResponse)).toHaveBeenCalledTimes(1);
  });

  test("reports replacedCodeCount from the status read BEFORE regenerating", async () => {
    /*
     * The status here is LIVE: regenerating swaps what `getStatusForUser`
     * would answer. A handler that read the count after minting the new set
     * would report ten and the page would tell a first-time user they had just
     * invalidated a list they never had.
     */
    const store: { current: TwoFactorBackupCodeStatus } = {
      current: PREVIOUS_STATUS,
    };

    getStatusSpy.mockImplementation(
      async (): Promise<TwoFactorBackupCodeStatus> => {
        return store.current;
      },
    );

    regenerateSpy.mockImplementation(async (): Promise<Array<string>> => {
      store.current = FRESH_STATUS;
      return PLAINTEXT_CODES;
    });

    await callRoute({ method: "POST", route: GENERATE_ROUTE });

    const payload: JSONObject = sentJsonObject();

    const violations: Array<string> = [];

    if (payload["replacedCodeCount"] !== PREVIOUS_STATUS.total) {
      violations.push(
        `replacedCodeCount was ${String(payload["replacedCodeCount"])}, expected the previous set's ${PREVIOUS_STATUS.total}`,
      );
    }

    if (payload["replacedCodeCount"] === FRESH_STATUS.total) {
      violations.push(
        "replacedCodeCount reports the size of the set that was just minted",
      );
    }

    const statusOrder: number = getStatusSpy.mock.invocationCallOrder[0]!;
    const regenerateOrder: number = regenerateSpy.mock.invocationCallOrder[0]!;

    if (statusOrder > regenerateOrder) {
      violations.push("the status was read after the old set was destroyed");
    }

    expect(violations).toEqual([]);
  });

  test("reports zero replaced codes for a user who had none", async () => {
    /*
     * The first-time case, and the one the number is most useful in: the page
     * must not warn somebody that they have invalidated codes they never
     * generated. Zero is also the value most easily lost on the way out, by a
     * serializer that drops falsy fields.
     */
    getStatusSpy.mockResolvedValue({
      total: 0,
      unused: 0,
      generatedAt: null,
    } as never);

    await callRoute({ method: "POST", route: GENERATE_ROUTE });

    const payload: JSONObject = sentJsonObject();

    expect(Object.keys(payload)).toContain("replacedCodeCount");
    expect(payload["replacedCodeCount"]).toBe(0);
  });

  test("sends only the codes and the replaced count", async () => {
    /*
     * Nothing else belongs in this payload. The status object it is built from
     * is the service's, and forwarding it wholesale is how a field nobody
     * reviewed ends up on the wire next to the credentials.
     */
    await callRoute({ method: "POST", route: GENERATE_ROUTE });

    expect(Object.keys(sentJsonObject()).sort()).toEqual([
      "codes",
      "replacedCodeCount",
    ]);
  });

  test("never passes the plaintext codes to the logger", async () => {
    /*
     * THE reason this file exists. Logger output reaches stdout, the
     * recent-log buffer and telemetry at once, and a backup code is a
     * password-equivalent credential -- one in a log line is a sign-in
     * somebody else can complete. The fact that a set was minted IS worth
     * recording, so the assertion is about the codes, not about silence.
     */
    await callRoute({ method: "POST", route: GENERATE_ROUTE });

    const haystack: string = loggerHaystack();

    const violations: Array<string> = [];

    for (const code of PLAINTEXT_CODES) {
      if (haystack.includes(code)) {
        violations.push(`a plaintext backup code reached the logger: ${code}`);
      }

      const displayForm: string = TwoFactorBackupCode.formatForDisplay(code);

      if (haystack.includes(displayForm)) {
        violations.push(
          `a backup code reached the logger in its display form: ${displayForm}`,
        );
      }
    }

    expect(violations).toEqual([]);

    /*
     * The guards that stop the assertion above from passing vacuously. If the
     * spies stopped capturing -- a renamed logger, a handler that stopped
     * logging, a `restoreAllMocks` in the wrong place -- the haystack would be
     * empty and `includes` would find nothing no matter what was logged. The
     * user id is in the real log line, so finding it proves the haystack is
     * the handler's actual output.
     */
    expect(loggerCallCount()).toBeGreaterThan(0);
    expect(haystack).toContain(CALLER_ID.toString());
  });

  test.each(UNAUTHENTICATED_REQUESTS)(
    "throws NotAuthenticatedException when %s",
    async (
      _label: string,
      authorization: Dictionary<unknown>,
    ): Promise<void> => {
      /*
       * "No caller" cannot be a request this route proceeds with: there is no
       * user whose codes it would be replacing. It has to refuse rather than
       * build an ObjectID out of undefined and hand it to a delete.
       */
      const result: RouteCallResult = await callRoute({
        method: "POST",
        route: GENERATE_ROUTE,
        authorization: authorization,
      });

      const violations: Array<string> = [];

      if (!(result.thrownToNext instanceof NotAuthenticatedException)) {
        violations.push(
          `expected a NotAuthenticatedException, got ${String(result.thrownToNext)}`,
        );
      }

      if (result.nextCallCount !== 1) {
        violations.push(
          `next() was called ${result.nextCallCount} times, expected exactly 1`,
        );
      }

      if (regenerateSpy.mock.calls.length > 0) {
        violations.push(
          "an unauthenticated request reached regenerateForUser -- codes were destroyed",
        );
      }

      if (getStatusSpy.mock.calls.length > 0) {
        violations.push("an unauthenticated request reached getStatusForUser");
      }

      if (asMock(Response.sendJsonObjectResponse).mock.calls.length > 0) {
        violations.push("an unauthenticated request was answered with codes");
      }

      expect(violations).toEqual([]);
    },
  );

  test("passes a regeneration failure to next() rather than reporting success", async () => {
    /*
     * `regenerateForUser` deletes the old set before it writes the new one. A
     * failure in the middle leaves the account with NO codes, so reporting
     * success would tell a user they now hold ten codes that do not exist --
     * and they would stop looking for the problem.
     */
    const failure: Error = new Error("deadlock detected");

    regenerateSpy.mockRejectedValue(failure as never);

    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: GENERATE_ROUTE,
    });

    expect(result.thrownToNext).toBe(failure);
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("passes a status-read failure to next() without destroying anything", async () => {
    /*
     * The status read happens first. If it fails, the old codes must still be
     * there afterwards -- a route that pressed on would have thrown away a
     * working set in service of a number it only needed for a label.
     */
    const failure: Error = new Error("connection terminated unexpectedly");

    getStatusSpy.mockRejectedValue(failure as never);

    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: GENERATE_ROUTE,
    });

    expect(result.thrownToNext).toBe(failure);
    expect(result.nextCallCount).toBe(1);
    expect(regenerateSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("POST /user-two-factor-backup-code/generate -- telling the owner", () => {
  /*
   * WHY THIS ROUTE NEEDS A NOTIFICATION AT ALL.
   *
   * It is the destructive one, and it is the one with the least standing in
   * front of it: a session alone -- no password, no second factor -- voids
   * every recovery code the user is holding. Somebody who has stolen a session
   * can therefore remove the owner's way back in, silently, and the owner
   * finds out at the next sign-in they cannot complete.
   *
   * The mail does not prevent that. It makes it visible, in a channel the
   * person driving the browser does not control -- the same bargain the
   * "a backup code was used" mail strikes on the login path.
   */
  test("mails the owner that their previous codes have stopped working", async () => {
    await callRoute({ method: "POST", route: GENERATE_ROUTE });
    await flushDetachedWork();

    const violations: Array<string> = [];

    if (sendMailSpy.mock.calls.length !== 1) {
      violations.push(
        `expected exactly one mail, saw ${String(sendMailSpy.mock.calls.length)}`,
      );
    }

    const sent: {
      toEmail: Email;
      templateType: EmailTemplateType;
      vars: Dictionary<string>;
    } = (sendMailSpy.mock.calls[0] as Array<unknown>)[0] as {
      toEmail: Email;
      templateType: EmailTemplateType;
      vars: Dictionary<string>;
    };

    if (
      sent?.templateType !== EmailTemplateType.TwoFactorBackupCodesRegenerated
    ) {
      violations.push(`wrong template: ${String(sent?.templateType)}`);
    }

    if (sent?.vars?.["newCodeCount"] !== String(PLAINTEXT_CODES.length)) {
      violations.push(
        `the mail reported ${String(sent?.vars?.["newCodeCount"])} new codes rather than ${String(PLAINTEXT_CODES.length)}`,
      );
    }

    expect(violations).toEqual([]);
  });

  /*
   * The address comes off the ACCOUNT, never off the request. The only thing
   * the caller proved is which user they are; a notification steered by their
   * own body would go to the attacker rather than to the person being robbed
   * of their recovery codes -- which is worse than not sending one, because it
   * looks from the logs as though the owner was told.
   */
  test("sends to the address on the account, not to anything in the request", async () => {
    await callRoute({
      method: "POST",
      route: GENERATE_ROUTE,
      body: { email: "attacker@example.com" },
      params: { email: "attacker@example.com" },
      query: { email: "attacker@example.com" },
    });
    await flushDetachedWork();

    const sent: { toEmail: Email } = (
      sendMailSpy.mock.calls[0] as Array<unknown>
    )[0] as { toEmail: Email };

    expect(sent.toEmail.toString()).toBe(OWNER_EMAIL);

    expect(findUserSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CALLER_ID,
      }),
    );
  });

  /*
   * The codes are in the RESPONSE and nowhere else -- not in the database, not
   * recoverable by an operator. A mail that carried them would put the entire
   * recovery set into an inbox and into every hop between here and it, which
   * is precisely the exposure hashing them was for.
   */
  test("never puts a code in the mail", async () => {
    await callRoute({ method: "POST", route: GENERATE_ROUTE });
    await flushDetachedWork();

    const haystack: string = JSON.stringify(sendMailSpy.mock.calls);

    // Guard: an empty haystack would make every assertion below vacuous.
    expect(haystack.length).toBeGreaterThan(20);

    const leaked: Array<string> = PLAINTEXT_CODES.filter((code: string) => {
      return haystack.includes(code);
    });

    expect(leaked).toEqual([]);
  });

  /*
   * The response carries the ONLY copy of the new codes. Failing the request
   * because SMTP is unreachable would throw them away -- while the old set has
   * already been destroyed, so the user would be left with no working codes at
   * all and no way to see the ones that replaced them.
   */
  test("still returns the codes when the mail cannot be sent", async () => {
    sendMailSpy.mockRejectedValue(new Error("SMTP is unreachable") as never);

    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: GENERATE_ROUTE,
    });
    await flushDetachedWork();

    const violations: Array<string> = [];

    if (result.nextCallCount !== 0) {
      violations.push(
        `the mail failure escaped to next(): ${String(result.thrownToNext)}`,
      );
    }

    const payload: JSONObject = sentJsonObject();

    if (!Array.isArray(payload["codes"])) {
      violations.push("no codes were returned to the caller");
    }

    expect(violations).toEqual([]);
  });

  /*
   * Same hazard one step earlier: the address lookup is a database round trip,
   * and it happens after the old codes are already gone.
   */
  test("still returns the codes when the owner cannot be looked up", async () => {
    findUserSpy.mockRejectedValue(new Error("Database not connected") as never);

    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: GENERATE_ROUTE,
    });
    await flushDetachedWork();

    expect(result.nextCallCount).toBe(0);
    expect(Array.isArray(sentJsonObject()["codes"])).toBe(true);
  });
});

describe("GET /user-two-factor-backup-code/status", () => {
  test("reports the total, the unused count and when the set was minted", async () => {
    getStatusSpy.mockResolvedValue({
      total: 10,
      unused: 7,
      generatedAt: PREVIOUS_SET_GENERATED_AT,
    } as never);

    const result: RouteCallResult = await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
    });

    expect(result.nextCallCount).toBe(0);
    expect(sentJsonObject()).toEqual({
      total: 10,
      unused: 7,
      generatedAt: "2026-01-02T03:04:05.678Z",
    });
  });

  test("sends generatedAt as an ISO string rather than a Date", async () => {
    /*
     * A Date survives `JSON.stringify` as an ISO string by accident, so this
     * looks the same from a browser today -- until something in the response
     * path starts formatting dates in the server's locale, at which point the
     * page's parse silently starts producing Invalid Date. Serializing here is
     * what makes the wire format the route's decision rather than the
     * serializer's.
     */
    getStatusSpy.mockResolvedValue({
      total: 10,
      unused: 10,
      generatedAt: NEW_SET_GENERATED_AT,
    } as never);

    await callRoute({ method: "GET", route: STATUS_ROUTE });

    const generatedAt: unknown = sentJsonObject()["generatedAt"];

    expect(typeof generatedAt).toBe("string");
    expect(generatedAt).toBe(NEW_SET_GENERATED_AT.toISOString());
  });

  test("sends a null generatedAt when the user has no codes", async () => {
    /*
     * The account that has never generated any. `null` is a fact the page
     * renders as "no backup codes yet"; an absent key is indistinguishable
     * from a field the page failed to load, and a `new Date(undefined)` on the
     * way out would be an Invalid Date rendered as a real one.
     */
    getStatusSpy.mockResolvedValue({
      total: 0,
      unused: 0,
      generatedAt: null,
    } as never);

    await callRoute({ method: "GET", route: STATUS_ROUTE });

    const payload: JSONObject = sentJsonObject();

    expect(Object.keys(payload).sort()).toEqual([
      "generatedAt",
      "total",
      "unused",
    ]);
    expect(payload["generatedAt"]).toBeNull();
  });

  test("keeps zero counts rather than dropping them", async () => {
    /*
     * A user who has spent all ten codes reads `total: 10, unused: 0`, and
     * that zero is the whole reason they are being told to regenerate. Lost on
     * the way out, the page cannot tell them apart from a user with codes to
     * spare.
     */
    getStatusSpy.mockResolvedValue({
      total: 10,
      unused: 0,
      generatedAt: PREVIOUS_SET_GENERATED_AT,
    } as never);

    await callRoute({ method: "GET", route: STATUS_ROUTE });

    const payload: JSONObject = sentJsonObject();

    expect(Object.keys(payload)).toContain("unused");
    expect(payload["unused"]).toBe(0);
    expect(payload["total"]).toBe(10);
  });

  test("sets the no-cache headers before the payload goes out", async () => {
    /*
     * Headers written after the body has been sent are ignored, so the ORDER
     * is the protection rather than merely that both calls happened. A stale
     * "you have 8 codes left" served out of a browser cache to somebody who
     * has just regenerated is a user who concludes the button did nothing --
     * and presses it again, invalidating the set they were just shown.
     */
    await callRoute({ method: "GET", route: STATUS_ROUTE });

    const noCacheOrder: number = asMock(Response.setNoCacheHeaders).mock
      .invocationCallOrder[0]!;
    const sendOrder: number = asMock(Response.sendJsonObjectResponse).mock
      .invocationCallOrder[0]!;

    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);
    expect(noCacheOrder).toBeLessThan(sendOrder);
  });

  test("reads the status for the caller on the access token", async () => {
    await callRoute({ method: "GET", route: STATUS_ROUTE });

    expect(getStatusSpy).toHaveBeenCalledTimes(1);
    expect(firstServiceArgument(getStatusSpy).userId.toString()).toBe(
      CALLER_ID.toString(),
    );
    expect(Object.keys(firstServiceArgument(getStatusSpy))).toEqual(["userId"]);
  });

  test.each(IMPERSONATION_ATTEMPTS)(
    "reads only the token's user even when the request carries %s",
    async (_label: string, attempt: ImpersonationAttempt): Promise<void> => {
      /*
       * Read-only, but not harmless: this payload says whether a named account
       * has recovery codes and how nearly exhausted they are, which is exactly
       * the reconnaissance somebody picks a target with. It is safe to serve
       * only because it can only ever be about the caller.
       */
      await callRoute({
        method: "GET",
        route: STATUS_ROUTE,
        params: attempt.params,
        query: attempt.query,
        body: attempt.body,
      });

      const violations: Array<string> = [];

      if (getStatusSpy.mock.calls.length !== 1) {
        violations.push(
          `getStatusForUser was called ${getStatusSpy.mock.calls.length} times, expected exactly 1`,
        );
      }

      const suppliedUserId: string =
        firstServiceArgument(getStatusSpy).userId.toString();

      if (suppliedUserId === SOMEBODY_ELSE_ID) {
        violations.push(
          "getStatusForUser was aimed at the id supplied by the request",
        );
      }

      if (suppliedUserId !== CALLER_ID.toString()) {
        violations.push(
          `getStatusForUser was called with ${suppliedUserId}, expected the token's ${CALLER_ID.toString()}`,
        );
      }

      expect(violations).toEqual([]);
    },
  );

  test.each(UNAUTHENTICATED_REQUESTS)(
    "throws NotAuthenticatedException when %s",
    async (
      _label: string,
      authorization: Dictionary<unknown>,
    ): Promise<void> => {
      const result: RouteCallResult = await callRoute({
        method: "GET",
        route: STATUS_ROUTE,
        authorization: authorization,
      });

      const violations: Array<string> = [];

      if (!(result.thrownToNext instanceof NotAuthenticatedException)) {
        violations.push(
          `expected a NotAuthenticatedException, got ${String(result.thrownToNext)}`,
        );
      }

      if (result.nextCallCount !== 1) {
        violations.push(
          `next() was called ${result.nextCallCount} times, expected exactly 1`,
        );
      }

      if (getStatusSpy.mock.calls.length > 0) {
        violations.push("an unauthenticated request reached getStatusForUser");
      }

      if (asMock(Response.sendJsonObjectResponse).mock.calls.length > 0) {
        violations.push(
          "an unauthenticated request was answered with a status",
        );
      }

      expect(violations).toEqual([]);
    },
  );

  test("never regenerates as a side effect of being asked for the status", async () => {
    /*
     * The read path and the destructive path share a service. A status route
     * that reached for `regenerateForUser` -- to "refresh" an empty set, say --
     * would void a printed list on a page load.
     */
    await callRoute({ method: "GET", route: STATUS_ROUTE });

    expect(regenerateSpy).not.toHaveBeenCalled();
  });

  test("passes a service failure to next() rather than reporting a count", async () => {
    /*
     * A failed count reported as `total: 0` would tell a user with ten codes
     * that they have none, and send them to regenerate -- invalidating the
     * list they were holding for no reason at all.
     */
    const failure: Error = new Error("connection terminated unexpectedly");

    getStatusSpy.mockRejectedValue(failure as never);

    const result: RouteCallResult = await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
    });

    expect(result.thrownToNext).toBe(failure);
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("the input matrices themselves", () => {
  /*
   * A `test.each` over an emptied table registers no tests and the suite still
   * goes green. Both matrices above are the only place their protections are
   * asserted, so a bad merge that empties one has to fail loudly rather than
   * silently removing the coverage.
   */
  test("the impersonation table is not empty", () => {
    expect(IMPERSONATION_ATTEMPTS.length).toBeGreaterThan(3);
  });

  test("the unauthenticated table is not empty", () => {
    expect(UNAUTHENTICATED_REQUESTS.length).toBeGreaterThan(3);
  });

  test("every impersonation attempt actually supplies a foreign user id", () => {
    /*
     * A row whose params, query and body carry nothing would pass the
     * ownership assertion trivially. This is what keeps the matrix honest.
     */
    const violations: Array<string> = [];

    for (const [label, attempt] of IMPERSONATION_ATTEMPTS) {
      const serialized: string = JSON.stringify(attempt);

      if (!serialized.includes(SOMEBODY_ELSE_ID)) {
        violations.push(
          `the "${label}" attempt does not carry a foreign user id`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
