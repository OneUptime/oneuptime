import Attribution from "../../../../Server/Utils/Attribution";
import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";
import LinkedInProvider from "../../../../Server/Utils/Marketing/Providers/LinkedIn";
import { ConversionSkip } from "../../../../Server/Utils/Marketing/ConversionUploadProvider";
import { JSONObject } from "../../../../Types/JSON";
import { MarketingConversionType } from "../../../../Types/Marketing/MarketingConversion";
import ObjectID from "../../../../Types/ObjectID";
import axios, { AxiosError } from "axios";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * ---------------------------------------------------------------------------
 * LinkedIn Conversions API.
 *
 * LinkedIn is the platform where enhanced matching matters most for this
 * product: it is where enterprise buyers are advertised to, and an enterprise
 * cycle is exactly the case where the li_fat_id from the original click is
 * long gone by the time the deal closes. LinkedIn accepts several userIds per
 * event and resolves whichever it can, so both identifiers are sent.
 *
 * Conversion rules are per-type and operator-configured, so an unset rule id
 * must leave the conversion PENDING rather than discard it.
 * ---------------------------------------------------------------------------
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    LinkedInApiVersion: "202606",
    LinkedInConversionsAccessToken: "linkedin-token",
    LinkedInSignUpConversionId: "1111",
    LinkedInPaidSubscriptionConversionId: "2222",
    LinkedInMeetingBookedConversionId: "3333",
    LinkedInEnterpriseLicenseRequestConversionId: "4444",
  };
});

type MakeConversionFunction = (
  data?: Partial<MarketingConversion>,
) => MarketingConversion;

const makeConversion: MakeConversionFunction = (
  data: Partial<MarketingConversion> = {},
): MarketingConversion => {
  return Object.assign(new MarketingConversion(), {
    id: new ObjectID("33333333-3333-4333-8333-333333333333"),
    conversionType: MarketingConversionType.SignUp,
    conversionAt: new Date("2026-07-22T10:11:12.345Z"),
    clickIds: { li_fat_id: "linkedin-click" },
    ...data,
  });
};

type UploadedBodyFunction = (postSpy: SpyInstance<any>) => JSONObject;

const uploadedBody: UploadedBodyFunction = (
  postSpy: SpyInstance<any>,
): JSONObject => {
  return postSpy.mock.calls[0]?.[1] as JSONObject;
};

