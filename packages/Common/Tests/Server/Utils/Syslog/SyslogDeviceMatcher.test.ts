import SyslogDeviceMatcher, {
  CACHE_TTL_MS,
  SyslogAttribution,
  SyslogDeviceAttribution,
  SyslogSender,
} from "../../../../Server/Utils/Syslog/SyslogDeviceMatcher";
import NetworkFlowDeviceMatcher, {
  FlowProbe,
} from "../../../../Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher";
import NetworkDeviceHydrationUtil from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import ProbeService from "../../../../Server/Services/ProbeService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Probe from "../../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../../Types/ObjectID";
import { SyslogDeviceMatchKind } from "../../../../Types/Syslog/SyslogAttribute";
import { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Whose syslog a message is. The address it came from decides first; what
 * the message says about itself only decides what the address cannot -
 * and never by a name alone when the address already is a device, because
 * a sender's own host name is too often a factory default another device
 * carries too.
 *
 * The estate under test: a firewall and a UniFi console the probe polls, an
 * access point and a switch the console manages, a router another probe of
 * the project polls, and two sites that reuse 192.168.1.1.
 */

const PROJECT: ObjectID = ObjectID.generate();
const OTHER_PROJECT: ObjectID = ObjectID.generate();
const PROBE: ObjectID = ObjectID.generate();

const PROJECT_PROBE: FlowProbe = { id: PROBE, projectId: PROJECT };
const GLOBAL_PROBE: FlowProbe = { id: PROBE, projectId: null };

const FIREWALL: ObjectID = ObjectID.generate();
const CONSOLE: ObjectID = ObjectID.generate();
const ACCESS_POINT: ObjectID = ObjectID.generate();
const SWITCH: ObjectID = ObjectID.generate();
const ROUTER: ObjectID = ObjectID.generate();
const SITE_A_GATEWAY: ObjectID = ObjectID.generate();
const SITE_B_GATEWAY: ObjectID = ObjectID.generate();
const TWIN_ONE: ObjectID = ObjectID.generate();
const TWIN_TWO: ObjectID = ObjectID.generate();

interface DeviceFields {
  id: ObjectID;
  projectId?: ObjectID;
  name?: string;
  hostname?: string;
  dnsName?: string;
  otherAddresses?: string;
  discoveredName?: string;
  macAddress?: string;
  sysName?: string;
  sysDescr?: string;
  sysObjectId?: string;
  vendor?: string;
  serialNumber?: string;
}

function device(fields: DeviceFields): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice(fields.id);
  value.projectId = fields.projectId || PROJECT;

  const columns: Array<keyof DeviceFields> = [
    "name",
    "hostname",
    "dnsName",
    "otherAddresses",
    "discoveredName",
    "macAddress",
    "sysName",
    "sysDescr",
    "sysObjectId",
    "vendor",
    "serialNumber",
  ];

  for (const column of columns) {
    if (fields[column] !== undefined) {
      (value as unknown as Record<string, unknown>)[column] = fields[column];
    }
  }

  return value;
}

