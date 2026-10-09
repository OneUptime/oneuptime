import {
  NetworkDeviceAssetFacts,
  NetworkDeviceAssetSource,
  getNetworkDeviceAssetFacts,
  getNetworkDeviceDnsName,
  getNetworkDeviceHostname,
  getNetworkDeviceIpAddress,
  getNetworkDeviceLocation,
  getNetworkDeviceManufacturer,
  getNetworkDeviceType,
  isIpAddressLiteral,
  readText,
  toOtelMacAddress,
} from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";
import { TopologyDeviceRoleInput } from "../../../Utils/Monitor/NetworkDeviceRoleCatalog";
import { DEFAULT_NETWORK_DEVICE_ROLES } from "../../../Types/NetworkDevice/DefaultNetworkDeviceRole";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #4569: a Cisco Meraki MX85 in a customer's Inventory read
 *
 *   oneuptime.resource.id = f795b9a6-...
 *   net.device.hostname   = 10.241.124.1
 *   os.description        = Meraki MX85
 *
 * - an IP address under "hostname", and no maker, model or type although the
 * device's own name, its sysDescr and its role said all three. These pin
 * where each asset fact of a network device comes from.
 */

// What the poller leaves on a locally-polled Meraki MX: system group only.
function merakiMx(
  overrides: Partial<NetworkDeviceAssetSource> = {},
): NetworkDeviceAssetSource {
  return {
    name: "UN0362WANRTR01",
    hostname: "10.241.124.1",
    sysName: "UN0362WANRTR01",
    sysDescr: "Meraki MX85",
    ...overrides,
  };
}

// A switch as the poller leaves it after a full ENTITY-MIB walk.
function entityMibSwitch(
  overrides: Partial<NetworkDeviceAssetSource> = {},
): NetworkDeviceAssetSource {
  return {
    name: "core-sw-01",
    hostname: "10.20.0.1",
    dnsName: "core-sw-01.corp.example.com",
    sysName: "core-sw-01",
    macAddress: "00:1b:54:c2:7a:01",
    vendor: "Cisco",
    deviceModel: "WS-C3850-48P",
    serialNumber: "FOC1840X0AB",
    firmwareVersion: "16.12.4",
    softwareVersion: "16.12.04",
    sysObjectId: "1.3.6.1.4.1.9.1.1745",
    sysDescr:
      "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.4, RELEASE SOFTWARE (fc5)",
    sysLocation: "DC1, Rack 14",
    site: { name: "London DC1" },
    ...overrides,
  };
}

const PROJECT_ROLES: Array<TopologyDeviceRoleInput> =
  DEFAULT_NETWORK_DEVICE_ROLES.map(
    (role: { key: string; name: string }): TopologyDeviceRoleInput => {
      return { key: role.key, name: role.name };
    },
  );

