import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteService, {
  getNothingReportsRootCause,
} from "../../../Server/Services/NetworkSiteService";
import NetworkSiteStatusTimelineService from "../../../Server/Services/NetworkSiteStatusTimelineService";
import logger from "../../../Server/Utils/Logger";
import NetworkSiteMaintenanceSuppression from "../../../Server/Utils/NetworkSite/NetworkSiteMaintenanceSuppression";
import { DeviceHealthGroup } from "../../../Server/Utils/NetworkDevice/DeviceHealthAggregation";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSiteStatusTimeline from "../../../Models/DatabaseModels/NetworkSiteStatusTimeline";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A NETWORK DEVICE BACKED BY A MONITOR WHOSE MONITORING IS TURNED OFF
 * (issue #6965).
 *
 * A monitor-backed device - a phone, a camera, an access point - takes its
 * status from the monitor bound to it, a Ping monitor say. When someone
 * turns that monitor's monitoring off, the monitor keeps the status its
 * last check saw - "Offline" - and nothing checks it any more. The device
 * used to keep that status too, so its site still rolled up Offline, the
 * Network Map still drew it red, and the site's alert stayed open, about a
 * device nothing was watching.
 *
 * Now a monitor that is not checked - monitoring off, or archived - gives
 * the device no verdict at all: no status, isReachable NULL, Pending, as if
 * nothing were bound. What is pinned here, against an in-memory project
 * that the real services read and write through their data-layer seams:
 *
 *   - the stamp (refreshStampedMonitorStatus), the re-stamp of every device
 *     a monitor backs (refreshStampsOfDevicesBoundToMonitors, what turning
 *     a monitor off, on, archiving or unarchiving it runs) and the monitor
 *     status bridge (onMonitorStatusChanged) all give such a device the
 *     empty stamp, and follow the monitor again once it is checked;
 *   - the site's roll-up stops counting the device: a site other devices
 *     report on recovers through its usual path, and a site nothing else
 *     reports on goes back to no status, its timeline row closed;
 *   - the site's alert is resolved either way, with the reason, and no
 *     alert opens while the monitor is off - not when it changes status by
 *     hand, not on the five-minute sweep; turning monitoring back on with
 *     the problem still there opens a new one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6965aaaa-0000-4000-8000-000000000001",
);
const SITE_ID: string = "6965aaaa-0000-4000-8000-0000000000b1";
const OTHER_SITE_ID: string = "6965aaaa-0000-4000-8000-0000000000b2";
const DEVICE_ID: string = "6965aaaa-0000-4000-8000-0000000000c1";
const SECOND_DEVICE_ID: string = "6965aaaa-0000-4000-8000-0000000000c2";
const THIRD_DEVICE_ID: string = "6965aaaa-0000-4000-8000-0000000000c3";
const MONITOR_ID: string = "6965aaaa-0000-4000-8000-0000000000d1";
const SECOND_MONITOR_ID: string = "6965aaaa-0000-4000-8000-0000000000d2";
const NETWORK_DEVICE_MONITOR_ID: string =
  "6965aaaa-0000-4000-8000-0000000000d3";
const OPERATIONAL_STATUS_ID: string = "6965aaaa-0000-4000-8000-0000000000e1";
const DEGRADED_STATUS_ID: string = "6965aaaa-0000-4000-8000-0000000000e2";
const OFFLINE_STATUS_ID: string = "6965aaaa-0000-4000-8000-0000000000e3";
const SEVERITY_ID: string = "6965aaaa-0000-4000-8000-0000000000f1";
const RESOLVED_STATE_ID: string = "6965aaaa-0000-4000-8000-0000000000f2";
const OPEN_STATE_ID: string = "6965aaaa-0000-4000-8000-0000000000f3";

interface WorldMonitor {
  id: string;
  monitorType: MonitorType;
  disableActiveMonitoring: boolean;
  isArchived: boolean;
  currentMonitorStatusId: string | null;
  // The devices a Network Device monitor's steps name.
  watchedDeviceIds?: Array<string> | undefined;
}

interface WorldDevice {
  id: string;
  siteId: string | null;
  monitoringMethod: string;
  monitorId: string | null;
  currentMonitorStatusId: string | null;
  isReachable: boolean | null;
}

interface WorldSite {
  id: string;
  name: string;
  currentMonitorStatusId: string | null;
  currentActiveAlertId: string | null;
  shouldAlertWhenUnhealthy: boolean;
}

interface WorldAlert {
  id: string;
  siteId: string;
  title: string;
  currentAlertStateId: string;
  resolvedWith: string | null;
}

interface WorldTimelineRow {
  siteId: string;
  monitorStatusId: string;
  endsAt: Date | null;
}

interface World {
  monitors: Array<WorldMonitor>;
  devices: Array<WorldDevice>;
  sites: Array<WorldSite>;
  alerts: Array<WorldAlert>;
  timeline: Array<WorldTimelineRow>;
}

const STATUSES: Array<{
  id: string;
  name: string;
  priority: number;
  isOperationalState: boolean;
  isOfflineState: boolean;
}> = [
  {
    id: OPERATIONAL_STATUS_ID,
    name: "Operational",
    priority: 1,
    isOperationalState: true,
    isOfflineState: false,
  },
  {
    id: DEGRADED_STATUS_ID,
    name: "Degraded",
    priority: 2,
    isOperationalState: false,
    isOfflineState: false,
  },
  {
    id: OFFLINE_STATUS_ID,
    name: "Offline",
    priority: 3,
    isOperationalState: false,
    isOfflineState: true,
  },
];

let world: World;
let alertCounter: number = 0;

// The ids a query names: one id, or the list inside QueryHelper.any().
function idsIn(value: unknown): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  if (typeof value === "string" || value instanceof ObjectID) {
    return [value.toString()];
  }

  const parameters: Dictionary<unknown> | undefined = (
    value as { objectLiteralParameters?: Dictionary<unknown> }
  ).objectLiteralParameters;

  if (!parameters) {
    throw new Error("A query this world does not know how to read.");
  }

  return (Object.values(parameters) as Array<Array<unknown>>)
    .flat()
    .map((id: unknown): string => {
      return String(id).toLowerCase();
    });
}

function objectIdOrUndefined(id: string | null): ObjectID | undefined {
  return id ? new ObjectID(id) : undefined;
}

function idOrNull(value: unknown): string | null {
  return value ? (value as ObjectID).toString() : null;
}

function findMonitor(id: string): WorldMonitor {
  const monitor: WorldMonitor | undefined = world.monitors.find(
    (candidate: WorldMonitor): boolean => {
      return candidate.id === id;
    },
  );

  if (!monitor) {
    throw new Error(`No monitor ${id} in this world.`);
  }

  return monitor;
}

