import SentinelInsightService, {
  MAX_TRIAGE_RUN_EVENTS,
} from "../../../Server/Services/SentinelInsightService";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import SentinelInsight from "../../../Models/DatabaseModels/SentinelInsight";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import SentinelInsightStatus from "../../../Types/AI/SentinelInsightStatus";
import SentinelInsightHumanVerdict from "../../../Types/AI/SentinelInsightHumanVerdict";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Human actions on Sentinel insights land here via SentinelInsightAPI
 * (verdict / resolve / triage-run). Contract under test: a Dismissed
 * verdict also closes the insight while Confirmed leaves the status
 * untouched; overwriting a verdict is allowed (latest wins — this is the
 * G11 precision measurement, not an audit trail); resolve stamps Confirmed
 * only when no verdict exists yet; and the triage-run read returns the
 * empty { run: null, events: [] } shape instead of erroring, reading run +
 * events as root with the ordered, capped event query.
 */

const insightId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function fakeInsight(overrides: Record<string, unknown>): SentinelInsight {
  return { id: insightId, ...overrides } as unknown as SentinelInsight;
}

function fakeRun(): AIRun {
  return { id: ObjectID.generate() } as unknown as AIRun;
}

function fakeEvent(sequence: number): AIRunEvent {
  return { id: ObjectID.generate(), sequence } as unknown as AIRunEvent;
}

describe("SentinelInsightService.applyHumanVerdict", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Confirmed: stores verdict + at + byUserId as root and leaves status untouched", async () => {
    const findOneById: jest.SpyInstance = jest.spyOn(
      SentinelInsightService,
      "findOneById",
    );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(SentinelInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: {
      insightId: ObjectID;
      verdict: SentinelInsightHumanVerdict;
    } = await SentinelInsightService.applyHumanVerdict({
      insightId,
      verdict: SentinelInsightHumanVerdict.Confirmed,
      byUserId: userId,
    });

    expect(result.insightId).toBe(insightId);
    expect(result.verdict).toBe(SentinelInsightHumanVerdict.Confirmed);

    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: insightId,
        data: expect.objectContaining({
          humanVerdict: SentinelInsightHumanVerdict.Confirmed,
          humanVerdictAt: expect.any(Date),
          humanVerdictByUserId: userId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    // Confirmed must NOT touch the lifecycle status.
    const updateArg: { data: Record<string, unknown> } = updateOneById.mock
      .calls[0]![0] as { data: Record<string, unknown> };
    expect(updateArg.data).not.toHaveProperty("status");

    // The write is unconditional — no read-before-write guard.
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("Dismissed: additionally closes the insight (status = Dismissed)", async () => {
    const updateOneById: jest.SpyInstance = jest
      .spyOn(SentinelInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await SentinelInsightService.applyHumanVerdict({
      insightId,
      verdict: SentinelInsightHumanVerdict.Dismissed,
      byUserId: userId,
    });

    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          humanVerdict: SentinelInsightHumanVerdict.Dismissed,
          status: SentinelInsightStatus.Dismissed,
        }),
      }),
    );
  });

  test("overwrite allowed: a second verdict simply re-writes (latest wins)", async () => {
    /*
     * There is deliberately no "already has a verdict" guard — people
     * change their minds, and the G11 measurement wants the latest call.
     */
    const updateOneById: jest.SpyInstance = jest
      .spyOn(SentinelInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await SentinelInsightService.applyHumanVerdict({
      insightId,
      verdict: SentinelInsightHumanVerdict.Confirmed,
      byUserId: userId,
    });

    const secondUserId: ObjectID = ObjectID.generate();
    const result: {
      insightId: ObjectID;
      verdict: SentinelInsightHumanVerdict;
    } = await SentinelInsightService.applyHumanVerdict({
      insightId,
      verdict: SentinelInsightHumanVerdict.Dismissed,
      byUserId: secondUserId,
    });

    expect(result.verdict).toBe(SentinelInsightHumanVerdict.Dismissed);
    expect(updateOneById).toHaveBeenCalledTimes(2);
    expect(updateOneById).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          humanVerdict: SentinelInsightHumanVerdict.Dismissed,
          humanVerdictByUserId: secondUserId,
          status: SentinelInsightStatus.Dismissed,
        }),
      }),
    );
  });
});

