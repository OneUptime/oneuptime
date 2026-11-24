import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_MAX_ZIP_ENTRY_BYTES,
  DEFAULT_MAX_ZIP_TOTAL_BYTES,
  MAX_ZIP_ENTRIES,
  ZipEntry,
  readZipEntries,
} from "../../../../../Server/Utils/Telemetry/AppleDebugSymbols/ZipArchive";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";
import {
  APP_UUID,
  CPU_TYPE_ARM64,
  ZipFixtureEntry,
  ZipLayout,
  buildAppMachO,
  buildTinyMachO,
  buildZip,
  buildZipLayout,
  writeUInt16,
  writeUInt32,
  writeUInt64,
  zip64Field,
} from "./MachOFixtures";

/*
 * A ZIP READER FOR THE dSYMs TEAMS UPLOAD, WHICH TRUSTS NOTHING IN THEM.
 *
 * readZipEntries lists an archive's files from its central directory -
 * ZIP64 too - and reads each only when asked: stored or deflated, its size
 * and checksum checked. An entry that says, or turns out, to be larger than
 * the limit is refused without inflating more than the limit; reads stop
 * once they add up to the total; and an archive that is cut short, corrupt
 * or not one at all is refused with a sentence, never read past its end.
 */

const MEBIBYTE: number = 1024 * 1024;

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "utf8",
  );
}

function namesOf(entries: Array<ZipEntry>): Array<string> {
  return entries.map((entry: ZipEntry): string => {
    return entry.name;
  });
}

function entryNamed(entries: Array<ZipEntry>, name: string): ZipEntry {
  const entry: ZipEntry | undefined = entries.find(
    (candidate: ZipEntry): boolean => {
      return candidate.name === name;
    },
  );

  if (!entry) {
    throw new Error(`The archive has no entry named ${name}.`);
  }

  return entry;
}

function errorOf(work: () => unknown): Error {
  try {
    work();
  } catch (error: unknown) {
    return error as Error;
  }

  throw new Error("Expected the work to throw.");
}

function readError(entry: ZipEntry): string {
  return errorOf((): unknown => {
    return entry.read();
  }).message;
}

function listError(bytes: Uint8Array): string {
  return errorOf((): unknown => {
    return readZipEntries(bytes);
  }).message;
}

function randomBytes(seed: number, length: number): Buffer {
  const random: SeededRandom = seededRandom(seed);
  const bytes: Buffer = Buffer.alloc(length);

  for (let index: number = 0; index < length; index++) {
    bytes[index] = random(256);
  }

  return bytes;
}

function only(bytes: Uint8Array): ZipEntry {
  const entries: Array<ZipEntry> = readZipEntries(bytes);

  expect(entries).toHaveLength(1);

  return entries[0]!;
}

const DWARF_NAME: string = "MyApp.app.dSYM/Contents/Resources/DWARF/MyApp";
const PLIST: string =
  '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict/></plist>';

