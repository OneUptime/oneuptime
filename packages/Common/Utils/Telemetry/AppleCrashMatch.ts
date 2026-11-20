import {
  AppleCrashFrame,
  AppleCrashReport,
  AppleCrashThread,
  isAppleAppFrame,
} from "./AppleCrashReport";

/*
 * ONE IOS CRASH, TWO REPORTS (#9923).
 *
 * An iOS app can register both of opentelemetry-swift's crash reporters:
 * KSCrash, which writes its report as the app dies and sends it on the next
 * launch (`device.crash`, stamped with the crash's own time and session),
 * and MetricKit, which hands over Apple's diagnostic on a later launch
 * (`metrickit.diagnostic.crash`, stamped with the end of its reporting
 * period: at or after the crash, within a day). Read as two exceptions, one
 * crash would count twice in the Crashes tile, App Crashes and the crash
 * rates. So the second report of a crash is kept as evidence of the first,
 * under the first's exception, and counted nowhere.
 *
 * Two reports are one crash only when everything both say agrees:
 *
 *   - they come from the two reporters, never two of one: a reporter never
 *     reports one crash twice, so two KSCrash reports are two crashes;
 *   - the same install (app.installation.id, else device.id) - a report
 *     that names none is never matched;
 *   - within MATCH_WINDOW_MS of each other: MetricKit's stamp is the end of
 *     a day-long reporting period, and KSCrash's the crash itself, or its
 *     next launch when it could not restore the crash's context;
 *   - the same signal, Mach exception and exception name, wherever both
 *     name one: a SIGSEGV is never a SIGABRT, an NSRangeException never an
 *     NSInvalidArgumentException;
 *   - the crashed thread's frames: both describe one thread at one moment,
 *     so read from its outermost frame (start, main) inwards they are the
 *     same binaries at the same offsets. Their innermost frames may differ
 *     where the reporters stopped differently - for an uncaught NSException
 *     KSCrash keeps the throw's own backtrace, MetricKit the thread as it
 *     aborted, the throw site beneath the abort - so the frames are compared
 *     from the outermost one, and every frame in the app's own code on
 *     either side must be among those that agree. A crash in Apple's code
 *     alone, with no frame of the app's, must agree frame for frame.
 *
 * A crash's two reports always meet all of these. Two different crashes of
 * one install meet them only when they crashed the same way, at the same
 * code, in the same day - the same bug twice - and then pairing the first
 * KSCrash report with the first MetricKit one, each report paired once
 * (AppleCrashRegister), still counts two crashes. What is not paired is
 * counted, as every crash was before: a doubt leaves a crash counted twice,
 * never two crashes counted once.
 *
 * Pure, and never throws.
 */

export type AppleCrashReporter = "kscrash" | "metrickit";

/*
 * What an iOS crash's occurrence says of its report: which reporter sent
 * it, and - for the second report of a crash - the occurrence of the first,
 * the same id its duplicateOf column holds, so the occurrence reads as the
 * evidence it is beside its attributes.
 */
export const APPLE_CRASH_REPORTER_ATTRIBUTE: string =
  "oneuptime.crash.reporter";
export const APPLE_CRASH_DUPLICATE_OF_ATTRIBUTE: string =
  "oneuptime.crash.duplicate_of";

export interface AppleCrashSignatureFrame {
  // The binary's name, as both reporters write it.
  binary: string;
  // Bytes from its load address.
  offset: number;
  // Whether it is in the app's own code (AppleCrashReport).
  isApp: boolean;
}

export interface AppleCrashSignature {
  reporter: AppleCrashReporter;
  // The install it happened on; '' for none, which never matches.
  install: string;
  // When its record says it happened, in milliseconds since the epoch.
  time: number;
  // "SIGSEGV", "EXC_BAD_ACCESS", "NSRangeException": null where unknown.
  signal: string | null;
  machException: string | null;
  exceptionName: string | null;
  // The crashed thread's frames, the innermost first.
  frames: Array<AppleCrashSignatureFrame>;
}