describe("getNetworkDeviceAssetFacts (issue #4569)", () => {
  test("the issue's Meraki MX: name, address, maker, model and type, from sysName and sysDescr alone", () => {
    expect(getNetworkDeviceAssetFacts(merakiMx())).toEqual({
      hostname: "UN0362WANRTR01",
      ipAddress: "10.241.124.1",
      dnsName: undefined,
      macAddress: undefined,
      serialNumber: undefined,
      manufacturer: "Cisco Meraki",
      model: "MX85",
      firmwareVersion: undefined,
      operatingSystem: undefined,
      osVersion: undefined,
      deviceType: "Firewall",
      site: undefined,
      location: undefined,
    } as NetworkDeviceAssetFacts);
  });

  test("a full ENTITY-MIB switch: every fact, ENTITY-MIB's values kept as walked", () => {
    expect(getNetworkDeviceAssetFacts(entityMibSwitch())).toEqual({
      hostname: "core-sw-01",
      ipAddress: "10.20.0.1",
      dnsName: "core-sw-01.corp.example.com",
      macAddress: "00-1B-54-C2-7A-01",
      serialNumber: "FOC1840X0AB",
      manufacturer: "Cisco",
      model: "WS-C3850-48P",
      firmwareVersion: "16.12.4",
      operatingSystem: "Cisco IOS XE",
      // ENTITY-MIB's software revision beats the sysDescr's "16.12.4".
      osVersion: "16.12.04",
      deviceType: "Switch",
      site: "London DC1",
      location: "DC1, Rack 14",
    } as NetworkDeviceAssetFacts);
  });

  test("ENTITY-MIB wins over the sysDescr for every fact both know", () => {
    const facts: NetworkDeviceAssetFacts = getNetworkDeviceAssetFacts({
      sysDescr:
        "Juniper Networks, Inc. ex2200-24t-4g Ethernet Switch, kernel JUNOS 12.3R6.6, Build date",
      deviceModel: "EX2200-24T-4G",
      softwareVersion: "12.3R6.6-entity",
      vendor: "Juniper Networks",
    });

    expect(facts.model).toBe("EX2200-24T-4G");
    expect(facts.osVersion).toBe("12.3R6.6-entity");
    expect(facts.manufacturer).toBe("Juniper Networks");
    // Only the sysDescr knows the OS name.
    expect(facts.operatingSystem).toBe("Junos OS");
  });

  test("a device that has never been walked has an address and nothing else", () => {
    expect(getNetworkDeviceAssetFacts({ hostname: "10.20.0.9" })).toEqual({
      hostname: undefined,
      ipAddress: "10.20.0.9",
      dnsName: undefined,
      macAddress: undefined,
      serialNumber: undefined,
      manufacturer: undefined,
      model: undefined,
      firmwareVersion: undefined,
      operatingSystem: undefined,
      osVersion: undefined,
      deviceType: undefined,
      site: undefined,
      location: undefined,
    } as NetworkDeviceAssetFacts);
  });

  test("an empty device has no facts, and nothing throws", () => {
    const facts: NetworkDeviceAssetFacts = getNetworkDeviceAssetFacts({});
    for (const value of Object.values(facts)) {
      expect(value).toBeUndefined();
    }
  });

  test("values of the wrong type read as unknown rather than throwing", () => {
    const facts: NetworkDeviceAssetFacts = getNetworkDeviceAssetFacts({
      name: 42,
      hostname: { ip: "10.0.0.1" },
      dnsName: 7,
      sysName: ["core"],
      macAddress: 123,
      vendor: true,
      deviceModel: null,
      serialNumber: 99,
      sysDescr: 5,
      sysLocation: {},
      site: { name: 12 },
      networkDeviceRole: { key: 3, name: false },
    });

    for (const value of Object.values(facts)) {
      expect(value).toBeUndefined();
    }
  });
});

describe("the hostname is the device's own name, never its IP address", () => {
  test("the sysName names it", () => {
    expect(getNetworkDeviceHostname(merakiMx())).toBe("UN0362WANRTR01");
  });

  test("a device named only by its address has no hostname", () => {
    expect(
      getNetworkDeviceHostname({
        name: "10.241.124.1",
        hostname: "10.241.124.1",
      }),
    ).toBeUndefined();
  });

  test("a sysName that is an IP address or a placeholder does not name it", () => {
    expect(
      getNetworkDeviceHostname({
        sysName: "10.241.124.1",
        hostname: "10.241.124.1",
      }),
    ).toBeUndefined();
    expect(
      getNetworkDeviceHostname({ sysName: "localhost", hostname: "10.0.0.1" }),
    ).toBeUndefined();
  });

  test("its DNS name names it when it reports no sysName", () => {
    expect(
      getNetworkDeviceHostname({
        hostname: "10.0.0.7",
        dnsName: "edge-rtr-07.corp.example.com",
      }),
    ).toBe("edge-rtr-07.corp.example.com");
  });

  test("a placeholder sysName gives way to the DNS name", () => {
    expect(
      getNetworkDeviceHostname({
        sysName: "localhost",
        hostname: "10.0.0.7",
        dnsName: "edge-rtr-07.corp.example.com",
      }),
    ).toBe("edge-rtr-07.corp.example.com");
  });

  test("the NetBIOS name discovery found names a Windows host", () => {
    expect(
      getNetworkDeviceHostname({
        hostname: "10.0.24.3",
        dnsName: "wb-0024-kds03.wbhq.com",
        discoveredName: "WB0024KDS03",
        discoveredNameSource: "netbios-name",
      }),
    ).toBe("WB0024KDS03");
  });

  test("a sysName discovery recorded still names a device not yet walked", () => {
    expect(
      getNetworkDeviceHostname({
        hostname: "10.0.0.1",
        discoveredName: "core-sw-01",
        discoveredNameSource: "system-name",
      }),
    ).toBe("core-sw-01");
  });

  test("a DNS name discovery recorded names it when the DNS column is empty", () => {
    expect(
      getNetworkDeviceHostname({
        hostname: "10.0.0.1",
        discoveredName: "core-sw-01.corp.example.com",
        discoveredNameSource: "dns-name",
      }),
    ).toBe("core-sw-01.corp.example.com");
  });

  test("an address discovery recorded is not a hostname", () => {
    expect(
      getNetworkDeviceHostname({
        hostname: "10.0.0.1",
        discoveredName: "10.0.0.1",
        discoveredNameSource: "address",
      }),
    ).toBeUndefined();
  });

  test("the record's own name is not mistaken for a hostname", () => {
    // A name a person typed is the item's title, not something the device reports.
    expect(
      getNetworkDeviceHostname({
        name: "Store 0362 WAN router",
        hostname: "10.0.0.1",
      }),
    ).toBeUndefined();
  });

  test("a device polled by its DNS name is named by it", () => {
    expect(
      getNetworkDeviceHostname({ hostname: "core-sw-01.corp.example.com" }),
    ).toBe("core-sw-01.corp.example.com");
  });
});