describe("SentinelInsightService.resolveInsight", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("missing insight → reject with a clear message, nothing written", async () => {
    jest.spyOn(SentinelInsightService, "findOneById").mockResolvedValue(null);
    const updateOneById: jest.SpyInstance = jest.spyOn(
      SentinelInsightService,
      "updateOneById",
    );

    await expect(
      SentinelInsightService.resolveInsight({
        insightId,
        byUserId: userId,
      }),
    ).rejects.toThrow(BadDataException);

    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("no verdict yet: resolving also stamps Confirmed (resolving implies the finding was real)", async () => {
    jest
      .spyOn(SentinelInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ humanVerdict: undefined }));
    const updateOneById: jest.SpyInstance = jest
      .spyOn(SentinelInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: { insightId: ObjectID; status: SentinelInsightStatus } =
      await SentinelInsightService.resolveInsight({
        insightId,
        byUserId: userId,
      });

    expect(result.status).toBe(SentinelInsightStatus.Resolved);

    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: insightId,
        data: expect.objectContaining({
          status: SentinelInsightStatus.Resolved,
          humanVerdict: SentinelInsightHumanVerdict.Confirmed,
          humanVerdictAt: expect.any(Date),
          humanVerdictByUserId: userId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("existing verdict is left untouched: resolve is a lifecycle action, not a verdict change", async () => {
    jest.spyOn(SentinelInsightService, "findOneById").mockResolvedValue(
      fakeInsight({
        humanVerdict: SentinelInsightHumanVerdict.Dismissed,
      }),
    );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(SentinelInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await SentinelInsightService.resolveInsight({
      insightId,
      byUserId: userId,
    });

    // ONLY the status may change — no verdict fields in the write.
    const updateArg: { data: Record<string, unknown> } = updateOneById.mock
      .calls[0]![0] as { data: Record<string, unknown> };
    expect(Object.keys(updateArg.data)).toEqual(["status"]);
    expect(updateArg.data["status"]).toBe(SentinelInsightStatus.Resolved);
  });
});

describe("SentinelInsightService.getLatestTriageRunWithEvents", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("missing insight → empty shape, no run lookup", async () => {
    jest.spyOn(SentinelInsightService, "findOneById").mockResolvedValue(null);
    const runFindOneById: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "findOneById",
    );

    const result: { run: AIRun | null; events: Array<AIRunEvent> } =
      await SentinelInsightService.getLatestTriageRunWithEvents({ insightId });

    expect(result).toEqual({ run: null, events: [] });
    expect(runFindOneById).not.toHaveBeenCalled();
  });

  test("no triage run enqueued (triageAiRunId null) → empty shape, no run lookup", async () => {
    jest
      .spyOn(SentinelInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ triageAiRunId: undefined }));
    const runFindOneById: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "findOneById",
    );

    const result: { run: AIRun | null; events: Array<AIRunEvent> } =
      await SentinelInsightService.getLatestTriageRunWithEvents({ insightId });

    expect(result).toEqual({ run: null, events: [] });
    expect(runFindOneById).not.toHaveBeenCalled();
  });

  test("triage run row gone (raced deletion) → empty shape, no event query", async () => {
    jest
      .spyOn(SentinelInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ triageAiRunId: ObjectID.generate() }));
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(null);
    const eventsFindBy: jest.SpyInstance = jest.spyOn(
      AIRunEventService,
      "findBy",
    );

    const result: { run: AIRun | null; events: Array<AIRunEvent> } =
      await SentinelInsightService.getLatestTriageRunWithEvents({ insightId });

    expect(result).toEqual({ run: null, events: [] });
    expect(eventsFindBy).not.toHaveBeenCalled();
  });

  test("happy path: run + events read as root, events ordered by sequence asc and capped at 500", async () => {
    const triageAiRunId: ObjectID = ObjectID.generate();
    const run: AIRun = fakeRun();
    const events: Array<AIRunEvent> = [
      fakeEvent(1),
      fakeEvent(2),
      fakeEvent(3),
    ];

    jest
      .spyOn(SentinelInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ triageAiRunId }));
    const runFindOneById: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(run);
    const eventsFindBy: jest.SpyInstance = jest
      .spyOn(AIRunEventService, "findBy")
      .mockResolvedValue(events);

    const result: { run: AIRun | null; events: Array<AIRunEvent> } =
      await SentinelInsightService.getLatestTriageRunWithEvents({ insightId });

    expect(result.run).toBe(run);
    expect(result.events).toBe(events);

    /*
     * Triage runs are system-authored and hidden by the per-user pin on
     * the generic AIRun CRUD — the lookup must run as root.
     */
    expect(runFindOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: triageAiRunId,
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    expect(eventsFindBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ aiRunId: run.id }),
        sort: expect.objectContaining({ sequence: SortOrder.Ascending }),
        limit: MAX_TRIAGE_RUN_EVENTS,
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    // The cap itself is a contract: the live panel never loads unbounded rows.
    expect(MAX_TRIAGE_RUN_EVENTS).toBe(500);
  });
});
