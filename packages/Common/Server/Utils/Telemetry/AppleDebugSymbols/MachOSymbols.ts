import {
  AppleSymbol,
  AppleSymbolFile,
  MAX_APPLE_SYMBOLS,
  MAX_APPLE_SYMBOL_NAME_LENGTH,
  normalizeAppleDebugId,
} from "../../../../Utils/Telemetry/AppleSymbols";

/*
 * AN APPLE BINARY'S FUNCTION SYMBOLS, READ FROM ITS MACH-O FILE (#9922).
 *
 * A dSYM's DWARF file is a Mach-O file (MH_DSYM) holding the symbol table of
 * the build it was made for; an executable that is not stripped holds one
 * too. Per architecture this reads the UUID (LC_UUID), where __TEXT is
 * loaded (the base every offset is measured from), which sections hold
 * instructions, and the function symbols of the symbol table, as
 * AppleSymbols.ts keeps them. A universal (fat) file is read slice by slice.
 *
 * The bytes are not trusted: every offset and size is checked against the
 * bytes of the file (or of its slice) before it is read, and the counts a
 * file gives are capped. A file that is not Mach-O, is cut short or is
 * corrupt is refused with an Error that says which.
 */

const MH_MAGIC: number = 0xfeedface;
const MH_CIGAM: number = 0xcefaedfe;
const MH_MAGIC_64: number = 0xfeedfacf;
const MH_CIGAM_64: number = 0xcffaedfe;
const FAT_MAGIC: number = 0xcafebabe;
const FAT_MAGIC_64: number = 0xcafebabf;

/*
 * Java class files start with 0xcafebabe too, followed by their version (45
 * and up). Like file(1) and LLVM, a universal binary is one that lists fewer
 * than 43 architectures.
 */
const MAX_FAT_ARCHITECTURES: number = 42;

const LC_SEGMENT: number = 0x1;
const LC_SYMTAB: number = 0x2;
const LC_SEGMENT_64: number = 0x19;
const LC_UUID: number = 0x1b;

const FAT_HEADER_SIZE: number = 8;
const FAT_ARCH_SIZE: number = 20;
const FAT_ARCH_64_SIZE: number = 32;
const MACH_HEADER_SIZE: number = 28;
const MACH_HEADER_64_SIZE: number = 32;
const LOAD_COMMAND_SIZE: number = 8;
const UUID_COMMAND_SIZE: number = 24;
const UUID_SIZE: number = 16;
const SYMTAB_COMMAND_SIZE: number = 24;
const SEGMENT_COMMAND_SIZE: number = 56;
const SEGMENT_COMMAND_64_SIZE: number = 72;
const SECTION_SIZE: number = 68;
const SECTION_64_SIZE: number = 80;
const SEGMENT_NAME_SIZE: number = 16;
const NLIST_SIZE: number = 12;
const NLIST_64_SIZE: number = 16;

const N_STAB: number = 0xe0;
const N_TYPE: number = 0x0e;
const N_SECT: number = 0x0e;
const N_EXT: number = 0x01;

const S_ATTR_PURE_INSTRUCTIONS: number = 0x80000000;
const S_ATTR_SOME_INSTRUCTIONS: number = 0x400;

// n_sect is one byte: 1 to 255 name a section, 0 (NO_SECT) none.
const MAX_SECTION_NUMBER: number = 255;

const CPU_TYPE_X86: number = 7;
const CPU_TYPE_ARM: number = 12;
const CPU_TYPE_X86_64: number = 0x01000007;
const CPU_TYPE_ARM64: number = 0x0100000c;
const CPU_TYPE_ARM64_32: number = 0x0200000c;
// A cpusubtype's top 8 bits are capabilities (pointer authentication, LIB64).
const CPU_SUBTYPE_MASK: number = 0x00ffffff;
const CPU_SUBTYPE_ARM64E: number = 2;
const CPU_SUBTYPE_X86_64_H: number = 8;

const ARM_ARCHITECTURES: ReadonlyMap<number, string> = new Map<number, string>([
  [6, "armv6"],
  [9, "armv7"],
  [11, "armv7s"],
  [12, "armv7k"],
]);

// The most load commands, and bytes of them, one file may have.
const MAX_LOAD_COMMANDS: number = 65_536;
const MAX_LOAD_COMMAND_BYTES: number = 64 * 1024 * 1024;

