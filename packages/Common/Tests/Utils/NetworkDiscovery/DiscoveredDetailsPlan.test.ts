import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { DeviceNameSource } from "../../../Types/NetworkDevice/DeviceNameSource";
import {
  NetworkDeviceDiscoveredDetails,
  NetworkDeviceDiscoveredField,
  NetworkDeviceDiscoveryReaderType,
  readNetworkDeviceDiscoveredDetails,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  DiscoveredAddressFindings,
  DiscoveredDetailsDeviceRow,
  DiscoveredDetailsPatch,
  DiscoveredMachineMatch,
  buildDiscoveredDetailsForImport,
  getDiscoveredAddressFindings,
  getScanReadTime,
  getScanReader,
  listDiscoveredAddresses,
  matchDiscoveredMachine,
  planDiscoveredDetails,
} from "../../../Utils/NetworkDiscovery/DiscoveredDetailsPlan";

/*
 * What a discovery scan's result records about the devices already at the
 * addresses it swept (issue #5185): each value the scan read, credited to the
 * scan and the time its run finished - only for a device the result agrees
 * is the machine at its address, never backwards in time, and never into the
 * device's own columns (these are only ever patches to its discovered
 * details).
 */

const PROJECT_ID: string = "1c9d4a7b-0000-4000-8000-000000000011";
const OTHER_PROJECT_ID: string = "1c9d4a7b-0000-4000-8000-000000000022";
const SCAN_ID: string = "80000000-0000-4000-8000-000000000001";
const COMPLETED_AT: string = "2026-10-23T09:00:00.000Z";
const EARLIER: string = "2026-10-22T09:00:00.000Z";
const LATER: string = "2026-10-24T09:00:00.000Z";

const SCAN: {
  id: string;
  name: string;
  cidr: string;
  completedAt: string;
} = {
  id: SCAN_ID,
  name: "Store subnets",
  cidr: "10.20.12.0/24",
  completedAt: COMPLETED_AT,
};

const CATALYST: string =
  "Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E8, RELEASE SOFTWARE (fc3)";

function snmpHost(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return {
    ipAddress: "10.20.12.7",
    sysName: "edge-sw-07",
    sysDescr: CATALYST,
    sysObjectId: "1.3.6.1.4.1.9.1.1208",
    sysLocation: "Store 12, back office rack",
    sysContact: "netops@acme.example",
    dnsHostname: "edge-sw-07.store-12.acme.example",
    snmpReachable: true,
    ...overrides,
  };
}

function pingHost(
  overrides: Partial<DiscoveredNetworkDevice> = {},
): DiscoveredNetworkDevice {
  return {
    ipAddress: "10.20.12.30",
    dnsHostname: "kds-03.store-12.acme.example",
    netbiosName: "WB0012KDS03",
    snmpReachable: false,
    ...overrides,
  };
}

function device(
  overrides: Partial<DiscoveredDetailsDeviceRow> = {},
): DiscoveredDetailsDeviceRow {
  return {
    deviceId: "40000000-0000-4000-8000-000000000007",
    projectId: PROJECT_ID,
    hostname: "10.20.12.7",
    ...overrides,
  };
}

function plan(
  hosts: Array<DiscoveredNetworkDevice>,
  devices: Array<DiscoveredDetailsDeviceRow>,
  scan: typeof SCAN = SCAN,
): Array<DiscoveredDetailsPatch> {
  return planDiscoveredDetails({
    projectId: PROJECT_ID,
    scan: scan,
    hosts: hosts,
    devices: devices,
  });
}

// What a device would hold after a patch, as the merge statement applies it.
function apply(
  current: Record<string, unknown>,
  patch: DiscoveredDetailsPatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const key of patch.unset) {
    delete next[key];
  }
  return { ...next, ...patch.set };
}

function detailsAfter(
  patch: DiscoveredDetailsPatch,
  current: Record<string, unknown> = {},
): NetworkDeviceDiscoveredDetails {
  return readNetworkDeviceDiscoveredDetails(apply(current, patch));
}

