import { describe, expect, test } from "@jest/globals";
import {
  AppleSymbol,
  AppleSymbolFile,
  AppleSymbolMatch,
  AppleSymbolTable,
  MAX_APPLE_SYMBOLS,
  MAX_APPLE_SYMBOL_NAME_LENGTH,
  decodeAppleSymbols,
  encodeAppleSymbols,
  lookupAppleSymbol,
} from "../../../../../Utils/Telemetry/AppleSymbols";
import {
  isMachOFile,
  readMachOSymbolFiles,
} from "../../../../../Server/Utils/Telemetry/AppleDebugSymbols/MachOSymbols";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";
import {
  APP_ARM64E_UUID,
  APP_SYMBOLS,
  APP_TEXT_END_OFFSET,
  APP_UUID,
  ARMV7_SYMBOLS,
  ARMV7_TEXT_BASE,
  ARMV7_TEXT_END_OFFSET,
  CODE,
  CPU_SUBTYPE_ARM64E,
  CPU_SUBTYPE_ARM64_ALL,
  CPU_SUBTYPE_ARM64_V8,
  CPU_SUBTYPE_ARM_V6,
  CPU_SUBTYPE_ARM_V7,
  CPU_SUBTYPE_ARM_V7K,
  CPU_SUBTYPE_ARM_V7S,
  CPU_SUBTYPE_I386_ALL,
  CPU_SUBTYPE_LIB64,
  CPU_SUBTYPE_PTRAUTH_ABI,
  CPU_SUBTYPE_X86_64_ALL,
  CPU_SUBTYPE_X86_64_H,
  CPU_TYPE_ARM,
  CPU_TYPE_ARM64,
  CPU_TYPE_ARM64_32,
  CPU_TYPE_POWERPC,
  CPU_TYPE_X86,
  CPU_TYPE_X86_64,
  FatLayout,
  FixtureSegment,
  FixtureSymbol,
  LC_SEGMENT_64,
  LC_SYMTAB,
  LC_UUID,
  MH_EXECUTE,
  MachOLayout,
  N_EXT,
  N_SECT,
  SIMULATOR_SYMBOLS,
  SIMULATOR_TEXT_END_OFFSET,
  SIMULATOR_UUID,
  S_ATTR_PURE_INSTRUCTIONS,
  S_ATTR_SOME_INSTRUCTIONS,
  S_CSTRING_LITERALS,
  TEXT_BASE,
  WATCH_UUID,
  appSegments,
  appleDoubleBytes,
  buildAppMachO,
  buildAppMachOLayout,
  buildArmv7MachO,
  buildFat,
  buildFatLayout,
  buildMachO,
  buildMachOLayout,
  buildManySymbolsMachO,
  buildSimulatorMachO,
  buildTinyMachO,
  buildVersionCommand,
  readUInt32,
  writeUInt32,
  writeUInt64,
} from "./MachOFixtures";

/*
 * AN APPLE BINARY'S FUNCTION SYMBOLS, READ FROM BYTES NOBODY VOUCHES FOR.
 *
 * readMachOSymbolFiles reads a dSYM's DWARF file - or an executable, a
 * universal file, a byte-swapped one - into what AppleSymbols.ts keeps:
 * per UUID and architecture, each function's offset from __TEXT and its
 * name. The files here are built byte by byte (MachOFixtures), so every
 * field the reader takes can be checked, and every one can be broken: a
 * file that is not Mach-O, is cut short or is corrupt is refused with a
 * sentence, and nothing is ever read outside the bytes given.
 */

function readOne(
  bytes: Uint8Array,
  binaryName: string = "MyApp",
): AppleSymbolFile {
  const files: Array<AppleSymbolFile> = readMachOSymbolFiles(bytes, binaryName);

  expect(files).toHaveLength(1);

  return files[0]!;
}

function errorOf(work: () => unknown): Error {
  try {
    work();
  } catch (error: unknown) {
    return error as Error;
  }

  throw new Error("Expected the read to throw.");
}

function messageOf(bytes: Uint8Array, binaryName: string = "MyApp"): string {
  return errorOf((): unknown => {
    return readMachOSymbolFiles(bytes, binaryName);
  }).message;
}

function namesOf(file: AppleSymbolFile): Array<string> {
  return file.symbols.map((symbol: AppleSymbol): string => {
    return symbol.name;
  });
}

function copyOf(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes);
}

// The offset of the n-th load command of a kind (0 for the first).
function commandOffset(
  layout: MachOLayout,
  cmd: number,
  nth: number = 0,
): number {
  const offsets: Array<number> = layout.commands
    .filter((command: { cmd: number }): boolean => {
      return command.cmd === cmd;
    })
    .map((command: { offset: number }): number => {
      return command.offset;
    });

  return offsets[nth]!;
}

const APP_FILE: AppleSymbolFile = {
  debugId: APP_UUID,
  architecture: "arm64",
  binaryName: "MyApp",
  symbols: [...APP_SYMBOLS],
  textEndOffset: APP_TEXT_END_OFFSET,
};

