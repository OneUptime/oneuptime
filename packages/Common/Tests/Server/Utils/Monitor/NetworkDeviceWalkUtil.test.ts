import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkDeviceWalkUtil, {
  NetworkDevicePingResult,
} from "../../../../Server/Utils/Monitor/NetworkDeviceWalkUtil";
import { NetworkDevicePollMode } from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import NetworkDeviceMetricUtil from "../../../../Server/Utils/Monitor/NetworkDeviceMetricUtil";
import NetworkInventoryUtil from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import SnmpInterfaceRateUtil from "../../../../Server/Utils/Monitor/SnmpInterfaceRateUtil";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorNetworkDeviceService from "../../../../Server/Services/MonitorNetworkDeviceService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorNetworkDevice from "../../../../Models/DatabaseModels/MonitorNetworkDevice";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import PingMonitorResponse from "../../../../Types/Monitor/PingMonitor/PingMonitorResponse";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import {
  NetworkDeviceTransceiver,
  SnmpTransceiverResult,
  TransceiverHealth,
  TransceiverMibSource,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TransceiverHealthUtil from "../../../../Utils/NetworkDevice/TransceiverHealthUtil";
import logger from "../../../../Server/Utils/Logger";
import OnCallPageTiming from "../../../../Server/Utils/OnCall/OnCallPageTiming";

/*
 * NetworkDeviceWalkUtil is the server half of device-owned polling: the
 * device's assigned probe reports each poll here - a ping always, and an
 * SNMP walk as well when the device has credentials - and this util
 * computes interface rates against the previous walk, persists the new
 * delta baseline, syncs inventory, emits device-scoped metrics, and fans
 * the poll out to every Network Device monitor referencing the device.
 *
 * These tests mock every collaborator and pin the orchestration contract:
 * the probe-scoping security guard, what flows into each collaborator (and
 * in what order), the lastWalkLog persistence gating, the fan-out lookup
 * (MonitorNetworkDevice, then the monitors it names), the synthesized
 * ProbeMonitorResponse shape under every ping/walk combination, and the
 * fault-isolation guarantees (metrics/criteria failures never break the
 * pipeline).
 */

const DEVICE_ID: string = "8f2c1f0e-0000-4000-8000-0000000000aa";
const OTHER_DEVICE_ID: string = "9a1b2c3d-0000-4000-8000-0000000000bb";
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const NOW: Date = new Date("2026-07-16T12:00:00.000Z");
const MONITORED_AT: Date = new Date("2026-07-16T11:59:58.000Z");

const PREVIOUS_WALK_LOG: JSONObject = {
  snmpResponse: {
    interfaces: [{ interfaceIndex: 1, inOctets: 1000, outOctets: 2000 }],
  },
  monitoredAt: "2026-07-16T11:55:00.000Z",
};

let deviceFindSpy: jest.SpyInstance;
let deviceUpdateSpy: jest.SpyInstance;
let monitorFindSpy: jest.SpyInstance;
let linkFindSpy: jest.SpyInstance;
let monitorResourceSpy: jest.SpyInstance;
let inventorySpy: jest.SpyInstance;
let metricsSpy: jest.SpyInstance;
let rateSpy: jest.SpyInstance;

function buildDevice(): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = new ObjectID(DEVICE_ID);
  device.projectId = PROJECT_ID;
  device.name = "core-sw-01";
  device.lastWalkLog = PREVIOUS_WALK_LOG;
  return device;
}

/*
 * The fan-out lookup reads MonitorNetworkDevice for the device's rows, then
 * the monitors they name, by id. The mock answers both from `monitors`, the
 * project's Network Device monitors, the way Postgres keeps the table: a row
 * for each device a monitor's steps name. QueryHelper.any is replaced with a
 * sentinel so a query says which ids it asked for.
 */
type MonitorIdsQuery = { __in?: Array<string> };

function rowsNaming(
  monitors: Array<Monitor>,
  deviceIds: Array<string>,
): Array<MonitorNetworkDevice> {
  const rows: Array<MonitorNetworkDevice> = [];

  for (const monitor of monitors) {
    const named: Set<string> = new Set();

    for (const step of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
      []) {
      const deviceId: string | undefined =
        step?.data?.networkDeviceMonitor?.networkDeviceId;

      if (!deviceId || !deviceIds.includes(deviceId) || named.has(deviceId)) {
        continue;
      }

      named.add(deviceId);

      const row: MonitorNetworkDevice = new MonitorNetworkDevice(
        ObjectID.generate(),
      );
      row.monitorId = monitor.id!;
      row.networkDeviceId = new ObjectID(deviceId);
      row.projectId = monitor.projectId!;
      rows.push(row);
    }
  }

  return rows;
}

function mockPipeline(options?: {
  device?: NetworkDevice | null | undefined;
  // The project's Network Device monitors, hand-made or provisioned.
  monitors?: Array<Monitor> | undefined;
}): void {
  deviceFindSpy = jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockResolvedValue(
      options && "device" in options ? options.device ?? null : buildDevice(),
    );
  /*
   * The delta baseline is persisted by a hook-free single-statement UPDATE:
   * the log is ~25 KB of jsonb and the hooked path would re-SELECT (and
   * re-detoast) the previous one before every write. It skips a device
   * another writer holds rather than waiting for it (issue #7194); true:
   * written. See NetworkDeviceWalkLogWritePath.test.ts for the full
   * contract.
   */
  deviceUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateColumnsByIdIfUnlockedWithoutHooks")
    .mockResolvedValue(true);
  jest.spyOn(QueryHelper, "any").mockImplementation(((
    values: Array<string | ObjectID | number>,
  ): MonitorIdsQuery => {
    return {
      __in: values.map((value: string | ObjectID | number) => {
        return value.toString();
      }),
    };
  }) as never);
  linkFindSpy = jest
    .spyOn(MonitorNetworkDeviceService, "findBy")
    .mockImplementation(
      async (
        findBy: FindBy<MonitorNetworkDevice>,
      ): Promise<Array<MonitorNetworkDevice>> => {
        const asked: MonitorIdsQuery | undefined = (
          findBy.query as unknown as JSONObject
        )["networkDeviceId"] as MonitorIdsQuery | undefined;

        return rowsNaming(options?.monitors || [], asked?.__in || []);
      },
    );
  monitorFindSpy = jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation(
      async (findBy: FindBy<Monitor>): Promise<Array<Monitor>> => {
        const asked: MonitorIdsQuery | undefined = (
          findBy.query as unknown as JSONObject
        )["_id"] as MonitorIdsQuery | undefined;

        return (options?.monitors || [])
          .filter((monitor: Monitor) => {
            return (asked?.__in || []).includes(monitor.id!.toString());
          })
          .sort((a: Monitor, b: Monitor) => {
            return a.id!.toString().localeCompare(b.id!.toString());
          });
      },
    );
  monitorResourceSpy = jest
    .spyOn(MonitorResourceUtil, "monitorResource")
    .mockResolvedValue(undefined as never);
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

const OK_PING: NetworkDevicePingResult = {
  isOnline: true,
  avgRttMs: 2.5,
  packetLossPercent: 0,
};

const FAILED_PING: NetworkDevicePingResult = {
  isOnline: false,
  packetLossPercent: 100,
  failureCause: "Request timed out",
};

function buildStep(networkDeviceId: string | undefined): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    ...step.data,
    networkDeviceMonitor:
      networkDeviceId === undefined
        ? undefined
        : {
            networkDeviceId: networkDeviceId,
            monitorInterfaces: true,
            oids: [],
          },
  } as MonitorStep["data"];
  return step;
}

