import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Headers from "../../../Types/API/Headers";
import APIException from "../../../Types/Exception/ApiException";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import { RESEND_VERIFICATION_EMAIL_API_URL } from "../../../../App/FeatureSet/Accounts/src/Utils/ApiPaths";
import {
  DEFAULT_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
  MAX_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
  VerificationEmailResendCredential,
  VerificationEmailResendOutcome,
  VerificationEmailResendResult,
  clampCooldownSeconds,
  formatCountdown,
  getRetryAfterSecondsFromError,
  parseVerificationEmailResendResponse,
  requestVerificationEmailResend,
} from "../../../../App/FeatureSet/Accounts/src/Utils/VerificationEmailResend";
import {
  WebmailProvider,
  getWebmailProvider,
} from "../../../../App/FeatureSet/Accounts/src/Utils/WebmailProvider";

/*
 * The pure half of "resend verification email": how a wait is shown, which
 * waits are believed, how the route's answer is read and which inbox the
 * "Open Gmail" shortcut may point at.
 *
 * Every number these helpers handle arrives over the network -- the signup
 * response, the resend response, a proxy's Retry-After header -- so most of
 * this file feeds them the shapes a broken or hostile answer could take and
 * checks that the screen still says something sane: no negative countdown,
 * no countdown of weeks that locks the button for good, no "we sent it" for a
 * body the page does not understand. The webmail cases are the same idea for
 * an address: only an EXACT consumer domain earns a link, never a look-alike.
 */

const GMAIL: WebmailProvider = {
  name: "Gmail",
  url: "https://mail.google.com/mail/u/0/#inbox",
};
const OUTLOOK: WebmailProvider = {
  name: "Outlook",
  url: "https://outlook.live.com/mail/0/",
};
const YAHOO: WebmailProvider = {
  name: "Yahoo Mail",
  url: "https://mail.yahoo.com/",
};
const ICLOUD: WebmailProvider = {
  name: "iCloud Mail",
  url: "https://www.icloud.com/mail",
};
const PROTON: WebmailProvider = {
  name: "Proton Mail",
  url: "https://mail.proton.me/",
};

const RESEND_TOKEN: string =
  "v1.eyJ2IjoxfQ.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmUtc2ln";
const VERIFICATION_TOKEN: string = "8f2d1c3a-4b5e-4f60-8a71-92b3c4d5e6f7";

type PostOptions = Parameters<typeof API.post>[0];

type ErrorWithHeadersFunction = (
  statusCode: number,
  headers: Headers,
) => HTTPErrorResponse;

