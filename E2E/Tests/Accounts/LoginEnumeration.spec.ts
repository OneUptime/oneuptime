import {
  BASE_URL,
  IS_USER_REGISTERED,
  REGISTERED_USER_EMAIL,
  REGISTERED_USER_PASSWORD,
} from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Account enumeration on the sign-in route.
 *
 * POST /identity/login answers a wrong password and an address that belongs to
 * nobody with the SAME message -- "Invalid login: Email or password does not
 * match." (App/FeatureSet/Identity/API/Authentication.ts). That is deliberate:
 * an answer that differed between the two turns the login form into a
 * membership oracle for the instance, which is a disclosure in its own right
 * on a private deployment and the first step of a targeted password attack on
 * a public one.
 *
 * The property is not visible to a unit test of the handler, because it is a
 * property of two DIFFERENT code paths agreeing -- the wrong-password branch
 * that runs with a user row in hand, and the fell-through-everything branch at
 * the end of the handler that runs without one. Nothing in the type system
 * makes them agree; only an assertion that compares the two responses does.
 * That comparison needs a real account to exist, which is why it lives here
 * rather than beside the handler.
 *
 * These are read-only probes: two failed sign-ins mutate nothing. They do
 * consume two slots of the per-account/per-address login budget that
 * Common/Server/Middleware/IdentityRateLimit.ts enforces (10 per account per
 * quarter hour, 150 per address), which is far inside it even with retries.
 */

const LOGIN_ROUTE: string = "/identity/login";

/*
 * An address that cannot belong to anybody. `.invalid` is reserved by RFC 2606
 * precisely so it can never be registered, and the random-ish local part keeps
 * a re-run from colliding with anything a previous run created.
 */
const UNKNOWN_EMAIL: string = "e2e-no-such-account@oneuptime-e2e.invalid";

const WRONG_PASSWORD: string = "definitely-not-the-password-9271";

interface LoginAttempt {
  status: number;
  message: string;
}

const attemptLogin: (data: {
  page: Page;
  email: string;
  password: string;
}) => Promise<LoginAttempt> = async (data: {
  page: Page;
  email: string;
  password: string;
}): Promise<LoginAttempt> => {
  const endpoint: string = URL.fromString(BASE_URL.toString())
    .addRoute(LOGIN_ROUTE)
    .toString();

  const response: APIResponse = await data.page.request.post(endpoint, {
    data: {
      data: {
        email: data.email,
        password: data.password,
      },
    },
  });

  let message: string = "";

  try {
    const body: unknown = await response.json();

    if (body && typeof body === "object") {
      const asRecord: Record<string, unknown> = body as Record<string, unknown>;
      message = String(asRecord["message"] ?? asRecord["error"] ?? "");
    }
  } catch {
    /*
     * A non-JSON body is itself a difference worth surfacing, so fall back to
     * the raw text rather than swallowing it.
     */
    message = await response.text();
  }

  return { status: response.status(), message };
};

test.describe("Sign-in must not disclose whether an account exists", () => {
  test("an unknown address is refused without confirming it is unknown", async ({
    page,
  }: {
    page: Page;
  }) => {
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const attempt: LoginAttempt = await attemptLogin({
      page,
      email: UNKNOWN_EMAIL,
      password: WRONG_PASSWORD,
    });

    /* Refused, and refused as bad input rather than as a server error. */
    expect(attempt.status).toBeGreaterThanOrEqual(400);
    expect(attempt.status).toBeLessThan(500);

    /*
     * The message must not name the address or say the account is missing.
     * "No user is registered with ..." is what /forgot-password says, and it
     * would be a disclosure here.
     */
    expect(attempt.message.toLowerCase()).not.toContain("not registered");
    expect(attempt.message.toLowerCase()).not.toContain("no user");
    expect(attempt.message).not.toContain(UNKNOWN_EMAIL);
  });

  /*
   * The comparison that is the point of this file. Skipped when the
   * environment has no registered account to compare against -- there is
   * nothing to assert without one, and a test that quietly passes on half its
   * premise is worse than one that says it did not run.
   */
  test("a wrong password and an unknown address are refused identically", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(
      !IS_USER_REGISTERED ||
        !REGISTERED_USER_EMAIL ||
        !REGISTERED_USER_PASSWORD,
      "needs a registered account to compare the two refusals against",
    );

    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const wrongPasswordForRealAccount: LoginAttempt = await attemptLogin({
      page,
      email: REGISTERED_USER_EMAIL.toString(),
      password: WRONG_PASSWORD,
    });

    const unknownAccount: LoginAttempt = await attemptLogin({
      page,
      email: UNKNOWN_EMAIL,
      password: WRONG_PASSWORD,
    });

    expect(wrongPasswordForRealAccount.status).toBe(unknownAccount.status);
    expect(wrongPasswordForRealAccount.message).toBe(unknownAccount.message);
  });

  /*
   * The correct password must still work after the failures above. This is
   * the guard against "fixing" enumeration by breaking sign-in, and against a
   * rate limiter tuned tightly enough that two wrong attempts lock a real user
   * out of their own account.
   */
  test("the real credentials still sign in after a failed attempt", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(
      !IS_USER_REGISTERED ||
        !REGISTERED_USER_EMAIL ||
        !REGISTERED_USER_PASSWORD,
      "needs a registered account to sign in as",
    );

    page.setDefaultNavigationTimeout(120000); // 2 minutes

    await attemptLogin({
      page,
      email: REGISTERED_USER_EMAIL.toString(),
      password: WRONG_PASSWORD,
    });

    const good: LoginAttempt = await attemptLogin({
      page,
      email: REGISTERED_USER_EMAIL.toString(),
      password: REGISTERED_USER_PASSWORD.toString(),
    });

    expect(good.status).toBeLessThan(400);
  });
});
