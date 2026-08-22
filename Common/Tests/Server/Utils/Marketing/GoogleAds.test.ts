import Attribution from "../../../../Server/Utils/Attribution";
import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";
import logger from "../../../../Server/Utils/Logger";
import GoogleAdsProvider from "../../../../Server/Utils/Marketing/Providers/GoogleAds";
import { ConversionUploadBatchResult } from "../../../../Server/Utils/Marketing/ConversionUploadProvider";
import { JSONObject } from "../../../../Types/JSON";
import { MarketingConversionType } from "../../../../Types/Marketing/MarketingConversion";
import axios, { AxiosResponse } from "axios";
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
 * Enhanced conversions for leads is an account-level Google setting as much as
 * a OneUptime one, so the provider reads a flag for it. Both states have to be
 * reachable from this file, which a plain constant on the mock cannot do — the
 * provider imports the binding once. A getter can.
 */
let mockEnhancedConversionsForLeadsEnabled: boolean = false;

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const mocked: Record<string, unknown> = {
    GoogleAdsApiVersion: "v23",
    GoogleAdsCustomerId: "1234567890",
    GoogleAdsDeveloperToken: "developer-token",
    GoogleAdsLoginCustomerId: "0987654321",
    GoogleAdsOAuthClientId: "oauth-client-id",
    GoogleAdsOAuthClientSecret: "oauth-client-secret",
    GoogleAdsOAuthRefreshToken: "oauth-refresh-token",
    GoogleAdsPaidSubscriptionConversionActionId: "222222",
    GoogleAdsSignUpConversionActionId: "111111",
    GoogleAdsMeetingBookedConversionActionId: "333333",
  };

  Object.defineProperty(mocked, "GoogleAdsEnhancedConversionsForLeadsEnabled", {
    get: (): boolean => {
      return mockEnhancedConversionsForLeadsEnabled;
    },
  });

  return mocked;
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
    },
  };
});

const makeConversion: (
  data?: Partial<MarketingConversion>,
) => MarketingConversion = (
  data: Partial<MarketingConversion> = {},
): MarketingConversion => {
  return Object.assign(new MarketingConversion(), {
    conversionType: MarketingConversionType.SignUp,
    conversionAt: new Date("2026-07-22T10:11:12.345Z"),
    clickIds: { gclid: "google-click" },
    ...data,
  });
};

const response: (data: JSONObject) => AxiosResponse<JSONObject> = (
  data: JSONObject,
): AxiosResponse<JSONObject> => {
  return { data } as AxiosResponse<JSONObject>;
};

