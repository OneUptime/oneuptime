import axios, { AxiosResponse } from "axios";
import {
  RedditAdsAccountId,
  RedditAdsOAuthClientId,
  RedditAdsOAuthClientSecret,
  RedditAdsOAuthRefreshToken,
} from "../../../EnvironmentConfig";
import ConversionUploadProvider, {
  ConversionSkip,
  ConversionTypeMapping,
  ConversionUploadBatchResult,
} from "../ConversionUploadProvider";
import { JSONObject } from "../../../../Types/JSON";
import { MarketingConversionType } from "../../../../Types/Marketing/MarketingConversion";
import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";

const REQUEST_TIMEOUT_MS: number = 30000;

// Reddit accepts conversion events up to 7 days old.
const REDDIT_MAX_EVENT_AGE_IN_DAYS: number = 7;

/*
 * Reddit Conversions API
 * (ads-api.reddit.com/api/v2.0/conversions/events/{accountId}) using the
 * rdt_cid click id or a SHA-256 email, whichever the conversion carries.
 * conversion_id (the conversion row id) makes retried uploads idempotent on
 * Reddit's side. OAuth2 refresh-token flow with HTTP basic auth against
 * reddit.com.
 */
export default class RedditProvider extends ConversionUploadProvider {
  public override readonly key: string = "reddit";
  public override readonly displayName: string = "Reddit";

  private cachedAccessToken: string | null = null;
  private cachedAccessTokenExpiresAt: number = 0;

  public override isConfigured(): boolean {
    return Boolean(
      RedditAdsOAuthClientId &&
        RedditAdsOAuthClientSecret &&
        RedditAdsOAuthRefreshToken &&
        RedditAdsAccountId,
    );
  }

  protected override getProviderSkipReason(
    conversion: MarketingConversion,
  ): ConversionSkip | null {
    if (
      !this.getClickId(conversion, "rdt_cid") &&
      !this.getHashedEmail(conversion)
    ) {
      return {
        reason: "No Reddit click id (rdt_cid) and no email to match on",
        isPermanent: true,
      };
    }

    if (!this.getTrackingType(conversion)) {
      return {
        reason: "No Reddit tracking type mapped for this conversion type",
        isPermanent: true,
      };
    }

    if (this.isOlderThanDays(conversion, REDDIT_MAX_EVENT_AGE_IN_DAYS)) {
      return {
        reason: "Conversion older than Reddit's 7-day upload window",
        isPermanent: true,
      };
    }

    return null;
  }

  /*
   * Reddit standard tracking types. A booked meeting is `Lead`: Reddit has no
   * distinct "meeting booked" type, and reporting it as Purchase would put a
   * demo into the same optimisation pool as revenue.
   */
  private getTrackingType(conversion: MarketingConversion): string | undefined {
    const mapping: ConversionTypeMapping<string> = {
      [MarketingConversionType.SignUp]: "SignUp",
      [MarketingConversionType.MeetingBooked]: "Lead",
      [MarketingConversionType.PaidSubscription]: "Purchase",
    };

    return this.resolveByConversionType(conversion, mapping);
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.cachedAccessToken &&
      Date.now() < this.cachedAccessTokenExpiresAt
    ) {
      return this.cachedAccessToken;
    }

    const params: URLSearchParams = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", RedditAdsOAuthRefreshToken);

    const response: AxiosResponse<{
      access_token?: string;
      expires_in?: number;
    }> = await axios.post(
      "https://www.reddit.com/api/v1/access_token",
      params.toString(),
      {
        auth: {
          username: RedditAdsOAuthClientId,
          password: RedditAdsOAuthClientSecret,
        },
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          // Reddit throttles/blocks requests without a descriptive User-Agent.
          "User-Agent": "OneUptime-ConversionsUpload/1.0",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );

    const accessToken: string | undefined = response.data?.access_token;

    if (!accessToken) {
      throw new Error("Reddit OAuth token response had no access_token");
    }

    this.cachedAccessToken = accessToken;
    this.cachedAccessTokenExpiresAt =
      Date.now() + ((response.data?.expires_in || 3600) - 60) * 1000;

    return accessToken;
  }

  public override async upload(
    conversions: Array<MarketingConversion>,
  ): Promise<ConversionUploadBatchResult> {
    const accessToken: string = await this.getAccessToken();

    const events: Array<JSONObject> = conversions.map(
      (conversion: MarketingConversion) => {
        const eventAt: Date = conversion.conversionAt || new Date();

        const eventMetadata: JSONObject = {
          // Dedup key: retried uploads are idempotent on Reddit's side.
          conversion_id: conversion.id!.toString(),
        };

        const valueInUSD: number | undefined = this.getValueInUSD(conversion);

        if (valueInUSD !== undefined) {
          eventMetadata["value_decimal"] = valueInUSD;
          eventMetadata["currency"] = "USD";
        }

        const payload: JSONObject = {
          event_at: eventAt.toISOString(),
          event_type: {
            tracking_type: this.getTrackingType(conversion) || "Lead",
          },
          event_metadata: eventMetadata,
        };

        const clickId: string | undefined = this.getClickId(
          conversion,
          "rdt_cid",
        );

        if (clickId) {
          payload["click_id"] = clickId;
        }

        const hashedEmail: string | undefined = this.getHashedEmail(conversion);

        if (hashedEmail) {
          payload["user"] = {
            email: hashedEmail,
          };
        }

        return payload;
      },
    );

    await axios.post(
      `https://ads-api.reddit.com/api/v2.0/conversions/events/${RedditAdsAccountId}`,
      {
        test_mode: false,
        events: events,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );

    /*
     * Reddit accepts or rejects the request as a whole; request-level
     * failures throw and the batch is retried (idempotent via
     * conversion_id).
     */
    return { permanentFailures: new Map<number, string>() };
  }
}