describe("an archive's entries", () => {
  const dwarf: Buffer = buildAppMachO({ uuid: APP_UUID });
  const archive: Buffer = buildZip([
    { name: "MyApp.app.dSYM/" },
    { name: "MyApp.app.dSYM/Contents/" },
    {
      name: "MyApp.app.dSYM/Contents/Info.plist",
      data: PLIST,
      method: "store",
    },
    { name: DWARF_NAME, data: dwarf },
    { name: "Empty/" },
    { name: "notes.txt", data: "Built by CI run 2189.\n", method: "store" },
  ]);

  test("lists its files in order with their sizes, and leaves folders out", () => {
    const entries: Array<ZipEntry> = readZipEntries(archive);

    expect(namesOf(entries)).toEqual([
      "MyApp.app.dSYM/Contents/Info.plist",
      DWARF_NAME,
      "notes.txt",
    ]);
    expect(
      entries.map((entry: ZipEntry): number => {
        return entry.uncompressedSize;
      }),
    ).toEqual([PLIST.length, dwarf.length, 22]);
  });

  test("reads a stored entry as it is and a deflated one inflated", () => {
    const entries: Array<ZipEntry> = readZipEntries(archive);

    expect(
      text(entryNamed(entries, "MyApp.app.dSYM/Contents/Info.plist").read()),
    ).toBe(PLIST);
    expect(
      Buffer.from(entryNamed(entries, DWARF_NAME).read()).equals(dwarf),
    ).toBe(true);
    expect(text(entryNamed(entries, "notes.txt").read())).toBe(
      "Built by CI run 2189.\n",
    );
  });

  test("inflates nothing until read() is called, and reads afresh on each call", () => {
    const entries: Array<ZipEntry> = readZipEntries(
      buildZip([
        { name: "good.txt", data: "good" },
        {
          name: "broken.bin",
          data: "x",
          method: "store",
          methodNumber: 8,
          declaredUncompressedSize: 50,
        },
      ]),
    );

    expect(namesOf(entries)).toEqual(["good.txt", "broken.bin"]);
    expect(text(entries[0]!.read())).toBe("good");
    expect(readError(entries[1]!)).toBe(
      "This zip file is corrupt: broken.bin cannot be inflated.",
    );
    expect(text(entries[0]!.read())).toBe("good");
  });

  test("an empty archive, only an end record, has no entries", () => {
    const empty: Buffer = buildZip([]);

    expect(empty).toHaveLength(22);
    expect(readZipEntries(empty)).toEqual([]);
  });

  test("an empty file, stored or deflated, reads as no bytes", () => {
    const entries: Array<ZipEntry> = readZipEntries(
      buildZip([
        { name: "stored-empty", data: "", method: "store" },
        { name: "deflated-empty", data: "" },
      ]),
    );

    expect(entries[0]!.read()).toHaveLength(0);
    expect(entries[1]!.read()).toHaveLength(0);
  });

  test("a large entry of bytes that do not compress reads whole", () => {
    const large: Buffer = randomBytes(9923, 3 * MEBIBYTE);
    const entry: ZipEntry = only(
      buildZip([{ name: "large.bin", data: large }]),
    );

    expect(entry.uncompressedSize).toBe(large.length);
    expect(Buffer.from(entry.read()).equals(large)).toBe(true);
  });

  test("a stored entry is read in place: a view of the archive's bytes, left as they were", () => {
    const stored: Buffer = buildZip([
      { name: "stored.bin", data: dwarf, method: "store" },
    ]);
    const before: Buffer = Buffer.from(stored);
    const read: Uint8Array = only(stored).read();

    expect(read.buffer).toBe(stored.buffer);
    expect(stored.equals(before)).toBe(true);
  });

  test("an archive in the middle of a larger buffer reads as it does alone", () => {
    const larger: Buffer = Buffer.concat([
      Buffer.alloc(7, 0x50),
      archive,
      Buffer.from("PK\x05\x06 not part of this archive", "latin1"),
    ]);
    const entries: Array<ZipEntry> = readZipEntries(
      larger.subarray(7, 7 + archive.length),
    );

    expect(namesOf(entries)).toEqual(namesOf(readZipEntries(archive)));
    expect(
      Buffer.from(entryNamed(entries, DWARF_NAME).read()).equals(dwarf),
    ).toBe(true);
  });

  test("a plain Uint8Array, not a Buffer, reads the same", () => {
    const plain: Uint8Array = new Uint8Array(archive.length);

    plain.set(archive);

    const entries: Array<ZipEntry> = readZipEntries(plain);

    expect(Buffer.isBuffer(plain)).toBe(false);
    expect(namesOf(entries)).toEqual(namesOf(readZipEntries(archive)));
    expect(
      Buffer.from(entryNamed(entries, DWARF_NAME).read()).equals(dwarf),
    ).toBe(true);
    expect(text(entryNamed(entries, "notes.txt").read())).toBe(
      "Built by CI run 2189.\n",
    );
  });

  test("hundreds of entries are all listed", () => {
    const many: Array<ZipFixtureEntry> = [];

    for (let index: number = 0; index < 300; index++) {
      many.push({
        name: `Frameworks/F${index}.txt`,
        data: `framework ${index}`,
      });
    }

    const entries: Array<ZipEntry> = readZipEntries(buildZip(many));

    expect(entries).toHaveLength(300);
    expect(text(entries[299]!.read())).toBe("framework 299");
  });

  test("an entry whose sizes are only in a data descriptor reads from the central directory's", () => {
    const layout: ZipLayout = buildZipLayout([
      {
        name: "streamed.txt",
        data: "written by a streaming zipper",
        flags: 0x0008,
      },
    ]);

    // The local header's CRC and sizes, zero as a streaming writer leaves them.
    layout.bytes.fill(
      0,
      layout.localHeaderOffsets[0]! + 14,
      layout.localHeaderOffsets[0]! + 26,
    );

    expect(text(only(layout.bytes).read())).toBe(
      "written by a streaming zipper",
    );
  });

  test("a local header's own extra fields are skipped, however long", () => {
    // An extended timestamp field (0x5455) in the local header only.
    const timestamp: Buffer = Buffer.from([
      0x55, 0x54, 0x09, 0x00, 0x03, 0x10, 0x20, 0x30, 0x40, 0x10, 0x20, 0x30,
      0x40,
    ]);

    expect(
      text(
        only(
          buildZip([
            {
              name: "dated.txt",
              data: "dated",
              method: "store",
              localExtra: timestamp,
            },
          ]),
        ).read(),
      ),
    ).toBe("dated");
    expect(
      text(
        only(
          buildZip([
            { name: "dated.txt", data: "dated", localExtra: timestamp },
          ]),
        ).read(),
      ),
    ).toBe("dated");
  });
});

