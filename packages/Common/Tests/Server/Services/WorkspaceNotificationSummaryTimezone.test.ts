import WorkspaceNotificationSummaryService from "../../../Server/Services/WorkspaceNotificationSummaryService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Timezone from "../../../Types/Timezone";
import UserType from "../../../Types/UserType";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
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
 * A workspace summary's time zone, as the summary service stores it: the
 * create and update hooks of WorkspaceNotificationSummaryService, run
 * directly, with the database reads stubbed.
 *
 * A summary's schedule stepped in UTC, as it had no time zone: one set for
 * 09:00 in Berlin went out at 08:00 there after the clocks went back. A
 * summary now has a time zone, and its schedule is read on that clock:
 *
 *   - a create that names one keeps it (a name that is not a time zone is
 *     refused, with how to send one);
 *   - a create that names none takes its creator's - the time zone in the
 *     profile of the person creating it - or UTC when no person creates it
 *     (an API key, a workflow), and the default first summary is 09:00
 *     there;
 *   - an update that changes it moves the next send to the schedule's time
 *     of day on the new clock; one that sends it back unchanged moves
 *     nothing.
 *
 * And the data migration's backfill: summaries made before summaries had a
 * time zone take their creator's, else UTC, without moving a next send.
 *
 * "Now" is Monday 5 Oct 2026, 12:00 UTC: 14:00 in Berlin, 08:00 in New York.
 */

const NOW: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");

