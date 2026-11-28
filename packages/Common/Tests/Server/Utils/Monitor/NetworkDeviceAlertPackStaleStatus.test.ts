/*
 * MonitorResource reaches the native isolated-vm addon through the criteria
 * evaluator's sandbox runner. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorTemplate from "../../../../Models/DatabaseModels/MonitorTemplate";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import OneUptimeDate from "../../../../Types/Date";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import {
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableSnapshot,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import {
  NetworkDeviceTransceiver,
  TransceiverHealth,
  TransceiverReadingKind,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import NetworkDeviceAlertPackUtil from "../../../../Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import ObjectID from "../../../../Types/ObjectID";
import UptimePrecision from "../../../../Types/StatusPage/UptimePrecision";
import NetworkAlertPolicyBootstrapUtil from "../../../../Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import UptimeUtil from "../../../../Utils/Uptime/UptimeUtil";
import {
  MonitorRecordTables,
  isOpenAlert,
  isOpenIncident,
  mockMonitorRecordTables,
} from "../../TestingUtils/MonitorRecordTables";
import {
  MonitorStatusTimelineRows,
  mockMonitorStatusTimelineRows,
} from "../../TestingUtils/MonitorStatusTimelineRows";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * AN ALERT-ONLY CRITERIA NEVER KEEPS A STALE STATUS (OneUptime issue #11238).
 *
 * The recommended network device alert pack - the template a policy or an
 * import gives every device - opens incidents for a device that stops
 * answering ("Device unreachable", Offline) and for a port that goes down,
 * and only alerts for the rest: a port above 80%, a port logging errors,
 * an optic gone or past its alarm threshold, a fan or a radio unhealthy.
 * Those alerts change no status.
 *
 * Only the first criteria that matched used to set a monitor's status, and
 * one that changes no status left it as it was. So a switch that missed one
 * poll went Offline, answered the next with one port above 80%, and stayed
 * Offline - its incident resolved, its status page red - for as long as any
 * alert-only criteria kept matching. A busy uplink is above 80% all day.
 *
 * Now the status comes from the criteria that change it: the first of them
 * that matches, in the order given, or the monitor's default status when
 * none does. The alerts open and resolve with their own criteria, as before.
 *
 * Each poll goes through MonitorResourceUtil.monitorResource: the real
 * evaluator, the real status change (MonitorStatusTimelineUtil), incidents,
 * alerts and the status timeline kept in memory. The status page's banner
 * and the uptime it shows are read from that timeline, as the page reads it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11238000-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11238000-2222-4222-8222-222222222222",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "11238000-3333-4333-8333-333333333333",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "11238000-4444-4444-8444-444444444444",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "11238000-5555-4555-8555-555555555555",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "11238000-6666-4666-8666-666666666666",
);

const START: Date = new Date("2026-11-27T09:00:00.000Z");
const POLL_EVERY_MINUTES: number = 5;
const SWITCH_NAME: string = "UN1782LANSWI03";

function monitorStatus(
  id: ObjectID,
  name: string,
  priority: number,
): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = id;
  status.name = name;
  status.priority = priority;
  return status;
}

const ONLINE: MonitorStatus = monitorStatus(ONLINE_STATUS_ID, "Online", 1);
const OFFLINE: MonitorStatus = monitorStatus(OFFLINE_STATUS_ID, "Offline", 3);

// A fan tray's health, as a vendor's hardware MIB reports it.
const FAN_ENTRY: string = "1.3.6.1.4.1.9.9.13.1.4.1";
const FAN_NAME: string = `${FAN_ENTRY}.2`;
const FAN_STATE: string = `${FAN_ENTRY}.3`;

const FAN_TABLE: SnmpTableDefinition = {
  key: "fans",
  name: "Fans",
  kind: SnmpTableKind.Hardware,
  rowLabelColumnOids: [FAN_NAME],
  columns: [
    {
      oid: FAN_STATE,
      name: "State",
      role: SnmpTableColumnRole.Status,
      valueLabels: { "1": "normal", "4": "shutdown", "5": "notPresent" },
      healthyValues: ["1"],
    },
  ],
};

// An access switch's ports: two access ports and its uplink.
function port(input: {
  index: number;
  name: string;
  utilizationPercent?: number | undefined;
  errorsPerSecond?: number | undefined;
  isUp?: boolean | undefined;
}): SnmpInterface {
  return {
    interfaceIndex: input.index,
    name: input.name,
    isAdministrativelyUp: true,
    isOperationallyUp: input.isUp ?? true,
    utilizationPercent: input.utilizationPercent ?? 12,
    errorsPerSecond: input.errorsPerSecond ?? 0,
  };
}

// The uplink's optic.
function optic(input: {
  isPresent?: boolean | undefined;
  isPastAlarm?: boolean | undefined;
}): NetworkDeviceTransceiver {
  const isPresent: boolean = input.isPresent ?? true;
  const rxPowerDbm: number = input.isPastAlarm ? -21 : -4;

  return {
    interfaceIndex: 49,
    interfaceName: "Te1/1/1",
    isPresent: isPresent,
    vendor: "FLEXOPTIX",
    serialNumber: "F1",
    measurements: isPresent
      ? {
          [TransceiverReadingKind.RxPower]: {
            readings: [{ value: rxPowerDbm }],
            thresholds: {
              lowAlarm: -18.4,
              lowWarning: -14.4,
              highWarning: 0.5,
              highAlarm: 2.5,
            },
          },
        }
      : {},
    health: isPresent
      ? input.isPastAlarm
        ? TransceiverHealth.Alarm
        : TransceiverHealth.Healthy
      : TransceiverHealth.NotDetected,
    ...(isPresent
      ? {}
      : {
          missingPolls: 2,
          missingSince: "2026-11-27T09:00:00.000Z",
        }),
  };
}

function fans(states: Array<number>): SnmpTableSnapshot {
  return SnmpTableListUtil.materialize({
    tables: [FAN_TABLE],
    results: [
      {
        key: "fans",
        rows: states.map((state: number, index: number) => {
          return {
            index: String(index + 1),
            values: { [FAN_NAME]: `Fan ${index + 1}`, [FAN_STATE]: state },
          };
        }),
      },
    ],
  })[0]!;
}

/*
 * One poll, as the probe reports it and the server hands it to the
 * monitor: the ping beside the walk, and what the walk read.
 */
