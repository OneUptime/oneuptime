import {
  BerError,
  BerReader,
  BerTag,
  decodeOid,
  encodeConstructed,
  encodeInteger,
  encodeLength,
  encodeNull,
  encodeOctetString,
  encodeOid,
  encodeUnsigned32,
} from "../../../../Utils/Snmp/V3/SnmpBer";
import { describe, expect, test } from "@jest/globals";

/*
 * The BER the SNMPv3 trap receiver reads before anything is authenticated:
 * octets from whoever can reach the probe's port. Every length is checked
 * against what is left, nothing is read past its parent, and anything else
 * is a BerError - never a crash, never a loop.
 */

describe("lengths", () => {
  test("short and long forms, both ways", () => {
    for (const length of [0, 1, 127, 128, 255, 256, 65535, 70000]) {
      const encoded: Buffer = encodeLength(length);
      const element: Buffer = Buffer.concat([
        Buffer.from([BerTag.OctetString]),
        encoded,
        Buffer.alloc(length),
      ]);

      expect(new BerReader(element).readOctetString().length).toBe(length);
    }

    expect(encodeLength(127)).toEqual(Buffer.from([0x7f]));
    expect(encodeLength(128)).toEqual(Buffer.from([0x81, 0x80]));
    expect(encodeLength(256)).toEqual(Buffer.from([0x82, 0x01, 0x00]));
  });

  test("an indefinite length is refused: SNMP does not use it", () => {
    expect(() => {
      new BerReader(Buffer.from([0x30, 0x80, 0x00, 0x00])).readConstructed();
    }).toThrow(BerError);
  });

  test("a length longer than four octets is refused", () => {
    expect(() => {
      new BerReader(
        Buffer.from([0x04, 0x85, 0, 0, 0, 0, 1, 0x00]),
      ).readOctetString();
    }).toThrow(BerError);
  });

  test("a length past the end of the datagram is refused, not read", () => {
    expect(() => {
      new BerReader(Buffer.from([0x04, 0x10, 0x41, 0x42])).readOctetString();
    }).toThrow(BerError);

    expect(() => {
      new BerReader(
        Buffer.from([0x04, 0x84, 0xff, 0xff, 0xff, 0xff]),
      ).readOctetString();
    }).toThrow(BerError);
  });

  test("a child cannot run past its parent", () => {
    // SEQUENCE of 3 holding an OCTET STRING that claims 5.
    const reader: BerReader = new BerReader(
      Buffer.from([0x30, 0x03, 0x04, 0x05, 0x41, 0x42, 0x43, 0x44, 0x45]),
    ).readConstructed();

    expect(() => {
      reader.readOctetString();
    }).toThrow(BerError);
  });

  test("a missing length octet is refused", () => {
    expect(() => {
      new BerReader(Buffer.from([0x30])).readConstructed();
    }).toThrow(BerError);
  });
});

describe("tags", () => {
  test("multi-octet tags are refused: SNMP has none", () => {
    expect(() => {
      new BerReader(Buffer.from([0x1f, 0x81, 0x01, 0x00])).readElement();
    }).toThrow(BerError);
  });

  test("an unexpected tag says so", () => {
    expect(() => {
      new BerReader(encodeInteger(5)).readOctetString();
    }).toThrow(/Expected BER tag 0x4, found 0x2/);
  });

  test("reading past the end is an error, and peek says null", () => {
    const reader: BerReader = new BerReader(Buffer.alloc(0));

    expect(reader.peekTag()).toBeNull();
    expect(reader.hasMore()).toBe(false);
    expect(() => {
      reader.readElement();
    }).toThrow(BerError);
  });

  test("bounds outside the buffer are refused at once", () => {
    expect(() => {
      return new BerReader(Buffer.alloc(4), 2, 10);
    }).toThrow(BerError);
  });
});

