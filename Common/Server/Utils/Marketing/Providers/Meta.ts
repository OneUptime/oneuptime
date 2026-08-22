import axios, { AxiosResponse } from "axios";
import {
  MetaConversionsAccessToken,
  MetaConversionsPixelId,
  MetaGraphApiVersion,
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

// Meta rejects website events older than 7 days at upload time.
const META_MAX_EVENT_AGE_IN_DAYS: number = 7;

/*
 * Meta (Facebook) Conversions API
 * (graph.facebook.com/{version}/{pixelId}/events). Emails are SHA-256 hashed
 * per Meta's customer-information matching spec; the raw email never leaves
 * OneUptime. event_id is the conversion row id, so Meta deduplicates
 * retried uploads (and browser-pixel duplicates) server-side.
 *
 * An event is uploadable with a click id, a hashed email, or both — Meta
 * matches on either. Requiring fbclid, as this provider used to, discarded
 * every conversion whose click id had not survived to the moment of
 * conversion, which is most of a sales-led funnel.
 */
export default class MetaProvider extends ConversionUploadProvider {
  public override readonly key: string = "meta";
  public override readonly displayName: string = "Meta";

  public override isConfigured(): boolean {
    return Boolean(MetaConversionsPixelId && MetaConversionsAccessToken);
  }

  protected override getProviderSkipReason(
    conversion: MarketingConversion,
  ): ConversionSkip | null {
    if (
      !this.getClickId(conversion, "fbclid") &&
      !this.getHashedEmail(conversion)
    ) {
      return {
        reason: "No Meta click id (fbclid) and no email to match on",
        isPermanent: true,
      };
    }

    if (!this.getEventName(conversion)) {
      return {
        reason: "No Meta event name mapped for this conversion type",
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

  /*
   * Standard Meta event names. `Schedule` is Meta's own name for a booked
   * meeting, and it carries no revenue — which is what keeps a demo out of the
   * Purchase optimisation pool.
   */
  private getEventName(conversion: MarketingConversion): string | undefined {
    const mapping: ConversionTypeMapping<string> = {
      [MarketingConversionType.SignUp]: "CompleteRegistration",
      [MarketingConversionType.MeetingBooked]: "Schedule",
      [MarketingConversionType.PaidSubscription]: "Purchase",
    };

    return this.resolveByConversionType(conversion, mapping);
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
        const fbclid: string | undefined = this.getClickId(
          conversion,
          "fbclid",
        );

        const userData: JSONObject = {};

        // Only send fbc when there is a click id to build it from.
        if (fbclid) {
          userData["fbc"] = this.buildFbc(fbclid, eventAt);
        }

        const hashedEmail: string | undefined = this.getHashedEmail(conversion);

        if (hashedEmail) {
          userData["em"] = [hashedEmail];
        }

        const eventName: string = this.getEventName(conversion) || "Lead";

        const payload: JSONObject = {
          event_name: eventName,
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
         * batch. Send 0 when the value is unknown. Lead-shaped events
         * (Schedule, Lead) never carry a value: getValueInUSD returns
         * undefined for them, so no custom_data is attached at all.
         */
        if (eventName === "Purchase" || valueInUSD !== undefined) {
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
