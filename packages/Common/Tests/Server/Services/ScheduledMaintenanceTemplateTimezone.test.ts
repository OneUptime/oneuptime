import ScheduledMaintenanceTemplateService, {
  TIMEZONE_NOT_A_TIME_ZONE,
} from "../../../Server/Services/ScheduledMaintenanceTemplateService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import Timezone from "../../../Types/Timezone";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import moment from "moment-timezone";

/*
 * A SCHEDULED MAINTENANCE TEMPLATE'S TIME ZONE (#10037).
 *
 * A template's events are its first event moved on whole intervals of its
 * own time zone's calendar (MaintenanceTemplateSchedule), so the zone is
 * part of its schedule. The service:
 *
 *   - gives a new template the zone it is sent - as the caller spelled it,
 *     a legacy name included, so Terraform reads back what it wrote - else
 *     the zone in the creator's profile, the clock the dashboard showed
 *     them, under the name the picker offers; else UTC, for a template no
 *     person creates (an API key, a workflow);
 *   - refuses a name that is no time zone, and reads a zone sent as
 *     nothing as UTC;
 *   - works the next event out on the template's clock whenever it is
 *     saved, the job's own write included.
 *
 * This runs the whole create and update - hooks, permission checks, the
 * write - against a table in memory, on 19 November 2026.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: string = "22222222-2222-4222-8222-222222222222";
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

function weekly(): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = EventInterval.Week;
  recurring.intervalCount = new PositiveNumber(1);
  return recurring;
}

function at(wallClock: string, zone: string): Date {
  return moment.tz(wallClock, "YYYY-MM-DD HH:mm", true, zone).toDate();
}

function wallClockOf(instant: unknown, zone: string): string {
  return moment.tz(instant as Date, zone).format("YYYY-MM-DD HH:mm z");
}

function member(
  permissions: Array<Permission> = [Permission.ProjectOwner],
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
    userId: USER_ID,
  };
}

// An API key: no person.
function apiKey(): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: [Permission.ProjectOwner],
      projectId: PROJECT_ID,
      isApiKey: true,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

/*
 * A weekly window typed in Berlin in July: created Monday 09:00 (CEST) for
 * Saturday 02:00 to 04:00. Its next event on 19 November is Monday 23
 * November, at 09:00 there - on winter time, 08:00 UTC.
 */
const JULY_SCHEDULE: StoredRow = {
  firstEventScheduledAt: at("2026-07-06 09:00", Timezone.EuropeBerlin),
  firstEventStartsAt: at("2026-07-11 02:00", Timezone.EuropeBerlin),
  firstEventEndsAt: at("2026-07-11 04:00", Timezone.EuropeBerlin),
  recurringInterval: weekly(),
};

let table: InMemoryTable;

function templateRow(fields: StoredRow): StoredRow {
  return {
    _id: TEMPLATE_ID,
    projectId: PROJECT_ID.toString(),
    templateName: "Saturday patching",
    templateDescription: "Used for the Saturday patch window.",
    title: "Database patching",
    isRecurringEvent: true,
    version: 1,
    ...JULY_SCHEDULE,
    ...fields,
  };
}

function stored(column: string): unknown {
  return table.get(TEMPLATE_ID)?.[column];
}

