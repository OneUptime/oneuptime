import SnmpOctetCounter from "../../../Utils/NetworkDevice/SnmpOctetCounter";
import { describe, expect, test } from "@jest/globals";

/*
 * FCMGMT-MIB (the Fibre Alliance MIB Fabric OS implements) carries every
 * port counter as an 8-byte OCTET STRING, big-endian, not a Counter64:
 * `connUnitPortStatCountInvalidCRC OCTET STRING (SIZE (8))`. The probe may
 * hand the decoder the bytes, a number (a recording, a JSON round trip), or
 * the hex a tool renders them as - and must never read ordinary text that
 * happens to be all digits as hex.
 */

function bytes(...values: Array<number>): Buffer {
  return Buffer.from(values);
}

function counter(value: bigint): Buffer {
  const buffer: Buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(value);
  return buffer;
}

describe("SnmpOctetCounter.decode", () => {
  describe("bytes", () => {
    test("eight bytes, big-endian", () => {
      expect(SnmpOctetCounter.decode(bytes(0, 0, 0, 0, 0, 0, 0, 12))).toBe(12);
      expect(SnmpOctetCounter.decode(bytes(0, 0, 0, 0, 0, 0, 1, 0))).toBe(256);
      expect(SnmpOctetCounter.decode(bytes(0, 0, 0, 1, 0, 0, 0, 0))).toBe(
        4294967296,
      );
    });

    test("all zero is zero, not nothing", () => {
      expect(SnmpOctetCounter.decode(Buffer.alloc(8))).toBe(0);
    });

    test("a count past 32 bits, which a Counter32 would have wrapped", () => {
      expect(SnmpOctetCounter.decode(counter(BigInt(2211904123456)))).toBe(
        2211904123456,
      );
    });

    test("the largest safe integer exactly; beyond it, the nearest number", () => {
      expect(
        SnmpOctetCounter.decode(counter(BigInt(Number.MAX_SAFE_INTEGER))),
      ).toBe(Number.MAX_SAFE_INTEGER);
      expect(
        SnmpOctetCounter.decode(counter(BigInt("18446744073709551615"))),
      ).toBe(Number(BigInt("18446744073709551615")));
    });

    test("fewer than eight bytes, as an agent that trims leading zeros sends them", () => {
      expect(SnmpOctetCounter.decode(bytes(1, 0))).toBe(256);
      expect(SnmpOctetCounter.decode(bytes(7))).toBe(7);
    });

    test("more than eight only when the extra bytes in front are zero", () => {
      expect(SnmpOctetCounter.decode(bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 5))).toBe(
        5,
      );
      expect(
        SnmpOctetCounter.decode(bytes(1, 0, 0, 0, 0, 0, 0, 0, 0, 5)),
      ).toBeUndefined();
    });

    test("no bytes is no counter", () => {
      expect(SnmpOctetCounter.decode(Buffer.alloc(0))).toBeUndefined();
      expect(SnmpOctetCounter.decode(new Uint8Array(0))).toBeUndefined();
    });

    test("a Uint8Array reads the same as a Buffer", () => {
      expect(
        SnmpOctetCounter.decode(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 3])),
      ).toBe(3);
    });
  });

  describe("numbers", () => {
    test("a non-negative integer is itself", () => {
      expect(SnmpOctetCounter.decode(0)).toBe(0);
      expect(SnmpOctetCounter.decode(1544)).toBe(1544);
    });

    test.each([-1, 1.5, NaN, Infinity, -Infinity])(
      "%s is no counter",
      (value: number) => {
        expect(SnmpOctetCounter.decode(value)).toBeUndefined();
      },
    );

    test("a bigint within 64 bits", () => {
      expect(SnmpOctetCounter.decode(BigInt(42))).toBe(42);
      expect(SnmpOctetCounter.decode(BigInt(-1))).toBeUndefined();
      expect(
        SnmpOctetCounter.decode(BigInt("18446744073709551616")),
      ).toBeUndefined();
    });
  });

  describe("hex text", () => {
    test.each([
      ["00 00 00 00 00 00 00 0c", 12],
      ["00:00:00:00:00:00:01:00", 256],
      ["00-00-00-00-00-00-00-ff", 255],
      ["00 0C", 12],
      ["  00 00 00 00 00 00 00 03  ", 3],
      ["000000000000000c", 12],
      ["0x0c", 12],
      ["0X1F", 31],
      // An odd number of digits after 0x is still one number.
      ["0x123", 291],
      ["0xffffffff", 4294967295],
    ])("%s is %s", (text: string, value: number) => {
      expect(SnmpOctetCounter.decode(text)).toBe(value);
    });

    test.each([
      // A lone "12" could as well be twelve: never read as 0x12.
      "12",
      "0c",
      "1544",
      // Nine octets, or seventeen digits: more than a counter holds.
      "00 00 00 00 00 00 00 00 01",
      "0x00000000000000001",
      "00000000000000001",
      "",
      "   ",
      "zz zz",
      "0x",
      "00 0",
      "NA",
    ])("%s is no counter", (text: string) => {
      expect(SnmpOctetCounter.decode(text)).toBeUndefined();
    });
  });

  test.each([undefined, null, {}, [], true])(
    "%p is no counter",
    (value: unknown) => {
      expect(SnmpOctetCounter.decode(value)).toBeUndefined();
    },
  );

  test("a 32-bit wrap reads as the counter it is: the rate util sees it go backwards", () => {
    const before: number | undefined = SnmpOctetCounter.decode(
      counter(BigInt(4294967290)),
    );
    const after: number | undefined = SnmpOctetCounter.decode(
      counter(BigInt(4294967300)),
    );

    // An 8-byte counter does not wrap at 2^32: the delta is ten, not negative.
    expect(after! - before!).toBe(10);
  });
});
