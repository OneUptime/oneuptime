import ScheduledMaintenanceExternalCalendarEventService, {
  ExternalCalendarEventRow,
} from "../../../../../Server/Services/ScheduledMaintenanceExternalCalendarEventService";
import ScheduledMaintenanceExternalCalendarService from "../../../../../Server/Services/ScheduledMaintenanceExternalCalendarService";
import logger from "../../../../../Server/Utils/Logger";
import { ExternalCalendarExpansionResult } from "../../../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarExpansion";
import { ExternalCalendarFetchResult } from "../../../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarFetch";
import ExternalCalendarRefresher, {
  DEFAULT_EXTERNAL_CALENDAR_REFRESHER_STEPS,
  EXTERNAL_CALENDAR_READ_BATCH_SIZE,
  EXTERNAL_CALENDAR_READ_LEASE_IN_MINUTES,
  EXTERNAL_CALENDAR_READ_NOW_COOLDOWN_IN_SECONDS,
  EXTERNAL_CALENDAR_READ_RUN_BUDGET_IN_SECONDS,
  EXTERNAL_CALENDAR_READ_TOO_SOON_MESSAGE,
  EXTERNAL_CALENDAR_TURNED_OFF_MESSAGE,
  ExternalCalendarReadOutcome,
} from "../../../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarRefresher";
import ScheduledMaintenanceExternalCalendar from "../../../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../../Types/Date";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../../Types/ObjectID";
import { ExternalCalendarReadError } from "../../../../../Types/ScheduledMaintenance/ExternalCalendar";
import { getJestSpyOn } from "../../../../Spy";
import { GOOGLE_HOLIDAYS_CALENDAR } from "./ExternalCalendarFixtures";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The reads of the calendars drawn on the maintenance calendar
 * (ExternalCalendarRefresher): which calendars the Workers' job reads, the
 * claim that keeps two readers off one calendar, what a read writes - its
 * events, in one replace, and its status - what a failed read keeps, the
 * calendar whose text has not changed, the link replaced while it was
 * read, and Read now's refusals.
 *
 * The services are spied on; the fetch and the expansion are the
 * refresher's replaceable steps.
 */

const NOW: Date = new Date("2026-10-15T10:20:00.000Z");
const CALENDAR_ID: ObjectID = new ObjectID(
  "60000000-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "60000000-0000-4000-8000-000000000002",
);
const LINK: string =
  "https://calendar.example.com/private-3f8a9c1d7e/basic.ics";

const EVENTS: Array<ExternalCalendarEventRow> = [
  {
    title: "Christmas Day",
    startsAt: new Date("2026-12-25T00:00:00.000Z"),
    endsAt: new Date("2026-12-26T00:00:00.000Z"),
    isAllDay: true,
  },
];

interface World {
  calendar: ScheduledMaintenanceExternalCalendar;
  // What the link answers, and how it works out.
  fetched: ExternalCalendarFetchResult;
  expanded: ExternalCalendarExpansionResult;
  // The link as a second read of the calendar finds it.
  linkOnSecondRead: string;
  writes: Array<Record<string, unknown>>;
  replaced: Array<Array<ExternalCalendarEventRow>>;
  fetchedLinks: Array<string>;
  expansions: number;
}

function calendar(
  overrides: Partial<ScheduledMaintenanceExternalCalendar> = {},
): ScheduledMaintenanceExternalCalendar {
  const model: ScheduledMaintenanceExternalCalendar =
    new ScheduledMaintenanceExternalCalendar();
  model._id = CALENDAR_ID.toString();
  model.projectId = PROJECT_ID;
  model.calendarUrl = LINK;
  model.refreshIntervalInMinutes = 15;
  model.eventCount = 7;
  model.isEnabled = true;
  model.nextReadAt = new Date("2026-10-15T10:00:00.000Z");
  Object.assign(model, overrides);
  return model;
}

let world: World;