describe("entry names", () => {
  test("a name flagged as UTF-8 reads as UTF-8", () => {
    const name: string = "Café.app.dSYM/Contents/Resources/DWARF/Café";

    expect(only(buildZip([{ name, data: "x" }])).name).toBe(name);
  });

  test("a UTF-8 name without the flag, as macOS's zip writes it, reads as UTF-8 too", () => {
    const name: string = "Ünïcode.app.dSYM/Contents/Resources/DWARF/Ünïcode";

    expect(
      only(buildZip([{ name, data: "x", withoutUtf8Flag: true }])).name,
    ).toBe(name);
  });

  test("a name that is not UTF-8 reads as Latin-1", () => {
    const entry: ZipEntry = only(
      buildZip([
        {
          name: "",
          nameBytes: Buffer.from([
            0x63, 0x61, 0x66, 0xe9, 0x2e, 0x74, 0x78, 0x74,
          ]),
          data: "x",
          withoutUtf8Flag: true,
        },
      ]),
    );

    expect(entry.name).toBe("café.txt");
  });

  test("a name is kept as the archive writes it, backslashes and all", () => {
    const name: string = "MyApp.app.dSYM\\Contents\\Resources\\DWARF\\MyApp";

    expect(only(buildZip([{ name, data: "x" }])).name).toBe(name);
  });
});

describe("finding the central directory", () => {
  const entries: Array<ZipFixtureEntry> = [
    { name: "a.txt", data: "first" },
    { name: "b.txt", data: "second", method: "store" },
  ];

  test("past a comment at the end of the archive", () => {
    expect(
      namesOf(
        readZipEntries(
          buildZip(entries, { comment: "Archived by Xcode 16.2" }),
        ),
      ),
    ).toEqual(["a.txt", "b.txt"]);
  });

  test("past the longest comment there can be, 65,535 bytes", () => {
    const archive: Buffer = buildZip(entries, {
      comment: Buffer.alloc(65_535, 0x2e),
    });

    expect(namesOf(readZipEntries(archive))).toEqual(["a.txt", "b.txt"]);
  });

  test("a signature inside the comment is not taken for the end record", () => {
    const comment: Buffer = Buffer.concat([
      Buffer.from("PK\x05\x06", "latin1"),
      Buffer.alloc(18, 0x11),
      Buffer.from(" and more after it"),
    ]);
    const archive: Buffer = buildZip(entries, { comment });

    expect(namesOf(readZipEntries(archive))).toEqual(["a.txt", "b.txt"]);
    expect(text(readZipEntries(archive)[1]!.read())).toBe("second");
  });

  test("bytes after the archive are tolerated, within the reach of a comment", () => {
    const archive: Buffer = Buffer.concat([
      buildZip(entries),
      Buffer.alloc(100, 0x20),
    ]);

    expect(namesOf(readZipEntries(archive))).toEqual(["a.txt", "b.txt"]);
  });

  test("an end record further back than the longest comment reaches is not found", () => {
    const archive: Buffer = Buffer.concat([
      buildZip(entries),
      Buffer.alloc(65_536, 0x20),
    ]);

    expect(listError(archive)).toBe("This file is not a zip file.");
  });
});

