import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkDeviceWalkUtil from "../../../../Server/Utils/Monitor/NetworkDeviceWalkUtil";
import NetworkDeviceMetricUtil from "../../../../Server/Utils/Monitor/NetworkDeviceMetricUtil";
import NetworkInventoryUtil from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import SnmpInterfaceRateUtil from "../../../../Server/Utils/Monitor/SnmpInterfaceRateUtil";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import NetworkInterfaceService from "../../../../Server/Services/NetworkInterfaceService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "../../../../Models/DatabaseModels/NetworkInterface";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";

/*
 * Which write path each half of a device walk takes.
 *
 * `lastWalkLog` is a ~28 KB jsonb delta baseline rewritten on every poll and
 * stored out of line. The ordinary update pipeline SELECTs the row before
 * writing it, which detoasts the PREVIOUS log a second time — the walk util
 * already read it — on the hottest table in the product. It now goes through
 * `updateColumnsByIdWithoutHooks`: one statement, no pre-read, no hooks.
 *
 * That is only safe because of what the payload does NOT contain. The
 * NetworkDevice update hooks re-run site-assignment rules on the identity
 * columns and re-stamp monitor status on the monitor binding; a column that
 * moves onto the hook-free path stops firing them SILENTLY. So these tests
 * pin both halves: the baseline write is hook-free and carries exactly one
 * column, and the walk's device enrichment — the write that actually carries
 * sysName — still goes through the hooked path.
 */

const DEVICE_ID: string = "8f2c1f0e-0000-4000-8000-0000000000aa";
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const NOW: Date = new Date("2026-07-16T12:00:00.000Z");
const MONITORED_AT: Date = new Date("2026-07-16T11:59:58.000Z");

/*
 * Every column a NetworkDeviceService update hook reacts to. onBeforeUpdate /
 * onUpdateSuccess branch on the identity columns (site-assignment rules), on
 * either spelling of the site, and on the monitor binding + monitoring method
 * (the stamped monitor status). None of them may ever appear in a hook-free
 * payload.
 */
const HOOK_WATCHED_COLUMNS: Array<string> = [
  "hostname",
  "name",
  "sysName",
  "siteId",
  "site",
  "monitorId",
  "monitor",
  "monitoringMethod",
];

const PREVIOUS_WALK_LOG: JSONObject = {
  snmpResponse: {
    interfaces: [{ interfaceIndex: 1, inOctets: 1000, outOctets: 2000 }],
  },
  monitoredAt: "2026-07-16T11:55:00.000Z",
};

let hookFreeUpdateSpy: jest.SpyInstance;
let hookedUpdateSpy: jest.SpyInstance;
let rateSpy: jest.SpyInstance;
let deviceFindSpy: jest.SpyInstance;

function buildSnmpResponse(
  overrides?: Partial<SnmpMonitorResponse>,
): SnmpMonitorResponse {
  return {
    isOnline: true,
    responseTimeInMs: 42,
    failureCause: "",
    oidResponses: [],
    isTimeout: false,
    interfaces: [
      {
        interfaceIndex: 1,
        name: "GigabitEthernet0/1",
        isOperationallyUp: true,
        isAdministrativelyUp: true,
        inOctets: 5000,
        outOctets: 7000,
      },
    ],
    ...overrides,
  };
}

// The walk pipeline with every collaborator but the device writes mocked.
function mockWalkPipeline(): void {
  const device: NetworkDevice = new NetworkDevice();
  device.id = new ObjectID(DEVICE_ID);
  device.projectId = PROJECT_ID;
  device.name = "core-sw-01";
  device.lastWalkLog = PREVIOUS_WALK_LOG;

  deviceFindSpy = jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockResolvedValue(device);
  hookFreeUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined);
  hookedUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateOneById")
    .mockResolvedValue(1);
  jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(NetworkInventoryUtil, "updateFromWalk")
    .mockResolvedValue(undefined);
  jest
    .spyOn(NetworkDeviceMetricUtil, "saveWalkMetrics")
    .mockResolvedValue(undefined);
  rateSpy = jest
    .spyOn(SnmpInterfaceRateUtil, "attachInterfaceRates")
    .mockImplementation(() => {
      return undefined;
    });
}

