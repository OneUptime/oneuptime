import ObjectID from "../../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../../Types/Date";
import SortOrder from "../../../../../../Types/BaseDatabase/SortOrder";
import InBetween from "../../../../../../Types/BaseDatabase/InBetween";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import AIInsightSeverity from "../../../../../../Types/AI/AIInsightSeverity";
import {
  PerformanceCodeLocation,
  PerformanceFinding,
} from "../../../../../../Types/AI/CodeFixTaskContext";
import Span from "../../../../../../Models/AnalyticsModels/Span";
import Service from "../../../../../../Models/DatabaseModels/Service";
import SpanService from "../../../../../Services/SpanService";
import ServiceService from "../../../../../Services/ServiceService";
import TraceAggregationService, {
  ServiceLatencyProfile,
  ServiceLatencyProfileRow,
  TraceAnalyticsTopItem,
} from "../../../../../Services/TraceAggregationService";
import SpanTreeAnalyzer, {
  AnalyzableSpan,
} from "../../../PerfEvidence/SpanTreeAnalyzer";
import FixPerformanceTaskTrigger from "../../FixPerformanceTaskTrigger";
import logger from "../../../../Logger";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * TraceLatencyRegression — a service whose recent p99 span latency
 * regressed to a multiple of its own 24-hour baseline, with the evidence
 * drilled down to span-tree findings from a representative slow trace.
 *
 * Stage 1 is two per-service latency-profile queries (recent hour vs the
 * prior 24h) via TraceAggregationService.getServiceLatencyProfile, which is
 * served by the Span proj_agg_by_service aggregate projection: this runs
 * unattended for every opted-in project every 15 minutes, so it must read
 * pre-aggregated minute rows, not 25 hours of raw spans. p99 (not p95) on
 * purpose: quantile(0.99) is the only percentile state that projection
 * stores, and quantile states of different levels do not merge. The drill
 * (slowest operation → representative trace → span-tree analysis → code
 * locations) runs ONLY for services that regressed, and the resulting
 * findings are stored on the insight because ClickHouse span retention is
 * short — the stored evidence must outlive the spans (FixPerformance
 * taskContext precedent). Deterministic — no LLM anywhere in this detector.
 */

// The regression window, compared against the prior baseline window.
export const LATENCY_RECENT_WINDOW_HOURS: number = 1;

/*
 * Baseline: the 24 hours before the regression window. Self-baselining
 * per service — a chronically slow service does not alert on being its
 * usual slow self.
 */
export const LATENCY_BASELINE_WINDOW_HOURS: number = 24;

/*
 * Absolute floor: a p99 under one second is not worth a human's attention
 * even if it doubled — sub-second "regressions" are dominated by cache
 * and GC noise.
 */
export const LATENCY_MIN_RECENT_P99_MS: number = 1000;

// p99 multiplier over the service's own baseline that counts as regression.
export const LATENCY_MIN_REGRESSION_MULTIPLIER: number = 2;

// A >= 4x p99 regression is a step change — escalate to High.
export const LATENCY_HIGH_SEVERITY_MULTIPLIER: number = 4;

/*
 * The baseline p99 is only trustworthy with enough prior samples; below
 * this the "baseline" is a handful of requests and the multiplier is
 * noise. Matches the cold-start posture of the metric baselines.
 */
export const LATENCY_MIN_PRIOR_SAMPLE_COUNT: number = 100;

/*
 * Per-service rows fetched per window. The profile query ranks by request
 * volume, so this bounds the scan to the 25 busiest services — the ones a
 * p99 regression actually hurts (and the prior-sample-count gate would
 * reject quiet services anyway).
 */
export const LATENCY_SERVICE_LIMIT: number = 25;

/*
 * Span cap for the representative-trace fetch — mirrors the trace
 * waterfall tools' cap; beyond this the analyzer's evidence quality
 * degrades anyway.
 */
