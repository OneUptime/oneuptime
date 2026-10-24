import crypto from "crypto";
import {
  EnterpriseMarketplaceBillingState,
  EnterpriseMarketplaceUsageReport,
} from "Common/Types/EnterpriseLicense/EnterpriseMarketplaceBilling";
import {
  SelfHostedUsageOutcome,
  SelfHostedUsageReport,
} from "./Reporters/SelfHostedMarketplaceReporter";

/*
 * The bookkeeping of billing a self-hosted installation's users through the
 * marketplace it was bought on, by the user-hour - pure functions over the
 * stored state (Common/Types/EnterpriseLicense/EnterpriseMarketplaceBilling),
 * so every rule here is tested without a database or a marketplace:
 *
 *   observe        every run notes how many users the installation has. An
 *                  hour is billed at the most users seen in it, and only when
 *                  a run saw the installation running in it: an hour the
 *                  installation was down is never billed. When a run lands in
 *                  a later hour, the hour it watched becomes a report.
 *   prepare        decides which reports to send now. A report the
 *                  marketplace would think too old (AWS takes six hours,
 *                  Microsoft 24) and that was never sent rides in the next
 *                  report instead, as AWS asks; one that was sent and never
 *                  answered is not sent again (it may have been billed) and
 *                  is counted as possibly unbilled. Nothing older than 30
 *                  days is billed at all.
 *   claim          every attempt is written down BEFORE it is sent, so a
 *                  report that may already have reached the marketplace is
 *                  never folded into another one.
 *   applyOutcome   what the marketplace said: accepted (billed - and the
 *                  marketplace's word that the buyer is subscribed),
 *                  not-entitled, too-old (rides in the next report),
 *                  conflict (not billed), or setup / retry (sent again).
 */

export const HOUR_IN_MS: number = 60 * 60 * 1000;

// Usage older than this is not billed at all, however it was held up.
export const MAX_BILLABLE_AGE_IN_MS: number = 30 * 24 * HOUR_IN_MS;

// The longest a stored message gets (they end up in the admin dialog and the log).
const MAX_MESSAGE_LENGTH: number = 500;

export interface ReportPolicy {
  maxReportAgeInMs: number;
  acceptsZeroQuantity: boolean;
}

export interface PreparedReports {
  state: EnterpriseMarketplaceBillingState;
  // Oldest first.
  toSend: Array<EnterpriseMarketplaceUsageReport>;
  // User-hours dropped because they may already have been billed, or are too old.
  droppedUserHours: number;
  notes: Array<string>;
}

