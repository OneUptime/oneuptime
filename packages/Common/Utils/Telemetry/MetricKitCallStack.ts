/*
 * A METRICKIT CALL STACK TREE, AS A STACK TRACE A PERSON CAN READ.
 *
 * opentelemetry-swift's MetricKit instrumentation puts a crash's or a hang's
 * call stacks in `exception.stacktrace` as JSON (MobileAppFaults), in one of
 * two shapes:
 *
 *   - its own, since the transform was fixed in 2.5.2 (StackTraceFormat.md):
 *     `{callStackPerThread, callStacks: [{threadAttributed,
 *     callStackFrames: [{binaryName, binaryUUID, offsetAddress}]}]}`, each
 *     thread's frames flat, the innermost first;
 *   - Apple's, which `MXCallStackTree.jsonRepresentation()` writes and
 *     2.3.0 to 2.5.1 sent as it was (their transform only read the shape
 *     with a `callStackTree` wrapper, which that method does not write), as
 *     does `useAppleStacktraceFormat`: `{callStackPerThread, callStacks:
 *     [{threadAttributed, callStackRootFrames: [{binaryName, binaryUUID,
 *     offsetIntoBinaryTextSegment, address, sampleCount, subFrames}]}]}`,
 *     each frame's callers nested in its subFrames.
 *
 * Neither is symbolicated: a frame names its binary and how far into it the
 * code was, and its binary's UUID says which build's symbols resolve it.
 * Drawn the way Apple's crash reports draw an unsymbolicated thread, with
 * the thread the diagnostic is about first:
 *
 *   Thread 0 Crashed:
 *   0   MyApp                     0x0000000102a4c5d8 0x102a20000 + 181720
 *   1   UIKitCore                 UIKitCore + 6948
 *
 *   Binary Images:
 *   MyApp <70B89F27-1634-3580-A695-57CDB41D7743>
 *
 * The runtime address and its binary's load address only when Apple's shape
 * gives the address (the other shape drops it); the binary and the offset
 * always, which with the UUID is what symbolicating a frame needs. Pure,
 * and never throws: anything that is not such a tree is null, and the
 * caller keeps the text it had.
 */

export interface MetricKitStackFrame {
  binaryName: string;
  binaryUUID: string;
  // Bytes into the binary's text segment.
  offset: number;
  // Where the frame's code was in memory, when Apple's shape says.
  address: number | null;
}

export interface MetricKitCallStack {
  // The thread (or the stack) the diagnostic is attributed to.
  threadAttributed: boolean;
  // The innermost frame first.
  frames: Array<MetricKitStackFrame>;
}

export interface MetricKitCallStackTree {
  // One stack per thread (a crash, a hang), or one sampled tree.
  callStackPerThread: boolean;
  callStacks: Array<MetricKitCallStack>;
}

// What the diagnostic is, for the attributed thread's heading.
export type MetricKitCallStackKind = "crash" | "hang";