export const LATENCY_MAX_TRACE_SPANS: number = 500;

/*
 * The drill's top-list ranks operations by p99, and for a group of ONE span
 * the p99 IS that span's own duration — so a single freak-slow request would
 * take the top slot outright. Fetch a small candidate set instead of one row
 * and let the sample floor below choose among them. Ten is enough: an
 * operation that cannot beat ten rivals on p99 is not the story.
 */
export const LATENCY_TOP_OPERATION_CANDIDATES: number = 10;

/*
 * Minimum spans an operation must have in the recent window before its p99
 * is treated as evidence — and, just as load-bearing, before its name is
 * allowed into the fingerprint. The fingerprint embeds the operation, so a
 * noisy winner does not merely mislabel one insight: it churns the dedupe
 * key tick after tick, and each new key is a NEW insight row plus a NEW
 * triage LLM run for one and the same ongoing regression. Deliberately far
 * below LATENCY_MIN_PRIOR_SAMPLE_COUNT — this gate only asks "is this
 * operation real traffic", not "is this baseline trustworthy".
 */
export const LATENCY_MIN_OPERATION_SAMPLE_COUNT: number = 20;

export interface LatencyRegressionDecision {
  isRegression: boolean;
  // recent p99 / prior p99 (0 when the prior p99 is 0).
  multiplier: number;
  severity: AIInsightSeverity;
}

// One service's joined recent-vs-prior latency profile.
export interface ServiceLatencyWindows {
  primaryEntityId: string;
  recentP99Ms: number;
  recentSampleCount: number;
  priorP99Ms: number;
  priorSampleCount: number;
}

export default class TraceLatencyRegressionDetector implements InsightDetector {
  public insightType: AIInsightType = AIInsightType.TraceLatencyRegression;

  /*
   * Pure decision: regression ⇔ recent p99 >= LATENCY_MIN_RECENT_P99_MS
   * AND prior window has >= LATENCY_MIN_PRIOR_SAMPLE_COUNT samples AND
   * recent p99 >= LATENCY_MIN_REGRESSION_MULTIPLIER * prior p99 (> 0).
   */
  public static evaluateRegression(input: {
    recentP99Ms: number;
    priorP99Ms: number;
    priorSampleCount: number;
  }): LatencyRegressionDecision {
    const multiplier: number =
      input.priorP99Ms > 0 ? input.recentP99Ms / input.priorP99Ms : 0;

    const isRegression: boolean =
      input.recentP99Ms >= LATENCY_MIN_RECENT_P99_MS &&
      input.priorSampleCount >= LATENCY_MIN_PRIOR_SAMPLE_COUNT &&
      input.priorP99Ms > 0 &&
      multiplier >= LATENCY_MIN_REGRESSION_MULTIPLIER;

    return {
      isRegression,
      multiplier,
      severity:
        multiplier >= LATENCY_HIGH_SEVERITY_MULTIPLIER
          ? AIInsightSeverity.High
          : AIInsightSeverity.Medium,
    };
  }

  /*
   * Pure join of the two per-service profile query results on
   * primaryEntityId. Services missing from the prior window join with a
   * zero baseline (and are then rejected by the sample-count gate).
   */
  public static joinServiceWindows(
    recentRows: Array<ServiceLatencyProfileRow>,
    priorRows: Array<ServiceLatencyProfileRow>,
  ): Array<ServiceLatencyWindows> {
    const priorByEntity: Map<string, ServiceLatencyProfileRow> = new Map();
    for (const row of priorRows) {
      if (row.primaryEntityId) {
        priorByEntity.set(row.primaryEntityId, row);
      }
    }

    const joined: Array<ServiceLatencyWindows> = [];
    for (const row of recentRows) {
      const entityId: string = row.primaryEntityId || "";
      if (!entityId) {
        continue;
      }
      const prior: ServiceLatencyProfileRow | undefined =
        priorByEntity.get(entityId);
      joined.push({
        primaryEntityId: entityId,
        recentP99Ms: row.p99DurationMs,
        recentSampleCount: row.count,
        priorP99Ms: prior?.p99DurationMs || 0,
        priorSampleCount: prior?.count || 0,
      });
    }
    return joined;
  }