const SUMMARY_ID: ObjectID = new ObjectID(
  "2b000000-0000-4000-8000-000000000001",
);
const OTHER_SUMMARY_ID: ObjectID = new ObjectID(
  "2b000000-0000-4000-8000-000000000002",
);
const THIRD_SUMMARY_ID: ObjectID = new ObjectID(
  "2b000000-0000-4000-8000-000000000003",
);
const PERSON_ID: ObjectID = new ObjectID(
  "2b000000-0000-4000-8000-0000000000a1",
);
const OTHER_PERSON_ID: ObjectID = new ObjectID(
  "2b000000-0000-4000-8000-0000000000a2",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "2b000000-0000-4000-8000-0000000000b1",
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

// A person signed in to the project, as the API's props carry them.
function person(id: ObjectID): DatabaseCommonInteractionProps {
  return {
    userId: id,
    userType: UserType.User,
    tenantId: PROJECT_ID,
  };
}

// An API key: no person behind it.
const API_KEY: DatabaseCommonInteractionProps = {
  userType: UserType.API,
  tenantId: PROJECT_ID,
};

function newSummary(
  columns: Partial<
    Pick<
      WorkspaceNotificationSummary,
      "recurringInterval" | "sendFirstReportAt" | "nextSendAt"
    >
  > & { timezone?: unknown },
): WorkspaceNotificationSummary {
  const summary: WorkspaceNotificationSummary =
    new WorkspaceNotificationSummary();
  summary.name = "Weekly Incident Summary";
  Object.assign(summary, columns);
  return summary;
}

async function create(
  summary: WorkspaceNotificationSummary,
  props: DatabaseCommonInteractionProps,
): Promise<WorkspaceNotificationSummary> {
  const onCreate: OnCreate<WorkspaceNotificationSummary> =
    await hooks.onBeforeCreate({
      data: summary,
      props: props,
    });

  return onCreate.createBy.data;
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

function stored(
  id: ObjectID,
  columns: Partial<
    Pick<
      WorkspaceNotificationSummary,
      | "recurringInterval"
      | "sendFirstReportAt"
      | "nextSendAt"
      | "isEnabled"
      | "createdByUserId"
    >
  > & { timezone?: string | null },
): WorkspaceNotificationSummary {
  const summary: WorkspaceNotificationSummary =
    new WorkspaceNotificationSummary();
  summary._id = id.toString();
  Object.assign(summary, columns);
  return summary;
}

function profile(id: ObjectID, timezone: string | null): User {
  const user: User = new User();
  user._id = id.toString();
  (user as unknown as { timezone: string | null }).timezone = timezone;
  return user;
}

let userTimezones: Record<string, string | null> = {};

beforeEach(() => {
  userTimezones = {};
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  // The profiles the hooks read: by id, with the time zone each one holds.
  getJestSpyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<User | null> => {
    const id: string = data.id.toString();

    return id in userTimezones ? profile(data.id, userTimezones[id]!) : null;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating a summary through the API", () => {
  test("keeps the time zone it names, and starts it at 09:00 there", async () => {
    userTimezones[PERSON_ID.toString()] = "Europe/Berlin";

    const created: WorkspaceNotificationSummary = await create(
      newSummary({ timezone: "America/New_York" }),
      person(PERSON_ID),
    );

    expect(created.timezone).toBe("America/New_York");
    // This Monday, 09:00 EDT: it is 08:00 in New York.
    expect(iso(created.sendFirstReportAt)).toBe("2026-10-05T13:00:00.000Z");
    expect(iso(created.nextSendAt)).toBe("2026-10-05T13:00:00.000Z");
    // It named one: the creator's is not read.
    expect(UserService.findOneById).not.toHaveBeenCalled();
  });

  test("without one, from a person, takes the time zone in their profile", async () => {
    userTimezones[PERSON_ID.toString()] = "Europe/Berlin";

    const created: WorkspaceNotificationSummary = await create(
      newSummary({}),
      person(PERSON_ID),
    );

    expect(created.timezone).toBe("Europe/Berlin");
    // Next Monday, 09:00 CEST.
    expect(iso(created.sendFirstReportAt)).toBe("2026-10-12T07:00:00.000Z");
    expect(iso(created.nextSendAt)).toBe("2026-10-12T07:00:00.000Z");

    // The person's own profile, read with root props (only they may read it).
    const read: Record<string, any> = (
      UserService.findOneById as unknown as jest.Mock
    ).mock.calls[0]![0] as Record<string, any>;
    expect(read["id"].toString()).toBe(PERSON_ID.toString());
    expect(read["select"]).toEqual({ timezone: true });
    expect(read["props"]).toEqual({ isRoot: true });
  });

  test("without one, from a person whose profile holds a legacy name, takes the name the dashboard offers", async () => {
    userTimezones[PERSON_ID.toString()] = "Asia/Calcutta";

    const created: WorkspaceNotificationSummary = await create(
      newSummary({}),
      person(PERSON_ID),
    );

    expect(created.timezone).toBe("Asia/Kolkata");
  });

  test("without one, from an API key, is UTC: there is no person to take one from", async () => {
    const created: WorkspaceNotificationSummary = await create(
      newSummary({}),
      API_KEY,
    );

    expect(created.timezone).toBe(Timezone.UTC);
    expect(iso(created.sendFirstReportAt)).toBe("2026-10-12T09:00:00.000Z");
    expect(UserService.findOneById).not.toHaveBeenCalled();
  });

  test("without one, from a workflow or the server, is UTC", async () => {
    const created: WorkspaceNotificationSummary = await create(newSummary({}), {
      isRoot: true,
      tenantId: PROJECT_ID,
    });

    expect(created.timezone).toBe(Timezone.UTC);
    expect(UserService.findOneById).not.toHaveBeenCalled();
  });

  test.each([
    ["no time zone in their profile", null],
    ["a profile time zone that is not one", "Mars/Olympus_Mons"],
  ])(
    "without one, from a person with %s, is UTC",
    async (_what: string, timezone: string | null) => {
      userTimezones[PERSON_ID.toString()] = timezone;

      const created: WorkspaceNotificationSummary = await create(
        newSummary({}),
        person(PERSON_ID),
      );

      expect(created.timezone).toBe(Timezone.UTC);
    },
  );

  test("without one, from a person who is gone, is UTC", async () => {
    const created: WorkspaceNotificationSummary = await create(
      newSummary({}),
      person(OTHER_PERSON_ID),
    );

    expect(created.timezone).toBe(Timezone.UTC);
  });

  test("sent as null is left out: the creator's is taken", async () => {
    userTimezones[PERSON_ID.toString()] = "Europe/Berlin";

    const created: WorkspaceNotificationSummary = await create(
      newSummary({ timezone: null }),
      person(PERSON_ID),
    );

    expect(created.timezone).toBe("Europe/Berlin");
  });

  test.each([
    ["a made-up zone", "Mars/Olympus_Mons"],
    ["an offset", "GMT+2"],
    ["an empty name", ""],
    ["a number", 2],
  ])(
    "with %s is refused before anything is read, and says how to send one",
    async (_what: string, timezone: unknown) => {
      await expect(
        create(newSummary({ timezone: timezone }), person(PERSON_ID)),
      ).rejects.toThrow(BadDataException);
      await expect(
        create(newSummary({ timezone: timezone }), person(PERSON_ID)),
      ).rejects.toThrow(/timezone is not a time zone/);
      await expect(
        create(newSummary({ timezone: timezone }), person(PERSON_ID)),
      ).rejects.toThrow(/Europe\/Berlin/);
      expect(UserService.findOneById).not.toHaveBeenCalled();
    },
  );

  test("with a first summary of its own keeps it, and reads the time zone for the summaries after it", async () => {
    // Mondays at 09:00 CEST since 7 Sep; created on 28 Oct, after the clocks went back.
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(
      at("2026-10-28T12:00:00.000Z"),
    );

    const created: WorkspaceNotificationSummary = await create(
      newSummary({
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-09-07T07:00:00.000Z"),
        timezone: "Europe/Berlin",
      }),
      API_KEY,
    );

    expect(iso(created.sendFirstReportAt)).toBe("2026-09-07T07:00:00.000Z");
    // Mon 2 Nov, 09:00 CET - not 08:00, where UTC steps put it.
    expect(iso(created.nextSendAt)).toBe("2026-11-02T08:00:00.000Z");
  });
});

describe("changing a summary's time zone", () => {
  const STORED_UTC: Parameters<typeof stored>[1] = {
    recurringInterval: every(EventInterval.Week, 1),
    // Mon 7 Sep, 09:00 CEST, stepped in UTC since.
    sendFirstReportAt: at("2026-09-07T07:00:00.000Z"),
    nextSendAt: at("2026-11-02T07:00:00.000Z"),
    isEnabled: true,
    timezone: Timezone.UTC,
  };

  beforeEach(() => {
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(
      at("2026-10-28T12:00:00.000Z"),
    );
  });

  test("moves the next send to the schedule's time of day on the new clock, in the same write", async () => {
    const findBy: jest.SpyInstance<any, any> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([stored(SUMMARY_ID, STORED_UTC)]);

    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy({ timezone: "Europe/Berlin" }));

    expect(
      iso((onUpdate.updateBy.data as Record<string, unknown>)["nextSendAt"]),
    ).toBe("2026-11-02T08:00:00.000Z");
    expect(findBy.mock.calls[0]![0]["select"]).toEqual(
      expect.objectContaining({ timezone: true }),
    );
  });

  test("that sends the time zone back unchanged - the edit form's every save - moves nothing", async () => {
    getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([
      stored(SUMMARY_ID, { ...STORED_UTC, timezone: "Europe/Berlin" }),
    ]);

    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(
        updateBy({
          name: "Renamed",
          timezone: "Europe/Berlin",
          recurringInterval: every(EventInterval.Week, 1),
          sendFirstReportAt: at("2026-09-07T07:00:00.000Z"),
        }),
      );

    expect(
      (onUpdate.updateBy.data as Record<string, unknown>)["nextSendAt"],
    ).toBeUndefined();
    expect(onUpdate.carryForward).toBeNull();
  });

  test("to one that is not a time zone is refused before anything is read", async () => {
    const findBy: jest.SpyInstance<any, any> = getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([]);

    await expect(
      hooks.onBeforeUpdate(updateBy({ timezone: "Europe/Atlantis" })),
    ).rejects.toThrow(/timezone is not a time zone/);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("cleared, reads in UTC: the next send follows the UTC clock", async () => {
    getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([
      stored(SUMMARY_ID, {
        ...STORED_UTC,
        timezone: "Europe/Berlin",
        nextSendAt: at("2026-11-02T08:00:00.000Z"),
      }),
    ]);

    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy({ timezone: null }));

    expect(
      iso((onUpdate.updateBy.data as Record<string, unknown>)["nextSendAt"]),
    ).toBe("2026-11-02T07:00:00.000Z");
  });

  test("switching a summary back on counts its next send on its own clock", async () => {
    getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "findBy",
    ).mockResolvedValue([
      stored(SUMMARY_ID, {
        ...STORED_UTC,
        timezone: "Europe/Berlin",
        nextSendAt: at("2026-07-06T07:00:00.000Z"),
        isEnabled: false,
      }),
    ]);

    const onUpdate: OnUpdate<WorkspaceNotificationSummary> =
      await hooks.onBeforeUpdate(updateBy({ isEnabled: true }));

    expect(
      iso((onUpdate.updateBy.data as Record<string, unknown>)["nextSendAt"]),
    ).toBe("2026-11-02T08:00:00.000Z");
  });
});

describe("giving the summaries made before time zones one (the data migration's backfill)", () => {
  // What the stored summaries hold, by id.
  let rows: Record<
    string,
    { createdByUserId?: string | undefined; timezone: string | null }
  > = {};
  let writes: Array<{ id: string; timezone: string; props: unknown }> = [];

  beforeEach(() => {
    rows = {};
    writes = [];

    getJestSpyOn(WorkspaceNotificationSummaryService, "findBy").mockImplementation(
      (async (): Promise<Array<WorkspaceNotificationSummary>> => {
        return Object.entries(rows)
          .filter(([, row]: [string, { timezone: string | null }]): boolean => {
            return row.timezone === null;
          })
          .map(
            ([id, row]: [
              string,
              { createdByUserId?: string | undefined },
            ]): WorkspaceNotificationSummary => {
              return stored(new ObjectID(id), {
                createdByUserId: row.createdByUserId
                  ? new ObjectID(row.createdByUserId)
                  : undefined,
              });
            },
          );
      }) as never,
    );

    getJestSpyOn(UserService, "findBy").mockImplementation((async (data: {
      query: { _id: unknown };
    }): Promise<Array<User>> => {
      return Object.entries(userTimezones).map(
        ([id, timezone]: [string, string | null]): User => {
          return profile(new ObjectID(id), timezone);
        },
      );
    }) as never);

    getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "updateOneBy",
    ).mockImplementation((async (data: {
      query: { _id: string };
      data: { timezone: string };
      props: unknown;
    }): Promise<number> => {
      const row: { timezone: string | null } | undefined =
        rows[data.query._id];

      // Written only while it still has no time zone.
      if (!row || row.timezone !== null) {
        return 0;
      }

      row.timezone = data.data.timezone;
      writes.push({
        id: data.query._id,
        timezone: data.data.timezone,
        props: data.props,
      });
      return 1;
    }) as never);
  });

  test("gives each its creator's time zone, and UTC to one with no creator or a creator with none", async () => {
    userTimezones[PERSON_ID.toString()] = "Europe/Berlin";
    userTimezones[OTHER_PERSON_ID.toString()] = null;

    rows[SUMMARY_ID.toString()] = {
      createdByUserId: PERSON_ID.toString(),
      timezone: null,
    };
    rows[OTHER_SUMMARY_ID.toString()] = {
      createdByUserId: OTHER_PERSON_ID.toString(),
      timezone: null,
    };
    rows[THIRD_SUMMARY_ID.toString()] = { timezone: null };

    const result: { fromCreator: number; utc: number } =
      await WorkspaceNotificationSummaryService.fillTimezonesFromCreators();

    expect(result).toEqual({ fromCreator: 1, utc: 2 });
    expect(rows[SUMMARY_ID.toString()]!.timezone).toBe("Europe/Berlin");
    expect(rows[OTHER_SUMMARY_ID.toString()]!.timezone).toBe(Timezone.UTC);
    expect(rows[THIRD_SUMMARY_ID.toString()]!.timezone).toBe(Timezone.UTC);
  });

  test("writes the time zone alone, without the hooks: no next send moves", async () => {
    userTimezones[PERSON_ID.toString()] = "Europe/Berlin";
    rows[SUMMARY_ID.toString()] = {
      createdByUserId: PERSON_ID.toString(),
      timezone: null,
    };

    await WorkspaceNotificationSummaryService.fillTimezonesFromCreators();

    const update: Record<string, any> = (
      WorkspaceNotificationSummaryService.updateOneBy as unknown as jest.Mock
    ).mock.calls[0]![0] as Record<string, any>;

    expect(update["data"]).toEqual({ timezone: "Europe/Berlin" });
    expect(update["props"]).toEqual({ isRoot: true, ignoreHooks: true });
    // Only while it still has none, so a time zone picked meanwhile is kept.
    expect(Object.keys(update["query"]).sort()).toEqual(["_id", "timezone"]);
  });

  test("takes the name the dashboard offers for a legacy one", async () => {
    userTimezones[PERSON_ID.toString()] = "Asia/Calcutta";
    rows[SUMMARY_ID.toString()] = {
      createdByUserId: PERSON_ID.toString(),
      timezone: null,
    };

    await WorkspaceNotificationSummaryService.fillTimezonesFromCreators();

    expect(rows[SUMMARY_ID.toString()]!.timezone).toBe("Asia/Kolkata");
  });

  test("leaves a summary that has a time zone alone", async () => {
    rows[SUMMARY_ID.toString()] = { timezone: "America/New_York" };

    const result: { fromCreator: number; utc: number } =
      await WorkspaceNotificationSummaryService.fillTimezonesFromCreators();

    expect(result).toEqual({ fromCreator: 0, utc: 0 });
    expect(writes).toHaveLength(0);
    expect(rows[SUMMARY_ID.toString()]!.timezone).toBe("America/New_York");
  });

  test("reads each creator once, for every summary they made", async () => {
    userTimezones[PERSON_ID.toString()] = "Europe/Berlin";
    rows[SUMMARY_ID.toString()] = {
      createdByUserId: PERSON_ID.toString(),
      timezone: null,
    };
    rows[OTHER_SUMMARY_ID.toString()] = {
      createdByUserId: PERSON_ID.toString(),
      timezone: null,
    };

    await WorkspaceNotificationSummaryService.fillTimezonesFromCreators();

    expect(UserService.findBy).toHaveBeenCalledTimes(1);
    const query: Record<string, any> = (
      UserService.findBy as unknown as jest.Mock
    ).mock.calls[0]![0] as Record<string, any>;
    expect(query["props"]).toEqual({ isRoot: true });
    expect(rows[OTHER_SUMMARY_ID.toString()]!.timezone).toBe("Europe/Berlin");
  });

  test("never loops on a summary it could not write", async () => {
    rows[SUMMARY_ID.toString()] = { timezone: null };

    // The write never lands: the summary keeps coming back without one.
    getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "updateOneBy",
    ).mockResolvedValue(0 as never);

    const result: { fromCreator: number; utc: number } =
      await WorkspaceNotificationSummaryService.fillTimezonesFromCreators();

    expect(result).toEqual({ fromCreator: 0, utc: 0 });
    expect(WorkspaceNotificationSummaryService.findBy).toHaveBeenCalledTimes(2);
  });

  test("with nothing to give a time zone, reads nobody's profile", async () => {
    const result: { fromCreator: number; utc: number } =
      await WorkspaceNotificationSummaryService.fillTimezonesFromCreators();

    expect(result).toEqual({ fromCreator: 0, utc: 0 });
    expect(UserService.findBy).not.toHaveBeenCalled();
  });
});

