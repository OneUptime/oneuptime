import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
import Includes from "../../../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../../../Types/ObjectID";
import ExceptionOwnCode, {
  ExceptionOwnCodeReading,
} from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/ExceptionOwnCode";

/*
 * Invariant under test: the ExceptionSpike detector fires exactly when an
 * ESTABLISHED exception's last-hour count is >= 10 AND >= 5x its own
 * average hourly rate over the prior 24h (baseline floored at 1/hour, so
 * dormant awakening falls out of the same rule), escalating to High at a
 * 10x multiplier — and its counts come from ONE root ClickHouse statement a
 * scan, scoped to (projectId, the candidates' fingerprints, exact time
 * windows), that counts what two counts a candidate counted. No LLM is ever
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

/*
 * ClickHouse, in memory: the occurrences a test puts there, counted as the
 * detector's statement counts them (countPerValueInWindows) - per
 * fingerprint, in each window, both ends in - and as the two counts a
 * candidate it used to make counted them (countOfOccurrences): the query's
 * fingerprint, its own or any of its group's.
 */
interface Occurrence {
  projectId: ObjectID;
  fingerprint: string;
  time: Date;
}

let occurrences: Array<Occurrence> = [];

function fingerprintMatches(fingerprint: string, query: unknown): boolean {
  return query instanceof Includes
    ? (query.values as Array<unknown>).includes(fingerprint)
    : query === fingerprint;
}

function isIn(time: Date, startsAt: Date, endsAt: Date): boolean {
  return (
    time.getTime() >= startsAt.getTime() && time.getTime() <= endsAt.getTime()
  );
}

function standInForClickHouse(): jest.SpyInstance {
  return jest
    .spyOn(ExceptionInstanceService, "countPerValueInWindows")
    .mockImplementation((async (data: {
      query: Record<string, unknown>;
      windows: Array<{ startsAt: Date; endsAt: Date }>;
    }): Promise<Map<string, Array<number>>> => {
      const counts: Map<string, Array<number>> = new Map<
        string,
        Array<number>
      >();

      for (const occurrence of occurrences) {
        if (
          occurrence.projectId.toString() !==
            (data.query["projectId"] as ObjectID).toString() ||
          !fingerprintMatches(occurrence.fingerprint, data.query["fingerprint"])
        ) {
          continue;
        }

        const windowCounts: Array<number> = data.windows.map(
          (window: { startsAt: Date; endsAt: Date }): number => {
            return isIn(occurrence.time, window.startsAt, window.endsAt)
              ? 1
              : 0;
          },
        );

        if (
          windowCounts.every((count: number): boolean => {
            return count === 0;
          })
        ) {
          continue;
        }

        const kept: Array<number> = counts.get(occurrence.fingerprint) || [
          ...data.windows.map((): number => {
            return 0;
          }),
        ];

        counts.set(
          occurrence.fingerprint,
          kept.map((count: number, index: number): number => {
            return count + windowCounts[index]!;
          }),
        );
      }

      return counts;
    }) as never);
}

// What one countBy of the old detector counted: the query, both ends in.
function countOfOccurrences(
  fingerprintQuery: string | Includes,
  startsAt: Date,
  endsAt: Date,
): number {
  return occurrences.filter((occurrence: Occurrence): boolean => {
    return (
      occurrence.projectId.toString() === projectId.toString() &&
      fingerprintMatches(occurrence.fingerprint, fingerprintQuery) &&
      isIn(occurrence.time, startsAt, endsAt)
    );
  }).length;
}

function at(date: Date, offsetMs: number): Date {
  return new Date(date.getTime() + offsetMs);
}

function occurring(
  fingerprint: string,
  times: Array<Date>,
  project: ObjectID = projectId,
): Array<Occurrence> {
  return times.map((time: Date): Occurrence => {
    return { projectId: project, fingerprint, time };
  });
}

function many(count: number, time: Date): Array<Date> {
  return Array.from({ length: count }, (): Date => {
    return time;
  });
}