// How far apart one crash's two reports are stamped, at most.
export const MATCH_WINDOW_MS: number = 26 * 60 * 60 * 1000;

// The most frames of a thread a signature keeps, from its innermost.
export const MAX_SIGNATURE_FRAMES: number = 128;

// The fewest agreeing frames that make two reports of a crash in Apple's code.
const MIN_SYSTEM_ONLY_FRAMES: number = 3;

const MACH_AND_SIGNAL: RegExp = /^(EXC_[A-Z_]+)(?:\s+\((SIG[A-Z0-9]+)\))?$/;
const SIGNAL_ONLY: RegExp = /^SIG[A-Z0-9]+$/;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/*
 * What an exception type says, as either reporter writes it: KSCrash's
 * "EXC_BAD_ACCESS (SIGSEGV)" or "SIGABRT", MetricKit's "EXC_BAD_ACCESS" or
 * "SIGSEGV", or an exception's name ("NSRangeException").
 */
export function readAppleExceptionType(type: string | null | undefined): {
  machException: string | null;
  signal: string | null;
  exceptionName: string | null;
} {
  const value: string = (type || "").trim();
  const machAndSignal: RegExpMatchArray | null = value.match(MACH_AND_SIGNAL);

  if (machAndSignal) {
    return {
      machException: machAndSignal[1] || null,
      signal: machAndSignal[2] || null,
      exceptionName: null,
    };
  }

  if (SIGNAL_ONLY.test(value)) {
    return { machException: null, signal: value, exceptionName: null };
  }

  // KSCrash names a report it could not read "crash"; that names nothing.
  return {
    machException: null,
    signal: null,
    exceptionName: value && value !== "crash" ? value : null,
  };
}

/*
 * The crashed thread a signature is read from: the one the report marks as
 * crashed (or hung). A report whose crashed thread was cut off - KSCrash
 * trims its report to 25 KB - has none, and gets no signature, so it is
 * never matched by another thread's frames.
 */
function crashedThread(report: AppleCrashReport): AppleCrashThread | null {
  return (
    report.threads.find((thread: AppleCrashThread): boolean => {
      return thread.isAttributed;
    }) || null
  );
}

/*
 * A report's signature, or null when it cannot be matched at all: no
 * crashed thread with a frame whose offset is known.
 */
export function buildAppleCrashSignature(input: {
  reporter: AppleCrashReporter;
  install: string;
  time: Date | number;
  report: AppleCrashReport;
  // The record's exception.type, as its reporter wrote it.
  exceptionType?: string | null | undefined;
  // MetricKit's own attributes, when the record is MetricKit's.
  signalName?: string | null | undefined;
  machExceptionName?: string | null | undefined;
  objcExceptionName?: string | null | undefined;
}): AppleCrashSignature | null {
  try {
    const thread: AppleCrashThread | null = crashedThread(input.report);

    if (!thread) {
      return null;
    }

    const frames: Array<AppleCrashSignatureFrame> = [];

    for (const frame of thread.frames.slice(0, MAX_SIGNATURE_FRAMES)) {
      if (frame.offset === null) {
        // A frame with no known offset breaks the thread's order: stop.
        break;
      }

      frames.push({
        binary: frame.binaryName,
        offset: frame.offset,
        isApp: isAppleAppFrame(input.report, frame),
      });
    }

    if (frames.length === 0) {
      return null;
    }

    const fromType: {
      machException: string | null;
      signal: string | null;
      exceptionName: string | null;
    } = readAppleExceptionType(input.exceptionType);

    const time: number =
      input.time instanceof Date ? input.time.getTime() : Number(input.time);

    return {
      reporter: input.reporter,
      install: (input.install || "").trim(),
      time: Number.isFinite(time) ? time : 0,
      signal:
        text(input.signalName) ||
        fromType.signal ||
        input.report.signal ||
        null,
      machException:
        text(input.machExceptionName) ||
        fromType.machException ||
        input.report.machException ||
        null,
      exceptionName: text(input.objcExceptionName) || fromType.exceptionName,
      frames,
    };
  } catch {
    return null;
  }
}

