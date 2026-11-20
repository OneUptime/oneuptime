/*
 * AN APPLE BINARY'S SYMBOLS, AS ONEUPTIME KEEPS THEM (#9922).
 *
 * An iOS app's crash and hang stacks name each frame by its binary, the
 * binary's UUID and how far into it the code was (MetricKitCallStack, and
 * KSCrash's Apple-format report): `MyApp + 229796`, never
 * `CartViewController.checkout()`. Apple's symbolication reads the build's
 * dSYM - a Mach-O file holding the symbol table of the build it was made for,
 * the build named by the same UUID - and finds the function whose code
 * starts at or before the frame's offset.
 *
 * OneUptime keeps what that needs and nothing else: per binary UUID and
 * architecture, every function symbol's offset from the start of the
 * binary's __TEXT segment (where the binary is loaded, so the offset is the
 * frame's own), and its name as the symbol table holds it. A dSYM is mostly
 * DWARF debug information, hundreds of megabytes for a large app; its symbol
 * table is a few megabytes, so the CLI reads it on the developer's machine
 * (Server/Utils/Telemetry/AppleDebugSymbols) and sends only that.
 *
 * Kept as text, one symbol a line, each offset the distance from the one
 * before it in hexadecimal: compact in a Postgres text column, and read back
 * into two arrays a binary search walks. Pure, and never throws.
 */

export interface AppleSymbol {
  /*
   * Bytes from the start of the binary's __TEXT segment - its load address
   * - to the symbol's first instruction.
   */
  offset: number;
  /*
   * The name as the symbol table holds it, without the underscore C puts
   * before every name: "$s5MyApp18CartViewControllerC8checkoutyyF",
   * "-[CartViewController checkout]", "main".
   */
  name: string;
}

export interface AppleSymbolFile {
  // The binary's UUID (LC_UUID), as normalizeAppleDebugId writes it.
  debugId: string;
  // "arm64", "arm64e", "x86_64", "armv7", ...
  architecture: string;
  // The binary's file name: "MyApp", "MyFramework".
  binaryName: string;
  // Ascending by offset, one name per offset.
  symbols: Array<AppleSymbol>;
  /*
   * Where the binary's code ends, as an offset: the end of its last section
   * of instructions. A frame at or past it is in no symbol of this file.
   */
  textEndOffset: number;
}

// A symbol table read back for lookups.
export interface AppleSymbolTable {
  offsets: Array<number>;
  names: Array<string>;
  textEndOffset: number;
}

// The function a frame's offset falls in, and how far into it.
export interface AppleSymbolMatch {
  name: string;
  // Bytes from the symbol's first instruction to the frame's.
  symbolOffset: number;
}

// The first line of a stored table: what it is, and its format's version.
export const APPLE_SYMBOLS_HEADER: string = "oneuptime-apple-symbols 1";

// The most symbols one binary's table holds, whatever a file says.
export const MAX_APPLE_SYMBOLS: number = 2_000_000;

// The longest symbol name kept; a longer one is cut there.
export const MAX_APPLE_SYMBOL_NAME_LENGTH: number = 4096;

const UUID_HEX_LENGTH: number = 32;
const UPPER_HEX: RegExp = /^[0-9A-F]+$/;

/*
 * A binary UUID as OneUptime stores and looks it up: upper case, dashed as
 * 8-4-4-4-12. MetricKit writes it so ("70B89F27-1634-3580-A695-
 * 57CDB41D7743"), KSCrash in lower case without dashes
 * ("70b89f2716343580a69557cdb41d7743"), dwarfdump in upper case with
 * dashes: all of them are the same binary. Null for anything that is not
 * 32 hexadecimal digits, dashes and braces aside.
 */
export function normalizeAppleDebugId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const hex: string = value.replace(/[-{}\s]/g, "").toUpperCase();

  if (hex.length !== UUID_HEX_LENGTH || !UPPER_HEX.test(hex)) {
    return null;
  }

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// A name as one line of the table: no line break, and bounded.
function toStoredName(name: string): string {
  return name.replace(/[\r\n]+/g, " ").slice(0, MAX_APPLE_SYMBOL_NAME_LENGTH);
}

/*
 * The symbols as the text OneUptime stores: the header, the end of the code
 * as a hexadecimal offset, then one symbol a line - its offset's distance
 * from the symbol before it, in hexadecimal, a space, its name. The symbols
 * are sorted and their offsets made unique here, whatever order they came
 * in: the first name given for an offset is kept.
 */
