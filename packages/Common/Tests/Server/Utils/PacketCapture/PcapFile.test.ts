import PcapFile, {
  PCAP_GLOBAL_HEADER_LENGTH,
  PCAP_MAX_RECORD_LENGTH,
  PCAP_RECORD_HEADER_LENGTH,
  PcapInspection,
  PcapTruncation,
} from "../../../../Server/Utils/PacketCapture/PcapFile";
import {
  makePcap,
  makePcapHeader,
  makePcapRecord,
  PcapByteOrder,
  pcapLength,
} from "./PcapFixture";
import { describe, expect, test } from "@jest/globals";

/*
 * The probe cuts a capture at its size limit with truncate(), and the
 * server checks what a probe uploaded with inspect() - counting the
 * packets itself rather than taking the probe's word - after decoding the
 * upload with decodeBase64(). A file that does not open in Wireshark, or a
 * count that is wrong, is what these would let through.
 */

const FLAVOURS: Array<{
  name: string;
  byteOrder: PcapByteOrder;
  isNanosecond: boolean;
}> = [
  {
    name: "little-endian, microseconds",
    byteOrder: PcapByteOrder.LittleEndian,
    isNanosecond: false,
  },
  {
    name: "little-endian, nanoseconds",
    byteOrder: PcapByteOrder.LittleEndian,
    isNanosecond: true,
  },
  {
    name: "big-endian, microseconds",
    byteOrder: PcapByteOrder.BigEndian,
    isNanosecond: false,
  },
  {
    name: "big-endian, nanoseconds",
    byteOrder: PcapByteOrder.BigEndian,
    isNanosecond: true,
  },
];

describe("the pcap format", () => {
  test("a global header is 24 bytes, a record header 16, and a packet at most 256 KiB", () => {
    expect(PCAP_GLOBAL_HEADER_LENGTH).toBe(24);
    expect(PCAP_RECORD_HEADER_LENGTH).toBe(16);
    expect(PCAP_MAX_RECORD_LENGTH).toBe(262144);
  });
});

describe("PcapFile.isPcap", () => {
  test.each(FLAVOURS)(
    "reads a $name file",
    (flavour: { byteOrder: PcapByteOrder; isNanosecond: boolean }) => {
      expect(
        PcapFile.isPcap(
          makePcap({
            packetLengths: [60],
            byteOrder: flavour.byteOrder,
            isNanosecond: flavour.isNanosecond,
          }),
        ),
      ).toBe(true);
    },
  );

  test("a header alone is a pcap file", () => {
    expect(PcapFile.isPcap(makePcapHeader())).toBe(true);
  });

  test("anything else is not", () => {
    expect(PcapFile.isPcap(Buffer.alloc(0))).toBe(false);
    expect(PcapFile.isPcap(makePcapHeader().subarray(0, 23))).toBe(false);
    expect(PcapFile.isPcap(Buffer.from("hello, this is not a pcap file"))).toBe(
      false,
    );

    // pcapng, which tcpdump writes only when asked, starts 0x0a0d0d0a.
    const pcapng: Buffer = Buffer.alloc(32);
    pcapng.writeUInt32LE(0x0a0d0d0a, 0);
    expect(PcapFile.isPcap(pcapng)).toBe(false);
  });
});

describe("PcapFile.inspect", () => {
  test.each(FLAVOURS)(
    "counts the packets of a $name file",
    (flavour: { byteOrder: PcapByteOrder; isNanosecond: boolean }) => {
      const lengths: Array<number> = [60, 1514, 0, 98, 262144];
      const file: Buffer = makePcap({
        packetLengths: lengths,
        byteOrder: flavour.byteOrder,
        isNanosecond: flavour.isNanosecond,
      });

      expect(PcapFile.inspect(file)).toEqual({
        isPcap: true,
        packetCount: 5,
        wholeLength: pcapLength(lengths),
        linkType: 1,
      });
    },
  );

  test("says the link type the file declares", () => {
    expect(
      PcapFile.inspect(makePcap({ packetLengths: [60], linkType: 113 }))
        .linkType,
    ).toBe(113);
    expect(
      PcapFile.inspect(
        makePcap({
          packetLengths: [60],
          linkType: 113,
          byteOrder: PcapByteOrder.BigEndian,
        }),
      ).linkType,
    ).toBe(113);
  });

  test("a header with no packets holds none", () => {
    expect(PcapFile.inspect(makePcapHeader())).toEqual({
      isPcap: true,
      packetCount: 0,
      wholeLength: 24,
      linkType: 1,
    });
  });

  test("a last record cut short is not counted, and the whole length stops before it", () => {
    const whole: Buffer = makePcap({ packetLengths: [60, 70] });
    const cut: Buffer = Buffer.concat([
      whole,
      makePcapRecord({ capturedLength: 100, index: 2 }).subarray(0, 40),
    ]);

    const inspection: PcapInspection = PcapFile.inspect(cut);

    expect(inspection.packetCount).toBe(2);
    expect(inspection.wholeLength).toBe(whole.length);
  });

  test("a record header cut short is not counted either", () => {
    const whole: Buffer = makePcap({ packetLengths: [60] });

    expect(
      PcapFile.inspect(Buffer.concat([whole, Buffer.alloc(10)])),
    ).toMatchObject({ packetCount: 1, wholeLength: whole.length });
  });

  test("a record that says it holds more than any packet stops the count there", () => {
    const whole: Buffer = makePcap({ packetLengths: [60] });
    const forged: Buffer = Buffer.concat([
      whole,
      makePcapRecord({
        capturedLength: 8,
        index: 1,
        declaredLength: PCAP_MAX_RECORD_LENGTH + 1,
      }),
      makePcapRecord({ capturedLength: 8, index: 2 }),
    ]);

    expect(PcapFile.inspect(forged)).toMatchObject({
      packetCount: 1,
      wholeLength: whole.length,
    });
  });

  test("a buffer that is not a pcap file holds nothing", () => {
    expect(PcapFile.inspect(Buffer.from("x".repeat(100)))).toEqual({
      isPcap: false,
      packetCount: 0,
      wholeLength: 0,
      linkType: null,
    });
  });
});

