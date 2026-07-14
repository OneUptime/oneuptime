import ObjectID from "../../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../../Types/Date";
import SortOrder from "../../../../../../Types/BaseDatabase/SortOrder";
import InBetween from "../../../../../../Types/BaseDatabase/InBetween";
import PositiveNumber from "../../../../../../Types/PositiveNumber";
import { JSONObject } from "../../../../../../Types/JSON";
import { LIMIT_PER_PROJECT } from "../../../../../../Types/Database/LimitMax";
import SentinelInsightType from "../../../../../../Types/AI/SentinelInsightType";
import SentinelInsightSeverity from "../../../../../../Types/AI/SentinelInsightSeverity";
import TelemetryException from "../../../../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../../../../Models/DatabaseModels/Service";
import TelemetryExceptionService from "../../../../../Services/TelemetryExceptionService";
import ExceptionInstanceService from "../../../../../Services/ExceptionInstanceService";
import ServiceService from "../../../../../Services/ServiceService";
import QueryHelper from "../../../../../Types/Database/QueryHelper";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * ExceptionSpike — an ESTABLISHED exception (first seen more than a day
 * ago) whose recent hourly occurrence rate blew past its own 24-hour
 * baseline, including the dormant-awakening case (an old exception that was
 * quiet all day suddenly firing). Candidates come cheap from Postgres
 * (group table); the actual rates come from two ClickHouse counts per
 * candidate (fingerprint bloom index + time range — the exception-monitor
 * count idiom). Deterministic — no LLM anywhere in this detector.
 */

// The spike window: occurrences in the last hour, compared to...
export const EXCEPTION_SPIKE_RECENT_WINDOW_HOURS: number = 1;

/*
 * ...the exception's own average hourly rate over the 24 hours BEFORE the
 * spike window. Self-baselining means a chronically noisy exception does
 * not alert on its normal noise.
 */
export const EXCEPTION_SPIKE_BASELINE_WINDOW_HOURS: number = 24;

/*
 * Absolute floor: below 10 occurrences/hour a "5x spike" can be 2→10 raw
 * events — statistically meaningless and guaranteed inbox noise.
 */
export const EXCEPTION_SPIKE_MIN_RECENT_COUNT: number = 10;

/*
 * Rate multiplier that counts as a spike. The baseline hourly average is
 * floored at 1 (see evaluateSpike) so near-zero baselines don't produce
 * infinite multipliers; the dormant case (prior24 == 0, recent >= 10) then
 * falls out of the same rule automatically.
 */
export const EXCEPTION_SPIKE_MIN_MULTIPLIER: number = 5;

// A >= 10x spike is a step change, not a fluctuation — escalate to High.
export const EXCEPTION_SPIKE_HIGH_SEVERITY_MULTIPLIER: number = 10;

/*
 * Candidate cap per scan tick: two ClickHouse counts per candidate, so 25
 * candidates = 50 bounded point queries. Sorted by lifetime occurrence
 * count so the perennial heavy hitters are always inspected first.
 */
export const EXCEPTION_SPIKE_CANDIDATE_LIMIT: number = 25;

// Titles must stay scannable in a list — truncate long exception messages.
export const EXCEPTION_SPIKE_TITLE_MESSAGE_MAX_LENGTH: number = 80;

export interface ExceptionSpikeDecision {
  isSpike: boolean;
  // recent count / max(baseline hourly average, 1).
  multiplier: number;
  severity: SentinelInsightSeverity;
  // prior-window count / EXCEPTION_SPIKE_BASELINE_WINDOW_HOURS (unfloored).
  baselineHourlyAverage: number;
  // Zero occurrences in the whole baseline window, then a burst.
  isDormantAwakening: boolean;
}

export default class ExceptionSpikeDetector implements InsightDetector {
  public insightType: SentinelInsightType = SentinelInsightType.ExceptionSpike;

