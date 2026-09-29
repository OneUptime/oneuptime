import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkInventoryUtil from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import NetworkInterfaceService from "../../../../Server/Services/NetworkInterfaceService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "../../../../Models/DatabaseModels/NetworkInterface";
import DeviceReachabilityUtil, {
  NetworkDeviceReachability,
} from "../../../../Utils/NetworkDevice/DeviceReachabilityUtil";
import SiteStatusRollupUtil, {
  RollupStatusOption,
} from "../../../../Utils/NetworkSite/SiteStatusRollupUtil";
import NetworkTopologyUtil, {
  TopologyBuildResult,
} from "../../../../Utils/Monitor/NetworkTopologyUtil";
import { NetworkTopologyNode } from "../../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";

/*
 * Issue #3220, end to end.
 *
 * "Network Device shown as Down (unreachable) despite device responding to
 * ping and interfaces showing Up." A router that answered SNMP fine — its
 * own Interfaces tab listed 14 ports up, written by that very walk — was
 * listed as Down, with "last seen 21 minutes ago" underneath. 323 of 980
 * devices in that project were in the same state, and the topology graph
 * and network map drew all of them red.
 *
 * The two halves of the cause:
 *
 *   1. a probe is handed a bounded batch of devices per one-minute fetch,
 *      so a fleet of ~1000 devices took ~20 minutes to poll all the way
 *      round however short the configured interval was; and
 *   2. every reader decided up/down from `lastSeenAt` being newer than a
 *      fixed 15 minutes, which a 20-minute cycle can never satisfy.
 *
 * The unit suites cover each layer on its own. What this file does is join
 * them: it drives the REAL write path with a walk exactly like the reported
 * one, and then asks every reader — the device pill, the site rollup and
 * the topology graph — what it makes of the row that was actually written.
 * A regression in either the writer or any single reader shows up here.
 */

const PROJECT_ID: string = "1c9d4a7b-0000-4000-8000-000000000011";
const DEVICE_ID: string = "8f2c1f0e-0000-4000-8000-0000000000aa";

// The moment the probe finally got round to UN1234WANRTR01.
const WALKED_AT: Date = new Date("2026-08-17T18:12:00.000Z");
// The moment the operator was looking at the screen: 21 minutes later.
const OBSERVED_AT: Date = new Date("2026-08-17T18:33:00.000Z");

const OPERATIONAL: RollupStatusOption = {
  monitorStatusId: "status-operational",
  priority: 1,
};
const OFFLINE: RollupStatusOption = {
  monitorStatusId: "status-offline",
  priority: 3,
};

let deviceUpdateSpy: jest.SpyInstance;

