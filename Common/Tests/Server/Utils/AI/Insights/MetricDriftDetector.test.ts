import { afterEach, describe, expect, test } from "@jest/globals";
import MetricDriftDetector, {
  METRIC_DRIFT_MAX_INSIGHTS,
  METRIC_DRIFT_MIN_SAMPLES_PER_WINDOW,
  METRIC_DRIFT_ROWS_PER_WINDOW,
  MetricDriftFinding,
} from "../../../../../Server/Utils/AI/Sentinel/Insights/Detectors/MetricDriftDetector";
import { InsightCandidate } from "../../../../../Server/Utils/AI/Sentinel/Insights/Types";
import MetricBaselineService, {
  MetricDriftWindowRow,
} from "../../../../../Server/Services/MetricBaselineService";
import SentinelInsightSeverity from "../../../../../Types/AI/SentinelInsightSeverity";
import SentinelInsightType from "../../../../../Types/AI/SentinelInsightType";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Invariant under test: the MetricDrift detector's join-in-JS decision
 * pairs (metric name, entity) cells across the recent/prior week windows
 * and fires exactly when BOTH windows have >= 100 samples AND the relative
 * mean change is >= 50% (zero prior means excluded — undefined change),
 * returning at most the top 5 movers, always at severity Low, and never
 * anything but a "look here" signal. No LLM is ever involved.
 */

const projectId: ObjectID = ObjectID.generate();
const now: Date = new Date("2026-07-14T12:00:00.000Z");

function row(input: {
  name: string;
  entityId?: string;
  mean: number;
  sampleCount?: number;
  window: "recent" | "prior";
}): MetricDriftWindowRow {
  return {
    name: input.name,
    primaryEntityId: input.entityId ?? "svc-1",
    mean: input.mean,
    sampleCount: input.sampleCount ?? 1000,
    window: input.window,
  };
}

