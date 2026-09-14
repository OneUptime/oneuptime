import UserWebAuthnAPI from "../../../Server/API/UserWebAuthnAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import UserTwoFactorBackupCodeService from "../../../Server/Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
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
 * POST /user-webauthn/verify-registration -- the moment a security key stops
 * being a plugged-in piece of plastic and becomes a second factor the account
 * will demand at every sign-in.
 *
 * WHY THIS ROUTE MINTS BACKUP CODES AT ALL
 *
 * Issue #3382: single-use backup codes shipped, and then essentially nobody
 * had any, because the only thing in the product that ever wrote one was a
 * button on the profile page that a user had to go and find. An account with
 * zero codes gets no recovery affordance worth the name, so the login screen
 * dead-ends exactly when it matters. The fix mints a set at ENROLMENT -- the
 * one moment the user is already thinking about losing access -- and this
 * route is one of the three places enrolment completes.
 *
 * A security key deserves it at least as much as an authenticator app does: an
 * app can be restored from a phone backup, whereas a hardware key left in a
 * taxi is simply gone, and nothing else on the account can stand in for it.
 *
 * WHAT THIS FILE GUARDS, all of which leave the suite green if nobody asserts
 * them here.
 *
 *   1. THE FIRST KEY ON A BARE ACCOUNT ACTUALLY MINTS, AND THE CODES COME
 *      BACK. `generateForUserIfNone` returns the ONLY copy of the plaintext
 *      that will ever exist -- the rows store keyed digests -- so a handler
 *      that mints and then answers with an empty success has written ten
 *      credentials nobody will ever see. `getStatusForUser` would report "10
 *      backup codes" to a user who holds none of them, which looks exactly
 *      like the healthy state and is strictly worse than having none.
 *
 *   2. A KEY ADDED ALONGSIDE AN AUTHENTICATOR APP CHANGES NOTHING. The
 *      only-if-there-are-none rule is the whole reason this calls
 *      `generateForUserIfNone` and not `regenerateForUser`; the latter opens
 *      by DELETING, so wiring it in here would silently void the list the user
 *      printed when they set their phone up. `regenerateForUser` and
 *      `deleteAllForUser` are therefore asserted never to be reached.
 *
 *   3. A MINT FAILURE IS SWALLOWED. By the time this code runs the credential
 *      is already committed. Letting a backup-code error out through `next()`
 *      would report a failed registration for a registration that succeeded --
 *      and the user, believing it failed, would go round again with a key the
 *      account already trusts.
 *
 *   4. THE OWNER COMES FROM THE SESSION. There is no `:userId` anywhere on
 *      this path, which is what makes the route safe today -- but "safe
 *      because there is no parameter to abuse" evaporates the moment somebody
 *      reaches for `req.body["userId"]`. Minting for the wrong account is not
 *      a read: on an account that has no codes it CREATES a working set of
 *      sign-in credentials and hands them to the caller.
 *
 *   5. NOTHING IS MINTED FOR A REGISTRATION THAT FAILED. The mint sits after
 *      the `await` on `verifyRegistration` on purpose. Moved above it, a
 *      caller replaying a junk credential would still walk away with ten live
 *      backup codes for their own account -- a way to mint recovery
 *      credentials that never proves possession of anything.
 *
 * WHAT IS MOCKED, AND WHAT IS DELIBERATELY NOT
 *
 * `UserWebAuthnService.verifyRegistration` and
 * `UserTwoFactorBackupCodeService.generateForUserIfNone` are spied on at the
 * singletons, so nothing touches Postgres and the plaintext is a fixed set
 * this file can compare against exactly.
 *
 * `CommonAPI.getDatabaseCommonInteractionProps` is NOT stubbed. It is the
 * thing that decides which user this request is for, so stubbing it would make
 * the ownership assertions circular -- they would prove only that a stub
 * returns what it was told to. The real one runs against a request that
 * carries an attacker's id in the body, the params and the query at once.
 *
 * `TwoFactorBackupCode` is NOT mocked either: `formatForDisplay` is the
 * route's output contract with the screen that shows the codes once.
 *
 * SIBLING FILES, SO NOTHING HERE IS DUPLICATED
 *
 *  - Common/Tests/Server/Services/UserTwoFactorBackupCodeService.test.ts owns
 *    `generateForUserIfNone` itself: the count check, the write loop and the
 *    by-id compensating delete.
 *  - Common/Tests/Server/API/UserTotpAuthAPI.test.ts owns the same minting on
 *    the authenticator-app enrolment route.
 *  - Common/Tests/Server/API/UserTwoFactorBackupCodeAPI.test.ts owns the
 *    self-service generate/status routes on the profile page.
 *  - App/Tests/FeatureSet/Identity/BackupCodeLoginVerification.test.ts owns
 *    SPENDING a code at sign-in.
 *
 * What is left, and what this file is entirely about, is the handler.
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

