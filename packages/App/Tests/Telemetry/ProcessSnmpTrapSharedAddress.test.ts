/*
 * SNMPv3 TRAPS FROM DEVICES THAT SHARE ONE ADDRESS, THROUGH THE TRAP INGEST
 * (OneUptime issues #11172, #11174).
 *
 * What the probe forwards for four traps Net-SNMP's snmptrap sent from one
 * address (Common/Tests/Helpers/Snmp/SharedAddressSnmpV3Traps; the probe's
 * SnmpTrapReceiverSharedAddress replays the same datagrams): two blades
 * signed by users of their own, two switches that share their site's
 * default credential. At the address there is also the chassis they send
 * through, registered by it as its hostname.
 *
 * Matched by the address alone - as #11005 left it, and as a probe older
 * than #11172 still forwards them - all four landed on the chassis, and
 * none on the device that sent it. Each goes to its own device now: the
 * blades by the credential that signed them, the switches by the engine ID
 * their SNMPv3 polls read. A trap is kept in no project whose credential
 * did not sign it, and one from an address nobody has is kept where it can
 * be told whose it is, with the site whose default signed it.
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
import SnmpTrapUnmatchedHome from "Common/Server/Utils/Monitor/SnmpTrapUnmatchedHome";
import {
  SHARED_ADDRESS,
  SHARED_ADDRESS_DEVICES,
  SHARED_ADDRESS_PROJECT_ID,
  SHARED_ADDRESS_SITE_ID,
  SharedAddressDeviceKey,
  forwardedSharedAddressTrap,
} from "Common/Tests/Helpers/Snmp/SharedAddressSnmpV3Traps";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import SnmpTrap from "Common/Types/Monitor/SnmpMonitor/SnmpTrap";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";

type AnyMock = Mock<(...args: Array<any>) => any>;
type DnsCache = { resolve: (hostname: string) => Promise<Array<string>> };

const PROBE_ID: ObjectID = new ObjectID("11720000-0000-4000-8000-0000000000f1");
const PROJECT_ID: ObjectID = new ObjectID(SHARED_ADDRESS_PROJECT_ID);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "11720000-0000-4000-8000-000000060be8",
);

const monitorResource: AnyMock =
  MonitorResourceUtil.monitorResource as unknown as AnyMock;

const CHASSIS_ID: string = "11720000-0000-4000-8000-0000000000c0";

function registered(data: {
  id: string;
  name: string;
  hostname: string;
  otherAddresses?: string;
  snmpEngineId?: string;
  projectId?: ObjectID;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(new ObjectID(data.id));
  device.projectId = data.projectId || PROJECT_ID;
  device.name = data.name;
  device.hostname = data.hostname;

  if (data.otherAddresses) {
    device.otherAddresses = data.otherAddresses;
  }

  if (data.snmpEngineId) {
    device.snmpEngineId = data.snmpEngineId;
  }

  return device;
}

/*
 * The chassis registered at the address, and the devices behind it, each at
 * an address of its own with the shared one among its Other Addresses - as
 * a person registers a NAT's devices, or a chassis's blades.
 */
function behindTheAddress(
  key: SharedAddressDeviceKey,
  index: number,
  options: { isPolledOverSnmpV3: boolean },
): NetworkDevice {
  return registered({
    id: SHARED_ADDRESS_DEVICES[key].id,
    name: SHARED_ADDRESS_DEVICES[key].name,
    hostname: `10.0.10.${index + 1}`,
    otherAddresses: SHARED_ADDRESS,
    ...(options.isPolledOverSnmpV3
      ? { snmpEngineId: SHARED_ADDRESS_DEVICES[key].engineId }
      : {}),
  });
}

const KEYS: Array<SharedAddressDeviceKey> = [
  "blade1",
  "blade2",
  "siteSwitch1",
  "siteSwitch2",
];

