import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkDeviceWalkUtil from "../../../../Server/Utils/Monitor/NetworkDeviceWalkUtil";
import NetworkDeviceMetricUtil from "../../../../Server/Utils/Monitor/NetworkDeviceMetricUtil";
import NetworkInventoryUtil from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import SnmpInterfaceRateUtil from "../../../../Server/Utils/Monitor/SnmpInterfaceRateUtil";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorNetworkDeviceService from "../../../../Server/Services/MonitorNetworkDeviceService";
import NetworkDeviceService, {
  NETWORK_DEVICE_POLL_DETAIL_COLUMNS,
} from "../../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import NetworkInterfaceService from "../../../../Server/Services/NetworkInterfaceService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "../../../../Models/DatabaseModels/NetworkInterface";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpDataType from "../../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import { SnmpTableSnapshot } from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import { NetworkDeviceTransceiver } from "../../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import NetworkDeviceMonitoringMethod from "../../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import logger from "../../../../Server/Utils/Logger";

/*
 * Which write path each half of a device walk takes.
 *
 * `lastWalkLog` is a ~28 KB jsonb delta baseline rewritten on every poll and
 * stored out of line. The ordinary update pipeline SELECTs the row before
 * writing it, which detoasts the PREVIOUS log a second time — the walk util
 * already read it — on the hottest table in the product. So it is never
 * written through the hooked path. It was a hook-free write of its own; now
 * (issue #7393) it rides, with the SNMP table and transceiver snapshots, in
 * the poll's one hook-free compare-and-set statement
 * (NetworkDeviceService.writePollVerdict): a poll wrote the device row three
 * or four times, and now writes it twice - its claim, and that statement.
 *
 * That is only safe because of what the statement does NOT contain. The
 * NetworkDevice update hooks re-run site-assignment rules on the identity
 * columns and re-stamp monitor status on the monitor binding; a column that
 * moves onto the hook-free path stops firing them SILENTLY. So these tests
 * pin both halves: the baseline and the snapshots are handed to the verdict
 * statement, which carries no column a hook watches, and the walk's device
 * enrichment — the write that actually carries sysName — still goes through
 * the hooked path.
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
let inventorySpy: jest.SpyInstance;
let metricsSpy: jest.SpyInstance;
let monitorFindSpy: jest.SpyInstance;

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

/*
 * The walk pipeline with every collaborator but the device writes mocked.
 * null: a device that has never been walked.
 */
function mockWalkPipeline(
  previousWalkLog: JSONObject | null = PREVIOUS_WALK_LOG,
): void {
  const device: NetworkDevice = new NetworkDevice();
  device.id = new ObjectID(DEVICE_ID);
  device.projectId = PROJECT_ID;
  device.name = "core-sw-01";

  if (previousWalkLog) {
    device.lastWalkLog = previousWalkLog;
  }

  deviceFindSpy = jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockResolvedValue(device);
  // true: written - the device was not held by another writer.
  hookFreeUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateColumnsByIdIfUnlockedWithoutHooks")
    .mockResolvedValue(true);
  hookedUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateOneById")
    .mockResolvedValue(1);
  // The fan-out's lookup: the device's rows in MonitorNetworkDevice.
  monitorFindSpy = jest
    .spyOn(MonitorNetworkDeviceService, "findBy")
    .mockResolvedValue([]);
  jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);
  inventorySpy = jest
    .spyOn(NetworkInventoryUtil, "updateFromWalk")
    .mockResolvedValue(undefined);
  metricsSpy = jest
    .spyOn(NetworkDeviceMetricUtil, "saveWalkMetrics")
    .mockResolvedValue(undefined);
  rateSpy = jest
    .spyOn(SnmpInterfaceRateUtil, "attachInterfaceRates")
    .mockImplementation(() => {
      return undefined;
    });
}

/*
 * `dataReceivedAt`: when OneUptime's ingest API received the poll, before
 * the queue it waited in. Absent - a job queued before the stamp existed -
 * the poll is timed when it is processed.
 */
async function runWalk(
  snmpResponse: SnmpMonitorResponse,
  options?: { dataReceivedAt?: Date | undefined },
): Promise<void> {
  await NetworkDeviceWalkUtil.processWalkResult({
    probeId: PROBE_ID,
    networkDeviceId: new ObjectID(DEVICE_ID),
    snmpResponse: snmpResponse,
    monitoredAt: MONITORED_AT,
    dataReceivedAt: options?.dataReceivedAt,
  });
}

/*
 * The rate baseline the walk handed the inventory sync, which writes it with
 * the poll's verdict (NetworkInventoryUtil.updateFromWalk ->
 * NetworkDeviceService.writePollVerdict). Undefined: the stored baseline is
 * left as it is.
 */
function handedBaseline(callIndex: number = 0): JSONObject | undefined {
  expect(inventorySpy.mock.calls.length).toBeGreaterThan(callIndex);
  return inventorySpy.mock.calls[callIndex][0]["lastWalkLog"] as
    | JSONObject
    | undefined;
}