describe("getDiscoveredAddressFindings", () => {
  test("an SNMP host: its whole system group, its PTR name", () => {
    const findings: Map<string, DiscoveredAddressFindings> =
      getDiscoveredAddressFindings([snmpHost()]);

    expect(findings.get("10.20.12.7")).toEqual({
      address: "10.20.12.7",
      answeredSnmp: true,
      snmp: {
        sysName: "edge-sw-07",
        sysDescr: CATALYST,
        sysObjectId: "1.3.6.1.4.1.9.1.1208",
        sysLocation: "Store 12, back office rack",
        sysContact: "netops@acme.example",
      },
      dnsName: "edge-sw-07.store-12.acme.example",
    });
  });

  test("a ping-only host: its names, and no SNMP answer", () => {
    expect(
      getDiscoveredAddressFindings([pingHost()]).get("10.20.12.30"),
    ).toEqual({
      address: "10.20.12.30",
      answeredSnmp: false,
      snmp: {},
      dnsName: "kds-03.store-12.acme.example",
      netbiosName: "WB0012KDS03",
    });
  });

  test("a ping-only row's stray SNMP fields are not an SNMP answer", () => {
    const findings: DiscoveredAddressFindings | undefined =
      getDiscoveredAddressFindings([
        pingHost({ sysName: "leftover", sysDescr: "leftover" }),
      ]).get("10.20.12.30");

    expect(findings?.answeredSnmp).toBe(false);
    expect(findings?.snmp).toEqual({});
  });

  test("an address on two rows: the fuller SNMP answer, whole; names from the first row with each", () => {
    const findings: DiscoveredAddressFindings | undefined =
      getDiscoveredAddressFindings([
        snmpHost({
          sysName: "short-answer",
          sysDescr: undefined,
          sysObjectId: undefined,
          sysLocation: undefined,
          sysContact: undefined,
          dnsHostname: undefined,
        }),
        snmpHost({ dnsHostname: "second.acme.example" }),
        pingHost({ ipAddress: "10.20.12.7", netbiosName: "EDGESW07" }),
      ]).get("10.20.12.7");

    expect(findings?.snmp.sysName).toBe("edge-sw-07");
    expect(findings?.snmp.sysDescr).toBe(CATALYST);
    expect(findings?.dnsName).toBe("second.acme.example");
    expect(findings?.netbiosName).toBe("EDGESW07");
  });

  test("untrusted values are normalised, junk rows and over-long addresses skipped", () => {
    const findings: Map<string, DiscoveredAddressFindings> =
      getDiscoveredAddressFindings([
        null as unknown as DiscoveredNetworkDevice,
        snmpHost({
          ipAddress: " 10.20.12.9 ",
          sysName: 7 as unknown as string,
          sysLocation: "rack\r\n4",
          dnsHostname: "<b>x</b>",
        }),
        snmpHost({ ipAddress: "1".repeat(101) }),
        snmpHost({ ipAddress: "" }),
      ]);

    expect(listDiscoveredAddresses(findings)).toEqual(["10.20.12.9"]);
    expect(findings.get("10.20.12.9")?.snmp.sysName).toBeUndefined();
    expect(findings.get("10.20.12.9")?.snmp.sysLocation).toBe("rack 4");
    expect(findings.get("10.20.12.9")?.dnsName).toBeUndefined();
  });

  test("not an array is no hosts", () => {
    for (const notAnArray of [undefined, null, {}, "x"]) {
      expect(getDiscoveredAddressFindings(notAnArray).size).toBe(0);
    }
  });
});

