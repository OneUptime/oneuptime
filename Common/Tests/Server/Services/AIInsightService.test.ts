import AIInsightService, {
  MAX_TRIAGE_RUN_EVENTS,
} from "../../../Server/Services/AIInsightService";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightHumanVerdict from "../../../Types/AI/AIInsightHumanVerdict";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Human actions on AI insights land here via AIInsightAPI
 * (verdict / resolve / reopen / triage-run). Contract under test: a
 * Dismissed verdict also closes the insight while Confirmed leaves the
 * status untouched — unless the insight was closed AS Dismissed, which
 * Confirmed contradicts, so that case reopens it; overwriting a verdict is
 * allowed (latest wins — this is the G11 precision measurement, not an
 * audit trail); resolve stamps Confirmed only when no verdict exists yet;
 * reopen undoes either terminal state and CLEARS the verdict, and is a
 * no-op on an already-open insight; and the triage-run read returns the
 * empty { run: null, events: [] } shape instead of erroring, reading run +
 * events as root with the ordered, capped event query.
 *
 * Every human action must be reversible: hiding the actions on a closed
 * insight (and having no reopen at all) made a mis-click permanent AND
 * kept InsightStore's dismissal cooldown suppressing the same fingerprint
 * for days, which is the regression the reopen tests below pin.
 */

const insightId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function fakeInsight(overrides: Record<string, unknown>): AIInsight {
  return { id: insightId, ...overrides } as unknown as AIInsight;
}

function fakeRun(): AIRun {
  return { id: ObjectID.generate() } as unknown as AIRun;
}

function fakeEvent(sequence: number): AIRunEvent {
  return { id: ObjectID.generate(), sequence } as unknown as AIRunEvent;
}

describe("AIInsightService.applyHumanVerdict", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("missing insight → reject with a clear message, nothing written", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(null);
    const updateOneById: jest.SpyInstance = jest.spyOn(
      AIInsightService,
      "updateOneById",
    );

    await expect(
      AIInsightService.applyHumanVerdict({
        insightId,
        verdict: AIInsightHumanVerdict.Confirmed,
        byUserId: userId,
      }),
    ).rejects.toThrow(BadDataException);

    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("Confirmed on an open insight: stores verdict + at + byUserId as root and leaves status untouched", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ status: AIInsightStatus.FixOpened }));
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: {
      insightId: ObjectID;
      verdict: AIInsightHumanVerdict;
      status: AIInsightStatus | null;
    } = await AIInsightService.applyHumanVerdict({
      insightId,
      verdict: AIInsightHumanVerdict.Confirmed,
      byUserId: userId,
    });

    expect(result.insightId).toBe(insightId);
    expect(result.verdict).toBe(AIInsightHumanVerdict.Confirmed);
    // Reported back unchanged — confirming did not move the lifecycle.
    expect(result.status).toBe(AIInsightStatus.FixOpened);

    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: insightId,
        data: expect.objectContaining({
          humanVerdict: AIInsightHumanVerdict.Confirmed,
          humanVerdictAt: expect.any(Date),
          humanVerdictByUserId: userId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    // Confirmed must NOT touch the lifecycle status of an open insight.
    const updateArg: { data: Record<string, unknown> } = updateOneById.mock
      .calls[0]![0] as { data: Record<string, unknown> };
    expect(updateArg.data).not.toHaveProperty("status");
  });

  test("Confirmed on an insight closed as Dismissed: reopens it to ActionRequired", async () => {
    /*
     * "Closed as noise" and "a human says it was real" cannot both hold.
     * Leaving the status alone here left the page showing Dismissed next to
     * Confirmed with no way back, and left InsightStore suppressing the same
     * fingerprint for the whole dismissal cooldown.
     */
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ status: AIInsightStatus.Dismissed }));
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: {
      insightId: ObjectID;
      verdict: AIInsightHumanVerdict;
      status: AIInsightStatus | null;
    } = await AIInsightService.applyHumanVerdict({
      insightId,
      verdict: AIInsightHumanVerdict.Confirmed,
      byUserId: userId,
    });

    expect(result.status).toBe(AIInsightStatus.ActionRequired);
    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          humanVerdict: AIInsightHumanVerdict.Confirmed,
          status: AIInsightStatus.ActionRequired,
        }),
      }),
    );
  });

  test("Confirmed on a dismissed insight with a fix task: reopens to FixOpened, not ActionRequired", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(
      fakeInsight({
        status: AIInsightStatus.Dismissed,
        fixAiRunId: ObjectID.generate(),
      }),
    );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await AIInsightService.applyHumanVerdict({
      insightId,
      verdict: AIInsightHumanVerdict.Confirmed,
      byUserId: userId,
    });

    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: AIInsightStatus.FixOpened }),
      }),
    );
  });

  test("Confirmed on a Resolved insight leaves it Resolved (only Dismissed is contradicted)", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ status: AIInsightStatus.Resolved }));
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: {
      insightId: ObjectID;
      verdict: AIInsightHumanVerdict;
      status: AIInsightStatus | null;
    } = await AIInsightService.applyHumanVerdict({
      insightId,
      verdict: AIInsightHumanVerdict.Confirmed,
      byUserId: userId,
    });

    expect(result.status).toBe(AIInsightStatus.Resolved);
    const updateArg: { data: Record<string, unknown> } = updateOneById.mock
      .calls[0]![0] as { data: Record<string, unknown> };
    expect(updateArg.data).not.toHaveProperty("status");
  });

  test("Dismissed: additionally closes the insight (status = Dismissed)", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(
        fakeInsight({ status: AIInsightStatus.ActionRequired }),
      );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await AIInsightService.applyHumanVerdict({
      insightId,
      verdict: AIInsightHumanVerdict.Dismissed,
      byUserId: userId,
    });

    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          humanVerdict: AIInsightHumanVerdict.Dismissed,
          status: AIInsightStatus.Dismissed,
        }),
      }),
    );
  });

  test("overwrite allowed: a second verdict simply re-writes (latest wins)", async () => {
    /*
     * There is deliberately no "already has a verdict" guard — people
     * change their minds, and the G11 measurement wants the latest call.
     */
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(
        fakeInsight({ status: AIInsightStatus.ActionRequired }),
      );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await AIInsightService.applyHumanVerdict({
      insightId,
      verdict: AIInsightHumanVerdict.Confirmed,
      byUserId: userId,
    });

    const secondUserId: ObjectID = ObjectID.generate();
    const result: {
      insightId: ObjectID;
      verdict: AIInsightHumanVerdict;
      status: AIInsightStatus | null;
    } = await AIInsightService.applyHumanVerdict({
      insightId,
      verdict: AIInsightHumanVerdict.Dismissed,
      byUserId: secondUserId,
    });

    expect(result.verdict).toBe(AIInsightHumanVerdict.Dismissed);
    expect(updateOneById).toHaveBeenCalledTimes(2);
    expect(updateOneById).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          humanVerdict: AIInsightHumanVerdict.Dismissed,
          humanVerdictByUserId: secondUserId,
          status: AIInsightStatus.Dismissed,
        }),
      }),
    );
  });
});

