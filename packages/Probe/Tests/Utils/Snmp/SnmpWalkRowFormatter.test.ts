import { describe, expect, test } from "@jest/globals";
import snmp from "net-snmp";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import {
  SNMP_WALK_MAX_VALUE_LENGTH,
  SnmpWalkRow,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import SnmpWalkResultUtil from "Common/Utils/NetworkDevice/SnmpWalkResultUtil";
import {
  getSnmpWalkDataType,
  toSnmpWalkRow,
} from "../../../Utils/Snmp/SnmpWalkRowFormatter";

/*
 * How one OID of a walk reads on the device's SNMP Walk page: every SNMP
 * type, text that is text in any script, binary that is binary, numbers
 * that keep every digit, and values too long to show whole.
 */

const OID: string = "1.3.6.1.2.1.1.1.0";

function row(type: number, value: unknown): SnmpWalkRow {
  return toSnmpWalkRow({
    oid: OID,
    type: type as snmp.ObjectType,
    value: value as snmp.VarbindValue,
  });
}

describe("numbers", () => {
  test.each([
    ["an Integer", snmp.ObjectType.Integer, 42, SnmpDataType.Integer],
    ["a negative Integer", snmp.ObjectType.Integer, -95, SnmpDataType.Integer],
    [
      "a Counter32",
      snmp.ObjectType.Counter32,
      4294967295,
      SnmpDataType.Counter32,
    ],
    ["a Gauge32", snmp.ObjectType.Gauge32, 37, SnmpDataType.Gauge32],
    [
      "a TimeTicks",
      snmp.ObjectType.TimeTicks,
      104524500,
      SnmpDataType.TimeTicks,
    ],
  ])(
    "%s is a number",
    (_label: string, type: number, value: number, dataType: SnmpDataType) => {
      expect(row(type, value)).toEqual({
        oid: OID,
        type: dataType,
        value: value,
      });
    },
  );

  test("a Counter64 is its decimal text, every digit kept past 2^53", () => {
    expect(
      row(snmp.ObjectType.Counter64, Buffer.from("ffffffffffffffff", "hex")),
    ).toEqual({
      oid: OID,
      type: SnmpDataType.Counter64,
      value: "18446744073709551615",
    });
  });

  test("a Counter64 in a minimal-length buffer, as net-snmp hands small ones over", () => {
    expect(
      row(snmp.ObjectType.Counter64, Buffer.from([0x04, 0x00])).value,
    ).toBe("1024");
    expect(
      row(snmp.ObjectType.Counter64, Buffer.from("00ffffffffffffffff", "hex"))
        .value,
    ).toBe("18446744073709551615");
  });

  test("a Counter64 as a bigint or a number", () => {
    expect(
      row(snmp.ObjectType.Counter64, BigInt("9007199254740993")).value,
    ).toBe("9007199254740993");
    expect(row(snmp.ObjectType.Counter64, 12).value).toBe("12");
  });
});

describe("octet strings", () => {
  test("text is text", () => {
    expect(row(snmp.ObjectType.OctetString, Buffer.from("core-sw-01"))).toEqual(
      { oid: OID, type: SnmpDataType.OctetString, value: "core-sw-01" },
    );
  });

  test("UTF-8 text in any script is text, not hex", () => {
    for (const text of ["Büro 2. Stock", "東京データセンター", "Склад 3"]) {
      expect(
        row(snmp.ObjectType.OctetString, Buffer.from(text, "utf8")),
      ).toEqual({ oid: OID, type: SnmpDataType.OctetString, value: text });
    }
  });

  test("line breaks and tabs are text", () => {
    expect(
      row(
        snmp.ObjectType.OctetString,
        Buffer.from("Cisco IOS\r\nVersion\t15.2"),
      ).value,
    ).toBe("Cisco IOS\r\nVersion\t15.2");
  });

  test("trailing NULs are padding, dropped", () => {
    expect(
      row(snmp.ObjectType.OctetString, Buffer.from("Linux\0\0\0", "binary")),
    ).toEqual({ oid: OID, type: SnmpDataType.OctetString, value: "Linux" });
  });

  test("a MAC address is hex octets", () => {
    expect(
      row(
        snmp.ObjectType.OctetString,
        Buffer.from([0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e]),
      ),
    ).toEqual({
      oid: OID,
      type: SnmpDataType.OctetString,
      value: "00 1A 2B 3C 4D 5E",
      isHex: true,
    });
  });

  test("octets of nothing but zeros are hex, not an empty string", () => {
    expect(
      row(snmp.ObjectType.OctetString, Buffer.from([0, 0, 0, 0, 0, 0])).value,
    ).toBe("00 00 00 00 00 00");
  });

  test("a NUL inside the text, or any other control character, makes it binary", () => {
    expect(
      row(snmp.ObjectType.OctetString, Buffer.from([0x41, 0x00, 0x42])).isHex,
    ).toBe(true);
    expect(
      row(snmp.ObjectType.OctetString, Buffer.from([0x41, 0x07, 0x42])).isHex,
    ).toBe(true);
  });

  test("octets that are not valid UTF-8 are hex", () => {
    expect(
      row(snmp.ObjectType.OctetString, Buffer.from([0xc3, 0x28, 0xa0, 0xa1])),
    ).toEqual({
      oid: OID,
      type: SnmpDataType.OctetString,
      value: "C3 28 A0 A1",
      isHex: true,
    });
  });

  test("an empty string is an empty string", () => {
    expect(row(snmp.ObjectType.OctetString, Buffer.alloc(0)).value).toBe("");
  });

  test("text longer than the limit is cut, and says so", () => {
    const long: string = "x".repeat(SNMP_WALK_MAX_VALUE_LENGTH + 50);
    const cut: SnmpWalkRow = row(
      snmp.ObjectType.OctetString,
      Buffer.from(long),
    );

    expect(cut.value).toBe("x".repeat(SNMP_WALK_MAX_VALUE_LENGTH));
    expect(cut.isCut).toBe(true);
  });

  test("binary longer than the limit is cut on a whole byte, and says so", () => {
    const bytes: Buffer = Buffer.alloc(2000, 0xab);
    const cut: SnmpWalkRow = row(snmp.ObjectType.OctetString, bytes);

    expect(cut.isHex).toBe(true);
    expect(cut.isCut).toBe(true);
    expect((cut.value as string).length).toBeLessThanOrEqual(
      SNMP_WALK_MAX_VALUE_LENGTH,
    );
    expect((cut.value as string).endsWith("AB")).toBe(true);
  });

  test("a string value is kept as it came", () => {
    expect(row(snmp.ObjectType.OctetString, "already text").value).toBe(
      "already text",
    );
  });
});

describe("the other types", () => {
  test("an OBJECT IDENTIFIER is its dotted OID", () => {
    expect(row(snmp.ObjectType.OID, "1.3.6.1.4.1.9.1.2134")).toEqual({
      oid: OID,
      type: SnmpDataType.ObjectIdentifier,
      value: "1.3.6.1.4.1.9.1.2134",
    });
  });

  test("an IpAddress is its dotted quad", () => {
    expect(row(snmp.ObjectType.IpAddress, "10.20.0.2")).toEqual({
      oid: OID,
      type: SnmpDataType.IpAddress,
      value: "10.20.0.2",
    });
  });

  test("an Opaque is always hex, even when its bytes look like text", () => {
    expect(row(snmp.ObjectType.Opaque, Buffer.from("AB"))).toEqual({
      oid: OID,
      type: SnmpDataType.Opaque,
      value: "41 42",
      isHex: true,
    });
  });

  test("a NULL has no value", () => {
    expect(row(snmp.ObjectType.Null, null)).toEqual({
      oid: OID,
      type: SnmpDataType.Null,
      value: null,
    });
  });

  test("a Boolean reads true or false", () => {
    expect(row(snmp.ObjectType.Boolean, true).value).toBe("true");
    expect(row(snmp.ObjectType.Boolean, false).value).toBe("false");
  });

  test("an unknown type keeps its value as text", () => {
    expect(row(250, "something")).toEqual({
      oid: OID,
      type: SnmpDataType.Unknown,
      value: "something",
    });
  });

  test("every SNMP data type has its name", () => {
    expect(getSnmpWalkDataType(snmp.ObjectType.EndOfMibView)).toBe(
      SnmpDataType.EndOfMibView,
    );
    expect(getSnmpWalkDataType(snmp.ObjectType.NoSuchObject)).toBe(
      SnmpDataType.NoSuchObject,
    );
    expect(getSnmpWalkDataType(snmp.ObjectType.NoSuchInstance)).toBe(
      SnmpDataType.NoSuchInstance,
    );
    expect(getSnmpWalkDataType(undefined)).toBe(SnmpDataType.Unknown);
  });
});

/*
 * What the probe writes is what the server keeps: no row the formatter
 * builds is one the server's sanitizer would change, so the walk a person
 * reads is the walk the probe read.
 */
describe("every row the probe builds survives the server's check unchanged", () => {
  test.each([
    [snmp.ObjectType.OctetString, Buffer.from([0, 1, 2, 3])],
    [snmp.ObjectType.OctetString, Buffer.from("Büro")],
    [snmp.ObjectType.OctetString, Buffer.alloc(3000, 0x41)],
    [snmp.ObjectType.Counter64, Buffer.from("ffffffffffffffff", "hex")],
    [snmp.ObjectType.TimeTicks, 5],
    [snmp.ObjectType.Null, null],
  ])("type %s", (type: number, value: unknown) => {
    const built: SnmpWalkRow = row(type, value);

    expect(
      SnmpWalkResultUtil.sanitize({
        rootOid: "1.3.6.1",
        rows: [built],
        stopReason: "complete",
        requestCount: 1,
        durationInMs: 1,
      })?.rows,
    ).toEqual([built]);
  });
});
