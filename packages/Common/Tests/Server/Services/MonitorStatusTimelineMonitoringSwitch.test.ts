import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService, {
  MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE,
  Service as MonitorStatusTimelineServiceClass,
} from "../../../Server/Services/MonitorStatusTimelineService";
import UserService from "../../../Server/Services/UserService";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * TURNING A MONITOR'S MONITORING OFF OR ON IS MARKED ON ITS STATUS TIMELINE
 * (issue #6480).
 *
 * Nothing recorded when monitoring was turned off, so uptime, status pages,
 * SLOs and monitor group graphs could not tell the time nothing checked the
 * monitor from the time it was checked: they counted it as the status the
 * monitor was left at. Turning the switch now starts a status event of its
 * own (MonitorStatusTimelineService.recordMonitoringSwitch) with the status
 * the monitor holds and MonitorStatusTimeline.isMonitoringOff saying which,
 * and every status event takes the switch it falls under, decided by
 * OneUptime whoever writes it:
 *
 *   - a status event appended now takes the monitor's switch as it is;
 *   - one written into the past takes the switch of the event before it
 *     (the first one's, before the first);
 *   - the same status as the event before it is refused unless the switch
 *     differs - then it marks only the switch.
 *
 * A status event that marks only the switch changes no status: it posts no
 * feed item, stamps no network device, starts no workflow and notifies no
 * owner. It still closes the event before it, as every status event does.
 *
 * These run the real create pipeline - DatabaseService's checks, the hooks,
 * the save, the success hooks - over in-memory tables for the status
 * timeline and the monitor, with an in-memory lock.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6480e000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("6480e000-0000-4000-8000-000000000002");
const MONITOR_ID: ObjectID = new ObjectID(
  "6480e000-0000-4000-8000-000000000003",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "6480e000-0000-4000-8000-0000000000a1",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "6480e000-0000-4000-8000-0000000000a2",
);

const DAY_MS: number = 24 * 60 * 60 * 1000;

// Well in the past, so a status event appended "now" comes after every row.
const FIRST_STATUS_AT: Date = new Date("2026-01-01T00:00:00.000Z");
const OFFLINE_AT: Date = new Date("2026-01-10T00:00:00.000Z");

interface InMemoryLock {
  name: string;
}

let held: Map<string, InMemoryLock>;
let timelines: InMemoryTable;
let monitors: InMemoryTable;
let feedItems: ReturnType<typeof getJestSpyOn>;
let networkBridge: ReturnType<typeof getJestSpyOn>;
let workflows: ReturnType<typeof getJestSpyOn>;

function timelineRow(data: {
  id: string;
  statusId: ObjectID;
  startsAt: Date;
  endsAt?: Date | undefined;
  isMonitoringOff: boolean;
}): StoredRow {
  return {
    _id: data.id,
    projectId: PROJECT_ID.toString(),
    monitorId: MONITOR_ID.toString(),
    monitorStatusId: data.statusId.toString(),
    startsAt: data.startsAt,
    endsAt: data.endsAt || null,
    isMonitoringOff: data.isMonitoringOff,
  };
}

const OPERATIONAL_ROW_ID: string = "6480e000-0000-4000-8000-0000000000b1";
const OFFLINE_ROW_ID: string = "6480e000-0000-4000-8000-0000000000b2";

// Operational, then Offline from OFFLINE_AT on: the monitor's history.
function history(offlineIsMonitoringOff: boolean = false): Array<StoredRow> {
  return [
    timelineRow({
      id: OPERATIONAL_ROW_ID,
      statusId: OPERATIONAL_STATUS_ID,
      startsAt: FIRST_STATUS_AT,
      endsAt: OFFLINE_AT,
      isMonitoringOff: false,
    }),
    timelineRow({
      id: OFFLINE_ROW_ID,
      statusId: OFFLINE_STATUS_ID,
      startsAt: OFFLINE_AT,
      isMonitoringOff: offlineIsMonitoringOff,
    }),
  ];
}

function useTables(data: {
  rows: Array<StoredRow>;
  isMonitoringOff: boolean;
}): void {
  timelines = useInMemoryTable(MonitorStatusTimelineService, data.rows);

  /*
   * The table stubs the service's workflow trigger; this is about that
   * trigger, so the service's own runs, down to DatabaseService's (spied).
   */
  (
    MonitorStatusTimelineService.onTriggerWorkflow as unknown as {
      mockRestore: () => void;
    }
  ).mockRestore();
  monitors = useInMemoryTable(MonitorService, [
    {
      _id: MONITOR_ID.toString(),
      projectId: PROJECT_ID.toString(),
      name: "Checkout API",
      currentMonitorStatusId: OFFLINE_STATUS_ID.toString(),
      disableActiveMonitoring: data.isMonitoringOff,
    },
  ]);
}

// The status event a create inserted, as stored.
function inserted(): StoredRow {
  expect(timelines.inserts).toHaveLength(1);
  return timelines.get(String(timelines.inserts[0]!["_id"]))!;
}

function onCreateWorkflowIds(): Array<string> {
  return workflows.mock.calls
    .filter((call: Array<unknown>) => {
      return call[2] === "on-create";
    })
    .map((call: Array<unknown>) => {
      return (call[0] as ObjectID).toString();
    });
}

async function changeStatus(data: {
  statusId: ObjectID;
  startsAt?: Date | undefined;
  isMonitoringOff?: boolean | undefined;
}): Promise<MonitorStatusTimeline> {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.projectId = PROJECT_ID;
  timeline.monitorId = MONITOR_ID;
  timeline.monitorStatusId = data.statusId;

  if (data.startsAt) {
    timeline.startsAt = data.startsAt;
  }

  if (data.isMonitoringOff !== undefined) {
    timeline.isMonitoringOff = data.isMonitoringOff;
  }

  return await MonitorStatusTimelineService.create({
    data: timeline,
    props: { isRoot: true },
  });
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

beforeEach(() => {
  held = new Map<string, InMemoryLock>();

  getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
    namespace: string;
  }): Promise<InMemoryLock> => {
    const name: string = `${data.namespace}-${data.key}`;

    if (held.has(name)) {
      throw new SemaphoreLockTimeoutError(`Acquire mutex ${name} timeout`);
    }

    const mutex: InMemoryLock = { name: name };
    held.set(name, mutex);
    return mutex;
  }) as never);

  getJestSpyOn(Semaphore, "release").mockImplementation((async (
    mutex: InMemoryLock,
  ): Promise<void> => {
    if (held.get(mutex.name) === mutex) {
      held.delete(mutex.name);
    }
  }) as never);

  stubProjectDirectory({});
  stubReadableParents();

  getJestSpyOn(UserService, "getUserMarkdownString").mockResolvedValue(
    FeedMarkdown.asMarkdown("[Ada Lovelace](mailto:ada@example.com)"),
  );

  // The monitor's own update hooks are about other writes.
  getJestSpyOn(MonitorService as never, "onBeforeUpdate").mockImplementation(
    (async (updateBy: unknown) => {
      return { updateBy: updateBy, carryForward: null };
    }) as never,
  );
  getJestSpyOn(MonitorService as never, "onUpdateSuccess").mockImplementation(
    (async (onUpdate: unknown) => {
      return onUpdate;
    }) as never,
  );

  // What a status change leads to once the lock is given back.
  networkBridge = getJestSpyOn(
    MonitorStatusTimelineService as never,
    "bridgeCurrentStatusToNetworkSites",
  ).mockResolvedValue(undefined as never);
  feedItems = getJestSpyOn(
    MonitorStatusTimelineService as never,
    "createStatusChangeFeedItem",
  ).mockResolvedValue(undefined as never);

  // The workflow service is not running here: the call is what is asked.
  workflows = getJestSpyOn(
    DatabaseService.prototype,
    "onTriggerWorkflow",
  ).mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("recordMonitoringSwitch: turning monitoring off", () => {
  beforeEach(() => {
    // The update has turned it off: the monitor reads off.
    useTables({ rows: history(), isMonitoringOff: true });
  });

  test("starts a status event with the status the monitor holds, marking its monitoring off", async () => {
    const before: number = Date.now();

    const written: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: true,
        switchedByUserId: USER_ID,
      });

    expect(written).not.toBeNull();

    const row: StoredRow = inserted();
    expect(String(row["monitorStatusId"])).toBe(OFFLINE_STATUS_ID.toString());
    expect(String(row["monitorId"])).toBe(MONITOR_ID.toString());
    expect(String(row["projectId"])).toBe(PROJECT_ID.toString());
    expect(row["isMonitoringOff"]).toBe(true);
    expect(row["endsAt"] || null).toBeNull();
    expect((row["startsAt"] as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(String(row["createdByUserId"])).toBe(USER_ID.toString());

    // Nobody is told the status changed: it did not.
    expect(row["isOwnerNotified"]).toBe(true);
    expect(row["rootCause"]).toBe(
      "[Ada Lovelace](mailto:ada@example.com) turned off monitoring. Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.",
    );
  });

  test("closes the status event before it at the switch, as every status event does", async () => {
    await MonitorStatusTimelineService.recordMonitoringSwitch({
      monitorId: MONITOR_ID,
      isMonitoringOff: true,
      switchedByUserId: USER_ID,
    });

    const row: StoredRow = inserted();
    expect((timelines.get(OFFLINE_ROW_ID)!["endsAt"] as Date).getTime()).toBe(
      (row["startsAt"] as Date).getTime(),
    );

    // The monitor's status is what it was; the lock is given back.
    expect(String(monitors.get(MONITOR_ID)!["currentMonitorStatusId"])).toBe(
      OFFLINE_STATUS_ID.toString(),
    );
    expect(Array.from(held.keys())).toEqual([]);
  });

  test("posts no feed item, stamps no network device and starts no On Create workflow", async () => {
    await MonitorStatusTimelineService.recordMonitoringSwitch({
      monitorId: MONITOR_ID,
      isMonitoringOff: true,
      switchedByUserId: USER_ID,
    });

    expect(feedItems).not.toHaveBeenCalled();
    expect(networkBridge).not.toHaveBeenCalled();
    expect(onCreateWorkflowIds()).toEqual([]);
  });

  test("the switch row's id is forgotten once its create is over: a later On Create for it is not held back", async () => {
    const written: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: true,
      });

    await MonitorStatusTimelineService.onTriggerWorkflow(
      written!.id!,
      PROJECT_ID,
      "on-create",
    );

    expect(onCreateWorkflowIds()).toEqual([written!.id!.toString()]);
  });

  test("turned off by OneUptime itself: credited to nobody", async () => {
    const userNames: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      UserService,
      "getUserMarkdownString",
    );

    await MonitorStatusTimelineService.recordMonitoringSwitch({
      monitorId: MONITOR_ID,
      isMonitoringOff: true,
    });

    const row: StoredRow = inserted();
    expect(row["createdByUserId"] || null).toBeNull();
    expect(row["rootCause"]).toBe(
      "Monitoring is off. Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.",
    );
    expect(userNames).not.toHaveBeenCalled();
  });

  test("writes nothing when the latest status event already marks it off", async () => {
    useTables({ rows: history(true), isMonitoringOff: true });

    expect(
      await MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: true,
      }),
    ).toBeNull();
    expect(timelines.inserts).toEqual([]);
  });

  test("already marked: not even tried - no lock taken, no duplicate refused, nobody looked up", async () => {
    useTables({ rows: history(true), isMonitoringOff: true });

    const create: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      MonitorStatusTimelineService,
      "create",
    );
    const lock: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      Semaphore,
      "lock",
    );
    const userNames: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      UserService,
      "getUserMarkdownString",
    );
    lock.mockClear();
    userNames.mockClear();

    /*
     * The refusal of a duplicate is logged as the sign of two writers
     * racing for one monitor: a migration run again, or a switch written
     * back as it is, must not raise it.
     */
    expect(
      await MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: true,
        switchedByUserId: USER_ID,
      }),
    ).toBeNull();

    expect(create).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
    expect(userNames).not.toHaveBeenCalled();
  });

  test("writes nothing for a monitor with no status yet: its first status event takes the switch as it is", async () => {
    useTables({ rows: [], isMonitoringOff: true });

    expect(
      await MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: true,
      }),
    ).toBeNull();
    expect(timelines.inserts).toEqual([]);

    // That first status event, appended now, reads the monitor's switch.
    await changeStatus({ statusId: OPERATIONAL_STATUS_ID });
    expect(inserted()["isMonitoringOff"]).toBe(true);
  });

  test("the monitor turned back on before the mark was written: the refusal of the same status is read as nothing to write", async () => {
    // The latest status event is monitored, and so is the monitor again.
    useTables({ rows: history(), isMonitoringOff: false });

    expect(
      await MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: true,
      }),
    ).toBeNull();
    expect(timelines.inserts).toEqual([]);
    expect(Array.from(held.keys())).toEqual([]);
  });

  test("any other failure is not swallowed", async () => {
    timelines.repository.save.mockRejectedValueOnce(
      new Error("The database went away."),
    );

    const error: unknown = await rejectionOf(
      MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: true,
      }),
    );

    expect((error as Error).message).toBe("The database went away.");
    expect(Array.from(held.keys())).toEqual([]);
  });
});

