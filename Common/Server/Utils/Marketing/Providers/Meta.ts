import axios, { AxiosResponse } from "axios";
import crypto from "crypto";
import {
  MetaConversionsAccessToken,
  MetaConversionsPixelId,
  MetaGraphApiVersion,
} from "../../../EnvironmentConfig";
import ConversionUploadProvider, {
  ConversionSkip,
  ConversionUploadBatchResult,
} from "../ConversionUploadProvider";
import { JSONObject } from "../../../../Types/JSON";
import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";

const REQUEST_TIMEOUT_MS: number = 30000;

// Meta rejects website events older than 7 days at upload time.
const META_MAX_EVENT_AGE_IN_DAYS: number = 7;

/*
 * Meta (Facebook) Conversions API
 * (graph.facebook.com/{version}/{pixelId}/events). Emails are SHA-256 hashed
 * per Meta's customer-information matching spec; the raw email never leaves
 * OneUptime. event_id is the conversion row id, so Meta deduplicates
 * retried uploads (and browser-pixel duplicates) server-side.
 */
export default class MetaProvider extends ConversionUploadProvider {
  public override readonly key: string = "meta";
  public override readonly displayName: string = "Meta";

  public override isConfigured(): boolean {
    return Boolean(MetaConversionsPixelId && MetaConversionsAccessToken);
  }

  public override getSkipReason(
    conversion: MarketingConversion,
  ): ConversionSkip | null {
    if (!this.getClickId(conversion, "fbclid")) {
      return {
        reason: "No Meta click id (fbclid)",
        isPermanent: true,
      };
    }

    if (this.isOlderThanDays(conversion, META_MAX_EVENT_AGE_IN_DAYS)) {
      return {
        reason: "Conversion older than Meta's 7-day upload window",
        isPermanent: true,
      };
    }

    return null;
  }

  private hashEmail(email: string): string {
    return crypto
      .createHash("sha256")
      .update(email.trim().toLowerCase())
      .digest("hex");
  }

  /*
   * fbc format per Meta spec: fb.1.{creationTimeMs}.{fbclid}. We use the
   * conversion time as creation time since the original click timestamp is
   * not stored.
   */
  private buildFbc(fbclid: string, eventAt: Date): string {
    return `fb.1.${eventAt.getTime()}.${fbclid}`;
  }

  public override async upload(
    conversions: Array<MarketingConversion>,
  ): Promise<ConversionUploadBatchResult> {
    const data: Array<JSONObject> = conversions.map(
      (conversion: MarketingConversion) => {
        const eventAt: Date = conversion.conversionAt || new Date();
        const fbclid: string = this.getClickId(conversion, "fbclid") || "";

        const userData: JSONObject = {
          fbc: this.buildFbc(fbclid, eventAt),
        };

        if (conversion.email) {
          userData["em"] = [this.hashEmail(conversion.email)];
        }

        const isSignUp: boolean = this.isSignUp(conversion);

        const payload: JSONObject = {
          event_name: isSignUp ? "CompleteRegistration" : "Purchase",
          event_time: Math.floor(eventAt.getTime() / 1000),
          event_id: conversion.id!.toString(),
          /*
           * Not "website": website events REQUIRE client_user_agent and
           * event_source_url, which a server-side backfill does not have —
           * Meta rejects the whole batch without them.
           */
          action_source: "other",
          user_data: userData,
        };

        const valueInUSD: number | undefined = this.getValueInUSD(conversion);

        /*
         * Purchase events REQUIRE custom_data.value and currency — one
         * valueless Purchase (custom-pricing plan) would 400 the entire
         * batch. Send 0 when the value is unknown.
         */
        if (!isSignUp || valueInUSD !== undefined) {
          payload["custom_data"] = {
            value: valueInUSD ?? 0,
            currency: "USD",
          };
        }

        return payload;
      },
    );

    const url: string = `https://graph.facebook.com/${MetaGraphApiVersion}/${MetaConversionsPixelId}/events`;

    const response: AxiosResponse<JSONObject> = await axios.post(
      url,
      {
        data: data,
        access_token: MetaConversionsAccessToken,
      },
      {
        timeout: REQUEST_TIMEOUT_MS,
      },
    );

    const eventsReceived: number =
      (response.data?.["events_received"] as number) || 0;

    if (eventsReceived !== conversions.length) {
      /*
       * Retrying the whole batch is safe: event_id makes redelivery
       * idempotent on Meta's side.
       */
      throw new Error(
        `Meta accepted ${eventsReceived} of ${conversions.length} events`,
      );
    }

    return { permanentFailures: new Map<number, string>() };
  }
}
