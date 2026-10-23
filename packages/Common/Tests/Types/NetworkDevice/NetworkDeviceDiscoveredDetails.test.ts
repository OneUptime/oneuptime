import { describe, expect, test } from "@jest/globals";
import {
  DISCOVERED_DETAILS_FOUND_BY_KEY,
  DISCOVERED_DETAILS_OTHER_MACHINE_KEY,
  MAX_DISCOVERED_VALUE_LENGTH,
  MAX_DISCOVERY_READER_ID_LENGTH,
  MAX_DISCOVERY_READER_NAME_LENGTH,
  NETWORK_DEVICE_DISCOVERED_FIELDS,
  NETWORK_DEVICE_DISCOVERED_SNMP_FIELDS,
  NetworkDeviceDiscoveredDetails,
  NetworkDeviceDiscoveredField,
  NetworkDeviceDiscoveredValue,
  NetworkDeviceDiscoveryReader,
  NetworkDeviceDiscoveryReaderType,
  NetworkDeviceOtherMachineSighting,
  buildDiscoveredValue,
  buildDiscoverySighting,
  buildOtherMachineSighting,
  cleanDiscoveredText,
  getDiscoveredTime,
  getDiscoveryMethodForField,
  getDiscoveryReaderTypeForField,
  isDiscoveredDetailsKey,
  isNetworkDeviceDiscoveredField,
  normalizeDiscoveredValue,
  readDiscoveryReader,
  readDiscoveryTime,
  readNetworkDeviceDiscoveredDetails,
  sanitizeDiscoveredDetailsOnWrite,
  toDiscoveredDetailsJson,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * What discovery found out about a network device, where and when (issue
 * #5185). The column is jsonb that three server writers merge into and an
 * API create may carry, and every value in it is untrusted - a PTR name is
 * chosen by whoever runs DNS for the subnet, a NetBIOS name and an SNMP
 * system group by the machine at the address. These pin what may be stored,
 * that the reader keeps exactly what the writers write and nothing else, and
 * that no input makes either throw.
 */

const SCAN: NetworkDeviceDiscoveryReader = {
  type: NetworkDeviceDiscoveryReaderType.DiscoveryScan,
  id: "6f1c1b6e-4d0e-4a7a-9b9a-2f3f8f0b9a10",
  name: "Office LAN",
};

const ROUTER: NetworkDeviceDiscoveryReader = {
  type: NetworkDeviceDiscoveryReaderType.NetworkDevice,
  id: "8f2c1f0e-0000-4000-8000-0000000000aa",
  name: "core-rtr-01",
};

const PROBE: NetworkDeviceDiscoveryReader = {
  type: NetworkDeviceDiscoveryReaderType.Probe,
  id: "30000000-0000-4000-8000-000000000001",
  name: "Frankfurt probe",
};

const READ_AT: string = "2026-10-23T09:00:00.000Z";

function readerFor(
  field: NetworkDeviceDiscoveredField,
): NetworkDeviceDiscoveryReader {
  switch (getDiscoveryReaderTypeForField(field)) {
    case NetworkDeviceDiscoveryReaderType.NetworkDevice:
      return ROUTER;
    case NetworkDeviceDiscoveryReaderType.Probe:
      return PROBE;
    default:
      return SCAN;
  }
}

// A usable value of every field.
const SAMPLE: Readonly<Record<NetworkDeviceDiscoveredField, string>> = {
  [NetworkDeviceDiscoveredField.SystemName]: "core-sw-01",
  [NetworkDeviceDiscoveredField.SystemDescription]:
    "Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E8",
  [NetworkDeviceDiscoveredField.SystemObjectId]: "1.3.6.1.4.1.9.1.1208",
  [NetworkDeviceDiscoveredField.SystemLocation]: "DC1, Rack 14",
  [NetworkDeviceDiscoveredField.SystemContact]: "netops@acme.example",
  [NetworkDeviceDiscoveredField.DnsName]: "core-sw-01.corp.example.com",
  [NetworkDeviceDiscoveredField.NetbiosName]: "FILESRV01",
  [NetworkDeviceDiscoveredField.MacAddress]: "00:1b:54:c2:7a:01",
  [NetworkDeviceDiscoveredField.IpAddress]: "10.20.0.1",
};

function entryOf(
  field: NetworkDeviceDiscoveredField,
  value: unknown = SAMPLE[field],
): NetworkDeviceDiscoveredValue {
  const entry: NetworkDeviceDiscoveredValue | undefined = buildDiscoveredValue({
    field: field,
    value: value,
    readBy: readerFor(field),
    readAt: READ_AT,
  });

  if (!entry) {
    throw new Error(`no entry for ${field}`);
  }

  return entry;
}

describe("the fields, and how each one is read", () => {
  test("nine fields, the five of the SNMP system group first", () => {
    expect([...NETWORK_DEVICE_DISCOVERED_FIELDS]).toEqual([
      "sysName",
      "sysDescr",
      "sysObjectId",
      "sysLocation",
      "sysContact",
      "dnsName",
      "netbiosName",
      "macAddress",
      "ipAddress",
    ]);
    expect([...NETWORK_DEVICE_DISCOVERED_SNMP_FIELDS]).toEqual(
      NETWORK_DEVICE_DISCOVERED_FIELDS.slice(0, 5),
    );
  });

  test.each([
    [NetworkDeviceDiscoveredField.SystemName, "snmp", "discoveryScan"],
    [NetworkDeviceDiscoveredField.SystemDescription, "snmp", "discoveryScan"],
    [NetworkDeviceDiscoveredField.SystemObjectId, "snmp", "discoveryScan"],
    [NetworkDeviceDiscoveredField.SystemLocation, "snmp", "discoveryScan"],
    [NetworkDeviceDiscoveredField.SystemContact, "snmp", "discoveryScan"],
    [NetworkDeviceDiscoveredField.DnsName, "reverseDns", "discoveryScan"],
    [NetworkDeviceDiscoveredField.NetbiosName, "netbios", "discoveryScan"],
    [NetworkDeviceDiscoveredField.MacAddress, "arpTable", "networkDevice"],
    [NetworkDeviceDiscoveredField.IpAddress, "dns", "probe"],
  ])(
    "%s is read by %s, by a %s",
    (
      field: NetworkDeviceDiscoveredField,
      method: string,
      readerType: string,
    ) => {
      expect(getDiscoveryMethodForField(field)).toBe(method);
      expect(getDiscoveryReaderTypeForField(field)).toBe(readerType);
      expect(entryOf(field).method).toBe(method);
    },
  );

  test("only the column's own keys are keys of it", () => {
    for (const field of NETWORK_DEVICE_DISCOVERED_FIELDS) {
      expect(isNetworkDeviceDiscoveredField(field)).toBe(true);
      expect(isDiscoveredDetailsKey(field)).toBe(true);
    }

    expect(isDiscoveredDetailsKey(DISCOVERED_DETAILS_FOUND_BY_KEY)).toBe(true);
    expect(isDiscoveredDetailsKey(DISCOVERED_DETAILS_OTHER_MACHINE_KEY)).toBe(
      true,
    );
    expect(DISCOVERED_DETAILS_FOUND_BY_KEY).toBe("foundBy");
    expect(DISCOVERED_DETAILS_OTHER_MACHINE_KEY).toBe("otherMachine");

    for (const other of [
      "vendor",
      "serialNumber",
      "__proto__",
      "constructor",
      "SYSNAME",
      "",
      42,
      null,
      undefined,
    ]) {
      expect(isDiscoveredDetailsKey(other)).toBe(false);
      expect(isNetworkDeviceDiscoveredField(other)).toBe(false);
    }

    expect(isNetworkDeviceDiscoveredField("foundBy")).toBe(false);
  });
});

describe("normalizeDiscoveredValue", () => {
  test("a PTR name goes through the reverse-DNS rules", () => {
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.DnsName,
        " Core-SW-01.Corp.Example.com. ",
      ),
    ).toBe("Core-SW-01.Corp.Example.com");
    // A name that merely restates the address is no name.
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.DnsName,
        "10.0.0.5",
      ),
    ).toBeUndefined();
    // Markup is not a hostname.
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.DnsName,
        "<script>x</script>.corp",
      ),
    ).toBeUndefined();
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.DnsName,
        "5.0.0.10.in-addr.arpa",
      ),
    ).toBeUndefined();
  });

  test("a NetBIOS name goes through the NetBIOS rules, case kept", () => {
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.NetbiosName,
        "WB0024KDS03   ",
      ),
    ).toBe("WB0024KDS03");
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.NetbiosName,
        "MORE-THAN-FIFTEEN-CHARACTERS",
      ),
    ).toBeUndefined();
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.NetbiosName,
        "host.corp",
      ),
    ).toBeUndefined();
  });

  test("a MAC is stored lower case and colon-separated, whatever the spelling", () => {
    for (const spelling of [
      "00-1B-54-C2-7A-01",
      "001b.54c2.7a01",
      "001B54C27A01",
      "00:1b:54:c2:7a:01",
    ]) {
      expect(
        normalizeDiscoveredValue(
          NetworkDeviceDiscoveredField.MacAddress,
          spelling,
        ),
      ).toBe("00:1b:54:c2:7a:01");
    }

    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.MacAddress,
        "not a mac",
      ),
    ).toBeUndefined();
    expect(
      normalizeDiscoveredValue(NetworkDeviceDiscoveredField.MacAddress, 12),
    ).toBeUndefined();
  });

  test("an IP address must be one, v4 or v6", () => {
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.IpAddress,
        " 10.0.0.1 ",
      ),
    ).toBe("10.0.0.1");
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.IpAddress,
        "2001:db8::1",
      ),
    ).toBe("2001:db8::1");
    for (const notAnAddress of [
      "core-fw-01.acme.example",
      "10.0.0",
      "999.1.1.1",
      "",
      null,
    ]) {
      expect(
        normalizeDiscoveredValue(
          NetworkDeviceDiscoveredField.IpAddress,
          notAnAddress,
        ),
      ).toBeUndefined();
    }
  });

  test("a sysObjectID is a dotted numeric OID, a leading dot dropped", () => {
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.SystemObjectId,
        ".1.3.6.1.4.1.9.1.1208",
      ),
    ).toBe("1.3.6.1.4.1.9.1.1208");
    for (const notAnOid of [
      "1.3.6.1.4.1.9..1",
      "1.3.6.1.4.1.9.1.",
      "iso.3.6.1",
      "1.3.6.1 4",
      "..",
      ".",
      "",
    ]) {
      expect(
        normalizeDiscoveredValue(
          NetworkDeviceDiscoveredField.SystemObjectId,
          notAnOid,
        ),
      ).toBeUndefined();
    }
  });

  test("free text is trimmed, its control characters made spaces, and cut to the column", () => {
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.SystemDescription,
        "Cisco IOS Software\r\nTechnical Support: http://www.cisco.com\u0000\u0000",
      ),
    ).toBe("Cisco IOS Software Technical Support: http://www.cisco.com");

    const long: string = "x".repeat(900);
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.SystemDescription,
        long,
      ),
    ).toHaveLength(MAX_DISCOVERED_VALUE_LENGTH.sysDescr);
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.SystemLocation,
        long,
      ),
    ).toHaveLength(MAX_DISCOVERED_VALUE_LENGTH.sysLocation);
    expect(
      normalizeDiscoveredValue(
        NetworkDeviceDiscoveredField.SystemLocation,
        "   ",
      ),
    ).toBeUndefined();
    expect(
      normalizeDiscoveredValue(NetworkDeviceDiscoveredField.SystemContact, 42),
    ).toBeUndefined();
  });

  test("the column widths: sysDescr 500, the rest of the system group 100", () => {
    expect(MAX_DISCOVERED_VALUE_LENGTH).toEqual({
      sysName: 100,
      sysDescr: 500,
      sysObjectId: 100,
      sysLocation: 100,
      sysContact: 100,
      dnsName: 253,
      netbiosName: 15,
      macAddress: 17,
      ipAddress: 45,
    });
  });
});

