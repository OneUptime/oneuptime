import Attribution from "../../../../Server/Utils/Attribution";
import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";
import MicrosoftAdsProvider from "../../../../Server/Utils/Marketing/Providers/MicrosoftAds";
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
 * ---------------------------------------------------------------------------
 * Microsoft Advertising offline conversions.
 *
 * Microsoft matches on msclkid or on a hashed email (its enhanced conversions),
 * and names its goals by string rather than by id — so a typo in a conversion
 * name is a silently unmatched upload, and an unset one must leave the row
 * pending rather than upload it under another goal's name.
 * ---------------------------------------------------------------------------
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    MicrosoftAdsDeveloperToken: "developer-token",
    MicrosoftAdsOAuthClientId: "ms-client-id",
    MicrosoftAdsOAuthClientSecret: "ms-client-secret",
    MicrosoftAdsOAuthRefreshToken: "ms-refresh-token",
    MicrosoftAdsCustomerId: "ms-customer",
    MicrosoftAdsAccountId: "ms-account",
    MicrosoftAdsSignUpConversionName: "OneUptime Signup",
    MicrosoftAdsPaidSubscriptionConversionName: "OneUptime Paid",
    MicrosoftAdsMeetingBookedConversionName: "OneUptime Demo Booked",
    MicrosoftAdsEnterpriseLicenseRequestConversionName:
      "OneUptime Enterprise Request",
  };
});

type MakeConversionFunction = (
  data?: Partial<MarketingConversion>,
) => MarketingConversion;

const makeConversion: MakeConversionFunction = (
  data: Partial<MarketingConversion> = {},
): MarketingConversion => {
  return Object.assign(new MarketingConversion(), {
    conversionType: MarketingConversionType.SignUp,
    conversionAt: new Date("2026-07-22T10:11:12.345Z"),
    clickIds: { msclkid: "microsoft-click" },
    ...data,
  });
};

type ResponseFunction = (data: JSONObject) => AxiosResponse<JSONObject>;

const response: ResponseFunction = (
  data: JSONObject,
): AxiosResponse<JSONObject> => {
  return { data } as AxiosResponse<JSONObject>;
};

type MockUploadFunction = (
  postSpy: SpyInstance<any>,
  data?: JSONObject,
) => void;

// Call 0 is the OAuth token exchange; call 1 is the conversion upload.
const mockUpload: MockUploadFunction = (
  postSpy: SpyInstance<any>,
  data: JSONObject = {},
): void => {
  postSpy
    .mockResolvedValueOnce(
      response({ access_token: "access-token", expires_in: 3600 }) as never,
    )
    .mockResolvedValueOnce(response(data) as never);
};

type UploadedConversionFunction = (postSpy: SpyInstance<any>) => JSONObject;

const uploadedConversion: UploadedConversionFunction = (
  postSpy: SpyInstance<any>,
): JSONObject => {
  const body: JSONObject = postSpy.mock.calls[1]?.[1] as JSONObject;
  return (body["OfflineConversions"] as Array<JSONObject>)[0]!;
};

