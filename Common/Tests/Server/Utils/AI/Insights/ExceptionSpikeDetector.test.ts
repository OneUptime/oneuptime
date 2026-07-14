import { afterEach, describe, expect, test } from "@jest/globals";
import ExceptionSpikeDetector, {
  EXCEPTION_SPIKE_BASELINE_WINDOW_HOURS,
  EXCEPTION_SPIKE_CANDIDATE_LIMIT,
  EXCEPTION_SPIKE_HIGH_SEVERITY_MULTIPLIER,
  EXCEPTION_SPIKE_MIN_MULTIPLIER,
  EXCEPTION_SPIKE_MIN_RECENT_COUNT,
  ExceptionSpikeDecision,
} from "../../../../../Server/Utils/AI/Sentinel/Insights/Detectors/ExceptionSpikeDetector";
import { InsightCandidate } from "../../../../../Server/Utils/AI/Sentinel/Insights/Types";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import ExceptionInstanceService from "../../../../../Server/Services/ExceptionInstanceService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../../../Models/DatabaseModels/Service";
import SentinelInsightSeverity from "../../../../../Types/AI/SentinelInsightSeverity";
import SentinelInsightType from "../../../../../Types/AI/SentinelInsightType";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Invariant under test: the ExceptionSpike detector fires exactly when an
 * ESTABLISHED exception's last-hour count is >= 10 AND >= 5x its own
 * average hourly rate over the prior 24h (baseline floored at 1/hour, so
 * dormant awakening falls out of the same rule), escalating to High at a
 * 10x multiplier — and its two ClickHouse counts are root queries scoped
 * to (projectId, fingerprint, exact time windows). No LLM is ever
 * involved.
 */

const projectId: ObjectID = ObjectID.generate();
const exceptionId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = ObjectID.generate();
const now: Date = new Date("2026-07-14T12:00:00.000Z");
const oneHourAgo: Date = new Date("2026-07-14T11:00:00.000Z");
const twentyFiveHoursAgo: Date = new Date("2026-07-13T11:00:00.000Z");

function fakeCandidate(): TelemetryException {
  return {
    id: exceptionId,
    message: "connection reset by peer",
    exceptionType: "ConnectionError",
    fingerprint: "fp-1",
    occuranceCount: 900,
    firstSeenAt: new Date("2026-06-01T00:00:00.000Z"),
    primaryEntityId: serviceId,
  } as unknown as TelemetryException;
}

describe("ExceptionSpikeDetector.evaluateSpike (pure decision matrix)", () => {
  test("dormant awakening: zero baseline and exactly the recent floor spikes at High", () => {
    const decision: ExceptionSpikeDecision =
      ExceptionSpikeDetector.evaluateSpike(EXCEPTION_SPIKE_MIN_RECENT_COUNT, 0);
    expect(decision.isSpike).toBe(true);
    expect(decision.isDormantAwakening).toBe(true);
    expect(decision.multiplier).toBe(10);
    expect(decision.severity).toBe(SentinelInsightSeverity.High);
    expect(decision.baselineHourlyAverage).toBe(0);
  });

  test("one below the recent floor never spikes, even on a zero baseline", () => {
    const decision: ExceptionSpikeDecision =
      ExceptionSpikeDetector.evaluateSpike(
        EXCEPTION_SPIKE_MIN_RECENT_COUNT - 1,
        0,
      );
    expect(decision.isSpike).toBe(false);
    expect(decision.isDormantAwakening).toBe(false);
  });

  test("exactly the multiplier threshold spikes (recent 10 vs 2/hour baseline)", () => {
    // prior 48 over 24h → 2/hour → multiplier 10/2 = 5 = threshold.
    const decision: ExceptionSpikeDecision =
      ExceptionSpikeDetector.evaluateSpike(10, 48);
    expect(decision.multiplier).toBe(EXCEPTION_SPIKE_MIN_MULTIPLIER);
    expect(decision.isSpike).toBe(true);
    expect(decision.severity).toBe(SentinelInsightSeverity.Medium);
  });

  test("just under the multiplier threshold does not spike", () => {
    // prior 49 over 24h → ~2.04/hour → multiplier ~4.9 < 5.
    const decision: ExceptionSpikeDecision =
      ExceptionSpikeDetector.evaluateSpike(10, 49);
    expect(decision.multiplier).toBeLessThan(EXCEPTION_SPIKE_MIN_MULTIPLIER);
    expect(decision.isSpike).toBe(false);
  });

  test("a busy-but-normal exception does not spike (self-baselining)", () => {
    // 100/hour recent against a 100/hour baseline → multiplier 1.
    const decision: ExceptionSpikeDecision =
      ExceptionSpikeDetector.evaluateSpike(
        100,
        100 * EXCEPTION_SPIKE_BASELINE_WINDOW_HOURS,
      );
    expect(decision.isSpike).toBe(false);
    expect(decision.multiplier).toBe(1);
  });

  test("sub-1/hour baselines are floored at 1 so multipliers stay finite", () => {
    // prior 1 over 24h → floored baseline 1 → multiplier = recent count.
    const decision: ExceptionSpikeDecision =
      ExceptionSpikeDetector.evaluateSpike(20, 1);
    expect(decision.multiplier).toBe(20);
    expect(decision.isSpike).toBe(true);
    expect(decision.isDormantAwakening).toBe(false);
  });

  test("severity boundary: exactly 10x is High, just under stays Medium", () => {
    // prior 48 → 2/hour. recent 20 → 10x. recent 19 → 9.5x.
    const high: ExceptionSpikeDecision = ExceptionSpikeDetector.evaluateSpike(
      20,
      48,
    );
    expect(high.multiplier).toBe(EXCEPTION_SPIKE_HIGH_SEVERITY_MULTIPLIER);
    expect(high.severity).toBe(SentinelInsightSeverity.High);

    const medium: ExceptionSpikeDecision = ExceptionSpikeDetector.evaluateSpike(
      19,
      48,
    );
    expect(medium.severity).toBe(SentinelInsightSeverity.Medium);
  });

  test("zero recent count never spikes", () => {
    const decision: ExceptionSpikeDecision =
      ExceptionSpikeDetector.evaluateSpike(0, 0);
    expect(decision.isSpike).toBe(false);
    expect(decision.multiplier).toBe(0);
  });
});