describe("cleanDiscoveredText", () => {
  test("runs of spaces and control characters close up into one space", () => {
    expect(cleanDiscoveredText("  a \t\t b\u0085\u009fc  ", 100)).toBe("a b c");
    expect(cleanDiscoveredText("\u007f", 100)).toBeUndefined();
    expect(cleanDiscoveredText("abcdef", 3)).toBe("abc");
    expect(cleanDiscoveredText("ab  cdef", 3)).toBe("ab");
  });

  test("anything that is not text is no text", () => {
    for (const notText of [undefined, null, 1, true, {}, [], ["a"]]) {
      expect(cleanDiscoveredText(notText, 100)).toBeUndefined();
    }
  });

  /*
   * The input is read out of jsonb of any length. It is cut before it is
   * scanned, so even megabytes of it cost a bounded scan.
   */
  test("a megabyte of input is cut before it is read, in well under a second", () => {
    const huge: string = "\u0000 a".repeat(400000);
    const started: number = Date.now();
    const cleaned: string | undefined = cleanDiscoveredText(huge, 500);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(cleaned).toBeDefined();
    expect(cleaned!.length).toBeLessThanOrEqual(500);
  });
});

describe("readDiscoveryTime and readDiscoveryReader", () => {
  test("a time is re-written in canonical ISO form, or refused", () => {
    expect(readDiscoveryTime(new Date(READ_AT))).toBe(READ_AT);
    expect(readDiscoveryTime("2026-10-23T11:00:00+02:00")).toBe(READ_AT);
    for (const notATime of ["", "yesterday", new Date("x"), 5, null]) {
      expect(readDiscoveryTime(notATime)).toBeUndefined();
    }
  });

  test("a reader needs a known type and an id; a name is kept only when usable", () => {
    expect(readDiscoveryReader(SCAN)).toEqual(SCAN);
    expect(
      readDiscoveryReader({ type: "discoveryScan", id: "abc", name: "  " }),
    ).toEqual({ type: "discoveryScan", id: "abc" });
    expect(
      readDiscoveryReader({ type: "discoveryScan", id: "abc", name: 7 }),
    ).toEqual({ type: "discoveryScan", id: "abc" });

    for (const notAReader of [
      { type: "person", id: "abc" },
      { type: "discoveryScan" },
      { type: "discoveryScan", id: "   " },
      { id: "abc" },
      "discoveryScan",
      null,
      [],
    ]) {
      expect(readDiscoveryReader(notAReader)).toBeUndefined();
    }
  });

  test("a reader's id and name are cut to their widths", () => {
    const reader: NetworkDeviceDiscoveryReader | undefined =
      readDiscoveryReader({
        type: "probe",
        id: "i".repeat(300),
        name: "n".repeat(300),
      });

    expect(reader?.id).toHaveLength(MAX_DISCOVERY_READER_ID_LENGTH);
    expect(reader?.name).toHaveLength(MAX_DISCOVERY_READER_NAME_LENGTH);
  });
});

