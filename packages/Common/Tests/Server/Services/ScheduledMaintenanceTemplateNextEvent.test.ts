import ScheduledMaintenanceTemplateService from "../../../Server/Services/ScheduledMaintenanceTemplateService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";
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
 * A SCHEDULED MAINTENANCE TEMPLATE THAT DOES NOT RECUR HAS NO NEXT EVENT.
 *
 * Turning Recurring Event off on a template left the time its next event
 * was due (scheduleNextEventAt) where it was. The job that creates the
 * events (ScheduleRecurringEvents) reads recurring templates only, so no
 * event came - but the templates list kept saying "Next event will be
 * scheduled at ...". ScheduledMaintenanceTemplateService now clears the
 * time whenever an update leaves a template not recurring, and keeps none on
 * a template created without the switch; the schedule itself stays, and
 * turning the switch back on schedules the next event again, at the
 * schedule's next time after now.
 *
 * This runs the whole update and create - the hooks, the permission checks
 * on what the hooks leave, the write - against a table in memory, as each
 * member who may edit a template and as OneUptime itself (the job). The
 * hook's own handling of an update over several templates is called
 * directly at the end.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_TEMPLATE_ID: string = "33333333-3333-4333-8333-333333333333";

const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

/*
 * Every time here is whole days away from the moment the suite loads, so the
 * few milliseconds between that moment and the hook's own clock read never
 * move a weekly schedule's next time.
 */
const LOADED_AT: number = Date.now();

function daysFromNow(days: number): Date {
  return new Date(LOADED_AT + days * DAY_IN_MS);
}

function weekly(): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = EventInterval.Week;
  recurring.intervalCount = new PositiveNumber(1);
  return recurring;
}

/*
 * A weekly schedule whose first event was created ten days ago: its events
 * were created then and four days ago, and the next one is created in four
 * days - two intervals after the first.
 */
const FIRST_EVENT_SCHEDULED_AT: Date = daysFromNow(-10);
const FIRST_EVENT_STARTS_AT: Date = daysFromNow(-8);
const FIRST_EVENT_ENDS_AT: Date = new Date(
  FIRST_EVENT_STARTS_AT.getTime() + 2 * HOUR_IN_MS,
);
const NEXT_EVENT_AT: Date = new Date(
  FIRST_EVENT_SCHEDULED_AT.getTime() + 14 * DAY_IN_MS,
);

// A time the template held before it was turned off.
const STALE_NEXT_EVENT_AT: Date = daysFromNow(-3);

function templateRow(fields: StoredRow): StoredRow {
  return {
    _id: TEMPLATE_ID,
    projectId: PROJECT_ID.toString(),
    templateName: "Weekly database patching",
    templateDescription: "Used for the Sunday patch window.",
    title: "Database patching",
    firstEventScheduledAt: FIRST_EVENT_SCHEDULED_AT,
    firstEventStartsAt: FIRST_EVENT_STARTS_AT,
    firstEventEndsAt: FIRST_EVENT_ENDS_AT,
    recurringInterval: weekly(),
    version: 1,
    ...fields,
  };
}

// A template running on its schedule.
const RECURRING: StoredRow = {
  isRecurringEvent: true,
  scheduleNextEventAt: NEXT_EVENT_AT,
};

// A template turned off before this fix: off, and still holding a time.
const TURNED_OFF_BEFORE: StoredRow = {
  isRecurringEvent: false,
  scheduleNextEventAt: STALE_NEXT_EVENT_AT,
};

// A template turned off since: off, with no time.
const TURNED_OFF: StoredRow = {
  isRecurringEvent: false,
  scheduleNextEventAt: null,
};

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

/*
 * Who may edit a template - the table's update list - and OneUptime itself,
 * which writes the next time from the job.
 */