function devicePoll(
  input: {
    answers?: boolean | undefined;
    uplinkUtilizationPercent?: number | undefined;
    uplinkErrorsPerSecond?: number | undefined;
    accessPortDown?: boolean | undefined;
    optic?: NetworkDeviceTransceiver | undefined;
    fanStates?: Array<number> | undefined;
  } = {},
): DataToProcess {
  const answers: boolean = input.answers ?? true;

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    probeId: ObjectID.generate(),
    isOnline: answers,
    failureCause: answers ? "" : "Request timed out",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    pingResponse: {
      packetsSent: 3,
      packetsReceived: answers ? 3 : 0,
      packetLossPercent: answers ? 0 : 100,
      avgRoundTripTimeInMs: answers ? 2 : undefined,
      isReachable: answers,
    },
    snmpResponse: answers
      ? {
          isOnline: true,
          responseTimeInMs: 12,
          failureCause: "",
          oidResponses: [],
          interfaces: [
            port({ index: 1, name: "Gi1/0/1" }),
            port({
              index: 2,
              name: "Gi1/0/2",
              isUp: !input.accessPortDown,
            }),
            port({
              index: 49,
              name: "Te1/1/1",
              utilizationPercent: input.uplinkUtilizationPercent,
              errorsPerSecond: input.uplinkErrorsPerSecond,
            }),
          ],
          transceivers: [input.optic || optic({})],
          tables: [fans(input.fanStates || [1, 1])],
        }
      : {
          isOnline: false,
          responseTimeInMs: 0,
          failureCause: "Request timed out",
          oidResponses: [],
        },
  } as unknown as DataToProcess;
}