describe("buildDiscoveredValue", () => {
  test("every field builds an entry from a usable value", () => {
    for (const field of NETWORK_DEVICE_DISCOVERED_FIELDS) {
      expect(entryOf(field)).toEqual({
        value: SAMPLE[field],
        method: getDiscoveryMethodForField(field),
        readBy: readerFor(field),
        readAt: READ_AT,
      });
    }
  });

  test("a value is never credited to a reader that does not read it", () => {
    // A MAC from a scan, a sysName from a router, a DNS name from a probe.
    expect(
      buildDiscoveredValue({
        field: NetworkDeviceDiscoveredField.MacAddress,
        value: SAMPLE.macAddress,
        readBy: SCAN,
        readAt: READ_AT,
      }),
    ).toBeUndefined();
    expect(
      buildDiscoveredValue({
        field: NetworkDeviceDiscoveredField.SystemName,
        value: SAMPLE.sysName,
        readBy: ROUTER,
        readAt: READ_AT,
      }),
    ).toBeUndefined();
    expect(
      buildDiscoveredValue({
        field: NetworkDeviceDiscoveredField.DnsName,
        value: SAMPLE.dnsName,
        readBy: PROBE,
        readAt: READ_AT,
      }),
    ).toBeUndefined();
  });

  test("an unusable value, reader or time builds nothing", () => {
    expect(
      buildDiscoveredValue({
        field: NetworkDeviceDiscoveredField.SystemName,
        value: "   ",
        readBy: SCAN,
        readAt: READ_AT,
      }),
    ).toBeUndefined();
    expect(
      buildDiscoveredValue({
        field: NetworkDeviceDiscoveredField.SystemName,
        value: "core-sw-01",
        readBy: { type: "discoveryScan" },
        readAt: READ_AT,
      }),
    ).toBeUndefined();
    expect(
      buildDiscoveredValue({
        field: NetworkDeviceDiscoveredField.SystemName,
        value: "core-sw-01",
        readBy: SCAN,
        readAt: "not a time",
      }),
    ).toBeUndefined();
  });
});

