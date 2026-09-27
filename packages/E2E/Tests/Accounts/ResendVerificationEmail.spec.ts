import {
  BASE_URL,
  E2E_SIGNUP_PASSWORD,
  IS_BILLING_ENABLED,
} from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import Faker from "Common/Utils/Faker";

/*
 * Asking for another verification email without being signed in.
 *
 * POST /identity/resend-verification-email
 * (App/FeatureSet/Identity/API/Authentication.ts) mails an unverified account
 * a fresh verification link. It is anonymous, so it never takes an address:
 * it takes exactly one credential -- the signed resend token /identity/signup
 * hands the page that created the account, or the token from an emailed
 * verification link -- and every request it will not honour, whatever was
 * wrong with it, gets one and the same 400.
 *
 * WHY THIS LIVES IN E2E
 *
 * The route's unit tests (App/Tests/FeatureSet/Identity/
 * ResendVerificationEmail.test.ts) mock the three things its answers turn on:
 * the Redis fence in GlobalCache, the Postgres query over the account's
 * EmailVerificationToken rows that the cooldown is computed from, and the
 * EncryptionSecret the resend token's HMAC key is derived from. This is the
 * only place all three are real at once. A token minted by the real /signup
 * is checked against the real secret; the welcome email's own row, written by
 * that same signup, has to be found by the real history query for the first
 * resend to be told to wait (signup never sets the fence, so nothing else can
 * produce that answer); and the answer is only reachable after a read of the
 * real fence, because a route that cannot reach Redis answers 503, not 200.
 *
 * WHAT IT DOES NOT DO
 *
 * Send mail. Every request below lands on a refusal, a cooldown or an address
 * that is already verified, so the result does not depend on the stack having
 * a working SMTP relay, and the fence is never claimed (only a send claims
 * it).
 *
 * HOSTED AND SELF-HOSTED
 *
 * A resend token exists only on the hosted service (billing on), where signup
 * holds a new account for email verification. A self-hosted signup (billing
 * off) is signed straight in and must carry no resend token at all. Which of
 * the two a stack is, is read from what its /signup actually answered; the
 * refusals are the same on both.
 *
 * THE BUDGET
 *
 * The route has a per-address limiter of its own
 * (IDENTITY_VERIFICATION_EMAIL_RESEND_RATE_LIMIT_PER_IP_PER_WINDOW in
 * Common/Server/Middleware/IdentityRateLimit.ts, 20 per quarter hour by
 * default), and every request from the e2e container comes from one address.
 * Nothing else in the suite spends that bucket, but this file must not spend
 * all of it either, or a retry would be refused with a 429 that says nothing
 * about the route. A passing run makes 8 resend requests (4 + 4). It runs in
 * one browser and retries once, so two failed attempts of every test still
 * make only 16.
 */

const SIGNUP_ROUTE: string = "/identity/signup";
const VERIFY_EMAIL_ROUTE: string = "/identity/verify-email";
const RESEND_ROUTE: string = "/identity/resend-verification-email";

/*
 * VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE, copied from
 * App/FeatureSet/Identity/Utils/VerificationEmailResendPolicy.ts. Copied, not
 * imported: the e2e image carries Common and E2E only
 * (packages/E2E/Dockerfile.tpl), so App is not there to import from. When the
 * wording changes there it has to change here too, and this spec failing on
 * the old wording is the reminder.
 */
const INVALID_REQUEST_MESSAGE: string =
  "This verification request is no longer valid. Sign in with your email and password and we will send you a new verification link.";

// VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS, from the same file.
const RESEND_COOLDOWN_IN_SECONDS: number = 60;

/*
 * Per request. Generous because a stack that has only just come up answers
 * slowly; none of the assertions below measures how long anything took.
 */
const REQUEST_TIMEOUT_IN_MS: number = 60_000;

/*
 * An address that can never belong to anybody (`.invalid` is reserved by
 * RFC 2606), for the forged token below.
 */
const UNKNOWN_EMAIL: string = "e2e-no-such-account@oneuptime-e2e.invalid";

type JSONRecord = Record<string, unknown>;

interface ApiAnswer {
  status: number;
  body: JSONRecord;
  text: string;
}

interface Signup {
  answer: ApiAnswer;
  miscData: JSONRecord;
}