const errorWithHeaders: ErrorWithHeadersFunction = (
  statusCode: number,
  headers: Headers,
): HTTPErrorResponse => {
  return new HTTPErrorResponse(
    statusCode,
    {
      message:
        "Too many requests for a new verification email. Please try again later.",
    },
    headers,
  );
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("formatCountdown", () => {
  test.each([
    [0, "0:00"],
    [1, "0:01"],
    [5, "0:05"],
    [9, "0:09"],
    [10, "0:10"],
    [45, "0:45"],
    [59, "0:59"],
    [60, "1:00"],
    [61, "1:01"],
    [119, "1:59"],
    [120, "2:00"],
    [599, "9:59"],
    [600, "10:00"],
    [725, "12:05"],
    [3599, "59:59"],
    [3600, "60:00"],
  ])("shows %p seconds as %p in English", (seconds: number, text: string) => {
    expect(formatCountdown(seconds, "en")).toBe(text);
  });

  test("never groups the minutes, however long the wait", () => {
    // A day: 1440 minutes. "1,440:00" would read as a different number.
    expect(formatCountdown(24 * 60 * 60, "en")).toBe("1440:00");
    expect(formatCountdown(100000 * 60 + 7, "en")).toBe("100000:07");
  });

  test("rounds a fractional wait UP, so 0:00 is never shown while a wait remains", () => {
    expect(formatCountdown(0.001, "en")).toBe("0:01");
    expect(formatCountdown(0.5, "en")).toBe("0:01");
    expect(formatCountdown(4.2, "en")).toBe("0:05");
    expect(formatCountdown(59.01, "en")).toBe("1:00");
    expect(formatCountdown(60.5, "en")).toBe("1:01");
  });

  test.each([
    ["a negative number", -1],
    ["a large negative number", -3600],
    ["negative zero", -0],
    ["a negative fraction", -0.5],
    ["NaN", Number.NaN],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["positive infinity", Number.POSITIVE_INFINITY],
  ])("shows %s as 0:00", (_label: string, seconds: number) => {
    expect(formatCountdown(seconds, "en")).toBe("0:00");
  });

  test("uses ASCII digits when no language is given", () => {
    expect(formatCountdown(65)).toMatch(/^\d+:\d\d$/);
  });

  test("uses the page's own numerals for Persian, still as two parts m:ss", () => {
    let text: string = "";

    expect(() => {
      text = formatCountdown(65, "fa");
    }).not.toThrow();

    const parts: Array<string> = text.split(":");

    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(new Intl.NumberFormat("fa").format(1));
    expect(parts[1]).toBe(
      new Intl.NumberFormat("fa", { minimumIntegerDigits: 2 }).format(5),
    );
    // Persian numerals, not the Latin ones the English page shows.
    expect(text).not.toBe("1:05");
    expect(text).not.toMatch(/[0-9]/);
  });

  test("pads the seconds for Persian as well", () => {
    const parts: Array<string> = formatCountdown(3, "fa").split(":");

    expect(parts).toHaveLength(2);
    expect(Array.from(parts[1] || "")).toHaveLength(2);
  });

  test.each(["hi", "ja", "de", "zh-CN", "zh-TW"])(
    "formats for %s without throwing",
    (locale: string) => {
      const text: string = formatCountdown(725, locale);

      expect(text.split(":")).toHaveLength(2);
    },
  );

  test("falls back to ASCII digits for a language tag Intl rejects", () => {
    expect(() => {
      return formatCountdown(65, "not a locale!!");
    }).not.toThrow();
    expect(formatCountdown(65, "not a locale!!")).toBe("1:05");
    expect(formatCountdown(725, "not a locale!!")).toBe("12:05");
    expect(formatCountdown(-5, "not a locale!!")).toBe("0:00");
  });

  test("falls back to ASCII digits when Intl itself throws", () => {
    jest.spyOn(Intl, "NumberFormat").mockImplementation(() => {
      throw new Error("Intl is not available");
    });

    expect(formatCountdown(65, "fa")).toBe("1:05");
    expect(formatCountdown(5, "en")).toBe("0:05");
  });
});

describe("clampCooldownSeconds", () => {
  test.each([
    [0, 0],
    [1, 1],
    [60, 60],
    [0.1, 1],
    [59.5, 60],
    [MAX_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS, 86400],
    [MAX_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS + 1, 86400],
    [Number.MAX_SAFE_INTEGER, 86400],
    [Number.MAX_VALUE, 86400],
    [-1, 0],
    [-0.5, 0],
    [-86400, 0],
  ])("clamps %p to %p", (value: number, expected: number) => {
    expect(clampCooldownSeconds(value)).toBe(expected);
  });

  test("caps a wait at one day", () => {
    expect(MAX_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS).toBe(86400);
    expect(DEFAULT_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS).toBe(60);
  });

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a numeric string", "60"],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["true", true],
    ["an object", { seconds: 60 }],
    ["an array", [60]],
    ["a bigint", BigInt(60)],
  ])("treats %s as no wait at all", (_label: string, value: unknown) => {
    expect(clampCooldownSeconds(value)).toBe(0);
  });
});