function buildMonitor(options: {
  steps: Array<MonitorStep>;
  disableActiveMonitoring?: boolean | undefined;
  disabledByIncident?: boolean | undefined;
  disabledByMaintenance?: boolean | undefined;
}): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: options.steps,
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = PROJECT_ID;
  monitor.monitorSteps = monitorSteps;
  monitor.disableActiveMonitoring = options.disableActiveMonitoring || false;
  monitor.disableActiveMonitoringBecauseOfManualIncident =
    options.disabledByIncident || false;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent =
    options.disabledByMaintenance || false;
  return monitor;
}

async function runPoll(input: {
  snmpResponse?: SnmpMonitorResponse | undefined;
  isOnline?: boolean | undefined;
  pollMode?: NetworkDevicePollMode | undefined;
  pingResponse?: NetworkDevicePingResult | undefined;
}): Promise<void> {
  await NetworkDeviceWalkUtil.processWalkResult({
    probeId: PROBE_ID,
    networkDeviceId: new ObjectID(DEVICE_ID),
    ...input,
    monitoredAt: MONITORED_AT,
  });
}

/*
 * What a probe that predates ping-first polling reports: a walk and nothing
 * else - no device verdict, no mode, no ping.
 */
async function runWalk(snmpResponse: SnmpMonitorResponse): Promise<void> {
  await runPoll({ snmpResponse: snmpResponse });
}

function synthesized(index: number = 0): ProbeMonitorResponse {
  return monitorResourceSpy.mock.calls[index]![0] as ProbeMonitorResponse;
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkDeviceWalkUtil.processWalkResult — probe-scoping guard", () => {
  test("the device lookup is scoped to the reporting probe", async () => {
    mockPipeline();

    await runWalk(buildSnmpResponse());

    expect(deviceFindSpy).toHaveBeenCalledTimes(1);
    const query: JSONObject = deviceFindSpy.mock.calls[0][0].query;
    expect((query["_id"] as ObjectID).toString()).toBe(DEVICE_ID);
    expect((query["probeId"] as ObjectID).toString()).toBe(PROBE_ID.toString());
  });

  /*
   * The auth middleware only proves the caller is SOME valid probe; a walk
   * for a device the probe is not assigned to must be dropped before any
   * write, or a compromised probe could overwrite another project's
   * inventory and trigger its monitors.
   */
  test("a walk from a probe the device is not assigned to is ignored entirely", async () => {
    mockPipeline({ device: null });

    await runWalk(buildSnmpResponse());

    expect(rateSpy).not.toHaveBeenCalled();
    expect(deviceUpdateSpy).not.toHaveBeenCalled();
    expect(inventorySpy).not.toHaveBeenCalled();
    expect(metricsSpy).not.toHaveBeenCalled();
    expect(monitorFindSpy).not.toHaveBeenCalled();
    expect(monitorResourceSpy).not.toHaveBeenCalled();
  });
});

