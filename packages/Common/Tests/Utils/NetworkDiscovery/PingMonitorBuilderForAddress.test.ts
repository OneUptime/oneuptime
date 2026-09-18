import { describe, expect, test } from "@jest/globals";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Hostname from "../../../Types/API/Hostname";
import IP from "../../../Types/IP/IP";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  buildPingMonitorDescription,
  buildPingMonitorForAddress,
  buildPingMonitorForDiscoveredHost,
  MonitorCriteriaSeedIds,
  PING_MONITOR_INTERVAL,
  PingMonitorOrigin,
} from "../../../Utils/NetworkDiscovery/PingMonitorBuilder";

/*
 * The Ping monitor every provisioning surface builds.
 *
 * Discovery import was the first place OneUptime created a Ping monitor for a
 * monitor-backed device (OneUptime/oneuptime#3447). The device create form,
 * the "Create Ping Monitor" button on a device's page and the device list's
 * bulk action now do the same thing, and they must produce the SAME monitor:
 * same type, same interval, same criteria, same incident suppression. An
 * operator who has learned what a provisioned monitor looks like from one
 * surface must not meet a different animal from another.
 *
 * `buildPingMonitorForAddress` is that shared shape. What is pinned here is
 * that it is address-driven (a device's hostname column, which is free text
 * and may be a name rather than an IP), that the discovery adapter delegates
 * to it rather than keeping a second copy, and that the only thing an origin
 * changes is the sentence explaining where the monitor came from.
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

function firstStep(monitor: Monitor): MonitorStep {
  const steps: Array<MonitorStep> =
    monitor.monitorSteps?.data?.monitorStepsInstanceArray || [];

  expect(steps).toHaveLength(1);

  return steps[0]!;
}

function build(data: {
  address?: string;
  deviceName?: string;
  origin?: PingMonitorOrigin;
}): Monitor {
  return buildPingMonitorForAddress({
    projectId: PROJECT_ID,
    address: data.address ?? "10.0.0.7",
    deviceName: data.deviceName ?? "lobby-ap-01",
    seedIds: SEED_IDS,
    origin: data.origin ?? PingMonitorOrigin.DeviceCreateForm,
  });
}

const EVERY_ORIGIN: Array<PingMonitorOrigin> = Object.values(
  PingMonitorOrigin,
) as Array<PingMonitorOrigin>;

describe("buildPingMonitorForAddress", () => {
  test("builds a Ping monitor in the device's project, named after the device", () => {
    const monitor: Monitor = build({});

    expect(monitor.monitorType).toBe(MonitorType.Ping);
    expect(monitor.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(monitor.name).toBe("Ping lobby-ap-01");
    expect(monitor.monitoringInterval).toBe(PING_MONITOR_INTERVAL);
  });

  test("points the step at the address as an IP when it is one", () => {
    const step: MonitorStep = firstStep(build({ address: "10.0.0.7" }));

    expect(step.data?.monitorDestination).toBeInstanceOf(IP);
    expect(step.data?.monitorDestination?.toString()).toBe("10.0.0.7");
  });

  /*
   * NetworkDevice.hostname is free text: an operator registering a device by
   * hand types whatever they call it, and "switch-01.example.com" is at least
   * as common as an address. Refusing a name would make the create form's
   * "create a Ping monitor" option silently do nothing for half the fleet.
   */
  test("points the step at the address as a hostname when it is not an IP", () => {
    const step: MonitorStep = firstStep(
      build({ address: "switch-01.example.com" }),
    );

    expect(step.data?.monitorDestination).toBeInstanceOf(Hostname);
    expect(step.data?.monitorDestination?.toString()).toBe(
      "switch-01.example.com",
    );
  });

  test("trims the address before deciding what it is", () => {
    const step: MonitorStep = firstStep(build({ address: "  10.0.0.7  " }));

    expect(step.data?.monitorDestination).toBeInstanceOf(IP);
  });

  test.each(["", "   "])(
    "refuses an empty address (%p) rather than building a destination-less monitor",
    (address: string) => {
      /*
       * MonitorStep.validate rejects a Ping step with no destination, so a
       * monitor built without one is refused at create time — after the
       * device has already been created, on the form path. Failing here, up
       * front, is what keeps that a clear error rather than a half-done one.
       */
      expect(() => {
        return build({ address: address });
      }).toThrow();
    },
  );

  test("seeds the criteria with the project's own statuses and severities", () => {
    const monitor: Monitor = build({});
    const step: MonitorStep = firstStep(monitor);

    expect(step.data?.monitorCriteria).toBeDefined();
    expect(monitor.monitorSteps?.data?.defaultMonitorStatusId?.toString()).toBe(
      SEED_IDS.onlineMonitorStatusId.toString(),
    );
  });

  /*
   * The two bulk-safety properties discovery import established. They hold
   * for every origin: a single device created by hand is still not a reason
   * to page somebody the first time a consumer access point misses a ping,
   * and the operator can turn incidents on from the monitor's own page.
   */
  test.each(EVERY_ORIGIN)(
    "does not open incidents but does move the status, for origin %s",
    (origin: PingMonitorOrigin) => {
      const step: MonitorStep = firstStep(build({ origin: origin }));
      const criteria: Array<MonitorCriteriaInstance> =
        step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

      expect(criteria.length).toBeGreaterThan(0);

      for (const criterion of criteria) {
        expect(criterion.data?.createIncidents).toBe(false);
        expect(criterion.data?.changeMonitorStatus).toBe(true);
      }
    },
  );

  test.each(EVERY_ORIGIN)(
    "builds the identical monitor for origin %s, apart from its description",
    (origin: PingMonitorOrigin) => {
      const reference: Monitor = build({
        origin: PingMonitorOrigin.DeviceCreateForm,
      });
      const monitor: Monitor = build({ origin: origin });

      expect(monitor.monitorType).toBe(reference.monitorType);
      expect(monitor.name).toBe(reference.name);
      expect(monitor.monitoringInterval).toBe(reference.monitoringInterval);
      expect(firstStep(monitor).data?.monitorDestination?.toString()).toBe(
        firstStep(reference).data?.monitorDestination?.toString(),
      );
      expect(
        monitor.monitorSteps?.data?.defaultMonitorStatusId?.toString(),
      ).toBe(reference.monitorSteps?.data?.defaultMonitorStatusId?.toString());
    },
  );

  test("every origin writes a distinct sentence that names the address", () => {
    const descriptions: Set<string> = new Set<string>();

    for (const origin of EVERY_ORIGIN) {
      const description: string = buildPingMonitorDescription({
        address: "10.0.0.7",
        origin: origin,
      });

      expect(description).toContain("10.0.0.7");
      descriptions.add(description);
    }

    // One sentence per origin — otherwise the origin carries no information.
    expect(descriptions.size).toBe(EVERY_ORIGIN.length);
  });

  test("the monitor carries its origin sentence", () => {
    const monitor: Monitor = build({
      address: "10.0.0.7",
      origin: PingMonitorOrigin.BulkAction,
    });

    expect(monitor.description).toBe(
      buildPingMonitorDescription({
        address: "10.0.0.7",
        origin: PingMonitorOrigin.BulkAction,
      }),
    );
  });

  test("two devices build two independent monitors", () => {
    const first: Monitor = build({ address: "10.0.0.1", deviceName: "one" });
    const second: Monitor = build({ address: "10.0.0.2", deviceName: "two" });

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
    expect(build({})._id).toBeUndefined();
  });
});