function arrange(overrides: Partial<World> = {}): void {
  world = {
    calendar: calendar(),
    fetched: { ok: true, body: GOOGLE_HOLIDAYS_CALENDAR },
    expanded: {
      ok: true,
      events: EVENTS,
      eventsInWindow: 1,
      hasMoreEvents: false,
      skippedSeries: 0,
    },
    linkOnSecondRead: LINK,
    writes: [],
    replaced: [],
    fetchedLinks: [],
    expansions: 0,
    ...overrides,
  };
}

beforeEach(() => {
  arrange();

  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(NOW.getTime());
  });

  let reads: number = 0;

  getJestSpyOn(
    ScheduledMaintenanceExternalCalendarService,
    "findOneById",
  ).mockImplementation(async (): Promise<unknown> => {
    reads++;

    if (!world.calendar) {
      return null;
    }

    // Every read after the first sees the link as it is then.
    return reads > 1 && world.linkOnSecondRead !== LINK
      ? calendar({ ...world.calendar, calendarUrl: world.linkOnSecondRead })
      : world.calendar;
  });

  getJestSpyOn(
    ScheduledMaintenanceExternalCalendarService,
    "updateColumnsByIdWithoutHooks",
  ).mockImplementation(async (input: unknown): Promise<void> => {
    world.writes.push(
      (input as { data: Record<string, unknown> }).data as Record<
        string,
        unknown
      >,
    );
  });

  getJestSpyOn(
    ScheduledMaintenanceExternalCalendarEventService,
    "replaceEventsOfCalendar",
  ).mockImplementation(async (input: unknown): Promise<void> => {
    world.replaced.push(
      (input as { events: Array<ExternalCalendarEventRow> }).events,
    );
  });

  ExternalCalendarRefresher.steps = {
    fetch: async (link: string): Promise<ExternalCalendarFetchResult> => {
      world.fetchedLinks.push(link);
      return world.fetched;
    },
    expand: async (): Promise<ExternalCalendarExpansionResult> => {
      world.expansions++;
      return world.expanded;
    },
  };
});

afterEach(() => {
  ExternalCalendarRefresher.steps = DEFAULT_EXTERNAL_CALENDAR_REFRESHER_STEPS;
  jest.restoreAllMocks();
});

// The status write: the last write of the read.
function statusWrite(): Record<string, unknown> {
  return world.writes[world.writes.length - 1]!;
}