describe("parseVerificationEmailResendResponse", () => {
  test("reads a sent email with the server's cooldown", () => {
    expect(
      parseVerificationEmailResendResponse({
        emailSent: true,
        alreadyVerified: false,
        retryAfterSeconds: 60,
      }),
    ).toEqual({
      outcome: VerificationEmailResendOutcome.Sent,
      retryAfterSeconds: 60,
    });
  });

  test("reads a cooldown with how long is left", () => {
    expect(
      parseVerificationEmailResendResponse({
        emailSent: false,
        alreadyVerified: false,
        retryAfterSeconds: 42,
      }),
    ).toEqual({
      outcome: VerificationEmailResendOutcome.CoolingDown,
      retryAfterSeconds: 42,
    });
  });

  test("reads an already verified account with no wait", () => {
    expect(
      parseVerificationEmailResendResponse({
        emailSent: false,
        alreadyVerified: true,
        retryAfterSeconds: 0,
      }),
    ).toEqual({
      outcome: VerificationEmailResendOutcome.AlreadyVerified,
      retryAfterSeconds: 0,
    });
  });

  test("lets 'already verified' win over everything else in the body", () => {
    expect(
      parseVerificationEmailResendResponse({
        emailSent: true,
        alreadyVerified: true,
        retryAfterSeconds: 999,
      }),
    ).toEqual({
      outcome: VerificationEmailResendOutcome.AlreadyVerified,
      retryAfterSeconds: 0,
    });
    expect(
      parseVerificationEmailResendResponse({ alreadyVerified: true }),
    ).toEqual({
      outcome: VerificationEmailResendOutcome.AlreadyVerified,
      retryAfterSeconds: 0,
    });
  });

  test.each([
    ["missing", undefined],
    ["zero", 0],
    ["negative", -30],
    ["NaN", Number.NaN],
    ["a string", "60"],
    ["null", null],
  ])(
    "falls back to the default wait when the cooldown is %s",
    (_label: string, retryAfterSeconds: unknown) => {
      const body: JSONObject = { emailSent: true };
      const coolingDownBody: JSONObject = { emailSent: false };

      if (retryAfterSeconds !== undefined) {
        body["retryAfterSeconds"] = retryAfterSeconds as number;
        coolingDownBody["retryAfterSeconds"] = retryAfterSeconds as number;
      }

      expect(parseVerificationEmailResendResponse(body)).toEqual({
        outcome: VerificationEmailResendOutcome.Sent,
        retryAfterSeconds:
          DEFAULT_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
      });
      expect(parseVerificationEmailResendResponse(coolingDownBody)).toEqual({
        outcome: VerificationEmailResendOutcome.CoolingDown,
        retryAfterSeconds:
          DEFAULT_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
      });
    },
  );

  test("clamps an absurd cooldown and rounds a fractional one up", () => {
    expect(
      parseVerificationEmailResendResponse({
        emailSent: false,
        retryAfterSeconds: 10 * 365 * 24 * 60 * 60,
      }).retryAfterSeconds,
    ).toBe(MAX_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS);
    expect(
      parseVerificationEmailResendResponse({
        emailSent: true,
        retryAfterSeconds: 12.2,
      }).retryAfterSeconds,
    ).toBe(13);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a string", "emailSent"],
    ["a number", 200],
    ["true", true],
    ["false", false],
    ["an array", [{ emailSent: true }]],
    ["an empty object", {}],
    ["a truthy but non-boolean emailSent", { emailSent: "true" }],
    ["emailSent as 1", { emailSent: 1 }],
    ["a truthy but non-boolean alreadyVerified", { alreadyVerified: "yes" }],
    ["alreadyVerified false and nothing else", { alreadyVerified: false }],
    ["an unrelated body", { message: "OK" }],
  ])(
    "refuses %s instead of claiming an email was sent",
    (_label: string, data: unknown) => {
      expect(() => {
        return parseVerificationEmailResendResponse(data);
      }).toThrow("Unexpected response to a verification email request.");
    },
  );
});