describe("an arm64 dSYM", () => {
  const dsym: Buffer = buildAppMachO({ uuid: APP_UUID });

  test("reads its UUID, architecture, name, the end of its code and its functions", () => {
    expect(readMachOSymbolFiles(dsym, "MyApp")).toEqual([APP_FILE]);
  });

  test("writes the UUID as normalizeAppleDebugId does, however the bytes spell it", () => {
    const lowerCase: Buffer = buildAppMachO({
      uuid: "70b89f2716343580a69557cdb41d7743",
    });

    expect(readOne(lowerCase).debugId).toBe(
      "70B89F27-1634-3580-A695-57CDB41D7743",
    );
  });

  test("names the binary as it is told, whatever the bytes say", () => {
    expect(readOne(dsym, "MyFramework").binaryName).toBe("MyFramework");
    expect(readOne(dsym, "libswift_Concurrency.dylib").binaryName).toBe(
      "libswift_Concurrency.dylib",
    );
  });

  test("measures every offset from __TEXT's vmaddr, not from address 0", () => {
    const file: AppleSymbolFile = readOne(dsym);

    expect(file.symbols[0]).toEqual({ offset: 0x4000, name: "main" });

    for (const symbol of file.symbols) {
      expect(symbol.offset).toBeLessThan(0x10000);
      expect(symbol.offset).toBeGreaterThanOrEqual(0x4000);
    }
  });

  test("ends the code where its last section of instructions ends: __stubs, not __cstring after it", () => {
    expect(readOne(dsym).textEndOffset).toBe(0x5060);
  });

  test("takes one leading underscore off each name, and only one", () => {
    const names: Array<string> = namesOf(readOne(dsym));

    expect(names).toContain("main");
    expect(names).toContain("_ZN3foo3barEv");
    expect(names).toContain("$s5MyApp18CartViewControllerC8checkoutyyF");
    expect(names).toContain("-[CartViewController checkout]");
    expect(names).not.toContain("_main");
    expect(names).not.toContain("ZN3foo3barEv");
  });

  test("leaves out debugging (STAB) entries, even ones with a section and an address in the code", () => {
    const file: AppleSymbolFile = readOne(dsym);

    expect(namesOf(file)).not.toContain("stab_begin");
    expect(namesOf(file)).not.toContain("stab_end");
    expect(namesOf(file)).not.toContain("gGlobal");
    expect(
      file.symbols.filter((symbol: AppleSymbol): boolean => {
        return symbol.offset === 0x4f00 || symbol.offset === 0x4f10;
      }),
    ).toEqual([]);
  });

  test("leaves out symbols of sections that do not hold instructions", () => {
    const names: Array<string> = namesOf(readOne(dsym));

    for (const name of ["kGreeting", "gCartCount", "gCache", "unwind"]) {
      expect(names).not.toContain(name);
    }
  });

  test("leaves out symbols not defined in a section here: undefined, absolute, indirect, prebound", () => {
    const names: Array<string> = namesOf(readOne(dsym));

    for (const name of ["printf", "absolute", "indirect", "prebound"]) {
      expect(names).not.toContain(name);
    }
  });

  test("leaves out symbols before __TEXT, at the end of the code, or in a section the file does not have", () => {
    const names: Array<string> = namesOf(readOne(dsym));

    for (const name of ["before_text", "at_text_end", "no_such_section"]) {
      expect(names).not.toContain(name);
    }
  });

  test("leaves out unnamed symbols: n_strx 0, not the string table's first byte, and a lone underscore", () => {
    const file: AppleSymbolFile = readOne(dsym);

    expect(namesOf(file)).not.toContain(" ");
    expect(namesOf(file)).not.toContain("");
    expect(
      file.symbols.filter((symbol: AppleSymbol): boolean => {
        return symbol.offset === 0x4900 || symbol.offset === 0x4a00;
      }),
    ).toEqual([]);
  });

  test("sorts by offset whatever order the table lists them in, one name per offset", () => {
    const offsets: Array<number> = readOne(dsym).symbols.map(
      (symbol: AppleSymbol): number => {
        return symbol.offset;
      },
    );

    for (let index: number = 1; index < offsets.length; index++) {
      expect(offsets[index]!).toBeGreaterThan(offsets[index - 1]!);
    }
  });

  test("keeps an external symbol's name where two share an offset, else the first listed", () => {
    const byOffset: Map<number, string> = new Map<number, string>(
      readOne(dsym).symbols.map((symbol: AppleSymbol): [number, string] => {
        return [symbol.offset, symbol.name];
      }),
    );

    expect(byOffset.get(0x4400)).toBe("checkout");
    expect(byOffset.get(0x4500)).toBe("first_local");
    expect(byOffset.get(0x4600)).toBe("first_external");
    expect(byOffset.get(0x4700)).toBe("external_then_local");
  });

  test("keeps a name two functions share for each of them, the string written once", () => {
    const layout: MachOLayout = buildAppMachOLayout({ uuid: APP_UUID });
    const symbols: Array<AppleSymbol> = readOne(layout.bytes).symbols;

    expect(
      symbols.filter((symbol: AppleSymbol): boolean => {
        return symbol.name === "OUTLINED_FUNCTION_0";
      }),
    ).toEqual([
      { offset: 0x4b00, name: "OUTLINED_FUNCTION_0" },
      { offset: 0x4c00, name: "OUTLINED_FUNCTION_0" },
    ]);
    expect(new Set(layout.stringIndexes).size).toBeLessThan(
      layout.stringIndexes.length,
    );
  });

  test("keeps symbols in __stubs and private externals: functions of the binary too", () => {
    const names: Array<string> = namesOf(readOne(dsym));

    expect(names).toContain("objc_msgSend$checkout");
    expect(names).toContain("private_extern_function");
  });

  test("gives offsets a frame's offset resolves against once stored", () => {
    const file: AppleSymbolFile = readOne(dsym);
    const table: AppleSymbolTable | null = decodeAppleSymbols(
      encodeAppleSymbols(file),
    );

    expect(table).not.toBeNull();
    expect(lookupAppleSymbol(table!, 0x4210)).toEqual({
      name: "$s5MyApp18CartViewControllerC8checkoutyyF",
      symbolOffset: 0x10,
    } as AppleSymbolMatch);
    expect(lookupAppleSymbol(table!, 0x5004)).toEqual({
      name: "objc_msgSend$checkout",
      symbolOffset: 4,
    } as AppleSymbolMatch);
    expect(lookupAppleSymbol(table!, 0x3fff)).toBeNull();
    expect(lookupAppleSymbol(table!, APP_TEXT_END_OFFSET)).toBeNull();
  });

  test("leaves the bytes it is given as they were", () => {
    const before: Buffer = copyOf(dsym);

    readMachOSymbolFiles(dsym, "MyApp");

    expect(dsym.equals(before)).toBe(true);
  });
});