describe("ExceptionSpikeDetector.detect (IO wiring)", () => {
  beforeEach(() => {
    occurrences = [];
    jest
      .spyOn(ExceptionOwnCode, "readMany")
      .mockResolvedValue(new Map<string, ExceptionOwnCodeReading>());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("counts every candidate's recent and prior windows in one root ClickHouse statement", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        fakeCandidate(),
      ] as unknown as Array<TelemetryException>);
    occurrences = [
      ...occurring("fp-1", many(50, at(oneHourAgo, 60 * 1000))),
      ...occurring("fp-1", many(24, at(twentyFiveHoursAgo, 60 * 1000))),
    ];
    const countSpy: jest.SpyInstance = standInForClickHouse();
    const countBySpy: jest.SpyInstance = jest.spyOn(
      ExceptionInstanceService,
      "countBy",
    );
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

    // One statement: recent [now-1h, now] and prior [now-25h, now-1h], by fingerprint.
    expect(countBySpy).not.toHaveBeenCalled();
    expect(countSpy).toHaveBeenCalledTimes(1);
    const statement: {
      query: Record<string, unknown>;
      valueColumnName: string;
      timeColumnName: string;
      windows: Array<{ startsAt: Date; endsAt: Date }>;
      props: Record<string, unknown>;
    } = countSpy.mock.calls[0]![0];
    expect(statement.query["projectId"]).toBe(projectId);
    expect(statement.query["fingerprint"]).toBe("fp-1");
    expect(statement.valueColumnName).toBe("fingerprint");
    expect(statement.timeColumnName).toBe("time");
    expect(statement.windows).toEqual([
      { startsAt: oneHourAgo, endsAt: now },
      { startsAt: twentyFiveHoursAgo, endsAt: oneHourAgo },
    ]);
    expect(statement.props).toEqual(expect.objectContaining({ isRoot: true }));

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

  test("an occurrence on a window's edge counts as the two counts counted it: in both windows at the spike window's start", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        fakeCandidate(),
      ] as unknown as Array<TelemetryException>);
    occurrences = [
      // The edges: now, the spike window's start (in both), the baseline's start.
      ...occurring("fp-1", many(10, now)),
      ...occurring("fp-1", many(10, oneHourAgo)),
      ...occurring("fp-1", many(4, twentyFiveHoursAgo)),
      // Just outside: neither window.
      ...occurring("fp-1", many(7, at(now, 1))),
      ...occurring("fp-1", many(7, at(twentyFiveHoursAgo, -1))),
    ];
    standInForClickHouse();
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "payments" } as unknown as Service);

    const candidates: Array<InsightCandidate> =
      await new ExceptionSpikeDetector().detect({ projectId, now });

    expect(countOfOccurrences("fp-1", oneHourAgo, now)).toBe(20);
    expect(countOfOccurrences("fp-1", twentyFiveHoursAgo, oneHourAgo)).toBe(14);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.evidence.exception).toEqual(
      expect.objectContaining({
        recentOccurrenceCount: 20,
        baselineHourlyAverage: 14 / EXCEPTION_SPIKE_BASELINE_WINDOW_HOURS,
      }),
    );
  });

  test("a candidate whose counts do not spike produces no insight", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        fakeCandidate(),
      ] as unknown as Array<TelemetryException>);
    occurrences = [
      ...occurring("fp-1", many(5, at(oneHourAgo, 1000))),
      ...occurring("fp-1", many(100, at(twentyFiveHoursAgo, 1000))),
    ];
    standInForClickHouse();
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
    const countSpy: jest.SpyInstance = standInForClickHouse();
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
    expect(countSpy).not.toHaveBeenCalled();
    expect(countBySpy).not.toHaveBeenCalled();
  });

  test("no candidate: no ClickHouse statement at all", async () => {
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([]);
    const countSpy: jest.SpyInstance = standInForClickHouse();

    expect(
      await new ExceptionSpikeDetector().detect({ projectId, now }),
    ).toEqual([]);
    expect(countSpy).not.toHaveBeenCalled();
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
      occurrences = [
        ...occurring("fp-1", many(5, at(oneHourAgo, 1000))),
        ...occurring("fp-merged", many(45, at(oneHourAgo, 2000))),
        ...occurring("fp-1", many(20, at(twentyFiveHoursAgo, 1000))),
        ...occurring("fp-merged", many(4, at(twentyFiveHoursAgo, 2000))),
      ];
      const countSpy: jest.SpyInstance = standInForClickHouse();
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

      expect(countSpy).toHaveBeenCalledTimes(1);
      const fingerprint: unknown = (
        countSpy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query["fingerprint"];
      expect(fingerprint).toBeInstanceOf(Includes);
      expect((fingerprint as Includes).values).toEqual(["fp-1", "fp-merged"]);
    });

    test("what was merged into the candidates is read once for them all, in the project, and all are counted in one statement", async () => {
      jest
        .spyOn(TelemetryExceptionService, "findBy")
        .mockResolvedValue([
          fakeCandidate(),
          { ...fakeCandidate(), id: otherId, fingerprint: "fp-other" },
          { id: ObjectID.generate(), fingerprint: undefined },
        ] as unknown as Array<TelemetryException>);
      const countSpy: jest.SpyInstance = standInForClickHouse();

      await new ExceptionSpikeDetector().detect({ projectId, now });

      expect(memberReads).toEqual([
        [
          projectId.toString(),
          [exceptionId.toString(), otherId.toString()],
          100,
          10000,
        ],
      ]);

      // Every candidate's group, the other's own fingerprint alone among them.
      expect(countSpy).toHaveBeenCalledTimes(1);
      const fingerprint: unknown = (
        countSpy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query["fingerprint"];
      expect((fingerprint as Includes).values).toEqual([
        "fp-1",
        "fp-merged",
        "fp-other",
      ]);
    });
  });

  /*
   * EQUIVALENCE: what one statement counts and sums per candidate is what
   * the two counts per candidate counted - for every candidate, over
   * occurrences on and around every edge of both windows, of the
   * candidates' own and merged fingerprints, of fingerprints no candidate
   * has and of another project. So the same exceptions spike, at the same
   * rates, as before.
   */
  test("the same spikes, at the same rates, as two counts per candidate found", async () => {
    const otherProjectId: ObjectID = ObjectID.generate();
    const edges: Array<Date> = [
      now,
      at(now, -1),
      at(now, 1),
      oneHourAgo,
      at(oneHourAgo, -1),
      at(oneHourAgo, 1),
      at(oneHourAgo, -30 * 60 * 1000),
      twentyFiveHoursAgo,
      at(twentyFiveHoursAgo, -1),
      at(twentyFiveHoursAgo, 1),
      at(now, -10 * 60 * 1000),
    ];
    let seed: number = 7;
    const random: (below: number) => number = (below: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % below;
    };

    for (let round: number = 0; round < 40; round++) {
      jest.restoreAllMocks();
      TelemetryExceptionService.clearGroupFingerprints();
      jest
        .spyOn(ExceptionOwnCode, "readMany")
        .mockResolvedValue(new Map<string, ExceptionOwnCodeReading>());
      jest
        .spyOn(ServiceService, "findOneById")
        .mockResolvedValue({ name: "payments" } as unknown as Service);

      // Up to five candidates, some with exceptions merged into them.
      const groups: Array<{ id: ObjectID; fingerprints: Array<string> }> = [];
      const candidateCount: number = 1 + random(5);

      for (let index: number = 0; index < candidateCount; index++) {
        const fingerprints: Array<string> = [`fp-${round}-${index}`];

        for (let merged: number = random(3); merged > 0; merged--) {
          fingerprints.push(`fp-${round}-${index}-merged-${merged}`);
        }

        groups.push({ id: ObjectID.generate(), fingerprints });
      }

      jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue(
        groups.map((group: { id: ObjectID; fingerprints: Array<string> }) => {
          return {
            ...fakeCandidate(),
            id: group.id,
            fingerprint: group.fingerprints[0],
          };
        }) as unknown as Array<TelemetryException>,
      );
      jest
        .spyOn(TelemetryExceptionService, "getGroupFingerprints")
        .mockResolvedValue(
          new Map<string, Array<string>>(
            groups.map(
              (group: {
                id: ObjectID;
                fingerprints: Array<string>;
              }): [string, Array<string>] => {
                return [group.id.toString().toLowerCase(), group.fingerprints];
              },
            ),
          ),
        );

      occurrences = [];

      for (const group of groups) {
        for (const fingerprint of group.fingerprints) {
          for (const edge of edges) {
            occurrences.push(
              ...occurring(fingerprint, many(random(4) * random(9), edge)),
            );
          }

          occurrences.push(
            ...occurring(fingerprint, many(random(6), now), otherProjectId),
          );
        }
      }

      occurrences.push(...occurring(`fp-${round}-nobody`, many(30, now)));

      standInForClickHouse();

      const found: Array<InsightCandidate> =
        await new ExceptionSpikeDetector().detect({ projectId, now });

      // What two counts per candidate found.
      const expected: Array<{ id: string; recent: number; baseline: number }> =
        [];

      for (const group of groups) {
        const query: string | Includes =
          group.fingerprints.length === 1
            ? group.fingerprints[0]!
            : new Includes([...group.fingerprints]);
        const recent: number = countOfOccurrences(query, oneHourAgo, now);
        const prior: number = countOfOccurrences(
          query,
          twentyFiveHoursAgo,
          oneHourAgo,
        );
        const decision: ExceptionSpikeDecision =
          ExceptionSpikeDetector.evaluateSpike(recent, prior);

        if (decision.isSpike) {
          expected.push({
            id: group.id.toString(),
            recent,
            baseline: decision.baselineHourlyAverage,
          });
        }
      }

      expect({
        round,
        spikes: found.map((candidate: InsightCandidate) => {
          const exception: Record<string, unknown> = candidate.evidence
            .exception as Record<string, unknown>;

          return {
            id: candidate.telemetryExceptionId!.toString(),
            recent: exception["recentOccurrenceCount"],
            baseline: exception["baselineHourlyAverage"],
          };
        }),
      }).toEqual({ round, spikes: expected });
    }
  });

  test("detect propagates ClickHouse errors — the scanner isolates detectors", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        fakeCandidate(),
      ] as unknown as Array<TelemetryException>);
    jest
      .spyOn(ExceptionInstanceService, "countPerValueInWindows")
      .mockRejectedValue(new Error("clickhouse down"));

    const detector: ExceptionSpikeDetector = new ExceptionSpikeDetector();
    await expect(detector.detect({ projectId, now })).rejects.toThrow(
      "clickhouse down",
    );
  });
});