describe("recordMonitoringSwitch: turning monitoring back on", () => {
  test("starts a status event with the status the monitor holds, marking it monitored again, and closes the one that marked it off", async () => {
    useTables({ rows: history(true), isMonitoringOff: false });

    await MonitorStatusTimelineService.recordMonitoringSwitch({
      monitorId: MONITOR_ID,
      isMonitoringOff: false,
      switchedByUserId: USER_ID,
    });

    const row: StoredRow = inserted();
    expect(String(row["monitorStatusId"])).toBe(OFFLINE_STATUS_ID.toString());
    expect(row["isMonitoringOff"]).toBe(false);
    expect(row["isOwnerNotified"]).toBe(true);
    expect(row["rootCause"]).toBe(
      "[Ada Lovelace](mailto:ada@example.com) turned monitoring back on. Uptime, status pages and SLOs count the monitor's time again from here.",
    );
    expect((timelines.get(OFFLINE_ROW_ID)!["endsAt"] as Date).getTime()).toBe(
      (row["startsAt"] as Date).getTime(),
    );
    expect(feedItems).not.toHaveBeenCalled();
    expect(onCreateWorkflowIds()).toEqual([]);
  });

  test("writes nothing when the latest status event already marks it monitored", async () => {
    useTables({ rows: history(), isMonitoringOff: false });

    expect(
      await MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: false,
      }),
    ).toBeNull();
    expect(timelines.inserts).toEqual([]);
  });
});