describe("the same symbols, however the file is laid out", () => {
  test("the app's executable (MH_EXECUTE), LC_UUID and LC_SYMTAB after its segments, reads as its dSYM", () => {
    const executable: Buffer = buildAppMachO({
      uuid: APP_UUID,
      fileType: MH_EXECUTE,
    });

    expect(readMachOSymbolFiles(executable, "MyApp")).toEqual([APP_FILE]);
  });

  test("load commands in dsymutil's order and in ld's give the same file", () => {
    expect(
      readMachOSymbolFiles(
        buildAppMachO({ uuid: APP_UUID, order: "linker" }),
        "MyApp",
      ),
    ).toEqual(
      readMachOSymbolFiles(
        buildAppMachO({ uuid: APP_UUID, order: "dsym" }),
        "MyApp",
      ),
    );
  });

  test("a byte-swapped (big-endian) file reads as its little-endian twin", () => {
    const swapped: Buffer = buildAppMachO({ uuid: APP_UUID, bigEndian: true });

    expect(swapped.readUInt32BE(0)).toBe(0xfeedfacf);
    expect(readMachOSymbolFiles(swapped, "MyApp")).toEqual([APP_FILE]);
    expect(
      readMachOSymbolFiles(
        buildAppMachO({
          uuid: APP_UUID,
          bigEndian: true,
          fileType: MH_EXECUTE,
        }),
        "MyApp",
      ),
    ).toEqual([APP_FILE]);
  });

  test("load commands of other kinds are passed over", () => {
    const withOthers: Buffer = buildMachO({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: CPU_SUBTYPE_ARM64_ALL,
      uuid: APP_UUID,
      segments: appSegments(),
      symbols: [
        {
          name: "_main",
          type: N_SECT | N_EXT,
          section: 1,
          value: TEXT_BASE + 0x4000,
        },
      ],
      otherCommands: [
        buildVersionCommand(),
        // LC_MAIN, LC_SOURCE_VERSION, LC_LOAD_DYLIB.
        { cmd: 0x80000028, payload: Buffer.alloc(16) },
        { cmd: 0x2a, payload: Buffer.alloc(8) },
        {
          cmd: 0xc,
          payload: Buffer.from("\0\0\0\x18/usr/lib/libSystem.B.dylib\0"),
        },
      ],
    });

    expect(readOne(withOthers).symbols).toEqual([
      { offset: 0x4000, name: "main" },
    ]);
  });

  test("the first LC_UUID is the binary's when a file has two", () => {
    const twoUuids: Buffer = buildMachO({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: CPU_SUBTYPE_ARM64_ALL,
      uuid: APP_UUID,
      segments: appSegments(),
      symbols: [],
      otherCommands: [
        {
          cmd: LC_UUID,
          payload: Buffer.from(SIMULATOR_UUID.split("-").join(""), "hex"),
        },
      ],
    });

    expect(readOne(twoUuids).debugId).toBe(APP_UUID);
  });

  test("section numbers run across segments: __DATA's first section is never __TEXT's", () => {
    const dataFirst: Buffer = buildMachO({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: CPU_SUBTYPE_ARM64_ALL,
      uuid: APP_UUID,
      segments: [
        { name: "__PAGEZERO", address: 0, size: TEXT_BASE, sections: [] },
        {
          name: "__DATA",
          address: TEXT_BASE + 0x8000,
          size: 0x1000,
          sections: [
            {
              name: "__data",
              address: TEXT_BASE + 0x8000,
              size: 0x100,
              flags: 0,
            },
          ],
        },
        {
          name: "__TEXT",
          address: TEXT_BASE,
          size: 0x8000,
          sections: [
            {
              name: "__text",
              address: TEXT_BASE + 0x4000,
              size: 0x100,
              flags: CODE,
            },
          ],
        },
      ],
      symbols: [
        // Section 1 is __data, section 2 __text.
        {
          name: "_data_symbol",
          type: N_SECT,
          section: 1,
          value: TEXT_BASE + 0x4000,
        },
        {
          name: "_code_symbol",
          type: N_SECT,
          section: 2,
          value: TEXT_BASE + 0x4010,
        },
      ],
    });

    expect(readOne(dataFirst)).toEqual({
      debugId: APP_UUID,
      architecture: "arm64",
      binaryName: "MyApp",
      symbols: [{ offset: 0x4010, name: "code_symbol" }],
      textEndOffset: 0x4100,
    });
  });

  test("a section holds instructions when either attribute says so", () => {
    const file: AppleSymbolFile = readOne(
      buildMachO({
        cpuType: CPU_TYPE_ARM64,
        cpuSubtype: CPU_SUBTYPE_ARM64_ALL,
        uuid: APP_UUID,
        segments: [
          {
            name: "__TEXT",
            address: TEXT_BASE,
            size: 0x8000,
            sections: [
              {
                name: "__pure",
                address: TEXT_BASE + 0x1000,
                size: 0x100,
                flags: S_ATTR_PURE_INSTRUCTIONS,
              },
              {
                name: "__some",
                address: TEXT_BASE + 0x1100,
                size: 0x100,
                flags: S_ATTR_SOME_INSTRUCTIONS,
              },
              {
                name: "__const",
                address: TEXT_BASE + 0x1200,
                size: 0x100,
                flags: S_CSTRING_LITERALS,
              },
            ],
          },
        ],
        symbols: [
          {
            name: "_pure",
            type: N_SECT,
            section: 1,
            value: TEXT_BASE + 0x1000,
          },
          {
            name: "_some",
            type: N_SECT,
            section: 2,
            value: TEXT_BASE + 0x1100,
          },
          {
            name: "_const",
            type: N_SECT,
            section: 3,
            value: TEXT_BASE + 0x11f0,
          },
        ],
      }),
    );

    expect(file.symbols).toEqual([
      { offset: 0x1000, name: "pure" },
      { offset: 0x1100, name: "some" },
    ]);
    expect(file.textEndOffset).toBe(0x1200);
  });

  test("a section of instructions in a later segment is code too, measured from __TEXT", () => {
    const segments: Array<FixtureSegment> = [
      ...appSegments(),
      {
        name: "__MYCODE",
        address: TEXT_BASE + 0x20000,
        size: 0x1000,
        sections: [
          {
            name: "__hot",
            address: TEXT_BASE + 0x20000,
            size: 0x200,
            flags: CODE,
          },
        ],
      },
    ];
    const file: AppleSymbolFile = readOne(
      buildMachO({
        cpuType: CPU_TYPE_ARM64,
        cpuSubtype: CPU_SUBTYPE_ARM64_ALL,
        uuid: APP_UUID,
        segments,
        // __MYCODE's __hot is section 7, after __TEXT's four and __DATA's two.
        symbols: [
          {
            name: "_hot_path",
            type: N_SECT,
            section: 7,
            value: TEXT_BASE + 0x20100,
          },
          {
            name: "_main",
            type: N_SECT | N_EXT,
            section: 1,
            value: TEXT_BASE + 0x4000,
          },
        ],
      }),
    );

    expect(file.symbols).toEqual([
      { offset: 0x4000, name: "main" },
      { offset: 0x20100, name: "hot_path" },
    ]);
    expect(file.textEndOffset).toBe(0x20200);
  });

  test("a dylib whose __TEXT is at address 0 has offsets that are its addresses", () => {
    const file: AppleSymbolFile = readOne(
      buildMachO({
        cpuType: CPU_TYPE_ARM64,
        cpuSubtype: CPU_SUBTYPE_ARM64E | CPU_SUBTYPE_PTRAUTH_ABI,
        uuid: APP_ARM64E_UUID,
        segments: [
          {
            name: "__TEXT",
            address: 0,
            size: 0x8000,
            sections: [
              { name: "__text", address: 0x3000, size: 0x2000, flags: CODE },
            ],
          },
        ],
        symbols: [
          {
            name: "_$s7Network5fetchyyF",
            type: N_SECT | N_EXT,
            section: 1,
            value: 0x3a00,
          },
        ],
      }),
      "Network",
    );

    expect(file).toEqual({
      debugId: APP_ARM64E_UUID,
      architecture: "arm64e",
      binaryName: "Network",
      symbols: [{ offset: 0x3a00, name: "$s7Network5fetchyyF" }],
      textEndOffset: 0x5000,
    });
  });

  test("offsets stay exact for a __TEXT far above 2^53, where a double cannot hold an address", () => {
    // A kernel's __TEXT: 0xffffff8000200000.
    const base: number = 0xffffff80 * 4294967296 + 0x00200000;
    const layout: MachOLayout = buildMachOLayout({
      cpuType: CPU_TYPE_X86_64,
      cpuSubtype: CPU_SUBTYPE_X86_64_ALL,
      uuid: APP_UUID,
      segments: [
        {
          name: "__TEXT",
          address: 0,
          size: 0x10000,
          sections: [{ name: "__text", address: 0, size: 0, flags: CODE }],
        },
      ],
      symbols: [
        {
          name: "_kernel_bootstrap",
          type: N_SECT | N_EXT,
          section: 1,
          value: 0,
        },
        { name: "_panic", type: N_SECT | N_EXT, section: 1, value: 0 },
      ],
    });
    const bytes: Buffer = layout.bytes;
    const segment: number = commandOffset(layout, LC_SEGMENT_64);
    const section: number = segment + 72;
    const symbolValue: (index: number) => number = (index: number): number => {
      return layout.symbolTableOffset + index * 16 + 8;
    };

    // Written by halves, exactly: the fixture's numbers would round.
    writeUInt32(bytes, segment + 24, 0x00200000, false);
    writeUInt32(bytes, segment + 28, 0xffffff80, false);
    writeUInt32(bytes, section + 32, 0x00201000, false);
    writeUInt32(bytes, section + 36, 0xffffff80, false);
    writeUInt32(bytes, section + 40, 0x3001, false);
    writeUInt32(bytes, symbolValue(0), 0x00201001, false);
    writeUInt32(bytes, symbolValue(0) + 4, 0xffffff80, false);
    writeUInt32(bytes, symbolValue(1), 0x00203000, false);
    writeUInt32(bytes, symbolValue(1) + 4, 0xffffff80, false);

    expect(base).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(readOne(bytes, "kernel").symbols).toEqual([
      { offset: 0x1001, name: "kernel_bootstrap" },
      { offset: 0x3000, name: "panic" },
    ]);
    expect(readOne(bytes, "kernel").textEndOffset).toBe(0x4001);
  });
});

