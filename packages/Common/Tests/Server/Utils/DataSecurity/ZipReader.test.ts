import { describe, expect, test } from "@jest/globals";
import zlib from "zlib";
import ZipReader, {
  DEFAULT_ZIP_LIMITS,
  ZipEntry,
  ZipEntryData,
  ZipError,
} from "../../../../Server/Utils/DataSecurity/Content/ZipReader";
import { buildZip } from "./ZipFixture";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * A ZIP READER THAT TRUSTS NOTHING IT IS GIVEN.
 *
 * It reads stored and deflated entries from the central directory, or from
 * the local headers when the bytes are only an archive's start; it never
 * reads past the bytes it is given; and it refuses the archives built to
 * hurt a reader - too many entries, an entry that inflates past what it
 * declares or claims a ratio deflate cannot reach, entries that share
 * their data - while a large but honest entry is read in part, within the
 * limits, quickly.
 */

function text(data: ZipEntryData): string {
  return Buffer.from(data.data).toString("utf8");
}

function refusal(work: () => unknown): ZipError {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(ZipError);
    return error as ZipError;
  }

  throw new Error("Expected a ZipError.");
}

describe("an archive with its central directory", () => {
  const archive: Buffer = buildZip([
    { name: "stored.txt", data: "stored as it is", method: "store" },
    { name: "deflated.xml", data: "<a>" + "deflated ".repeat(100) + "</a>" },
    { name: "folder/ünïcode.txt", data: "a name in UTF-8" },
  ]);

  test("lists every entry, with its name and sizes", () => {
    const zip: ZipReader = ZipReader.open(archive);

    expect(zip.isTruncated).toBe(false);
    expect(
      zip.entries.map((entry: ZipEntry) => {
        return entry.name;
      }),
    ).toEqual(["stored.txt", "deflated.xml", "folder/ünïcode.txt"]);
    expect(zip.find("deflated.xml")?.uncompressedSize).toBe(907);
  });

  test("reads stored and deflated entries whole", () => {
    const zip: ZipReader = ZipReader.open(archive);

    expect(text(zip.read(zip.find("stored.txt")!))).toBe("stored as it is");
    expect(zip.readText("deflated.xml")).toEqual({
      text: "<a>" + "deflated ".repeat(100) + "</a>",
      isPartial: false,
    });
    expect(zip.readText("folder/ünïcode.txt")?.text).toBe("a name in UTF-8");
    expect(zip.readText("missing.txt")).toBeNull();
  });

  test("knows a ZIP archive by its first bytes, and refuses what is not one", () => {
    expect(ZipReader.isZip(archive)).toBe(true);
    expect(ZipReader.isZip(Buffer.from("PK"))).toBe(false);
    expect(ZipReader.isZip(Buffer.from("name,email\n"))).toBe(false);
    expect(
      refusal(() => {
        return ZipReader.open(Buffer.from("not an archive"));
      }).isZipBomb,
    ).toBe(false);
  });
});

describe("an archive cut short: only its first bytes were read", () => {
  test("is read from its local headers, as far as they go", () => {
    const whole: Buffer = buildZip([
      { name: "[Content_Types].xml", data: "<Types/>" },
      { name: "word/document.xml", data: "<w:t>Hello</w:t>".repeat(50) },
      {
        name: "word/media/image1.png",
        data: Buffer.alloc(50_000, 7),
        method: "store",
      },
    ]);
    const start: Buffer = whole.subarray(0, whole.length - 30_000);
    const zip: ZipReader = ZipReader.open(start);

    expect(zip.isTruncated).toBe(true);
    expect(zip.readText("word/document.xml")?.text).toBe(
      "<w:t>Hello</w:t>".repeat(50),
    );
  });

  test("measures an entry whose sizes only its data descriptor says", () => {
    const zip: ZipReader = ZipReader.open(
      buildZip(
        [
          {
            name: "first.xml",
            data: "first ".repeat(200),
            dataDescriptor: true,
          },
          {
            name: "second.xml",
            data: "second ".repeat(200),
            dataDescriptor: true,
          },
        ],
        { omitCentralDirectory: true },
      ),
    );

    expect(zip.isTruncated).toBe(true);
    expect(zip.readText("first.xml")?.text).toBe("first ".repeat(200));
    expect(zip.readText("second.xml")?.text).toBe("second ".repeat(200));
  });

  test("reads the start of an entry the bytes end inside, and never past them", () => {
    const content: string = "row of the sheet\n".repeat(2000);
    const whole: Buffer = buildZip([
      { name: "big.txt", data: content, method: "store" },
    ]);
    const start: Buffer = whole.subarray(0, 4000);
    const zip: ZipReader = ZipReader.open(start);
    const read: ZipEntryData = zip.read(zip.find("big.txt")!);

    expect(read.isPartial).toBe(true);
    expect(read.data.length).toBeLessThan(4000);
    expect(content.startsWith(text(read))).toBe(true);
  });
});

