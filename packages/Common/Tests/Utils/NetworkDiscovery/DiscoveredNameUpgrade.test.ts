import {
  BestNamedHost,
  DiscoveredNameDeviceRow,
  DiscoveredNameUpgrade,
  IMPROVABLE_DEVICE_NAME_SOURCES,
  getBestNamedHostsByAddress,
  getImprovableHostAddresses,
  isHostStillTheDevice,
  listImprovableAddresses,
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
 *   (d) the result names the host from a strictly better source;
 *   (e) nothing says the address now belongs to another machine: a device
 *       with a DNS name is renamed only by a result that reports that same
 *       PTR name for its address.
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
      expect(
        plan({ devices: [row({ hostname: ` ${ADDRESS} ` })] }),
      ).toHaveLength(1);
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
      expect(plan({ devices: [row({ name: "Kitchen display 4" })] })).toEqual(
        [],
      );
    });

    test("never renames a device whose name only differs in case from the discovered one", () => {
      expect(
        plan({ devices: [row({ name: "WB-0024-KDS04.wbhq.com" })] }),
      ).toEqual([]);
    });

    test("never renames a device that does not say how it was named", () => {
      for (const discoveredNameSource of [undefined, null, "", "typed"]) {
        expect(
          plan({
            devices: [row({ discoveredNameSource: discoveredNameSource })],
          }),
        ).toEqual([]);
      }
    });

    test("never renames a device with a source but no discovered name", () => {
      expect(plan({ devices: [row({ discoveredName: undefined })] })).toEqual(
        [],
      );
    });

    test("a re-saved name with spaces around it is still discovery's", () => {
      expect(plan({ devices: [row({ name: ` ${PTR_NAME} ` })] })).toHaveLength(
        1,
      );
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
          hosts: [
            host({ netbiosName: undefined, dnsHostname: "kds04-new.wbhq.com" }),
          ],
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

  describe("(e) nothing says the address now belongs to another machine", () => {
    // A printer imported under its DNS name, on a DHCP range.
    const PRINTER_PTR: string = "printer-3f.corp.example.com";

    function printerRow(
      overrides: Partial<DiscoveredNameDeviceRow> = {},
    ): DiscoveredNameDeviceRow {
      return row({
        name: PRINTER_PTR,
        discoveredName: PRINTER_PTR,
        dnsName: PRINTER_PTR,
        ...overrides,
      });
    }

    test("never renames a device after the machine that took its address over: the PTR name changed", () => {
      /*
       * The lease moved to a laptop. Its NetBIOS name is a better SOURCE
       * than the printer's DNS name, but it is the laptop's name.
       */
      expect(
        plan({
          hosts: [
            host({
              dnsHostname: "laptop-xyz.corp.example.com",
              netbiosName: "LAPTOP-XYZ",
            }),
          ],
          devices: [printerRow()],
        }),
      ).toEqual([]);
    });

    test("never renames a device with a DNS name on a result with no PTR name for its address", () => {
      expect(
        plan({
          hosts: [host({ dnsHostname: undefined, netbiosName: "PRINTER-3F" })],
          devices: [printerRow()],
        }),
      ).toEqual([]);

      // A PTR answer that is not a usable name is no PTR name either.
      expect(
        plan({
          hosts: [
            host({
              dnsHostname: "54.42.16.10.in-addr.arpa",
              netbiosName: "PRINTER-3F",
            }),
          ],
          devices: [printerRow()],
        }),
      ).toEqual([]);
    });

    test("renames it once a result reports the same PTR name again", () => {
      expect(
        plan({
          hosts: [
            host({ dnsHostname: PRINTER_PTR, netbiosName: "PRINTER-3F" }),
          ],
          devices: [printerRow()],
        })[0]?.candidateNames,
      ).toEqual(["PRINTER-3F", `PRINTER-3F (${ADDRESS})`]);
    });

    test("a reverse-DNS lookup that timed out never renames a device to the NetBIOS stump of its own DNS name", () => {
      /*
       * Imported as its DNS name because NetBIOS answered with the first
       * fifteen characters of it. A later scan whose PTR lookup timed out
       * has nothing to compare the stump with, and the rule alone would
       * name the host by it; (e) keeps the device's name.
       */
      const fullName: string = "wb-0024-kitchen-display-03.wbhq.com";
      const stump: string = "WB-0024-KITCHEN";
      const device: DiscoveredNameDeviceRow = row({
        name: fullName,
        discoveredName: fullName,
        dnsName: fullName,
      });

      expect(
        plan({
          hosts: [host({ dnsHostname: undefined, netbiosName: stump })],
          devices: [device],
        }),
      ).toEqual([]);

      // And a scan that does carry the PTR name names the host by it: no better.
      expect(
        plan({
          hosts: [host({ dnsHostname: fullName, netbiosName: stump })],
          devices: [device],
        }),
      ).toEqual([]);
    });

    test("compares DNS names without case, surrounding spaces or the root dot", () => {
      for (const reported of [
        "PRINTER-3F.CORP.EXAMPLE.COM",
        "printer-3f.corp.example.com.",
        "  Printer-3F.Corp.Example.Com  ",
      ]) {
        expect(
          plan({
            hosts: [host({ dnsHostname: reported, netbiosName: "PRINTER-3F" })],
            devices: [printerRow()],
          }),
        ).toHaveLength(1);
      }

      expect(
        plan({
          hosts: [
            host({ dnsHostname: PRINTER_PTR, netbiosName: "PRINTER-3F" }),
          ],
          devices: [printerRow({ dnsName: " PRINTER-3F.corp.example.com. " })],
        }),
      ).toHaveLength(1);
    });

    test("a device whose DNS Name was cleared is held to the DNS name it was named by", () => {
      const cleared: DiscoveredNameDeviceRow = printerRow({ dnsName: null });

      expect(
        plan({
          hosts: [
            host({
              dnsHostname: "laptop-xyz.corp.example.com",
              netbiosName: "LAPTOP-XYZ",
            }),
          ],
          devices: [cleared],
        }),
      ).toEqual([]);

      const renamed: DiscoveredNameUpgrade | undefined = plan({
        hosts: [host({ dnsHostname: PRINTER_PTR, netbiosName: "PRINTER-3F" })],
        devices: [cleared],
      })[0];

      expect(renamed?.candidateNames[0]).toBe("PRINTER-3F");
      // And its DNS Name is filled again, as at import.
      expect(renamed?.dnsName).toBe(PRINTER_PTR);
    });

    test("a short (first-label) name is compared with the PTR name's first label", () => {
      const shortRow: DiscoveredNameDeviceRow = printerRow({
        name: "printer-3f",
        discoveredName: "printer-3f",
        dnsName: undefined,
      });

      expect(
        plan({
          hosts: [
            host({ dnsHostname: PRINTER_PTR, netbiosName: "PRINTER-3F" }),
          ],
          devices: [shortRow],
          scan: SHORT_NAMES,
        })[0]?.candidateNames[0],
      ).toBe("PRINTER-3F");

      expect(
        plan({
          hosts: [
            host({
              dnsHostname: "laptop-xyz.corp.example.com",
              netbiosName: "LAPTOP-XYZ",
            }),
          ],
          devices: [shortRow],
          scan: SHORT_NAMES,
        }),
      ).toEqual([]);

      // A one-label DNS Name a person typed reads the same way.
      expect(
        plan({
          hosts: [
            host({ dnsHostname: PRINTER_PTR, netbiosName: "PRINTER-3F" }),
          ],
          devices: [printerRow({ dnsName: "printer-3f" })],
        }),
      ).toHaveLength(1);
    });

    test("a NetBIOS-named device with a DNS Name takes its SNMP name only while the PTR name still matches", () => {
      const netbiosRow: DiscoveredNameDeviceRow = row({
        name: NETBIOS_NAME,
        discoveredName: NETBIOS_NAME,
        discoveredNameSource: DeviceNameSource.NetbiosName,
        dnsName: PTR_NAME,
      });

      expect(
        plan({
          hosts: [
            host({
              sysName: "kds04-snmp",
              snmpReachable: true,
              dnsHostname: undefined,
            }),
          ],
          devices: [netbiosRow],
        }),
      ).toEqual([]);

      expect(
        plan({
          hosts: [host({ sysName: "kds04-snmp", snmpReachable: true })],
          devices: [netbiosRow],
        })[0]?.discoveredNameSource,
      ).toBe(DeviceNameSource.SystemName);
    });

    test("a device named by its address has no DNS name to compare, and takes what the result finds there", () => {
      expect(
        plan({
          hosts: [
            host({
              dnsHostname: "laptop-xyz.corp.example.com",
              netbiosName: "LAPTOP-XYZ",
            }),
          ],
          devices: [
            row({
              name: ADDRESS,
              discoveredName: ADDRESS,
              discoveredNameSource: DeviceNameSource.Address,
              dnsName: undefined,
            }),
          ],
        })[0]?.candidateNames[0],
      ).toBe("LAPTOP-XYZ");
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
              dnsName: "ws-0042.corp.example.com",
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

    test("is never overwritten, even by another spelling of the same name", () => {
      const upgrade: DiscoveredNameUpgrade | undefined = plan({
        devices: [row({ dnsName: "WB-0024-KDS04.WBHQ.COM." })],
      })[0];

      // Renamed: the result still reports that DNS name, see (e)...
      expect(upgrade?.discoveredNameSource).toBe(DeviceNameSource.NetbiosName);
      // ...and the DNS Name the device has is left as it is.
      expect(upgrade).not.toHaveProperty("dnsName");
    });

    test("is not filled from an unusable PTR answer", () => {
      // A device named by its address: nothing for (e) to compare.
      expect(
        plan({
          hosts: [host({ dnsHostname: "54.42.16.10.in-addr.arpa" })],
          devices: [
            row({
              name: ADDRESS,
              discoveredName: ADDRESS,
              discoveredNameSource: DeviceNameSource.Address,
              dnsName: undefined,
            }),
          ],
        })[0],
      ).toEqual({
        deviceId: "device-1",
        hostname: ADDRESS,
        fromName: ADDRESS,
        fromSource: DeviceNameSource.Address,
        candidateNames: [NETBIOS_NAME, `${NETBIOS_NAME} (${ADDRESS})`],
        discoveredNameSource: DeviceNameSource.NetbiosName,
      });
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
        devices: [
          row({
            name: ADDRESS,
            discoveredName: ADDRESS,
            discoveredNameSource: DeviceNameSource.Address,
            dnsName: undefined,
          }),
        ],
      })[0];

      expect(upgrade?.dnsName).toBeDefined();
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

describe("planDiscoveredNameUpgrades with the result already read", () => {
  test("plans from the map it is handed, without reading the hosts again", () => {
    const bestHosts: Map<string, BestNamedHost> = getBestNamedHostsByAddress([
      host(),
    ]);

    expect(
      planDiscoveredNameUpgrades({
        projectId: PROJECT_ID,
        // Never read when the map is given.
        hosts: "not a host list",
        bestHosts: bestHosts,
        devices: [row()],
        scan: FULL_NAMES,
      }),
    ).toEqual(plan());
  });

  test("an empty map plans nothing", () => {
    expect(
      planDiscoveredNameUpgrades({
        projectId: PROJECT_ID,
        hosts: [host()],
        bestHosts: new Map<string, BestNamedHost>(),
        devices: [row()],
        scan: FULL_NAMES,
      }),
    ).toEqual([]);
  });

  test("a device list that is not a list plans nothing, and never throws", () => {
    expect(
      planDiscoveredNameUpgrades({
        projectId: PROJECT_ID,
        hosts: [host()],
        devices: "rows" as unknown as Array<DiscoveredNameDeviceRow>,
        scan: FULL_NAMES,
      }),
    ).toEqual([]);
  });
});

describe("isHostStillTheDevice", () => {
  test("is true with no DNS name to compare, whatever the result reports", () => {
    expect(
      isHostStillTheDevice(
        row({ dnsName: undefined }),
        host({ dnsHostname: undefined }),
        DeviceNameSource.Address,
      ),
    ).toBe(true);
    expect(
      isHostStillTheDevice(
        row({ dnsName: "   ", discoveredName: ADDRESS }),
        host({ dnsHostname: "anything.example.com" }),
        DeviceNameSource.Address,
      ),
    ).toBe(true);
  });

  test("reads the discovered name as the DNS name only for a device named by DNS", () => {
    // Named by NetBIOS, no DNS Name: the NetBIOS name is not a DNS name.
    expect(
      isHostStillTheDevice(
        row({ dnsName: undefined, discoveredName: NETBIOS_NAME }),
        host({ dnsHostname: undefined }),
        DeviceNameSource.NetbiosName,
      ),
    ).toBe(true);
    expect(
      isHostStillTheDevice(
        row({ dnsName: undefined, discoveredName: PTR_NAME }),
        host({ dnsHostname: undefined }),
        DeviceNameSource.DnsName,
      ),
    ).toBe(false);
  });

  test("is false for a PTR value that is not text, and never throws", () => {
    for (const value of [42, {}, [], true]) {
      expect(
        isHostStillTheDevice(
          row(),
          host({ dnsHostname: value as unknown as string }),
          DeviceNameSource.DnsName,
        ),
      ).toBe(false);
    }
  });

  test("never matches a longer name by its prefix", () => {
    expect(
      isHostStillTheDevice(
        row({ dnsName: "kds04.wbhq.com" }),
        host({ dnsHostname: "kds04.wbhq.com.evil.example" }),
        DeviceNameSource.DnsName,
      ),
    ).toBe(false);
    expect(
      isHostStillTheDevice(
        row({ dnsName: "kds04" }),
        host({ dnsHostname: "kds045.wbhq.com" }),
        DeviceNameSource.DnsName,
      ),
    ).toBe(false);
  });
});

describe("listImprovableAddresses", () => {
  test("lists the addresses a map names by more than their address, in its order", () => {
    expect(
      listImprovableAddresses(
        getBestNamedHostsByAddress([
          host({ ipAddress: "10.0.0.2" }),
          host({
            ipAddress: "10.0.0.1",
            dnsHostname: undefined,
            netbiosName: undefined,
          }),
          host({ ipAddress: "10.0.0.3", netbiosName: undefined }),
        ]),
      ),
    ).toEqual(["10.0.0.2", "10.0.0.3"]);
  });

  test("is empty for an empty map", () => {
    expect(listImprovableAddresses(new Map<string, BestNamedHost>())).toEqual(
      [],
    );
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