const WRITERS: Array<[string, () => DatabaseCommonInteractionProps]> = [
  [
    "a project owner",
    (): DatabaseCommonInteractionProps => {
      return member([Permission.ProjectOwner]);
    },
  ],
  [
    "a project admin",
    (): DatabaseCommonInteractionProps => {
      return member([Permission.ProjectAdmin]);
    },
  ],
  [
    "a project member",
    (): DatabaseCommonInteractionProps => {
      return member([Permission.ProjectMember]);
    },
  ],
  [
    "a scheduled maintenance admin",
    (): DatabaseCommonInteractionProps => {
      return member([Permission.ScheduledMaintenanceAdmin]);
    },
  ],
  [
    "a scheduled maintenance member",
    (): DatabaseCommonInteractionProps => {
      return member([Permission.ScheduledMaintenanceMember]);
    },
  ],
  [
    "someone who may edit and read templates",
    (): DatabaseCommonInteractionProps => {
      return member([
        Permission.EditScheduledMaintenanceTemplate,
        Permission.ReadScheduledMaintenanceTemplate,
      ]);
    },
  ],
  [
    "OneUptime itself",
    (): DatabaseCommonInteractionProps => {
      return { isRoot: true };
    },
  ],
];

let table: InMemoryTable;

function useTable(rows: Array<StoredRow>): void {
  table = useInMemoryTable(ScheduledMaintenanceTemplateService, rows);
}

function stored(column: string, id: string = TEMPLATE_ID): unknown {
  return table.get(id)?.[column];
}

function storedTime(column: string, id: string = TEMPLATE_ID): string | null {
  const value: unknown = stored(column, id);

  return value instanceof Date ? value.toISOString() : (value as null);
}