function findDevice(id: string): WorldDevice {
  const device: WorldDevice | undefined = world.devices.find(
    (candidate: WorldDevice): boolean => {
      return candidate.id === id;
    },
  );

  if (!device) {
    throw new Error(`No device ${id} in this world.`);
  }

  return device;
}

function findSite(id: string): WorldSite {
  const site: WorldSite | undefined = world.sites.find(
    (candidate: WorldSite): boolean => {
      return candidate.id === id;
    },
  );

  if (!site) {
    throw new Error(`No site ${id} in this world.`);
  }

  return site;
}

// A device row as the model reads it back: a NULL column is undefined.
function deviceRow(device: WorldDevice): NetworkDevice {
  return {
    id: new ObjectID(device.id),
    _id: device.id,
    projectId: PROJECT_ID,
    siteId: objectIdOrUndefined(device.siteId),
    monitoringMethod: device.monitoringMethod,
    monitorId: objectIdOrUndefined(device.monitorId),
    currentMonitorStatusId: objectIdOrUndefined(device.currentMonitorStatusId),
    isReachable: device.isReachable === null ? undefined : device.isReachable,
  } as unknown as NetworkDevice;
}

/*
 * A monitor row with only what the read selected: a read that forgets the
 * two switches gets a monitor with neither, which is how a mutation that
 * drops them from a select shows up here.
 */
function monitorRow(
  monitor: WorldMonitor,
  select: Dictionary<unknown>,
): Monitor {
  const row: Dictionary<unknown> = {
    id: new ObjectID(monitor.id),
    _id: monitor.id,
    projectId: PROJECT_ID,
    monitorType: monitor.monitorType,
    currentMonitorStatusId: objectIdOrUndefined(monitor.currentMonitorStatusId),
  };

  if (select["currentMonitorStatus"] && monitor.currentMonitorStatusId) {
    row["currentMonitorStatus"] = {
      isOfflineState: STATUSES.find(
        (status: { id: string; isOfflineState: boolean }): boolean => {
          return status.id === monitor.currentMonitorStatusId;
        },
      )?.isOfflineState,
    };
  }

  if (select["disableActiveMonitoring"]) {
    row["disableActiveMonitoring"] = monitor.disableActiveMonitoring;
  }

  if (select["isArchived"]) {
    row["isArchived"] = monitor.isArchived;
  }

  if (select["monitorSteps"]) {
    row["monitorSteps"] = {
      data: {
        monitorStepsInstanceArray: (monitor.watchedDeviceIds || []).map(
          (deviceId: string): Dictionary<unknown> => {
            return {
              data: { networkDeviceMonitor: { networkDeviceId: deviceId } },
            };
          },
        ),
      },
    };
  }

  return row as unknown as Monitor;
}

function siteRow(site: WorldSite): NetworkSite {
  return {
    id: new ObjectID(site.id),
    _id: site.id,
    projectId: PROJECT_ID,
    name: site.name,
    currentMonitorStatusId: objectIdOrUndefined(site.currentMonitorStatusId),
    currentActiveAlertId: objectIdOrUndefined(site.currentActiveAlertId),
    shouldAlertWhenUnhealthy: site.shouldAlertWhenUnhealthy,
    alertSeverityId: new ObjectID(SEVERITY_ID),
  } as unknown as NetworkSite;
}

// One health bucket per device, as the grouped aggregate hands them back.
function healthGroupOf(device: WorldDevice): DeviceHealthGroup {
  return {
    siteId: device.siteId,
    monitorStatusId: device.currentMonitorStatusId,
    monitoringMethod: device.monitoringMethod,
    isReachable: device.isReachable,
    hasBeenPolled: false,
    hasBeenSeen: false,
    isStale: false,
    hasDownInterfaces: false,
    deviceCount: 1,
    interfacesDownTotal: 0,
  };
}

interface Spies {
  deviceWrites: SpyInstance<
    typeof NetworkDeviceService.updateColumnsByIdWithoutHooks
  >;
  monitorRead: SpyInstance<typeof MonitorService.findOneBy>;
  monitorsRead: SpyInstance<typeof MonitorService.findBy>;
  devicesRead: SpyInstance<typeof NetworkDeviceService.findBy>;
  statusRead: SpyInstance<typeof MonitorStatusService.findOneBy>;
  siteRollups: SpyInstance<
    typeof NetworkSiteService.recomputeRollupForSiteAndAncestors
  >;
  alertsCreated: SpyInstance<typeof AlertService.create>;
}

let spies: Spies;