describe("the IP address and DNS name are facts of their own", () => {
  test.each([
    ["10.241.124.1", "10.241.124.1"],
    ["2001:db8::1", "2001:db8::1"],
    ["  10.0.0.1  ", "10.0.0.1"],
    ["core-sw-01.corp.example.com", undefined],
    ["core-sw-01", undefined],
    ["", undefined],
  ])(
    "polled at %p, the IP address is %p",
    (hostname: string, ip: string | undefined) => {
      expect(getNetworkDeviceIpAddress({ hostname })).toBe(ip);
    },
  );

  test("the stored DNS name wins over the polled address", () => {
    expect(
      getNetworkDeviceDnsName({
        hostname: "core-sw-01.mgmt.example.com",
        dnsName: "core-sw-01.corp.example.com",
      }),
    ).toBe("core-sw-01.corp.example.com");
  });

  test("a device polled by DNS name has that DNS name", () => {
    expect(
      getNetworkDeviceDnsName({ hostname: "core-sw-01.corp.example.com" }),
    ).toBe("core-sw-01.corp.example.com");
  });

  test("an IP address is never a DNS name", () => {
    expect(getNetworkDeviceDnsName({ hostname: "10.0.0.1" })).toBeUndefined();
    expect(
      getNetworkDeviceDnsName({ hostname: "2001:db8::1" }),
    ).toBeUndefined();
  });

  test("a polled value that is no DNS name at all is not one", () => {
    expect(
      getNetworkDeviceDnsName({ hostname: "core switch <1>" }),
    ).toBeUndefined();
  });

  test.each([
    ["10.0.0.1", true],
    ["2001:db8::1", true],
    ["fe80::1", true],
    ["256.0.0.1", false],
    ["core-sw-01", false],
    [undefined, false],
    [42, false],
  ])("isIpAddressLiteral(%p) is %p", (value: unknown, expected: boolean) => {
    expect(isIpAddressLiteral(value)).toBe(expected);
  });
});

describe("the manufacturer", () => {
  test("Meraki's sysObjectID names it when the poller stored it", () => {
    expect(
      getNetworkDeviceManufacturer(
        merakiMx({
          vendor: "Cisco Meraki",
          sysObjectId: "1.3.6.1.4.1.29671.2.110",
        }),
      ),
    ).toBe("Cisco Meraki");
  });

  test("Meraki's sysDescr names it when nothing else does", () => {
    expect(getNetworkDeviceManufacturer(merakiMx())).toBe("Cisco Meraki");
  });

  test("ENTITY-MIB's manufacturer is kept as walked", () => {
    expect(
      getNetworkDeviceManufacturer({
        vendor: "Cisco Systems, Inc.",
        sysObjectId: "1.3.6.1.4.1.9.1.1745",
        sysDescr: "Cisco IOS Software, Version 15.0(2)SE11",
      }),
    ).toBe("Cisco Systems, Inc.");
  });

  /*
   * An EdgeSwitch answers with Broadcom's FASTPATH arc, so the poller's
   * vendor column says Broadcom; its sysDescr says what it is.
   */
  test("a platform the sysDescr names beats the bare enterprise arc", () => {
    expect(
      getNetworkDeviceManufacturer({
        vendor: "Broadcom",
        sysObjectId: "1.3.6.1.4.1.4413.1.1.43",
        sysDescr:
          "EdgeSwitch 24-Port Lite, 1.9.3.5089037, Linux 3.6.5-f4a26ed5, 0.0.00.0000",
      }),
    ).toBe("Ubiquiti");
  });

  test("an SNMP agent is not a manufacturer", () => {
    expect(
      getNetworkDeviceManufacturer({
        vendor: "Net-SNMP",
        sysObjectId: "1.3.6.1.4.1.8072.3.2.10",
        sysDescr: "Linux fw01 5.10.0-21-amd64 #1 SMP x86_64",
      }),
    ).toBeUndefined();
  });

  test("a typed vendor on a device that is never walked is kept", () => {
    expect(getNetworkDeviceManufacturer({ vendor: "Lantronix" })).toBe(
      "Lantronix",
    );
  });

  test("nothing known is no manufacturer", () => {
    expect(getNetworkDeviceManufacturer({})).toBeUndefined();
  });
});

