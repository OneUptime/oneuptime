import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The purchase a converted free trial makes, sent to Google Analytics by the
 * server because no browser is present when Stripe charges the card.
 *
 * Pinned here: that nothing is sent without the API secret a maintainer has
 * to create, or where Google tags are off; that nothing is sent for a project
 * whose row carries no campaign, which is the server's only evidence its
 * creator allowed measurement; that the campaign travels with the purchase,
 * since there is no session left for it to join; and that a failure never
 * reaches the Stripe webhook that called it, nor puts the secret in a log.
 */

let mockApiSecret: string = "";
let mockGoogleTagManagerEnabled: boolean = true;

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    get GoogleAnalyticsMeasurementProtocolApiSecret(): string {
      return mockApiSecret;
    },
    get GoogleTagManagerEnabled(): boolean {
      return mockGoogleTagManagerEnabled;
    },
  };
});

const mockLoggerError: jest.Mock = jest.fn();
const mockLoggerDebug: jest.Mock = jest.fn();

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: (...args: Array<unknown>): unknown => {
        return mockLoggerDebug(...args);
      },
      error: (...args: Array<unknown>): unknown => {
        return mockLoggerError(...args);
      },
      warn: jest.fn(),
    },
  };
});

const mockPost: jest.Mock = jest.fn();

jest.mock("axios", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
    },
  };
});

import GoogleAnalyticsMeasurementProtocol, {
  GOOGLE_ANALYTICS_MEASUREMENT_ID,
  GOOGLE_ANALYTICS_MEASUREMENT_PROTOCOL_URL,
  GoogleAnalyticsPurchase,
} from "../../../../Server/Utils/Marketing/GoogleAnalyticsMeasurementProtocol";
import { JSONObject } from "../../../../Types/JSON";

const API_SECRET: string = "mp-secret-not-for-production";
const USER_ID: string = "44444444-4444-4444-8444-444444444444";
const PAID_AT: Date = new Date("2026-09-07T10:01:00.000Z");

function purchase(
  overrides?: Partial<GoogleAnalyticsPurchase>,
): GoogleAnalyticsPurchase {
  return {
    userId: USER_ID,
    transactionId: "first_payment:project-1",
    value: 49,
    currency: "USD",
    plan: "Growth",
    occurredAt: PAID_AT,
    attributionSource: {
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "status-page-uk",
      utmTerm: "status page software",
      utmContent: "ad-variant-b",
      utmId: "2233445566",
      clickIds: { gclid: "gclid_abc123" },
      firstTouchAttribution: { utmSource: "google" },
    },
    ...overrides,
  };
}

interface PostedRequest {
  url: string;
  body: JSONObject;
  config: { params: JSONObject; headers: JSONObject };
}

function postedRequest(): PostedRequest {
  const call: Array<unknown> = mockPost.mock.calls[0] as Array<unknown>;

  return {
    url: call[0] as string,
    body: call[1] as JSONObject,
    config: call[2] as { params: JSONObject; headers: JSONObject },
  };
}

function postedEvents(): Array<{ name: string; params: JSONObject }> {
  return postedRequest().body["events"] as unknown as Array<{
    name: string;
    params: JSONObject;
  }>;
}