const HEALTHY: DataToProcess = devicePoll();
// The switch missed one poll: a reboot, a link flap, its probe restarting.
const UNREACHABLE: DataToProcess = devicePoll({ answers: false });
// The uplink above 80%: "Interface saturated", an alert.
const UPLINK_SATURATED: DataToProcess = devicePoll({
  uplinkUtilizationPercent: 92,
});
// The uplink logging errors: "Interface errors", an alert.
const UPLINK_ERRORS: DataToProcess = devicePoll({ uplinkErrorsPerSecond: 40 });
// The uplink's optic pulled: "Transceiver not detected", one alert per port.
const OPTIC_MISSING: DataToProcess = devicePoll({
  optic: optic({ isPresent: false }),
});
// The uplink's optic past its alarm threshold, one alert per port.
const OPTIC_PAST_ALARM: DataToProcess = devicePoll({
  optic: optic({ isPastAlarm: true }),
});
// A fan failed: "Fans: row unhealthy", one alert per row.
const FAN_FAILED: DataToProcess = devicePoll({ fanStates: [1, 4] });
// An access port down: "Interface down", an incident that sets Offline.
const ACCESS_PORT_DOWN_AND_SATURATED: DataToProcess = devicePoll({
  accessPortDown: true,
  uplinkUtilizationPercent: 92,
});

let tables: MonitorRecordTables;
let timeline: MonitorStatusTimelineRows;
let monitorUnderTest: Monitor;

function watch(monitorSteps: MonitorSteps): void {
  monitorUnderTest = new Monitor();
  monitorUnderTest.id = MONITOR_ID;
  monitorUnderTest.projectId = PROJECT_ID;
  monitorUnderTest.name = SWITCH_NAME;
  monitorUnderTest.monitorType = MonitorType.NetworkDevice;
  monitorUnderTest.monitorSteps = monitorSteps;
  monitorUnderTest.currentMonitorStatusId = ONLINE_STATUS_ID;

  tables = mockMonitorRecordTables({
    getMonitor: (): Monitor => {
      return monitorUnderTest;
    },
    projectId: PROJECT_ID,
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    alertSeverityId: ALERT_SEVERITY_ID,
  });

  timeline = mockMonitorStatusTimelineRows({
    getMonitor: (): Monitor => {
      return monitorUnderTest;
    },
    projectId: PROJECT_ID,
    statuses: [ONLINE, OFFLINE],
  });
}

// The recommended pack, with the device's tables, as a policy clones it.
function watchWithRecommendedPack(): void {
  const template: MonitorTemplate =
    NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate({
      projectId: PROJECT_ID,
      incidentSeverityId: INCIDENT_SEVERITY_ID,
      alertSeverityId: ALERT_SEVERITY_ID,
      onlineMonitorStatusId: ONLINE_STATUS_ID,
      offlineMonitorStatusId: OFFLINE_STATUS_ID,
    });

  const monitorSteps: MonitorSteps = template.monitorSteps!;

  // The fan table's own item, as the pack adds one for a table it knows.
  const fanItem: MonitorCriteriaInstance =
    NetworkDeviceAlertPackUtil.buildCriteriaInstances({
      downMonitorStatusId: OFFLINE_STATUS_ID,
      upMonitorStatusId: ONLINE_STATUS_ID,
      incidentSeverityId: INCIDENT_SEVERITY_ID,
      alertSeverityId: ALERT_SEVERITY_ID,
      tables: [FAN_TABLE],
    }).find((instance: MonitorCriteriaInstance): boolean => {
      return instance.data?.name === "Fans: row unhealthy";
    })!;

  monitorSteps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.push(
    fanItem,
  );

  watch(monitorSteps);
}

async function poll(dataToProcess: DataToProcess): Promise<void> {
  jest.setSystemTime(
    OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      POLL_EVERY_MINUTES,
    ),
  );

  await MonitorResourceUtil.monitorResource({
    ...dataToProcess,
    probeId: ObjectID.generate(),
    monitoredAt: OneUptimeDate.getCurrentDate(),
  } as DataToProcess);
}

