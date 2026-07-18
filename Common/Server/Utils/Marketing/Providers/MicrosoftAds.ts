import axios, { AxiosResponse } from "axios";
import {
  MicrosoftAdsAccountId,
  MicrosoftAdsCustomerId,
  MicrosoftAdsDeveloperToken,
  MicrosoftAdsOAuthClientId,
  MicrosoftAdsOAuthClientSecret,
  MicrosoftAdsOAuthRefreshToken,
  MicrosoftAdsPaidSubscriptionConversionName,
  MicrosoftAdsSignUpConversionName,
} from "../../../EnvironmentConfig";
import ConversionUploadProvider, {
  ConversionSkip,
  ConversionUploadBatchResult,
} from "../ConversionUploadProvider";
import { JSONObject } from "../../../../Types/JSON";
import MarketingConversion from "../../../../Models/DatabaseModels/MarketingConversion";

const REQUEST_TIMEOUT_MS: number = 30000;

// Microsoft accepts offline conversions up to 90 days after the click.
const MICROSOFT_MAX_CONVERSION_AGE_IN_DAYS: number = 90;

/*
 * Microsoft Advertising (Bing Ads) offline conversions via the Campaign
 * Management v13 REST surface (OfflineConversions/Apply) using msclkid.
 * Offline conversion goals are matched by conversion NAME configured in the
 * Microsoft Advertising UI. OAuth2 refresh-token flow against Microsoft
 * identity platform with the msads.manage scope.
 */
export default class MicrosoftAdsProvider extends ConversionUploadProvider {
  public override readonly key: string = "microsoft";
  public override readonly displayName: string = "Microsoft Advertising";

  private cachedAccessToken: string | null = null;
  private cachedAccessTokenExpiresAt: number = 0;

  public override isConfigured(): boolean {
    return Boolean(
      MicrosoftAdsDeveloperToken &&
        MicrosoftAdsOAuthClientId &&
        MicrosoftAdsOAuthRefreshToken &&
        MicrosoftAdsCustomerId &&
        MicrosoftAdsAccountId,
    );
  }

  public override getSkipReason(
    conversion: MarketingConversion,
  ): ConversionSkip | null {
    if (!this.getClickId(conversion, "msclkid")) {
      return {
        reason: "No Microsoft click id (msclkid)",
        isPermanent: true,
      };
    }

    if (!this.getConversionName(conversion)) {
      // Config gap — leave pending so it uploads once the name is configured.
      return {
        reason:
          "No Microsoft Advertising conversion name configured for this conversion type",
        isPermanent: false,
      };
    }

    if (
      this.isOlderThanDays(conversion, MICROSOFT_MAX_CONVERSION_AGE_IN_DAYS)
    ) {
      return {
        reason: "Conversion older than Microsoft's 90-day click window",
        isPermanent: true,
      };
    }

    return null;
  }

  private getConversionName(conversion: MarketingConversion): string {
    return this.isSignUp(conversion)
      ? MicrosoftAdsSignUpConversionName
      : MicrosoftAdsPaidSubscriptionConversionName;
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.cachedAccessToken &&
      Date.now() < this.cachedAccessTokenExpiresAt
    ) {
      return this.cachedAccessToken;
    }

    const params: URLSearchParams = new URLSearchParams();
    params.append("client_id", MicrosoftAdsOAuthClientId);
    if (MicrosoftAdsOAuthClientSecret) {
      params.append("client_secret", MicrosoftAdsOAuthClientSecret);
    }
    params.append("refresh_token", MicrosoftAdsOAuthRefreshToken);
    params.append("grant_type", "refresh_token");
    params.append("scope", "https://ads.microsoft.com/msads.manage offline_access");

    const response: AxiosResponse<{
      access_token?: string;
      expires_in?: number;
    }> = await axios.post(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
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
      throw new Error("Microsoft OAuth token response had no access_token");
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

    const body: JSONObject = {
      OfflineConversions: conversions.map(
        (conversion: MarketingConversion) => {
          const payload: JSONObject = {
            MicrosoftClickId: this.getClickId(conversion, "msclkid") || "",
            ConversionName: this.getConversionName(conversion),
            // ISO 8601 UTC, e.g. 2026-07-18T12:34:56Z.
            ConversionTime: (conversion.conversionAt || new Date())
              .toISOString()
              .replace(/\.\d{3}Z$/, "Z"),
          };

          const valueInUSD: number | undefined =
            this.getValueInUSD(conversion);

          if (valueInUSD !== undefined) {
            payload["ConversionValue"] = valueInUSD;
            payload["ConversionCurrencyCode"] = "USD";
          }

          return payload;
        },
      ),
    };

    const response: AxiosResponse<JSONObject> = await axios.post(
      "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/OfflineConversions/Apply",
      body,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          DeveloperToken: MicrosoftAdsDeveloperToken,
          CustomerId: MicrosoftAdsCustomerId,
          CustomerAccountId: MicrosoftAdsAccountId,
          "Content-Type": "application/json",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );

    /*
     * The Apply response reports per-item failures in PartialErrors, each
     * carrying the Index of the failing item in the submitted array.
     */
    const permanentFailures: Map<number, string> = new Map<number, string>();

    const partialErrors: Array<JSONObject> =
      (response.data?.["PartialErrors"] as Array<JSONObject>) || [];

    for (const partialError of partialErrors) {
      if (typeof partialError?.["Index"] === "number") {
        permanentFailures.set(
          partialError["Index"] as number,
          `${partialError["ErrorCode"] || ""} ${
            partialError["Message"] || "Unknown Microsoft Advertising error"
          }`.trim(),
        );
      }
    }

    return { permanentFailures };
  }
}
