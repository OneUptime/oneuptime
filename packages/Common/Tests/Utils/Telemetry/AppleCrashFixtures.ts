/*
 * AN IOS APP'S CRASHES AND HANGS, AS ITS SDK SENDS THEM (#9922, #9923).
 *
 * Shaped after what reaches OneUptime from opentelemetry-swift:
 *
 *   - MetricKit (Sources/Instrumentation/MetricKit): an MXCrashDiagnostic's
 *     or MXHangDiagnostic's `callStackTree.jsonRepresentation()` in Apple's
 *     own shape - one stack per thread, each frame's callers nested in its
 *     subFrames, the attributed thread marked - as `exception.stacktrace`;
 *   - KSCrash (Sources/Instrumentation/Crash, KSCrash 2.6): the
 *     Apple-format report its default `.unsymbolicated` style writes - every
 *     frame "<index padded to 4><binary padded to 30>\t0x<pc> 0x<load> +
 *     <offset>", the crashed thread marked, the binary images last with
 *     their UUIDs in lower case without dashes.
 *
 * One crash seen by both: the app's CartViewController dereferenced a
 * freed object (EXC_BAD_ACCESS, SIGSEGV) under a button tap. One uncaught
 * NSRangeException, seen by both: KSCrash keeps the throw's backtrace,
 * MetricKit the thread as it aborted, the throw site beneath. And one hang
 * of the main thread, waiting on a lock.
 */

export const APP_UUID: string = "70B89F27-1634-3580-A695-57CDB41D7743";
export const APP_UUID_COMPACT: string = "70b89f2716343580a69557cdb41d7743";
// The next build of the same app: a new UUID, its code moved.
export const NEXT_BUILD_UUID: string = "1E3C5A79-2B4D-4F6E-8A1C-3E5B7D9F0A2C";
export const UIKIT_UUID: string = "77A62F2E-8212-30F3-84C1-E8497440ACF8";
export const FOUNDATION_UUID: string = "A1B2C3D4-5678-40AB-8DEF-1234567890AB";
export const COREFOUNDATION_UUID: string =
  "2B3C4D5E-6F70-4182-93A4-B5C6D7E8F901";
export const LIBSYSTEM_KERNEL_UUID: string =
  "3C4D5E6F-7081-4293-A4B5-C6D7E8F90A12";
export const LIBOBJC_UUID: string = "4D5E6F70-8192-43A4-B5C6-D7E8F90A1B23";
export const DYLD_UUID: string = "5E6F7081-92A3-44B5-86D7-E8F90A1B2C34";
export const GRAPHICS_SERVICES_UUID: string =
  "6F708192-A3B4-45C6-97E8-F90A1B2C3D45";

export const APP_LOAD: number = 0x100004000;
const UIKIT_LOAD: number = 0x1a3a00000;
const COREFOUNDATION_LOAD: number = 0x1a1b00000;
const GRAPHICS_SERVICES_LOAD: number = 0x1e4a00000;
const DYLD_LOAD: number = 0x1c5e40000;
const LIBSYSTEM_KERNEL_LOAD: number = 0x1e9c0c000;
const LIBOBJC_LOAD: number = 0x19a2c0000;

export interface FixtureFrame {
  binaryName: string;
  binaryUUID: string;
  offset: number;
  load: number;
}

function frame(
  binaryName: string,
  binaryUUID: string,
  load: number,
  offset: number,
): FixtureFrame {
  return { binaryName, binaryUUID, offset, load };
}

/*
 * The crash's main thread, the innermost first: two of the app's frames
 * (CartViewController.checkout(), then its button action), UIKit's event
 * dispatch, the run loop, and main.
 */
export const CRASH_MAIN_THREAD: Array<FixtureFrame> = [
  frame("MyApp", APP_UUID, APP_LOAD, 229796),
  frame("MyApp", APP_UUID, APP_LOAD, 188420),
  frame("UIKitCore", UIKIT_UUID, UIKIT_LOAD, 1361368),
  frame("UIKitCore", UIKIT_UUID, UIKIT_LOAD, 1053236),
  frame("CoreFoundation", COREFOUNDATION_UUID, COREFOUNDATION_LOAD, 1233892),
  frame(
    "GraphicsServices",
    GRAPHICS_SERVICES_UUID,
    GRAPHICS_SERVICES_LOAD,
    6956,
  ),
  frame("UIKitCore", UIKIT_UUID, UIKIT_LOAD, 2744560),
  frame("MyApp", APP_UUID, APP_LOAD, 20320),
  frame("dyld", DYLD_UUID, DYLD_LOAD, 41300),
];