describe("a read that works", () => {
  test("replaces the calendar's events and writes what it found, next read one interval on", async () => {
    const outcome: ExternalCalendarReadOutcome =
      await ExternalCalendarRefresher.readCalendar(CALENDAR_ID);

    expect(outcome).toEqual({ read: true, error: null, eventCount: 1 });
    expect(world.fetchedLinks).toEqual([LINK]);
    expect(world.replaced).toEqual([EVENTS]);
    expect(statusWrite()).toEqual({
      lastReadAt: NOW,
      lastReadAttemptAt: NOW,
      lastReadError: null,
      lastReadHttpStatus: null,
      nextReadAt: new Date("2026-10-15T10:35:00.000Z"),
      eventCount: 1,
      hasMoreEvents: false,
      contentDigest: ExternalCalendarRefresher.getContentDigest(
        GOOGLE_HOLIDAYS_CALENDAR,
        NOW,
      ),
    });
  });

  test("says when the calendar holds more than is kept", async () => {
    arrange({
      expanded: {
        ok: true,
        events: EVENTS,
        eventsInWindow: 4000,
        hasMoreEvents: true,
        skippedSeries: 0,
      },
    });

    await ExternalCalendarRefresher.readCalendar(CALENDAR_ID);

    expect(statusWrite()["hasMoreEvents"]).toBe(true);
  });

  test("an unchanged calendar is not worked out or written again", async () => {
    arrange({
      calendar: calendar({
        contentDigest: ExternalCalendarRefresher.getContentDigest(
          GOOGLE_HOLIDAYS_CALENDAR,
          NOW,
        ),
      }),
    });

    const outcome: ExternalCalendarReadOutcome =
      await ExternalCalendarRefresher.readCalendar(CALENDAR_ID);

    expect(outcome).toEqual({ read: true, error: null, eventCount: 7 });
    expect(world.expansions).toBe(0);
    expect(world.replaced).toEqual([]);
    expect(statusWrite()).toEqual({
      lastReadAt: NOW,
      lastReadAttemptAt: NOW,
      lastReadError: null,
      lastReadHttpStatus: null,
      nextReadAt: new Date("2026-10-15T10:35:00.000Z"),
    });
  });

  test("the same text is worked out again on another day: the window moved", () => {
    const today: string = ExternalCalendarRefresher.getContentDigest(
      GOOGLE_HOLIDAYS_CALENDAR,
      NOW,
    );

    expect(
      ExternalCalendarRefresher.getContentDigest(
        GOOGLE_HOLIDAYS_CALENDAR,
        new Date("2026-10-15T23:59:00.000Z"),
      ),
    ).toBe(today);
    expect(
      ExternalCalendarRefresher.getContentDigest(
        GOOGLE_HOLIDAYS_CALENDAR,
        new Date("2026-10-16T00:01:00.000Z"),
      ),
    ).not.toBe(today);
    expect(
      ExternalCalendarRefresher.getContentDigest(
        `${GOOGLE_HOLIDAYS_CALENDAR}\r\n`,
        NOW,
      ),
    ).not.toBe(today);
  });

  test("a link replaced while it was read: what it held is not kept", async () => {
    arrange({ linkOnSecondRead: "https://other.example.org/calendar.ics" });

    const outcome: ExternalCalendarReadOutcome =
      await ExternalCalendarRefresher.readCalendar(CALENDAR_ID);

    expect(outcome).toEqual({ read: false, error: null, eventCount: null });
    expect(world.replaced).toEqual([]);
    expect(world.writes).toEqual([]);
  });

  test("a calendar deleted before its read is not read", async () => {
    arrange({
      calendar: null as unknown as ScheduledMaintenanceExternalCalendar,
    });

    expect(await ExternalCalendarRefresher.readCalendar(CALENDAR_ID)).toEqual({
      read: false,
      error: null,
      eventCount: null,
    });
    expect(world.fetchedLinks).toEqual([]);
  });
});

describe("a read that fails", () => {
  test.each([
    [ExternalCalendarReadError.NotFound, 404],
    [ExternalCalendarReadError.ServerError, 503],
    [ExternalCalendarReadError.Unreachable, null],
    [ExternalCalendarReadError.NotAllowed, null],
    [ExternalCalendarReadError.Timeout, null],
    [ExternalCalendarReadError.TooLarge, null],
  ])(
    "at the link (%s) keeps the last good events, says why, and is tried again an hour on",
    async (error: ExternalCalendarReadError, httpStatus: number | null) => {
      arrange({
        fetched: { ok: false, error: error, httpStatus: httpStatus },
      });

      const outcome: ExternalCalendarReadOutcome =
        await ExternalCalendarRefresher.readCalendar(CALENDAR_ID);

      expect(outcome).toEqual({ read: true, error: error, eventCount: null });
      expect(world.replaced).toEqual([]);
      expect(world.expansions).toBe(0);
      expect(statusWrite()).toEqual({
        lastReadAttemptAt: NOW,
        lastReadError: error,
        lastReadHttpStatus: httpStatus,
        // Its interval is 15 minutes; after a failure, at least an hour.
        nextReadAt: new Date("2026-10-15T11:20:00.000Z"),
      });
    },
  );

  test.each([
    ExternalCalendarReadError.NotACalendar,
    ExternalCalendarReadError.TooComplex,
  ])(
    "in the working out (%s) the same way",
    async (error: ExternalCalendarReadError) => {
      arrange({
        expanded: {
          ok: false,
          error: error as
            | ExternalCalendarReadError.NotACalendar
            | ExternalCalendarReadError.TooComplex,
        },
      });

      expect(await ExternalCalendarRefresher.readCalendar(CALENDAR_ID)).toEqual(
        {
          read: true,
          error: error,
          eventCount: null,
        },
      );
      expect(world.replaced).toEqual([]);
      expect(statusWrite()["lastReadError"]).toBe(error);
      expect(statusWrite()["lastReadAt"]).toBeUndefined();
    },
  );
});

