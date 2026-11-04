import SecurityHuntScheduler, {
  SecurityHuntRunOutcome,
} from "../../../../../Server/Utils/SecurityEvent/Hunts/SecurityHuntScheduler";
import SecurityHuntNotifications from "../../../../../Server/Utils/SecurityEvent/Hunts/SecurityHuntNotifications";
import AccessTokenService from "../../../../../Server/Services/AccessTokenService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityHuntRunService, {
  Service as SecurityHuntRunServiceClass,
} from "../../../../../Server/Services/SecurityHuntRunService";
import SecurityHuntService from "../../../../../Server/Services/SecurityHuntService";
import logger from "../../../../../Server/Utils/Logger";
import SecurityHunt from "../../../../../Models/DatabaseModels/SecurityHunt";
import SecurityHuntRun from "../../../../../Models/DatabaseModels/SecurityHuntRun";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import QueryTimeoutException from "../../../../../Types/Exception/QueryTimeoutException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import {
  SECURITY_HUNT_RUN_DELAY_IN_SECONDS,
  SECURITY_HUNT_RUN_ERRORS,
  SECURITY_HUNT_RUN_RETENTION_IN_DAYS,
  SecurityHuntRunResult,
  SecurityHuntRunWindow,
  SecurityHuntSchedule,
  getSecurityHuntRunResult,
} from "../../../../../Types/SecurityEvent/SecurityHunt";
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
 * A HUNT'S RUN HISTORY (SecurityHuntRun), as the scheduler keeps it.
 *
 * Every scheduled run that read events is kept: its window, how many events
 * its search found there - none is a run too - or why it could not be made.
 * Only once the run's record on its hunt has held, so a window two workers
 * read is kept once; never for a run with nothing new to read, nor for a hunt
 * taken off its schedule. Keeping it never fails the run: the hunt is still
 * recorded and its people still told. The rows are written as OneUptime, and
 * the service clears them once they are 90 days old.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const MAYA: ObjectID = new ObjectID("80000000-0000-4000-8000-000000000001");
const HUNT_ID: ObjectID = new ObjectID("3b000000-0000-4000-8000-000000000001");
const MINUTE: number = 60 * 1000;
const NOW: Date = new Date("2026-10-29T12:00:00.000Z");
const DELAY: number = SECURITY_HUNT_RUN_DELAY_IN_SECONDS * 1000;
const SEARCHED_UP_TO: Date = new Date(NOW.getTime() - 61 * MINUTE);
const DUE_AT: Date = new Date(NOW.getTime() - MINUTE);

// The window an hourly run made at NOW reads.
const WINDOW: SecurityHuntRunWindow = {
  startTime: new Date(SEARCHED_UP_TO.getTime() + 1),
  endTime: new Date(NOW.getTime() - DELAY),
};

function hunt(values: Partial<Record<string, unknown>> = {}): SecurityHunt {
  const model: SecurityHunt = new SecurityHunt();
  model._id = HUNT_ID.toString();
  model.projectId = PROJECT_ID;
  model.name = "Encoded PowerShell";
  model.schedule = SecurityHuntSchedule.EveryHour;
  model.searchQuery = "processname:powershell.exe commandline:-enc";
  model.filters = {};
  model.scheduledByUserId = MAYA;
  model.searchedUpToAt = SEARCHED_UP_TO;
  model.nextRunAt = DUE_AT;
  Object.assign(model, values);
  return model;
}

const READER: DatabaseCommonInteractionProps = {
  userId: MAYA,
  tenantId: PROJECT_ID,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [Permission.ProjectUser, Permission.SecurityViewer].map(
        (permission: Permission) => {
          return { _type: "UserPermission", permission, labelIds: [] };
        },
      ),
    },
  },
} as unknown as DatabaseCommonInteractionProps;

