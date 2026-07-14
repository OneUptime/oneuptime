/** @timezone Asia/Kolkata */

import { afterEach, describe, expect, test } from "@jest/globals";
import ErrorLogSpikeDetector, {
  ERROR_LOG_SEVERITIES,
  ERROR_LOG_SPIKE_HIGH_SEVERITY_MULTIPLIER,
  ERROR_LOG_SPIKE_HISTOGRAM_BUCKET_MINUTES,
  ERROR_LOG_SPIKE_MAX_ATTRIBUTED_SERVICES,
  ERROR_LOG_SPIKE_MIN_MULTIPLIER,
  ERROR_LOG_SPIKE_MIN_RECENT_COUNT,
  ErrorLogSpikeDecision,
} from "../../../../../Server/Utils/AI/Sentinel/Insights/Detectors/ErrorLogSpikeDetector";
import { InsightCandidate } from "../../../../../Server/Utils/AI/Sentinel/Insights/Types";
import LogAggregationService, {
  HistogramBucket,
} from "../../../../../Server/Services/LogAggregationService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import Service from "../../../../../Models/DatabaseModels/Service";
import SentinelInsightSeverity from "../../../../../Types/AI/SentinelInsightSeverity";
import SentinelInsightType from "../../../../../Types/AI/SentinelInsightType";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Invariant under test: the ErrorLogSpike detector fires exactly when the
 * project's Error/Fatal log count in the last hour is >= 100 AND >= 3x its
 * average hourly rate over the prior 24h (baseline floored at 1/hour),
 * escalating to High at 10x — stage 1 is ONE projection-shaped histogram
 * (no service filter), and the scan-costly service attribution runs ONLY
 * after a spike is found, bounded to the spike hour and capped at 3
 * services. No LLM is ever involved.
 *
 * The suite is PINNED to a non-UTC process timezone (docblock pragma above,
 * honored by Tests/Utils/TimezoneEnvironment.js). Asia/Kolkata is chosen for
 * two properties: it is a POSITIVE offset, the direction that silently
 * SUPPRESSES spikes (bad buckets fall out of the recent window and inflate
 * the baseline they are compared against — a detector that reports nothing
 * looks healthy), and it is a :30 offset, which a whole-hours-only fix would
 * still get wrong. Every bucket fixture below therefore uses the shape
 * ClickHouse actually emits — a zone-LESS "YYYY-MM-DD hh:mm:ss" wall clock —
 * and every expectation is an absolute UTC instant, so the suite holds only
 * if bucket times are parsed as UTC rather than as the worker's local time.
 */

const projectId: ObjectID = ObjectID.generate();
const now: Date = new Date("2026-07-14T12:00:00.000Z");
const serviceIdA: string = ObjectID.generate().toString();
const serviceIdB: string = ObjectID.generate().toString();

// The real ClickHouse DateTime rendering: no zone designator, space-separated.
function bucket(time: string, count: number): HistogramBucket {
  return { time, severity: "Error", count };
}

describe("test environment (guards the fixtures below from being vacuous)", () => {
  test("the process runs in a non-UTC zone that skews zone-less parsing", () => {
    expect(process.env["TZ"]).toBe("Asia/Kolkata");

    /*
     * Proof that this suite is adversarial rather than accidentally green: a
     * bare `new Date(clickhouseWallClock)` here does NOT land on the UTC
     * instant of the same wall clock, it lands 5h30m earlier. Every zone-less
     * fixture below is therefore a live trap for local-time parsing.
     */
    const naive: number = new Date("2026-07-14 11:05:00").getTime();
    expect(naive).toBe(Date.UTC(2026, 6, 14, 11, 5, 0) - 5.5 * 60 * 60 * 1000);
  });
});