describe("GoogleAnalyticsMeasurementProtocol", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ status: 204 });
    mockLoggerError.mockReset();
    mockLoggerDebug.mockReset();
    mockApiSecret = API_SECRET;
    mockGoogleTagManagerEnabled = true;
  });

  describe("isConfigured", () => {
    test("needs the API secret and Google tags both", () => {
      expect(GoogleAnalyticsMeasurementProtocol.isConfigured()).toBe(true);

      mockApiSecret = "";
      expect(GoogleAnalyticsMeasurementProtocol.isConfigured()).toBe(false);

      mockApiSecret = API_SECRET;
      mockGoogleTagManagerEnabled = false;
      expect(GoogleAnalyticsMeasurementProtocol.isConfigured()).toBe(false);
    });
  });

  describe("sendPurchase", () => {
    test("posts to the Measurement Protocol with the product's property and the secret", async () => {
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(purchase());

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(postedRequest().url).toBe(
        GOOGLE_ANALYTICS_MEASUREMENT_PROTOCOL_URL,
      );
      expect(postedRequest().config.params).toEqual({
        measurement_id: GOOGLE_ANALYTICS_MEASUREMENT_ID,
        api_secret: API_SECRET,
      });
    });

    test("sends the purchase the browser would have sent, under the marketing event's id", async () => {
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(purchase());

      expect(postedEvents()[1]).toEqual({
        name: "purchase",
        params: {
          transaction_id: "first_payment:project-1",
          value: 49,
          currency: "USD",
          items: [
            {
              item_id: "Growth",
              item_name: "Growth",
              price: 49,
              quantity: 1,
            },
          ],
        },
      });
    });

    test("puts the project's campaign ahead of the purchase, for Google Analytics to credit it to", async () => {
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(purchase());

      expect(postedEvents()[0]).toEqual({
        name: "campaign_details",
        params: {
          source: "google",
          medium: "cpc",
          campaign: "status-page-uk",
          campaign_id: "2233445566",
          term: "status page software",
          content: "ad-variant-b",
        },
      });
    });

    test("identifies the creator as the Dashboard does, dated when the money arrived", async () => {
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(purchase());

      const body: JSONObject = postedRequest().body;

      expect(body["user_id"]).toBe(USER_ID);
      expect(body["client_id"]).toBe(
        GoogleAnalyticsMeasurementProtocol.getClientId(USER_ID),
      );
      expect(body["timestamp_micros"]).toBe(PAID_AT.getTime() * 1000);
      expect(body["consent"]).toEqual({
        ad_user_data: "GRANTED",
        ad_personalization: "GRANTED",
      });
    });

    test("credits a Google Ads click with no campaign parameters to google / cpc", async () => {
      // Auto-tagging adds the click ID and nothing else.
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(
        purchase({
          attributionSource: { clickIds: { gclid: "gclid_only" } },
        }),
      );

      expect(postedEvents()[0]).toEqual({
        name: "campaign_details",
        params: { source: "google", medium: "cpc" },
      });
    });

    /*
     * Google Ads adds gad_source and gad_campaignid to its ad clicks, beside
     * the click ID, so a click with no UTMs still says which campaign won it.
     */
    test("credits a Google Ads click with no UTMs to the campaign Google Ads named on it", async () => {
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(
        purchase({
          attributionSource: {
            gadSource: "1",
            gadCampaignId: "23145678901",
            clickIds: { gclid: "gclid_auto_tagged" },
          },
        }),
      );

      expect(postedEvents()[0]).toEqual({
        name: "campaign_details",
        params: {
          source: "google",
          medium: "cpc",
          campaign_id: "23145678901",
        },
      });
    });

    // gad_source comes with auto-tagging off too, when there is no click ID.
    test("credits a click carrying only Google Ads' own parameters to google / cpc", async () => {
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(
        purchase({ attributionSource: { gadSource: "1" } }),
      );

      expect(postedEvents()[0]).toEqual({
        name: "campaign_details",
        params: { source: "google", medium: "cpc" },
      });
    });

    test("takes the campaign ID from Google Ads when the ad's UTMs carry none", async () => {
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(
        purchase({
          attributionSource: {
            utmSource: "google",
            utmMedium: "cpc",
            utmCampaign: "status-page-uk",
            gadCampaignId: "23145678901",
            clickIds: { gclid: "gclid_abc123" },
          },
        }),
      );

      expect(postedEvents()[0]).toEqual({
        name: "campaign_details",
        params: {
          source: "google",
          medium: "cpc",
          campaign: "status-page-uk",
          campaign_id: "23145678901",
        },
      });
    });

    test("keeps the campaign ID the ad's own utm_id gives", async () => {
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(
        purchase({
          attributionSource: {
            ...purchase().attributionSource,
            gadCampaignId: "99999999999",
          },
        }),
      );

      expect(postedEvents()[0]!.params["campaign_id"]).toBe("2233445566");
    });

    test("sends the purchase alone when the campaign names no source Google Analytics knows", async () => {
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(
        purchase({
          attributionSource: { clickIds: { msclkid: "bing_click" } },
        }),
      );

      expect(
        postedEvents().map((event: { name: string }) => {
          return event.name;
        }),
      ).toEqual(["purchase"]);
    });

    test("keeps a campaign value to the hundred characters Google Analytics keeps", async () => {
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(
        purchase({
          attributionSource: {
            utmSource: "google",
            utmCampaign: "c".repeat(180),
          },
        }),
      );

      expect(postedEvents()[0]!.params["campaign"]).toBe("c".repeat(100));
    });

    test("never dates a purchase ahead of now", async () => {
      const before: number = Date.now();

      await GoogleAnalyticsMeasurementProtocol.sendPurchase(
        purchase({ occurredAt: new Date(Date.now() + 3600 * 1000) }),
      );

      const timestampInMicros: number = postedRequest().body[
        "timestamp_micros"
      ] as number;

      expect(timestampInMicros).toBeGreaterThanOrEqual(before * 1000);
      expect(timestampInMicros).toBeLessThanOrEqual(Date.now() * 1000);
    });

    test("sends nothing without the API secret", async () => {
      mockApiSecret = "";

      await GoogleAnalyticsMeasurementProtocol.sendPurchase(purchase());

      expect(mockPost).not.toHaveBeenCalled();
    });

    test("sends nothing where Google tags are off", async () => {
      mockGoogleTagManagerEnabled = false;

      await GoogleAnalyticsMeasurementProtocol.sendPurchase(purchase());

      expect(mockPost).not.toHaveBeenCalled();
    });

    test("sends nothing for a project that carries no campaign", async () => {
      /*
       * The signup form hands a campaign over only while measurement is
       * allowed. Without one, nothing says this person allowed it.
       */
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(
        purchase({
          attributionSource: {
            utmSource: "",
            clickIds: {},
            firstTouchAttribution: {},
          },
        }),
      );

      expect(mockPost).not.toHaveBeenCalled();
    });

    test("sends nothing without a user to key it on", async () => {
      await GoogleAnalyticsMeasurementProtocol.sendPurchase(
        purchase({ userId: "" }),
      );

      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  describe("sendPurchaseInBackground", () => {
    test("neither throws nor rejects when Google Analytics cannot be reached, and keeps the secret out of the log", async () => {
      mockPost.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

      expect(() => {
        GoogleAnalyticsMeasurementProtocol.sendPurchaseInBackground(purchase());
      }).not.toThrow();

      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });

      expect(mockLoggerError).toHaveBeenCalledTimes(1);

      const logged: string = String(mockLoggerError.mock.calls[0]![0]);

      expect(logged).toContain("first_payment:project-1");
      expect(logged).not.toContain(API_SECRET);
    });
  });

  describe("getClientId", () => {
    test("is the same for a user every time, different between users, and shaped like the Google tag's", () => {
      const clientId: string =
        GoogleAnalyticsMeasurementProtocol.getClientId(USER_ID);

      expect(clientId).toMatch(/^\d+\.\d+$/);
      expect(GoogleAnalyticsMeasurementProtocol.getClientId(USER_ID)).toBe(
        clientId,
      );
      expect(
        GoogleAnalyticsMeasurementProtocol.getClientId(
          "55555555-5555-4555-8555-555555555555",
        ),
      ).not.toBe(clientId);
    });
  });

  describe("the property", () => {
    test("is the one the product's pages load", () => {
      // A purchase sent to another property would never meet its campaign.
      const consentPartial: string = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../Server/Views/Partials/AnalyticsConsent.ejs",
        ),
        "utf8",
      );

      expect(consentPartial).toContain(
        `gtag/js?id=${GOOGLE_ANALYTICS_MEASUREMENT_ID}`,
      );
      expect(consentPartial).toContain(
        `window.gtag('config', '${GOOGLE_ANALYTICS_MEASUREMENT_ID}')`,
      );
    });
  });
});
