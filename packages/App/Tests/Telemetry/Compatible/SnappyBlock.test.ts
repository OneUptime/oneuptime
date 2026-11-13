import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import SnappyBlock, {
  SnappyDecodeError,
  SnappyTooLargeError,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/SnappyBlock";
import { snappyCompress } from "./SnappyTestCompressor";

/*
 * Snappy's block format, as Prometheus remote write and Loki's protobuf
 * push send it: hand-built blocks that pin each element encoding, round
 * trips through a compressor that writes every form, and every way a
 * block can lie about itself.
 */

const MAX: number = 64 * 1024 * 1024;

const decompress: (bytes: Array<number> | Buffer) => Buffer = (
  bytes: Array<number> | Buffer,
): Buffer => {
  return SnappyBlock.decompress(Buffer.from(bytes), MAX);
};

describe("SnappyBlock.decompress - hand-built blocks", () => {
  test("an empty block is an empty body", () => {
    expect(decompress([0x00]).length).toBe(0);
  });

  test("a one-byte literal", () => {
    expect(decompress([0x01, 0x00, 0x61]).toString()).toBe("a");
  });

  test("a copy with a 1-byte offset that overlaps what it writes (a run)", () => {
    // 'a', then copy 9 bytes from 1 back: tag = 1 | (9 - 4) << 2.
    expect(decompress([0x0a, 0x00, 0x61, 0x15, 0x01]).toString()).toBe(
      "aaaaaaaaaa",
    );
  });

  test("a copy with a 2-byte offset", () => {
    // "abcd", then copy 8 bytes from 4 back: tag = 2 | (8 - 1) << 2.
    expect(
      decompress([
        0x0c, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x1e, 0x04, 0x00,
      ]).toString(),
    ).toBe("abcdabcdabcd");
  });

  test("a copy with a 4-byte offset", () => {
    // "xyz", then copy 3 bytes from 3 back: tag = 3 | (3 - 1) << 2.
    expect(
      decompress([
        0x06, 0x08, 0x78, 0x79, 0x7a, 0x0b, 0x03, 0, 0, 0,
      ]).toString(),
    ).toBe("xyzxyz");
  });

  test("a copy's 11-bit offset uses the tag's top three bits", () => {
    const head: Buffer = crypto.randomBytes(300);
    // Literal of 300 (2-byte length form), then copy 4 bytes from 300 back.
    const block: Array<number> = [
      0xb0,
      0x02, // varint 304
      61 << 2,
      299 & 0xff,
      299 >> 8,
      ...head,
      1 | ((4 - 4) << 2) | ((300 >> 8) << 5),
      300 & 0xff,
    ];

    const output: Buffer = decompress(block);

    expect(output.length).toBe(304);
    expect(output.subarray(300).equals(head.subarray(0, 4))).toBe(true);
  });

  test("a literal whose length takes one extra byte (tag 60)", () => {
    const literal: Buffer = crypto.randomBytes(100);
    const output: Buffer = decompress([100, 60 << 2, 99, ...literal]);

    expect(output.equals(literal)).toBe(true);
  });

  test("a literal whose length takes three and four extra bytes (tags 62, 63)", () => {
    const literal: Buffer = crypto.randomBytes(70_000);
    const lengthMinusOne: number = literal.length - 1;
    const varint: Array<number> = [0xf0, 0xa2, 0x04]; // 70000

    expect(
      decompress([
        ...varint,
        62 << 2,
        lengthMinusOne & 0xff,
        (lengthMinusOne >> 8) & 0xff,
        (lengthMinusOne >> 16) & 0xff,
        ...literal,
      ]).equals(literal),
    ).toBe(true);

    expect(
      decompress([
        ...varint,
        63 << 2,
        lengthMinusOne & 0xff,
        (lengthMinusOne >> 8) & 0xff,
        (lengthMinusOne >> 16) & 0xff,
        0,
        ...literal,
      ]).equals(literal),
    ).toBe(true);
  });
});

describe("SnappyBlock.decompress - round trips", () => {
  const bodies: Array<[string, Buffer]> = [
    [
      "text",
      Buffer.from("The quick brown fox jumps over the lazy dog. ".repeat(50)),
    ],
    ["random bytes", crypto.randomBytes(10_000)],
    ["a long run of one byte", Buffer.alloc(100_000, 7)],
    [
      "protobuf-like repetition",
      Buffer.from(
        Array.from({ length: 2_000 }, (_value: unknown, index: number) => {
          return `__name__\u0012http_requests_total\u001a${index % 7}`;
        }).join(""),
      ),
    ],
    ["one byte", Buffer.from([42])],
    ["a megabyte", crypto.randomBytes(1024 * 1024)],
  ];

  test.each(bodies)(
    "%s, with 1- and 2-byte offsets",
    (_name: string, body: Buffer) => {
      expect(decompress(snappyCompress(body)).equals(body)).toBe(true);
    },
  );

  test.each(bodies)(
    "%s, with 4-byte offsets",
    (_name: string, body: Buffer) => {
      expect(
        decompress(snappyCompress(body, { forceFourByteOffsets: true })).equals(
          body,
        ),
      ).toBe(true);
    },
  );

  test.each(bodies)("%s, as literals only", (_name: string, body: Buffer) => {
    expect(
      decompress(snappyCompress(body, { literalsOnly: true })).equals(body),
    ).toBe(true);
  });

  test("a repetitive body really is compressed, so copies are exercised", () => {
    const body: Buffer = Buffer.alloc(100_000, 7);

    expect(snappyCompress(body).length).toBeLessThan(body.length / 10);
  });
});

describe("SnappyBlock.decompress - blocks that lie", () => {
  test.each<[string, Array<number>]>([
    ["no bytes at all", []],
    ["a length cut off mid-varint", [0x80]],
    ["a length longer than five bytes", [0x80, 0x80, 0x80, 0x80, 0x80, 0x01]],
    ["a literal that runs past the end", [0x05, 0x10, 0x61, 0x62]],
    ["a literal whose extra length bytes are cut off", [0x64, 60 << 2]],
    ["a copy whose offset is cut off", [0x05, 0x00, 0x61, 0x15]],
    ["a copy pointing before the start", [0x05, 0x00, 0x61, 0x01, 0x05]],
    ["a copy with offset zero", [0x05, 0x00, 0x61, 0x01, 0x00]],
    ["more bytes than the length declares", [0x01, 0x04, 0x61, 0x62]],
    ["fewer bytes than the length declares", [0x05, 0x00, 0x61]],
    [
      "a copy that writes past the declared length",
      [0x03, 0x00, 0x61, 0x15, 0x01],
    ],
  ])("refuses %s", (_name: string, block: Array<number>) => {
    expect(() => {
      decompress(block);
    }).toThrow(SnappyDecodeError);
  });

  test("a block declaring more than the ceiling is refused before anything is allocated", () => {
    // Declares 4 GiB - 1 in five bytes.
    const block: Buffer = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f]);

    let error: unknown = null;

    try {
      SnappyBlock.decompress(block, 1024);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(SnappyTooLargeError);
    expect((error as SnappyTooLargeError).declaredLength).toBe(4294967295);
  });

  test("a body at exactly the ceiling is accepted", () => {
    const body: Buffer = crypto.randomBytes(2048);

    expect(
      SnappyBlock.decompress(snappyCompress(body), 2048).equals(body),
    ).toBe(true);
  });
});

describe("SnappyBlock.declaredLength", () => {
  test("reads the preamble without decompressing", () => {
    expect(SnappyBlock.declaredLength(snappyCompress(Buffer.alloc(300)))).toBe(
      300,
    );
  });

  test("is null for a preamble that is not a varint", () => {
    expect(SnappyBlock.declaredLength(Buffer.from([0x80]))).toBeNull();
  });
});