describe("ErrorLogSpikeDetector.parseBucketTime (pure)", () => {
  test("a zone-less ClickHouse wall clock is read as UTC, not as local time", () => {
    expect(
      ErrorLogSpikeDetector.parseBucketTime("2026-07-14 11:05:00").getTime(),
    ).toBe(Date.UTC(2026, 6, 14, 11, 5, 0));
  });

  test("a zone-less T-separated clock is read as UTC too", () => {
    expect(
      ErrorLogSpikeDetector.parseBucketTime("2026-07-14T11:05:00").getTime(),
    ).toBe(Date.UTC(2026, 6, 14, 11, 5, 0));
  });

  test("fractional seconds (DateTime64) survive the UTC normalization", () => {
    expect(
      ErrorLogSpikeDetector.parseBucketTime(
        "2026-07-14 11:05:00.123",
      ).getTime(),
    ).toBe(Date.UTC(2026, 6, 14, 11, 5, 0) + 123);
  });

  test("an ISO-Z string passes through untouched (no double-Z Invalid Date)", () => {
    const parsed: Date = ErrorLogSpikeDetector.parseBucketTime(
      "2026-07-14T11:05:00.000Z",
    );
    expect(isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getTime()).toBe(Date.UTC(2026, 6, 14, 11, 5, 0));
  });

  test("an explicit +/- offset passes through and keeps its own zone", () => {
    // 11:05 at +05:30 is 05:35 UTC — the offset must be honored, not appended to.
    const positive: Date = ErrorLogSpikeDetector.parseBucketTime(
      "2026-07-14 11:05:00+05:30",
    );
    expect(isNaN(positive.getTime())).toBe(false);
    expect(positive.getTime()).toBe(Date.UTC(2026, 6, 14, 5, 35, 0));

    // 11:05 at -08:00 is 19:05 UTC.
    const negative: Date = ErrorLogSpikeDetector.parseBucketTime(
      "2026-07-14T11:05:00-08:00",
    );
    expect(isNaN(negative.getTime())).toBe(false);
    expect(negative.getTime()).toBe(Date.UTC(2026, 6, 14, 19, 5, 0));
  });

  test("garbage stays an Invalid Date so the caller's isNaN guard still skips it", () => {
    expect(
      isNaN(ErrorLogSpikeDetector.parseBucketTime("not-a-date").getTime()),
    ).toBe(true);
    expect(isNaN(ErrorLogSpikeDetector.parseBucketTime("").getTime())).toBe(
      true,
    );
  });
});

describe("ErrorLogSpikeDetector.splitHistogram (pure)", () => {
  const boundary: Date = new Date("2026-07-14T11:00:00.000Z");

  test("buckets at or after the boundary are recent; earlier ones are prior", () => {
    const split: { recentCount: number; priorCount: number } =
      ErrorLogSpikeDetector.splitHistogram(
        [
          bucket("2026-07-14 10:55:00", 7),
          bucket("2026-07-14 11:00:00", 11),
          bucket("2026-07-14 11:30:00", 13),
          bucket("2026-07-13 12:00:00", 5),
        ],
        boundary,
      );
    expect(split.recentCount).toBe(24);
    expect(split.priorCount).toBe(12);
  });

  test("the zone-less ClickHouse shape splits identically to its ISO-Z equivalent", () => {
    /*
     * Regression lock for the local-time parsing bug: these two fixtures are
     * the same four instants written two ways. Under the bug the zone-less
     * form drifted by the worker's UTC offset (here it lost the entire recent
     * window into the baseline) while the ISO-Z form did not — which is
     * exactly why the original ISO-Z-only fixture could not see the defect.
     */
    const clickhouseSplit: { recentCount: number; priorCount: number } =
      ErrorLogSpikeDetector.splitHistogram(
        [
          bucket("2026-07-14 11:05:00", 500),
          bucket("2026-07-14 11:55:00", 250),
          bucket("2026-07-14 10:59:00", 40),
          bucket("2026-07-14 09:00:00", 200),
        ],
        boundary,
      );
    const isoSplit: { recentCount: number; priorCount: number } =
      ErrorLogSpikeDetector.splitHistogram(
        [
          bucket("2026-07-14T11:05:00.000Z", 500),
          bucket("2026-07-14T11:55:00.000Z", 250),
          bucket("2026-07-14T10:59:00.000Z", 40),
          bucket("2026-07-14T09:00:00.000Z", 200),
        ],
        boundary,
      );

    expect(clickhouseSplit).toEqual({ recentCount: 750, priorCount: 240 });
    expect(clickhouseSplit).toEqual(isoSplit);
  });

  test("a bucket straddling the boundary counts as prior (conservative bias)", () => {
    const split: { recentCount: number; priorCount: number } =
      ErrorLogSpikeDetector.splitHistogram(
        [bucket("2026-07-14 10:59:00", 100)],
        boundary,
      );
    expect(split.recentCount).toBe(0);
    expect(split.priorCount).toBe(100);
  });

  test("unparseable bucket times are skipped, empty input splits to zeros", () => {
    const split: { recentCount: number; priorCount: number } =
      ErrorLogSpikeDetector.splitHistogram(
        [bucket("not-a-date", 999)],
        boundary,
      );
    expect(split).toEqual({ recentCount: 0, priorCount: 0 });
    expect(ErrorLogSpikeDetector.splitHistogram([], boundary)).toEqual({
      recentCount: 0,
      priorCount: 0,
    });
  });
});