// A thread that was only waiting.
export const IDLE_THREAD: Array<FixtureFrame> = [
  frame(
    "libsystem_kernel.dylib",
    LIBSYSTEM_KERNEL_UUID,
    LIBSYSTEM_KERNEL_LOAD,
    8660,
  ),
  frame(
    "libsystem_kernel.dylib",
    LIBSYSTEM_KERNEL_UUID,
    LIBSYSTEM_KERNEL_LOAD,
    6312,
  ),
];

/*
 * The uncaught NSRangeException's throw site and what called it: the
 * app's Cart.item(at:) asked an NSArray for index 10 of 3.
 */
const THROW_SITE: Array<FixtureFrame> = [
  frame("CoreFoundation", COREFOUNDATION_UUID, COREFOUNDATION_LOAD, 1032),
  frame("MyApp", APP_UUID, APP_LOAD, 150240),
  frame("MyApp", APP_UUID, APP_LOAD, 188420),
  frame("UIKitCore", UIKIT_UUID, UIKIT_LOAD, 1361368),
  frame("CoreFoundation", COREFOUNDATION_UUID, COREFOUNDATION_LOAD, 1233892),
  frame(
    "GraphicsServices",
    GRAPHICS_SERVICES_UUID,
    GRAPHICS_SERVICES_LOAD,
    6956,
  ),
  frame("UIKitCore", UIKIT_UUID, UIKIT_LOAD, 2744560),
  frame("MyApp", APP_UUID, APP_LOAD, 20320),
  frame("dyld", DYLD_UUID, DYLD_LOAD, 41300),
];

// KSCrash's crashed thread for it: the exception's own backtrace.
export const NSEXCEPTION_KSCRASH_THREAD: Array<FixtureFrame> = [
  frame("CoreFoundation", COREFOUNDATION_UUID, COREFOUNDATION_LOAD, 646068),
  frame("libobjc.A.dylib", LIBOBJC_UUID, LIBOBJC_LOAD, 101180),
  ...THROW_SITE,
];

// MetricKit's: the thread as it aborted, the throw site beneath the abort.
export const NSEXCEPTION_METRICKIT_THREAD: Array<FixtureFrame> = [
  frame(
    "libsystem_kernel.dylib",
    LIBSYSTEM_KERNEL_UUID,
    LIBSYSTEM_KERNEL_LOAD,
    31452,
  ),
  frame(
    "libsystem_kernel.dylib",
    LIBSYSTEM_KERNEL_UUID,
    LIBSYSTEM_KERNEL_LOAD,
    29080,
  ),
  frame("libobjc.A.dylib", LIBOBJC_UUID, LIBOBJC_LOAD, 102564),
  frame("libobjc.A.dylib", LIBOBJC_UUID, LIBOBJC_LOAD, 101300),
  ...THROW_SITE,
];

// The hang: the main thread waiting on a lock the app's sync code held.
export const HANG_MAIN_THREAD: Array<FixtureFrame> = [
  frame(
    "libsystem_kernel.dylib",
    LIBSYSTEM_KERNEL_UUID,
    LIBSYSTEM_KERNEL_LOAD,
    4812,
  ),
  frame("Foundation", FOUNDATION_UUID, 0x1a2f00000, 501236),
  frame("MyApp", APP_UUID, APP_LOAD, 310544),
  frame("MyApp", APP_UUID, APP_LOAD, 310112),
  frame("UIKitCore", UIKIT_UUID, UIKIT_LOAD, 2744560),
  frame("MyApp", APP_UUID, APP_LOAD, 20320),
  frame("dyld", DYLD_UUID, DYLD_LOAD, 41300),
];

/*
 * One thread in Apple's own shape: the innermost frame at the root, its
 * caller in its subFrames, and so on.
 */
function appleThread(
  frames: Array<FixtureFrame>,
  threadAttributed: boolean,
): Record<string, unknown> {
  let root: Record<string, unknown> | null = null;

  for (let index: number = frames.length - 1; index >= 0; index--) {
    const current: FixtureFrame = frames[index]!;

    root = {
      binaryUUID: current.binaryUUID,
      offsetIntoBinaryTextSegment: current.offset,
      sampleCount: 1,
      binaryName: current.binaryName,
      address: current.load + current.offset,
      ...(root ? { subFrames: [root] } : {}),
    };
  }

  return {
    threadAttributed: threadAttributed,
    callStackRootFrames: root ? [root] : [],
  };
}

