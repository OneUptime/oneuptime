import zlib from "zlib";
import { AppleSymbol } from "../../../../../Utils/Telemetry/AppleSymbols";

/*
 * MACH-O FILES AND ZIP ARCHIVES, BUILT BYTE BY BYTE FOR THE dSYM READERS.
 *
 * There is no Apple toolchain here, so a test's dSYM is written from its
 * load commands up: the header, segments and their sections, LC_UUID and
 * LC_SYMTAB with its string table - 32 or 64 bits, in either byte order,
 * alone or in a universal (fat) file - and the zips teams ship them in.
 * Each build says where it put what, so a test can break one field.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const MH_MAGIC: number = 0xfeedface;
export const MH_MAGIC_64: number = 0xfeedfacf;
export const FAT_MAGIC: number = 0xcafebabe;
export const FAT_MAGIC_64: number = 0xcafebabf;

export const MH_EXECUTE: number = 0x2;
export const MH_DSYM: number = 0xa;

export const LC_SEGMENT: number = 0x1;
export const LC_SYMTAB: number = 0x2;
export const LC_SEGMENT_64: number = 0x19;
export const LC_UUID: number = 0x1b;
export const LC_BUILD_VERSION: number = 0x32;

export const CPU_TYPE_X86: number = 7;
export const CPU_TYPE_ARM: number = 12;
export const CPU_TYPE_X86_64: number = 0x01000007;
export const CPU_TYPE_ARM64: number = 0x0100000c;
export const CPU_TYPE_ARM64_32: number = 0x0200000c;
export const CPU_TYPE_POWERPC: number = 18;

export const CPU_SUBTYPE_ARM64_ALL: number = 0;
export const CPU_SUBTYPE_ARM64_V8: number = 1;
export const CPU_SUBTYPE_ARM64E: number = 2;
// arm64e binaries set it, with their pointer authentication ABI version.
export const CPU_SUBTYPE_PTRAUTH_ABI: number = 0x80000000;
export const CPU_SUBTYPE_X86_64_ALL: number = 3;
export const CPU_SUBTYPE_X86_64_H: number = 8;
// x86_64 executables set it.
export const CPU_SUBTYPE_LIB64: number = 0x80000000;
export const CPU_SUBTYPE_I386_ALL: number = 3;
export const CPU_SUBTYPE_ARM_V6: number = 6;
export const CPU_SUBTYPE_ARM_V7: number = 9;
export const CPU_SUBTYPE_ARM_V7S: number = 11;
export const CPU_SUBTYPE_ARM_V7K: number = 12;

export const N_UNDF: number = 0x00;
export const N_EXT: number = 0x01;
export const N_ABS: number = 0x02;
export const N_INDR: number = 0x0a;
export const N_PBUD: number = 0x0c;
export const N_SECT: number = 0x0e;
export const N_PEXT: number = 0x10;
// Debugging (STAB) entries.
export const N_GSYM: number = 0x20;
export const N_FUN: number = 0x24;
export const N_BNSYM: number = 0x2e;
export const N_ENSYM: number = 0x4e;
export const N_SO: number = 0x64;
export const N_OSO: number = 0x66;
export const N_ARM_THUMB_DEF: number = 0x0008;

export const S_REGULAR: number = 0x0;
export const S_ZEROFILL: number = 0x1;
export const S_CSTRING_LITERALS: number = 0x2;
export const S_SYMBOL_STUBS: number = 0x8;
export const S_ATTR_PURE_INSTRUCTIONS: number = 0x80000000;
export const S_ATTR_SOME_INSTRUCTIONS: number = 0x400;
export const S_ATTR_DEBUG: number = 0x02000000;
export const CODE: number =
  S_REGULAR | S_ATTR_PURE_INSTRUCTIONS | S_ATTR_SOME_INSTRUCTIONS;

// Where an arm64 or x86_64 iOS app's __TEXT is: after the 4 GiB __PAGEZERO.
export const TEXT_BASE: number = 0x100000000;

export const APP_UUID: string = "70B89F27-1634-3580-A695-57CDB41D7743";
export const APP_ARM64E_UUID: string = "1F0E2D3C-4B5A-6978-8796-A5B4C3D2E1F0";
export const SIMULATOR_UUID: string = "C0FFEE00-1234-4ABC-8DEF-0123456789AB";
export const FRAMEWORK_UUID: string = "5A5A5A5A-0000-1111-2222-333344445555";
export const WATCH_UUID: string = "DEADBEEF-CAFE-F00D-BAAD-0123456789AB";

const TWO_TO_THE_32: number = 4294967296;

// Named, so a call reads UUID_HEX.test(hex): wrap-regex and Prettier disagree on a literal's.
const UUID_HEX: RegExp = /^[0-9a-fA-F]{32}$/;

export interface FixtureSection {
  name: string;
  address: number;
  size: number;
  flags: number;
}

export interface FixtureSegment {
  name: string;
  address: number;
  size: number;
  sections: Array<FixtureSection>;
}

export interface FixtureSymbol {
  // As the string table holds it, underscore and all; "" is n_strx 0.
  name: string;
  type: number;
  section: number;
  value: number;
  description?: number | undefined;
  // An n_strx to write in place of the name's own.
  stringIndex?: number | undefined;
}

export interface FixtureCommand {
  cmd: number;
  payload: Uint8Array;
}

export interface MachOFixture {
  // 64 bits unless false.
  is64?: boolean | undefined;
  // Every field big-endian: the byte-swapped (MH_CIGAM) form.
  bigEndian?: boolean | undefined;
  cpuType: number;
  cpuSubtype: number;
  // MH_DSYM unless given.
  fileType?: number | undefined;
  // 32 hexadecimal digits, dashed or not; null writes no LC_UUID.
  uuid: string | null;
  segments: Array<FixtureSegment>;
  // null writes no LC_SYMTAB.
  symbols: Array<FixtureSymbol> | null;
  /*
   * "dsym" puts LC_UUID and LC_SYMTAB before the segments, as dsymutil
   * writes them; "linker" puts them after, as ld does.
   */
  order?: "dsym" | "linker" | undefined;
  otherCommands?: Array<FixtureCommand> | undefined;
  // Bytes written after the string table.
  trailer?: Uint8Array | undefined;
}

