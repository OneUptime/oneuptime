import InsightStore, {
  INSIGHT_FINGERPRINT_MAX_LENGTH,
  INSIGHT_METRIC_NAME_MAX_LENGTH,
  INSIGHT_SERVICE_NAME_MAX_LENGTH,
  INSIGHT_TITLE_MAX_LENGTH,
  INSIGHT_TRACE_ID_MAX_LENGTH,
  MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN,
  UpsertCandidatesResult,
} from "../../../../../Server/Utils/AI/Sentinel/Insights/InsightStore";
import { InsightCandidate } from "../../../../../Server/Utils/AI/Sentinel/Insights/Types";
import SentinelInsightService from "../../../../../Server/Services/SentinelInsightService";
import CreateBy from "../../../../../Server/Types/Database/CreateBy";
import FindOneBy from "../../../../../Server/Types/Database/FindOneBy";
import SentinelInsight from "../../../../../Models/DatabaseModels/SentinelInsight";
import SentinelInsightStatus from "../../../../../Types/AI/SentinelInsightStatus";
import SentinelInsightType from "../../../../../Types/AI/SentinelInsightType";
import SentinelInsightSeverity from "../../../../../Types/AI/SentinelInsightSeverity";
import ColumnLength from "../../../../../Types/Database/ColumnLength";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Adversarial hardening of the insight store. The invariants these tests
 * lock in:
 *   (a) column safety: detector-produced strings are clamped to the model's
 *       declared column lengths BEFORE hitting DatabaseService's length
 *       check (which throws on overflow), and the clamped fingerprint is the
 *       row's identity for the dedupe LOOKUP too — so an over-long
 *       fingerprint refreshes one row across ticks instead of failing or
 *       duplicating on every scan;
 *   (b) per-candidate isolation: one failing candidate never aborts the
 *       batch — siblings are still upserted and every successfully created
 *       insight is returned for routing (otherwise a mid-batch failure would
 *       strand already-created rows in Detected forever);
 *   (c) a failed create does not consume the per-scan cap;
 *   (d) same-fingerprint behavior is pinned: within one batch (DB-faithful
 *       lookup) the second candidate refreshes the row the first created;
 *       when the lookup misses for both (the concurrent-scan race —
 *       (projectId, fingerprint) is deliberately NOT unique and there is no
 *       DB-level guard) the store creates duplicates. The single-flight cron
 *       (10-min timeout < 15-min tick) is the real concurrency guard.
 */

const projectId: ObjectID = ObjectID.generate();
const now: Date = new Date("2026-07-14T12:00:00.000Z");

function makeCandidate(
  overrides?: Partial<InsightCandidate>,
): InsightCandidate {
  return {
    insightType: SentinelInsightType.TraceLatencyRegression,
    fingerprint: "latency:svc-1:GET /checkout",
    title: "Latency regression: p99 3.0x on GET /checkout",
    detailMarkdown: "**p99** went from 800ms to 2400ms.",
    severity: SentinelInsightSeverity.Medium,
    evidence: {
      latency: {
        recentP99Ms: 2400,
        baselineP99Ms: 800,
        regressionMultiplier: 3,
      },
    },
    ...overrides,
  };
}

/*
 * create echoes back the model it was handed (with an id), so assertions can
 * inspect exactly what the store persisted.
 */
function mockCreate(): jest.SpyInstance {
  return jest
    .spyOn(SentinelInsightService, "create")
    .mockImplementation((createBy: CreateBy<SentinelInsight>) => {
      const model: SentinelInsight = createBy.data;
      model.id = ObjectID.generate();
      return Promise.resolve(model);
    });
}

function mockFindOneBy(existing: SentinelInsight | null): jest.SpyInstance {
  return jest
    .spyOn(SentinelInsightService, "findOneBy")
    .mockResolvedValue(existing);
}

function mockUpdateOneById(): jest.SpyInstance {
  return jest
    .spyOn(SentinelInsightService, "updateOneById")
    .mockResolvedValue(undefined);
}