function stubTheWorld(): Spies {
  jest
    .spyOn(NetworkDeviceService, "findOneById")
    .mockImplementation((async (data: {
      id: ObjectID;
    }): Promise<NetworkDevice | null> => {
      const device: WorldDevice | undefined = world.devices.find(
        (candidate: WorldDevice): boolean => {
          return candidate.id === data.id.toString();
        },
      );

      return device ? deviceRow(device) : null;
    }) as never);

  const devicesRead: SpyInstance<typeof NetworkDeviceService.findBy> = jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation((async (data: {
      query: Dictionary<unknown>;
      skip?: number;
      limit?: number;
    }): Promise<Array<NetworkDevice>> => {
      const byId: Array<string> = idsIn(data.query["_id"]);
      const byMonitor: Array<string> = idsIn(data.query["monitorId"]);

      const rows: Array<WorldDevice> = world.devices.filter(
        (device: WorldDevice): boolean => {
          if (data.query["_id"] !== undefined && !byId.includes(device.id)) {
            return false;
          }

          if (
            data.query["monitorId"] !== undefined &&
            (!device.monitorId || !byMonitor.includes(device.monitorId))
          ) {
            return false;
          }

          return true;
        },
      );

      const skip: number = data.skip || 0;

      return rows
        .slice(skip, skip + (data.limit || LIMIT_MAX))
        .map((device: WorldDevice): NetworkDevice => {
          return deviceRow(device);
        });
    }) as never);

  const deviceWrites: SpyInstance<
    typeof NetworkDeviceService.updateColumnsByIdWithoutHooks
  > = jest
    .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: Dictionary<unknown>;
    }): Promise<void> => {
      const device: WorldDevice = findDevice(data.id.toString());

      if ("currentMonitorStatusId" in data.data) {
        device.currentMonitorStatusId = idOrNull(
          data.data["currentMonitorStatusId"],
        );
      }

      if ("isReachable" in data.data) {
        const value: unknown = data.data["isReachable"];
        device.isReachable = typeof value === "boolean" ? value : null;
      }
    }) as never);

  const monitorRead: SpyInstance<typeof MonitorService.findOneBy> = jest
    .spyOn(MonitorService, "findOneBy")
    .mockImplementation((async (data: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
    }): Promise<Monitor | null> => {
      const id: string | undefined = idsIn(data.query["_id"])[0];
      const monitor: WorldMonitor | undefined = world.monitors.find(
        (candidate: WorldMonitor): boolean => {
          return candidate.id === id;
        },
      );

      return monitor ? monitorRow(monitor, data.select) : null;
    }) as never);

  const monitorsRead: SpyInstance<typeof MonitorService.findBy> = jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation((async (data: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
    }): Promise<Array<Monitor>> => {
      const ids: Array<string> = idsIn(data.query["_id"]);

      return world.monitors
        .filter((monitor: WorldMonitor): boolean => {
          return (
            ids.includes(monitor.id) &&
            (data.query["monitorType"] === undefined ||
              data.query["monitorType"] === monitor.monitorType)
          );
        })
        .map((monitor: WorldMonitor): Monitor => {
          return monitorRow(monitor, data.select);
        });
    }) as never);

  const statusRead: SpyInstance<typeof MonitorStatusService.findOneBy> = jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation((async (data: {
      query: Dictionary<unknown>;
    }): Promise<MonitorStatus | null> => {
      const id: string | undefined = idsIn(data.query["_id"])[0];
      const status: (typeof STATUSES)[number] | undefined = STATUSES.find(
        (candidate: (typeof STATUSES)[number]): boolean => {
          return candidate.id === id;
        },
      );

      return status
        ? ({
            id: new ObjectID(status.id),
            _id: status.id,
            isOfflineState: status.isOfflineState,
          } as unknown as MonitorStatus)
        : null;
    }) as never);

  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockImplementation((async (): Promise<Array<MonitorStatus>> => {
      return STATUSES.map(
        (status: (typeof STATUSES)[number]): MonitorStatus => {
          return {
            id: new ObjectID(status.id),
            _id: status.id,
            name: status.name,
            priority: status.priority,
            isOperationalState: status.isOperationalState,
            isOfflineState: status.isOfflineState,
          } as unknown as MonitorStatus;
        },
      );
    }) as never);

  jest
    .spyOn(NetworkSiteService, "findOneById")
    .mockImplementation((async (data: {
      id: ObjectID;
    }): Promise<NetworkSite | null> => {
      const site: WorldSite | undefined = world.sites.find(
        (candidate: WorldSite): boolean => {
          return candidate.id === data.id.toString();
        },
      );

      return site ? siteRow(site) : null;
    }) as never);

  jest.spyOn(NetworkSiteService, "getDescendantSiteIds").mockResolvedValue([]);
  jest.spyOn(NetworkSiteService, "getAncestorIds").mockResolvedValue([]);

  jest
    .spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: Dictionary<unknown>;
    }): Promise<void> => {
      const site: WorldSite = findSite(data.id.toString());

      if ("currentMonitorStatusId" in data.data) {
        site.currentMonitorStatusId = idOrNull(
          data.data["currentMonitorStatusId"],
        );
      }

      if ("currentActiveAlertId" in data.data) {
        site.currentActiveAlertId = idOrNull(data.data["currentActiveAlertId"]);
      }
    }) as never);

  const siteRollups: SpyInstance<
    typeof NetworkSiteService.recomputeRollupForSiteAndAncestors
  > = jest.spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors");

  jest
    .spyOn(
      NetworkSiteMaintenanceSuppression,
      "getSiteIdsUnderOngoingMaintenance",
    )
    .mockResolvedValue(new Set<string>());

  jest
    .spyOn(NetworkDeviceService, "getHealthGroupsForSites")
    .mockImplementation((async (data: {
      siteIds: Array<ObjectID>;
    }): Promise<Array<DeviceHealthGroup>> => {
      const siteIds: Array<string> = data.siteIds.map(
        (siteId: ObjectID): string => {
          return siteId.toString();
        },
      );

      return world.devices
        .filter((device: WorldDevice): boolean => {
          return Boolean(device.siteId) && siteIds.includes(device.siteId!);
        })
        .map((device: WorldDevice): DeviceHealthGroup => {
          return healthGroupOf(device);
        });
    }) as never);

  jest
    .spyOn(NetworkSiteStatusTimelineService, "updateBy")
    .mockImplementation((async (data: {
      query: Dictionary<unknown>;
      data: Dictionary<unknown>;
    }): Promise<number> => {
      const siteId: string = String(data.query["siteId"]);
      let closed: number = 0;

      for (const row of world.timeline) {
        if (row.siteId === siteId && row.endsAt === null) {
          row.endsAt = data.data["endsAt"] as Date;
          closed++;
        }
      }

      return closed;
    }) as never);

  jest
    .spyOn(NetworkSiteStatusTimelineService, "create")
    .mockImplementation((async (data: {
      data: NetworkSiteStatusTimeline;
    }): Promise<NetworkSiteStatusTimeline> => {
      world.timeline.push({
        siteId: data.data.siteId!.toString(),
        monitorStatusId: data.data.monitorStatusId!.toString(),
        endsAt: null,
      });

      return data.data;
    }) as never);

  jest.spyOn(AlertSeverityService, "findOneBy").mockResolvedValue({
    id: new ObjectID(SEVERITY_ID),
  } as never);

  const alertsCreated: SpyInstance<typeof AlertService.create> = jest
    .spyOn(AlertService, "create")
    .mockImplementation((async (data: { data: Alert }): Promise<Alert> => {
      alertCounter++;
      const id: string = `6965aaaa-0000-4000-8000-${String(
        alertCounter,
      ).padStart(12, "0")}`;
      const siteName: string = String(data.data.title).replace(
        /^Network site (.*) is .*$/,
        "$1",
      );
      const site: WorldSite | undefined = world.sites.find(
        (candidate: WorldSite): boolean => {
          return candidate.name === siteName;
        },
      );

      world.alerts.push({
        id: id,
        siteId: site ? site.id : "",
        title: String(data.data.title),
        currentAlertStateId: OPEN_STATE_ID,
        resolvedWith: null,
      });

      const created: Alert = new Alert(new ObjectID(id));
      created.title = String(data.data.title);
      return created;
    }) as never);

  jest.spyOn(AlertService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Alert | null> => {
    const alert: WorldAlert | undefined = world.alerts.find(
      (candidate: WorldAlert): boolean => {
        return candidate.id === data.id.toString();
      },
    );

    return alert
      ? ({
          id: new ObjectID(alert.id),
          _id: alert.id,
          currentAlertStateId: new ObjectID(alert.currentAlertStateId),
        } as unknown as Alert)
      : null;
  }) as never);

  jest
    .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(new ObjectID(RESOLVED_STATE_ID) as never);

  jest
    .spyOn(AlertStateTimelineService, "create")
    .mockImplementation((async (data: {
      data: AlertStateTimeline;
    }): Promise<AlertStateTimeline> => {
      const alert: WorldAlert | undefined = world.alerts.find(
        (candidate: WorldAlert): boolean => {
          return candidate.id === data.data.alertId!.toString();
        },
      );

      if (alert) {
        alert.currentAlertStateId = data.data.alertStateId!.toString();
        alert.resolvedWith = data.data.rootCause || "";
      }

      return data.data;
    }) as never);

  return {
    deviceWrites,
    monitorRead,
    monitorsRead,
    devicesRead,
    statusRead,
    siteRollups,
    alertsCreated,
  };
}