export interface CommandPlace {
  cmd: number;
  offset: number;
  size: number;
}

export interface MachOLayout {
  bytes: Buffer;
  bigEndian: boolean;
  headerSize: number;
  sizeOfCommands: number;
  commands: Array<CommandPlace>;
  // -1 when the file has none.
  uuidCommandOffset: number;
  symtabCommandOffset: number;
  symbolTableOffset: number;
  symbolEntrySize: number;
  stringTableOffset: number;
  stringTableSize: number;
  // Each symbol's n_strx, in the order given.
  stringIndexes: Array<number>;
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

export function writeUInt16(
  buffer: Uint8Array,
  offset: number,
  value: number,
  bigEndian: boolean,
): void {
  const view: DataView = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );

  view.setUint16(offset, value & 0xffff, !bigEndian);
}

export function writeUInt32(
  buffer: Uint8Array,
  offset: number,
  value: number,
  bigEndian: boolean,
): void {
  const view: DataView = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );

  view.setUint32(offset, value >>> 0, !bigEndian);
}

export function writeUInt64(
  buffer: Uint8Array,
  offset: number,
  value: number,
  bigEndian: boolean,
): void {
  const high: number = Math.floor(value / TWO_TO_THE_32);
  const low: number = value - high * TWO_TO_THE_32;

  if (bigEndian) {
    writeUInt32(buffer, offset, high, true);
    writeUInt32(buffer, offset + 4, low, true);
  } else {
    writeUInt32(buffer, offset, low, false);
    writeUInt32(buffer, offset + 4, high, false);
  }
}

export function readUInt32(
  buffer: Uint8Array,
  offset: number,
  bigEndian: boolean,
): number {
  return new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  ).getUint32(offset, !bigEndian);
}

// A segment's or section's name, NUL-padded to 16 bytes.
function writeFixedName(buffer: Buffer, offset: number, name: string): void {
  buffer.write(name.slice(0, 16), offset, "latin1");
}

function uuidBytes(uuid: string): Buffer {
  const hex: string = uuid.split("-").join("");

  if (!UUID_HEX.test(hex)) {
    throw new Error(`A fixture UUID is 32 hexadecimal digits, not ${uuid}.`);
  }

  return Buffer.from(hex, "hex");
}

interface PlannedCommand {
  cmd: number;
  size: number;
  write: (buffer: Buffer, offset: number) => void;
}