// The walk makes no device write of its own: the inventory sync makes them.
function expectNoDeviceWriteOfItsOwn(): void {
  expect(hookFreeUpdateSpy).not.toHaveBeenCalled();
  expect(hookedUpdateSpy).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkDeviceWalkUtil — the lastWalkLog baseline write", () => {
  /*
   * No pre-update SELECT, and no write of its own (issue #7393): the
   * baseline rides in the poll's verdict statement. If it goes back through
   * updateOneById / updateBy, every poll re-reads and re-TOASTs the previous
   * 25 KB log that the walk already has in memory; as a write of its own, it
   * is one more new version of the device row on every poll.
   */
  test("is handed to the inventory sync to write with the poll's verdict: the walk makes no device write of its own", async () => {
    mockWalkPipeline();
    const waitingWriteSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "updateColumnsByIdWithoutHooks",
    );

    await runWalk(buildSnmpResponse());

    expect(handedBaseline()).toBeDefined();
    expectNoDeviceWriteOfItsOwn();
    expect(waitingWriteSpy).not.toHaveBeenCalled();
  });

  test("goes to the walked device's inventory sync", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse());

    expect(inventorySpy).toHaveBeenCalledTimes(1);
    expect(
      (inventorySpy.mock.calls[0][0]["deviceId"] as ObjectID).toString(),
    ).toBe(DEVICE_ID);
    expect(
      (inventorySpy.mock.calls[0][0]["projectId"] as ObjectID).toString(),
    ).toBe(PROJECT_ID.toString());
  });

  /*
   * A plain-JSON snapshot, not the live response object: the rest of the
   * pipeline mutates data.snmpResponse (inventory prunes it down to monitored
   * ports), and a baseline that shrank with it would compute rates for the
   * pruned ports against nothing on the next poll.
   */
  test("persists a deep JSON snapshot of the INTERFACES, stamped with the server receipt time", async () => {
    mockWalkPipeline();
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse();

    await runWalk(snmpResponse);

    const walkLog: JSONObject = handedBaseline()!;
    const storedResponse: JSONObject = walkLog["snmpResponse"] as JSONObject;

    expect(storedResponse["interfaces"]).toEqual(
      JSON.parse(JSON.stringify(snmpResponse.interfaces)),
    );
    expect(storedResponse["interfaces"]).not.toBe(snmpResponse.interfaces);
    expect(walkLog["monitoredAt"]).toEqual(NOW);
  });

  /*
   * The column stores ONLY what reads it back.
   *
   * SnmpInterfaceRateUtil is the single reader and it touches
   * snmpResponse.interfaces and nothing else, so every other field was dead
   * weight in a jsonb column rewritten on every poll of every device. That
   * became worth fixing when OID Collection Templates made long health-OID
   * lists normal: oidResponses is the field that grows, and storing it here
   * would have added tens of KB per device per poll of TOAST churn on the
   * product's hottest table, for data nothing ever reads.
   *
   * If a future reader needs another field, add it here deliberately — do
   * not go back to storing the whole response. SnmpOidRateUtil is the one
   * other reader: it keeps the counter OIDs' readings, a few numbers, under
   * oidCounters (pinned below) - never oidResponses.
   */
  test("stores only the interfaces, not the rest of the walk", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse());

    const walkLog: JSONObject = handedBaseline()!;

    expect(Object.keys(walkLog["snmpResponse"] as JSONObject)).toEqual([
      "interfaces",
    ]);
  });

  /*
   * The guard rail for everything above sits on the statement that writes
   * it: the verdict statement's details are the baseline and the two
   * snapshots, and none of them is a column a hook watches (the
   * "NetworkInventoryUtil — the device enrichment write" tests below). Its
   * WHERE never writes a device deleted while its walk was in flight
   * (NetworkDevicePollVerdict.test.ts).
   */

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

    expect(handedBaseline()).toBeUndefined();
    expectNoDeviceWriteOfItsOwn();
  });

  test("an empty interface array is treated the same as no interfaces", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse({ interfaces: [] }));

    expect(handedBaseline()).toBeUndefined();
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
      inventorySpy.mock.invocationCallOrder[0] as number,
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
 * carries sysName — an identity column — and it MUST keep going through
 * updateOneById: that is the write whose hooks re-evaluate site-assignment
 * rules for a device that has no site, and it is how a discovery-imported
 * device (imported with only an IP) ever gets placed.
 *
 * The poll's verdict - reachability, liveness, the interface counts - left
 * it for a statement of its own (issue #7389), which writes it only when the
 * device holds no verdict from a poll received later. That is safe for the
 * same reason as the baseline above: no hook reads any of those columns.
 */
describe("NetworkInventoryUtil — the device enrichment write", () => {
  function mockInventoryServices(): {
    hookedUpdate: jest.SpyInstance;
    hookFreeUpdate: jest.SpyInstance;
    pollVerdict: jest.SpyInstance;
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
      pollVerdict: jest
        .spyOn(NetworkDeviceService, "writePollVerdict")
        .mockResolvedValue(true),
    };
  }

  test("sysName is still written through the hooked path, so site-assignment rules re-run", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
      pollVerdict: jest.SpyInstance;
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
   * Reachability - what the device list, the topology graph and the site
   * rollup read - is written first, by the guarded verdict statement, and
   * never by the hooked write. Moved back onto the hooked payload, an older
   * poll processed after a newer one would put its answer back over the
   * newer one's again.
   */
  test("reachability and liveness go through the guarded verdict write, never the hooked one", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
      pollVerdict: jest.SpyInstance;
    } = mockInventoryServices();

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: {
        isOnline: true,
        responseTimeInMs: 12,
        failureCause: "",
        oidResponses: [],
        systemInfo: { sysName: "UN0664LANSWI03" },
      } as unknown as SnmpMonitorResponse,
      isOnline: true,
    });

    expect(spies.pollVerdict).toHaveBeenCalledTimes(1);
    expect(spies.pollVerdict.mock.calls[0][0].verdict).toEqual({
      isReachable: true,
      isSnmpReachable: true,
      interfaceCounts: undefined,
    });
    expect(spies.pollVerdict.mock.invocationCallOrder[0]).toBeLessThan(
      spies.hookedUpdate.mock.invocationCallOrder[0] as number,
    );

    const payload: JSONObject = spies.hookedUpdate.mock.calls[0][0][
      "data"
    ] as JSONObject;

    for (const column of [
      "lastPollReceivedAt",
      "lastPolledAt",
      "isReachable",
      "lastSeenAt",
      "isSnmpReachable",
      "lastSnmpSeenAt",
      "interfacesTotal",
      "interfacesUp",
      "interfacesDown",
    ]) {
      expect(payload).not.toHaveProperty(column);
    }

    expect(spies.hookFreeUpdate).not.toHaveBeenCalled();
  });

  /*
   * The verdict statement's columns are fixed (writePollVerdict), and the
   * verdict it is handed names none of the columns a hook watches.
   */
  test("the verdict carries no column any device update hook watches", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
      pollVerdict: jest.SpyInstance;
    } = mockInventoryServices();

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: buildSnmpResponse(),
      isOnline: true,
    });

    const verdictKeys: Array<string> = Object.keys(
      spies.pollVerdict.mock.calls[0][0].verdict as JSONObject,
    );

    for (const watched of HOOK_WATCHED_COLUMNS) {
      expect(verdictKeys).not.toContain(watched);
    }
  });

  /*
   * A poll older than the verdict the device holds wrote nothing through the
   * verdict statement, and its system group, neighbours and snapshots are
   * older than the device's too: the hooked write is not made at all.
   */
  test("an older poll than the one the device holds makes no enrichment write", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
      pollVerdict: jest.SpyInstance;
    } = mockInventoryServices();
    spies.pollVerdict.mockResolvedValue(false);

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: {
        isOnline: true,
        responseTimeInMs: 12,
        failureCause: "",
        oidResponses: [],
        systemInfo: { sysName: "UN0664LANSWI03" },
      } as unknown as SnmpMonitorResponse,
      isOnline: true,
    });

    expect(spies.pollVerdict).toHaveBeenCalledTimes(1);
    expect(spies.hookedUpdate).not.toHaveBeenCalled();
  });

  /*
   * Issue #7393: the poll's details - its rate baseline and its SNMP table
   * and transceiver snapshots - ride in the verdict's one statement. Each
   * was a write of the device row of its own; the snapshots, which change on
   * every poll, made the hooked write (a read of the row, the UPDATE, the
   * hooks) one of every poll of a device with tables or optics.
   */
  const TABLE_SNAPSHOT: Array<SnmpTableSnapshot> = [
    {
      tableId: "wifi-radios",
      name: "Wi-Fi radios",
      rows: [],
    } as unknown as SnmpTableSnapshot,
  ];
  const OPTICS: Array<NetworkDeviceTransceiver> = [
    { interfaceIndex: 1 } as unknown as NetworkDeviceTransceiver,
  ];

  test("the poll's baseline and snapshots ride in the verdict statement, with the verdict", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
      pollVerdict: jest.SpyInstance;
    } = mockInventoryServices();

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: buildSnmpResponse(),
      isOnline: true,
      lastWalkLog: PREVIOUS_WALK_LOG,
      snmpTableSnapshot: TABLE_SNAPSHOT,
      transceiverSnapshot: OPTICS,
    });

    expect(spies.pollVerdict).toHaveBeenCalledTimes(1);
    const write: JSONObject = spies.pollVerdict.mock.calls[0][0] as JSONObject;
    expect(write["details"]).toEqual({
      lastWalkLog: PREVIOUS_WALK_LOG,
      snmpTableSnapshot: TABLE_SNAPSHOT,
      transceiverSnapshot: OPTICS,
    });
    expect(write["verdict"]).toEqual({
      isReachable: true,
      isSnmpReachable: true,
      interfaceCounts: { total: 1, up: 1, down: 0 },
    });
    expect(spies.hookFreeUpdate).not.toHaveBeenCalled();
  });

  test("a poll that changed nothing but its snapshots makes no hooked write at all", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
      pollVerdict: jest.SpyInstance;
    } = mockInventoryServices();

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: buildSnmpResponse(),
      isOnline: true,
      snmpTableSnapshot: TABLE_SNAPSHOT,
      transceiverSnapshot: OPTICS,
    });

    expect(spies.pollVerdict).toHaveBeenCalledTimes(1);
    expect(spies.hookedUpdate).not.toHaveBeenCalled();
  });

  test("the hooked write carries no snapshot, even when the device's system group changed too", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
      pollVerdict: jest.SpyInstance;
    } = mockInventoryServices();

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: buildSnmpResponse({
        systemInfo: { sysName: "UN0664LANSWI03" },
      }),
      isOnline: true,
      snmpTableSnapshot: TABLE_SNAPSHOT,
      transceiverSnapshot: OPTICS,
    });

    expect(spies.hookedUpdate).toHaveBeenCalledTimes(1);
    const payload: JSONObject = spies.hookedUpdate.mock.calls[0][0][
      "data"
    ] as JSONObject;
    expect(payload["sysName"]).toBe("UN0664LANSWI03");
    for (const column of NETWORK_DEVICE_POLL_DETAIL_COLUMNS) {
      expect(payload).not.toHaveProperty(column);
    }
  });

  test("the details carry nothing but the baseline and the snapshots: no column a device update hook watches", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
      pollVerdict: jest.SpyInstance;
    } = mockInventoryServices();

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: buildSnmpResponse(),
      isOnline: true,
      lastWalkLog: PREVIOUS_WALK_LOG,
      snmpTableSnapshot: TABLE_SNAPSHOT,
      transceiverSnapshot: OPTICS,
    });

    const detailKeys: Array<string> = Object.keys(
      spies.pollVerdict.mock.calls[0][0]["details"] as JSONObject,
    );

    expect(detailKeys.sort()).toEqual(
      [...NETWORK_DEVICE_POLL_DETAIL_COLUMNS].sort(),
    );
    for (const watched of HOOK_WATCHED_COLUMNS) {
      expect(detailKeys).not.toContain(watched);
    }
  });

  /*
   * A monitor-backed device's bound monitor owns its health, so a poll that
   * arrives for one writes no verdict. Its baseline and snapshots are
   * inventory, and are written all the same - in the same guarded
   * statement, with no health column in it.
   */
  test("a monitor-backed device gets its details with no verdict", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
      pollVerdict: jest.SpyInstance;
    } = mockInventoryServices();
    const monitorBacked: NetworkDevice = new NetworkDevice();
    monitorBacked.id = new ObjectID(DEVICE_ID);
    monitorBacked.monitoringMethod = NetworkDeviceMonitoringMethod.Monitor;
    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(monitorBacked);
    jest.spyOn(logger, "warn").mockImplementation((() => {
      return undefined;
    }) as never);

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: buildSnmpResponse(),
      isOnline: true,
      snmpTableSnapshot: TABLE_SNAPSHOT,
    });

    expect(spies.pollVerdict).toHaveBeenCalledTimes(1);
    expect(spies.pollVerdict.mock.calls[0][0]["verdict"]).toBeNull();
    expect(spies.pollVerdict.mock.calls[0][0]["details"]).toEqual({
      lastWalkLog: undefined,
      snmpTableSnapshot: TABLE_SNAPSHOT,
      transceiverSnapshot: undefined,
    });
  });

  test("a monitor-backed device with no details to write gets no verdict statement at all", async () => {
    const spies: {
      hookedUpdate: jest.SpyInstance;
      hookFreeUpdate: jest.SpyInstance;
      pollVerdict: jest.SpyInstance;
    } = mockInventoryServices();
    const monitorBacked: NetworkDevice = new NetworkDevice();
    monitorBacked.id = new ObjectID(DEVICE_ID);
    monitorBacked.monitoringMethod = NetworkDeviceMonitoringMethod.Monitor;
    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(monitorBacked);
    jest.spyOn(logger, "warn").mockImplementation((() => {
      return undefined;
    }) as never);

    await NetworkInventoryUtil.updateFromWalk({
      projectId: PROJECT_ID,
      deviceId: new ObjectID(DEVICE_ID),
      snmpResponse: buildSnmpResponse({
        systemInfo: { sysName: "UN0664LANSWI03" },
      }),
      isOnline: true,
    });

    expect(spies.pollVerdict).not.toHaveBeenCalled();
    // Its inventory is still recorded, through the hooked write.
    expect(spies.hookedUpdate).toHaveBeenCalledTimes(1);
  });
});

