import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import MonitorIncidentPause from "../../../Server/Utils/Monitor/MonitorIncidentPause";
import MonitorTurnedOff from "../../../Server/Utils/Monitor/MonitorTurnedOff";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  RowsCallerMayWriteRead,
  stubRowsCallerMayWrite,
} from "../TestingUtils/RowsCallerMayWrite";
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
 * SWITCHING KEEP MONITORING DURING INCIDENTS APPLIES AT ONCE (issue #11141).
 *
 * The setting decides whether an incident declared by hand pauses the
 * monitor, and it applies to incidents already open too: switched on while
 * one pauses the monitor, its checks resume now - not once that incident is
 * resolved - and switched off while one is open, they pause now. So an
 * update that writes it works the monitor out again from its incidents
 * (MonitorIncidentPause.syncMonitors). So does turning monitoring back on:
 * while an incident pauses the monitor with no status of its own, its time
 * stays left out of uptime from there.
 *
 * The real onBeforeUpdate and onUpdateSuccess run; the database is stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11141a00-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("11141a00-0000-4000-8000-000000000002");
const WEBHOOKS: string = "11141a00-0000-4000-8000-0000000000a1";
const CHECKOUT: string = "11141a00-0000-4000-8000-0000000000a2";

interface StoredMonitor {
  id: string;
  disableActiveMonitoring: boolean;
  keepMonitoringDuringIncidents: boolean;
}

let storedMonitors: Array<StoredMonitor>;
let synced: ReturnType<typeof getJestSpyOn>;
let switches: ReturnType<typeof getJestSpyOn>;
let order: Array<string>;

type OnBeforeUpdate = (
  updateBy: UpdateBy<Monitor>,
) => Promise<OnUpdate<Monitor>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<Monitor>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<Monitor>>;

const hooks: {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
} = MonitorService as unknown as {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
};

function matching(query: Dictionary<unknown>): Array<StoredMonitor> {
  const id: unknown = query["_id"];

  if (typeof id === "string" || id instanceof ObjectID) {
    return storedMonitors.filter((monitor: StoredMonitor): boolean => {
      return monitor.id === id.toString().toLowerCase();
    });
  }

  return storedMonitors;
}

function rowOf(record: StoredMonitor): Monitor {
  const row: Monitor = new Monitor();
  row._id = record.id;
  row.projectId = PROJECT_ID;
  row.name = record.id === WEBHOOKS ? "Webhooks" : "Checkout";
  row.monitorType = MonitorType.IncomingRequest;
  row.disableActiveMonitoring = record.disableActiveMonitoring;
  row.keepMonitoringDuringIncidents = record.keepMonitoringDuringIncidents;
  return row;
}

beforeEach(() => {
  storedMonitors = [
    {
      id: WEBHOOKS,
      disableActiveMonitoring: false,
      keepMonitoringDuringIncidents: false,
    },
    {
      id: CHECKOUT,
      disableActiveMonitoring: true,
      keepMonitoringDuringIncidents: false,
    },
  ];
  order = [];

  stubProjectDirectory({});

  jest.spyOn(MonitorService, "findBy").mockImplementation((async (findBy: {
    query: Dictionary<unknown>;
  }): Promise<Array<Monitor>> => {
    return matching(findBy.query).map(rowOf);
  }) as never);

  stubRowsCallerMayWrite(MonitorService, (read: RowsCallerMayWriteRead) => {
    return matching(read.query as Dictionary<unknown>).map(
      (record: StoredMonitor) => {
        return {
          _id: record.id,
          disableActiveMonitoring: record.disableActiveMonitoring,
        };
      },
    );
  });

  jest.spyOn(MonitorService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Monitor | null> => {
    const record: StoredMonitor | undefined = storedMonitors.find(
      (monitor: StoredMonitor): boolean => {
        return monitor.id === data.id.toString();
      },
    );
    return record ? rowOf(record) : null;
  }) as never);

  jest
    .spyOn(MonitorService, "getMonitorLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/monitor") as never,
    );
  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(PayAsYouGoBillingService, "requirePayAsYouGo")
    .mockResolvedValue(undefined as never);

  switches = getJestSpyOn(
    MonitorStatusTimelineService,
    "recordMonitoringSwitch",
  ).mockImplementation((async (): Promise<null> => {
    order.push("switch");
    return null;
  }) as never);
  jest
    .spyOn(MonitorTurnedOff, "resolveWhatItWouldHaveResolved")
    .mockResolvedValue({
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
    } as never);
  jest
    .spyOn(NetworkDeviceService, "refreshStampsOfDevicesBoundToMonitors")
    .mockResolvedValue(undefined as never);

  synced = getJestSpyOn(
    MonitorIncidentPause,
    "syncMonitors",
  ).mockImplementation((async (): Promise<void> => {
    order.push("sync");
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function editor(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };
}

async function runUpdate(
  data: Dictionary<unknown>,
  ids: Array<string> = [WEBHOOKS],
  props: DatabaseCommonInteractionProps = editor(),
): Promise<void> {
  const onUpdate: OnUpdate<Monitor> = await hooks.onBeforeUpdate({
    query: (ids.length === 1
      ? { _id: ids[0] }
      : {}) as UpdateBy<Monitor>["query"],
    data: data as UpdateBy<Monitor>["data"],
    props: props,
    limit: ids.length === 1 ? 1 : 100,
    skip: 0,
  });

  // The write itself.
  for (const id of ids) {
    const record: StoredMonitor = storedMonitors.find(
      (monitor: StoredMonitor): boolean => {
        return monitor.id === id;
      },
    )!;

    if (typeof data["keepMonitoringDuringIncidents"] === "boolean") {
      record.keepMonitoringDuringIncidents = data[
        "keepMonitoringDuringIncidents"
      ] as boolean;
    }

    if (typeof data["disableActiveMonitoring"] === "boolean") {
      record.disableActiveMonitoring = data[
        "disableActiveMonitoring"
      ] as boolean;
    }
  }

  await hooks.onUpdateSuccess(
    onUpdate,
    ids.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

// The monitors each syncMonitors call worked out, and the project it named.
function syncedCalls(): Array<{
  projectId: string;
  monitorIds: Array<string>;
}> {
  return synced.mock.calls.map((call: Array<unknown>) => {
    const data: { projectId: ObjectID; monitorIds: Array<ObjectID> } =
      call[0] as never;
    return {
      projectId: data.projectId.toString(),
      monitorIds: data.monitorIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    };
  });
}

describe("Keep monitoring during incidents, written", () => {
  test("switched on: the monitor is worked out again at once, so an incident pausing it lets go now", async () => {
    await runUpdate({ keepMonitoringDuringIncidents: true });

    expect(syncedCalls()).toEqual([
      { projectId: PROJECT_ID.toString(), monitorIds: [WEBHOOKS] },
    ]);
  });

  test("switched off: worked out again, so an open incident declared by hand pauses it now", async () => {
    storedMonitors[0]!.keepMonitoringDuringIncidents = true;

    await runUpdate({ keepMonitoringDuringIncidents: false });

    expect(syncedCalls()).toEqual([
      { projectId: PROJECT_ID.toString(), monitorIds: [WEBHOOKS] },
    ]);
  });

  test("every monitor a bulk update writes is worked out, each on its own", async () => {
    await runUpdate({ keepMonitoringDuringIncidents: true }, [
      WEBHOOKS,
      CHECKOUT,
    ]);

    expect(syncedCalls()).toEqual([
      { projectId: PROJECT_ID.toString(), monitorIds: [WEBHOOKS] },
      { projectId: PROJECT_ID.toString(), monitorIds: [CHECKOUT] },
    ]);
  });

  test("written as OneUptime, with no project in hand: the monitor's own project is read", async () => {
    await runUpdate({ keepMonitoringDuringIncidents: true }, [WEBHOOKS], {
      isRoot: true,
    });

    expect(syncedCalls()).toEqual([
      { projectId: PROJECT_ID.toString(), monitorIds: [WEBHOOKS] },
    ]);
  });

  test("a failure working it out never fails the save", async () => {
    synced.mockRejectedValue(new Error("Redis is down") as never);

    await expect(
      runUpdate({ keepMonitoringDuringIncidents: true }),
    ).resolves.toBeUndefined();
  });
});

describe("monitoring turned back on", () => {
  test("works the monitor out again after its switch is marked, so a pause with no status keeps its time left out", async () => {
    await runUpdate({ disableActiveMonitoring: false }, [CHECKOUT]);

    expect(switches).toHaveBeenCalledTimes(1);
    expect(syncedCalls()).toEqual([
      { projectId: PROJECT_ID.toString(), monitorIds: [CHECKOUT] },
    ]);
    expect(order).toEqual(["switch", "sync"]);
  });

  test("turning it off asks nothing of the incidents: nothing checks the monitor either way", async () => {
    await runUpdate({ disableActiveMonitoring: true }, [WEBHOOKS]);

    expect(synced).not.toHaveBeenCalled();
  });

  test("writing the switch back as it is turns nothing, and works nothing out", async () => {
    await runUpdate({ disableActiveMonitoring: false }, [WEBHOOKS]);

    expect(synced).not.toHaveBeenCalled();
  });
});

describe("any other update", () => {
  test("leaves the monitor's pause alone", async () => {
    await runUpdate({
      description: "Receives the payment provider's webhooks",
    });

    expect(synced).not.toHaveBeenCalled();
  });
});
