import axios from "axios";
import crypto from "crypto";
import {
  GoogleAnalyticsMeasurementProtocolApiSecret,
  GoogleTagManagerEnabled,
} from "../../EnvironmentConfig";
import type { AttributionSource } from "./MarketingEventUtil";
import {
  UtmPropertyKeys,
  UtmUrlPropertyKey,
} from "../../../Types/Marketing/Attribution";
import { JSONObject } from "../../../Types/JSON";
import logger from "../Logger";

/*
 * The Google Analytics property the product's pages load
 * (Common/Server/Views/Partials/AnalyticsConsent.ejs, analytics-only mode)
 * and the marketing site's Tag Manager container sends to.
 */
export const GOOGLE_ANALYTICS_MEASUREMENT_ID: string = "G-76XZF1WF3Z";

export const GOOGLE_ANALYTICS_MEASUREMENT_PROTOCOL_URL: string =
  "https://www.google-analytics.com/mp/collect";

const REQUEST_TIMEOUT_MS: number = 15000;

// Google Analytics keeps 100 characters of a parameter on a standard property.
const MAX_PARAMETER_VALUE_LENGTH: number = 100;

/*
 * Google's own ad click ids. Google Analytics reports a visit that carries
 * one, and no campaign parameters, as google / cpc.
 */
const GOOGLE_AD_CLICK_ID_KEYS: Array<string> = ["gclid", "gbraid", "wbraid"];

// The campaign columns, as Google Analytics' campaign_details parameters.
const CAMPAIGN_DETAILS_PARAMETER_BY_PROPERTY_KEY: Record<string, string> = {
  utmSource: "source",
  utmMedium: "medium",
  utmCampaign: "campaign",
  utmId: "campaign_id",
  utmTerm: "term",
  utmContent: "content",
};

export interface GoogleAnalyticsPurchase {
  /*
   * The internal id of the user who created the project: the user_id the
   * Dashboard gives Google Analytics on every signed-in page.
   */
  userId: string;
  // The marketing event's id (Docs/analytics/marketing-event-webhooks.md).
  transactionId: string;
  value: number;
  currency: string;
  plan: string;
  occurredAt: Date;
  // The Project row, whose campaign the purchase is credited to.
  attributionSource: AttributionSource;
}

/*
 * Sends Google Analytics a purchase no browser is present for.
 *
 * The browser sends `purchase` for a project that pays at once
 * (Common/Utils/Analytics.ts). A plan that starts on a free trial sends none
 * there, because nothing has been bought yet, and the moment something is -
 * Stripe charging the card when the trial ends - happens with nobody on the
 * page. So the server sends that one, through the Measurement Protocol:
 *
 *   - Only with an API secret a maintainer has created in Google Analytics
 *     (GOOGLE_ANALYTICS_MEASUREMENT_PROTOCOL_API_SECRET), and only where
 *     Google tags run at all (GoogleTagManagerEnabled). Never on a
 *     self-hosted install.
 *   - Only for a project whose row carries a campaign. The signup form and
 *     Sign in with Microsoft hand one over only while measurement is
 *     allowed, so it is the server's one evidence that the person who
 *     started the trial allowed Google Analytics - and the campaign is what
 *     the purchase is there to be credited to.
 *   - With that campaign as a campaign_details event ahead of the purchase,
 *     which Google Analytics applies to the events after it: there is no
 *     browser session left for the purchase to join, so the campaign has to
 *     travel with it.
 *   - Keyed on the creator's user ID (the Dashboard's user_id) and on a
 *     client ID derived from it, the same for every purchase of that user.
 *     The browser's own client ID is not known here.
 *
 * transaction_id is the marketing event's id, which Google Analytics
 * deduplicates purchases on, so a webhook Stripe sends again does not count
 * twice. Never throws: the caller is Stripe's webhook.
 */
export default class GoogleAnalyticsMeasurementProtocol {
  public static isConfigured(): boolean {
    return Boolean(
      GoogleTagManagerEnabled && GoogleAnalyticsMeasurementProtocolApiSecret,
    );
  }

  // Whether the row carries any campaign: a UTM value, a click ID or a first touch.
  public static hasAttribution(source: AttributionSource): boolean {
    const row: JSONObject = source as unknown as JSONObject;

    const hasCampaignValue: boolean = [
      ...UtmPropertyKeys,
      UtmUrlPropertyKey,
    ].some((key: string): boolean => {
      return typeof row[key] === "string" && Boolean(row[key]);
    });

    return (
      hasCampaignValue ||
      Object.keys(source.clickIds || {}).length > 0 ||
      Object.keys(source.firstTouchAttribution || {}).length > 0
    );
  }