describe("PcapFile.truncate", () => {
  test("a file under the limit is kept whole", () => {
    const file: Buffer = makePcap({ packetLengths: [60, 70, 80] });
    const truncation: PcapTruncation = PcapFile.truncate(file, file.length);

    expect(truncation.packetCount).toBe(3);
    expect(truncation.buffer.equals(file)).toBe(true);
  });

  test("a file over the limit is cut after the last whole packet that fits", () => {
    const file: Buffer = makePcap({ packetLengths: [100, 100, 100, 100] });
    const limit: number = pcapLength([100, 100]) + 50;
    const truncation: PcapTruncation = PcapFile.truncate(file, limit);

    expect(truncation.packetCount).toBe(2);
    expect(truncation.buffer).toHaveLength(pcapLength([100, 100]));
    expect(
      truncation.buffer.equals(file.subarray(0, pcapLength([100, 100]))),
    ).toBe(true);
    expect(truncation.buffer.length).toBeLessThanOrEqual(limit);
  });

  test("what it cuts is a pcap file that reads back with the same packets", () => {
    const file: Buffer = makePcap({
      packetLengths: [60, 1514, 98, 1514, 60],
      byteOrder: PcapByteOrder.BigEndian,
      isNanosecond: true,
    });
    const truncation: PcapTruncation = PcapFile.truncate(file, 2000);
    const inspection: PcapInspection = PcapFile.inspect(truncation.buffer);

    expect(inspection.isPcap).toBe(true);
    expect(inspection.packetCount).toBe(truncation.packetCount);
    expect(inspection.wholeLength).toBe(truncation.buffer.length);
    // 24 + (16 + 60) + (16 + 1514) + (16 + 98) = 1744; the next 1530 do not fit.
    expect(truncation.packetCount).toBe(3);
    expect(truncation.buffer).toHaveLength(1744);
  });

  test("a half-written last record is dropped even under the limit", () => {
    const whole: Buffer = makePcap({ packetLengths: [60] });
    const halfWritten: Buffer = Buffer.concat([
      whole,
      makePcapRecord({ capturedLength: 60, index: 1 }).subarray(0, 30),
    ]);
    const truncation: PcapTruncation = PcapFile.truncate(halfWritten, 1000000);

    expect(truncation.packetCount).toBe(1);
    expect(truncation.buffer.equals(whole)).toBe(true);
  });

  test("a limit that fits only the header keeps the header", () => {
    const file: Buffer = makePcap({ packetLengths: [60] });
    const truncation: PcapTruncation = PcapFile.truncate(file, 30);

    expect(truncation.packetCount).toBe(0);
    expect(truncation.buffer).toHaveLength(24);
    expect(PcapFile.isPcap(truncation.buffer)).toBe(true);
  });

  test("a limit smaller than the header, or a buffer that is not a pcap file, is nothing", () => {
    expect(
      PcapFile.truncate(makePcap({ packetLengths: [60] }), 10).buffer,
    ).toHaveLength(0);
    expect(PcapFile.truncate(Buffer.from("not a pcap"), 1000)).toEqual({
      buffer: Buffer.alloc(0),
      packetCount: 0,
    });
  });

  test("the cut is a copy: changing the original afterwards changes nothing", () => {
    const file: Buffer = makePcap({ packetLengths: [60, 60] });
    const truncation: PcapTruncation = PcapFile.truncate(
      file,
      pcapLength([60]),
    );

    file.fill(0);

    expect(PcapFile.inspect(truncation.buffer).packetCount).toBe(1);
  });
});

describe("PcapFile.decodeBase64", () => {
  test("decodes standard base64, with or without padding characters", () => {
    for (const length of [1, 2, 3, 4, 5, 6, 100, 1001]) {
      const bytes: Buffer = Buffer.alloc(length, 7);
      const decoded: Buffer | null = PcapFile.decodeBase64(
        bytes.toString("base64"),
      );

      expect(decoded).not.toBeNull();
      expect(decoded!.equals(bytes)).toBe(true);
    }
  });

  test("a whole pcap file comes back byte for byte", () => {
    const file: Buffer = makePcap({ packetLengths: [60, 1514, 98] });

    expect(PcapFile.decodeBase64(file.toString("base64"))!.equals(file)).toBe(
      true,
    );
  });

  test("anything that is not standard base64 is refused rather than half-decoded", () => {
    for (const text of [
      "",
      "=",
      "====",
      "abc",
      "abcde",
      "ab=c",
      "a===",
      "ab c",
      "ab\ncd==",
      "ab-_",
      "abc!",
      "YWJjé",
      "YW==Jj",
    ]) {
      expect(PcapFile.decodeBase64(text)).toBeNull();
    }
  });

  test("a large upload is checked without a regular expression, in good time", () => {
    const large: string = Buffer.alloc(20 * 1024 * 1024, 1).toString("base64");
    const started: number = Date.now();

    expect(PcapFile.decodeBase64(large)).toHaveLength(20 * 1024 * 1024);
    expect(Date.now() - started).toBeLessThan(5000);

    // One bad character at the very end is still found.
    expect(
      PcapFile.decodeBase64(`${large.substring(0, large.length - 4)}AA!=`),
    ).toBeNull();
  });
});
