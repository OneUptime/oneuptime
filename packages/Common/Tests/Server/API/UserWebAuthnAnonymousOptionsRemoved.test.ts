import UserWebAuthnAPI from "../../../Server/API/UserWebAuthnAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
} from "../../../Server/Middleware/IdentityRateLimit";
import { mockRouter } from "./Helpers";
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ---------------------------------------------------------------------------
 * NO SECURITY KEY'S OPTIONS FOR AN ADDRESS ALONE (#9822).
 *
 * POST /user-webauthn/generate-authentication-options took an email address
 * and nothing else, from anybody:
 *
 *   - an address with no account, or an account with no security key:
 *     400 "No security key is available for this account.";
 *   - an account with one: 200, the options for the browser's prompt, naming
 *     the account's credential ids and transports - and a challenge written
 *     over the one that account's own sign-in was about to sign.
 *
 * So anyone could learn which addresses had an account and which accounts
 * used a security key, and could break a sign-in in progress. The options
 * now come from the sign-in itself, once the password or the sign-in link
 * has proved the account (POST /identity/security-key-sign-in-options,
 * App/Tests/FeatureSet/Identity/SecurityKeySignInSaysNothingOfAccounts).
 * This file holds the route, and its rate-limit bucket, gone: no route on
 * this API answers anybody who is not signed in.
 * ---------------------------------------------------------------------------
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

const API_SOURCE: string = fs.readFileSync(
  path.join(__dirname, "../../../Server/API/UserWebAuthnAPI.ts"),
  "utf8",
);

beforeAll(() => {
  mockRouter.routes.length = 0;
  new UserWebAuthnAPI();
});

describe("UserWebAuthnAPI - no security key's options for an address alone", () => {
  test("serves some routes, so the checks below read real registrations", () => {
    expect(mockRouter.routes.length).toBeGreaterThan(0);
  });

  test("no route, by any method, hands out authentication options", () => {
    const optionRoutes: Array<string> = mockRouter.routes
      .filter((route: { uri: string }) => {
        return route.uri.includes("authentication-options");
      })
      .map((route: { method: string; uri: string }) => {
        return `${route.method} ${route.uri}`;
      });

    expect(optionRoutes).toEqual([]);
  });

  test("every route it serves is for somebody signed in", () => {
    const anonymousRoutes: Array<string> = mockRouter.routes
      .filter((route: { middlewares: Array<unknown> }) => {
        return !route.middlewares.includes(UserMiddleware.getUserMiddleware);
      })
      .map((route: { method: string; uri: string }) => {
        return `${route.method} ${route.uri}`;
      });

    expect(anonymousRoutes).toEqual([]);
  });

  test("registering a key still needs a session, and nothing more in front of it", () => {
    for (const uri of [
      "/user-webauthn/generate-registration-options",
      "/user-webauthn/verify-registration",
    ]) {
      expect(mockRouter.match("post", uri).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    }
  });

  test("its source no longer looks an account up by an address", () => {
    expect(API_SOURCE).not.toContain("generateAuthenticationOptions");
    expect(API_SOURCE).not.toContain('data["email"]');
  });
});

describe("IdentityRateLimit - the old route's bucket is gone with it", () => {
  test("there is no WebAuthnChallenge bucket", () => {
    expect(Object.keys(IdentityRateLimitBucket)).not.toContain(
      "WebAuthnChallenge",
    );
    expect(Object.values(IdentityRateLimitBucket)).not.toContain(
      "webauthn-challenge",
    );
  });

  test("the security key's options are counted on the second step's bucket", () => {
    /*
     * The options re-prove the password, so they are a password oracle
     * like every other second step, and share its budget (Authentication.ts
     * registers the route behind twoFactorRateLimit).
     */
    const authentication: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Identity/API/Authentication.ts",
      ),
      "utf8",
    );

    expect(authentication).toMatch(
      /router\.post\(\s*SECURITY_KEY_SIGN_IN_OPTIONS_ROUTE,\s*twoFactorRateLimit,/,
    );
    expect(
      IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.TwoFactor),
    ).toBeDefined();
  });
});