describe("NetworkDeviceWalkUtil.processWalkResult — happy path", () => {
  test("rates are computed against the device's stored lastWalkLog, before the new baseline is persisted", async () => {
    mockPipeline();
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse();

    await runWalk(snmpResponse);

    expect(rateSpy).toHaveBeenCalledTimes(1);
    // Rates work on the very object the rest of the pipeline consumes.
    expect(rateSpy.mock.calls[0][0].snmpResponse).toBe(snmpResponse);
    expect(rateSpy.mock.calls[0][0].previousWalkLog).toBe(PREVIOUS_WALK_LOG);

    /*
     * Persisting first would make the delta baseline the walk itself —
     * every rate would compute to zero.
     */
    expect(rateSpy.mock.invocationCallOrder[0]).toBeLessThan(
      deviceUpdateSpy.mock.invocationCallOrder[0] as number,
    );
  });

  test("a walk with interfaces persists itself as the next delta baseline", async () => {
    mockPipeline();
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse();

    await runWalk(snmpResponse);

    expect(deviceUpdateSpy).toHaveBeenCalledTimes(1);
    const updateArgs: JSONObject = deviceUpdateSpy.mock.calls[0][0];
    expect((updateArgs["id"] as ObjectID).toString()).toBe(DEVICE_ID);

    const lastWalkLog: JSONObject = (updateArgs["data"] as JSONObject)[
      "lastWalkLog"
    ] as JSONObject;
    const storedResponse: JSONObject = lastWalkLog[
      "snmpResponse"
    ] as JSONObject;

    /*
     * A plain-JSON snapshot of the INTERFACES, not the live object and not
     * the whole walk. SnmpInterfaceRateUtil is the only reader of this column
     * and only ever looks at snmpResponse.interfaces; storing the rest was
     * dead weight rewritten on every poll of every device.
     */
    expect(storedResponse["interfaces"]).toEqual(
      JSON.parse(JSON.stringify(snmpResponse.interfaces)),
    );
    expect(storedResponse["interfaces"]).not.toBe(snmpResponse.interfaces);
    expect(Object.keys(storedResponse)).toEqual(["interfaces"]);
    expect(lastWalkLog["monitoredAt"]).toEqual(NOW);
  });

  test("inventory is synced with the device's own projectId/deviceId, the in-flight response and the mode", async () => {
    mockPipeline();
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse();

    await runWalk(snmpResponse);

    expect(inventorySpy).toHaveBeenCalledTimes(1);
    const inventoryArgs: JSONObject = inventorySpy.mock.calls[0][0];
    expect((inventoryArgs["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((inventoryArgs["deviceId"] as ObjectID).toString()).toBe(DEVICE_ID);
    expect(inventoryArgs["snmpResponse"]).toBe(snmpResponse);
    expect(inventoryArgs["isOnline"]).toBe(true);
    // An old probe only ever walked: its mode is snmp.
    expect(inventoryArgs["pollMode"]).toBe("snmp");
  });

  test("device-scoped metrics are emitted with the device and probe identity", async () => {
    mockPipeline();
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse();

    await runWalk(snmpResponse);

    expect(metricsSpy).toHaveBeenCalledTimes(1);
    const metricArgs: JSONObject = metricsSpy.mock.calls[0][0];
    expect((metricArgs["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((metricArgs["networkDeviceId"] as ObjectID).toString()).toBe(
      DEVICE_ID,
    );
    expect(metricArgs["deviceName"]).toBe("core-sw-01");
    expect((metricArgs["probeId"] as ObjectID).toString()).toBe(
      PROBE_ID.toString(),
    );
    expect(metricArgs["snmpResponse"]).toBe(snmpResponse);
    expect(metricArgs["responseTimeInMs"]).toBe(42);
    expect(metricArgs["isOnline"]).toBe(true);
    expect(metricArgs["pingResponse"]).toBeUndefined();
  });
});

describe("NetworkDeviceWalkUtil.processWalkResult — failed poll", () => {
  /*
   * Keeping the last GOOD counters across failed polls means rates resume
   * with a correct (longer-window) delta instead of losing a cycle.
   */
  test("a poll that walked no interfaces never overwrites the stored baseline", async () => {
    mockPipeline();

    await runWalk(
      buildSnmpResponse({
        isOnline: false,
        isTimeout: true,
        failureCause: "Device did not respond",
        interfaces: undefined,
      }),
    );

    expect(deviceUpdateSpy).not.toHaveBeenCalled();
  });

  test("an empty interface array is treated the same as no interfaces", async () => {
    mockPipeline();

    await runWalk(buildSnmpResponse({ interfaces: [] }));

    expect(deviceUpdateSpy).not.toHaveBeenCalled();
  });

  test("inventory and metrics still run on a failed poll (lastSeenAt gating is inventory's job)", async () => {
    mockPipeline();

    await runWalk(
      buildSnmpResponse({
        isOnline: false,
        isTimeout: true,
        failureCause: "Device did not respond",
        interfaces: undefined,
      }),
    );

    expect(inventorySpy).toHaveBeenCalledTimes(1);
    expect(inventorySpy.mock.calls[0][0]["isOnline"]).toBe(false);
    expect(metricsSpy).toHaveBeenCalledTimes(1);
    expect(metricsSpy.mock.calls[0][0]["isOnline"]).toBe(false);
  });
});

/*
 * Ping-first polling. A ping-first probe reports the device verdict (ping OR
 * walk), the mode, the ping, and the walk only when one ran. What reaches
 * inventory, metrics and the monitors under each combination is the whole
 * contract of "a device without credentials still has a status".
 */
describe("NetworkDeviceWalkUtil.processWalkResult — ping-first polling", () => {
  const EXPECTED_OK_PING: PingMonitorResponse = {
    packetsSent: 0,
    packetsReceived: 0,
    packetLossPercent: 0,
    avgRoundTripTimeInMs: 2.5,
  };

  test("a reachable ping-only poll: no rates, no baseline, inventory and metrics in ping mode with no walk, and the ping carried", async () => {
    mockPipeline();

    await runPoll({ isOnline: true, pollMode: "ping", pingResponse: OK_PING });

    expect(rateSpy).not.toHaveBeenCalled();
    expect(deviceUpdateSpy).not.toHaveBeenCalled();

    const inventoryArgs: JSONObject = inventorySpy.mock.calls[0][0];
    expect(inventoryArgs["snmpResponse"]).toBeUndefined();
    expect(inventoryArgs["isOnline"]).toBe(true);
    expect(inventoryArgs["pollMode"]).toBe("ping");

    const metricArgs: JSONObject = metricsSpy.mock.calls[0][0];
    expect(metricArgs["snmpResponse"]).toBeUndefined();
    // Walk time only: a ping-only poll writes no response-time point.
    expect(metricArgs["responseTimeInMs"]).toBeUndefined();
    expect(metricArgs["isOnline"]).toBe(true);
    expect(metricArgs["pingResponse"]).toEqual(EXPECTED_OK_PING);
  });

  test("the monitor response on a ping-only poll carries NO snmpResponse - never a synthesized failure", async () => {
    const step: MonitorStep = buildStep(DEVICE_ID);
    mockPipeline({ monitors: [buildMonitor({ steps: [step] })] });

    await runPoll({ isOnline: true, pollMode: "ping", pingResponse: OK_PING });

    expect(monitorResourceSpy).toHaveBeenCalledTimes(1);
    const response: ProbeMonitorResponse = synthesized();

    expect(response.snmpResponse).toBeUndefined();
    expect(response.isOnline).toBe(true);
    expect(response.responseTimeInMs).toBeUndefined();
    expect(response.isTimeout).toBeUndefined();
    expect(response.failureCause).toBe("");
    expect(response.pingResponse).toEqual(EXPECTED_OK_PING);
    expect(response.monitorStepId.toString()).toBe(step.id.toString());
    expect(response.monitoredAt).toEqual(MONITORED_AT);
  });

  test("an unreachable ping-only poll: verdict false, the ping's failure cause, still no walk", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });

    await runPoll({
      isOnline: false,
      pollMode: "ping",
      pingResponse: FAILED_PING,
    });

    expect(inventorySpy.mock.calls[0][0]["isOnline"]).toBe(false);
    expect(metricsSpy.mock.calls[0][0]["isOnline"]).toBe(false);

    const response: ProbeMonitorResponse = synthesized();
    expect(response.isOnline).toBe(false);
    expect(response.snmpResponse).toBeUndefined();
    expect(response.failureCause).toBe("Request timed out");
    expect(response.pingResponse?.packetLossPercent).toBe(100);
  });

  test("snmp mode, ping answered, walk failed: the device is Up and the failed walk is the real walk", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });
    const failedWalk: SnmpMonitorResponse = buildSnmpResponse({
      isOnline: false,
      responseTimeInMs: 5000,
      isTimeout: true,
      failureCause: "SNMP timed out after 3 attempts",
      interfaces: undefined,
    });

    await runPoll({
      isOnline: true,
      pollMode: "snmp",
      pingResponse: OK_PING,
      snmpResponse: failedWalk,
    });

    const inventoryArgs: JSONObject = inventorySpy.mock.calls[0][0];
    expect(inventoryArgs["isOnline"]).toBe(true);
    expect(inventoryArgs["pollMode"]).toBe("snmp");
    expect(inventoryArgs["snmpResponse"]).toBe(failedWalk);

    const response: ProbeMonitorResponse = synthesized();
    // The device verdict, not the walk's.
    expect(response.isOnline).toBe(true);
    expect(response.snmpResponse).toBe(failedWalk);
    expect(response.responseTimeInMs).toBe(5000);
    expect(response.isTimeout).toBe(true);
    // The walk's cause is the specific one; the walk-failing alert reads it.
    expect(response.failureCause).toBe("SNMP timed out after 3 attempts");
  });

  /*
   * ICMP-filtered SNMP gear. The walk is the proof of life; the ping's
   * "timed out" is not a failure of anything and must not be surfaced as
   * the poll's failure cause on a device that is Up.
   */
  test("snmp mode, ping failed, walk succeeded: Up, the walk verbatim, and no failure cause from the ping", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });
    const walk: SnmpMonitorResponse = buildSnmpResponse();

    await runPoll({
      isOnline: true,
      pollMode: "snmp",
      pingResponse: FAILED_PING,
      snmpResponse: walk,
    });

    const response: ProbeMonitorResponse = synthesized();
    expect(response.isOnline).toBe(true);
    expect(response.snmpResponse).toBe(walk);
    expect(response.responseTimeInMs).toBe(42);
    expect(response.failureCause).toBe("");
    expect(response.pingResponse?.packetLossPercent).toBe(100);
  });

  test("snmp mode, both failed: Down, the walk's cause first, the ping's when the walk has none", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });

    await runPoll({
      isOnline: false,
      pollMode: "snmp",
      pingResponse: FAILED_PING,
      snmpResponse: buildSnmpResponse({
        isOnline: false,
        failureCause: "SNMP timed out after 3 attempts",
        interfaces: undefined,
      }),
    });

    expect(synthesized().isOnline).toBe(false);
    expect(synthesized().failureCause).toBe("SNMP timed out after 3 attempts");

    monitorResourceSpy.mockClear();

    await runPoll({
      isOnline: false,
      pollMode: "snmp",
      pingResponse: FAILED_PING,
      snmpResponse: buildSnmpResponse({
        isOnline: false,
        failureCause: "",
        interfaces: undefined,
      }),
    });

    expect(synthesized().failureCause).toBe("Request timed out");
  });

  test("an old probe's walk (no verdict, no mode, no ping) derives the verdict from the walk", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });

    await runWalk(
      buildSnmpResponse({ isOnline: false, interfaces: undefined }),
    );

    expect(inventorySpy.mock.calls[0][0]["isOnline"]).toBe(false);
    expect(inventorySpy.mock.calls[0][0]["pollMode"]).toBe("snmp");
    expect(synthesized().isOnline).toBe(false);
    expect(synthesized().pingResponse).toBeUndefined();
  });

  test("an old probe's walk with no verdict at all counts as answered (the inventory's convention)", async () => {
    mockPipeline();

    await runWalk({
      oidResponses: [],
      responseTimeInMs: 5,
    } as unknown as SnmpMonitorResponse);

    expect(inventorySpy.mock.calls[0][0]["isOnline"]).toBe(true);
  });
});

