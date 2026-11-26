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
import MonitorTemplate from "../../../../Models/DatabaseModels/MonitorTemplate";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import OneUptimeDate from "../../../../Types/Date";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import NetworkAlertPolicyBootstrapUtil from "../../../../Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import {
  DEFAULT_STATUS,
  MonitorRecordTables,
  isOpenAlert,
  isOpenIncident,
  mockMonitorRecordTables,
} from "../../TestingUtils/MonitorRecordTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * SNMP FAILING IS NOT OFFLINE (OneUptime issue #11071).
 *
 * A customer with 3,000 Meraki switches saw them reported Offline over one
 * SNMP credential problem, while every switch answered ping. Each poll
 * pings the device beside its SNMP walk, and the device is up when either
 * answers - but the criteria a fleet is monitored with decide what the
 * monitor says, and they read SNMP:
 *
 *   - The recommended alert pack (the template a policy or an import gives
 *     every device) raised "SNMP walk failing" as an alert that changed no
 *     status. The first criteria that matches decides a monitor's status,
 *     so a switch that was Offline for one poll - a reboot, a link flap, its
 *     probe restarting - and came back with SNMP still failing matched
 *     "SNMP walk failing" and stayed Offline for as long as SNMP failed.
 *     Its incident resolved; its status never came back.
 *   - A new monitor's default criteria had no word for it at all.
 *
 * These drive MonitorResourceUtil.monitorResource end to end - the real
 * evaluator, incidents and alerts opened and resolved in memory - over the
 * polls a switch's probe sends.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11071000-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11071000-2222-4222-8222-222222222222",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "11071000-3333-4333-8333-333333333333",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "11071000-4444-4444-8444-444444444444",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "11071000-5555-4555-8555-555555555555",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "11071000-6666-4666-8666-666666666666",
);

const START: Date = new Date("2026-11-24T09:00:00.000Z");
const SWITCH_NAME: string = "UN1782LANSWI03";

/*
 * One poll, as the probe reports it and the server hands it to the
 * monitor: the ping's verdict (null: a probe that ran none), the walk's
 * (null: a device that is only pinged), and the device's - either.
 */
function devicePoll(data: {
  ping: boolean | null;
  walk: boolean | null;
}): DataToProcess {
  const isOnline: boolean = Boolean(data.ping || data.walk);
  const walkCause: string = "SNMP request timed out after 3 attempts";

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    probeId: ObjectID.generate(),
    isOnline: isOnline,
    failureCause:
      data.walk === false
        ? walkCause
        : data.ping === false && !isOnline
          ? "Request timed out"
          : "",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    ...(data.ping === null
      ? {}
      : {
          pingResponse: {
            packetsSent: 3,
            packetsReceived: data.ping ? 3 : 0,
            packetLossPercent: data.ping ? 0 : 100,
            avgRoundTripTimeInMs: data.ping ? 2 : undefined,
            isReachable: data.ping,
          },
        }),
    ...(data.walk === null
      ? {}
      : {
          snmpResponse: {
            isOnline: data.walk,
            responseTimeInMs: data.walk ? 12 : 0,
            failureCause: data.walk ? "" : walkCause,
            oidResponses: [],
            interfaces: [],
            transceivers: [],
          },
        }),
  } as unknown as DataToProcess;
}

const HEALTHY: DataToProcess = devicePoll({ ping: true, walk: true });
// The report: SNMP credentials broken, the switch answering ping.
const SNMP_FAILING: DataToProcess = devicePoll({ ping: true, walk: false });
const DOWN: DataToProcess = devicePoll({ ping: false, walk: false });
// Gear that drops ICMP from the probe but answers SNMP.
const ICMP_FILTERED: DataToProcess = devicePoll({ ping: false, walk: true });

