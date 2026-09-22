import zlib from "zlib";
import ZipArchive, {
  crc32,
  DEFAULT_ZIP_LIMITS,
  normalizeZipPath,
  ZipEntry,
  ZipError,
} from "../../Utils/Books/Zip";
import { createZip, ZipFixtureEntry } from "./Helpers/ZipFixture";

/*
 * The ZIP reader treats the book's EPUB as untrusted input: it is downloaded
 * from another origin at runtime. These tests build archives byte by byte
 * (see Helpers/ZipFixture.ts), including ones that lie about their contents,
 * and pin both the happy path and every refusal.
 */

const archiveOf: (
  entries: Array<ZipFixtureEntry>,
  limits?: Partial<typeof DEFAULT_ZIP_LIMITS>,
) => ZipArchive = (
  entries: Array<ZipFixtureEntry>,
  limits: Partial<typeof DEFAULT_ZIP_LIMITS> = {},
): ZipArchive => {
  return new ZipArchive(createZip(entries), limits);
};

const expectZipError: (action: () => unknown, message: RegExp) => void = (
  action: () => unknown,
  message: RegExp,
): void => {
  let caught: unknown = null;

  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ZipError);
  expect((caught as ZipError).name).toBe("ZipError");
  expect((caught as ZipError).message).toMatch(message);
};

describe("crc32", () => {
  test("matches the standard check value for '123456789'", () => {
    expect(crc32(Buffer.from("123456789", "ascii"))).toBe(0xcbf43926);
  });

  test("is zero for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  test("matches zlib's own CRC-32 for arbitrary bytes", () => {
    const data: Buffer = Buffer.from(
      Array.from({ length: 4096 }, (_value: unknown, index: number): number => {
        return (index * 31 + 7) & 0xff;
      }),
    );
    const zlibCrc: ((data: Buffer) => number) | undefined = (
      zlib as unknown as { crc32?: (data: Buffer) => number }
    ).crc32;

    expect(crc32(data)).toBeGreaterThanOrEqual(0);
    expect(crc32(data)).toBeLessThanOrEqual(0xffffffff);

    if (zlibCrc) {
      expect(crc32(data)).toBe(zlibCrc(data));
    }
  });

  test("always returns an unsigned 32-bit value", () => {
    for (const text of ["a", "abc", "The quick brown fox", "\u00ff\u00fe"]) {
      const value: number = crc32(Buffer.from(text, "utf-8"));

      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 32);
    }
  });
});

describe("normalizeZipPath", () => {
  test.each([
    ["mimetype", "mimetype"],
    ["OEBPS/content.opf", "OEBPS/content.opf"],
    ["./OEBPS/./m/01.xhtml", "OEBPS/m/01.xhtml"],
    ["OEBPS//m///01.xhtml", "OEBPS/m/01.xhtml"],
    ["OEBPS\\m\\01.xhtml", "OEBPS/m/01.xhtml"],
    ["/OEBPS/content.opf", "OEBPS/content.opf"],
    ["OEBPS/m/../rollback.xhtml", "OEBPS/rollback.xhtml"],
    ["OEBPS/m/../../mimetype", "mimetype"],
    ["a/..", ""],
  ])("normalizes %j to %j", (input: string, expected: string) => {
    expect(normalizeZipPath(input)).toBe(expected);
  });

  test.each([
    ["../evil.txt"],
    ["OEBPS/../../evil.txt"],
    ["..\\..\\windows\\system32"],
    ["./../x"],
  ])("refuses %j, which escapes the archive root", (input: string) => {
    expect(normalizeZipPath(input)).toBeNull();
  });
});

