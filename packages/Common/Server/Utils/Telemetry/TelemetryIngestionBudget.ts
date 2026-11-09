import logger from "../Logger";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetCounterDecision,
  TelemetryIngestionBudgetCounterMode,
  TelemetryIngestionBudgetCounterOutcome,
  TelemetryIngestionBudgetCounterScope,
} from "./TelemetryIngestionBudgetCounter";
import TelemetryIngestionBudgetSettings, {
  TelemetryIngestionBudgetInstanceSettings,
} from "./TelemetryIngestionBudgetSettings";
import { TelemetryIngestBodySize } from "./TelemetryIngestBodySize";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import {
  formatTelemetryIngestionBudgetGB,
  formatTelemetryIngestionBudgetMBPerSecond,
  getTelemetryIngestionBudgetDay,
  getTelemetryIngestionBudgetSignalSlug,
  getTelemetryIngestionBudgetSignalWords,
  getTelemetryIngestionBudgetWarningBytes,
  isTelemetryIngestionBudgetLimited,
  resolveTelemetryIngestionBudget,
  TelemetryIngestionBudgetDay,
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetResolved,
  TelemetryIngestionBudgetResolvedScope,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import moment from "moment-timezone";

/*
 * The ingest side of telemetry ingestion budgets: decide whether a request
 * may be stored, against its project's budget and its ingestion key's, and
 * count it.
 *
 * Every queue-bound producer passes through here exactly once:
 *
 *   - the ingestion key middleware (TelemetryIngest), for the HTTP surfaces
 *     that carry a signal: OTLP/HTTP, Fluentd / Fluent Bit, syslog, the
 *     Vercel log drain, security events and Pyroscope. A refusal is answered
 *     there, before the handler runs.
 *   - the OTLP/gRPC server, which answers its own refusals.
 *   - TelemetryQueueService, for every producer that came through neither:
 *     MQTT, the cloud streams and OneUptime's own collectors. Nobody can be
 *     told there, so a request over a used-up budget is dropped (and
 *     counted), and no rate applies.
 *
 * What it costs per request: with no budget or rate in force for the
 * project's signal (nothing set anywhere - every install until an admin sets
 * one), two in-process cache lookups and no Redis at all. With one, a single
 * Redis round trip (TelemetryIngestionBudgetCounter's script), plus one more
 * in the worker for a compressed body whose real size differs from the size
 * counted on arrival (reconcile).
 */

// Kept with the shared types (they are what every surface answers with).
export { TelemetryIngestionBudgetRefusalKind };
export type { TelemetryIngestionBudgetRefusal };

/*
 * What was counted for an admitted request, carried on it (and, when its
 * size was not exact, on its queue job) so the request is counted once and
 * the worker can settle a compressed body's real size.
 */
export interface TelemetryIngestionBudgetCharge {
  projectId: string;
  signal: TelemetryIngestionBudgetSignal;
  dayId: string;
  dayTtlSeconds: number;
  countedBytes: number;
  // Whether countedBytes is the decompressed size itself.
  isExact: boolean;
  /*
   * Checked but not counted yet: the middleware could not size the body
   * (Pyroscope reads it after the key is checked), so the enqueue counts it.
   */
  isPending: boolean;
  scopes: Array<TelemetryIngestionBudgetCounterScope>;
}

/*
 * The part of a charge a queue job carries for the worker: just enough to
 * add a compressed body's remaining bytes to the right day's counters.
 */
export interface TelemetryIngestionBudgetJobCharge {
  dayId: string;
  signalSlug: string;
  countedBytes: number;
  scopes: Array<{
    scope: TelemetryIngestionBudgetScope;
    scopeId: string;
    warningBytes: number | null;
  }>;
}

export interface TelemetryIngestionBudgetAdmission {
  refusal: TelemetryIngestionBudgetRefusal | null;
  // null when nothing was counted: no limit in force, or Redis unavailable.
  charge: TelemetryIngestionBudgetCharge | null;
}

export enum TelemetryIngestionBudgetAdmissionMode {
  // A sender that is answered: refuse over the daily budget and the rate.
  Refuse = "refuse",
  // A sender that cannot be answered: drop over the daily budget, no rate.
  Drop = "drop",
  // Refuse like Refuse, but count later (chargePending): the size is unknown.
  Check = "check",
}

const ADMITTED_UNCOUNTED: TelemetryIngestionBudgetAdmission = {
  refusal: null,
  charge: null,
};

const COUNTER_MODE_FOR: Record<
  TelemetryIngestionBudgetAdmissionMode,
  TelemetryIngestionBudgetCounterMode
> = {
  [TelemetryIngestionBudgetAdmissionMode.Refuse]:
    TelemetryIngestionBudgetCounterMode.Refuse,
  [TelemetryIngestionBudgetAdmissionMode.Drop]:
    TelemetryIngestionBudgetCounterMode.Drop,
  [TelemetryIngestionBudgetAdmissionMode.Check]:
    TelemetryIngestionBudgetCounterMode.Check,
};

// A day's counters outlive the day by this long, for the status page and sweep.
const DAY_COUNTERS_KEPT_AFTER_RESET_SECONDS: number = 24 * 60 * 60;

export const formatTelemetryIngestionBudgetResetsAt: (date: Date) => string = (
  date: Date,
): string => {
  return moment.utc(date.getTime()).format("YYYY-MM-DD HH:mm [UTC]");
};

export default class TelemetryIngestionBudget {
  /*
   * Decide a request and, when admitted, count it. Never throws: a failure to
   * read settings or counters admits the request uncounted.
   */
  public static async admit(data: {
    projectId: ObjectID;
    signal: TelemetryIngestionBudgetSignal;
    ingestionKeyPolicy?: TelemetryIngestionKeyPolicy | null | undefined;
    mode: TelemetryIngestionBudgetAdmissionMode;
    // Called only when a limit is in force, so an unlimited project pays nothing.
    measure: () => TelemetryIngestBodySize;
    now?: Date | undefined;
  }): Promise<TelemetryIngestionBudgetAdmission> {
    try {
      const now: Date = data.now || new Date();

      const instance: TelemetryIngestionBudgetInstanceSettings =
        await TelemetryIngestionBudgetSettings.getInstanceSettings();
      const projectOverrides: TelemetryIngestionBudgetStoredSettings | null =
        await TelemetryIngestionBudgetSettings.getProjectOverrides(
          data.projectId,
        );

      const resolved: TelemetryIngestionBudgetResolved =
        resolveTelemetryIngestionBudget({
          signal: data.signal,
          instance: instance.budgets,
          project: projectOverrides,
          ingestionKey: data.ingestionKeyPolicy?.ingestionBudgets ?? null,
        });

      if (!isTelemetryIngestionBudgetLimited(resolved)) {
        return ADMITTED_UNCOUNTED;
      }

      const day: TelemetryIngestionBudgetDay = getTelemetryIngestionBudgetDay({
        now: now,
        resetTime: instance.resetTime,
        timezone: instance.timezone,
      });

      const scopes: Array<TelemetryIngestionBudgetCounterScope> =
        this.getScopes({
          projectId: data.projectId,
          ingestionKeyPolicy: data.ingestionKeyPolicy,
          resolved: resolved,
          warningPercent: instance.warningPercent,
        });

      const isCheck: boolean =
        data.mode === TelemetryIngestionBudgetAdmissionMode.Check;
      const size: TelemetryIngestBodySize = isCheck
        ? { bytes: 0, isExact: true }
        : data.measure();

      const charge: TelemetryIngestionBudgetCharge = {
        projectId: data.projectId.toString(),
        signal: data.signal,
        dayId: day.id,
        dayTtlSeconds:
          Math.ceil((day.resetsAt.getTime() - now.getTime()) / 1000) +
          DAY_COUNTERS_KEPT_AFTER_RESET_SECONDS,
        countedBytes: size.bytes,
        isExact: size.isExact,
        isPending: isCheck,
        scopes: scopes,
      };

      const decision: TelemetryIngestionBudgetCounterDecision =
        await TelemetryIngestionBudgetCounter.consume({
          projectId: charge.projectId,
          signalSlug: getTelemetryIngestionBudgetSignalSlug(data.signal),
          dayId: day.id,
          dayTtlSeconds: charge.dayTtlSeconds,
          bytes: size.bytes,
          mode: COUNTER_MODE_FOR[data.mode],
          scopes: scopes,
          nowMs: now.getTime(),
        });

      return this.toAdmission({
        decision: decision,
        charge: charge,
        day: day,
        mode: data.mode,
      });
    } catch (err) {
      logger.warn(
        `TelemetryIngestionBudget: could not decide a ${getTelemetryIngestionBudgetSignalWords(
          data.signal,
        )} request of project ${data.projectId.toString()} against its budget; admitting it uncounted`,
      );
      logger.warn(err);
      return ADMITTED_UNCOUNTED;
    }
  }

  /*
   * Count a request a Check admitted, now that its size is known. Returns the
   * completed charge, or null when it could not be counted.
   */
  public static async chargePending(data: {
    charge: TelemetryIngestionBudgetCharge;
    size: TelemetryIngestBodySize;
    now?: Date | undefined;
  }): Promise<TelemetryIngestionBudgetCharge | null> {
    const now: Date = data.now || new Date();

    const decision: TelemetryIngestionBudgetCounterDecision =
      await TelemetryIngestionBudgetCounter.consume({
        projectId: data.charge.projectId,
        signalSlug: getTelemetryIngestionBudgetSignalSlug(data.charge.signal),
        dayId: data.charge.dayId,
        dayTtlSeconds: data.charge.dayTtlSeconds,
        bytes: data.size.bytes,
        mode: TelemetryIngestionBudgetCounterMode.Charge,
        scopes: data.charge.scopes,
        nowMs: now.getTime(),
      });

    if (decision.outcome !== TelemetryIngestionBudgetCounterOutcome.Admitted) {
      return null;
    }

    return {
      ...data.charge,
      countedBytes: data.size.bytes,
      isExact: data.size.isExact,
      isPending: false,
    };
  }

  // What a queue job carries of a charge whose size the worker must settle.
  public static toJobCharge(
    charge: TelemetryIngestionBudgetCharge,
  ): TelemetryIngestionBudgetJobCharge {
    return {
      dayId: charge.dayId,
      signalSlug: getTelemetryIngestionBudgetSignalSlug(charge.signal),
      countedBytes: charge.countedBytes,
      scopes: charge.scopes.map(
        (
          scope: TelemetryIngestionBudgetCounterScope,
        ): TelemetryIngestionBudgetJobCharge["scopes"][number] => {
          return {
            scope: scope.scope,
            scopeId: scope.scopeId,
            warningBytes: scope.warningBytes,
          };
        },
      ),
    };
  }

  /*
   * The worker has inflated a body counted at an estimate: add the
   * difference to the day it was counted on. Best effort, never throws.
   */
  public static async reconcile(data: {
    charge: TelemetryIngestionBudgetJobCharge;
    decodedBytes: number;
    now?: Date | undefined;
  }): Promise<void> {
    try {
      if (!Number.isFinite(data.decodedBytes) || data.decodedBytes < 0) {
        return;
      }

      const delta: number =
        Math.floor(data.decodedBytes) - Math.floor(data.charge.countedBytes);

      if (delta === 0) {
        return;
      }

      await TelemetryIngestionBudgetCounter.reconcile({
        dayId: data.charge.dayId,
        signalSlug: data.charge.signalSlug,
        scopes: data.charge.scopes,
        deltaBytes: delta,
        nowMs: (data.now || new Date()).getTime(),
      });
    } catch (err) {
      logger.warn(
        "TelemetryIngestionBudget: could not settle a compressed body's size against its budget",
      );
      logger.warn(err);
    }
  }

  // The sentence a refused sender is answered with.
  public static getRefusalMessage(data: {
    kind: TelemetryIngestionBudgetRefusalKind;
    scope: TelemetryIngestionBudgetScope;
    signal: TelemetryIngestionBudgetSignal;
    limitBytes: number;
    resetsAt: Date;
    retryAfterSeconds: number | null;
  }): string {
    const words: string = getTelemetryIngestionBudgetSignalWords(data.signal);
    const isKey: boolean =
      data.scope === TelemetryIngestionBudgetScope.IngestionKey;

    if (data.kind === TelemetryIngestionBudgetRefusalKind.RateLimited) {
      const seconds: number = Math.max(1, data.retryAfterSeconds ?? 1);

      return `${isKey ? "This ingestion key is" : "This project is"} sending ${words} faster than its ingestion rate limit of ${formatTelemetryIngestionBudgetMBPerSecond(
        data.limitBytes,
      )}. Retry in ${seconds} second${seconds === 1 ? "" : "s"}.`;
    }

    return `${isKey ? "This ingestion key's" : "This project's"} daily ${words} ingestion budget of ${formatTelemetryIngestionBudgetGB(
      data.limitBytes,
    )} is used up, so OneUptime is not storing ${words} ${
      isKey ? "sent with this key" : "from this project"
    } until the budget resets at ${formatTelemetryIngestionBudgetResetsAt(
      data.resetsAt,
    )}.`;
  }

  private static getScopes(data: {
    projectId: ObjectID;
    ingestionKeyPolicy?: TelemetryIngestionKeyPolicy | null | undefined;
    resolved: TelemetryIngestionBudgetResolved;
    warningPercent: number;
  }): Array<TelemetryIngestionBudgetCounterScope> {
    const toScope: (
      scope: TelemetryIngestionBudgetScope,
      scopeId: string,
      limits: TelemetryIngestionBudgetResolvedScope,
    ) => TelemetryIngestionBudgetCounterScope = (
      scope: TelemetryIngestionBudgetScope,
      scopeId: string,
      limits: TelemetryIngestionBudgetResolvedScope,
    ): TelemetryIngestionBudgetCounterScope => {
      return {
        scope: scope,
        scopeId: scopeId,
        dailyBudgetBytes: limits.dailyBudget.bytes,
        warningBytes:
          limits.dailyBudget.bytes === null
            ? null
            : getTelemetryIngestionBudgetWarningBytes({
                dailyBudgetBytes: limits.dailyBudget.bytes,
                warningPercent: data.warningPercent,
              }),
        rateLimitBytesPerSecond: limits.rateLimit.bytes,
      };
    };

    /*
     * The project is always counted while anything is limited, even when
     * only the key has a budget: the project's day total is what its members
     * see and what the metrics publish.
     */
    const scopes: Array<TelemetryIngestionBudgetCounterScope> = [
      toScope(
        TelemetryIngestionBudgetScope.Project,
        data.projectId.toString(),
        data.resolved.project,
      ),
    ];

    if (data.resolved.ingestionKey && data.ingestionKeyPolicy) {
      scopes.push(
        toScope(
          TelemetryIngestionBudgetScope.IngestionKey,
          data.ingestionKeyPolicy.ingestionKeyId.toString(),
          data.resolved.ingestionKey,
        ),
      );
    }

    return scopes;
  }

  private static toAdmission(data: {
    decision: TelemetryIngestionBudgetCounterDecision;
    charge: TelemetryIngestionBudgetCharge;
    day: TelemetryIngestionBudgetDay;
    mode: TelemetryIngestionBudgetAdmissionMode;
  }): TelemetryIngestionBudgetAdmission {
    const decision: TelemetryIngestionBudgetCounterDecision = data.decision;

    if (
      decision.outcome ===
      TelemetryIngestionBudgetCounterOutcome.CounterUnavailable
    ) {
      return ADMITTED_UNCOUNTED;
    }

    if (decision.outcome === TelemetryIngestionBudgetCounterOutcome.Admitted) {
      for (const index of decision.warningCrossedScopeIndexes || []) {
        const scope: TelemetryIngestionBudgetCounterScope | undefined =
          data.charge.scopes[index];

        if (scope) {
          logger.info(
            `TelemetryIngestionBudget: ${this.describeScope(scope, data.charge)} crossed the warning threshold of its daily ${getTelemetryIngestionBudgetSignalWords(
              data.charge.signal,
            )} budget.`,
          );
        }
      }

      return { refusal: null, charge: data.charge };
    }

    const scope: TelemetryIngestionBudgetCounterScope | undefined =
      data.charge.scopes[decision.scopeIndex ?? 0];

    if (!scope) {
      return ADMITTED_UNCOUNTED;
    }

    const isRate: boolean =
      decision.outcome === TelemetryIngestionBudgetCounterOutcome.RateLimited;
    const kind: TelemetryIngestionBudgetRefusalKind = isRate
      ? TelemetryIngestionBudgetRefusalKind.RateLimited
      : TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted;
    const limitBytes: number =
      (isRate ? scope.rateLimitBytesPerSecond : scope.dailyBudgetBytes) || 0;
    const retryAfterSeconds: number | null = isRate
      ? Math.max(1, decision.retryAfterSeconds ?? 1)
      : null;

    /*
     * One line per scope and signal per budget day, from the request that
     * found the budget used up: a refused sender keeps knocking, and a line
     * per refusal would flood the very logs an operator reads to find it.
     */
    if (!isRate && decision.isFirstExhaustion) {
      logger.warn(
        `TelemetryIngestionBudget: ${this.describeScope(scope, data.charge)} used up its daily ${getTelemetryIngestionBudgetSignalWords(
          data.charge.signal,
        )} budget of ${formatTelemetryIngestionBudgetGB(limitBytes)}; ${
          data.mode === TelemetryIngestionBudgetAdmissionMode.Drop
            ? "dropping"
            : "refusing"
        } it until ${formatTelemetryIngestionBudgetResetsAt(data.day.resetsAt)}.`,
      );
    }

    return {
      refusal: {
        kind: kind,
        scope: scope.scope,
        signal: data.charge.signal,
        message: this.getRefusalMessage({
          kind: kind,
          scope: scope.scope,
          signal: data.charge.signal,
          limitBytes: limitBytes,
          resetsAt: data.day.resetsAt,
          retryAfterSeconds: retryAfterSeconds,
        }),
        retryAfterSeconds: retryAfterSeconds,
        resetsAt: data.day.resetsAt,
      },
      charge: null,
    };
  }

  private static describeScope(
    scope: TelemetryIngestionBudgetCounterScope,
    charge: TelemetryIngestionBudgetCharge,
  ): string {
    return scope.scope === TelemetryIngestionBudgetScope.IngestionKey
      ? `ingestion key ${scope.scopeId} of project ${charge.projectId}`
      : `project ${charge.projectId}`;
  }
}