const toRecord: (value: unknown) => JSONRecord = (
  value: unknown,
): JSONRecord => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONRecord)
    : {};
};

/*
 * POSTs `body` as JSON -- or nothing at all when it is undefined -- and keeps
 * the raw text as well as the parsed body, so a failure can show what the
 * server actually said even when it was not JSON.
 */
const post: (data: {
  page: Page;
  route: string;
  body?: unknown;
}) => Promise<ApiAnswer> = async (data: {
  page: Page;
  route: string;
  body?: unknown;
}): Promise<ApiAnswer> => {
  const response: APIResponse = await data.page.request.post(
    URL.fromString(BASE_URL.toString()).addRoute(data.route).toString(),
    {
      timeout: REQUEST_TIMEOUT_IN_MS,
      ...(data.body === undefined ? {} : { data: data.body }),
    },
  );

  const text: string = await response.text();

  let body: JSONRecord = {};

  try {
    body = toRecord(JSON.parse(text));
  } catch {
    // Left empty; `text` carries the body into the failure message instead.
  }

  return { status: response.status(), body, text };
};

/*
 * The route throws its refusals, so expressErrorHandler serializes them as
 * { error }; Response.sendErrorResponse would have written { message }. Read
 * the reason the way HTTPErrorResponse does rather than pinning one key.
 */
const readErrorMessage: (body: JSONRecord) => string = (
  body: JSONRecord,
): string => {
  for (const key of ["data", "message", "error"]) {
    const value: unknown = body[key];

    if (typeof value === "string" && value) {
      return value;
    }
  }

  return "";
};

/*
 * A resend token in the real format ("v1.<payload>.<signature>", see
 * App/FeatureSet/Identity/Utils/VerificationEmailResendToken.ts) whose payload
 * would pass every check the route makes -- current, well formed, a valid id
 * and address -- and whose signature the server never made. The only thing
 * that can refuse it is the HMAC.
 */
const buildForgedResendToken: () => string = (): string => {
  const nowMs: number = Date.now();

  const payload: string = Buffer.from(
    JSON.stringify({
      v: 1,
      u: ObjectID.generate().toString(),
      e: UNKNOWN_EMAIL,
      i: nowMs,
      x: nowMs + 60 * 60 * 1000,
    }),
    "utf8",
  ).toString("base64url");

  return `v1.${payload}.${"A".repeat(43)}`;
};

/*
 * A genuine token with one character of its signature changed: the real
 * claims of a real account, under a signature the server did not make.
 */
const withAlteredSignature: (token: string) => string = (
  token: string,
): string => {
  const signatureStart: number = token.lastIndexOf(".") + 1;
  const replacement: string = token.charAt(signatureStart) === "A" ? "B" : "A";

  return (
    token.slice(0, signatureStart) +
    replacement +
    token.slice(signatureStart + 1)
  );
};

/*
 * A brand new account, over the API, in the envelopes the register form's
 * ModelForm sends (JSONFunctions.serialize) -- the API deserializes those
 * back into Email, Name, HashedString and Phone before it builds the user.
 * The company fields are the ones the form shows only on the hosted service.
 * miscDataProps is empty on purpose: no captcha (the e2e stack runs with it
 * off, as for every other signup in the suite) and no notifySelfHosted, which
 * would report the signup to oneuptime.com.
 */
const signUp: (page: Page) => Promise<Signup> = async (
  page: Page,
): Promise<Signup> => {
  const answer: ApiAnswer = await post({
    page,
    route: SIGNUP_ROUTE,
    body: {
      data: {
        email: { _type: "Email", value: Faker.generateEmail().toString() },
        name: { _type: "Name", value: "E2E Resend Verification" },
        password: { _type: "HashedString", value: E2E_SIGNUP_PASSWORD },
        ...(IS_BILLING_ENABLED
          ? {
              companyName: "E2E Resend Verification",
              companyPhoneNumber: { _type: "Phone", value: "+14155552671" },
            }
          : {}),
      },
      miscDataProps: {},
    },
  });

  expect(
    answer.status,
    `POST ${SIGNUP_ROUTE} failed: ${answer.text.slice(0, 300)}`,
  ).toBe(200);

  return { answer, miscData: toRecord(answer.body["_miscData"]) };
};

