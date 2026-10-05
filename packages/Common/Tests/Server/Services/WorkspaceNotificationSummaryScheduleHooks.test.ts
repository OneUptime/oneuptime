import WorkspaceNotificationSummaryService from "../../../Server/Services/WorkspaceNotificationSummaryService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A workspace summary's schedule, as the summary service stores it: the
 * create and update hooks of WorkspaceNotificationSummaryService, run
 * directly, with the database read and the follow-up write stubbed.
 *
 * How Often had no default, and the next send - the only thing the report
 * worker sends on - was worked out by the dashboard alone: a summary created
 * through the API was never sent, one dated in the past was sent a summary a
 * minute until the schedule caught up, and editing the schedule kept the
 * next send it had. The service now fills in the schedule a new summary
 * leaves out (every week, the first next Monday at 09:00 UTC), works its
 * next send out, and works it out again when the schedule really changes.
 *
 * "Now" is Monday 5 Oct 2026, 12:00 UTC.
 */

const NOW: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");

const SUMMARY_ID: ObjectID = new ObjectID(
  "2a000000-0000-4000-8000-000000000001",
);
const OTHER_SUMMARY_ID: ObjectID = new ObjectID(
  "2a000000-0000-4000-8000-000000000002",
);

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<WorkspaceNotificationSummary>,
  ) => Promise<OnCreate<WorkspaceNotificationSummary>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<WorkspaceNotificationSummary>,
  ) => Promise<OnUpdate<WorkspaceNotificationSummary>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<WorkspaceNotificationSummary>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<WorkspaceNotificationSummary>>;
};

const hooks: Hooks = WorkspaceNotificationSummaryService as unknown as Hooks;

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

function at(iso: string): Date {
  return OneUptimeDate.fromString(iso);
}

function iso(value: unknown): string | undefined {
  return value instanceof Date ? value.toISOString() : undefined;
}

function intervalText(value: unknown): string | undefined {
  return value instanceof Recurring
    ? `${value.intervalCount.toNumber()} ${value.intervalType}`
    : undefined;
}

function newSummary(
  columns: Partial<
    Pick<
      WorkspaceNotificationSummary,
      "recurringInterval" | "sendFirstReportAt" | "nextSendAt"
    >
  >,
): WorkspaceNotificationSummary {
  const summary: WorkspaceNotificationSummary =
    new WorkspaceNotificationSummary();
  summary.name = "Weekly Incident Summary";
  Object.assign(summary, columns);
  return summary;
}

async function create(
  summary: WorkspaceNotificationSummary,
): Promise<WorkspaceNotificationSummary> {
  const onCreate: OnCreate<WorkspaceNotificationSummary> =
    await hooks.onBeforeCreate({
      data: summary,
      props: { isRoot: true },
    });

  return onCreate.createBy.data;
}

function updateBy(
  data: Record<string, unknown>,
  query?: Record<string, unknown>,
): UpdateBy<WorkspaceNotificationSummary> {
  return {
    query: query || { _id: SUMMARY_ID.toString() },
    data: data,
    props: { isRoot: true },
    skip: 0,
    limit: 1,
  } as unknown as UpdateBy<WorkspaceNotificationSummary>;
}

function stored(
  id: ObjectID,
  columns: Partial<
    Pick<
      WorkspaceNotificationSummary,
      "recurringInterval" | "sendFirstReportAt" | "nextSendAt" | "isEnabled"
    >
  >,
): WorkspaceNotificationSummary {
  const summary: WorkspaceNotificationSummary =
    new WorkspaceNotificationSummary();
  summary._id = id.toString();
  Object.assign(summary, columns);
  return summary;
}