// The most entries a symbol table may list; MAX_APPLE_SYMBOLS of them are kept.
const MAX_SYMBOL_TABLE_ENTRIES: number = 16 * 1024 * 1024;

// Bytes enough for the longest name kept, however its UTF-8 is written.
const MAX_NAME_BYTES: number = MAX_APPLE_SYMBOL_NAME_LENGTH * 4;

const UNDERSCORE: number = 0x5f;
const TWO_TO_THE_32: number = 4294967296;

// A 64-bit address or size, as two 32-bit halves: a double cannot hold every one.
interface Address {
  high: number;
  low: number;
}

interface Section {
  address: Address;
  size: Address;
  holdsInstructions: boolean;
}

interface SymbolTableCommand {
  symbolsOffset: number;
  symbolCount: number;
  stringsOffset: number;
  stringsSize: number;
}

interface Slice {
  bytes: Uint8Array;
  view: DataView;
  // Who a message is about: "MyApp", or "MyApp (arm64)" in a universal file.
  label: string;
  // What a message calls the bytes read: "the file", or "its slice".
  whole: string;
}

interface Candidate {
  offset: number;
  stringIndex: number;
  isExternal: boolean;
  // Its place in the symbol table, which decides between equal offsets.
  tableIndex: number;
}

function toView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function isThinMagic(magic: number): boolean {
  return (
    magic === MH_MAGIC ||
    magic === MH_CIGAM ||
    magic === MH_MAGIC_64 ||
    magic === MH_CIGAM_64
  );
}

function isThinMachO(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && isThinMagic(toView(bytes).getUint32(0, true));
}

/*
 * Whether the bytes start like a Mach-O file: thin, in either byte order,
 * or universal.
 */
export function isMachOFile(bytes: Uint8Array): boolean {
  if (bytes.length < 4) {
    return false;
  }

  const view: DataView = toView(bytes);

  if (isThinMagic(view.getUint32(0, true))) {
    return true;
  }

  const fatMagic: number = view.getUint32(0, false);

  if (fatMagic !== FAT_MAGIC && fatMagic !== FAT_MAGIC_64) {
    return false;
  }

  return bytes.length < 8 || view.getUint32(4, false) <= MAX_FAT_ARCHITECTURES;
}

// "arm64", "arm64e", "x86_64", "armv7", ... as Apple's tools name them.
function getArchitectureName(cpuType: number, cpuSubtype: number): string {
  const subtype: number = cpuSubtype & CPU_SUBTYPE_MASK;

  switch (cpuType) {
    case CPU_TYPE_ARM64:
      return subtype === CPU_SUBTYPE_ARM64E ? "arm64e" : "arm64";
    case CPU_TYPE_ARM64_32:
      return "arm64_32";
    case CPU_TYPE_X86_64:
      return subtype === CPU_SUBTYPE_X86_64_H ? "x86_64h" : "x86_64";
    case CPU_TYPE_ARM:
      return ARM_ARCHITECTURES.get(subtype) || "arm";
    case CPU_TYPE_X86:
      return "i386";
    default:
      return `cpu-${cpuType}-${subtype}`;
  }
}

/*
 * A 64-bit value as a number: exact to 2^53, and past it still larger than
 * any buffer, which is all an offset or size needs.
 */
function readUInt64(
  view: DataView,
  offset: number,
  littleEndian: boolean,
): number {
  const address: Address = readAddress(view, offset, littleEndian);

  return address.high * TWO_TO_THE_32 + address.low;
}

function readAddress(
  view: DataView,
  offset: number,
  littleEndian: boolean,
): Address {
  return littleEndian
    ? {
        low: view.getUint32(offset, true),
        high: view.getUint32(offset + 4, true),
      }
    : {
        high: view.getUint32(offset, false),
        low: view.getUint32(offset + 4, false),
      };
}

// How far `to` is past `from`, exact while the distance is below 2^53.
function distance(from: Address, to: Address): number {
  return (to.high - from.high) * TWO_TO_THE_32 + (to.low - from.low);
}

// A segment's or section's name: up to 16 bytes, NUL-padded.
function readFixedName(bytes: Uint8Array, offset: number): string {
  let name: string = "";

  for (let index: number = 0; index < SEGMENT_NAME_SIZE; index++) {
    const byte: number = bytes[offset + index]!;

    if (byte === 0) {
      break;
    }

    name += String.fromCharCode(byte);
  }

  return name;
}