let tables: MonitorRecordTables;
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

  /*
   * The status change as MonitorStatusTimelineUtil makes it: a matching
   * criteria moves the monitor only when it changes the monitor's status.
   * One that does not - an alert-only criteria - leaves the status as it
   * was, which is the whole of this report.
   */
  jest
    .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
    .mockImplementation((async (statusInput: {
      monitor: Monitor;
      criteriaInstance: MonitorCriteriaInstance;
    }): Promise<MonitorStatusTimeline | null> => {
      const criteria: MonitorCriteriaInstance["data"] =
        statusInput.criteriaInstance.data;

      if (
        criteria?.changeMonitorStatus &&
        criteria.monitorStatusId &&
        criteria.monitorStatusId.toString() !==
          statusInput.monitor.currentMonitorStatusId?.toString()
      ) {
        tables.statusSetBy.push(criteria.name || "");
        statusInput.monitor.currentMonitorStatusId = new ObjectID(
          criteria.monitorStatusId.toString(),
        );
      }

      return null;
    }) as never);
}

async function poll(dataToProcess: DataToProcess): Promise<void> {
  jest.setSystemTime(
    OneUptimeDate.addRemoveMinutes(OneUptimeDate.getCurrentDate(), 5),
  );

  await MonitorResourceUtil.monitorResource({
    ...dataToProcess,
    monitoredAt: OneUptimeDate.getCurrentDate(),
  } as DataToProcess);
}

function status(): "Online" | "Offline" | string {
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
  return tables.alerts.filter(isOpenAlert).map((alert: Alert) => {
    return alert.title || "";
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(START);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the recommended alert pack, on a switch whose SNMP fails while it answers ping (#11071)", () => {
  beforeEach(() => {
    // The template every device's monitor is cloned from, actions filled in.
    const template: MonitorTemplate =
      NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate({
        projectId: PROJECT_ID,
        incidentSeverityId: INCIDENT_SEVERITY_ID,
        alertSeverityId: ALERT_SEVERITY_ID,
        onlineMonitorStatusId: ONLINE_STATUS_ID,
        offlineMonitorStatusId: OFFLINE_STATUS_ID,
      });

    watch(template.monitorSteps!);
  });

  it("a switch whose SNMP credentials break is Online, with an alert that SNMP is failing", async () => {
    await poll(HEALTHY);
    await poll(SNMP_FAILING);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["SNMP walk failing"]);
  });

  /*
   * The pack's healthy state matches nothing: the monitor sits on its
   * default status. An alert-only criteria's alert stayed open there for
   * ever once its condition cleared - only a move back to the default
   * status from another one resolved anything - so fixing the credentials
   * of 3,000 switches left 3,000 "SNMP walk failing" alerts open.
   */
  it("SNMP fixed, the alert resolves on the next poll, and the switch stays Online", async () => {
    await poll(HEALTHY);
    await poll(SNMP_FAILING);
    await poll(SNMP_FAILING);

    expect(openAlerts()).toEqual(["SNMP walk failing"]);
    expect(tables.alerts).toHaveLength(1);

    await poll(HEALTHY);

    expect(openAlerts()).toEqual([]);
    expect(status()).toBe("Online");
    // It stayed on its default status: nothing moved it there again.
    expect(tables.statusSetBy).not.toContain(DEFAULT_STATUS);

    // SNMP breaks again: a new alert, the old one stays resolved.
    await poll(SNMP_FAILING);

    expect(openAlerts()).toEqual(["SNMP walk failing"]);
    expect(tables.alerts).toHaveLength(2);
  });

  /*
   * THE REPORT. Down for one poll, back with SNMP still failing: the
   * incident resolves and the switch is Online again - it stayed Offline
   * for as long as SNMP failed.
   */
  it("a switch back from one unreachable poll with SNMP still failing comes back Online", async () => {
    await poll(HEALTHY);
    await poll(DOWN);

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["Device unreachable"]);

    await poll(SNMP_FAILING);

    expect(openIncidents()).toEqual([]);
    expect(status()).toBe("Online");
    expect(openAlerts()).toEqual(["SNMP walk failing"]);

    // SNMP fixed: the alert resolves, the switch stays Online.
    await poll(HEALTHY);

    expect(openAlerts()).toEqual([]);
    expect(status()).toBe("Online");
  });

  it("a switch that answers nothing is down, and is not also told its SNMP is failing", async () => {
    await poll(HEALTHY);
    await poll(DOWN);

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["Device unreachable"]);
    expect(openAlerts()).toEqual([]);
  });

  it("gear that drops ICMP but answers SNMP stays Online, with nothing raised", async () => {
    await poll(HEALTHY);
    await poll(ICMP_FILTERED);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual([]);
    expect(tables.statusSetBy).not.toContain("Device unreachable");
  });

  it("a device that is only pinged is never told its SNMP is failing", async () => {
    await poll(devicePoll({ ping: true, walk: null }));

    expect(status()).toBe("Online");
    expect(openAlerts()).toEqual([]);

    await poll(devicePoll({ ping: false, walk: null }));

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["Device unreachable"]);
    expect(openAlerts()).toEqual([]);
  });
});