beforeEach(() => {
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating a summary", () => {
  test("without a schedule gets every week, the first next Monday at 09:00 UTC, and that as its next send", async () => {
    const created: WorkspaceNotificationSummary = await create(newSummary({}));

    expect(intervalText(created.recurringInterval)).toBe("1 Week");
    expect(iso(created.sendFirstReportAt)).toBe("2026-10-12T09:00:00.000Z");
    expect(iso(created.nextSendAt)).toBe("2026-10-12T09:00:00.000Z");
  });

  test("with the first summary the dashboard worked out in the creator's time zone sends it then", async () => {
    // 09:00 next Monday in Berlin, as the form sends it.
    const created: WorkspaceNotificationSummary = await create(
      newSummary({
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-10-12T07:00:00.000Z"),
      }),
    );

    expect(intervalText(created.recurringInterval)).toBe("1 Week");
    expect(iso(created.sendFirstReportAt)).toBe("2026-10-12T07:00:00.000Z");
    expect(iso(created.nextSendAt)).toBe("2026-10-12T07:00:00.000Z");
  });

  test("daily, without a first summary, starts tomorrow at 09:00", async () => {
    const created: WorkspaceNotificationSummary = await create(
      newSummary({ recurringInterval: every(EventInterval.Day, 1) }),
    );

    expect(intervalText(created.recurringInterval)).toBe("1 Day");
    expect(iso(created.sendFirstReportAt)).toBe("2026-10-06T09:00:00.000Z");
    expect(iso(created.nextSendAt)).toBe("2026-10-06T09:00:00.000Z");
  });

  test("with a first summary in the past waits for the schedule's next occurrence - no catch-up burst", async () => {
    const created: WorkspaceNotificationSummary = await create(
      newSummary({
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-09-01T10:00:00.000Z"),
      }),
    );

    // The date it was given stays: it is what the schedule follows.
    expect(iso(created.sendFirstReportAt)).toBe("2026-09-01T10:00:00.000Z");
    expect(iso(created.nextSendAt)).toBe("2026-10-06T10:00:00.000Z");
  });

  test("with a next send of the caller's own keeps it", async () => {
    const created: WorkspaceNotificationSummary = await create(
      newSummary({
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-10-12T09:00:00.000Z"),
        nextSendAt: at("2026-10-05T12:05:00.000Z"),
      }),
    );

    expect(iso(created.nextSendAt)).toBe("2026-10-05T12:05:00.000Z");
  });

  test("with a schedule sent as JSON, as the API sends it, keeps it", async () => {
    const created: WorkspaceNotificationSummary = await create(
      newSummary({
        recurringInterval: every(
          EventInterval.Month,
          1,
        ).toJSON() as unknown as Recurring,
        sendFirstReportAt: "2026-11-01T09:00:00.000Z" as unknown as Date,
      }),
    );

    expect(iso(created.nextSendAt)).toBe("2026-11-01T09:00:00.000Z");
  });

  test("with an interval that cannot be read is refused, and says how to send one", async () => {
    await expect(
      create(
        newSummary({
          recurringInterval: { _type: "Recurring" } as unknown as Recurring,
        }),
      ),
    ).rejects.toThrow(BadDataException);
    await expect(
      create(
        newSummary({
          recurringInterval: { _type: "Recurring" } as unknown as Recurring,
        }),
      ),
    ).rejects.toThrow(/recurringInterval is not a recurring interval/);
  });

  test("with a first summary date that cannot be read is refused", async () => {
    await expect(
      create(
        newSummary({
          sendFirstReportAt: "whenever" as unknown as Date,
        }),
      ),
    ).rejects.toThrow(/sendFirstReportAt is not a date and time/);
  });
});