describe("ErrorLogSpikeDetector.evaluateSpike (pure decision matrix)", () => {
  test("exactly the recent floor on a zero baseline spikes at High", () => {
    const decision: ErrorLogSpikeDecision = ErrorLogSpikeDetector.evaluateSpike(
      ERROR_LOG_SPIKE_MIN_RECENT_COUNT,
      0,
    );
    expect(decision.isSpike).toBe(true);
    expect(decision.multiplier).toBe(ERROR_LOG_SPIKE_MIN_RECENT_COUNT);
    expect(decision.severity).toBe(SentinelInsightSeverity.High);
  });

  test("one below the recent floor never spikes", () => {
    const decision: ErrorLogSpikeDecision = ErrorLogSpikeDetector.evaluateSpike(
      ERROR_LOG_SPIKE_MIN_RECENT_COUNT - 1,
      0,
    );
    expect(decision.isSpike).toBe(false);
  });

  test("exactly the multiplier threshold spikes (300 vs 100/hour baseline)", () => {
    const decision: ErrorLogSpikeDecision = ErrorLogSpikeDetector.evaluateSpike(
      300,
      2400,
    );
    expect(decision.multiplier).toBe(ERROR_LOG_SPIKE_MIN_MULTIPLIER);
    expect(decision.isSpike).toBe(true);
    expect(decision.severity).toBe(SentinelInsightSeverity.Medium);
  });

  test("just under the multiplier threshold does not spike", () => {
    const decision: ErrorLogSpikeDecision = ErrorLogSpikeDetector.evaluateSpike(
      299,
      2400,
    );
    expect(decision.isSpike).toBe(false);
  });

  test("chronically chatty projects do not spike on their normal volume", () => {
    const decision: ErrorLogSpikeDecision = ErrorLogSpikeDetector.evaluateSpike(
      5000,
      5000 * 24,
    );
    expect(decision.isSpike).toBe(false);
    expect(decision.multiplier).toBe(1);
  });

  test("severity boundary: exactly 10x is High", () => {
    const decision: ErrorLogSpikeDecision = ErrorLogSpikeDetector.evaluateSpike(
      1000,
      2400,
    );
    expect(decision.multiplier).toBe(ERROR_LOG_SPIKE_HIGH_SEVERITY_MULTIPLIER);
    expect(decision.severity).toBe(SentinelInsightSeverity.High);
  });
});

describe("ErrorLogSpikeDetector.buildFingerprint (pure)", () => {
  test("per-service and project-wide wire-contract formats", () => {
    expect(ErrorLogSpikeDetector.buildFingerprint("svc1")).toBe(
      "error-log-spike:svc1",
    );
    expect(ErrorLogSpikeDetector.buildFingerprint(undefined)).toBe(
      "error-log-spike:project",
    );
  });
});