describe("AIInsightService.reopenInsight", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("missing insight → reject with a clear message, nothing written", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(null);
    const updateOneById: jest.SpyInstance = jest.spyOn(
      AIInsightService,
      "updateOneById",
    );

    await expect(AIInsightService.reopenInsight({ insightId })).rejects.toThrow(
      BadDataException,
    );

    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("Dismissed → ActionRequired, and the verdict fields are cleared", async () => {
    /*
     * Clearing is the point: a verdict the human took back must stop
     * counting toward per-detector precision, and a stale humanVerdictAt
     * would otherwise anchor InsightStore's dismissal cooldown.
     */
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(
      fakeInsight({
        status: AIInsightStatus.Dismissed,
        humanVerdict: AIInsightHumanVerdict.Dismissed,
      }),
    );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: { insightId: ObjectID; status: AIInsightStatus } =
      await AIInsightService.reopenInsight({ insightId });

    expect(result.status).toBe(AIInsightStatus.ActionRequired);

    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: insightId,
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    const updateArg: { data: Record<string, unknown> } = updateOneById.mock
      .calls[0]![0] as { data: Record<string, unknown> };
    expect(updateArg.data["status"]).toBe(AIInsightStatus.ActionRequired);
    // Explicit nulls — undefined would leave the columns as they were.
    expect(updateArg.data["humanVerdict"]).toBeNull();
    expect(updateArg.data["humanVerdictAt"]).toBeNull();
    expect(updateArg.data["humanVerdictByUserId"]).toBeNull();
  });

  test("Resolved → ActionRequired too: both terminal states are reversible", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(
      fakeInsight({
        status: AIInsightStatus.Resolved,
        humanVerdict: AIInsightHumanVerdict.Confirmed,
      }),
    );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: { insightId: ObjectID; status: AIInsightStatus } =
      await AIInsightService.reopenInsight({ insightId });

    expect(result.status).toBe(AIInsightStatus.ActionRequired);
    expect(updateOneById).toHaveBeenCalledTimes(1);
  });

  test("a closed insight with a fix task reopens to FixOpened", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(
      fakeInsight({
        status: AIInsightStatus.Resolved,
        fixAiRunId: ObjectID.generate(),
      }),
    );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: { insightId: ObjectID; status: AIInsightStatus } =
      await AIInsightService.reopenInsight({ insightId });

    expect(result.status).toBe(AIInsightStatus.FixOpened);
    const updateArg: { data: Record<string, unknown> } = updateOneById.mock
      .calls[0]![0] as { data: Record<string, unknown> };
    expect(updateArg.data["status"]).toBe(AIInsightStatus.FixOpened);
  });

  test("already open: no-op that reports the current status (a double click cannot rewrite it)", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ status: AIInsightStatus.FixOpened }));
    const updateOneById: jest.SpyInstance = jest.spyOn(
      AIInsightService,
      "updateOneById",
    );

    const result: { insightId: ObjectID; status: AIInsightStatus } =
      await AIInsightService.reopenInsight({ insightId });

    expect(result.status).toBe(AIInsightStatus.FixOpened);
    expect(updateOneById).not.toHaveBeenCalled();
  });
});