function truncated(slice: Slice, what: string): Error {
  return new Error(`${slice.label} is truncated: ${what}.`);
}

function corrupt(slice: Slice, what: string): Error {
  return new Error(`${slice.label} is corrupt: ${what}.`);
}

/*
 * Every slice of the file that has a UUID and a __TEXT segment, with its
 * function symbols: one for a thin file, one per architecture for a
 * universal one. Throws when the bytes are not a Mach-O file, or are cut
 * short or corrupt.
 */
export function readMachOSymbolFiles(
  bytes: Uint8Array,
  binaryName: string,
): Array<AppleSymbolFile> {
  if (!isMachOFile(bytes)) {
    throw new Error(`${binaryName} is not a Mach-O file.`);
  }

  const view: DataView = toView(bytes);
  const fatMagic: number = view.getUint32(0, false);

  if (fatMagic === FAT_MAGIC || fatMagic === FAT_MAGIC_64) {
    return readUniversalFile({
      bytes,
      view,
      binaryName,
      is64: fatMagic === FAT_MAGIC_64,
    });
  }

  const file: AppleSymbolFile | null = readSlice(
    { bytes, view, label: binaryName, whole: "the file" },
    binaryName,
  );

  return file ? [file] : [];
}

function readUniversalFile(data: {
  bytes: Uint8Array;
  view: DataView;
  binaryName: string;
  is64: boolean;
}): Array<AppleSymbolFile> {
  const bytes: Uint8Array = data.bytes;
  const view: DataView = data.view;
  const binaryName: string = data.binaryName;

  if (bytes.length < FAT_HEADER_SIZE) {
    throw new Error(
      `${binaryName} is truncated: the file ends inside its universal header.`,
    );
  }

  const count: number = view.getUint32(4, false);
  const entrySize: number = data.is64 ? FAT_ARCH_64_SIZE : FAT_ARCH_SIZE;

  if (FAT_HEADER_SIZE + count * entrySize > bytes.length) {
    throw new Error(
      `${binaryName} is truncated: the file ends inside its list of architectures.`,
    );
  }

  const files: Array<AppleSymbolFile> = [];

  for (let index: number = 0; index < count; index++) {
    const entry: number = FAT_HEADER_SIZE + index * entrySize;
    const architecture: string = getArchitectureName(
      view.getUint32(entry, false),
      view.getUint32(entry + 4, false),
    );
    const offset: number = data.is64
      ? readUInt64(view, entry + 8, false)
      : view.getUint32(entry + 8, false);
    const size: number = data.is64
      ? readUInt64(view, entry + 16, false)
      : view.getUint32(entry + 12, false);

    if (offset + size > bytes.length) {
      throw new Error(
        `${binaryName} is truncated: its ${architecture} slice runs past the end of the file.`,
      );
    }

    const sliceBytes: Uint8Array = bytes.subarray(offset, offset + size);

    if (!isThinMachO(sliceBytes)) {
      throw new Error(
        `${binaryName} is corrupt: its ${architecture} slice is not a Mach-O file.`,
      );
    }

    const file: AppleSymbolFile | null = readSlice(
      {
        bytes: sliceBytes,
        view: toView(sliceBytes),
        label: `${binaryName} (${architecture})`,
        whole: "its slice",
      },
      binaryName,
    );

    if (file) {
      files.push(file);
    }
  }

  return files;
}

/*
 * One thin Mach-O file, or one slice of a universal one. Null when it has
 * no UUID or no __TEXT segment: nothing can be looked up in it.
 */
