import { describe, expect, test } from "@jest/globals";
import { DeviceNameSource } from "../../../Types/NetworkDevice/DeviceNameSource";
import { NetworkDeviceDiscoveryReaderType } from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import {
  AssetFactSource,
  AssetFactSourceKind,
  isAutomaticAssetFactSource,
} from "../../../Utils/Inventory/AssetFactSource";
import {
  NetworkDeviceAssetFacts,
  NetworkDeviceAssetSource,
  NetworkDeviceEffectiveInputs,
  NetworkDeviceFactDetail,
  NetworkDeviceFactDetails,
  getNetworkDeviceAssetFacts,
  getNetworkDeviceDnsName,
  getNetworkDeviceEffectiveInputs,
  getNetworkDeviceFactDetails,
  getNetworkDeviceHostname,
  getNetworkDeviceIpAddress,
  getNetworkDeviceLocation,
  getNetworkDeviceManufacturer,
  getNetworkDeviceSystemDescription,
  getNetworkDeviceType,
} from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";

/*
 * A network device's details and where each came from (issue #5185): its own
 * columns - what its SNMP poll read, what someone saved - against what
 * discovery read about it. A value someone saved always wins and is never
 * replaced; of two automatic readings the newer wins; a detail the device has
 * nothing for takes what discovery read; and every fact says which.
 */

const SCAN_READER: {
  type: NetworkDeviceDiscoveryReaderType;
  id: string;
  name: string;
} = {
  type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
  id: "80000000-0000-4000-8000-000000000001",
  name: "Store subnets",
};
const ROUTER_READER: {
  type: NetworkDeviceDiscoveryReaderType;
  id: string;
  name: string;
} = {
  type: NetworkDeviceDiscoveryReaderType.NetworkDevice,
  id: "40000000-0000-4000-8000-000000000099",
  name: "core-rtr-01",
};
const PROBE_READER: {
  type: NetworkDeviceDiscoveryReaderType;
  id: string;
  name: string;
} = {
  type: NetworkDeviceDiscoveryReaderType.Probe,
  id: "30000000-0000-4000-8000-000000000001",
  name: "Frankfurt probe",
};

const POLLED_AT: string = "2026-10-23T09:00:00.000Z";
const SCANNED_BEFORE: string = "2026-10-23T07:00:00.000Z";
const SCANNED_AFTER: string = "2026-10-23T10:00:00.000Z";

const CATALYST: string =
  "Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E8, RELEASE SOFTWARE (fc3)";

function scanned(
  value: string,
  readAt: string = SCANNED_BEFORE,
  method: string = "snmp",
): Record<string, unknown> {
  return { value: value, method: method, readBy: SCAN_READER, readAt: readAt };
}

// A switch OneUptime only pings, whose subnet a discovery scan read.
function pingedSwitch(
  overrides: Partial<NetworkDeviceAssetSource> = {},
): NetworkDeviceAssetSource {
  return {
    name: "edge-sw-07",
    hostname: "10.20.12.7",
    discoveredDetails: {
      sysName: scanned("edge-sw-07"),
      sysDescr: scanned(CATALYST),
      sysObjectId: scanned("1.3.6.1.4.1.9.1.1208"),
      sysLocation: scanned("Store 12, back office rack"),
      sysContact: scanned("netops@acme.example"),
      dnsName: scanned(
        "edge-sw-07.store-12.acme.example",
        SCANNED_BEFORE,
        "reverseDns",
      ),
      macAddress: {
        value: "00:1b:54:c2:7a:07",
        method: "arpTable",
        readBy: ROUTER_READER,
        readAt: SCANNED_BEFORE,
      },
      foundBy: { readBy: SCAN_READER, readAt: SCANNED_BEFORE },
    },
    ...overrides,
  };
}