describe("ZIP64 archives", () => {
  const dwarf: Buffer = buildAppMachO({ uuid: APP_UUID });

  test("reads entries whose sizes and offsets are in ZIP64 extra fields", () => {
    const layout: ZipLayout = buildZipLayout(
      [
        { name: "big/", data: undefined },
        { name: DWARF_NAME, data: dwarf },
        {
          name: "stored.txt",
          data: "stored in a ZIP64 archive",
          method: "store",
        },
      ],
      { zip64: true },
    );
    const entries: Array<ZipEntry> = readZipEntries(layout.bytes);

    expect(layout.zip64EndOffset).toBeGreaterThan(0);
    expect(layout.bytes.readUInt32LE(layout.endOffset + 16)).toBe(0xffffffff);
    expect(namesOf(entries)).toEqual([DWARF_NAME, "stored.txt"]);
    expect(entries[0]!.uncompressedSize).toBe(dwarf.length);
    expect(Buffer.from(entries[0]!.read()).equals(dwarf)).toBe(true);
    expect(text(entries[1]!.read())).toBe("stored in a ZIP64 archive");
  });

  test("a ZIP64 field after another extra field, holding only what its entry marks", () => {
    const data: string = "the offset alone is in the ZIP64 field";
    const timestamp: Buffer = Buffer.from([
      0x55, 0x54, 0x05, 0x00, 0x01, 0x10, 0x20, 0x30, 0x40,
    ]);
    const layout: ZipLayout = buildZipLayout([
      {
        name: "first.txt",
        data: "first",
        method: "store",
      },
      {
        name: "marked.txt",
        data,
        method: "store",
        centralExtra: Buffer.concat([timestamp, zip64Field([0])]),
      },
    ]);
    const central: number = layout.centralHeaderOffsets[1]!;
    const field: number = central + 46 + "marked.txt".length + timestamp.length;

    // The local header offset moves into the field: 0xffffffff in the entry.
    writeUInt64(layout.bytes, field + 4, layout.localHeaderOffsets[1]!, false);
    writeUInt32(layout.bytes, central + 42, 0xffffffff, false);

    expect(text(readZipEntries(layout.bytes)[1]!.read())).toBe(data);

    // The sizes too: in the order uncompressed, compressed, offset.
    const all: ZipLayout = buildZipLayout([
      {
        name: "all.txt",
        data,
        method: "store",
        centralExtra: Buffer.concat([
          timestamp,
          zip64Field([data.length, data.length, 0]),
        ]),
      },
    ]);
    const allCentral: number = all.centralHeaderOffsets[0]!;

    writeUInt32(all.bytes, allCentral + 20, 0xffffffff, false);
    writeUInt32(all.bytes, allCentral + 24, 0xffffffff, false);
    writeUInt32(all.bytes, allCentral + 42, 0xffffffff, false);

    expect(only(all.bytes).uncompressedSize).toBe(data.length);
    expect(text(only(all.bytes).read())).toBe(data);
  });

  test("a locator that points at no ZIP64 end record is corrupt", () => {
    const layout: ZipLayout = buildZipLayout([{ name: "a.txt", data: "a" }], {
      zip64: true,
    });
    const elsewhere: Buffer = Buffer.from(layout.bytes);
    const outside: Buffer = Buffer.from(layout.bytes);

    writeUInt64(elsewhere, layout.zip64LocatorOffset + 8, 0, false);
    writeUInt64(outside, layout.zip64LocatorOffset + 8, 0xffffffffff, false);

    for (const bytes of [elsewhere, outside]) {
      expect(listError(bytes)).toBe(
        "This zip file is corrupt: its ZIP64 end of central directory record is missing.",
      );
    }
  });

  test("an entry marked 0xffffffff without the field it needs is corrupt", () => {
    const withoutField: ZipLayout = buildZipLayout([
      { name: "a.txt", data: "a" },
    ]);

    writeUInt32(
      withoutField.bytes,
      withoutField.centralHeaderOffsets[0]! + 24,
      0xffffffff,
      false,
    );

    const tooShort: ZipLayout = buildZipLayout([
      { name: "a.txt", data: "a", centralExtra: zip64Field([1]) },
    ]);

    writeUInt32(
      tooShort.bytes,
      tooShort.centralHeaderOffsets[0]! + 20,
      0xffffffff,
      false,
    );
    writeUInt32(
      tooShort.bytes,
      tooShort.centralHeaderOffsets[0]! + 24,
      0xffffffff,
      false,
    );

    const runsOver: ZipLayout = buildZipLayout([
      { name: "a.txt", data: "a", centralExtra: zip64Field([1]) },
    ]);
    const extra: number = runsOver.centralHeaderOffsets[0]! + 46 + 5;

    writeUInt16(runsOver.bytes, extra + 2, 200, false);
    writeUInt32(
      runsOver.bytes,
      runsOver.centralHeaderOffsets[0]! + 24,
      0xffffffff,
      false,
    );

    for (const bytes of [withoutField.bytes, tooShort.bytes, runsOver.bytes]) {
      expect(listError(bytes)).toBe(
        "This zip file is corrupt: a.txt is missing the ZIP64 sizes its entry needs.",
      );
    }
  });

  test(`an archive that lists more than ${MAX_ZIP_ENTRIES} entries is refused`, () => {
    const layout: ZipLayout = buildZipLayout([{ name: "a.txt", data: "a" }], {
      zip64: true,
    });

    writeUInt64(layout.bytes, layout.zip64EndOffset + 32, 2_000_000, false);
    expect(listError(layout.bytes)).toBe(
      "This zip file lists 2000000 entries, more than the 1000000 OneUptime reads.",
    );

    writeUInt64(
      layout.bytes,
      layout.zip64EndOffset + 32,
      0xffffffffffff,
      false,
    );
    expect(listError(layout.bytes)).toBe(
      `This zip file lists ${0xffffffffffff} entries, more than the 1000000 OneUptime reads.`,
    );
  });
});