// A Mach-O file as the fixture describes it, and where each part of it is.
export function buildMachOLayout(fixture: MachOFixture): MachOLayout {
  const is64: boolean = fixture.is64 !== false;
  const bigEndian: boolean = fixture.bigEndian === true;
  const fileType: number = fixture.fileType ?? MH_DSYM;
  const headerSize: number = is64 ? 32 : 28;
  const segmentHeaderSize: number = is64 ? 72 : 56;
  const sectionSize: number = is64 ? 80 : 68;
  const entrySize: number = is64 ? 16 : 12;
  const alignment: number = is64 ? 8 : 4;
  const symbols: Array<FixtureSymbol> = fixture.symbols || [];

  // " \0" first, as ld64 writes it, then each name once.
  const stringParts: Array<Buffer> = [Buffer.from(" \0", "latin1")];
  const indexOfName: Map<string, number> = new Map<string, number>();
  const stringIndexes: Array<number> = [];
  let stringLength: number = 2;

  for (const symbol of symbols) {
    if (symbol.stringIndex !== undefined) {
      stringIndexes.push(symbol.stringIndex);
      continue;
    }

    if (symbol.name === "") {
      stringIndexes.push(0);
      continue;
    }

    let index: number | undefined = indexOfName.get(symbol.name);

    if (index === undefined) {
      const encoded: Buffer = Buffer.from(`${symbol.name}\0`, "utf8");

      index = stringLength;
      stringParts.push(encoded);
      stringLength += encoded.length;
      indexOfName.set(symbol.name, index);
    }

    stringIndexes.push(index);
  }

  stringParts.push(
    Buffer.alloc(alignUp(stringLength, alignment) - stringLength),
  );

  const stringTable: Buffer = Buffer.concat(stringParts);

  const place: {
    symbolTableOffset: number;
    stringTableOffset: number;
  } = { symbolTableOffset: 0, stringTableOffset: 0 };

  const segmentCommands: Array<PlannedCommand> = fixture.segments.map(
    (segment: FixtureSegment): PlannedCommand => {
      return {
        cmd: is64 ? LC_SEGMENT_64 : LC_SEGMENT,
        size: segmentHeaderSize + segment.sections.length * sectionSize,
        write: (buffer: Buffer, offset: number): void => {
          const protection: number = segment.name === "__TEXT" ? 5 : 3;

          writeFixedName(buffer, offset + 8, segment.name);

          if (is64) {
            writeUInt64(buffer, offset + 24, segment.address, bigEndian);
            writeUInt64(buffer, offset + 32, segment.size, bigEndian);
            writeUInt32(buffer, offset + 56, protection, bigEndian);
            writeUInt32(buffer, offset + 60, protection, bigEndian);
            writeUInt32(
              buffer,
              offset + 64,
              segment.sections.length,
              bigEndian,
            );
          } else {
            writeUInt32(buffer, offset + 24, segment.address, bigEndian);
            writeUInt32(buffer, offset + 28, segment.size, bigEndian);
            writeUInt32(buffer, offset + 40, protection, bigEndian);
            writeUInt32(buffer, offset + 44, protection, bigEndian);
            writeUInt32(
              buffer,
              offset + 48,
              segment.sections.length,
              bigEndian,
            );
          }

          segment.sections.forEach(
            (section: FixtureSection, index: number): void => {
              const at: number =
                offset + segmentHeaderSize + index * sectionSize;

              writeFixedName(buffer, at, section.name);
              writeFixedName(buffer, at + 16, segment.name);

              if (is64) {
                writeUInt64(buffer, at + 32, section.address, bigEndian);
                writeUInt64(buffer, at + 40, section.size, bigEndian);
                writeUInt32(buffer, at + 52, 2, bigEndian);
                writeUInt32(buffer, at + 64, section.flags, bigEndian);
              } else {
                writeUInt32(buffer, at + 32, section.address, bigEndian);
                writeUInt32(buffer, at + 36, section.size, bigEndian);
                writeUInt32(buffer, at + 44, 2, bigEndian);
                writeUInt32(buffer, at + 56, section.flags, bigEndian);
              }
            },
          );
        },
      };
    },
  );

  const uuidCommand: Array<PlannedCommand> =
    fixture.uuid === null
      ? []
      : [
          {
            cmd: LC_UUID,
            size: 24,
            write: (buffer: Buffer, offset: number): void => {
              uuidBytes(fixture.uuid as string).copy(buffer, offset + 8);
            },
          },
        ];

  const symtabCommand: Array<PlannedCommand> =
    fixture.symbols === null
      ? []
      : [
          {
            cmd: LC_SYMTAB,
            size: 24,
            write: (buffer: Buffer, offset: number): void => {
              writeUInt32(
                buffer,
                offset + 8,
                place.symbolTableOffset,
                bigEndian,
              );
              writeUInt32(buffer, offset + 12, symbols.length, bigEndian);
              writeUInt32(
                buffer,
                offset + 16,
                place.stringTableOffset,
                bigEndian,
              );
              writeUInt32(buffer, offset + 20, stringTable.length, bigEndian);
            },
          },
        ];

  const otherCommands: Array<PlannedCommand> = (
    fixture.otherCommands || []
  ).map((command: FixtureCommand): PlannedCommand => {
    return {
      cmd: command.cmd,
      size: alignUp(8 + command.payload.length, alignment),
      write: (buffer: Buffer, offset: number): void => {
        buffer.set(command.payload, offset + 8);
      },
    };
  });

  const commands: Array<PlannedCommand> =
    fixture.order === "linker"
      ? [...segmentCommands, ...symtabCommand, ...uuidCommand, ...otherCommands]
      : [
          ...uuidCommand,
          ...otherCommands,
          ...symtabCommand,
          ...segmentCommands,
        ];

  const sizeOfCommands: number = commands.reduce(
    (total: number, command: PlannedCommand): number => {
      return total + command.size;
    },
    0,
  );

  place.symbolTableOffset = alignUp(headerSize + sizeOfCommands, alignment);
  place.stringTableOffset =
    place.symbolTableOffset + symbols.length * entrySize;

  const trailer: Uint8Array = fixture.trailer || new Uint8Array(0);
  const bytes: Buffer = Buffer.alloc(
    place.stringTableOffset + stringTable.length + trailer.length,
  );

  writeUInt32(bytes, 0, is64 ? MH_MAGIC_64 : MH_MAGIC, bigEndian);
  writeUInt32(bytes, 4, fixture.cpuType, bigEndian);
  writeUInt32(bytes, 8, fixture.cpuSubtype, bigEndian);
  writeUInt32(bytes, 12, fileType, bigEndian);
  writeUInt32(bytes, 16, commands.length, bigEndian);
  writeUInt32(bytes, 20, sizeOfCommands, bigEndian);
  // MH_NOUNDEFS | MH_DYLDLINK | MH_TWOLEVEL | MH_PIE, as ld writes an app.
  writeUInt32(bytes, 24, fileType === MH_EXECUTE ? 0x00200085 : 0, bigEndian);

  const places: Array<CommandPlace> = [];
  let offset: number = headerSize;

  for (const command of commands) {
    writeUInt32(bytes, offset, command.cmd, bigEndian);
    writeUInt32(bytes, offset + 4, command.size, bigEndian);
    command.write(bytes, offset);
    places.push({ cmd: command.cmd, offset, size: command.size });
    offset += command.size;
  }

  symbols.forEach((symbol: FixtureSymbol, index: number): void => {
    const entry: number = place.symbolTableOffset + index * entrySize;

    writeUInt32(bytes, entry, stringIndexes[index]!, bigEndian);
    bytes[entry + 4] = symbol.type;
    bytes[entry + 5] = symbol.section;
    writeUInt16(bytes, entry + 6, symbol.description ?? 0, bigEndian);

    if (is64) {
      writeUInt64(bytes, entry + 8, symbol.value, bigEndian);
    } else {
      writeUInt32(bytes, entry + 8, symbol.value, bigEndian);
    }
  });

  stringTable.copy(bytes, place.stringTableOffset);
  bytes.set(trailer, place.stringTableOffset + stringTable.length);

  const offsetOf: (cmd: number) => number = (cmd: number): number => {
    const found: CommandPlace | undefined = places.find(
      (command: CommandPlace): boolean => {
        return command.cmd === cmd;
      },
    );

    return found ? found.offset : -1;
  };

  return {
    bytes,
    bigEndian,
    headerSize,
    sizeOfCommands,
    commands: places,
    uuidCommandOffset: offsetOf(LC_UUID),
    symtabCommandOffset: offsetOf(LC_SYMTAB),
    symbolTableOffset: place.symbolTableOffset,
    symbolEntrySize: entrySize,
    stringTableOffset: place.stringTableOffset,
    stringTableSize: stringTable.length,
    stringIndexes,
  };
}