function pingMonitor(overrides: Partial<WorldMonitor> = {}): WorldMonitor {
  return {
    id: MONITOR_ID,
    monitorType: MonitorType.Ping,
    disableActiveMonitoring: false,
    isArchived: false,
    currentMonitorStatusId: OFFLINE_STATUS_ID,
    ...overrides,
  };
}

function monitorBackedDevice(
  overrides: Partial<WorldDevice> = {},
): WorldDevice {
  return {
    id: DEVICE_ID,
    siteId: SITE_ID,
    monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
    monitorId: MONITOR_ID,
    currentMonitorStatusId: null,
    isReachable: null,
    ...overrides,
  };
}

function storeSite(overrides: Partial<WorldSite> = {}): WorldSite {
  return {
    id: SITE_ID,
    name: "Store 12",
    currentMonitorStatusId: null,
    currentActiveAlertId: null,
    shouldAlertWhenUnhealthy: true,
    ...overrides,
  };
}

// What the operator does, through the real services.
async function bind(deviceId: string = DEVICE_ID): Promise<void> {
  await NetworkDeviceService.refreshStampedMonitorStatus({
    deviceId: new ObjectID(deviceId),
    clearWhenNotMonitorBacked: false,
  });
}

// What MonitorService.onUpdateSuccess runs once the switch is saved.
async function setMonitoring(
  monitorId: string,
  change: Partial<Pick<WorldMonitor, "disableActiveMonitoring" | "isArchived">>,
): Promise<void> {
  Object.assign(findMonitor(monitorId), change);

  await NetworkDeviceService.refreshStampsOfDevicesBoundToMonitors({
    monitorIds: [new ObjectID(monitorId)],
  });
}

// What MonitorStatusTimelineService runs once a monitor's status moves.
async function monitorStatusChanges(
  monitorId: string,
  statusId: string,
): Promise<void> {
  findMonitor(monitorId).currentMonitorStatusId = statusId;

  await NetworkSiteService.onMonitorStatusChanged({
    projectId: PROJECT_ID,
    monitorIds: [new ObjectID(monitorId)],
    monitorStatusId: new ObjectID(statusId),
  });
}

// The five-minute stale-rollup sweep, for one site.
async function sweep(siteId: string = SITE_ID): Promise<void> {
  await NetworkSiteService.recomputeRollupForSite(new ObjectID(siteId));
}

function openTimelineRows(siteId: string = SITE_ID): Array<WorldTimelineRow> {
  return world.timeline.filter((row: WorldTimelineRow): boolean => {
    return row.siteId === siteId && row.endsAt === null;
  });
}

function openAlerts(): Array<WorldAlert> {
  return world.alerts.filter((alert: WorldAlert): boolean => {
    return alert.currentAlertStateId !== RESOLVED_STATE_ID;
  });
}