const clip: (text: string) => string = (text: string): string => {
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.substring(0, MAX_MESSAGE_LENGTH)}...`
    : text;
};

const copyState: (
  state: EnterpriseMarketplaceBillingState,
) => EnterpriseMarketplaceBillingState = (
  state: EnterpriseMarketplaceBillingState,
): EnterpriseMarketplaceBillingState => {
  return {
    ...state,
    observedHour: state.observedHour ? { ...state.observedHour } : null,
    pendingReports: state.pendingReports.map(
      (
        report: EnterpriseMarketplaceUsageReport,
      ): EnterpriseMarketplaceUsageReport => {
        return { ...report };
      },
    ),
    lastAcceptedReport: state.lastAcceptedReport
      ? { ...state.lastAcceptedReport }
      : null,
  };
};

export default class MarketplaceBilling {
  // The start of the hour `date` is in (UTC).
  public static hourStartOf(date: Date): Date {
    return new Date(Math.floor(date.getTime() / HOUR_IN_MS) * HOUR_IN_MS);
  }

  /*
   * The report's idempotency key: the same for the same installation and
   * hour, so a retry from any pod is the same request (AWS's ClientToken,
   * Google's operation ID). A name-based UUID - Google recommends one, and
   * it fits AWS's 64 characters.
   */
  public static idempotencyKeyFor(instanceId: string, hourStart: Date): string {
    const hash: Buffer = crypto
      .createHash("sha256")
      .update(
        `oneuptime-marketplace-usage:${instanceId}:${hourStart.toISOString()}`,
      )
      .digest();

    const bytes: Buffer = Buffer.from(hash.subarray(0, 16));
    // Version 5 and the RFC 4122 variant, so it reads as a name-based UUID.
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex: string = bytes.toString("hex");

    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
  }

  /*
   * Notes that the installation has `users` users now. When `now` is in a
   * later hour than the one being watched, the watched hour becomes a report
   * (with any carried usage), and the new hour starts being watched.
   */
  public static observe(data: {
    state: EnterpriseMarketplaceBillingState;
    now: Date;
    users: number;
    instanceId: string;
  }): EnterpriseMarketplaceBillingState {
    const state: EnterpriseMarketplaceBillingState = copyState(data.state);
    const users: number =
      Number.isFinite(data.users) && data.users > 0
        ? Math.floor(data.users)
        : 0;
    const hourStart: string = MarketplaceBilling.hourStartOf(
      data.now,
    ).toISOString();

    if (!state.observedHour) {
      state.observedHour = { start: hourStart, maxUsers: users };
      return state;
    }

    // The same hour - or a clock that went back: keep watching it.
    if (hourStart <= state.observedHour.start) {
      state.observedHour.maxUsers = Math.max(
        state.observedHour.maxUsers,
        users,
      );
      return state;
    }

    const watched: { start: string; maxUsers: number } = state.observedHour;
    const alreadyReported: boolean = state.pendingReports.some(
      (report: EnterpriseMarketplaceUsageReport): boolean => {
        return report.hourStart === watched.start;
      },
    );

    if (!alreadyReported) {
      state.pendingReports.push({
        hourStart: watched.start,
        quantity: watched.maxUsers + state.carriedUserHours,
        idempotencyKey: MarketplaceBilling.idempotencyKeyFor(
          data.instanceId,
          new Date(watched.start),
        ),
        attempts: 0,
        firstAttemptAt: null,
        lastError: null,
      });
      state.carriedUserHours = 0;
    }

    state.observedHour = { start: hourStart, maxUsers: users };

    return state;
  }

  /*
   * The reports to send now, oldest first, after moving the ones the
   * marketplace would think too old: never sent - they ride in the newest
   * report that has not been sent either (or in the next report made); sent
   * and never answered - dropped, because they may have been billed.
   */
  public static prepare(data: {
    state: EnterpriseMarketplaceBillingState;
    now: Date;
    policy: ReportPolicy;
  }): PreparedReports {
    const state: EnterpriseMarketplaceBillingState = copyState(data.state);
    const nowInMs: number = data.now.getTime();
    const notes: Array<string> = [];
    let droppedUserHours: number = 0;

    const keep: Array<EnterpriseMarketplaceUsageReport> = [];
    let carry: number = 0;

    for (const report of state.pendingReports) {
      const ageInMs: number = nowInMs - new Date(report.hourStart).getTime();

      if (ageInMs > MAX_BILLABLE_AGE_IN_MS) {
        droppedUserHours += report.quantity;
        notes.push(
          `${report.quantity} user-hours from ${report.hourStart} are more than 30 days old and were NOT billed.`,
        );
        continue;
      }

      if (ageInMs > data.policy.maxReportAgeInMs) {
        if (report.attempts === 0) {
          carry += report.quantity;
          continue;
        }

        droppedUserHours += report.quantity;
        notes.push(
          `The report of ${report.quantity} user-hours for ${report.hourStart} was sent ${report.attempts} time(s) without an answer and is now too old to send again; it may NOT have been billed.`,
        );
        continue;
      }

      if (report.quantity === 0 && !data.policy.acceptsZeroQuantity) {
        // Nothing to bill, and this marketplace refuses an empty report.
        continue;
      }

      keep.push(report);
    }

    state.pendingReports = keep;
    MarketplaceBilling.carryInto(state, carry);

    return {
      state,
      toSend: state.pendingReports.map(
        (
          report: EnterpriseMarketplaceUsageReport,
        ): EnterpriseMarketplaceUsageReport => {
          return { ...report };
        },
      ),
      droppedUserHours,
      notes,
    };
  }

  /*
   * Writes the attempt down before the report is sent: from here on the
   * report may reach the marketplace, so it is never folded into another.
   */
  public static claim(data: {
    state: EnterpriseMarketplaceBillingState;
    idempotencyKey: string;
    now: Date;
  }): EnterpriseMarketplaceBillingState {
    const state: EnterpriseMarketplaceBillingState = copyState(data.state);
    const report: EnterpriseMarketplaceUsageReport | undefined =
      state.pendingReports.find(
        (candidate: EnterpriseMarketplaceUsageReport): boolean => {
          return candidate.idempotencyKey === data.idempotencyKey;
        },
      );

    if (report) {
      report.attempts += 1;
      report.firstAttemptAt = report.firstAttemptAt || data.now.toISOString();
    }

    return state;
  }

  // What the marketplace said about one report.
  public static applyOutcome(data: {
    state: EnterpriseMarketplaceBillingState;
    idempotencyKey: string;
    outcome: SelfHostedUsageOutcome;
    now: Date;
  }): EnterpriseMarketplaceBillingState {
    const state: EnterpriseMarketplaceBillingState = copyState(data.state);
    const index: number = state.pendingReports.findIndex(
      (candidate: EnterpriseMarketplaceUsageReport): boolean => {
        return candidate.idempotencyKey === data.idempotencyKey;
      },
    );

    if (index === -1) {
      return state;
    }

    const report: EnterpriseMarketplaceUsageReport =
      state.pendingReports[index]!;
    const nowText: string = data.now.toISOString();
    const outcome: SelfHostedUsageOutcome = data.outcome;

    switch (outcome.kind) {
      case "accepted":
        state.pendingReports.splice(index, 1);
        state.lastAcceptedReport = {
          hourStart: report.hourStart,
          quantity: report.quantity,
          reportId: clip(outcome.reportId),
          acceptedAt: nowText,
        };
        state.verifiedAt = nowText;
        state.lastProblem = null;
        state.lastProblemAt = null;
        return state;

      case "not-entitled":
        state.pendingReports.splice(index, 1);
        state.unbilledUserHours += report.quantity;
        state.refusedAt = nowText;
        state.refusal = clip(outcome.detail);
        state.lastProblem = clip(outcome.detail);
        state.lastProblemAt = nowText;
        return state;

      case "too-old":
        state.pendingReports.splice(index, 1);
        MarketplaceBilling.carryInto(state, report.quantity);
        state.lastProblem = clip(outcome.detail);
        state.lastProblemAt = nowText;
        return state;

      case "conflict":
        state.pendingReports.splice(index, 1);
        state.unbilledUserHours += report.quantity;
        state.lastProblem = clip(outcome.detail);
        state.lastProblemAt = nowText;
        return state;

      case "setup":
      case "retry":
        report.lastError = clip(outcome.detail);
        state.lastProblem = clip(outcome.detail);
        state.lastProblemAt = nowText;
        return state;
    }
  }

  // The report the marketplace is sent for a stored one.
  public static toReport(
    report: EnterpriseMarketplaceUsageReport,
  ): SelfHostedUsageReport {
    return {
      hourStart: new Date(report.hourStart),
      quantity: report.quantity,
      idempotencyKey: report.idempotencyKey,
    };
  }

  /*
   * Adds usage to the newest report that has never been sent, or keeps it
   * for the next report made.
   */
  private static carryInto(
    state: EnterpriseMarketplaceBillingState,
    userHours: number,
  ): void {
    if (userHours <= 0) {
      return;
    }

    for (
      let index: number = state.pendingReports.length - 1;
      index >= 0;
      index--
    ) {
      const candidate: EnterpriseMarketplaceUsageReport =
        state.pendingReports[index]!;

      if (candidate.attempts === 0) {
        candidate.quantity += userHours;
        return;
      }
    }

    state.carriedUserHours += userHours;
  }
}