/*
 * The counters SNMP OID Rate (per second) is computed against. A counter
 * only grows, so what an alert on one compares is how fast it grows: the
 * poll's counter OIDs (Counter32, Counter64) are kept - the counters only,
 * by OID, with the poll's receipt time - beside the interfaces, and the next
 * poll's rate is each one's growth since.
 */
describe("NetworkDeviceWalkUtil — the counters an OID rate is computed against", () => {
  const IF_IN_ERRORS: string = "1.3.6.1.2.1.2.2.1.14.3";
  const CPU: string = "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1";

  const PREVIOUS_COUNTERS: JSONObject = {
    values: { [IF_IN_ERRORS]: "1200" },
    readAt: "2026-07-16T11:55:00.000Z",
  };

  function oidReads(errors: number): Array<SnmpOidResponse> {
    return [
      {
        oid: IF_IN_ERRORS,
        name: "ifInErrors.3",
        value: errors,
        type: SnmpDataType.Counter32,
      },
      {
        oid: CPU,
        name: "cpmCPUTotal5minRev.1",
        value: 7,
        type: SnmpDataType.Gauge32,
      },
    ];
  }

  function storedWalkLog(): JSONObject {
    return handedBaseline()!;
  }

  test("keeps the counters the poll read - the counters only - with the poll's receipt time", async () => {
    mockWalkPipeline();

    await runWalk(buildSnmpResponse({ oidResponses: oidReads(1500) }));

    const walkLog: JSONObject = storedWalkLog();

    expect(Object.keys(walkLog)).toEqual([
      "snmpResponse",
      "monitoredAt",
      "oidCounters",
    ]);
    expect(walkLog["oidCounters"]).toEqual({
      values: { [IF_IN_ERRORS]: "1500" },
      readAt: NOW.toISOString(),
    });
    // Plain JSON: what goes into jsonb is what comes back out.
    expect(JSON.parse(JSON.stringify(walkLog["oidCounters"]))).toEqual(
      walkLog["oidCounters"],
    );
  });

  test("gives each counter its growth per second since the previous poll, before the inventory, metrics and monitors read the poll", async () => {
    mockWalkPipeline({ ...PREVIOUS_WALK_LOG, oidCounters: PREVIOUS_COUNTERS });

    let rateTheInventorySaw: number | undefined = undefined;

    jest
      .spyOn(NetworkInventoryUtil, "updateFromWalk")
      .mockImplementation(
        async (args: { snmpResponse?: SnmpMonitorResponse | undefined }) => {
          rateTheInventorySaw =
            args.snmpResponse?.oidResponses[0]?.ratePerSecond;
        },
      );

    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
      oidResponses: oidReads(1500),
    });

    await runWalk(snmpResponse);

    // 300 more errors in the 300 seconds between the two polls.
    expect(snmpResponse.oidResponses[0]!.ratePerSecond).toBe(1);
    expect(rateTheInventorySaw).toBe(1);
    // A gauge is never given a rate.
    expect(snmpResponse.oidResponses[1]!.ratePerSecond).toBeUndefined();
  });

  test("a device's first counters have no rate yet", async () => {
    mockWalkPipeline();

    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
      oidResponses: oidReads(1500),
    });

    await runWalk(snmpResponse);

    expect(snmpResponse.oidResponses[0]!.ratePerSecond).toBeUndefined();
  });

  test("a counter that went back since the previous poll gets no rate, and is the next poll's baseline", async () => {
    mockWalkPipeline({ ...PREVIOUS_WALK_LOG, oidCounters: PREVIOUS_COUNTERS });

    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
      oidResponses: oidReads(3),
    });

    await runWalk(snmpResponse);

    expect(snmpResponse.oidResponses[0]!.ratePerSecond).toBeUndefined();
    expect(storedWalkLog()["oidCounters"]).toEqual({
      values: { [IF_IN_ERRORS]: "3" },
      readAt: NOW.toISOString(),
    });
  });

  /*
   * A device whose poll reads counters but walks no interface table still
   * needs its counters kept, or no rate would ever exist. The interfaces'
   * baseline is left as it was - with ITS time - so their next rate has a
   * correct (longer) window rather than none.
   */
  test("a poll that read counters but walked no interfaces keeps them, and leaves the interfaces' baseline and its time as they were", async () => {
    mockWalkPipeline({ ...PREVIOUS_WALK_LOG, oidCounters: PREVIOUS_COUNTERS });

    await runWalk(
      buildSnmpResponse({
        interfaces: undefined,
        oidResponses: oidReads(1500),
      }),
    );

    const walkLog: JSONObject = storedWalkLog();

    expect(walkLog["snmpResponse"]).toEqual(PREVIOUS_WALK_LOG["snmpResponse"]);
    expect(walkLog["monitoredAt"]).toBe(PREVIOUS_WALK_LOG["monitoredAt"]);
    expect(walkLog["oidCounters"]).toEqual({
      values: { [IF_IN_ERRORS]: "1500" },
      readAt: NOW.toISOString(),
    });
    expectNoDeviceWriteOfItsOwn();
  });

  test("a poll that walked interfaces but read no counter keeps the counters it had, and their time", async () => {
    mockWalkPipeline({ ...PREVIOUS_WALK_LOG, oidCounters: PREVIOUS_COUNTERS });

    await runWalk(buildSnmpResponse({ oidResponses: [] }));

    const walkLog: JSONObject = storedWalkLog();

    expect(walkLog["oidCounters"]).toEqual(PREVIOUS_COUNTERS);
    expect(walkLog["monitoredAt"]).toEqual(NOW);
    expect((walkLog["snmpResponse"] as JSONObject)["interfaces"]).toHaveLength(
      1,
    );
  });

  test("a device that never walked interfaces keeps its counters on their own", async () => {
    mockWalkPipeline(null);

    await runWalk(
      buildSnmpResponse({ interfaces: undefined, oidResponses: oidReads(10) }),
    );

    expect(storedWalkLog()).toEqual({
      oidCounters: {
        values: { [IF_IN_ERRORS]: "10" },
        readAt: NOW.toISOString(),
      },
    });
  });

  test("a poll that read only gauges and walked no interfaces writes nothing", async () => {
    mockWalkPipeline({ ...PREVIOUS_WALK_LOG, oidCounters: PREVIOUS_COUNTERS });

    await runWalk(
      buildSnmpResponse({
        interfaces: undefined,
        oidResponses: [oidReads(1)[1] as SnmpOidResponse],
      }),
    );

    expect(handedBaseline()).toBeUndefined();
  });

  test("a ping-only poll writes nothing and keeps every baseline", async () => {
    mockWalkPipeline({ ...PREVIOUS_WALK_LOG, oidCounters: PREVIOUS_COUNTERS });

    await NetworkDeviceWalkUtil.processWalkResult({
      probeId: PROBE_ID,
      networkDeviceId: new ObjectID(DEVICE_ID),
      isOnline: true,
      pollMode: "ping",
      snmpResponse: undefined,
      monitoredAt: MONITORED_AT,
    });

    expect(handedBaseline()).toBeUndefined();
    expectNoDeviceWriteOfItsOwn();
  });
});