const PROJECT_DEVICES: Array<NetworkDevice> = [
  device({
    id: FIREWALL,
    name: "HQ Firewall",
    hostname: "10.0.0.1",
    vendor: "Sophos",
    serialNumber: "X21000ABCD12345",
    sysName: "fw-hq",
  }),
  device({
    id: CONSOLE,
    name: "Office UDM Pro",
    hostname: "192.168.100.1",
    sysObjectId: "1.3.6.1.4.1.41112.1.6",
  }),
  device({
    id: ACCESS_POINT,
    name: "Lobby AP",
    hostname: "192.168.100.5",
    macAddress: "d8:b3:70:fb:fc:dd",
  }),
  device({
    id: SWITCH,
    name: "Warehouse Switch",
    hostname: "warehouse-sw.example.com",
    dnsName: "warehouse-sw.example.com",
    sysName: "warehouse-sw",
    serialNumber: "sn-7788",
    otherAddresses: "10.255.0.9, 2001:db8::9",
  }),
  device({
    id: ROUTER,
    name: "Branch Router",
    hostname: "10.9.0.1",
    discoveredName: "branch-rtr-01",
    sysDescr: "RouterOS CCR2004-16G-2S+",
    sysObjectId: "1.3.6.1.4.1.14988.1",
  }),
  device({
    id: SITE_A_GATEWAY,
    name: "Site A Gateway",
    hostname: "192.168.1.1",
  }),
  device({
    id: SITE_B_GATEWAY,
    name: "Site B Gateway",
    hostname: "192.168.1.1",
  }),
  device({ id: TWIN_ONE, name: "MikroTik", hostname: "10.20.0.1" }),
  device({
    id: TWIN_TWO,
    name: "Core Router",
    hostname: "10.20.0.2",
    sysName: "MikroTik",
    macAddress: "AA-BB-CC-00-00-02",
  }),
];

let probeDevices: MockFunction;
let projectDevices: MockFunction;

// The devices the probe polls that own an address.
function sourceIs(...devices: Array<NetworkDevice>): void {
  probeDevices.mockResolvedValue(devices as never);
}

function byId(id: ObjectID, projectId: ObjectID = PROJECT): NetworkDevice {
  const found: NetworkDevice | undefined = PROJECT_DEVICES.find(
    (candidate: NetworkDevice): boolean => {
      return candidate.id?.toString() === id.toString();
    },
  );
  const value: NetworkDevice = new NetworkDevice(id);

  value.projectId = projectId;
  value.name = found?.name || "";

  return value;
}

beforeEach(() => {
  SyslogDeviceMatcher.clearCaches();
  NetworkFlowDeviceMatcher.clearCaches();

  probeDevices = jest
    .spyOn(NetworkDeviceHydrationUtil, "findDevicesByProbeAndSource")
    .mockResolvedValue([] as never) as unknown as MockFunction;

  projectDevices = jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockResolvedValue(PROJECT_DEVICES as never) as unknown as MockFunction;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  SyslogDeviceMatcher.clearCaches();
  NetworkFlowDeviceMatcher.clearCaches();
});

async function attribute(
  sender: SyslogSender,
  probe: FlowProbe | null = PROJECT_PROBE,
): Promise<SyslogAttribution> {
  return SyslogDeviceMatcher.attribute(probe, sender);
}

interface Told {
  device: string;
  matchedBy: string;
  relay: string | null;
}

function told(attribution: SyslogAttribution): Array<Told> {
  return attribution.devices.map((entry: SyslogDeviceAttribution): Told => {
    return {
      device: entry.device.id.toString(),
      matchedBy: entry.matchedBy,
      relay: entry.relay ? entry.relay.id.toString() : null,
    };
  });
}

function one(
  device: ObjectID,
  matchedBy: SyslogDeviceMatchKind,
  relay: ObjectID | null = null,
): Array<Told> {
  return [
    {
      device: device.toString(),
      matchedBy: matchedBy,
      relay: relay ? relay.toString() : null,
    },
  ];
}

