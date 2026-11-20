import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "@jest/globals";
import { AppleSymbolFile } from "../../../../../Utils/Telemetry/AppleSymbols";
import {
  DSYM_WALK_LIMITS,
  findDwarfFiles,
  isMachO,
  isZip,
  readDsymSymbolFilesFromBytes,
  readDsymSymbolFilesFromPath,
} from "../../../../../Server/Utils/Telemetry/AppleDebugSymbols/DsymFiles";
import {
  APP_SYMBOLS,
  APP_TEXT_END_OFFSET,
  APP_UUID,
  ARMV7_SYMBOLS,
  ARMV7_TEXT_END_OFFSET,
  CODE,
  CPU_TYPE_ARM,
  CPU_TYPE_ARM64,
  CPU_TYPE_X86_64,
  FRAMEWORK_UUID,
  MH_EXECUTE,
  N_EXT,
  N_SECT,
  SIMULATOR_SYMBOLS,
  SIMULATOR_TEXT_END_OFFSET,
  SIMULATOR_UUID,
  WATCH_UUID,
  ZipFixtureEntry,
  appleDoubleBytes,
  buildAppMachO,
  buildArmv7MachO,
  buildFat,
  buildMachO,
  buildSimulatorMachO,
  buildZip,
  dsymBundleEntries,
} from "./MachOFixtures";

/*
 * THE dSYMs A TEAM HAS, WHEREVER IT KEEPS THEM.
 *
 * A dSYM is a bundle - MyApp.app.dSYM/Contents/Resources/DWARF/MyApp - and
 * teams have them as bundles in a build folder or Xcode's archives, as zips
 * of bundles (an Xcode archive, App Store Connect's "Download dSYMs", a CI
 * artifact), or as the DWARF file alone. Every DWARF file of a bundle is
 * read, named by its file name; nothing else is (the app's own executable,
 * macOS's "._" files, a bundle's Info.plist); and a UUID found twice is kept
 * once. The path tests build their folders under the system's temporary
 * folder and remove them when they are done.
 */

const DIRECTORIES: Array<string> = [];