describe("the Workers' job", () => {
  test("reads the enabled calendars that are due, oldest first, a batch at a time", async () => {
    // The second has never been read: it has no next read yet.
    const neverRead: ScheduledMaintenanceExternalCalendar = calendar({
      _id: "60000000-0000-4000-8000-000000000012",
    });

    delete neverRead.nextReadAt;

    const due: Array<ScheduledMaintenanceExternalCalendar> = [
      calendar({ _id: "60000000-0000-4000-8000-000000000011" }),
      neverRead,
    ];

    const findBy: jest.SpyInstance = getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findBy",
    ).mockResolvedValue(due);

    const claims: Array<{
      id: string;
      expected: Date | null;
      leaseUntil: Date;
    }> = [];

    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "claimForRead",
    ).mockImplementation(async (input: unknown): Promise<boolean> => {
      const claim: {
        id: ObjectID;
        expectedNextReadAt: Date | null;
        leaseUntil: Date;
      } = input as {
        id: ObjectID;
        expectedNextReadAt: Date | null;
        leaseUntil: Date;
      };

      claims.push({
        id: claim.id.toString(),
        expected: claim.expectedNextReadAt,
        leaseUntil: claim.leaseUntil,
      });

      return true;
    });

    const readSpy: jest.SpyInstance = getJestSpyOn(
      ExternalCalendarRefresher,
      "readCalendar",
    ).mockResolvedValue({ read: true, error: null, eventCount: 1 });

    expect(await ExternalCalendarRefresher.readDueCalendars()).toBe(2);

    const query: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
      props: Record<string, unknown>;
    } = findBy.mock.calls[0]![0] as never;

    expect(query.query["isEnabled"]).toBe(true);
    expect(query.query["nextReadAt"]).toBeDefined();
    expect(query.sort).toEqual({ nextReadAt: SortOrder.Ascending });
    expect(query.limit).toBe(EXTERNAL_CALENDAR_READ_BATCH_SIZE);
    expect(query.props).toEqual({ isRoot: true });

    expect(claims).toEqual([
      {
        id: "60000000-0000-4000-8000-000000000011",
        expected: new Date("2026-10-15T10:00:00.000Z"),
        leaseUntil: new Date(
          NOW.getTime() + EXTERNAL_CALENDAR_READ_LEASE_IN_MINUTES * 60 * 1000,
        ),
      },
      {
        id: "60000000-0000-4000-8000-000000000012",
        expected: null,
        leaseUntil: new Date(
          NOW.getTime() + EXTERNAL_CALENDAR_READ_LEASE_IN_MINUTES * 60 * 1000,
        ),
      },
    ]);
    expect(readSpy).toHaveBeenCalledTimes(2);
    // Each claim also says when the read began.
    expect(world.writes).toEqual([
      { lastReadAttemptAt: NOW },
      { lastReadAttemptAt: NOW },
    ]);
  });

  test("a calendar another reader claimed first is left to it", async () => {
    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findBy",
    ).mockResolvedValue([calendar()]);

    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "claimForRead",
    ).mockResolvedValue(false);

    const readSpy: jest.SpyInstance = getJestSpyOn(
      ExternalCalendarRefresher,
      "readCalendar",
    );

    expect(await ExternalCalendarRefresher.readDueCalendars()).toBe(0);
    expect(readSpy).not.toHaveBeenCalled();
    expect(world.writes).toEqual([]);
  });

  test("one calendar that fails to be read never stops the rest", async () => {
    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findBy",
    ).mockResolvedValue([
      calendar({ _id: "60000000-0000-4000-8000-000000000021" }),
      calendar({ _id: "60000000-0000-4000-8000-000000000022" }),
    ]);

    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "claimForRead",
    ).mockResolvedValue(true);

    const readSpy: jest.SpyInstance = getJestSpyOn(
      ExternalCalendarRefresher,
      "readCalendar",
    )
      .mockRejectedValueOnce(new Error("database went away"))
      .mockResolvedValueOnce({ read: true, error: null, eventCount: 1 });

    expect(await ExternalCalendarRefresher.readDueCalendars()).toBe(1);
    expect(readSpy).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();
  });

  // Due calendars with ids from `from` on: a backlog's worth.
  function dueCalendars(
    from: number,
    count: number,
  ): Array<ScheduledMaintenanceExternalCalendar> {
    return Array.from({ length: count }, (_unused: unknown, index: number) => {
      return calendar({
        _id: `60000000-0000-4000-8000-${String(from + index).padStart(12, "0")}`,
      });
    });
  }

  test("a whole batch due is followed by the next in the same run, until one is short", async () => {
    const findBy: jest.SpyInstance = getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findBy",
    )
      .mockResolvedValueOnce(
        dueCalendars(100, EXTERNAL_CALENDAR_READ_BATCH_SIZE),
      )
      .mockResolvedValueOnce(dueCalendars(200, 3));

    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "claimForRead",
    ).mockResolvedValue(true);

    const readSpy: jest.SpyInstance = getJestSpyOn(
      ExternalCalendarRefresher,
      "readCalendar",
    ).mockResolvedValue({ read: true, error: null, eventCount: 1 });

    expect(await ExternalCalendarRefresher.readDueCalendars()).toBe(
      EXTERNAL_CALENDAR_READ_BATCH_SIZE + 3,
    );
    // The short batch was the last: nothing more is asked for.
    expect(findBy).toHaveBeenCalledTimes(2);
    expect(readSpy).toHaveBeenCalledTimes(
      EXTERNAL_CALENDAR_READ_BATCH_SIZE + 3,
    );
  });

  test("a calendar still due after its try is not tried again in the run", async () => {
    // Another reader holds every one: their claims fail, and they stay due.
    const findBy: jest.SpyInstance = getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findBy",
    ).mockResolvedValue(dueCalendars(300, EXTERNAL_CALENDAR_READ_BATCH_SIZE));

    const claimSpy: jest.SpyInstance = getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "claimForRead",
    ).mockResolvedValue(false);

    const readSpy: jest.SpyInstance = getJestSpyOn(
      ExternalCalendarRefresher,
      "readCalendar",
    );

    expect(await ExternalCalendarRefresher.readDueCalendars()).toBe(0);
    expect(findBy).toHaveBeenCalledTimes(2);
    expect(claimSpy).toHaveBeenCalledTimes(EXTERNAL_CALENDAR_READ_BATCH_SIZE);
    expect(readSpy).not.toHaveBeenCalled();
  });

  test(`a run stops reading once ${EXTERNAL_CALENDAR_READ_RUN_BUDGET_IN_SECONDS} seconds are up, leaving the rest to the next run`, async () => {
    // Every read takes ten seconds on the clock, and the backlog never ends.
    let clock: number = NOW.getTime();

    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation(
      (): Date => {
        return new Date(clock);
      },
    );

    let batches: number = 0;

    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "findBy",
    ).mockImplementation(async (): Promise<unknown> => {
      batches++;
      return dueCalendars(1000 * batches, EXTERNAL_CALENDAR_READ_BATCH_SIZE);
    });

    const claims: Array<Date> = [];

    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "claimForRead",
    ).mockImplementation(async (input: unknown): Promise<boolean> => {
      claims.push((input as { leaseUntil: Date }).leaseUntil);
      return true;
    });

    const readSpy: jest.SpyInstance = getJestSpyOn(
      ExternalCalendarRefresher,
      "readCalendar",
    ).mockImplementation(async (): Promise<ExternalCalendarReadOutcome> => {
      clock += 10 * 1000;
      return { read: true, error: null, eventCount: 1 };
    });

    // Reads begin 0, 10, 20, 30 and 40 seconds in; at 50 the time is up.
    const expected: number = Math.ceil(
      EXTERNAL_CALENDAR_READ_RUN_BUDGET_IN_SECONDS / 10,
    );

    expect(await ExternalCalendarRefresher.readDueCalendars()).toBe(expected);
    expect(readSpy).toHaveBeenCalledTimes(expected);

    // Each claim's lease runs from when it was made, not from the run's start.
    expect(claims[1]!.getTime() - claims[0]!.getTime()).toBe(10 * 1000);
  });
});