export function buildMachO(fixture: MachOFixture): Buffer {
  return buildMachOLayout(fixture).bytes;
}

// LC_BUILD_VERSION for iOS 15: a command the readers pass over.
export function buildVersionCommand(): FixtureCommand {
  const payload: Buffer = Buffer.alloc(16);

  payload.writeUInt32LE(2, 0);
  payload.writeUInt32LE(0x000f0000, 4);
  payload.writeUInt32LE(0x00110000, 8);

  return { cmd: LC_BUILD_VERSION, payload };
}

export interface FatSlice {
  cpuType: number;
  cpuSubtype: number;
  bytes: Uint8Array;
  // As a power of two: 14 (16 KiB) unless given.
  alignment?: number | undefined;
}

export interface FatLayout {
  bytes: Buffer;
  sliceOffsets: Array<number>;
  entrySize: number;
}

// A universal file of the slices, its header and list of architectures big-endian.
export function buildFatLayout(
  slices: Array<FatSlice>,
  options: { is64?: boolean | undefined } = {},
): FatLayout {
  const is64: boolean = options.is64 === true;
  const entrySize: number = is64 ? 32 : 20;
  const sliceOffsets: Array<number> = [];
  let end: number = 8 + slices.length * entrySize;

  for (const slice of slices) {
    end = alignUp(end, 2 ** (slice.alignment ?? 14));
    sliceOffsets.push(end);
    end += slice.bytes.length;
  }

  const bytes: Buffer = Buffer.alloc(end);

  writeUInt32(bytes, 0, is64 ? FAT_MAGIC_64 : FAT_MAGIC, true);
  writeUInt32(bytes, 4, slices.length, true);

  slices.forEach((slice: FatSlice, index: number): void => {
    const entry: number = 8 + index * entrySize;
    const offset: number = sliceOffsets[index]!;

    writeUInt32(bytes, entry, slice.cpuType, true);
    writeUInt32(bytes, entry + 4, slice.cpuSubtype, true);

    if (is64) {
      writeUInt64(bytes, entry + 8, offset, true);
      writeUInt64(bytes, entry + 16, slice.bytes.length, true);
      writeUInt32(bytes, entry + 24, slice.alignment ?? 14, true);
    } else {
      writeUInt32(bytes, entry + 8, offset, true);
      writeUInt32(bytes, entry + 12, slice.bytes.length, true);
      writeUInt32(bytes, entry + 16, slice.alignment ?? 14, true);
    }

    bytes.set(slice.bytes, offset);
  });

  return { bytes, sliceOffsets, entrySize };
}

export function buildFat(
  slices: Array<FatSlice>,
  options: { is64?: boolean | undefined } = {},
): Buffer {
  return buildFatLayout(slices, options).bytes;
}

/*
 * AN iOS APP'S dSYM, AS A TEST READS IT.
 *
 * __TEXT at 0x100000000 with __text (section 1) and __stubs (2), which
 * hold instructions, then __cstring (3) and __unwind_info (4), which do
 * not; __DATA's __data (5) and __bss (6); a dSYM's __DWARF last. Its
 * symbol table has every kind of entry: debugging (STAB) ones, local and
 * external functions, names shared by two functions, aliases at one
 * address, symbols that are not functions or not defined here, and ones
 * outside the code.
 */
export const APP_TEXT_END_OFFSET: number = 0x5060;

function text(offset: number): number {
  return TEXT_BASE + offset;
}

export function appSegments(): Array<FixtureSegment> {
  return [
    { name: "__PAGEZERO", address: 0, size: TEXT_BASE, sections: [] },
    {
      name: "__TEXT",
      address: TEXT_BASE,
      size: 0x8000,
      sections: [
        { name: "__text", address: text(0x4000), size: 0x1000, flags: CODE },
        {
          name: "__stubs",
          address: text(0x5000),
          size: 0x60,
          flags: S_SYMBOL_STUBS | CODE,
        },
        {
          name: "__cstring",
          address: text(0x5060),
          size: 0x200,
          flags: S_CSTRING_LITERALS,
        },
        {
          name: "__unwind_info",
          address: text(0x5260),
          size: 0x100,
          flags: S_REGULAR,
        },
      ],
    },
    {
      name: "__DATA",
      address: text(0x8000),
      size: 0x4000,
      sections: [
        { name: "__data", address: text(0x8000), size: 0x100, flags: 0 },
        {
          name: "__bss",
          address: text(0x8100),
          size: 0x80,
          flags: S_ZEROFILL,
        },
      ],
    },
    { name: "__LINKEDIT", address: text(0xc000), size: 0x4000, sections: [] },
  ];
}

// What dsymutil adds: the debug information, in sections of its own.
export function dwarfSegment(): FixtureSegment {
  return {
    name: "__DWARF",
    address: text(0x10000),
    size: 0x10000,
    sections: [
      {
        name: "__debug_line",
        address: text(0x10000),
        size: 0x4000,
        flags: S_ATTR_DEBUG,
      },
      {
        name: "__debug_info",
        address: text(0x14000),
        size: 0x8000,
        flags: S_ATTR_DEBUG,
      },
    ],
  };
}

