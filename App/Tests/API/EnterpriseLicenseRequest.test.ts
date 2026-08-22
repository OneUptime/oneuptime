import {
  buildResponse,
  CapturedResponse,
  createMockRouter,
  MockRouter,
  RouteHandler,
} from "./CalWebhookTestUtil";
import Attribution from "Common/Server/Utils/Attribution";
import MarketingConversion from "Common/Models/DatabaseModels/MarketingConversion";
import MarketingConversionService from "Common/Server/Services/MarketingConversionService";
import MailService from "Common/Server/Services/MailService";
import MarketingFormRateLimit, {
  MarketingFormRateLimitOutcome,
} from "Common/Server/Middleware/MarketingFormRateLimit";
import { ExpressRequest, NextFunction } from "Common/Server/Utils/Express";
import EmailMessage from "Common/Types/Email/EmailMessage";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { MarketingConversionType } from "Common/Types/Marketing/MarketingConversion";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * POST /api/enterprise-license-request
 *
 * WHAT THIS ENDPOINT REPLACED
 *
 * A `mailto:enterprise@oneuptime.com` link. A mailto sends no request to
 * OneUptime, so the most valuable step of the funnel produced no click id, no
 * campaign, and no row — an ad spend could not be connected to the deals it
 * bought. The lead still reaches the same inbox; it is simply attributable on
 * the way.
 *
 * WHAT THE TESTS HAVE TO HOLD DOWN
 *
 * Unlike the Cal webhook, there is no signature here: the caller is a browser,
 * and any secret it held would be public. So everything in the body is hostile
 * input, and the load-bearing assertions are:
 *
 *   - a body with no usable email writes nothing;
 *   - resubmitting the same address produces ONE ledger row, because the row's
 *     primary key is derived from the address — otherwise a stranger inflates
 *     the count that ad platforms are given;
 *   - only allowlisted attribution keys survive, and nothing free-text the
 *     person typed reaches the ledger at all;
 *   - the lead still reaches sales when the ledger write was a duplicate, and
 *     the ledger write still stands when the mail fails.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockRouter = createMockRouter();

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): MockRouter => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Services/MarketingConversionService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/MarketingFormRateLimit", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Middleware/MarketingFormRateLimit",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      consume: jest.fn(),
      resolveClientIp: jest.fn((): string => {
        return "203.0.113.7";
      }),
      resolveEmailKey: jest.fn((): string => {
        return "email-key";
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    EnterpriseSalesEmail: "enterprise@oneuptime.com",
  };
});

import {
  EnterpriseLicenseRequestInput,
  getEnterpriseLicenseRequestConversionId,
  parseEnterpriseLicenseRequest,
} from "../../API/EnterpriseLicenseRequest";

type BuildRequestFunction = (body: unknown) => ExpressRequest;

const buildRequest: BuildRequestFunction = (body: unknown): ExpressRequest => {
  return {
    body: body,
    params: {},
    query: {},
    headers: {},
  } as unknown as ExpressRequest;
};

type CallRouteFunction = (request: ExpressRequest) => Promise<{
  response: CapturedResponse;
  next: NextFunction;
}>;

const callRoute: CallRouteFunction = async (
  request: ExpressRequest,
): Promise<{ response: CapturedResponse; next: NextFunction }> => {
  const handler: RouteHandler = mockRouter.match(
    "POST",
    "/enterprise-license-request",
  );
  const response: CapturedResponse = buildResponse();
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await handler(request, response, next);

  return { response, next };
};

type CreatedConversionFunction = () => MarketingConversion;

const createdConversion: CreatedConversionFunction =
  (): MarketingConversion => {
    const call: { data: MarketingConversion } = (
      MarketingConversionService.create as unknown as jest.Mock
    ).mock.calls[0]![0] as { data: MarketingConversion };

    return call.data;
  };

type SentMailFunction = () => EmailMessage;

const sentMail: SentMailFunction = (): EmailMessage => {
  return (MailService.sendMail as unknown as jest.Mock).mock
    .calls[0]![0] as EmailMessage;
};

const VALID_BODY: JSONObject = {
  email: "Ada@Example.com",
  name: "Ada Lovelace",
  company: "Analytical Engines Ltd",
  message: "We need 400 monitors, air-gapped.",
  utm: {
    utmSource: "linkedin",
    utmMedium: "paid-social",
    utmCampaign: "enterprise-q3",
  },
  clickIds: { li_fat_id: "linkedin-click" },
  firstTouchAttribution: {
    utmSource: "google",
    landingUrl: "https://oneuptime.com/enterprise",
  },
};

