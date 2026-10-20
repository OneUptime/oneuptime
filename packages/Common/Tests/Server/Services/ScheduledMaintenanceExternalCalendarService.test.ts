import ScheduledMaintenanceExternalCalendarService, {
  EXTERNAL_CALENDAR_LIMIT_MESSAGE,
} from "../../../Server/Services/ScheduledMaintenanceExternalCalendarService";
import ScheduledMaintenanceExternalCalendarEventService from "../../../Server/Services/ScheduledMaintenanceExternalCalendarEventService";
import logger from "../../../Server/Utils/Logger";
import ScheduledMaintenanceExternalCalendar from "../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Color from "../../../Types/Color";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import {
  EXTERNAL_CALENDAR_LINK_PROBLEM_MESSAGES,
  EXTERNAL_CALENDARS_PER_PROJECT,
  ExternalCalendarLinkProblem,
} from "../../../Types/ScheduledMaintenance/ExternalCalendar";
import UserType from "../../../Types/UserType";
import { DISTINCT_COLORS } from "../../../Utils/DistinctColor";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The calendars from outside a project drawn on its maintenance calendar,
 * created and changed through the real write pipeline - the hooks, the
 * permission checks, the success hooks - as a project member, over an
 * in-memory table (ScheduledMaintenanceExternalCalendarService).
 *
 *   - a link is checked and stored the way it is read (webcal:// as
 *     https://), encrypted, never read back, with its host kept readable;
 *   - a calendar is read at once once it is added, its link is changed, it
 *     is turned on, or how often it is read changes - and a new link
 *     forgets the old one's events and status;
 *   - a calendar added without a colour gets one its project's calendars do
 *     not use;
 *   - at most EXTERNAL_CALENDARS_PER_PROJECT per project;
 *   - the status columns are OneUptime's alone.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);
const CALENDAR_ID: string = "5e000000-0000-4000-8000-000000000002";

const SECRET_LINK: string =
  "webcal://calendar.example.com/private-3f8a9c1d7e/basic.ics";
const STORED_LINK: string =
  "https://calendar.example.com/private-3f8a9c1d7e/basic.ics";

function member(
  permissions: Array<Permission> = [Permission.ScheduledMaintenanceMember],
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            } as UserPermission;
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function storedCalendar(overrides: StoredRow = {}): StoredRow {
  return {
    _id: CALENDAR_ID,
    projectId: PROJECT_ID.toString(),
    name: "Public holidays",
    calendarUrl: "stored-encrypted-link",
    calendarHost: "calendar.example.com",
    color: new Color("#4f46e5"),
    isEnabled: true,
    refreshIntervalInMinutes: 60,
    eventCount: 12,
    hasMoreEvents: false,
    lastReadAt: new Date("2026-10-15T09:00:00.000Z"),
    nextReadAt: new Date("2026-10-15T10:00:00.000Z"),
    version: 1,
    ...overrides,
  };
}

function newCalendar(
  overrides: Partial<ScheduledMaintenanceExternalCalendar> = {},
): ScheduledMaintenanceExternalCalendar {
  const calendar: ScheduledMaintenanceExternalCalendar =
    new ScheduledMaintenanceExternalCalendar();
  calendar.projectId = PROJECT_ID;
  calendar.name = "  Change freezes  ";
  calendar.calendarUrl = SECRET_LINK;
  Object.assign(calendar, overrides);
  return calendar;
}

async function refusalOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected a refusal");
}

describe("wiring", () => {
  test("both services are registered in Server/Services/Index.ts, so their tables are created", () => {
    const index: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "Server", "Services", "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import ScheduledMaintenanceExternalCalendarService from "./ScheduledMaintenanceExternalCalendarService";',
    );
    expect(index).toContain(
      'import ScheduledMaintenanceExternalCalendarEventService from "./ScheduledMaintenanceExternalCalendarEventService";',
    );
    expect(index).toContain("  ScheduledMaintenanceExternalCalendarService,\n");
    expect(index).toContain(
      "  ScheduledMaintenanceExternalCalendarEventService,\n",
    );
  });
});