describe("matchDiscoveredMachine - is what the scan found the device?", () => {
  function found(
    host: DiscoveredNetworkDevice = snmpHost(),
  ): DiscoveredAddressFindings {
    return getDiscoveredAddressFindings([host]).get(host.ipAddress)!;
  }

  test("a device known only by its address: the machine at the address is the device", () => {
    expect(matchDiscoveredMachine(device(), found())).toBe(
      DiscoveredMachineMatch.AddressOnly,
    );
  });

  test("the same system name, object ID or NetBIOS name: the same machine", () => {
    expect(
      matchDiscoveredMachine(device({ sysName: "EDGE-SW-07" }), found()),
    ).toBe(DiscoveredMachineMatch.Same);
    expect(
      matchDiscoveredMachine(
        device({ sysObjectId: "1.3.6.1.4.1.9.1.1208" }),
        found(),
      ),
    ).toBe(DiscoveredMachineMatch.Same);
    expect(
      matchDiscoveredMachine(
        device({
          hostname: "10.20.12.30",
          discoveredName: "WB0012KDS03",
          discoveredNameSource: DeviceNameSource.NetbiosName,
        }),
        found(pingHost()),
      ),
    ).toBe(DiscoveredMachineMatch.Same);
  });

  test("a different system name, object ID or NetBIOS name: another machine", () => {
    expect(
      matchDiscoveredMachine(device({ sysName: "LAPTOP-12" }), found()),
    ).toBe(DiscoveredMachineMatch.Other);
    expect(
      matchDiscoveredMachine(
        device({ sysName: "edge-sw-07", sysObjectId: "1.3.6.1.4.1.311.1" }),
        found(),
      ),
    ).toBe(DiscoveredMachineMatch.Other);
    expect(
      matchDiscoveredMachine(
        device({
          hostname: "10.20.12.30",
          discoveredName: "WB0012KDS04",
          discoveredNameSource: DeviceNameSource.NetbiosName,
        }),
        found(pingHost()),
      ),
    ).toBe(DiscoveredMachineMatch.Other);
  });

  test("the name a device was imported under by its sysName counts as its system name", () => {
    expect(
      matchDiscoveredMachine(
        device({
          discoveredName: "edge-sw-07",
          discoveredNameSource: DeviceNameSource.SystemName,
        }),
        found(),
      ),
    ).toBe(DiscoveredMachineMatch.Same);
    expect(
      matchDiscoveredMachine(
        device({
          discoveredName: "edge-sw-99",
          discoveredNameSource: DeviceNameSource.SystemName,
        }),
        found(),
      ),
    ).toBe(DiscoveredMachineMatch.Other);
  });

  test("the machine's own word beats DNS: a matching sysName survives a changed PTR record", () => {
    expect(
      matchDiscoveredMachine(
        device({
          sysName: "edge-sw-07",
          dnsName: "old-name.store-12.acme.example",
        }),
        found(),
      ),
    ).toBe(DiscoveredMachineMatch.Same);
  });

  test("with nothing else to compare, a device's DNS name must be the PTR name found", () => {
    expect(
      matchDiscoveredMachine(
        device({ dnsName: "edge-sw-07.store-12.acme.example." }),
        found(snmpHost({ sysName: undefined, sysObjectId: undefined })),
      ),
    ).toBe(DiscoveredMachineMatch.Same);
    // A short DNS name is the first label of the found one.
    expect(
      matchDiscoveredMachine(
        device({ dnsName: "edge-sw-07" }),
        found(snmpHost({ sysName: undefined, sysObjectId: undefined })),
      ),
    ).toBe(DiscoveredMachineMatch.Same);
    expect(
      matchDiscoveredMachine(
        device({ dnsName: "printer-3.store-12.acme.example" }),
        found(snmpHost({ sysName: undefined, sysObjectId: undefined })),
      ),
    ).toBe(DiscoveredMachineMatch.Other);
  });

  test("a device's DNS name and no PTR name found: unverified, nothing recorded", () => {
    expect(
      matchDiscoveredMachine(
        device({ dnsName: "edge-sw-07.store-12.acme.example" }),
        found(
          snmpHost({
            sysName: undefined,
            sysObjectId: undefined,
            dnsHostname: undefined,
          }),
        ),
      ),
    ).toBe(DiscoveredMachineMatch.Unverified);
  });

  test("the name a device was imported under by its PTR record counts as its DNS name", () => {
    expect(
      matchDiscoveredMachine(
        device({
          discoveredName: "printer-3.store-12.acme.example",
          discoveredNameSource: DeviceNameSource.DnsName,
        }),
        found(snmpHost({ sysName: undefined, sysObjectId: undefined })),
      ),
    ).toBe(DiscoveredMachineMatch.Other);
  });
});

