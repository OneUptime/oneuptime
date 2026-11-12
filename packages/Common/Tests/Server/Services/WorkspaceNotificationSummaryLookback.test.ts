import WorkspaceNotificationSummaryService from "../../../Server/Services/WorkspaceNotificationSummaryService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceNotificationSummaryItem from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import { WORKSPACE_SUMMARY_LOOKBACK_REASON } from "../../../Utils/Workspace/WorkspaceSummarySetup";
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
 * #7352: A WORKSPACE SUMMARY'S LOOKBACK PERIOD (DAYS), held by
 * WorkspaceNotificationSummaryService - its create and update hooks, run
 * directly with the database read stubbed, and the report it builds.
 *
 * Nothing held it. 0 was refused on create as "numberOfDaysOfData is
 * required" and saved by an edit, after which the summary covered 7 days
 * while the summaries table said 0. -5 was saved, and every summary then
 * covered a window in the future - "from Oct 10 to Oct 05" - so it always
 * said nothing had happened. A part of a day reached the integer column
 * and came back as a database error. Now every create and edit is held to
 * a whole number of days from 1 to 365, and a summary stored before with
 * less than a day covers 7, one with more than a year covers a year.
 *
 * "Now" is Monday 5 Oct 2026, 12:00 UTC.
 */

const NOW: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID(
  "73520000-0000-4000-8000-000000000001",
);