describe("NetworkDeviceWalkUtil.toPingMonitorResponse", () => {
  test("no ping (an old probe) is no response, never an invented one", () => {
    expect(NetworkDeviceWalkUtil.toPingMonitorResponse(undefined)).toBe(
      undefined,
    );
  });

  test("maps the probe's shape onto the Ping monitor's, counts defaulting when the probe did not report them", () => {
    expect(NetworkDeviceWalkUtil.toPingMonitorResponse(OK_PING)).toEqual({
      packetsSent: 0,
      packetsReceived: 0,
      packetLossPercent: 0,
      avgRoundTripTimeInMs: 2.5,
    });

    expect(
      NetworkDeviceWalkUtil.toPingMonitorResponse({
        ...OK_PING,
        packetsSent: 2,
        packetsReceived: 2,
      }),
    ).toEqual({
      packetsSent: 2,
      packetsReceived: 2,
      packetLossPercent: 0,
      avgRoundTripTimeInMs: 2.5,
    });
  });

  test("a ping with no measured loss implies it from the verdict", () => {
    expect(
      NetworkDeviceWalkUtil.toPingMonitorResponse({ isOnline: true })
        ?.packetLossPercent,
    ).toBe(0);
    expect(
      NetworkDeviceWalkUtil.toPingMonitorResponse({ isOnline: false })
        ?.packetLossPercent,
    ).toBe(100);
  });

  test("a non-finite RTT is dropped rather than charted", () => {
    expect(
      NetworkDeviceWalkUtil.toPingMonitorResponse({
        isOnline: true,
        avgRttMs: Number.NaN,
      })?.avgRoundTripTimeInMs,
    ).toBeUndefined();
  });
});

describe("NetworkDeviceWalkUtil.processWalkResult — fault isolation", () => {
  test("a metrics failure does not break the pipeline: fan-out still happens", async () => {
    const watching: Monitor = buildMonitor({ steps: [buildStep(DEVICE_ID)] });
    mockPipeline({ monitors: [watching] });
    metricsSpy.mockRejectedValue(new Error("clickhouse is down"));

    await expect(runWalk(buildSnmpResponse())).resolves.toBeUndefined();

    expect(monitorFindSpy).toHaveBeenCalled();
    expect(monitorResourceSpy).toHaveBeenCalledTimes(1);
  });

  test("one monitor's evaluation failure does not prevent evaluating the next", async () => {
    const first: Monitor = buildMonitor({ steps: [buildStep(DEVICE_ID)] });
    const second: Monitor = buildMonitor({ steps: [buildStep(DEVICE_ID)] });
    mockPipeline({ monitors: [first, second] });
    monitorResourceSpy.mockRejectedValueOnce(
      new Error("criteria evaluation exploded"),
    );

    await expect(runWalk(buildSnmpResponse())).resolves.toBeUndefined();

    // The monitors come back in id order; the one after the failure still runs.
    const [, later] = [first, second].sort((a: Monitor, b: Monitor) => {
      return a.id!.toString().localeCompare(b.id!.toString());
    });

    expect(monitorResourceSpy).toHaveBeenCalledTimes(2);
    expect(synthesized(1).monitorId.toString()).toBe(later!.id!.toString());
  });
});