describe("the summary's message, read in its time zone", () => {
  type MessageBuilder = {
    buildSummaryMessageBlocks: (data: {
      summary: WorkspaceNotificationSummary;
    }) => Promise<Array<{ _type: string; text?: string }>>;
    buildIncidentBlocks: (data: Record<string, unknown>) => Promise<void>;
  };

  type StaticFormatter = {
    formatDate: (date: Date, timezone?: string) => string;
  };

  const builder: MessageBuilder =
    WorkspaceNotificationSummaryService as unknown as MessageBuilder;

  const formatter: StaticFormatter = (
    WorkspaceNotificationSummaryService as unknown as {
      constructor: StaticFormatter;
    }
  ).constructor;

  function summaryIn(
    timezone: string | undefined,
  ): WorkspaceNotificationSummary {
    const summary: WorkspaceNotificationSummary =
      new WorkspaceNotificationSummary();
    summary.name = "Weekly Incident Summary";
    summary.projectId = PROJECT_ID;
    summary.summaryType = WorkspaceNotificationSummaryType.Incident;
    summary.summaryItems = [];
    summary.numberOfDaysOfData = 7;

    if (timezone) {
      summary.timezone = timezone as Timezone;
    }

    return summary;
  }

  beforeEach(() => {
    // Mon 5 Oct, 09:00 in Sydney (AEDT): still Sunday in UTC.
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(
      at("2026-10-04T22:00:00.000Z"),
    );
    getJestSpyOn(
      WorkspaceNotificationSummaryService,
      "buildIncidentBlocks",
    ).mockResolvedValue(undefined as never);
  });

  test("says the week it covers in the summary's time zone: up to Monday in Sydney", async () => {
    const blocks: Array<{ _type: string; text?: string }> =
      await builder.buildSummaryMessageBlocks({
        summary: summaryIn("Australia/Sydney"),
      });

    expect(blocks[0]!.text).toBe(
      "Incident Summary \u2014 Sep 28, 2026 to Oct 05, 2026",
    );
  });

  test("says it in UTC for a summary without one, as before", async () => {
    const blocks: Array<{ _type: string; text?: string }> =
      await builder.buildSummaryMessageBlocks({
        summary: summaryIn(undefined),
      });

    expect(blocks[0]!.text).toBe(
      "Incident Summary \u2014 Sep 27, 2026 to Oct 04, 2026",
    );
  });

  test("hands the summary's time zone to the list it builds, whose dates are read in it", async () => {
    await builder.buildSummaryMessageBlocks({
      summary: summaryIn("Australia/Sydney"),
    });

    const listData: Record<string, unknown> = (
      builder.buildIncidentBlocks as unknown as jest.Mock
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect(listData["timezone"]).toBe("Australia/Sydney");
    expect(
      formatter.formatDate(at("2026-10-04T22:00:00.000Z"), "Australia/Sydney"),
    ).toBe("Oct 05, 2026");
    expect(formatter.formatDate(at("2026-10-04T22:00:00.000Z"))).toBe(
      "Oct 04, 2026",
    );
  });
});