async function runWalk(snmpResponse: SnmpMonitorResponse): Promise<void> {
  await NetworkDeviceWalkUtil.processWalkResult({
    probeId: PROBE_ID,
    networkDeviceId: new ObjectID(DEVICE_ID),
    snmpResponse: snmpResponse,
    monitoredAt: MONITORED_AT,
  });
}

function hookFreeCallArgs(): JSONObject {
  expect(hookFreeUpdateSpy).toHaveBeenCalledTimes(1);
  return hookFreeUpdateSpy.mock.calls[0][0] as JSONObject;
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkDeviceWalkUtil — the lastWalkLog baseline write", () => {
  /*
   * The point of the change: no pre-update SELECT. If this write goes back
   * through updateOneById / updateBy, every poll re-reads and re-TOASTs the
   * previous 25 KB log that the walk already has in memory.
   */
  test("goes through the hook-free single-statement path, never the hooked one", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse());

    expect(hookFreeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(hookedUpdateSpy).not.toHaveBeenCalled();
  });

  test("targets the walked device by id", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse());

    expect((hookFreeCallArgs()["id"] as ObjectID).toString()).toBe(DEVICE_ID);
  });

  /*
   * A plain-JSON snapshot, not the live response object: the rest of the
   * pipeline mutates data.snmpResponse (inventory prunes it down to monitored
   * ports), and a baseline that shrank with it would compute rates for the
   * pruned ports against nothing on the next poll.
   */
  test("persists a deep JSON snapshot of the walk, stamped with the server receipt time", async () => {
    mockWalkPipeline();
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse();

    await runWalk(snmpResponse);

    const walkLog: JSONObject = (hookFreeCallArgs()["data"] as JSONObject)[
      "lastWalkLog"
    ] as JSONObject;

    expect(walkLog["snmpResponse"]).toEqual(
      JSON.parse(JSON.stringify(snmpResponse)),
    );
    expect(walkLog["snmpResponse"]).not.toBe(snmpResponse);
    expect(walkLog["monitoredAt"]).toEqual(NOW);
  });

  /*
   * The guard rail for everything above. Moving a column into this payload
   * silently stops the hooks that own it: site-assignment rules
   * (hostname/name/sysName), the old+new site rollups (siteId/site) and the
   * stamped monitor status (monitorId/monitoringMethod) all hang off the
   * hooked update. Anything new belongs in NetworkInventoryUtil's enrichment
   * write, not here.
   */
  test("carries lastWalkLog and nothing else", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse());

    const payload: JSONObject = hookFreeCallArgs()["data"] as JSONObject;
    expect(Object.keys(payload)).toEqual(["lastWalkLog"]);
  });

  test("carries no column any device update hook watches", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse());

    const payloadKeys: Array<string> = Object.keys(
      hookFreeCallArgs()["data"] as JSONObject,
    );

    for (const watched of HOOK_WATCHED_COLUMNS) {
      expect(payloadKeys).not.toContain(watched);
    }
  });

  /*
   * The hooked path finds rows with `withDeleted: false`, so it could never
   * write to a device deleted while its walk was in flight. The raw path
   * matches on _id alone, so the guard has to be explicit or a delete would
   * be followed by 25 KB landing back on the deleted row.
   */
  test("refuses to write to a device that was deleted mid-walk", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse());

    const expectedData: JSONObject = hookFreeCallArgs()[
      "expectedData"
    ] as JSONObject;
    expect(expectedData).toBeDefined();
    expect(Object.keys(expectedData)).toEqual(["deletedAt"]);
    expect(expectedData["deletedAt"]).toBeNull();
  });

  /*
   * Preserved behaviour: keeping the last GOOD counters across failed polls
   * lets rates resume with a correct (longer-window) delta. Overwriting the
   * baseline with an empty walk would zero every rate for a cycle.
   */
  test("a poll that walked no interfaces writes nothing at all", async () => {
    mockWalkPipeline();

    await runWalk(
      buildSnmpResponse({
        isOnline: false,
        isTimeout: true,
        failureCause: "Device did not respond",
        interfaces: undefined,
      }),
    );

    expect(hookFreeUpdateSpy).not.toHaveBeenCalled();
    expect(hookedUpdateSpy).not.toHaveBeenCalled();
  });

  test("an empty interface array is treated the same as no interfaces", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse({ interfaces: [] }));

    expect(hookFreeUpdateSpy).not.toHaveBeenCalled();
  });

  /*
   * Preserved ordering. Persisting first would make the delta baseline the
   * walk itself and every rate would compute to zero.
   */
  test("rates are computed against the stored log before the baseline is overwritten", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse());

    expect(rateSpy.mock.calls[0][0].previousWalkLog).toBe(PREVIOUS_WALK_LOG);
    expect(rateSpy.mock.invocationCallOrder[0]).toBeLessThan(
      hookFreeUpdateSpy.mock.invocationCallOrder[0] as number,
    );
  });

  /*
   * The one read of lastWalkLog that has to stay: the walk util needs the
   * previous counters to compute a delta. Dropping it from the select would
   * silently zero every interface rate in the product.
   */
  test("the device lookup still selects lastWalkLog for the delta", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse());

    const select: JSONObject = deviceFindSpy.mock.calls[0][0]
      .select as JSONObject;
    expect(select["lastWalkLog"]).toBe(true);
  });
});