// A switch its own SNMP poll walked, an hour after the scan.
function walkedSwitch(
  overrides: Partial<NetworkDeviceAssetSource> = {},
): NetworkDeviceAssetSource {
  return {
    name: "core-sw-01",
    hostname: "10.20.0.1",
    sysName: "core-sw-01",
    sysDescr:
      "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.4, RELEASE SOFTWARE (fc5)",
    sysObjectId: "1.3.6.1.4.1.9.1.1745",
    sysLocation: "DC1, Rack 14",
    vendor: "Cisco",
    deviceModel: "WS-C3850-48P",
    serialNumber: "FOC1840X0AB",
    firmwareVersion: "16.12.4",
    softwareVersion: "16.12.04",
    lastSnmpSeenAt: POLLED_AT,
    ...overrides,
  };
}

function kindOf(
  detail: NetworkDeviceFactDetail,
): AssetFactSourceKind | undefined {
  return detail.source?.kind;
}

function expectDiscovered(
  detail: NetworkDeviceFactDetail,
  method: string,
  readAt: string = SCANNED_BEFORE,
): void {
  expect(detail.source).toEqual({
    kind: AssetFactSourceKind.Discovered,
    method: method,
    readBy:
      method === "arpTable"
        ? ROUTER_READER
        : method === "dns"
          ? PROBE_READER
          : SCAN_READER,
    readAt: readAt,
  });
}

describe("a device OneUptime only pings takes what discovery read", () => {
  const details: NetworkDeviceFactDetails =
    getNetworkDeviceFactDetails(pingedSwitch());

  test("its hostname is the system name the scan read", () => {
    expect(details.facts.hostname.value).toBe("edge-sw-07");
    expectDiscovered(details.facts.hostname, "snmp");
  });

  test("its IP address is the address its probe polls", () => {
    expect(details.facts.ipAddress).toEqual({
      value: "10.20.12.7",
      source: { kind: AssetFactSourceKind.PolledAddress },
    });
  });

  test("its DNS name is the PTR name the scan found", () => {
    expect(details.facts.dnsName.value).toBe(
      "edge-sw-07.store-12.acme.example",
    );
    expectDiscovered(details.facts.dnsName, "reverseDns");
  });

  test("its MAC is what a router's ARP table says, in the IEEE form", () => {
    expect(details.facts.macAddress.value).toBe("00-1B-54-C2-7A-07");
    expectDiscovered(details.facts.macAddress, "arpTable");
  });

  test("its maker, OS and version come from the sysObjectID and sysDescr the scan read", () => {
    expect(details.facts.manufacturer.value).toBe("Cisco");
    expectDiscovered(details.facts.manufacturer, "snmp");
    expect(details.facts.operatingSystem.value).toBe("Cisco IOS");
    expectDiscovered(details.facts.operatingSystem, "snmp");
    expect(details.facts.osVersion.value).toBe("15.2(7)E8");
    expectDiscovered(details.facts.osVersion, "snmp");
  });

  test("its type is worked out from what the scan read", () => {
    expect(details.facts.deviceType.value).toBe("Switch");
    expect(kindOf(details.facts.deviceType)).toBe(
      AssetFactSourceKind.Classified,
    );
  });

  test("its location is the sysLocation the scan read", () => {
    expect(details.facts.location.value).toBe("Store 12, back office rack");
    expectDiscovered(details.facts.location, "snmp");
  });

  test("what nothing read stays unknown - never a guess", () => {
    expect(details.facts.serialNumber).toEqual({});
    expect(details.facts.model).toEqual({});
    expect(details.facts.firmwareVersion).toEqual({});
  });

  test("its SNMP system group, each from the scan", () => {
    for (const key of [
      "sysName",
      "sysDescr",
      "sysObjectId",
      "sysLocation",
      "sysContact",
    ] as const) {
      expectDiscovered(details.system[key], "snmp");
    }
    expect(details.system.sysContact.value).toBe("netops@acme.example");
  });

  test("the scan that last found it there", () => {
    expect(details.foundBy).toEqual({
      readBy: SCAN_READER,
      readAt: SCANNED_BEFORE,
    });
    expect(details.otherMachine).toBeUndefined();
  });

  test("the plain facts, as the mirror and the list read them, agree", () => {
    const facts: NetworkDeviceAssetFacts =
      getNetworkDeviceAssetFacts(pingedSwitch());

    expect(facts).toEqual({
      hostname: "edge-sw-07",
      ipAddress: "10.20.12.7",
      dnsName: "edge-sw-07.store-12.acme.example",
      macAddress: "00-1B-54-C2-7A-07",
      serialNumber: undefined,
      manufacturer: "Cisco",
      model: undefined,
      firmwareVersion: undefined,
      operatingSystem: "Cisco IOS",
      osVersion: "15.2(7)E8",
      deviceType: "Switch",
      site: undefined,
      location: "Store 12, back office rack",
    });
    expect(getNetworkDeviceHostname(pingedSwitch())).toBe("edge-sw-07");
    expect(getNetworkDeviceDnsName(pingedSwitch())).toBe(
      "edge-sw-07.store-12.acme.example",
    );
    expect(getNetworkDeviceManufacturer(pingedSwitch())).toBe("Cisco");
    expect(getNetworkDeviceType(pingedSwitch())).toBe("Switch");
    expect(getNetworkDeviceLocation(pingedSwitch())).toBe(
      "Store 12, back office rack",
    );
    expect(getNetworkDeviceSystemDescription(pingedSwitch())).toBe(CATALYST);
  });
});