  /*
   * Pure decision: the slowest operation whose p99 is backed by real
   * traffic. Candidates below LATENCY_MIN_OPERATION_SAMPLE_COUNT are
   * dropped outright — with n=1 the "p99" is just that one span, so an
   * unfiltered ranking hands the top slot to whatever freak request the
   * window happened to catch.
   *
   * Ranking is re-established here rather than trusting the query's row
   * order: ClickHouse's ORDER BY val DESC is not a total order, and ties
   * broken arbitrarily by the server would move the fingerprint (which
   * embeds the operation name) from tick to tick. Ties fall to volume,
   * then to the name — a total, deterministic order.
   *
   * Undefined when nothing clears the floor. The caller then emits
   * service-level evidence under the stable service-scoped fingerprint,
   * which is strictly better than naming an operation we do not believe.
   */
  public static pickSlowestOperation(
    items: Array<TraceAnalyticsTopItem>,
  ): string | undefined {
    const credible: Array<TraceAnalyticsTopItem> = items.filter(
      (item: TraceAnalyticsTopItem): boolean => {
        return (
          item.value.length > 0 &&
          item.count >= LATENCY_MIN_OPERATION_SAMPLE_COUNT
        );
      },
    );

    credible.sort(
      (a: TraceAnalyticsTopItem, b: TraceAnalyticsTopItem): number => {
        if (b.metricValue !== a.metricValue) {
          return b.metricValue - a.metricValue;
        }
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return a.value.localeCompare(b.value);
      },
    );

    return credible[0]?.value;
  }

  /*
   * Nanoseconds → milliseconds conversion into the analyzer's input shape
   * (the AIInvestigationAPI conversion, kept local because the API file
   * does not export it). Pure — the ns→ms arithmetic is unit-tested.
   */
  public static toAnalyzableSpans(spans: Array<Span>): Array<AnalyzableSpan> {
    return spans.map((span: Span): AnalyzableSpan => {
      const attributes: Record<string, string> = {};

      for (const [key, value] of Object.entries(span.attributes || {})) {
        if (value !== null && value !== undefined) {
          attributes[key] = String(value);
        }
      }

      return {
        spanId: span.spanId?.toString() || "",
        parentSpanId: span.parentSpanId?.toString() || undefined,
        name: span.name || "",
        startMs: Number(span.startTimeUnixNano) / 1_000_000,
        endMs: Number(span.endTimeUnixNano) / 1_000_000,
        durationMs: Number(span.durationUnixNano) / 1_000_000,
        attributes,
      };
    });
  }

  /*
   * Stable dedupe key: service + NORMALIZED operation name (ids/digits
   * collapsed), so the same regressing endpoint refreshes one insight no
   * matter which concrete URL the representative trace hit.
   */
  public static buildFingerprint(
    serviceEntityId: string,
    operationName: string | undefined,
  ): string {
    return `latency:${serviceEntityId}:${SpanTreeAnalyzer.normalizeSpanName(
      operationName || "",
    )}`;
  }

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    const recentWindowStart: Date = OneUptimeDate.addRemoveHours(
      context.now,
      -1 * LATENCY_RECENT_WINDOW_HOURS,
    );
    const priorWindowStart: Date = OneUptimeDate.addRemoveHours(
      recentWindowStart,
      -1 * LATENCY_BASELINE_WINDOW_HOURS,
    );

    // Stage 1 — per-service latency profile: recent hour vs prior 24h.
    const recentProfile: ServiceLatencyProfile =
      await TraceAggregationService.getServiceLatencyProfile({
        projectId: context.projectId,
        startTime: recentWindowStart,
        endTime: context.now,
        limit: LATENCY_SERVICE_LIMIT,
      });