describe("ZipArchive: reading", () => {
  const archive: ZipArchive = archiveOf([
    { name: "mimetype", data: "application/epub+zip", method: "store" },
    { name: "META-INF/container.xml", data: "<container/>" },
    {
      name: "OEBPS/m/01.xhtml",
      data: "<p>" + "Move 01. ".repeat(200) + "</p>",
    },
    { name: "OEBPS/bom.xhtml", data: "\ufeff<p>With a BOM</p>" },
    { name: "OEBPS/\u00fcnicode.xhtml", data: "<p>\u00fc</p>" },
    { name: "OEBPS/", data: "", method: "store" },
    { name: "../escape.txt", data: "outside" },
    { name: "OEBPS/../../escape2.txt", data: "outside" },
  ]);

  test("lists the file entries it can read, and nothing else", () => {
    const names: Array<string> = archive
      .list()
      .map((entry: ZipEntry): string => {
        return entry.name;
      })
      .sort();

    expect(names).toEqual(
      [
        "META-INF/container.xml",
        "OEBPS/bom.xhtml",
        "OEBPS/m/01.xhtml",
        "OEBPS/\u00fcnicode.xhtml",
        "mimetype",
      ].sort(),
    );
  });

  test("reads stored entries byte for byte", () => {
    expect(archive.read("mimetype")?.toString("utf-8")).toBe(
      "application/epub+zip",
    );
    expect(
      archive.list().find((entry: ZipEntry): boolean => {
        return entry.name === "mimetype";
      })?.compressionMethod,
    ).toBe(0);
  });

  test("inflates deflated entries", () => {
    const entry: ZipEntry | undefined = archive
      .list()
      .find((candidate: ZipEntry): boolean => {
        return candidate.name === "OEBPS/m/01.xhtml";
      });

    expect(entry?.compressionMethod).toBe(8);
    expect(entry!.compressedSize).toBeLessThan(entry!.uncompressedSize);
    expect(archive.readText("OEBPS/m/01.xhtml")).toBe(
      "<p>" + "Move 01. ".repeat(200) + "</p>",
    );
  });

  test("strips a UTF-8 byte order mark from text", () => {
    expect(archive.read("OEBPS/bom.xhtml")!.subarray(0, 3)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    );
    expect(archive.readText("OEBPS/bom.xhtml")).toBe("<p>With a BOM</p>");
  });

  test("decodes UTF-8 entry names and content", () => {
    expect(archive.has("OEBPS/\u00fcnicode.xhtml")).toBe(true);
    expect(archive.readText("OEBPS/\u00fcnicode.xhtml")).toBe("<p>\u00fc</p>");
  });

  test("looks entries up by their normalized path", () => {
    expect(archive.has("./OEBPS/m/01.xhtml")).toBe(true);
    expect(archive.has("OEBPS\\m\\01.xhtml")).toBe(true);
    expect(archive.has("/mimetype")).toBe(true);
    expect(archive.readText("OEBPS/m/../bom.xhtml")).toBe("<p>With a BOM</p>");
  });

  test("returns null for entries that do not exist", () => {
    expect(archive.has("OEBPS/missing.xhtml")).toBe(false);
    expect(archive.read("OEBPS/missing.xhtml")).toBeNull();
    expect(archive.readText("OEBPS/missing.xhtml")).toBeNull();
  });

  test("never exposes entries whose names escape the archive root", () => {
    expect(archive.has("../escape.txt")).toBe(false);
    expect(archive.read("../escape.txt")).toBeNull();
    expect(archive.has("escape.txt")).toBe(false);
    expect(archive.has("escape2.txt")).toBe(false);
  });

  test("ignores directory entries", () => {
    expect(archive.has("OEBPS")).toBe(false);
    expect(archive.read("OEBPS/")).toBeNull();
  });

  test("keeps the first of two entries with the same name", () => {
    const duplicate: ZipArchive = archiveOf([
      { name: "OEBPS/a.xhtml", data: "first" },
      { name: "OEBPS/a.xhtml", data: "second" },
      { name: "OEBPS/./a.xhtml", data: "third" },
    ]);

    expect(duplicate.list()).toHaveLength(1);
    expect(duplicate.readText("OEBPS/a.xhtml")).toBe("first");
  });

  test("reads an empty archive", () => {
    const empty: ZipArchive = archiveOf([]);

    expect(empty.list()).toEqual([]);
    expect(empty.read("anything")).toBeNull();
  });

  test("reads empty entries", () => {
    const withEmpty: ZipArchive = archiveOf([
      { name: "empty-stored", data: "", method: "store" },
      { name: "empty-deflated", data: "" },
    ]);

    expect(withEmpty.read("empty-stored")).toEqual(Buffer.alloc(0));
    expect(withEmpty.readText("empty-deflated")).toBe("");
  });

  test("finds the end of the central directory behind a trailing comment", () => {
    const commented: ZipArchive = new ZipArchive(
      createZip([{ name: "mimetype", data: "application/epub+zip" }], {
        comment: "Back to Metal, built by the typesetter",
      }),
    );

    expect(commented.readText("mimetype")).toBe("application/epub+zip");
  });

  test("finds the end of the central directory behind the longest possible comment", () => {
    const commented: ZipArchive = new ZipArchive(
      createZip([{ name: "a", data: "b" }], { comment: "x".repeat(0xffff) }),
    );

    expect(commented.readText("a")).toBe("b");
  });

  test("reads every entry of a many-entry archive", () => {
    const entries: Array<ZipFixtureEntry> = Array.from(
      { length: 150 },
      (_value: unknown, index: number): ZipFixtureEntry => {
        return {
          name: `OEBPS/s/${index}.xhtml`,
          data: `<p>${index}</p>`,
          method: index % 2 === 0 ? "store" : "deflate",
        };
      },
    );
    const many: ZipArchive = archiveOf(entries);

    expect(many.list()).toHaveLength(150);
    for (let index: number = 0; index < 150; index++) {
      expect(many.readText(`OEBPS/s/${index}.xhtml`)).toBe(`<p>${index}</p>`);
    }
  });

  test("reads the same entry repeatedly with identical results", () => {
    const first: Buffer | null = archive.read("OEBPS/m/01.xhtml");
    const second: Buffer | null = archive.read("OEBPS/m/01.xhtml");

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  test("returns copies of stored data, so callers cannot corrupt the archive", () => {
    const data: Buffer = archive.read("mimetype")!;
    data.fill(0);

    expect(archive.readText("mimetype")).toBe("application/epub+zip");
  });

  test("uses the default limits when none are given", () => {
    expect(DEFAULT_ZIP_LIMITS.maxArchiveBytes).toBeGreaterThan(1024 * 1024);
    expect(DEFAULT_ZIP_LIMITS.maxEntries).toBeGreaterThan(100);
    expect(DEFAULT_ZIP_LIMITS.maxEntryBytes).toBeGreaterThan(1024 * 1024);
  });
});

describe("ZipArchive: refusing broken or hostile archives", () => {
  test("refuses input too short to be an archive", () => {
    expectZipError(() => {
      return new ZipArchive(Buffer.alloc(10));
    }, /too short/);
    expectZipError(() => {
      return new ZipArchive(Buffer.alloc(0));
    }, /too short/);
  });

  test("refuses input without an end of central directory", () => {
    expectZipError(() => {
      return new ZipArchive(Buffer.alloc(200, 0x41));
    }, /no end of central directory/);
    expectZipError(() => {
      return new ZipArchive(Buffer.from("<html>not a zip at all</html>"));
    }, /no end of central directory/);
  });

  test("refuses an archive larger than the archive limit", () => {
    const buffer: Buffer = createZip([{ name: "a", data: "x".repeat(100) }]);

    expectZipError(() => {
      return new ZipArchive(buffer, { maxArchiveBytes: buffer.length - 1 });
    }, /above the \d+ byte limit/);
    expect(
      new ZipArchive(buffer, { maxArchiveBytes: buffer.length }).readText("a"),
    ).toBe("x".repeat(100));
  });

  test("refuses multi-disk archives", () => {
    expectZipError(() => {
      return new ZipArchive(
        createZip([{ name: "a", data: "b" }], { diskNumber: 1 }),
      );
    }, /Multi-disk/);
  });

  test("refuses ZIP64 archives", () => {
    expectZipError(() => {
      return new ZipArchive(
        createZip([{ name: "a", data: "b" }], { entryCount: 0xffff }),
      );
    }, /ZIP64/);
    expectZipError(() => {
      return new ZipArchive(
        createZip([{ name: "a", data: "b" }], {
          centralDirectoryOffset: 0xffffffff,
        }),
      );
    }, /ZIP64/);
  });

  test("refuses more entries than the entry limit", () => {
    const entries: Array<ZipFixtureEntry> = [
      { name: "a", data: "1" },
      { name: "b", data: "2" },
      { name: "c", data: "3" },
    ];

    expectZipError(() => {
      return archiveOf(entries, { maxEntries: 2 });
    }, /3 entries, above the 2 entry limit/);
    expect(archiveOf(entries, { maxEntries: 3 }).list()).toHaveLength(3);
  });

  test("refuses a central directory that lies outside the archive", () => {
    expectZipError(() => {
      return new ZipArchive(
        createZip([{ name: "a", data: "b" }], {
          centralDirectoryOffset: 1_000_000,
        }),
      );
    }, /outside the archive/);
    expectZipError(() => {
      return new ZipArchive(
        createZip([{ name: "a", data: "b" }], {
          centralDirectorySize: 1_000_000,
        }),
      );
    }, /outside the archive/);
  });

  test("refuses a central directory with fewer entries than it declares", () => {
    expectZipError(() => {
      return new ZipArchive(
        createZip(
          [
            { name: "a", data: "1" },
            { name: "b", data: "2" },
          ],
          { entryCount: 3 },
        ),
      );
    }, /truncated/);
  });

  test("refuses a central directory entry with a bad signature", () => {
    const buffer: Buffer = createZip([{ name: "a", data: "b" }]);

    // Point the directory at the local header, which has a different signature.
    expectZipError(() => {
      return new ZipArchive(
        createZip([{ name: "a", data: "b" }], {
          centralDirectoryOffset: 0,
          centralDirectorySize: 10,
        }),
      );
    }, /bad signature/);
    expect(new ZipArchive(buffer).readText("a")).toBe("b");
  });

  test("refuses a central directory entry whose name runs past the directory", () => {
    const buffer: Buffer = createZip([{ name: "long-name.xhtml", data: "b" }]);
    const endOffset: number = buffer.lastIndexOf(
      Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    );
    const directoryOffset: number = buffer.readUInt32LE(endOffset + 16);

    // Claim a 60 000 byte file name in the central directory entry.
    buffer.writeUInt16LE(60000, directoryOffset + 28);

    expectZipError(() => {
      return new ZipArchive(buffer);
    }, /truncated/);
  });

  test("refuses to read encrypted entries", () => {
    const encrypted: ZipArchive = archiveOf([
      { name: "secret", data: "hidden", flags: 0x1 },
      { name: "open", data: "visible" },
    ]);

    expect(encrypted.has("secret")).toBe(true);
    expectZipError(() => {
      return encrypted.read("secret");
    }, /encrypted/);
    expect(encrypted.readText("open")).toBe("visible");
  });

  test("refuses unsupported compression methods", () => {
    const bzip: ZipArchive = archiveOf([
      { name: "bzip", data: "data", method: "store", compressionMethod: 12 },
    ]);

    expectZipError(() => {
      return bzip.read("bzip");
    }, /unsupported compression method 12/);
  });

  test("refuses entries larger than the entry limit, before inflating them", () => {
    const large: ZipArchive = archiveOf(
      [{ name: "big", data: "x".repeat(64) }],
      {
        maxEntryBytes: 63,
      },
    );

    expectZipError(() => {
      return large.read("big");
    }, /64 bytes, above the 63 byte limit/);
    expect(
      archiveOf([{ name: "big", data: "x".repeat(64) }], {
        maxEntryBytes: 64,
      }).readText("big"),
    ).toBe("x".repeat(64));
  });

  test("refuses an entry whose local header has a bad signature", () => {
    const broken: ZipArchive = archiveOf([
      { name: "a", data: "b", localSignature: 0x12345678 },
    ]);

    expectZipError(() => {
      return broken.read("a");
    }, /bad local header/);
  });

  test("refuses an entry whose local header lies beyond the archive", () => {
    const broken: ZipArchive = archiveOf([
      { name: "a", data: "b", localHeaderOffset: 0x7fffffff },
    ]);

    expectZipError(() => {
      return broken.read("a");
    }, /no local header/);
  });

  test("refuses an entry whose data is truncated", () => {
    const truncated: ZipArchive = archiveOf([
      { name: "a", data: "short", method: "store", compressedSize: 100_000 },
    ]);

    expectZipError(() => {
      return truncated.read("a");
    }, /truncated/);
  });

  test("refuses an entry that fails its CRC-32 check", () => {
    const stored: ZipArchive = archiveOf([
      { name: "a", data: "payload", method: "store", crc32: 0xdeadbeef },
    ]);
    const deflated: ZipArchive = archiveOf([
      { name: "b", data: "payload", crc32: 1 },
    ]);

    expectZipError(() => {
      return stored.read("a");
    }, /CRC-32/);
    expectZipError(() => {
      return deflated.read("b");
    }, /CRC-32/);
  });

  test("refuses a zip bomb: a tiny declared size over a huge deflated payload", () => {
    const payload: Buffer = Buffer.alloc(8 * 1024 * 1024, 0x41);
    const bomb: ZipArchive = archiveOf([
      { name: "bomb.xhtml", data: payload, uncompressedSize: 100 },
    ]);
    const started: number = Date.now();

    expectZipError(() => {
      return bomb.read("bomb.xhtml");
    }, /could not be inflated|wrong size/);
    // Inflation stops at the declared size instead of expanding the whole payload.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("refuses a deflated entry whose data is one byte longer than declared", () => {
    const understated: ZipArchive = archiveOf([
      { name: "a", data: "0123456789", uncompressedSize: 9 },
    ]);

    expectZipError(() => {
      return understated.read("a");
    }, /wrong size|could not be inflated/);
  });

  test("refuses entries whose declared size is larger than their data", () => {
    const stored: ZipArchive = archiveOf([
      { name: "a", data: "0123456789", method: "store", uncompressedSize: 20 },
    ]);
    const deflated: ZipArchive = archiveOf([
      { name: "b", data: "0123456789", uncompressedSize: 20 },
    ]);

    expectZipError(() => {
      return stored.read("a");
    }, /wrong size/);
    expectZipError(() => {
      return deflated.read("b");
    }, /wrong size/);
  });

  test("refuses a stored entry whose declared size is smaller than its data", () => {
    const stored: ZipArchive = archiveOf([
      { name: "a", data: "0123456789", method: "store", uncompressedSize: 5 },
    ]);

    expectZipError(() => {
      return stored.read("a");
    }, /wrong size/);
  });

  test("refuses deflate data that is not valid deflate", () => {
    const garbage: Buffer = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const corrupt: ZipArchive = archiveOf([
      {
        name: "a",
        data: garbage,
        method: "store",
        compressionMethod: 8,
        uncompressedSize: 50,
      },
    ]);

    expectZipError(() => {
      return corrupt.read("a");
    }, /could not be inflated|wrong size/);
  });

  test("a broken entry does not stop the others being read", () => {
    const mixed: ZipArchive = archiveOf([
      { name: "bad", data: "x", crc32: 7 },
      { name: "good", data: "fine" },
    ]);

    expect(() => {
      return mixed.read("bad");
    }).toThrow(ZipError);
    expect(mixed.readText("good")).toBe("fine");
  });
});