function readSlice(slice: Slice, binaryName: string): AppleSymbolFile | null {
  const bytes: Uint8Array = slice.bytes;
  const view: DataView = slice.view;
  const magic: number = view.getUint32(0, true);
  const is64: boolean = magic === MH_MAGIC_64 || magic === MH_CIGAM_64;
  const littleEndian: boolean = magic === MH_MAGIC || magic === MH_MAGIC_64;
  const headerSize: number = is64 ? MACH_HEADER_64_SIZE : MACH_HEADER_SIZE;

  if (bytes.length < headerSize) {
    throw truncated(slice, `${slice.whole} ends inside its Mach-O header`);
  }

  const cpuType: number = view.getUint32(4, littleEndian);
  const cpuSubtype: number = view.getUint32(8, littleEndian);
  const commandCount: number = view.getUint32(16, littleEndian);
  const commandBytes: number = view.getUint32(20, littleEndian);

  if (commandCount > MAX_LOAD_COMMANDS) {
    throw corrupt(
      slice,
      `it lists ${commandCount} load commands, more than the ${MAX_LOAD_COMMANDS} OneUptime reads`,
    );
  }

  if (commandBytes > MAX_LOAD_COMMAND_BYTES) {
    throw corrupt(
      slice,
      `its load commands take ${commandBytes} bytes, more than the ${MAX_LOAD_COMMAND_BYTES} OneUptime reads`,
    );
  }

  if (headerSize + commandBytes > bytes.length) {
    throw truncated(
      slice,
      `its load commands run past the end of ${slice.whole}`,
    );
  }

  if (commandCount * LOAD_COMMAND_SIZE > commandBytes) {
    throw corrupt(
      slice,
      `it lists ${commandCount} load commands in ${commandBytes} bytes, too few to hold them`,
    );
  }

  const commandsEnd: number = headerSize + commandBytes;
  const sections: Array<Section> = [];
  let uuid: string | null = null;
  let textBase: Address | null = null;
  let symbolTable: SymbolTableCommand | null = null;
  let offset: number = headerSize;

  for (let index: number = 0; index < commandCount; index++) {
    const place: string = `load command ${index + 1} of ${commandCount}`;

    if (offset + LOAD_COMMAND_SIZE > commandsEnd) {
      throw corrupt(slice, `${place} runs past the end of its load commands`);
    }

    const command: number = view.getUint32(offset, littleEndian);
    const commandSize: number = view.getUint32(offset + 4, littleEndian);

    if (commandSize < LOAD_COMMAND_SIZE) {
      throw corrupt(
        slice,
        `${place} says it is ${commandSize} bytes long, too short for a load command`,
      );
    }

    if (offset + commandSize > commandsEnd) {
      throw corrupt(slice, `${place} runs past the end of its load commands`);
    }

    if (command === LC_UUID) {
      if (commandSize < UUID_COMMAND_SIZE) {
        throw corrupt(
          slice,
          `its UUID load command is ${commandSize} bytes long, too short for a UUID`,
        );
      }

      if (uuid === null) {
        uuid = Buffer.from(
          bytes.buffer,
          bytes.byteOffset + offset + 8,
          UUID_SIZE,
        ).toString("hex");
      }
    } else if (command === LC_SEGMENT || command === LC_SEGMENT_64) {
      const segmentBase: Address | null = readSegment({
        slice,
        offset,
        commandSize,
        is64Segment: command === LC_SEGMENT_64,
        littleEndian,
        sections,
      });

      if (textBase === null && segmentBase !== null) {
        textBase = segmentBase;
      }
    } else if (command === LC_SYMTAB) {
      if (commandSize < SYMTAB_COMMAND_SIZE) {
        throw corrupt(
          slice,
          `its symbol table load command is ${commandSize} bytes long, too short for one`,
        );
      }

      if (symbolTable === null) {
        symbolTable = {
          symbolsOffset: view.getUint32(offset + 8, littleEndian),
          symbolCount: view.getUint32(offset + 12, littleEndian),
          stringsOffset: view.getUint32(offset + 16, littleEndian),
          stringsSize: view.getUint32(offset + 20, littleEndian),
        };
      }
    }

    offset += commandSize;
  }

  const debugId: string | null = normalizeAppleDebugId(uuid);

  if (debugId === null || textBase === null) {
    return null;
  }

  const textEndOffset: number = getTextEndOffset(sections, textBase);

  return {
    debugId,
    architecture: getArchitectureName(cpuType, cpuSubtype),
    binaryName,
    symbols: symbolTable
      ? readSymbols({
          slice,
          symbolTable,
          is64,
          littleEndian,
          sections,
          textBase,
          textEndOffset,
        })
      : [],
    textEndOffset,
  };
}

/*
 * Adds a segment's sections to `sections`, in load command order, and
 * returns its vmaddr when it is __TEXT.
 */