function status(): string {
  const current: string | undefined =
    monitorUnderTest.currentMonitorStatusId?.toString();

  if (current === ONLINE_STATUS_ID.toString()) {
    return "Online";
  }

  if (current === OFFLINE_STATUS_ID.toString()) {
    return "Offline";
  }

  return current || "";
}

function openIncidents(): Array<string> {
  return tables.incidents.filter(isOpenIncident).map((incident: Incident) => {
    return incident.title || "";
  });
}

function openAlerts(): Array<string> {
  return tables.alerts
    .filter(isOpenAlert)
    .map((alert: Alert) => {
      return alert.title || "";
    })
    .sort();
}

// The status page's banner, read from the monitor as the page reads it.
function statusPageBanner(): string | null {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.monitorId = MONITOR_ID;
  resource.monitor = monitorUnderTest;

  return (
    StatusPageService.getOverallMonitorStatus({
      statusPageResources: [resource],
      monitorStatuses: [ONLINE, OFFLINE],
      monitorGroupCurrentStatuses: {},
    })?.name || null
  );
}

// The uptime a status page shows, from the start of the test until now.
function uptimePercent(): number {
  return UptimeUtil.calculateUptimePercentage(
    timeline.rows,
    UptimePrecision.TWO_DECIMAL,
    [OFFLINE],
    { startDate: START, endDate: OneUptimeDate.getCurrentDate() },
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(START);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the recommended alert pack: a switch back from one unreachable poll is Online, whatever only alerts (#11238)", () => {
  beforeEach(() => {
    watchWithRecommendedPack();
  });

  /*
   * THE REPORT. Unreachable for one poll, back with its uplink above 80%:
   * "Interface saturated" is the first criteria to match, an alert. The
   * switch stayed Offline for as long as the uplink stayed busy.
   */
  it("back with its uplink above 80%: Online, its incident resolved, the saturation alert open", async () => {
    await poll(HEALTHY);
    expect(status()).toBe("Online");

    await poll(UNREACHABLE);
    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["Device unreachable"]);

    await poll(UPLINK_SATURATED);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["Interface saturated"]);
  });

  it("stays Online poll after poll while the uplink stays busy, with the one alert", async () => {
    await poll(HEALTHY);
    await poll(UNREACHABLE);

    for (let polls: number = 0; polls < 6; polls++) {
      await poll(UPLINK_SATURATED);

      expect(status()).toBe("Online");
      expect(openAlerts()).toEqual(["Interface saturated"]);
    }

    // One alert, kept open: never a new one per poll.
    expect(tables.alerts).toHaveLength(1);

    // The uplink quiet again: the alert resolves, the switch stays Online.
    await poll(HEALTHY);

    expect(openAlerts()).toEqual([]);
    expect(status()).toBe("Online");
  });

  it("back with its uplink logging errors: Online, with the errors alert", async () => {
    await poll(HEALTHY);
    await poll(UNREACHABLE);
    await poll(UPLINK_ERRORS);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["Interface errors"]);

    await poll(HEALTHY);

    expect(openAlerts()).toEqual([]);
    expect(status()).toBe("Online");
  });

  it("back with its uplink optic missing: Online, with the per-port alert", async () => {
    await poll(HEALTHY);
    await poll(UNREACHABLE);
    await poll(OPTIC_MISSING);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual([
      "Transceiver not detected - Interface: Te1/1/1",
    ]);
    expect(
      tables.alerts.filter(isOpenAlert).map((alert: Alert) => {
        return Boolean(alert.seriesFingerprint);
      }),
    ).toEqual([true]);

    await poll(HEALTHY);

    expect(openAlerts()).toEqual([]);
    expect(status()).toBe("Online");
  });

  it("back with its uplink optic past its alarm threshold: Online, with the per-port alert", async () => {
    await poll(HEALTHY);
    await poll(UNREACHABLE);
    await poll(OPTIC_PAST_ALARM);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual([
      "Transceiver past its alarm threshold - Interface: Te1/1/1",
    ]);
  });

  it("back with a fan failed: Online, with the per-row alert", async () => {
    await poll(HEALTHY);
    await poll(UNREACHABLE);
    await poll(FAN_FAILED);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual([
      "Fans: row unhealthy - Row: Fan 2 | Row Index: 2",
    ]);

    await poll(HEALTHY);

    expect(openAlerts()).toEqual([]);
    expect(status()).toBe("Online");
  });

  /*
   * Two whole-device alerts, a per-port one and a per-row one at once. The
   * two whole-device alerts check different things, so each opens: they
   * used to open one, the first claiming the device (#11349).
   */
  it("back with everything that only alerts at once: Online, with each alert", async () => {
    await poll(HEALTHY);
    await poll(UNREACHABLE);
    await poll(
      devicePoll({
        uplinkUtilizationPercent: 92,
        uplinkErrorsPerSecond: 40,
        optic: optic({ isPastAlarm: true }),
        fanStates: [4, 1],
      }),
    );

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual([
      "Fans: row unhealthy - Row: Fan 1 | Row Index: 1",
      "Interface errors",
      "Interface saturated",
      "Transceiver past its alarm threshold - Interface: Te1/1/1",
    ]);

    // Everything quiet again: each alert resolves, the switch stays Online.
    await poll(HEALTHY);

    expect(openAlerts()).toEqual([]);
    expect(status()).toBe("Online");
  });

  /*
   * A criteria that changes the status still wins over one that only
   * alerts: a port down is an incident and Offline, whatever else is busy.
   */
  it("a port down beside a busy uplink: Offline from 'Interface down', with the saturation alert too", async () => {
    await poll(HEALTHY);
    await poll(ACCESS_PORT_DOWN_AND_SATURATED);

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["Interface down"]);
    expect(openAlerts()).toEqual(["Interface saturated"]);

    // The port back up, the uplink still busy: Online, the alert still open.
    await poll(UPLINK_SATURATED);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["Interface saturated"]);
  });

  it("the switch unreachable again while its uplink alert is open: Offline, and the alert resolves", async () => {
    await poll(HEALTHY);
    await poll(UPLINK_SATURATED);

    expect(status()).toBe("Online");
    expect(openAlerts()).toEqual(["Interface saturated"]);

    await poll(UNREACHABLE);

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["Device unreachable"]);
    // Nothing was read of the uplink: its alert's criteria no longer holds.
    expect(openAlerts()).toEqual([]);
  });
});