export function appSymbols(): Array<FixtureSymbol> {
  const swiftCheckout: string = "_$s5MyApp18CartViewControllerC8checkoutyyF";

  return [
    // Debugging entries, some with a section and an address in the code.
    { name: "/Users/dev/MyApp/", type: N_SO, section: 0, value: 0 },
    {
      name: "/Users/dev/MyApp/build/CartViewController.o",
      type: N_OSO,
      section: 0,
      value: 0,
    },
    { name: "_stab_begin", type: N_BNSYM, section: 1, value: text(0x4f00) },
    { name: swiftCheckout, type: N_FUN, section: 1, value: text(0x4200) },
    { name: "_stab_end", type: N_ENSYM, section: 1, value: text(0x4f10) },
    { name: "_gGlobal", type: N_GSYM, section: 5, value: text(0x8000) },
    // Functions, local and external, in no order.
    { name: swiftCheckout, type: N_SECT, section: 1, value: text(0x4200) },
    {
      name: "-[CartViewController checkout]",
      type: N_SECT,
      section: 1,
      value: text(0x4100),
    },
    { name: "_main", type: N_SECT | N_EXT, section: 1, value: text(0x4000) },
    {
      name: "__ZN3foo3barEv",
      type: N_SECT | N_EXT,
      section: 1,
      value: text(0x4300),
    },
    // An external name wins over a local one listed first.
    {
      name: "_checkout_local_alias",
      type: N_SECT,
      section: 1,
      value: text(0x4400),
    },
    {
      name: "_checkout",
      type: N_SECT | N_EXT,
      section: 1,
      value: text(0x4400),
    },
    // Of two locals, or two externals, the first wins.
    { name: "_first_local", type: N_SECT, section: 1, value: text(0x4500) },
    { name: "_second_local", type: N_SECT, section: 1, value: text(0x4500) },
    {
      name: "_first_external",
      type: N_SECT | N_EXT,
      section: 1,
      value: text(0x4600),
    },
    {
      name: "_second_external",
      type: N_SECT | N_EXT,
      section: 1,
      value: text(0x4600),
    },
    {
      name: "_external_then_local",
      type: N_SECT | N_EXT,
      section: 1,
      value: text(0x4700),
    },
    {
      name: "_local_after_external",
      type: N_SECT,
      section: 1,
      value: text(0x4700),
    },
    // A private external: a function of the binary too.
    {
      name: "_private_extern_function",
      type: N_PEXT | N_SECT,
      section: 1,
      value: text(0x4800),
    },
    // No name: n_strx 0, and a lone underscore.
    { name: "", type: N_SECT, section: 1, value: text(0x4900) },
    { name: "_", type: N_SECT, section: 1, value: text(0x4a00) },
    // One name for two functions, written once in the string table.
    {
      name: "_OUTLINED_FUNCTION_0",
      type: N_SECT,
      section: 1,
      value: text(0x4b00),
    },
    {
      name: "_OUTLINED_FUNCTION_0",
      type: N_SECT,
      section: 1,
      value: text(0x4c00),
    },
    // In __stubs, which holds instructions too.
    {
      name: "_objc_msgSend$checkout",
      type: N_SECT,
      section: 2,
      value: text(0x5000),
    },
    // Not functions: a string, data, zero-fill, unwind information.
    { name: "_kGreeting", type: N_SECT, section: 3, value: text(0x5060) },
    {
      name: "_gCartCount",
      type: N_SECT | N_EXT,
      section: 5,
      value: text(0x8000),
    },
    { name: "_gCache", type: N_SECT, section: 6, value: text(0x8100) },
    { name: "_unwind", type: N_SECT, section: 4, value: text(0x5260) },
    // Not defined in a section of this binary.
    { name: "_printf", type: N_UNDF | N_EXT, section: 0, value: 0 },
    {
      name: "_absolute",
      type: N_ABS | N_EXT,
      section: 0,
      value: text(0x4d00),
    },
    { name: "_indirect", type: N_INDR | N_EXT, section: 0, value: 0 },
    { name: "_prebound", type: N_PBUD | N_EXT, section: 0, value: 0 },
    // Outside the code: before __TEXT, at its end, in no section there is.
    {
      name: "_before_text",
      type: N_SECT,
      section: 1,
      value: TEXT_BASE - 0x10,
    },
    {
      name: "_at_text_end",
      type: N_SECT,
      section: 2,
      value: text(APP_TEXT_END_OFFSET),
    },
    {
      name: "_no_such_section",
      type: N_SECT,
      section: 200,
      value: text(0x4e00),
    },
  ];
}

// What the readers make of appSymbols().
export const APP_SYMBOLS: ReadonlyArray<AppleSymbol> = [
  { offset: 0x4000, name: "main" },
  { offset: 0x4100, name: "-[CartViewController checkout]" },
  { offset: 0x4200, name: "$s5MyApp18CartViewControllerC8checkoutyyF" },
  { offset: 0x4300, name: "_ZN3foo3barEv" },
  { offset: 0x4400, name: "checkout" },
  { offset: 0x4500, name: "first_local" },
  { offset: 0x4600, name: "first_external" },
  { offset: 0x4700, name: "external_then_local" },
  { offset: 0x4800, name: "private_extern_function" },
  { offset: 0x4b00, name: "OUTLINED_FUNCTION_0" },
  { offset: 0x4c00, name: "OUTLINED_FUNCTION_0" },
  { offset: 0x5000, name: "objc_msgSend$checkout" },
];

export interface AppMachOOptions {
  uuid: string | null;
  cpuType?: number | undefined;
  cpuSubtype?: number | undefined;
  fileType?: number | undefined;
  bigEndian?: boolean | undefined;
  order?: "dsym" | "linker" | undefined;
}