describe("a device its own poll reads keeps what its poll read", () => {
  test("every fact from its own SNMP poll, with when the poll last succeeded", () => {
    const details: NetworkDeviceFactDetails =
      getNetworkDeviceFactDetails(walkedSwitch());

    for (const fact of [
      details.facts.hostname,
      details.facts.serialNumber,
      details.facts.manufacturer,
      details.facts.model,
      details.facts.firmwareVersion,
      details.facts.osVersion,
      details.facts.location,
      details.system.sysDescr,
    ]) {
      expect(fact.source).toEqual({
        kind: AssetFactSourceKind.SnmpPoll,
        readAt: POLLED_AT,
      });
    }
  });

  test("an older scan's reading does not replace a newer poll's", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      walkedSwitch({
        discoveredDetails: {
          sysLocation: scanned("Somewhere else", SCANNED_BEFORE),
          sysName: scanned("old-name", SCANNED_BEFORE),
        },
      }),
    );

    expect(details.facts.location.value).toBe("DC1, Rack 14");
    expect(kindOf(details.facts.location)).toBe(AssetFactSourceKind.SnmpPoll);
    expect(details.facts.hostname.value).toBe("core-sw-01");
    // Two automatic readings are not a disagreement to show.
    expect(details.facts.location.discoveredDifferent).toBeUndefined();
  });

  test("a newer scan's reading replaces an older poll's - a walk that stopped long ago", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      walkedSwitch({
        discoveredDetails: {
          sysLocation: scanned("DC2, Rack 3", SCANNED_AFTER),
        },
      }),
    );

    expect(details.facts.location.value).toBe("DC2, Rack 3");
    expectDiscovered(details.facts.location, "snmp", SCANNED_AFTER);
  });

  test("ENTITY-MIB's columns are the poll's; nothing discovery reads replaces them", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      walkedSwitch({
        discoveredDetails: { sysDescr: scanned("Meraki MX85", SCANNED_AFTER) },
      }),
    );

    // The newer sysDescr wins as the sysDescr...
    expect(details.system.sysDescr.value).toBe("Meraki MX85");
    // ...but the poll's ENTITY-MIB model still wins over what it names.
    expect(details.facts.model.value).toBe("WS-C3850-48P");
    expect(kindOf(details.facts.model)).toBe(AssetFactSourceKind.SnmpPoll);
  });
});