/*
 * The discovery adapter is the original entry point and Discovery.tsx still
 * calls it by name. It has to remain a thin wrapper, or the four surfaces
 * would drift apart again the first time one of them is edited.
 */
describe("buildPingMonitorForDiscoveredHost delegates to the shared builder", () => {
  test("produces the same monitor the address builder does for the discovery origin", () => {
    const viaHost: Monitor = buildPingMonitorForDiscoveredHost({
      projectId: PROJECT_ID,
      host: { ipAddress: "10.246.174.13" },
      deviceName: "un0661voipcp01",
      seedIds: SEED_IDS,
    });

    const viaAddress: Monitor = buildPingMonitorForAddress({
      projectId: PROJECT_ID,
      address: "10.246.174.13",
      deviceName: "un0661voipcp01",
      seedIds: SEED_IDS,
      origin: PingMonitorOrigin.DiscoveryImport,
    });

    expect(viaHost.name).toBe(viaAddress.name);
    expect(viaHost.description).toBe(viaAddress.description);
    expect(viaHost.monitorType).toBe(viaAddress.monitorType);
    expect(viaHost.monitoringInterval).toBe(viaAddress.monitoringInterval);
    expect(firstStep(viaHost).data?.monitorDestination?.toString()).toBe(
      firstStep(viaAddress).data?.monitorDestination?.toString(),
    );
  });

  test("keeps the discovery-scan wording, which existing imports already carry", () => {
    const monitor: Monitor = buildPingMonitorForDiscoveredHost({
      projectId: PROJECT_ID,
      host: { ipAddress: "10.246.174.13" },
      deviceName: "un0661voipcp01",
      seedIds: SEED_IDS,
    });

    expect(monitor.description).toContain("discovery scan");
  });
});