  /*
   * Pure decision: recent-hour count vs the prior 24h window count.
   * Spike ⇔ recent >= EXCEPTION_SPIKE_MIN_RECENT_COUNT AND
   * recent >= EXCEPTION_SPIKE_MIN_MULTIPLIER * max(prior/24, 1).
   */
  public static evaluateSpike(
    recentCount: number,
    priorWindowCount: number,
  ): ExceptionSpikeDecision {
    const baselineHourlyAverage: number =
      priorWindowCount / EXCEPTION_SPIKE_BASELINE_WINDOW_HOURS;
    const effectiveBaseline: number = Math.max(baselineHourlyAverage, 1);
    const multiplier: number = recentCount / effectiveBaseline;

    const isSpike: boolean =
      recentCount >= EXCEPTION_SPIKE_MIN_RECENT_COUNT &&
      multiplier >= EXCEPTION_SPIKE_MIN_MULTIPLIER;

    return {
      isSpike,
      multiplier,
      severity:
        multiplier >= EXCEPTION_SPIKE_HIGH_SEVERITY_MULTIPLIER
          ? SentinelInsightSeverity.High
          : SentinelInsightSeverity.Medium,
      baselineHourlyAverage,
      isDormantAwakening:
        priorWindowCount === 0 &&
        recentCount >= EXCEPTION_SPIKE_MIN_RECENT_COUNT,
    };
  }

  /*
   * Human label for the exception: the type when present, else the first
   * EXCEPTION_SPIKE_TITLE_MESSAGE_MAX_LENGTH characters of the message.
   */
  public static buildExceptionLabel(
    exceptionType: string | undefined,
    message: string | undefined,
  ): string {
    if (exceptionType && exceptionType.trim().length > 0) {
      return exceptionType.trim();
    }
    const trimmedMessage: string = (message || "").trim();
    if (trimmedMessage.length === 0) {
      return "Unknown exception";
    }
    if (trimmedMessage.length <= EXCEPTION_SPIKE_TITLE_MESSAGE_MAX_LENGTH) {
      return trimmedMessage;
    }
    return `${trimmedMessage.slice(0, EXCEPTION_SPIKE_TITLE_MESSAGE_MAX_LENGTH)}…`;
  }

  // Stable dedupe key, keyed on the exception GROUP id (ingest dedupe unit).
  public static buildFingerprint(telemetryExceptionId: string): string {
    return `exception-spike:${telemetryExceptionId}`;
  }

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    const recentWindowStart: Date = OneUptimeDate.addRemoveHours(
      context.now,
      -1 * EXCEPTION_SPIKE_RECENT_WINDOW_HOURS,
    );
    const priorWindowStart: Date = OneUptimeDate.addRemoveHours(
      recentWindowStart,
      -1 * EXCEPTION_SPIKE_BASELINE_WINDOW_HOURS,
    );
    const establishedBefore: Date = OneUptimeDate.addRemoveHours(
      context.now,
      -1 * EXCEPTION_SPIKE_BASELINE_WINDOW_HOURS,
    );

    /*
     * Candidates: established exception groups (born before the baseline
     * window so they HAVE a baseline) that were active in the spike
     * window. Anything younger is NewExceptionDetector's territory.
     */
    const candidateQuery: JSONObject = {
      projectId: context.projectId,
      lastSeenAt: QueryHelper.greaterThanEqualTo(recentWindowStart),
      firstSeenAt: QueryHelper.lessThan(establishedBefore),
      isResolved: false,
      isArchived: false,
    };