/*
 * OneUptime issue #7194: a telemetry queue backlog of device polls, on a
 * database busy enough that a device's row was often held by another writer
 * when its poll got to it.
 *
 * The baseline write queued for the device's row like any UPDATE, and it had
 * no try/catch: held past lock_timeout, it failed the whole job ("canceling
 * statement due to lock timeout"), and the queue ran the job again from the
 * start, twice - up to three times the work for the busy database, and the
 * backlog grew. And every poll that did get through was timed by the moment
 * a worker dequeued it, so a draining backlog read as a burst of traffic many
 * times its size.
 */
describe("NetworkDeviceWalkUtil — a busy database and a queue backlog (issue #7194)", () => {
  const RECEIVED_AT: Date = new Date("2026-07-16T11:57:00.000Z");
  const IF_IN_ERRORS: string = "1.3.6.1.2.1.2.2.1.14.3";

  function counterReads(errors: number): Array<SnmpOidResponse> {
    return [
      {
        oid: IF_IN_ERRORS,
        name: "ifInErrors.3",
        value: errors,
        type: SnmpDataType.Counter32,
      },
    ];
  }

  function interfaceWith(
    inOctets: number,
    outOctets: number,
  ): SnmpMonitorResponse["interfaces"] {
    return [
      {
        interfaceIndex: 1,
        name: "GigabitEthernet0/1",
        isOperationallyUp: true,
        isAdministrativelyUp: true,
        inOctets: inOctets,
        outOctets: outOctets,
      },
    ];
  }

  // The interfaces half of a stored baseline, as the jsonb column holds it.
  function interfacesBaseline(inOctets: number, outOctets: number): JSONObject {
    return JSON.parse(
      JSON.stringify({ interfaces: interfaceWith(inOctets, outOctets) }),
    ) as JSONObject;
  }

  function storedWalkLog(callIndex: number = 0): JSONObject {
    return handedBaseline(callIndex)!;
  }

  // What a device read back from Postgres holds: the log as jsonb gives it.
  function deviceHolding(walkLog: JSONObject): NetworkDevice {
    const device: NetworkDevice = new NetworkDevice();
    device.id = new ObjectID(DEVICE_ID);
    device.projectId = PROJECT_ID;
    device.name = "core-sw-01";
    device.lastWalkLog = JSON.parse(JSON.stringify(walkLog)) as JSONObject;
    return device;
  }

  function quietWarnings(): jest.SpyInstance {
    return jest.spyOn(logger, "warn").mockImplementation((() => {
      return undefined;
    }) as never);
  }

  /*
   * The baseline had a write of its own that never waited for the row
   * (FOR UPDATE SKIP LOCKED) and never threw. It now rides in the poll's
   * verdict statement (issue #7393), which waits for the row as it always
   * did - so the newer of two polls written at once is the one whose result
   * stands - and whose lock timeout, deadlock or other failure is logged by
   * the inventory sync and never fails the poll: the rest of it - the
   * interfaces, the endpoints, the metrics, the monitors - still runs, and
   * the next poll's rates are worked out over the longer window.
   */
  describe("a device another writer holds", () => {
    function mockSyncAround(failure: Error): {
      interfaces: jest.SpyInstance;
      hooked: jest.SpyInstance;
    } {
      const ownedDevice: NetworkDevice = new NetworkDevice();
      ownedDevice.id = new ObjectID(DEVICE_ID);

      jest
        .spyOn(NetworkDeviceService, "findOneBy")
        .mockResolvedValue(ownedDevice);
      jest
        .spyOn(NetworkDeviceService, "writePollVerdict")
        .mockRejectedValue(failure);

      return {
        interfaces: jest
          .spyOn(NetworkInterfaceService, "upsertWalkedInterfaces")
          .mockResolvedValue({ unmonitoredInterfaceIndexes: [] } as never),
        hooked: jest
          .spyOn(NetworkDeviceService, "updateOneById")
          .mockResolvedValue(1),
      };
    }

    function walkWithNewSysName(): Promise<void> {
      return NetworkInventoryUtil.updateFromWalk({
        projectId: PROJECT_ID,
        deviceId: new ObjectID(DEVICE_ID),
        snmpResponse: buildSnmpResponse({
          systemInfo: { sysName: "UN0664LANSWI03" },
        }),
        isOnline: true,
        lastWalkLog: PREVIOUS_WALK_LOG,
      });
    }

    test.each([
      ["a lock timeout", "canceling statement due to lock timeout", "55P03"],
      ["a deadlock", "deadlock detected", "40P01"],
    ])(
      "%s on the poll's result statement is logged, and the rest of the poll still runs",
      async (_label: string, message: string, code: string) => {
        const warn: jest.SpyInstance = quietWarnings();
        const failure: Error & { code?: string | undefined } = new Error(
          message,
        );
        failure.code = code;
        const spies: {
          interfaces: jest.SpyInstance;
          hooked: jest.SpyInstance;
        } = mockSyncAround(failure);

        await expect(walkWithNewSysName()).resolves.toBeUndefined();

        // Its interfaces are another table: written as usual.
        expect(spies.interfaces).toHaveBeenCalledTimes(1);
        // Whether it is the newest poll is unknown: its system group waits.
        expect(spies.hooked).not.toHaveBeenCalled();

        expect(
          warn.mock.calls.some((call: Array<unknown>) => {
            return (
              String(call[0]).includes(DEVICE_ID) &&
              String(call[0]).includes(message)
            );
          }),
        ).toBe(true);
      },
    );

    test("any other failure of it is logged, and does not fail the poll", async () => {
      quietWarnings();
      const error: jest.SpyInstance = jest
        .spyOn(logger, "error")
        .mockImplementation((() => {
          return undefined;
        }) as never);
      mockSyncAround(new Error("Connection terminated unexpectedly"));

      await expect(walkWithNewSysName()).resolves.toBeUndefined();

      expect(
        error.mock.calls.some((call: Array<unknown>) => {
          return String(call[0]).includes(DEVICE_ID);
        }),
      ).toBe(true);
    });

    test("the walk around it - metrics, monitors - runs whatever the sync did", async () => {
      mockWalkPipeline();

      await expect(runWalk(buildSnmpResponse())).resolves.toBeUndefined();

      expect(inventorySpy).toHaveBeenCalledTimes(1);
      expect(metricsSpy).toHaveBeenCalledTimes(1);
      expect(monitorFindSpy).toHaveBeenCalled();
      expectNoDeviceWriteOfItsOwn();
    });
  });

  describe("the time a poll is rated at", () => {
    test("is when OneUptime received the poll, not when a worker got to it - for the rates and for the baseline", async () => {
      mockWalkPipeline({
        ...PREVIOUS_WALK_LOG,
        oidCounters: {
          values: { [IF_IN_ERRORS]: "1200" },
          readAt: "2026-07-16T11:55:00.000Z",
        },
      });

      const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
        oidResponses: counterReads(1320),
      });

      await runWalk(snmpResponse, { dataReceivedAt: RECEIVED_AT });

      // The interfaces: compared at the receipt time.
      expect(rateSpy.mock.calls[0][0].now).toEqual(RECEIVED_AT);
      // The counter OIDs: 120 more errors over the 120 s since 11:55:00.
      expect(snmpResponse.oidResponses[0]!.ratePerSecond).toBe(1);

      // And the next poll's baseline is stamped with it, not the worker's now.
      const walkLog: JSONObject = storedWalkLog();
      expect(walkLog["monitoredAt"]).toEqual(RECEIVED_AT);
      expect(walkLog["oidCounters"]).toEqual({
        values: { [IF_IN_ERRORS]: "1320" },
        readAt: RECEIVED_AT.toISOString(),
      });
    });

    test.each([
      ["has no receipt time (queued before the stamp existed)", undefined],
      ["has an unreadable receipt time", new Date("not a date")],
    ])(
      "is the moment it is processed when the job %s",
      async (_label: string, dataReceivedAt: Date | undefined) => {
        mockWalkPipeline();
        const transceiverSpy: jest.SpyInstance = jest.spyOn(
          NetworkDeviceWalkUtil,
          "applyTransceivers",
        );

        await runWalk(buildSnmpResponse(), { dataReceivedAt });

        expect(rateSpy.mock.calls[0][0].now).toEqual(NOW);
        expect(storedWalkLog()["monitoredAt"]).toEqual(NOW);
        expect(transceiverSpy.mock.calls[0][0].now).toEqual(NOW);
        expect(inventorySpy.mock.calls[0][0].receivedAt).toEqual(NOW);
      },
    );

    /*
     * Everything else the poll saw is timed at the same receipt (issue
     * #7389): the inventory - when the device, its interfaces and its
     * endpoints were last seen, and the readings of its own MAC and
     * address - and the transceivers' judgement.
     */
    test("is the time the inventory and the transceivers are stamped with too", async () => {
      mockWalkPipeline();
      const transceiverSpy: jest.SpyInstance = jest.spyOn(
        NetworkDeviceWalkUtil,
        "applyTransceivers",
      );

      await runWalk(buildSnmpResponse(), { dataReceivedAt: RECEIVED_AT });

      expect(inventorySpy).toHaveBeenCalledTimes(1);
      expect(inventorySpy.mock.calls[0][0].receivedAt).toEqual(RECEIVED_AT);
      expect(transceiverSpy).toHaveBeenCalledTimes(1);
      expect(transceiverSpy.mock.calls[0][0].now).toEqual(RECEIVED_AT);
    });

    /*
     * The burst the issue's charts would have shown. Two polls five minutes
     * apart wait out a backlog and are processed two seconds apart. Timed by
     * the dequeues, the second poll's five minutes of traffic were divided
     * by two seconds: 150 times the real rate, on the chart and against every
     * bandwidth and error-rate criteria.
     */
    test("a backlog drained in seconds is rated over the minutes between the polls, not the seconds between the dequeues", async () => {
      mockWalkPipeline(null);
      rateSpy.mockRestore();
      const clock: jest.SpyInstance = jest.spyOn(
        OneUptimeDate,
        "getCurrentDate",
      );

      // Received 11:50:00, processed at 13:00:00.
      clock.mockReturnValue(new Date("2026-07-16T13:00:00.000Z"));
      await runWalk(
        buildSnmpResponse({
          interfaces: interfaceWith(1_000_000, 2_000_000),
          oidResponses: counterReads(1200),
        }),
        { dataReceivedAt: new Date("2026-07-16T11:50:00.000Z") },
      );

      expect(handedBaseline(0)).toBeDefined();
      deviceFindSpy.mockResolvedValue(deviceHolding(storedWalkLog(0)));

      // Received 11:55:00, processed two seconds after the first.
      clock.mockReturnValue(new Date("2026-07-16T13:00:02.000Z"));
      const second: SnmpMonitorResponse = buildSnmpResponse({
        // 1,250 bytes a second in, 2,500 out, for the 300 s between them.
        interfaces: interfaceWith(1_375_000, 2_750_000),
        // An error a second.
        oidResponses: counterReads(1500),
      });
      await runWalk(second, {
        dataReceivedAt: new Date("2026-07-16T11:55:00.000Z"),
      });

      expect(second.interfaces![0]!.inBitsPerSecond).toBe(10_000);
      expect(second.interfaces![0]!.outBitsPerSecond).toBe(20_000);
      expect(second.oidResponses[0]!.ratePerSecond).toBe(1);

      expect(storedWalkLog(1)["monitoredAt"]).toEqual(
        new Date("2026-07-16T11:55:00.000Z"),
      );
    });
  });

  /*
   * Polls do not always arrive in order: a job that failed and was retried
   * - or one that simply waited longer in the queue - can be processed after
   * a newer poll of the same device. Its reading is older than the baseline,
   * so it must not be put back over it: the next poll would then be rated
   * against a reading older than the one it follows.
   */
  describe("a poll received before the one the baseline holds", () => {
    const NEWER: string = "2026-07-16T11:58:00.000Z";
    const OLDER: Date = new Date("2026-07-16T11:53:00.000Z");

    test("writes nothing: the newer interfaces and counters stay the baseline, and it gets no rate", async () => {
      mockWalkPipeline({
        snmpResponse: interfacesBaseline(9_000, 9_000),
        monitoredAt: NEWER,
        oidCounters: { values: { [IF_IN_ERRORS]: "1500" }, readAt: NEWER },
      });
      rateSpy.mockRestore();

      const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
        interfaces: interfaceWith(5_000, 5_000),
        oidResponses: counterReads(1400),
      });

      await runWalk(snmpResponse, { dataReceivedAt: OLDER });

      expect(handedBaseline()).toBeUndefined();
      // A negative window: no rate rather than a made-up one.
      expect(snmpResponse.interfaces![0]!.inBitsPerSecond).toBeUndefined();
      expect(snmpResponse.oidResponses[0]!.ratePerSecond).toBeUndefined();
      // The rest of the poll is processed as any other.
      expect(inventorySpy).toHaveBeenCalledTimes(1);
    });

    /*
     * The two halves of the baseline carry their own times - a poll that
     * read counters but walked no interfaces moves only the counters'. Each
     * half is kept or replaced by its own time.
     */
    test("replaces only the half of the baseline it is newer than", async () => {
      mockWalkPipeline({
        snmpResponse: interfacesBaseline(1_000, 1_000),
        monitoredAt: "2026-07-16T11:50:00.000Z",
        oidCounters: { values: { [IF_IN_ERRORS]: "1500" }, readAt: NEWER },
      });

      await runWalk(
        buildSnmpResponse({
          interfaces: interfaceWith(5_000, 5_000),
          oidResponses: counterReads(1400),
        }),
        { dataReceivedAt: new Date("2026-07-16T11:55:00.000Z") },
      );

      const walkLog: JSONObject = storedWalkLog();

      // Newer than the interfaces' baseline: replaces it.
      expect(walkLog["monitoredAt"]).toEqual(
        new Date("2026-07-16T11:55:00.000Z"),
      );
      expect(
        (
          (walkLog["snmpResponse"] as JSONObject)[
            "interfaces"
          ] as Array<JSONObject>
        )[0]!["inOctets"],
      ).toBe(5_000);
      // Older than the counters': they stay, with their time.
      expect(walkLog["oidCounters"]).toEqual({
        values: { [IF_IN_ERRORS]: "1500" },
        readAt: NEWER,
      });
    });

    test("one received at the very time the baseline holds - the same poll, retried - rewrites nothing", async () => {
      mockWalkPipeline({
        snmpResponse: interfacesBaseline(5_000, 5_000),
        monitoredAt: RECEIVED_AT.toISOString(),
        oidCounters: {
          values: { [IF_IN_ERRORS]: "1400" },
          readAt: RECEIVED_AT.toISOString(),
        },
      });

      await runWalk(
        buildSnmpResponse({
          interfaces: interfaceWith(5_000, 5_000),
          oidResponses: counterReads(1400),
        }),
        { dataReceivedAt: RECEIVED_AT },
      );

      expect(handedBaseline()).toBeUndefined();
    });
  });

  describe("isReceivedAfter", () => {
    test.each([
      ["no stored time", undefined, true],
      ["a null stored time", null, true],
      ["an unreadable stored time", "yesterday-ish", true],
      ["a stored time that is not a string", 12345, true],
      ["an older stored time", "2026-07-16T11:56:59.999Z", true],
      ["the same stored time", "2026-07-16T11:57:00.000Z", false],
      ["a newer stored time", "2026-07-16T11:57:00.001Z", false],
      ["an older stored Date", new Date("2026-07-16T11:00:00.000Z"), true],
    ])(
      "a poll received at 11:57:00 against %s",
      (_label: string, storedAt: unknown, expected: boolean) => {
        expect(
          NetworkDeviceWalkUtil.isReceivedAfter(RECEIVED_AT, storedAt),
        ).toBe(expected);
      },
    );
  });
});