describe("EnterpriseLicenseRequest", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (
      MarketingConversionService.findOneById as unknown as jest.Mock
    ).mockResolvedValue(null as never);
    (
      MarketingConversionService.create as unknown as jest.Mock
    ).mockResolvedValue(new MarketingConversion() as never);
    (MailService.sendMail as unknown as jest.Mock).mockResolvedValue(
      undefined as never,
    );
    (MarketingFormRateLimit.consume as unknown as jest.Mock).mockResolvedValue({
      outcome: MarketingFormRateLimitOutcome.Allowed,
    } as never);
  });

  describe("body parsing", () => {
    test("normalizes the email and keeps the contact fields", () => {
      const parsed: EnterpriseLicenseRequestInput | null =
        parseEnterpriseLicenseRequest(VALID_BODY);

      expect(parsed).toMatchObject({
        email: "ada@example.com",
        name: "Ada Lovelace",
        company: "Analytical Engines Ltd",
        message: "We need 400 monitors, air-gapped.",
      });
    });

    test.each([
      ["a missing email", {}],
      ["an empty email", { email: "" }],
      ["a whitespace email", { email: "   " }],
      ["a malformed email", { email: "not-an-email" }],
      ["a non-string email", { email: 42 }],
      ["an email with no domain", { email: "ada@" }],
    ])("rejects %s", (_label: string, body: JSONObject) => {
      expect(parseEnterpriseLicenseRequest(body)).toBeNull();
    });

    test("reads attribution nested under utm and clickIds", () => {
      expect(parseEnterpriseLicenseRequest(VALID_BODY)).toMatchObject({
        utm: {
          utmSource: "linkedin",
          utmMedium: "paid-social",
          utmCampaign: "enterprise-q3",
        },
        clickIds: { li_fat_id: "linkedin-click" },
      });
    });

    /*
     * A hand-rolled integration will reasonably put the attribution alongside
     * the contact fields rather than nested, and refusing that would be a
     * gratuitous way to lose attribution.
     */
    test("reads attribution posted flat alongside the contact fields", () => {
      expect(
        parseEnterpriseLicenseRequest({
          email: "ada@example.com",
          utm_source: "google",
          utm_campaign: "flat-campaign",
          gclid: "flat-click",
        }),
      ).toMatchObject({
        utm: { utmSource: "google", utmCampaign: "flat-campaign" },
        clickIds: { gclid: "flat-click" },
      });
    });

    test("drops attribution keys that are not allowlisted", () => {
      const parsed: EnterpriseLicenseRequestInput | null =
        parseEnterpriseLicenseRequest({
          email: "ada@example.com",
          clickIds: { gclid: "valid", attackerKey: "must-not-persist" },
          utm: { utmSource: "google", utmEvil: "must-not-persist" },
        });

      expect(parsed?.clickIds).toEqual({ gclid: "valid" });
      expect(parsed?.utm).toEqual({ utmSource: "google" });
    });

    test.each([
      ["name", "name", 200],
      ["company", "company", 200],
      ["message", "message", 4000],
    ])(
      "bounds %s at %i characters",
      (_label: string, field: string, maxLength: number) => {
        const parsed: EnterpriseLicenseRequestInput | null =
          parseEnterpriseLicenseRequest({
            email: "ada@example.com",
            [field]: "x".repeat(maxLength + 500),
          });

        expect(
          (parsed as unknown as Record<string, string>)[field],
        ).toHaveLength(maxLength);
      },
    );

    test("bounds the email at the width of the column it lands in", () => {
      const longLocalPart: string = "a".repeat(200);

      expect(
        parseEnterpriseLicenseRequest({
          email: `${longLocalPart}@example.com`,
        }),
      ).toBeNull();
    });
  });

  describe("deterministic conversion id", () => {
    test("is stable across calls for one address", () => {
      expect(
        getEnterpriseLicenseRequestConversionId("ada@example.com").toString(),
      ).toBe(
        getEnterpriseLicenseRequestConversionId("ada@example.com").toString(),
      );
    });

    test("ignores case and padding, as the ledger's identity does", () => {
      expect(
        getEnterpriseLicenseRequestConversionId(
          "  ADA@Example.com ",
        ).toString(),
      ).toBe(
        getEnterpriseLicenseRequestConversionId("ada@example.com").toString(),
      );
    });

    test("differs between addresses", () => {
      expect(
        getEnterpriseLicenseRequestConversionId("ada@example.com").toString(),
      ).not.toBe(
        getEnterpriseLicenseRequestConversionId("grace@example.com").toString(),
      );
    });

    test("is a well-formed UUID Postgres will accept", () => {
      expect(
        ObjectID.isValidUUID(
          getEnterpriseLicenseRequestConversionId("ada@example.com").toString(),
        ),
      ).toBe(true);
    });
  });

  describe("route", () => {
    test("records the request and answers 200", async () => {
      const { response } = await callRoute(buildRequest(VALID_BODY));

      expect(response.statusCode).toBe(200);
      expect(response.jsonBody).toEqual({ accepted: true, duplicate: false });
      expect(MarketingConversionService.create).toHaveBeenCalledTimes(1);
    });

    test("writes an EnterpriseLicenseRequested conversion carrying the attribution", async () => {
      await callRoute(buildRequest(VALID_BODY));

      const conversion: MarketingConversion = createdConversion();

      expect(conversion.conversionType).toBe(
        MarketingConversionType.EnterpriseLicenseRequested,
      );
      expect(conversion.email).toBe("ada@example.com");
      expect(conversion.emailHash).toBe(
        Attribution.hashEmail("ada@example.com"),
      );
      expect(conversion.clickIds).toEqual({ li_fat_id: "linkedin-click" });
      expect(conversion.utmSource).toBe("linkedin");
      expect(conversion.utmMedium).toBe("paid-social");
      expect(conversion.utmCampaign).toBe("enterprise-q3");
      expect(conversion.firstTouchAttribution).toEqual({
        utmSource: "google",
        landingUrl: "https://oneuptime.com/enterprise",
      });
    });

    /*
     * Every column of the ledger is a candidate for forwarding to an ad
     * platform. Free text a prospect typed is not.
     */
    test("stores none of the free text the person typed", async () => {
      await callRoute(buildRequest(VALID_BODY));

      const serialized: string = JSON.stringify(createdConversion());

      expect(serialized).not.toContain("Ada Lovelace");
      expect(serialized).not.toContain("Analytical Engines");
      expect(serialized).not.toContain("air-gapped");
    });

    test("claims no revenue, user or project for a lead", async () => {
      await callRoute(buildRequest(VALID_BODY));

      const conversion: MarketingConversion = createdConversion();

      expect(conversion.userId).toBeUndefined();
      expect(conversion.projectId).toBeUndefined();
      expect(conversion.conversionValueInUSDCents).toBeUndefined();
    });

    test("keys the row on the address so a resubmission is one conversion", async () => {
      await callRoute(buildRequest(VALID_BODY));

      expect(createdConversion().id?.toString()).toBe(
        getEnterpriseLicenseRequestConversionId("ada@example.com").toString(),
      );
    });

    test("does not insert again when the row already exists", async () => {
      (
        MarketingConversionService.findOneById as unknown as jest.Mock
      ).mockResolvedValue(new MarketingConversion() as never);

      const { response } = await callRoute(buildRequest(VALID_BODY));

      expect(response.statusCode).toBe(200);
      expect(response.jsonBody).toEqual({ accepted: true, duplicate: true });
      expect(MarketingConversionService.create).not.toHaveBeenCalled();
    });

    /*
     * The existence check and the insert are two statements, so two concurrent
     * submissions can both miss and both insert. The loser collides on the
     * derived key — which means the request IS recorded.
     */
    test("absorbs a unique violation from a concurrent submission", async () => {
      (
        MarketingConversionService.create as unknown as jest.Mock
      ).mockRejectedValue(
        Object.assign(new Error("duplicate key"), { code: "23505" }) as never,
      );

      const { response, next } = await callRoute(buildRequest(VALID_BODY));

      expect(response.statusCode).toBe(200);
      expect(response.jsonBody).toEqual({ accepted: true, duplicate: true });
      expect(next).not.toHaveBeenCalled();
    });

    test("passes a non-unique-violation database error to the error handler", async () => {
      (
        MarketingConversionService.create as unknown as jest.Mock
      ).mockRejectedValue(new Error("connection reset") as never);

      const { next } = await callRoute(buildRequest(VALID_BODY));

      expect(next).toHaveBeenCalled();
    });

    test.each([
      ["a body with no email", { name: "Ada" }],
      ["an empty body", {}],
      ["a null body", null],
      ["an array body", []],
      ["a string body", "email=ada@example.com"],
    ])(
      "answers 400 and writes nothing for %s",
      async (_label: string, body: unknown) => {
        const { response } = await callRoute(buildRequest(body));

        expect(response.statusCode).toBe(400);
        expect(MarketingConversionService.create).not.toHaveBeenCalled();
        expect(MailService.sendMail).not.toHaveBeenCalled();
      },
    );

    test("creates and reads with root props on this internal table", async () => {
      await callRoute(buildRequest(VALID_BODY));

      expect(MarketingConversionService.findOneById).toHaveBeenCalledWith(
        expect.objectContaining({ props: { isRoot: true } }),
      );
      expect(MarketingConversionService.create).toHaveBeenCalledWith(
        expect.objectContaining({ props: { isRoot: true } }),
      );
    });
  });

  describe("rate limiting", () => {
    test("answers 429 without writing or emailing when limited", async () => {
      (
        MarketingFormRateLimit.consume as unknown as jest.Mock
      ).mockResolvedValue({
        outcome: MarketingFormRateLimitOutcome.RateLimited,
        retryAfterSeconds: 120,
      } as never);

      const { response } = await callRoute(buildRequest(VALID_BODY));

      expect(response.statusCode).toBe(429);
      expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "120");
      expect(MarketingConversionService.create).not.toHaveBeenCalled();
      expect(MailService.sendMail).not.toHaveBeenCalled();
    });

    /*
     * The thing behind this limiter is a sales lead. Refusing real leads for
     * the duration of a Redis incident costs more than the spam a short
     * unthrottled window admits.
     */
    test("accepts the request when the counter is unavailable", async () => {
      (
        MarketingFormRateLimit.consume as unknown as jest.Mock
      ).mockResolvedValue({
        outcome: MarketingFormRateLimitOutcome.CounterUnavailable,
      } as never);

      const { response } = await callRoute(buildRequest(VALID_BODY));

      expect(response.statusCode).toBe(200);
      expect(MarketingConversionService.create).toHaveBeenCalledTimes(1);
    });

    test("bills the request to the trusted client address and the email", async () => {
      await callRoute(buildRequest(VALID_BODY));

      expect(MarketingFormRateLimit.resolveEmailKey).toHaveBeenCalledWith(
        "ada@example.com",
      );
      expect(MarketingFormRateLimit.consume).toHaveBeenCalledWith({
        emailKey: "email-key",
        clientIp: "203.0.113.7",
      });
    });
  });

  describe("the lead email", () => {
    test("goes to the configured sales address", async () => {
      await callRoute(buildRequest(VALID_BODY));

      expect(sentMail().toEmail.toString()).toBe("enterprise@oneuptime.com");
    });

    /*
     * The notification service compiles `body` as a Handlebars template
     * against `vars`, and `{{ }}` HTML-escapes. Interpolating the person's
     * text into the body string instead would hand a stranger both an HTML
     * injection into the sales inbox and a template the server then compiles.
     */
    test("carries caller text in vars, never spliced into the body", async () => {
      await callRoute(
        buildRequest({
          ...VALID_BODY,
          name: "<script>alert(1)</script>",
          message: "{{constructor}}",
        }),
      );

      const mail: EmailMessage = sentMail();

      expect(mail.body).not.toContain("<script>");
      expect(mail.body).not.toContain("alert(1)");
      expect(mail.vars["name"]).toBe("<script>alert(1)</script>");
      expect(mail.vars["message"]).toBe("{{constructor}}");
    });

    test("includes the attribution so sales can see where the lead came from", async () => {
      await callRoute(buildRequest(VALID_BODY));

      expect(sentMail().vars).toMatchObject({
        email: "ada@example.com",
        company: "Analytical Engines Ltd",
        utmSource: "linkedin",
        utmMedium: "paid-social",
        utmCampaign: "enterprise-q3",
      });
    });

    test("names the missing optional fields rather than leaving them blank", async () => {
      await callRoute(buildRequest({ email: "ada@example.com" }));

      expect(sentMail().vars).toMatchObject({
        name: "(not given)",
        company: "(not given)",
        message: "(none)",
        utmSource: "(none)",
      });
    });

    /*
     * Someone resubmitting usually means the first one was missed. The ledger
     * must not count it twice; a human should still hear about it.
     */
    test("still reaches sales when the ledger row already existed", async () => {
      (
        MarketingConversionService.findOneById as unknown as jest.Mock
      ).mockResolvedValue(new MarketingConversion() as never);

      await callRoute(buildRequest(VALID_BODY));

      expect(MailService.sendMail).toHaveBeenCalledTimes(1);
    });

    /*
     * Best effort: a mail outage must not become a 500 that loses the lead the
     * ledger has already accepted.
     */
    test("still answers 200 when the mail fails", async () => {
      (MailService.sendMail as unknown as jest.Mock).mockRejectedValue(
        new Error("smtp down") as never,
      );

      const { response, next } = await callRoute(buildRequest(VALID_BODY));

      expect(response.statusCode).toBe(200);
      expect(response.jsonBody).toEqual({ accepted: true, duplicate: false });
      expect(next).not.toHaveBeenCalled();
      expect(MarketingConversionService.create).toHaveBeenCalledTimes(1);
    });
  });
});