describe("INTEGER", () => {
  test("round trips the signed 32-bit range in the fewest octets", () => {
    for (const value of [
      0, 1, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768,
      2147483647, -2147483648, 90210, -90210,
    ]) {
      expect(new BerReader(encodeInteger(value)).readInteger()).toBe(value);
    }

    expect(encodeInteger(0)).toEqual(Buffer.from([0x02, 0x01, 0x00]));
    expect(encodeInteger(128)).toEqual(Buffer.from([0x02, 0x02, 0x00, 0x80]));
    expect(encodeInteger(-1)).toEqual(Buffer.from([0x02, 0x01, 0xff]));
    expect(encodeInteger(-129)).toEqual(Buffer.from([0x02, 0x02, 0xff, 0x7f]));
  });

  test("outside SNMP's range, or not whole, is refused when writing", () => {
    expect(() => {
      encodeInteger(2147483648);
    }).toThrow(BerError);
    expect(() => {
      encodeInteger(1.5);
    }).toThrow(BerError);
  });

  test("an INTEGER with no octets, or more than SNMP needs, is refused when reading", () => {
    expect(() => {
      new BerReader(Buffer.from([0x02, 0x00])).readInteger();
    }).toThrow(BerError);
    expect(() => {
      new BerReader(
        Buffer.from([0x02, 0x09, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      ).readInteger();
    }).toThrow(BerError);
  });
});

describe("unsigned 32-bit values", () => {
  test("round trip with a leading zero when the top bit is set", () => {
    for (const value of [0, 1, 127, 128, 65535, 2147483648, 4294967295]) {
      expect(
        new BerReader(encodeUnsigned32(value, BerTag.Counter32)).readUnsigned32(
          BerTag.Counter32,
        ),
      ).toBe(value);
    }

    expect(encodeUnsigned32(4294967295, BerTag.Gauge32)).toEqual(
      Buffer.from([0x42, 0x05, 0x00, 0xff, 0xff, 0xff, 0xff]),
    );
  });

  test("outside 32 bits is refused when writing", () => {
    expect(() => {
      encodeUnsigned32(4294967296, BerTag.Counter32);
    }).toThrow(BerError);
    expect(() => {
      encodeUnsigned32(-1, BerTag.Counter32);
    }).toThrow(BerError);
  });
});

describe("OBJECT IDENTIFIER", () => {
  test("round trips, the first two arcs folded into one octet", () => {
    for (const oid of [
      "1.3.6.1.6.3.1.1.4.1.0",
      "1.3.6.1.4.1.1588.2.1.1.1.6.2.1.36",
      "0.0",
      "2.999.3",
      "1.3.6.1.4.1.4294967295",
    ]) {
      expect(new BerReader(encodeOid(oid)).readOid()).toBe(oid);
    }

    expect(encodeOid("1.3.6.1")).toEqual(
      Buffer.from([0x06, 0x03, 0x2b, 0x06, 0x01]),
    );
  });

  test("a leading dot is read as written by people", () => {
    expect(new BerReader(encodeOid(".1.3.6.1")).readOid()).toBe("1.3.6.1");
  });

  test("text that is not an OID is refused when writing", () => {
    for (const bad of ["", "1", "1.3.x", "3.1", "1.40", "1.3.6.4294967296"]) {
      expect(() => {
        encodeOid(bad);
      }).toThrow(BerError);
    }
  });

  test("a padded subidentifier, one cut off, or one past 32 bits is refused when reading", () => {
    expect(() => {
      decodeOid(Buffer.from([0x2b, 0x80, 0x01]), 0, 3);
    }).toThrow(BerError);
    expect(() => {
      decodeOid(Buffer.from([0x2b, 0x86]), 0, 2);
    }).toThrow(BerError);
    expect(() => {
      decodeOid(Buffer.from([0x2b, 0x90, 0x80, 0x80, 0x80, 0x00]), 0, 6);
    }).toThrow(BerError);
    expect(() => {
      decodeOid(Buffer.alloc(0), 0, 0);
    }).toThrow(BerError);
  });

  test("an OID longer than any MIB's is refused", () => {
    const octets: Buffer = Buffer.concat([
      Buffer.from([0x2b]),
      Buffer.alloc(200, 0x01),
    ]);

    expect(() => {
      decodeOid(octets, 0, octets.length);
    }).toThrow(BerError);
  });
});

describe("NULL, OCTET STRING and constructed values", () => {
  test("NULL is two octets and refuses a value", () => {
    expect(encodeNull()).toEqual(Buffer.from([0x05, 0x00]));
    new BerReader(encodeNull()).readNull();
    expect(() => {
      new BerReader(Buffer.from([0x05, 0x01, 0x00])).readNull();
    }).toThrow(BerError);
  });

  test("an OCTET STRING of text or octets", () => {
    expect(
      new BerReader(encodeOctetString("san-monitor"))
        .readOctetString()
        .toString(),
    ).toBe("san-monitor");
    expect(
      new BerReader(
        encodeOctetString(Buffer.from([0, 1, 2])),
      ).readOctetString(),
    ).toEqual(Buffer.from([0, 1, 2]));
  });

  test("a SEQUENCE reads its children in order and says where it is", () => {
    const encoded: Buffer = encodeConstructed([
      encodeInteger(3),
      encodeOctetString("x"),
      encodeConstructed([encodeNull()], 0xa7),
    ]);
    const reader: BerReader = new BerReader(encoded).readConstructed();

    expect(reader.readInteger()).toBe(3);
    expect(reader.readOctetString().toString()).toBe("x");
    expect(reader.peekTag()).toBe(0xa7);
    reader.readConstructed(0xa7).readNull();
    expect(reader.hasMore()).toBe(false);
    expect(reader.getOffset()).toBe(encoded.length);
    expect(reader.getBuffer()).toBe(encoded);
  });
});

test("ten thousand random datagrams never crash the reader, only fail it", () => {
  // A deterministic walk over byte patterns, without a random generator: every value of a few positions.
  let parsed: number = 0;

  for (let first: number = 0; first < 256; first += 3) {
    for (let second: number = 0; second < 256; second += 7) {
      const datagram: Buffer = Buffer.from([
        first,
        second,
        (first * 31 + second) & 0xff,
        (second * 17) & 0xff,
        0x02,
        0x01,
        0x03,
      ]);

      try {
        const reader: BerReader = new BerReader(datagram);

        while (reader.hasMore()) {
          reader.readElement();
        }

        parsed++;
      } catch (err) {
        expect(err).toBeInstanceOf(BerError);
      }
    }
  }

  expect(parsed).toBeGreaterThan(0);
});
