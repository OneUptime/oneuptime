import Der, {
  DerElement,
  DerParseError,
  DerTag,
} from "../../../../Utils/Monitors/CertificateRevocation/Der";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * The DER reader takes bytes from the network: the monitored server's
 * certificates and whatever answers at the OCSP / CRL address they name. It
 * must read well-formed DER exactly and refuse everything else with a
 * DerParseError - never read past its buffer, never loop.
 */

function hex(text: string): Buffer {
  return Buffer.from(text.replace(/\s+/g, ""), "hex");
}

describe("Der.readElement", () => {
  test("reads a short-form length", () => {
    const element: DerElement = Der.parse(hex("04 03 aa bb cc"));

    expect(element.tag).toBe(DerTag.OctetString);
    expect(Der.value(element)).toEqual(hex("aa bb cc"));
    expect(Der.encoded(element)).toEqual(hex("04 03 aa bb cc"));
  });

  test("reads a long-form length", () => {
    const content: Buffer = Buffer.alloc(300, 0x41);
    const encoded: Buffer = Buffer.concat([hex("04 82 01 2c"), content]);
    const element: DerElement = Der.parse(encoded);

    expect(Der.value(element).length).toBe(300);
    expect(element.valueStart).toBe(4);
  });

  test("refuses an indefinite length", () => {
    expect(() => {
      return Der.parse(hex("30 80 00 00"));
    }).toThrow(DerParseError);
  });

  test("refuses a length that runs past the buffer", () => {
    expect(() => {
      return Der.parse(hex("04 05 aa bb"));
    }).toThrow(DerParseError);
  });

  test("refuses a child that runs past its parent", () => {
    // SEQUENCE of length 3 whose child claims 4 octets.
    const parent: DerElement = Der.parse(hex("30 03 04 04 aa bb cc dd"));

    expect(() => {
      return Der.children(parent);
    }).toThrow(DerParseError);
  });

  test("refuses high tag numbers and over-long lengths", () => {
    expect(() => {
      return Der.parse(hex("1f 81 00 00"));
    }).toThrow(DerParseError);

    expect(() => {
      return Der.parse(hex("04 85 00 00 00 00 01 aa"));
    }).toThrow(DerParseError);
  });

  test("refuses a buffer too short to hold an element", () => {
    expect(() => {
      return Der.parse(Buffer.alloc(0));
    }).toThrow(DerParseError);

    expect(() => {
      return Der.parse(hex("30"));
    }).toThrow(DerParseError);
  });
});

