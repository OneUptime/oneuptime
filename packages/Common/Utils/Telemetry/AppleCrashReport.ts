import { normalizeAppleDebugId } from "./AppleSymbols";
import {
  IsCodeFunction,
  isDigitCode,
  isLineTerminatorCode,
  isWhiteSpaceCode,
} from "../RegExpCharacterClasses";

/*
 * AN APPLE CRASH REPORT'S THREADS, READ BACK (#9922, #9923).
 *
 * An iOS app's crash or hang reaches OneUptime as one of two texts:
 *
 *   - the threads OneUptime draws from MetricKit's call stack tree
 *     (MetricKitCallStack): "Thread 0 Crashed:", frames such as
 *     "0   MyApp   0x0000000102a4c5d8 0x102a20000 + 181720" or
 *     "1   UIKitCore   UIKitCore + 6948", and "Binary Images:" lines
 *     "MyApp <70B89F27-1634-3580-A695-57CDB41D7743>";
 *   - the Apple-format report opentelemetry-swift's KSCrash instrumentation
 *     sends as `device.crash` (KSCrash 2.6's KSCrashReportFilterAppleFmt):
 *     a header ("Exception Type:  EXC_BAD_ACCESS (SIGSEGV)", "Triggered by
 *     Thread:  0"), every thread ("Thread 0 name: ...", "Thread 0
 *     Crashed:", "Thread 1:"), frames "0   MyApp\t0x0000000102a4c5d8
 *     0x102a20000 + 181720" - or, in its other report styles, the device's
 *     own symbol ("0x... -[UIApplication sendEvent:] + 120") or both
 *     side by side ("0x... 0x102a20000 + 181720 (main + 52)") - an
 *     NSException's "Last Exception Backtrace:", and "Binary Images:"
 *     lines "0x102a20000 - 0x102b0ffff MyApp arm64  <70b89f27...> /private
 *     /var/containers/Bundle/Application/.../MyApp.app/MyApp". KSCrash cuts
 *     the report from its end to fit 25 KB, so its binary images, and even
 *     its last threads, may be missing.
 *
 * Both are read here into threads of frames - each frame's binary, its
 * offset into the binary (from its load address, which is what a dSYM's
 * symbols are measured from) and the symbol the line names - with the
 * binary images and the exception the header names. Symbolication
 * (Server/Utils/Telemetry/AppleSymbolication) resolves the offsets, grouping
 * (ExceptionGrouping) keys an exception by its frames, and the two reports
 * of one crash are told apart from two crashes by them (AppleCrashMatch).
 *
 * Pure, bounded, and never throws: what is not such a report is null.
 */

export interface AppleCrashFrame {
  // Its number in its thread, the innermost 0.
  index: number;
  binaryName: string;
  /*
   * Bytes from the binary's load address to the instruction: the offset a
   * dSYM's symbols are measured in. Null when the line gives only a symbol
   * and the binary's load address is not known.
   */
  offset: number | null;
  // The instruction's address and the binary's load address, when written.
  address: number | null;
  loadAddress: number | null;
  // The function the line names, and how far into it; null when none.
  symbol: string | null;
  symbolOffset: number | null;
  // Which line of the text it is, for writing it again symbolicated.
  lineIndex: number;
}

export interface AppleCrashThread {
  // The thread's number; a sampled stack's position for MetricKit's tree.
  index: number;
  // The thread the report is about: the one that crashed or hung.
  isAttributed: boolean;
  frames: Array<AppleCrashFrame>;
}

export interface AppleBinaryImage {
  name: string;
  // The binary's UUID, as normalizeAppleDebugId writes it, when given.
  debugId: string | null;
  loadAddress: number | null;
  // Where the binary was on the device, when given (KSCrash).
  path: string | null;
  architecture: string | null;
}

export interface AppleCrashReport {
  threads: Array<AppleCrashThread>;
  images: Array<AppleBinaryImage>;
  // The header's Mach exception ("EXC_BAD_ACCESS") and signal ("SIGSEGV").
  machException: string | null;
  signal: string | null;
  // An uncaught NSException's throw site, when the report holds it.
  lastExceptionBacktrace: Array<AppleCrashFrame> | null;
  // The text's lines, as read.
  lines: Array<string>;
}

