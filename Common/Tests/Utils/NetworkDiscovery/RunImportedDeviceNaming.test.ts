import {
  MAX_DISCOVERED_HOST_ADDRESS_LENGTH,
  RunImportedDeviceRename,
  RunImportedDeviceRow,
  getNamedHostsByAddress,
  planRunImportedDeviceRenames,
  toEpochMilliseconds,
} from "../../../Utils/NetworkDiscovery/RunImportedDeviceNaming";
import {
  DiscoveredHostNaming,
  MAX_DEVICE_DNS_NAME_LENGTH,
  MAX_DEVICE_NAME_LENGTH,
  buildDeviceName,
  buildFallbackDeviceName,
} from "../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { describe, expect, test } from "@jest/globals";

/*
 * The decision logic behind renaming the devices a discovery run imported by
 * address before it knew their names (part of OneUptime issue #3677).
 *
 * Auto-import (and an operator in the Review dialog) can import from a
 * running sweep's partial snapshots, and those never carry reverse-DNS names —
 * the probe resolves them after the sweep. So a host with no sysName imports
 * as "10.18.166.51", and when the Completed result lands with its PTR name the
 * import engine skips the host as already registered. These rules decide
 * which of those devices get the name the run finally resolved.
 *
 * Every rule here is one where getting it wrong renames something nobody
 * asked to have renamed — a device in another project, a device an operator
 * named, or a device that has been named by its address for a year and just
 * happens to be re-reported by a scan after an upgrade — so each condition is
 * pinned positive AND negative:
 *
 *   (a) the scan's project only;
 *   (b) the device's hostname is an address this result reports;
 *   (c) the device is still named by that bare address;
 *   (d) the device was created during this run (createdAt >= startedAt);
 *   (e) the host now has a name that is not its address.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT_ID: string = "55555555-5555-4555-8555-555555555555";

const RUN_STARTED_AT: Date = new Date("2026-09-15T10:00:00.000Z");
const DURING_RUN: Date = new Date("2026-09-15T10:05:00.000Z");
const BEFORE_RUN: Date = new Date("2026-09-15T09:59:59.999Z");
const RUN_COMPLETED_AT: Date = new Date("2026-09-15T11:00:00.000Z");
const AFTER_RUN: Date = new Date("2026-09-15T11:00:00.001Z");

const ADDRESS: string = "10.18.166.51";
const PTR_NAME: string = "kds01.wbhq.com";

const FULL_NAMES: DiscoveredHostNaming = { useShortDeviceNames: false };
const SHORT_NAMES: DiscoveredHostNaming = { useShortDeviceNames: true };

function host(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return {
    ipAddress: ADDRESS,
    dnsHostname: PTR_NAME,
    ...overrides,
  };
}

// A device imported mid-run from a partial snapshot: named by its address.
function row(
  overrides: Partial<RunImportedDeviceRow> = {},
): RunImportedDeviceRow {
  return {
    deviceId: "device-1",
    projectId: PROJECT_ID,
    name: ADDRESS,
    hostname: ADDRESS,
    createdAt: DURING_RUN,
    ...overrides,
  };
}

function plan(
  data: {
    hosts?: unknown;
    devices?: Array<RunImportedDeviceRow>;
    scan?: DiscoveredHostNaming;
    runStartedAt?: Date | string | null | undefined;
    runCompletedAt?: Date | string | null | undefined;
    projectId?: string;
  } = {},
): Array<RunImportedDeviceRename> {
  return planRunImportedDeviceRenames({
    projectId: data.projectId ?? PROJECT_ID,
    hosts: "hosts" in data ? data.hosts : [host()],
    devices: data.devices ?? [row()],
    scan: data.scan ?? FULL_NAMES,
    runStartedAt: "runStartedAt" in data ? data.runStartedAt : RUN_STARTED_AT,
    runCompletedAt:
      "runCompletedAt" in data ? data.runCompletedAt : RUN_COMPLETED_AT,
  });
}

describe("planRunImportedDeviceRenames", () => {
  test("renames a device the run imported by address to the PTR name the final result resolved", () => {
    expect(plan()).toEqual([
      {
        deviceId: "device-1",
        hostname: ADDRESS,
        fromName: ADDRESS,
        candidateNames: [PTR_NAME, `${PTR_NAME} (${ADDRESS})`],
        dnsName: PTR_NAME,
      },
    ]);
  });

  describe("(a) the scan's project only", () => {
    test("plans a device in the scan's project", () => {
      expect(plan()).toHaveLength(1);
    });

    test("never plans a device in another project, whatever else matches", () => {
      expect(plan({ devices: [row({ projectId: OTHER_PROJECT_ID })] })).toEqual(
        [],
      );
    });

    test("never plans a device whose project is unknown", () => {
      expect(plan({ devices: [row({ projectId: undefined })] })).toEqual([]);
      expect(plan({ devices: [row({ projectId: null })] })).toEqual([]);
    });

    test("plans nothing when the scan's project is blank", () => {
      expect(plan({ projectId: "  " })).toEqual([]);
    });
  });

  describe("(b) an address this result reports", () => {
    test("plans a device whose hostname is a reported address", () => {
      expect(plan()[0]?.hostname).toBe(ADDRESS);
    });

    test("does not plan a device whose hostname matches no host in the result", () => {
      expect(
        plan({
          devices: [row({ name: "10.18.166.99", hostname: "10.18.166.99" })],
        }),
      ).toEqual([]);
    });

    test("matches a hostname stored with surrounding whitespace", () => {
      expect(
        plan({ devices: [row({ hostname: `  ${ADDRESS} ` })] })[0]?.hostname,
      ).toBe(ADDRESS);
    });

    test("does not plan a device with no hostname", () => {
      expect(plan({ devices: [row({ hostname: undefined })] })).toEqual([]);
      expect(plan({ devices: [row({ hostname: "" })] })).toEqual([]);
    });
  });

  describe("(c) still named by its bare address", () => {
    test("does not plan a device an operator has named", () => {
      expect(plan({ devices: [row({ name: "Store 0660 KDS" })] })).toEqual([]);
    });

    test("does not plan a device already named by the resolved name", () => {
      expect(plan({ devices: [row({ name: PTR_NAME })] })).toEqual([]);
    });

    test("does not plan a device named by the address plus something else", () => {
      expect(plan({ devices: [row({ name: `${ADDRESS} (old)` })] })).toEqual(
        [],
      );
    });

    test("treats a name that differs from the hostname only by whitespace as the address", () => {
      const plans: Array<RunImportedDeviceRename> = plan({
        devices: [row({ name: ` ${ADDRESS}  ` })],
      });

      expect(plans).toHaveLength(1);
      expect(plans[0]?.fromName).toBe(ADDRESS);
    });

    test("treats a name that differs from the hostname only by case as the address", () => {
      const ipv6: string = "fe80::a1b2";

      expect(
        plan({
          hosts: [host({ ipAddress: ipv6 })],
          devices: [row({ name: "FE80::A1B2", hostname: ipv6 })],
        }),
      ).toHaveLength(1);
    });

    test("does not plan a device with no name", () => {
      expect(plan({ devices: [row({ name: undefined })] })).toEqual([]);
      expect(plan({ devices: [row({ name: "   " })] })).toEqual([]);
    });
  });

  describe("(d) created during this run", () => {
    test("plans a device created after the run started", () => {
      expect(plan()).toHaveLength(1);
    });

    test("plans a device created in the very millisecond the run started", () => {
      expect(
        plan({ devices: [row({ createdAt: new Date(RUN_STARTED_AT) })] }),
      ).toHaveLength(1);
    });

    test("does not plan a device created before the run — a long-standing address-named device stays as it is", () => {
      expect(plan({ devices: [row({ createdAt: BEFORE_RUN })] })).toEqual([]);
    });

    test("reads createdAt and startedAt given as ISO strings", () => {
      expect(
        plan({
          devices: [row({ createdAt: DURING_RUN.toISOString() })],
          runStartedAt: RUN_STARTED_AT.toISOString(),
        }),
      ).toHaveLength(1);
      expect(
        plan({
          devices: [row({ createdAt: BEFORE_RUN.toISOString() })],
          runStartedAt: RUN_STARTED_AT.toISOString(),
        }),
      ).toEqual([]);
    });

    /*
     * The upper bound. A Completed result is processed again when a rule save
     * re-arms it or a capped import resumes, and a device that appeared AFTER
     * the run finished — typed in by hand as its address, or deleted and
     * re-added — was never imported from this run's partial snapshot. The
     * re-armed pass must not rename it.
     */
    test("does not plan a device created after the run completed", () => {
      expect(plan({ devices: [row({ createdAt: AFTER_RUN })] })).toEqual([]);
    });

    test("counts a device created in the same millisecond the run completed", () => {
      expect(
        plan({ devices: [row({ createdAt: new Date(RUN_COMPLETED_AT) })] }),
      ).toHaveLength(1);
    });

    test("reads completedAt given as an ISO string", () => {
      expect(
        plan({
          devices: [row({ createdAt: AFTER_RUN.toISOString() })],
          runCompletedAt: RUN_COMPLETED_AT.toISOString(),
        }),
      ).toEqual([]);
    });

    test("plans nothing at all when the scan has no completedAt, or a junk one", () => {
      expect(plan({ runCompletedAt: undefined })).toEqual([]);
      expect(plan({ runCompletedAt: null })).toEqual([]);
      expect(plan({ runCompletedAt: "not a date" })).toEqual([]);
    });

    test("plans nothing at all when the scan has no startedAt", () => {
      expect(plan({ runStartedAt: undefined })).toEqual([]);
      expect(plan({ runStartedAt: null })).toEqual([]);
      expect(plan({ runStartedAt: "" })).toEqual([]);
    });

    test("plans nothing when startedAt is not a date", () => {
      expect(plan({ runStartedAt: "not a date" })).toEqual([]);
      expect(plan({ runStartedAt: new Date("nope") })).toEqual([]);
    });

    test("does not plan a device whose createdAt is missing or junk", () => {
      expect(plan({ devices: [row({ createdAt: undefined })] })).toEqual([]);
      expect(plan({ devices: [row({ createdAt: "yesterday-ish" })] })).toEqual(
        [],
      );
    });
  });

  describe("(e) the host now has a name", () => {
    test("names a host by its PTR record when it has no sysName", () => {
      expect(plan()[0]?.candidateNames[0]).toBe(PTR_NAME);
    });

    test("names a host by its sysName, which wins over its PTR record", () => {
      expect(
        plan({ hosts: [host({ sysName: "core-sw-01" })] })[0]?.candidateNames,
      ).toEqual(["core-sw-01", `core-sw-01 (${ADDRESS})`]);
    });

    test("names a host with a sysName and no PTR record by its sysName", () => {
      expect(
        plan({
          hosts: [host({ sysName: "core-sw-01", dnsHostname: undefined })],
        })[0]?.candidateNames[0],
      ).toBe("core-sw-01");
    });

    test("does not plan a device whose host still has neither a sysName nor a PTR record", () => {
      expect(plan({ hosts: [host({ dnsHostname: undefined })] })).toEqual([]);
    });

    test("does not plan a device whose host's only 'name' is its own address", () => {
      expect(plan({ hosts: [host({ sysName: ADDRESS })] })).toEqual([]);
      expect(
        plan({
          hosts: [host({ sysName: ` ${ADDRESS} `, dnsHostname: undefined })],
        }),
      ).toEqual([]);
    });

    test("does not treat an unusable PTR answer as a name", () => {
      expect(
        plan({ hosts: [host({ dnsHostname: "51.166.18.10.in-addr.arpa" })] }),
      ).toEqual([]);
      expect(
        plan({ hosts: [host({ dnsHostname: "<script>.example.com" })] }),
      ).toEqual([]);
      expect(plan({ hosts: [host({ dnsHostname: "10.18.166.51" })] })).toEqual(
        [],
      );
    });
  });

  describe("the scan's naming choice", () => {
    test("uses the full PTR name when short names are off", () => {
      expect(plan({ scan: FULL_NAMES })[0]?.candidateNames).toEqual([
        PTR_NAME,
        `${PTR_NAME} (${ADDRESS})`,
      ]);
    });

    test("treats a missing naming choice as full names", () => {
      expect(plan({ scan: {} })[0]?.candidateNames[0]).toBe(PTR_NAME);
    });

    test("uses the short hostname, and a short fallback, when short names are on", () => {
      expect(plan({ scan: SHORT_NAMES })[0]?.candidateNames).toEqual([
        "kds01",
        `kds01 (${ADDRESS})`,
      ]);
    });

    test("still stores the full PTR name as dnsName when short names are on", () => {
      expect(plan({ scan: SHORT_NAMES })[0]?.dnsName).toBe(PTR_NAME);
    });

    test("computes both candidates with the same builder the import uses", () => {
      const discovered: DiscoveredNetworkDevice = host({
        sysName: "edge-router.corp.example.com",
      });

      for (const naming of [FULL_NAMES, SHORT_NAMES]) {
        expect(
          plan({ hosts: [discovered], scan: naming })[0]?.candidateNames,
        ).toEqual([
          buildDeviceName(discovered, naming),
          buildFallbackDeviceName(discovered, naming),
        ]);
      }
    });

    test("clamps an over-long sysName to the device name ceiling, in both candidates", () => {
      const longName: string = "x".repeat(200);
      const candidates: Array<string> = plan({
        hosts: [host({ sysName: longName })],
      })[0]!.candidateNames;

      expect(candidates[0]).toHaveLength(MAX_DEVICE_NAME_LENGTH);
      expect(candidates[1]!.length).toBeLessThanOrEqual(MAX_DEVICE_NAME_LENGTH);
      expect(candidates[1]!.endsWith(` (${ADDRESS})`)).toBe(true);
    });
  });

  describe("dnsName", () => {
    test("is filled in when the device has none and the host has a valid PTR record", () => {
      expect(plan()[0]?.dnsName).toBe(PTR_NAME);
    });

    test("is filled in when the device's dnsName is blank", () => {
      expect(plan({ devices: [row({ dnsName: "  " })] })[0]?.dnsName).toBe(
        PTR_NAME,
      );
    });

    test("is never overwritten on a device that already has one", () => {
      const plans: Array<RunImportedDeviceRename> = plan({
        devices: [row({ dnsName: "old-name.wbhq.com" })],
      });

      expect(plans).toHaveLength(1);
      expect(plans[0]?.dnsName).toBeUndefined();
      expect("dnsName" in plans[0]!).toBe(false);
    });

    test("is not set from a sysName when the host has no PTR record", () => {
      const plans: Array<RunImportedDeviceRename> = plan({
        hosts: [
          host({ sysName: "core-sw.corp.example.com", dnsHostname: undefined }),
        ],
      });

      expect(plans).toHaveLength(1);
      expect("dnsName" in plans[0]!).toBe(false);
    });

    test("is not set from an unusable PTR answer, while a sysName still renames the device", () => {
      const plans: Array<RunImportedDeviceRename> = plan({
        hosts: [host({ sysName: "core-sw-01", dnsHostname: "bad name.com" })],
      });

      expect(plans[0]?.candidateNames[0]).toBe("core-sw-01");
      expect("dnsName" in plans[0]!).toBe(false);
    });

    test("drops a PTR answer's root dot, as the builder does", () => {
      expect(
        plan({ hosts: [host({ dnsHostname: `${PTR_NAME}.` })] })[0]?.dnsName,
      ).toBe(PTR_NAME);
    });

    test("never exceeds the dnsName ceiling", () => {
      const label: string = "a".repeat(60);
      const longPtr: string = [label, label, label, "example", "com"].join(".");

      const dnsName: string | undefined = plan({
        hosts: [host({ dnsHostname: longPtr })],
      })[0]?.dnsName;

      expect(dnsName).toBe(longPtr);
      expect(dnsName!.length).toBeLessThanOrEqual(MAX_DEVICE_DNS_NAME_LENGTH);
    });
  });

  describe("the stored result's rows", () => {
    test("uses the first row that names an address when the address is listed twice", () => {
      expect(
        plan({
          hosts: [
            host({ dnsHostname: undefined }),
            host({ dnsHostname: "second.wbhq.com" }),
            host({ dnsHostname: "third.wbhq.com" }),
          ],
        })[0]?.candidateNames[0],
      ).toBe("second.wbhq.com");
    });

    test("plans a device once when its address is listed on several rows", () => {
      expect(plan({ hosts: [host(), host(), host()] })).toHaveLength(1);
    });

    test("plans a device once when the same row is passed twice", () => {
      expect(plan({ devices: [row(), row()] })).toHaveLength(1);
    });

    test("survives null rows, non-object rows and non-string fields in the jsonb", () => {
      const plans: Array<RunImportedDeviceRename> = plan({
        hosts: [
          null,
          undefined,
          42,
          "10.18.166.51",
          { ipAddress: { nested: true }, dnsHostname: "junk.example.com" },
          { ipAddress: null, dnsHostname: "nobody.example.com" },
          { ipAddress: ADDRESS, sysName: 42, dnsHostname: PTR_NAME },
        ],
      });

      expect(plans).toHaveLength(1);
      // The numeric sysName is blanked, so the PTR record names the host.
      expect(plans[0]?.candidateNames[0]).toBe(PTR_NAME);
    });

    test("reads a numeric address as its string", () => {
      expect(
        plan({
          hosts: [{ ipAddress: 7, dnsHostname: PTR_NAME }],
          devices: [row({ name: "7", hostname: "7" })],
        }),
      ).toHaveLength(1);
    });

    test("reads an address with surrounding whitespace as the trimmed address", () => {
      expect(
        plan({ hosts: [host({ ipAddress: `  ${ADDRESS}  ` })] }),
      ).toHaveLength(1);
    });

    test("plans nothing when the result is not an array", () => {
      expect(plan({ hosts: undefined })).toEqual([]);
      expect(plan({ hosts: null })).toEqual([]);
      expect(plan({ hosts: { ipAddress: ADDRESS } })).toEqual([]);
      expect(plan({ hosts: "[]" })).toEqual([]);
    });

    test("ignores a junk device row rather than throwing", () => {
      expect(
        plan({
          devices: [
            null as unknown as RunImportedDeviceRow,
            { deviceId: "" } as RunImportedDeviceRow,
            {
              deviceId: "device-2",
              projectId: PROJECT_ID,
              name: 42,
              hostname: ADDRESS,
              createdAt: DURING_RUN,
            } as unknown as RunImportedDeviceRow,
            row(),
          ],
        }),
      ).toHaveLength(1);
    });
  });

  describe("several devices", () => {
    test("orders plans oldest device first, so the first import keeps the plain name", () => {
      const plans: Array<RunImportedDeviceRename> = plan({
        hosts: [
          host({ ipAddress: "10.0.0.1", dnsHostname: "shared.example.com" }),
          host({ ipAddress: "10.0.0.2", dnsHostname: "shared.example.com" }),
        ],
        devices: [
          row({
            deviceId: "later",
            name: "10.0.0.2",
            hostname: "10.0.0.2",
            createdAt: new Date("2026-09-15T10:07:00.000Z"),
          }),
          row({
            deviceId: "earlier",
            name: "10.0.0.1",
            hostname: "10.0.0.1",
            createdAt: new Date("2026-09-15T10:02:00.000Z"),
          }),
        ],
      });

      expect(
        plans.map((entry: RunImportedDeviceRename): string => {
          return entry.deviceId;
        }),
      ).toEqual(["earlier", "later"]);
    });

    test("breaks a createdAt tie by address and then by id", () => {
      const plans: Array<RunImportedDeviceRename> = plan({
        hosts: [
          host({ ipAddress: "10.0.0.2" }),
          host({ ipAddress: "10.0.0.1" }),
        ],
        devices: [
          row({ deviceId: "b", name: "10.0.0.2", hostname: "10.0.0.2" }),
          row({ deviceId: "d", name: "10.0.0.1", hostname: "10.0.0.1" }),
          row({ deviceId: "c", name: "10.0.0.1", hostname: "10.0.0.1" }),
        ],
      });

      expect(
        plans.map((entry: RunImportedDeviceRename): string => {
          return entry.deviceId;
        }),
      ).toEqual(["c", "d", "b"]);
    });

    test("plans every eligible device and none of the rest", () => {
      const plans: Array<RunImportedDeviceRename> = plan({
        hosts: [
          host({ ipAddress: "10.0.0.1", dnsHostname: "one.example.com" }),
          host({ ipAddress: "10.0.0.2", dnsHostname: "two.example.com" }),
          host({ ipAddress: "10.0.0.3", dnsHostname: undefined }),
          host({ ipAddress: "10.0.0.4", dnsHostname: "four.example.com" }),
        ],
        devices: [
          row({ deviceId: "one", name: "10.0.0.1", hostname: "10.0.0.1" }),
          row({ deviceId: "two", name: "hand-named", hostname: "10.0.0.2" }),
          row({ deviceId: "three", name: "10.0.0.3", hostname: "10.0.0.3" }),
          row({
            deviceId: "four",
            name: "10.0.0.4",
            hostname: "10.0.0.4",
            createdAt: BEFORE_RUN,
          }),
        ],
      });

      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({
        deviceId: "one",
        candidateNames: ["one.example.com", "one.example.com (10.0.0.1)"],
      });
    });
  });
});