beforeEach(() => {
  alertCounter = 0;
  world = {
    monitors: [pingMonitor()],
    devices: [monitorBackedDevice()],
    sites: [storeSite()],
    alerts: [],
    timeline: [],
  };
  spies = stubTheWorld();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the issue, end to end: a device bound to an Offline monitor whose monitoring is turned off", () => {
  it("stops saying Offline - device, site and alert - and follows the monitor again once it is back on", async () => {
    // Bound to a Ping monitor that is Offline: the device, then its site, read Offline.
    await bind();

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
      OFFLINE_STATUS_ID,
    );
    expect(findDevice(DEVICE_ID).isReachable).toBe(false);
    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(OFFLINE_STATUS_ID);
    expect(openAlerts()).toHaveLength(1);
    const firstAlert: WorldAlert = openAlerts()[0]!;
    expect(firstAlert.title).toBe("Network site Store 12 is Offline");
    expect(findSite(SITE_ID).currentActiveAlertId).toBe(firstAlert.id);

    // Monitoring off: nothing checks the device, so it has no status...
    await setMonitoring(MONITOR_ID, { disableActiveMonitoring: true });

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBeNull();
    expect(findDevice(DEVICE_ID).isReachable).toBeNull();

    // ...nor does the site it was the only reporter for...
    expect(findSite(SITE_ID).currentMonitorStatusId).toBeNull();
    expect(openTimelineRows()).toHaveLength(0);

    // ...and the site's alert is resolved, saying why.
    expect(openAlerts()).toHaveLength(0);
    expect(firstAlert.resolvedWith).toBe(
      getNothingReportsRootCause("Store 12"),
    );
    expect(findSite(SITE_ID).currentActiveAlertId).toBeNull();

    // Monitoring on again, the problem still there: it all follows the monitor again.
    await setMonitoring(MONITOR_ID, { disableActiveMonitoring: false });

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
      OFFLINE_STATUS_ID,
    );
    expect(findDevice(DEVICE_ID).isReachable).toBe(false);
    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(OFFLINE_STATUS_ID);
    expect(openTimelineRows()).toEqual([
      { siteId: SITE_ID, monitorStatusId: OFFLINE_STATUS_ID, endsAt: null },
    ]);
    expect(openAlerts()).toHaveLength(1);
    expect(openAlerts()[0]!.id).not.toBe(firstAlert.id);

    // And when the monitor recovers, so do the device and the site, and the new alert resolves.
    await monitorStatusChanges(MONITOR_ID, OPERATIONAL_STATUS_ID);

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
      OPERATIONAL_STATUS_ID,
    );
    expect(findDevice(DEVICE_ID).isReachable).toBe(true);
    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(
      OPERATIONAL_STATUS_ID,
    );
    expect(openAlerts()).toHaveLength(0);
  });

  it("archiving the monitor does the same, and unarchiving it brings the device back", async () => {
    await bind();
    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(OFFLINE_STATUS_ID);

    await setMonitoring(MONITOR_ID, { isArchived: true });

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBeNull();
    expect(findDevice(DEVICE_ID).isReachable).toBeNull();
    expect(findSite(SITE_ID).currentMonitorStatusId).toBeNull();
    expect(openAlerts()).toHaveLength(0);

    await setMonitoring(MONITOR_ID, { isArchived: false });

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
      OFFLINE_STATUS_ID,
    );
    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(OFFLINE_STATUS_ID);
  });

  it("an archived monitor whose monitoring is also off stays without a verdict when only one is undone", async () => {
    await bind();

    await setMonitoring(MONITOR_ID, {
      isArchived: true,
      disableActiveMonitoring: true,
    });
    await setMonitoring(MONITOR_ID, { isArchived: false });

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBeNull();
    expect(findSite(SITE_ID).currentMonitorStatusId).toBeNull();

    await setMonitoring(MONITOR_ID, { disableActiveMonitoring: false });

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
      OFFLINE_STATUS_ID,
    );
  });

  it("while monitoring is off, no site alert opens for the device: not on a status change by hand, not on the sweep", async () => {
    await bind();
    await setMonitoring(MONITOR_ID, { disableActiveMonitoring: true });
    spies.alertsCreated.mockClear();

    // Someone sets the monitor's status by hand, or declares an incident on it.
    await monitorStatusChanges(MONITOR_ID, DEGRADED_STATUS_ID);
    await monitorStatusChanges(MONITOR_ID, OFFLINE_STATUS_ID);
    await sweep();
    await sweep();

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBeNull();
    expect(findDevice(DEVICE_ID).isReachable).toBeNull();
    expect(findSite(SITE_ID).currentMonitorStatusId).toBeNull();
    expect(spies.alertsCreated).not.toHaveBeenCalled();
    expect(openAlerts()).toHaveLength(0);
    expect(openTimelineRows()).toHaveLength(0);
  });

  it("a device bound while monitoring is already off never reads Offline at all", async () => {
    findMonitor(MONITOR_ID).disableActiveMonitoring = true;

    await bind();

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBeNull();
    expect(findDevice(DEVICE_ID).isReachable).toBeNull();
    expect(findSite(SITE_ID).currentMonitorStatusId).toBeNull();
    expect(spies.alertsCreated).not.toHaveBeenCalled();
  });

  /*
   * A site with other devices reporting is not left without a status: the
   * device drops out of its roll-up, and the site rolls up from the rest -
   * here back to Operational, which resolves the alert as a recovery.
   */
  it("a site other devices report on rolls up from them, and its alert resolves as a recovery", async () => {
    world.monitors.push(
      pingMonitor({
        id: SECOND_MONITOR_ID,
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
      }),
    );
    world.devices.push(
      monitorBackedDevice({
        id: SECOND_DEVICE_ID,
        monitorId: SECOND_MONITOR_ID,
      }),
    );

    await bind(SECOND_DEVICE_ID);
    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(
      OPERATIONAL_STATUS_ID,
    );

    await bind(DEVICE_ID);
    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(OFFLINE_STATUS_ID);
    const alert: WorldAlert = openAlerts()[0]!;

    await setMonitoring(MONITOR_ID, { disableActiveMonitoring: true });

    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(
      OPERATIONAL_STATUS_ID,
    );
    expect(openTimelineRows()).toEqual([
      {
        siteId: SITE_ID,
        monitorStatusId: OPERATIONAL_STATUS_ID,
        endsAt: null,
      },
    ]);
    expect(openAlerts()).toHaveLength(0);
    expect(alert.resolvedWith).toContain("**Recovered:**");
    expect(findDevice(SECOND_DEVICE_ID).currentMonitorStatusId).toBe(
      OPERATIONAL_STATUS_ID,
    );
  });

  it("a monitor backing devices at two sites takes it off both", async () => {
    world.sites.push(storeSite({ id: OTHER_SITE_ID, name: "Store 40" }));
    world.devices.push(
      monitorBackedDevice({ id: SECOND_DEVICE_ID, siteId: OTHER_SITE_ID }),
    );

    await bind(DEVICE_ID);
    await bind(SECOND_DEVICE_ID);
    expect(openAlerts()).toHaveLength(2);

    await setMonitoring(MONITOR_ID, { disableActiveMonitoring: true });

    expect(findSite(SITE_ID).currentMonitorStatusId).toBeNull();
    expect(findSite(OTHER_SITE_ID).currentMonitorStatusId).toBeNull();
    expect(openAlerts()).toHaveLength(0);
    expect(
      world.alerts.map((alert: WorldAlert): string | null => {
        return alert.resolvedWith;
      }),
    ).toEqual([
      getNothingReportsRootCause("Store 12"),
      getNothingReportsRootCause("Store 40"),
    ]);
  });
});

describe("NetworkDeviceService.refreshStampedMonitorStatus and a monitor that is not checked", () => {
  it("reads the monitor's two switches with its status", async () => {
    await bind();

    const select: Dictionary<unknown> = spies.monitorRead.mock.calls[0]![0]
      .select as Dictionary<unknown>;
    expect(select["disableActiveMonitoring"]).toBe(true);
    expect(select["isArchived"]).toBe(true);
    expect(select["currentMonitorStatusId"]).toBe(true);
  });

  it("empties a stamp the monitor left, in one write, and refreshes the site chain", async () => {
    findDevice(DEVICE_ID).currentMonitorStatusId = OFFLINE_STATUS_ID;
    findDevice(DEVICE_ID).isReachable = false;
    findMonitor(MONITOR_ID).disableActiveMonitoring = true;

    await bind();

    expect(spies.deviceWrites).toHaveBeenCalledTimes(1);
    const write: Dictionary<unknown> = spies.deviceWrites.mock.calls[0]![0]
      .data as Dictionary<unknown>;
    expect(write).toEqual({ currentMonitorStatusId: null, isReachable: null });
    expect(spies.siteRollups).toHaveBeenCalledTimes(1);
    expect(spies.siteRollups.mock.calls[0]![0].toString()).toBe(SITE_ID);
  });

  it("writes nothing for a device that already has no status from it", async () => {
    findMonitor(MONITOR_ID).disableActiveMonitoring = true;

    await bind();

    expect(spies.deviceWrites).not.toHaveBeenCalled();
    expect(spies.siteRollups).not.toHaveBeenCalled();
  });

  it("an archived monitor gives no verdict either", async () => {
    findDevice(DEVICE_ID).currentMonitorStatusId = OPERATIONAL_STATUS_ID;
    findDevice(DEVICE_ID).isReachable = true;
    findMonitor(MONITOR_ID).isArchived = true;
    findMonitor(MONITOR_ID).currentMonitorStatusId = OPERATIONAL_STATUS_ID;

    await bind();

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBeNull();
    expect(findDevice(DEVICE_ID).isReachable).toBeNull();
  });

  it("a checked monitor's status is stamped as before, Operational or Offline", async () => {
    findMonitor(MONITOR_ID).currentMonitorStatusId = OPERATIONAL_STATUS_ID;
    await bind();
    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
      OPERATIONAL_STATUS_ID,
    );
    expect(findDevice(DEVICE_ID).isReachable).toBe(true);

    findMonitor(MONITOR_ID).currentMonitorStatusId = OFFLINE_STATUS_ID;
    await bind();
    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
      OFFLINE_STATUS_ID,
    );
    expect(findDevice(DEVICE_ID).isReachable).toBe(false);
  });

  /*
   * A probe-polled device's health is its poll, and its stamp comes from
   * the Network Device monitors that watch its walk - not from monitorId.
   * Turning off a monitor it happens to name changes nothing on it.
   */
  it("leaves a probe-polled device alone", async () => {
    world.devices = [
      monitorBackedDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
        currentMonitorStatusId: DEGRADED_STATUS_ID,
        isReachable: true,
      }),
    ];
    findMonitor(MONITOR_ID).disableActiveMonitoring = true;

    await bind();

    expect(spies.deviceWrites).not.toHaveBeenCalled();
    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
      DEGRADED_STATUS_ID,
    );
    expect(findDevice(DEVICE_ID).isReachable).toBe(true);
  });
});

