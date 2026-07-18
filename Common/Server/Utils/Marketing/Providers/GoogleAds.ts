import axios, { AxiosResponse } from "axios";
import {
  GoogleAdsApiVersion,
  GoogleAdsCustomerId,
  GoogleAdsDeveloperToken,
  GoogleAdsLoginCustomerId,
  GoogleAdsOAuthClientId,
  GoogleAdsOAuthClientSecret,
  GoogleAdsOAuthRefreshToken,
  GoogleAdsPaidSubscriptionConversionActionId,
  GoogleAdsSignUpConversionActionId,
} from "../../../EnvironmentConfig";
import ConversionUploadProvider, {
  ConversionSkip,
  ConversionUploadBatchResult,
} from "../ConversionUploadProvider";
import { JSONObject } from "../../../../Types/JSON";
import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";
import logger from "../../Logger";

const REQUEST_TIMEOUT_MS: number = 30000;

// Google Ads accepts click conversions up to 90 days after the click.
const GOOGLE_MAX_CONVERSION_AGE_IN_DAYS: number = 90;

/*
 * Google Ads offline click conversions
 * (customers/{id}:uploadClickConversions) with OAuth2 refresh-token auth.
 * Supports gclid, wbraid and gbraid click ids. Uses partialFailure so valid
 * conversions succeed even when others in the batch fail.
 */
export default class GoogleAdsProvider extends ConversionUploadProvider {
  public override readonly key: string = "google";
  public override readonly displayName: string = "Google Ads";

  private cachedAccessToken: string | null = null;
  private cachedAccessTokenExpiresAt: number = 0;

  public override isConfigured(): boolean {
    return Boolean(
      GoogleAdsDeveloperToken &&
        GoogleAdsOAuthClientId &&
        GoogleAdsOAuthClientSecret &&
        GoogleAdsOAuthRefreshToken &&
        GoogleAdsCustomerId,
    );
  }

  public override getSkipReason(
    conversion: MarketingConversion,
  ): ConversionSkip | null {
    if (!this.getGoogleClickId(conversion)) {
      return {
        reason: "No Google click id (gclid/wbraid/gbraid)",
        isPermanent: true,
      };
    }

    if (!this.getConversionActionId(conversion)) {
      // Config gap — leave pending so it uploads once the id is configured.
      return {
        reason:
          "No Google Ads conversion action id configured for this conversion type",
        isPermanent: false,
      };
    }

    if (this.isOlderThanDays(conversion, GOOGLE_MAX_CONVERSION_AGE_IN_DAYS)) {
      return {
        reason: "Conversion older than Google's 90-day click window",
        isPermanent: true,
      };
    }

    return null;
  }

  private getGoogleClickId(conversion: MarketingConversion): JSONObject | null {
    const gclid: string | undefined = this.getClickId(conversion, "gclid");
    if (gclid) {
      return { gclid: gclid };
    }

    const wbraid: string | undefined = this.getClickId(conversion, "wbraid");
    if (wbraid) {
      return { wbraid: wbraid };
    }

    const gbraid: string | undefined = this.getClickId(conversion, "gbraid");
    if (gbraid) {
      return { gbraid: gbraid };
    }

    return null;
  }

  private getConversionActionId(conversion: MarketingConversion): string {
    return this.isSignUp(conversion)
      ? GoogleAdsSignUpConversionActionId
      : GoogleAdsPaidSubscriptionConversionActionId;
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.cachedAccessToken &&
      Date.now() < this.cachedAccessTokenExpiresAt
    ) {
      return this.cachedAccessToken;
    }

    const params: URLSearchParams = new URLSearchParams();
    params.append("client_id", GoogleAdsOAuthClientId);
    params.append("client_secret", GoogleAdsOAuthClientSecret);
    params.append("refresh_token", GoogleAdsOAuthRefreshToken);
    params.append("grant_type", "refresh_token");