// The app's dSYM (or, with MH_EXECUTE, its executable) for arm64.
export function buildAppMachOLayout(options: AppMachOOptions): MachOLayout {
  const fileType: number = options.fileType ?? MH_DSYM;

  return buildMachOLayout({
    bigEndian: options.bigEndian,
    cpuType: options.cpuType ?? CPU_TYPE_ARM64,
    cpuSubtype: options.cpuSubtype ?? CPU_SUBTYPE_ARM64_ALL,
    fileType,
    uuid: options.uuid,
    segments:
      fileType === MH_DSYM ? [...appSegments(), dwarfSegment()] : appSegments(),
    symbols: appSymbols(),
    order: options.order ?? (fileType === MH_DSYM ? "dsym" : "linker"),
    otherCommands: [buildVersionCommand()],
  });
}

export function buildAppMachO(options: AppMachOOptions): Buffer {
  return buildAppMachOLayout(options).bytes;
}

// The app built for the x86_64 simulator.
export const SIMULATOR_TEXT_END_OFFSET: number = 0x3f90;

export const SIMULATOR_SYMBOLS: ReadonlyArray<AppleSymbol> = [
  { offset: 0x3f00, name: "main" },
  { offset: 0x3f40, name: "$s5MyApp3runyyF" },
  { offset: 0x3f80, name: "swift_retain$stub" },
];

export function buildSimulatorMachO(
  uuid: string | null,
  bigEndian: boolean = false,
): Buffer {
  return buildMachO({
    bigEndian,
    cpuType: CPU_TYPE_X86_64,
    cpuSubtype: CPU_SUBTYPE_X86_64_ALL,
    uuid,
    segments: [
      { name: "__PAGEZERO", address: 0, size: TEXT_BASE, sections: [] },
      {
        name: "__TEXT",
        address: TEXT_BASE,
        size: 0x4000,
        sections: [
          { name: "__text", address: text(0x3f00), size: 0x80, flags: CODE },
          {
            name: "__stubs",
            address: text(0x3f80),
            size: 0x10,
            flags: S_SYMBOL_STUBS | CODE,
          },
          {
            name: "__cstring",
            address: text(0x3f90),
            size: 0x40,
            flags: S_CSTRING_LITERALS,
          },
        ],
      },
    ],
    symbols: [
      {
        name: "_$s5MyApp3runyyF",
        type: N_SECT,
        section: 1,
        value: text(0x3f40),
      },
      { name: "_main", type: N_SECT | N_EXT, section: 1, value: text(0x3f00) },
      {
        name: "_swift_retain$stub",
        type: N_SECT,
        section: 2,
        value: text(0x3f80),
      },
      { name: "_swift_retain", type: N_UNDF | N_EXT, section: 0, value: 0 },
    ],
  });
}

/*
 * A 32-bit armv7 dSYM: LC_SEGMENT, 12-byte nlist entries, __TEXT at
 * 0x4000 and Thumb functions (N_ARM_THUMB_DEF, their n_value even).
 */
export const ARMV7_TEXT_BASE: number = 0x4000;
export const ARMV7_TEXT_END_OFFSET: number = 0x1840;

export const ARMV7_SYMBOLS: ReadonlyArray<AppleSymbol> = [
  { offset: 0x1000, name: "main" },
  {
    offset: 0x1100,
    name: "-[AppDelegate application:didFinishLaunchingWithOptions:]",
  },
  { offset: 0x1200, name: "arm_mode_function" },
  { offset: 0x1800, name: "objc_msgSend$stub" },
];

export function buildArmv7MachOLayout(
  uuid: string | null,
  options: { bigEndian?: boolean | undefined; cpuSubtype?: number } = {},
): MachOLayout {
  return buildMachOLayout({
    is64: false,
    bigEndian: options.bigEndian,
    cpuType: CPU_TYPE_ARM,
    cpuSubtype: options.cpuSubtype ?? CPU_SUBTYPE_ARM_V7,
    uuid,
    segments: [
      { name: "__PAGEZERO", address: 0, size: ARMV7_TEXT_BASE, sections: [] },
      {
        name: "__TEXT",
        address: ARMV7_TEXT_BASE,
        size: 0x4000,
        sections: [
          { name: "__text", address: 0x5000, size: 0x800, flags: CODE },
          {
            name: "__symbolstub1",
            address: 0x5800,
            size: 0x40,
            flags: S_SYMBOL_STUBS | CODE,
          },
          {
            name: "__cstring",
            address: 0x5840,
            size: 0x100,
            flags: S_CSTRING_LITERALS,
          },
        ],
      },
      {
        name: "__DATA",
        address: 0x8000,
        size: 0x1000,
        sections: [{ name: "__data", address: 0x8000, size: 0x40, flags: 0 }],
      },
    ],
    symbols: [
      { name: "/Users/dev/Watch/", type: N_SO, section: 0, value: 0 },
      {
        name: "_main",
        type: N_SECT | N_EXT,
        section: 1,
        value: 0x5000,
        description: N_ARM_THUMB_DEF,
      },
      {
        name: "-[AppDelegate application:didFinishLaunchingWithOptions:]",
        type: N_SECT,
        section: 1,
        value: 0x5100,
        description: N_ARM_THUMB_DEF,
      },
      { name: "_arm_mode_function", type: N_SECT, section: 1, value: 0x5200 },
      { name: "_objc_msgSend$stub", type: N_SECT, section: 2, value: 0x5800 },
      { name: "_kTitle", type: N_SECT, section: 3, value: 0x5840 },
      { name: "_gState", type: N_SECT | N_EXT, section: 4, value: 0x8000 },
      { name: "_objc_msgSend", type: N_UNDF | N_EXT, section: 0, value: 0 },
    ],
  });
}

export function buildArmv7MachO(
  uuid: string | null,
  options: { bigEndian?: boolean | undefined; cpuSubtype?: number } = {},
): Buffer {
  return buildArmv7MachOLayout(uuid, options).bytes;
}

