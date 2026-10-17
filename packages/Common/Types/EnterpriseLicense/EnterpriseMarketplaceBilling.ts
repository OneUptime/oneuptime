import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "../Marketplace/CloudMarketplace";
import { JSONObject } from "../JSON";

/*
 * How a self-hosted OneUptime Enterprise installation bought on a cloud
 * marketplace (AWS Marketplace, Microsoft Marketplace, Google Cloud
 * Marketplace) bills its users there, by the user-hour - stored as JSON in
 * GlobalConfig.enterpriseMarketplaceBilling and written only by the
 * Enterprise Edition's usage job (ee/Server/Marketplace).
 *
 * Each hour the job takes the largest number of users it saw in that hour,
 * reports it to the marketplace and keeps here what it still owes and what
 * the marketplace last said. An accepted report is also the marketplace's
 * word that the buyer is subscribed: that is what licenses the installation
 * without a license key (verifiedAt), and a refusal says the opposite
 * (refusedAt).
 *
 * Dates are ISO strings, as they are stored.
 */

export interface EnterpriseMarketplaceUsageReport {
  // The start of the hour the report is for, on the hour.
  hourStart: string;
  // User-hours: the users seen in that hour, plus any carried from older hours.
  quantity: number;
  // The same for every attempt, so a retry is the same report to the marketplace.
  idempotencyKey: string;
  attempts: number;
  firstAttemptAt: string | null;
  lastError: string | null;
}

export interface EnterpriseMarketplaceAcceptedReport {
  hourStart: string;
  quantity: number;
  // The marketplace's ID for it: a metering record, a usage event, an operation.
  reportId: string;
  acceptedAt: string;
}

export interface EnterpriseMarketplaceBillingState {
  version: 1;
  marketplace: CloudMarketplace;
  // The hour being watched now, and the most users seen in it so far.
  observedHour: { start: string; maxUsers: number } | null;
  // Reports not taken yet, oldest first.
  pendingReports: Array<EnterpriseMarketplaceUsageReport>;
  // Usage too old to report on its own, added to the next report made.
  carriedUserHours: number;
  lastAcceptedReport: EnterpriseMarketplaceAcceptedReport | null;
  // When the marketplace last accepted a report.
  verifiedAt: string | null;
  // When it last said the buyer is not subscribed, and what it said.
  refusedAt: string | null;
  refusal: string | null;
  // The latest problem reporting (a setup mistake or an outage), for the admin dialog.
  lastProblem: string | null;
  lastProblemAt: string | null;
  // User-hours that could not be billed (too old, or refused), for the record.
  unbilledUserHours: number;
}

/*
 * What the Admin Dashboard is shown: the state without the bookkeeping
 * (idempotency keys, per-report errors).
 */
export interface EnterpriseMarketplaceBillingSummary {
  marketplace: CloudMarketplace;
  verifiedAt: string | null;
  refusedAt: string | null;
  refusal: string | null;
  lastAcceptedReport: EnterpriseMarketplaceAcceptedReport | null;
  pendingReportCount: number;
  pendingUserHours: number;
  lastProblem: string | null;
  lastProblemAt: string | null;
}

const isRecord: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toIsoDateOrNull: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toCount: (value: unknown) => number = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
};

const toTextOrNull: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return typeof value === "string" && value ? value : null;
};

export default class EnterpriseMarketplaceBillingUtil {
  public static createEmpty(
    marketplace: CloudMarketplace,
  ): EnterpriseMarketplaceBillingState {
    return {
      version: 1,
      marketplace,
      observedHour: null,
      pendingReports: [],
      carriedUserHours: 0,
      lastAcceptedReport: null,
      verifiedAt: null,
      refusedAt: null,
      refusal: null,
      lastProblem: null,
      lastProblemAt: null,
      unbilledUserHours: 0,
    };
  }