describe("a value someone saved is never replaced", () => {
  test("an SNMP column set on a device that was never walked is saved, and wins", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedSwitch({ sysLocation: "Rack 4 (typed)" }),
    );

    expect(details.facts.location.value).toBe("Rack 4 (typed)");
    expect(details.facts.location.source).toEqual({
      kind: AssetFactSourceKind.Saved,
    });
    // ...and what discovery read differently is shown beside it.
    expect(details.facts.location.discoveredDifferent).toEqual({
      value: "Store 12, back office rack",
      source: {
        kind: AssetFactSourceKind.Discovered,
        method: "snmp",
        readBy: SCAN_READER,
        readAt: SCANNED_BEFORE,
      },
    });
  });

  test("a saved value discovery agrees with shows no disagreement", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedSwitch({ sysLocation: "STORE 12, BACK OFFICE RACK" }),
    );

    expect(details.facts.location.discoveredDifferent).toBeUndefined();
  });

  test("a saved value is never replaced, however new the scan", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedSwitch({
        sysName: "my-name",
        discoveredDetails: { sysName: scanned("scan-name", SCANNED_AFTER) },
      }),
    );

    expect(details.facts.hostname.value).toBe("my-name");
    expect(kindOf(details.facts.hostname)).toBe(AssetFactSourceKind.Saved);
  });

  test("a typed MAC wins; what the ARP table says differently is shown beside it", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedSwitch({
        macAddress: "00:1b:54:c2:7a:99",
        isMacAddressLearned: false,
      }),
    );

    expect(details.facts.macAddress.value).toBe("00-1B-54-C2-7A-99");
    expect(kindOf(details.facts.macAddress)).toBe(AssetFactSourceKind.Saved);
    expect(details.facts.macAddress.discoveredDifferent?.value).toBe(
      "00-1B-54-C2-7A-07",
    );
    expect(details.facts.macAddress.discoveredDifferent?.source.readBy).toEqual(
      ROUTER_READER,
    );
  });

  test("a typed MAC the ARP table agrees with, in any spelling, shows no disagreement", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedSwitch({ macAddress: "00-1B-54-C2-7A-07" }),
    );

    expect(details.facts.macAddress.discoveredDifferent).toBeUndefined();
  });

  test("a learned MAC says which router's table taught it and when", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedSwitch({
        macAddress: "00:1b:54:c2:7a:07",
        isMacAddressLearned: true,
      }),
    );

    expectDiscovered(details.facts.macAddress, "arpTable");
  });

  test("a MAC learned before readings were recorded says a router's ARP table", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails({
      name: "register-1",
      hostname: "10.0.0.5",
      macAddress: "00:1b:54:c2:7a:07",
      isMacAddressLearned: true,
    });

    expect(details.facts.macAddress.source).toEqual({
      kind: AssetFactSourceKind.LearnedFromArp,
    });
  });

  test("a saved DNS name wins; a different PTR name is shown beside it", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedSwitch({ dnsName: "printer-3.old.acme.example" }),
    );

    expect(details.facts.dnsName.value).toBe("printer-3.old.acme.example");
    expect(kindOf(details.facts.dnsName)).toBe(AssetFactSourceKind.Saved);
    expect(details.facts.dnsName.discoveredDifferent?.value).toBe(
      "edge-sw-07.store-12.acme.example",
    );
  });

  test("a saved DNS name the scan confirms is credited to the scan", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedSwitch({ dnsName: "EDGE-SW-07.store-12.acme.example" }),
    );

    expect(details.facts.dnsName.value).toBe(
      "EDGE-SW-07.store-12.acme.example",
    );
    expectDiscovered(details.facts.dnsName, "reverseDns");
    expect(details.facts.dnsName.discoveredDifferent).toBeUndefined();
  });

  test("an assigned role is the type, and says so", () => {
    expect(
      getNetworkDeviceFactDetails(
        pingedSwitch({
          networkDeviceRole: { key: "pos", name: "PoS Terminal" },
        }),
      ).facts.deviceType,
    ).toEqual({
      value: "PoS Terminal",
      source: { kind: AssetFactSourceKind.AssignedRole },
    });
  });

  test("the site is the site's", () => {
    expect(
      getNetworkDeviceFactDetails(pingedSwitch({ site: { name: "Store 12" } }))
        .facts.site,
    ).toEqual({
      value: "Store 12",
      source: { kind: AssetFactSourceKind.Site },
    });
  });
});