/*
 * The other half of the split. NetworkInventoryUtil's device enrichment write
 * carries sysName — an identity column — plus lastSeenAt / isReachable, and it
 * MUST keep going through updateOneById: that is the write whose hooks
 * re-evaluate site-assignment rules for a device that has no site, and it is
 * how a discovery-imported device (imported with only an IP) ever gets placed.
 */
describe("NetworkInventoryUtil — the device enrichment write", () => {
  function mockInventoryServices(): {
    hookedUpdate: jest.SpyInstance;
    hookFreeUpdate: jest.SpyInstance;
  } {
    const ownedDevice: NetworkDevice = new NetworkDevice();
    ownedDevice.id = new ObjectID(DEVICE_ID);

    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(ownedDevice);
    jest.spyOn(NetworkInterfaceService, "findBy").mockResolvedValue([]);
    jest.spyOn(NetworkInterfaceService, "updateOneById").mockResolvedValue(1);
    jest
      .spyOn(NetworkInterfaceService, "create")
      .mockResolvedValue(new NetworkInterface());
    jest
      .spyOn(NetworkEndpointService, "upsertDiscoveredEndpoints")
      .mockResolvedValue(undefined as never);

    return {
      hookedUpdate: jest
        .spyOn(NetworkDeviceService, "updateOneById")
        .mockResolvedValue(1),
      hookFreeUpdate: jest
        .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined),
    };
  }

  test("sysName is still written through the hooked path, so site-assignment rules re-run", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
    } = mockInventoryServices();

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: {
        isOnline: true,
        responseTimeInMs: 12,
        failureCause: "",
        oidResponses: [],
        systemInfo: {
          sysName: "UN0664LANSWI03",
        },
      } as unknown as SnmpMonitorResponse,
      isOnline: true,
    });

    expect(spies.hookedUpdate).toHaveBeenCalledTimes(1);
    const payload: JSONObject = spies.hookedUpdate.mock.calls[0][0][
      "data"
    ] as JSONObject;
    expect(payload["sysName"]).toBe("UN0664LANSWI03");

    // The enrichment write must not have followed lastWalkLog off the hooks.
    expect(spies.hookFreeUpdate).not.toHaveBeenCalled();
  });

  /*
   * The enrichment write is also the one that stamps reachability, which the
   * device list, the topology graph and the site rollup all read. It stays on
   * the hooked path with sysName rather than being split off for speed.
   */
  test("reachability and liveness ride along on that same hooked write", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
    } = mockInventoryServices();

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: {
        isOnline: true,
        responseTimeInMs: 12,
        failureCause: "",
        oidResponses: [],
      } as unknown as SnmpMonitorResponse,
      isOnline: true,
    });

    const payload: JSONObject = spies.hookedUpdate.mock.calls[0][0][
      "data"
    ] as JSONObject;
    expect(payload["isReachable"]).toBe(true);
    expect(payload["lastPolledAt"]).toBeDefined();
    expect(payload["lastSeenAt"]).toBeDefined();
    expect(spies.hookFreeUpdate).not.toHaveBeenCalled();
  });
});