describe("architectures", () => {
  const cases: Array<[string, number, number, boolean]> = [
    ["arm64", CPU_TYPE_ARM64, CPU_SUBTYPE_ARM64_ALL, true],
    ["arm64", CPU_TYPE_ARM64, CPU_SUBTYPE_ARM64_V8, true],
    ["arm64", CPU_TYPE_ARM64, 3, true],
    ["arm64e", CPU_TYPE_ARM64, CPU_SUBTYPE_ARM64E, true],
    [
      "arm64e",
      CPU_TYPE_ARM64,
      (CPU_SUBTYPE_ARM64E | CPU_SUBTYPE_PTRAUTH_ABI) >>> 0,
      true,
    ],
    // Pointer authentication ABI version 1, in bits 24 to 27.
    [
      "arm64e",
      CPU_TYPE_ARM64,
      (CPU_SUBTYPE_PTRAUTH_ABI | 0x01000000 | CPU_SUBTYPE_ARM64E) >>> 0,
      true,
    ],
    ["arm64_32", CPU_TYPE_ARM64_32, 1, false],
    ["x86_64", CPU_TYPE_X86_64, CPU_SUBTYPE_X86_64_ALL, true],
    [
      "x86_64",
      CPU_TYPE_X86_64,
      (CPU_SUBTYPE_X86_64_ALL | CPU_SUBTYPE_LIB64) >>> 0,
      true,
    ],
    ["x86_64h", CPU_TYPE_X86_64, CPU_SUBTYPE_X86_64_H, true],
    ["armv7", CPU_TYPE_ARM, CPU_SUBTYPE_ARM_V7, false],
    ["armv7s", CPU_TYPE_ARM, CPU_SUBTYPE_ARM_V7S, false],
    ["armv7k", CPU_TYPE_ARM, CPU_SUBTYPE_ARM_V7K, false],
    ["armv6", CPU_TYPE_ARM, CPU_SUBTYPE_ARM_V6, false],
    ["arm", CPU_TYPE_ARM, 0, false],
    ["arm", CPU_TYPE_ARM, 13, false],
    ["i386", CPU_TYPE_X86, CPU_SUBTYPE_I386_ALL, false],
    ["cpu-18-0", CPU_TYPE_POWERPC, 0, false],
    // SPARC, and PowerPC 64 with a capability bit: named by their numbers.
    ["cpu-14-1", 14, 1, false],
    ["cpu-16777234-100", 0x01000012, (100 | CPU_SUBTYPE_LIB64) >>> 0, true],
  ];

  test.each(cases)(
    "%s for cputype %s, cpusubtype %s",
    (expected: string, cpuType: number, cpuSubtype: number, is64: boolean) => {
      expect(
        readOne(buildTinyMachO({ cpuType, cpuSubtype, is64 })).architecture,
      ).toBe(expected);
    },
  );

  test("a byte-swapped file's CPU is read in its byte order", () => {
    expect(
      readOne(
        buildTinyMachO({
          cpuType: CPU_TYPE_ARM64,
          cpuSubtype: CPU_SUBTYPE_ARM64E,
          bigEndian: true,
        }),
      ).architecture,
    ).toBe("arm64e");
    expect(
      readOne(
        buildTinyMachO({
          cpuType: CPU_TYPE_ARM,
          cpuSubtype: CPU_SUBTYPE_ARM_V7K,
          is64: false,
          bigEndian: true,
        }),
      ).architecture,
    ).toBe("armv7k");
  });
});

describe("a 32-bit armv7 dSYM", () => {
  test("reads LC_SEGMENT, 12-byte nlist entries and 32-bit addresses", () => {
    expect(
      readMachOSymbolFiles(buildArmv7MachO(WATCH_UUID), "WatchApp"),
    ).toEqual([
      {
        debugId: WATCH_UUID,
        architecture: "armv7",
        binaryName: "WatchApp",
        symbols: [...ARMV7_SYMBOLS],
        textEndOffset: ARMV7_TEXT_END_OFFSET,
      },
    ]);
  });

  test("measures from its own __TEXT, at 0x4000, and keeps Thumb functions where they start", () => {
    const file: AppleSymbolFile = readOne(buildArmv7MachO(WATCH_UUID));

    expect(ARMV7_TEXT_BASE + file.symbols[0]!.offset).toBe(0x5000);
    expect(file.symbols[0]!.offset % 2).toBe(0);
  });

  test("a byte-swapped 32-bit file reads as its twin", () => {
    const swapped: Buffer = buildArmv7MachO(WATCH_UUID, { bigEndian: true });

    expect(swapped.readUInt32BE(0)).toBe(0xfeedface);
    expect(readMachOSymbolFiles(swapped, "WatchApp")).toEqual(
      readMachOSymbolFiles(buildArmv7MachO(WATCH_UUID), "WatchApp"),
    );
  });

  test("armv7s and armv7k builds name their architecture", () => {
    expect(
      readOne(buildArmv7MachO(WATCH_UUID, { cpuSubtype: CPU_SUBTYPE_ARM_V7S }))
        .architecture,
    ).toBe("armv7s");
    expect(
      readOne(buildArmv7MachO(WATCH_UUID, { cpuSubtype: CPU_SUBTYPE_ARM_V7K }))
        .architecture,
    ).toBe("armv7k");
  });
});

describe("a universal (fat) file", () => {
  const arm64: Buffer = buildAppMachO({ uuid: APP_UUID });
  const simulator: Buffer = buildSimulatorMachO(SIMULATOR_UUID);
  const simulatorFile: AppleSymbolFile = {
    debugId: SIMULATOR_UUID,
    architecture: "x86_64",
    binaryName: "MyApp",
    symbols: [...SIMULATOR_SYMBOLS],
    textEndOffset: SIMULATOR_TEXT_END_OFFSET,
  };

  test("reads each slice with its own UUID, architecture and symbols", () => {
    const fat: Buffer = buildFat([
      { cpuType: CPU_TYPE_ARM64, cpuSubtype: 0, bytes: arm64 },
      {
        cpuType: CPU_TYPE_X86_64,
        cpuSubtype: 3,
        bytes: simulator,
        alignment: 12,
      },
    ]);

    expect(fat.readUInt32BE(0)).toBe(0xcafebabe);
    expect(readMachOSymbolFiles(fat, "MyApp")).toEqual([
      APP_FILE,
      simulatorFile,
    ]);
  });

  test("a FAT_MAGIC_64 file, with 64-bit offsets, reads the same", () => {
    const fat: Buffer = buildFat(
      [
        { cpuType: CPU_TYPE_ARM64, cpuSubtype: 0, bytes: arm64 },
        { cpuType: CPU_TYPE_X86_64, cpuSubtype: 3, bytes: simulator },
      ],
      { is64: true },
    );

    expect(fat.readUInt32BE(0)).toBe(0xcafebabf);
    expect(readMachOSymbolFiles(fat, "MyApp")).toEqual([
      APP_FILE,
      simulatorFile,
    ]);
  });

  test("reads each slice's offsets from the start of the slice, wherever it is", () => {
    for (const alignment of [0, 3, 4, 12, 14]) {
      const fat: Buffer = buildFat([
        {
          cpuType: CPU_TYPE_X86_64,
          cpuSubtype: 3,
          bytes: simulator,
          alignment,
        },
        { cpuType: CPU_TYPE_ARM64, cpuSubtype: 0, bytes: arm64, alignment },
      ]);

      expect(readMachOSymbolFiles(fat, "MyApp")).toEqual([
        simulatorFile,
        APP_FILE,
      ]);
    }
  });

  test("arm64 and arm64e slices are two binaries, two UUIDs", () => {
    const arm64e: Buffer = buildAppMachO({
      uuid: APP_ARM64E_UUID,
      cpuSubtype: (CPU_SUBTYPE_ARM64E | CPU_SUBTYPE_PTRAUTH_ABI) >>> 0,
    });
    const files: Array<AppleSymbolFile> = readMachOSymbolFiles(
      buildFat([
        { cpuType: CPU_TYPE_ARM64, cpuSubtype: 0, bytes: arm64 },
        { cpuType: CPU_TYPE_ARM64, cpuSubtype: 0x80000002, bytes: arm64e },
      ]),
      "MyApp",
    );

    expect(
      files.map((file: AppleSymbolFile): [string, string] => {
        return [file.debugId, file.architecture];
      }),
    ).toEqual([
      [APP_UUID, "arm64"],
      [APP_ARM64E_UUID, "arm64e"],
    ]);
  });

  test("slices of 32 and 64 bits, and of either byte order, sit side by side", () => {
    const files: Array<AppleSymbolFile> = readMachOSymbolFiles(
      buildFat([
        {
          cpuType: CPU_TYPE_ARM,
          cpuSubtype: 9,
          bytes: buildArmv7MachO(WATCH_UUID),
        },
        {
          cpuType: CPU_TYPE_X86_64,
          cpuSubtype: 3,
          bytes: buildSimulatorMachO(SIMULATOR_UUID, true),
        },
        { cpuType: CPU_TYPE_ARM64, cpuSubtype: 0, bytes: arm64 },
      ]),
      "MyApp",
    );

    expect(
      files.map((file: AppleSymbolFile): string => {
        return file.architecture;
      }),
    ).toEqual(["armv7", "x86_64", "arm64"]);
    expect(files[1]).toEqual(simulatorFile);
  });

  test("a slice with no UUID is passed over, the others kept", () => {
    const files: Array<AppleSymbolFile> = readMachOSymbolFiles(
      buildFat([
        {
          cpuType: CPU_TYPE_ARM64,
          cpuSubtype: 0,
          bytes: buildAppMachO({ uuid: null }),
        },
        { cpuType: CPU_TYPE_X86_64, cpuSubtype: 3, bytes: simulator },
      ]),
      "MyApp",
    );

    expect(files).toEqual([simulatorFile]);
  });

  test("a universal file of slices with no UUID, or of none, has no files", () => {
    expect(
      readMachOSymbolFiles(
        buildFat([
          {
            cpuType: CPU_TYPE_ARM64,
            cpuSubtype: 0,
            bytes: buildAppMachO({ uuid: null }),
          },
          {
            cpuType: CPU_TYPE_X86_64,
            cpuSubtype: 3,
            bytes: buildSimulatorMachO(null),
          },
        ]),
        "MyApp",
      ),
    ).toEqual([]);
    expect(readMachOSymbolFiles(buildFat([]), "MyApp")).toEqual([]);
    expect(readMachOSymbolFiles(buildFat([], { is64: true }), "MyApp")).toEqual(
      [],
    );
  });
});