describe("the address is a device this probe polls", () => {
  test("the message is that device's, matched by the address it came from", async () => {
    sourceIs(byId(FIREWALL));

    const attribution: SyslogAttribution = await attribute({
      sourceIpAddress: "10.0.0.1",
    });

    expect(told(attribution)).toEqual(
      one(FIREWALL, SyslogDeviceMatchKind.SourceAddress),
    );
    expect(attribution.unmatchedProjectId).toBeNull();
    expect(probeDevices).toHaveBeenCalledWith({
      probeId: PROBE,
      sourceIpAddress: "10.0.0.1",
      select: { name: true },
    });
  });

  test("it comes back with its name and with what says who made it", async () => {
    sourceIs(byId(FIREWALL));

    const attribution: SyslogAttribution = await attribute({
      sourceIpAddress: "10.0.0.1",
    });

    expect(attribution.devices[0]?.device.name).toBe("HQ Firewall");
    expect(attribution.devices[0]?.device.vendorText).toBe("Sophos");
    expect(attribution.devices[0]?.device.projectId.toString()).toBe(
      PROJECT.toString(),
    );
  });

  test("the header's host name never moves it to another device, whatever it says", async () => {
    // The factory-default trap: the sender calls itself what another device is named.
    sourceIs(byId(FIREWALL));

    for (const headerHostname of [
      "MikroTik",
      "Lobby AP",
      "warehouse-sw",
      "branch-rtr-01",
    ]) {
      expect({
        headerHostname,
        told: told(
          await attribute({ sourceIpAddress: "10.0.0.1", headerHostname }),
        ),
      }).toEqual({
        headerHostname,
        told: one(FIREWALL, SyslogDeviceMatchKind.SourceAddress),
      });
    }
  });

  test("nor does a name in the message's own fields, from a device that is no controller", async () => {
    // A FortiGate's devname that happens to be another device's name.
    sourceIs(byId(FIREWALL));

    expect(
      told(
        await attribute({
          sourceIpAddress: "10.0.0.1",
          identity: { hostname: "Lobby AP" },
        }),
      ),
    ).toEqual(one(FIREWALL, SyslogDeviceMatchKind.SourceAddress));
  });

  test("a message that names the sender itself is the sender's, with no relay", async () => {
    sourceIs(byId(FIREWALL));

    expect(
      told(
        await attribute({
          sourceIpAddress: "10.0.0.1",
          identity: { serialNumber: "X21000ABCD12345", ipAddress: "10.0.0.1" },
          headerHostname: "fw-hq",
        }),
      ),
    ).toEqual(one(FIREWALL, SyslogDeviceMatchKind.SourceAddress));
  });

  test("a device added after the project was last read is still the message's", async () => {
    const added: ObjectID = ObjectID.generate();
    const row: NetworkDevice = new NetworkDevice(added);

    row.projectId = PROJECT;
    row.name = "Just Added";
    sourceIs(row);

    const attribution: SyslogAttribution = await attribute({
      sourceIpAddress: "10.77.0.1",
    });

    expect(told(attribution)).toEqual(
      one(added, SyslogDeviceMatchKind.SourceAddress),
    );
    expect(attribution.devices[0]?.device.name).toBe("Just Added");
    expect(attribution.devices[0]?.device.vendorText).toBe("");
  });
});