describe("InsightStore — column-length clamps", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the clamp caps mirror the SentinelInsight column definitions", () => {
    expect(INSIGHT_FINGERPRINT_MAX_LENGTH).toBe(ColumnLength.LongText);
    expect(INSIGHT_TITLE_MAX_LENGTH).toBe(ColumnLength.LongText);
    expect(INSIGHT_SERVICE_NAME_MAX_LENGTH).toBe(ColumnLength.LongText);
    expect(INSIGHT_METRIC_NAME_MAX_LENGTH).toBe(ColumnLength.LongText);
    expect(INSIGHT_TRACE_ID_MAX_LENGTH).toBe(ColumnLength.ShortText);
  });

  test("over-long detector strings are clamped to the column caps on create — and the dedupe lookup uses the CLAMPED fingerprint", async () => {
    /*
     * A span name can be an entire SQL statement — every string that ends up
     * in a length-checked varchar column must be clamped or the create
     * throws and the candidate (and, without isolation, the batch) is lost.
     */
    const hugeOperation: string = `SELECT ${"column_name, ".repeat(100)}FROM orders`;
    const findOneBy: jest.SpyInstance = mockFindOneBy(null);
    const create: jest.SpyInstance = mockCreate();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: [
        makeCandidate({
          fingerprint: `latency:svc-1:${hugeOperation}`,
          title: `Latency regression: p99 3.0x on ${hugeOperation}`,
          serviceName: "s".repeat(INSIGHT_SERVICE_NAME_MAX_LENGTH + 100),
          metricName: "m".repeat(INSIGHT_METRIC_NAME_MAX_LENGTH + 100),
          traceId: "t".repeat(INSIGHT_TRACE_ID_MAX_LENGTH + 50),
        }),
      ],
      now,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.created).toHaveLength(1);

    const persisted: SentinelInsight = result.created[0]!;
    const expectedFingerprint: string = `latency:svc-1:${hugeOperation}`.slice(
      0,
      INSIGHT_FINGERPRINT_MAX_LENGTH,
    );

    expect(persisted.fingerprint).toBe(expectedFingerprint);
    expect(persisted.title!.length).toBe(INSIGHT_TITLE_MAX_LENGTH);
    expect(persisted.serviceName!.length).toBe(INSIGHT_SERVICE_NAME_MAX_LENGTH);
    expect(persisted.metricName!.length).toBe(INSIGHT_METRIC_NAME_MAX_LENGTH);
    expect(persisted.traceId!.length).toBe(INSIGHT_TRACE_ID_MAX_LENGTH);

    // Identity consistency: the lookup asked for what the insert stored.
    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          fingerprint: expectedFingerprint,
        }),
      }),
    );
  });

  test("a clamped fingerprint still dedupes on the next tick — refresh, not a duplicate row", async () => {
    const hugeFingerprint: string = `latency:svc-1:${"x".repeat(1000)}`;
    const clamped: string = hugeFingerprint.slice(
      0,
      INSIGHT_FINGERPRINT_MAX_LENGTH,
    );

    /*
     * DB-faithful stateful lookup: rows created by this run are visible to
     * later lookups keyed on their (clamped) stored fingerprint.
     */
    const rowsByFingerprint: Map<string, SentinelInsight> = new Map();

    jest
      .spyOn(SentinelInsightService, "findOneBy")
      .mockImplementation((findOneBy: FindOneBy<SentinelInsight>) => {
        const fingerprint: string = (
          findOneBy.query as { fingerprint?: string }
        ).fingerprint!;
        return Promise.resolve(rowsByFingerprint.get(fingerprint) || null);
      });

    const create: jest.SpyInstance = jest
      .spyOn(SentinelInsightService, "create")
      .mockImplementation((createBy: CreateBy<SentinelInsight>) => {
        const model: SentinelInsight = createBy.data;
        model.id = ObjectID.generate();
        model.status = SentinelInsightStatus.ActionRequired;
        rowsByFingerprint.set(model.fingerprint!, model);
        return Promise.resolve(model);
      });
    const update: jest.SpyInstance = mockUpdateOneById();

    const firstTick: UpsertCandidatesResult =
      await InsightStore.upsertCandidates({
        projectId,
        candidates: [makeCandidate({ fingerprint: hugeFingerprint })],
        now,
      });

    const secondTick: UpsertCandidatesResult =
      await InsightStore.upsertCandidates({
        projectId,
        candidates: [makeCandidate({ fingerprint: hugeFingerprint })],
        now: new Date(now.getTime() + 15 * 60 * 1000),
      });

    expect(firstTick.created).toHaveLength(1);
    expect(firstTick.created[0]?.fingerprint).toBe(clamped);
    expect(secondTick.created).toHaveLength(0);
    expect(secondTick.refreshed).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("InsightStore — per-candidate failure isolation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a create rejection on the middle candidate does not abort the batch — siblings are created and returned for routing", async () => {
    mockFindOneBy(null);
    jest
      .spyOn(SentinelInsightService, "create")
      .mockImplementation((createBy: CreateBy<SentinelInsight>) => {
        const model: SentinelInsight = createBy.data;
        if (model.fingerprint === "boom") {
          return Promise.reject(new Error("title length cannot be more..."));
        }
        model.id = ObjectID.generate();
        return Promise.resolve(model);
      });

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: [
        makeCandidate({ fingerprint: "first" }),
        makeCandidate({ fingerprint: "boom" }),
        makeCandidate({ fingerprint: "third" }),
      ],
      now,
    });

    expect(result.created).toHaveLength(2);
    expect(result.created[0]?.fingerprint).toBe("first");
    expect(result.created[1]?.fingerprint).toBe("third");
    expect(result.droppedByCap).toBe(0);
  });

  test("a dedupe-lookup rejection is isolated too — the remaining candidates still upsert", async () => {
    jest
      .spyOn(SentinelInsightService, "findOneBy")
      .mockImplementation((findOneBy: FindOneBy<SentinelInsight>) => {
        const fingerprint: string = (
          findOneBy.query as { fingerprint?: string }
        ).fingerprint!;
        if (fingerprint === "first") {
          return Promise.reject(new Error("connection reset"));
        }
        return Promise.resolve(null);
      });
    mockCreate();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: [
        makeCandidate({ fingerprint: "first" }),
        makeCandidate({ fingerprint: "second" }),
      ],
      now,
    });

    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.fingerprint).toBe("second");
  });

  test("a failed create does not consume the per-scan cap — later candidates still fill it", async () => {
    mockFindOneBy(null);
    jest
      .spyOn(SentinelInsightService, "create")
      .mockImplementation((createBy: CreateBy<SentinelInsight>) => {
        const model: SentinelInsight = createBy.data;
        if (model.fingerprint === "fp-2") {
          return Promise.reject(new Error("transient"));
        }
        model.id = ObjectID.generate();
        return Promise.resolve(model);
      });

    /*
     * Cap + 1 candidates with one failure: exactly cap creates succeed and
     * nothing is counted as dropped — the failure freed a cap slot.
     */
    const candidates: Array<InsightCandidate> = [];
    for (
      let i: number = 0;
      i < MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN + 1;
      i++
    ) {
      candidates.push(makeCandidate({ fingerprint: `fp-${i}` }));
    }

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates,
      now,
    });

    expect(result.created).toHaveLength(MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN);
    expect(result.droppedByCap).toBe(0);
  });
});

