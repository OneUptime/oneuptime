import InsightStore, {
  DISMISSED_COOLDOWN_DAYS,
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
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * The insight store's dedupe matrix keeps the inbox quiet: a candidate whose
 * fingerprint matches a live (non-terminal) insight REFRESHES it in place and
 * NEVER touches its status; a fingerprint a human dismissed within the last
 * DISMISSED_COOLDOWN_DAYS is suppressed entirely (G11 noise posture); only
 * never-seen, Resolved, or long-dismissed fingerprints create NEW rows, and
 * at most MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN of those per scan tick —
 * drops are counted and logged, never silent.
 */

const projectId: ObjectID = ObjectID.generate();
const now: Date = new Date("2026-07-14T12:00:00.000Z");

function makeCandidate(
  overrides?: Partial<InsightCandidate>,
): InsightCandidate {
  return {
    insightType: SentinelInsightType.NewException,
    fingerprint: "new-exception:abc",
    title: "New exception: NullPointerException in checkout",
    detailMarkdown: "**3 occurrences** in the last 24 hours.",
    severity: SentinelInsightSeverity.Medium,
    evidence: { exception: { recentOccurrenceCount: 3 } },
    ...overrides,
  };
}

function fakeExisting(overrides?: {
  status?: SentinelInsightStatus;
  occurrenceCount?: number;
  humanVerdictAt?: Date | undefined;
}): SentinelInsight {
  return {
    id: ObjectID.generate(),
    status: overrides?.status ?? SentinelInsightStatus.Detected,
    occurrenceCount: overrides?.occurrenceCount ?? 2,
    humanVerdictAt: overrides?.humanVerdictAt,
  } as unknown as SentinelInsight;
}

function mockFindOneBy(existing: SentinelInsight | null): jest.SpyInstance {
  return jest
    .spyOn(SentinelInsightService, "findOneBy")
    .mockResolvedValue(existing);
}

/*
 * create echoes back the model it was handed (with an id), so the returned
 * `created` array carries the exact fields the store persisted.
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

function mockUpdateOneById(): jest.SpyInstance {
  return jest
    .spyOn(SentinelInsightService, "updateOneById")
    .mockResolvedValue(undefined);
}

describe("InsightStore.upsertCandidates — dedupe matrix", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("no existing insight → CREATE with status Detected, firstSeenAt = lastSeenAt = now, occurrenceCount 1 and all candidate fields", async () => {
    mockFindOneBy(null);
    const create: jest.SpyInstance = mockCreate();
    const telemetryServiceId: ObjectID = ObjectID.generate();
    const telemetryExceptionId: ObjectID = ObjectID.generate();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: [
        makeCandidate({
          serviceName: "checkout",
          telemetryServiceId,
          telemetryExceptionId,
          traceId: "trace-1",
          metricName: "http.server.duration",
        }),
      ],
      now,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.created).toHaveLength(1);
    expect(result.refreshed).toBe(0);
    expect(result.suppressed).toBe(0);
    expect(result.droppedByCap).toBe(0);

    const persisted: SentinelInsight = result.created[0]!;
    expect(persisted.projectId).toBe(projectId);
    expect(persisted.insightType).toBe(SentinelInsightType.NewException);
    expect(persisted.status).toBe(SentinelInsightStatus.Detected);
    expect(persisted.severity).toBe(SentinelInsightSeverity.Medium);
    expect(persisted.fingerprint).toBe("new-exception:abc");
    expect(persisted.title).toBe(
      "New exception: NullPointerException in checkout",
    );
    expect(persisted.detailMarkdown).toBe(
      "**3 occurrences** in the last 24 hours.",
    );
    expect(persisted.evidence).toEqual({
      exception: { recentOccurrenceCount: 3 },
    });
    expect(persisted.serviceName).toBe("checkout");
    expect(persisted.telemetryServiceId).toBe(telemetryServiceId);
    expect(persisted.telemetryExceptionId).toBe(telemetryExceptionId);
    expect(persisted.traceId).toBe("trace-1");
    expect(persisted.metricName).toBe("http.server.duration");
    expect(persisted.firstSeenAt).toBe(now);
    expect(persisted.lastSeenAt).toBe(now);
    expect(persisted.occurrenceCount).toBe(1);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("dedupe lookup asks for the MOST RECENT (projectId, fingerprint) row as root", async () => {
    const findOneBy: jest.SpyInstance = mockFindOneBy(null);
    mockCreate();

    await InsightStore.upsertCandidates({
      projectId,
      candidates: [makeCandidate()],
      now,
    });

    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId,
          fingerprint: "new-exception:abc",
        }),
        sort: expect.objectContaining({ createdAt: SortOrder.Descending }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test.each([
    [SentinelInsightStatus.Detected],
    [SentinelInsightStatus.ActionRequired],
    [SentinelInsightStatus.FixOpened],
  ])(
    "existing %s insight → REFRESH: lastSeenAt, occurrenceCount+1, evidence/detail/severity updated — and status is NEVER touched",
    async (status: SentinelInsightStatus) => {
      const existing: SentinelInsight = fakeExisting({
        status,
        occurrenceCount: 4,
      });
      mockFindOneBy(existing);
      const create: jest.SpyInstance = mockCreate();
      const update: jest.SpyInstance = mockUpdateOneById();

      const result: UpsertCandidatesResult =
        await InsightStore.upsertCandidates({
          projectId,
          candidates: [
            makeCandidate({ severity: SentinelInsightSeverity.High }),
          ],
          now,
        });

      expect(create).not.toHaveBeenCalled();
      expect(result.created).toHaveLength(0);
      expect(result.refreshed).toBe(1);

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: existing.id,
          data: expect.objectContaining({
            lastSeenAt: now,
            occurrenceCount: 5,
            severity: SentinelInsightSeverity.High,
            detailMarkdown: "**3 occurrences** in the last 24 hours.",
            evidence: { exception: { recentOccurrenceCount: 3 } },
          }),
          props: expect.objectContaining({ isRoot: true }),
        }),
      );

      const updateData: Record<string, unknown> =
        update.mock.calls[0]?.[0]?.data;
      expect(Object.keys(updateData)).not.toContain("status");
      expect(Object.keys(updateData)).not.toContain("firstSeenAt");
    },
  );

  test("refresh with an unset occurrenceCount (defensive) counts up from the column default of 1", async () => {
    const existing: SentinelInsight = fakeExisting();
    (existing as unknown as Record<string, unknown>)["occurrenceCount"] =
      undefined;
    mockFindOneBy(existing);
    const update: jest.SpyInstance = mockUpdateOneById();

    await InsightStore.upsertCandidates({
      projectId,
      candidates: [makeCandidate()],
      now,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ occurrenceCount: 2 }),
      }),
    );
  });

  test("Dismissed 1 day ago → suppressed: no create, no update (G11 noise posture)", async () => {
    const oneDayAgo: Date = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    mockFindOneBy(
      fakeExisting({
        status: SentinelInsightStatus.Dismissed,
        humanVerdictAt: oneDayAgo,
      }),
    );
    const create: jest.SpyInstance = mockCreate();
    const update: jest.SpyInstance = mockUpdateOneById();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: [makeCandidate()],
      now,
    });

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result.suppressed).toBe(1);
    expect(result.created).toHaveLength(0);
    expect(result.refreshed).toBe(0);
  });

  test("cooldown boundary: dismissed EXACTLY 7 days ago still suppresses (inclusive)", async () => {
    const exactlySevenDaysAgo: Date = new Date(
      now.getTime() - DISMISSED_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
    );
    mockFindOneBy(
      fakeExisting({
        status: SentinelInsightStatus.Dismissed,
        humanVerdictAt: exactlySevenDaysAgo,
      }),
    );
    const create: jest.SpyInstance = mockCreate();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: [makeCandidate()],
      now,
    });

    expect(create).not.toHaveBeenCalled();
    expect(result.suppressed).toBe(1);
  });

  test("dismissed just past the cooldown (7 days + 1 ms) → CREATE a fresh insight", async () => {
    const pastCooldown: Date = new Date(
      now.getTime() - (DISMISSED_COOLDOWN_DAYS * 24 * 60 * 60 * 1000 + 1),
    );
    mockFindOneBy(
      fakeExisting({
        status: SentinelInsightStatus.Dismissed,
        humanVerdictAt: pastCooldown,
      }),
    );
    const create: jest.SpyInstance = mockCreate();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: [makeCandidate()],
      now,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.created).toHaveLength(1);
    expect(result.suppressed).toBe(0);
  });

  test("Dismissed with no verdict timestamp (defensive) suppresses — cannot prove the cooldown elapsed", async () => {
    mockFindOneBy(
      fakeExisting({
        status: SentinelInsightStatus.Dismissed,
        humanVerdictAt: undefined,
      }),
    );
    const create: jest.SpyInstance = mockCreate();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: [makeCandidate()],
      now,
    });

    expect(create).not.toHaveBeenCalled();
    expect(result.suppressed).toBe(1);
  });

  test("existing Resolved insight → CREATE new: a resolved issue that reappears is a regression", async () => {
    mockFindOneBy(fakeExisting({ status: SentinelInsightStatus.Resolved }));
    const create: jest.SpyInstance = mockCreate();
    const update: jest.SpyInstance = mockUpdateOneById();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: [makeCandidate()],
      now,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(result.created).toHaveLength(1);
    expect(result.refreshed).toBe(0);
  });
});

describe("InsightStore.upsertCandidates — per-scan new-insight cap", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function distinctCandidates(count: number): Array<InsightCandidate> {
    const candidates: Array<InsightCandidate> = [];
    for (let i: number = 0; i < count; i++) {
      candidates.push(makeCandidate({ fingerprint: `new-exception:${i}` }));
    }
    return candidates;
  }

  test("exactly at the cap: every candidate is created and nothing is dropped", async () => {
    mockFindOneBy(null);
    const create: jest.SpyInstance = mockCreate();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: distinctCandidates(MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN),
      now,
    });

    expect(create).toHaveBeenCalledTimes(MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN);
    expect(result.created).toHaveLength(MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN);
    expect(result.droppedByCap).toBe(0);
  });

  test("one past the cap: the extra candidate is counted as dropped, not created", async () => {
    mockFindOneBy(null);
    const create: jest.SpyInstance = mockCreate();

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates: distinctCandidates(MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN + 1),
      now,
    });

    expect(create).toHaveBeenCalledTimes(MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN);
    expect(result.created).toHaveLength(MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN);
    expect(result.droppedByCap).toBe(1);
  });

  test("the cap only limits CREATES — refreshes past the cap still happen", async () => {
    /*
     * 10 never-seen fingerprints (fill the cap), then one that matches a
     * live insight: the live one must still refresh.
     */
    const existing: SentinelInsight = fakeExisting({
      status: SentinelInsightStatus.ActionRequired,
    });

    jest
      .spyOn(SentinelInsightService, "findOneBy")
      .mockImplementation((findOneBy: FindOneBy<SentinelInsight>) => {
        const fingerprint: string | undefined = (
          findOneBy.query as { fingerprint?: string }
        ).fingerprint;
        if (fingerprint === "exception-spike:live") {
          return Promise.resolve(existing);
        }
        return Promise.resolve(null);
      });
    mockCreate();
    const update: jest.SpyInstance = mockUpdateOneById();

    const candidates: Array<InsightCandidate> = distinctCandidates(
      MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN,
    );
    candidates.push(makeCandidate({ fingerprint: "exception-spike:live" }));

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates,
      now,
    });

    expect(result.created).toHaveLength(MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN);
    expect(result.refreshed).toBe(1);
    expect(result.droppedByCap).toBe(0);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test("a mixed batch aggregates all four counters correctly", async () => {
    const live: SentinelInsight = fakeExisting({
      status: SentinelInsightStatus.Detected,
    });
    const dismissedRecently: SentinelInsight = fakeExisting({
      status: SentinelInsightStatus.Dismissed,
      humanVerdictAt: new Date(now.getTime() - 60 * 1000),
    });

    jest
      .spyOn(SentinelInsightService, "findOneBy")
      .mockImplementation((findOneBy: FindOneBy<SentinelInsight>) => {
        const fingerprint: string | undefined = (
          findOneBy.query as { fingerprint?: string }
        ).fingerprint;
        if (fingerprint === "live") {
          return Promise.resolve(live);
        }
        if (fingerprint === "dismissed") {
          return Promise.resolve(dismissedRecently);
        }
        return Promise.resolve(null);
      });
    mockCreate();
    mockUpdateOneById();

    const candidates: Array<InsightCandidate> = [
      makeCandidate({ fingerprint: "live" }),
      makeCandidate({ fingerprint: "dismissed" }),
      makeCandidate({ fingerprint: "brand-new" }),
    ];

    const result: UpsertCandidatesResult = await InsightStore.upsertCandidates({
      projectId,
      candidates,
      now,
    });

    expect(result.refreshed).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(result.created).toHaveLength(1);
    expect(result.droppedByCap).toBe(0);
    expect(result.created[0]?.fingerprint).toBe("brand-new");
  });
});