describe("a controller passing on a message about a device it manages", () => {
  test("by MAC address: the message is the access point's, and the console is its relay", async () => {
    sourceIs(byId(CONSOLE));

    const attribution: SyslogAttribution = await attribute({
      sourceIpAddress: "192.168.100.1",
      identity: { macAddress: "d8:b3:70:fb:fc:dd", managedDevice: true },
      headerHostname: "udm-pro",
    });

    expect(told(attribution)).toEqual(
      one(ACCESS_POINT, SyslogDeviceMatchKind.MacAddress, CONSOLE),
    );
    expect(attribution.devices[0]?.relay?.name).toBe("Office UDM Pro");
  });

  test("a MAC address is the same in any spelling", async () => {
    sourceIs(byId(CONSOLE));

    for (const macAddress of [
      "D8:B3:70:FB:FC:DD",
      "d8-b3-70-fb-fc-dd",
      "d8b3.70fb.fcdd",
      "d8b370fbfcdd",
    ]) {
      expect({
        macAddress,
        told: told(
          await attribute({
            sourceIpAddress: "192.168.100.1",
            identity: { macAddress },
          }),
        ),
      }).toEqual({
        macAddress,
        told: one(ACCESS_POINT, SyslogDeviceMatchKind.MacAddress, CONSOLE),
      });
    }
  });

  test("by serial number, in any case", async () => {
    sourceIs(byId(CONSOLE));

    expect(
      told(
        await attribute({
          sourceIpAddress: "192.168.100.1",
          identity: { serialNumber: "SN-7788" },
        }),
      ),
    ).toEqual(one(SWITCH, SyslogDeviceMatchKind.SerialNumber, CONSOLE));
  });

  test("by an address the message gives for its device: its hostname, or one of its Other Addresses", async () => {
    sourceIs(byId(CONSOLE));

    expect(
      told(
        await attribute({
          sourceIpAddress: "192.168.100.1",
          identity: { ipAddress: "192.168.100.5" },
        }),
      ),
    ).toEqual(one(ACCESS_POINT, SyslogDeviceMatchKind.Address, CONSOLE));

    expect(
      told(
        await attribute({
          sourceIpAddress: "192.168.100.1",
          identity: { ipAddress: "2001:DB8:0:0::9" },
        }),
      ),
    ).toEqual(one(SWITCH, SyslogDeviceMatchKind.Address, CONSOLE));
  });

  test("by an address written where the header's host name goes", async () => {
    // A relay that keeps the original sender's address in the header.
    sourceIs(byId(CONSOLE));

    expect(
      told(
        await attribute({
          sourceIpAddress: "192.168.100.1",
          headerHostname: "192.168.100.5",
        }),
      ),
    ).toEqual(one(ACCESS_POINT, SyslogDeviceMatchKind.Address, CONSOLE));
  });

  test("by the controller's own name for the device, when the message is about a managed device", async () => {
    sourceIs(byId(CONSOLE));

    expect(
      told(
        await attribute({
          sourceIpAddress: "192.168.100.1",
          identity: { hostname: "Warehouse Switch", managedDevice: true },
        }),
      ),
    ).toEqual(one(SWITCH, SyslogDeviceMatchKind.Hostname, CONSOLE));
  });

  test("a MAC address wins over a name that says otherwise", async () => {
    sourceIs(byId(CONSOLE));

    expect(
      told(
        await attribute({
          sourceIpAddress: "192.168.100.1",
          identity: {
            macAddress: "d8:b3:70:fb:fc:dd",
            hostname: "Warehouse Switch",
            managedDevice: true,
          },
        }),
      ),
    ).toEqual(one(ACCESS_POINT, SyslogDeviceMatchKind.MacAddress, CONSOLE));
  });

  test("a device the project does not have stays the console's own message", async () => {
    sourceIs(byId(CONSOLE));

    expect(
      told(
        await attribute({
          sourceIpAddress: "192.168.100.1",
          identity: {
            macAddress: "00:11:22:33:44:55",
            hostname: "Garage AP",
            ipAddress: "192.168.100.77",
            managedDevice: true,
          },
        }),
      ),
    ).toEqual(one(CONSOLE, SyslogDeviceMatchKind.SourceAddress));
  });

  test("an address two devices share names neither", async () => {
    sourceIs(byId(CONSOLE));

    expect(
      told(
        await attribute({
          sourceIpAddress: "192.168.100.1",
          identity: { ipAddress: "192.168.1.1" },
        }),
      ),
    ).toEqual(one(CONSOLE, SyslogDeviceMatchKind.SourceAddress));
  });

  test("two devices at one address that pass on the same message store it once", async () => {
    sourceIs(byId(CONSOLE), byId(FIREWALL));

    expect(
      told(
        await attribute({
          sourceIpAddress: "192.168.100.1",
          identity: { macAddress: "d8:b3:70:fb:fc:dd" },
        }),
      ),
    ).toEqual(one(ACCESS_POINT, SyslogDeviceMatchKind.MacAddress, CONSOLE));
  });
});