describe("ExceptionSpikeDetector.buildFingerprint (pure)", () => {
  test("wire-contract fingerprint format", () => {
    expect(ExceptionSpikeDetector.buildFingerprint("abc123")).toBe(
      "exception-spike:abc123",
    );
  });
});

describe("ExceptionSpikeDetector.detect (IO wiring)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("counts recent vs prior windows per candidate with root ClickHouse queries", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        fakeCandidate(),
      ] as unknown as Array<TelemetryException>);
    const countBySpy: jest.SpyInstance = jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(50))
      .mockResolvedValueOnce(new PositiveNumber(24));
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "payments" } as unknown as Service);

    const detector: ExceptionSpikeDetector = new ExceptionSpikeDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    // Candidate query: established + active + not resolved/archived, root.
    expect(findBySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId: projectId,
          isResolved: false,
          isArchived: false,
          lastSeenAt: expect.anything(),
          firstSeenAt: expect.anything(),
        }),
        limit: EXCEPTION_SPIKE_CANDIDATE_LIMIT,
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    // Two counts: recent [now-1h, now] then prior [now-25h, now-1h].
    expect(countBySpy).toHaveBeenCalledTimes(2);
    const recentQuery: Record<string, unknown> = countBySpy.mock.calls[0]![0]!
      .query as unknown as Record<string, unknown>;
    expect(recentQuery["projectId"]).toBe(projectId);
    expect(recentQuery["fingerprint"]).toBe("fp-1");
    const recentWindow: InBetween<Date> = recentQuery[
      "time"
    ] as InBetween<Date>;
    expect(recentWindow).toBeInstanceOf(InBetween);
    expect(recentWindow.startValue).toEqual(oneHourAgo);
    expect(recentWindow.endValue).toEqual(now);

    const priorQuery: Record<string, unknown> = countBySpy.mock.calls[1]![0]!
      .query as unknown as Record<string, unknown>;
    const priorWindow: InBetween<Date> = priorQuery["time"] as InBetween<Date>;
    expect(priorWindow.startValue).toEqual(twentyFiveHoursAgo);
    expect(priorWindow.endValue).toEqual(oneHourAgo);
    expect(countBySpy.mock.calls[0]![0]!.props).toEqual(
      expect.objectContaining({ isRoot: true }),
    );

    // 50 recent vs 1/hour baseline → 50x spike, High.
    expect(candidates).toHaveLength(1);
    const candidate: InsightCandidate = candidates[0]!;
    expect(candidate.insightType).toBe(SentinelInsightType.ExceptionSpike);
    expect(candidate.fingerprint).toBe(
      `exception-spike:${exceptionId.toString()}`,
    );
    expect(candidate.severity).toBe(SentinelInsightSeverity.High);
    expect(candidate.title).toBe(
      "Exception spike: ConnectionError at 50.0x normal rate in payments",
    );
    expect(candidate.evidence.exception).toEqual(
      expect.objectContaining({
        recentOccurrenceCount: 50,
        baselineHourlyAverage: 1,
        spikeMultiplier: 50,
        totalOccurrenceCount: 900,
      }),
    );
    expect(candidate.detailMarkdown).toContain("Spike multiplier: 50.0x");
  });

  test("a candidate whose counts do not spike produces no insight", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        fakeCandidate(),
      ] as unknown as Array<TelemetryException>);
    jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(5))
      .mockResolvedValueOnce(new PositiveNumber(100));
    const findOneByIdSpy: jest.SpyInstance = jest.spyOn(
      ServiceService,
      "findOneById",
    );

    const detector: ExceptionSpikeDetector = new ExceptionSpikeDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toEqual([]);
    expect(findOneByIdSpy).not.toHaveBeenCalled();
  });

  test("candidates without a fingerprint are skipped without ClickHouse queries", async () => {
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([
      {
        id: exceptionId,
        fingerprint: undefined,
      } as unknown as TelemetryException,
    ]);
    const countBySpy: jest.SpyInstance = jest.spyOn(
      ExceptionInstanceService,
      "countBy",
    );

    const detector: ExceptionSpikeDetector = new ExceptionSpikeDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toEqual([]);
    expect(countBySpy).not.toHaveBeenCalled();
  });

  test("detect propagates ClickHouse errors — the scanner isolates detectors", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        fakeCandidate(),
      ] as unknown as Array<TelemetryException>);
    jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockRejectedValue(new Error("clickhouse down"));

    const detector: ExceptionSpikeDetector = new ExceptionSpikeDetector();
    await expect(detector.detect({ projectId, now })).rejects.toThrow(
      "clickhouse down",
    );
  });
});