// The longest text read, and the most threads and frames kept.
const MAX_REPORT_LENGTH: number = 4 * 1024 * 1024;
const MAX_THREADS: number = 512;
const MAX_FRAMES_PER_THREAD: number = 1024;
const MAX_IMAGES: number = 4096;

const THREAD_HEADING: RegExp = /^Thread (\d{1,5})( Crashed| Hung)?:$/;
const CALL_STACK_HEADING: RegExp = /^Call stack (\d{1,5}):$/;
const TRIGGERED_BY: RegExp = /^Triggered by Thread:\s+(\d{1,5})\s*$/;
const EXCEPTION_TYPE: RegExp =
  /^Exception Type:\s+([A-Z0-9_]+)(?:\s+\(([A-Z0-9_]+)\))?\s*$/;
const FRAME_START: RegExp = /^(\d{1,5})\s+(\S.*)$/;
const ADDRESS_TOKEN: RegExp = /\s0x([0-9a-fA-F]{1,16})(?=\s|$)/;
const LOAD_PLUS_OFFSET: RegExp = /^0x([0-9a-fA-F]{1,16}) \+ (\d{1,20})$/;
const SYMBOL_PLUS_OFFSET: RegExp = /^(.+) \+ (\d{1,20})$/;
const WHITESPACE: RegExp = /\s/;

/*
 * ---------------------------------------------------------------------------
 * A FRAME'S SIDE-BY-SIDE SYMBOL AND A BINARY IMAGE'S LINE, READ ONCE.
 *
 * Each reader below stands for the pattern named above it and answers
 * exactly as it did. Those patterns found the first place a run of white
 * space led to what they wanted - a "(", a binary's architecture and UUID,
 * a UUID - and read the run again from each of its characters, then the
 * white space before the rest of the line again before a line separator:
 * time that grew with the square of the line's length. A line of a report
 * the app sends may be as long as the report, 4 MB: a few seconds at
 * 32 KB, hours at that. Each reader reads each character a fixed number of
 * times (OutsideTextPatternsGuard, AppleCrashReportLinearTime).
 * ---------------------------------------------------------------------------
 */

const DASH: number = 0x2d;
const LESS_THAN: number = 0x3c;
const GREATER_THAN: number = 0x3e;
const CLOSING_PARENTHESIS: number = 0x29;