test.describe("Resending a verification email without signing in", () => {
  /*
   * Every step is an HTTP request, so the browser engine plays no part, and
   * a second engine would spend the route's per-address budget twice.
   */
  test.skip(({ browserName }: { browserName: string }): boolean => {
    return browserName !== "chromium";
  }, "API-level spec: one engine covers it, and a second would spend the route's per-address limiter budget twice.");

  // See THE BUDGET above: one retry is what keeps a bad run inside it.
  test.describe.configure({ retries: 1 });

  test("every request it will not honour gets one identical refusal", async ({
    page,
  }: {
    page: Page;
  }) => {
    const forgedResendToken: string = buildForgedResendToken();

    /*
     * A valid UUID, so it gets past the shape check and is looked up in
     * Postgres -- where nothing has it.
     */
    const unknownVerificationToken: string = ObjectID.generate().toString();

    const probes: Array<{ label: string; body?: unknown }> = [
      { label: "no body" },
      {
        label: "both credentials at once",
        body: {
          data: {
            resendToken: forgedResendToken,
            verificationToken: unknownVerificationToken,
          },
        },
      },
      {
        label: "a forged resend token",
        body: { data: { resendToken: forgedResendToken } },
      },
      {
        label: "an unknown verification token",
        body: { data: { verificationToken: unknownVerificationToken } },
      },
    ];

    const answers: Array<{ label: string; answer: ApiAnswer }> = [];

    // One at a time: the order is the order a reader expects them in.
    for (const probe of probes) {
      answers.push({
        label: probe.label,
        answer: await post({
          page,
          route: RESEND_ROUTE,
          ...(probe.body === undefined ? {} : { body: probe.body }),
        }),
      });
    }

    for (const { label, answer } of answers) {
      expect(answer.status, `${label}: ${answer.text.slice(0, 300)}`).toBe(400);
      expect(readErrorMessage(answer.body), label).toBe(
        INVALID_REQUEST_MESSAGE,
      );
    }

    /*
     * Not just the same message: the same body. An extra field on one of
     * them would tell a caller which check it failed as surely as a
     * different message would.
     */
    const firstBody: JSONRecord = answers[0]!.answer.body;

    for (const { label, answer } of answers) {
      expect(answer.body, `${label} vs ${answers[0]!.label}`).toEqual(
        firstBody,
      );
    }
  });

  test("a new signup's resend token is told to wait, and then that the address is verified", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(5 * 60 * 1000);

    const signup: Signup = await signUp(page);

    if (signup.miscData["emailVerificationRequired"] !== true) {
      /*
       * A hosted stack that signs a new account straight in has lost the
       * verification gate, and skipping here would hide that on the one job
       * that runs this test.
       */
      expect(
        IS_BILLING_ENABLED,
        "BILLING_ENABLED=true, yet /identity/signup signed the new account straight in instead of holding it for email verification.",
      ).toBe(false);

      test.skip(
        true,
        "Self-hosted stack (billing off): /identity/signup signs the account in directly and hands out no resend token. The next test covers this stack.",
      );
    }

    /*
     * Checked before any resend is made, so a stack without the flag fails
     * here with the reason rather than having spent part of the budget.
     */
    const verificationToken: unknown =
      signup.miscData["emailVerificationToken"];

    if (
      typeof verificationToken !== "string" ||
      !ObjectID.isValidUUID(verificationToken)
    ) {
      throw new Error(
        "Signup needs email verification but the response carried no emailVerificationToken. " +
          "The hosted e2e stack must run the App with " +
          "EXPOSE_VERIFICATION_CODE_IN_API_RESPONSE_FOR_E2E=true -- it has no " +
          "mailbox to read the welcome email from.",
      );
    }

    const resendTokenValue: unknown =
      signup.miscData["verificationEmailResendToken"];

    expect(
      typeof resendTokenValue,
      `/identity/signup answered emailVerificationRequired without a verificationEmailResendToken: ${signup.answer.text.slice(0, 300)}`,
    ).toBe("string");

    const resendToken: string = resendTokenValue as string;

    expect(resendToken).toMatch(/^v1\./);
    expect(signup.miscData["verificationEmailResendAvailableInSeconds"]).toBe(
      RESEND_COOLDOWN_IN_SECONDS,
    );

    /*
     * The resend token can only ask for mail; the verification token IS the
     * proof of the mailbox. Handing out the second inside the first would
     * let the page that signed up verify the address without the email.
     * Checked in the payload as decoded too, since base64 would hide it from
     * a plain substring check.
     */
    const decodedPayload: string = Buffer.from(
      resendToken.split(".")[1] || "",
      "base64url",
    ).toString("utf8");

    expect(resendToken).not.toContain(verificationToken);
    expect(decodedPayload).not.toContain(verificationToken);

    /*
     * Straight after signup the welcome email is seconds old, so the policy
     * must see its row and answer with a wait inside the cooldown -- and
     * send nothing.
     */
    const coolingDown: ApiAnswer = await post({
      page,
      route: RESEND_ROUTE,
      body: { data: { resendToken } },
    });

    expect(
      coolingDown.status,
      `resend straight after signup: ${coolingDown.text.slice(0, 300)}`,
    ).toBe(200);

    // Exactly these three fields: in particular, never a token.
    expect(coolingDown.body).toEqual({
      emailSent: false,
      alreadyVerified: false,
      retryAfterSeconds: expect.any(Number),
    });

    const retryAfterSeconds: number = coolingDown.body[
      "retryAfterSeconds"
    ] as number;

    expect(Number.isInteger(retryAfterSeconds)).toBe(true);
    expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(retryAfterSeconds).toBeLessThanOrEqual(RESEND_COOLDOWN_IN_SECONDS);

    /*
     * The real claims of this real, unverified account under a signature
     * the server did not make: refused exactly like the invented ones in
     * the test above, so the refusal says nothing about whether the account
     * exists.
     */
    const tampered: ApiAnswer = await post({
      page,
      route: RESEND_ROUTE,
      body: { data: { resendToken: withAlteredSignature(resendToken) } },
    });

    expect(
      tampered.status,
      `altered signature: ${tampered.text.slice(0, 300)}`,
    ).toBe(400);
    expect(readErrorMessage(tampered.body)).toBe(INVALID_REQUEST_MESSAGE);

    /*
     * Follow the welcome email's link, in the body VerifyEmail.tsx sends
     * through ModelAPI: an EmailVerificationToken with only `token` set,
     * serialized as an ObjectID envelope.
     */
    const verified: ApiAnswer = await post({
      page,
      route: VERIFY_EMAIL_ROUTE,
      body: {
        data: { token: new ObjectID(verificationToken).toJSON() },
        miscDataProps: {},
      },
    });

    expect(
      verified.status,
      `POST ${VERIFY_EMAIL_ROUTE} failed: ${verified.text.slice(0, 300)}`,
    ).toBe(200);

    /*
     * Both credentials now name a verified account, and both are still
     * current -- the link token does not expire for a day and is not spent
     * by verifying -- so each must be told there is nothing left to send.
     */
    const credentials: Array<{ label: string; data: JSONRecord }> = [
      { label: "the resend token", data: { resendToken } },
      { label: "the verification token", data: { verificationToken } },
    ];

    for (const credential of credentials) {
      const answer: ApiAnswer = await post({
        page,
        route: RESEND_ROUTE,
        body: { data: credential.data },
      });

      expect(
        answer.status,
        `${credential.label} after verifying: ${answer.text.slice(0, 300)}`,
      ).toBe(200);
      expect(answer.body, credential.label).toEqual({
        emailSent: false,
        alreadyVerified: true,
        retryAfterSeconds: 0,
      });
    }
  });

  test("a self-hosted signup, which signs straight in, carries no resend token", async ({
    page,
  }: {
    page: Page;
  }) => {
    const signup: Signup = await signUp(page);

    test.skip(
      signup.miscData["emailVerificationRequired"] === true,
      "Hosted stack (billing on): signup holds the account for verification and does hand out a resend token. The test above covers this stack.",
    );

    /*
     * Searched for in the whole body rather than in _miscData alone, so it
     * is caught wherever it turns up.
     */
    expect(signup.answer.text).not.toContain("verificationEmailResendToken");
    expect(signup.answer.text).not.toContain(
      "verificationEmailResendAvailableInSeconds",
    );
  });
});