function theFleet(
  options: { isPolledOverSnmpV3: boolean } = { isPolledOverSnmpV3: true },
): Array<NetworkDevice> {
  return [
    registered({
      id: CHASSIS_ID,
      name: "chassis-1",
      hostname: SHARED_ADDRESS,
      snmpEngineId: "800000090300AABBCC0000FF",
    }),
    ...KEYS.map((key: SharedAddressDeviceKey, index: number) => {
      return behindTheAddress(key, index, options);
    }),
  ];
}

function trapJob(trap: Partial<SnmpTrap>): ProbeIngestJobData {
  return JSON.parse(
    JSON.stringify({
      jobType: "snmp-trap",
      ingestionTimestamp: new Date("2026-11-27T10:00:01.000Z"),
      snmpTrap: {
        probeId: PROBE_ID.toString(),
        snmpTrap: {
          receivedAt: "2026-11-27T10:00:00.000Z",
          ...trap,
        },
      },
    }),
  ) as ProbeIngestJobData;
}

// As the probe forwards it.
function recordedTrapOf(key: SharedAddressDeviceKey): Partial<SnmpTrap> {
  return forwardedSharedAddressTrap(key);
}

// As a probe older than #11172 forwards the same trap: no holders.
function asAnOlderProbeForwards(
  key: SharedAddressDeviceKey,
): Partial<SnmpTrap> {
  const trap: Partial<SnmpTrap> = { ...forwardedSharedAddressTrap(key) };
  delete trap.signedBy;
  return trap;
}

function monitorWatching(device: NetworkDevice): Monitor {
  const monitor: Monitor = new Monitor(ObjectID.generate());
  monitor.projectId = device.projectId!;

  const step: MonitorStep = new MonitorStep();
  step.data!.networkDeviceMonitor = {
    networkDeviceId: device.id!.toString(),
    monitorInterfaces: true,
    oids: [],
  };

  const steps: MonitorSteps = new MonitorSteps();
  steps.data!.monitorStepsInstanceArray = [step];
  monitor.monitorSteps = steps;

  return monitor;
}

let writeUnmatched: AnyMock;
let writeMatched: AnyMock;
let findMonitors: AnyMock;
let findProbeUse: AnyMock;
// Each device's monitor, by the monitor's ID: the device's name.
let deviceNameByMonitorId: Map<string, string> = new Map();

function theProbeHas(devices: Array<NetworkDevice>): void {
  jest.spyOn(NetworkDeviceService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }): Promise<Array<NetworkDevice>> => {
    if (typeof data.query["hostname"] === "string") {
      return devices.filter((device: NetworkDevice) => {
        return device.hostname === data.query["hostname"];
      });
    }

    if ("otherAddresses" in data.query) {
      // The text search the lookup narrows by: Other Addresses that hold it.
      return devices.filter((device: NetworkDevice) => {
        return (device.otherAddresses || "").includes(SHARED_ADDRESS);
      });
    }

    return devices;
  }) as never);

  const monitors: Array<Monitor> = devices.map(monitorWatching);

  deviceNameByMonitorId = new Map(
    monitors.map((monitor: Monitor, index: number): [string, string] => {
      return [monitor.id!.toString(), devices[index]!.name || ""];
    }),
  );

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

function theProbeIs(fields: { isGlobalProbe: boolean }): void {
  const probe: Probe = new Probe(PROBE_ID);
  probe.isGlobalProbe = fields.isGlobalProbe;

  if (!fields.isGlobalProbe) {
    probe.projectId = PROJECT_ID;
  }

  jest.spyOn(ProbeService, "findOneById").mockResolvedValue(probe as never);
}

// The devices a trap was kept on, by name, in the order written.
function keptOn(): Array<Array<string>> {
  return writeMatched.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { devices: Array<NetworkDevice> }).devices.map(
      (device: NetworkDevice) => {
        return device.name || "";
      },
    );
  });
}