afterAll(() => {
  for (const directory of DIRECTORIES) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// A folder of the files given, by their paths in it; a path ending in "/" is a folder.
function makeTree(files: Record<string, Uint8Array | string>): string {
  const root: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-dsyms-"),
  );

  DIRECTORIES.push(root);

  for (const [relative, contents] of Object.entries(files)) {
    const file: string = path.join(root, relative);

    if (relative.endsWith("/")) {
      fs.mkdirSync(file, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }

  return root;
}

function errorOf(work: () => unknown): Error {
  try {
    work();
  } catch (error: unknown) {
    return error as Error;
  }

  throw new Error("Expected the read to throw.");
}

// Each file as "binary architecture UUID", for comparing lists at a glance.
function summaryOf(files: Array<AppleSymbolFile>): Array<string> {
  return files.map((file: AppleSymbolFile): string => {
    return `${file.binaryName} ${file.architecture} ${file.debugId}`;
  });
}

const EXECUTABLE_UUID: string = "E0E0E0E0-1111-2222-3333-444444444444";

function buildFrameworkMachO(uuid: string): Buffer {
  return buildMachO({
    cpuType: CPU_TYPE_ARM64,
    cpuSubtype: 0,
    uuid,
    segments: [
      {
        name: "__TEXT",
        address: 0,
        size: 0x8000,
        sections: [
          { name: "__text", address: 0x4000, size: 0x200, flags: CODE },
        ],
      },
    ],
    symbols: [
      {
        name: "_$s11MyFramework6helperyyF",
        type: N_SECT,
        section: 1,
        value: 0x4100,
      },
      {
        name: "_$s11MyFramework5setupyyF",
        type: N_SECT | N_EXT,
        section: 1,
        value: 0x4000,
      },
    ],
  });
}

const APP_DWARF: Buffer = buildFat([
  {
    cpuType: CPU_TYPE_ARM64,
    cpuSubtype: 0,
    bytes: buildAppMachO({ uuid: APP_UUID }),
  },
  {
    cpuType: CPU_TYPE_X86_64,
    cpuSubtype: 3,
    bytes: buildSimulatorMachO(SIMULATOR_UUID),
    alignment: 12,
  },
]);
const FRAMEWORK_DWARF: Buffer = buildFrameworkMachO(FRAMEWORK_UUID);
const WATCH_DWARF: Buffer = buildArmv7MachO(WATCH_UUID);
// The app's own executable, never read: it is not in a dSYM.
const APP_EXECUTABLE: Buffer = buildAppMachO({
  uuid: EXECUTABLE_UUID,
  fileType: MH_EXECUTE,
});

const ARM64_APP: AppleSymbolFile = {
  debugId: APP_UUID,
  architecture: "arm64",
  binaryName: "MyApp",
  symbols: [...APP_SYMBOLS],
  textEndOffset: APP_TEXT_END_OFFSET,
};
const X86_64_APP: AppleSymbolFile = {
  debugId: SIMULATOR_UUID,
  architecture: "x86_64",
  binaryName: "MyApp",
  symbols: [...SIMULATOR_SYMBOLS],
  textEndOffset: SIMULATOR_TEXT_END_OFFSET,
};
const FRAMEWORK: AppleSymbolFile = {
  debugId: FRAMEWORK_UUID,
  architecture: "arm64",
  binaryName: "MyFramework",
  symbols: [
    { offset: 0x4000, name: "$s11MyFramework5setupyyF" },
    { offset: 0x4100, name: "$s11MyFramework6helperyyF" },
  ],
  textEndOffset: 0x4200,
};
const WATCH: AppleSymbolFile = {
  debugId: WATCH_UUID,
  architecture: "armv7",
  binaryName: "WatchApp",
  symbols: [...ARMV7_SYMBOLS],
  textEndOffset: ARMV7_TEXT_END_OFFSET,
};

describe("telling a zip from a Mach-O file", () => {
  test("a zip starts with a local header, or an empty one with its end record", () => {
    expect(isZip(buildZip([{ name: "a.txt", data: "a" }]))).toBe(true);
    expect(isZip(buildZip([]))).toBe(true);
    expect(isZip(APP_DWARF)).toBe(false);
    expect(isZip(Buffer.from("PK"))).toBe(false);
    expect(isZip(Buffer.from("PK\x01\x02", "latin1"))).toBe(false);
    expect(isZip(Buffer.from("plain text"))).toBe(false);
    expect(isZip(new Uint8Array(0))).toBe(false);
  });

  test("a Mach-O file is thin in either byte order and 32 or 64 bits, or universal", () => {
    expect(isMachO(FRAMEWORK_DWARF)).toBe(true);
    expect(isMachO(buildAppMachO({ uuid: APP_UUID, bigEndian: true }))).toBe(
      true,
    );
    expect(isMachO(WATCH_DWARF)).toBe(true);
    expect(isMachO(buildArmv7MachO(WATCH_UUID, { bigEndian: true }))).toBe(
      true,
    );
    expect(isMachO(APP_DWARF)).toBe(true);
    expect(
      isMachO(
        buildFat(
          [{ cpuType: CPU_TYPE_ARM, cpuSubtype: 9, bytes: WATCH_DWARF }],
          { is64: true },
        ),
      ),
    ).toBe(true);
  });

  test("what only looks like one is not: a Java class, a zip, text, too few bytes", () => {
    expect(isMachO(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x41]))).toBe(
      false,
    );
    expect(isMachO(buildZip([{ name: "MyApp", data: FRAMEWORK_DWARF }]))).toBe(
      false,
    );
    expect(isMachO(Buffer.from("feedfacf"))).toBe(false);
    expect(isMachO(Buffer.from([0xcf, 0xfa, 0xed]))).toBe(false);
    expect(isMachO(appleDoubleBytes())).toBe(false);
  });
});

describe("a zip of dSYMs", () => {
  test("reads every bundle's DWARF file, named by it, and nothing else in the zip", () => {
    const zip: Buffer = buildZip([
      ...dsymBundleEntries({
        bundle: "MyApp.app.dSYM",
        binary: "MyApp",
        dwarf: APP_DWARF,
      }),
      ...dsymBundleEntries({
        bundle: "MyFramework.framework.dSYM",
        binary: "MyFramework",
        dwarf: FRAMEWORK_DWARF,
        method: "store",
      }),
      // What Finder's Compress adds, and what a Finder window leaves.
      { name: "__MACOSX/" },
      {
        name: "__MACOSX/MyApp.app.dSYM/Contents/Resources/DWARF/._MyApp",
        data: appleDoubleBytes(),
      },
      { name: "__MACOSX/._MyApp.app.dSYM", data: appleDoubleBytes() },
      {
        name: "MyApp.app.dSYM/Contents/Resources/DWARF/.DS_Store",
        data: "Bud1 not Mach-O",
      },
      {
        name: "MyApp.app.dSYM/Contents/Resources/DWARF/._MyApp",
        data: appleDoubleBytes(),
      },
      { name: "README.txt", data: "dSYMs for build 2189" },
    ]);

    expect(readDsymSymbolFilesFromBytes(zip, "dSYMs.zip")).toEqual([
      ARM64_APP,
      X86_64_APP,
      FRAMEWORK,
    ]);
  });

  test("an Xcode archive, zipped: its dSYMs, never the app's own executable", () => {
    const archive: string = "MyApp 20-11-2026, 10.00.xcarchive/";
    const zip: Buffer = buildZip([
      { name: archive },
      { name: `${archive}Info.plist`, data: "<plist/>" },
      ...dsymBundleEntries({
        prefix: `${archive}dSYMs/`,
        bundle: "MyApp.app.dSYM",
        binary: "MyApp",
        dwarf: APP_DWARF,
      }),
      ...dsymBundleEntries({
        prefix: `${archive}dSYMs/`,
        bundle: "MyFramework.framework.dSYM",
        binary: "MyFramework",
        dwarf: FRAMEWORK_DWARF,
      }),
      {
        name: `${archive}Products/Applications/MyApp.app/MyApp`,
        data: APP_EXECUTABLE,
      },
      {
        name: `${archive}Products/Applications/MyApp.app/Frameworks/MyFramework.framework/MyFramework`,
        data: buildFrameworkMachO(EXECUTABLE_UUID),
      },
    ]);

    expect(
      summaryOf(readDsymSymbolFilesFromBytes(zip, "MyApp.xcarchive.zip")),
    ).toEqual([
      `MyApp arm64 ${APP_UUID}`,
      `MyApp x86_64 ${SIMULATOR_UUID}`,
      `MyFramework arm64 ${FRAMEWORK_UUID}`,
    ]);
  });

  test("App Store Connect's download: bundles named by UUID, binaries by their own names", () => {
    const zip: Buffer = buildZip([
      ...dsymBundleEntries({
        bundle: `${APP_UUID}.dSYM`,
        binary: "MyApp",
        dwarf: buildAppMachO({ uuid: APP_UUID }),
      }),
      ...dsymBundleEntries({
        bundle: `${FRAMEWORK_UUID}.dSYM`,
        binary: "MyFramework",
        dwarf: FRAMEWORK_DWARF,
      }),
    ]);

    expect(readDsymSymbolFilesFromBytes(zip, "appDsyms.zip")).toEqual([
      ARM64_APP,
      FRAMEWORK,
    ]);
  });

  test("a bundle zipped twice is read once", () => {
    const zip: Buffer = buildZip([
      ...dsymBundleEntries({
        prefix: "a/",
        bundle: "MyApp.app.dSYM",
        binary: "MyApp",
        dwarf: APP_DWARF,
      }),
      ...dsymBundleEntries({
        prefix: "b/",
        bundle: "MyApp.app.dSYM",
        binary: "MyApp",
        dwarf: APP_DWARF,
      }),
    ]);

    expect(readDsymSymbolFilesFromBytes(zip, "twice.zip")).toEqual([
      ARM64_APP,
      X86_64_APP,
    ]);
  });

  test("a UUID in two bundles is kept once, as the first one has it", () => {
    const zip: Buffer = buildZip([
      ...dsymBundleEntries({
        bundle: "MyApp.app.dSYM",
        binary: "MyApp",
        dwarf: APP_DWARF,
      }),
      ...dsymBundleEntries({
        prefix: "Renamed/",
        bundle: "Renamed.app.dSYM",
        binary: "Renamed",
        dwarf: buildAppMachO({ uuid: APP_UUID }),
      }),
    ]);

    expect(summaryOf(readDsymSymbolFilesFromBytes(zip, "dSYMs.zip"))).toEqual([
      `MyApp arm64 ${APP_UUID}`,
      `MyApp x86_64 ${SIMULATOR_UUID}`,
    ]);
  });

  test("a zip with no bundle's DWARF file in it has no files", () => {
    const notBundles: Array<ZipFixtureEntry> = [
      { name: "README.txt", data: "no dSYMs here" },
      { name: "MyApp.app/MyApp", data: APP_EXECUTABLE },
      // Deeper than a DWARF folder's own files, or with no bundle name.
      {
        name: "MyApp.app.dSYM/Contents/Resources/DWARF/Extra/MyApp",
        data: FRAMEWORK_DWARF,
      },
      { name: ".dSYM/Contents/Resources/DWARF/MyApp", data: FRAMEWORK_DWARF },
      { name: "MyApp.app.dSYM/Contents/Resources/DWARF/", data: undefined },
      {
        name: "MyApp.app.dSYM/Contents/Resources/MyApp",
        data: FRAMEWORK_DWARF,
      },
    ];

    expect(
      readDsymSymbolFilesFromBytes(buildZip(notBundles), "other.zip"),
    ).toEqual([]);
    expect(readDsymSymbolFilesFromBytes(buildZip([]), "empty.zip")).toEqual([]);
  });

  test("a zip made on Windows, its folders written with backslashes, is read", () => {
    const zip: Buffer = buildZip([
      {
        name: "dSYMs\\MyFramework.framework.dSYM\\Contents\\Resources\\DWARF\\MyFramework",
        data: FRAMEWORK_DWARF,
      },
    ]);

    expect(readDsymSymbolFilesFromBytes(zip, "dSYMs.zip")).toEqual([FRAMEWORK]);
  });

  test("a ZIP64 zip of dSYMs is read", () => {
    const zip: Buffer = buildZip(
      dsymBundleEntries({
        bundle: "MyApp.app.dSYM",
        binary: "MyApp",
        dwarf: APP_DWARF,
      }),
      { zip64: true },
    );

    expect(readDsymSymbolFilesFromBytes(zip, "dSYMs.zip")).toEqual([
      ARM64_APP,
      X86_64_APP,
    ]);
  });

  test("an upload's bytes as a plain Uint8Array, not a Buffer, read the same", () => {
    const zip: Buffer = buildZip(
      dsymBundleEntries({
        bundle: "MyApp.app.dSYM",
        binary: "MyApp",
        dwarf: APP_DWARF,
      }),
    );
    const plainZip: Uint8Array = new Uint8Array(zip.length);
    const plainDwarf: Uint8Array = new Uint8Array(FRAMEWORK_DWARF.length);

    plainZip.set(zip);
    plainDwarf.set(FRAMEWORK_DWARF);

    expect(isZip(plainZip)).toBe(true);
    expect(isMachO(plainDwarf)).toBe(true);
    expect(readDsymSymbolFilesFromBytes(plainZip, "dSYMs.zip")).toEqual([
      ARM64_APP,
      X86_64_APP,
    ]);
    expect(readDsymSymbolFilesFromBytes(plainDwarf, "MyFramework")).toEqual([
      FRAMEWORK,
    ]);
  });

  test("a DWARF file the zip holds that cannot be read fails the read, and says why", () => {
    const zipOf: (dwarf: ZipFixtureEntry) => Buffer = (
      dwarf: ZipFixtureEntry,
    ): Buffer => {
      return buildZip([
        ...dsymBundleEntries({
          bundle: "MyFramework.framework.dSYM",
          binary: "MyFramework",
          dwarf: FRAMEWORK_DWARF,
        }),
        dwarf,
      ]);
    };
    const messageOf: (zip: Buffer) => string = (zip: Buffer): string => {
      return errorOf((): unknown => {
        return readDsymSymbolFilesFromBytes(zip, "dSYMs.zip");
      }).message;
    };
    const dwarfPath: string = "MyApp.app.dSYM/Contents/Resources/DWARF/MyApp";

    expect(
      messageOf(
        zipOf({
          name: dwarfPath,
          data: APP_DWARF.subarray(0, APP_DWARF.length - 1),
        }),
      ),
    ).toBe(
      "MyApp is truncated: its x86_64 slice runs past the end of the file.",
    );
    expect(messageOf(zipOf({ name: dwarfPath, data: "not a binary" }))).toBe(
      "MyApp is not a Mach-O file.",
    );
    expect(
      messageOf(zipOf({ name: dwarfPath, data: APP_DWARF, flags: 0x0001 })),
    ).toBe(
      `${dwarfPath} is encrypted; OneUptime reads only zip files without a password.`,
    );
  });

  test("a zip cut short is refused as the zip reader refuses it", () => {
    const zip: Buffer = buildZip(
      dsymBundleEntries({
        bundle: "MyApp.app.dSYM",
        binary: "MyApp",
        dwarf: APP_DWARF,
      }),
    );

    expect(
      errorOf((): unknown => {
        return readDsymSymbolFilesFromBytes(
          zip.subarray(0, zip.length - 30),
          "dSYMs.zip",
        );
      }).message,
    ).toBe("This file is not a zip file.");
  });
});

describe("one DWARF file", () => {
  test("is named by the last segment of the name it was given", () => {
    for (const fileName of [
      "MyFramework",
      "build/MyFramework.framework.dSYM/Contents/Resources/DWARF/MyFramework",
      "/Users/dev/Library/Developer/Xcode/Archives/MyFramework",
      "C:\\Builds\\MyFramework.framework.dSYM\\Contents\\Resources\\DWARF\\MyFramework",
      "uploads/MyFramework/",
    ]) {
      expect(readDsymSymbolFilesFromBytes(FRAMEWORK_DWARF, fileName)).toEqual([
        FRAMEWORK,
      ]);
    }
  });

  test("a universal DWARF file gives a file per architecture", () => {
    expect(readDsymSymbolFilesFromBytes(APP_DWARF, "MyApp")).toEqual([
      ARM64_APP,
      X86_64_APP,
    ]);
  });

  test("a universal file whose slices share a UUID keeps the first", () => {
    const shared: Buffer = buildFat([
      {
        cpuType: CPU_TYPE_ARM64,
        cpuSubtype: 0,
        bytes: buildAppMachO({ uuid: APP_UUID }),
      },
      {
        cpuType: CPU_TYPE_ARM64,
        cpuSubtype: 2,
        bytes: buildAppMachO({ uuid: APP_UUID, cpuSubtype: 2 }),
      },
    ]);

    expect(summaryOf(readDsymSymbolFilesFromBytes(shared, "MyApp"))).toEqual([
      `MyApp arm64 ${APP_UUID}`,
    ]);
  });

  test("a DWARF file with no UUID has no files", () => {
    expect(
      readDsymSymbolFilesFromBytes(buildAppMachO({ uuid: null }), "MyApp"),
    ).toEqual([]);
  });

  test("anything else is refused, by the name it was given", () => {
    for (const bytes of [
      Buffer.from("not a dSYM"),
      appleDoubleBytes(),
      Buffer.from("\x7fELF\x02\x01\x01\0", "latin1"),
      new Uint8Array(0),
    ]) {
      expect(
        errorOf((): unknown => {
          return readDsymSymbolFilesFromBytes(
            bytes,
            "uploads/MyApp.app.dSYM.tar.gz",
          );
        }).message,
      ).toBe(
        "uploads/MyApp.app.dSYM.tar.gz is neither a dSYM's DWARF file nor a zip of dSYMs.",
      );
    }
  });

  test("a DWARF file cut short is refused by the Mach-O reader, by its binary's name", () => {
    expect(
      errorOf((): unknown => {
        return readDsymSymbolFilesFromBytes(
          FRAMEWORK_DWARF.subarray(0, 100),
          "build/MyFramework",
        );
      }).message,
    ).toBe(
      "MyFramework is truncated: its load commands run past the end of the file.",
    );
  });
});

describe("a path on disk", () => {
  const DWARF: string = "Contents/Resources/DWARF";

  test("a folder of Xcode archives: every bundle in it, a UUID found twice kept once", () => {
    const today: string =
      "Archives/2026-11-20/MyApp 20-11-2026, 10.00.xcarchive";
    const yesterday: string =
      "Archives/2026-11-19/MyApp 19-11-2026, 18.30.xcarchive";
    const root: string = makeTree({
      [`${today}/Info.plist`]: "<plist/>",
      [`${today}/dSYMs/MyApp.app.dSYM/Contents/Info.plist`]: "<plist/>",
      [`${today}/dSYMs/MyApp.app.dSYM/${DWARF}/MyApp`]: APP_DWARF,
      [`${today}/dSYMs/MyFramework.framework.dSYM/${DWARF}/MyFramework`]:
        FRAMEWORK_DWARF,
      [`${today}/Products/Applications/MyApp.app/MyApp`]: APP_EXECUTABLE,
      // The same build archived twice.
      [`${yesterday}/dSYMs/MyApp.app.dSYM/${DWARF}/MyApp`]: APP_DWARF,
      [`Watch/WatchApp.app.dSYM/${DWARF}/WatchApp`]: WATCH_DWARF,
      "Empty/": "",
    });

    expect(readDsymSymbolFilesFromPath(root)).toEqual([
      ARM64_APP,
      X86_64_APP,
      FRAMEWORK,
      WATCH,
    ]);
  });

  test("macOS's hidden files in a DWARF folder are passed over", () => {
    const root: string = makeTree({
      [`MyApp.app.dSYM/${DWARF}/MyApp`]: APP_DWARF,
      [`MyApp.app.dSYM/${DWARF}/._MyApp`]: appleDoubleBytes(),
      [`MyApp.app.dSYM/${DWARF}/.DS_Store`]: "Bud1",
      [`__MACOSX/MyApp.app.dSYM/${DWARF}/._MyApp`]: appleDoubleBytes(),
    });

    expect(readDsymSymbolFilesFromPath(root)).toEqual([ARM64_APP, X86_64_APP]);
  });

  test("a file in a DWARF folder that is not a Mach-O file fails the read, and says so", () => {
    const root: string = makeTree({
      [`MyApp.app.dSYM/${DWARF}/MyApp`]: APP_DWARF,
      [`MyApp.app.dSYM/${DWARF}/MyApp.txt`]: "notes",
    });

    expect(
      errorOf((): unknown => {
        return readDsymSymbolFilesFromPath(root);
      }).message,
    ).toBe("MyApp.txt is not a Mach-O file.");
  });

  test("the path may be a dSYM bundle, its DWARF folder or its DWARF file", () => {
    const root: string = makeTree({
      [`Build/MyFramework.framework.dSYM/${DWARF}/MyFramework`]:
        FRAMEWORK_DWARF,
    });
    const bundle: string = path.join(
      root,
      "Build",
      "MyFramework.framework.dSYM",
    );

    for (const target of [
      bundle,
      `${bundle}${path.sep}`,
      path.join(bundle, "Contents", "Resources", "DWARF"),
      path.join(bundle, "Contents", "Resources", "DWARF", "MyFramework"),
    ]) {
      expect(readDsymSymbolFilesFromPath(target)).toEqual([FRAMEWORK]);
    }
  });

  test("a zip on disk is read as a zip of dSYMs", () => {
    const root: string = makeTree({
      "dSYMs.zip": buildZip(
        dsymBundleEntries({
          bundle: "MyApp.app.dSYM",
          binary: "MyApp",
          dwarf: APP_DWARF,
        }),
      ),
    });

    expect(readDsymSymbolFilesFromPath(path.join(root, "dSYMs.zip"))).toEqual([
      ARM64_APP,
      X86_64_APP,
    ]);
  });

  test("a DWARF file far larger than its symbol table is read whole", () => {
    const large: Buffer = buildMachO({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: 0,
      uuid: FRAMEWORK_UUID,
      segments: [
        {
          name: "__TEXT",
          address: 0,
          size: 0x8000,
          sections: [
            { name: "__text", address: 0x4000, size: 0x200, flags: CODE },
          ],
        },
      ],
      symbols: [
        {
          name: "_$s11MyFramework6helperyyF",
          type: N_SECT,
          section: 1,
          value: 0x4100,
        },
        {
          name: "_$s11MyFramework5setupyyF",
          type: N_SECT | N_EXT,
          section: 1,
          value: 0x4000,
        },
      ],
      // Debug information after the symbols, as a dSYM's __DWARF is.
      trailer: Buffer.alloc(6 * 1024 * 1024, 0x5a),
    });
    const root: string = makeTree({
      [`MyFramework.framework.dSYM/${DWARF}/MyFramework`]: large,
    });

    expect(readDsymSymbolFilesFromPath(root)).toEqual([FRAMEWORK]);
  });

  test("a folder with no dSYM in it has no files", () => {
    const root: string = makeTree({
      "README.md": "# Build",
      "MyApp.app/MyApp": APP_EXECUTABLE,
      "Logs/": "",
    });

    expect(readDsymSymbolFilesFromPath(root)).toEqual([]);
    expect(readDsymSymbolFilesFromPath(makeTree({}))).toEqual([]);
  });

  test("a file that is neither is refused by its path, as is an empty one", () => {
    const root: string = makeTree({
      "notes.txt": "not a dSYM",
      "empty.bin": "",
    });

    for (const name of ["notes.txt", "empty.bin"]) {
      const file: string = path.join(root, name);

      expect(
        errorOf((): unknown => {
          return readDsymSymbolFilesFromPath(file);
        }).message,
      ).toBe(`${file} is neither a dSYM's DWARF file nor a zip of dSYMs.`);
    }
  });

  test("a path that does not exist is refused, by the path", () => {
    const missing: string = path.join(makeTree({}), "Missing.app.dSYM");

    expect(
      errorOf((): unknown => {
        return readDsymSymbolFilesFromPath(missing);
      }).message,
    ).toBe(`${missing} does not exist.`);
  });

  test("a bundle deeper than the walk goes is not found; one at its last folder is", () => {
    const eight: string = "1/2/3/4/5/6/7/8";
    const root: string = makeTree({
      // Its DWARF folder is 12 folders down.
      [`${eight}/MyFramework.framework.dSYM/${DWARF}/MyFramework`]:
        FRAMEWORK_DWARF,
      // And this one's is 13.
      [`${eight}/9/WatchApp.app.dSYM/${DWARF}/WatchApp`]: WATCH_DWARF,
    });

    expect(DSYM_WALK_LIMITS.maxDepth).toBe(12);
    expect(readDsymSymbolFilesFromPath(root)).toEqual([FRAMEWORK]);
    // One folder further in, both are in reach ("9" sorts before "MyFramework...").
    expect(readDsymSymbolFilesFromPath(path.join(root, "1"))).toEqual([
      WATCH,
      FRAMEWORK,
    ]);
  });

  test("a symbolic link to a folder is not followed, so a loop ends; one to a DWARF file is read", () => {
    const root: string = makeTree({
      [`MyApp.app.dSYM/${DWARF}/MyApp`]: APP_DWARF,
      "Elsewhere/MyFramework": FRAMEWORK_DWARF,
      [`MyFramework.framework.dSYM/${DWARF}/`]: "",
    });

    fs.symlinkSync(root, path.join(root, "loop"), "dir");
    fs.symlinkSync(
      path.join(root, "Elsewhere", "MyFramework"),
      path.join(
        root,
        "MyFramework.framework.dSYM",
        "Contents",
        "Resources",
        "DWARF",
        "MyFramework",
      ),
    );
    fs.symlinkSync(
      path.join(root, "Gone"),
      path.join(
        root,
        "MyFramework.framework.dSYM",
        "Contents",
        "Resources",
        "DWARF",
        "Broken",
      ),
    );

    expect(readDsymSymbolFilesFromPath(root)).toEqual([
      ARM64_APP,
      X86_64_APP,
      FRAMEWORK,
    ]);
  });

  test("the walk finds DWARF files as absolute paths, in name order", () => {
    const root: string = makeTree({
      [`b/Second.app.dSYM/${DWARF}/Second`]: FRAMEWORK_DWARF,
      [`a/First.app.dSYM/${DWARF}/First`]: FRAMEWORK_DWARF,
      [`a/First.app.dSYM/${DWARF}/Another`]: FRAMEWORK_DWARF,
      "a/notes.txt": "x",
    });

    expect(findDwarfFiles(root)).toEqual([
      path.join(
        root,
        "a",
        "First.app.dSYM",
        "Contents",
        "Resources",
        "DWARF",
        "Another",
      ),
      path.join(
        root,
        "a",
        "First.app.dSYM",
        "Contents",
        "Resources",
        "DWARF",
        "First",
      ),
      path.join(
        root,
        "b",
        "Second.app.dSYM",
        "Contents",
        "Resources",
        "DWARF",
        "Second",
      ),
    ]);
  });

  test("a folder holding more files and folders than the walk looks at is refused", () => {
    const files: Record<string, string> = {};

    for (let index: number = 0; index < 60; index++) {
      files[`folder/file-${index}.txt`] = "";
    }

    const root: string = makeTree(files);

    expect(DSYM_WALK_LIMITS.maxEntries).toBe(100_000);
    expect(
      errorOf((): unknown => {
        return findDwarfFiles(root, { maxDepth: 12, maxEntries: 50 });
      }).message,
    ).toBe(
      `${root} holds more than 50 files and folders: point at a folder of dSYMs, an Xcode archive or a zip of dSYMs instead.`,
    );
    expect(findDwarfFiles(root, { maxDepth: 12, maxEntries: 61 })).toEqual([]);
    expect(findDwarfFiles(root, { maxDepth: 0, maxEntries: 50 })).toEqual([]);
  });

  test("a folder that cannot be listed is refused when it is the one given", () => {
    const root: string = makeTree({ "file.txt": "x" });

    expect(() => {
      return findDwarfFiles(path.join(root, "file.txt", "below"));
    }).toThrow();
  });
});