export function encodeAppleSymbols(input: {
  symbols: Array<AppleSymbol>;
  textEndOffset: number;
}): string {
  const sorted: Array<AppleSymbol> = input.symbols
    .filter((symbol: AppleSymbol): boolean => {
      return (
        Number.isSafeInteger(symbol.offset) &&
        symbol.offset >= 0 &&
        typeof symbol.name === "string" &&
        symbol.name.length > 0
      );
    })
    .map((symbol: AppleSymbol, index: number) => {
      return { symbol, index };
    })
    .sort(
      (
        a: { symbol: AppleSymbol; index: number },
        b: { symbol: AppleSymbol; index: number },
      ): number => {
        return a.symbol.offset - b.symbol.offset || a.index - b.index;
      },
    )
    .map((entry: { symbol: AppleSymbol; index: number }): AppleSymbol => {
      return entry.symbol;
    });

  const lines: Array<string> = [
    APPLE_SYMBOLS_HEADER,
    Math.max(0, Math.floor(input.textEndOffset || 0)).toString(16),
  ];

  let previous: number = 0;
  let count: number = 0;

  for (const symbol of sorted) {
    if (count > 0 && symbol.offset === previous) {
      continue;
    }

    if (count >= MAX_APPLE_SYMBOLS) {
      break;
    }

    lines.push(
      `${(symbol.offset - previous).toString(16)} ${toStoredName(symbol.name)}`,
    );
    previous = symbol.offset;
    count++;
  }

  return lines.join("\n");
}

// How many symbols a stored table holds, without reading it into arrays.
export function countStoredAppleSymbols(text: string): number {
  if (typeof text !== "string" || !text.startsWith(APPLE_SYMBOLS_HEADER)) {
    return 0;
  }

  let lines: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      lines++;
    }
  }

  // The header's line break, and the end of the code's.
  return Math.max(0, lines - 1);
}

/*
 * A stored table read back, or null when the text is not one. A line that
 * cannot be read ends the table there: the symbols before it still resolve.
 */
export function decodeAppleSymbols(text: string): AppleSymbolTable | null {
  if (typeof text !== "string") {
    return null;
  }

  const lines: Array<string> = text.split("\n");

  if (lines[0] !== APPLE_SYMBOLS_HEADER || lines.length < 2) {
    return null;
  }

  const textEndOffset: number = parseInt(lines[1] || "", 16);

  if (!Number.isFinite(textEndOffset) || textEndOffset < 0) {
    return null;
  }

  const offsets: Array<number> = [];
  const names: Array<string> = [];
  let offset: number = 0;

  for (let index: number = 2; index < lines.length; index++) {
    const line: string = lines[index]!;
    const space: number = line.indexOf(" ");

    if (space <= 0 || space === line.length - 1) {
      if (line === "") {
        continue;
      }
      break;
    }

    const delta: number = parseInt(line.slice(0, space), 16);

    if (!Number.isFinite(delta) || delta < 0 || (index > 2 && delta === 0)) {
      break;
    }

    offset += delta;

    if (!Number.isSafeInteger(offset)) {
      break;
    }

    offsets.push(offset);
    names.push(line.slice(space + 1));

    if (offsets.length >= MAX_APPLE_SYMBOLS) {
      break;
    }
  }

  return { offsets, names, textEndOffset };
}

/*
 * The function a frame's offset falls in: the symbol with the greatest
 * offset at or before it, while the offset is still in the binary's code.
 * Null before the first symbol, at or past the end of the code, or for an
 * offset that is not one.
 */
export function lookupAppleSymbol(
  table: AppleSymbolTable,
  offset: number,
): AppleSymbolMatch | null {
  if (
    !Number.isFinite(offset) ||
    offset < 0 ||
    table.offsets.length === 0 ||
    (table.textEndOffset > 0 && offset >= table.textEndOffset)
  ) {
    return null;
  }

  let low: number = 0;
  let high: number = table.offsets.length - 1;

  if (offset < table.offsets[0]!) {
    return null;
  }

  while (low < high) {
    const middle: number = Math.ceil((low + high) / 2);

    if (table.offsets[middle]! <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return {
    name: table.names[low]!,
    symbolOffset: offset - table.offsets[low]!,
  };
}