// Bounds on what one tree is read into, whatever an SDK sends.
const MAX_CALL_STACKS: number = 256;
const MAX_FRAMES_PER_STACK: number = 512;
const MAX_SUBFRAME_DEPTH: number = 512;
// The longest JSON read; a stack trace past it is kept as sent.
const MAX_JSON_LENGTH: number = 2 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNonNegativeInteger(value: unknown): number | null {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function readFrame(
  raw: unknown,
  offsetKey: "offsetAddress" | "offsetIntoBinaryTextSegment",
): MetricKitStackFrame | null {
  if (!isRecord(raw)) {
    return null;
  }

  const binaryName: string = readText(raw["binaryName"]);
  const offset: number | null = readNonNegativeInteger(raw[offsetKey]);

  if (!binaryName || offset === null) {
    return null;
  }

  return {
    binaryName: binaryName,
    binaryUUID: readText(raw["binaryUUID"]),
    offset: offset,
    address: readNonNegativeInteger(raw["address"]),
  };
}

/*
 * Apple's frames, each with its callers in subFrames: flattened depth first,
 * a frame before its subframes, as opentelemetry-swift's own transform
 * flattens them, so the innermost frame stays first.
 */
function flattenAppleFrames(
  rawFrames: Array<unknown>,
  into: Array<MetricKitStackFrame>,
  depth: number,
): void {
  for (const rawFrame of rawFrames) {
    if (into.length >= MAX_FRAMES_PER_STACK || depth > MAX_SUBFRAME_DEPTH) {
      return;
    }

    const frame: MetricKitStackFrame | null = readFrame(
      rawFrame,
      "offsetIntoBinaryTextSegment",
    );

    if (frame) {
      into.push(frame);
    }

    const subFrames: unknown = isRecord(rawFrame)
      ? rawFrame["subFrames"]
      : undefined;

    if (Array.isArray(subFrames)) {
      flattenAppleFrames(subFrames, into, depth + 1);
    }
  }
}

function readCallStack(raw: unknown): MetricKitCallStack | null {
  if (!isRecord(raw)) {
    return null;
  }

  const frames: Array<MetricKitStackFrame> = [];

  if (Array.isArray(raw["callStackFrames"])) {
    for (const rawFrame of raw["callStackFrames"] as Array<unknown>) {
      if (frames.length >= MAX_FRAMES_PER_STACK) {
        break;
      }

      const frame: MetricKitStackFrame | null = readFrame(
        rawFrame,
        "offsetAddress",
      );

      if (frame) {
        frames.push(frame);
      }
    }
  } else if (Array.isArray(raw["callStackRootFrames"])) {
    flattenAppleFrames(raw["callStackRootFrames"] as Array<unknown>, frames, 0);
  } else {
    return null;
  }

  return {
    threadAttributed: raw["threadAttributed"] === true,
    frames: frames,
  };
}

/**
 * A MetricKit call stack tree read from its JSON, in either shape, with or
 * without Apple's `callStackTree` wrapper; null for anything else, a tree
 * with no frame at all included. Never throws.
 */
export function parseMetricKitCallStackTree(
  text: string,
): MetricKitCallStackTree | null {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed: string = text.trim();

  if (
    !trimmed.startsWith("{") ||
    !trimmed.endsWith("}") ||
    trimmed.length > MAX_JSON_LENGTH
  ) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (isRecord(parsed) && isRecord(parsed["callStackTree"])) {
    parsed = parsed["callStackTree"];
  }

  if (!isRecord(parsed) || !Array.isArray(parsed["callStacks"])) {
    return null;
  }

  const callStacks: Array<MetricKitCallStack> = [];

  for (const rawStack of (parsed["callStacks"] as Array<unknown>).slice(
    0,
    MAX_CALL_STACKS,
  )) {
    const callStack: MetricKitCallStack | null = readCallStack(rawStack);

    if (callStack) {
      callStacks.push(callStack);
    }
  }

  const hasFrames: boolean = callStacks.some(
    (callStack: MetricKitCallStack): boolean => {
      return callStack.frames.length > 0;
    },
  );

  if (!hasFrames) {
    return null;
  }

  return {
    callStackPerThread: parsed["callStackPerThread"] !== false,
    callStacks: callStacks,
  };
}

function toHex(value: number, width: number): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

// One frame as an unsymbolicated line of an Apple crash report.
function formatFrame(frame: MetricKitStackFrame, index: number): string {
  const position: string =
    frame.address !== null && frame.address >= frame.offset
      ? `${toHex(frame.address, 16)} ${toHex(frame.address - frame.offset, 0)} + ${frame.offset}`
      : `${frame.binaryName} + ${frame.offset}`;

  return `${String(index).padEnd(4)}${frame.binaryName.padEnd(30)} ${position}`;
}

function headingFor(input: {
  callStack: MetricKitCallStack;
  index: number;
  perThread: boolean;
  kind: MetricKitCallStackKind;
}): string {
  if (!input.perThread) {
    return `Call stack ${input.index}:`;
  }

  if (!input.callStack.threadAttributed) {
    return `Thread ${input.index}:`;
  }

  return input.kind === "crash"
    ? `Thread ${input.index} Crashed:`
    : `Thread ${input.index} Hung:`;
}

/**
 * The tree as an Apple crash report's threads and binary images: the
 * attributed thread first, then the others in their order, each thread
 * keeping its own number.
 */
export function formatMetricKitCallStackTree(
  tree: MetricKitCallStackTree,
  kind: MetricKitCallStackKind,
): string {
  const ordered: Array<{ callStack: MetricKitCallStack; index: number }> =
    tree.callStacks
      .map((callStack: MetricKitCallStack, index: number) => {
        return { callStack: callStack, index: index };
      })
      .sort(
        (
          left: { callStack: MetricKitCallStack; index: number },
          right: { callStack: MetricKitCallStack; index: number },
        ): number => {
          const leftFirst: number = left.callStack.threadAttributed ? 0 : 1;
          const rightFirst: number = right.callStack.threadAttributed ? 0 : 1;

          return leftFirst - rightFirst || left.index - right.index;
        },
      );

  const blocks: Array<string> = [];
  const images: Map<string, string> = new Map<string, string>();

  for (const entry of ordered) {
    if (entry.callStack.frames.length === 0) {
      continue;
    }

    const lines: Array<string> = [
      headingFor({
        callStack: entry.callStack,
        index: entry.index,
        perThread: tree.callStackPerThread,
        kind: kind,
      }),
    ];

    entry.callStack.frames.forEach(
      (frame: MetricKitStackFrame, index: number) => {
        lines.push(formatFrame(frame, index));

        if (!images.has(frame.binaryName)) {
          images.set(frame.binaryName, frame.binaryUUID);
        }
      },
    );

    blocks.push(lines.join("\n"));
  }

  const imageLines: Array<string> = Array.from(images.entries()).map(
    ([binaryName, binaryUUID]: [string, string]): string => {
      return binaryUUID ? `${binaryName} <${binaryUUID}>` : binaryName;
    },
  );

  if (imageLines.length > 0) {
    blocks.push(["Binary Images:", ...imageLines].join("\n"));
  }

  return blocks.join("\n\n");
}

/**
 * A MetricKit stack trace as a person reads one, or null when the text is
 * not a MetricKit call stack tree (the caller keeps it as sent). Never
 * throws.
 */
export function toReadableMetricKitStackTrace(
  text: string,
  kind: MetricKitCallStackKind,
): string | null {
  try {
    const tree: MetricKitCallStackTree | null =
      parseMetricKitCallStackTree(text);

    return tree ? formatMetricKitCallStackTree(tree, kind) : null;
  } catch {
    return null;
  }
}
