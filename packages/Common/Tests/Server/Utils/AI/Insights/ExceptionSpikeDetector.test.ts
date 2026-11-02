import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import ExceptionSpikeDetector, {
  EXCEPTION_SPIKE_BASELINE_WINDOW_HOURS,
  EXCEPTION_SPIKE_CANDIDATE_LIMIT,
  EXCEPTION_SPIKE_HIGH_SEVERITY_MULTIPLIER,
  EXCEPTION_SPIKE_MIN_MULTIPLIER,
  EXCEPTION_SPIKE_MIN_RECENT_COUNT,
  ExceptionSpikeDecision,
} from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/ExceptionSpikeDetector";
import { InsightCandidate } from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import ExceptionInstanceService from "../../../../../Server/Services/ExceptionInstanceService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../../../Models/DatabaseModels/Service";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../../Types/BaseDatabase/Includes";
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
    expect(decision.severity).toBe(AIInsightSeverity.High);
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
    expect(decision.severity).toBe(AIInsightSeverity.Medium);
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
    expect(high.severity).toBe(AIInsightSeverity.High);

    const medium: ExceptionSpikeDecision = ExceptionSpikeDetector.evaluateSpike(
      19,
      48,
    );
    expect(medium.severity).toBe(AIInsightSeverity.Medium);
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
    expect(candidate.insightType).toBe(AIInsightType.ExceptionSpike);
    expect(candidate.fingerprint).toBe(
      `exception-spike:${exceptionId.toString()}`,
    );
    expect(candidate.severity).toBe(AIInsightSeverity.High);
    /*
     * Type AND message: the type alone collides across findings (a service
     * whose instrumentation types every failure by HTTP status renders a wall
     * of identical rows).
     */
    expect(candidate.title).toBe(
      "Exception spike: ConnectionError: connection reset by peer at 50.0x normal rate in payments",
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

  /*
   * The occurrences of the exceptions merged into one count on it
   * (TelemetryExceptionMerge): a candidate's rate is its group's - its own
   * fingerprint and those merged into it (TelemetryExceptionService
   * .getGroupFingerprints) - read once for every candidate.
   */
  describe("a candidate others were merged into", () => {
    const otherId: ObjectID = ObjectID.generate();
    let memberReads: Array<Array<unknown>>;

    beforeEach(() => {
      memberReads = [];
      TelemetryExceptionService.clearGroupFingerprints();

      jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
        manager: {
          query: async (sql: string, params: Array<unknown>) => {
            if (!sql.includes("ROW_NUMBER()")) {
              return [];
            }

            memberReads.push(params);

            return [
              { survivorId: exceptionId.toString(), fingerprint: "fp-merged" },
            ];
          },
        },
      } as never);
    });

    afterEach(() => {
      TelemetryExceptionService.clearGroupFingerprints();
    });

    test("spikes on the occurrences of the exceptions merged into it too", async () => {
      jest
        .spyOn(TelemetryExceptionService, "findBy")
        .mockResolvedValue([
          fakeCandidate(),
        ] as unknown as Array<TelemetryException>);
      /*
       * Its own fingerprint is quiet; the duplicate merged into it took 45
       * of the last hour's 50 occurrences.
       */
      const countBySpy: jest.SpyInstance = jest
        .spyOn(ExceptionInstanceService, "countBy")
        .mockImplementation((async (data: {
          query: Record<string, unknown>;
        }) => {
          const window: InBetween<Date> = data.query["time"] as InBetween<Date>;
          const isRecent: boolean = window.endValue.getTime() === now.getTime();
          const isGroup: boolean =
            data.query["fingerprint"] instanceof Includes;

          return new PositiveNumber(
            isRecent ? (isGroup ? 50 : 5) : isGroup ? 24 : 20,
          );
        }) as never);
      jest
        .spyOn(ServiceService, "findOneById")
        .mockResolvedValue({ name: "payments" } as unknown as Service);

      const candidates: Array<InsightCandidate> =
        await new ExceptionSpikeDetector().detect({ projectId, now });

      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.evidence.exception).toEqual(
        expect.objectContaining({
          recentOccurrenceCount: 50,
          baselineHourlyAverage: 1,
          spikeMultiplier: 50,
        }),
      );

      for (const call of countBySpy.mock.calls) {
        const fingerprint: unknown = (
          call[0] as { query: Record<string, unknown> }
        ).query["fingerprint"];
        expect(fingerprint).toBeInstanceOf(Includes);
        expect((fingerprint as Includes).values).toEqual(["fp-1", "fp-merged"]);
      }
    });

    test("what was merged into the candidates is read once for them all, in the project", async () => {
      jest
        .spyOn(TelemetryExceptionService, "findBy")
        .mockResolvedValue([
          fakeCandidate(),
          { ...fakeCandidate(), id: otherId, fingerprint: "fp-other" },
          { id: ObjectID.generate(), fingerprint: undefined },
        ] as unknown as Array<TelemetryException>);
      const countBySpy: jest.SpyInstance = jest
        .spyOn(ExceptionInstanceService, "countBy")
        .mockResolvedValue(new PositiveNumber(1));

      await new ExceptionSpikeDetector().detect({ projectId, now });

      expect(memberReads).toEqual([
        [
          projectId.toString(),
          [exceptionId.toString(), otherId.toString()],
          100,
          10000,
        ],
      ]);

      // Nothing merged into the other: its own fingerprint, as before any merge.
      const fingerprints: Array<unknown> = countBySpy.mock.calls.map(
        (call: Array<unknown>): unknown => {
          return (call[0] as { query: Record<string, unknown> }).query[
            "fingerprint"
          ];
        },
      );
      expect(fingerprints).toHaveLength(4);
      expect(fingerprints.slice(2)).toEqual(["fp-other", "fp-other"]);
    });
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