describe("limits", () => {
  test("the defaults are 512 MiB an entry and 2 GiB for all reads together", () => {
    expect(DEFAULT_MAX_ZIP_ENTRY_BYTES).toBe(512 * MEBIBYTE);
    expect(DEFAULT_MAX_ZIP_TOTAL_BYTES).toBe(2048 * MEBIBYTE);
  });

  test("an entry that says it is larger than an entry may be is refused before it is inflated", () => {
    const entry: ZipEntry = only(
      buildZip([
        {
          name: "huge.bin",
          data: "tiny",
          declaredUncompressedSize: 600 * MEBIBYTE,
        },
      ]),
    );

    expect(entry.uncompressedSize).toBe(600 * MEBIBYTE);
    expect(readError(entry)).toBe(
      "huge.bin is 629145600 bytes uncompressed, more than the 536870912 OneUptime reads from one zip entry.",
    );
  });

  test("an entry of exactly maxEntryBytes is read, and one byte more is refused", () => {
    const limit: number = 64 * 1024;

    for (const method of ["store", "deflate"] as Array<"store" | "deflate">) {
      const entries: Array<ZipEntry> = readZipEntries(
        buildZip([
          { name: "fits.bin", data: Buffer.alloc(limit, 1), method },
          { name: "over.bin", data: Buffer.alloc(limit + 1, 1), method },
        ]),
        { maxEntryBytes: limit },
      );

      expect(entries[0]!.read()).toHaveLength(limit);
      expect(readError(entries[1]!)).toBe(
        `over.bin is ${limit + 1} bytes uncompressed, more than the ${limit} OneUptime reads from one zip entry.`,
      );
    }
  });

  test("a deflate bomb that says how large it is, is refused by its size", () => {
    const zeros: Buffer = Buffer.alloc(16 * MEBIBYTE);
    const archive: Buffer = buildZip([{ name: "bomb.bin", data: zeros }]);

    expect(archive.length).toBeLessThan(64 * 1024);
    expect(
      readError(readZipEntries(archive, { maxEntryBytes: MEBIBYTE })[0]!),
    ).toBe(
      "bomb.bin is 16777216 bytes uncompressed, more than the 1048576 OneUptime reads from one zip entry.",
    );
  });

  test("a deflate bomb that lies about its size stops inflating at the size it gives", () => {
    for (const size of [16 * MEBIBYTE, 64 * MEBIBYTE]) {
      const archive: Buffer = buildZip([
        {
          name: "bomb.bin",
          data: Buffer.alloc(size),
          declaredUncompressedSize: 1024,
        },
      ]);

      expect(readError(only(archive))).toBe(
        "bomb.bin inflates past the 1024 bytes it says it holds: the zip file is corrupt or a zip bomb.",
      );
    }

    const saysNothing: Buffer = buildZip([
      {
        name: "bomb.bin",
        data: Buffer.alloc(MEBIBYTE),
        declaredUncompressedSize: 0,
      },
    ]);

    expect(readError(only(saysNothing))).toBe(
      "bomb.bin inflates past the 0 bytes it says it holds: the zip file is corrupt or a zip bomb.",
    );
  });

  test("reads stop once they add up to maxTotalBytes, and a refused read takes nothing", () => {
    const part: Buffer = Buffer.alloc(400_000, 7);
    const entries: Array<ZipEntry> = readZipEntries(
      buildZip([
        { name: "one.bin", data: part },
        { name: "two.bin", data: part, method: "store" },
        { name: "three.bin", data: part },
        { name: "small.txt", data: "small" },
      ]),
      { maxTotalBytes: 1_000_000 },
    );
    const refusal: (name: string) => string = (name: string): string => {
      return `${name} would take this zip file past 1000000 bytes uncompressed, more than OneUptime reads from one zip file.`;
    };

    expect(entries[0]!.read()).toHaveLength(400_000);
    expect(entries[1]!.read()).toHaveLength(400_000);
    expect(readError(entries[2]!)).toBe(refusal("three.bin"));
    // Reading one again counts again.
    expect(readError(entries[0]!)).toBe(refusal("one.bin"));
    // What was refused took nothing: 800,005 bytes fit.
    expect(text(entries[3]!.read())).toBe("small");
  });

  test("each listing counts its own reads", () => {
    const archive: Buffer = buildZip([
      { name: "one.bin", data: Buffer.alloc(600_000) },
    ]);

    for (let listing: number = 0; listing < 3; listing++) {
      expect(
        readZipEntries(archive, { maxTotalBytes: 1_000_000 })[0]!.read(),
      ).toHaveLength(600_000);
    }
  });

  test("limits that are not numbers of bytes are the defaults", () => {
    const archive: Buffer = buildZip([{ name: "a.txt", data: "abc" }]);

    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        text(
          readZipEntries(archive, {
            maxEntryBytes: value,
            maxTotalBytes: value,
          })[0]!.read(),
        ),
      ).toBe("abc");
    }

    expect(readError(readZipEntries(archive, { maxEntryBytes: 0 })[0]!)).toBe(
      "a.txt is 3 bytes uncompressed, more than the 0 OneUptime reads from one zip entry.",
    );
  });
});