describe("files with nothing to look up in them", () => {
  test("a file with no LC_UUID has no files", () => {
    expect(
      readMachOSymbolFiles(buildAppMachO({ uuid: null }), "MyApp"),
    ).toEqual([]);
    expect(readMachOSymbolFiles(buildArmv7MachO(null), "MyApp")).toEqual([]);
  });

  test("a file with no __TEXT segment has no files: there is no base to measure from", () => {
    const noText: Buffer = buildMachO({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: 0,
      uuid: APP_UUID,
      segments: [
        {
          name: "",
          address: 0,
          size: 0x1000,
          sections: [{ name: "__text", address: 0, size: 0x100, flags: CODE }],
        },
      ],
      symbols: [{ name: "_main", type: N_SECT | N_EXT, section: 1, value: 0 }],
    });

    expect(readMachOSymbolFiles(noText, "main.o")).toEqual([]);
  });

  test("a file with no LC_SYMTAB has its UUID and the end of its code, and no symbols", () => {
    const stripped: Buffer = buildMachO({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: 0,
      uuid: APP_UUID,
      segments: appSegments(),
      symbols: null,
    });

    expect(readMachOSymbolFiles(stripped, "MyApp")).toEqual([
      {
        debugId: APP_UUID,
        architecture: "arm64",
        binaryName: "MyApp",
        symbols: [],
        textEndOffset: APP_TEXT_END_OFFSET,
      },
    ]);
  });

  test("an empty symbol table has no symbols", () => {
    const empty: Buffer = buildMachO({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: 0,
      uuid: APP_UUID,
      segments: appSegments(),
      symbols: [],
    });

    expect(readOne(empty).symbols).toEqual([]);
  });

  test("a binary with no section of instructions has no code and no symbols", () => {
    const dataOnly: Buffer = buildMachO({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: 0,
      uuid: APP_UUID,
      segments: [
        {
          name: "__TEXT",
          address: TEXT_BASE,
          size: 0x1000,
          sections: [
            {
              name: "__const",
              address: TEXT_BASE + 0x100,
              size: 0x100,
              flags: 0,
            },
          ],
        },
      ],
      symbols: [
        { name: "_table", type: N_SECT, section: 1, value: TEXT_BASE + 0x100 },
      ],
    });

    expect(readOne(dataOnly)).toMatchObject({ symbols: [], textEndOffset: 0 });
  });
});

describe("limits", () => {
  test(`keeps at most ${MAX_APPLE_SYMBOLS} symbols, the lowest offsets`, () => {
    const count: number = MAX_APPLE_SYMBOLS + 3;
    const file: AppleSymbolFile = readOne(buildManySymbolsMachO(count));

    expect(file.symbols).toHaveLength(MAX_APPLE_SYMBOLS);
    expect(file.symbols[0]).toEqual({ offset: 0x4000, name: "f" });
    expect(file.symbols[MAX_APPLE_SYMBOLS - 1]).toEqual({
      offset: 0x4000 + (MAX_APPLE_SYMBOLS - 1) * 4,
      name: "f",
    });
    expect(file.textEndOffset).toBe(0x4000 + count * 4);

    let ascending: boolean = true;

    for (let index: number = 1; index < file.symbols.length; index++) {
      if (file.symbols[index]!.offset !== file.symbols[index - 1]!.offset + 4) {
        ascending = false;
        break;
      }
    }

    expect(ascending).toBe(true);
  });

  const longNameFile: (names: Array<string>) => AppleSymbolFile = (
    names: Array<string>,
  ): AppleSymbolFile => {
    return readOne(
      buildMachO({
        cpuType: CPU_TYPE_ARM64,
        cpuSubtype: 0,
        uuid: APP_UUID,
        segments: appSegments(),
        symbols: names.map((name: string, index: number): FixtureSymbol => {
          return {
            name,
            type: N_SECT | N_EXT,
            section: 1,
            value: TEXT_BASE + 0x4000 + index * 0x10,
          };
        }),
      }),
    );
  };

  test(`cuts a name at ${MAX_APPLE_SYMBOL_NAME_LENGTH} characters, after its underscore comes off`, () => {
    const names: Array<string> = namesOf(
      longNameFile([
        `_${"x".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH + 1000)}`,
        `_${"y".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH)}`,
        `_${"z".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH * 5)}`,
      ]),
    );

    expect(names).toEqual([
      "x".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH),
      "y".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH),
      "z".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH),
    ]);
  });

  test("reads names as UTF-8, and never cuts one between the halves of a character", () => {
    const names: Array<string> = namesOf(
      longNameFile([
        "_$s5Café4menuyyF",
        `_${"é".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH + 10)}`,
        `_${"中".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH + 10)}`,
        `_a${"\u{1F600}".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH)}`,
        `_${"\u{1F600}".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH)}`,
      ]),
    );

    expect(names[0]).toBe("$s5Café4menuyyF");
    expect(names[1]).toBe("é".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH));
    expect(names[2]).toBe("中".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH));
    // "a" and 2047 emoji: 4095 UTF-16 units, the 2048th emoji's first half dropped.
    expect(names[3]).toBe(`a${"\u{1F600}".repeat(2047)}`);
    expect(names[4]).toBe("\u{1F600}".repeat(MAX_APPLE_SYMBOL_NAME_LENGTH / 2));
  });

  test("a name the string table ends inside of stops at its end, not at the bytes after it", () => {
    const layout: MachOLayout = buildMachOLayout({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: 0,
      uuid: APP_UUID,
      segments: appSegments(),
      symbols: [
        {
          name: "_main",
          type: N_SECT | N_EXT,
          section: 1,
          value: TEXT_BASE + 0x4000,
        },
      ],
      trailer: Buffer.from("TRAILING-BYTES-WITH-NO-NUL"),
    });

    // " \0_mai" - the table ends before "n\0".
    writeUInt32(layout.bytes, layout.symtabCommandOffset + 20, 6, false);

    expect(readOne(layout.bytes).symbols).toEqual([
      { offset: 0x4000, name: "mai" },
    ]);

    // No NUL at all to the end of the table: still only the table's bytes.
    writeUInt32(
      layout.bytes,
      layout.symtabCommandOffset + 20,
      layout.stringTableSize,
      false,
    );
    layout.bytes.fill(
      0x41,
      layout.stringTableOffset + 2,
      layout.stringTableOffset + layout.stringTableSize,
    );

    expect(layout.stringTableSize).toBe(8);
    expect(readOne(layout.bytes).symbols).toEqual([
      { offset: 0x4000, name: "AAAAAA" },
    ]);
  });

  test("an n_strx past the string table names nothing: that symbol is passed over", () => {
    const file: AppleSymbolFile = readOne(
      buildMachO({
        cpuType: CPU_TYPE_ARM64,
        cpuSubtype: 0,
        uuid: APP_UUID,
        segments: appSegments(),
        symbols: [
          {
            name: "_main",
            type: N_SECT | N_EXT,
            section: 1,
            value: TEXT_BASE + 0x4000,
          },
          {
            name: "_lost",
            type: N_SECT | N_EXT,
            section: 1,
            value: TEXT_BASE + 0x4100,
            stringIndex: 0xfffffff0,
          },
          {
            name: "_just_past",
            type: N_SECT | N_EXT,
            section: 1,
            value: TEXT_BASE + 0x4200,
            stringIndex: 8,
          },
        ],
      }),
    );

    // The string table is " \0_main\0", 8 bytes: n_strx 8 is just past it.
    expect(file.symbols).toEqual([{ offset: 0x4000, name: "main" }]);
  });

  test("a lone underscore at the very end of the string table names nothing", () => {
    const layout: MachOLayout = buildMachOLayout({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: 0,
      uuid: APP_UUID,
      segments: appSegments(),
      symbols: [
        {
          name: "_main",
          type: N_SECT | N_EXT,
          section: 1,
          value: TEXT_BASE + 0x4000,
        },
        {
          name: "_",
          type: N_SECT,
          section: 1,
          value: TEXT_BASE + 0x4100,
          stringIndex: 2,
        },
      ],
    });

    // The table is cut after "_" of "_main": n_strx 2 is its last byte.
    writeUInt32(layout.bytes, layout.symtabCommandOffset + 20, 3, false);

    expect(readOne(layout.bytes).symbols).toEqual([]);
  });

  test("names that overlap far more than a linker writes them are refused, before they fill the memory", () => {
    const run: number = 20_000;
    const symbols: Array<FixtureSymbol> = [];

    /*
     * The table is " \0" and padding (8 bytes), then one long run of letters:
     * every name starts one byte further into the run.
     */
    for (let index: number = 0; index < 200; index++) {
      symbols.push({
        name: "",
        type: N_SECT | N_EXT,
        section: 1,
        value: TEXT_BASE + 0x4000 + index * 4,
        stringIndex: 8 + index,
      });
    }

    const layout: MachOLayout = buildMachOLayout({
      cpuType: CPU_TYPE_ARM64,
      cpuSubtype: 0,
      uuid: APP_UUID,
      segments: appSegments(),
      symbols,
      trailer: Buffer.alloc(run, 0x61),
    });

    writeUInt32(
      layout.bytes,
      layout.symtabCommandOffset + 20,
      layout.stringTableSize + run,
      false,
    );

    expect(messageOf(layout.bytes)).toBe(
      "MyApp is corrupt: its symbols' names add up to more than twice its string table.",
    );
  });
});