let propsOf: Spy;
let countBy: Spy;
let compareAndSet: Spy;
let huntFound: Spy;
let keepRun: Spy;

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
  keepRun = getJestSpyOn(SecurityHuntRunService, "create").mockResolvedValue(
    {} as never,
  );
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The one run the scheduler kept, and how it was written.
function keptRun(): { run: SecurityHuntRun; props: unknown } {
  expect(keepRun).toHaveBeenCalledTimes(1);

  const call: { data: SecurityHuntRun; props: unknown } = keepRun.mock
    .calls[0]![0] as { data: SecurityHuntRun; props: unknown };

  return { run: call.data, props: call.props };
}

describe("every scheduled run that read events is kept", () => {
  test("one that found events: its hunt, its project, its window and how many it found, written as OneUptime", async () => {
    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt(),
      { now: NOW },
    );
    const { run, props } = keptRun();

    expect(outcome.isKeptInHistory).toBe(true);
    expect(run).toBeInstanceOf(SecurityHuntRun);
    expect(run.projectId).toEqual(PROJECT_ID);
    expect(run.securityHuntId).toEqual(HUNT_ID);
    expect(run.windowStartAt).toEqual(WINDOW.startTime);
    expect(run.windowEndAt).toEqual(WINDOW.endTime);
    expect(run.eventCount).toBe(3);
    expect(run.error).toBeUndefined();
    // Nobody makes these rows: OneUptime does, as the run is recorded.
    expect(props).toEqual({ isRoot: true });
    expect(getSecurityHuntRunResult(run)).toBe(SecurityHuntRunResult.Found);
  });

  test("one that found nothing is a run too: kept with none found, so the history shows the hunt ran", async () => {
    countBy.mockResolvedValue(new PositiveNumber(0) as never);

    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt(),
      { now: NOW },
    );
    const { run } = keptRun();

    expect(outcome.isKeptInHistory).toBe(true);
    expect(run.eventCount).toBe(0);
    expect(run.windowStartAt).toEqual(WINDOW.startTime);
    expect(getSecurityHuntRunResult(run)).toBe(
      SecurityHuntRunResult.NothingFound,
    );
    expect(huntFound).not.toHaveBeenCalled();
  });

  test("one that could not be made: kept with why, the window it tried, and no count", async () => {
    propsOf.mockResolvedValue({ userId: MAYA } as never);

    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt(),
      { now: NOW },
    );
    const { run } = keptRun();

    expect(outcome.isKeptInHistory).toBe(true);
    expect(run.error).toBe(
      SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message,
    );
    expect(run.eventCount).toBeUndefined();
    expect(run.windowStartAt).toEqual(WINDOW.startTime);
    expect(run.windowEndAt).toEqual(WINDOW.endTime);
    expect(getSecurityHuntRunResult(run)).toBe(SecurityHuntRunResult.Failed);
  });

  test("one whose search the time limit stopped: kept as failed, never as having found nothing", async () => {
    countBy.mockRejectedValue(
      new QueryTimeoutException("The query took too long.") as never,
    );

    await SecurityHuntScheduler.runHunt(hunt(), { now: NOW });

    const { run } = keptRun();

    expect(run.error).toBe(SECURITY_HUNT_RUN_ERRORS.timedOut.message);
    expect(run.eventCount).toBeUndefined();
    expect(getSecurityHuntRunResult(run)).toBe(SecurityHuntRunResult.Failed);
  });

  test("kept only after the hunt's record, and before its people are told", async () => {
    const order: Array<string> = [];

    compareAndSet.mockImplementation((async () => {
      order.push("record");
      return true;
    }) as never);
    keepRun.mockImplementation((async () => {
      order.push("history");
      return {};
    }) as never);
    huntFound.mockImplementation((async () => {
      order.push("notify");
      return true;
    }) as never);

    await SecurityHuntScheduler.runHunt(hunt(), { now: NOW });

    expect(order).toEqual(["record", "history", "notify"]);
  });
});