describe("getRetryAfterSecondsFromError", () => {
  test("reads the lower-cased header the browser hands back", () => {
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, { "retry-after": "30" }),
      ),
    ).toBe(30);
  });

  test.each(["Retry-After", "RETRY-AFTER", "retry-After"])(
    "finds the header spelled %s",
    (name: string) => {
      expect(
        getRetryAfterSecondsFromError(errorWithHeaders(429, { [name]: "45" })),
      ).toBe(45);
    },
  );

  test("finds the header among others", () => {
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, {
          "content-type": "application/json",
          "x-request-id": "abc",
          "retry-after": "900",
        }),
      ),
    ).toBe(900);
  });

  test("trims whitespace around the value", () => {
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, { "retry-after": "  12 \t" }),
      ),
    ).toBe(12);
  });

  test("accepts a numeric header value", () => {
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, { "retry-after": 75 as unknown as string }),
      ),
    ).toBe(75);
  });

  test("accepts zero", () => {
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, { "retry-after": "0" }),
      ),
    ).toBe(0);
  });

  test.each([
    ["a word", "soon"],
    ["an HTTP date", "Wed, 21 Oct 2015 07:28:00 GMT"],
    ["a negative number", "-5"],
    ["a fraction", "1.5"],
    ["a signed number", "+30"],
    ["an exponent", "1e3"],
    ["hex", "0x10"],
    ["an empty value", ""],
    ["only whitespace", "   "],
    ["two numbers", "30 60"],
    ["a number with a unit", "30s"],
  ])("ignores %s", (_label: string, value: string) => {
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, { "retry-after": value }),
      ),
    ).toBe(0);
  });

  test("ignores a header value that is neither a string nor a number", () => {
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, {
          "retry-after": { seconds: 30 } as unknown as string,
        }),
      ),
    ).toBe(0);
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, { "retry-after": null as unknown as string }),
      ),
    ).toBe(0);
  });

  test("caps a huge wait at one day", () => {
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, { "retry-after": "999999999999" }),
      ),
    ).toBe(MAX_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS);
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, { "retry-after": "9".repeat(20) }),
      ),
    ).toBe(MAX_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS);
  });

  test("treats a value too long to be a number as no wait (the caller's default applies)", () => {
    // 400 nines is Infinity once parsed: not a finite wait, so not believed.
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, { "retry-after": "9".repeat(400) }),
      ),
    ).toBe(0);
  });

  test("is 0 when a 429 names no wait", () => {
    expect(getRetryAfterSecondsFromError(errorWithHeaders(429, {}))).toBe(0);
    expect(
      getRetryAfterSecondsFromError(
        errorWithHeaders(429, { "x-retry-after": "30" }),
      ),
    ).toBe(0);
  });

  test("is 0 when the error carries no headers object", () => {
    const error: HTTPErrorResponse = errorWithHeaders(429, {});
    error.headers = undefined as unknown as Headers;

    expect(getRetryAfterSecondsFromError(error)).toBe(0);
  });

  test.each([400, 403, 404, 500, 502, 503])(
    "ignores Retry-After on a %p",
    (statusCode: number) => {
      expect(
        getRetryAfterSecondsFromError(
          errorWithHeaders(statusCode, { "retry-after": "30" }),
        ),
      ).toBe(0);
    },
  );

  test.each([
    ["a plain Error", new Error("429")],
    ["an API exception", new APIException("Network Error")],
    ["a success response", new HTTPResponse<JSONObject>(200, {}, {})],
    [
      "a look-alike object",
      { statusCode: 429, headers: { "retry-after": "30" } },
    ],
    ["a string", "429"],
    ["null", null],
    ["undefined", undefined],
  ])("is 0 for %s", (_label: string, error: unknown) => {
    expect(getRetryAfterSecondsFromError(error)).toBe(0);
  });
});