describe("the device type is the role the map draws", () => {
  test("the role an operator assigned wins, by its name", () => {
    expect(
      getNetworkDeviceType(
        merakiMx({ networkDeviceRole: { key: "router", name: "Router" } }),
      ),
    ).toBe("Router");
  });

  test("a custom role keeps its own name", () => {
    expect(
      getNetworkDeviceType(
        merakiMx({
          networkDeviceRole: { key: "sdWanEdge", name: "SD-WAN Edge" },
        }),
      ),
    ).toBe("SD-WAN Edge");
  });

  test("with no assignment, the classifier's role by the built-in name", () => {
    expect(getNetworkDeviceType(merakiMx())).toBe("Firewall");
    expect(getNetworkDeviceType(entityMibSwitch())).toBe("Switch");
  });

  test("the project's name for the classified role, as the map labels it", () => {
    const renamed: Array<TopologyDeviceRoleInput> = PROJECT_ROLES.map(
      (role: TopologyDeviceRoleInput): TopologyDeviceRoleInput => {
        return role.key === "firewall"
          ? { key: role.key, name: "Security appliance" }
          : role;
      },
    );

    expect(getNetworkDeviceType(merakiMx(), { roles: renamed })).toBe(
      "Security appliance",
    );
  });

  test("a project without the classified role falls back to the built-in name", () => {
    expect(
      getNetworkDeviceType(merakiMx(), {
        roles: [{ key: "switch", name: "Switch" }],
      }),
    ).toBe("Firewall");
  });

  test("a device nothing classifies has no type, as the map draws it neutral", () => {
    expect(getNetworkDeviceType({ hostname: "10.0.0.9" })).toBeUndefined();
  });

  test("the address-based name convention still classifies it", () => {
    expect(
      getNetworkDeviceType({ hostname: "10.0.0.9", name: "edge-fw01" }),
    ).toBe("Firewall");
  });
});

describe("the location", () => {
  test("the device's own sysLocation", () => {
    expect(getNetworkDeviceLocation({ sysLocation: "  DC1, Rack 14 " })).toBe(
      "DC1, Rack 14",
    );
  });

  test.each([
    "Sitting on the Dock of the Bay",
    "Unknown",
    "(none)",
    "n/a",
    "-",
    "NOT SET",
    "",
    "   ",
  ])("the agent default %p is no location", (sysLocation: string) => {
    expect(getNetworkDeviceLocation({ sysLocation })).toBeUndefined();
  });

  test("the site is a fact of its own", () => {
    expect(
      getNetworkDeviceAssetFacts(merakiMx({ site: { name: "Store 0362" } }))
        .site,
    ).toBe("Store 0362");
  });
});

describe("toOtelMacAddress", () => {
  test.each([
    ["00:1b:54:c2:7a:01", "00-1B-54-C2-7A-01"],
    ["00-1B-54-C2-7A-01", "00-1B-54-C2-7A-01"],
    ["001b.54c2.7a01", "00-1B-54-C2-7A-01"],
    ["001B54C27A01", "00-1B-54-C2-7A-01"],
  ])("%p becomes %p", (value: string, expected: string) => {
    expect(toOtelMacAddress(value)).toBe(expected);
  });

  test("a value that is not a 48-bit MAC is passed through", () => {
    expect(toOtelMacAddress("see rack label")).toBe("see rack label");
  });

  test.each([undefined, null, ""])("%p is no MAC", (value: unknown) => {
    expect(toOtelMacAddress(value as string | undefined)).toBeUndefined();
  });
});

describe("readText", () => {
  test.each([
    [" a ", "a"],
    ["", undefined],
    ["   ", undefined],
    [1, undefined],
    [null, undefined],
    [undefined, undefined],
    [{}, undefined],
  ])("readText(%p) is %p", (value: unknown, expected: string | undefined) => {
    expect(readText(value)).toBe(expected);
  });
});
