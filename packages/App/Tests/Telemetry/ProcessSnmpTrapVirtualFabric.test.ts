/*
 * A Brocade chassis with Virtual Fabrics, its traps through the probe's
 * SNMPv3 trap receiver (#11005) and on to the right logical switch
 * (#11014).
 *
 * The chassis' logical switches share its management address, and each is
 * its own NetworkDevice, polled in its own SNMPv3 context (VF:128, VF:20).
 * Fabric OS sends each logical switch's traps over SNMPv3 in that switch's
 * context, and the probe forwards the context with the trap: the trap is
 * that logical switch's, and fires that device's monitors alone - not every
 * device at the address, as a trap that names no context still does.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Mock } from "jest-mock";
import { processSnmpTrapFromQueue } from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import { ProbeIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import SnmpTrapLogWriter from "../../FeatureSet/Telemetry/Services/SnmpTrapLogWriter";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ProbeService from "Common/Server/Services/ProbeService";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDeviceWalkUtil from "Common/Server/Utils/Monitor/NetworkDeviceWalkUtil";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import ObjectID from "Common/Types/ObjectID";

type AnyMock = Mock<(...args: Array<any>) => any>;
type DnsCache = { resolve: (hostname: string) => Promise<Array<string>> };

const PROBE_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const CHASSIS: string = "10.20.0.5";

const monitorResource: AnyMock =
  MonitorResourceUtil.monitorResource as unknown as AnyMock;

// swFCPortScn, as Fabric OS sends it over SNMPv3.
function trapJob(contextName: string | undefined): ProbeIngestJobData {
  const snmpTrap: JSONObject = {
    sourceIpAddress: CHASSIS,
    trapOid: "1.3.6.1.4.1.1588.2.1.1.1.0.3",
    snmpVersion: "v3",
    securityName: "oneuptime",
    securityLevel: "authPriv",
    engineId: "800006340300c4f57c4a1b00",
    receivedAt: "2026-11-26T10:00:00.000Z",
    varbinds: [
      { oid: "1.3.6.1.4.1.1588.2.1.1.1.6.2.1.4.3", value: "2" },
      { oid: "1.3.6.1.4.1.1588.2.1.1.1.1.35.3", value: "5" },
    ],
  };

  if (contextName !== undefined) {
    snmpTrap["contextName"] = contextName;
  }

  return JSON.parse(
    JSON.stringify({
      jobType: "snmp-trap",
      ingestionTimestamp: new Date("2026-11-26T10:00:01.000Z"),
      snmpTrap: {
        probeId: PROBE_ID.toString(),
        snmpTrap: snmpTrap,
      },
    }),
  ) as ProbeIngestJobData;
}

function logicalSwitch(
  name: string,
  snmpV3ContextName: string | undefined,
): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(ObjectID.generate());
  device.projectId = PROJECT_ID;
  device.name = name;
  device.hostname = CHASSIS;

  if (snmpV3ContextName !== undefined) {
    device.snmpV3ContextName = snmpV3ContextName;
  }

  return device;
}

function monitorWatching(deviceId: ObjectID): Monitor {
  const monitor: Monitor = new Monitor(ObjectID.generate());
  monitor.projectId = PROJECT_ID;

  const step: MonitorStep = new MonitorStep();
  step.data!.networkDeviceMonitor = {
    networkDeviceId: deviceId.toString(),
    monitorInterfaces: true,
    oids: [],
  };

  const steps: MonitorSteps = new MonitorSteps();
  steps.data!.monitorStepsInstanceArray = [step];
  monitor.monitorSteps = steps;

  return monitor;
}

const DEFAULT_SWITCH: NetworkDevice = logicalSwitch("fabric-a (FID 128)", undefined);
const LOGICAL_SWITCH_20: NetworkDevice = logicalSwitch("fabric-b (FID 20)", "VF:20");

let writeUnmatched: AnyMock;
let writeMatched: AnyMock;
let findMonitors: AnyMock;

function chassisHas(devices: Array<NetworkDevice>): void {
  jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation((async (data: {
      query: Record<string, unknown>;
    }): Promise<Array<NetworkDevice>> => {
      return data.query["hostname"] === CHASSIS ? devices : [];
    }) as never);

  const monitors: Array<Monitor> = devices.map((device: NetworkDevice) => {
    return monitorWatching(device.id!);
  });

  findMonitors.mockImplementation((async (data: {
    deviceIds: Array<string>;
  }): Promise<Array<Monitor>> => {
    return monitors.filter((monitor: Monitor) => {
      return data.deviceIds.includes(
        monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
          .networkDeviceMonitor!.networkDeviceId || "",
      );
    });
  }) as never);
}

// The devices whose monitors a trap fired, by name.
function firedFor(): Array<string> {
  const deviceIds: Array<string> = findMonitors.mock.calls.flatMap(
    (call: Array<unknown>) => {
      return (call[0] as { deviceIds: Array<string> }).deviceIds;
    },
  );

  return [DEFAULT_SWITCH, LOGICAL_SWITCH_20]
    .filter((device: NetworkDevice) => {
      return deviceIds.includes(device.id!.toString());
    })
    .map((device: NetworkDevice) => {
      return device.name!;
    });
}

beforeEach(() => {
  NetworkDeviceHydrationUtil.clearSourceMatchCache();
  monitorResource.mockClear();

  jest
    .spyOn(
      (NetworkDeviceHydrationUtil as unknown as { dnsCache: DnsCache })
        .dnsCache,
      "resolve",
    )
    .mockResolvedValue([] as never);

  const probe: Probe = new Probe(PROBE_ID);
  probe.projectId = PROJECT_ID;
  jest.spyOn(ProbeService, "findOneById").mockResolvedValue(probe as never);

  writeUnmatched = jest
    .spyOn(SnmpTrapLogWriter, "writeUnmatchedTrapLogRow")
    .mockResolvedValue(undefined as never) as unknown as AnyMock;

  writeMatched = jest
    .spyOn(SnmpTrapLogWriter, "writeTrapLogRows")
    .mockResolvedValue(undefined as never) as unknown as AnyMock;

  findMonitors = jest
    .spyOn(NetworkDeviceWalkUtil, "findMonitorsWatchingDevices")
    .mockResolvedValue([] as never) as unknown as AnyMock;
});

afterEach(() => {
  jest.restoreAllMocks();
  NetworkDeviceHydrationUtil.clearSourceMatchCache();
});

describe("an SNMPv3 trap from a chassis with Virtual Fabrics", () => {
  it("in VF:20, is logical switch 20's alone: its trap history and its monitors", async () => {
    chassisHas([DEFAULT_SWITCH, LOGICAL_SWITCH_20]);

    await processSnmpTrapFromQueue(trapJob("VF:20"));

    expect(firedFor()).toEqual(["fabric-b (FID 20)"]);
    expect(
      (
        writeMatched.mock.calls[0]![0] as { devices: Array<NetworkDevice> }
      ).devices.map((device: NetworkDevice) => {
        return device.name;
      }),
    ).toEqual(["fabric-b (FID 20)"]);
    expect(monitorResource).toHaveBeenCalledTimes(1);
  });

  it("in the default logical switch's context, which nobody typed, is the device polled in the default context", async () => {
    chassisHas([DEFAULT_SWITCH, LOGICAL_SWITCH_20]);

    await processSnmpTrapFromQueue(trapJob("VF:128"));

    expect(firedFor()).toEqual(["fabric-a (FID 128)"]);
  });

  it("naming no context, goes to every device at the address, as a v1 or v2c trap does", async () => {
    chassisHas([DEFAULT_SWITCH, LOGICAL_SWITCH_20]);

    await processSnmpTrapFromQueue(trapJob(undefined));

    expect(firedFor()).toEqual(["fabric-a (FID 128)", "fabric-b (FID 20)"]);
    expect(monitorResource).toHaveBeenCalledTimes(2);
  });

  it("from a logical switch nobody registered, is logged as unmatched, not raised on a neighbour", async () => {
    chassisHas([LOGICAL_SWITCH_20]);

    await processSnmpTrapFromQueue(trapJob("VF:30"));

    expect(findMonitors).not.toHaveBeenCalled();
    expect(writeMatched).not.toHaveBeenCalled();
    expect(writeUnmatched).toHaveBeenCalledTimes(1);
  });

  it("the routing reads each device's context from the cached answer too", async () => {
    chassisHas([DEFAULT_SWITCH, LOGICAL_SWITCH_20]);

    await processSnmpTrapFromQueue(trapJob("VF:20"));
    await processSnmpTrapFromQueue(trapJob("VF:20"));

    expect(
      writeMatched.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { devices: Array<NetworkDevice> }).devices.map(
          (device: NetworkDevice) => {
            return device.name;
          },
        );
      }),
    ).toEqual([["fabric-b (FID 20)"], ["fabric-b (FID 20)"]]);
  });
});