const VERIFY_REGISTRATION_ROUTE: string = "/user-webauthn/verify-registration";

const CALLER_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

/*
 * The id an attacker puts in every part of the request they control, hoping
 * the handler reads one of them instead of the session.
 */
const SOMEBODY_ELSE_ID: string = "22222222-2222-4222-8222-222222222222";

/*
 * What the service hands back when it mints. Fixed strings rather than real
 * generated ones so the response assertion has an exact expectation: a
 * formatter reduced to the identity function, or a handler returning a
 * placeholder array of the right length, has to fail rather than agree with
 * itself.
 */
const MINTED_CODES: Array<string> = [
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
 * The same ten codes in the form the show-once screen renders as-is. Written
 * out as literals rather than derived from `formatForDisplay`, so the
 * assertion pins the contract instead of restating the implementation.
 */
const MINTED_CODES_AS_DISPLAYED: Array<string> = [
  "2W9XK-Q4M7B",
  "H3TRZ-5D8NC",
  "P6JVG-2YK4S",
  "B8NQ7-MXW3T",
  "F5RD9-CZH2K",
  "T4KY6-BVN8P",
  "M2XS5-GQJ7W",
  "C9HB3-NPR6D",
  "Z7VM4-TKG5X",
  "K3PC8-WYS9N",
];

/* A credential body shaped the way the browser's navigator.credentials returns one. */
const CREDENTIAL_FROM_THE_BROWSER: JSONObject = {
  id: "credential-id-from-the-authenticator",
  rawId: "credential-id-from-the-authenticator",
  type: "public-key",
  response: {
    clientDataJSON: "client-data",
    attestationObject: "attestation",
  },
};

const KEY_NAME: string = "Yubikey on my keyring";

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

type CallRouteOptions = {
  params?: Dictionary<string> | undefined;
  query?: Dictionary<string> | undefined;
  body?: Dictionary<unknown> | undefined;

  /*
   * Spliced onto the request in place of the default signed-in caller. An
   * EMPTY object is a request with no `userAuthorization` property at all,
   * which is what reaches the handler if the middleware in front of it is ever
   * removed or fails open.
   */
  authorization?: Dictionary<unknown> | undefined;
};

type CallVerifyRegistrationFunction = (
  data?: CallRouteOptions,
) => Promise<RouteCallResult>;

const callVerifyRegistration: CallVerifyRegistrationFunction = async (
  data?: CallRouteOptions,
): Promise<RouteCallResult> => {
  const req: OneUptimeRequest = {
    params: data?.params || {},
    query: data?.query || {},
    body: data?.body || {
      credential: CREDENTIAL_FROM_THE_BROWSER,
      name: KEY_NAME,
    },
    headers: {},
    ...(data?.authorization || { userAuthorization: { userId: CALLER_ID } }),
  } as unknown as OneUptimeRequest;

  const res: OneUptimeResponse = {
    send: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as OneUptimeResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", VERIFY_REGISTRATION_ROUTE)
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

/* The body the route answered with, as the enrolment page receives it. */
type SentJsonObjectFunction = () => JSONObject;

const sentJsonObject: SentJsonObjectFunction = (): JSONObject => {
  const call: Array<unknown> | undefined = asMock(
    Response.sendJsonObjectResponse,
  ).mock.calls[0];

  return (call?.[2] as JSONObject) || {};
};

type MintArgument = { userId: ObjectID; count?: number | undefined };

type VerifyRegistrationArgument = {
  credential: unknown;
  name: string;
  props: { userId?: ObjectID | undefined };
};

let verifyRegistrationSpy: jest.SpyInstance;
let mintSpy: jest.SpyInstance;
let regenerateSpy: jest.SpyInstance;
let deleteAllSpy: jest.SpyInstance;
let loggerErrorSpy: jest.SpyInstance;

beforeAll(() => {
  mockRouter.routes.length = 0;
  new UserWebAuthnAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  verifyRegistrationSpy = getJestSpyOn(
    UserWebAuthnService,
    "verifyRegistration",
  );
  verifyRegistrationSpy.mockResolvedValue(undefined as never);

  /*
   * The default is the interesting case: an account that has no codes, so the
   * service mints and returns the plaintext.
   */
  mintSpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "generateForUserIfNone",
  );
  mintSpy.mockResolvedValue(MINTED_CODES as never);

  /*
   * Spied so the "never called" assertions are real. Left with an
   * implementation that throws would be indistinguishable from a stub that was
   * simply never reached, and both of these DESTROY the user's existing codes,
   * so a call to either is the failure this route must not have.
   */
  regenerateSpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "regenerateForUser",
  );
  regenerateSpy.mockResolvedValue(MINTED_CODES as never);

  deleteAllSpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "deleteAllForUser",
  );
  deleteAllSpy.mockResolvedValue(undefined as never);

  loggerErrorSpy = getJestSpyOn(logger, "error").mockImplementation(
    (): void => {
      return undefined;
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /user-webauthn/verify-registration", () => {
  describe("the route itself", () => {
    test("is registered as a POST behind the user middleware", () => {
      /*
       * The handler takes the owning user from `userAuthorization`, which is
       * put on the request by this middleware and by nothing else. Without it
       * the id would be undefined for every caller, and asserted by IDENTITY
       * rather than by counting because swapping in a different middleware
       * keeps the count at one.
       */
      const route: { middlewares: Array<unknown> } = mockRouter.match(
        "post",
        VERIFY_REGISTRATION_ROUTE,
      );

      expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
    });

    test("carries no route parameter that could name a user", () => {
      /*
       * This is the property the whole ownership story rests on: there is
       * nothing in the path to point at somebody else. A future
       * `/user-webauthn/:userId/verify-registration` -- added to let the admin
       * page reuse the endpoint, say -- would hand any signed-in caller a way
       * to mint a live set of backup codes onto a stranger's account, and the
       * handler as written would not notice.
       */
      const parameterised: Array<string> = mockRouter.routes
        .filter((route: { uri: string }): boolean => {
          return route.uri === VERIFY_REGISTRATION_ROUTE;
        })
        .map((route: { uri: string }): string => {
          return route.uri;
        })
        .filter((uri: string): boolean => {
          return uri.includes(":");
        });

      expect(parameterised).toEqual([]);
    });
  });

  describe("registering the first security key on an account with no codes", () => {
    test("mints a set for the signed-in user", async () => {
      const result: RouteCallResult = await callVerifyRegistration();

      expect(result.nextCallCount).toBe(0);
      expect(mintSpy).toHaveBeenCalledTimes(1);

      const argument: MintArgument = mintSpy.mock.calls[0]![0] as MintArgument;

      expect(argument.userId).toBe(CALLER_ID);
    });

    test("answers with the minted codes, formatted for display", async () => {
      /*
       * This response IS the only delivery of the plaintext. The rows hold
       * keyed digests, so a handler that mints and then answers without the
       * codes -- the old `sendEmptySuccessResponse` -- leaves the account
       * holding ten credentials that nobody, including the user, can ever
       * produce again.
       */
      await callVerifyRegistration();

      expect(sentJsonObject()).toEqual({
        backupCodes: MINTED_CODES_AS_DISPLAYED,
      });
    });

    test("does not answer with an empty success", async () => {
      /*
       * The failure mode this route had before the fix, asserted separately
       * from the payload: an empty success is a 200 the enrolment page cannot
       * distinguish from "there were no codes to show", so it renders nothing
       * and the codes are gone.
       */
      await callVerifyRegistration();

      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    });

    test("hyphenates without altering the code material", async () => {
      /*
       * `formatForDisplay` is cosmetic and `normalizeCode` strips the hyphen
       * straight back out -- so the one thing that must survive the formatter
       * is the characters themselves, in order. A formatter that dropped,
       * reordered or re-cased a character would hand the user a list that
       * cannot sign them in, and they would only find out at the worst
       * possible moment.
       */
      await callVerifyRegistration();

      const returned: Array<string> = sentJsonObject()[
        "backupCodes"
      ] as Array<string>;

      expect(
        returned.map((code: string): string => {
          return code.replace(/-/g, "");
        }),
      ).toEqual(MINTED_CODES);
    });
  });

  describe("registering a key alongside codes the user already has", () => {
    test("answers with an empty array when the service reports there were codes already", async () => {
      /*
       * `null` is the service saying "this account already has a recovery
       * route and I wrote nothing". The route must turn that into an empty
       * list rather than into `null` or a missing property: the page branches
       * on the array being non-empty, and `undefined.length` would take the
       * whole enrolment screen down after a registration that succeeded.
       */
      mintSpy.mockResolvedValue(null as never);

      const result: RouteCallResult = await callVerifyRegistration();

      expect(result.nextCallCount).toBe(0);
      expect(sentJsonObject()).toEqual({ backupCodes: [] });
    });

    test("never replaces or deletes the existing set", async () => {
      /*
       * The difference between the two service methods is the entire point of
       * this call site. `regenerateForUser` opens by deleting everything the
       * user holds, so reaching for it here would mean that adding a security
       * key to an account that already has an authenticator app silently voids
       * the printed list from that first enrolment -- codes the user has no
       * reason to believe stopped working.
       */
      mintSpy.mockResolvedValue(null as never);

      await callVerifyRegistration();

      expect(regenerateSpy).not.toHaveBeenCalled();
      expect(deleteAllSpy).not.toHaveBeenCalled();
    });
  });

  describe("when minting fails", () => {
    test("still reports the registration as successful", async () => {
      /*
       * The credential row is committed before this line runs. Surfacing the
       * backup-code failure through `next()` would tell the user their key was
       * not registered when it was, and they would register it again -- or,
       * worse, conclude that security keys do not work here and turn the
       * second factor off.
       */
      mintSpy.mockRejectedValue(
        new Error("backup code table is unreachable") as never,
      );

      const result: RouteCallResult = await callVerifyRegistration();

      expect(result.nextCallCount).toBe(0);
      expect(result.thrownToNext).toBeUndefined();
      expect(sentJsonObject()).toEqual({ backupCodes: [] });
    });

    test("logs the failure rather than losing it", async () => {
      /*
       * Swallowed is not the same as ignored. An account that quietly ends
       * enrolment with no recovery codes looks identical from the outside to
       * one that was never meant to have any, so the log line is the only
       * trace an operator has that the mint was attempted and lost.
       */
      const mintFailure: Error = new Error("backup code table is unreachable");

      mintSpy.mockRejectedValue(mintFailure as never);

      await callVerifyRegistration();

      expect(loggerErrorSpy).toHaveBeenCalledWith(mintFailure);
    });
  });

  describe("who the codes are minted for", () => {
    const IMPERSONATION_ATTEMPTS: Array<
      [string, Required<Omit<CallRouteOptions, "authorization">>]
    > = [
      [
        "a userId in the body",
        {
          params: {},
          query: {},
          body: {
            credential: CREDENTIAL_FROM_THE_BROWSER,
            name: KEY_NAME,
            userId: SOMEBODY_ELSE_ID,
          },
        },
      ],
      [
        "a userId in the route params",
        {
          params: { userId: SOMEBODY_ELSE_ID },
          query: {},
          body: {
            credential: CREDENTIAL_FROM_THE_BROWSER,
            name: KEY_NAME,
          },
        },
      ],
      [
        "a userId in the query string",
        {
          params: {},
          query: { userId: SOMEBODY_ELSE_ID },
          body: {
            credential: CREDENTIAL_FROM_THE_BROWSER,
            name: KEY_NAME,
          },
        },
      ],
      [
        "an id and a _id as well as a userId, plus a props.isRoot",
        {
          params: { id: SOMEBODY_ELSE_ID, userId: SOMEBODY_ELSE_ID },
          query: { _id: SOMEBODY_ELSE_ID },
          body: {
            credential: CREDENTIAL_FROM_THE_BROWSER,
            name: KEY_NAME,
            id: SOMEBODY_ELSE_ID,
            _id: SOMEBODY_ELSE_ID,
            userId: SOMEBODY_ELSE_ID,
            props: { isRoot: true, userId: SOMEBODY_ELSE_ID },
          },
        },
      ],
    ];

    test.each(IMPERSONATION_ATTEMPTS)(
      "mints for the session's user and not for %s",
      async (
        _name: string,
        attempt: Required<Omit<CallRouteOptions, "authorization">>,
      ) => {
        /*
         * Minting onto another account is not a read. On an account with no
         * codes it CREATES a working set of sign-in credentials and returns
         * the plaintext to the caller -- a second factor bypass handed over by
         * a route the victim never touched.
         */
        await callVerifyRegistration(attempt);

        const mintArgument: MintArgument = mintSpy.mock
          .calls[0]![0] as MintArgument;

        expect(mintArgument.userId).toBe(CALLER_ID);
        expect(mintArgument.userId.toString()).not.toBe(SOMEBODY_ELSE_ID);

        /* The credential is saved for the same user, from the same source. */
        const registrationArgument: VerifyRegistrationArgument =
          verifyRegistrationSpy.mock.calls[0]![0] as VerifyRegistrationArgument;

        expect(registrationArgument.props.userId).toBe(CALLER_ID);
      },
    );

    test("mints nothing when the request carries no authenticated user", async () => {
      /*
       * What the handler sees if the middleware in front of it is removed or
       * fails open. The guard matters because `generateForUserIfNone` with an
       * undefined userId does not throw at the service boundary -- it counts
       * rows matching `userId: undefined`, which is a query over the WHOLE
       * table, finds somebody else's codes and concludes this account already
       * has a recovery route. On an empty table it would instead write ten
       * ownerless rows.
       */
      const result: RouteCallResult = await callVerifyRegistration({
        authorization: {},
      });

      expect(mintSpy).not.toHaveBeenCalled();
      expect(regenerateSpy).not.toHaveBeenCalled();
      expect(result.nextCallCount).toBe(0);
      expect(sentJsonObject()).toEqual({ backupCodes: [] });
    });
  });

  describe("when the registration itself fails", () => {
    test("mints nothing and answers nothing", async () => {
      /*
       * The mint sits AFTER the await on `verifyRegistration` deliberately.
       * Hoisted above it -- or moved into a `Promise.all` alongside it -- a
       * caller posting a junk credential would still walk away with ten live
       * backup codes for their own account: a route that mints sign-in
       * credentials without ever proving possession of an authenticator.
       */
      const registrationFailure: BadDataException = new BadDataException(
        "Registration verification failed",
      );

      verifyRegistrationSpy.mockRejectedValue(registrationFailure as never);

      const result: RouteCallResult = await callVerifyRegistration();

      expect(result.thrownToNext).toBe(registrationFailure);
      expect(result.nextCallCount).toBe(1);
      expect(mintSpy).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("mints only once the credential is saved", async () => {
      /*
       * The ordering stated as an invariant rather than inferred from the
       * failure case above, because a refactor that fires the mint first and
       * merely happens to swallow it on a rejected registration would pass
       * that test and still be wrong: the codes would exist, and the response
       * would carry them, for a registration that never completed.
       */
      const callOrder: Array<string> = [];

      verifyRegistrationSpy.mockImplementation(async (): Promise<void> => {
        await Promise.resolve();
        callOrder.push("verify-registration");
      });

      mintSpy.mockImplementation(async (): Promise<Array<string>> => {
        callOrder.push("mint");
        return MINTED_CODES;
      });

      await callVerifyRegistration();

      expect(callOrder).toEqual(["verify-registration", "mint"]);
    });

    test("passes the credential and the key's name straight through", async () => {
      /*
       * Cheap, and it keeps the tests above honest: every assertion here is
       * driven through the real handler, so if the body were not reaching
       * `verifyRegistration` at all the enrolment being tested would be a
       * fiction.
       */
      await callVerifyRegistration();

      const argument: VerifyRegistrationArgument = verifyRegistrationSpy.mock
        .calls[0]![0] as VerifyRegistrationArgument;

      expect(argument.credential).toEqual(CREDENTIAL_FROM_THE_BROWSER);
      expect(argument.name).toBe(KEY_NAME);
    });
  });
});
