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
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
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
 * (indexed column UNION legacy step JSON, deduped), the synthesized
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
 * The fan-out lookup issues two queries on the same column and the mock
 * has to tell them apart: QueryHelper.any / isNull are replaced with
 * sentinels so the query object says which it is.
 */
type MonitorLinkQuery = { __in?: Array<string>; __isNull?: true };

function linkQueryOf(findBy: FindBy<Monitor>): MonitorLinkQuery | undefined {
  return (findBy.query as unknown as JSONObject)[
    "autoProvisionedNetworkDeviceId"
  ] as MonitorLinkQuery | undefined;
}

function mockPipeline(options?: {
  device?: NetworkDevice | null | undefined;
  // Hand-made monitors: linked to the device only through their step JSON.
  monitors?: Array<Monitor> | undefined;
  // Provisioned monitors: linked through autoProvisionedNetworkDeviceId.
  indexedMonitors?: Array<Monitor> | undefined;
}): void {
  deviceFindSpy = jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockResolvedValue(
      options && "device" in options ? options.device ?? null : buildDevice(),
    );
  /*
   * The delta baseline is persisted by a hook-free single-statement UPDATE:
   * the log is ~25 KB of jsonb and the hooked path would re-SELECT (and
   * re-detoast) the previous one before every write. See
   * NetworkDeviceWalkLogWritePath.test.ts for the full contract.
   */
  deviceUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined);
  jest.spyOn(QueryHelper, "any").mockImplementation(((
    values: Array<string | ObjectID | number>,
  ): MonitorLinkQuery => {
    return {
      __in: values.map((value: string | ObjectID | number) => {
        return value.toString();
      }),
    };
  }) as never);
  jest
    .spyOn(QueryHelper, "isNull")
    .mockReturnValue({ __isNull: true } as never);
  monitorFindSpy = jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation(
      async (findBy: FindBy<Monitor>): Promise<Array<Monitor>> => {
        const link: MonitorLinkQuery | undefined = linkQueryOf(findBy);

        if (link?.__isNull) {
          return options?.monitors || [];
        }

        if (link?.__in) {
          return options?.indexedMonitors || [];
        }

        return [];
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

function monitorFindCalls(kind: "indexed" | "legacy"): Array<FindBy<Monitor>> {
  return monitorFindSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as FindBy<Monitor>;
    })
    .filter((findBy: FindBy<Monitor>) => {
      const link: MonitorLinkQuery | undefined = linkQueryOf(findBy);
      return kind === "legacy" ? Boolean(link?.__isNull) : Boolean(link?.__in);
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

    expect(monitorResourceSpy).toHaveBeenCalledTimes(2);
    expect(synthesized(1).monitorId.toString()).toBe(second.id!.toString());
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
    expect(evaluatedMonitorIds).toEqual([
      watching.id!.toString(),
      watchingTwice.id!.toString(),
      watchingTwice.id!.toString(),
      watchingBoth.id!.toString(),
    ]);

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

  test("a provisioned monitor found through its column is evaluated like a hand-made one", async () => {
    const provisioned: Monitor = buildMonitor({
      steps: [buildStep(DEVICE_ID)],
    });
    mockPipeline({ indexedMonitors: [provisioned] });

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
 * The fan-out lookup is the prerequisite for alert policies: a walk must
 * find the monitors watching its device by an indexed column, not by
 * scanning every Network Device monitor's step JSON in the project. The
 * scan survives, paged and restricted to rows the index cannot serve, for
 * hand-made monitors that carry the link only in their steps.
 */
describe("NetworkDeviceWalkUtil.findMonitorsWatchingDevices", () => {
  test("an empty device list short-circuits without querying", async () => {
    mockPipeline();

    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: PROJECT_ID,
        deviceIds: [],
      });

    expect(monitors).toEqual([]);
    expect(monitorFindSpy).not.toHaveBeenCalled();
  });

  test("issues an indexed query on the device column and a legacy scan restricted to unlinked rows, both scoped, sorted and paged", async () => {
    mockPipeline();

    await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
    });

    const indexed: Array<FindBy<Monitor>> = monitorFindCalls("indexed");
    const legacy: Array<FindBy<Monitor>> = monitorFindCalls("legacy");
    expect(indexed).toHaveLength(1);
    expect(legacy).toHaveLength(1);

    expect(linkQueryOf(indexed[0]!)?.__in).toEqual([
      DEVICE_ID,
      OTHER_DEVICE_ID,
    ]);
    expect(linkQueryOf(legacy[0]!)?.__isNull).toBe(true);

    for (const findBy of [indexed[0]!, legacy[0]!]) {
      const query: JSONObject = findBy.query as unknown as JSONObject;
      expect((query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(query["monitorType"]).toBe(MonitorType.NetworkDevice);
      expect((findBy.sort as unknown as JSONObject)["_id"]).toBe(
        SortOrder.Ascending,
      );
      expect(findBy.limit).toBe(LIMIT_MAX);
      expect(findBy.skip).toBe(0);
      expect(findBy.props.isRoot).toBe(true);
      expect((findBy.select as unknown as JSONObject)["monitorSteps"]).toBe(
        true,
      );
    }
  });

  test("keeps only legacy monitors with at least one step referencing a given device, tolerating malformed steps", async () => {
    const watching: Monitor = buildMonitor({ steps: [buildStep(DEVICE_ID)] });
    const watchingOther: Monitor = buildMonitor({
      steps: [buildStep(OTHER_DEVICE_ID)],
    });
    const mixedSteps: Monitor = buildMonitor({
      steps: [buildStep(undefined), buildStep(DEVICE_ID)],
    });

    // Degenerate rows must be skipped, not crash the filter.
    const noSteps: Monitor = new Monitor();
    noSteps.id = ObjectID.generate();
    noSteps.projectId = PROJECT_ID;

    const stepsWithoutData: Monitor = buildMonitor({ steps: [] });
    stepsWithoutData.monitorSteps!.data = undefined;

    const stepWithoutData: MonitorStep = new MonitorStep();
    stepWithoutData.data = undefined;
    const stepDataMissing: Monitor = buildMonitor({
      steps: [stepWithoutData],
    });

    const noDeviceReference: Monitor = buildMonitor({
      steps: [buildStep(undefined)],
    });

    mockPipeline({
      monitors: [
        watching,
        watchingOther,
        mixedSteps,
        noSteps,
        stepsWithoutData,
        stepDataMissing,
        noDeviceReference,
      ],
    });

    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID],
      });

    expect(
      monitors.map((monitor: Monitor) => {
        return monitor.id!.toString();
      }),
    ).toEqual([watching.id!.toString(), mixedSteps.id!.toString()]);
  });

  test("matches monitors referencing ANY of the given devices", async () => {
    const watchingFirst: Monitor = buildMonitor({
      steps: [buildStep(DEVICE_ID)],
    });
    const watchingSecond: Monitor = buildMonitor({
      steps: [buildStep(OTHER_DEVICE_ID)],
    });
    mockPipeline({ monitors: [watchingFirst, watchingSecond] });

    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
      });

    expect(monitors).toHaveLength(2);
  });

  test("unions the indexed and legacy results, indexed first, deduped by id", async () => {
    const provisioned: Monitor = buildMonitor({
      steps: [buildStep(DEVICE_ID)],
    });
    const handMade: Monitor = buildMonitor({ steps: [buildStep(DEVICE_ID)] });

    /*
     * A row cannot really be in both sets (the legacy scan is restricted to
     * NULL links), but the union must not depend on that: a monitor the
     * indexed query returned is never evaluated twice.
     */
    mockPipeline({
      indexedMonitors: [provisioned],
      monitors: [provisioned, handMade],
    });

    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID],
      });

    expect(
      monitors.map((monitor: Monitor) => {
        return monitor.id!.toString();
      }),
    ).toEqual([provisioned.id!.toString(), handMade.id!.toString()]);
  });

  test("the legacy scan pages until a short page, and finds a monitor on the second page", async () => {
    mockPipeline();

    const firstPage: Array<Monitor> = Array.from({ length: LIMIT_MAX }, () => {
      return buildMonitor({ steps: [buildStep(OTHER_DEVICE_ID)] });
    });
    const straggler: Monitor = buildMonitor({ steps: [buildStep(DEVICE_ID)] });

    monitorFindSpy.mockImplementation(
      async (findBy: FindBy<Monitor>): Promise<Array<Monitor>> => {
        if (linkQueryOf(findBy)?.__in) {
          return [];
        }

        return (findBy.skip as number) === 0 ? firstPage : [straggler];
      },
    );

    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID],
      });

    const legacy: Array<FindBy<Monitor>> = monitorFindCalls("legacy");
    expect(legacy).toHaveLength(2);
    expect(legacy[0]!.skip).toBe(0);
    expect(legacy[1]!.skip).toBe(LIMIT_MAX);

    expect(monitors).toHaveLength(1);
    expect(monitors[0]!.id!.toString()).toBe(straggler.id!.toString());
  });
});