describe("NetworkDeviceWalkUtil.processWalkResult — monitor fan-out", () => {
  test("only enabled monitors' steps referencing the walked device are evaluated", async () => {
    const watching: Monitor = buildMonitor({ steps: [buildStep(DEVICE_ID)] });
    const disabled: Monitor = buildMonitor({
      steps: [buildStep(DEVICE_ID)],
      disableActiveMonitoring: true,
    });
    const disabledByIncident: Monitor = buildMonitor({
      steps: [buildStep(DEVICE_ID)],
      disabledByIncident: true,
    });
    const disabledByMaintenance: Monitor = buildMonitor({
      steps: [buildStep(DEVICE_ID)],
      disabledByMaintenance: true,
    });
    const watchingOtherDevice: Monitor = buildMonitor({
      steps: [buildStep(OTHER_DEVICE_ID)],
    });
    const watchingTwice: Monitor = buildMonitor({
      steps: [buildStep(DEVICE_ID), buildStep(DEVICE_ID)],
    });
    const watchingBoth: Monitor = buildMonitor({
      steps: [buildStep(DEVICE_ID), buildStep(OTHER_DEVICE_ID)],
    });

    mockPipeline({
      monitors: [
        watching,
        disabled,
        disabledByIncident,
        disabledByMaintenance,
        watchingOtherDevice,
        watchingTwice,
        watchingBoth,
      ],
    });

    await runWalk(buildSnmpResponse());

    // watching(1) + watchingTwice(2) + watchingBoth's matching step(1).
    expect(monitorResourceSpy).toHaveBeenCalledTimes(4);

    const evaluatedMonitorIds: Array<string> =
      monitorResourceSpy.mock.calls.map((call: Array<ProbeMonitorResponse>) => {
        return call[0]!.monitorId.toString();
      });
    // In whatever order the monitors come back (by id, from the lookup).
    expect([...evaluatedMonitorIds].sort()).toEqual(
      [
        watching.id!.toString(),
        watchingTwice.id!.toString(),
        watchingTwice.id!.toString(),
        watchingBoth.id!.toString(),
      ].sort(),
    );

    // The two-step monitor is evaluated once per referencing step.
    const twiceStepIds: Array<string> = monitorResourceSpy.mock.calls
      .filter((call: Array<ProbeMonitorResponse>) => {
        return call[0]!.monitorId.toString() === watchingTwice.id!.toString();
      })
      .map((call: Array<ProbeMonitorResponse>) => {
        return call[0]!.monitorStepId.toString();
      });
    expect(twiceStepIds).toEqual(
      watchingTwice.monitorSteps!.data!.monitorStepsInstanceArray.map(
        (step: MonitorStep) => {
          return step.id.toString();
        },
      ),
    );

    // The mixed monitor is only evaluated for the step watching THIS device.
    const mixedCalls: Array<Array<ProbeMonitorResponse>> =
      monitorResourceSpy.mock.calls.filter(
        (call: Array<ProbeMonitorResponse>) => {
          return call[0]!.monitorId.toString() === watchingBoth.id!.toString();
        },
      );
    expect(mixedCalls).toHaveLength(1);
    expect(mixedCalls[0]![0]!.monitorStepId.toString()).toBe(
      watchingBoth.monitorSteps!.data!.monitorStepsInstanceArray[0]!.id.toString(),
    );
  });

  test("a provisioned monitor is found, and evaluated, like a hand-made one", async () => {
    const provisioned: Monitor = buildMonitor({
      steps: [buildStep(DEVICE_ID)],
    });
    provisioned.autoProvisionedNetworkDeviceId = new ObjectID(DEVICE_ID);
    mockPipeline({ monitors: [provisioned] });

    await runWalk(buildSnmpResponse());

    expect(monitorResourceSpy).toHaveBeenCalledTimes(1);
    expect(synthesized().monitorId.toString()).toBe(provisioned.id!.toString());
  });

  test("the synthesized response carries the walk verbatim into the criteria pipeline", async () => {
    const step: MonitorStep = buildStep(DEVICE_ID);
    const monitor: Monitor = buildMonitor({ steps: [step] });
    mockPipeline({ monitors: [monitor] });

    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
      isOnline: false,
      responseTimeInMs: 5000,
      isTimeout: true,
      failureCause: "SNMP timed out after 3 attempts",
    });

    await runWalk(snmpResponse);

    expect(monitorResourceSpy).toHaveBeenCalledTimes(1);
    const response: ProbeMonitorResponse = synthesized();

    expect(response.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(response.monitorId.toString()).toBe(monitor.id!.toString());
    expect(response.monitorStepId.toString()).toBe(step.id.toString());
    expect(response.probeId.toString()).toBe(PROBE_ID.toString());
    expect(response.snmpResponse).toBe(snmpResponse);
    expect(response.isOnline).toBe(false);
    expect(response.responseTimeInMs).toBe(5000);
    expect(response.isTimeout).toBe(true);
    expect(response.failureCause).toBe("SNMP timed out after 3 attempts");
    expect(response.pingResponse).toBeUndefined();
    expect(response.monitoredAt).toEqual(MONITORED_AT);
    expect(response.ingestedAt).toEqual(NOW);
  });

  test("a walk with no failure cause synthesizes an empty string, never undefined", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });

    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse();
    delete (snmpResponse as Partial<SnmpMonitorResponse>).failureCause;

    await runWalk(snmpResponse);

    expect(synthesized().failureCause).toBe("");
  });
});

/*
 * The fan-out lookup reads MonitorNetworkDevice - the table Postgres keeps
 * from every monitor's steps (MonitorNetworkDevicePostgres pins the
 * triggers) - and then the monitors it names, by id. It never reads the
 * steps of every Network Device monitor in the project, as it did on every
 * poll and every trap.
 */
