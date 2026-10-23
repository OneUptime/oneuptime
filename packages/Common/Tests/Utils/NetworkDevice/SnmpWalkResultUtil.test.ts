import { describe, expect, test } from "@jest/globals";
import SnmpDataType from "../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  SNMP_WALK_DEFAULT_ROOT_OID,
  SNMP_WALK_MAX_FAILURE_MESSAGE_LENGTH,
  SNMP_WALK_MAX_OID_LENGTH,
  SNMP_WALK_MAX_OIDS,
  SNMP_WALK_MAX_VALUE_LENGTH,
  SnmpWalkAuthenticationReason,
  SnmpWalkFailureKind,
  SnmpWalkStopReason,
} from "../../../Types/NetworkDevice/NetworkDeviceSnmpWalk";
import SnmpWalkResultUtil, {
  SNMP_WALK_INVALID_AFTER_MESSAGE,
  SNMP_WALK_INVALID_ROOT_MESSAGE,
} from "../../../Utils/NetworkDevice/SnmpWalkResultUtil";

/*
 * The pure half of an SNMP walk (issue #5184): OID order, where a walk
 * starts, and the check a probe's report goes through before it is stored
 * and drawn on the device's SNMP Walk page.
 */

describe("OID order", () => {
  test("compares arc by arc, as numbers, not as text", () => {
    expect(
      SnmpWalkResultUtil.compareOids(
        "1.3.6.1.2.1.2.2.1.9",
        "1.3.6.1.2.1.2.2.1.10",
      ),
    ).toBeLessThan(0);
    expect(
      SnmpWalkResultUtil.compareOids(
        "1.3.6.1.2.1.2.2.1.10",
        "1.3.6.1.2.1.2.2.1.9",
      ),
    ).toBeGreaterThan(0);
    expect(SnmpWalkResultUtil.compareOids("1.3.6.1", "1.3.6.1")).toBe(0);
  });

  test("a prefix comes before everything under it", () => {
    expect(SnmpWalkResultUtil.compareOids("1.3.6.1", "1.3.6.1.0")).toBeLessThan(
      0,
    );
    expect(
      SnmpWalkResultUtil.compareOids("1.3.6.1.2.1.1.1.0", "1.3.6.1.2"),
    ).toBeGreaterThan(0);
  });

  test("a leading dot does not change an OID's place", () => {
    expect(SnmpWalkResultUtil.compareOids(".1.3.6.1.2", "1.3.6.1.2")).toBe(0);
  });

  test("sorting with it puts a walk in walk order", () => {
    const oids: Array<string> = [
      "1.3.6.1.2.1.31.1.1.1.6.1",
      "1.3.6.1.2.1.2.2.1.10.2",
      "1.3.6.1.2.1.2.2.1.2.10",
      "1.3.6.1.2.1.2.2.1.2.9",
      "1.3.6.1.2.1.1.1.0",
    ];

    expect([...oids].sort(SnmpWalkResultUtil.compareOids)).toEqual([
      "1.3.6.1.2.1.1.1.0",
      "1.3.6.1.2.1.2.2.1.2.9",
      "1.3.6.1.2.1.2.2.1.2.10",
      "1.3.6.1.2.1.2.2.1.10.2",
      "1.3.6.1.2.1.31.1.1.1.6.1",
    ]);
  });

  test("an OID is within its own subtree and everything under it", () => {
    expect(
      SnmpWalkResultUtil.isWithinSubtree("1.3.6.1.2.1.2", "1.3.6.1.2.1.2"),
    ).toBe(true);
    expect(
      SnmpWalkResultUtil.isWithinSubtree(
        "1.3.6.1.2.1.2",
        "1.3.6.1.2.1.2.2.1.2.1",
      ),
    ).toBe(true);
    expect(
      SnmpWalkResultUtil.isWithinSubtree(".1.3.6.1.2.1.2", "1.3.6.1.2.1.2.1.0"),
    ).toBe(true);
  });

  test("an OID that only shares the root's digits is not within it", () => {
    expect(
      SnmpWalkResultUtil.isWithinSubtree(
        "1.3.6.1.2.1.2",
        "1.3.6.1.2.1.25.1.1.0",
      ),
    ).toBe(false);
    expect(
      SnmpWalkResultUtil.isWithinSubtree("1.3.6.1.2.1.2", "1.3.6.1.2.1"),
    ).toBe(false);
  });
});