describe("through the write pipeline, as a project member", () => {
  let calendars: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    calendars = useInMemoryTable(ScheduledMaintenanceExternalCalendarService, [
      storedCalendar(),
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a new calendar stores its link as it is read - encrypted - with its host, trimmed name and a colour of its own, due to be read at once", async () => {
    const before: number = Date.now();

    const created: ScheduledMaintenanceExternalCalendar =
      await ScheduledMaintenanceExternalCalendarService.create({
        data: newCalendar(),
        props: member(),
      });

    const row: StoredRow = calendars.get(created.id!.toString())!;

    expect(row["name"]).toBe("Change freezes");
    expect(row["calendarHost"]).toBe("calendar.example.com");
    // Encrypted at rest: neither the link pasted nor the link read.
    expect(String(row["calendarUrl"])).not.toContain("private-3f8a9c1d7e");
    expect(row["calendarUrl"]).not.toBe(STORED_LINK);
    // The project's other calendar is indigo, the palette's first: the next is picked.
    expect((row["color"] as Color).toString().toLowerCase()).toBe(
      DISTINCT_COLORS[1]!.toString().toLowerCase(),
    );
    expect((row["nextReadAt"] as Date).getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(row["isEnabled"]).not.toBe(false);
  });

  test("a colour the request gives is kept, and a refresh interval reads as one of the choices", async () => {
    const created: ScheduledMaintenanceExternalCalendar =
      await ScheduledMaintenanceExternalCalendarService.create({
        data: newCalendar({
          color: new Color("#0d9488"),
          refreshIntervalInMinutes: 90,
        }),
        props: member(),
      });

    const row: StoredRow = calendars.get(created.id!.toString())!;

    expect((row["color"] as Color).toString().toLowerCase()).toBe("#0d9488");
    expect(row["refreshIntervalInMinutes"]).toBe(360);
  });

  test.each([
    ["no link", "", ExternalCalendarLinkProblem.Empty],
    ["a word", "holidays", ExternalCalendarLinkProblem.NotALink],
    ["ftp", "ftp://calendar.example.com/a.ics", ExternalCalendarLinkProblem.NotHttp],
  ])(
    "a link that is %s is refused, saying why, and nothing is created",
    async (
      _name: string,
      link: string,
      problem: ExternalCalendarLinkProblem,
    ) => {
      const error: Error = await refusalOf(
        ScheduledMaintenanceExternalCalendarService.create({
          data: newCalendar({ calendarUrl: link }),
          props: member(),
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(EXTERNAL_CALENDAR_LINK_PROBLEM_MESSAGES[problem]);
      expect(calendars.inserts).toHaveLength(0);
    },
  );

  test(`a project shows at most ${EXTERNAL_CALENDARS_PER_PROJECT} calendars`, async () => {
    calendars = useInMemoryTable(
      ScheduledMaintenanceExternalCalendarService,
      Array.from({ length: EXTERNAL_CALENDARS_PER_PROJECT }).map(
        (_value: unknown, index: number): StoredRow => {
          return storedCalendar({
            _id: `5e000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
          });
        },
      ),
    );

    const error: Error = await refusalOf(
      ScheduledMaintenanceExternalCalendarService.create({
        data: newCalendar(),
        props: member(),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(EXTERNAL_CALENDAR_LIMIT_MESSAGE);
    expect(EXTERNAL_CALENDAR_LIMIT_MESSAGE).toContain("20");
  });

  test("a member cannot write what a read found", async () => {
    for (const data of [
      { lastReadError: "NotFound" },
      { eventCount: 3 },
      { calendarHost: "elsewhere.example.com" },
      { nextReadAt: new Date("2030-01-01T00:00:00.000Z") },
      { contentDigest: "abc" },
    ]) {
      await refusalOf(
        ScheduledMaintenanceExternalCalendarService.updateOneById({
          id: new ObjectID(CALENDAR_ID),
          data: data as never,
          props: member(),
        }),
      );
    }

    expect(calendars.get(CALENDAR_ID)?.["eventCount"]).toBe(12);
    expect(calendars.get(CALENDAR_ID)?.["calendarHost"]).toBe(
      "calendar.example.com",
    );
  });

  test("a member reads the calendar but never its link", async () => {
    const read: ScheduledMaintenanceExternalCalendar | null =
      await ScheduledMaintenanceExternalCalendarService.findOneById({
        id: new ObjectID(CALENDAR_ID),
        select: { _id: true, name: true, calendarHost: true },
        props: member([Permission.ScheduledMaintenanceViewer]),
      });

    expect(read?.name).toBe("Public holidays");
    expect(read?.calendarHost).toBe("calendar.example.com");

    // Asking for the link itself is refused, whoever asks.
    for (const permissions of [
      [Permission.ScheduledMaintenanceViewer],
      [Permission.ScheduledMaintenanceMember],
      [Permission.ProjectOwner],
    ]) {
      await refusalOf(
        ScheduledMaintenanceExternalCalendarService.findOneById({
          id: new ObjectID(CALENDAR_ID),
          select: { _id: true, calendarUrl: true },
          props: member(permissions),
        }),
      );
    }
  });

  test("Change link stores the new link and forgets everything the old one held", async () => {
    const resets: Array<{ id: string; data: StoredRow }> = [];

    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "updateColumnsByIdWithoutHooks",
    ).mockImplementation(async (input: unknown): Promise<void> => {
      const write: { id: ObjectID; data: StoredRow } = input as {
        id: ObjectID;
        data: StoredRow;
      };
      resets.push({ id: write.id.toString(), data: write.data });
    });

    const deleted: Array<string> = [];

    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarEventService,
      "deleteEventsOfCalendar",
    ).mockImplementation(async (id: unknown): Promise<void> => {
      deleted.push((id as ObjectID).toString());
    });

    await ScheduledMaintenanceExternalCalendarService.updateOneById({
      id: new ObjectID(CALENDAR_ID),
      data: {
        calendarUrl: "webcal://other.example.org/team/calendar.ics",
      } as never,
      props: member(),
    });

    const row: StoredRow = calendars.get(CALENDAR_ID)!;
    expect(String(row["calendarUrl"])).not.toContain("other.example.org");
    expect(row["calendarUrl"]).not.toBe("stored-encrypted-link");

    expect(resets).toHaveLength(1);
    expect(resets[0]!.id).toBe(CALENDAR_ID);
    expect(resets[0]!.data).toMatchObject({
      calendarHost: "other.example.org",
      lastReadAt: null,
      lastReadAttemptAt: null,
      lastReadError: null,
      lastReadHttpStatus: null,
      eventCount: 0,
      hasMoreEvents: false,
      contentDigest: null,
    });
    expect(resets[0]!.data["nextReadAt"]).toBeInstanceOf(Date);
    expect(deleted).toEqual([CALENDAR_ID]);
  });

  test("a new link that cannot be one is refused, and the old one stays", async () => {
    const error: Error = await refusalOf(
      ScheduledMaintenanceExternalCalendarService.updateOneById({
        id: new ObjectID(CALENDAR_ID),
        data: { calendarUrl: "not a link" } as never,
        props: member(),
      }),
    );

    expect(error.message).toBe(
      EXTERNAL_CALENDAR_LINK_PROBLEM_MESSAGES[
        ExternalCalendarLinkProblem.NotALink
      ],
    );
    expect(calendars.get(CALENDAR_ID)?.["calendarUrl"]).toBe(
      "stored-encrypted-link",
    );
  });

  test.each([
    ["turned on", { isEnabled: true }],
    ["read more often", { refreshIntervalInMinutes: 15 }],
  ])(
    "a calendar %s is read at once, and keeps its events meanwhile",
    async (_name: string, data: StoredRow) => {
      const writes: Array<StoredRow> = [];

      getJestSpyOn(
        ScheduledMaintenanceExternalCalendarService,
        "updateColumnsByIdWithoutHooks",
      ).mockImplementation(async (input: unknown): Promise<void> => {
        writes.push((input as { data: StoredRow }).data);
      });

      const deleteSpy: jest.SpyInstance = getJestSpyOn(
        ScheduledMaintenanceExternalCalendarEventService,
        "deleteEventsOfCalendar",
      ).mockImplementation(async (): Promise<void> => {
        return undefined;
      });

      await ScheduledMaintenanceExternalCalendarService.updateOneById({
        id: new ObjectID(CALENDAR_ID),
        data: data as never,
        props: member(),
      });

      expect(writes).toHaveLength(1);
      expect(Object.keys(writes[0]!)).toEqual(["nextReadAt"]);
      expect(deleteSpy).not.toHaveBeenCalled();
    },
  );

  test("a new name or colour, or turning a calendar off, changes nothing about its reads", async () => {
    const writeSpy: jest.SpyInstance = getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "updateColumnsByIdWithoutHooks",
    ).mockImplementation(async (): Promise<void> => {
      return undefined;
    });

    for (const data of [
      { name: "  Bank holidays " },
      { color: new Color("#db2777") },
      { isEnabled: false },
    ]) {
      await ScheduledMaintenanceExternalCalendarService.updateOneById({
        id: new ObjectID(CALENDAR_ID),
        data: data as never,
        props: member(),
      });
    }

    expect(writeSpy).not.toHaveBeenCalled();
    expect(calendars.get(CALENDAR_ID)?.["name"]).toBe("Bank holidays");
    expect(calendars.get(CALENDAR_ID)?.["isEnabled"]).toBe(false);
  });

  test("a viewer may neither add nor change a calendar", async () => {
    const viewer: DatabaseCommonInteractionProps = member([
      Permission.ScheduledMaintenanceViewer,
    ]);

    await refusalOf(
      ScheduledMaintenanceExternalCalendarService.create({
        data: newCalendar(),
        props: viewer,
      }),
    );

    await refusalOf(
      ScheduledMaintenanceExternalCalendarService.updateOneById({
        id: new ObjectID(CALENDAR_ID),
        data: { name: "Renamed" } as never,
        props: viewer,
      }),
    );

    expect(calendars.inserts).toHaveLength(0);
    expect(calendars.get(CALENDAR_ID)?.["name"]).toBe("Public holidays");
  });
});

describe("claimForRead", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("moves the next read to the end of the lease, only if nobody moved it since", async () => {
    const compareAndSet: jest.SpyInstance = getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "compareAndSetColumnsByIdWithoutHooks",
    ).mockResolvedValue(true);

    const expected: Date = new Date("2026-10-15T10:00:00.000Z");
    const leaseUntil: Date = new Date("2026-10-15T10:05:00.000Z");

    await expect(
      ScheduledMaintenanceExternalCalendarService.claimForRead({
        id: new ObjectID(CALENDAR_ID),
        expectedNextReadAt: expected,
        leaseUntil: leaseUntil,
      }),
    ).resolves.toBe(true);

    expect(compareAndSet).toHaveBeenCalledWith({
      id: new ObjectID(CALENDAR_ID),
      data: { nextReadAt: leaseUntil },
      expectedData: { nextReadAt: expected },
      skipUpdateDateColumn: true,
    });
  });
});