function mockServices(): void {
  const ownedDevice: NetworkDevice = new NetworkDevice();
  ownedDevice.id = new ObjectID(DEVICE_ID);

  jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockResolvedValue(ownedDevice as never);
  deviceUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateOneById")
    .mockResolvedValue(1 as never);
  jest.spyOn(NetworkInterfaceService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(NetworkInterfaceService, "updateOneById")
    .mockResolvedValue(1 as never);
  jest
    .spyOn(NetworkInterfaceService, "create")
    .mockResolvedValue(new NetworkInterface() as never);
  jest
    .spyOn(NetworkEndpointService, "upsertDiscoveredEndpoints")
    .mockResolvedValue(undefined as never);
}

// 14 ports up and 12 down — the mix the reported device's Interfaces tab showed.
function reportedInterfaces(): Array<SnmpInterface> {
  const interfaces: Array<SnmpInterface> = [];

  for (let index: number = 1; index <= 26; index++) {
    interfaces.push({
      interfaceIndex: index,
      name: `Gi0/${index}`,
      isAdministrativelyUp: true,
      isOperationallyUp: index <= 14,
    } as SnmpInterface);
  }

  return interfaces;
}

/*
 * Runs the real writer and returns the device row as it would then be read
 * back — the columns the update wrote, nothing invented.
 */
async function walkAndReadBackDevice(data: {
  isOnline: boolean;
  interfaces: Array<SnmpInterface>;
}): Promise<Record<string, unknown>> {
  const snmpResponse: SnmpMonitorResponse = {
    isOnline: data.isOnline,
    responseTimeInMs: 274,
    failureCause: "",
    oidResponses: [],
    interfaces: data.interfaces,
    systemInfo: { sysName: "UN1234WANRTR01" },
  } as SnmpMonitorResponse;

  await NetworkInventoryUtil.updateFromWalk({
    projectId: new ObjectID(PROJECT_ID),
    deviceId: new ObjectID(DEVICE_ID),
    snmpResponse: snmpResponse,
    isOnline: data.isOnline,
  });

  expect(deviceUpdateSpy).toHaveBeenCalled();

  return {
    // The device's configured schedule, unchanged by the walk.
    pollingIntervalInMinutes: 5,
    ...(deviceUpdateSpy.mock.calls[0]![0].data as Record<string, unknown>),
  };
}

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      "performance",
      "hrtime",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  // The walk lands at 18:12; every reader below looks at 18:33.
  jest.setSystemTime(WALKED_AT);
  mockServices();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("issue #3220 — a device that answered 21 minutes ago", () => {
  test("the walk records that it answered, and when it was asked", async () => {
    const row: Record<string, unknown> = await walkAndReadBackDevice({
      isOnline: true,
      interfaces: reportedInterfaces(),
    });

    expect(row["isReachable"]).toBe(true);
    expect(row["lastPolledAt"]).toEqual(WALKED_AT);
    expect(row["lastSeenAt"]).toEqual(WALKED_AT);
  });

  test("the same walk is what put 14 up / 12 down on the Interfaces tab", async () => {
    const row: Record<string, unknown> = await walkAndReadBackDevice({
      isOnline: true,
      interfaces: reportedInterfaces(),
    });

    /*
     * The contradiction the report was really about: these counts and the
     * reachability verdict come out of ONE walk, so they cannot honestly
     * disagree.
     */
    expect(row["interfacesUp"]).toBe(14);
    expect(row["interfacesDown"]).toBe(12);
    expect(row["isReachable"]).toBe(true);
  });

  test("the device pill reads Up, 21 minutes later", async () => {
    const row: Record<string, unknown> = await walkAndReadBackDevice({
      isOnline: true,
      interfaces: reportedInterfaces(),
    });

    expect(DeviceReachabilityUtil.getStatus(row, OBSERVED_AT)).toBe(
      NetworkDeviceReachability.Up,
    );
  });

  test("the site rollup above it stays operational", async () => {
    const row: Record<string, unknown> = await walkAndReadBackDevice({
      isOnline: true,
      interfaces: reportedInterfaces(),
    });

    expect(
      SiteStatusRollupUtil.worstStatus({
        deviceStates: [row],
        operationalStatus: OPERATIONAL,
        offlineStatus: OFFLINE,
        now: OBSERVED_AT,
      }),
    ).toBe(OPERATIONAL.monitorStatusId);
  });

  test("the topology graph draws it up, not red", async () => {
    const row: Record<string, unknown> = await walkAndReadBackDevice({
      isOnline: true,
      interfaces: reportedInterfaces(),
    });

    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        {
          id: DEVICE_ID,
          name: "UN1234WANRTR01",
          hostname: "10.15.128.165",
          isReachable: row["isReachable"] as boolean,
          lastPolledAt: row["lastPolledAt"] as Date,
          lastSeenAt: row["lastSeenAt"] as Date,
          pollingIntervalInMinutes: 5,
        },
      ],
      OBSERVED_AT,
    );

    const node: NetworkTopologyNode | undefined = result.nodes.find(
      (candidate: NetworkTopologyNode) => {
        return candidate.id === DEVICE_ID;
      },
    );

    expect(node?.status).toBe("up");
  });
});

/*
 * The fix must not have bought its way out of false positives with false
 * negatives. A device that genuinely stops answering has to go down — and
 * go down on the very next poll, not after a timeout.
 */