describe("where a walk starts", () => {
  test("no starting OID walks everything an agent exposes", () => {
    expect(SnmpWalkResultUtil.resolveStart({})).toEqual({
      rootOid: SNMP_WALK_DEFAULT_ROOT_OID,
    });
    expect(SnmpWalkResultUtil.resolveStart({ rootOid: "  " })).toEqual({
      rootOid: "1.3.6.1",
    });
    expect(SnmpWalkResultUtil.resolveStart({ rootOid: null })).toEqual({
      rootOid: "1.3.6.1",
    });
  });

  test("a numeric OID is kept, without its leading dot or spaces", () => {
    expect(
      SnmpWalkResultUtil.resolveStart({ rootOid: " .1.3.6.1.4.1.9 " }),
    ).toEqual({ rootOid: "1.3.6.1.4.1.9" });
  });

  test.each([
    ["a MIB name", "IF-MIB::ifTable"],
    ["a symbolic name", "ifTable"],
    ["a trailing dot", "1.3.6.1."],
    ["a single arc", "1"],
    ["letters among digits", "1.3.6.x.1"],
    [
      "an OID longer than any agent sends",
      `1.3${".1".repeat(SNMP_WALK_MAX_OID_LENGTH)}`,
    ],
  ])(
    "%s is refused, in the person's words",
    (_label: string, rootOid: string) => {
      expect(() => {
        return SnmpWalkResultUtil.resolveStart({ rootOid: rootOid });
      }).toThrow(SNMP_WALK_INVALID_ROOT_MESSAGE);
    },
  );

  test("a walk that continues another keeps the OID it continues after", () => {
    expect(
      SnmpWalkResultUtil.resolveStart({
        rootOid: "1.3.6.1.2.1.2",
        afterOid: ".1.3.6.1.2.1.2.2.1.10.12",
      }),
    ).toEqual({
      rootOid: "1.3.6.1.2.1.2",
      afterOid: "1.3.6.1.2.1.2.2.1.10.12",
    });
  });

  test("continuing after the root itself is no continuation", () => {
    expect(
      SnmpWalkResultUtil.resolveStart({
        rootOid: "1.3.6.1.2.1.2",
        afterOid: "1.3.6.1.2.1.2",
      }),
    ).toEqual({ rootOid: "1.3.6.1.2.1.2" });
  });

  test.each([
    ["outside the subtree", "1.3.6.1.2.1.25.1.1.0"],
    ["above the root", "1.3.6.1.2"],
    ["not an OID", "ifDescr.3"],
  ])(
    "an OID to continue after %s is refused",
    (_label: string, afterOid: string) => {
      expect(() => {
        return SnmpWalkResultUtil.resolveStart({
          rootOid: "1.3.6.1.2.1.2",
          afterOid: afterOid,
        });
      }).toThrow(SNMP_WALK_INVALID_AFTER_MESSAGE);
    },
  );

  test("an OID to continue after is checked against the default root too", () => {
    expect(
      SnmpWalkResultUtil.resolveStart({ afterOid: "1.3.6.1.4.1.9.2" }),
    ).toEqual({ rootOid: "1.3.6.1", afterOid: "1.3.6.1.4.1.9.2" });
    expect(() => {
      return SnmpWalkResultUtil.resolveStart({ afterOid: "1.0.8802.1.1.2" });
    }).toThrow(SNMP_WALK_INVALID_AFTER_MESSAGE);
  });
});

function report(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    rootOid: "1.3.6.1.2.1.1",
    rows: [
      {
        oid: "1.3.6.1.2.1.1.5.0",
        type: SnmpDataType.OctetString,
        value: "core-sw-01",
      },
    ],
    stopReason: SnmpWalkStopReason.Complete,
    snmpVersion: "2c",
    requestCount: 2,
    durationInMs: 14,
    ...overrides,
  };
}