async function update(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<void> {
  await ScheduledMaintenanceTemplateService.updateOneById({
    id: new ObjectID(TEMPLATE_ID),
    data: data as never,
    props: props,
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the write to be refused, but it went through.");
}

// The schedule a template keeps, whatever its switch: its first event and interval.
function storedSchedule(): Record<string, unknown> {
  return {
    firstEventScheduledAt: storedTime("firstEventScheduledAt"),
    firstEventStartsAt: storedTime("firstEventStartsAt"),
    firstEventEndsAt: storedTime("firstEventEndsAt"),
    recurringInterval: (stored("recurringInterval") as Recurring).toString(),
  };
}

const SCHEDULE: Record<string, unknown> = {
  firstEventScheduledAt: FIRST_EVENT_SCHEDULED_AT.toISOString(),
  firstEventStartsAt: FIRST_EVENT_STARTS_AT.toISOString(),
  firstEventEndsAt: FIRST_EVENT_ENDS_AT.toISOString(),
  recurringInterval: weekly().toString(),
};

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("turning Recurring Event off", () => {
  test.each(WRITERS)(
    "%s turns it off: the template has no next event, and keeps its schedule",
    async (_who: string, props: () => DatabaseCommonInteractionProps) => {
      useTable([templateRow(RECURRING)]);

      await update({ isRecurringEvent: false }, props());

      expect(stored("isRecurringEvent")).toBe(false);
      expect(stored("scheduleNextEventAt")).toBeNull();
      expect(storedSchedule()).toEqual(SCHEDULE);
    },
  );

  test("the Dashboard's Edit, which sends the schedule back as it was, turns it off the same way", async () => {
    useTable([templateRow(RECURRING)]);

    await update(
      {
        templateName: "Weekly database patching",
        isRecurringEvent: false,
        firstEventScheduledAt: FIRST_EVENT_SCHEDULED_AT,
        firstEventStartsAt: FIRST_EVENT_STARTS_AT,
        firstEventEndsAt: FIRST_EVENT_ENDS_AT,
        recurringInterval: weekly(),
      },
      member([Permission.ProjectMember]),
    );

    expect(stored("scheduleNextEventAt")).toBeNull();
    expect(storedSchedule()).toEqual(SCHEDULE);
  });

  test("a time sent with the switch off is not kept", async () => {
    useTable([templateRow(RECURRING)]);

    await update(
      { isRecurringEvent: false, scheduleNextEventAt: daysFromNow(2) },
      member([Permission.ProjectOwner]),
    );

    expect(stored("scheduleNextEventAt")).toBeNull();
  });

  test("a member who may not edit templates is refused, and the template keeps recurring", async () => {
    useTable([templateRow(RECURRING)]);

    const error: unknown = await refusalOf(
      update({ isRecurringEvent: false }, member([Permission.Viewer])),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(stored("isRecurringEvent")).toBe(true);
    expect(storedTime("scheduleNextEventAt")).toBe(NEXT_EVENT_AT.toISOString());
  });
});

describe("turning Recurring Event back on", () => {
  test.each(WRITERS)(
    "%s turns it back on: the next event is scheduled again, at the schedule's next time after now",
    async (_who: string, props: () => DatabaseCommonInteractionProps) => {
      useTable([templateRow(TURNED_OFF)]);

      await update({ isRecurringEvent: true }, props());

      expect(stored("isRecurringEvent")).toBe(true);
      expect(storedTime("scheduleNextEventAt")).toBe(
        NEXT_EVENT_AT.toISOString(),
      );
      expect(storedSchedule()).toEqual(SCHEDULE);
    },
  );

  test("the times it was off create no event: the next time is after now, a whole number of intervals after the first", async () => {
    useTable([templateRow(TURNED_OFF)]);

    await update({ isRecurringEvent: true }, member([Permission.ProjectAdmin]));

    const next: Date = stored("scheduleNextEventAt") as Date;
    const intervals: number =
      (next.getTime() - FIRST_EVENT_SCHEDULED_AT.getTime()) / (7 * DAY_IN_MS);

    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(intervals).toBe(2);
  });

  test("a template turned off before its first event picks up at that first event", async () => {
    const firstEventScheduledAt: Date = daysFromNow(3);

    useTable([
      templateRow({
        ...TURNED_OFF,
        firstEventScheduledAt: firstEventScheduledAt,
        firstEventStartsAt: daysFromNow(5),
        firstEventEndsAt: daysFromNow(6),
      }),
    ]);

    await update({ isRecurringEvent: true }, member([Permission.ProjectOwner]));

    expect(storedTime("scheduleNextEventAt")).toBe(
      firstEventScheduledAt.toISOString(),
    );
  });

  test("the Dashboard's Edit, which sends the kept schedule with the switch, schedules it the same way", async () => {
    useTable([templateRow(TURNED_OFF)]);

    await update(
      {
        isRecurringEvent: true,
        firstEventScheduledAt: FIRST_EVENT_SCHEDULED_AT,
        firstEventStartsAt: FIRST_EVENT_STARTS_AT,
        firstEventEndsAt: FIRST_EVENT_ENDS_AT,
        recurringInterval: weekly(),
      },
      member([Permission.ScheduledMaintenanceMember]),
    );

    expect(storedTime("scheduleNextEventAt")).toBe(
      NEXT_EVENT_AT.toISOString(),
    );
  });

  test("a template that never had a schedule is refused, and stays off", async () => {
    useTable([
      templateRow({
        ...TURNED_OFF,
        firstEventScheduledAt: null,
        firstEventStartsAt: null,
        firstEventEndsAt: null,
        recurringInterval: null,
      }),
    ]);

    const error: unknown = await refusalOf(
      update({ isRecurringEvent: true }, member([Permission.ProjectOwner])),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "First event scheduled at is required for recurring events.",
    );
    expect(stored("isRecurringEvent")).toBe(false);
    expect(stored("scheduleNextEventAt")).toBeNull();
  });
});

describe("any other edit", () => {
  test("of a template turned off before this fix clears the time it still held", async () => {
    useTable([templateRow(TURNED_OFF_BEFORE)]);

    await update(
      { templateName: "Monthly database patching" },
      member([Permission.ProjectMember]),
    );

    expect(stored("templateName")).toBe("Monthly database patching");
    expect(stored("scheduleNextEventAt")).toBeNull();
    expect(storedSchedule()).toEqual(SCHEDULE);
  });

  test("of a template that holds no time writes nothing more than it was sent", async () => {
    useTable([templateRow(TURNED_OFF)]);

    await update(
      { templateName: "Monthly database patching" },
      member([Permission.ProjectMember]),
    );

    expect(stored("templateName")).toBe("Monthly database patching");
    expect(table.updates).toHaveLength(1);
    expect(table.updates[0]!.set).not.toHaveProperty("scheduleNextEventAt");
  });

  test("turning off a template that is already off and holds no time writes only the switch", async () => {
    useTable([templateRow(TURNED_OFF)]);

    await update({ isRecurringEvent: false }, member([Permission.ProjectOwner]));

    expect(table.updates).toHaveLength(1);
    expect(table.updates[0]!.set).not.toHaveProperty("scheduleNextEventAt");
    expect(stored("scheduleNextEventAt")).toBeNull();
  });

  test("of a template that does not recur keeps no time it is sent", async () => {
    useTable([templateRow(TURNED_OFF)]);

    await update(
      { scheduleNextEventAt: daysFromNow(2) },
      member([Permission.ProjectOwner]),
    );

    expect(stored("scheduleNextEventAt")).toBeNull();
  });

  test("of a recurring template keeps its next event", async () => {
    useTable([templateRow(RECURRING)]);

    await update(
      { title: "Database and cache patching" },
      member([Permission.ProjectMember]),
    );

    expect(stored("title")).toBe("Database and cache patching");
    expect(stored("isRecurringEvent")).toBe(true);
    expect(storedTime("scheduleNextEventAt")).toBe(
      NEXT_EVENT_AT.toISOString(),
    );
  });
});

/*
 * The job moves a recurring template's next time on as OneUptime, then
 * creates the event. A template turned off between the job's read and its
 * write is left with no next time all the same.
 */
describe("the job's own write of the next time", () => {
  test("keeps a recurring template scheduled", async () => {
    useTable([templateRow(RECURRING)]);

    await update({ scheduleNextEventAt: daysFromNow(11) }, { isRoot: true });

    expect(stored("isRecurringEvent")).toBe(true);
    expect(stored("scheduleNextEventAt")).toBeInstanceOf(Date);
    expect((stored("scheduleNextEventAt") as Date).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  test("leaves a template turned off in the meantime with no next time", async () => {
    useTable([templateRow(TURNED_OFF)]);

    await update({ scheduleNextEventAt: daysFromNow(11) }, { isRoot: true });

    expect(stored("isRecurringEvent")).toBe(false);
    expect(stored("scheduleNextEventAt")).toBeNull();
  });
});

describe("creating a template", () => {
  async function create(
    fields: Record<string, unknown>,
  ): Promise<StoredRow | undefined> {
    useTable([]);

    const template: ScheduledMaintenanceTemplate =
      new ScheduledMaintenanceTemplate();

    Object.assign(template, {
      projectId: PROJECT_ID,
      templateName: "Weekly database patching",
      templateDescription: "Used for the Sunday patch window.",
      title: "Database patching",
      ...fields,
    });

    await ScheduledMaintenanceTemplateService.create({
      data: template,
      props: member([Permission.ProjectOwner]),
    });

    expect(table.inserts).toHaveLength(1);

    return table.inserts[0];
  }

  test("without Recurring Event keeps no next time it is sent", async () => {
    const row: StoredRow | undefined = await create({
      isRecurringEvent: false,
      scheduleNextEventAt: daysFromNow(2),
    });

    expect(row?.["isRecurringEvent"]).toBe(false);
    expect(row?.["scheduleNextEventAt"]).toBeUndefined();
  });

  test("without the switch at all keeps no next time either", async () => {
    const row: StoredRow | undefined = await create({
      scheduleNextEventAt: daysFromNow(2),
    });

    expect(row?.["scheduleNextEventAt"]).toBeUndefined();
  });

  test("with Recurring Event on schedules its first event", async () => {
    const firstEventScheduledAt: Date = daysFromNow(2);

    const row: StoredRow | undefined = await create({
      isRecurringEvent: true,
      firstEventScheduledAt: firstEventScheduledAt,
      firstEventStartsAt: daysFromNow(4),
      firstEventEndsAt: daysFromNow(5),
      recurringInterval: weekly(),
    });

    expect(row?.["isRecurringEvent"]).toBe(true);
    expect((row?.["scheduleNextEventAt"] as Date).toISOString()).toBe(
      firstEventScheduledAt.toISOString(),
    );
  });
});

/*
 * The hook alone, over an update of several templates: the API updates one
 * template at a time, but an update by query writes every template it
 * matches with the same data, so the time is cleared only when none of
 * them recurs - never under a template that still does.
 */
describe("an update of several templates", () => {
  interface UpdateHooks {
    onBeforeUpdate(
      updateBy: UpdateBy<ScheduledMaintenanceTemplate>,
    ): Promise<OnUpdate<ScheduledMaintenanceTemplate>>;
  }

  const hooks: UpdateHooks =
    ScheduledMaintenanceTemplateService as unknown as UpdateHooks;

  async function hookedData(
    rows: Array<StoredRow>,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    stubRowsCallerMayWriteLikeFindBy(
      ScheduledMaintenanceTemplateService,
      jest
        .spyOn(ScheduledMaintenanceTemplateService, "findBy")
        .mockImplementation((async (): Promise<
          Array<ScheduledMaintenanceTemplate>
        > => {
          return rows.map((row: StoredRow): ScheduledMaintenanceTemplate => {
            const template: ScheduledMaintenanceTemplate =
              new ScheduledMaintenanceTemplate();

            Object.assign(template, row);

            return template;
          });
        }) as never),
    );

    const updateBy: UpdateBy<ScheduledMaintenanceTemplate> = {
      query: { projectId: PROJECT_ID },
      data: data as never,
      props: { isRoot: true },
      limit: 100,
      skip: 0,
    } as unknown as UpdateBy<ScheduledMaintenanceTemplate>;

    await hooks.onBeforeUpdate(updateBy);

    return updateBy.data as unknown as Record<string, unknown>;
  }

  test("none of which recurs: their times are cleared", async () => {
    const data: Record<string, unknown> = await hookedData(
      [
        templateRow(TURNED_OFF_BEFORE),
        templateRow({ ...TURNED_OFF_BEFORE, _id: OTHER_TEMPLATE_ID }),
      ],
      { templateDescription: "Patching windows." },
    );

    expect(data["scheduleNextEventAt"]).toBeNull();
  });

  test("all turned off by the update: their times are cleared", async () => {
    const data: Record<string, unknown> = await hookedData(
      [
        templateRow(RECURRING),
        templateRow({ ...RECURRING, _id: OTHER_TEMPLATE_ID }),
      ],
      { isRecurringEvent: false },
    );

    expect(data["scheduleNextEventAt"]).toBeNull();
  });

  test("one of which still recurs: no time is cleared under it", async () => {
    const data: Record<string, unknown> = await hookedData(
      [
        templateRow(TURNED_OFF_BEFORE),
        templateRow({ ...RECURRING, _id: OTHER_TEMPLATE_ID }),
      ],
      { templateDescription: "Patching windows." },
    );

    expect(data["scheduleNextEventAt"]).toBeInstanceOf(Date);
  });

  test("none of which recurs or holds a time: the update writes nothing more", async () => {
    const data: Record<string, unknown> = await hookedData(
      [
        templateRow(TURNED_OFF),
        templateRow({ ...TURNED_OFF, _id: OTHER_TEMPLATE_ID }),
      ],
      { templateDescription: "Patching windows." },
    );

    expect(Object.keys(data)).toEqual(["templateDescription"]);
  });

  test("none of which recurs, one holding a time: their times are cleared", async () => {
    const data: Record<string, unknown> = await hookedData(
      [
        templateRow(TURNED_OFF),
        templateRow({ ...TURNED_OFF_BEFORE, _id: OTHER_TEMPLATE_ID }),
      ],
      { templateDescription: "Patching windows." },
    );

    expect(data["scheduleNextEventAt"]).toBeNull();
  });

  test("none at all: the update writes nothing more", async () => {
    const data: Record<string, unknown> = await hookedData([], {
      isRecurringEvent: false,
    });

    expect(Object.keys(data)).toEqual(["isRecurringEvent"]);
  });
});