describe("bytes that are not a Mach-O file", () => {
  const notMachO: Array<[string, Uint8Array]> = [
    ["nothing", new Uint8Array(0)],
    ["three bytes of a magic number", Buffer.from([0xcf, 0xfa, 0xed])],
    ["text", Buffer.from("This is not a dSYM.\n")],
    [
      "an ELF file",
      Buffer.from("\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0", "latin1"),
    ],
    ["a Windows executable", Buffer.from("MZ\x90\0\x03\0\0\0", "latin1")],
    ["a zip", Buffer.from("PK\x03\x04\x14\0\0\0", "latin1")],
    ["an AppleDouble file", appleDoubleBytes()],
    [
      "a Java class file",
      Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34, 0, 0x1d]),
    ],
    [
      "a universal header listing 43 architectures",
      Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 43]),
    ],
    [
      "a 64-bit universal header listing a million",
      Buffer.from([0xca, 0xfe, 0xba, 0xbf, 0, 0x0f, 0x42, 0x40]),
    ],
    [
      "a magic number one bit off",
      Buffer.from([0xcf, 0xfa, 0xed, 0xfd, 0, 0, 0, 0]),
    ],
  ];

  test.each(notMachO)(
    "%s is refused as not a Mach-O file",
    (_label: string, bytes: Uint8Array) => {
      expect(isMachOFile(bytes)).toBe(false);
      expect(messageOf(bytes)).toBe("MyApp is not a Mach-O file.");
    },
  );

  test("the message names the binary it was asked to read", () => {
    expect(messageOf(Buffer.from("hello"), "libswiftCore.dylib")).toBe(
      "libswiftCore.dylib is not a Mach-O file.",
    );
  });

  test("Mach-O files of every kind are known by their first bytes", () => {
    const thin: Buffer = buildAppMachO({ uuid: APP_UUID });

    expect(isMachOFile(thin)).toBe(true);
    expect(
      isMachOFile(buildAppMachO({ uuid: APP_UUID, bigEndian: true })),
    ).toBe(true);
    expect(isMachOFile(buildArmv7MachO(WATCH_UUID))).toBe(true);
    expect(isMachOFile(buildArmv7MachO(WATCH_UUID, { bigEndian: true }))).toBe(
      true,
    );
    expect(
      isMachOFile(
        buildFat([{ cpuType: CPU_TYPE_ARM64, cpuSubtype: 0, bytes: thin }]),
      ),
    ).toBe(true);
    expect(
      isMachOFile(
        buildFat([{ cpuType: CPU_TYPE_ARM64, cpuSubtype: 0, bytes: thin }], {
          is64: true,
        }),
      ),
    ).toBe(true);
    // Only the magic number: what follows is the reader's to check.
    expect(isMachOFile(thin.subarray(0, 4))).toBe(true);
    expect(
      isMachOFile(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 42])),
    ).toBe(true);
  });
});