describe("the status page and uptime follow the status the pack's criteria set (#11238)", () => {
  beforeEach(() => {
    watchWithRecommendedPack();
  });

  it("the page's banner is Online again on the poll the switch answers, though the uplink is busy", async () => {
    await poll(HEALTHY);
    expect(statusPageBanner()).toBe("Online");

    await poll(UNREACHABLE);
    expect(statusPageBanner()).toBe("Offline");

    await poll(UPLINK_SATURATED);
    expect(statusPageBanner()).toBe("Online");

    await poll(UPLINK_SATURATED);
    expect(statusPageBanner()).toBe("Online");
  });

  it("the timeline holds one Offline row, as long as the switch did not answer", async () => {
    await poll(HEALTHY);
    await poll(UNREACHABLE);
    await poll(UPLINK_SATURATED);
    await poll(UPLINK_SATURATED);
    await poll(HEALTHY);

    expect(timeline.statusNames()).toEqual(["Online", "Offline", "Online"]);

    const offlineRow: MonitorStatusTimeline = timeline.rows[1]!;

    expect(
      OneUptimeDate.getMinutesBetweenTwoDates(
        offlineRow.startsAt!,
        offlineRow.endsAt!,
      ),
    ).toBe(POLL_EVERY_MINUTES);
  });

  it("uptime counts the unreachable poll as down, and the busy polls as up", async () => {
    await poll(HEALTHY); // 09:05
    await poll(UNREACHABLE); // 09:10, down until the next poll
    await poll(UPLINK_SATURATED); // 09:15
    await poll(UPLINK_SATURATED); // 09:20
    await poll(UPLINK_SATURATED); // 09:25

    // 5 minutes down of 25.
    expect(uptimePercent()).toBe(80);
  });
});
