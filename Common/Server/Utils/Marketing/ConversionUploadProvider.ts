import { AxiosError } from "axios";
import { JSONObject } from "../../../Types/JSON";
import { AttributionConsentState } from "../../../Types/Marketing/AcquisitionAttribution";
import { MarketingConversionType } from "../../../Types/Marketing/MarketingConversion";
import MarketingConversion from "../../../Models/DatabaseModels/MarketingConversion";

export interface ConversionUploadBatchResult {
  permanentFailures: Map<number, string>;
}

export interface ConversionSkip {
  reason: string;
  isPermanent: boolean;
}

export default abstract class ConversionUploadProvider {
  public abstract readonly key: string;
  public abstract readonly displayName: string;
  public readonly maxBatchSize: number = 500;

  public abstract isConfigured(): boolean;

  protected getPrivacySkipReason(
    conversion: MarketingConversion,
  ): ConversionSkip | null {
    if (conversion.conversionType === MarketingConversionType.Touchpoint) {
      return {
        reason: "Acquisition touchpoints are internal and are not conversion events.",
        isPermanent: true,
      };
    }
    if (
      conversion.consentState &&
      conversion.consentState !== AttributionConsentState.Granted
    ) {
      return {
        reason: "Offline/enhanced conversion upload requires granted consent.",
        isPermanent: true,
      };
    }
    return null;
  }

  public abstract getSkipReason(
    conversion: MarketingConversion,
  ): ConversionSkip | null;

  public abstract upload(
    conversions: Array<MarketingConversion>,
  ): Promise<ConversionUploadBatchResult>;

  protected getClickId(
    conversion: MarketingConversion,
    clickIdKey: string,
  ): string | undefined {
    const clickIds: JSONObject = conversion.clickIds || {};
    const value: unknown = clickIds[clickIdKey];
    return typeof value === "string" && value ? value : undefined;
  }

  protected getValueInUSD(conversion: MarketingConversion): number | undefined {
    if (
      conversion.conversionValueInUSDCents === undefined ||
      conversion.conversionValueInUSDCents === null ||
      conversion.conversionValueInUSDCents <= 0
    ) {
      return undefined;
    }
    return conversion.conversionValueInUSDCents / 100;
  }

  protected isSignUp(conversion: MarketingConversion): boolean {
    return conversion.conversionType === MarketingConversionType.SignUp;
  }

  protected isOlderThanDays(
    conversion: MarketingConversion,
    days: number,
  ): boolean {
    const conversionAt: Date = conversion.conversionAt || new Date();
    return Date.now() - conversionAt.getTime() > days * 24 * 60 * 60 * 1000;
  }

  public static getErrorMessage(err: unknown): string {
    if (err instanceof AxiosError) {
      return `HTTP ${err.response?.status || "?"}: ${JSON.stringify(
        err.response?.data || err.message,
      ).slice(0, 900)}`;
    }
    return (err as Error)?.message || "Unknown error";
  }
}