describe("requestVerificationEmailResend", () => {
  // API.post is generic; this is the instance jest.spyOn hands back.
  type PostSpy = SpyInstance<
    (options: PostOptions) => ReturnType<typeof API.post>
  >;

  const mockPost: (
    answer: HTTPResponse<JSONObject> | HTTPErrorResponse,
  ) => PostSpy = (
    answer: HTTPResponse<JSONObject> | HTTPErrorResponse,
  ): PostSpy => {
    return jest.spyOn(API, "post").mockImplementation(async () => {
      return answer as HTTPResponse<JSONObject>;
    });
  };

  const onlyCall: (spy: PostSpy) => PostOptions = (
    spy: PostSpy,
  ): PostOptions => {
    expect(spy).toHaveBeenCalledTimes(1);
    return spy.mock.calls[0]![0];
  };

  test("posts a resend token to /resend-verification-email and nothing else", async () => {
    const post: PostSpy = mockPost(
      new HTTPResponse<JSONObject>(
        200,
        { emailSent: true, alreadyVerified: false, retryAfterSeconds: 60 },
        {},
      ),
    );

    const result: VerificationEmailResendResult =
      await requestVerificationEmailResend({ resendToken: RESEND_TOKEN });

    const options: PostOptions = onlyCall(post);

    expect(options.url.toString()).toBe(
      RESEND_VERIFICATION_EMAIL_API_URL.toString(),
    );
    expect(options.url.toString()).toMatch(/\/resend-verification-email$/);
    expect(options.data).toEqual({ data: { resendToken: RESEND_TOKEN } });
    expect(result).toEqual({
      outcome: VerificationEmailResendOutcome.Sent,
      retryAfterSeconds: 60,
    });
  });

  test("posts a verification token in the same envelope", async () => {
    const post: PostSpy = mockPost(
      new HTTPResponse<JSONObject>(
        200,
        { emailSent: false, alreadyVerified: false, retryAfterSeconds: 17 },
        {},
      ),
    );

    const result: VerificationEmailResendResult =
      await requestVerificationEmailResend({
        verificationToken: VERIFICATION_TOKEN,
      });

    const options: PostOptions = onlyCall(post);

    expect(options.url.toString()).toBe(
      RESEND_VERIFICATION_EMAIL_API_URL.toString(),
    );
    expect(options.data).toEqual({
      data: { verificationToken: VERIFICATION_TOKEN },
    });
    expect(result).toEqual({
      outcome: VerificationEmailResendOutcome.CoolingDown,
      retryAfterSeconds: 17,
    });
  });

  test("never sends an email address or any other field the caller slipped in", async () => {
    const post: PostSpy = mockPost(
      new HTTPResponse<JSONObject>(200, { alreadyVerified: true }, {}),
    );

    await requestVerificationEmailResend({
      resendToken: RESEND_TOKEN,
      email: "someone-else@example.com",
      verificationToken: VERIFICATION_TOKEN,
    } as unknown as VerificationEmailResendCredential);

    expect(onlyCall(post).data).toEqual({
      data: { resendToken: RESEND_TOKEN },
    });
  });

  test("reads an already verified account", async () => {
    mockPost(
      new HTTPResponse<JSONObject>(
        200,
        { emailSent: false, alreadyVerified: true, retryAfterSeconds: 0 },
        {},
      ),
    );

    await expect(
      requestVerificationEmailResend({ resendToken: RESEND_TOKEN }),
    ).resolves.toEqual({
      outcome: VerificationEmailResendOutcome.AlreadyVerified,
      retryAfterSeconds: 0,
    });
  });

  test.each([400, 429, 500, 503])(
    "throws the %p response itself, so the caller can tell refusals apart",
    async (statusCode: number) => {
      const refusal: HTTPErrorResponse = errorWithHeaders(statusCode, {
        "retry-after": "30",
      });
      mockPost(refusal);

      await expect(
        requestVerificationEmailResend({ resendToken: RESEND_TOKEN }),
      ).rejects.toBe(refusal);
    },
  );

  test("passes a network failure through untouched", async () => {
    const failure: APIException = new APIException("Network Error");
    jest.spyOn(API, "post").mockRejectedValue(failure);

    await expect(
      requestVerificationEmailResend({ verificationToken: VERIFICATION_TOKEN }),
    ).rejects.toBe(failure);
  });

  test("refuses a success whose body it does not understand", async () => {
    mockPost(new HTTPResponse<JSONObject>(200, { ok: true }, {}));

    await expect(
      requestVerificationEmailResend({ resendToken: RESEND_TOKEN }),
    ).rejects.toThrow("Unexpected response to a verification email request.");
  });
});