describe("NetworkDeviceService.refreshStampsOfDevicesBoundToMonitors", () => {
  it("does nothing, and reads nothing, for no monitors", async () => {
    await NetworkDeviceService.refreshStampsOfDevicesBoundToMonitors({
      monitorIds: [],
    });

    expect(spies.devicesRead).not.toHaveBeenCalled();
  });

  it("reads the devices bound to the monitors as OneUptime, in id order, and re-stamps each of them", async () => {
    world.devices.push(
      monitorBackedDevice({ id: SECOND_DEVICE_ID, siteId: null }),
      monitorBackedDevice({
        id: THIRD_DEVICE_ID,
        monitorId: SECOND_MONITOR_ID,
      }),
    );
    world.monitors.push(pingMonitor({ id: SECOND_MONITOR_ID }));
    const refresh: SpyInstance<
      typeof NetworkDeviceService.refreshStampedMonitorStatus
    > = jest.spyOn(NetworkDeviceService, "refreshStampedMonitorStatus");

    await NetworkDeviceService.refreshStampsOfDevicesBoundToMonitors({
      monitorIds: [new ObjectID(MONITOR_ID)],
    });

    const read: Dictionary<unknown> = spies.devicesRead.mock
      .calls[0]![0] as unknown as Dictionary<unknown>;
    expect(idsIn((read["query"] as Dictionary<unknown>)["monitorId"])).toEqual([
      MONITOR_ID,
    ]);
    expect(read["props"]).toEqual({ isRoot: true });
    expect(read["sort"]).toEqual({ _id: "ASC" });
    expect(read["skip"]).toBe(0);
    expect(read["limit"]).toBe(LIMIT_MAX);

    expect(
      refresh.mock.calls.map(
        (
          call: [{ deviceId: ObjectID; clearWhenNotMonitorBacked: boolean }],
        ) => {
          return [
            call[0].deviceId.toString(),
            call[0].clearWhenNotMonitorBacked,
          ];
        },
      ),
    ).toEqual([
      [DEVICE_ID, false],
      [SECOND_DEVICE_ID, false],
    ]);
  });

  it("pages through a monitor that backs more devices than one page", async () => {
    const pageOfDevices: Array<NetworkDevice> = Array.from(
      { length: LIMIT_MAX },
      (): NetworkDevice => {
        return deviceRow(monitorBackedDevice({ id: DEVICE_ID }));
      },
    );
    spies.devicesRead.mockReset();
    spies.devicesRead
      .mockResolvedValueOnce(pageOfDevices)
      .mockResolvedValueOnce([deviceRow(monitorBackedDevice())]);
    const refresh: SpyInstance<
      typeof NetworkDeviceService.refreshStampedMonitorStatus
    > = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockResolvedValue(undefined);

    await NetworkDeviceService.refreshStampsOfDevicesBoundToMonitors({
      monitorIds: [new ObjectID(MONITOR_ID)],
    });

    expect(spies.devicesRead).toHaveBeenCalledTimes(2);
    expect(spies.devicesRead.mock.calls[1]![0].skip).toBe(LIMIT_MAX);
    expect(refresh).toHaveBeenCalledTimes(LIMIT_MAX + 1);
  });

  it("one device that fails is logged, and the others are still re-stamped", async () => {
    world.devices.push(monitorBackedDevice({ id: SECOND_DEVICE_ID }));
    const errors: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });
    const refresh: SpyInstance<
      typeof NetworkDeviceService.refreshStampedMonitorStatus
    > = jest
      .spyOn(NetworkDeviceService, "refreshStampedMonitorStatus")
      .mockRejectedValueOnce(new Error("database is down"))
      .mockResolvedValueOnce(undefined);

    await expect(
      NetworkDeviceService.refreshStampsOfDevicesBoundToMonitors({
        monitorIds: [new ObjectID(MONITOR_ID)],
      }),
    ).resolves.toBeUndefined();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(String(errors.mock.calls[0]![0])).toContain(DEVICE_ID);
  });
});

