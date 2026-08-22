import Attribution from "../../../../Server/Utils/Attribution";
import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";
import RedditProvider from "../../../../Server/Utils/Marketing/Providers/Reddit";
import { JSONObject } from "../../../../Types/JSON";
import { MarketingConversionType } from "../../../../Types/Marketing/MarketingConversion";
import ObjectID from "../../../../Types/ObjectID";
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
 * Reddit Conversions API.
 *
 * Reddit's tracking types are the same hazard as Meta's event names: `Purchase`
 * is the revenue type, and the provider used to reach it for anything that was
 * not a signup. Reddit has no "meeting booked" type, so both sales-led steps
 * are `Lead` — which is the honest mapping, not a placeholder.
 *
 * Reddit also matches on a hashed email, so a conversion without rdt_cid is
 * still uploadable.
 * ---------------------------------------------------------------------------
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    RedditAdsOAuthClientId: "reddit-client-id",
    RedditAdsOAuthClientSecret: "reddit-client-secret",
    RedditAdsOAuthRefreshToken: "reddit-refresh-token",
    RedditAdsAccountId: "reddit-account",
  };
});

type MakeConversionFunction = (
  data?: Partial<MarketingConversion>,
) => MarketingConversion;

const makeConversion: MakeConversionFunction = (
  data: Partial<MarketingConversion> = {},
): MarketingConversion => {
  return Object.assign(new MarketingConversion(), {
    id: new ObjectID("22222222-2222-4222-8222-222222222222"),
    conversionType: MarketingConversionType.SignUp,
    conversionAt: new Date("2026-07-22T10:11:12.345Z"),
    clickIds: { rdt_cid: "reddit-click" },
    ...data,
  });
};

type ResponseFunction = (data: JSONObject) => AxiosResponse<JSONObject>;

const response: ResponseFunction = (
  data: JSONObject,
): AxiosResponse<JSONObject> => {
  return { data } as AxiosResponse<JSONObject>;
};

type UploadedEventFunction = (postSpy: SpyInstance<any>) => JSONObject;

// Call 0 is the OAuth token exchange; call 1 is the conversion upload.
const uploadedEvent: UploadedEventFunction = (
  postSpy: SpyInstance<any>,
): JSONObject => {
  const body: JSONObject = postSpy.mock.calls[1]?.[1] as JSONObject;
  return (body["events"] as Array<JSONObject>)[0]!;
};

type MockUploadFunction = (postSpy: SpyInstance<any>) => void;

const mockUpload: MockUploadFunction = (postSpy: SpyInstance<any>): void => {
  postSpy
    .mockResolvedValueOnce(
      response({ access_token: "access-token", expires_in: 3600 }) as never,
    )
    .mockResolvedValueOnce(response({}) as never);
};

describe("RedditProvider", () => {
  let provider: RedditProvider;
  let postSpy: SpyInstance<any>;

  beforeEach(() => {
    provider = new RedditProvider();
    postSpy = jest.spyOn(axios, "post") as SpyInstance<any>;
    // Reddit only accepts events up to 7 days old; freeze inside that window.
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
        reason: "No Reddit click id (rdt_cid) and no email to match on",
        isPermanent: true,
      });
    });

    test("permanently skips a conversion outside Reddit's 7-day window", () => {
      expect(
        provider.getSkipReason(
          makeConversion({
            conversionAt: new Date("2026-07-01T00:00:00.000Z"),
          }),
        ),
      ).toEqual({
        reason: "Conversion older than Reddit's 7-day upload window",
        isPermanent: true,
      });
    });

    test("sends the click id and the hashed email when both are known", async () => {
      mockUpload(postSpy);

      await provider.upload([makeConversion({ email: "Ada@Example.com" })]);

      const event: JSONObject = uploadedEvent(postSpy);

      expect(event["click_id"]).toBe("reddit-click");
      expect(event["user"]).toEqual({
        email: Attribution.hashEmail("ada@example.com"),
      });
    });

    /*
     * The click id used to be sent as `click_id: "" ` when absent. An empty
     * string is not "no identifier" to an API, it is an identifier that cannot
     * match anything — omit the field instead.
     */
    test("omits click_id entirely when there is no click id", async () => {
      mockUpload(postSpy);

      await provider.upload([
        makeConversion({ clickIds: {}, email: "ada@example.com" }),
      ]);

      expect(uploadedEvent(postSpy)["click_id"]).toBeUndefined();
    });

    test("never sends the address in the clear", async () => {
      mockUpload(postSpy);

      await provider.upload([makeConversion({ email: "ada@example.com" })]);

      expect(JSON.stringify(postSpy.mock.calls[1]?.[1])).not.toContain(
        "ada@example.com",
      );
    });
  });

  describe("tracking types", () => {
    test.each([
      [MarketingConversionType.SignUp, "SignUp"],
      [MarketingConversionType.MeetingBooked, "Lead"],
      [MarketingConversionType.PaidSubscription, "Purchase"],
    ])(
      "sends %s as %s",
      async (
        conversionType: MarketingConversionType,
        expectedTrackingType: string,
      ) => {
        mockUpload(postSpy);

        await provider.upload([
          makeConversion({ conversionType: conversionType }),
        ]);

        expect(uploadedEvent(postSpy)["event_type"]).toEqual({
          tracking_type: expectedTrackingType,
        });
      },
    );

    test.each([MarketingConversionType.MeetingBooked])(
      "attaches no revenue to %s even when the row holds a value",
      async (conversionType: MarketingConversionType) => {
        mockUpload(postSpy);

        await provider.upload([
          makeConversion({
            conversionType: conversionType,
            conversionValueInUSDCents: 500000,
          }),
        ]);

        const metadata: JSONObject = uploadedEvent(postSpy)[
          "event_metadata"
        ] as JSONObject;

        expect(metadata["value_decimal"]).toBeUndefined();
        expect(metadata["currency"]).toBeUndefined();
      },
    );

    test("attaches revenue to a paid subscription", async () => {
      mockUpload(postSpy);

      await provider.upload([
        makeConversion({
          conversionType: MarketingConversionType.PaidSubscription,
          conversionValueInUSDCents: 12999,
        }),
      ]);

      expect(uploadedEvent(postSpy)["event_metadata"]).toEqual({
        conversion_id: "22222222-2222-4222-8222-222222222222",
        value_decimal: 129.99,
        currency: "USD",
      });
    });
  });

  test("keys the event on the conversion row id so retries dedupe", async () => {
    mockUpload(postSpy);

    await provider.upload([makeConversion()]);

    expect(
      (uploadedEvent(postSpy)["event_metadata"] as JSONObject)["conversion_id"],
    ).toBe("22222222-2222-4222-8222-222222222222");
  });

  test("posts to the configured ad account", async () => {
    mockUpload(postSpy);

    await provider.upload([makeConversion()]);

    expect(postSpy.mock.calls[1]?.[0]).toBe(
      "https://ads-api.reddit.com/api/v2.0/conversions/events/reddit-account",
    );
  });
});
