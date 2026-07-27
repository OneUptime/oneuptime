import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkDeviceWalkUtil from "../../../../Server/Utils/Monitor/NetworkDeviceWalkUtil";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import NetworkDeviceMetricUtil from "../../../../Server/Utils/Monitor/NetworkDeviceMetricUtil";
import NetworkInventoryUtil from "../../../../Server/Utils/Monitor/NetworkInventoryUtil";
import SnmpInterfaceRateUtil from "../../../../Server/Utils/Monitor/SnmpInterfaceRateUtil";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SnmpMonitorResponse from "../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";

/*
 * NetworkDeviceWalkUtil is the server half of device-owned polling: the
 * device's assigned probe reports each SNMP walk here, and this util
 * computes interface rates against the previous walk, persists the new
 * delta baseline, syncs inventory, emits device-scoped metrics, and fans
 * the walk out to every Network Device monitor referencing the device.
 *
 * These tests mock every collaborator and pin the orchestration contract:
 * the probe-scoping security guard, what flows into each collaborator (and
 * in what order), the lastWalkLog persistence gating, the fan-out
 * filtering, the synthesized ProbeMonitorResponse shape, and the
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

function mockPipeline(options?: {
  device?: NetworkDevice | null | undefined;
  monitors?: Array<Monitor> | undefined;
}): void {
  deviceFindSpy = jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockResolvedValue(
      options && "device" in options ? options.device ?? null : buildDevice(),
    );
  deviceUpdateSpy = jest
    .spyOn(NetworkDeviceService, "updateOneById")
    .mockResolvedValue(undefined);
  monitorFindSpy = jest
    .spyOn(MonitorService, "findBy")
    .mockResolvedValue(options?.monitors || []);
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

async function runWalk(snmpResponse: SnmpMonitorResponse): Promise<void> {
  await NetworkDeviceWalkUtil.processWalkResult({
    probeId: PROBE_ID,
    networkDeviceId: new ObjectID(DEVICE_ID),
    snmpResponse: snmpResponse,
    monitoredAt: MONITORED_AT,
  });
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
    // A plain-JSON snapshot of the walk, not the live object.
    expect(lastWalkLog["snmpResponse"]).toEqual(
      JSON.parse(JSON.stringify(snmpResponse)),
    );
    expect(lastWalkLog["snmpResponse"]).not.toBe(snmpResponse);
    expect(lastWalkLog["monitoredAt"]).toEqual(NOW);
  });

  test("inventory is synced with the device's own projectId/deviceId and the in-flight response", async () => {
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

describe("NetworkDeviceWalkUtil.processWalkResult — fault isolation", () => {
  test("a metrics failure does not break the pipeline: fan-out still happens", async () => {
    const watching: Monitor = buildMonitor({ steps: [buildStep(DEVICE_ID)] });
    mockPipeline({ monitors: [watching] });
    metricsSpy.mockRejectedValue(new Error("clickhouse is down"));

    await expect(runWalk(buildSnmpResponse())).resolves.toBeUndefined();

    expect(monitorFindSpy).toHaveBeenCalledTimes(1);
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
    expect(
      (
        monitorResourceSpy.mock.calls[1][0] as ProbeMonitorResponse
      ).monitorId.toString(),
    ).toBe(second.id!.toString());
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
    const synthesized: ProbeMonitorResponse =
      monitorResourceSpy.mock.calls[0][0];

    expect(synthesized.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(synthesized.monitorId.toString()).toBe(monitor.id!.toString());
    expect(synthesized.monitorStepId.toString()).toBe(step.id.toString());
    expect(synthesized.probeId.toString()).toBe(PROBE_ID.toString());
    expect(synthesized.snmpResponse).toBe(snmpResponse);
    expect(synthesized.isOnline).toBe(false);
    expect(synthesized.responseTimeInMs).toBe(5000);
    expect(synthesized.isTimeout).toBe(true);
    expect(synthesized.failureCause).toBe("SNMP timed out after 3 attempts");
    expect(synthesized.monitoredAt).toEqual(MONITORED_AT);
    expect(synthesized.ingestedAt).toEqual(NOW);
  });

  test("a walk with no failure cause synthesizes an empty string, never undefined", async () => {
    mockPipeline({
      monitors: [buildMonitor({ steps: [buildStep(DEVICE_ID)] })],
    });

    const snmpResponse: SnmpMonitorResponse = buildSnmpResponse();
    delete (snmpResponse as Partial<SnmpMonitorResponse>).failureCause;

    await runWalk(snmpResponse);

    expect(
      (monitorResourceSpy.mock.calls[0][0] as ProbeMonitorResponse)
        .failureCause,
    ).toBe("");
  });
});

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

  test("queries the project's Network Device monitors", async () => {
    mockPipeline();

    await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID],
    });

    expect(monitorFindSpy).toHaveBeenCalledTimes(1);
    const query: JSONObject = monitorFindSpy.mock.calls[0][0].query;
    expect((query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(query["monitorType"]).toBe(MonitorType.NetworkDevice);
  });

  test("keeps only monitors with at least one step referencing a given device, tolerating malformed steps", async () => {
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
});