describe("entries OneUptime cannot read", () => {
  test("an encrypted entry is listed, and refused when read", () => {
    const entries: Array<ZipEntry> = readZipEntries(
      buildZip([
        { name: "secret.bin", data: "ciphertext", flags: 0x0001 },
        { name: "plain.txt", data: "plain" },
      ]),
    );

    expect(namesOf(entries)).toEqual(["secret.bin", "plain.txt"]);
    expect(readError(entries[0]!)).toBe(
      "secret.bin is encrypted; OneUptime reads only zip files without a password.",
    );
    expect(text(entries[1]!.read())).toBe("plain");
  });

  test("an entry compressed some other way is refused, by its method", () => {
    // bzip2, LZMA, Zstandard, XZ, PPMd and WinZip's AES.
    for (const method of [12, 14, 93, 95, 98, 99]) {
      const entry: ZipEntry = only(
        buildZip([
          {
            name: "packed.bin",
            data: "packed",
            method: "store",
            methodNumber: method,
          },
        ]),
      );

      expect(readError(entry)).toBe(
        `packed.bin is compressed with method ${method}; OneUptime reads only stored and deflated zip entries.`,
      );
    }
  });
});

describe("bytes that are not a zip file, or a corrupt one", () => {
  const archive: ZipLayout = buildZipLayout([
    { name: "first.txt", data: "first", method: "store" },
    { name: "second.txt", data: "second entry, deflated" },
  ]);

  const broken: (change: (bytes: Buffer) => void) => Buffer = (
    change: (bytes: Buffer) => void,
  ): Buffer => {
    const bytes: Buffer = Buffer.from(archive.bytes);

    change(bytes);

    return bytes;
  };

  test("bytes with no end of central directory record are not a zip file", () => {
    const notZips: Array<Uint8Array> = [
      new Uint8Array(0),
      Buffer.from("PK"),
      Buffer.from("PK\x05\x06", "latin1"),
      Buffer.from("name,email\nada,ada@example.com\n"),
      buildTinyMachO({ cpuType: CPU_TYPE_ARM64, cpuSubtype: 0 }),
      archive.bytes.subarray(0, archive.endOffset),
      archive.bytes.subarray(0, archive.bytes.length - 5),
    ];

    for (const bytes of notZips) {
      expect(listError(bytes)).toBe("This file is not a zip file.");
    }
  });

  test("a central directory that runs past where it should end", () => {
    const message: string =
      "This zip file is corrupt: its central directory runs past where it should end.";

    expect(
      listError(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, archive.endOffset + 16, archive.endOffset, false);
        }),
      ),
    ).toBe(message);
    expect(
      listError(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, archive.endOffset + 12, 0xfffffff0, false);
        }),
      ),
    ).toBe(message);
  });

  test("a central directory entry that is not there, or runs past the directory", () => {
    expect(
      listError(
        broken((bytes: Buffer): void => {
          bytes[archive.centralHeaderOffsets[0]!] = 0;
        }),
      ),
    ).toBe(
      "This zip file is corrupt: entry 1 of its 2 is missing from its central directory.",
    );
    expect(
      listError(
        broken((bytes: Buffer): void => {
          writeUInt16(bytes, archive.endOffset + 10, 3, false);
        }),
      ),
    ).toBe(
      "This zip file is corrupt: entry 3 of its 3 is missing from its central directory.",
    );
    expect(
      listError(
        broken((bytes: Buffer): void => {
          writeUInt16(
            bytes,
            archive.centralHeaderOffsets[1]! + 28,
            0xffff,
            false,
          );
        }),
      ),
    ).toBe(
      "This zip file is corrupt: entry 2 of its 2 runs past the end of its central directory.",
    );
    // A comment 4 bytes long that is not there: entry 2 is looked for 4 bytes late.
    expect(
      listError(
        broken((bytes: Buffer): void => {
          writeUInt16(bytes, archive.centralHeaderOffsets[0]! + 32, 4, false);
        }),
      ),
    ).toBe(
      "This zip file is corrupt: entry 2 of its 2 is missing from its central directory.",
    );
    expect(
      listError(
        broken((bytes: Buffer): void => {
          writeUInt16(
            bytes,
            archive.centralHeaderOffsets[0]! + 32,
            0x100,
            false,
          );
        }),
      ),
    ).toBe(
      "This zip file is corrupt: entry 1 of its 2 runs past the end of its central directory.",
    );
  });

  test("an entry whose local header is missing, or outside the file", () => {
    const missing: Buffer = broken((bytes: Buffer): void => {
      bytes[archive.localHeaderOffsets[1]!] = 0x51;
    });
    const outside: Buffer = broken((bytes: Buffer): void => {
      writeUInt32(
        bytes,
        archive.centralHeaderOffsets[1]! + 42,
        0xfffffff0,
        false,
      );
    });
    const atTheEnd: Buffer = broken((bytes: Buffer): void => {
      writeUInt32(
        bytes,
        archive.centralHeaderOffsets[1]! + 42,
        bytes.length - 10,
        false,
      );
    });

    for (const bytes of [missing, outside, atTheEnd]) {
      const entries: Array<ZipEntry> = readZipEntries(bytes);

      expect(text(entries[0]!.read())).toBe("first");
      expect(readError(entries[1]!)).toBe(
        "This zip file is corrupt: second.txt has no local header.",
      );
    }
  });

  test("an entry whose data runs past the end of the file", () => {
    const entries: Array<ZipEntry> = readZipEntries(
      broken((bytes: Buffer): void => {
        writeUInt32(
          bytes,
          archive.centralHeaderOffsets[1]! + 20,
          0x7fffffff,
          false,
        );
      }),
    );

    expect(readError(entries[1]!)).toBe(
      "This zip file is truncated: second.txt runs past the end of the file.",
    );
  });

  test("an entry whose local header says its name or extra field is longer than the file", () => {
    const entries: Array<ZipEntry> = readZipEntries(
      broken((bytes: Buffer): void => {
        writeUInt16(bytes, archive.localHeaderOffsets[1]! + 28, 0xffff, false);
      }),
    );

    expect(readError(entries[1]!)).toBe(
      "This zip file is truncated: second.txt runs past the end of the file.",
    );
  });

  test("an entry whose sizes do not agree with its bytes", () => {
    const entries: Array<ZipEntry> = readZipEntries(
      buildZip([
        {
          name: "stored.txt",
          data: "stored",
          method: "store",
          declaredUncompressedSize: 60,
        },
        {
          name: "deflated.txt",
          data: "deflated",
          declaredUncompressedSize: 60,
        },
      ]),
    );

    expect(readError(entries[0]!)).toBe(
      "This zip file is corrupt: stored.txt is stored as 6 bytes but says it holds 60.",
    );
    expect(readError(entries[1]!)).toBe(
      "This zip file is corrupt: deflated.txt inflates to 8 bytes, not the 60 it says it holds.",
    );
  });

  test("deflated data that is not deflate, or is cut short", () => {
    const compressed: number = buildZip([
      {
        name: "a.txt",
        data: "a longer text to deflate, a longer text to deflate",
      },
    ]).readUInt32LE(18);
    const entries: Array<ZipEntry> = readZipEntries(
      buildZip([
        {
          name: "garbage.bin",
          data: Buffer.from([0xff, 0xff, 0xff, 0xff]),
          method: "store",
          methodNumber: 8,
          declaredUncompressedSize: 10,
        },
        {
          name: "cut.txt",
          data: "a longer text to deflate, a longer text to deflate",
          declaredCompressedSize: compressed - 4,
        },
      ]),
    );

    expect(readError(entries[0]!)).toBe(
      "This zip file is corrupt: garbage.bin cannot be inflated.",
    );
    expect(readError(entries[1]!)).toBe(
      "This zip file is corrupt: cut.txt cannot be inflated.",
    );
  });

  test("an entry whose checksum does not match its bytes", () => {
    const entries: Array<ZipEntry> = readZipEntries(
      buildZip([
        {
          name: "stored.txt",
          data: "stored",
          method: "store",
          crc: 0x12345678,
        },
        { name: "deflated.txt", data: "deflated", crc: 0 },
      ]),
    );

    expect(readError(entries[0]!)).toBe(
      "This zip file is corrupt: stored.txt's checksum does not match its bytes.",
    );
    expect(readError(entries[1]!)).toBe(
      "This zip file is corrupt: deflated.txt's checksum does not match its bytes.",
    );
  });
});