function readSegment(data: {
  slice: Slice;
  offset: number;
  commandSize: number;
  is64Segment: boolean;
  littleEndian: boolean;
  sections: Array<Section>;
}): Address | null {
  const slice: Slice = data.slice;
  const view: DataView = slice.view;
  const offset: number = data.offset;
  const littleEndian: boolean = data.littleEndian;
  const headerSize: number = data.is64Segment
    ? SEGMENT_COMMAND_64_SIZE
    : SEGMENT_COMMAND_SIZE;
  const sectionSize: number = data.is64Segment ? SECTION_64_SIZE : SECTION_SIZE;

  if (data.commandSize < headerSize) {
    throw corrupt(
      slice,
      `a segment load command is ${data.commandSize} bytes long, too short for a segment`,
    );
  }

  const name: string = readFixedName(slice.bytes, offset + 8);
  const sectionCount: number = view.getUint32(
    offset + (data.is64Segment ? 64 : 48),
    littleEndian,
  );

  if (headerSize + sectionCount * sectionSize > data.commandSize) {
    throw corrupt(
      slice,
      `its segment ${name} lists ${sectionCount} sections, more than its load command holds`,
    );
  }

  for (let index: number = 0; index < sectionCount; index++) {
    const section: number = offset + headerSize + index * sectionSize;
    const flags: number = view.getUint32(
      section + (data.is64Segment ? 64 : 56),
      littleEndian,
    );

    data.sections.push({
      address: data.is64Segment
        ? readAddress(view, section + 32, littleEndian)
        : { high: 0, low: view.getUint32(section + 32, littleEndian) },
      size: data.is64Segment
        ? readAddress(view, section + 40, littleEndian)
        : { high: 0, low: view.getUint32(section + 36, littleEndian) },
      holdsInstructions:
        (flags & S_ATTR_PURE_INSTRUCTIONS) !== 0 ||
        (flags & S_ATTR_SOME_INSTRUCTIONS) !== 0,
    });
  }

  if (name !== "__TEXT") {
    return null;
  }

  return data.is64Segment
    ? readAddress(view, offset + 24, littleEndian)
    : { high: 0, low: view.getUint32(offset + 24, littleEndian) };
}

// The end of the last section of instructions, from the __TEXT base.
function getTextEndOffset(sections: Array<Section>, textBase: Address): number {
  let textEndOffset: number = 0;

  for (const section of sections) {
    if (!section.holdsInstructions) {
      continue;
    }

    const end: number =
      distance(textBase, section.address) +
      section.size.high * TWO_TO_THE_32 +
      section.size.low;

    if (Number.isSafeInteger(end) && end > textEndOffset) {
      textEndOffset = end;
    }
  }

  return textEndOffset;
}

/*
 * The function symbols of a symbol table: defined in a section of
 * instructions, not debugging (STAB) entries, inside the code, and named.
 * Sorted by offset, one name per offset - an external symbol's, else the
 * first in the table - and at most MAX_APPLE_SYMBOLS of them.
 */
