import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import AIInsightSeverity from "../../../../../../Types/AI/AIInsightSeverity";
import MetricBaselineService, {
  MetricDriftWindowRow,
  MetricBaselineService as MetricBaselineServiceClass,
} from "../../../../../Services/MetricBaselineService";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../Types";

/*
 * MetricDrift — a metric's mean over the last 7 days drifted substantially
 * from its mean over the prior 7 days, per (metric name, entity) cell. The
 * data comes from two GROUP BY finalization queries over the
 * MetricBaselineHourly materialized view (already maintained for anomaly
 * monitors — this detector adds no write load); the recent/prior join and
 * the drift decision are pure functions here so they are unit-testable
 * without any ClickHouse.
 *
 * Drift severity is always Low and NEVER routes to an auto-fix: direction
 * and goodness are unknowable without semantics (a 60% drop in latency is
 * a win; a 60% drop in throughput is an outage). It is a "look here"
 * signal, nothing more. Deterministic — no LLM anywhere in this detector.
 */

/*
 * Both windows need this many raw samples per cell before their means are
 * comparable — below it a single noisy hour can swing the mean by more
 * than the drift threshold.
 */
export const METRIC_DRIFT_MIN_SAMPLES_PER_WINDOW: number = 100;

/*
 * Relative mean change (|recent-prior| / |prior|) that counts as drift.
 * 50% is far outside normal week-to-week variation for the sample-count-
 * gated cells, so the inbox only sees step changes.
 */
export const METRIC_DRIFT_MIN_RELATIVE_CHANGE: number = 0.5;

/*
 * At most this many drift insights per scan tick, ranked by |relative
 * change|. A platform-wide shift moves hundreds of metrics at once — the
 * top movers tell the story, the rest are echoes.
 */
export const METRIC_DRIFT_MAX_INSIGHTS: number = 5;

/*
 * Rows fetched per drift window (recent/prior), ranked by sample count.
 * Bounded because the detector joins the windows in JS. Mirrors
 * MetricBaselineService.DRIFT_MAX_ROWS_PER_WINDOW — the service clamps to
 * that cap regardless.
 */
export const METRIC_DRIFT_ROWS_PER_WINDOW: number =
  MetricBaselineServiceClass.DRIFT_MAX_ROWS_PER_WINDOW;

// One joined-and-qualified drift finding, ready to become an insight.
export interface MetricDriftFinding {
  metricName: string;
  primaryEntityId: string;
  recentMean: number;
  priorMean: number;
  // Signed: (recent - prior) / |prior|. Positive = the mean went up.
  relativeChange: number;
  recentSampleCount: number;
  priorSampleCount: number;
}

export default class MetricDriftDetector implements InsightDetector {
  public insightType: AIInsightType = AIInsightType.MetricDrift;