describe("InsightStore — same-fingerprint duplicates (batch and race)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("two same-fingerprint candidates in ONE batch: the second refreshes the row the first created (DB-faithful lookup)", async () => {
    const rowsByFingerprint: Map<string, SentinelInsight> = new Map();

    jest
      .spyOn(SentinelInsightService, "findOneBy")
      .mockImplementation((findOneBy: FindOneBy<SentinelInsight>) => {
        const fingerprint: string = (
          findOneBy.query as { fingerprint?: string }
        ).fingerprint!;
        return Promise.resolve(rowsByFingerprint.get(fingerprint) || null);
      });
    jest
      .spyOn(SentinelInsightService, "create")
      .mockImplementation((createBy: CreateBy<SentinelInsight>) => {
        const model: SentinelInsight = createBy.data;
        model.id = ObjectID.generate();
        rowsByFingerprint.set(model.fingerprint!, model);
        return Promise.resolve(model);
      });
    const update: jest.SpyInstance = mockUpdateOneById();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: [
        makeCandidate({ fingerprint: "shared" }),
        makeCandidate({ fingerprint: "shared" }),
      ],
      now,
    });

    expect(result.created).toHaveLength(1);
    expect(result.refreshed).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test("PINNED: when the lookup misses for both (concurrent-scan race), the store creates duplicates — there is no DB-level uniqueness guard", async () => {
    /*
     * (projectId, fingerprint) is deliberately NOT unique (terminal rows
     * accumulate as history), so nothing below the store prevents two racing
     * scans from double-creating. The operational guard is the single-flight
     * cron (10-minute job timeout < 15-minute tick). If multi-instance
     * workers ever run this job, a real dedupe guard must be added.
     */
    mockFindOneBy(null);
    const create: jest.SpyInstance = mockCreate();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: [
        makeCandidate({ fingerprint: "raced" }),
        makeCandidate({ fingerprint: "raced" }),
      ],
      now,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.created).toHaveLength(2);
  });
});