// MetricKit's call stack tree, as `MXCallStackTree.jsonRepresentation()` writes it.
export function metricKitTree(
  threads: Array<{ frames: Array<FixtureFrame>; attributed: boolean }>,
): string {
  return JSON.stringify({
    callStackPerThread: true,
    callStacks: threads.map(
      (thread: { frames: Array<FixtureFrame>; attributed: boolean }) => {
        return appleThread(thread.frames, thread.attributed);
      },
    ),
  });
}

// opentelemetry-swift's own simplified shape (2.5.2 and later).
export function metricKitSimplifiedTree(
  threads: Array<{ frames: Array<FixtureFrame>; attributed: boolean }>,
): string {
  return JSON.stringify({
    callStackPerThread: true,
    callStacks: threads.map(
      (thread: { frames: Array<FixtureFrame>; attributed: boolean }) => {
        return {
          threadAttributed: thread.attributed,
          callStackFrames: thread.frames.map((current: FixtureFrame) => {
            return {
              binaryUUID: current.binaryUUID,
              offsetAddress: current.offset,
              binaryName: current.binaryName,
            };
          }),
        };
      },
    ),
  });
}

// The crash's MXCrashDiagnostic tree: the crashed main thread, an idle one.
export const CRASH_TREE: string = metricKitTree([
  { frames: IDLE_THREAD, attributed: false },
  { frames: CRASH_MAIN_THREAD, attributed: true },
]);

export const HANG_TREE: string = metricKitTree([
  { frames: HANG_MAIN_THREAD, attributed: true },
  { frames: IDLE_THREAD, attributed: false },
]);

export const NSEXCEPTION_TREE: string = metricKitTree([
  { frames: NSEXCEPTION_METRICKIT_THREAD, attributed: true },
]);

function hex(value: number, width: number = 0): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

// One KSCrash frame line, exactly as KSCrashReportFilterAppleFmt writes it.
export function kscrashFrameLine(current: FixtureFrame, index: number): string {
  return `${String(index).padEnd(4)}${current.binaryName.padEnd(30)}\t${hex(
    current.load + current.offset,
    16,
  )} ${hex(current.load)} + ${current.offset}`;
}

const IMAGES: Array<{
  name: string;
  uuid: string;
  load: number;
  size: number;
  arch: string;
  path: string;
}> = [
  {
    name: "MyApp",
    uuid: APP_UUID,
    load: APP_LOAD,
    size: 0x164000,
    arch: "arm64",
    path: "/private/var/containers/Bundle/Application/1C2D3E4F-5A6B-4C7D-8E9F-0A1B2C3D4E5F/MyApp.app/MyApp",
  },
  {
    name: "libobjc.A.dylib",
    uuid: LIBOBJC_UUID,
    load: LIBOBJC_LOAD,
    size: 0x40000,
    arch: "arm64e",
    path: "/usr/lib/libobjc.A.dylib",
  },
  {
    name: "CoreFoundation",
    uuid: COREFOUNDATION_UUID,
    load: COREFOUNDATION_LOAD,
    size: 0x500000,
    arch: "arm64e",
    path: "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
  },
  {
    name: "UIKitCore",
    uuid: UIKIT_UUID,
    load: UIKIT_LOAD,
    size: 0x1600000,
    arch: "arm64e",
    path: "/System/Library/PrivateFrameworks/UIKitCore.framework/UIKitCore",
  },
  {
    name: "dyld",
    uuid: DYLD_UUID,
    load: DYLD_LOAD,
    size: 0x60000,
    arch: "arm64e",
    path: "/usr/lib/dyld",
  },
  {
    name: "GraphicsServices",
    uuid: GRAPHICS_SERVICES_UUID,
    load: GRAPHICS_SERVICES_LOAD,
    size: 0x10000,
    arch: "arm64e",
    path: "/System/Library/PrivateFrameworks/GraphicsServices.framework/GraphicsServices",
  },
  {
    name: "libsystem_kernel.dylib",
    uuid: LIBSYSTEM_KERNEL_UUID,
    load: LIBSYSTEM_KERNEL_LOAD,
    size: 0x40000,
    arch: "arm64e",
    path: "/usr/lib/system/libsystem_kernel.dylib",
  },
];