describe("AIInsightService.resolveInsight", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("missing insight → reject with a clear message, nothing written", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(null);
    const updateOneById: jest.SpyInstance = jest.spyOn(
      AIInsightService,
      "updateOneById",
    );

    await expect(
      AIInsightService.resolveInsight({
        insightId,
        byUserId: userId,
      }),
    ).rejects.toThrow(BadDataException);

    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("no verdict yet: resolving also stamps Confirmed (resolving implies the finding was real)", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ humanVerdict: undefined }));
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const result: { insightId: ObjectID; status: AIInsightStatus } =
      await AIInsightService.resolveInsight({
        insightId,
        byUserId: userId,
      });

    expect(result.status).toBe(AIInsightStatus.Resolved);

    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: insightId,
        data: expect.objectContaining({
          status: AIInsightStatus.Resolved,
          humanVerdict: AIInsightHumanVerdict.Confirmed,
          humanVerdictAt: expect.any(Date),
          humanVerdictByUserId: userId,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("existing verdict is left untouched: resolve is a lifecycle action, not a verdict change", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(
      fakeInsight({
        humanVerdict: AIInsightHumanVerdict.Dismissed,
      }),
    );
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await AIInsightService.resolveInsight({
      insightId,
      byUserId: userId,
    });

    // ONLY the status may change — no verdict fields in the write.
    const updateArg: { data: Record<string, unknown> } = updateOneById.mock
      .calls[0]![0] as { data: Record<string, unknown> };
    expect(Object.keys(updateArg.data)).toEqual(["status"]);
    expect(updateArg.data["status"]).toBe(AIInsightStatus.Resolved);
  });
});

describe("AIInsightService.getLatestTriageRunWithEvents", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("missing insight → empty shape, no run lookup", async () => {
    jest.spyOn(AIInsightService, "findOneById").mockResolvedValue(null);
    const runFindOneById: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "findOneById",
    );

    const result: { run: AIRun | null; events: Array<AIRunEvent> } =
      await AIInsightService.getLatestTriageRunWithEvents({ insightId });

    expect(result).toEqual({ run: null, events: [] });
    expect(runFindOneById).not.toHaveBeenCalled();
  });

  test("no triage run enqueued (triageAiRunId null) → empty shape, no run lookup", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ triageAiRunId: undefined }));
    const runFindOneById: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "findOneById",
    );

    const result: { run: AIRun | null; events: Array<AIRunEvent> } =
      await AIInsightService.getLatestTriageRunWithEvents({ insightId });

    expect(result).toEqual({ run: null, events: [] });
    expect(runFindOneById).not.toHaveBeenCalled();
  });

  test("triage run row gone (raced deletion) → empty shape, no event query", async () => {
    jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ triageAiRunId: ObjectID.generate() }));
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(null);
    const eventsFindBy: jest.SpyInstance = jest.spyOn(
      AIRunEventService,
      "findBy",
    );

    const result: { run: AIRun | null; events: Array<AIRunEvent> } =
      await AIInsightService.getLatestTriageRunWithEvents({ insightId });

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
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(fakeInsight({ triageAiRunId }));
    const runFindOneById: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(run);
    const eventsFindBy: jest.SpyInstance = jest
      .spyOn(AIRunEventService, "findBy")
      .mockResolvedValue(events);

    const result: { run: AIRun | null; events: Array<AIRunEvent> } =
      await AIInsightService.getLatestTriageRunWithEvents({ insightId });

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