describe("what is not kept", () => {
  test("a run whose record did not hold - changed meanwhile, or recorded by another worker - so a window is kept once", async () => {
    compareAndSet.mockResolvedValue(false as never);

    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt(),
      { now: NOW },
    );

    expect(outcome.isKeptInHistory).toBe(false);
    expect(keepRun).not.toHaveBeenCalled();
  });

  test("a failed run whose record did not hold either", async () => {
    propsOf.mockResolvedValue({ userId: MAYA } as never);
    compareAndSet.mockResolvedValue(false as never);

    await SecurityHuntScheduler.runHunt(hunt(), { now: NOW });

    expect(keepRun).not.toHaveBeenCalled();
  });

  test("a turn with nothing new to read yet: it read nothing, so there is no run", async () => {
    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt({ searchedUpToAt: new Date(NOW.getTime() - DELAY) }),
      { now: NOW },
    );

    expect(outcome.window).toBeNull();
    expect(keepRun).not.toHaveBeenCalled();
  });

  test("a hunt taken off its schedule since it was found due", async () => {
    await SecurityHuntScheduler.runHunt(
      hunt({ schedule: SecurityHuntSchedule.NotScheduled }),
      { now: NOW },
    );

    expect(keepRun).not.toHaveBeenCalled();
  });
});

describe("keeping a run never fails the run", () => {
  test("a history that cannot be written is logged; the hunt is still recorded and its people still told", async () => {
    keepRun.mockRejectedValue(new Error("database is down") as never);

    const outcome: SecurityHuntRunOutcome = await SecurityHuntScheduler.runHunt(
      hunt(),
      { now: NOW },
    );

    expect(outcome.isRecorded).toBe(true);
    expect(outcome.isKeptInHistory).toBe(false);
    expect(outcome.isNotificationQueued).toBe(true);
    expect(huntFound).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });

  test("keepInHistory itself never throws, and says whether it kept the run", async () => {
    await expect(
      SecurityHuntScheduler.keepInHistory({
        hunt: hunt(),
        window: WINDOW,
        eventCount: 5,
        error: null,
      }),
    ).resolves.toBe(true);

    keepRun.mockRejectedValue(new Error("connection reset") as never);

    await expect(
      SecurityHuntScheduler.keepInHistory({
        hunt: hunt(),
        window: WINDOW,
        eventCount: null,
        error: SECURITY_HUNT_RUN_ERRORS.searchFailed.message,
      }),
    ).resolves.toBe(false);
  });
});

describe("how long runs are kept", () => {
  test("90 days, cleared by the daily clean-up every such table has, by when each run was made", () => {
    expect(SECURITY_HUNT_RUN_RETENTION_IN_DAYS).toBe(90);

    const service: SecurityHuntRunServiceClass =
      new SecurityHuntRunServiceClass();

    expect(service.hardDeleteItemByColumnName).toBe("createdAt");
    expect(service.hardDeleteItemsOlderThanDays).toBe(
      SECURITY_HUNT_RUN_RETENTION_IN_DAYS,
    );
    // The one the workers use is the same.
    expect(SecurityHuntRunService.hardDeleteItemsOlderThanDays).toBe(90);
  });
});

describe("what a run came to, as its row says it", () => {
  test("found, found nothing, or failed: an error wins over any count", () => {
    expect(getSecurityHuntRunResult({ eventCount: 12 })).toBe(
      SecurityHuntRunResult.Found,
    );
    expect(getSecurityHuntRunResult({ eventCount: 0 })).toBe(
      SecurityHuntRunResult.NothingFound,
    );
    expect(getSecurityHuntRunResult({ eventCount: null })).toBe(
      SecurityHuntRunResult.NothingFound,
    );
    expect(
      getSecurityHuntRunResult({ eventCount: 4, error: "Its search failed." }),
    ).toBe(SecurityHuntRunResult.Failed);
    expect(getSecurityHuntRunResult({ error: "Its search failed." })).toBe(
      SecurityHuntRunResult.Failed,
    );
  });
});