describe("names", () => {
  test("a NetBIOS name a scan read names a hand-made Windows host", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails({
      name: "kitchen display",
      hostname: "10.20.12.30",
      discoveredDetails: {
        netbiosName: scanned("WB0012KDS03", SCANNED_BEFORE, "netbios"),
        dnsName: scanned(
          "wb-0012-kds03.store-12.acme.example",
          SCANNED_BEFORE,
          "reverseDns",
        ),
      },
    });

    expect(details.facts.hostname.value).toBe("WB0012KDS03");
    expectDiscovered(details.facts.hostname, "netbios");
  });

  test("the name discovery imported the device under is saved on it, and still names it", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails({
      name: "WB0012KDS03",
      hostname: "10.20.12.30",
      discoveredName: "WB0012KDS03",
      discoveredNameSource: DeviceNameSource.NetbiosName,
    });

    expect(details.facts.hostname).toEqual({
      value: "WB0012KDS03",
      source: { kind: AssetFactSourceKind.Saved },
    });
  });

  test("a device polled at a DNS name: that name is its DNS name, its probe's lookup its IP", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails({
      name: "core-fw-01",
      hostname: "core-fw-01.acme.example",
      discoveredDetails: {
        ipAddress: {
          value: "10.0.0.1",
          method: "dns",
          readBy: PROBE_READER,
          readAt: SCANNED_AFTER,
        },
      },
    });

    expect(details.facts.dnsName).toEqual({
      value: "core-fw-01.acme.example",
      source: { kind: AssetFactSourceKind.PolledAddress },
    });
    expect(details.facts.ipAddress.value).toBe("10.0.0.1");
    expectDiscovered(details.facts.ipAddress, "dns", SCANNED_AFTER);
    expect(details.facts.hostname.value).toBe("core-fw-01.acme.example");
    expect(
      getNetworkDeviceIpAddress({
        hostname: "core-fw-01.acme.example",
        discoveredDetails: {
          ipAddress: {
            value: "10.0.0.1",
            method: "dns",
            readBy: PROBE_READER,
            readAt: SCANNED_AFTER,
          },
        },
      }),
    ).toBe("10.0.0.1");
  });

  test("a device polled at an address never takes a resolved address over it", () => {
    expect(
      getNetworkDeviceFactDetails({
        hostname: "10.0.0.1",
        discoveredDetails: {
          ipAddress: {
            value: "10.9.9.9",
            method: "dns",
            readBy: PROBE_READER,
            readAt: SCANNED_AFTER,
          },
        },
      }).facts.ipAddress.value,
    ).toBe("10.0.0.1");
  });

  test("the hostname is never the IP address, wherever it would come from", () => {
    expect(
      getNetworkDeviceFactDetails({
        name: "10.0.0.5",
        hostname: "10.0.0.5",
        discoveredDetails: { sysName: scanned("10.0.0.5") },
      }).facts.hostname,
    ).toEqual({});
  });
});

describe("another machine at the address", () => {
  test("the note is passed through, and its values are never a fact", () => {
    const details: NetworkDeviceFactDetails = getNetworkDeviceFactDetails(
      pingedSwitch({
        discoveredDetails: {
          otherMachine: {
            readBy: SCAN_READER,
            readAt: SCANNED_AFTER,
            sysName: "LAPTOP-12",
          },
        },
      }),
    );

    expect(details.otherMachine).toEqual({
      readBy: SCAN_READER,
      readAt: SCANNED_AFTER,
      sysName: "LAPTOP-12",
    });
    expect(details.facts.hostname).toEqual({});
  });
});