    const priorProfile: ServiceLatencyProfile =
      await TraceAggregationService.getServiceLatencyProfile({
        projectId: context.projectId,
        startTime: priorWindowStart,
        endTime: recentWindowStart,
        limit: LATENCY_SERVICE_LIMIT,
      });

    /*
     * A partial window is not "less data", it is WRONG data: a p99 and a
     * span count computed over whatever fraction ClickHouse managed before
     * the execution cap fired. Comparing a partial window against a
     * complete one manufactures regressions that never happened (and hides
     * ones that did). Skip this project's latency detection for the tick
     * and let the next one, 15 minutes out, decide — a delayed insight is
     * recoverable, a fabricated one (which may open a fix PR) is not.
     */
    if (recentProfile.isPartial || priorProfile.isPartial) {
      logger.info(
        `TraceLatencyRegressionDetector: skipping project ${context.projectId.toString()} for this scan — the service latency profile query returned a possibly partial result (execution cap reached).`,
      );
      return [];
    }

    const joined: Array<ServiceLatencyWindows> =
      TraceLatencyRegressionDetector.joinServiceWindows(
        recentProfile.rows,
        priorProfile.rows,
      );

    const candidates: Array<InsightCandidate> = [];

    for (const windows of joined) {
      const decision: LatencyRegressionDecision =
        TraceLatencyRegressionDetector.evaluateRegression({
          recentP99Ms: windows.recentP99Ms,
          priorP99Ms: windows.priorP99Ms,
          priorSampleCount: windows.priorSampleCount,
        });

      if (!decision.isRegression) {
        continue;
      }

      candidates.push(
        await this.drillRegression({
          context,
          windows,
          decision,
          recentWindowStart,
        }),
      );
    }