describe("Read now", () => {
  function claimed(result: boolean): jest.SpyInstance {
    return getJestSpyOn(
      ScheduledMaintenanceExternalCalendarService,
      "claimForRead",
    ).mockResolvedValue(result);
  }

  test("reads the calendar at once, claiming it first", async () => {
    const claim: jest.SpyInstance = claimed(true);

    expect(await ExternalCalendarRefresher.readNow(CALENDAR_ID)).toEqual({
      read: true,
      error: null,
      eventCount: 1,
    });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(world.replaced).toEqual([EVENTS]);
  });

  test("a calendar that does not exist is not found", async () => {
    arrange({
      calendar: null as unknown as ScheduledMaintenanceExternalCalendar,
    });

    await expect(
      ExternalCalendarRefresher.readNow(CALENDAR_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test("a calendar that is off is not read", async () => {
    arrange({ calendar: calendar({ isEnabled: false }) });
    const claim: jest.SpyInstance = claimed(true);

    await expect(
      ExternalCalendarRefresher.readNow(CALENDAR_ID),
    ).rejects.toEqual(
      new BadDataException(EXTERNAL_CALENDAR_TURNED_OFF_MESSAGE),
    );
    expect(claim).not.toHaveBeenCalled();
    expect(world.fetchedLinks).toEqual([]);
  });

  test(`a calendar read less than ${EXTERNAL_CALENDAR_READ_NOW_COOLDOWN_IN_SECONDS} seconds ago is not read again`, async () => {
    arrange({
      calendar: calendar({
        lastReadAttemptAt: new Date(NOW.getTime() - 10 * 1000),
      }),
    });
    const claim: jest.SpyInstance = claimed(true);

    await expect(
      ExternalCalendarRefresher.readNow(CALENDAR_ID),
    ).rejects.toEqual(
      new BadDataException(EXTERNAL_CALENDAR_READ_TOO_SOON_MESSAGE),
    );
    expect(claim).not.toHaveBeenCalled();
  });

  test("a calendar read longer ago than that is read", async () => {
    arrange({
      calendar: calendar({
        lastReadAttemptAt: new Date(
          NOW.getTime() -
            (EXTERNAL_CALENDAR_READ_NOW_COOLDOWN_IN_SECONDS + 1) * 1000,
        ),
      }),
    });
    claimed(true);

    expect((await ExternalCalendarRefresher.readNow(CALENDAR_ID)).read).toBe(
      true,
    );
  });

  test("a calendar another reader is reading is left to it", async () => {
    claimed(false);

    await expect(
      ExternalCalendarRefresher.readNow(CALENDAR_ID),
    ).rejects.toEqual(
      new BadDataException(EXTERNAL_CALENDAR_READ_TOO_SOON_MESSAGE),
    );
    expect(world.fetchedLinks).toEqual([]);
  });
});