describe("a global probe, where one address can be a device in several projects", () => {
  test("each project's device gets the message, and each names devices of its own project only", async () => {
    const elsewhere: ObjectID = ObjectID.generate();

    sourceIs(byId(CONSOLE), byId(elsewhere, OTHER_PROJECT));
    projectDevices.mockImplementation((async (options: {
      query: { projectId: ObjectID };
    }): Promise<Array<NetworkDevice>> => {
      return options.query.projectId.toString() === PROJECT.toString()
        ? PROJECT_DEVICES
        : [
            device({
              id: elsewhere,
              projectId: OTHER_PROJECT,
              name: "Their Console",
              hostname: "192.168.100.1",
            }),
          ];
    }) as never);

    const attribution: SyslogAttribution = await attribute(
      {
        sourceIpAddress: "192.168.100.1",
        identity: { macAddress: "d8:b3:70:fb:fc:dd" },
      },
      GLOBAL_PROBE,
    );

    // The MAC is a device of the first project only: the second keeps its console.
    expect(told(attribution)).toEqual([
      ...one(ACCESS_POINT, SyslogDeviceMatchKind.MacAddress, CONSOLE),
      ...one(elsewhere, SyslogDeviceMatchKind.SourceAddress),
    ]);
    expect(attribution.devices[1]?.device.projectId.toString()).toBe(
      OTHER_PROJECT.toString(),
    );
  });

  test("an address that is no device of the probe is dropped: there is no project to ask or keep it for", async () => {
    const attribution: SyslogAttribution = await attribute(
      {
        sourceIpAddress: "10.9.0.1",
        identity: { macAddress: "d8:b3:70:fb:fc:dd" },
        headerHostname: "Lobby AP",
      },
      GLOBAL_PROBE,
    );

    expect(attribution).toEqual({ devices: [], unmatchedProjectId: null });
    expect(projectDevices).not.toHaveBeenCalled();
  });
});

