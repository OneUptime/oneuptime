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

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    GoogleAdsApiVersion: "v23",
    GoogleAdsCustomerId: "1234567890",
    GoogleAdsDeveloperToken: "developer-token",
    GoogleAdsLoginCustomerId: "0987654321",
    GoogleAdsOAuthClientId: "oauth-client-id",
    GoogleAdsOAuthClientSecret: "oauth-client-secret",
    GoogleAdsOAuthRefreshToken: "oauth-refresh-token",
    GoogleAdsPaidSubscriptionConversionActionId: "222222",
    GoogleAdsSignUpConversionActionId: "111111",
  };
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
});
