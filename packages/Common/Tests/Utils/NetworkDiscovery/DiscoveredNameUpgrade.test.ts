import {
  DiscoveredNameDeviceRow,
  DiscoveredNameUpgrade,
  IMPROVABLE_DEVICE_NAME_SOURCES,
  getBestNamedHostsByAddress,
  getImprovableHostAddresses,
  planDiscoveredNameUpgrades,
} from "../../../Utils/NetworkDiscovery/DiscoveredNameUpgrade";
import {
  DiscoveredHostNaming,
  MAX_DEVICE_DNS_NAME_LENGTH,
} from "../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { DeviceNameSource } from "../../../Types/NetworkDevice/DeviceNameSource";
import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { describe, expect, test } from "@jest/globals";

/*
 * Improving the names discovery gave devices when a later scan finds a better
 * one (OneUptime issue #4518). Every condition is one where getting it wrong
 * renames something nobody asked to have renamed — a device in another
 * project, a device a person named, a device whose name would get WORSE — so
 * each is pinned positive and negative:
 *
 *   (a) the scan's project only;
 *   (b) the device's hostname is an address this result reports;
 *   (c) the device is still called exactly what discovery named it;
 *   (d) the result names the host from a strictly better source.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT_ID: string = "55555555-5555-4555-8555-555555555555";
const ADDRESS: string = "10.16.42.54";
const PTR_NAME: string = "wb-0024-kds04.wbhq.com";
const NETBIOS_NAME: string = "WB0024KDS04";

const FULL_NAMES: DiscoveredHostNaming = { useShortDeviceNames: false };
const SHORT_NAMES: DiscoveredHostNaming = { useShortDeviceNames: true };

// The reported display, as a later scan that asked NetBIOS reports it.
function host(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return {
    ipAddress: ADDRESS,
    snmpReachable: false,
    dnsHostname: PTR_NAME,
    netbiosName: NETBIOS_NAME,
    ...overrides,
  };
}

// A device an earlier scan imported under its DNS name.
function row(
  overrides: Partial<DiscoveredNameDeviceRow> = {},
): DiscoveredNameDeviceRow {
  return {
    deviceId: "device-1",
    projectId: PROJECT_ID,
    name: PTR_NAME,
    hostname: ADDRESS,
    dnsName: PTR_NAME,
    discoveredName: PTR_NAME,
    discoveredNameSource: DeviceNameSource.DnsName,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    ...overrides,
  };
}

function plan(
  data: {
    hosts?: unknown;
    devices?: Array<DiscoveredNameDeviceRow>;
    scan?: DiscoveredHostNaming;
    projectId?: string;
  } = {},
): Array<DiscoveredNameUpgrade> {
  return planDiscoveredNameUpgrades({
    projectId: data.projectId ?? PROJECT_ID,
    hosts: "hosts" in data ? data.hosts : [host()],
    devices: data.devices ?? [row()],
    scan: data.scan ?? FULL_NAMES,
  });
}

describe("planDiscoveredNameUpgrades", () => {
  test("renames a device imported under its DNS name to the Windows name a later scan found", () => {
    expect(plan()).toEqual([
      {
        deviceId: "device-1",
        hostname: ADDRESS,
        fromName: PTR_NAME,
        fromSource: DeviceNameSource.DnsName,
        candidateNames: [NETBIOS_NAME, `${NETBIOS_NAME} (${ADDRESS})`],
        discoveredNameSource: DeviceNameSource.NetbiosName,
      },
    ]);
  });

  test("renames a device imported under its address to the first name a later scan found", () => {
    expect(
      plan({
        hosts: [host({ netbiosName: undefined })],
        devices: [
          row({
            name: ADDRESS,
            discoveredName: ADDRESS,
            discoveredNameSource: DeviceNameSource.Address,
            dnsName: undefined,
          }),
        ],
      }),
    ).toEqual([
      {
        deviceId: "device-1",
        hostname: ADDRESS,
        fromName: ADDRESS,
        fromSource: DeviceNameSource.Address,
        candidateNames: [PTR_NAME, `${PTR_NAME} (${ADDRESS})`],
        discoveredNameSource: DeviceNameSource.DnsName,
        // Filled, as at import.
        dnsName: PTR_NAME,
      },
    ]);
  });

  test("renames a NetBIOS-named device once the host answers SNMP with a name", () => {
    expect(
      plan({
        hosts: [host({ sysName: "kds04-snmp", snmpReachable: true })],
        devices: [
          row({
            name: NETBIOS_NAME,
            discoveredName: NETBIOS_NAME,
            discoveredNameSource: DeviceNameSource.NetbiosName,
          }),
        ],
      })[0],
    ).toMatchObject({
      candidateNames: ["kds04-snmp", `kds04-snmp (${ADDRESS})`],
      discoveredNameSource: DeviceNameSource.SystemName,
      fromSource: DeviceNameSource.NetbiosName,
    });
  });

  test("names under the scan's naming choice, as an import would", () => {
    expect(
      plan({
        hosts: [host({ netbiosName: undefined })],
        devices: [
          row({
            name: ADDRESS,
            discoveredName: ADDRESS,
            discoveredNameSource: DeviceNameSource.Address,
          }),
        ],
        scan: SHORT_NAMES,
      })[0]?.candidateNames,
    ).toEqual(["wb-0024-kds04", `wb-0024-kds04 (${ADDRESS})`]);
  });

  describe("(a) the scan's project only", () => {
    test("never plans a device in another project", () => {
      expect(plan({ devices: [row({ projectId: OTHER_PROJECT_ID })] })).toEqual(
        [],
      );
    });

    test("never plans a device whose project is unknown, or for a blank project", () => {
      expect(plan({ devices: [row({ projectId: undefined })] })).toEqual([]);
      expect(plan({ devices: [row({ projectId: null })] })).toEqual([]);
      expect(plan({ projectId: "  " })).toEqual([]);
    });
  });

  describe("(b) an address this result reports", () => {
    test("never plans a device at an address the result does not report", () => {
      expect(plan({ devices: [row({ hostname: "10.16.42.99" })] })).toEqual([]);
    });

    test("matches the address trimmed, and never a blank one", () => {
      expect(plan({ devices: [row({ hostname: ` ${ADDRESS} ` })] })).toHaveLength(
        1,
      );
      expect(plan({ devices: [row({ hostname: "" })] })).toEqual([]);
      expect(plan({ devices: [row({ hostname: null })] })).toEqual([]);
    });

    test("a result that is not a list of hosts plans nothing, and never throws", () => {
      for (const hosts of [undefined, null, "x", 42, {}, [null, 42, "x"]]) {
        expect(plan({ hosts: hosts })).toEqual([]);
      }
    });
  });

  describe("(c) still called exactly what discovery named it", () => {
    test("never renames a device a person renamed", () => {
      expect(plan({ devices: [row({ name: "Kitchen display 4" })] })).toEqual([]);
    });

    test("never renames a device whose name only differs in case from the discovered one", () => {
      expect(
        plan({ devices: [row({ name: "WB-0024-KDS04.wbhq.com" })] }),
      ).toEqual([]);
    });

    test("never renames a device that does not say how it was named", () => {
      for (const discoveredNameSource of [undefined, null, "", "typed"]) {
        expect(
          plan({ devices: [row({ discoveredNameSource: discoveredNameSource })] }),
        ).toEqual([]);
      }
    });

    test("never renames a device with a source but no discovered name", () => {
      expect(plan({ devices: [row({ discoveredName: undefined })] })).toEqual(
        [],
      );
    });

    test("a re-saved name with spaces around it is still discovery's", () => {
      expect(plan({ devices: [row({ name: ` ${PTR_NAME} ` })] })).toHaveLength(1);
    });
  });

  describe("(d) a strictly better source", () => {
    test("never renames to a name from the same source, even a different one", () => {
      /*
       * The DNS record changed: the device keeps the name discovery gave it.
       * A name is improved, never merely changed.
       */
      expect(
        plan({
          hosts: [host({ netbiosName: undefined, dnsHostname: "kds04-new.wbhq.com" })],
        }),
      ).toEqual([]);
    });

    test("never renames to a worse source: a lost NetBIOS reply cannot drop a name back to DNS", () => {
      expect(
        plan({
          hosts: [host({ netbiosName: undefined })],
          devices: [
            row({
              name: NETBIOS_NAME,
              discoveredName: NETBIOS_NAME,
              discoveredNameSource: DeviceNameSource.NetbiosName,
            }),
          ],
        }),
      ).toEqual([]);
    });

    test("never renames a device to its address", () => {
      expect(
        plan({
          hosts: [host({ netbiosName: undefined, dnsHostname: undefined })],
        }),
      ).toEqual([]);
    });

    test("nothing beats an SNMP name", () => {
      expect(
        plan({
          hosts: [host({ sysName: "other-snmp-name", snmpReachable: true })],
          devices: [
            row({
              name: "kds04-snmp",
              discoveredName: "kds04-snmp",
              discoveredNameSource: DeviceNameSource.SystemName,
            }),
          ],
        }),
      ).toEqual([]);
    });
  });

  describe("the candidate names", () => {
    test("include the device's own name when only its case changes, so the rename still goes through", () => {
      /*
       * A DNS short name "ws-0042" and the NetBIOS name "WS-0042" are the same
       * name in another case. The engine leaves the device itself out of the
       * collision count, so the first candidate is free.
       */
      expect(
        plan({
          hosts: [
            host({
              ipAddress: "10.0.0.42",
              dnsHostname: "ws-0042.corp.example.com",
              netbiosName: "WS-0042",
            }),
          ],
          devices: [
            row({
              hostname: "10.0.0.42",
              name: "ws-0042",
              discoveredName: "ws-0042",
            }),
          ],
          scan: SHORT_NAMES,
        })[0]?.candidateNames,
      ).toEqual(["WS-0042", "WS-0042 (10.0.0.42)"]);
    });

    test("are never blank, and never listed twice", () => {
      for (const upgrade of plan()) {
        for (const candidate of upgrade.candidateNames) {
          expect(candidate.trim()).toBe(candidate);
          expect(candidate).not.toBe("");
        }

        expect(
          new Set(
            upgrade.candidateNames.map((name: string): string => {
              return name.toLowerCase();
            }),
          ).size,
        ).toBe(upgrade.candidateNames.length);
      }
    });
  });

  describe("the DNS Name", () => {
    test("is filled when the device has none and the host has a usable PTR record", () => {
      expect(plan({ devices: [row({ dnsName: undefined })] })[0]?.dnsName).toBe(
        PTR_NAME,
      );
      expect(plan({ devices: [row({ dnsName: "  " })] })[0]?.dnsName).toBe(
        PTR_NAME,
      );
    });

    test("is never overwritten", () => {
      expect(
        plan({ devices: [row({ dnsName: "old.wbhq.com" })] })[0],
      ).not.toHaveProperty("dnsName");
    });

    test("is not filled from an unusable PTR answer", () => {
      expect(
        plan({
          hosts: [host({ dnsHostname: "54.42.16.10.in-addr.arpa" })],
          devices: [row({ dnsName: undefined })],
        })[0],
      ).not.toHaveProperty("dnsName");
    });

    test("is clamped to the column's DNS-name ceiling", () => {
      const longName: string = [
        "a".repeat(63),
        "b".repeat(63),
        "c".repeat(63),
        "d".repeat(61),
      ].join(".");

      expect(longName.length).toBe(253);

      const upgrade: DiscoveredNameUpgrade | undefined = plan({
        hosts: [host({ dnsHostname: longName })],
        devices: [row({ dnsName: undefined })],
      })[0];

      expect(upgrade?.dnsName?.length).toBeLessThanOrEqual(
        MAX_DEVICE_DNS_NAME_LENGTH,
      );
    });
  });

  describe("order and duplicates", () => {
    test("one plan per device, however many times the reads returned it", () => {
      expect(plan({ devices: [row(), row(), row()] })).toHaveLength(1);
    });

    test("oldest device first, then by address, then by id", () => {
      const hosts: Array<DiscoveredNetworkDevice> = [
        host({ ipAddress: "10.0.0.3" }),
        host({ ipAddress: "10.0.0.1" }),
        host({ ipAddress: "10.0.0.2" }),
      ];

      const upgrades: Array<DiscoveredNameUpgrade> = plan({
        hosts: hosts,
        devices: [
          row({
            deviceId: "c",
            hostname: "10.0.0.3",
            createdAt: new Date("2026-10-03T00:00:00.000Z"),
          }),
          row({
            deviceId: "b",
            hostname: "10.0.0.2",
            createdAt: new Date("2026-10-01T00:00:00.000Z"),
          }),
          row({
            deviceId: "a",
            hostname: "10.0.0.1",
            createdAt: new Date("2026-10-01T00:00:00.000Z"),
          }),
          row({ deviceId: "z", hostname: "10.0.0.1", createdAt: undefined }),
        ],
      });

      expect(
        upgrades.map((upgrade: DiscoveredNameUpgrade): string => {
          return upgrade.deviceId;
        }),
      ).toEqual(["a", "b", "c", "z"]);
    });

    test("an address on several rows is named by the row with the best source", () => {
      /*
       * Duplicate rows are normal. A row the NetBIOS lookup missed must not
       * shadow a later row it answered for.
       */
      expect(
        plan({
          hosts: [host({ netbiosName: undefined }), host()],
        })[0]?.discoveredNameSource,
      ).toBe(DeviceNameSource.NetbiosName);
    });
  });
});