describe("the address is no device of this probe, on a project's own probe", () => {
  test("a device of the project another probe polls is found by its address", async () => {
    expect(told(await attribute({ sourceIpAddress: "10.9.0.1" }))).toEqual(
      one(ROUTER, SyslogDeviceMatchKind.SourceAddress),
    );
  });

  test("...and by one of its Other Addresses, in any spelling", async () => {
    expect(told(await attribute({ sourceIpAddress: "10.255.0.9" }))).toEqual(
      one(SWITCH, SyslogDeviceMatchKind.SourceAddress),
    );
    expect(
      told(await attribute({ sourceIpAddress: "2001:db8:0:0:0:0:0:9" })),
    ).toEqual(one(SWITCH, SyslogDeviceMatchKind.SourceAddress));
  });

  test("an address two sites reuse is neither site's: the message is kept as nobody's", async () => {
    const attribution: SyslogAttribution = await attribute({
      sourceIpAddress: "192.168.1.1",
    });

    expect(attribution).toEqual({
      devices: [],
      unmatchedProjectId: PROJECT,
    });
  });

  test("a device behind NAT is found by the MAC address, serial number or address its message gives", async () => {
    expect(
      told(
        await attribute({
          sourceIpAddress: "203.0.113.50",
          identity: { macAddress: "d8:b3:70:fb:fc:dd" },
        }),
      ),
    ).toEqual(one(ACCESS_POINT, SyslogDeviceMatchKind.MacAddress));

    expect(
      told(
        await attribute({
          sourceIpAddress: "203.0.113.50",
          identity: { serialNumber: "x21000abcd12345" },
        }),
      ),
    ).toEqual(one(FIREWALL, SyslogDeviceMatchKind.SerialNumber));

    expect(
      told(
        await attribute({
          sourceIpAddress: "203.0.113.50",
          identity: { ipAddress: "10.0.0.1" },
        }),
      ),
    ).toEqual(one(FIREWALL, SyslogDeviceMatchKind.Address));

    expect(
      told(
        await attribute({
          sourceIpAddress: "203.0.113.50",
          headerHostname: "10.0.0.1",
        }),
      ),
    ).toEqual(one(FIREWALL, SyslogDeviceMatchKind.Address));
  });

  test("...and by the host name it sends: the device's name, system name, DNS name or discovered name", async () => {
    const names: Record<string, ObjectID> = {
      "HQ Firewall": FIREWALL,
      "fw-hq": FIREWALL,
      "warehouse-sw.example.com": SWITCH,
      "warehouse-sw": SWITCH,
      "branch-rtr-01": ROUTER,
      "Lobby AP": ACCESS_POINT,
    };

    for (const headerHostname of Object.keys(names)) {
      expect({
        headerHostname,
        told: told(
          await attribute({ sourceIpAddress: "203.0.113.50", headerHostname }),
        ),
      }).toEqual({
        headerHostname,
        told: one(
          names[headerHostname] as ObjectID,
          SyslogDeviceMatchKind.Hostname,
        ),
      });
    }
  });

  test("a name is the same in any case, with or without its domain, with a trailing dot", async () => {
    for (const headerHostname of [
      "FW-HQ",
      "fw-hq.example.net",
      "Warehouse-SW.Example.com.",
      "  warehouse-sw  ",
    ]) {
      const expected: ObjectID = headerHostname.toLowerCase().includes("fw-hq")
        ? FIREWALL
        : SWITCH;

      expect({
        headerHostname,
        told: told(
          await attribute({ sourceIpAddress: "203.0.113.50", headerHostname }),
        ),
      }).toEqual({
        headerHostname,
        told: one(expected, SyslogDeviceMatchKind.Hostname),
      });
    }
  });

  test("a name in the message's own fields is asked before the header's", async () => {
    expect(
      told(
        await attribute({
          sourceIpAddress: "203.0.113.50",
          identity: { hostname: "fw-hq" },
          headerHostname: "warehouse-sw",
        }),
      ),
    ).toEqual(one(FIREWALL, SyslogDeviceMatchKind.Hostname));
  });

  test("a name two devices carry names neither", async () => {
    // One is NAMED MikroTik, the other's system name is MikroTik.
    const attribution: SyslogAttribution = await attribute({
      sourceIpAddress: "203.0.113.50",
      headerHostname: "MikroTik",
    });

    expect(attribution).toEqual({ devices: [], unmatchedProjectId: PROJECT });
  });

  test("a name that tells no two machines apart names nobody", async () => {
    projectDevices.mockResolvedValue([
      device({ id: FIREWALL, name: "localhost", hostname: "10.0.0.1" }),
      device({ id: SWITCH, name: "unknown", hostname: "10.0.0.2" }),
    ] as never);

    for (const headerHostname of [
      "localhost",
      "LOCALHOST",
      "localhost.localdomain",
      "(none)",
      "unknown",
      "-",
      "",
      "   ",
    ]) {
      expect({
        headerHostname,
        attribution: await attribute({
          sourceIpAddress: "203.0.113.50",
          headerHostname,
        }),
      }).toEqual({
        headerHostname,
        attribution: { devices: [], unmatchedProjectId: PROJECT },
      });
    }
  });

  test("a MAC address is asked before a name, a serial number before an address", async () => {
    expect(
      told(
        await attribute({
          sourceIpAddress: "203.0.113.50",
          identity: {
            macAddress: "d8:b3:70:fb:fc:dd",
            serialNumber: "sn-7788",
            ipAddress: "10.0.0.1",
            hostname: "branch-rtr-01",
          },
        }),
      ),
    ).toEqual(one(ACCESS_POINT, SyslogDeviceMatchKind.MacAddress));

    expect(
      told(
        await attribute({
          sourceIpAddress: "203.0.113.50",
          identity: {
            serialNumber: "sn-7788",
            ipAddress: "10.0.0.1",
            hostname: "branch-rtr-01",
          },
        }),
      ),
    ).toEqual(one(SWITCH, SyslogDeviceMatchKind.SerialNumber));
  });

  test("nobody at all: the message is kept for the project, as from no device yet", async () => {
    const attribution: SyslogAttribution = await attribute({
      sourceIpAddress: "203.0.113.50",
      identity: { macAddress: "00:11:22:33:44:55", serialNumber: "nope" },
      headerHostname: "never-heard-of-it",
    });

    expect(attribution).toEqual({ devices: [], unmatchedProjectId: PROJECT });
  });

  test("a source that is not an address at all is still asked by name", async () => {
    expect(
      told(
        await attribute({
          sourceIpAddress: "not-an-address",
          headerHostname: "fw-hq",
        }),
      ),
    ).toEqual(one(FIREWALL, SyslogDeviceMatchKind.Hostname));
  });
});