// [0-9a-fA-F]
const isHexCode: IsCodeFunction = (code: number): boolean => {
  return (
    isDigitCode(code) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
};

// [0-9a-fA-F-]: a UUID's characters.
const isUuidCode: IsCodeFunction = (code: number): boolean => {
  return isHexCode(code) || code === DASH;
};

// \S
const isNotWhiteSpaceCode: IsCodeFunction = (code: number): boolean => {
  return !isWhiteSpaceCode(code);
};

type RunBoundFunction = (
  text: string,
  at: number,
  isInRun: IsCodeFunction,
) => number;

// The index after the run of `isInRun` characters that starts at `at`.
const runEnd: RunBoundFunction = (
  text: string,
  at: number,
  isInRun: IsCodeFunction,
): number => {
  let index: number = at;

  while (index < text.length && isInRun(text.charCodeAt(index))) {
    index++;
  }

  return index;
};

// The index the run of `isInRun` characters that ends right before `at` starts at.
const runStart: RunBoundFunction = (
  text: string,
  at: number,
  isInRun: IsCodeFunction,
): number => {
  let index: number = at;

  while (index > 0 && isInRun(text.charCodeAt(index - 1))) {
    index--;
  }

  return index;
};

type FindLineTerminatorFunction = (text: string) => number;

// Where the first and the last line terminator are: what "." stops at. -1 for none.
const firstLineTerminator: FindLineTerminatorFunction = (
  text: string,
): number => {
  for (let index: number = 0; index < text.length; index++) {
    if (isLineTerminatorCode(text.charCodeAt(index))) {
      return index;
    }
  }

  return -1;
};

const lastLineTerminator: FindLineTerminatorFunction = (
  text: string,
): number => {
  for (let index: number = text.length - 1; index >= 0; index--) {
    if (isLineTerminatorCode(text.charCodeAt(index))) {
      return index;
    }
  }

  return -1;
};

type IsSpanFunction = (text: string, from: number, to: number) => boolean;

// Whether text[from, to) holds a line terminator.
const holdsLineTerminator: IsSpanFunction = (
  text: string,
  from: number,
  to: number,
): boolean => {
  for (let index: number = from; index < to; index++) {
    if (isLineTerminatorCode(text.charCodeAt(index))) {
      return true;
    }
  }

  return false;
};

interface SideBySide {
  // What the line says before the symbol: its position.
  before: string;
  symbol: string;
  offset: string;
}

/*
 * ^(.*?)\s+\((.+) \+ (\d{1,20})\)$ - a position with the symbol written
 * beside it, "0x102a20000 + 181720 (main + 52)": what comes before the
 * first "(" white space leads to, the symbol inside the parentheses and its
 * offset, or null. The text ends with " + ", up to twenty digits and ")",
 * so where the symbol ends is known first; then each "(" is asked about
 * once, from the left. Neither what comes before it nor the symbol may hold
 * a line terminator; the white space between them may.
 */
export function readSideBySideSymbol(text: string): SideBySide | null {
  const last: number = text.length - 1;

  if (last < 0 || text.charCodeAt(last) !== CLOSING_PARENTHESIS) {
    return null;
  }

  const offsetStart: number = runStart(text, last, isDigitCode);
  const offsetLength: number = last - offsetStart;
  const plusStart: number = offsetStart - 3;

  if (
    offsetLength < 1 ||
    offsetLength > 20 ||
    plusStart < 0 ||
    text.slice(plusStart, offsetStart) !== " + "
  ) {
    return null;
  }

  const first: number = firstLineTerminator(text);
  // The last line terminator before " + ", which the symbol may not hold.
  const lastBeforePlus: number = lastLineTerminator(text.slice(0, plusStart));

  for (
    let opening: number = text.indexOf("(", 1);
    opening !== -1 && opening <= plusStart - 2;
    opening = text.indexOf("(", opening + 1)
  ) {
    if (!isWhiteSpaceCode(text.charCodeAt(opening - 1))) {
      continue;
    }

    const spaceStart: number = runStart(text, opening, isWhiteSpaceCode);

    // What comes before only grows from here.
    if (first !== -1 && first < spaceStart) {
      return null;
    }

    // The symbol holds a line terminator; a later "(" may leave it out.
    if (lastBeforePlus > opening) {
      continue;
    }

    return {
      before: text.slice(0, spaceStart),
      symbol: text.slice(opening + 1, plusStart),
      offset: text.slice(offsetStart, last),
    };
  }

  return null;
}

interface KsCrashImage {
  loadAddress: string;
  // The binary's name, as the line writes it: perhaps with spaces in it.
  name: string;
  architecture: string;
  uuid: string;
  // Where the binary was on the device: the rest of the line.
  path: string;
}

/*
 * "0x" and one to sixteen hex digits at `at`, with white space after them:
 * the index after the digits, or -1.
 */
function addressEnd(text: string, at: number): number {
  if (!text.startsWith("0x", at)) {
    return -1;
  }

  const end: number = runEnd(text, at + 2, isHexCode);
  const length: number = end - at - 2;

  return length >= 1 &&
    length <= 16 &&
    end < text.length &&
    isWhiteSpaceCode(text.charCodeAt(end))
    ? end
    : -1;
}

/*
 * (\S+)\s+<([0-9a-fA-F-]{32,36})>\s*(.*)$ at `at`: a binary's architecture,
 * white space, its UUID in angle brackets and the rest of the line after
 * the white space that follows, which may hold no line terminator (`last`
 * is the line's last one). Null when they are not there.
 */
function readArchitectureAndUuid(
  text: string,
  at: number,
  last: number,
): Pick<KsCrashImage, "architecture" | "uuid" | "path"> | null {
  const architectureEnd: number = runEnd(text, at, isNotWhiteSpaceCode);
  const lessThan: number = runEnd(text, architectureEnd, isWhiteSpaceCode);

  if (
    architectureEnd === at ||
    lessThan === architectureEnd ||
    text.charCodeAt(lessThan) !== LESS_THAN
  ) {
    return null;
  }

  // At most one character more than a UUID may hold: enough to refuse it.
  let uuidEnd: number = lessThan + 1;

  while (
    uuidEnd < text.length &&
    uuidEnd - lessThan - 1 <= 36 &&
    isUuidCode(text.charCodeAt(uuidEnd))
  ) {
    uuidEnd++;
  }

  const uuidLength: number = uuidEnd - lessThan - 1;

  if (
    uuidLength < 32 ||
    uuidLength > 36 ||
    text.charCodeAt(uuidEnd) !== GREATER_THAN
  ) {
    return null;
  }

  const pathStart: number = runEnd(text, uuidEnd + 1, isWhiteSpaceCode);

  if (last >= pathStart) {
    return null;
  }

  return {
    architecture: text.slice(at, architectureEnd),
    uuid: text.slice(lessThan + 1, uuidEnd),
    path: text.slice(pathStart),
  };
}

/*
 * ^0x([0-9a-fA-F]{1,16})\s+-\s+0x([0-9a-fA-F]{1,16})\s+(.+?)\s+(\S+)\s+<([0-9a-fA-F-]{32,36})>\s*(.*)$
 * - a binary image as KSCrash writes it, "0x102a20000 - 0x102b0ffff MyApp
 * arm64  <70b89f27...> /private/var/.../MyApp", or null. The name is the
 * shortest that leaves an architecture and a UUID after it, and may hold
 * spaces: each run of white space after its first word is asked once
 * whether the architecture and the UUID follow it. Only when none does may
 * the name be one white space character of the run before it, as the
 * pattern let it be.
 */
function readKsCrashImage(line: string): KsCrashImage | null {
  const loadEnd: number = addressEnd(line, 0);

  if (loadEnd === -1) {
    return null;
  }

  const dash: number = runEnd(line, loadEnd, isWhiteSpaceCode);
  const endStart: number = runEnd(line, dash + 1, isWhiteSpaceCode);

  if (line.charCodeAt(dash) !== DASH || endStart === dash + 1) {
    return null;
  }

  const endEnd: number = addressEnd(line, endStart);

  if (endEnd === -1) {
    return null;
  }

  const nameStart: number = runEnd(line, endEnd, isWhiteSpaceCode);
  const last: number = lastLineTerminator(line);

  for (
    let spaceStart: number = runEnd(line, nameStart, isNotWhiteSpaceCode);
    spaceStart < line.length;

  ) {
    const spaceEnd: number = runEnd(line, spaceStart, isWhiteSpaceCode);
    const rest: Pick<KsCrashImage, "architecture" | "uuid" | "path"> | null =
      readArchitectureAndUuid(line, spaceEnd, last);

    if (rest) {
      return {
        loadAddress: line.slice(2, loadEnd),
        name: line.slice(nameStart, spaceStart),
        ...rest,
      };
    }

    // The run becomes part of the name, which may hold no line terminator.
    if (holdsLineTerminator(line, spaceStart, spaceEnd)) {
      break;
    }

    spaceStart = runEnd(line, spaceEnd, isNotWhiteSpaceCode);
  }

  /*
   * No name: the white space before the first word is three characters or
   * more, its last one or more before the architecture, and the name the
   * last other one that is no line terminator.
   */
  for (let name: number = nameStart - 2; name > endEnd; name--) {
    if (isLineTerminatorCode(line.charCodeAt(name))) {
      continue;
    }

    const rest: Pick<KsCrashImage, "architecture" | "uuid" | "path"> | null =
      readArchitectureAndUuid(line, nameStart, last);

    return rest
      ? {
          loadAddress: line.slice(2, loadEnd),
          name: line.charAt(name),
          ...rest,
        }
      : null;
  }

  return null;
}

/*
 * ^(.+?)\s+<([0-9a-fA-F-]{32,36})>$ - a binary image as MetricKit's tree is
 * drawn, "MyApp <70B89F27-1634-3580-A695-57CDB41D7743>": its name and UUID,
 * or null. The UUID ends the line, so it is found from the end, and the
 * name is what comes before the white space before it. The name may hold no
 * line terminator.
 */
function readDrawnImage(line: string): { name: string; uuid: string } | null {
  const last: number = line.length - 1;

  if (last < 0 || line.charCodeAt(last) !== GREATER_THAN) {
    return null;
  }

  const uuidStart: number = runStart(line, last, isUuidCode);
  const uuidLength: number = last - uuidStart;
  const lessThan: number = uuidStart - 1;

  if (
    uuidLength < 32 ||
    uuidLength > 36 ||
    lessThan < 0 ||
    line.charCodeAt(lessThan) !== LESS_THAN
  ) {
    return null;
  }

  const spaceStart: number = runStart(line, lessThan, isWhiteSpaceCode);

  if (spaceStart === lessThan) {
    return null;
  }

  // A line that starts with white space: the name is its first character.
  const nameEnd: number =
    spaceStart > 0 ? spaceStart : lessThan - spaceStart >= 2 ? 1 : -1;

  if (nameEnd === -1 || holdsLineTerminator(line, 0, nameEnd)) {
    return null;
  }

  return { name: line.slice(0, nameEnd), uuid: line.slice(uuidStart, last) };
}

function readHex(text: string): number | null {
  const value: number = parseInt(text, 16);

  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readDecimal(text: string): number | null {
  const value: number = Number(text);

  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// A device symbol KSCrash could not name reads "(null)": no symbol at all.
function readSymbol(text: string): string | null {
  const symbol: string = text.trim();

  return symbol && symbol !== "(null)" && symbol !== "<redacted>"
    ? symbol
    : null;
}

/*
 * The binary name and position of a frame drawn with no address:
 * "UIKitCore                      UIKitCore + 6948" - the name, padded,
 * then the name again before the offset, so a name with spaces in it is
 * read whole.
 */
function readNameAndOffset(
  rest: string,
): { binaryName: string; offset: number } | null {
  const match: RegExpMatchArray | null = rest.match(/^(.*\S) \+ (\d{1,20})$/);

  if (!match) {
    return null;
  }

  const doubled: string = match[1]!;
  const offset: number | null = readDecimal(match[2]!);

  if (offset === null) {
    return null;
  }

  for (let index: number = 1; index < doubled.length; index++) {
    if (!WHITESPACE.test(doubled[index]!)) {
      continue;
    }

    const left: string = doubled.slice(0, index).trim();
    const right: string = doubled.slice(index).trim();

    if (left && left === right) {
      return { binaryName: left, offset };
    }
  }

  return null;
}

// One frame line, or null when the line is not one.
export function readAppleFrameLine(
  line: string,
  lineIndex: number,
): AppleCrashFrame | null {
  const start: RegExpMatchArray | null = line.trim().match(FRAME_START);

  if (!start) {
    return null;
  }

  const index: number | null = readDecimal(start[1]!);

  if (index === null) {
    return null;
  }

  let rest: string = start[2]!;

  // A symbol written beside the position: "(main + 52)".
  let symbol: string | null = null;
  let symbolOffset: number | null = null;
  const sideBySide: SideBySide | null = readSideBySideSymbol(rest);

  const frame: AppleCrashFrame = {
    index,
    binaryName: "",
    offset: null,
    address: null,
    loadAddress: null,
    symbol: null,
    symbolOffset: null,
    lineIndex,
  };

  const addressMatch: RegExpMatchArray | null = ` ${rest}`.match(ADDRESS_TOKEN);

  if (addressMatch && addressMatch.index !== undefined) {
    // The binary's name, then the instruction's address, then what follows.
    const addressStart: number = addressMatch.index;
    const binaryName: string = ` ${rest}`.slice(0, addressStart).trim();
    const address: number | null = readHex(addressMatch[1]!);
    let position: string = ` ${rest}`
      .slice(addressStart + addressMatch[0].length)
      .trim();

    if (!binaryName || address === null) {
      return null;
    }

    const positionSideBySide: SideBySide | null =
      readSideBySideSymbol(position);

    if (positionSideBySide) {
      position = positionSideBySide.before.trim();
      symbol = readSymbol(positionSideBySide.symbol);
      symbolOffset = symbol ? readDecimal(positionSideBySide.offset) : null;
    }

    frame.binaryName = binaryName;
    frame.address = address;

    const loadPlusOffset: RegExpMatchArray | null =
      position.match(LOAD_PLUS_OFFSET);

    if (loadPlusOffset) {
      frame.loadAddress = readHex(loadPlusOffset[1]!);
      frame.offset = readDecimal(loadPlusOffset[2]!);
    } else {
      const named: RegExpMatchArray | null = position.match(SYMBOL_PLUS_OFFSET);

      if (!named) {
        return null;
      }

      // KSCrash's symbolicated style: the device's symbol, no offset.
      symbol = readSymbol(named[1]!);
      symbolOffset = symbol ? readDecimal(named[2]!) : null;
    }

    frame.symbol = symbol;
    frame.symbolOffset = symbolOffset;

    return frame;
  }

  if (sideBySide) {
    rest = sideBySide.before.trim();
    symbol = readSymbol(sideBySide.symbol);
    symbolOffset = symbol ? readDecimal(sideBySide.offset) : null;
  }

  const nameAndOffset: { binaryName: string; offset: number } | null =
    readNameAndOffset(rest);

  if (!nameAndOffset) {
    return null;
  }

  frame.binaryName = nameAndOffset.binaryName;
  frame.offset = nameAndOffset.offset;
  frame.symbol = symbol;
  frame.symbolOffset = symbolOffset;

  return frame;
}

// One line of "Binary Images:", as KSCrash writes it or MetricKit's tree is drawn, or null.
export function readAppleImageLine(line: string): AppleBinaryImage | null {
  const trimmed: string = line.trim();
  const kscrash: KsCrashImage | null = readKsCrashImage(trimmed);

  if (kscrash) {
    return {
      name: kscrash.name.trim(),
      debugId: normalizeAppleDebugId(kscrash.uuid),
      loadAddress: readHex(kscrash.loadAddress),
      path: kscrash.path.trim() || null,
      architecture: kscrash.architecture,
    };
  }

  const drawn: { name: string; uuid: string } | null = readDrawnImage(trimmed);

  if (drawn) {
    return {
      name: drawn.name.trim(),
      debugId: normalizeAppleDebugId(drawn.uuid),
      loadAddress: null,
      path: null,
      architecture: null,
    };
  }

  return null;
}

/*
 * A crash report's threads, binary images and exception, or null when the
 * text holds no thread with a frame. Never throws.
 */
export function parseAppleCrashReport(text: string): AppleCrashReport | null {
  try {
    if (typeof text !== "string" || !text || text.length > MAX_REPORT_LENGTH) {
      return null;
    }

    const lines: Array<string> = text.split("\n");
    const threads: Array<AppleCrashThread> = [];
    const images: Array<AppleBinaryImage> = [];
    let machException: string | null = null;
    let signal: string | null = null;
    let triggeredBy: number | null = null;
    let lastExceptionBacktrace: Array<AppleCrashFrame> | null = null;

    type Section = "none" | "thread" | "lastException" | "images";
    let section: Section = "none";
    let current: AppleCrashThread | null = null;

    lines.forEach((rawLine: string, lineIndex: number) => {
      const line: string = rawLine.replace(/\r$/, "");
      const trimmed: string = line.trim();

      if (!trimmed) {
        // A blank line ends a thread's frames and the images.
        if (section !== "none") {
          section = "none";
          current = null;
        }
        return;
      }

      const thread: RegExpMatchArray | null =
        trimmed.match(THREAD_HEADING) || trimmed.match(CALL_STACK_HEADING);

      if (thread) {
        if (threads.length >= MAX_THREADS) {
          section = "none";
          current = null;
          return;
        }

        current = {
          index: Number(thread[1]),
          isAttributed: Boolean(thread[2]),
          frames: [],
        };
        threads.push(current);
        section = "thread";
        return;
      }

      if (trimmed === "Last Exception Backtrace:") {
        lastExceptionBacktrace = [];
        section = "lastException";
        current = null;
        return;
      }

      if (trimmed === "Binary Images:") {
        section = "images";
        current = null;
        return;
      }

      if (section === "images") {
        const image: AppleBinaryImage | null = readAppleImageLine(trimmed);

        if (image && images.length < MAX_IMAGES) {
          images.push(image);
        }
        return;
      }

      if (section === "thread" && current) {
        const frame: AppleCrashFrame | null = readAppleFrameLine(
          trimmed,
          lineIndex,
        );
        const into: AppleCrashThread = current;

        if (frame && into.frames.length < MAX_FRAMES_PER_THREAD) {
          into.frames.push(frame);
        }
        return;
      }

      if (section === "lastException" && lastExceptionBacktrace) {
        const frame: AppleCrashFrame | null = readAppleFrameLine(
          trimmed,
          lineIndex,
        );

        if (frame && lastExceptionBacktrace.length < MAX_FRAMES_PER_THREAD) {
          lastExceptionBacktrace.push(frame);
        }
        return;
      }

      const exceptionType: RegExpMatchArray | null =
        trimmed.match(EXCEPTION_TYPE);

      if (exceptionType) {
        machException = exceptionType[1] || null;
        signal = exceptionType[2] || null;
        return;
      }

      const triggered: RegExpMatchArray | null = trimmed.match(TRIGGERED_BY);

      if (triggered) {
        triggeredBy = Number(triggered[1]);
      }
    });

    // KSCrash marks the crashed thread; its header says which, too.
    if (
      triggeredBy !== null &&
      !threads.some((thread: AppleCrashThread): boolean => {
        return thread.isAttributed;
      })
    ) {
      for (const thread of threads) {
        if (thread.index === triggeredBy) {
          thread.isAttributed = true;
        }
      }
    }

    const withFrames: Array<AppleCrashThread> = threads.filter(
      (thread: AppleCrashThread): boolean => {
        return thread.frames.length > 0;
      },
    );

    if (withFrames.length === 0) {
      return null;
    }

    const report: AppleCrashReport = {
      threads: withFrames,
      images,
      machException,
      signal,
      lastExceptionBacktrace,
      lines,
    };

    fillOffsetsFromImages(report);

    return report;
  } catch {
    return null;
  }
}

// The image a frame's binary is, by name - and load address, when both say.
export function findAppleImage(
  report: AppleCrashReport,
  frame: AppleCrashFrame,
): AppleBinaryImage | null {
  let byName: AppleBinaryImage | null = null;

  for (const image of report.images) {
    if (image.name !== frame.binaryName) {
      continue;
    }

    if (
      frame.loadAddress !== null &&
      image.loadAddress !== null &&
      image.loadAddress === frame.loadAddress
    ) {
      return image;
    }

    byName = byName || image;
  }

  return byName;
}

/*
 * A frame KSCrash named by the device's symbol has no offset of its own;
 * its binary's load address, from the images, gives it one.
 */
function fillOffsetsFromImages(report: AppleCrashReport): void {
  const frames: Array<AppleCrashFrame> = [
    ...report.threads.flatMap((thread: AppleCrashThread) => {
      return thread.frames;
    }),
    ...(report.lastExceptionBacktrace || []),
  ];

  for (const frame of frames) {
    if (frame.offset !== null || frame.address === null) {
      continue;
    }

    const image: AppleBinaryImage | null = findAppleImage(report, frame);

    if (
      image &&
      image.loadAddress !== null &&
      frame.address >= image.loadAddress
    ) {
      frame.loadAddress = image.loadAddress;
      frame.offset = frame.address - image.loadAddress;
    }
  }
}

/*
 * The thread the report is about: the one marked as crashed or hung, else
 * the first with frames.
 */
export function getAttributedAppleThread(
  report: AppleCrashReport,
): AppleCrashThread | null {
  return (
    report.threads.find((thread: AppleCrashThread): boolean => {
      return thread.isAttributed;
    }) ||
    report.threads[0] ||
    null
  );
}

/*
 * WHICH BINARIES ARE APPLE'S.
 *
 * A frame in the app's own code says where a bug is; a frame in UIKit or
 * libsystem says only how the app got there, and its offset moves with
 * every iOS update. A binary's path says which it is when the report gives
 * one: the app's binaries are in its bundle (".app/"), Apple's in the
 * system (/System/, /usr/lib/, the cryptexes of /private/preboot/). MetricKit
 * gives names alone, so they are judged by name: dyld, every .dylib, and the
 * frameworks iOS ships.
 */
const APPLE_SYSTEM_FRAMEWORKS: ReadonlySet<string> = new Set<string>([
  "AVFAudio",
  "AVFoundation",
  "AVKit",
  "Accelerate",
  "Accessibility",
  "AccessibilityUtilities",
  "ActivityKit",
  "AppIntents",
  "AppSupport",
  "AppleJPEG",
  "AssertionServices",
  "AudioToolbox",
  "AuthenticationServices",
  "BackBoardServices",
  "BaseBoard",
  "BoardServices",
  "CFNetwork",
  "CallKit",
  "CloudKit",
  "Combine",
  "Contacts",
  "ContactsUI",
  "CoreAnimation",
  "CoreAudio",
  "CoreAutoLayout",
  "CoreBluetooth",
  "CoreData",
  "CoreFoundation",
  "CoreGraphics",
  "CoreHaptics",
  "CoreImage",
  "CoreLocation",
  "CoreML",
  "CoreMedia",
  "CoreMotion",
  "CoreNFC",
  "CoreServices",
  "CoreSpotlight",
  "CoreTelephony",
  "CoreText",
  "CoreUI",
  "CoreVideo",
  "CryptoKit",
  "DataDetectorsCore",
  "EventKit",
  "ExternalAccessory",
  "FileProvider",
  "FontServices",
  "Foundation",
  "FrontBoardServices",
  "GLKit",
  "GameController",
  "GameKit",
  "GraphicsServices",
  "HealthKit",
  "HomeKit",
  "IOKit",
  "IOSurface",
  "ImageIO",
  "JavaScriptCore",
  "LocalAuthentication",
  "MapKit",
  "MediaPlayer",
  "MediaToolbox",
  "MessageUI",
  "Metal",
  "MetalKit",
  "MetalPerformanceShaders",
  "MobileCoreServices",
  "MultipeerConnectivity",
  "NaturalLanguage",
  "Network",
  "NetworkExtension",
  "OpenGLES",
  "PDFKit",
  "PassKit",
  "PencilKit",
  "Photos",
  "PhotosUI",
  "QuartzCore",
  "QuickLook",
  "ARKit",
  "RealityKit",
  "RunningBoardServices",
  "SafariServices",
  "SceneKit",
  "Security",
  "Speech",
  "SpringBoardServices",
  "SpriteKit",
  "StoreKit",
  "SwiftUI",
  "SwiftUICore",
  "SystemConfiguration",
  "TextInput",
  "UIFoundation",
  "UIKit",
  "UIKitCore",
  "UIKitServices",
  "UserNotifications",
  "Vision",
  "VisionKit",
  "WatchConnectivity",
  "WebCore",
  "WebKit",
  "WidgetKit",
  "dyld",
  "dyld_sim",
]);

export function isAppleSystemBinary(input: {
  name: string;
  path?: string | null | undefined;
}): boolean {
  const path: string = (input.path || "").trim();

  if (path) {
    if (path.includes(".app/") || path.includes(".appex/")) {
      return false;
    }

    if (
      path.startsWith("/System/") ||
      path.startsWith("/usr/lib/") ||
      path.startsWith("/private/preboot/") ||
      path.startsWith("/Developer/") ||
      path.startsWith("/Library/Developer/")
    ) {
      return true;
    }
  }

  const name: string = input.name.trim();

  return name.endsWith(".dylib") || APPLE_SYSTEM_FRAMEWORKS.has(name);
}

// Whether a frame is in the app's own code, as far as the report says.
export function isAppleAppFrame(
  report: AppleCrashReport,
  frame: AppleCrashFrame,
): boolean {
  const image: AppleBinaryImage | null = findAppleImage(report, frame);

  return !isAppleSystemBinary({
    name: frame.binaryName,
    path: image?.path || null,
  });
}