describe("MicrosoftAdsProvider", () => {
  let provider: MicrosoftAdsProvider;
  let postSpy: SpyInstance<any>;

  beforeEach(() => {
    provider = new MicrosoftAdsProvider();
    postSpy = jest.spyOn(axios, "post") as SpyInstance<any>;
    jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-07-23T10:11:12.345Z").getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reports configured only when the OAuth and account settings exist", () => {
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
        reason: "No Microsoft click id (msclkid) and no email to match on",
        isPermanent: true,
      });
    });

    test("permanently skips a conversion outside Microsoft's 90-day window", () => {
      expect(
        provider.getSkipReason(
          makeConversion({
            conversionAt: new Date("2026-01-01T00:00:00.000Z"),
          }),
        ),
      ).toEqual({
        reason: "Conversion older than Microsoft's 90-day click window",
        isPermanent: true,
      });
    });

    test("sends the click id and the hashed email when both are known", async () => {
      mockUpload(postSpy);

      await provider.upload([makeConversion({ email: "Ada@Example.com" })]);

      expect(uploadedConversion(postSpy)).toMatchObject({
        MicrosoftClickId: "microsoft-click",
        HashedEmailAddress: Attribution.hashEmail("ada@example.com"),
      });
    });

    test("omits MicrosoftClickId entirely when there is no click id", async () => {
      mockUpload(postSpy);

      await provider.upload([
        makeConversion({ clickIds: {}, email: "ada@example.com" }),
      ]);

      const uploaded: JSONObject = uploadedConversion(postSpy);

      expect(uploaded["MicrosoftClickId"]).toBeUndefined();
      expect(uploaded["HashedEmailAddress"]).toBe(
        Attribution.hashEmail("ada@example.com"),
      );
    });

    test("never sends the address in the clear", async () => {
      mockUpload(postSpy);

      await provider.upload([makeConversion({ email: "ada@example.com" })]);

      expect(JSON.stringify(postSpy.mock.calls[1]?.[1])).not.toContain(
        "ada@example.com",
      );
    });
  });

  describe("conversion goals", () => {
    test.each([
      [MarketingConversionType.SignUp, "OneUptime Signup"],
      [MarketingConversionType.PaidSubscription, "OneUptime Paid"],
      [MarketingConversionType.MeetingBooked, "OneUptime Demo Booked"],
      [
        MarketingConversionType.EnterpriseLicenseRequested,
        "OneUptime Enterprise Request",
      ],
    ])(
      "reports %s against its own goal name",
      async (conversionType: MarketingConversionType, expectedName: string) => {
        mockUpload(postSpy);

        await provider.upload([
          makeConversion({ conversionType: conversionType }),
        ]);

        expect(uploadedConversion(postSpy)["ConversionName"]).toBe(
          expectedName,
        );
      },
    );

    test.each([
      MarketingConversionType.MeetingBooked,
      MarketingConversionType.EnterpriseLicenseRequested,
    ])(
      "attaches no ConversionValue to %s even when the row holds one",
      async (conversionType: MarketingConversionType) => {
        mockUpload(postSpy);

        await provider.upload([
          makeConversion({
            conversionType: conversionType,
            conversionValueInUSDCents: 500000,
          }),
        ]);

        const uploaded: JSONObject = uploadedConversion(postSpy);

        expect(uploaded["ConversionValue"]).toBeUndefined();
        expect(uploaded["ConversionCurrencyCode"]).toBeUndefined();
      },
    );

    test("attaches ConversionValue to a paid subscription", async () => {
      mockUpload(postSpy);

      await provider.upload([
        makeConversion({
          conversionType: MarketingConversionType.PaidSubscription,
          conversionValueInUSDCents: 12999,
        }),
      ]);

      expect(uploadedConversion(postSpy)).toMatchObject({
        ConversionValue: 129.99,
        ConversionCurrencyCode: "USD",
      });
    });
  });

  test("sends the conversion time as second-precision ISO 8601 UTC", async () => {
    mockUpload(postSpy);

    await provider.upload([makeConversion()]);

    expect(uploadedConversion(postSpy)["ConversionTime"]).toBe(
      "2026-07-22T10:11:12Z",
    );
  });

  test("records per-item PartialErrors against the right batch index", async () => {
    mockUpload(postSpy, {
      PartialErrors: [
        { Index: 1, ErrorCode: "InvalidClickId", Message: "not found" },
      ],
    });

    const result: ConversionUploadBatchResult = await provider.upload([
      makeConversion(),
      makeConversion({ clickIds: { msclkid: "expired" } }),
    ]);

    expect(result.permanentFailures.size).toBe(1);
    expect(result.permanentFailures.get(1)).toBe("InvalidClickId not found");
  });
});