// A dSYM of one function, for the tests that look at one field.
export function buildTinyMachO(data: {
  cpuType: number;
  cpuSubtype: number;
  uuid?: string | null | undefined;
  is64?: boolean | undefined;
  bigEndian?: boolean | undefined;
}): Buffer {
  const is64: boolean = data.is64 !== false;
  const base: number = is64 ? TEXT_BASE : ARMV7_TEXT_BASE;

  return buildMachO({
    is64,
    bigEndian: data.bigEndian,
    cpuType: data.cpuType,
    cpuSubtype: data.cpuSubtype,
    uuid: data.uuid === undefined ? APP_UUID : data.uuid,
    segments: [
      {
        name: "__TEXT",
        address: base,
        size: 0x2000,
        sections: [
          { name: "__text", address: base + 0x1000, size: 0x100, flags: CODE },
        ],
      },
    ],
    symbols: [
      {
        name: "_main",
        type: N_SECT | N_EXT,
        section: 1,
        value: base + 0x1000,
      },
    ],
  });
}

/*
 * A dSYM whose symbol table lists `count` functions, all named "f", at
 * 0x4000, 0x4004, ... from __TEXT - written in the reverse order.
 */
export function buildManySymbolsMachO(count: number): Buffer {
  const layout: MachOLayout = buildMachOLayout({
    cpuType: CPU_TYPE_ARM64,
    cpuSubtype: CPU_SUBTYPE_ARM64_ALL,
    uuid: APP_UUID,
    segments: [
      { name: "__PAGEZERO", address: 0, size: TEXT_BASE, sections: [] },
      {
        name: "__TEXT",
        address: TEXT_BASE,
        size: 0x4000 + count * 4,
        sections: [
          {
            name: "__text",
            address: text(0x4000),
            size: count * 4,
            flags: CODE,
          },
        ],
      },
    ],
    symbols: [],
  });
  const strings: Buffer = Buffer.from(" \0_f\0\0\0\0", "latin1");
  const table: Buffer = Buffer.alloc(count * 16);

  for (let index: number = 0; index < count; index++) {
    const entry: number = index * 16;

    table.writeUInt32LE(2, entry);
    table[entry + 4] = N_SECT | N_EXT;
    table[entry + 5] = 1;
    writeUInt64(
      table,
      entry + 8,
      text(0x4000 + (count - 1 - index) * 4),
      false,
    );
  }

  const bytes: Buffer = Buffer.concat([layout.bytes, table, strings]);
  const symtab: number = layout.symtabCommandOffset;

  writeUInt32(bytes, symtab + 8, layout.bytes.length, false);
  writeUInt32(bytes, symtab + 12, count, false);
  writeUInt32(bytes, symtab + 16, layout.bytes.length + table.length, false);
  writeUInt32(bytes, symtab + 20, strings.length, false);

  return bytes;
}

// What Finder's Compress puts in __MACOSX: an AppleDouble file, not Mach-O.
export function appleDoubleBytes(): Buffer {
  const bytes: Buffer = Buffer.alloc(82);

  bytes.writeUInt32BE(0x00051607, 0);
  bytes.writeUInt32BE(0x00020000, 4);
  bytes.write("Mac OS X        ", 8, "latin1");

  return bytes;
}

/*
 * ZIP ARCHIVES: local headers, the central directory and its end record -
 * ZIP64 too - with stored or deflated entries and the ways an archive can
 * lie about them.
 */
export interface ZipFixtureEntry {
  name: string;
  // Absent for a folder, whose name ends with "/".
  data?: Uint8Array | string | undefined;
  // Deflated unless "store".
  method?: "store" | "deflate" | undefined;
  // A compression method to write in place of the one used.
  methodNumber?: number | undefined;
  flags?: number | undefined;
  // Leave the UTF-8 name flag (bit 11) off, as macOS's zip does.
  withoutUtf8Flag?: boolean | undefined;
  // The name as written, when it is not the name's UTF-8.
  nameBytes?: Uint8Array | undefined;
  declaredUncompressedSize?: number | undefined;
  declaredCompressedSize?: number | undefined;
  crc?: number | undefined;
  localExtra?: Uint8Array | undefined;
  centralExtra?: Uint8Array | undefined;
}

export interface ZipFixtureOptions {
  // Sizes and offsets in ZIP64 extra fields, and ZIP64 end records.
  zip64?: boolean | undefined;
  comment?: Uint8Array | string | undefined;
  declaredEntryCount?: number | undefined;
}

export interface ZipLayout {
  bytes: Buffer;
  localHeaderOffsets: Array<number>;
  centralHeaderOffsets: Array<number>;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  endOffset: number;
  // -1 unless the archive is ZIP64.
  zip64EndOffset: number;
  zip64LocatorOffset: number;
}