describe("a probe's walk report, as the server stores it", () => {
  test("a well-formed report is stored as it came", () => {
    const value: Record<string, unknown> = report({
      afterOid: "1.3.6.1.2.1.1.1.0",
      nextOid: "1.3.6.1.2.1.1.5.0",
      stopReason: SnmpWalkStopReason.OidLimit,
    });

    expect(SnmpWalkResultUtil.sanitize(value)).toEqual(value);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["text", "rows"],
    ["a number", 5],
  ])("%s is no walk result", (_label: string, value: unknown) => {
    expect(SnmpWalkResultUtil.sanitize(value)).toBeNull();
  });

  test("keeps no more rows than a walk reads", () => {
    const rows: Array<Record<string, unknown>> = Array.from(
      { length: SNMP_WALK_MAX_OIDS + 25 },
      (_: unknown, index: number) => {
        return {
          oid: `1.3.6.1.2.1.2.2.1.2.${index + 1}`,
          type: "Integer",
          value: index,
        };
      },
    );

    const stored: NetworkDeviceDiagnosticSnmpWalkResult | null =
      SnmpWalkResultUtil.sanitize(report({ rows: rows }));

    expect(stored?.rows).toHaveLength(SNMP_WALK_MAX_OIDS);
    expect(stored?.rows[SNMP_WALK_MAX_OIDS - 1]?.oid).toBe(
      `1.3.6.1.2.1.2.2.1.2.${SNMP_WALK_MAX_OIDS}`,
    );
  });

  test("drops a row whose OID is not an OID, and anything that is not a row", () => {
    const stored: NetworkDeviceDiagnosticSnmpWalkResult | null =
      SnmpWalkResultUtil.sanitize(
        report({
          rows: [
            { oid: "sysName.0", type: "OctetString", value: "a" },
            { oid: 42, type: "Integer", value: 1 },
            "1.3.6.1.2.1.1.1.0",
            null,
            { oid: ".1.3.6.1.2.1.1.3.0", type: "TimeTicks", value: 9 },
          ],
        }),
      );

    expect(stored?.rows).toEqual([
      { oid: "1.3.6.1.2.1.1.3.0", type: SnmpDataType.TimeTicks, value: 9 },
    ]);
  });

  test("a type this server does not know reads as Unknown", () => {
    expect(
      SnmpWalkResultUtil.sanitize(
        report({
          rows: [{ oid: "1.3.6.1.2.1.1.1.0", type: "Float128", value: "x" }],
        }),
      )?.rows[0]?.type,
    ).toBe(SnmpDataType.Unknown);
  });

  test("a value that is neither text nor a finite number is no value", () => {
    const stored: NetworkDeviceDiagnosticSnmpWalkResult | null =
      SnmpWalkResultUtil.sanitize(
        report({
          rows: [
            { oid: "1.3.6.1.2.1.1.1.0", type: "Integer", value: { a: 1 } },
            { oid: "1.3.6.1.2.1.1.2.0", type: "Integer", value: Infinity },
            { oid: "1.3.6.1.2.1.1.3.0", type: "Null", value: null },
          ],
        }),
      );

    expect(
      stored?.rows.map((row: { value: unknown }) => {
        return row.value;
      }),
    ).toEqual([null, null, null]);
  });

  test("text with a NUL, which jsonb refuses, is stored as its bytes in hex", () => {
    expect(
      SnmpWalkResultUtil.sanitize(
        report({
          rows: [
            {
              oid: "1.3.6.1.2.1.1.1.0",
              type: "OctetString",
              value: `ab${String.fromCharCode(0)}c`,
            },
          ],
        }),
      )?.rows[0],
    ).toEqual({
      oid: "1.3.6.1.2.1.1.1.0",
      type: SnmpDataType.OctetString,
      value: "61 62 00 63",
      isHex: true,
    });
  });

  test("text past the limit is cut and says so", () => {
    const row: Record<string, unknown> | undefined =
      SnmpWalkResultUtil.sanitize(
        report({
          rows: [
            {
              oid: "1.3.6.1.2.1.1.1.0",
              type: "OctetString",
              value: "y".repeat(SNMP_WALK_MAX_VALUE_LENGTH * 3),
            },
          ],
        }),
      )?.rows[0] as unknown as Record<string, unknown>;

    expect((row["value"] as string).length).toBe(SNMP_WALK_MAX_VALUE_LENGTH);
    expect(row["isCut"]).toBe(true);
  });

  test("the probe's isHex and isCut are kept only when true", () => {
    const stored: NetworkDeviceDiagnosticSnmpWalkResult | null =
      SnmpWalkResultUtil.sanitize(
        report({
          rows: [
            {
              oid: "1.3.6.1.2.1.2.2.1.6.1",
              type: "OctetString",
              value: "00 1A",
              isHex: true,
              isCut: "yes",
            },
          ],
        }),
      );

    expect(stored?.rows[0]).toEqual({
      oid: "1.3.6.1.2.1.2.2.1.6.1",
      type: SnmpDataType.OctetString,
      value: "00 1A",
      isHex: true,
    });
  });

  test("a failure is kept with its kind, its reason and its message, cut to length", () => {
    const stored: NetworkDeviceDiagnosticSnmpWalkResult | null =
      SnmpWalkResultUtil.sanitize(
        report({
          rows: [],
          stopReason: SnmpWalkStopReason.Failed,
          failure: {
            kind: SnmpWalkFailureKind.Authentication,
            authenticationReason: SnmpWalkAuthenticationReason.WrongDigest,
            message: "z".repeat(SNMP_WALK_MAX_FAILURE_MESSAGE_LENGTH + 10),
          },
        }),
      );

    expect(stored?.failure?.kind).toBe(SnmpWalkFailureKind.Authentication);
    expect(stored?.failure?.authenticationReason).toBe(
      SnmpWalkAuthenticationReason.WrongDigest,
    );
    expect(stored?.failure?.message).toHaveLength(
      SNMP_WALK_MAX_FAILURE_MESSAGE_LENGTH,
    );
  });

  test("a failure kind or reason this server does not know is Unknown, and no reason", () => {
    const stored: NetworkDeviceDiagnosticSnmpWalkResult | null =
      SnmpWalkResultUtil.sanitize(
        report({
          failure: {
            kind: "cosmic rays",
            authenticationReason: "moon phase",
            message: 7,
          },
        }),
      );

    expect(stored?.failure).toEqual({
      kind: SnmpWalkFailureKind.Unknown,
      message: "",
    });
  });

  test("a report that says nothing of why it stopped stopped for its failure, or was complete", () => {
    expect(
      SnmpWalkResultUtil.sanitize(report({ stopReason: undefined }))
        ?.stopReason,
    ).toBe(SnmpWalkStopReason.Complete);
    expect(
      SnmpWalkResultUtil.sanitize(
        report({
          stopReason: "who knows",
          failure: { kind: SnmpWalkFailureKind.Timeout, message: "" },
        }),
      )?.stopReason,
    ).toBe(SnmpWalkStopReason.Failed);
  });

  test("OIDs that are not OIDs are dropped, and the root falls back to the default", () => {
    const stored: NetworkDeviceDiagnosticSnmpWalkResult | null =
      SnmpWalkResultUtil.sanitize(
        report({
          rootOid: "ifTable",
          afterOid: "ifDescr.3",
          nextOid: 9,
        }),
      );

    expect(stored?.rootOid).toBe(SNMP_WALK_DEFAULT_ROOT_OID);
    expect(stored).not.toHaveProperty("afterOid");
    expect(stored).not.toHaveProperty("nextOid");
  });

  test("only the probe's own spellings of an SNMP version are kept", () => {
    expect(
      SnmpWalkResultUtil.sanitize(report({ snmpVersion: "3" }))?.snmpVersion,
    ).toBe("3");
    expect(
      SnmpWalkResultUtil.sanitize(report({ snmpVersion: "<b>v9</b>" })),
    ).not.toHaveProperty("snmpVersion");
  });

  test("counts that are not counts are zero, and fractions are whole", () => {
    const stored: NetworkDeviceDiagnosticSnmpWalkResult | null =
      SnmpWalkResultUtil.sanitize(
        report({ requestCount: -2, durationInMs: 12.9 }),
      );

    expect(stored?.requestCount).toBe(0);
    expect(stored?.durationInMs).toBe(12);
  });
});

describe("hex", () => {
  test("is two upper-case digits a byte, a space between bytes", () => {
    expect(SnmpWalkResultUtil.toHex(new Uint8Array([0, 10, 171, 255]))).toBe(
      "00 0A AB FF",
    );
    expect(SnmpWalkResultUtil.toHex(new Uint8Array([]))).toBe("");
  });
});