describe("a thin file cut short or corrupt", () => {
  const layout: MachOLayout = buildAppMachOLayout({ uuid: APP_UUID });
  const original: Buffer = layout.bytes;

  const broken: (change: (bytes: Buffer) => void) => Buffer = (
    change: (bytes: Buffer) => void,
  ): Buffer => {
    const bytes: Buffer = copyOf(original);

    change(bytes);

    return bytes;
  };

  test("a file that ends inside its Mach-O header", () => {
    for (let length: number = 4; length < 32; length++) {
      expect(messageOf(original.subarray(0, length))).toBe(
        "MyApp is truncated: the file ends inside its Mach-O header.",
      );
    }

    const armv7: Buffer = buildArmv7MachO(WATCH_UUID);

    for (let length: number = 4; length < 28; length++) {
      expect(messageOf(armv7.subarray(0, length))).toBe(
        "MyApp is truncated: the file ends inside its Mach-O header.",
      );
    }

    // A 32-bit header is 28 bytes: one with no load commands is whole.
    const header: Buffer = copyOf(armv7.subarray(0, 28));

    writeUInt32(header, 16, 0, false);
    writeUInt32(header, 20, 0, false);
    expect(readMachOSymbolFiles(header, "MyApp")).toEqual([]);
  });

  test("load commands that run past the end of the file", () => {
    expect(messageOf(original.subarray(0, layout.headerSize + 100))).toBe(
      "MyApp is truncated: its load commands run past the end of the file.",
    );
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, 20, bytes.length, false);
        }),
      ),
    ).toBe(
      "MyApp is truncated: its load commands run past the end of the file.",
    );
  });

  test("a load command that runs past the end of the load commands", () => {
    const last: { offset: number } =
      layout.commands[layout.commands.length - 1]!;
    const count: number = layout.commands.length;

    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, last.offset + 4, 0x1000, false);
        }),
      ),
    ).toBe(
      `MyApp is corrupt: load command ${count} of ${count} runs past the end of its load commands.`,
    );
    // One more command than the load commands hold.
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, 16, count + 1, false);
        }),
      ),
    ).toBe(
      `MyApp is corrupt: load command ${count + 1} of ${count + 1} runs past the end of its load commands.`,
    );
  });

  test("a load command of 0 or 4 bytes, which would never move on", () => {
    for (const size of [0, 4, 7]) {
      expect(
        messageOf(
          broken((bytes: Buffer): void => {
            writeUInt32(bytes, layout.commands[1]!.offset + 4, size, false);
          }),
        ),
      ).toBe(
        `MyApp is corrupt: load command 2 of ${layout.commands.length} says it is ${size} bytes long, too short for a load command.`,
      );
    }
  });

  test("absurd numbers of load commands, and of their bytes", () => {
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, 16, 0xffffffff, false);
        }),
      ),
    ).toBe(
      "MyApp is corrupt: it lists 4294967295 load commands, more than the 65536 OneUptime reads.",
    );
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, 20, 0xffffffff, false);
        }),
      ),
    ).toBe(
      "MyApp is corrupt: its load commands take 4294967295 bytes, more than the 67108864 OneUptime reads.",
    );
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, 16, layout.sizeOfCommands / 8 + 1, false);
        }),
      ),
    ).toBe(
      `MyApp is corrupt: it lists ${layout.sizeOfCommands / 8 + 1} load commands in ${layout.sizeOfCommands} bytes, too few to hold them.`,
    );
  });

  test("a segment that lists more sections than its load command holds", () => {
    const text: number = commandOffset(layout, LC_SEGMENT_64, 1);

    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, text + 64, 100, false);
        }),
      ),
    ).toBe(
      "MyApp is corrupt: its segment __TEXT lists 100 sections, more than its load command holds.",
    );
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, text + 64, 0xffffffff, false);
        }),
      ),
    ).toBe(
      "MyApp is corrupt: its segment __TEXT lists 4294967295 sections, more than its load command holds.",
    );
  });

  test("load commands too short for what they say they are", () => {
    const shortCommand: (cmd: number) => Buffer = (cmd: number): Buffer => {
      return buildMachO({
        cpuType: CPU_TYPE_ARM64,
        cpuSubtype: 0,
        uuid: null,
        segments: appSegments(),
        symbols: null,
        otherCommands: [{ cmd, payload: Buffer.alloc(8) }],
      });
    };

    expect(messageOf(shortCommand(LC_UUID))).toBe(
      "MyApp is corrupt: its UUID load command is 16 bytes long, too short for a UUID.",
    );
    expect(messageOf(shortCommand(LC_SYMTAB))).toBe(
      "MyApp is corrupt: its symbol table load command is 16 bytes long, too short for one.",
    );
    expect(messageOf(shortCommand(LC_SEGMENT_64))).toBe(
      "MyApp is corrupt: a segment load command is 16 bytes long, too short for a segment.",
    );
    expect(messageOf(shortCommand(0x1))).toBe(
      "MyApp is corrupt: a segment load command is 16 bytes long, too short for a segment.",
    );
  });

  test("a symbol table outside the file", () => {
    const symtab: number = layout.symtabCommandOffset;
    const message: string =
      "MyApp is truncated: its symbol table runs past the end of the file.";

    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, symtab + 8, bytes.length, false);
        }),
      ),
    ).toBe(message);
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, symtab + 8, 0xfffffff0, false);
        }),
      ),
    ).toBe(message);
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, symtab + 12, 1_000_000, false);
        }),
      ),
    ).toBe(message);
  });

  test("a string table outside the file", () => {
    const symtab: number = layout.symtabCommandOffset;
    const message: string =
      "MyApp is truncated: its string table runs past the end of the file.";

    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, symtab + 16, bytes.length - 4, false);
        }),
      ),
    ).toBe(message);
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, symtab + 20, 0xffffffff, false);
        }),
      ),
    ).toBe(message);
    expect(messageOf(original.subarray(0, original.length - 1))).toBe(message);
  });

  test("an absurd number of symbols", () => {
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(
            bytes,
            layout.symtabCommandOffset + 12,
            0xffffffff,
            false,
          );
        }),
      ),
    ).toBe(
      "MyApp is corrupt: its symbol table lists 4294967295 symbols, more than the 16777216 OneUptime reads.",
    );
  });

  test("a big-endian file is checked as closely", () => {
    const swapped: MachOLayout = buildAppMachOLayout({
      uuid: APP_UUID,
      bigEndian: true,
    });
    const bytes: Buffer = copyOf(swapped.bytes);

    writeUInt32(bytes, swapped.symtabCommandOffset + 12, 0xffffffff, true);
    expect(messageOf(bytes)).toBe(
      "MyApp is corrupt: its symbol table lists 4294967295 symbols, more than the 16777216 OneUptime reads.",
    );
    expect(messageOf(swapped.bytes.subarray(0, 40))).toBe(
      "MyApp is truncated: its load commands run past the end of the file.",
    );
  });
});

