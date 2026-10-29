import SecurityHuntScheduler, {
  SECURITY_HUNTS_PROJECT_WORK,
  SecurityHuntRunError,
  SecurityHuntRunOutcome,
} from "../../../../../Server/Utils/SecurityEvent/Hunts/SecurityHuntScheduler";
import SecurityHuntNotifications from "../../../../../Server/Utils/SecurityEvent/Hunts/SecurityHuntNotifications";
import SecurityProjectWork, {
  SecurityProjectWorkLease,
} from "../../../../../Server/Utils/SecurityEvent/SecurityProjectWork";
import AccessTokenService from "../../../../../Server/Services/AccessTokenService";
import AnalyticsDatabaseService from "../../../../../Server/Services/AnalyticsDatabaseService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityHuntService from "../../../../../Server/Services/SecurityHuntService";
import logger from "../../../../../Server/Utils/Logger";
import SecurityHunt from "../../../../../Models/DatabaseModels/SecurityHunt";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import QueryTimeoutException from "../../../../../Types/Exception/QueryTimeoutException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import {
  SECURITY_HUNT_RUN_DELAY_IN_SECONDS,
  SECURITY_HUNT_RUN_ERRORS,
  SecurityHuntRunWindow,
  SecurityHuntSchedule,
} from "../../../../../Types/SecurityEvent/SecurityHunt";
import { buildSecurityHuntQuery } from "../../../../../Utils/SecurityEvent/SecurityHuntSearch";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A SCHEDULED HUNT'S RUNS (SecurityHuntScheduler).
 *
 * Every minute the projects with a hunt due get a turn; a turn runs their
 * due hunts, the longest overdue first, while it keeps its lease. One run
 * counts what the hunt's search finds in the events that arrived since the
 * last one - as the person it runs as, exactly, through the Events page's
 * read - records it in one compare-and-set on the schedule it was read
 * with, and only then queues the notification. A run that cannot be made
 * says why on the hunt, keeps its window, and is tried again within the
 * hour.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const MAYA: ObjectID = new ObjectID("80000000-0000-4000-8000-000000000001");
const HUNT_ID: ObjectID = new ObjectID("3b000000-0000-4000-8000-000000000001");
const MINUTE: number = 60 * 1000;
const NOW: Date = new Date("2026-10-29T12:00:00.000Z");
const DELAY: number = SECURITY_HUNT_RUN_DELAY_IN_SECONDS * 1000;
const SEARCHED_UP_TO: Date = new Date(NOW.getTime() - 61 * MINUTE);
const DUE_AT: Date = new Date(NOW.getTime() - MINUTE);

function hunt(values: Partial<Record<string, unknown>> = {}): SecurityHunt {
  const model: SecurityHunt = new SecurityHunt();
  model._id = HUNT_ID.toString();
  model.projectId = PROJECT_ID;
  model.name = "Encoded PowerShell";
  model.schedule = SecurityHuntSchedule.EveryHour;
  model.searchQuery = "processname:powershell.exe commandline:-enc";
  model.filters = { "!statusName": ["Failure"] };
  model.scheduledByUserId = MAYA;
  model.searchedUpToAt = SEARCHED_UP_TO;
  model.nextRunAt = DUE_AT;
  Object.assign(model, values);
  return model;
}

// Somebody in the project, with the permissions given.
function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: MAYA,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return { _type: "UserPermission", permission, labelIds: [] };
        }),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

const READER: DatabaseCommonInteractionProps = member([
  Permission.ProjectUser,
  Permission.SecurityViewer,
]);

let propsOf: Spy;
let countBy: Spy;
let compareAndSet: Spy;
let huntFound: Spy;