describe("planDiscoveredDetails - what a result records", () => {
  test("every value the scan read at the device's address, credited to the scan and its run", () => {
    const patches: Array<DiscoveredDetailsPatch> = plan(
      [snmpHost()],
      [device()],
    );

    expect(patches).toHaveLength(1);
    const details: NetworkDeviceDiscoveredDetails = detailsAfter(patches[0]!);

    expect(details.values.sysName?.value).toBe("edge-sw-07");
    expect(details.values.sysDescr?.value).toBe(CATALYST);
    expect(details.values.sysObjectId?.value).toBe("1.3.6.1.4.1.9.1.1208");
    expect(details.values.sysLocation?.value).toBe(
      "Store 12, back office rack",
    );
    expect(details.values.sysContact?.value).toBe("netops@acme.example");
    expect(details.values.dnsName?.value).toBe(
      "edge-sw-07.store-12.acme.example",
    );
    expect(details.values.sysName).toEqual({
      value: "edge-sw-07",
      method: "snmp",
      readBy: {
        type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
        id: SCAN_ID,
        name: "Store subnets",
      },
      readAt: COMPLETED_AT,
    });
    expect(details.values.dnsName?.method).toBe("reverseDns");
    expect(details.foundBy).toEqual({
      readBy: {
        type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
        id: SCAN_ID,
        name: "Store subnets",
      },
      readAt: COMPLETED_AT,
    });
  });

  test("a ping-only host records its names and that it was found, and nothing of SNMP", () => {
    const patches: Array<DiscoveredDetailsPatch> = plan(
      [pingHost()],
      [device({ hostname: "10.20.12.30" })],
    );

    const details: NetworkDeviceDiscoveredDetails = detailsAfter(patches[0]!);
    expect(details.values.netbiosName?.value).toBe("WB0012KDS03");
    expect(details.values.netbiosName?.method).toBe("netbios");
    expect(details.values.dnsName?.value).toBe("kds-03.store-12.acme.example");
    expect(details.values.sysName).toBeUndefined();
    expect(details.foundBy?.readAt).toBe(COMPLETED_AT);
    // No SNMP answer says nothing about the system group: nothing dropped.
    expect(patches[0]!.unset).toEqual(["otherMachine"]);
  });

  test("never a column of the device: a patch only ever names discovered-details keys", () => {
    const patch: DiscoveredDetailsPatch = plan([snmpHost()], [device()])[0]!;

    for (const key of [...Object.keys(patch.set), ...patch.unset]) {
      expect([
        "sysName",
        "sysDescr",
        "sysObjectId",
        "sysLocation",
        "sysContact",
        "dnsName",
        "netbiosName",
        "foundBy",
        "otherMachine",
      ]).toContain(key);
    }
    // Neither the ARP learner's nor the probe's keys are touched.
    expect(Object.keys(patch.set)).not.toContain("macAddress");
    expect(Object.keys(patch.set)).not.toContain("ipAddress");
    expect(patch.unset).not.toContain("macAddress");
    expect(patch.unset).not.toContain("ipAddress");
  });

  test("a system group the scan read is whole: what it lacks is dropped from the record", () => {
    const patch: DiscoveredDetailsPatch = plan(
      [snmpHost({ sysLocation: undefined, sysContact: "" })],
      [device()],
    )[0]!;

    expect(patch.unset).toEqual(["otherMachine", "sysLocation", "sysContact"]);

    const before: Record<string, unknown> = {
      sysLocation: {
        value: "Old rack",
        method: "snmp",
        readBy: { type: "discoveryScan", id: SCAN_ID },
        readAt: EARLIER,
      },
    };
    expect(detailsAfter(patch, before).values.sysLocation).toBeUndefined();
  });

  test("a value read again replaces the one an earlier run recorded", () => {
    const before: Record<string, unknown> = {
      sysName: {
        value: "old-name",
        method: "snmp",
        readBy: { type: "discoveryScan", id: SCAN_ID },
        readAt: EARLIER,
      },
    };

    const details: NetworkDeviceDiscoveredDetails = detailsAfter(
      plan([snmpHost()], [device({ discoveredDetails: before })])[0]!,
      before,
    );

    expect(details.values.sysName?.value).toBe("edge-sw-07");
    expect(details.values.sysName?.readAt).toBe(COMPLETED_AT);
  });

  test("never backwards: nothing recorded from a newer reading is replaced or dropped", () => {
    const newer: Record<string, unknown> = {
      sysName: {
        value: "renamed-later",
        method: "snmp",
        readBy: { type: "discoveryScan", id: "another-scan" },
        readAt: LATER,
      },
      sysLocation: {
        value: "Moved later",
        method: "snmp",
        readBy: { type: "discoveryScan", id: "another-scan" },
        readAt: LATER,
      },
      foundBy: {
        readBy: { type: "discoveryScan", id: "another-scan" },
        readAt: LATER,
      },
    };

    const patch: DiscoveredDetailsPatch = plan(
      [snmpHost({ sysLocation: undefined })],
      [device({ discoveredDetails: newer })],
    )[0]!;

    expect(patch.set["sysName"]).toBeUndefined();
    expect(patch.set["foundBy"]).toBeUndefined();
    expect(patch.unset).not.toContain("sysLocation");
    // What it read that nothing newer covers is still recorded.
    expect(patch.set["sysDescr"]).toBeDefined();

    const details: NetworkDeviceDiscoveredDetails = detailsAfter(patch, newer);
    expect(details.values.sysName?.value).toBe("renamed-later");
    expect(details.values.sysLocation?.value).toBe("Moved later");
  });

  test("processing the same result twice changes nothing", () => {
    const once: DiscoveredDetailsPatch = plan([snmpHost()], [device()])[0]!;
    const afterOnce: Record<string, unknown> = apply({}, once);

    const twice: DiscoveredDetailsPatch = plan(
      [snmpHost()],
      [device({ discoveredDetails: afterOnce })],
    )[0]!;

    expect(apply(afterOnce, twice)).toEqual(afterOnce);
  });

  test("another machine at the address: only a note of it, nothing it read", () => {
    const patch: DiscoveredDetailsPatch = plan(
      [snmpHost({ sysName: "LAPTOP-12" })],
      [device({ sysName: "edge-sw-07" })],
    )[0]!;

    expect(Object.keys(patch.set)).toEqual(["otherMachine"]);
    expect(patch.unset).toEqual([]);
    expect(patch.set["otherMachine"]).toEqual({
      readBy: {
        type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
        id: SCAN_ID,
        name: "Store subnets",
      },
      readAt: COMPLETED_AT,
      sysName: "LAPTOP-12",
      sysObjectId: "1.3.6.1.4.1.9.1.1208",
      dnsName: "edge-sw-07.store-12.acme.example",
    });
  });

  test("the device found at its address again: the note goes", () => {
    const before: Record<string, unknown> = {
      otherMachine: {
        readBy: { type: "discoveryScan", id: SCAN_ID },
        readAt: EARLIER,
        sysName: "LAPTOP-12",
      },
    };

    const patch: DiscoveredDetailsPatch = plan(
      [snmpHost()],
      [device({ sysName: "edge-sw-07", discoveredDetails: before })],
    )[0]!;

    expect(patch.unset).toContain("otherMachine");
    expect(detailsAfter(patch, before).otherMachine).toBeUndefined();
  });

  test("an older result's note never contradicts a newer sighting of the device", () => {
    const newer: Record<string, unknown> = {
      foundBy: {
        readBy: { type: "discoveryScan", id: "another-scan" },
        readAt: LATER,
      },
    };

    expect(
      plan(
        [snmpHost({ sysName: "LAPTOP-12" })],
        [device({ sysName: "edge-sw-07", discoveredDetails: newer })],
      ),
    ).toEqual([]);
  });

  test("an unverified device gets nothing", () => {
    expect(
      plan(
        [
          snmpHost({
            sysName: undefined,
            sysObjectId: undefined,
            dnsHostname: undefined,
          }),
        ],
        [device({ dnsName: "edge-sw-07.store-12.acme.example" })],
      ),
    ).toEqual([]);
  });

  test("only devices of the scan's project, at addresses it reports, each once", () => {
    const patches: Array<DiscoveredDetailsPatch> = plan(
      [snmpHost(), pingHost()],
      [
        device({ deviceId: "a", hostname: "10.20.12.7" }),
        device({ deviceId: "a", hostname: "10.20.12.7" }),
        device({
          deviceId: "b",
          hostname: "10.20.12.7",
          projectId: OTHER_PROJECT_ID,
        }),
        device({ deviceId: "c", hostname: "10.99.0.1" }),
        device({ deviceId: "d", hostname: "10.20.12.30" }),
        device({ deviceId: "", hostname: "10.20.12.7" }),
        null as unknown as DiscoveredDetailsDeviceRow,
      ],
    );

    expect(
      patches.map((patch: DiscoveredDetailsPatch): string => {
        return patch.deviceId;
      }),
    ).toEqual(["a", "d"]);
  });

  test("no scan id, no completion time or no hosts: nothing at all", () => {
    expect(plan([snmpHost()], [device()], { ...SCAN, id: "" })).toEqual([]);
    expect(
      plan([snmpHost()], [device()], {
        ...SCAN,
        completedAt: "not a time",
      }),
    ).toEqual([]);
    expect(plan([], [device()])).toEqual([]);
    expect(
      planDiscoveredDetails({
        projectId: "",
        scan: SCAN,
        hosts: [snmpHost()],
        devices: [device()],
      }),
    ).toEqual([]);
  });

  test("findings handed in are used instead of the hosts", () => {
    const findings: Map<string, DiscoveredAddressFindings> =
      getDiscoveredAddressFindings([snmpHost()]);

    expect(
      planDiscoveredDetails({
        projectId: PROJECT_ID,
        scan: SCAN,
        hosts: "ignored",
        findings: findings,
        devices: [device()],
      }),
    ).toHaveLength(1);
  });

  test("a scan without a name is credited under its target", () => {
    const patch: DiscoveredDetailsPatch = plan([snmpHost()], [device()], {
      ...SCAN,
      name: "",
    })[0]!;

    expect(detailsAfter(patch).foundBy?.readBy.name).toBe("10.20.12.0/24");
  });
});