async function update(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = member(),
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

let profileTimezone: string | undefined = undefined;

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ["nextTick", "queueMicrotask", "setImmediate"],
  });

  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});

  profileTimezone = undefined;

  getJestSpyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<User | null> => {
    if (data.id.toString() !== USER_ID.toString()) {
      return null;
    }

    const user: User = new User();
    user._id = USER_ID.toString();

    if (profileTimezone) {
      user.timezone = profileTimezone as Timezone;
    }

    return user;
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("creating a template", () => {
  // A recurring template whose first event is created in two days.
  function newTemplate(
    fields: Record<string, unknown>,
  ): ScheduledMaintenanceTemplate {
    const template: ScheduledMaintenanceTemplate =
      new ScheduledMaintenanceTemplate();

    Object.assign(template, {
      projectId: PROJECT_ID,
      templateName: "Saturday patching",
      templateDescription: "Used for the Saturday patch window.",
      title: "Database patching",
      isRecurringEvent: true,
      firstEventScheduledAt: new Date("2026-11-21T09:00:00.000Z"),
      firstEventStartsAt: new Date("2026-11-22T02:00:00.000Z"),
      firstEventEndsAt: new Date("2026-11-22T04:00:00.000Z"),
      recurringInterval: weekly(),
      ...fields,
    });

    return template;
  }

  async function create(
    fields: Record<string, unknown>,
    props: DatabaseCommonInteractionProps = member(),
  ): Promise<StoredRow | undefined> {
    table = useInMemoryTable(ScheduledMaintenanceTemplateService, []);

    await ScheduledMaintenanceTemplateService.create({
      data: newTemplate(fields),
      props: props,
    });

    expect(table.inserts).toHaveLength(1);

    return table.inserts[0];
  }

  test.each([
    ["Europe/Berlin", "Europe/Berlin"],
    ["America/Vancouver", "America/Vancouver"],
    // A legacy name is kept as sent: what an API caller reads back.
    ["US/Eastern", "US/Eastern"],
    // Another spelling of a name is the name.
    [" europe/berlin ", "Europe/Berlin"],
  ])(
    "sent %j, it keeps %j, whatever the creator's profile says",
    async (sent: string, kept: string) => {
      profileTimezone = "Asia/Tokyo";

      const row: StoredRow | undefined = await create({ timezone: sent });

      expect(row?.["timezone"]).toBe(kept);
    },
  );

  test("sent none, it takes the time zone in its creator's profile, under the name the picker offers", async () => {
    profileTimezone = "Asia/Calcutta";

    const row: StoredRow | undefined = await create({});

    expect(row?.["timezone"]).toBe("Asia/Kolkata");
  });

  test("sent none by a creator who has none, it is read in UTC", async () => {
    const row: StoredRow | undefined = await create({});

    expect(row?.["timezone"]).toBe(Timezone.UTC);
  });

  test("sent none by an API key, it is read in UTC, and nobody's profile is read", async () => {
    profileTimezone = "Asia/Tokyo";

    const row: StoredRow | undefined = await create({}, apiKey());

    expect(row?.["timezone"]).toBe(Timezone.UTC);
    expect(UserService.findOneById).not.toHaveBeenCalled();
  });

  test("sent as nothing, it is the creator's too", async () => {
    profileTimezone = "Europe/Berlin";

    expect((await create({ timezone: null }))?.["timezone"]).toBe(
      "Europe/Berlin",
    );
    expect((await create({ timezone: "" }))?.["timezone"]).toBe(
      "Europe/Berlin",
    );
  });

  test("a template that does not recur gets one as well, for the day it is turned on", async () => {
    profileTimezone = "Europe/Berlin";

    const row: StoredRow | undefined = await create({
      isRecurringEvent: false,
    });

    expect(row?.["timezone"]).toBe("Europe/Berlin");
    expect(row?.["scheduleNextEventAt"]).toBeUndefined();
  });

  test("a name that is no time zone is refused, saying what to send, and nothing is saved", async () => {
    table = useInMemoryTable(ScheduledMaintenanceTemplateService, []);

    const error: unknown = await refusalOf(
      ScheduledMaintenanceTemplateService.create({
        data: newTemplate({ timezone: "Europe/Atlantis" }),
        props: member(),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(TIMEZONE_NOT_A_TIME_ZONE);
    expect(TIMEZONE_NOT_A_TIME_ZONE).toContain('"Europe/Berlin"');
    expect(table.inserts).toEqual([]);
  });

  test("its first event is its next one, as sent", async () => {
    const row: StoredRow | undefined = await create({
      timezone: Timezone.EuropeBerlin,
    });

    expect((row?.["scheduleNextEventAt"] as Date).toISOString()).toBe(
      "2026-11-21T09:00:00.000Z",
    );
  });
});

describe("updating a template", () => {
  test("turned back on in Berlin, its next event is on Berlin's clock: 09:00 on winter time, 08:00 UTC", async () => {
    table = useInMemoryTable(ScheduledMaintenanceTemplateService, [
      templateRow({
        isRecurringEvent: false,
        timezone: Timezone.EuropeBerlin,
        scheduleNextEventAt: null,
      }),
    ]);

    await update({ isRecurringEvent: true });

    expect(
      wallClockOf(stored("scheduleNextEventAt"), Timezone.EuropeBerlin),
    ).toBe("2026-11-23 09:00 CET");
  });

  /*
   * What the migration gives every template saved before: UTC, the clock the
   * old steps of 7 x 24 hours were - so its next event stays where it was,
   * 07:00 UTC, which is 08:00 in Berlin for the winter.
   */
  test("a template on UTC, as every template saved before is, keeps its next event where the old steps had it", async () => {
    table = useInMemoryTable(ScheduledMaintenanceTemplateService, [
      templateRow({
        timezone: Timezone.UTC,
        scheduleNextEventAt: new Date("2026-11-23T07:00:00.000Z"),
      }),
    ]);

    await update({ title: "Database and cache patching" });

    expect((stored("scheduleNextEventAt") as Date).toISOString()).toBe(
      "2026-11-23T07:00:00.000Z",
    );
    expect(stored("timezone")).toBe(Timezone.UTC);
  });

  test("set to Berlin, the same template's next event moves to 09:00 there, where it was typed", async () => {
    table = useInMemoryTable(ScheduledMaintenanceTemplateService, [
      templateRow({
        timezone: Timezone.UTC,
        scheduleNextEventAt: new Date("2026-11-23T07:00:00.000Z"),
      }),
    ]);

    await update({ timezone: Timezone.EuropeBerlin });

    expect(stored("timezone")).toBe(Timezone.EuropeBerlin);
    expect((stored("scheduleNextEventAt") as Date).toISOString()).toBe(
      "2026-11-23T08:00:00.000Z",
    );
  });

  test("the Dashboard's Edit, which sends the whole schedule back, works it out the same way", async () => {
    table = useInMemoryTable(ScheduledMaintenanceTemplateService, [
      templateRow({
        timezone: Timezone.UTC,
        scheduleNextEventAt: new Date("2026-11-23T07:00:00.000Z"),
      }),
    ]);

    await update({
      ...JULY_SCHEDULE,
      isRecurringEvent: true,
      timezone: Timezone.EuropeBerlin,
    });

    expect((stored("scheduleNextEventAt") as Date).toISOString()).toBe(
      "2026-11-23T08:00:00.000Z",
    );
  });

  test("sent as nothing, it is UTC again", async () => {
    table = useInMemoryTable(ScheduledMaintenanceTemplateService, [
      templateRow({
        timezone: Timezone.EuropeBerlin,
        scheduleNextEventAt: new Date("2026-11-23T08:00:00.000Z"),
      }),
    ]);

    await update({ timezone: null });

    expect(stored("timezone")).toBe(Timezone.UTC);
    expect((stored("scheduleNextEventAt") as Date).toISOString()).toBe(
      "2026-11-23T07:00:00.000Z",
    );
  });

  test("a name that is no time zone is refused, and the template is left as it was", async () => {
    table = useInMemoryTable(ScheduledMaintenanceTemplateService, [
      templateRow({
        timezone: Timezone.EuropeBerlin,
        scheduleNextEventAt: new Date("2026-11-23T08:00:00.000Z"),
      }),
    ]);

    const error: unknown = await refusalOf(
      update({ timezone: "Mars/Olympus" }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(TIMEZONE_NOT_A_TIME_ZONE);
    expect(table.updates).toEqual([]);
    expect(stored("timezone")).toBe(Timezone.EuropeBerlin);
  });

  /*
   * The job moves the next time on as OneUptime once it has created the
   * event, and the hook works it out again from the template's own
   * schedule: on its own clock.
   */
  test("the job's own write is worked out on the template's clock too", async () => {
    table = useInMemoryTable(ScheduledMaintenanceTemplateService, [
      templateRow({
        timezone: Timezone.EuropeBerlin,
        scheduleNextEventAt: new Date("2026-11-16T08:00:00.000Z"),
      }),
    ]);

    await update(
      { scheduleNextEventAt: new Date("2026-11-23T08:00:00.000Z") },
      { isRoot: true },
    );

    expect((stored("scheduleNextEventAt") as Date).toISOString()).toBe(
      "2026-11-23T08:00:00.000Z",
    );
  });

  test("in Vancouver, on UTC-7 since 1 November, an event created at 22:00 in July is still created at 22:00 there", async () => {
    table = useInMemoryTable(ScheduledMaintenanceTemplateService, [
      templateRow({
        firstEventScheduledAt: at(
          "2026-07-03 22:00",
          Timezone.AmericaVancouver,
        ),
        firstEventStartsAt: at("2026-07-04 02:00", Timezone.AmericaVancouver),
        firstEventEndsAt: at("2026-07-04 04:00", Timezone.AmericaVancouver),
        timezone: Timezone.AmericaVancouver,
        isRecurringEvent: false,
        scheduleNextEventAt: null,
      }),
    ]);

    await update({ isRecurringEvent: true });

    expect(
      wallClockOf(stored("scheduleNextEventAt"), Timezone.AmericaVancouver),
    ).toBe("2026-11-20 22:00 MST");
  });
});