describe("the two address notes", () => {
  test("only a discovery scan finds a device at its address", () => {
    expect(buildDiscoverySighting({ readBy: SCAN, readAt: READ_AT })).toEqual({
      readBy: SCAN,
      readAt: READ_AT,
    });
    expect(
      buildDiscoverySighting({ readBy: ROUTER, readAt: READ_AT }),
    ).toBeUndefined();
    expect(
      buildDiscoverySighting({ readBy: SCAN, readAt: "never" }),
    ).toBeUndefined();
  });

  test("another machine is described by what it said, each value normalised", () => {
    const note: NetworkDeviceOtherMachineSighting | undefined =
      buildOtherMachineSighting({
        readBy: SCAN,
        readAt: READ_AT,
        sysName: " LAPTOP-12 ",
        sysObjectId: ".1.3.6.1.4.1.311.1.1.3.1.1",
        dnsName: "laptop-12.corp.example.com.",
        netbiosName: "LAPTOP-12",
      });

    expect(note).toEqual({
      readBy: SCAN,
      readAt: READ_AT,
      sysName: "LAPTOP-12",
      sysObjectId: "1.3.6.1.4.1.311.1.1.3.1.1",
      dnsName: "laptop-12.corp.example.com",
      netbiosName: "LAPTOP-12",
    });
  });

  test("what another machine said that is not usable is left out", () => {
    expect(
      buildOtherMachineSighting({
        readBy: SCAN,
        readAt: READ_AT,
        sysName: "\u0000",
        dnsName: "10.0.0.5",
        netbiosName: "x.y",
        sysObjectId: "iso",
      }),
    ).toEqual({ readBy: SCAN, readAt: READ_AT });
  });
});

