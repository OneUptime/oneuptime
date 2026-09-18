import { describe, expect, test } from "@jest/globals";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Hostname from "../../../Types/API/Hostname";
import IP from "../../../Types/IP/IP";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  buildPingMonitorDestination,
  buildPingMonitorForDiscoveredHost,
  buildPingMonitorName,
  MAX_PING_MONITOR_NAME_LENGTH,
  MonitorCriteriaSeedIds,
  PING_MONITOR_INTERVAL,
} from "../../../Utils/NetworkDiscovery/PingMonitorBuilder";

/*
 * The monitor a ping-only discovered host imports with.
 *
 * A host that answered ICMP but not SNMP becomes a monitor-backed device with
 * no probe and no credentials — correct, but with nothing reporting its health
 * it sits on "Pending" forever (OneUptime/oneuptime#3447). This builder is the
 * other half: the Ping monitor that answers, on a schedule, the same question
 * the discovery sweep already answered once.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-0000-4000-8000-000000000001",
);

const SEED_IDS: MonitorCriteriaSeedIds = {
  onlineMonitorStatusId: new ObjectID("22222222-0000-4000-8000-000000000001"),
  offlineMonitorStatusId: new ObjectID("22222222-0000-4000-8000-000000000002"),
  defaultIncidentSeverityId: new ObjectID(
    "33333333-0000-4000-8000-000000000001",
  ),
  defaultAlertSeverityId: new ObjectID("44444444-0000-4000-8000-000000000001"),
};

function pingOnlyHost(ipAddress: string): DiscoveredNetworkDevice {
  return {
    ipAddress: ipAddress,
    snmpReachable: false,
  };
}

function firstStep(monitor: Monitor): MonitorStep {
  const steps: Array<MonitorStep> =
    monitor.monitorSteps?.data?.monitorStepsInstanceArray || [];

  expect(steps).toHaveLength(1);

  return steps[0]!;
}

function build(data: { ipAddress?: string; deviceName?: string }): Monitor {
  return buildPingMonitorForDiscoveredHost({
    projectId: PROJECT_ID,
    host: pingOnlyHost(data.ipAddress ?? "10.246.174.13"),
    deviceName: data.deviceName ?? "un0661voipcp01",
    seedIds: SEED_IDS,
  });
}

describe("buildPingMonitorName", () => {
  test("names the monitor after the device", () => {
    expect(buildPingMonitorName("core-switch-01")).toBe("Ping core-switch-01");
  });

  test("trims the device name before composing", () => {
    expect(buildPingMonitorName("  edge-ap-02  ")).toBe("Ping edge-ap-02");
  });

  test("clamps to the slug-safe ceiling, not the name column", () => {
    const name: string = buildPingMonitorName("d".repeat(400));

    expect(name.length).toBe(MAX_PING_MONITOR_NAME_LENGTH);
    expect(name.startsWith("Ping ")).toBe(true);
  });

  test("the ceiling leaves room for the slug suffix the create path appends", () => {
    /*
     * Monitor is @SlugifyColumn("name", "slug") and Slug.getSlug appends a
     * dash plus ten random digits into a varchar(100), throwing rather than
     * truncating on overflow. A 100-character name would therefore fail the
     * create even though the name column accepts it.
     */
    expect(
      MAX_PING_MONITOR_NAME_LENGTH + "-1234567890".length,
    ).toBeLessThanOrEqual(100);
  });

  test("a device name at the builder's own ceiling still composes within the column", () => {
    /*
     * DiscoveredDeviceBuilder clamps device names to 80 characters, so this
     * is the widest name that can actually reach here through the import path.
     */
    const name: string = buildPingMonitorName("d".repeat(80));

    expect(name.length).toBeLessThanOrEqual(MAX_PING_MONITOR_NAME_LENGTH);
    expect(name).toBe(`Ping ${"d".repeat(80)}`);
  });
});

describe("buildPingMonitorDestination", () => {
  test("an IPv4 address becomes an IP", () => {
    const destination: IP | Hostname =
      buildPingMonitorDestination("10.246.174.13");

    expect(destination).toBeInstanceOf(IP);
    expect(destination.toString()).toBe("10.246.174.13");
  });

  test("an IPv6 address becomes an IP", () => {
    const destination: IP | Hostname = buildPingMonitorDestination("::1");

    expect(destination).toBeInstanceOf(IP);
  });

  test("surrounding whitespace does not stop it being recognised as an IP", () => {
    expect(buildPingMonitorDestination("  10.0.0.7  ")).toBeInstanceOf(IP);
  });

  test("anything that is not an IP is carried as a hostname rather than rejected", () => {
    /*
     * The scanner only ever produces addresses, but the column is free text
     * and a hand-written scan row could hold a name. Refusing it would fail
     * the import; MonitorStep accepts either type.
     */
    const destination: IP | Hostname = buildPingMonitorDestination(
      "switch-01.example.com",
    );

    expect(destination).toBeInstanceOf(Hostname);
  });
});

