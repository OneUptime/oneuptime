import { AxiosError } from "axios";
import { JSONObject } from "../../../Types/JSON";
import { MarketingConversionType } from "../../../Types/Marketing/MarketingConversion";
import MarketingConversion from "../../../Models/DatabaseModels/MarketingConversion";

/*
 * One implementation per ad platform. The MarketingConversions worker job
 * iterates all configured providers and uploads every pending conversion to
 * each of them, tracking per-provider status in
 * MarketingConversion.uploadState (keyed by `key`).
 *
 * Contract:
 * - getSkipReason returns a human-readable reason when this conversion can
 *   never be uploaded to this platform (wrong/missing click id, outside the
 *   platform's upload window, provider not configured for this conversion
 *   type). Null means uploadable.
 * - upload() sends one batch. Per-conversion PERMANENT rejections are
 *   returned in the result keyed by array index; they will not be retried.
 *   Transport/auth-level failures must THROW — the whole batch stays pending
 *   and is retried on the next run (bounded by the job's attempt cap), so
 *   providers should be safe against duplicate delivery where the platform
 *   supports an idempotency/dedup key.
 */

export interface ConversionUploadBatchResult {
  // Index into the submitted batch -> permanent failure message.
  permanentFailures: Map<number, string>;
}

export interface ConversionSkip {
  reason: string;
  /*
   * Permanent skips (missing click id, outside the platform's upload window)
   * are recorded as Skipped and never revisited. Non-permanent skips
   * (missing provider configuration such as a conversion action id) leave
   * the conversion pending so it uploads once the configuration is added.
   */
  isPermanent: boolean;
}

export default abstract class ConversionUploadProvider {
  // Stable key used in MarketingConversion.uploadState. Never change it.
  public abstract readonly key: string;
  public abstract readonly displayName: string;

  /*
   * Max conversions this provider accepts in one upload() call. Providers
   * that issue one HTTP request per conversion must keep this small so a
   * single run finishes well inside the worker job timeout.
   */
  public readonly maxBatchSize: number = 500;

  public abstract isConfigured(): boolean;

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
