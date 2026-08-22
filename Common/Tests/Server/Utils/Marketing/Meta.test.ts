import Attribution from "../../../../Server/Utils/Attribution";
import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";
import MetaProvider from "../../../../Server/Utils/Marketing/Providers/Meta";
import { ConversionSkip } from "../../../../Server/Utils/Marketing/ConversionUploadProvider";
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
 * Meta Conversions API.
 *
 * Two things this file is really about:
 *
 *   - WHAT A CONVERSION IS CALLED. Meta's event names carry meaning to the
 *     optimiser. `Purchase` demands a value and pulls the event into the
 *     revenue optimisation pool; `Schedule` and `Lead` do not. The provider
 *     used to send `isSignUp ? CompleteRegistration : Purchase`, so anything
 *     that was not a signup was revenue by default.
 *
 *   - HOW A PERSON IS IDENTIFIED. Meta matches on a click id, a hashed email,
 *     or both. Requiring fbclid — which the provider used to — discarded every
 *     conversion whose click id had not survived to the moment of conversion,
 *     which is nearly all of a sales-led funnel.
 * ---------------------------------------------------------------------------
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    MetaConversionsPixelId: "pixel-id",
    MetaConversionsAccessToken: "meta-access-token",
    MetaGraphApiVersion: "v22.0",
  };
});

type MakeConversionFunction = (
  data?: Partial<MarketingConversion>,
) => MarketingConversion;