describe("Der readers", () => {
  test("decodes object identifiers, including multi-octet arcs", () => {
    // 1.2.840.113549.1.1.11 (sha256WithRSAEncryption)
    expect(
      Der.readObjectIdentifier(
        Der.parse(hex("06 09 2a 86 48 86 f7 0d 01 01 0b")),
      ),
    ).toBe("1.2.840.113549.1.1.11");
    // 2.5.29.31 (CRL distribution points)
    expect(Der.readObjectIdentifier(Der.parse(hex("06 03 55 1d 1f")))).toBe(
      "2.5.29.31",
    );
    // 1.3.6.1.5.5.7.48.1 (id-ad-ocsp)
    expect(
      Der.readObjectIdentifier(Der.parse(hex("06 08 2b 06 01 05 05 07 30 01"))),
    ).toBe("1.3.6.1.5.5.7.48.1");
  });

  test("refuses a truncated object identifier", () => {
    expect(() => {
      return Der.readObjectIdentifier(Der.parse(hex("06 02 2a 86")));
    }).toThrow(DerParseError);
  });

  test("reads integers in their shortest form, so padded serials compare equal", () => {
    expect(Der.readInteger(Der.parse(hex("02 02 00 80")))).toEqual(
      hex("00 80"),
    );
    expect(Der.readInteger(Der.parse(hex("02 03 00 00 80")))).toEqual(
      hex("00 80"),
    );
    expect(Der.readInteger(Der.parse(hex("02 03 00 12 34")))).toEqual(
      hex("12 34"),
    );
    // A negative number keeps its sign: -128 is not +128.
    expect(Der.readInteger(Der.parse(hex("02 02 ff 80")))).toEqual(hex("80"));
    expect(Der.readInteger(Der.parse(hex("02 01 00")))).toEqual(hex("00"));
  });

  test("reads small numbers and refuses negative or huge ones", () => {
    expect(
      Der.readSmallNumber(Der.parse(hex("0a 01 03")), DerTag.Enumerated),
    ).toBe(3);
    expect(
      Der.readSmallNumber(Der.parse(hex("02 02 01 00")), DerTag.Integer),
    ).toBe(256);
    expect(() => {
      return Der.readSmallNumber(Der.parse(hex("02 01 ff")), DerTag.Integer);
    }).toThrow(DerParseError);
    expect(() => {
      return Der.readSmallNumber(
        Der.parse(hex("02 05 01 00 00 00 00")),
        DerTag.Integer,
      );
    }).toThrow(DerParseError);
  });

  test("reads bit strings of whole octets only", () => {
    expect(Der.readBitString(Der.parse(hex("03 03 00 ab cd")))).toEqual(
      hex("ab cd"),
    );
    expect(() => {
      return Der.readBitString(Der.parse(hex("03 02 04 f0")));
    }).toThrow(DerParseError);
  });

  test("reads UTCTime with the RFC 5280 century rule", () => {
    const utc2049: Date = Der.readTime(
      Der.parse(Buffer.concat([hex("17 0d"), Buffer.from("491231235959Z")])),
    );
    const utc1950: Date = Der.readTime(
      Der.parse(Buffer.concat([hex("17 0d"), Buffer.from("500101000000Z")])),
    );

    expect(utc2049.toISOString()).toBe("2049-12-31T23:59:59.000Z");
    expect(utc1950.toISOString()).toBe("1950-01-01T00:00:00.000Z");
  });

  test("reads GeneralizedTime, with and without fractions", () => {
    const whole: Date = Der.readTime(
      Der.parse(Buffer.concat([hex("18 0f"), Buffer.from("20261103130313Z")])),
    );
    const fraction: Date = Der.readTime(
      Der.parse(
        Buffer.concat([hex("18 12"), Buffer.from("20261103130313.25Z")]),
      ),
    );

    expect(whole.toISOString()).toBe("2026-11-03T13:03:13.000Z");
    expect(fraction.toISOString()).toBe("2026-11-03T13:03:13.250Z");
  });

  test("refuses times that are not UTC, malformed or out of range", () => {
    for (const text of [
      "20261103130313+0100",
      "2026110313031Z",
      "20261303130313Z",
      "hello world....Z",
    ]) {
      const encoded: Buffer = Buffer.concat([
        Buffer.from([DerTag.GeneralizedTime, text.length]),
        Buffer.from(text),
      ]);

      expect(() => {
        return Der.readTime(Der.parse(encoded));
      }).toThrow(DerParseError);
    }
  });
});

describe("Der writers", () => {
  test("encodes lengths in short and long form, and reads them back", () => {
    for (const length of [0, 1, 127, 128, 255, 256, 65535, 70000]) {
      const encoded: Buffer = Der.encodeOctetString(Buffer.alloc(length, 7));
      const element: DerElement = Der.parse(encoded);

      expect(Der.value(element).length).toBe(length);
      expect(element.end).toBe(encoded.length);
    }
  });

  test("nests sequences", () => {
    const encoded: Buffer = Der.encodeSequence([
      Der.encodeOctetString(hex("01")),
      Der.encodeSequence([Der.encodeOctetString(hex("02 03"))]),
    ]);

    expect(encoded).toEqual(hex("30 09 04 01 01 30 04 04 02 02 03"));
    expect(Der.children(Der.parse(encoded)).length).toBe(2);
  });
});

describe("Der on arbitrary bytes", () => {
  /*
   * Walks every element of whatever it is given. Anything the reader cannot
   * make sense of must surface as a DerParseError.
   */
  function walk(element: DerElement, depth: number): void {
    if (depth > 64 || !Der.isConstructed(element)) {
      return;
    }

    for (const child of Der.children(element)) {
      walk(child, depth + 1);
    }
  }

  test("random and mutated inputs never fail any other way", () => {
    const random: SeededRandom = seededRandom(6960);
    const valid: Buffer = Der.encodeSequence([
      Der.encodeSequence([
        hex("06 09 2a 86 48 86 f7 0d 01 01 0b"),
        hex("05 00"),
      ]),
      Der.encodeOctetString(Buffer.alloc(40, 0x11)),
      hex("02 03 00 ff ee"),
      Buffer.concat([hex("18 0f"), Buffer.from("20261103130313Z")]),
    ]);

    for (let round: number = 0; round < 3000; round++) {
      let input: Buffer;

      if (round % 2 === 0) {
        input = Buffer.alloc(1 + random(96));
        for (let index: number = 0; index < input.length; index++) {
          input[index] = random(256);
        }
      } else {
        input = Buffer.from(valid);
        const flips: number = 1 + random(4);
        for (let flip: number = 0; flip < flips; flip++) {
          input[random(input.length)] = random(256);
        }
        input = input.subarray(0, 1 + random(input.length));
      }

      try {
        walk(Der.parse(input), 0);
      } catch (error) {
        expect(error).toBeInstanceOf(DerParseError);
      }
    }
  });
});