describe("never reading outside the bytes given", () => {
  const OWN_MESSAGES: Array<RegExp> = [
    /^This file is not a zip file\.$/,
    /^This zip file is (corrupt|truncated): [\s\S]+\.$/,
    /^This zip file lists \d+ entries, more than the \d+ OneUptime reads\.$/,
    / is encrypted; OneUptime reads only zip files without a password\.$/,
    / is compressed with method \d+; OneUptime reads only stored and deflated zip entries\.$/,
    / is \d+ bytes uncompressed, more than the \d+ OneUptime reads from one zip entry\.$/,
    / would take this zip file past \d+ bytes uncompressed, more than OneUptime reads from one zip file\.$/,
    / inflates past the \d+ bytes it says it holds: the zip file is corrupt or a zip bomb\.$/,
  ];

  const expectOwnMessage: (error: unknown) => void = (error: unknown): void => {
    const message: string = (error as Error).message;

    expect(
      OWN_MESSAGES.some((pattern: RegExp): boolean => {
        return pattern.test(message);
      }),
    ).toBe(true);
  };

  const checkArchive: (bytes: Uint8Array) => void = (
    bytes: Uint8Array,
  ): void => {
    let entries: Array<ZipEntry>;

    try {
      entries = readZipEntries(bytes, {
        maxEntryBytes: MEBIBYTE,
        maxTotalBytes: 4 * MEBIBYTE,
      });
    } catch (error: unknown) {
      expectOwnMessage(error);
      return;
    }

    for (const entry of entries) {
      try {
        const data: Uint8Array = entry.read();

        expect(data.length).toBe(entry.uncompressedSize);
      } catch (error: unknown) {
        expectOwnMessage(error);
      }
    }
  };

  const sources: Array<Buffer> = [
    buildZip(
      [
        { name: "MyApp.app.dSYM/" },
        {
          name: "MyApp.app.dSYM/Contents/Info.plist",
          data: PLIST,
          method: "store",
        },
        {
          name: DWARF_NAME,
          data: buildTinyMachO({ cpuType: CPU_TYPE_ARM64, cpuSubtype: 0 }),
        },
      ],
      { comment: "dSYMs" },
    ),
    buildZip(
      [
        { name: "a.txt", data: "a deflated entry of a ZIP64 archive" },
        { name: "b.txt", data: "a stored one", method: "store" },
      ],
      { zip64: true },
    ),
  ];

  test("an archive cut at every length is refused with a sentence, or read", () => {
    for (const source of sources) {
      for (let length: number = 0; length <= source.length; length++) {
        checkArchive(source.subarray(0, length));
      }
    }
  });

  test("archives with bytes changed at random are refused with a sentence, or read", () => {
    const random: SeededRandom = seededRandom(9924);

    for (let attempt: number = 0; attempt < 3000; attempt++) {
      const bytes: Buffer = Buffer.from(sources[attempt % sources.length]!);
      const changes: number = 1 + random(4);

      for (let change: number = 0; change < changes; change++) {
        bytes[random(bytes.length)] = random(4) === 0 ? 0xff : random(256);
      }

      checkArchive(bytes);
    }
  });

  test("every size and offset of the central directory set to edge values is refused or read", () => {
    const layout: ZipLayout = buildZipLayout([
      { name: "a.txt", data: "first entry" },
      { name: "b.txt", data: "second entry", method: "store" },
    ]);
    const values: Array<number> = [
      0,
      1,
      0x7fffffff,
      0xfffffffe,
      0xffffffff,
      layout.bytes.length,
    ];

    for (const central of layout.centralHeaderOffsets) {
      for (const field of [16, 20, 24, 42]) {
        for (const value of values) {
          const bytes: Buffer = Buffer.from(layout.bytes);

          writeUInt32(bytes, central + field, value, false);
          checkArchive(bytes);
        }
      }

      for (const field of [28, 30, 32]) {
        for (const value of [0, 1, 0xffff]) {
          const bytes: Buffer = Buffer.from(layout.bytes);

          writeUInt16(bytes, central + field, value, false);
          checkArchive(bytes);
        }
      }
    }
  });
});
