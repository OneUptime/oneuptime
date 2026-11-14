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
import WorkspaceNotificationSummaryItem from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import { WorkspaceSummaryNotSendableException } from "../../../Utils/Workspace/WorkspaceSummarySetup";
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
 * #7116: A WORKSPACE SUMMARY THAT COULD NEVER BE SENT IS NOT STORED - the
 * create and update hooks of WorkspaceNotificationSummaryService, run
 * directly, with the database read stubbed.
 *
 * A summary with no channel to post in (none, or only blank names) or
 * nothing to include was stored, and the report worker tried to send it
 * every minute for ever. Now a create or an update that would leave it so
 * is refused, in the words its send failed with; channel names sent as one
 * text - as the dashboard's edit form sent them - are stored as the list
 * they name, not posted in letter by letter. A write that does not touch
 * them is never refused for them.
 *
 * "Now" is Monday 5 Oct 2026, 12:00 UTC.
 */

const NOW: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");

// Why a write is refused, as the summary form says it: what is missing, and where.
const NO_CHANNELS: string = "The summary has no channel to post in.";
const NO_ITEMS: string =
  "The summary has no items picked under What to Include.";

const SUMMARY_ID: ObjectID = new ObjectID(
  "71160000-0000-4000-8000-000000000001",
);

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<WorkspaceNotificationSummary>,
  ) => Promise<OnCreate<WorkspaceNotificationSummary>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<WorkspaceNotificationSummary>,
  ) => Promise<OnUpdate<WorkspaceNotificationSummary>>;
};

const hooks: Hooks = WorkspaceNotificationSummaryService as unknown as Hooks;

function newSummary(
  columns: Record<string, unknown>,
): WorkspaceNotificationSummary {
  const summary: WorkspaceNotificationSummary =
    new WorkspaceNotificationSummary();
  summary.name = "Weekly Incident Summary";
  summary.channelNames = ["#ops"];
  summary.summaryItems = [WorkspaceNotificationSummaryItem.All];
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

async function createRefusal(
  columns: Record<string, unknown>,
): Promise<unknown> {
  try {
    await create(newSummary(columns));
  } catch (err) {
    return err;
  }

  throw new Error("The create was not refused.");
}

function updateBy(
  data: Record<string, unknown>,
): UpdateBy<WorkspaceNotificationSummary> {
  return {
    query: { _id: SUMMARY_ID.toString() },
    data: data,
    props: { isRoot: true },
    skip: 0,
    limit: 1,
  } as unknown as UpdateBy<WorkspaceNotificationSummary>;
}

async function updateRefusal(data: Record<string, unknown>): Promise<unknown> {
  try {
    await hooks.onBeforeUpdate(updateBy(data));
  } catch (err) {
    return err;
  }

  throw new Error("The update was not refused.");
}

function weekly(): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = EventInterval.Week;
  recurring.intervalCount = new PositiveNumber(1);
  return recurring;
}

let findBy: jest.SpyInstance<any, any>;

beforeEach(() => {
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  findBy = getJestSpyOn(
    WorkspaceNotificationSummaryService,
    "findBy",
  ).mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating a summary", () => {
  test("REGRESSION: with only blank channel names is refused, saying it has no channel", async () => {
    const refusal: unknown = await createRefusal({
      channelNames: [" ", ""],
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe(NO_CHANNELS);
    // A 400 for the API, like any bad write - not the send's own failure.
    expect(refusal).not.toBeInstanceOf(WorkspaceSummaryNotSendableException);
  });

  test("with no channel names, or a text of commas, or none at all (null), is refused the same way", async () => {
    for (const channelNames of [[], " , ,", null]) {
      const refusal: unknown = await createRefusal({
        channelNames: channelNames,
      });

      expect((refusal as Error).message).toBe(NO_CHANNELS);
    }
  });

  test("with nothing to include is refused, saying so", async () => {
    for (const summaryItems of [[], [" "], null]) {
      const refusal: unknown = await createRefusal({
        summaryItems: summaryItems,
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(NO_ITEMS);
    }
  });

  test("with neither: the channels are said first", async () => {
    const refusal: unknown = await createRefusal({
      channelNames: [],
      summaryItems: [],
    });

    expect((refusal as Error).message).toBe(NO_CHANNELS);
  });

  test("REGRESSION: with channel names sent as one text stores the list it names - not a channel per letter", async () => {
    const created: WorkspaceNotificationSummary = await create(
      newSummary({ channelNames: " #ops, engineering ,, " }),
    );

    expect(created.channelNames).toEqual(["#ops", "engineering"]);
    // The rest of the create goes on: it still gets its schedule.
    expect(created.recurringInterval).toBeInstanceOf(Recurring);
    expect(created.nextSendAt).toBeInstanceOf(Date);
  });

  test("with a list stores it trimmed, the blank names left out", async () => {
    const created: WorkspaceNotificationSummary = await create(
      newSummary({
        channelNames: [" #ops ", "", "#alerts"],
        summaryItems: [" Total Count "],
      }),
    );

    expect(created.channelNames).toEqual(["#ops", "#alerts"]);
    expect(created.summaryItems).toEqual(["Total Count"]);
  });

  test("without channel names or items leaves them to the check every create of a required column gets", async () => {
    const summary: WorkspaceNotificationSummary =
      new WorkspaceNotificationSummary();
    summary.name = "Weekly Incident Summary";

    const created: WorkspaceNotificationSummary = await create(summary);

    expect(created.channelNames).toBeUndefined();
    expect(created.summaryItems).toBeUndefined();
  });
});

describe("updating a summary", () => {
  test("REGRESSION: to only blank channel names is refused before anything is read", async () => {
    const refusal: unknown = await updateRefusal({ channelNames: ["  "] });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe(NO_CHANNELS);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("to no channel names (null), or nothing to include, is refused", async () => {
    expect(
      ((await updateRefusal({ channelNames: null })) as Error).message,
    ).toBe(NO_CHANNELS);
    expect(((await updateRefusal({ summaryItems: [] })) as Error).message).toBe(
      NO_ITEMS,
    );
    expect(
      ((await updateRefusal({ summaryItems: null })) as Error).message,
    ).toBe(NO_ITEMS);
  });

  test("that also reschedules it is refused all the same, before the schedule is read", async () => {
    const refusal: unknown = await updateRefusal({
      channelNames: [],
      recurringInterval: weekly(),
    });

    expect((refusal as Error).message).toBe(NO_CHANNELS);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("REGRESSION: with channel names sent as one text, as the dashboard's edit form sent them, writes the list they name", async () => {
    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(
        updateBy({ name: "Ops", channelNames: "#ops, #alerts" }),
      );

    expect(onUpdate.updateBy.data).toEqual({
      name: "Ops",
      channelNames: ["#ops", "#alerts"],
    });
    expect(findBy).not.toHaveBeenCalled();
  });

  test("of its channels alone is not refused for its items, which it leaves alone", async () => {
    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy({ channelNames: ["#alerts"] }));

    expect(onUpdate.updateBy.data).toEqual({ channelNames: ["#alerts"] });
  });

  test("that does not touch them - a new name, switching it off, the worker's next send - is never refused for them", async () => {
    for (const data of [
      { name: "Renamed" },
      { isEnabled: false },
      { nextSendAt: OneUptimeDate.fromString("2026-10-12T09:00:00.000Z") },
    ] as Array<Record<string, unknown>>) {
      const before: Record<string, unknown> = { ...data };

      const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
        await hooks.onBeforeUpdate(updateBy(data));

      expect(onUpdate.updateBy.data).toEqual(before);
    }
  });
});