describe("MetricDriftDetector.evaluateDrift (pure decision matrix)", () => {
  test("exactly +50% relative change qualifies; just under does not", () => {
    const qualifying: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift([
        row({ name: "cpu", mean: 15, window: "recent" }),
        row({ name: "cpu", mean: 10, window: "prior" }),
      ]);
    expect(qualifying).toHaveLength(1);
    expect(qualifying[0]!.relativeChange).toBe(0.5);

    const notQualifying: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift([
        row({ name: "cpu", mean: 14.99, window: "recent" }),
        row({ name: "cpu", mean: 10, window: "prior" }),
      ]);
    expect(notQualifying).toEqual([]);
  });

  test("negative drift qualifies symmetrically (-50%)", () => {
    const findings: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift([
        row({ name: "throughput", mean: 5, window: "recent" }),
        row({ name: "throughput", mean: 10, window: "prior" }),
      ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.relativeChange).toBe(-0.5);
  });

  test("negative prior means compare on absolute value", () => {
    // prior -10 → recent -20 is a -100% change relative to |prior|.
    const findings: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift([
        row({ name: "delta", mean: -20, window: "recent" }),
        row({ name: "delta", mean: -10, window: "prior" }),
      ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.relativeChange).toBe(-1);
  });

  test("sample-count gate applies to BOTH windows at exactly the threshold", () => {
    const recentThin: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift([
        row({
          name: "cpu",
          mean: 20,
          sampleCount: METRIC_DRIFT_MIN_SAMPLES_PER_WINDOW - 1,
          window: "recent",
        }),
        row({ name: "cpu", mean: 10, window: "prior" }),
      ]);
    expect(recentThin).toEqual([]);

    const priorThin: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift([
        row({ name: "cpu", mean: 20, window: "recent" }),
        row({
          name: "cpu",
          mean: 10,
          sampleCount: METRIC_DRIFT_MIN_SAMPLES_PER_WINDOW - 1,
          window: "prior",
        }),
      ]);
    expect(priorThin).toEqual([]);

    const bothAtThreshold: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift([
        row({
          name: "cpu",
          mean: 20,
          sampleCount: METRIC_DRIFT_MIN_SAMPLES_PER_WINDOW,
          window: "recent",
        }),
        row({
          name: "cpu",
          mean: 10,
          sampleCount: METRIC_DRIFT_MIN_SAMPLES_PER_WINDOW,
          window: "prior",
        }),
      ]);
    expect(bothAtThreshold).toHaveLength(1);
  });

  test("zero prior mean is skipped — relative change is undefined there", () => {
    const findings: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift([
        row({ name: "new-metric", mean: 100, window: "recent" }),
        row({ name: "new-metric", mean: 0, window: "prior" }),
      ]);
    expect(findings).toEqual([]);
  });

  test("cells present in only one window are skipped", () => {
    const findings: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift([
        row({ name: "only-recent", mean: 100, window: "recent" }),
        row({ name: "only-prior", mean: 100, window: "prior" }),
      ]);
    expect(findings).toEqual([]);
  });

  test("same metric name on different entities joins per-entity, not across", () => {
    const findings: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift([
        row({ name: "cpu", entityId: "svc-a", mean: 20, window: "recent" }),
        row({ name: "cpu", entityId: "svc-b", mean: 10, window: "prior" }),
      ]);
    expect(findings).toEqual([]);
  });

  test("caps at the top movers ranked by |relative change|", () => {
    const rows: Array<MetricDriftWindowRow> = [];
    for (let i: number = 0; i < METRIC_DRIFT_MAX_INSIGHTS + 3; i++) {
      // Metric i drifts by (100 + i*10)% — bigger i, bigger drift.
      rows.push(
        row({
          name: `metric-${i}`,
          mean: 10 * (2 + i * 0.1),
          window: "recent",
        }),
      );
      rows.push(row({ name: `metric-${i}`, mean: 10, window: "prior" }));
    }

    const findings: Array<MetricDriftFinding> =
      MetricDriftDetector.evaluateDrift(rows);

    expect(findings).toHaveLength(METRIC_DRIFT_MAX_INSIGHTS);
    // Largest mover first.
    expect(findings[0]!.metricName).toBe(
      `metric-${METRIC_DRIFT_MAX_INSIGHTS + 2}`,
    );
    const changes: Array<number> = findings.map((f: MetricDriftFinding) => {
      return Math.abs(f.relativeChange);
    });
    const sorted: Array<number> = [...changes].sort((a: number, b: number) => {
      return b - a;
    });
    expect(changes).toEqual(sorted);
  });
});

describe("MetricDriftDetector.formatChangePercent (pure)", () => {
  test("signs and rounds the percent label", () => {
    expect(MetricDriftDetector.formatChangePercent(0.62)).toBe("+62%");
    expect(MetricDriftDetector.formatChangePercent(-0.714)).toBe("-71%");
    expect(MetricDriftDetector.formatChangePercent(0)).toBe("+0%");
  });
});

describe("MetricDriftDetector.buildFingerprint (pure)", () => {
  test("wire-contract fingerprint format", () => {
    expect(MetricDriftDetector.buildFingerprint("cpu.usage", "svc-1")).toBe(
      "metric-drift:cpu.usage:svc-1",
    );
  });
});

describe("MetricDriftDetector.detect (IO wiring)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("fetches both windows once and maps findings to Low-severity candidates", async () => {
    const driftSpy: jest.SpyInstance = jest
      .spyOn(MetricBaselineService, "getWeekOverWeekDrift")
      .mockResolvedValue([
        row({ name: "http.server.duration", mean: 16.2, window: "recent" }),
        row({ name: "http.server.duration", mean: 10, window: "prior" }),
      ]);

    const detector: MetricDriftDetector = new MetricDriftDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(driftSpy).toHaveBeenCalledWith({
      projectId: projectId,
      limitPerWindow: METRIC_DRIFT_ROWS_PER_WINDOW,
    });

    expect(candidates).toHaveLength(1);
    const candidate: InsightCandidate = candidates[0]!;
    expect(candidate.insightType).toBe(SentinelInsightType.MetricDrift);
    expect(candidate.fingerprint).toBe(
      "metric-drift:http.server.duration:svc-1",
    );
    expect(candidate.title).toBe(
      "Metric drift: http.server.duration +62% week-over-week",
    );
    expect(candidate.severity).toBe(SentinelInsightSeverity.Low);
    expect(candidate.metricName).toBe("http.server.duration");
    expect(candidate.evidence.metricDrift).toEqual(
      expect.objectContaining({
        metricName: "http.server.duration",
        primaryEntityId: "svc-1",
        recentWeekMean: 16.2,
        priorWeekMean: 10,
        recentSampleCount: 1000,
        priorSampleCount: 1000,
      }),
    );
    expect(candidate.evidence.metricDrift!.relativeChangePercent).toBeCloseTo(
      62,
      6,
    );
    expect(candidate.detailMarkdown).toContain("Relative change: +62%");
  });

  test("no qualifying drift → no candidates", async () => {
    jest
      .spyOn(MetricBaselineService, "getWeekOverWeekDrift")
      .mockResolvedValue([
        row({ name: "stable", mean: 10.1, window: "recent" }),
        row({ name: "stable", mean: 10, window: "prior" }),
      ]);

    const detector: MetricDriftDetector = new MetricDriftDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toEqual([]);
  });

  test("detect propagates baseline-store errors — the scanner isolates detectors", async () => {
    jest
      .spyOn(MetricBaselineService, "getWeekOverWeekDrift")
      .mockRejectedValue(new Error("clickhouse down"));

    const detector: MetricDriftDetector = new MetricDriftDetector();
    await expect(detector.detect({ projectId, now })).rejects.toThrow(
      "clickhouse down",
    );
  });
});