describe("ErrorLogSpikeDetector.detect (IO wiring)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("spike → one insight per attributed service, sharing the project-wide evidence", async () => {
    const getHistogramSpy: jest.SpyInstance = jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([
        bucket("2026-07-14 11:05:00", 500),
        bucket("2026-07-14 09:00:00", 240),
      ]);
    const topListSpy: jest.SpyInstance = jest
      .spyOn(LogAggregationService, "getAnalyticsTopList")
      .mockResolvedValue([
        { value: serviceIdA, count: 300 },
        { value: serviceIdB, count: 100 },
      ]);
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValueOnce({ name: "api" } as unknown as Service)
      .mockResolvedValueOnce(null);

    const detector: ErrorLogSpikeDetector = new ErrorLogSpikeDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    // Stage 1: one projection-shaped project-wide histogram over 25h.
    expect(getHistogramSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: projectId,
        startTime: new Date("2026-07-13T11:00:00.000Z"),
        endTime: now,
        bucketSizeInMinutes: ERROR_LOG_SPIKE_HISTOGRAM_BUCKET_MINUTES,
        severityTexts: ERROR_LOG_SEVERITIES,
      }),
    );
    // No service filter on the projection path.
    expect(
      (getHistogramSpy.mock.calls[0]![0] as unknown as Record<string, unknown>)[
        "serviceIds"
      ],
    ).toBeUndefined();

    // Stage 2: attribution bounded to the spike hour, capped at 3.
    expect(topListSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: projectId,
        startTime: new Date("2026-07-14T11:00:00.000Z"),
        endTime: now,
        groupBy: ["primaryEntityId"],
        aggregation: "count",
        severityTexts: ERROR_LOG_SEVERITIES,
        limit: ERROR_LOG_SPIKE_MAX_ATTRIBUTED_SERVICES,
      }),
    );

    /*
     * 500 recent vs 10/hour baseline → 50x, High, two service insights. The
     * stage-2 window above is bound as a real Date (true UTC hour), so under
     * the local-time parsing bug a non-UTC worker would not merely miss the
     * spike — its stage-1 counts would not even reconcile with the hour it
     * attributes. This assertion holds only when both stages agree on UTC.
     */
    expect(candidates).toHaveLength(2);
    const first: InsightCandidate = candidates[0]!;
    expect(first.insightType).toBe(SentinelInsightType.ErrorLogSpike);
    expect(first.fingerprint).toBe(`error-log-spike:${serviceIdA}`);
    expect(first.title).toBe("Error-log spike: 50.0x normal volume in api");
    expect(first.severity).toBe(SentinelInsightSeverity.High);
    expect(first.serviceName).toBe("api");
    expect(first.telemetryServiceId?.toString()).toBe(serviceIdA);
    expect(first.evidence.logSpike).toEqual(
      expect.objectContaining({
        recentErrorCount: 500,
        baselineHourlyAverage: 10,
        spikeMultiplier: 50,
        windowMinutes: 60,
      }),
    );
    expect(first.evidence.logSpike!.topServices).toEqual([
      { serviceName: "api", count: 300 },
      { serviceName: serviceIdB, count: 100 },
    ]);

    // Unresolvable entity keeps its raw id and no telemetryServiceId.
    const second: InsightCandidate = candidates[1]!;
    expect(second.fingerprint).toBe(`error-log-spike:${serviceIdB}`);
    expect(second.serviceName).toBe(serviceIdB);
    expect(second.telemetryServiceId).toBeUndefined();
  });

  test("no spike → no insights and NO stage-2 attribution query", async () => {
    jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([bucket("2026-07-14 11:05:00", 50)]);
    const topListSpy: jest.SpyInstance = jest.spyOn(
      LogAggregationService,
      "getAnalyticsTopList",
    );

    const detector: ErrorLogSpikeDetector = new ErrorLogSpikeDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toEqual([]);
    expect(topListSpy).not.toHaveBeenCalled();
  });

  test("spike with empty attribution → single project-wide insight", async () => {
    jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([bucket("2026-07-14 11:05:00", 500)]);
    jest
      .spyOn(LogAggregationService, "getAnalyticsTopList")
      .mockResolvedValue([]);

    const detector: ErrorLogSpikeDetector = new ErrorLogSpikeDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.fingerprint).toBe("error-log-spike:project");
    expect(candidates[0]!.title).toContain("across the project");
    expect(candidates[0]!.serviceName).toBeUndefined();
    expect(candidates[0]!.evidence.logSpike!.topServices).toEqual([]);
  });

  test("a zone-carrying histogram still spikes (no double-Z zeroing)", async () => {
    /*
     * Belt-and-braces on the passthrough branch: if a ClickHouse setting ever
     * starts emitting a zone designator, the detector must keep counting those
     * buckets rather than parsing them to Invalid Date and reporting silence.
     */
    jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([
        bucket("2026-07-14T11:05:00.000Z", 500),
        bucket("2026-07-14T09:00:00.000Z", 240),
      ]);
    jest
      .spyOn(LogAggregationService, "getAnalyticsTopList")
      .mockResolvedValue([]);

    const detector: ErrorLogSpikeDetector = new ErrorLogSpikeDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.evidence.logSpike!.recentErrorCount).toBe(500);
    expect(candidates[0]!.evidence.logSpike!.spikeMultiplier).toBe(50);
  });

  test("detect propagates histogram errors — the scanner isolates detectors", async () => {
    jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockRejectedValue(new Error("clickhouse down"));

    const detector: ErrorLogSpikeDetector = new ErrorLogSpikeDetector();
    await expect(detector.detect({ projectId, now })).rejects.toThrow(
      "clickhouse down",
    );
  });
});