  /*
   * The state stored in the column, or null when there is none or it is not
   * one (a hand edit, a future version). Every field is checked on the way:
   * this is what licenses the installation, so nothing is taken on trust
   * from its shape.
   */
  public static fromJSON(
    value: unknown,
  ): EnterpriseMarketplaceBillingState | null {
    if (!isRecord(value) || value["version"] !== 1) {
      return null;
    }

    if (!CloudMarketplaceUtil.isCloudMarketplace(value["marketplace"])) {
      return null;
    }

    const state: EnterpriseMarketplaceBillingState =
      EnterpriseMarketplaceBillingUtil.createEmpty(value["marketplace"]);

    const observed: unknown = value["observedHour"];

    if (isRecord(observed)) {
      const start: string | null = toIsoDateOrNull(observed["start"]);

      if (start) {
        state.observedHour = {
          start,
          maxUsers: toCount(observed["maxUsers"]),
        };
      }
    }

    const pending: unknown = value["pendingReports"];

    if (Array.isArray(pending)) {
      for (const entry of pending) {
        if (!isRecord(entry)) {
          continue;
        }

        const hourStart: string | null = toIsoDateOrNull(entry["hourStart"]);
        const idempotencyKey: string | null = toTextOrNull(
          entry["idempotencyKey"],
        );

        if (!hourStart || !idempotencyKey) {
          continue;
        }

        state.pendingReports.push({
          hourStart,
          quantity: toCount(entry["quantity"]),
          idempotencyKey,
          attempts: toCount(entry["attempts"]),
          firstAttemptAt: toIsoDateOrNull(entry["firstAttemptAt"]),
          lastError: toTextOrNull(entry["lastError"]),
        });
      }
    }

    state.pendingReports.sort(
      (
        a: EnterpriseMarketplaceUsageReport,
        b: EnterpriseMarketplaceUsageReport,
      ): number => {
        return a.hourStart.localeCompare(b.hourStart);
      },
    );

    state.carriedUserHours = toCount(value["carriedUserHours"]);

    const accepted: unknown = value["lastAcceptedReport"];

    if (isRecord(accepted)) {
      const hourStart: string | null = toIsoDateOrNull(accepted["hourStart"]);
      const acceptedAt: string | null = toIsoDateOrNull(accepted["acceptedAt"]);
      const reportId: string | null = toTextOrNull(accepted["reportId"]);

      if (hourStart && acceptedAt && reportId) {
        state.lastAcceptedReport = {
          hourStart,
          quantity: toCount(accepted["quantity"]),
          reportId,
          acceptedAt,
        };
      }
    }

    state.verifiedAt = toIsoDateOrNull(value["verifiedAt"]);
    state.refusedAt = toIsoDateOrNull(value["refusedAt"]);
    state.refusal = toTextOrNull(value["refusal"]);
    state.lastProblem = toTextOrNull(value["lastProblem"]);
    state.lastProblemAt = toIsoDateOrNull(value["lastProblemAt"]);
    state.unbilledUserHours = toCount(value["unbilledUserHours"]);

    return state;
  }

  public static toJSON(state: EnterpriseMarketplaceBillingState): JSONObject {
    return JSON.parse(JSON.stringify(state)) as JSONObject;
  }

  public static summarize(
    state: EnterpriseMarketplaceBillingState,
  ): EnterpriseMarketplaceBillingSummary {
    return {
      marketplace: state.marketplace,
      verifiedAt: state.verifiedAt,
      refusedAt: state.refusedAt,
      refusal: state.refusal,
      lastAcceptedReport: state.lastAcceptedReport
        ? { ...state.lastAcceptedReport }
        : null,
      pendingReportCount: state.pendingReports.length,
      pendingUserHours:
        state.carriedUserHours +
        state.pendingReports.reduce(
          (total: number, report: EnterpriseMarketplaceUsageReport): number => {
            return total + report.quantity;
          },
          0,
        ),
      lastProblem: state.lastProblem,
      lastProblemAt: state.lastProblemAt,
    };
  }
}