  /*
   * The campaign the purchase is credited to: the row's last-touch campaign,
   * or google / cpc for a Google Ads click that carried no UTMs (Google Ads
   * adds its click ID and its gad_* parameters, nothing else). Google Ads
   * names the campaign on its clicks, so gad_campaignid is the campaign_id
   * whenever the ad's own UTMs give none. Null when there is no campaign.
   */
  public static getCampaignDetails(
    source: AttributionSource,
  ): JSONObject | null {
    const row: JSONObject = source as unknown as JSONObject;
    const campaignDetails: JSONObject = {};

    for (const [propertyKey, parameter] of Object.entries(
      CAMPAIGN_DETAILS_PARAMETER_BY_PROPERTY_KEY,
    )) {
      const value: unknown = row[propertyKey];

      if (typeof value === "string" && value) {
        campaignDetails[parameter] = value.slice(0, MAX_PARAMETER_VALUE_LENGTH);
      }
    }

    if (Object.keys(campaignDetails).length === 0) {
      if (!this.isGoogleAdsClick(source)) {
        return null;
      }

      campaignDetails["source"] = "google";
      campaignDetails["medium"] = "cpc";
    }

    const googleAdsCampaignId: unknown = row["gadCampaignId"];

    if (
      !campaignDetails["campaign_id"] &&
      typeof googleAdsCampaignId === "string" &&
      googleAdsCampaignId
    ) {
      campaignDetails["campaign_id"] = googleAdsCampaignId.slice(
        0,
        MAX_PARAMETER_VALUE_LENGTH,
      );
    }

    return campaignDetails;
  }

  // A click Google Ads tagged: one of its click IDs, or a gad_* parameter.
  private static isGoogleAdsClick(source: AttributionSource): boolean {
    const clickIds: JSONObject = source.clickIds || {};

    return (
      GOOGLE_AD_CLICK_ID_KEYS.some((key: string): boolean => {
        return Boolean(clickIds[key]);
      }) ||
      Boolean(source.gadSource) ||
      Boolean(source.gadCampaignId)
    );
  }

  /*
   * A stable client ID for a user: two 32-bit numbers, the shape the
   * Google tag writes, from a hash of the user ID.
   */
  public static getClientId(userId: string): string {
    const digest: Buffer = crypto
      .createHash("sha256")
      .update(`oneuptime-google-analytics-client:${userId}`, "utf8")
      .digest();

    return `${digest.readUInt32BE(0)}.${digest.readUInt32BE(4)}`;
  }

  public static buildRequestBody(
    purchase: GoogleAnalyticsPurchase,
  ): JSONObject {
    const campaignDetails: JSONObject | null = this.getCampaignDetails(
      purchase.attributionSource,
    );

    // Microseconds, and never ahead of now.
    const timestampInMicros: number =
      Math.min(purchase.occurredAt.getTime(), Date.now()) * 1000;

    const events: Array<JSONObject> = [];

    if (campaignDetails) {
      events.push({ name: "campaign_details", params: campaignDetails });
    }

    events.push({
      name: "purchase",
      params: {
        transaction_id: purchase.transactionId,
        value: purchase.value,
        currency: purchase.currency,
        items: [
          {
            item_id: purchase.plan,
            item_name: purchase.plan,
            price: purchase.value,
            quantity: 1,
          },
        ],
      },
    });

    return {
      client_id: this.getClientId(purchase.userId),
      user_id: purchase.userId,
      timestamp_micros: timestampInMicros,
      /*
       * What the page signalled when this person allowed measurement
       * (AnalyticsConsent.ejs grants every consent type then), which is the
       * only case anything is sent.
       */
      consent: {
        ad_user_data: "GRANTED",
        ad_personalization: "GRANTED",
      },
      events: events,
    };
  }

  public static async sendPurchase(
    purchase: GoogleAnalyticsPurchase,
  ): Promise<void> {
    if (!this.isConfigured() || !purchase.userId) {
      return;
    }

    if (!this.hasAttribution(purchase.attributionSource)) {
      logger.debug(
        `GoogleAnalytics: not sending purchase ${purchase.transactionId}: the project carries no campaign, so nothing says its creator allowed measurement.`,
      );
      return;
    }

    /*
     * Google Analytics answers 2xx to every request it receives, valid or
     * not, and asks for the same request not to be sent again - so a
     * failure here is logged and not retried. The secret is in the query
     * string and must stay out of every log line.
     */
    await axios.post(
      GOOGLE_ANALYTICS_MEASUREMENT_PROTOCOL_URL,
      this.buildRequestBody(purchase),
      {
        params: {
          measurement_id: GOOGLE_ANALYTICS_MEASUREMENT_ID,
          api_secret: GoogleAnalyticsMeasurementProtocolApiSecret,
        },
        headers: { "content-type": "application/json" },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );

    logger.debug(
      `GoogleAnalytics: sent purchase ${purchase.transactionId} through the Measurement Protocol.`,
    );
  }

  // Fire and forget. Neither throws nor rejects.
  public static sendPurchaseInBackground(
    purchase: GoogleAnalyticsPurchase,
  ): void {
    try {
      this.sendPurchase(purchase).catch((err: unknown) => {
        logger.error(
          `GoogleAnalytics: failed to send purchase ${purchase.transactionId}: ${
            (err as Error)?.message || err
          }`,
        );
      });
    } catch (err) {
      logger.error(
        `GoogleAnalytics: failed to send purchase ${purchase.transactionId}: ${
          (err as Error)?.message || err
        }`,
      );
    }
  }
}