describe("getBestNamedHostsByAddress", () => {
  test("keeps the first row on a tie, and a better row over a worse one", () => {
    const best: ReturnType<typeof getBestNamedHostsByAddress> =
      getBestNamedHostsByAddress([
        host({ netbiosName: "FIRST" }),
        host({ netbiosName: "SECOND" }),
        host({ netbiosName: undefined, dnsHostname: undefined }),
      ]);

    expect(best.get(ADDRESS)?.host.netbiosName).toBe("FIRST");
    expect(best.get(ADDRESS)?.source).toBe(DeviceNameSource.NetbiosName);
  });

  test("skips rows with no address, or one too long to be a hostname", () => {
    expect(
      getBestNamedHostsByAddress([
        host({ ipAddress: "" }),
        host({ ipAddress: "1".repeat(101) }),
      ]).size,
    ).toBe(0);
  });
});

describe("getImprovableHostAddresses", () => {
  test("lists the addresses a result names by more than their address", () => {
    expect(
      getImprovableHostAddresses([
        host(),
        host({ ipAddress: "10.0.0.2", netbiosName: undefined }),
        host({
          ipAddress: "10.0.0.3",
          netbiosName: undefined,
          dnsHostname: undefined,
        }),
      ]),
    ).toEqual([ADDRESS, "10.0.0.2"]);
  });

  test("is empty for anything that is not a host list", () => {
    expect(getImprovableHostAddresses(undefined)).toEqual([]);
    expect(getImprovableHostAddresses("hosts")).toEqual([]);
  });
});

describe("IMPROVABLE_DEVICE_NAME_SOURCES", () => {
  test("is every source but the device's SNMP name, which nothing beats", () => {
    expect(IMPROVABLE_DEVICE_NAME_SOURCES).toEqual([
      DeviceNameSource.NetbiosName,
      DeviceNameSource.DnsName,
      DeviceNameSource.Address,
    ]);
  });
});