const SUMMARY_ID: ObjectID = new ObjectID(
  "73520000-0000-4000-8000-000000000002",
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

type Block = { _type: string; text?: string };

type MessageBuilder = {
  buildSummaryMessageBlocks: (data: {
    summary: WorkspaceNotificationSummary;
  }) => Promise<Array<Block>>;
};

const builder: MessageBuilder =
  WorkspaceNotificationSummaryService as unknown as MessageBuilder;

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

// What a create saves, after its hooks: OneUptime's own create, or a member's.
async function create(
  columns: Record<string, unknown>,
  props: Record<string, unknown> = { isRoot: true },
): Promise<WorkspaceNotificationSummary> {
  const onCreate: OnCreate<WorkspaceNotificationSummary> =
    await hooks.onBeforeCreate({
      data: newSummary(columns),
      props: props,
    } as unknown as CreateBy<WorkspaceNotificationSummary>);

  return onCreate.createBy.data;
}

async function createRefusal(
  columns: Record<string, unknown>,
  props?: Record<string, unknown>,
): Promise<unknown> {
  try {
    await create(columns, props);
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

let findBy: ReturnType<typeof getJestSpyOn>;

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
  test.each([
    [0],
    [-5],
    [-1],
    [1.5],
    [366],
    ["0"],
    ["-5"],
    ["seven"],
    [""],
    [null],
  ])(
    "with a Lookback Period of %p is refused, in the field's words",
    async (days: unknown) => {
      const refusal: unknown = await createRefusal({
        numberOfDaysOfData: days,
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(
        WORKSPACE_SUMMARY_LOOKBACK_REASON,
      );
    },
  );

  test("REGRESSION: 0 is no longer refused by the column's name", async () => {
    const refusal: unknown = await createRefusal({ numberOfDaysOfData: 0 });

    expect((refusal as Error).message).not.toContain("numberOfDaysOfData");
    expect((refusal as Error).message).toBe(
      "Lookback Period (Days) must be a whole number of days from 1 to 365 (a year).",
    );
  });

  test("by a member of the project is held to it as OneUptime's own create is", async () => {
    const refusal: unknown = await createRefusal(
      { numberOfDaysOfData: -5, timezone: "Europe/Berlin" },
      {
        tenantId: PROJECT_ID,
        userId: new ObjectID("73520000-0000-4000-8000-000000000003"),
      },
    );

    expect((refusal as Error).message).toBe(WORKSPACE_SUMMARY_LOOKBACK_REASON);
  });

  test.each([
    [1, 1],
    [7, 7],
    [30, 30],
    [365, 365],
    ["14", 14],
    [" 90 ", 90],
  ])(
    "with a Lookback Period of %p stores %p days",
    async (days: unknown, stored: number) => {
      const created: WorkspaceNotificationSummary = await create({
        numberOfDaysOfData: days,
      });

      expect(created.numberOfDaysOfData).toBe(stored);
      // The rest of the create goes on: it still gets its schedule.
      expect(created.nextSendAt).toBeInstanceOf(Date);
    },
  );

  test("without a Lookback Period - through the API - covers the last 7 days, as the form starts on: no longer refused as numberOfDaysOfData is required", async () => {
    const created: WorkspaceNotificationSummary = await create({});

    expect(created.numberOfDaysOfData).toBe(7);
  });

  test("with the channels wrong as well: the channels are said first", async () => {
    const refusal: unknown = await createRefusal({
      channelNames: [],
      numberOfDaysOfData: -5,
    });

    expect((refusal as Error).message).toBe(
      "The summary has no channel to post in.",
    );
  });
});

describe("updating a summary", () => {
  test.each([[0], [-5], [1.5], [366], ["-5"], [null]])(
    "to a Lookback Period of %p is refused before anything is read",
    async (days: unknown) => {
      const refusal: unknown = await updateRefusal({
        numberOfDaysOfData: days,
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(
        WORKSPACE_SUMMARY_LOOKBACK_REASON,
      );
      expect(findBy).not.toHaveBeenCalled();
    },
  );

  test("REGRESSION: to 0 is refused: an edit saved it, and the summary covered 7 days while the table said 0", async () => {
    const refusal: unknown = await updateRefusal({ numberOfDaysOfData: 0 });

    expect((refusal as Error).message).toBe(WORKSPACE_SUMMARY_LOOKBACK_REASON);
  });

  test("to a Lookback Period sent as text writes the number of days", async () => {
    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy({ numberOfDaysOfData: "30" }));

    expect(onUpdate.updateBy.data).toEqual({ numberOfDaysOfData: 30 });
  });

  test("that does not touch it - a rename - is never refused for it, even for a summary stored with -5", async () => {
    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy({ name: "Ops" }));

    expect(onUpdate.updateBy.data).toEqual({ name: "Ops" });
  });

  test("a summary stored with -5 can be put right", async () => {
    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy({ numberOfDaysOfData: 7 }));

    expect(onUpdate.updateBy.data).toEqual({ numberOfDaysOfData: 7 });
  });
});

describe("the summary's report, for the days it covers", () => {
  let incidentBlocks: ReturnType<typeof getJestSpyOn>;

  function storedWith(days: number | undefined): WorkspaceNotificationSummary {
    const summary: WorkspaceNotificationSummary =
      new WorkspaceNotificationSummary();
    summary.name = "Weekly Incident Summary";
    summary.projectId = PROJECT_ID;
    summary.summaryType = WorkspaceNotificationSummaryType.Incident;
    summary.summaryItems = [];

    if (days !== undefined) {
      summary.numberOfDaysOfData = days;
    }

    return summary;
  }

  // The report: its title, its reporting period, and the date it reads from.
  async function report(days: number | undefined): Promise<{
    title: string;
    period: string;
    fromDate: Date;
  }> {
    const blocks: Array<Block> = await builder.buildSummaryMessageBlocks({
      summary: storedWith(days),
    });

    const listData: Record<string, unknown> = incidentBlocks.mock
      .calls[0]![0] as Record<string, unknown>;

    return {
      title: blocks[0]!.text || "",
      period:
        blocks.find((block: Block): boolean => {
          return Boolean(block.text?.includes("Reporting period"));
        })?.text || "",
      fromDate: listData["fromDate"] as Date,
    };
  }

  beforeEach(() => {
    incidentBlocks = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "buildIncidentBlocks",
    ).mockResolvedValue(undefined as never);
  });

  test("a summary of 7 days covers the 7 days before now", async () => {
    const shown: { title: string; period: string; fromDate: Date } =
      await report(7);

    expect(shown.title).toBe("Incident Summary — Sep 28, 2026 to Oct 05, 2026");
    expect(shown.period).toBe("_Reporting period: **7** days_");
    expect(shown.fromDate).toEqual(OneUptimeDate.addRemoveDays(NOW, -7));
  });

  test("a summary of 1 day says day, not days", async () => {
    const shown: { title: string; period: string; fromDate: Date } =
      await report(1);

    expect(shown.title).toBe("Incident Summary — Oct 04, 2026 to Oct 05, 2026");
    expect(shown.period).toBe("_Reporting period: **1** day_");
  });

  test("REGRESSION: one stored with -5 covers the last 7 days - not a window in the future, which always said nothing happened", async () => {
    const shown: { title: string; period: string; fromDate: Date } =
      await report(-5);

    expect(shown.fromDate.getTime()).toBeLessThan(NOW.getTime());
    expect(shown.fromDate).toEqual(OneUptimeDate.addRemoveDays(NOW, -7));
    expect(shown.title).toBe("Incident Summary — Sep 28, 2026 to Oct 05, 2026");
    expect(shown.period).toBe("_Reporting period: **7** days_");
  });

  test("one stored with 0, or with none, covers the last 7 days", async () => {
    for (const days of [0, undefined]) {
      incidentBlocks.mockClear();

      const shown: { title: string; period: string; fromDate: Date } =
        await report(days);

      expect(shown.period).toBe("_Reporting period: **7** days_");
      expect(shown.fromDate).toEqual(OneUptimeDate.addRemoveDays(NOW, -7));
    }
  });

  test("one stored with more than a year covers a year", async () => {
    const shown: { title: string; period: string; fromDate: Date } =
      await report(400);

    expect(shown.period).toBe("_Reporting period: **365** days_");
    expect(shown.fromDate).toEqual(OneUptimeDate.addRemoveDays(NOW, -365));
  });
});
