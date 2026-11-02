import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "./StackTraceParser";
import { normalizeExceptionText } from "./ExceptionSanitizer";

/*
 * WHAT MAKES TWO OCCURRENCES THE SAME EXCEPTION: GROUPING V2.
 *
 * The first fingerprint (v1, ExceptionUtil.getFingerprint) hashes the
 * normalized message and the whole stack trace as written. A line number it
 * does not recognise (Python's `line 42`, Java's `Cart.java:42`) moves with
 * any edit above the throw, a library upgrade changes the library frames,
 * and a message that embeds a short value differs on every call: each
 * variant became its own exception.
 *
 * v2 groups by what the bug is - where in your own code it was thrown:
 *
 *   - the exception's type, and its in-app frames: each frame's module (its
 *     file, without the release, build hash or host it was served from) and
 *     function. Line and column numbers are left out, and so are library
 *     frames (node_modules, site-packages, the JDK, ... - StackTraceParser's
 *     own judgement, the one the Stack Trace page highlights by);
 *   - a frame repeated by recursion counts once, so the depth a stack
 *     overflow reached does not split it;
 *   - with no in-app frame, every frame, the same way;
 *   - with no stack trace at all, the message, with the values that change
 *     from call to call taken out (normalizeExceptionText, as v1 does).
 *
 * New exceptions are grouped this way; an exception that already exists keeps
 * its v1 fingerprint as its identity, and an occurrence that matches it by v1
 * still lands on it (ExceptionUtil.assignGroupFingerprints), so the switch
 * neither splits nor merges an existing exception.
 *
 * Bounded: the stack trace is cut before it is parsed, and so is the message
 * before it is normalized; no regular expression runs over a frame's text.
 */

export const EXCEPTION_GROUPING_VERSION: number = 2;

// How much of a stack trace and of a message is read.
export const MAX_GROUPING_STACK_TRACE_LENGTH: number = 64 * 1024;
export const MAX_GROUPING_MESSAGE_LENGTH: number = 64 * 1024;
// The most frames that count, from the top of the trace.
export const MAX_GROUPING_FRAMES: number = 50;
// How many of a module's last path segments name it.
export const GROUPING_MODULE_SEGMENTS: number = 3;
// How much of one frame's file and function is read.
const MAX_FRAME_TEXT_LENGTH: number = 1024;

export enum ExceptionGroupingBasis {
  InAppFrames = "in-app-frames",
  AllFrames = "all-frames",
  Message = "message",
}