describe("a device that genuinely stops answering still goes down", () => {
  test("the failing walk records the failure and leaves lastSeenAt behind", async () => {
    const row: Record<string, unknown> = await walkAndReadBackDevice({
      isOnline: false,
      interfaces: [],
    });

    expect(row["isReachable"]).toBe(false);
    expect(row["lastPolledAt"]).toEqual(WALKED_AT);
    expect(row).not.toHaveProperty("lastSeenAt");
  });

  test("every reader calls it down, immediately", async () => {
    const written: Record<string, unknown> = await walkAndReadBackDevice({
      isOnline: false,
      interfaces: [],
    });

    // The row as it now stands: last answered before the failing poll.
    const row: Record<string, unknown> = {
      ...written,
      lastSeenAt: OneUptimeDate.addRemoveMinutes(WALKED_AT, -5),
    };

    // One second after the failed walk — no waiting for a window to expire.
    const justAfter: Date = new Date(WALKED_AT.getTime() + 1000);

    expect(DeviceReachabilityUtil.getStatus(row, justAfter)).toBe(
      NetworkDeviceReachability.Down,
    );

    expect(
      SiteStatusRollupUtil.worstStatus({
        deviceStates: [row],
        operationalStatus: OPERATIONAL,
        offlineStatus: OFFLINE,
        now: justAfter,
      }),
    ).toBe(OFFLINE.monitorStatusId);

    const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
      [
        {
          id: DEVICE_ID,
          name: "UN1234WANRTR01",
          isReachable: row["isReachable"] as boolean,
          lastPolledAt: row["lastPolledAt"] as Date,
          lastSeenAt: row["lastSeenAt"] as Date,
          pollingIntervalInMinutes: 5,
        },
      ],
      justAfter,
    );

    expect(
      result.nodes.find((candidate: NetworkTopologyNode) => {
        return candidate.id === DEVICE_ID;
      })?.status,
    ).toBe("down");
  });
});

/*
 * And the polling pipeline going silent. The fleet keeps its last known
 * verdicts — manufacturing an outage nobody observed is the failure this
 * change removes — but every device is flagged stale, which is what sends
 * the operator to the probe instead of to 300 devices.
 */
describe("a fleet whose probe has gone silent is flagged, not condemned", () => {
  test("a good verdict nobody has refreshed for hours stays Up and reads stale", async () => {
    const row: Record<string, unknown> = await walkAndReadBackDevice({
      isOnline: true,
      interfaces: reportedInterfaces(),
    });

    const hoursLater: Date = new Date(WALKED_AT.getTime() + 4 * 60 * 60 * 1000);

    const reachability: {
      status: NetworkDeviceReachability;
      isStale: boolean;
    } = DeviceReachabilityUtil.getReachability(row, hoursLater);

    expect(reachability.status).toBe(NetworkDeviceReachability.Up);
    /*
     * isStale is what puts the amber "Stale" pill next to the verdict and
     * points the tooltip at the probe — a different investigation from
     * "this device is down", and the reason it is not expressed as Down.
     */
    expect(reachability.isStale).toBe(true);
  });

  /*
   * The property that keeps the device list self-consistent: the summary
   * tiles and the Status chip are SQL over `isReachable`, so whatever the
   * clock says, the pill has to be reproducible from that column alone.
   */
  test("the verdict stays reproducible from the stored column alone", async () => {
    const row: Record<string, unknown> = await walkAndReadBackDevice({
      isOnline: true,
      interfaces: reportedInterfaces(),
    });

    for (const hoursLater of [0, 1, 4, 24, 24 * 30]) {
      const at: Date = new Date(WALKED_AT.getTime() + hoursLater * 3600 * 1000);

      expect(DeviceReachabilityUtil.getStatus(row, at)).toBe(
        row["isReachable"] === true
          ? NetworkDeviceReachability.Up
          : NetworkDeviceReachability.Down,
      );
    }
  });
});
