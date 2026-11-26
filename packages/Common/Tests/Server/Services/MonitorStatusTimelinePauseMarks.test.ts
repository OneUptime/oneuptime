import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import UserService from "../../../Server/Services/UserService";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
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

jest.mock("../../../Server/Utils/Logger");

/*
 * PAUSED TIME THAT IS LEFT OUT, ON THE STATUS TIMELINE (issue #11141).
 *
 * A status event's isMonitoringOff is OneUptime's to decide, from the
 * monitor's own switch (Monitor.disableActiveMonitoring), whoever writes
 * the event (#6480). A monitor paused by incidents declared by hand that
 * put it in no status has its switch on - nobody turned it off - but its
 * time is left out all the same: its status is only what its last check
 * saw (MonitorIncidentPause). So the status event that marks it says so
 * itself, and is marked as it says (recordMonitoringSwitch's rootCause),
 * the switch staying as it is; and every status event written after it
 * takes the monitor's switch again, as before, so a status set since - the
 * resolve's operational status, another incident's, a person's - counts.
 *
 * The real create pipeline runs over in-memory tables, as in
 * MonitorStatusTimelineMonitoringSwitch.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11141e00-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11141e00-0000-4000-8000-000000000003",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "11141e00-0000-4000-8000-0000000000a1",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "11141e00-0000-4000-8000-0000000000a2",
);

const OFFLINE_ROW_ID: string = "11141e00-0000-4000-8000-0000000000b2";
const OFFLINE_AT: Date = new Date("2026-01-10T00:00:00.000Z");

const PAUSED_ROOT_CAUSE: string =
  "Monitoring is paused by [INC-12](https://oneuptime.example/incidents/1), declared by hand without a status for this monitor. Nothing checks the monitor until the incident is resolved, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.";
const RESUMED_ROOT_CAUSE: string =
  "Monitoring resumed. Uptime, status pages and SLOs count the monitor's time again from here.";

let held: Set<string>;
let timelines: InMemoryTable;
let workflows: ReturnType<typeof getJestSpyOn>;

function useTables(data: {
  isOfflineRowMonitoringOff: boolean;
  isMonitoringTurnedOff: boolean;
}): void {
  timelines = useInMemoryTable(MonitorStatusTimelineService, [
    {
      _id: OFFLINE_ROW_ID,
      projectId: PROJECT_ID.toString(),
      monitorId: MONITOR_ID.toString(),
      monitorStatusId: OFFLINE_STATUS_ID.toString(),
      startsAt: OFFLINE_AT,
      endsAt: null,
      isMonitoringOff: data.isOfflineRowMonitoringOff,
    },
  ]);

  (
    MonitorStatusTimelineService.onTriggerWorkflow as unknown as {
      mockRestore: () => void;
    }
  ).mockRestore();

  useInMemoryTable(MonitorService, [
    {
      _id: MONITOR_ID.toString(),
      projectId: PROJECT_ID.toString(),
      name: "Webhooks",
      currentMonitorStatusId: OFFLINE_STATUS_ID.toString(),
      disableActiveMonitoring: data.isMonitoringTurnedOff,
      disableActiveMonitoringBecauseOfManualIncident: true,
    },
  ]);
}

function newest(): StoredRow {
  expect(timelines.inserts.length).toBeGreaterThan(0);
  return timelines.get(
    String(timelines.inserts[timelines.inserts.length - 1]!["_id"]),
  )!;
}

async function changeStatus(statusId: ObjectID): Promise<MonitorStatusTimeline> {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.projectId = PROJECT_ID;
  timeline.monitorId = MONITOR_ID;
  timeline.monitorStatusId = statusId;

  return await MonitorStatusTimelineService.create({
    data: timeline,
    props: { isRoot: true },
  });
}

beforeEach(() => {
  held = new Set<string>();

  getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
    namespace: string;
  }): Promise<{ name: string }> => {
    const name: string = `${data.namespace}-${data.key}`;

    if (held.has(name)) {
      throw new SemaphoreLockTimeoutError(`Acquire mutex ${name} timeout`);
    }

    held.add(name);
    return { name: name };
  }) as never);

  getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
    name: string;
  }): Promise<void> => {
    held.delete(mutex.name);
  }) as never);

  stubProjectDirectory({});
  stubReadableParents();

  getJestSpyOn(UserService, "getUserMarkdownString").mockResolvedValue(
    FeedMarkdown.asMarkdown("[Ada Lovelace](mailto:ada@example.com)"),
  );

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

  getJestSpyOn(
    MonitorStatusTimelineService as never,
    "bridgeCurrentStatusToNetworkSites",
  ).mockResolvedValue(undefined as never);
  getJestSpyOn(
    MonitorStatusTimelineService as never,
    "createStatusChangeFeedItem",
  ).mockResolvedValue(undefined as never);

  workflows = getJestSpyOn(
    DatabaseService.prototype,
    "onTriggerWorkflow",
  ).mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an incident's mark of paused time left out", () => {
  test("is marked left out though the monitor's switch is on, with the incident's words", async () => {
    useTables({ isOfflineRowMonitoringOff: false, isMonitoringTurnedOff: false });

    const written: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: true,
        rootCause: PAUSED_ROOT_CAUSE,
      });

    expect(written).not.toBeNull();

    const row: StoredRow = newest();
    expect(String(row["monitorStatusId"])).toBe(OFFLINE_STATUS_ID.toString());
    expect(row["isMonitoringOff"]).toBe(true);
    expect(row["rootCause"]).toBe(PAUSED_ROOT_CAUSE);
    // No status changed: nobody is told it did, and nobody turned a switch.
    expect(row["isOwnerNotified"]).toBe(true);
    expect(row["createdByUserId"] || null).toBeNull();

    // It ends the row before it, as every status event does.
    expect((timelines.get(OFFLINE_ROW_ID)!["endsAt"] as Date).getTime()).toBe(
      (row["startsAt"] as Date).getTime(),
    );
  });

  test("starts no On Create workflow: no status changed", async () => {
    useTables({ isOfflineRowMonitoringOff: false, isMonitoringTurnedOff: false });

    const written: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: true,
        rootCause: PAUSED_ROOT_CAUSE,
      });

    const onCreateIds: Array<string> = workflows.mock.calls
      .filter((call: Array<unknown>): boolean => {
        return call[2] === "on-create";
      })
      .map((call: Array<unknown>): string => {
        return (call[0] as ObjectID).toString();
      });

    expect(onCreateIds).not.toContain(written!.id!.toString());
  });

  test("its end is marked counted again, with its own words", async () => {
    useTables({ isOfflineRowMonitoringOff: true, isMonitoringTurnedOff: false });

    await MonitorStatusTimelineService.recordMonitoringSwitch({
      monitorId: MONITOR_ID,
      isMonitoringOff: false,
      rootCause: RESUMED_ROOT_CAUSE,
    });

    const row: StoredRow = newest();
    expect(row["isMonitoringOff"]).toBe(false);
    expect(row["rootCause"]).toBe(RESUMED_ROOT_CAUSE);
  });

  test("nothing is written when the newest status event already says so", async () => {
    useTables({ isOfflineRowMonitoringOff: true, isMonitoringTurnedOff: false });

    expect(
      await MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: true,
        rootCause: PAUSED_ROOT_CAUSE,
      }),
    ).toBeNull();
    expect(timelines.inserts).toHaveLength(0);
  });

  test("a status set after it takes the monitor's switch again, so it counts", async () => {
    useTables({ isOfflineRowMonitoringOff: false, isMonitoringTurnedOff: false });

    await MonitorStatusTimelineService.recordMonitoringSwitch({
      monitorId: MONITOR_ID,
      isMonitoringOff: true,
      rootCause: PAUSED_ROOT_CAUSE,
    });

    // The resolve's operational status, another incident's, a person's.
    await changeStatus(OPERATIONAL_STATUS_ID);

    const row: StoredRow = newest();
    expect(String(row["monitorStatusId"])).toBe(
      OPERATIONAL_STATUS_ID.toString(),
    );
    expect(row["isMonitoringOff"]).toBe(false);
  });

  test("a mark without the incident's words follows the monitor's switch, as before (#6480): with it on, there is nothing to mark", async () => {
    useTables({ isOfflineRowMonitoringOff: false, isMonitoringTurnedOff: false });

    /*
     * Asked to mark it off with no reason of its own, while the switch is
     * on: the row would repeat the one before it, and is refused as that.
     */
    expect(
      await MonitorStatusTimelineService.recordMonitoringSwitch({
        monitorId: MONITOR_ID,
        isMonitoringOff: true,
      }),
    ).toBeNull();
    expect(timelines.inserts).toHaveLength(0);
  });

  test("with monitoring turned off, the switch's own mark is written as before", async () => {
    useTables({ isOfflineRowMonitoringOff: false, isMonitoringTurnedOff: true });

    await MonitorStatusTimelineService.recordMonitoringSwitch({
      monitorId: MONITOR_ID,
      isMonitoringOff: true,
    });

    const row: StoredRow = newest();
    expect(row["isMonitoringOff"]).toBe(true);
    expect(String(row["rootCause"])).toContain("Monitoring is off.");
  });
});