export interface ExceptionGroupingKey {
  basis: ExceptionGroupingBasis;
  // The exception's type, as given.
  exceptionType: string;
  // One per frame ("module|function"), or the normalized message.
  parts: Array<string>;
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isHexDigit(character: string): boolean {
  return (
    isDigit(character) ||
    (character >= "a" && character <= "f") ||
    (character >= "A" && character <= "F")
  );
}

/*
 * Runs of four or more digits become "<n>": a release or date directory
 * (/releases/20261030/), a generated name (lambda$1234). Shorter numbers are
 * kept: step2 is not step3.
 */
export function collapseLongDigitRuns(text: string): string {
  let out: string = "";
  let run: string = "";

  for (const character of text) {
    if (isDigit(character)) {
      run += character;
      continue;
    }

    out += run.length >= 4 ? "<n>" : run;
    run = "";
    out += character;
  }

  return out + (run.length >= 4 ? "<n>" : run);
}

// A dot-separated piece of a file name that is a build's content hash.
function isContentHash(piece: string): boolean {
  if (piece.length < 6) {
    return false;
  }

  let hasDigit: boolean = false;

  for (const character of piece) {
    if (!isHexDigit(character)) {
      return false;
    }
    hasDigit = hasDigit || isDigit(character);
  }

  return hasDigit;
}

/*
 * A frame's module: its file, as the same code is named in every release and
 * from every host. The query and fragment, the scheme and host it was served
 * from, `webpack:///` and `./` prefixes, content hashes in file names
 * (main.3f2a9c1b.js) and long digit runs are taken out, and the last few
 * path segments are kept, so /srv/releases/20261030/app/src/cart.ts and
 * /srv/releases/20261031/app/src/cart.ts are one module.
 */
export function normalizeFrameModule(fileName: string): string {
  let path: string = (fileName || "").slice(0, MAX_FRAME_TEXT_LENGTH).trim();

  for (const separator of ["?", "#"]) {
    const index: number = path.indexOf(separator);
    if (index >= 0) {
      path = path.slice(0, index);
    }
  }

  const schemeIndex: number = path.indexOf("://");
  if (schemeIndex >= 0) {
    const afterScheme: string = path.slice(schemeIndex + 3);
    const slash: number = afterScheme.indexOf("/");
    // webpack:///./src/x.ts and file:///app/x.js have no host to drop.
    path = slash >= 0 ? afterScheme.slice(slash) : afterScheme;
  }

  const segments: Array<string> = [];

  for (const rawSegment of path.split("\\").join("/").split("/")) {
    const segment: string = rawSegment.trim();

    if (segment === "" || segment === "." || segment === "..") {
      continue;
    }

    const pieces: Array<string> = segment
      .split(".")
      .filter((piece: string, index: number, all: Array<string>): boolean => {
        // A hash between a name and its extension, never the name itself.
        return index === 0 || index === all.length - 1 || !isContentHash(piece);
      });

    segments.push(collapseLongDigitRuns(pieces.join(".")));
  }

  return segments.slice(-GROUPING_MODULE_SEGMENTS).join("/");
}

/*
 * A frame's function, as written, without what varies around it: an
 * `async ` prefix, long digit runs, and repeated whitespace. An anonymous
 * function is "<anonymous>" however the runtime writes it.
 */
export function normalizeFrameFunction(functionName: string): string {
  let name: string = (functionName || "")
    .slice(0, MAX_FRAME_TEXT_LENGTH)
    .trim();

  while (name.startsWith("async ")) {
    name = name.slice("async ".length).trim();
  }

  name = name.split(/\s/).filter(Boolean).join(" ");

  if (
    name === "" ||
    name === "anonymous" ||
    name === "<anonymous>" ||
    name === "Object.<anonymous>"
  ) {
    return "<anonymous>";
  }

  return collapseLongDigitRuns(name);
}

function frameKey(frame: StackFrame): string {
  const module: string = normalizeFrameModule(frame.fileName);
  const fn: string = normalizeFrameFunction(frame.functionName);

  return module || fn !== "<anonymous>" ? `${module}|${fn}` : "";
}

function framesKey(frames: Array<StackFrame>): Array<string> {
  const parts: Array<string> = [];

  for (const frame of frames) {
    const key: string = frameKey(frame);

    // Nothing to name it by, or recursion: the frame before was the same.
    if (!key || parts[parts.length - 1] === key) {
      continue;
    }

    parts.push(key);

    if (parts.length >= MAX_GROUPING_FRAMES) {
      break;
    }
  }

  return parts;
}

export function getExceptionGroupingKey(input: {
  exceptionType?: string | undefined;
  message?: string | undefined;
  stackTrace?: string | undefined;
}): ExceptionGroupingKey {
  const exceptionType: string = (input.exceptionType || "").trim();
  let frames: Array<StackFrame> = [];

  if (input.stackTrace) {
    try {
      const parsed: ParsedStackTrace = StackTraceParser.parse(
        input.stackTrace.slice(0, MAX_GROUPING_STACK_TRACE_LENGTH),
      );
      frames = parsed.frames;
    } catch {
      frames = [];
    }
  }

  const inApp: Array<string> = framesKey(
    frames.filter((frame: StackFrame): boolean => {
      return frame.inApp;
    }),
  );

  if (inApp.length > 0) {
    return {
      basis: ExceptionGroupingBasis.InAppFrames,
      exceptionType,
      parts: inApp,
    };
  }

  const all: Array<string> = framesKey(frames);

  if (all.length > 0) {
    return {
      basis: ExceptionGroupingBasis.AllFrames,
      exceptionType,
      parts: all,
    };
  }

  return {
    basis: ExceptionGroupingBasis.Message,
    exceptionType,
    parts: [
      normalizeExceptionText(
        (input.message || "").slice(0, MAX_GROUPING_MESSAGE_LENGTH),
      ).trim(),
    ],
  };
}

/*
 * The text a v2 fingerprint hashes: the version, the exception's service and
 * project (a fingerprint is unique per service, as v1's), the type, the basis
 * and the parts, one per line. The version keeps a v2 fingerprint from ever
 * equalling a v1 one.
 */
export function getExceptionGroupingText(data: {
  projectId: string;
  primaryEntityId: string;
  key: ExceptionGroupingKey;
}): string {
  return [
    `grouping-v${EXCEPTION_GROUPING_VERSION}`,
    data.projectId,
    data.primaryEntityId,
    data.key.exceptionType,
    data.key.basis,
    ...data.key.parts,
  ].join("\n");
}