describe("getScanReader and getScanReadTime", () => {
  test("a scan is credited by its own name, else its target, else by id alone", () => {
    expect(getScanReader(SCAN)).toEqual({
      type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
      id: SCAN_ID,
      name: "Store subnets",
    });
    expect(getScanReader({ ...SCAN, name: null })?.name).toBe("10.20.12.0/24");
    expect(getScanReader({ id: SCAN_ID })).toEqual({
      type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
      id: SCAN_ID,
    });
    expect(getScanReader({ id: " " })).toBeUndefined();
  });

  test("the values a row holds were read by its last run: the later of its start and its end", () => {
    // A finished run.
    expect(
      getScanReadTime({ startedAt: EARLIER, completedAt: COMPLETED_AT }),
    ).toBe(COMPLETED_AT);
    // A run still going keeps the previous run's end: its start is the run.
    expect(
      getScanReadTime({ startedAt: LATER, completedAt: COMPLETED_AT }),
    ).toBe(LATER);
    expect(getScanReadTime({ startedAt: EARLIER })).toBe(EARLIER);
    expect(getScanReadTime({ completedAt: COMPLETED_AT })).toBe(COMPLETED_AT);
    expect(getScanReadTime({})).toBeUndefined();
  });
});

describe("buildDiscoveredDetailsForImport", () => {
  test("a device imported from a host starts with what its scan read", () => {
    const json: Record<string, unknown> | null =
      buildDiscoveredDetailsForImport({ host: snmpHost(), scan: SCAN });

    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(json);
    expect(details.values.sysName?.value).toBe("edge-sw-07");
    expect(details.values.dnsName?.value).toBe(
      "edge-sw-07.store-12.acme.example",
    );
    expect(details.foundBy?.readBy.id).toBe(SCAN_ID);
    // Exactly what a later run of the same scan would record.
    expect(json).toEqual(plan([snmpHost()], [device()])[0]!.set);
  });

  test("a ping-only host's import records its names", () => {
    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(
        buildDiscoveredDetailsForImport({ host: pingHost(), scan: SCAN }),
      );

    expect(
      details.values[NetworkDeviceDiscoveredField.NetbiosName]?.value,
    ).toBe("WB0012KDS03");
    expect(details.values.sysDescr).toBeUndefined();
  });

  test("no scan id, no time, or no address: nothing", () => {
    expect(
      buildDiscoveredDetailsForImport({
        host: snmpHost(),
        scan: { ...SCAN, id: "" },
      }),
    ).toBeNull();
    expect(
      buildDiscoveredDetailsForImport({
        host: snmpHost(),
        scan: { ...SCAN, completedAt: undefined as unknown as string },
      }),
    ).toBeNull();
    expect(
      buildDiscoveredDetailsForImport({
        host: snmpHost({ ipAddress: "" }),
        scan: SCAN,
      }),
    ).toBeNull();
  });
});

describe("a large result", () => {
  test("20,000 hosts and 5,000 devices are planned in well under two seconds", () => {
    const hosts: Array<DiscoveredNetworkDevice> = [];
    const devices: Array<DiscoveredDetailsDeviceRow> = [];

    for (let index: number = 0; index < 20000; index++) {
      const address: string = `10.${Math.floor(index / 65536)}.${Math.floor(index / 256) % 256}.${index % 256}`;
      hosts.push(snmpHost({ ipAddress: address, sysName: `sw-${index}` }));

      if (index % 4 === 0) {
        devices.push(
          device({ deviceId: `device-${index}`, hostname: address }),
        );
      }
    }

    const started: number = Date.now();
    const patches: Array<DiscoveredDetailsPatch> = plan(hosts, devices);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(patches).toHaveLength(5000);
  });
});