describe("getNamedHostsByAddress", () => {
  test("keys the hosts that have a name by their address", () => {
    const named: Map<string, DiscoveredNetworkDevice> = getNamedHostsByAddress(
      [
        host({ ipAddress: "10.0.0.1" }),
        host({ ipAddress: "10.0.0.2", dnsHostname: undefined }),
        host({
          ipAddress: "10.0.0.3",
          sysName: "sw-3",
          dnsHostname: undefined,
        }),
      ],
      FULL_NAMES,
    );

    expect(Array.from(named.keys())).toEqual(["10.0.0.1", "10.0.0.3"]);
  });

  test("skips a row with no address, or one too long to be a device's hostname", () => {
    const named: Map<string, DiscoveredNetworkDevice> = getNamedHostsByAddress(
      [
        host({ ipAddress: "" }),
        host({ ipAddress: "   " }),
        host({ ipAddress: "1".repeat(MAX_DISCOVERED_HOST_ADDRESS_LENGTH + 1) }),
        host({ ipAddress: "1".repeat(MAX_DISCOVERED_HOST_ADDRESS_LENGTH) }),
      ],
      FULL_NAMES,
    );

    expect(Array.from(named.keys())).toEqual([
      "1".repeat(MAX_DISCOVERED_HOST_ADDRESS_LENGTH),
    ]);
  });

  test("returns nothing for a value that is not an array", () => {
    expect(getNamedHostsByAddress(undefined, FULL_NAMES).size).toBe(0);
    expect(getNamedHostsByAddress({}, FULL_NAMES).size).toBe(0);
  });
});

describe("toEpochMilliseconds", () => {
  test("reads a Date and an ISO string to the same instant", () => {
    expect(toEpochMilliseconds(RUN_STARTED_AT)).toBe(RUN_STARTED_AT.getTime());
    expect(toEpochMilliseconds(RUN_STARTED_AT.toISOString())).toBe(
      RUN_STARTED_AT.getTime(),
    );
  });

  test("reads anything else as no date at all", () => {
    expect(toEpochMilliseconds(undefined)).toBeUndefined();
    expect(toEpochMilliseconds(null)).toBeUndefined();
    expect(toEpochMilliseconds("")).toBeUndefined();
    expect(toEpochMilliseconds("garbage")).toBeUndefined();
    expect(toEpochMilliseconds(new Date("garbage"))).toBeUndefined();
    expect(toEpochMilliseconds(1757930400000)).toBeUndefined();
  });
});
