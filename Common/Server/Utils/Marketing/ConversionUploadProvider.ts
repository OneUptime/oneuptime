import { AxiosError } from "axios";
import Attribution from "../Attribution";
import { JSONObject } from "../../../Types/JSON";
import {
  AdUploadableMarketingConversionTypes,
  LeadMarketingConversionTypes,
  MarketingConversionType,
} from "../../../Types/Marketing/MarketingConversion";
import MarketingConversion from "../../../Models/DatabaseModels/MarketingConversion";

/*
 * One implementation per ad platform. The MarketingConversions worker job
 * iterates all configured providers and uploads every pending conversion to
 * each of them, tracking per-provider status in
 * MarketingConversion.uploadState (keyed by `key`).
 *
 * Contract:
 * - getSkipReason returns a human-readable reason when this conversion can
 *   never be uploaded to this platform (conversion type with no ad-platform
 *   mapping, no identifier this platform can match on, outside the platform's
 *   upload window, provider not configured for this conversion type). Null
 *   means uploadable. It is implemented here and must not be overridden —
 *   providers implement getProviderSkipReason instead, which only runs for
 *   conversion types that are ad-uploadable at all.
 * - upload() sends one batch. Per-conversion PERMANENT rejections are
 *   returned in the result keyed by array index; they will not be retried.
 *   Transport/auth-level failures must THROW — the whole batch stays pending
 *   and is retried on the next run (bounded by the job's attempt cap), so
 *   providers should be safe against duplicate delivery where the platform
 *   supports an idempotency/dedup key.
 *
 * IDENTIFIERS
 *
 * A conversion can be matched to an ad click two ways, and most platforms
 * accept either:
 *
 *   - the click id the visitor carried (gclid, fbclid, msclkid, ...), which is
 *     exact but only survives as far as the browser storage that held it; and
 *   - the SHA-256 of the person's email, which every platform calls "enhanced
 *     conversions"/"enhanced matching" and which survives a change of device,
 *     a cleared browser, and the weeks between a demo and the deal it led to.
 *
 * Providers must consider a conversion uploadable when EITHER is present.
 * Requiring the click id — which is what every provider here used to do — threw
 * away exactly the sales-led conversions the enhanced-matching mechanism was
 * designed for.
 */

export interface ConversionUploadBatchResult {
  // Index into the submitted batch -> permanent failure message.
  permanentFailures: Map<number, string>;
}

export interface ConversionSkip {
  reason: string;
  /*
   * Permanent skips (no usable identifier, outside the platform's upload
   * window) are recorded as Skipped and never revisited. Non-permanent skips
   * (missing provider configuration such as a conversion action id) leave
   * the conversion pending so it uploads once the configuration is added.
   */
  isPermanent: boolean;
}

/*
 * A per-conversion-type mapping. Written as a Record over the enum rather than
 * a switch or a two-way branch on purpose: the compiler refuses a Record that
 * omits a member, so adding a MarketingConversionType is a build error in every
 * provider until that provider states what the new type means on its platform.
 *
 * That is the guarantee Docs/analytics/enterprise-conversion-tracking.md asks
 * for. Before it existed, providers chose their conversion action with
 * `isSignUp(conversion) ? signUp : paidSubscription`, so a booked meeting added
 * to the uploadable list would have been reported to every ad platform as a
 * purchase.
 */
export type ConversionTypeMapping<T> = Record<MarketingConversionType, T>;

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

  /*
   * Screens conversion types the ledger records but no ad platform has a
   * mapping for, before any provider sees them.
   */
  public getSkipReason(conversion: MarketingConversion): ConversionSkip | null {
    if (
      !AdUploadableMarketingConversionTypes.includes(
        conversion.conversionType as MarketingConversionType,
      )
    ) {
      return {
        reason: `Conversion type ${
          conversion.conversionType || "unknown"
        } has no ad platform conversion mapping`,
        isPermanent: true,
      };
    }

    return this.getProviderSkipReason(conversion);
  }

  protected abstract getProviderSkipReason(
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

  /*
   * The hashed email this conversion can be matched on, or undefined.
   *
   * Prefers the stored emailHash and falls back to hashing the email column,
   * so rows written before emailHash existed still match. Both paths go
   * through Attribution so the digest is identical whichever one produced it.
   */
  protected getHashedEmail(
    conversion: MarketingConversion,
  ): string | undefined {
    if (conversion.emailHash) {
      return conversion.emailHash;
    }

    return Attribution.hashEmail(conversion.email) || undefined;
  }

  /*
   * Resolve a per-type value, or undefined when the column holds a string that
   * is not a known conversion type. The column is a plain varchar, so this
   * cannot be assumed away even though the mapping itself is exhaustive.
   */
  protected resolveByConversionType<T>(
    conversion: MarketingConversion,
    mapping: ConversionTypeMapping<T>,
  ): T | undefined {
    const conversionType: MarketingConversionType =
      conversion.conversionType as MarketingConversionType;

    if (!Object.values(MarketingConversionType).includes(conversionType)) {
      return undefined;
    }

    return mapping[conversionType];
  }

  /*
   * A sales-led lead (booked meeting, enterprise licence request) rather than
   * a completed transaction.
   */
  protected isLead(conversion: MarketingConversion): boolean {
    return LeadMarketingConversionTypes.includes(
      conversion.conversionType as MarketingConversionType,
    );
  }

  /*
   * The revenue to report for this conversion, in USD.
   *
   * Leads return undefined regardless of what the row holds. A booked meeting
   * is not money, and reporting one as revenue would let a bidding algorithm
   * optimise towards booking meetings that never close.
   */
  protected getValueInUSD(conversion: MarketingConversion): number | undefined {
    if (this.isLead(conversion)) {
      return undefined;
    }

    if (
      conversion.conversionValueInUSDCents === undefined ||
      conversion.conversionValueInUSDCents === null ||
      conversion.conversionValueInUSDCents <= 0
    ) {
      return undefined;
    }
    return conversion.conversionValueInUSDCents / 100;
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