/*
 * A KSCrash report in its default unsymbolicated Apple format. `withImages`
 * false is a report KSCrash cut at 25 KB, its binary images gone.
 */
export function kscrashReport(input: {
  exceptionType: string;
  exceptionCodes: string;
  crashed: Array<FixtureFrame>;
  crashedIndex?: number | undefined;
  others?: Array<Array<FixtureFrame>> | undefined;
  lastExceptionBacktrace?: Array<FixtureFrame> | undefined;
  withImages?: boolean | undefined;
}): string {
  const crashedIndex: number = input.crashedIndex ?? 0;
  const lines: Array<string> = [
    "Incident Identifier: 9A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D",
    "CrashReporter Key:   5f1c0a62e7b0a4f1c3d2e1f0a9b8c7d6e5f4a3b2",
    "Hardware Model:      iPhone15,2",
    "Process:         MyApp [4521]",
    "Path:            /private/var/containers/Bundle/Application/1C2D3E4F-5A6B-4C7D-8E9F-0A1B2C3D4E5F/MyApp.app/MyApp",
    "Identifier:      com.example.myapp",
    "Version:         4.2 (812)",
    "Code Type:       ARM-64",
    "Parent Process:  ? [1]",
    "",
    "Date/Time:       2026-11-19 10:14:03.123 +0000",
    "OS Version:      iOS 18.1 (22B83)",
    "Report Version:  104",
    "",
    `Exception Type:  ${input.exceptionType}`,
    `Exception Codes: ${input.exceptionCodes}`,
    `Triggered by Thread:  ${crashedIndex}`,
  ];

  const threads: Array<Array<FixtureFrame>> = [...(input.others || [])];
  threads.splice(crashedIndex, 0, input.crashed);

  threads.forEach((threadFrames: Array<FixtureFrame>, index: number) => {
    lines.push("");

    if (index === 0) {
      lines.push("Thread 0 name:  Dispatch queue: com.apple.main-thread");
    }

    lines.push(
      index === crashedIndex ? `Thread ${index} Crashed:` : `Thread ${index}:`,
    );

    threadFrames.forEach((current: FixtureFrame, frameIndex: number) => {
      lines.push(kscrashFrameLine(current, frameIndex));
    });
  });

  if (input.lastExceptionBacktrace) {
    lines.push("", "Last Exception Backtrace:");
    input.lastExceptionBacktrace.forEach(
      (current: FixtureFrame, frameIndex: number) => {
        lines.push(kscrashFrameLine(current, frameIndex));
      },
    );
  }

  lines.push(
    "",
    `Thread ${crashedIndex} crashed with ARM Thread State (64-bit):`,
    "    x0: 0x0000000000000000   x1: 0x0000000000000010   x2: 0x0000000000000001",
    "    fp: 0x000000016f9b2f30   lr: 0x0000000100032004   sp: 0x000000016f9b2ef0",
  );

  if (input.withImages !== false) {
    lines.push("", "Binary Images:");

    for (const image of IMAGES) {
      lines.push(
        `${hex(image.load)} - ${hex(image.load + image.size - 1)} ${image.name} ${image.arch}  <${image.uuid.replace(/-/g, "").toLowerCase()}> ${image.path}`,
      );
    }

    lines.push("", "EOF", "");
  }

  return lines.join("\n");
}

// The crash, as KSCrash reported it on the next launch.
export const CRASH_KSCRASH_REPORT: string = kscrashReport({
  exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
  exceptionCodes: "KERN_INVALID_ADDRESS at 0x0000000000000010",
  crashed: CRASH_MAIN_THREAD,
  others: [IDLE_THREAD],
});

export const NSEXCEPTION_KSCRASH_REPORT: string = kscrashReport({
  exceptionType: "EXC_CRASH (SIGABRT)",
  exceptionCodes: "0x0000000000000000, 0x0000000000000000",
  crashed: NSEXCEPTION_KSCRASH_THREAD,
  lastExceptionBacktrace: NSEXCEPTION_KSCRASH_THREAD,
});

// The crash's own moment, and when MetricKit's payload period ended.
export const CRASHED_AT: Date = new Date("2026-11-19T10:14:03.123Z");
export const METRICKIT_PERIOD_END: Date = new Date("2026-11-19T23:59:59.000Z");