describe("readNetworkDeviceDiscoveredDetails", () => {
  function fullJson(): Record<string, unknown> {
    const json: Record<string, unknown> = {};
    for (const field of NETWORK_DEVICE_DISCOVERED_FIELDS) {
      json[field] = entryOf(field);
    }
    json[DISCOVERED_DETAILS_FOUND_BY_KEY] = { readBy: SCAN, readAt: READ_AT };
    json[DISCOVERED_DETAILS_OTHER_MACHINE_KEY] = {
      readBy: SCAN,
      readAt: READ_AT,
      sysName: "LAPTOP-12",
    };
    return json;
  }

  test("reads back exactly what the writers write, and writes it back the same", () => {
    const json: Record<string, unknown> = fullJson();
    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(json);

    expect(Object.keys(details.values)).toEqual([
      ...NETWORK_DEVICE_DISCOVERED_FIELDS,
    ]);
    expect(details.foundBy).toEqual({ readBy: SCAN, readAt: READ_AT });
    expect(details.otherMachine?.sysName).toBe("LAPTOP-12");
    expect(toDiscoveredDetailsJson(details)).toEqual(json);
  });

  test("survives the jsonb round trip, keys in any order", () => {
    const json: Record<string, unknown> = fullJson();
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(json).reverse()) {
      reordered[key] = json[key];
    }

    expect(
      toDiscoveredDetailsJson(
        readNetworkDeviceDiscoveredDetails(
          JSON.parse(JSON.stringify(reordered)),
        ),
      ),
    ).toEqual(json);
  });

  test("anything that is not an object reads as nothing discovered", () => {
    for (const notAnObject of [null, undefined, "x", 4, [], [fullJson()]]) {
      expect(readNetworkDeviceDiscoveredDetails(notAnObject)).toEqual({
        values: {},
      });
    }
  });

  test("an entry OneUptime would not have written is left out, the rest kept", () => {
    const json: Record<string, unknown> = {
      sysName: entryOf(NetworkDeviceDiscoveredField.SystemName),
      // Wrong method for the field.
      sysDescr: {
        ...entryOf(NetworkDeviceDiscoveredField.SystemDescription),
        method: "arpTable",
      },
      // Wrong reader for the field.
      macAddress: {
        ...entryOf(NetworkDeviceDiscoveredField.MacAddress),
        readBy: SCAN,
      },
      // A value its normaliser refuses.
      dnsName: {
        ...entryOf(NetworkDeviceDiscoveredField.DnsName),
        value: "<b>bad</b>",
      },
      // A time that does not parse.
      ipAddress: {
        ...entryOf(NetworkDeviceDiscoveredField.IpAddress),
        readAt: "soon",
      },
      // Not an entry at all.
      sysLocation: "DC1",
      // Keys the column does not have.
      vendor: entryOf(NetworkDeviceDiscoveredField.SystemName),
      __proto__polluted: { value: "x" },
      // A sighting by a router is not a discovery sighting.
      foundBy: { readBy: ROUTER, readAt: READ_AT },
      otherMachine: "LAPTOP-12",
    };

    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(json);

    expect(Object.keys(details.values)).toEqual(["sysName"]);
    expect(details.foundBy).toBeUndefined();
    expect(details.otherMachine).toBeUndefined();
  });

  test("a stored value is normalised again on the way out", () => {
    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails({
        sysDescr: {
          value: "Line one\r\nLine two",
          method: "snmp",
          readBy: SCAN,
          readAt: "2026-10-23T11:00:00+02:00",
        },
      });

    expect(details.values.sysDescr).toEqual({
      value: "Line one Line two",
      method: "snmp",
      readBy: SCAN,
      readAt: READ_AT,
    });
  });
});