describe("GoogleAdsProvider", () => {
  let provider: GoogleAdsProvider;
  let postSpy: SpyInstance<any>;

  beforeEach(() => {
    provider = new GoogleAdsProvider();
    postSpy = jest.spyOn(axios, "post") as SpyInstance<any>;
    mockEnhancedConversionsForLeadsEnabled = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reports configured only when the OAuth and account settings exist", () => {
    expect(provider.isConfigured()).toBe(true);
  });

  test("permanently skips conversions without a Google click identifier", () => {
    expect(
      provider.getSkipReason(makeConversion({ clickIds: { fbclid: "meta" } })),
    ).toEqual({
      reason: "No Google click id (gclid/wbraid/gbraid)",
      isPermanent: true,
    });
  });

  test.each([
    ["gclid", "standard-click"],
    ["wbraid", "web-to-app-click"],
    ["gbraid", "app-to-web-click"],
  ])("accepts the supported %s identifier", (key: string, value: string) => {
    expect(
      provider.getSkipReason(makeConversion({ clickIds: { [key]: value } })),
    ).toBeNull();
  });

  test("prefers gclid when multiple Google identifiers are present", async () => {
    postSpy
      .mockResolvedValueOnce(
        response({ access_token: "access-token", expires_in: 3600 }) as never,
      )
      .mockResolvedValueOnce(response({}) as never);

    await provider.upload([
      makeConversion({
        clickIds: {
          gclid: "preferred-gclid",
          wbraid: "secondary-wbraid",
          gbraid: "secondary-gbraid",
        },
      }),
    ]);

    const uploadBody: JSONObject = postSpy.mock.calls[1]?.[1] as JSONObject;
    const uploadedConversion: JSONObject = (
      uploadBody["conversions"] as Array<JSONObject>
    )[0]!;

    expect(uploadedConversion).toMatchObject({ gclid: "preferred-gclid" });
    expect(uploadedConversion["wbraid"]).toBeUndefined();
    expect(uploadedConversion["gbraid"]).toBeUndefined();
  });

  test("permanently skips conversions outside Google's 90-day window", () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-07-22T12:00:00.000Z").getTime());

    expect(
      provider.getSkipReason(
        makeConversion({
          conversionAt: new Date("2026-04-01T00:00:00.000Z"),
        }),
      ),
    ).toEqual({
      reason: "Conversion older than Google's 90-day click window",
      isPermanent: true,
    });
  });

  test("uploads signup and paid conversions with the correct actions and value", async () => {
    postSpy
      .mockResolvedValueOnce(
        response({ access_token: "access-token", expires_in: 3600 }) as never,
      )
      .mockResolvedValueOnce(response({}) as never);

    const result: ConversionUploadBatchResult = await provider.upload([
      makeConversion({
        conversionType: MarketingConversionType.SignUp,
        clickIds: { wbraid: "signup-wbraid" },
      }),
      makeConversion({
        conversionType: MarketingConversionType.PaidSubscription,
        clickIds: { gbraid: "paid-gbraid" },
        conversionValueInUSDCents: 12999,
      }),
    ]);

    expect(result.permanentFailures.size).toBe(0);
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(postSpy.mock.calls[0]?.[0]).toBe(
      "https://oauth2.googleapis.com/token",
    );
    expect(postSpy.mock.calls[0]?.[1]).toContain(
      "refresh_token=oauth-refresh-token",
    );

    const uploadUrl: string = postSpy.mock.calls[1]?.[0] as string;
    const uploadBody: JSONObject = postSpy.mock.calls[1]?.[1] as JSONObject;
    const uploadOptions: JSONObject = postSpy.mock.calls[1]?.[2] as JSONObject;
    const conversions: Array<JSONObject> = uploadBody[
      "conversions"
    ] as Array<JSONObject>;

    expect(uploadUrl).toBe(
      "https://googleads.googleapis.com/v23/customers/1234567890:uploadClickConversions",
    );
    expect(uploadBody["partialFailure"]).toBe(true);
    expect(conversions[0]).toEqual({
      wbraid: "signup-wbraid",
      conversionAction: "customers/1234567890/conversionActions/111111",
      conversionDateTime: "2026-07-22 10:11:12+00:00",
    });
    expect(conversions[1]).toEqual({
      gbraid: "paid-gbraid",
      conversionAction: "customers/1234567890/conversionActions/222222",
      conversionDateTime: "2026-07-22 10:11:12+00:00",
      conversionValue: 129.99,
      currencyCode: "USD",
    });
    expect(uploadOptions).toMatchObject({
      headers: {
        Authorization: "Bearer access-token",
        "developer-token": "developer-token",
        "login-customer-id": "0987654321",
      },
      timeout: 30000,
    });
  });

  test("does not send zero or negative conversion values", async () => {
    postSpy
      .mockResolvedValueOnce(
        response({ access_token: "access-token", expires_in: 3600 }) as never,
      )
      .mockResolvedValueOnce(response({}) as never);

    await provider.upload([
      makeConversion({ conversionValueInUSDCents: 0 }),
      makeConversion({ conversionValueInUSDCents: -100 }),
    ]);

    const uploadBody: JSONObject = postSpy.mock.calls[1]?.[1] as JSONObject;
    const conversions: Array<JSONObject> = uploadBody[
      "conversions"
    ] as Array<JSONObject>;

    expect(conversions[0]?.["conversionValue"]).toBeUndefined();
    expect(conversions[0]?.["currencyCode"]).toBeUndefined();
    expect(conversions[1]?.["conversionValue"]).toBeUndefined();
  });

  test("reuses an unexpired OAuth access token across batches", async () => {
    postSpy
      .mockResolvedValueOnce(
        response({ access_token: "cached-token", expires_in: 3600 }) as never,
      )
      .mockResolvedValue(response({}) as never);

    await provider.upload([makeConversion()]);
    await provider.upload([makeConversion({ clickIds: { gclid: "second" } })]);

    expect(postSpy).toHaveBeenCalledTimes(3);
    expect(
      postSpy.mock.calls.filter((call: Array<unknown>) => {
        return call[0] === "https://oauth2.googleapis.com/token";
      }),
    ).toHaveLength(1);
  });

  test("maps indexed partial failures to the submitted conversion", async () => {
    postSpy
      .mockResolvedValueOnce(
        response({ access_token: "access-token", expires_in: 3600 }) as never,
      )
      .mockResolvedValueOnce(
        response({
          partialFailureError: {
            details: [
              {
                errors: [
                  {
                    message: "Expired click identifier",
                    location: {
                      fieldPathElements: [
                        { fieldName: "conversions", index: 1 },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        }) as never,
      );

    const result: ConversionUploadBatchResult = await provider.upload([
      makeConversion(),
      makeConversion({ clickIds: { gclid: "expired" } }),
    ]);

    expect(Array.from(result.permanentFailures.entries())).toEqual([
      [1, "Expired click identifier"],
    ]);
  });

  test("treats ALREADY_EXISTS as successful idempotent delivery", async () => {
    postSpy
      .mockResolvedValueOnce(
        response({ access_token: "access-token", expires_in: 3600 }) as never,
      )
      .mockResolvedValueOnce(
        response({
          partialFailureError: {
            details: [
              {
                errors: [
                  {
                    errorCode: { conversionUploadError: "ALREADY_EXISTS" },
                    message: "The conversion was already uploaded",
                    location: {
                      fieldPathElements: [
                        { fieldName: "conversions", index: 0 },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        }) as never,
      );

    const result: ConversionUploadBatchResult = await provider.upload([
      makeConversion(),
    ]);

    expect(result.permanentFailures.size).toBe(0);
  });

  test("logs an unparseable partial failure instead of silently hiding it", async () => {
    const errorSpy: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });
    postSpy
      .mockResolvedValueOnce(
        response({ access_token: "access-token", expires_in: 3600 }) as never,
      )
      .mockResolvedValueOnce(
        response({
          partialFailureError: {
            details: [{ errors: [{ message: "Unindexed failure" }] }],
          },
        }) as never,
      );

    const result: ConversionUploadBatchResult = await provider.upload([
      makeConversion(),
    ]);

    expect(result.permanentFailures.size).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Google Ads partial failure with unparseable indexes",
      ),
    );
  });

  /*
   * -------------------------------------------------------------------------
   * Enhanced conversions.
   *
   * A hashed email raises the match rate of any upload, and is the ONLY thing
   * that can attribute a sales-led deal: the gclid that started it is long gone
   * from the browser by the time a licence is signed. Two separate behaviours,
   * deliberately gated differently:
   *
   *   - attaching userIdentifiers alongside a click id needs no configuration
   *     and always happens;
   *   - uploading with ONLY a hashed email is enhanced conversions for leads,
   *     which the Google Ads account must be set up for, so it is behind a
   *     flag and refused when off.
   * -------------------------------------------------------------------------
   */
  describe("enhanced conversions", () => {
    test("attaches a hashed email alongside a click id without any flag", async () => {
      postSpy
        .mockResolvedValueOnce(
          response({ access_token: "access-token", expires_in: 3600 }) as never,
        )
        .mockResolvedValueOnce(response({}) as never);

      await provider.upload([makeConversion({ email: "ada@example.com" })]);

      const uploadBody: JSONObject = postSpy.mock.calls[1]?.[1] as JSONObject;
      const uploaded: JSONObject = (
        uploadBody["conversions"] as Array<JSONObject>
      )[0]!;

      expect(uploaded["userIdentifiers"]).toEqual([
        {
          hashedEmail: Attribution.hashEmail("ada@example.com"),
          userIdentifierSource: "FIRST_PARTY",
        },
      ]);
      // The click id is still there: enhanced matching adds, it does not replace.
      expect(uploaded["gclid"]).toBe("google-click");
    });

    test("never sends the address in the clear", async () => {
      postSpy
        .mockResolvedValueOnce(
          response({ access_token: "access-token", expires_in: 3600 }) as never,
        )
        .mockResolvedValueOnce(response({}) as never);

      await provider.upload([makeConversion({ email: "ada@example.com" })]);

      expect(JSON.stringify(postSpy.mock.calls[1]?.[1])).not.toContain(
        "ada@example.com",
      );
    });

    test("sends no userIdentifiers when there is no email at all", async () => {
      postSpy
        .mockResolvedValueOnce(
          response({ access_token: "access-token", expires_in: 3600 }) as never,
        )
        .mockResolvedValueOnce(response({}) as never);

      await provider.upload([makeConversion()]);

      const uploadBody: JSONObject = postSpy.mock.calls[1]?.[1] as JSONObject;
      const uploaded: JSONObject = (
        uploadBody["conversions"] as Array<JSONObject>
      )[0]!;

      expect(uploaded["userIdentifiers"]).toBeUndefined();
    });

    test("prefers the stored emailHash over the address column", async () => {
      postSpy
        .mockResolvedValueOnce(
          response({ access_token: "access-token", expires_in: 3600 }) as never,
        )
        .mockResolvedValueOnce(response({}) as never);

      await provider.upload([
        makeConversion({
          email: "ada@example.com",
          emailHash: "already-hashed-elsewhere",
        }),
      ]);

      const uploadBody: JSONObject = postSpy.mock.calls[1]?.[1] as JSONObject;
      const uploaded: JSONObject = (
        uploadBody["conversions"] as Array<JSONObject>
      )[0]!;

      expect(uploaded["userIdentifiers"]).toEqual([
        {
          hashedEmail: "already-hashed-elsewhere",
          userIdentifierSource: "FIRST_PARTY",
        },
      ]);
    });

    test("refuses an email-only conversion while the leads flag is off", () => {
      expect(
        provider.getSkipReason(
          makeConversion({ clickIds: {}, email: "ada@example.com" }),
        ),
      ).toEqual({
        reason: "No Google click id (gclid/wbraid/gbraid)",
        isPermanent: true,
      });
    });

    test("accepts an email-only conversion once the leads flag is on", () => {
      mockEnhancedConversionsForLeadsEnabled = true;

      expect(
        provider.getSkipReason(
          makeConversion({ clickIds: {}, email: "ada@example.com" }),
        ),
      ).toBeNull();
    });

    test("still refuses a conversion with neither a click id nor an email", () => {
      mockEnhancedConversionsForLeadsEnabled = true;

      expect(provider.getSkipReason(makeConversion({ clickIds: {} }))).toEqual({
        reason:
          "No Google click id (gclid/wbraid/gbraid) and no email to match on",
        isPermanent: true,
      });
    });

    test("uploads an email-only lead with no click id field at all", async () => {
      mockEnhancedConversionsForLeadsEnabled = true;

      postSpy
        .mockResolvedValueOnce(
          response({ access_token: "access-token", expires_in: 3600 }) as never,
        )
        .mockResolvedValueOnce(response({}) as never);

      await provider.upload([
        makeConversion({
          conversionType: MarketingConversionType.MeetingBooked,
          clickIds: {},
          email: "ada@example.com",
        }),
      ]);

      const uploadBody: JSONObject = postSpy.mock.calls[1]?.[1] as JSONObject;
      const uploaded: JSONObject = (
        uploadBody["conversions"] as Array<JSONObject>
      )[0]!;

      expect(uploaded).toEqual({
        conversionAction: "customers/1234567890/conversionActions/333333",
        conversionDateTime: "2026-07-22 10:11:12+00:00",
        userIdentifiers: [
          {
            hashedEmail: Attribution.hashEmail("ada@example.com"),
            userIdentifierSource: "FIRST_PARTY",
          },
        ],
      });
    });
  });

  /*
   * -------------------------------------------------------------------------
   * One conversion action per conversion type.
   *
   * The provider used to pick between two actions with `isSignUp ? a : b`, so
   * anything that was not a signup was reported against the paid-subscription
   * action. Each type now names its own.
   * -------------------------------------------------------------------------
   */
  describe("conversion action mapping", () => {
    test.each([
      [MarketingConversionType.SignUp, "111111"],
      [MarketingConversionType.PaidSubscription, "222222"],
      [MarketingConversionType.MeetingBooked, "333333"],
    ])(
      "reports %s against its own conversion action",
      async (
        conversionType: MarketingConversionType,
        expectedActionId: string,
      ) => {
        postSpy
          .mockResolvedValueOnce(
            response({
              access_token: "access-token",
              expires_in: 3600,
            }) as never,
          )
          .mockResolvedValueOnce(response({}) as never);

        await provider.upload([
          makeConversion({ conversionType: conversionType }),
        ]);

        const uploadBody: JSONObject = postSpy.mock.calls[1]?.[1] as JSONObject;
        const uploaded: JSONObject = (
          uploadBody["conversions"] as Array<JSONObject>
        )[0]!;

        expect(uploaded["conversionAction"]).toBe(
          `customers/1234567890/conversionActions/${expectedActionId}`,
        );
      },
    );

    test("never attaches revenue to a booked meeting", async () => {
      postSpy
        .mockResolvedValueOnce(
          response({ access_token: "access-token", expires_in: 3600 }) as never,
        )
        .mockResolvedValueOnce(response({}) as never);

      await provider.upload([
        makeConversion({
          conversionType: MarketingConversionType.MeetingBooked,
          conversionValueInUSDCents: 500000,
        }),
      ]);

      const uploadBody: JSONObject = postSpy.mock.calls[1]?.[1] as JSONObject;
      const uploaded: JSONObject = (
        uploadBody["conversions"] as Array<JSONObject>
      )[0]!;

      expect(uploaded["conversionValue"]).toBeUndefined();
      expect(uploaded["currencyCode"]).toBeUndefined();
    });
  });
});