    return candidates;
  }

  /*
   * Drill one regressed service down to a concrete, code-shaped story:
   * slowest CREDIBLE operation (p99 in the spike hour, sample floor
   * applied) → the single slowest span of that operation → its whole trace
   * → deterministic span-tree findings + code.* locations. When no
   * operation clears the floor the insight stays at service level rather
   * than pinning the blame — and the drill queries are skipped entirely.
   */
  private async drillRegression(input: {
    context: InsightScanContext;
    windows: ServiceLatencyWindows;
    decision: LatencyRegressionDecision;
    recentWindowStart: Date;
  }): Promise<InsightCandidate> {
    const serviceEntityId: ObjectID = new ObjectID(
      input.windows.primaryEntityId,
    );

    /*
     * Candidate operations for the service — the top-list ranks by the
     * metric (p99) and returns each operation's span count alongside it,
     * which is exactly what the sample floor needs. Bounded: one 1-hour
     * query pinned to the one service that regressed.
     */
    const topOperations: Array<TraceAnalyticsTopItem> =
      await TraceAggregationService.getAnalyticsTopList({
        projectId: input.context.projectId,
        startTime: input.recentWindowStart,
        endTime: input.context.now,
        bucketSizeInMinutes: LATENCY_RECENT_WINDOW_HOURS * 60,
        chartType: "toplist",
        metric: "p99Duration",
        groupBy: ["name"],
        serviceIds: [serviceEntityId],
        limit: LATENCY_TOP_OPERATION_CANDIDATES,
      });

    const operationName: string | undefined =
      TraceLatencyRegressionDetector.pickSlowestOperation(topOperations);

    /*
     * Representative trace: the slowest span of the slowest operation in
     * the spike window, then that trace's full span set. Explicit
     * projectId in every root query — the scanner never relies on ACL.
     */
    let sampleTraceId: string | undefined = undefined;
    let findings: Array<PerformanceFinding> = [];
    let codeLocations: Array<PerformanceCodeLocation> = [];

    if (operationName) {
      const slowestSpans: Array<Span> = await SpanService.findBy({
        query: {
          projectId: input.context.projectId,
          primaryEntityId: serviceEntityId,
          name: operationName,
          startTime: new InBetween(input.recentWindowStart, input.context.now),
        } as never,
        select: {
          traceId: true,
        } as never,
        sort: {
          durationUnixNano: SortOrder.Descending,
        } as never,
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });

      sampleTraceId = slowestSpans[0]?.traceId?.toString() || undefined;
    }

    if (sampleTraceId) {
      const traceSpans: Array<Span> = await SpanService.findBy({
        query: {
          projectId: input.context.projectId,
          traceId: sampleTraceId,
        } as never,
        select: {
          spanId: true,
          parentSpanId: true,
          name: true,
          startTimeUnixNano: true,
          endTimeUnixNano: true,
          durationUnixNano: true,
          attributes: true,
        } as never,
        sort: {
          startTimeUnixNano: SortOrder.Ascending,
        } as never,
        limit: LATENCY_MAX_TRACE_SPANS,
        skip: 0,
        props: { isRoot: true },
      });

      const analyzableSpans: Array<AnalyzableSpan> =
        TraceLatencyRegressionDetector.toAnalyzableSpans(traceSpans);

      findings = SpanTreeAnalyzer.analyzeTrace(analyzableSpans);
      codeLocations = FixPerformanceTaskTrigger.collectCodeLocations(
        analyzableSpans,
        findings,
      );
    }

    const service: Service | null = await ServiceService.findOneById({
      id: serviceEntityId,
      select: { name: true },
      props: { isRoot: true },
    });
    const serviceName: string | null = service?.name || null;

    const detailLines: Array<string> = [
      "**Trace latency regression detected**",
      "",
      `- Service: ${serviceName || input.windows.primaryEntityId}`,
      `- Recent p99 (last ${LATENCY_RECENT_WINDOW_HOURS}h): ${input.windows.recentP99Ms.toFixed(0)} ms over ${input.windows.recentSampleCount} spans`,
      `- Baseline p99 (prior ${LATENCY_BASELINE_WINDOW_HOURS}h): ${input.windows.priorP99Ms.toFixed(0)} ms over ${input.windows.priorSampleCount} spans`,
      `- Regression multiplier: ${input.decision.multiplier.toFixed(1)}x`,
    ];
    if (operationName) {
      detailLines.push(`- Slowest operation: \`${operationName}\``);
    }
    if (sampleTraceId) {
      detailLines.push(`- Representative trace: \`${sampleTraceId}\``);
    }
    if (findings.length > 0) {
      detailLines.push(
        "",
        "## Span-tree findings (representative trace)",
        "",
        SpanTreeAnalyzer.renderFindingsMarkdown(findings),
      );
    }

    return {
      insightType: AIInsightType.TraceLatencyRegression,
      fingerprint: TraceLatencyRegressionDetector.buildFingerprint(
        input.windows.primaryEntityId,
        operationName,
      ),
      title: `Latency regression: p99 ${input.decision.multiplier.toFixed(1)}x${operationName ? ` on ${operationName}` : ""}${serviceName ? ` in ${serviceName}` : ""}`,
      detailMarkdown: detailLines.join("\n"),
      severity: input.decision.severity,
      serviceName: serviceName || undefined,
      telemetryServiceId: serviceName ? serviceEntityId : undefined,
      traceId: sampleTraceId,
      evidence: {
        latency: {
          recentP99Ms: input.windows.recentP99Ms,
          baselineP99Ms: input.windows.priorP99Ms,
          regressionMultiplier: input.decision.multiplier,
          operationName,
          sampleTraceId,
          performanceFindings: findings.length > 0 ? findings : undefined,
          codeLocations: codeLocations.length > 0 ? codeLocations : undefined,
        },
      },
    };
  }
}