function readSymbols(data: {
  slice: Slice;
  symbolTable: SymbolTableCommand;
  is64: boolean;
  littleEndian: boolean;
  sections: Array<Section>;
  textBase: Address;
  textEndOffset: number;
}): Array<AppleSymbol> {
  const slice: Slice = data.slice;
  const bytes: Uint8Array = slice.bytes;
  const view: DataView = slice.view;
  const littleEndian: boolean = data.littleEndian;
  const table: SymbolTableCommand = data.symbolTable;
  const entrySize: number = data.is64 ? NLIST_64_SIZE : NLIST_SIZE;

  if (table.symbolCount > MAX_SYMBOL_TABLE_ENTRIES) {
    throw corrupt(
      slice,
      `its symbol table lists ${table.symbolCount} symbols, more than the ${MAX_SYMBOL_TABLE_ENTRIES} OneUptime reads`,
    );
  }

  if (table.symbolsOffset + table.symbolCount * entrySize > bytes.length) {
    throw truncated(
      slice,
      `its symbol table runs past the end of ${slice.whole}`,
    );
  }

  if (table.stringsOffset + table.stringsSize > bytes.length) {
    throw truncated(
      slice,
      `its string table runs past the end of ${slice.whole}`,
    );
  }

  // Which section numbers (n_sect) hold instructions.
  const instructionSections: Uint8Array = new Uint8Array(
    MAX_SECTION_NUMBER + 1,
  );

  for (
    let index: number = 0;
    index < Math.min(data.sections.length, MAX_SECTION_NUMBER);
    index++
  ) {
    instructionSections[index + 1] = data.sections[index]!.holdsInstructions
      ? 1
      : 0;
  }

  const candidates: Array<Candidate> = [];

  for (let index: number = 0; index < table.symbolCount; index++) {
    const entry: number = table.symbolsOffset + index * entrySize;
    const type: number = bytes[entry + 4]!;

    if ((type & N_STAB) !== 0 || (type & N_TYPE) !== N_SECT) {
      continue;
    }

    if (instructionSections[bytes[entry + 5]!] !== 1) {
      continue;
    }

    const value: Address = data.is64
      ? readAddress(view, entry + 8, littleEndian)
      : { high: 0, low: view.getUint32(entry + 8, littleEndian) };
    const offset: number = distance(data.textBase, value);

    if (offset < 0 || offset >= data.textEndOffset) {
      continue;
    }

    const stringIndex: number = view.getUint32(entry, littleEndian);

    if (!hasName(bytes, table, stringIndex)) {
      continue;
    }

    candidates.push({
      offset,
      stringIndex,
      isExternal: (type & N_EXT) !== 0,
      tableIndex: index,
    });
  }

  candidates.sort((a: Candidate, b: Candidate): number => {
    return a.offset - b.offset || a.tableIndex - b.tableIndex;
  });

  const names: SymbolNames = createSymbolNames(slice, table);
  const symbols: Array<AppleSymbol> = [];
  let next: number = 0;

  while (next < candidates.length && symbols.length < MAX_APPLE_SYMBOLS) {
    const offset: number = candidates[next]!.offset;
    let chosen: Candidate = candidates[next]!;

    // The first external symbol at this offset, else the first of all.
    while (next < candidates.length && candidates[next]!.offset === offset) {
      const candidate: Candidate = candidates[next]!;

      if (!chosen.isExternal && candidate.isExternal) {
        chosen = candidate;
      }

      next++;
    }

    symbols.push({ offset, name: names.read(chosen.stringIndex) });
  }

  return symbols;
}

/*
 * Whether n_strx names something once its leading underscore is gone: 0 is
 * the empty name, and an index past the string table names nothing.
 */
function hasName(
  bytes: Uint8Array,
  table: SymbolTableCommand,
  stringIndex: number,
): boolean {
  if (stringIndex === 0 || stringIndex >= table.stringsSize) {
    return false;
  }

  const start: number = table.stringsOffset + stringIndex;
  const first: number = bytes[start]!;

  if (first === 0) {
    return false;
  }

  return !(
    first === UNDERSCORE &&
    (stringIndex + 1 >= table.stringsSize || bytes[start + 1] === 0)
  );
}

interface SymbolNames {
  read: (stringIndex: number) => string;
}

/*
 * Names read from the string table, each n_strx once. Real tables never
 * overlap their names, so names that add up to more than twice the table
 * are a crafted file, refused before it can fill the memory.
 */
function createSymbolNames(
  slice: Slice,
  table: SymbolTableCommand,
): SymbolNames {
  const bytes: Uint8Array = slice.bytes;
  const text: Buffer = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const stringsEnd: number = table.stringsOffset + table.stringsSize;
  const budget: number = table.stringsSize * 2 + MAX_NAME_BYTES;
  const cache: Map<number, string> = new Map<number, string>();
  let bytesRead: number = 0;

  return {
    read: (stringIndex: number): string => {
      const cached: string | undefined = cache.get(stringIndex);

      if (cached !== undefined) {
        return cached;
      }

      let start: number = table.stringsOffset + stringIndex;

      // C puts an underscore before every name; one is taken off.
      if (bytes[start] === UNDERSCORE) {
        start++;
      }

      const limit: number = Math.min(stringsEnd, start + MAX_NAME_BYTES);
      let end: number = start;

      while (end < limit && bytes[end] !== 0) {
        end++;
      }

      bytesRead += end - start;

      if (bytesRead > budget) {
        throw corrupt(
          slice,
          "its symbols' names add up to more than twice its string table",
        );
      }

      let name: string = text.toString("utf8", start, end);

      if (name.length > MAX_APPLE_SYMBOL_NAME_LENGTH) {
        name = name.slice(0, MAX_APPLE_SYMBOL_NAME_LENGTH);

        const last: number = name.charCodeAt(name.length - 1);

        // Not half of a surrogate pair.
        if (last >= 0xd800 && last <= 0xdbff) {
          name = name.slice(0, -1);
        }
      }

      cache.set(stringIndex, name);

      return name;
    },
  };
}
