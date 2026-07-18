import axios, { AxiosError } from "axios";
import {
  LinkedInApiVersion,
  LinkedInConversionsAccessToken,
  LinkedInPaidSubscriptionConversionId,
  LinkedInSignUpConversionId,
} from "../../../EnvironmentConfig";
import ConversionUploadProvider, {
  ConversionSkip,
  ConversionUploadBatchResult,
} from "../ConversionUploadProvider";
import { JSONObject } from "../../../../Types/JSON";
import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";

const REQUEST_TIMEOUT_MS: number = 30000;

// LinkedIn accepts conversions up to 90 days after the interaction.
const LINKEDIN_MAX_CONVERSION_AGE_IN_DAYS: number = 90;

/*
 * LinkedIn Conversions API (api.linkedin.com/rest/conversionEvents) using
 * the li_fat_id first-party click id. Conversion rules are referenced by
 * urn:lla:llaPartnerConversion:{id}. Events are posted one at a time (small
 * volumes); auth-level failures abort the batch for retry, other per-event
 * rejections are recorded as permanent.
 *
 * Note: LinkedIn access tokens expire (typically 60 days) — the token in
 * LINKEDIN_CONVERSIONS_ACCESS_TOKEN must be rotated externally.
 */
export default class LinkedInProvider extends ConversionUploadProvider {
  public override readonly key: string = "linkedin";
  public override readonly displayName: string = "LinkedIn";

  /*
   * LinkedIn has no batch endpoint, so upload() issues one request per
   * conversion — keep runs short enough to finish inside the job timeout.
   */
  public override readonly maxBatchSize: number = 50;

  public override isConfigured(): boolean {
    return Boolean(LinkedInConversionsAccessToken);
  }

  public override getSkipReason(
    conversion: MarketingConversion,
  ): ConversionSkip | null {
    if (!this.getClickId(conversion, "li_fat_id")) {
      return {
        reason: "No LinkedIn click id (li_fat_id)",
        isPermanent: true,
      };
    }

    if (!this.getConversionRuleId(conversion)) {
      // Config gap — leave pending so it uploads once the id is configured.
      return {
        reason:
          "No LinkedIn conversion rule id configured for this conversion type",
        isPermanent: false,
      };
    }

    if (
      this.isOlderThanDays(conversion, LINKEDIN_MAX_CONVERSION_AGE_IN_DAYS)
    ) {
      return {
        reason: "Conversion older than LinkedIn's 90-day window",
        isPermanent: true,
      };
    }

    return null;
  }

  private getConversionRuleId(conversion: MarketingConversion): string {
    return this.isSignUp(conversion)
      ? LinkedInSignUpConversionId
      : LinkedInPaidSubscriptionConversionId;
  }

  public override async upload(
    conversions: Array<MarketingConversion>,
  ): Promise<ConversionUploadBatchResult> {
    const permanentFailures: Map<number, string> = new Map<number, string>();

    for (let i: number = 0; i < conversions.length; i++) {
      const conversion: MarketingConversion = conversions[i]!;

      const body: JSONObject = {
        conversion: `urn:lla:llaPartnerConversion:${this.getConversionRuleId(
          conversion,
        )}`,
        conversionHappenedAt: (
          conversion.conversionAt || new Date()
        ).getTime(),
        // Dedup key: a retried batch must not double-count conversions.
        eventId: conversion.id!.toString(),
        user: {
          userIds: [
            {
              idType: "LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID",
              idValue: this.getClickId(conversion, "li_fat_id") || "",
            },
          ],
        },
      };

      const valueInUSD: number | undefined = this.getValueInUSD(conversion);

      if (valueInUSD !== undefined) {
        body["conversionValue"] = {
          currencyCode: "USD",
          amount: valueInUSD.toFixed(2),
        };
      }

      try {
        await axios.post("https://api.linkedin.com/rest/conversionEvents",
          body,
          {
            headers: {
              Authorization: `Bearer ${LinkedInConversionsAccessToken}`,
              "LinkedIn-Version": LinkedInApiVersion,
              "X-Restli-Protocol-Version": "2.0.0",
              "Content-Type": "application/json",
            },
            timeout: REQUEST_TIMEOUT_MS,
          },
        );
      } catch (err) {
        const status: number | undefined = (err as AxiosError).response
          ?.status;

        /*
         * Only definitive per-event validation rejections are permanent.
         * Everything else — auth/token problems, rate limits, 5xx, and
         * network errors (no response, so no status) — is transport-level:
         * throw so the whole batch stays pending and is retried. eventId
         * makes redelivery idempotent on LinkedIn's side.
         */
        if (status !== 400 && status !== 422) {
          throw err;
        }

        permanentFailures.set(
          i,
          ConversionUploadProvider.getErrorMessage(err),
        );
      }
    }

    return { permanentFailures };
  }
}