beforeEach(() => {
  propsOf = getJestSpyOn(
    AccessTokenService,
    "getDatabaseCommonInteractionPropsByUserAndProject",
  ).mockResolvedValue(READER as never);
  countBy = getJestSpyOn(SecurityEventService, "countBy").mockResolvedValue(
    new PositiveNumber(3) as never,
  );
  compareAndSet = getJestSpyOn(
    SecurityHuntService,
    "compareAndSetColumnsByIdWithoutHooks",
  ).mockResolvedValue(true as never);
  huntFound = getJestSpyOn(
    SecurityHuntNotifications,
    "huntFound",
  ).mockResolvedValue(true as never);
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// What the one compare-and-set of a run wrote.
function recorded(): Record<string, unknown> {
  expect(compareAndSet).toHaveBeenCalledTimes(1);
  return (compareAndSet.mock.calls[0]![0] as { data: Record<string, unknown> })
    .data;
}

describe("the cron's half", () => {
  test("queues one turn for each project with a hunt due, read as OneUptime", async () => {
    const findAll: Spy = getJestSpyOn(
      SecurityHuntService,
      "findAllBy",
    ).mockResolvedValue([
      hunt(),
      hunt({ _id: "3b000000-0000-4000-8000-000000000002" }),
      hunt({ projectId: OTHER_PROJECT_ID }),
    ] as never);
    const enqueue: Spy = getJestSpyOn(
      SecurityProjectWork,
      "enqueueProjects",
    ).mockResolvedValue(2 as never);

    await expect(
      SecurityHuntScheduler.enqueueProjectsWithDueHunts(NOW),
    ).resolves.toBe(2);

    const read: Record<string, unknown> = findAll.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(read["props"]).toEqual({ isRoot: true });
    expect(read["sort"]).toEqual({ nextRunAt: SortOrder.Ascending });
    expect(Object.keys(read["query"] as Record<string, unknown>)).toEqual([
      "nextRunAt",
    ]);
    expect(enqueue).toHaveBeenCalledWith(
      SECURITY_HUNTS_PROJECT_WORK,
      [PROJECT_ID, PROJECT_ID, OTHER_PROJECT_ID],
      NOW,
    );
    expect(SECURITY_HUNTS_PROJECT_WORK.jobName).toBe(
      "SecurityHunts:RunProject",
    );
  });
});

describe("a project's turn", () => {
  function lease(options: {
    timeLeft: Array<boolean>;
    kept: Array<boolean>;
  }): SecurityProjectWorkLease {
    return {
      hasTimeLeft: (): boolean => {
        return options.timeLeft.length > 0 ? options.timeLeft.shift()! : true;
      },
      keep: async (): Promise<boolean> => {
        return options.kept.length > 0 ? options.kept.shift()! : true;
      },
    } as SecurityProjectWorkLease;
  }

  test("runs the project's due hunts, the longest overdue first", async () => {
    const findAll: Spy = getJestSpyOn(
      SecurityHuntService,
      "findAllBy",
    ).mockResolvedValue([hunt(), hunt(), hunt()] as never);
    const run: Spy = getJestSpyOn(
      SecurityHuntScheduler,
      "runHunt",
    ).mockResolvedValue({} as never);

    await SecurityHuntScheduler.runDueHuntsForProject(PROJECT_ID);

    const read: Record<string, unknown> = findAll.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect((read["query"] as Record<string, unknown>)["projectId"]).toBe(
      PROJECT_ID,
    );
    expect(read["sort"]).toEqual({ nextRunAt: SortOrder.Ascending });
    expect(read["props"]).toEqual({ isRoot: true });
    expect(run).toHaveBeenCalledTimes(3);
  });

  test("stops when its time is up, or its lease is lost: what is left is still due next minute", async () => {
    getJestSpyOn(SecurityHuntService, "findAllBy").mockResolvedValue([
      hunt(),
      hunt(),
      hunt(),
    ] as never);
    const run: Spy = getJestSpyOn(
      SecurityHuntScheduler,
      "runHunt",
    ).mockResolvedValue({} as never);

    await SecurityHuntScheduler.runDueHuntsForProject(
      PROJECT_ID,
      lease({ timeLeft: [true, false], kept: [] }),
    );
    expect(run).toHaveBeenCalledTimes(1);

    run.mockClear();
    await SecurityHuntScheduler.runDueHuntsForProject(
      PROJECT_ID,
      lease({ timeLeft: [], kept: [true, false] }),
    );
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("who a run reads as", () => {
  test("the person it runs as, as they are in the project now", async () => {
    await expect(SecurityHuntScheduler.getRunProps(hunt())).resolves.toBe(
      READER,
    );
    expect(propsOf).toHaveBeenCalledWith({
      userId: MAYA,
      projectId: PROJECT_ID,
    });
  });

  test("nobody, for a hunt with nobody to run as: it says so", async () => {
    await expect(
      SecurityHuntScheduler.getRunProps(hunt({ scheduledByUserId: null })),
    ).rejects.toEqual(
      new SecurityHuntRunError(
        SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message,
      ),
    );
    expect(propsOf).not.toHaveBeenCalled();
  });

  test("nobody, for somebody who left the project or no longer reads security events", async () => {
    for (const props of [
      { userId: MAYA } as DatabaseCommonInteractionProps,
      member([Permission.ProjectUser]),
      member([Permission.ProjectUser, Permission.ReadSecurityCase]),
    ]) {
      propsOf.mockResolvedValue(props as never);

      await expect(SecurityHuntScheduler.getRunProps(hunt())).rejects.toEqual(
        new SecurityHuntRunError(
          SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message,
        ),
      );
    }
  });
});

describe("what a run counts", () => {
  test("the hunt's search and chips over its window, as the Events page reads them, exactly", async () => {
    const window: SecurityHuntRunWindow = {
      startTime: new Date(SEARCHED_UP_TO.getTime() + 1),
      endTime: new Date(NOW.getTime() - DELAY),
    };

    await expect(
      SecurityHuntScheduler.countEvents({
        hunt: hunt(),
        window,
        props: READER,
      }),
    ).resolves.toBe(3);
    expect(countBy).toHaveBeenCalledWith({
      query: buildSecurityHuntQuery({
        projectId: PROJECT_ID,
        searchQuery: hunt().searchQuery,
        filters: { "!statusName": ["Failure"] },
        startTime: window.startTime,
        endTime: window.endTime,
      }),
      props: READER,
      exact: true,
    });
  });

  test("why it could not: in the words the hunt shows", () => {
    expect(
      SecurityHuntScheduler.describeRunError(
        new SecurityHuntRunError("its own words"),
      ),
    ).toBe("its own words");
    expect(
      SecurityHuntScheduler.describeRunError(
        new QueryTimeoutException("The query took too long."),
      ),
    ).toBe(SECURITY_HUNT_RUN_ERRORS.timedOut.message);

    const isTimeout: Spy = getJestSpyOn(
      AnalyticsDatabaseService,
      "isQueryTimeoutError",
    ).mockReturnValue(true as never);

    expect(
      SecurityHuntScheduler.describeRunError(new Error("Timeout exceeded")),
    ).toBe(SECURITY_HUNT_RUN_ERRORS.timedOut.message);

    isTimeout.mockReturnValue(false as never);

    // Never the database's own words, which may name tables and columns.
    expect(
      SecurityHuntScheduler.describeRunError(
        new Error("Code: 62. DB::Exception: Syntax error near attributes"),
      ),
    ).toBe(SECURITY_HUNT_RUN_ERRORS.searchFailed.message);
  });
});

describe("one run of a hunt", () => {
  test("that finds events: records them, moves its window on, and only then tells people", async () => {
    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt(),
      { now: NOW },
    );
    const window: SecurityHuntRunWindow = {
      startTime: new Date(SEARCHED_UP_TO.getTime() + 1),
      endTime: new Date(NOW.getTime() - DELAY),
    };

    expect(outcome).toEqual({
      window,
      eventCount: 3,
      error: null,
      isRecorded: true,
      isNotificationQueued: true,
    });
    expect(recorded()).toEqual({
      lastRunAt: NOW,
      lastRunEventCount: 3,
      lastRunError: null,
      searchedUpToAt: window.endTime,
      // Due a minute ago, every hour: an hour after it was due.
      nextRunAt: new Date(DUE_AT.getTime() + 60 * MINUTE),
      lastFoundAt: window.endTime,
      lastFoundSinceAt: window.startTime,
      lastFoundEventCount: 3,
    });
    expect(huntFound).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      securityHuntId: HUNT_ID,
      eventCount: 3,
      window,
    });
  });

  test("records on the schedule it was read with, so a hunt changed while it ran keeps the change", async () => {
    await SecurityHuntScheduler.runHunt(hunt(), { now: NOW });

    const call: Record<string, unknown> = compareAndSet.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(call["id"]).toEqual(HUNT_ID);
    expect(call["expectedData"]).toEqual({
      nextRunAt: DUE_AT,
      searchedUpToAt: SEARCHED_UP_TO,
    });
    expect(call["skipUpdateDateColumn"]).toBe(true);
  });

  test("whose record did not hold - changed meanwhile, or recorded by another worker - tells nobody", async () => {
    compareAndSet.mockResolvedValue(false as never);

    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt(),
      { now: NOW },
    );

    expect(outcome.isRecorded).toBe(false);
    expect(outcome.isNotificationQueued).toBe(false);
    expect(huntFound).not.toHaveBeenCalled();
  });

  test("that finds nothing: says so, moves its window on, keeps what it found before, tells nobody", async () => {
    countBy.mockResolvedValue(new PositiveNumber(0) as never);

    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt(),
      { now: NOW },
    );
    const write: Record<string, unknown> = recorded();

    expect(outcome.eventCount).toBe(0);
    expect(write["lastRunEventCount"]).toBe(0);
    expect(write["searchedUpToAt"]).toEqual(new Date(NOW.getTime() - DELAY));
    expect(write).not.toHaveProperty("lastFoundAt");
    expect(write).not.toHaveProperty("lastFoundEventCount");
    expect(huntFound).not.toHaveBeenCalled();
  });

  test("that cannot read - its author left - says why, keeps its window, and tries again within the hour", async () => {
    propsOf.mockResolvedValue(member([Permission.ProjectUser]) as never);

    const weekly: SecurityHunt = hunt({
      schedule: SecurityHuntSchedule.EveryWeek,
    });
    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      weekly,
      { now: NOW },
    );

    expect(outcome.error).toBe(
      SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message,
    );
    expect(countBy).not.toHaveBeenCalled();
    expect(recorded()).toEqual({
      lastRunAt: NOW,
      lastRunError: SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message,
      nextRunAt: new Date(NOW.getTime() + 60 * MINUTE),
    });
    expect(huntFound).not.toHaveBeenCalled();
    // A run it could not make is no error of OneUptime's to log.
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("whose search the time limit stopped: says so, never that it found nothing", async () => {
    countBy.mockRejectedValue(
      new QueryTimeoutException("The query took too long.") as never,
    );

    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt(),
      { now: NOW },
    );
    const write: Record<string, unknown> = recorded();

    expect(outcome.eventCount).toBeNull();
    expect(write["lastRunError"]).toBe(
      SECURITY_HUNT_RUN_ERRORS.timedOut.message,
    );
    expect(write).not.toHaveProperty("lastRunEventCount");
    expect(write).not.toHaveProperty("searchedUpToAt");
  });

  test("whose search failed some other way: logged for OneUptime, said plainly on the hunt", async () => {
    countBy.mockRejectedValue(new Error("connection reset") as never);

    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt(),
      { now: NOW },
    );

    expect(outcome.error).toBe(SECURITY_HUNT_RUN_ERRORS.searchFailed.message);
    expect(logger.error).toHaveBeenCalled();
  });

  test("with nothing new to read yet: due again next interval, and nothing else written", async () => {
    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt({ searchedUpToAt: new Date(NOW.getTime() - DELAY) }),
      { now: NOW },
    );

    expect(outcome.window).toBeNull();
    expect(countBy).not.toHaveBeenCalled();
    expect(recorded()).toEqual({
      nextRunAt: new Date(DUE_AT.getTime() + 60 * MINUTE),
    });
  });

  test("taken off its schedule since it was found due: runs no more", async () => {
    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt({ schedule: SecurityHuntSchedule.NotScheduled }),
      { now: NOW },
    );

    expect(outcome.window).toBeNull();
    expect(countBy).not.toHaveBeenCalled();
    expect(recorded()).toEqual({ nextRunAt: null });
  });

  test("never throws, even when its record cannot be written", async () => {
    compareAndSet.mockRejectedValue(new Error("database is down") as never);

    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt(),
      { now: NOW },
    );

    expect(outcome.isRecorded).toBe(false);
    expect(huntFound).not.toHaveBeenCalled();
  });

  test("of a hunt with no id or project: nothing at all", async () => {
    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt({ projectId: undefined }),
      { now: NOW },
    );

    expect(outcome.isRecorded).toBe(false);
    expect(compareAndSet).not.toHaveBeenCalled();
  });
});