    const response: AxiosResponse<{
      access_token?: string;
      expires_in?: number;
    }> = await axios.post(
      "https://oauth2.googleapis.com/token",
      params.toString(),
      {
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );

    const accessToken: string | undefined = response.data?.access_token;

    if (!accessToken) {
      throw new Error("Google OAuth token response had no access_token");
    }

    this.cachedAccessToken = accessToken;
    // Refresh one minute before actual expiry.
    this.cachedAccessTokenExpiresAt =
      Date.now() + ((response.data?.expires_in || 3600) - 60) * 1000;

    return accessToken;
  }

  // Format Google Ads expects: "yyyy-mm-dd hh:mm:ss+00:00".
  private formatConversionDateTime(date: Date): string {
    const iso: string = date.toISOString(); // 2026-07-18T12:34:56.789Z
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`;
  }

  public override async upload(
    conversions: Array<MarketingConversion>,
  ): Promise<ConversionUploadBatchResult> {
    const accessToken: string = await this.getAccessToken();

    const headers: JSONObject = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": GoogleAdsDeveloperToken,
    };

    if (GoogleAdsLoginCustomerId) {
      headers["login-customer-id"] = GoogleAdsLoginCustomerId;
    }

    const body: JSONObject = {
      conversions: conversions.map((conversion: MarketingConversion) => {
        const payload: JSONObject = {
          ...(this.getGoogleClickId(conversion) || {}),
          conversionAction: `customers/${GoogleAdsCustomerId}/conversionActions/${this.getConversionActionId(
            conversion,
          )}`,
          conversionDateTime: this.formatConversionDateTime(
            conversion.conversionAt || new Date(),
          ),
        };

        const valueInUSD: number | undefined = this.getValueInUSD(conversion);

        if (valueInUSD !== undefined) {
          payload["conversionValue"] = valueInUSD;
          payload["currencyCode"] = "USD";
        }

        return payload;
      }),
      partialFailure: true,
    };

    const url: string = `https://googleads.googleapis.com/${GoogleAdsApiVersion}/customers/${GoogleAdsCustomerId}:uploadClickConversions`;

    const response: AxiosResponse<JSONObject> = await axios.post(url, body, {
      headers: headers as Record<string, string>,
      timeout: REQUEST_TIMEOUT_MS,
    });

    return this.parsePartialFailure(response.data);
  }

  /*
   * partialFailureError.details[].errors[] entries carry the index of the
   * failing operation in location.fieldPathElements ({fieldName:
   * "conversions", index: N}).
   */
  private parsePartialFailure(
    responseData: JSONObject,
  ): ConversionUploadBatchResult {
    const permanentFailures: Map<number, string> = new Map<number, string>();

    const partialFailureError: JSONObject | undefined = responseData?.[
      "partialFailureError"
    ] as JSONObject | undefined;

    if (!partialFailureError) {
      return { permanentFailures };
    }

    const details: Array<JSONObject> =
      (partialFailureError["details"] as Array<JSONObject>) || [];

    let alreadyExistsCount: number = 0;

    for (const detail of details) {
      const errors: Array<JSONObject> =
        (detail["errors"] as Array<JSONObject>) || [];

      for (const error of errors) {
        const message: string =
          (error["message"] as string) || "Unknown Google Ads error";

        /*
         * A duplicate rejection means the conversion WAS counted by a prior
         * run (e.g. crash between upload and status write) — that is a
         * success, not a failure.
         */
        if (JSON.stringify(error).includes("ALREADY_EXISTS")) {
          alreadyExistsCount++;
          continue;
        }

        const fieldPathElements: Array<JSONObject> =
          ((error["location"] as JSONObject)?.[
            "fieldPathElements"
          ] as Array<JSONObject>) || [];

        for (const element of fieldPathElements) {
          if (
            element["fieldName"] === "conversions" &&
            typeof element["index"] === "number"
          ) {
            permanentFailures.set(element["index"] as number, message);
          }
        }
      }
    }

    /*
     * A partial failure with no parseable indexes should not be silently
     * treated as full success.
     */
    if (permanentFailures.size === 0 && alreadyExistsCount === 0) {
      logger.error(
        `Google Ads partial failure with unparseable indexes: ${JSON.stringify(
          partialFailureError,
        ).slice(0, 1000)}`,
      );
    }

    return { permanentFailures };
  }
}