describe("a new Network Device monitor's default criteria (#11071)", () => {
  beforeEach(() => {
    watch(
      MonitorSteps.getDefaultMonitorSteps({
        defaultMonitorStatusId: ONLINE_STATUS_ID,
        monitorType: MonitorType.NetworkDevice,
        monitorName: SWITCH_NAME,
        onlineMonitorStatusId: ONLINE_STATUS_ID,
        offlineMonitorStatusId: OFFLINE_STATUS_ID,
        defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
        defaultAlertSeverityId: ALERT_SEVERITY_ID,
        warningAlertSeverityId: ALERT_SEVERITY_ID,
      }),
    );
  });

  it("an SNMP credential problem reads as SNMP failing: Online, with an alert and no incident", async () => {
    await poll(HEALTHY);
    expect(status()).toBe("Online");
    expect(openAlerts()).toEqual([]);

    await poll(SNMP_FAILING);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual([`SNMP is failing on ${SWITCH_NAME}`]);
    expect(tables.statusSetBy).not.toContain(
      `Check if ${SWITCH_NAME} is offline`,
    );

    await poll(HEALTHY);

    expect(openAlerts()).toEqual([]);
    expect(status()).toBe("Online");
  });

  it("a switch that answers neither ping nor SNMP is Offline, and comes back Online with SNMP still failing", async () => {
    await poll(HEALTHY);
    await poll(DOWN);

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual([`${SWITCH_NAME} is offline`]);

    await poll(SNMP_FAILING);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual([`SNMP is failing on ${SWITCH_NAME}`]);
  });

  it("gear that drops ICMP but answers SNMP is Online, with nothing raised", async () => {
    await poll(ICMP_FILTERED);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual([]);
  });

  it("a device that is only pinged is Online on an answer and Offline without one, never told SNMP is failing", async () => {
    await poll(devicePoll({ ping: true, walk: null }));

    expect(status()).toBe("Online");
    expect(openAlerts()).toEqual([]);

    await poll(devicePoll({ ping: false, walk: null }));

    expect(status()).toBe("Offline");
    expect(openAlerts()).not.toContain(`SNMP is failing on ${SWITCH_NAME}`);
  });

  /*
   * A probe that ran no ping - one from before ping-first polling - has
   * nothing for the ICMP check to read, so its SNMP failing reads as it
   * always did: the walk is the device's only answer.
   */
  it("a probe that ran no ping: a failed walk is the device down, as before", async () => {
    await poll(HEALTHY);
    await poll(devicePoll({ ping: null, walk: false }));

    expect(status()).toBe("Offline");
    expect(openAlerts()).not.toContain(`SNMP is failing on ${SWITCH_NAME}`);
  });

  it("every poll matches one of the three, so the monitor never falls to its default status", async () => {
    for (const dataToProcess of [
      HEALTHY,
      SNMP_FAILING,
      DOWN,
      ICMP_FILTERED,
      devicePoll({ ping: true, walk: null }),
      devicePoll({ ping: false, walk: null }),
    ]) {
      await poll(dataToProcess);
    }

    expect(tables.statusSetBy).not.toContain(DEFAULT_STATUS);
  });
});