describe("what a device is known by", () => {
  test("an address is never a name: a device registered by address is not found by a host name equal to it", async () => {
    projectDevices.mockResolvedValue([
      device({ id: FIREWALL, name: "10.0.0.9", hostname: "10.0.0.1" }),
    ] as never);

    // "10.0.0.9" is the device's NAME, not an address of it.
    expect(
      await attribute({
        sourceIpAddress: "203.0.113.50",
        headerHostname: "10.0.0.9",
      }),
    ).toEqual({ devices: [], unmatchedProjectId: PROJECT });
  });

  test("a device registered by a DNS name is known by it, whole and without its domain", async () => {
    projectDevices.mockResolvedValue([
      device({ id: SWITCH, name: "Closet", hostname: "sw-closet.corp.test" }),
    ] as never);

    for (const headerHostname of ["sw-closet.corp.test", "sw-closet"]) {
      expect(
        told(
          await attribute({ sourceIpAddress: "203.0.113.50", headerHostname }),
        ),
      ).toEqual(one(SWITCH, SyslogDeviceMatchKind.Hostname));
    }
  });

  test("rows without an id or a project are passed over", async () => {
    const nameless: NetworkDevice = new NetworkDevice();

    nameless.name = "fw-hq";
    projectDevices.mockResolvedValue([
      nameless,
      device({ id: FIREWALL, name: "fw-hq", hostname: "10.0.0.1" }),
    ] as never);

    expect(
      told(
        await attribute({
          sourceIpAddress: "203.0.113.50",
          headerHostname: "fw-hq",
        }),
      ),
    ).toEqual(one(FIREWALL, SyslogDeviceMatchKind.Hostname));
  });

  test("its vendor text is its Vendor, the maker of its sysObjectID, and its system description - each once", async () => {
    sourceIs(byId(ROUTER));

    expect(
      (await attribute({ sourceIpAddress: "10.9.0.1" })).devices[0]?.device
        .vendorText,
    ).toBe("MikroTik RouterOS CCR2004-16G-2S+");

    SyslogDeviceMatcher.clearCaches();
    projectDevices.mockResolvedValue([
      device({
        id: ROUTER,
        name: "r",
        hostname: "10.9.0.1",
        vendor: "MikroTik",
        sysObjectId: "1.3.6.1.4.1.14988.1",
        sysDescr: "x".repeat(2000),
      }),
    ] as never);

    const vendorText: string =
      (await attribute({ sourceIpAddress: "10.9.0.1" })).devices[0]?.device
        .vendorText || "";

    // "MikroTik" once, though the column and the sysObjectID both say it.
    expect(vendorText.startsWith("MikroTik xxx")).toBe(true);
    expect(vendorText.length).toBe(512);
  });

  test("reads only what matching needs, as root, for the one project", async () => {
    await attribute({ sourceIpAddress: "203.0.113.50" });

    expect(projectDevices).toHaveBeenCalledTimes(1);
    expect(projectDevices).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: PROJECT },
        select: {
          _id: true,
          projectId: true,
          name: true,
          hostname: true,
          dnsName: true,
          otherAddresses: true,
          discoveredName: true,
          macAddress: true,
          sysName: true,
          sysDescr: true,
          sysObjectId: true,
          vendor: true,
          serialNumber: true,
        },
        props: { isRoot: true },
      }),
    );
  });
});