describe("updating a summary", () => {
  test("that leaves the schedule alone reads nothing and adds nothing", async () => {
    const findBy: jest.SpyInstance<any, any> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([]);

    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy({ name: "Renamed" }));

    expect(findBy).not.toHaveBeenCalled();
    expect(onUpdate.updateBy.data).toEqual({ name: "Renamed" });
    expect(onUpdate.carryForward).toBeNull();
  });

  test("from the report worker, moving the next send, reads nothing and adds nothing", async () => {
    const findBy: jest.SpyInstance<any, any> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([]);

    const data: Record<string, unknown> = {
      nextSendAt: at("2026-10-19T09:00:00.000Z"),
    };
    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy(data));

    expect(findBy).not.toHaveBeenCalled();
    expect(
      iso((onUpdate.updateBy.data as Record<string, unknown>)["nextSendAt"]),
    ).toBe("2026-10-19T09:00:00.000Z");
  });

  test("that sends the schedule back unchanged keeps the next send it has", async () => {
    getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([
      stored(SUMMARY_ID, {
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-09-07T09:00:00.000Z"),
        nextSendAt: at("2026-10-12T09:00:00.000Z"),
      }),
    ]);

    const data: Record<string, unknown> = {
      name: "Renamed",
      recurringInterval: every(EventInterval.Week, 1),
      sendFirstReportAt: at("2026-09-07T09:00:00.000Z"),
    };
    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy(data));

    expect(
      (onUpdate.updateBy.data as Record<string, unknown>)["nextSendAt"],
    ).toBeUndefined();
    expect(onUpdate.carryForward).toBeNull();
  });

  test("that makes it daily goes out at the next daily occurrence, in the same write", async () => {
    const findBy: jest.SpyInstance<any, any> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([
      stored(SUMMARY_ID, {
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-09-07T09:00:00.000Z"),
        nextSendAt: at("2026-10-12T09:00:00.000Z"),
      }),
    ]);

    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(
        updateBy({ recurringInterval: every(EventInterval.Day, 1) }),
      );

    expect(
      iso((onUpdate.updateBy.data as Record<string, unknown>)["nextSendAt"]),
    ).toBe("2026-10-06T09:00:00.000Z");
    expect(onUpdate.carryForward).toBeNull();

    // It read the summaries the update is about, with root props.
    const readArguments: Record<string, any> = findBy.mock.calls[0]![0];
    expect(readArguments["query"]).toEqual({ _id: SUMMARY_ID.toString() });
    expect(readArguments["props"]).toEqual({ isRoot: true });
    expect(readArguments["select"]).toEqual(
      expect.objectContaining({
        recurringInterval: true,
        sendFirstReportAt: true,
        nextSendAt: true,
      }),
    );
  });

  test("that moves the first summary later sends it then", async () => {
    getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([
      stored(SUMMARY_ID, {
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-09-07T09:00:00.000Z"),
        nextSendAt: at("2026-10-12T09:00:00.000Z"),
      }),
    ]);

    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(
        updateBy({ sendFirstReportAt: at("2026-10-21T17:00:00.000Z") }),
      );

    expect(
      iso((onUpdate.updateBy.data as Record<string, unknown>)["nextSendAt"]),
    ).toBe("2026-10-21T17:00:00.000Z");
  });

  test("that switches it back on after months off sends at the next occurrence, not at once", async () => {
    const findBy: jest.SpyInstance<any, any> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([
      stored(SUMMARY_ID, {
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-06-01T09:00:00.000Z"),
        nextSendAt: at("2026-07-06T09:00:00.000Z"),
        isEnabled: false,
      }),
    ]);

    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy({ isEnabled: true }));

    expect(
      iso((onUpdate.updateBy.data as Record<string, unknown>)["nextSendAt"]),
    ).toBe("2026-10-12T09:00:00.000Z");
    expect(findBy.mock.calls[0]![0]["select"]).toEqual(
      expect.objectContaining({ isEnabled: true }),
    );
  });

  test("that switches it off reads nothing and adds nothing", async () => {
    const findBy: jest.SpyInstance<any, any> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([]);

    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy({ isEnabled: false }));

    expect(findBy).not.toHaveBeenCalled();
    expect(onUpdate.updateBy.data).toEqual({ isEnabled: false });
  });

  test("with an interval that cannot be read is refused before anything is read", async () => {
    const findBy: jest.SpyInstance<any, any> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([]);

    await expect(
      hooks.onBeforeUpdate(
        updateBy({ recurringInterval: { _type: "Recurring" } }),
      ),
    ).rejects.toThrow(/recurringInterval is not a recurring interval/);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("of several summaries needing the same next send writes it in the one update", async () => {
    getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([
      stored(SUMMARY_ID, {
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-09-07T09:00:00.000Z"),
      }),
      stored(OTHER_SUMMARY_ID, {
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-09-07T09:00:00.000Z"),
      }),
    ]);

    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(
        updateBy(
          { recurringInterval: every(EventInterval.Day, 1) },
          { name: "Weekly" },
        ),
      );

    expect(
      iso((onUpdate.updateBy.data as Record<string, unknown>)["nextSendAt"]),
    ).toBe("2026-10-06T09:00:00.000Z");
    expect(onUpdate.carryForward).toBeNull();
  });

  test("of several summaries needing different next sends writes each one's after the update", async () => {
    getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([
      stored(SUMMARY_ID, {
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-09-07T09:00:00.000Z"),
      }),
      stored(OTHER_SUMMARY_ID, {
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-09-07T15:30:00.000Z"),
      }),
    ]);

    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(
        updateBy(
          { recurringInterval: every(EventInterval.Day, 1) },
          { name: "Weekly" },
        ),
      );

    // One write cannot hold both: none is added to it.
    expect(
      (onUpdate.updateBy.data as Record<string, unknown>)["nextSendAt"],
    ).toBeUndefined();

    const updateOneById: jest.SpyInstance<any, any> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "updateOneById",
    ).mockResolvedValue(undefined);

    // Only the summaries the update wrote get theirs.
    await hooks.onUpdateSuccess(onUpdate, [SUMMARY_ID, OTHER_SUMMARY_ID]);

    expect(updateOneById).toHaveBeenCalledTimes(2);

    const writes: Array<{ id: string; nextSendAt: string | undefined }> =
      updateOneById.mock.calls.map(
        (call: Array<any>): { id: string; nextSendAt: string | undefined } => {
          expect(call[0].props).toEqual({ isRoot: true, ignoreHooks: true });
          return {
            id: call[0].id.toString(),
            nextSendAt: iso(call[0].data.nextSendAt),
          };
        },
      );

    expect(writes).toEqual([
      {
        id: SUMMARY_ID.toString(),
        nextSendAt: "2026-10-06T09:00:00.000Z",
      },
      {
        id: OTHER_SUMMARY_ID.toString(),
        nextSendAt: "2026-10-05T15:30:00.000Z",
      },
    ]);
  });

  test("after an update that wrote only some summaries, writes only theirs", async () => {
    const updateOneById: jest.SpyInstance<any, any> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "updateOneById",
    ).mockResolvedValue(undefined);

    await hooks.onUpdateSuccess(
      {
        updateBy: updateBy({}),
        carryForward: {
          nextSendWrites: [
            {
              summaryId: SUMMARY_ID,
              nextSendAt: at("2026-10-06T09:00:00.000Z"),
            },
            {
              summaryId: OTHER_SUMMARY_ID,
              nextSendAt: at("2026-10-05T15:30:00.000Z"),
            },
          ],
        },
      },
      [OTHER_SUMMARY_ID],
    );

    expect(updateOneById).toHaveBeenCalledTimes(1);
    expect(updateOneById.mock.calls[0]![0].id.toString()).toBe(
      OTHER_SUMMARY_ID.toString(),
    );
  });

  test("with nothing carried forward writes nothing afterwards", async () => {
    const updateOneById: jest.SpyInstance<any, any> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "updateOneById",
    ).mockResolvedValue(undefined);

    await hooks.onUpdateSuccess(
      { updateBy: updateBy({}), carryForward: null },
      [SUMMARY_ID],
    );

    expect(updateOneById).not.toHaveBeenCalled();
  });
});
