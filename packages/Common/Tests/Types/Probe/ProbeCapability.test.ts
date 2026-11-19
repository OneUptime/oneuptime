import ProbeCapability, {
  FIRST_PROBE_VERSION_WITH_SNMP_TABLES,
  FIRST_PROBE_VERSION_WITH_TOTP_CODES,
  MAX_PROBE_CAPABILITIES,
  MAX_PROBE_CAPABILITY_LENGTH,
  ProbeCapabilityUtil,
} from "../../../Types/Probe/ProbeCapability";
import { describe, expect, test } from "@jest/globals";

/*
 * Probe capabilities travel as plain strings in every probe request body,
 * between probe and server builds of different ages - so the strings are
 * the contract, and the server reads whatever a body holds without
 * trusting its shape.
 */
describe("ProbeCapability", () => {
  test("the wire strings never change: probes and servers of every age compare them", () => {
    expect(ProbeCapability.NetworkDevicePing).toBe("networkDevicePing");
    expect(ProbeCapability.SnmpTables).toBe("snmpTables");
    // Only a probe declaring this is handed SNMP walks and credentials.
    expect(ProbeCapability.SnmpWalk).toBe("snmpWalk");
    // Only a probe declaring this is handed databases to scan.
    expect(ProbeCapability.DataSecurityScan).toBe("dataSecurityScan");
    // A busy scheduling endpoint answers a probe declaring this with a 429.
    expect(ProbeCapability.RetryWhenBusy).toBe("retryWhenBusy");
    // And every other work endpoint, once the probe declares this (#8051).
    expect(ProbeCapability.RetryAllWorkWhenBusy).toBe("retryAllWorkWhenBusy");
    // Only a probe declaring this is handed a step that needs a one-time code (#9759).
    expect(ProbeCapability.TotpCodes).toBe("totpCodes");
  });

  test("a probe that reads a 429 from its scheduling fetches alone does not declare it reads one from all its work fetches", () => {
    const fromBefore8051: Array<string> = ProbeCapabilityUtil.parse([
      "networkDevicePing",
      "retryWhenBusy",
    ]);

    expect(
      ProbeCapabilityUtil.has(fromBefore8051, ProbeCapability.RetryWhenBusy),
    ).toBe(true);
    expect(
      ProbeCapabilityUtil.has(
        fromBefore8051,
        ProbeCapability.RetryAllWorkWhenBusy,
      ),
    ).toBe(false);
  });

  test("every capability is a distinct wire string a request is read for", () => {
    const values: Array<string> = Object.values(ProbeCapability);

    expect(new Set(values).size).toBe(values.length);
    expect(values.length).toBeLessThanOrEqual(MAX_PROBE_CAPABILITIES);

    for (const value of values) {
      expect(value.length).toBeLessThanOrEqual(MAX_PROBE_CAPABILITY_LENGTH);
      expect(ProbeCapabilityUtil.parse([value])).toEqual([value]);
    }
  });

  test("a probe that declares snmpWalk has it, one that does not has not", () => {
    expect(
      ProbeCapabilityUtil.has(
        ProbeCapabilityUtil.parse(["networkDevicePing", "snmpWalk"]),
        ProbeCapability.SnmpWalk,
      ),
    ).toBe(true);
    expect(
      ProbeCapabilityUtil.has(
        ProbeCapabilityUtil.parse(["networkDevicePing", "snmpTables"]),
        ProbeCapability.SnmpWalk,
      ),
    ).toBe(false);
  });

  test("SNMP tables first shipped in 14.0.18", () => {
    expect(FIRST_PROBE_VERSION_WITH_SNMP_TABLES).toBe("14.0.18");
  });

  test("one-time codes ship in the release after 17.0.0", () => {
    expect(FIRST_PROBE_VERSION_WITH_TOTP_CODES).toBe("17.0.1");
  });

  test("a probe from before one-time codes does not declare it makes them", () => {
    const before9759: Array<string> = ProbeCapabilityUtil.parse([
      "networkDevicePing",
      "snmpTables",
      "snmpWalk",
      "dataSecurityScan",
      "dataObservabilityCollect",
      "retryWhenBusy",
      "retryAllWorkWhenBusy",
    ]);

    expect(ProbeCapabilityUtil.has(before9759, ProbeCapability.TotpCodes)).toBe(
      false,
    );
    expect(
      ProbeCapabilityUtil.has(
        ProbeCapabilityUtil.parse([...before9759, "totpCodes"]),
        ProbeCapability.TotpCodes,
      ),
    ).toBe(true);
  });
});

describe("ProbeCapabilityUtil.parse", () => {
  test("reads a probe's list as it was sent", () => {
    expect(
      ProbeCapabilityUtil.parse(["networkDevicePing", "snmpTables"]),
    ).toEqual(["networkDevicePing", "snmpTables"]);
  });

  test.each([
    ["nothing at all (an older probe)", undefined],
    ["null", null],
    ["a string", "snmpTables"],
    ["an object", { snmpTables: true }],
    ["a number", 7],
  ])("reads %s as no capabilities", (_label: string, value: unknown) => {
    expect(ProbeCapabilityUtil.parse(value)).toEqual([]);
  });

  test("keeps only non-empty strings, trimmed, each once", () => {
    expect(
      ProbeCapabilityUtil.parse([
        " snmpTables ",
        "snmpTables",
        "",
        "   ",
        42,
        null,
        { capability: "networkDevicePing" },
        ["networkDevicePing"],
        "networkDevicePing",
      ]),
    ).toEqual(["snmpTables", "networkDevicePing"]);
  });

  test("drops a capability longer than any real one", () => {
    const tooLong: string = "x".repeat(MAX_PROBE_CAPABILITY_LENGTH + 1);
    const longest: string = "y".repeat(MAX_PROBE_CAPABILITY_LENGTH);

    expect(ProbeCapabilityUtil.parse([tooLong, longest, "snmpTables"])).toEqual(
      [longest, "snmpTables"],
    );
  });

  test("reads a bounded number of capabilities, however many are sent", () => {
    const flood: Array<string> = [];

    for (let index: number = 0; index < 10000; index++) {
      flood.push(`capability${index}`);
    }

    flood.push("snmpTables");

    const parsed: Array<string> = ProbeCapabilityUtil.parse(flood);

    expect(parsed).toHaveLength(MAX_PROBE_CAPABILITIES);
    expect(parsed[0]).toBe("capability0");
    expect(parsed).not.toContain("snmpTables");
  });
});

describe("ProbeCapabilityUtil.has", () => {
  test("is true only for a capability the list holds", () => {
    const capabilities: Array<string> = ProbeCapabilityUtil.parse([
      "networkDevicePing",
    ]);

    expect(
      ProbeCapabilityUtil.has(capabilities, ProbeCapability.NetworkDevicePing),
    ).toBe(true);
    expect(
      ProbeCapabilityUtil.has(capabilities, ProbeCapability.SnmpTables),
    ).toBe(false);
  });

  test("a probe that declared nothing has nothing", () => {
    expect(ProbeCapabilityUtil.has(undefined, ProbeCapability.SnmpTables)).toBe(
      false,
    );
    expect(ProbeCapabilityUtil.has([], ProbeCapability.SnmpTables)).toBe(false);
  });

  test("matches the exact string, not a look-alike", () => {
    expect(
      ProbeCapabilityUtil.has(
        ["SnmpTables", "snmpTablesV2", "snmp"],
        ProbeCapability.SnmpTables,
      ),
    ).toBe(false);
  });
});