describe("a universal file cut short or corrupt", () => {
  const arm64: Buffer = buildAppMachO({ uuid: APP_UUID });
  const simulator: Buffer = buildSimulatorMachO(SIMULATOR_UUID);
  const fat: FatLayout = buildFatLayout([
    { cpuType: CPU_TYPE_ARM64, cpuSubtype: 0, bytes: arm64, alignment: 4 },
    { cpuType: CPU_TYPE_X86_64, cpuSubtype: 3, bytes: simulator, alignment: 4 },
  ]);

  const broken: (change: (bytes: Buffer) => void) => Buffer = (
    change: (bytes: Buffer) => void,
  ): Buffer => {
    const bytes: Buffer = copyOf(fat.bytes);

    change(bytes);

    return bytes;
  };

  test("a file that ends inside its universal header or its list of architectures", () => {
    for (let length: number = 4; length < 8; length++) {
      expect(messageOf(fat.bytes.subarray(0, length))).toBe(
        "MyApp is truncated: the file ends inside its universal header.",
      );
    }

    for (let length: number = 8; length < 48; length++) {
      expect(messageOf(fat.bytes.subarray(0, length))).toBe(
        "MyApp is truncated: the file ends inside its list of architectures.",
      );
    }
  });

  test("a slice that runs past the end of the file", () => {
    expect(messageOf(fat.bytes.subarray(0, fat.bytes.length - 1))).toBe(
      "MyApp is truncated: its x86_64 slice runs past the end of the file.",
    );
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, 8 + 8, 0xfffffff0, true);
        }),
      ),
    ).toBe(
      "MyApp is truncated: its arm64 slice runs past the end of the file.",
    );
  });

  test("a 64-bit universal file whose slice is 4 GiB in", () => {
    const fat64: FatLayout = buildFatLayout(
      [{ cpuType: CPU_TYPE_ARM64, cpuSubtype: 0, bytes: arm64 }],
      { is64: true },
    );
    const bytes: Buffer = copyOf(fat64.bytes);

    writeUInt64(bytes, 8 + 8, 0x100000000, true);
    expect(messageOf(bytes)).toBe(
      "MyApp is truncated: its arm64 slice runs past the end of the file.",
    );

    writeUInt64(bytes, 8 + 8, fat64.sliceOffsets[0]!, true);
    writeUInt32(bytes, 8 + 16, 0xffffffff, true);
    expect(messageOf(bytes)).toBe(
      "MyApp is truncated: its arm64 slice runs past the end of the file.",
    );
  });

  test("a slice that is not a thin Mach-O file", () => {
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          bytes.fill(0, fat.sliceOffsets[1]!, fat.sliceOffsets[1]! + 4);
        }),
      ),
    ).toBe("MyApp is corrupt: its x86_64 slice is not a Mach-O file.");

    const nested: Buffer = buildFat([
      {
        cpuType: CPU_TYPE_ARM64,
        cpuSubtype: 0,
        bytes: fat.bytes,
        alignment: 4,
      },
    ]);

    expect(messageOf(nested)).toBe(
      "MyApp is corrupt: its arm64 slice is not a Mach-O file.",
    );
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, 8 + 12, 0, true);
        }),
      ),
    ).toBe("MyApp is corrupt: its arm64 slice is not a Mach-O file.");
  });

  test("a slice cut inside its own header names its architecture", () => {
    expect(
      messageOf(
        broken((bytes: Buffer): void => {
          writeUInt32(bytes, 8 + 12, 20, true);
        }),
      ),
    ).toBe(
      "MyApp (arm64) is truncated: its slice ends inside its Mach-O header.",
    );
  });

  test("a slice's symbol table is held to the slice, though the file goes on past it", () => {
    const appLayout: MachOLayout = buildAppMachOLayout({ uuid: APP_UUID });
    const bytes: Buffer = copyOf(fat.bytes);
    const symtab: number = fat.sliceOffsets[0]! + appLayout.symtabCommandOffset;

    // Past the arm64 slice, but inside the x86_64 one that follows it.
    writeUInt32(bytes, symtab + 8, arm64.length + 16, false);
    expect(fat.bytes.length).toBeGreaterThan(
      fat.sliceOffsets[0]! + arm64.length + 16 + 36 * 16,
    );
    expect(messageOf(bytes)).toBe(
      "MyApp (arm64) is truncated: its symbol table runs past the end of its slice.",
    );
  });

  test("a corrupt slice's load commands name its architecture", () => {
    const bytes: Buffer = copyOf(fat.bytes);

    writeUInt32(bytes, fat.sliceOffsets[1]! + 16, 0xffffffff, false);
    expect(messageOf(bytes)).toBe(
      "MyApp (x86_64) is corrupt: it lists 4294967295 load commands, more than the 65536 OneUptime reads.",
    );
  });
});

describe("never reading outside the bytes given", () => {
  const dsym: Buffer = buildAppMachO({ uuid: APP_UUID });

  test("a file in the middle of a larger buffer reads as it does alone", () => {
    const larger: Buffer = Buffer.concat([
      Buffer.alloc(13, 0xee),
      dsym,
      Buffer.alloc(29, 0xee),
    ]);

    expect(
      readMachOSymbolFiles(larger.subarray(13, 13 + dsym.length), "MyApp"),
    ).toEqual([APP_FILE]);
  });

  test("a plain Uint8Array, not a Buffer, reads the same", () => {
    const plain: Uint8Array = new Uint8Array(dsym.length);

    plain.set(dsym);

    expect(Buffer.isBuffer(plain)).toBe(false);
    expect(isMachOFile(plain)).toBe(true);
    expect(readMachOSymbolFiles(plain, "MyApp")).toEqual([APP_FILE]);
  });

  test("a view that ends before the file does is cut short, though the bytes after it are there", () => {
    const larger: Buffer = Buffer.concat([Buffer.alloc(8), dsym]);

    expect(messageOf(larger.subarray(8, 8 + dsym.length - 20))).toBe(
      "MyApp is truncated: its string table runs past the end of the file.",
    );
    expect(messageOf(larger.subarray(8, 8 + 100))).toBe(
      "MyApp is truncated: its load commands run past the end of the file.",
    );
  });

  // What every failure is allowed to say: a sentence about the binary.
  const OWN_MESSAGE: RegExp =
    /^MyApp( \([\w-]+\))? is (truncated|corrupt|not a Mach-O file)[.:]/;

  const checkRead: (bytes: Uint8Array) => void = (bytes: Uint8Array): void => {
    let files: Array<AppleSymbolFile>;

    try {
      files = readMachOSymbolFiles(bytes, "MyApp");
    } catch (error: unknown) {
      expect((error as Error).message).toMatch(OWN_MESSAGE);
      return;
    }

    for (const file of files) {
      expect(file.debugId).toMatch(
        /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/,
      );
      expect(Number.isSafeInteger(file.textEndOffset)).toBe(true);
      expect(file.textEndOffset).toBeGreaterThanOrEqual(0);

      let previous: number = -1;

      for (const symbol of file.symbols) {
        expect(symbol.offset).toBeGreaterThan(previous);
        expect(symbol.offset).toBeLessThan(file.textEndOffset);
        expect(symbol.name.length).toBeGreaterThan(0);
        expect(symbol.name.length).toBeLessThanOrEqual(
          MAX_APPLE_SYMBOL_NAME_LENGTH,
        );
        previous = symbol.offset;
      }
    }
  };

  test("a thin file cut at every length is refused with a sentence, or read", () => {
    for (let length: number = 0; length < dsym.length; length++) {
      checkRead(dsym.subarray(0, length));
    }
  });

  test("a universal file cut at every length is refused with a sentence, or read", () => {
    const fat: Buffer = buildFat([
      {
        cpuType: CPU_TYPE_ARM,
        cpuSubtype: 9,
        bytes: buildArmv7MachO(WATCH_UUID),
        alignment: 2,
      },
      { cpuType: CPU_TYPE_ARM64, cpuSubtype: 0, bytes: dsym, alignment: 3 },
    ]);

    for (let length: number = 0; length < fat.length; length++) {
      checkRead(fat.subarray(0, length));
    }
  });

  test("files with bytes changed at random are refused with a sentence, or read", () => {
    const random: SeededRandom = seededRandom(9922);
    const sources: Array<Buffer> = [
      dsym,
      buildAppMachO({ uuid: APP_UUID, bigEndian: true }),
      buildArmv7MachO(WATCH_UUID),
      buildFat(
        [
          { cpuType: CPU_TYPE_ARM64, cpuSubtype: 0, bytes: dsym, alignment: 3 },
          {
            cpuType: CPU_TYPE_X86_64,
            cpuSubtype: 3,
            bytes: buildSimulatorMachO(SIMULATOR_UUID),
            alignment: 3,
          },
        ],
        { is64: random(2) === 0 },
      ),
    ];

    for (let attempt: number = 0; attempt < 4000; attempt++) {
      const source: Buffer = sources[attempt % sources.length]!;
      const bytes: Buffer = copyOf(source);
      const changes: number = 1 + random(6);
      // Most of the time in the header and load commands, where the offsets are.
      const region: number =
        random(4) === 0 ? bytes.length : Math.min(bytes.length, 1600);

      for (let change: number = 0; change < changes; change++) {
        const at: number = random(region);

        bytes[at] = random(3) === 0 ? 0xff : random(256);
      }

      checkRead(bytes);
    }
  });

  test("a load command's size set to every value near the real one is refused or read", () => {
    const layout: MachOLayout = buildAppMachOLayout({ uuid: APP_UUID });

    for (const command of layout.commands) {
      for (let delta: number = -24; delta <= 24; delta++) {
        const bytes: Buffer = copyOf(layout.bytes);

        writeUInt32(
          bytes,
          command.offset + 4,
          Math.max(0, command.size + delta),
          false,
        );
        checkRead(bytes);
      }
    }

    expect(
      readUInt32(layout.bytes, layout.commands[0]!.offset + 4, false),
    ).toBe(layout.commands[0]!.size);
  });
});