describe("NetworkSiteService.onMonitorStatusChanged and a monitor that is not checked", () => {
  it("gives a monitor-backed device bound to it the empty stamp, without reading the status row", async () => {
    world.devices = [
      monitorBackedDevice({
        currentMonitorStatusId: OFFLINE_STATUS_ID,
        isReachable: false,
      }),
    ];
    findMonitor(MONITOR_ID).disableActiveMonitoring = true;

    await monitorStatusChanges(MONITOR_ID, DEGRADED_STATUS_ID);

    expect(spies.deviceWrites).toHaveBeenCalledTimes(1);
    expect(spies.deviceWrites.mock.calls[0]![0].data).toEqual({
      currentMonitorStatusId: null,
      isReachable: null,
    });
    expect(spies.statusRead).not.toHaveBeenCalled();
    expect(spies.siteRollups).toHaveBeenCalledTimes(1);
  });

  it("an archived monitor's status change empties the stamp the same way", async () => {
    world.devices = [
      monitorBackedDevice({
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
        isReachable: true,
      }),
    ];
    findMonitor(MONITOR_ID).isArchived = true;

    await monitorStatusChanges(MONITOR_ID, OFFLINE_STATUS_ID);

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBeNull();
    expect(findDevice(DEVICE_ID).isReachable).toBeNull();
  });

  it("reads the switch of the monitors the devices are bound to once, with both flags", async () => {
    world.devices.push(monitorBackedDevice({ id: SECOND_DEVICE_ID }));

    await monitorStatusChanges(MONITOR_ID, OPERATIONAL_STATUS_ID);

    const switchReads: Array<Dictionary<unknown>> =
      spies.monitorsRead.mock.calls
        .map((call: Array<unknown>): Dictionary<unknown> => {
          return call[0] as Dictionary<unknown>;
        })
        .filter((read: Dictionary<unknown>): boolean => {
          return (
            (read["query"] as Dictionary<unknown>)["monitorType"] === undefined
          );
        });

    expect(switchReads).toHaveLength(1);
    expect(
      idsIn((switchReads[0]!["query"] as Dictionary<unknown>)["_id"]),
    ).toEqual([MONITOR_ID]);
    expect(
      (
        (switchReads[0]!["query"] as Dictionary<unknown>)[
          "projectId"
        ] as ObjectID
      ).toString(),
    ).toBe(PROJECT_ID.toString());
    expect(switchReads[0]!["select"]).toEqual({
      _id: true,
      disableActiveMonitoring: true,
      isArchived: true,
    });
    expect(switchReads[0]!["props"]).toEqual({ isRoot: true });
  });

  it("a checked monitor's devices get its status as before", async () => {
    world.devices.push(monitorBackedDevice({ id: SECOND_DEVICE_ID }));

    await monitorStatusChanges(MONITOR_ID, OFFLINE_STATUS_ID);

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
      OFFLINE_STATUS_ID,
    );
    expect(findDevice(SECOND_DEVICE_ID).isReachable).toBe(false);
    expect(spies.statusRead).toHaveBeenCalledTimes(1);
  });

  it("a monitor not found counts as checked", async () => {
    world.monitors = [];

    await NetworkSiteService.onMonitorStatusChanged({
      projectId: PROJECT_ID,
      monitorIds: [new ObjectID(MONITOR_ID)],
      monitorStatusId: new ObjectID(OFFLINE_STATUS_ID),
    });

    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
      OFFLINE_STATUS_ID,
    );
  });

  it("a probe-polled device that names a monitor that is not checked is not stamped at all", async () => {
    world.devices = [
      monitorBackedDevice({
        monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
        isReachable: true,
      }),
    ];
    findMonitor(MONITOR_ID).disableActiveMonitoring = true;

    await monitorStatusChanges(MONITOR_ID, OFFLINE_STATUS_ID);

    expect(spies.deviceWrites).not.toHaveBeenCalled();
    expect(spies.siteRollups).not.toHaveBeenCalled();
    expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
      OPERATIONAL_STATUS_ID,
    );
  });

  describe("a Network Device monitor watching devices through its steps", () => {
    beforeEach(() => {
      world.monitors = [
        {
          id: NETWORK_DEVICE_MONITOR_ID,
          monitorType: MonitorType.NetworkDevice,
          disableActiveMonitoring: false,
          isArchived: false,
          currentMonitorStatusId: OPERATIONAL_STATUS_ID,
          watchedDeviceIds: [DEVICE_ID],
        },
      ];
      world.devices = [
        monitorBackedDevice({
          monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
          monitorId: null,
          currentMonitorStatusId: OPERATIONAL_STATUS_ID,
          isReachable: true,
        }),
      ];
    });

    it("stamps them while it is checked", async () => {
      await monitorStatusChanges(NETWORK_DEVICE_MONITOR_ID, DEGRADED_STATUS_ID);

      expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
        DEGRADED_STATUS_ID,
      );
      expect(findDevice(DEVICE_ID).isReachable).toBe(true);
    });

    it("stamps nothing once its monitoring is off: the poll decides them, and the status they had stays", async () => {
      findMonitor(NETWORK_DEVICE_MONITOR_ID).disableActiveMonitoring = true;

      await monitorStatusChanges(NETWORK_DEVICE_MONITOR_ID, OFFLINE_STATUS_ID);

      expect(spies.deviceWrites).not.toHaveBeenCalled();
      expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
        OPERATIONAL_STATUS_ID,
      );
      // Its own read already told the switch: no second read of it.
      expect(spies.monitorsRead).toHaveBeenCalledTimes(1);
      expect(
        (
          spies.monitorsRead.mock.calls[0]![0] as unknown as Dictionary<unknown>
        )["select"],
      ).toEqual(
        expect.objectContaining({
          monitorSteps: true,
          disableActiveMonitoring: true,
          isArchived: true,
        }),
      );
    });

    it("an archived one stamps nothing either", async () => {
      findMonitor(NETWORK_DEVICE_MONITOR_ID).isArchived = true;

      await monitorStatusChanges(NETWORK_DEVICE_MONITOR_ID, OFFLINE_STATUS_ID);

      expect(spies.deviceWrites).not.toHaveBeenCalled();
    });

    it("a device a checked monitor watches is still stamped by it, whatever another monitor it names says", async () => {
      world.monitors.push(pingMonitor({ disableActiveMonitoring: true }));
      findDevice(DEVICE_ID).monitorId = MONITOR_ID;

      await NetworkSiteService.onMonitorStatusChanged({
        projectId: PROJECT_ID,
        monitorIds: [
          new ObjectID(NETWORK_DEVICE_MONITOR_ID),
          new ObjectID(MONITOR_ID),
        ],
        monitorStatusId: new ObjectID(DEGRADED_STATUS_ID),
      });

      expect(findDevice(DEVICE_ID).currentMonitorStatusId).toBe(
        DEGRADED_STATUS_ID,
      );
    });
  });
});