describe("no probe", () => {
  test("a message from a probe that is not known is nobody's", async () => {
    expect(await attribute({ sourceIpAddress: "10.0.0.1" }, null)).toEqual({
      devices: [],
      unmatchedProjectId: null,
    });
    expect(probeDevices).not.toHaveBeenCalled();
    expect(projectDevices).not.toHaveBeenCalled();
  });

  test("getProbe answers with the probe's project, or null for a global one", async () => {
    const own: Probe = new Probe(PROBE);

    own.projectId = PROJECT;

    const findProbe: MockFunction = jest
      .spyOn(ProbeService, "findOneById")
      .mockResolvedValue(own as never) as unknown as MockFunction;

    expect(await SyslogDeviceMatcher.getProbe(PROBE)).toEqual({
      id: PROBE,
      projectId: PROJECT,
    });

    NetworkFlowDeviceMatcher.clearCaches();
    findProbe.mockResolvedValue(new Probe(PROBE) as never);

    expect(await SyslogDeviceMatcher.getProbe(PROBE)).toEqual({
      id: PROBE,
      projectId: null,
    });

    NetworkFlowDeviceMatcher.clearCaches();
    findProbe.mockResolvedValue(null as never);

    expect(await SyslogDeviceMatcher.getProbe(PROBE)).toBeNull();
  });
});

describe("caching, on a path every message takes", () => {
  test("a hundred messages from one address cost one look at the probe's devices and one at the project", async () => {
    sourceIs(byId(FIREWALL));

    for (let index: number = 0; index < 100; index++) {
      await attribute({ sourceIpAddress: "10.0.0.1" });
    }

    expect(probeDevices).toHaveBeenCalledTimes(1);
    expect(projectDevices).toHaveBeenCalledTimes(1);
  });

  test("an address that is nobody's is remembered too, and many of them share one read of the project", async () => {
    for (let index: number = 0; index < 50; index++) {
      await attribute({ sourceIpAddress: `203.0.113.${index % 5}` });
    }

    expect(probeDevices).toHaveBeenCalledTimes(5);
    expect(projectDevices).toHaveBeenCalledTimes(1);
  });

  test("another probe is asked on its own", async () => {
    sourceIs(byId(FIREWALL));

    await attribute({ sourceIpAddress: "10.0.0.1" });
    await attribute(
      { sourceIpAddress: "10.0.0.1" },
      { id: ObjectID.generate(), projectId: PROJECT },
    );

    expect(probeDevices).toHaveBeenCalledTimes(2);
    expect(projectDevices).toHaveBeenCalledTimes(1);
  });

  test("a device added shows up once the answers are CACHE_TTL_MS old", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-13T10:00:00.000Z"));

    expect(
      (await attribute({ sourceIpAddress: "10.50.0.1" })).unmatchedProjectId,
    ).toEqual(PROJECT);

    const added: ObjectID = ObjectID.generate();

    projectDevices.mockResolvedValue([
      ...PROJECT_DEVICES,
      device({ id: added, name: "New Switch", hostname: "10.50.0.1" }),
    ] as never);

    // Still the old answer, a second before it is due.
    jest.setSystemTime(new Date(Date.now() + CACHE_TTL_MS - 1000));
    expect((await attribute({ sourceIpAddress: "10.50.0.1" })).devices).toEqual(
      [],
    );

    jest.setSystemTime(new Date(Date.now() + 2000));
    expect(told(await attribute({ sourceIpAddress: "10.50.0.1" }))).toEqual(
      one(added, SyslogDeviceMatchKind.SourceAddress),
    );
  });

  test("clearCaches forgets everything at once", async () => {
    sourceIs(byId(FIREWALL));
    await attribute({ sourceIpAddress: "10.0.0.1" });

    SyslogDeviceMatcher.clearCaches();
    await attribute({ sourceIpAddress: "10.0.0.1" });

    expect(probeDevices).toHaveBeenCalledTimes(2);
    expect(projectDevices).toHaveBeenCalledTimes(2);
  });

  test("the answers stay fresh for a minute", () => {
    expect(CACHE_TTL_MS).toBe(60_000);
  });
});