describe("every status event takes the switch it falls under", () => {
  test("appended now: the monitor's switch as it is - a status set by hand while monitoring is off is not checked either", async () => {
    useTables({ rows: history(true), isMonitoringOff: true });

    // An incident resolved by hand, say: Operational, but still unchecked.
    await changeStatus({ statusId: OPERATIONAL_STATUS_ID });

    const row: StoredRow = inserted();
    expect(row["isMonitoringOff"]).toBe(true);

    // A status change all the same: its feed item, its workflow.
    expect(feedItems).toHaveBeenCalledTimes(1);
    expect(onCreateWorkflowIds()).toEqual([String(row["_id"])]);
  });

  test("appended now with monitoring on: monitored, a status change like any other", async () => {
    useTables({ rows: history(), isMonitoringOff: false });

    await changeStatus({ statusId: OPERATIONAL_STATUS_ID });

    const row: StoredRow = inserted();
    expect(row["isMonitoringOff"]).toBe(false);
    expect(feedItems).toHaveBeenCalledTimes(1);
    expect(networkBridge).toHaveBeenCalledTimes(1);
    expect(onCreateWorkflowIds()).toEqual([String(row["_id"])]);
  });

  test("the switch is OneUptime's to decide: one a write sends is replaced", async () => {
    useTables({ rows: history(), isMonitoringOff: false });

    await changeStatus({
      statusId: OPERATIONAL_STATUS_ID,
      isMonitoringOff: true,
    });

    expect(inserted()["isMonitoringOff"]).toBe(false);
  });

  test("the same status under another switch, written by any other path, marks only the switch: nobody is told, as no status changed", async () => {
    /*
     * Monitoring turned off before the switch was marked (an upgrade the
     * data migration has not reached yet): the latest status event is
     * monitored, the monitor reads off. A status change of the same status
     * - a manual monitor set to what it is, say - lands as the mark.
     */
    useTables({ rows: history(), isMonitoringOff: true });

    await changeStatus({ statusId: OFFLINE_STATUS_ID });

    const row: StoredRow = inserted();
    expect(row["isMonitoringOff"]).toBe(true);
    expect(row["isOwnerNotified"]).toBe(true);
    expect(feedItems).not.toHaveBeenCalled();
    expect(networkBridge).not.toHaveBeenCalled();
    expect(onCreateWorkflowIds()).toEqual([]);
  });

  test("the same status and the same switch as the event before it is refused, as before", async () => {
    useTables({ rows: history(), isMonitoringOff: false });

    const error: unknown = await rejectionOf(
      changeStatus({ statusId: OFFLINE_STATUS_ID }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE,
    );
    expect(timelines.inserts).toEqual([]);
    expect(Array.from(held.keys())).toEqual([]);
  });

  test("written into the past: the switch of the event before it, not the monitor's now", async () => {
    // Off from day 10 to day 20 of January, back on since; the monitor reads on.
    useTables({
      rows: [
        timelineRow({
          id: OPERATIONAL_ROW_ID,
          statusId: OPERATIONAL_STATUS_ID,
          startsAt: FIRST_STATUS_AT,
          endsAt: OFFLINE_AT,
          isMonitoringOff: false,
        }),
        timelineRow({
          id: OFFLINE_ROW_ID,
          statusId: OPERATIONAL_STATUS_ID,
          startsAt: OFFLINE_AT,
          endsAt: new Date(OFFLINE_AT.getTime() + 10 * DAY_MS),
          isMonitoringOff: true,
        }),
        timelineRow({
          id: "6480e000-0000-4000-8000-0000000000b3",
          statusId: OPERATIONAL_STATUS_ID,
          startsAt: new Date(OFFLINE_AT.getTime() + 10 * DAY_MS),
          isMonitoringOff: false,
        }),
      ],
      isMonitoringOff: false,
    });

    await changeStatus({
      statusId: OFFLINE_STATUS_ID,
      startsAt: new Date(OFFLINE_AT.getTime() + 5 * DAY_MS),
    });

    const row: StoredRow = inserted();
    expect(row["isMonitoringOff"]).toBe(true);
    // It ends where the next status event starts.
    expect((row["endsAt"] as Date).getTime()).toBe(
      OFFLINE_AT.getTime() + 10 * DAY_MS,
    );
  });

  test("written before the first status event: the first one's switch", async () => {
    useTables({
      rows: [
        timelineRow({
          id: OFFLINE_ROW_ID,
          statusId: OFFLINE_STATUS_ID,
          startsAt: OFFLINE_AT,
          isMonitoringOff: true,
        }),
      ],
      isMonitoringOff: false,
    });

    await changeStatus({
      statusId: OPERATIONAL_STATUS_ID,
      startsAt: FIRST_STATUS_AT,
    });

    expect(inserted()["isMonitoringOff"]).toBe(true);
  });

  test("the same status as the next event is refused only when the switch is the same too", async () => {
    // Off since day 20; a backfill of the same Offline, monitored, before it.
    useTables({
      rows: [
        timelineRow({
          id: OPERATIONAL_ROW_ID,
          statusId: OPERATIONAL_STATUS_ID,
          startsAt: FIRST_STATUS_AT,
          endsAt: new Date(OFFLINE_AT.getTime() + 10 * DAY_MS),
          isMonitoringOff: false,
        }),
        timelineRow({
          id: OFFLINE_ROW_ID,
          statusId: OFFLINE_STATUS_ID,
          startsAt: new Date(OFFLINE_AT.getTime() + 10 * DAY_MS),
          isMonitoringOff: true,
        }),
      ],
      isMonitoringOff: true,
    });

    await changeStatus({ statusId: OFFLINE_STATUS_ID, startsAt: OFFLINE_AT });

    const row: StoredRow = inserted();
    expect(row["isMonitoringOff"]).toBe(false);
    expect(String(row["monitorStatusId"])).toBe(OFFLINE_STATUS_ID.toString());
  });
});

describe("getMonitoringSwitchRootCause", () => {
  test.each([
    [
      true,
      "",
      "Monitoring is off. Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.",
    ],
    [
      true,
      "**Ada**",
      "**Ada** turned off monitoring. Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.",
    ],
    [
      false,
      "",
      "Monitoring was turned back on. Uptime, status pages and SLOs count the monitor's time again from here.",
    ],
    [
      false,
      "**Ada**",
      "**Ada** turned monitoring back on. Uptime, status pages and SLOs count the monitor's time again from here.",
    ],
  ])(
    "monitoring off: %s, switched by %j",
    (isMonitoringOff: boolean, switchedBy: string, expected: string) => {
      expect(
        MonitorStatusTimelineServiceClass.getMonitoringSwitchRootCause({
          isMonitoringOff: isMonitoringOff,
          switchedBy: switchedBy
            ? FeedMarkdown.asMarkdown(switchedBy)
            : FeedMarkdown.empty(),
        }),
      ).toBe(expected);
    },
  );
});