describe("NetworkDeviceWalkUtil.findMonitorsWatchingDevices", () => {
  function deviceIdsAsked(): Array<Array<string>> {
    return linkFindSpy.mock.calls.map((call: Array<unknown>) => {
      return (
        (
          (call[0] as FindBy<MonitorNetworkDevice>)
            .query as unknown as JSONObject
        )["networkDeviceId"] as MonitorIdsQuery
      ).__in!;
    });
  }

  function monitorIdsAsked(): Array<Array<string>> {
    return monitorFindSpy.mock.calls.map((call: Array<unknown>) => {
      return (
        ((call[0] as FindBy<Monitor>).query as unknown as JSONObject)[
          "_id"
        ] as MonitorIdsQuery
      ).__in!;
    });
  }

  function ids(monitors: Array<Monitor>): Array<string> {
    return monitors.map((monitor: Monitor) => {
      return monitor.id!.toString();
    });
  }

  test("an empty device list asks nothing", async () => {
    mockPipeline();

    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: PROJECT_ID,
        deviceIds: [],
      });

    expect(monitors).toEqual([]);
    expect(linkFindSpy).not.toHaveBeenCalled();
    expect(monitorFindSpy).not.toHaveBeenCalled();
  });

  test("ids that are not ids are dropped, and a list of only those asks nothing", async () => {
    mockPipeline();

    await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
      projectId: PROJECT_ID,
      deviceIds: ["", "not-a-uuid", "'; DROP TABLE x; --"],
    });

    expect(linkFindSpy).not.toHaveBeenCalled();
  });

  test("asks the table for the device's rows in the project, as root, sorted and paged", async () => {
    mockPipeline();

    await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
    });

    expect(linkFindSpy).toHaveBeenCalledTimes(1);

    const findBy: FindBy<MonitorNetworkDevice> = linkFindSpy.mock
      .calls[0]![0] as FindBy<MonitorNetworkDevice>;
    const query: JSONObject = findBy.query as unknown as JSONObject;

    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((query["networkDeviceId"] as MonitorIdsQuery).__in).toEqual([
      DEVICE_ID,
      OTHER_DEVICE_ID,
    ]);
    expect(query["_id"]).toBeUndefined();
    expect((findBy.sort as unknown as JSONObject)["_id"]).toBe(
      SortOrder.Ascending,
    );
    expect(findBy.limit).toBe(LIMIT_MAX);
    expect(findBy.skip).toBe(0);
    expect(findBy.props.isRoot).toBe(true);
    expect(findBy.select).toEqual({ _id: true, monitorId: true });
  });

  test("a device no monitor watches reads no monitor", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(OTHER_DEVICE_ID)] })],
    });

    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID],
      });

    expect(monitors).toEqual([]);
    expect(monitorFindSpy).not.toHaveBeenCalled();
  });

  test("reads the monitors it names by id, in the project, as Network Device monitors, with their steps and pause flags", async () => {
    const watching: Monitor = buildMonitor({ steps: [buildStep(DEVICE_ID)] });
    mockPipeline({ monitors: [watching] });

    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID],
      });

    expect(ids(monitors)).toEqual([watching.id!.toString()]);
    expect(monitorFindSpy).toHaveBeenCalledTimes(1);

    const findBy: FindBy<Monitor> = monitorFindSpy.mock
      .calls[0]![0] as FindBy<Monitor>;
    const query: JSONObject = findBy.query as unknown as JSONObject;

    expect((query["_id"] as MonitorIdsQuery).__in).toEqual([
      watching.id!.toString(),
    ]);
    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(query["monitorType"]).toBe(MonitorType.NetworkDevice);
    expect(findBy.props.isRoot).toBe(true);
    expect(findBy.limit).toBe(1);
    expect(findBy.select).toMatchObject({
      _id: true,
      projectId: true,
      monitorSteps: true,
      isArchived: true,
      disableActiveMonitoring: true,
      disableActiveMonitoringBecauseOfManualIncident: true,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
    });
  });

  test("never reads Network Device monitors by project: every monitor read names its ids", async () => {
    mockPipeline({
      monitors: [
        buildMonitor({ steps: [buildStep(DEVICE_ID)] }),
        buildMonitor({ steps: [buildStep(OTHER_DEVICE_ID)] }),
      ],
    });

    await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID],
    });

    for (const call of monitorFindSpy.mock.calls) {
      const query: JSONObject = (call[0] as FindBy<Monitor>)
        .query as unknown as JSONObject;

      expect(query["_id"]).toBeDefined();
      expect(query["autoProvisionedNetworkDeviceId"]).toBeUndefined();
    }
  });

  test("a monitor that watches several of the devices is read once", async () => {
    const both: Monitor = buildMonitor({
      steps: [buildStep(DEVICE_ID), buildStep(OTHER_DEVICE_ID)],
    });
    const one: Monitor = buildMonitor({ steps: [buildStep(OTHER_DEVICE_ID)] });
    mockPipeline({ monitors: [both, one] });

    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
      });

    expect(ids(monitors).sort()).toEqual(
      [both.id!.toString(), one.id!.toString()].sort(),
    );
    expect(monitorIdsAsked()).toHaveLength(1);
    expect(monitorIdsAsked()[0]).toHaveLength(2);
  });

  test("a device named twice is asked about once", async () => {
    mockPipeline();

    await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID, DEVICE_ID, OTHER_DEVICE_ID, DEVICE_ID],
    });

    expect(deviceIdsAsked()).toEqual([[DEVICE_ID, OTHER_DEVICE_ID]]);
  });

  test("a page of the stale poll check is asked about in chunks", async () => {
    mockPipeline();

    const devices: Array<string> = Array.from(
      { length: NetworkDeviceWalkUtil.FAN_OUT_ID_CHUNK_SIZE * 2 + 1 },
      () => {
        return ObjectID.generate().toString();
      },
    );

    await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
      projectId: PROJECT_ID,
      deviceIds: devices,
    });

    expect(
      deviceIdsAsked().map((chunk: Array<string>) => {
        return chunk.length;
      }),
    ).toEqual([
      NetworkDeviceWalkUtil.FAN_OUT_ID_CHUNK_SIZE,
      NetworkDeviceWalkUtil.FAN_OUT_ID_CHUNK_SIZE,
      1,
    ]);
    expect(deviceIdsAsked().flat()).toEqual(devices);
  });

  test("the monitors found are read in chunks too, and come back in id order", async () => {
    const monitors: Array<Monitor> = Array.from(
      { length: NetworkDeviceWalkUtil.FAN_OUT_ID_CHUNK_SIZE + 3 },
      () => {
        return buildMonitor({ steps: [buildStep(DEVICE_ID)] });
      },
    );
    mockPipeline({ monitors: monitors });

    const found: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID],
      });

    expect(
      monitorIdsAsked().map((chunk: Array<string>) => {
        return chunk.length;
      }),
    ).toEqual([NetworkDeviceWalkUtil.FAN_OUT_ID_CHUNK_SIZE, 3]);
    expect(ids(found)).toEqual(ids(monitors).sort());
  });

  test("a full page of rows asks for the next one, after the last row's id", async () => {
    mockPipeline();

    const lastRowId: ObjectID = ObjectID.generate();
    const fullPage: Array<MonitorNetworkDevice> = Array.from(
      { length: LIMIT_MAX },
      (_value: unknown, index: number) => {
        const row: MonitorNetworkDevice = new MonitorNetworkDevice(
          index === LIMIT_MAX - 1 ? lastRowId : ObjectID.generate(),
        );
        row.monitorId = ObjectID.generate();
        return row;
      },
    );
    const straggler: MonitorNetworkDevice = new MonitorNetworkDevice(
      ObjectID.generate(),
    );
    straggler.monitorId = ObjectID.generate();

    const greaterThan: jest.SpyInstance = jest
      .spyOn(QueryHelper, "greaterThan")
      .mockImplementation(((value: ObjectID) => {
        return { __after: value.toString() };
      }) as never);

    linkFindSpy.mockImplementation(
      async (
        findBy: FindBy<MonitorNetworkDevice>,
      ): Promise<Array<MonitorNetworkDevice>> => {
        return (findBy.query as unknown as JSONObject)["_id"]
          ? [straggler]
          : fullPage;
      },
    );
    monitorFindSpy.mockResolvedValue([]);

    await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID],
    });

    expect(linkFindSpy).toHaveBeenCalledTimes(2);
    expect(greaterThan).toHaveBeenCalledWith(lastRowId);
    expect(
      (
        (linkFindSpy.mock.calls[1]![0] as FindBy<MonitorNetworkDevice>)
          .query as unknown as JSONObject
      )["_id"],
    ).toEqual({ __after: lastRowId.toString() });

    // Every row's monitor is read: the first page's and the straggler's.
    expect(monitorIdsAsked().flat()).toHaveLength(LIMIT_MAX + 1);
  });

  test("columns a caller adds are read as well", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });

    await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID],
      select: { createdAt: true },
    });

    expect(
      (monitorFindSpy.mock.calls[0]![0] as FindBy<Monitor>).select,
    ).toMatchObject({ createdAt: true, monitorSteps: true });
  });

  test("a monitor provisioned for the device is found like a hand-made one, and so is one whose steps were edited to name it", async () => {
    const provisioned: Monitor = buildMonitor({
      steps: [buildStep(DEVICE_ID)],
    });
    provisioned.autoProvisionedNetworkDeviceId = new ObjectID(DEVICE_ID);

    // Provisioned for another device, then edited to watch this one.
    const edited: Monitor = buildMonitor({ steps: [buildStep(DEVICE_ID)] });
    edited.autoProvisionedNetworkDeviceId = new ObjectID(OTHER_DEVICE_ID);

    mockPipeline({ monitors: [provisioned, edited] });

    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID],
      });

    expect(ids(monitors).sort()).toEqual(
      [provisioned.id!.toString(), edited.id!.toString()].sort(),
    );
  });
});

/*
 * Transceivers ride the same pipeline: the probe's readings are folded into
 * what the device had stored (TransceiverHealthUtil.mergeSnapshot) before
 * inventory stores them and the monitors judge them, so a pulled optic is
 * told apart from one still in place and its received power has a history.
 */