describe("LinkedInProvider", () => {
  let provider: LinkedInProvider;
  let postSpy: SpyInstance<any>;

  beforeEach(() => {
    provider = new LinkedInProvider();
    postSpy = jest.spyOn(axios, "post") as SpyInstance<any>;
    jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-07-23T10:11:12.345Z").getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reports configured when the access token exists", () => {
    expect(provider.isConfigured()).toBe(true);
  });

  describe("identifiers", () => {
    test("accepts a conversion with only a click id", () => {
      expect(provider.getSkipReason(makeConversion())).toBeNull();
    });

    test("accepts a conversion with only an email", () => {
      expect(
        provider.getSkipReason(
          makeConversion({ clickIds: {}, email: "ada@example.com" }),
        ),
      ).toBeNull();
    });

    test("permanently skips a conversion with neither", () => {
      expect(provider.getSkipReason(makeConversion({ clickIds: {} }))).toEqual({
        reason: "No LinkedIn click id (li_fat_id) and no email to match on",
        isPermanent: true,
      });
    });

    test("sends both identifiers when both are known", async () => {
      postSpy.mockResolvedValueOnce({} as never);

      await provider.upload([makeConversion({ email: "Ada@Example.com" })]);

      expect(uploadedBody(postSpy)["user"]).toEqual({
        userIds: [
          {
            idType: "LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID",
            idValue: "linkedin-click",
          },
          {
            idType: "SHA256_EMAIL",
            idValue: Attribution.hashEmail("ada@example.com"),
          },
        ],
      });
    });

    /*
     * The click id used to be sent as an empty idValue when absent, which is a
     * userId LinkedIn can never resolve rather than an absent one.
     */
    test("sends only the email identifier when there is no click id", async () => {
      postSpy.mockResolvedValueOnce({} as never);

      await provider.upload([
        makeConversion({ clickIds: {}, email: "ada@example.com" }),
      ]);

      expect(uploadedBody(postSpy)["user"]).toEqual({
        userIds: [
          {
            idType: "SHA256_EMAIL",
            idValue: Attribution.hashEmail("ada@example.com"),
          },
        ],
      });
    });

    test("never sends the address in the clear", async () => {
      postSpy.mockResolvedValueOnce({} as never);

      await provider.upload([makeConversion({ email: "ada@example.com" })]);

      expect(JSON.stringify(uploadedBody(postSpy))).not.toContain(
        "ada@example.com",
      );
    });
  });

  describe("conversion rules", () => {
    test.each([
      [MarketingConversionType.SignUp, "1111"],
      [MarketingConversionType.PaidSubscription, "2222"],
      [MarketingConversionType.MeetingBooked, "3333"],
      [MarketingConversionType.EnterpriseLicenseRequested, "4444"],
    ])(
      "reports %s against its own conversion rule",
      async (
        conversionType: MarketingConversionType,
        expectedRuleId: string,
      ) => {
        postSpy.mockResolvedValueOnce({} as never);

        await provider.upload([
          makeConversion({ conversionType: conversionType }),
        ]);

        expect(uploadedBody(postSpy)["conversion"]).toBe(
          `urn:lla:llaPartnerConversion:${expectedRuleId}`,
        );
      },
    );

    test.each([
      MarketingConversionType.MeetingBooked,
      MarketingConversionType.EnterpriseLicenseRequested,
    ])(
      "attaches no conversionValue to %s even when the row holds one",
      async (conversionType: MarketingConversionType) => {
        postSpy.mockResolvedValueOnce({} as never);

        await provider.upload([
          makeConversion({
            conversionType: conversionType,
            conversionValueInUSDCents: 500000,
          }),
        ]);

        expect(uploadedBody(postSpy)["conversionValue"]).toBeUndefined();
      },
    );

    test("attaches conversionValue to a paid subscription", async () => {
      postSpy.mockResolvedValueOnce({} as never);

      await provider.upload([
        makeConversion({
          conversionType: MarketingConversionType.PaidSubscription,
          conversionValueInUSDCents: 12999,
        }),
      ]);

      expect(uploadedBody(postSpy)["conversionValue"]).toEqual({
        currencyCode: "USD",
        amount: "129.99",
      });
    });
  });

  test("keys the event on the conversion row id so retries dedupe", async () => {
    postSpy.mockResolvedValueOnce({} as never);

    await provider.upload([makeConversion()]);

    expect(uploadedBody(postSpy)["eventId"]).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  test("permanently skips a conversion outside LinkedIn's 90-day window", () => {
    const skip: ConversionSkip | null = provider.getSkipReason(
      makeConversion({ conversionAt: new Date("2026-01-01T00:00:00.000Z") }),
    );

    expect(skip).toEqual({
      reason: "Conversion older than LinkedIn's 90-day window",
      isPermanent: true,
    });
  });

  describe("failure handling", () => {
    type BuildAxiosErrorFunction = (status: number) => AxiosError;

    const buildAxiosError: BuildAxiosErrorFunction = (
      status: number,
    ): AxiosError => {
      const error: AxiosError = new AxiosError("rejected");
      Object.assign(error, { response: { status: status, data: {} } });
      return error;
    };

    test.each([400, 422])(
      "records a %s as a permanent per-event failure",
      async (status: number) => {
        postSpy.mockRejectedValueOnce(buildAxiosError(status) as never);

        const result: { permanentFailures: Map<number, string> } =
          await provider.upload([makeConversion()]);

        expect(result.permanentFailures.get(0)).toContain(`HTTP ${status}`);
      },
    );

    /*
     * Anything that is not a definitive validation rejection is transport
     * level. It must throw so the whole batch stays pending and is retried —
     * recording it as a permanent failure would discard a conversion because
     * the token had expired or LinkedIn had a bad minute.
     */
    test.each([401, 429, 500, 503])(
      "throws on a %s so the batch is retried",
      async (status: number) => {
        postSpy.mockRejectedValueOnce(buildAxiosError(status) as never);

        await expect(provider.upload([makeConversion()])).rejects.toBeDefined();
      },
    );

    test("throws on a network error with no response at all", async () => {
      postSpy.mockRejectedValueOnce(new Error("socket hang up") as never);

      await expect(provider.upload([makeConversion()])).rejects.toThrow(
        "socket hang up",
      );
    });
  });
});