function toBytes(data: Uint8Array | string): Buffer {
  return typeof data === "string"
    ? Buffer.from(data, "utf8")
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

// A ZIP64 extended information extra field (0x0001) of the values given.
export function zip64Field(values: Array<number>): Buffer {
  const field: Buffer = Buffer.alloc(4 + values.length * 8);

  field.writeUInt16LE(0x0001, 0);
  field.writeUInt16LE(values.length * 8, 2);
  values.forEach((value: number, index: number): void => {
    writeUInt64(field, 4 + index * 8, value, false);
  });

  return field;
}

export function buildZipLayout(
  entries: Array<ZipFixtureEntry>,
  options: ZipFixtureOptions = {},
): ZipLayout {
  const zip64: boolean = options.zip64 === true;
  const marker: number = 0xffffffff;
  const locals: Array<Buffer> = [];
  const centrals: Array<Buffer> = [];
  const localHeaderOffsets: Array<number> = [];
  const centralHeaderOffsets: Array<number> = [];
  let offset: number = 0;
  let centralLength: number = 0;

  for (const entry of entries) {
    const isFolder: boolean = entry.data === undefined;
    const raw: Buffer = isFolder ? Buffer.alloc(0) : toBytes(entry.data!);
    const isDeflated: boolean = !isFolder && entry.method !== "store";
    const compressed: Buffer = isDeflated ? zlib.deflateRawSync(raw) : raw;
    const method: number = entry.methodNumber ?? (isDeflated ? 8 : 0);
    const name: Buffer = entry.nameBytes
      ? toBytes(entry.nameBytes)
      : Buffer.from(entry.name, "utf8");
    const flags: number =
      (entry.flags ?? 0) | (entry.withoutUtf8Flag ? 0 : 0x0800);
    const crc: number = entry.crc ?? zlib.crc32(raw);
    const uncompressedSize: number =
      entry.declaredUncompressedSize ?? raw.length;
    const compressedSize: number =
      entry.declaredCompressedSize ?? compressed.length;
    const version: number = zip64 ? 45 : 20;

    const localExtra: Buffer = Buffer.concat([
      zip64 ? zip64Field([uncompressedSize, compressedSize]) : Buffer.alloc(0),
      entry.localExtra ? toBytes(entry.localExtra) : Buffer.alloc(0),
    ]);
    const local: Buffer = Buffer.alloc(30);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(version, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x6000, 10);
    local.writeUInt16LE(0x5974, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(zip64 ? marker : compressedSize, 18);
    local.writeUInt32LE(zip64 ? marker : uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);

    const localRecord: Buffer = Buffer.concat([
      local,
      name,
      localExtra,
      compressed,
    ]);

    localHeaderOffsets.push(offset);
    locals.push(localRecord);

    const centralExtra: Buffer = Buffer.concat([
      zip64
        ? zip64Field([uncompressedSize, compressedSize, offset])
        : Buffer.alloc(0),
      entry.centralExtra ? toBytes(entry.centralExtra) : Buffer.alloc(0),
    ]);
    const central: Buffer = Buffer.alloc(46);

    central.writeUInt32LE(0x02014b50, 0);
    // Made by Unix, zip 3.0.
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(version, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0x6000, 12);
    central.writeUInt16LE(0x5974, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(zip64 ? marker : compressedSize, 20);
    central.writeUInt32LE(zip64 ? marker : uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt32LE(
      (isFolder ? 0o40755 * 65536 + 0x10 : 0o100644 * 65536) >>> 0,
      38,
    );
    central.writeUInt32LE(zip64 ? marker : offset, 42);

    const centralRecord: Buffer = Buffer.concat([central, name, centralExtra]);

    centralHeaderOffsets.push(centralLength);
    centrals.push(centralRecord);
    centralLength += centralRecord.length;
    offset += localRecord.length;
  }

  const centralDirectoryOffset: number = offset;
  const directory: Buffer = Buffer.concat(centrals);
  const count: number = options.declaredEntryCount ?? entries.length;
  const comment: Buffer = options.comment
    ? toBytes(options.comment)
    : Buffer.alloc(0);
  const tail: Array<Buffer> = [];
  let zip64EndOffset: number = -1;
  let zip64LocatorOffset: number = -1;

  if (zip64) {
    const record: Buffer = Buffer.alloc(56);

    zip64EndOffset = centralDirectoryOffset + directory.length;
    record.writeUInt32LE(0x06064b50, 0);
    writeUInt64(record, 4, 44, false);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    writeUInt64(record, 24, count, false);
    writeUInt64(record, 32, count, false);
    writeUInt64(record, 40, directory.length, false);
    writeUInt64(record, 48, centralDirectoryOffset, false);

    const locator: Buffer = Buffer.alloc(20);

    zip64LocatorOffset = zip64EndOffset + record.length;
    locator.writeUInt32LE(0x07064b50, 0);
    writeUInt64(locator, 8, zip64EndOffset, false);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }

  const end: Buffer = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : Math.min(count, 0xffff), 8);
  end.writeUInt16LE(zip64 ? 0xffff : Math.min(count, 0xffff), 10);
  end.writeUInt32LE(zip64 ? marker : directory.length, 12);
  end.writeUInt32LE(zip64 ? marker : centralDirectoryOffset, 16);
  end.writeUInt16LE(comment.length, 20);

  const bytes: Buffer = Buffer.concat([
    ...locals,
    directory,
    ...tail,
    end,
    comment,
  ]);

  return {
    bytes,
    localHeaderOffsets,
    centralHeaderOffsets: centralHeaderOffsets.map(
      (relative: number): number => {
        return centralDirectoryOffset + relative;
      },
    ),
    centralDirectoryOffset,
    centralDirectorySize: directory.length,
    endOffset: bytes.length - comment.length - end.length,
    zip64EndOffset,
    zip64LocatorOffset,
  };
}

export function buildZip(
  entries: Array<ZipFixtureEntry>,
  options: ZipFixtureOptions = {},
): Buffer {
  return buildZipLayout(entries, options).bytes;
}

// A dSYM bundle's files, as a zip holds them, under `prefix`.
export function dsymBundleEntries(data: {
  prefix?: string | undefined;
  bundle: string;
  binary: string;
  dwarf: Uint8Array;
  method?: "store" | "deflate" | undefined;
}): Array<ZipFixtureEntry> {
  const root: string = `${data.prefix ?? ""}${data.bundle}/`;

  return [
    { name: root },
    { name: `${root}Contents/` },
    {
      name: `${root}Contents/Info.plist`,
      data: '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.apple.xcode.dsym.com.example.MyApp</string></dict></plist>',
    },
    { name: `${root}Contents/Resources/` },
    { name: `${root}Contents/Resources/DWARF/` },
    {
      name: `${root}Contents/Resources/DWARF/${data.binary}`,
      data: data.dwarf,
      method: data.method,
    },
  ];
}