function sameFrame(
  a: AppleCrashSignatureFrame,
  b: AppleCrashSignatureFrame,
): boolean {
  return a.offset === b.offset && a.binary === b.binary;
}

// Both name one, and they differ.
function disagree(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b;
}

/*
 * How many frames two threads share counted from their outermost frame -
 * the longest run of agreeing frames that ends at both threads' ends.
 */
export function countAgreeingOutermostFrames(
  a: Array<AppleCrashSignatureFrame>,
  b: Array<AppleCrashSignatureFrame>,
): number {
  let count: number = 0;

  while (
    count < a.length &&
    count < b.length &&
    sameFrame(a[a.length - 1 - count]!, b[b.length - 1 - count]!)
  ) {
    count++;
  }

  return count;
}

// Whether two reports are one crash: see the rules above.
export function isSameAppleCrash(
  a: AppleCrashSignature,
  b: AppleCrashSignature,
): boolean {
  if (a.reporter === b.reporter) {
    return false;
  }

  if (!a.install || a.install !== b.install) {
    return false;
  }

  if (
    !Number.isFinite(a.time) ||
    !Number.isFinite(b.time) ||
    Math.abs(a.time - b.time) > MATCH_WINDOW_MS
  ) {
    return false;
  }

  if (
    disagree(a.signal, b.signal) ||
    disagree(a.machException, b.machException) ||
    disagree(a.exceptionName, b.exceptionName)
  ) {
    return false;
  }

  const agreeing: number = countAgreeingOutermostFrames(a.frames, b.frames);

  if (agreeing === 0) {
    return false;
  }

  /*
   * Every frame of the app's own code, on either side, must be among the
   * agreeing ones - the frames nearest the bug are where two crashes differ.
   */
  const appFramesAgree: (frames: Array<AppleCrashSignatureFrame>) => boolean = (
    frames: Array<AppleCrashSignatureFrame>,
  ): boolean => {
    return frames.every(
      (frame: AppleCrashSignatureFrame, index: number): boolean => {
        return !frame.isApp || index >= frames.length - agreeing;
      },
    );
  };

  const hasAppFrame: boolean =
    a.frames.some((frame: AppleCrashSignatureFrame): boolean => {
      return frame.isApp;
    }) ||
    b.frames.some((frame: AppleCrashSignatureFrame): boolean => {
      return frame.isApp;
    });

  if (hasAppFrame) {
    return appFramesAgree(a.frames) && appFramesAgree(b.frames);
  }

  // Apple's code alone: the very same frames, enough of them to mean it.
  return (
    agreeing === a.frames.length &&
    agreeing === b.frames.length &&
    agreeing >= MIN_SYSTEM_ONLY_FRAMES
  );
}

/*
 * The report among `candidates` a new one repeats, or null: one that is the
 * same crash (isSameAppleCrash) and not yet paired, the nearest in time
 * first - so a crash loop's reports pair in the order they happened.
 */
export function findAppleCrashPartner<
  Candidate extends { signature: AppleCrashSignature; pairedWith?: unknown },
>(
  signature: AppleCrashSignature,
  candidates: Array<Candidate>,
): Candidate | null {
  let best: Candidate | null = null;
  let bestDistance: number = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate.pairedWith) {
      continue;
    }

    if (!isSameAppleCrash(signature, candidate.signature)) {
      continue;
    }

    const distance: number = Math.abs(
      candidate.signature.time - signature.time,
    );

    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

// A frame's place in a signature, for a reader of what was matched.
export function describeAppleSignatureFrame(
  frame: AppleCrashSignatureFrame | AppleCrashFrame,
): string {
  const binary: string =
    "binary" in frame ? frame.binary : (frame as AppleCrashFrame).binaryName;

  return `${binary} + ${frame.offset}`;
}