describe("zip bombs", () => {
  test("an entry that inflates past the size it declares is refused", () => {
    const zip: ZipReader = ZipReader.open(
      buildZip([
        {
          name: "word/document.xml",
          data: Buffer.alloc(2 * 1024 * 1024, 0x41),
          declaredUncompressedSize: 1000,
        },
      ]),
    );
    const error: ZipError = refusal(() => {
      return zip.read(zip.entries[0]!);
    });

    expect(error.isZipBomb).toBe(true);
    expect(error.message).toContain("inflates past");
  });

  test("an archive listing more entries than a scan reads is refused", () => {
    const error: ZipError = refusal(() => {
      return ZipReader.open(
        buildZip([{ name: "a.txt", data: "a" }], {
          declaredEntryCount: 60_000,
        }),
      );
    });

    expect(error.isZipBomb).toBe(true);
    expect(error.message).toContain("60000 entries");
  });

  test("entries that share their data are refused", () => {
    const zip: ZipReader = ZipReader.open(
      buildZip(
        [
          { name: "one.xml", data: "x".repeat(10_000) },
          { name: "two.xml", data: "x".repeat(10_000) },
        ],
        { shareFirstLocalHeader: true },
      ),
    );

    zip.read(zip.entries[0]!);

    expect(
      refusal(() => {
        return zip.read(zip.entries[1]!);
      }).isZipBomb,
    ).toBe(true);
  });

  test("an entry that claims more than deflate can inflate is refused", () => {
    const zip: ZipReader = ZipReader.open(
      buildZip([
        {
          name: "claims.xml",
          data: "tiny",
          declaredUncompressedSize: 4_000_000_000,
        },
      ]),
    );

    expect(
      refusal(() => {
        return zip.read(zip.entries[0]!);
      }).isZipBomb,
    ).toBe(true);
  });

  test("an honest entry of 64 MB of zeros is read in part, within the limit, quickly", () => {
    const zeros: Buffer = Buffer.alloc(64 * 1024 * 1024);
    const deflated: Buffer = zlib.deflateRawSync(zeros);
    const archive: Buffer = buildZip([
      { name: "xl/worksheets/sheet1.xml", data: zeros },
    ]);

    /*
     * A reader reads an entry once (a second read of the same data is how
     * a bomb shares it), so each attempt opens the archive again.
     */
    const timed: FastestRun<ZipEntryData> = fastestRun({
      run: (): ZipEntryData => {
        const zip: ZipReader = ZipReader.open(archive);

        return zip.read(zip.entries[0]!);
      },
      limitInMs: 5000,
    });
    const read: ZipEntryData = timed.result;

    expect(deflated.length).toBeLessThan(100_000);
    expect(read.isPartial).toBe(true);
    expect(read.data.length).toBeGreaterThan(0);
    expect(read.data.length).toBeLessThanOrEqual(
      DEFAULT_ZIP_LIMITS.maxEntryBytes,
    );
    expect(timed.inMs).toBeLessThan(5000);
  });

  test("the entries read together inflate to no more than maxTotalBytes", () => {
    const zip: ZipReader = ZipReader.open(
      buildZip([
        { name: "one.xml", data: "1".repeat(6000) },
        { name: "two.xml", data: "2".repeat(6000) },
      ]),
      { maxEntryBytes: 5000, maxTotalBytes: 8000 },
    );
    const first: ZipEntryData = zip.read(zip.entries[0]!);
    const second: ZipEntryData = zip.read(zip.entries[1]!);

    expect(first.isPartial).toBe(true);
    expect(first.data.length).toBeLessThanOrEqual(5000);
    expect(first.data.length + second.data.length).toBeLessThanOrEqual(8000);
    expect(second.isPartial).toBe(true);
  });
});

describe("entries a scan cannot read", () => {
  test("an encrypted entry, and one of a method other than store or deflate, are refused", () => {
    const zip: ZipReader = ZipReader.open(
      buildZip([
        { name: "secret.txt", data: "x", flags: 0x1 },
        { name: "bzip2.txt", data: "y", method: "store", methodNumber: 12 },
      ]),
    );

    expect(
      refusal(() => {
        return zip.read(zip.entries[0]!);
      }).message,
    ).toContain("encrypted");
    expect(
      refusal(() => {
        return zip.read(zip.entries[1]!);
      }).message,
    ).toContain("method 12");
  });
});