// The devices whose monitors the traps fired, by name, in the order fired.
function firedFor(): Array<string> {
  return monitorResource.mock.calls.map((call: Array<unknown>) => {
    const response: ProbeMonitorResponse = call[0] as ProbeMonitorResponse;
    return deviceNameByMonitorId.get(response.monitorId.toString()) || "";
  });
}

beforeEach(() => {
  NetworkDeviceHydrationUtil.clearSourceMatchCache();
  SnmpTrapUnmatchedHome.clearCache();
  monitorResource.mockClear();

  jest
    .spyOn(
      (NetworkDeviceHydrationUtil as unknown as { dnsCache: DnsCache })
        .dnsCache,
      "resolve",
    )
    .mockResolvedValue([] as never);

  theProbeIs({ isGlobalProbe: false });

  writeUnmatched = jest
    .spyOn(SnmpTrapLogWriter, "writeUnmatchedTrapLogRow")
    .mockResolvedValue(undefined as never) as unknown as AnyMock;

  writeMatched = jest
    .spyOn(SnmpTrapLogWriter, "writeTrapLogRows")
    .mockResolvedValue(undefined as never) as unknown as AnyMock;

  findMonitors = jest
    .spyOn(NetworkDeviceWalkUtil, "findMonitorsWatchingDevices")
    .mockResolvedValue([] as never) as unknown as AnyMock;

  findProbeUse = jest
    .spyOn(NetworkDeviceService, "findProbeUseByProject")
    .mockResolvedValue({
      isUsed: true,
      siteIds: [],
    } as never) as unknown as AnyMock;
});

afterEach(() => {
  jest.restoreAllMocks();
  NetworkDeviceHydrationUtil.clearSourceMatchCache();
  SnmpTrapUnmatchedHome.clearCache();
});