describe("sanitizeDiscoveredDetailsOnWrite", () => {
  test("keeps what the reader keeps", () => {
    const json: Record<string, unknown> = {
      sysName: entryOf(NetworkDeviceDiscoveredField.SystemName),
      foundBy: { readBy: SCAN, readAt: READ_AT },
      junk: { value: "x" },
    };

    expect(sanitizeDiscoveredDetailsOnWrite(json)).toEqual({
      sysName: entryOf(NetworkDeviceDiscoveredField.SystemName),
      foundBy: { readBy: SCAN, readAt: READ_AT },
    });
  });

  test("nothing worth keeping is null, not an empty object", () => {
    expect(sanitizeDiscoveredDetailsOnWrite({})).toBeNull();
    expect(sanitizeDiscoveredDetailsOnWrite({ junk: 1 })).toBeNull();
    expect(sanitizeDiscoveredDetailsOnWrite("x")).toBeNull();
    expect(sanitizeDiscoveredDetailsOnWrite(null)).toBeNull();
  });
});

describe("getDiscoveredTime", () => {
  test("the time an entry was read, in milliseconds", () => {
    expect(
      getDiscoveredTime(entryOf(NetworkDeviceDiscoveredField.SystemName)),
    ).toBe(new Date(READ_AT).getTime());
    expect(getDiscoveredTime(undefined)).toBeUndefined();
    expect(getDiscoveredTime({ readAt: "never" })).toBeUndefined();
  });
});

/*
 * Whatever the column holds - a probe of another version, a write through the
 * API, a bit of corruption - the reader never throws, and what it reads is
 * stable: read it, write it, read it again, and nothing changes.
 */
describe("a sweep of arbitrary column contents", () => {
  const random: SeededRandom = seededRandom(5185);

  const pieces: Array<unknown> = [
    undefined,
    null,
    "",
    " ",
    "core-sw-01",
    "10.0.0.1",
    "00:1b:54:c2:7a:01",
    "1.3.6.1.4.1.9",
    "x".repeat(2000),
    "\u0000\r\n",
    42,
    true,
    [],
    {},
    READ_AT,
    "never",
    "snmp",
    "reverseDns",
    "netbios",
    "arpTable",
    "dns",
    SCAN,
    ROUTER,
    PROBE,
  ];

  function pick(): unknown {
    return pieces[random(pieces.length)];
  }

  function arbitraryEntry(): unknown {
    if (random(4) === 0) {
      return pick();
    }

    return {
      value: pick(),
      method: pick(),
      readBy: pick(),
      readAt: pick(),
    };
  }

  test("2,000 columns: never a throw, and reading is stable", () => {
    const keys: Array<string> = [
      ...NETWORK_DEVICE_DISCOVERED_FIELDS,
      DISCOVERED_DETAILS_FOUND_BY_KEY,
      DISCOVERED_DETAILS_OTHER_MACHINE_KEY,
      "vendor",
    ];

    for (let index: number = 0; index < 2000; index++) {
      const column: Record<string, unknown> = {};

      for (const key of keys) {
        if (random(2) === 0) {
          column[key] = arbitraryEntry();
        }
      }

      const once: Record<string, unknown> = toDiscoveredDetailsJson(
        readNetworkDeviceDiscoveredDetails(column),
      );
      const twice: Record<string, unknown> = toDiscoveredDetailsJson(
        readNetworkDeviceDiscoveredDetails(JSON.parse(JSON.stringify(once))),
      );

      expect(twice).toEqual(once);

      for (const key of Object.keys(once)) {
        expect(isDiscoveredDetailsKey(key)).toBe(true);
      }
    }
  });
});
