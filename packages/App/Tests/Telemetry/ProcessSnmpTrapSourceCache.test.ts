/*
 * The SNMP trap worker finds the devices a trap is from through
 * NetworkDeviceHydrationUtil.findDevicesByProbeAndSource, which answers from
 * a per-process cache (NetworkDeviceSourceMatchCache.test.ts in Common). This
 * pins that the worker really goes through it: a burst of traps from one
 * sender reads the probe's devices once, matched or not, and every trap is
 * still logged and evaluated. Before, a trap from an address no device had
 * as its hostname read up to 10,000 of the probe's devices and resolved
 * their DNS names, on every trap.
 *
 * Only the database (NetworkDeviceService.findBy), the DNS cache, the trap
 * log writer and the monitor lookup are stubbed; the matching and the cache
 * are the real ones.
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
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import ObjectID from "Common/Types/ObjectID";

type AnyMock = jest.Mock<(...args: Array<any>) => any>;
type DnsCache = { resolve: (hostname: string) => Promise<Array<string>> };

const PROBE_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();

const monitorResource: AnyMock =
  MonitorResourceUtil.monitorResource as unknown as AnyMock;

function trapJob(sourceIpAddress: string): ProbeIngestJobData {
  return JSON.parse(
    JSON.stringify({
      jobType: "snmp-trap",
      ingestionTimestamp: new Date("2026-11-14T10:00:01.000Z"),
      snmpTrap: {
        probeId: PROBE_ID.toString(),
        snmpTrap: {
          sourceIpAddress: sourceIpAddress,
          trapOid: "1.3.6.1.6.3.1.1.5.3",
        },
      },
    }),
  ) as ProbeIngestJobData;
}

function networkDevice(input: {
  hostname: string;
  otherAddresses?: string;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(ObjectID.generate());
  device.projectId = PROJECT_ID;
  device.name = "Core Router";
  device.hostname = input.hostname;

  if (input.otherAddresses) {
    device.otherAddresses = input.otherAddresses;
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

let findBy: AnyMock;
let writeUnmatched: AnyMock;
let writeMatched: AnyMock;
let findMonitors: AnyMock;
let resolve: AnyMock;

// The probe's devices: none with the address as hostname, `onProbe` in all.
function probePolls(onProbe: Array<NetworkDevice>): void {
  findBy.mockImplementation((async (data: {
    query: Record<string, unknown>;
  }): Promise<Array<NetworkDevice>> => {
    return data.query["hostname"] !== undefined ? [] : onProbe;
  }) as never);
}

beforeEach(() => {
  NetworkDeviceHydrationUtil.clearSourceMatchCache();
  monitorResource.mockClear();

  findBy = jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockResolvedValue([] as never) as unknown as AnyMock;

  resolve = jest
    .spyOn(
      (NetworkDeviceHydrationUtil as unknown as { dnsCache: DnsCache })
        .dnsCache,
      "resolve",
    )
    .mockResolvedValue([] as never) as unknown as AnyMock;

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

describe("a burst of SNMP traps from one sender", () => {
  it("from a sender nobody added, reads the probe's devices once, and logs every trap as unmatched", async () => {
    probePolls([networkDevice({ hostname: "core.example.com" })]);
    resolve.mockResolvedValue(["10.9.9.9"] as never);

    for (let index: number = 0; index < 25; index++) {
      await processSnmpTrapFromQueue(trapJob("203.0.113.50"));
    }

    // One exact lookup and one scan of the probe's devices, for 25 traps.
    expect(findBy).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(writeUnmatched).toHaveBeenCalledTimes(25);
    expect(findMonitors).not.toHaveBeenCalled();
  });

  it("from a router sending from an Other Address, reads once, and every trap reaches its monitors", async () => {
    const router: NetworkDevice = networkDevice({
      hostname: "10.0.0.1",
      otherAddresses: "10.255.0.1",
    });
    probePolls([router]);
    findMonitors.mockResolvedValue([monitorWatching(router.id!)] as never);

    for (let index: number = 0; index < 10; index++) {
      await processSnmpTrapFromQueue(trapJob("10.255.0.1"));
    }

    expect(findBy).toHaveBeenCalledTimes(2);
    expect(writeMatched).toHaveBeenCalledTimes(10);
    expect(monitorResource).toHaveBeenCalledTimes(10);

    for (const call of findMonitors.mock.calls) {
      expect((call[0] as { deviceIds: Array<string> }).deviceIds).toEqual([
        router.id!.toString(),
      ]);
    }

    // The trap log names the device, from the cached answer too.
    const logged: Array<NetworkDevice> = (
      writeMatched.mock.calls[9]![0] as { devices: Array<NetworkDevice> }
    ).devices;
    expect(logged[0]!.name).toBe("Core Router");
    expect(logged[0]!.projectId!.toString()).toBe(PROJECT_ID.toString());
  });

  it("from two senders, reads each once", async () => {
    probePolls([]);

    for (let index: number = 0; index < 5; index++) {
      await processSnmpTrapFromQueue(trapJob("203.0.113.1"));
      await processSnmpTrapFromQueue(trapJob("203.0.113.2"));
    }

    expect(findBy).toHaveBeenCalledTimes(4);
    expect(writeUnmatched).toHaveBeenCalledTimes(10);
  });

  it("an exact hostname match is cached as well", async () => {
    const router: NetworkDevice = networkDevice({ hostname: "10.0.0.7" });
    findBy.mockResolvedValue([router] as never);

    await processSnmpTrapFromQueue(trapJob("10.0.0.7"));
    await processSnmpTrapFromQueue(trapJob("10.0.0.7"));

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(writeMatched).toHaveBeenCalledTimes(2);
  });
});

describe("what the trap path reads per trap", () => {
  it("the monitor lookup is still asked for every trap (its own cost is the device's, not the project's)", async () => {
    const router: NetworkDevice = networkDevice({ hostname: "10.0.0.7" });
    findBy.mockResolvedValue([router] as never);

    await processSnmpTrapFromQueue(trapJob("10.0.0.7"));
    await processSnmpTrapFromQueue(trapJob("10.0.0.7"));

    expect(findMonitors).toHaveBeenCalledTimes(2);
    expect(
      (findMonitors.mock.calls[0]![0] as { projectId: ObjectID }).projectId,
    ).toEqual(PROJECT_ID);
  });

  it("a sender's trap is matched among the receiving probe's devices only", async () => {
    findBy.mockResolvedValue([] as never);

    await processSnmpTrapFromQueue(trapJob("10.0.0.7"));

    for (const call of findBy.mock.calls) {
      expect(
        (call[0] as { query: { probeId: ObjectID } }).query.probeId.toString(),
      ).toBe(PROBE_ID.toString());
    }
  });

  it("a trap is answered from the cache even when the job's JSON spells the source with whitespace", async () => {
    findBy.mockResolvedValue([
      networkDevice({ hostname: "10.0.0.7" }),
    ] as never);

    await processSnmpTrapFromQueue(trapJob("10.0.0.7"));
    await processSnmpTrapFromQueue(trapJob(" 10.0.0.7 "));

    expect(findBy).toHaveBeenCalledTimes(1);
  });
});