  /*
   * Pure join + decision: pair each (name, entity) cell's recent and
   * prior rows, gate on sample counts, and keep cells whose relative mean
   * change clears the threshold. Cells with a zero prior mean are skipped
   * — relative change against a zero baseline is undefined, and
   * "metric appeared" is NewException/ErrorLogSpike territory, not drift.
   * Returns the top METRIC_DRIFT_MAX_INSIGHTS movers by |relative change|.
   */
  public static evaluateDrift(
    rows: Array<MetricDriftWindowRow>,
  ): Array<MetricDriftFinding> {
    const recentByCell: Map<string, MetricDriftWindowRow> = new Map();
    const priorByCell: Map<string, MetricDriftWindowRow> = new Map();

    for (const row of rows) {
      // \u0000 cannot appear in either component — collision-free key.
      const cellKey: string = `${row.name}\u0000${row.primaryEntityId}`;
      if (row.window === "recent") {
        recentByCell.set(cellKey, row);
      } else {
        priorByCell.set(cellKey, row);
      }
    }

    const findings: Array<MetricDriftFinding> = [];

    for (const [cellKey, recent] of recentByCell) {
      const prior: MetricDriftWindowRow | undefined = priorByCell.get(cellKey);
      if (!prior) {
        continue;
      }
      if (
        recent.sampleCount < METRIC_DRIFT_MIN_SAMPLES_PER_WINDOW ||
        prior.sampleCount < METRIC_DRIFT_MIN_SAMPLES_PER_WINDOW
      ) {
        continue;
      }
      if (prior.mean === 0) {
        continue;
      }

      const relativeChange: number =
        (recent.mean - prior.mean) / Math.abs(prior.mean);

      if (Math.abs(relativeChange) < METRIC_DRIFT_MIN_RELATIVE_CHANGE) {
        continue;
      }

      findings.push({
        metricName: recent.name,
        primaryEntityId: recent.primaryEntityId,
        recentMean: recent.mean,
        priorMean: prior.mean,
        relativeChange,
        recentSampleCount: recent.sampleCount,
        priorSampleCount: prior.sampleCount,
      });
    }

    findings.sort((a: MetricDriftFinding, b: MetricDriftFinding): number => {
      if (Math.abs(b.relativeChange) !== Math.abs(a.relativeChange)) {
        return Math.abs(b.relativeChange) - Math.abs(a.relativeChange);
      }
      // Deterministic tie-break so scan ticks are reproducible.
      const aKey: string = `${a.metricName}\u0000${a.primaryEntityId}`;
      const bKey: string = `${b.metricName}\u0000${b.primaryEntityId}`;
      return aKey.localeCompare(bKey);
    });

    return findings.slice(0, METRIC_DRIFT_MAX_INSIGHTS);
  }

  // Signed percent label, e.g. "+62%" / "-71%".
  public static formatChangePercent(relativeChange: number): string {
    const percent: number = Math.round(relativeChange * 100);
    return `${percent >= 0 ? "+" : ""}${percent}%`;
  }

  // Stable dedupe key per (metric name, entity) cell.
  public static buildFingerprint(
    metricName: string,
    primaryEntityId: string,
  ): string {
    return `metric-drift:${metricName}:${primaryEntityId}`;
  }

  public async detect(
    context: InsightScanContext,
  ): Promise<Array<InsightCandidate>> {
    const rows: Array<MetricDriftWindowRow> =
      await MetricBaselineService.getWeekOverWeekDrift({
        projectId: context.projectId,
        limitPerWindow: METRIC_DRIFT_ROWS_PER_WINDOW,
      });

    const findings: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift(rows);

    return findings.map((finding: MetricDriftFinding): InsightCandidate => {
      const changeLabel: string = MetricDriftDetector.formatChangePercent(
        finding.relativeChange,
      );

      const detailLines: Array<string> = [
        "**Metric drift detected (week-over-week)**",
        "",
        `- Metric: \`${finding.metricName}\``,
      ];
      if (finding.primaryEntityId) {
        detailLines.push(`- Entity: \`${finding.primaryEntityId}\``);
      }
      detailLines.push(
        `- Recent 7-day mean: ${finding.recentMean.toFixed(4)} (${finding.recentSampleCount} samples)`,
        `- Prior 7-day mean: ${finding.priorMean.toFixed(4)} (${finding.priorSampleCount} samples)`,
        `- Relative change: ${changeLabel}`,
        "",
        "Direction and goodness are metric-specific — this is a heads-up, not an alarm.",
      );

      return {
        insightType: AIInsightType.MetricDrift,
        fingerprint: MetricDriftDetector.buildFingerprint(
          finding.metricName,
          finding.primaryEntityId,
        ),
        title: `Metric drift: ${finding.metricName} ${changeLabel} week-over-week`,
        detailMarkdown: detailLines.join("\n"),
        /*
         * Always Low: without metric semantics the detector cannot know
         * whether the drift is good or bad — it must never outrank a
         * concrete exception or latency finding.
         */
        severity: AIInsightSeverity.Low,
        metricName: finding.metricName,
        evidence: {
          metricDrift: {
            metricName: finding.metricName,
            primaryEntityId: finding.primaryEntityId || undefined,
            recentWeekMean: finding.recentMean,
            priorWeekMean: finding.priorMean,
            relativeChangePercent: finding.relativeChange * 100,
            recentSampleCount: finding.recentSampleCount,
            priorSampleCount: finding.priorSampleCount,
          },
        },
      };
    });
  }
}