    const exceptions: Array<TelemetryException> =
      await TelemetryExceptionService.findBy({
        query: candidateQuery as never,
        select: {
          _id: true,
          message: true,
          exceptionType: true,
          fingerprint: true,
          occuranceCount: true,
          firstSeenAt: true,
          primaryEntityId: true,
        },
        sort: {
          occuranceCount: SortOrder.Descending,
        },
        limit: EXCEPTION_SPIKE_CANDIDATE_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

    const candidates: Array<InsightCandidate> = [];

    for (const exception of exceptions) {
      if (!exception.id || !exception.fingerprint) {
        continue;
      }

      /*
       * Two bounded ClickHouse counts (fingerprint bloom + time range —
       * the MonitorTelemetryMonitor.monitorException idiom). Occurrence
       * `time` is client-reported, so both windows use the same clock and
       * skew cancels out within the comparison.
       */
      const recentCount: PositiveNumber =
        await ExceptionInstanceService.countBy({
          query: {
            projectId: context.projectId,
            fingerprint: exception.fingerprint,
            time: new InBetween(recentWindowStart, context.now),
          } as never,
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });

      const priorCount: PositiveNumber = await ExceptionInstanceService.countBy(
        {
          query: {
            projectId: context.projectId,
            fingerprint: exception.fingerprint,
            time: new InBetween(priorWindowStart, recentWindowStart),
          } as never,
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        },
      );

      const decision: ExceptionSpikeDecision =
        ExceptionSpikeDetector.evaluateSpike(
          recentCount.toNumber(),
          priorCount.toNumber(),
        );

      if (!decision.isSpike) {
        continue;
      }

      const serviceName: string | null = await this.resolveServiceName(
        exception.primaryEntityId,
      );

      const label: string = ExceptionSpikeDetector.buildExceptionLabel(
        exception.exceptionType,
        exception.message,
      );

      const firstSeenAtIso: string | undefined = exception.firstSeenAt
        ? exception.firstSeenAt.toISOString()
        : undefined;

      const detailLines: Array<string> = [
        decision.isDormantAwakening
          ? "**Dormant exception woke up**"
          : "**Exception spike detected**",
        "",
        `- Exception: \`${label}\``,
      ];
      if (exception.message) {
        detailLines.push(`- Message: ${exception.message}`);
      }
      if (serviceName) {
        detailLines.push(`- Service: ${serviceName}`);
      }
      detailLines.push(
        `- Occurrences in the last ${EXCEPTION_SPIKE_RECENT_WINDOW_HOURS}h: ${recentCount.toNumber()}`,
        `- Baseline: ${decision.baselineHourlyAverage.toFixed(2)}/hour over the prior ${EXCEPTION_SPIKE_BASELINE_WINDOW_HOURS}h (${priorCount.toNumber()} total)`,
        `- Spike multiplier: ${decision.multiplier.toFixed(1)}x`,
        `- Exception first seen: ${firstSeenAtIso || "unknown"} (lifetime occurrences: ${exception.occuranceCount || 0})`,
      );

      candidates.push({
        insightType: SentinelInsightType.ExceptionSpike,
        fingerprint: ExceptionSpikeDetector.buildFingerprint(
          exception.id.toString(),
        ),
        title: `Exception spike: ${label} at ${decision.multiplier.toFixed(1)}x normal rate${serviceName ? ` in ${serviceName}` : ""}`,
        detailMarkdown: detailLines.join("\n"),
        severity: decision.severity,
        serviceName: serviceName || undefined,
        telemetryServiceId: serviceName ? exception.primaryEntityId : undefined,
        telemetryExceptionId: exception.id,
        evidence: {
          exception: {
            exceptionMessage: exception.message,
            exceptionType: exception.exceptionType,
            recentOccurrenceCount: recentCount.toNumber(),
            baselineHourlyAverage: decision.baselineHourlyAverage,
            spikeMultiplier: decision.multiplier,
            totalOccurrenceCount: exception.occuranceCount,
            firstSeenAt: firstSeenAtIso,
          },
        },
      });
    }

    return candidates;
  }

  /*
   * Best-effort service attribution: primaryEntityId is polymorphic and
   * findOneById returns null for non-Service kinds — the insight then
   * ships without a service name.
   */
  private async resolveServiceName(
    primaryEntityId: ObjectID | undefined,
  ): Promise<string | null> {
    if (!primaryEntityId) {
      return null;
    }
    const service: Service | null = await ServiceService.findOneById({
      id: primaryEntityId,
      select: { name: true },
      props: { isRoot: true },
    });
    return service?.name || null;
  }
}