function opticReading(
  interfaceIndex: number,
  rxPowerDbm: number,
): SnmpTransceiverResult {
  return {
    interfaceIndex: interfaceIndex,
    vendor: "FS",
    partNumber: "SFP-10GLR-31",
    serialNumber: `S${interfaceIndex}`,
    measurements: {
      rxPower: {
        readings: [{ value: rxPowerDbm }],
        thresholds: {
          lowAlarm: -18.4,
          lowWarning: -14.4,
          highWarning: 0.5,
          highAlarm: 2.5,
        },
      },
    },
    source: TransceiverMibSource.CiscoEntitySensor,
  };
}

function storedOptic(
  overrides: Partial<NetworkDeviceTransceiver> = {},
): NetworkDeviceTransceiver {
  return {
    interfaceIndex: 1,
    interfaceName: "GigabitEthernet0/1",
    isPresent: true,
    serialNumber: "S1",
    measurements: {},
    health: TransceiverHealth.NotJudged,
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: "2026-07-16T11:55:00.000Z",
    ...overrides,
  };
}

function deviceStoring(
  snapshot: Array<NetworkDeviceTransceiver> | undefined,
): NetworkDevice {
  const device: NetworkDevice = buildDevice();
  if (snapshot) {
    device.transceiverSnapshot = snapshot;
  }
  return device;
}

describe("NetworkDeviceWalkUtil.applyTransceivers", () => {
  test("this poll's optics are merged, put on the response and returned for storing", () => {
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
      transceiverResults: [opticReading(1, -4.2)],
      transceiverSource: TransceiverMibSource.CiscoEntitySensor,
    });

    const merged: Array<NetworkDeviceTransceiver> | undefined =
      NetworkDeviceWalkUtil.applyTransceivers({
        device: deviceStoring(undefined),
        snmpResponse: snmpResponse,
        now: NOW,
      });

    expect(merged).toHaveLength(1);
    expect(merged![0]).toMatchObject({
      interfaceIndex: 1,
      interfaceName: "GigabitEthernet0/1",
      isPresent: true,
      health: TransceiverHealth.Healthy,
      firstSeenAt: NOW.toISOString(),
    });
    expect(snmpResponse.transceivers).toEqual(merged);
    // Copies: pruning the response for a muted port never edits what is stored.
    expect(snmpResponse.transceivers![0]).not.toBe(merged![0]);
  });

  test("an optic gone since the stored snapshot is not detected on the response too", () => {
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
      transceiverResults: [],
      transceiverSource: TransceiverMibSource.CiscoEntitySensor,
    });

    const merged: Array<NetworkDeviceTransceiver> | undefined =
      NetworkDeviceWalkUtil.applyTransceivers({
        device: deviceStoring([storedOptic()]),
        snmpResponse: snmpResponse,
        now: NOW,
      });

    expect(merged![0]!.isPresent).toBe(false);
    expect(merged![0]!.missingPolls).toBe(1);
    expect(snmpResponse.transceivers![0]!.health).toBe(
      TransceiverHealth.NotDetected,
    );
  });

  test("a read that failed judges the stored optics and stores nothing new", () => {
    const stored: NetworkDeviceTransceiver = storedOptic({
      isPresent: false,
      health: TransceiverHealth.NotDetected,
      missingPolls: 4,
      missingSince: "2026-07-16T11:40:00.000Z",
    });
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
      transceiverWalkFailure: "Transceiver walk timed out",
    });

    expect(
      NetworkDeviceWalkUtil.applyTransceivers({
        device: deviceStoring([stored]),
        snmpResponse: snmpResponse,
        now: NOW,
      }),
    ).toBeUndefined();

    // The open "not detected" alert stays open rather than flapping.
    expect(snmpResponse.transceivers).toEqual([stored]);
  });

  test("an agent that answered nothing at all where it used to report optics is a failed read", () => {
    const stored: NetworkDeviceTransceiver = storedOptic();
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
      transceiverResults: [],
    });

    expect(
      NetworkDeviceWalkUtil.applyTransceivers({
        device: deviceStoring([stored]),
        snmpResponse: snmpResponse,
        now: NOW,
      }),
    ).toBeUndefined();
    expect(snmpResponse.transceivers).toEqual([stored]);
  });

  test("a device with no optics at all is judged as having none", () => {
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
      transceiverResults: [],
      transceiverSource: TransceiverMibSource.EntitySensor,
    });

    expect(
      NetworkDeviceWalkUtil.applyTransceivers({
        device: deviceStoring(undefined),
        snmpResponse: snmpResponse,
        now: NOW,
      }),
    ).toBeUndefined();
    expect(snmpResponse.transceivers).toEqual([]);
  });

  test("a poll that did not read optics (an older probe) leaves the criteria unevaluated", () => {
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse();

    expect(
      NetworkDeviceWalkUtil.applyTransceivers({
        device: deviceStoring([storedOptic()]),
        snmpResponse: snmpResponse,
        now: NOW,
      }),
    ).toBeUndefined();
    expect(snmpResponse.transceivers).toBeUndefined();
  });

  test("a failed walk or no walk judges nothing", () => {
    const failed: SnmpMonitorResponse = buildSnmpResponse({
      isOnline: false,
      transceiverResults: [opticReading(1, -4)],
    });

    expect(
      NetworkDeviceWalkUtil.applyTransceivers({
        device: deviceStoring([storedOptic()]),
        snmpResponse: failed,
        now: NOW,
      }),
    ).toBeUndefined();
    expect(failed.transceivers).toBeUndefined();

    expect(
      NetworkDeviceWalkUtil.applyTransceivers({
        device: deviceStoring([storedOptic()]),
        snmpResponse: undefined,
        now: NOW,
      }),
    ).toBeUndefined();
  });

  test("only the server judges optics: whatever a probe sent as judged is dropped", () => {
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
      transceivers: [storedOptic({ health: TransceiverHealth.Alarm })],
    });

    NetworkDeviceWalkUtil.applyTransceivers({
      device: deviceStoring(undefined),
      snmpResponse: snmpResponse,
      now: NOW,
    });

    expect(snmpResponse.transceivers).toBeUndefined();
  });

  test("a damaged stored snapshot is read as nothing stored", () => {
    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse({
      transceiverResults: [opticReading(1, -4)],
      transceiverSource: TransceiverMibSource.CiscoEntitySensor,
    });

    expect(
      NetworkDeviceWalkUtil.applyTransceivers({
        device: deviceStoring({
          not: "an array",
        } as unknown as Array<NetworkDeviceTransceiver>),
        snmpResponse: snmpResponse,
        now: NOW,
      }),
    ).toHaveLength(1);
  });
});