describe("getWebmailProvider", () => {
  test.each([
    ["ada@gmail.com", GMAIL],
    ["ada@googlemail.com", GMAIL],
    ["ada@outlook.com", OUTLOOK],
    ["ada@hotmail.com", OUTLOOK],
    ["ada@live.com", OUTLOOK],
    ["ada@msn.com", OUTLOOK],
    ["ada@yahoo.com", YAHOO],
    ["ada@ymail.com", YAHOO],
    ["ada@rocketmail.com", YAHOO],
    ["ada@icloud.com", ICLOUD],
    ["ada@me.com", ICLOUD],
    ["ada@mac.com", ICLOUD],
    ["ada@proton.me", PROTON],
    ["ada@protonmail.com", PROTON],
    ["ada@protonmail.ch", PROTON],
    ["ada@pm.me", PROTON],
  ])("recognises %s", (email: string, provider: WebmailProvider) => {
    expect(getWebmailProvider(email)).toEqual(provider);
  });

  test.each([
    ["outlook.de"],
    ["outlook.fr"],
    ["outlook.co.uk"],
    ["outlook.com.au"],
    ["hotmail.co.uk"],
    ["hotmail.fr"],
    ["hotmail.com.br"],
    ["live.co.uk"],
    ["live.com.au"],
    ["live.nl"],
  ])("recognises the regional Outlook domain %s", (domain: string) => {
    expect(getWebmailProvider(`ada@${domain}`)).toEqual(OUTLOOK);
  });

  test.each([
    ["yahoo.fr"],
    ["yahoo.de"],
    ["yahoo.co.uk"],
    ["yahoo.co.jp"],
    ["yahoo.com.br"],
    ["yahoo.com.au"],
  ])("recognises the regional Yahoo domain %s", (domain: string) => {
    expect(getWebmailProvider(`ada@${domain}`)).toEqual(YAHOO);
  });

  test("ignores case in the domain and whitespace around the address", () => {
    expect(getWebmailProvider("Ada.Lovelace@GMAIL.COM")).toEqual(GMAIL);
    expect(getWebmailProvider("  ada@Gmail.com  ")).toEqual(GMAIL);
    expect(getWebmailProvider("\tada@Hotmail.Co.UK\n")).toEqual(OUTLOOK);
    expect(getWebmailProvider("ADA@YAHOO.CO.JP")).toEqual(YAHOO);
  });

  test("accepts any non-empty local part, tags included", () => {
    expect(getWebmailProvider("ada+oneuptime@gmail.com")).toEqual(GMAIL);
    expect(getWebmailProvider("a@pm.me")).toEqual(PROTON);
  });

  test("hands out a copy, so nobody can rewrite the shared table", () => {
    const first: WebmailProvider | null = getWebmailProvider("ada@gmail.com");

    expect(first).not.toBeNull();
    first!.url = "https://attacker.example.com/";
    first!.name = "Attacker";

    expect(getWebmailProvider("grace@gmail.com")).toEqual(GMAIL);
  });

  test.each([
    ["a look-alike that ends in another domain", "ada@gmail.com.evil.io"],
    ["a look-alike prefix", "ada@notgmail.com"],
    ["a look-alike suffix", "ada@gmail.co"],
    ["a subdomain of a provider", "ada@mail.gmail.com"],
    ["a provider as a subdomain", "ada@gmail.evil.io"],
    ["a trailing dot", "ada@gmail.com."],
    ["two at signs", "a@b@gmail.com"],
    ["an at sign in the domain", "ada@gmail.com@evil.io"],
    ["an empty local part", "@gmail.com"],
    ["an empty domain", "ada@"],
    ["no at sign", "gmail.com"],
    ["an empty string", ""],
    ["only whitespace", "   "],
    ["a company domain", "ada@acme.com"],
    ["another company domain", "ada@oneuptime.com"],
    ["an unknown webmail", "ada@fastmail.com"],
    ["a regional Gmail that does not exist", "ada@gmail.de"],
    ["a three-letter country code", "ada@outlook.abc"],
    ["a numeric country code", "ada@yahoo.12"],
    ["a regional look-alike", "ada@outlook.co.uk.evil.io"],
    ["an unlisted outlook form", "ada@outlook.org.uk"],
    ["a msn regional domain (not listed)", "ada@msn.de"],
    ["an icloud regional domain (not listed)", "ada@icloud.de"],
    ["an internal space", "ada@gm ail.com"],
  ])("offers no link for %s", (_label: string, email: string) => {
    expect(getWebmailProvider(email)).toBeNull();
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
  ])("offers no link for %s", (_label: string, email: null | undefined) => {
    expect(getWebmailProvider(email)).toBeNull();
  });

  test("offers no link for a value that is not a string at all", () => {
    expect(
      getWebmailProvider({ toString: "ada@gmail.com" } as unknown as string),
    ).toBeNull();
    expect(getWebmailProvider(42 as unknown as string)).toBeNull();
  });

  test("every link it hands out is one of the fixed inbox URLs", () => {
    const allowedUrls: Array<string> = [
      GMAIL.url,
      OUTLOOK.url,
      YAHOO.url,
      ICLOUD.url,
      PROTON.url,
    ];

    for (const email of [
      'evil"onclick@gmail.com',
      "javascript:alert(1)@gmail.com",
      "<script>@outlook.com",
      "x@yahoo.co.jp",
    ]) {
      const provider: WebmailProvider | null = getWebmailProvider(email);

      expect(provider).not.toBeNull();
      expect(allowedUrls).toContain(provider!.url);
      expect(provider!.url).not.toContain(email);
    }
  });
});