describe("NetworkSiteService.recomputeRollupForSite when nothing at the site reports", () => {
  it("clears a status nothing supports any more, closes its timeline row and opens none", async () => {
    findSite(SITE_ID).currentMonitorStatusId = OFFLINE_STATUS_ID;
    world.timeline.push({
      siteId: SITE_ID,
      monitorStatusId: OFFLINE_STATUS_ID,
      endsAt: null,
    });

    await sweep();

    expect(findSite(SITE_ID).currentMonitorStatusId).toBeNull();
    expect(world.timeline).toHaveLength(1);
    expect(world.timeline[0]!.endsAt).toBeInstanceOf(Date);
  });

  it("resolves the site's open alert with the reason, and stops tracking it", async () => {
    world.alerts.push({
      id: "6965aaaa-0000-4000-8000-0000000000a9",
      siteId: SITE_ID,
      title: "Network site Store 12 is Offline",
      currentAlertStateId: OPEN_STATE_ID,
      resolvedWith: null,
    });
    findSite(SITE_ID).currentMonitorStatusId = OFFLINE_STATUS_ID;
    findSite(SITE_ID).currentActiveAlertId =
      "6965aaaa-0000-4000-8000-0000000000a9";

    await sweep();

    expect(world.alerts[0]!.currentAlertStateId).toBe(RESOLVED_STATE_ID);
    expect(world.alerts[0]!.resolvedWith).toBe(
      getNothingReportsRootCause("Store 12"),
    );
    expect(findSite(SITE_ID).currentActiveAlertId).toBeNull();
  });

  it("an alert resolved by hand already is not resolved again, and is no longer tracked", async () => {
    world.alerts.push({
      id: "6965aaaa-0000-4000-8000-0000000000a9",
      siteId: SITE_ID,
      title: "Network site Store 12 is Offline",
      currentAlertStateId: RESOLVED_STATE_ID,
      resolvedWith: null,
    });
    findSite(SITE_ID).currentMonitorStatusId = OFFLINE_STATUS_ID;
    findSite(SITE_ID).currentActiveAlertId =
      "6965aaaa-0000-4000-8000-0000000000a9";
    const resolutions: SpyInstance<typeof AlertStateTimelineService.create> =
      jest.spyOn(AlertStateTimelineService, "create");

    await sweep();

    expect(resolutions).not.toHaveBeenCalled();
    expect(world.alerts[0]!.resolvedWith).toBeNull();
    expect(findSite(SITE_ID).currentActiveAlertId).toBeNull();
  });

  it("a failure to resolve the alert is logged and the status is still cleared", async () => {
    findSite(SITE_ID).currentMonitorStatusId = OFFLINE_STATUS_ID;
    findSite(SITE_ID).currentActiveAlertId =
      "6965aaaa-0000-4000-8000-0000000000a9";
    jest
      .spyOn(AlertService, "findOneById")
      .mockRejectedValue(new Error("database is down"));
    const errors: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    await expect(sweep()).resolves.toBeUndefined();

    expect(findSite(SITE_ID).currentMonitorStatusId).toBeNull();
    expect(errors).toHaveBeenCalled();
  });

  it("a site with no status yet only has its run stamped", async () => {
    const writes: SpyInstance<
      typeof NetworkSiteService.updateColumnsByIdWithoutHooks
    > = jest.spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks");

    await sweep();

    expect(writes).toHaveBeenCalledTimes(1);
    expect(Object.keys(writes.mock.calls[0]![0].data)).toEqual([
      "lastRollupAt",
    ]);
  });

  // The behaviour that predates this: a site with no devices keeps its status.
  it("a site with no devices at all keeps its status, as it always has", async () => {
    world.devices = [];
    findSite(SITE_ID).currentMonitorStatusId = OPERATIONAL_STATUS_ID;

    await sweep();

    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(
      OPERATIONAL_STATUS_ID,
    );
  });

  it("a project whose statuses could not be read keeps the status as it is", async () => {
    findDevice(DEVICE_ID).currentMonitorStatusId = OFFLINE_STATUS_ID;
    findDevice(DEVICE_ID).isReachable = false;
    findSite(SITE_ID).currentMonitorStatusId = OFFLINE_STATUS_ID;
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([]);

    await sweep();

    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(OFFLINE_STATUS_ID);
  });

  it("a device in an ongoing maintenance window below the site still counts: the site is operational, not cleared", async () => {
    const maintainedSiteId: ObjectID = new ObjectID(OTHER_SITE_ID);
    world.sites.push(storeSite({ id: OTHER_SITE_ID, name: "Store 40" }));
    world.devices.push(
      monitorBackedDevice({
        id: SECOND_DEVICE_ID,
        siteId: OTHER_SITE_ID,
        monitorId: SECOND_MONITOR_ID,
        currentMonitorStatusId: OPERATIONAL_STATUS_ID,
        isReachable: true,
      }),
    );
    jest
      .spyOn(NetworkSiteService, "getDescendantSiteIds")
      .mockResolvedValue([maintainedSiteId]);
    jest
      .spyOn(
        NetworkSiteMaintenanceSuppression,
        "getSiteIdsUnderOngoingMaintenance",
      )
      .mockResolvedValue(new Set<string>([OTHER_SITE_ID]));
    findSite(SITE_ID).currentMonitorStatusId = OFFLINE_STATUS_ID;

    await sweep();

    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(
      OPERATIONAL_STATUS_ID,
    );
  });

  /*
   * A device held back by a window is not a device that reports nothing:
   * it reports, and votes again when the window ends. So a site whose only
   * reporting devices are under maintenance keeps its status, even where
   * the rollup has no operational status to fall back on - a project whose
   * statuses are only Degraded and Offline - and its alert stays open.
   */
  it("a site whose only reporting device is held back by maintenance keeps its status and its alert, with no operational status to fall back on", async () => {
    const maintainedSiteId: ObjectID = new ObjectID(OTHER_SITE_ID);
    world.sites.push(storeSite({ id: OTHER_SITE_ID, name: "Store 40" }));
    world.devices.push(
      monitorBackedDevice({
        id: SECOND_DEVICE_ID,
        siteId: OTHER_SITE_ID,
        monitorId: SECOND_MONITOR_ID,
        currentMonitorStatusId: OFFLINE_STATUS_ID,
        isReachable: false,
      }),
    );
    world.alerts.push({
      id: "6965aaaa-0000-4000-8000-0000000000a9",
      siteId: SITE_ID,
      title: "Network site Store 12 is Offline",
      currentAlertStateId: OPEN_STATE_ID,
      resolvedWith: null,
    });
    jest
      .spyOn(NetworkSiteService, "getDescendantSiteIds")
      .mockResolvedValue([maintainedSiteId]);
    jest
      .spyOn(
        NetworkSiteMaintenanceSuppression,
        "getSiteIdsUnderOngoingMaintenance",
      )
      .mockResolvedValue(new Set<string>([OTHER_SITE_ID]));
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue(
      STATUSES.filter((status: (typeof STATUSES)[number]): boolean => {
        return !status.isOperationalState;
      }).map((status: (typeof STATUSES)[number]): MonitorStatus => {
        return {
          id: new ObjectID(status.id),
          _id: status.id,
          name: status.name,
          priority: status.priority,
          isOperationalState: status.isOperationalState,
          isOfflineState: status.isOfflineState,
        } as unknown as MonitorStatus;
      }),
    );
    findSite(SITE_ID).currentMonitorStatusId = OFFLINE_STATUS_ID;
    findSite(SITE_ID).currentActiveAlertId =
      "6965aaaa-0000-4000-8000-0000000000a9";

    await sweep();

    expect(findSite(SITE_ID).currentMonitorStatusId).toBe(OFFLINE_STATUS_ID);
    expect(world.alerts[0]!.currentAlertStateId).toBe(OPEN_STATE_ID);
    expect(findSite(SITE_ID).currentActiveAlertId).toBe(
      "6965aaaa-0000-4000-8000-0000000000a9",
    );
  });
});