describe("NetworkDeviceWalkUtil.processWalkResult — transceivers", () => {
  test("the device lookup reads the stored transceiver snapshot", async () => {
    mockPipeline();

    await runWalk(buildSnmpResponse());

    expect(deviceFindSpy.mock.calls[0][0].select.transceiverSnapshot).toBe(
      true,
    );
  });

  test("the merged snapshot is stored through inventory and judged by every watching monitor", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });

    await runWalk(
      buildSnmpResponse({
        transceiverResults: [opticReading(1, -19.2)],
        transceiverSource: TransceiverMibSource.CiscoEntitySensor,
      }),
    );

    const stored: Array<NetworkDeviceTransceiver> =
      inventorySpy.mock.calls[0][0].transceiverSnapshot;

    expect(stored).toHaveLength(1);
    expect(stored[0]!.health).toBe(TransceiverHealth.Alarm);
    expect(synthesized().snmpResponse!.transceivers).toEqual(stored);
  });

  test("the raw readings are charted, then not carried into every monitor's log", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });
    let chartedReadings: unknown = undefined;
    metricsSpy.mockImplementation(async (args: JSONObject): Promise<void> => {
      chartedReadings = (args["snmpResponse"] as unknown as SnmpMonitorResponse)
        .transceiverResults;
    });

    await runWalk(
      buildSnmpResponse({
        transceiverResults: [opticReading(1, -4)],
        transceiverSource: TransceiverMibSource.CiscoEntitySensor,
      }),
    );

    expect(chartedReadings).toEqual([opticReading(1, -4)]);
    expect(synthesized().snmpResponse!.transceiverResults).toBeUndefined();
    expect(synthesized().snmpResponse!.transceivers).toHaveLength(1);
    expect(synthesized().snmpResponse!.transceiverSource).toBe(
      TransceiverMibSource.CiscoEntitySensor,
    );
  });

  test("a poll that did not read optics leaves the stored snapshot alone", async () => {
    mockPipeline({ device: deviceStoring([storedOptic()]) });

    await runWalk(buildSnmpResponse());

    expect(inventorySpy.mock.calls[0][0].transceiverSnapshot).toBeUndefined();
  });

  test("a failure judging optics is logged and never breaks the poll", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });
    jest
      .spyOn(TransceiverHealthUtil, "mergeSnapshot")
      .mockImplementation(() => {
        throw new Error("bad snapshot");
      });
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined as never;
      });

    await expect(
      runWalk(
        buildSnmpResponse({
          transceiverResults: [opticReading(1, -4)],
          transceiverSource: TransceiverMibSource.CiscoEntitySensor,
        }),
      ),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    expect(inventorySpy).toHaveBeenCalledTimes(1);
    expect(inventorySpy.mock.calls[0][0].transceiverSnapshot).toBeUndefined();
    expect(metricsSpy).toHaveBeenCalledTimes(1);
    expect(monitorResourceSpy).toHaveBeenCalledTimes(1);
    expect(synthesized().snmpResponse!.transceivers).toBeUndefined();
  });
});

/*
 * A device polled at a DNS name has no IP address of its own anywhere; its
 * ping reports the address the name resolved to (issue #5185). The walk
 * hands that, with the probe that polled, to the inventory, which records it.
 */
describe("NetworkDeviceWalkUtil.processWalkResult - the address the ping resolved", () => {
  test("the ping's name and address, and the probe, reach the inventory", async () => {
    mockPipeline();

    await runPoll({
      isOnline: true,
      pollMode: "ping",
      pingResponse: {
        ...OK_PING,
        resolvedHost: "core-fw-01.acme.example",
        resolvedAddress: "10.0.0.1",
      },
    });

    const inventoryArgs: JSONObject = inventorySpy.mock.calls[0][0];
    expect(inventoryArgs["dnsResolution"]).toEqual({
      hostname: "core-fw-01.acme.example",
      address: "10.0.0.1",
    });
    expect((inventoryArgs["probeId"] as ObjectID).toString()).toBe(
      PROBE_ID.toString(),
    );
  });

  test("a ping of an address resolves nothing: no name, no address", async () => {
    mockPipeline();

    await runPoll({ isOnline: true, pollMode: "ping", pingResponse: OK_PING });

    expect(inventorySpy.mock.calls[0][0]["dnsResolution"]).toEqual({
      hostname: undefined,
      address: undefined,
    });
  });

  test("an older probe sends no ping: no resolution at all", async () => {
    mockPipeline();

    await runWalk(buildSnmpResponse());

    expect(inventorySpy.mock.calls[0][0]["dnsResolution"]).toBeUndefined();
  });

  test("values out of a probe's JSON that are not text are dropped", async () => {
    mockPipeline();

    await runPoll({
      isOnline: true,
      pollMode: "ping",
      pingResponse: {
        ...OK_PING,
        resolvedHost: 42 as unknown as string,
        resolvedAddress: { ip: "10.0.0.1" } as unknown as string,
      },
    });

    expect(inventorySpy.mock.calls[0][0]["dnsResolution"]).toEqual({
      hostname: undefined,
      address: undefined,
    });
  });
});

/*
 * WHEN ONEUPTIME RECEIVED THE POLL (dataReceivedAt, issue #6647): the probe
 * ingest worker hands over the moment the ingest API received it, and every
 * monitor the poll fans out to evaluates it as received then - a page its
 * evaluation starts is timed from it (OnCallPageTiming). A poll handed no
 * moment evaluates as before, with no such field at all.
 */
describe("NetworkDeviceWalkUtil.processWalkResult — when OneUptime received the poll", () => {
  const RECEIVED_AT: Date = new Date("2026-07-16T11:59:59.000Z");

  test("every monitor step the poll fans out to evaluates it as received then", async () => {
    mockPipeline({
      monitors: [
        buildMonitor({ steps: [buildStep(DEVICE_ID), buildStep(DEVICE_ID)] }),
        buildMonitor({ steps: [buildStep(DEVICE_ID)] }),
      ],
    });

    await NetworkDeviceWalkUtil.processWalkResult({
      probeId: PROBE_ID,
      networkDeviceId: new ObjectID(DEVICE_ID),
      snmpResponse: buildSnmpResponse(),
      monitoredAt: MONITORED_AT,
      dataReceivedAt: RECEIVED_AT,
    });

    expect(monitorResourceSpy).toHaveBeenCalledTimes(3);

    for (let index: number = 0; index < 3; index++) {
      const response: ProbeMonitorResponse = synthesized(index);

      expect(response.dataReceivedAt).toEqual(RECEIVED_AT);
      expect(OnCallPageTiming.getMonitorDataReceivedAt(response)).toEqual(
        RECEIVED_AT,
      );
      // The probe's clock and the evaluation's stay what they were.
      expect(response.monitoredAt).toEqual(MONITORED_AT);
      expect(response.ingestedAt).toEqual(NOW);
    }
  });

  test("a ping's verdict with no walk too", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });

    await NetworkDeviceWalkUtil.processWalkResult({
      probeId: PROBE_ID,
      networkDeviceId: new ObjectID(DEVICE_ID),
      isOnline: false,
      pollMode: "ping",
      monitoredAt: MONITORED_AT,
      dataReceivedAt: RECEIVED_AT,
    });

    expect(synthesized().dataReceivedAt).toEqual(RECEIVED_AT);
  });

  test("a poll handed no moment evaluates as before: no such field at all", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });

    await runWalk(buildSnmpResponse());

    expect("dataReceivedAt" in synthesized()).toBe(false);
    expect(
      OnCallPageTiming.getMonitorDataReceivedAt(synthesized()),
    ).toBeUndefined();
  });
});