describe("four recorded SNMPv3 traps from one address", () => {
  it("from a probe older than #11172 with only the chassis polled over SNMPv3: never the chassis, whose engine is another; the four behind it cannot be told apart", async () => {
    theProbeHas(theFleet({ isPolledOverSnmpV3: false }));

    for (const key of KEYS) {
      await processSnmpTrapFromQueue(trapJob(asAnOlderProbeForwards(key)));
    }

    const behind: Array<string> = [
      "chassis-1 blade 1",
      "chassis-1 blade 2",
      "branch switch 1",
      "branch switch 2",
    ];
    expect(keptOn()).toEqual([behind, behind, behind, behind]);
  });

  it("each on its own device: the blades by the credential that signed them, the switches by their engines", async () => {
    theProbeHas(theFleet());

    for (const key of KEYS) {
      await processSnmpTrapFromQueue(trapJob(recordedTrapOf(key)));
    }

    expect(keptOn()).toEqual([
      ["chassis-1 blade 1"],
      ["chassis-1 blade 2"],
      ["branch switch 1"],
      ["branch switch 2"],
    ]);
    expect(firedFor()).toEqual([
      "chassis-1 blade 1",
      "chassis-1 blade 2",
      "branch switch 1",
      "branch switch 2",
    ]);
  });

  it("from a probe older than #11172, the engines its polls read still tell all four apart", async () => {
    theProbeHas(theFleet());

    for (const key of KEYS) {
      await processSnmpTrapFromQueue(trapJob(asAnOlderProbeForwards(key)));
    }

    expect(keptOn()).toEqual([
      ["chassis-1 blade 1"],
      ["chassis-1 blade 2"],
      ["branch switch 1"],
      ["branch switch 2"],
    ]);
  });

  it("with no SNMPv3 poll yet, the blades are still told apart; the switches sharing a credential both get each other's", async () => {
    theProbeHas(theFleet({ isPolledOverSnmpV3: false }));

    for (const key of KEYS) {
      await processSnmpTrapFromQueue(trapJob(recordedTrapOf(key)));
    }

    expect(keptOn()).toEqual([
      ["chassis-1 blade 1"],
      ["chassis-1 blade 2"],
      ["branch switch 1", "branch switch 2"],
      ["branch switch 1", "branch switch 2"],
    ]);
  });

  it("one switch polled is enough: the other is the one whose engine is not known to be another", async () => {
    const fleet: Array<NetworkDevice> = theFleet({ isPolledOverSnmpV3: false });
    fleet.find((device: NetworkDevice) => {
      return device.id!.toString() === SHARED_ADDRESS_DEVICES.siteSwitch1.id;
    })!.snmpEngineId = SHARED_ADDRESS_DEVICES.siteSwitch1.engineId;
    theProbeHas(fleet);

    await processSnmpTrapFromQueue(trapJob(recordedTrapOf("siteSwitch2")));
    await processSnmpTrapFromQueue(trapJob(recordedTrapOf("siteSwitch1")));

    expect(keptOn()).toEqual([["branch switch 2"], ["branch switch 1"]]);
  });

  it("a device of another project at the same address never gets them", async () => {
    theProbeIs({ isGlobalProbe: true });
    theProbeHas([
      ...theFleet(),
      registered({
        id: "11720000-0000-4000-8000-0000000000e1",
        name: "someone else's router",
        hostname: SHARED_ADDRESS,
        projectId: OTHER_PROJECT_ID,
      }),
    ]);

    for (const key of KEYS) {
      await processSnmpTrapFromQueue(trapJob(recordedTrapOf(key)));
    }

    expect(keptOn().flat()).not.toContain("someone else's router");
    expect(firedFor()).not.toContain("someone else's router");
  });

  it("what the trap history and the monitors keep never says who holds its credential", async () => {
    theProbeHas(theFleet());

    await processSnmpTrapFromQueue(trapJob(recordedTrapOf("blade1")));

    const kept: SnmpTrap = (
      writeMatched.mock.calls[0]![0] as { snmpTrap: SnmpTrap }
    ).snmpTrap;
    expect(kept).not.toHaveProperty("signedBy");
    expect(kept.securityName).toBe("blade-1-monitor");
    expect(kept.engineId).toBe(SHARED_ADDRESS_DEVICES.blade1.engineId);

    const fired: ProbeMonitorResponse = monitorResource.mock
      .calls[0]![0] as ProbeMonitorResponse;
    expect(fired.snmpTrapResponse).not.toHaveProperty("signedBy");
  });

  it("the address's devices are read once for the four, as the address lookup always was", async () => {
    theProbeHas(theFleet());
    const findBy: AnyMock = NetworkDeviceService.findBy as unknown as AnyMock;

    for (const key of KEYS) {
      await processSnmpTrapFromQueue(trapJob(recordedTrapOf(key)));
    }

    // The hostname read and the Other Addresses read, once each.
    expect(findBy).toHaveBeenCalledTimes(2);
  });
});