describe("a device read without its discovered details reads exactly as before #5185", () => {
  const PLAIN: Array<NetworkDeviceAssetSource> = [
    {
      name: "UN0362WANRTR01",
      hostname: "10.241.124.1",
      sysName: "UN0362WANRTR01",
      sysDescr: "Meraki MX85",
    },
    walkedSwitch({ lastSnmpSeenAt: undefined }),
    { name: "10.0.0.5", hostname: "10.0.0.5" },
    {
      name: "fw",
      hostname: "fw.corp.example.com",
      vendor: "Net-SNMP",
      sysObjectId: "1.3.6.1.4.1.8072.3.2.10",
    },
  ];

  test("no source is discovered, and the values are the columns' own", () => {
    for (const device of PLAIN) {
      const details: NetworkDeviceFactDetails =
        getNetworkDeviceFactDetails(device);
      const facts: Record<string, NetworkDeviceFactDetail> =
        details.facts as unknown as Record<string, NetworkDeviceFactDetail>;

      for (const key of Object.keys(facts)) {
        expect({ key, kind: facts[key]!.source?.kind }).not.toEqual({
          key,
          kind: AssetFactSourceKind.Discovered,
        });
      }
    }
  });

  test("an SNMP agent's vendor is never a manufacturer, discovered or not", () => {
    expect(getNetworkDeviceManufacturer(PLAIN[3]!)).toBeUndefined();
    expect(
      getNetworkDeviceManufacturer({
        hostname: "10.0.0.9",
        discoveredDetails: { sysObjectId: scanned("1.3.6.1.4.1.8072.3.2.10") },
      }),
    ).toBeUndefined();
  });
});

describe("getNetworkDeviceEffectiveInputs", () => {
  test("a column wins over discovery unless it is an older automatic reading", () => {
    const inputs: NetworkDeviceEffectiveInputs =
      getNetworkDeviceEffectiveInputs(
        walkedSwitch({
          discoveredDetails: {
            sysName: scanned("older", SCANNED_BEFORE),
            sysContact: scanned("newer contact", SCANNED_AFTER),
          },
        }),
      );

    expect(inputs.sysName.value).toBe("core-sw-01");
    expect(inputs.sysContact.value).toBe("newer contact");
    expect(inputs.vendor.source).toEqual({
      kind: AssetFactSourceKind.SnmpPoll,
      readAt: POLLED_AT,
    });
  });

  test("a junk column or a junk record reads as nothing", () => {
    const inputs: NetworkDeviceEffectiveInputs =
      getNetworkDeviceEffectiveInputs({
        sysName: 7,
        sysDescr: "   ",
        lastSnmpSeenAt: "not a time",
        discoveredDetails: "garbage",
      });

    expect(inputs.sysName).toEqual({});
    expect(inputs.sysDescr).toEqual({});
    expect(inputs.details).toEqual({ values: {} });
  });

  test("a Date out of a row reads the same as its string", () => {
    expect(
      getNetworkDeviceEffectiveInputs(
        walkedSwitch({ lastSnmpSeenAt: new Date(POLLED_AT) }),
      ).sysName.source,
    ).toEqual({ kind: AssetFactSourceKind.SnmpPoll, readAt: POLLED_AT });
  });
});

describe("isAutomaticAssetFactSource", () => {
  test("only what OneUptime read by itself is replaceable by a newer reading", () => {
    const automatic: Array<AssetFactSourceKind> = [
      AssetFactSourceKind.SnmpPoll,
      AssetFactSourceKind.Discovered,
      AssetFactSourceKind.LearnedFromArp,
      AssetFactSourceKind.Collector,
    ];

    for (const kind of Object.values(AssetFactSourceKind)) {
      const source: AssetFactSource = { kind: kind };
      expect({ kind, automatic: isAutomaticAssetFactSource(source) }).toEqual({
        kind,
        automatic: automatic.includes(kind),
      });
    }
    expect(isAutomaticAssetFactSource(undefined)).toBe(false);
  });
});