describe("buildPingMonitorForDiscoveredHost", () => {
  test("builds a Ping monitor in the device's project", () => {
    const monitor: Monitor = build({});

    expect(monitor.monitorType).toBe(MonitorType.Ping);
    expect(monitor.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(monitor.name).toBe("Ping un0661voipcp01");
  });

  test("re-wraps the project id rather than sharing the caller's instance", () => {
    const monitor: Monitor = build({});

    expect(monitor.projectId).not.toBe(PROJECT_ID);
    expect(monitor.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("points the step at the host's address", () => {
    const step: MonitorStep = firstStep(build({ ipAddress: "10.246.174.13" }));

    expect(step.data?.monitorDestination?.toString()).toBe("10.246.174.13");
  });

  test("the step carries a destination, which is what makes it valid for Ping", () => {
    /*
     * MonitorStep.validate rejects a Ping step with no destination
     * ("Monitor Destination is required"), so a monitor built without one
     * would be refused at create time and the device would import unbound —
     * straight back into the Pending dead end.
     */
    const step: MonitorStep = firstStep(build({}));

    expect(step.data?.monitorDestination).toBeDefined();
  });

  test("seeds the criteria with the project's own statuses and severities", () => {
    const monitor: Monitor = build({});
    const step: MonitorStep = firstStep(monitor);

    // The criteria exist and were seeded, rather than left undefined.
    expect(step.data?.monitorCriteria).toBeDefined();

    expect(monitor.monitorSteps?.data?.defaultMonitorStatusId?.toString()).toBe(
      SEED_IDS.onlineMonitorStatusId.toString(),
    );
  });

  test("builds exactly one step", () => {
    expect(
      build({}).monitorSteps?.data?.monitorStepsInstanceArray,
    ).toHaveLength(1);
  });

  test("describes where the monitor came from", () => {
    const monitor: Monitor = build({ ipAddress: "10.246.174.13" });

    expect(monitor.description).toContain("10.246.174.13");
    expect(monitor.description).toContain("discovery scan");
  });

  test("a host with no address is refused rather than building a destination-less monitor", () => {
    expect(() => {
      return buildPingMonitorForDiscoveredHost({
        projectId: PROJECT_ID,
        host: { ipAddress: "" },
        deviceName: "nameless",
        seedIds: SEED_IDS,
      });
    }).toThrow();
  });

  test("a whitespace-only address is refused too", () => {
    expect(() => {
      return buildPingMonitorForDiscoveredHost({
        projectId: PROJECT_ID,
        host: { ipAddress: "   " },
        deviceName: "nameless",
        seedIds: SEED_IDS,
      });
    }).toThrow();
  });

  test("two hosts build two independent monitors", () => {
    /*
     * A bulk import runs this once per host. Sharing any nested object
     * between them would make one device's edit rewrite another's monitor.
     */
    const first: Monitor = build({
      ipAddress: "10.0.0.1",
      deviceName: "one",
    });
    const second: Monitor = build({
      ipAddress: "10.0.0.2",
      deviceName: "two",
    });

    expect(first.monitorSteps).not.toBe(second.monitorSteps);
    expect(firstStep(first)).not.toBe(firstStep(second));
    expect(firstStep(first).data?.monitorDestination?.toString()).toBe(
      "10.0.0.1",
    );
    expect(firstStep(second).data?.monitorDestination?.toString()).toBe(
      "10.0.0.2",
    );
  });

  test("does not persist anything or assume an id", () => {
    /*
     * The builder is pure: the caller creates the monitor through the API so
     * billing, probe attachment and the status timeline hooks still run.
     */
    expect(build({})._id).toBeUndefined();
  });
});

/*
 * Two properties that exist because this runs as a BULK action.
 *
 * An operator ticking "Import Selected (14)" is recording inventory, not
 * deliberately standing up fourteen alerting monitors. Both defaults below are
 * right for a hand-made monitor and wrong for this one.
 */
describe("buildPingMonitorForDiscoveredHost - safe defaults for a bulk import", () => {
  function criteriaOf(monitor: Monitor): Array<MonitorCriteriaInstance> {
    return (
      firstStep(monitor).data?.monitorCriteria?.data
        ?.monitorCriteriaInstanceArray || []
    );
  }

  test("does not open incidents", () => {
    /*
     * The stock Ping offline criteria sets createIncidents: true. Fourteen of
     * those pointed at consumer gear means fourteen incidents, on-call
     * notifications and status-page impact the first time one misses a ping.
     */
    const criteria: Array<MonitorCriteriaInstance> = criteriaOf(build({}));

    expect(criteria.length).toBeGreaterThan(0);

    for (const criteriaInstance of criteria) {
      expect(criteriaInstance.data?.createIncidents).toBe(false);
    }
  });

  test("still changes the monitor's status, which is what the device pill reads", () => {
    /*
     * Suppressing incidents must not suppress the status change: the whole
     * point of the monitor is to move the device off "Pending".
     */
    const criteria: Array<MonitorCriteriaInstance> = criteriaOf(build({}));

    const changesStatus: boolean = criteria.some(
      (criteriaInstance: MonitorCriteriaInstance) => {
        return criteriaInstance.data?.changeMonitorStatus === true;
      },
    );

    expect(changesStatus).toBe(true);
  });
});

describe("buildPingMonitorForDiscoveredHost - the polling cadence is chosen, not defaulted", () => {
  test("sets an explicit monitoring interval", () => {
    /*
     * A NULL monitoringInterval is not "use a sensible default":
     * MonitorProbeService falls back to now + 1 MINUTE when the column is
     * null. Importing a subnet's worth of IP phones would otherwise ping
     * every one of them every sixty seconds forever, because nobody chose
     * that.
     */
    expect(build({}).monitoringInterval).toBe(PING_MONITOR_INTERVAL);
  });

  test("the interval is a cron expression the interval dropdown offers", () => {
    // So the operator can change it from the same control as any other monitor.
    expect(PING_MONITOR_INTERVAL).toBe("*/5 * * * *");
  });
});