const makeConversion: MakeConversionFunction = (
  data: Partial<MarketingConversion> = {},
): MarketingConversion => {
  return Object.assign(new MarketingConversion(), {
    id: new ObjectID("11111111-1111-4111-8111-111111111111"),
    conversionType: MarketingConversionType.SignUp,
    conversionAt: new Date("2026-07-22T10:11:12.345Z"),
    clickIds: { fbclid: "meta-click" },
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

const uploadedEvent: UploadedEventFunction = (
  postSpy: SpyInstance<any>,
): JSONObject => {
  const body: JSONObject = postSpy.mock.calls[0]?.[1] as JSONObject;
  return (body["data"] as Array<JSONObject>)[0]!;
};

describe("MetaProvider", () => {
  let provider: MetaProvider;
  let postSpy: SpyInstance<any>;

  beforeEach(() => {
    provider = new MetaProvider();
    postSpy = jest.spyOn(axios, "post") as SpyInstance<any>;
    // Meta only accepts events up to 7 days old; freeze inside that window.
    jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-07-23T10:11:12.345Z").getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reports configured only when the pixel and token exist", () => {
    expect(provider.isConfigured()).toBe(true);
  });

  describe("identifiers", () => {
    test("accepts a conversion with only a click id", () => {
      expect(
        provider.getSkipReason(makeConversion({ clickIds: { fbclid: "x" } })),
      ).toBeNull();
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
        reason: "No Meta click id (fbclid) and no email to match on",
        isPermanent: true,
      });
    });

    test("permanently skips a conversion outside Meta's 7-day window", () => {
      const skip: ConversionSkip | null = provider.getSkipReason(
        makeConversion({
          conversionAt: new Date("2026-07-01T00:00:00.000Z"),
        }),
      );

      expect(skip).toEqual({
        reason: "Conversion older than Meta's 7-day upload window",
        isPermanent: true,
      });
    });

    test("sends fbc and a hashed email when both are known", async () => {
      postSpy.mockResolvedValueOnce(response({ events_received: 1 }) as never);

      await provider.upload([makeConversion({ email: "Ada@Example.com" })]);

      /*
       * fbc is fb.1.{creationTimeMs}.{fbclid} per Meta's spec, and the
       * creation time it uses is the conversion time — the original click
       * timestamp is not stored.
       */
      expect(uploadedEvent(postSpy)["user_data"]).toEqual({
        fbc: `fb.1.${new Date("2026-07-22T10:11:12.345Z").getTime()}.meta-click`,
        em: [Attribution.hashEmail("ada@example.com")],
      });
    });

    /*
     * fbc is built by splicing the click id into a template, so an absent
     * click id must omit the field entirely rather than send a well-formed
     * string ending in nothing.
     */
    test("omits fbc entirely when there is no click id", async () => {
      postSpy.mockResolvedValueOnce(response({ events_received: 1 }) as never);

      await provider.upload([
        makeConversion({ clickIds: {}, email: "ada@example.com" }),
      ]);

      const userData: JSONObject = uploadedEvent(postSpy)[
        "user_data"
      ] as JSONObject;

      expect(userData["fbc"]).toBeUndefined();
      expect(userData["em"]).toEqual([
        Attribution.hashEmail("ada@example.com"),
      ]);
    });

    test("never sends the address in the clear", async () => {
      postSpy.mockResolvedValueOnce(response({ events_received: 1 }) as never);

      await provider.upload([makeConversion({ email: "ada@example.com" })]);

      expect(JSON.stringify(postSpy.mock.calls[0]?.[1])).not.toContain(
        "ada@example.com",
      );
    });
  });

  describe("event naming", () => {
    test.each([
      [MarketingConversionType.SignUp, "CompleteRegistration"],
      [MarketingConversionType.MeetingBooked, "Schedule"],
      [MarketingConversionType.PaidSubscription, "Purchase"],
    ])(
      "sends %s as %s",
      async (
        conversionType: MarketingConversionType,
        expectedEventName: string,
      ) => {
        postSpy.mockResolvedValueOnce(
          response({ events_received: 1 }) as never,
        );

        await provider.upload([
          makeConversion({ conversionType: conversionType }),
        ]);

        expect(uploadedEvent(postSpy)["event_name"]).toBe(expectedEventName);
      },
    );

    /*
     * The regression this exists for: a booked meeting reported as a Purchase
     * carrying the row's value would teach Meta's optimiser that demos are
     * revenue.
     */
    test.each([MarketingConversionType.MeetingBooked])(
      "attaches no custom_data to %s even when the row holds a value",
      async (conversionType: MarketingConversionType) => {
        postSpy.mockResolvedValueOnce(
          response({ events_received: 1 }) as never,
        );

        await provider.upload([
          makeConversion({
            conversionType: conversionType,
            conversionValueInUSDCents: 500000,
          }),
        ]);

        const event: JSONObject = uploadedEvent(postSpy);

        expect(event["event_name"]).not.toBe("Purchase");
        expect(event["custom_data"]).toBeUndefined();
      },
    );

    /*
     * Purchase is the one event Meta rejects without a value, and one rejected
     * event fails the whole batch — so a custom-pricing subscription with no
     * known revenue must still send a value, even a zero one.
     */
    test("sends a zero value for a purchase whose revenue is unknown", async () => {
      postSpy.mockResolvedValueOnce(response({ events_received: 1 }) as never);

      await provider.upload([
        makeConversion({
          conversionType: MarketingConversionType.PaidSubscription,
        }),
      ]);

      expect(uploadedEvent(postSpy)["custom_data"]).toEqual({
        value: 0,
        currency: "USD",
      });
    });

    test("sends the real value for a purchase that has one", async () => {
      postSpy.mockResolvedValueOnce(response({ events_received: 1 }) as never);

      await provider.upload([
        makeConversion({
          conversionType: MarketingConversionType.PaidSubscription,
          conversionValueInUSDCents: 12999,
        }),
      ]);

      expect(uploadedEvent(postSpy)["custom_data"]).toEqual({
        value: 129.99,
        currency: "USD",
      });
    });
  });

  describe("delivery", () => {
    test("keys the event on the conversion row id so retries dedupe", async () => {
      postSpy.mockResolvedValueOnce(response({ events_received: 1 }) as never);

      await provider.upload([makeConversion()]);

      expect(uploadedEvent(postSpy)["event_id"]).toBe(
        "11111111-1111-4111-8111-111111111111",
      );
    });

    test("posts to the configured pixel", async () => {
      postSpy.mockResolvedValueOnce(response({ events_received: 1 }) as never);

      await provider.upload([makeConversion()]);

      expect(postSpy.mock.calls[0]?.[0]).toBe(
        "https://graph.facebook.com/v22.0/pixel-id/events",
      );
    });

    /*
     * A partial acceptance is thrown, not recorded as a per-row failure: the
     * response does not say WHICH events were dropped, so the only safe move is
     * to retry the batch, which event_id makes idempotent.
     */
    test("throws when Meta accepts fewer events than were sent", async () => {
      postSpy.mockResolvedValueOnce(response({ events_received: 1 }) as never);

      await expect(
        provider.upload([makeConversion(), makeConversion()]),
      ).rejects.toThrow("Meta accepted 1 of 2 events");
    });
  });
});