describe("a trap from an address no device has (#11174)", () => {
  const NEW_DEVICE_ADDRESS: string = "198.51.100.40";

  function fromANewDevice(fields: Partial<SnmpTrap> = {}): Partial<SnmpTrap> {
    return {
      ...forwardedSharedAddressTrap("siteSwitch1"),
      sourceIpAddress: NEW_DEVICE_ADDRESS,
      engineId: "800000090300AABBCC0000AA",
      ...fields,
    };
  }

  it("on a project's own probe, is kept as from an unknown source, with the site whose default signed it", async () => {
    theProbeHas(theFleet());
    findProbeUse.mockResolvedValue({
      isUsed: true,
      siteIds: [SHARED_ADDRESS_SITE_ID],
    } as never);

    await processSnmpTrapFromQueue(trapJob(fromANewDevice()));

    expect(writeMatched).not.toHaveBeenCalled();
    expect(writeUnmatched).toHaveBeenCalledTimes(1);

    const written: {
      projectId: ObjectID;
      siteId?: ObjectID;
      snmpTrap: SnmpTrap;
    } = writeUnmatched.mock.calls[0]![0] as {
      projectId: ObjectID;
      siteId?: ObjectID;
      snmpTrap: SnmpTrap;
    };
    expect(written.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(written.siteId?.toString()).toBe(SHARED_ADDRESS_SITE_ID);
    expect(written.snmpTrap).not.toHaveProperty("signedBy");
    expect(written.snmpTrap.sourceIpAddress).toBe(NEW_DEVICE_ADDRESS);
  });

  it("on a global probe, is kept in the one project whose site's default signed it", async () => {
    theProbeIs({ isGlobalProbe: true });
    theProbeHas(theFleet());
    findProbeUse.mockResolvedValue({
      isUsed: true,
      siteIds: [SHARED_ADDRESS_SITE_ID],
    } as never);

    await processSnmpTrapFromQueue(trapJob(fromANewDevice()));

    const written: { projectId: ObjectID; siteId?: ObjectID } = writeUnmatched
      .mock.calls[0]![0] as { projectId: ObjectID; siteId?: ObjectID };
    expect(written.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(written.siteId?.toString()).toBe(SHARED_ADDRESS_SITE_ID);
  });

  it("on a global probe, nowhere when two projects hold the credential", async () => {
    theProbeIs({ isGlobalProbe: true });
    theProbeHas(theFleet());

    await processSnmpTrapFromQueue(
      trapJob(
        fromANewDevice({
          signedBy: {
            projectIds: [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()],
            deviceIds: [],
            siteIds: [],
          },
        }),
      ),
    );

    expect(writeUnmatched).not.toHaveBeenCalled();
    expect(writeMatched).not.toHaveBeenCalled();
  });

  it("on a global probe, nowhere for a v2c trap, as before", async () => {
    theProbeIs({ isGlobalProbe: true });
    theProbeHas(theFleet());

    await processSnmpTrapFromQueue(
      trapJob({
        sourceIpAddress: NEW_DEVICE_ADDRESS,
        trapOid: "1.3.6.1.6.3.1.1.5.1",
        snmpVersion: "2c",
        community: "public",
        varbinds: [],
      }),
    );

    expect(writeUnmatched).not.toHaveBeenCalled();
  });

  it("signed with a credential of another project than the device at the address, it is kept as that project's unknown source, never on the other's device", async () => {
    theProbeIs({ isGlobalProbe: true });
    theProbeHas([
      registered({
        id: "11720000-0000-4000-8000-0000000000e1",
        name: "someone else's router",
        hostname: NEW_DEVICE_ADDRESS,
        projectId: OTHER_PROJECT_ID,
      }),
    ]);

    await processSnmpTrapFromQueue(trapJob(fromANewDevice()));

    expect(writeMatched).not.toHaveBeenCalled();
    expect(
      (writeUnmatched.mock.calls[0]![0] as { projectId: ObjectID }).projectId,
    ).toEqual(PROJECT_ID);
  });
});

describe("what is not an authenticated SNMPv3 trap goes by its address, as before", () => {
  it("a v2c trap from the address goes to the chassis registered at it", async () => {
    theProbeHas(theFleet());

    await processSnmpTrapFromQueue(
      trapJob({
        sourceIpAddress: SHARED_ADDRESS,
        trapOid: "1.3.6.1.6.3.1.1.5.1",
        snmpVersion: "2c",
        community: "public",
        varbinds: [],
      }),
    );

    expect(keptOn()).toEqual([["chassis-1"]]);
  });

  it("a noAuthNoPriv trap claiming a blade's holders goes to the chassis too: its user name proves nothing", async () => {
    theProbeHas(theFleet());

    await processSnmpTrapFromQueue(
      trapJob({
        ...recordedTrapOf("blade1"),
        securityLevel: "noAuthNoPriv" as SnmpTrap["securityLevel"],
      }),
    );

    expect(keptOn()).toEqual([["chassis-1"]]);
  });
});
