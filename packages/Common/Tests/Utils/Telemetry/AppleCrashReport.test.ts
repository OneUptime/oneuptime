import { describe, expect, test } from "@jest/globals";
import {
  AppleCrashFrame,
  AppleCrashReport,
  AppleCrashThread,
  findAppleImage,
  getAttributedAppleThread,
  isAppleAppFrame,
  isAppleSystemBinary,
  parseAppleCrashReport,
  readAppleFrameLine,
} from "../../../Utils/Telemetry/AppleCrashReport";
import { toReadableMetricKitStackTrace } from "../../../Utils/Telemetry/MetricKitCallStack";
import {
  APP_LOAD,
  APP_UUID,
  CRASH_KSCRASH_REPORT,
  CRASH_MAIN_THREAD,
  CRASH_TREE,
  FixtureFrame,
  HANG_MAIN_THREAD,
  HANG_TREE,
  IDLE_THREAD,
  NSEXCEPTION_KSCRASH_REPORT,
  NSEXCEPTION_KSCRASH_THREAD,
  UIKIT_UUID,
  kscrashFrameLine,
  kscrashReport,
  metricKitSimplifiedTree,
} from "./AppleCrashFixtures";

/*
 * #9922, #9923: an iOS app's crash or hang report read back into threads of
 * frames - each frame's binary and its offset into the binary, what a dSYM
 * resolves and what two reports of one crash are compared by.
 */

function offsetsOf(thread: AppleCrashThread): Array<string> {
  return thread.frames.map((frame: AppleCrashFrame): string => {
    return `${frame.binaryName} + ${frame.offset}`;
  });
}

function expected(frames: Array<FixtureFrame>): Array<string> {
  return frames.map((frame: FixtureFrame): string => {
    return `${frame.binaryName} + ${frame.offset}`;
  });
}

describe("KSCrash's Apple-format report", () => {
  const report: AppleCrashReport = parseAppleCrashReport(CRASH_KSCRASH_REPORT)!;

  test("reads every thread, and the one that crashed", () => {
    expect(report).not.toBeNull();
    expect(
      report.threads.map((thread: AppleCrashThread) => {
        return [thread.index, thread.isAttributed, thread.frames.length];
      }),
    ).toEqual([
      [0, true, CRASH_MAIN_THREAD.length],
      [1, false, IDLE_THREAD.length],
    ]);
    expect(getAttributedAppleThread(report)!.index).toBe(0);
  });

  test("reads each frame's binary, address, load address and offset", () => {
    const thread: AppleCrashThread = getAttributedAppleThread(report)!;

    expect(offsetsOf(thread)).toEqual(expected(CRASH_MAIN_THREAD));
    expect(thread.frames[0]).toMatchObject({
      index: 0,
      binaryName: "MyApp",
      address: APP_LOAD + 229796,
      loadAddress: APP_LOAD,
      offset: 229796,
      symbol: null,
    });
  });

  test("reads the exception the header names", () => {
    expect(report.machException).toBe("EXC_BAD_ACCESS");
    expect(report.signal).toBe("SIGSEGV");
  });

  test("reads the binary images: their UUIDs as one form, their paths and architectures", () => {
    const app: ReturnType<typeof findAppleImage> = findAppleImage(
      report,
      getAttributedAppleThread(report)!.frames[0]!,
    );

    expect(app).toEqual({
      name: "MyApp",
      debugId: APP_UUID,
      loadAddress: APP_LOAD,
      path: "/private/var/containers/Bundle/Application/1C2D3E4F-5A6B-4C7D-8E9F-0A1B2C3D4E5F/MyApp.app/MyApp",
      architecture: "arm64",
    });
    expect(
      report.images.find((image: { name: string }) => {
        return image.name === "UIKitCore";
      })!.debugId,
    ).toBe(UIKIT_UUID);
  });

  test("tells the app's frames from Apple's by their paths", () => {
    const thread: AppleCrashThread = getAttributedAppleThread(report)!;

    expect(
      thread.frames.map((frame: AppleCrashFrame): boolean => {
        return isAppleAppFrame(report, frame);
      }),
    ).toEqual([true, true, false, false, false, false, false, true, false]);
  });

  test("a crashed thread that is not the first is still the one", () => {
    const later: AppleCrashReport = parseAppleCrashReport(
      kscrashReport({
        exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
        exceptionCodes: "KERN_INVALID_ADDRESS at 0x0000000000000010",
        crashed: CRASH_MAIN_THREAD,
        crashedIndex: 2,
        others: [IDLE_THREAD, IDLE_THREAD],
      }),
    )!;

    expect(getAttributedAppleThread(later)!.index).toBe(2);
    expect(offsetsOf(getAttributedAppleThread(later)!)).toEqual(
      expected(CRASH_MAIN_THREAD),
    );
  });

  test("a report cut before its binary images still reads its frames, with no UUID to resolve them by", () => {
    const cut: AppleCrashReport = parseAppleCrashReport(
      kscrashReport({
        exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
        exceptionCodes: "KERN_INVALID_ADDRESS at 0x0000000000000010",
        crashed: CRASH_MAIN_THREAD,
        withImages: false,
      }),
    )!;

    expect(offsetsOf(getAttributedAppleThread(cut)!)).toEqual(
      expected(CRASH_MAIN_THREAD),
    );
    expect(cut.images).toEqual([]);
  });

  test("an NSException's report keeps its last exception backtrace", () => {
    const exception: AppleCrashReport = parseAppleCrashReport(
      NSEXCEPTION_KSCRASH_REPORT,
    )!;

    expect(exception.machException).toBe("EXC_CRASH");
    expect(exception.signal).toBe("SIGABRT");
    expect(
      exception.lastExceptionBacktrace!.map((frame: AppleCrashFrame) => {
        return `${frame.binaryName} + ${frame.offset}`;
      }),
    ).toEqual(expected(NSEXCEPTION_KSCRASH_THREAD));
  });

  test("the register dump and the header's other lines are no frames", () => {
    const thread: AppleCrashThread = getAttributedAppleThread(report)!;

    expect(thread.frames).toHaveLength(CRASH_MAIN_THREAD.length);
    expect(report.threads).toHaveLength(2);
  });
});

describe("KSCrash's other report styles", () => {
  test("a frame named by the device's symbol takes its offset from the binary's load address", () => {
    const text: string = CRASH_KSCRASH_REPORT.replace(
      kscrashFrameLine(CRASH_MAIN_THREAD[2]!, 2),
      `2   UIKitCore                     \t0x${(0x1a3a00000 + 1361368).toString(16).padStart(16, "0")} -[UIApplication sendAction:to:from:forEvent:] + 96`,
    );
    const frame: AppleCrashFrame = getAttributedAppleThread(
      parseAppleCrashReport(text)!,
    )!.frames[2]!;

    expect(frame).toMatchObject({
      binaryName: "UIKitCore",
      symbol: "-[UIApplication sendAction:to:from:forEvent:]",
      symbolOffset: 96,
      loadAddress: 0x1a3a00000,
      offset: 1361368,
    });
  });

  test("side by side, both the position and the symbol", () => {
    expect(
      readAppleFrameLine(
        "7   MyApp                         \t0x0000000100008f60 0x100004000 + 20320 (main + 52)",
        3,
      ),
    ).toEqual({
      index: 7,
      binaryName: "MyApp",
      offset: 20320,
      address: 0x100008f60,
      loadAddress: APP_LOAD,
      symbol: "main",
      symbolOffset: 52,
      lineIndex: 3,
    });
  });

  test("a symbol KSCrash could not name is no symbol", () => {
    expect(
      readAppleFrameLine(
        "1   MyApp                         \t0x0000000100032004 0x100004000 + 188420 ((null) + 0)",
        0,
      )!.symbol,
    ).toBeNull();
    expect(
      readAppleFrameLine(
        "1   MyApp                         \t0x0000000100032004 <redacted> + 12",
        0,
      )!.symbol,
    ).toBeNull();
  });

  test("a binary whose name has spaces in it is read whole", () => {
    expect(
      readAppleFrameLine(
        "0   My Shop App                   \t0x000000010003c1a4 0x100004000 + 229796",
        0,
      )!.binaryName,
    ).toBe("My Shop App");
    expect(
      readAppleFrameLine(
        "0   My Shop App                    My Shop App + 229796",
        0,
      ),
    ).toMatchObject({ binaryName: "My Shop App", offset: 229796 });
  });
});

describe("the threads OneUptime draws from MetricKit", () => {
  test("a crash's tree, drawn and read back: the crashed thread, its frames and its binaries' UUIDs", () => {
    const drawn: string = toReadableMetricKitStackTrace(CRASH_TREE, "crash")!;
    const report: AppleCrashReport = parseAppleCrashReport(drawn)!;
    const thread: AppleCrashThread = getAttributedAppleThread(report)!;

    expect(thread.isAttributed).toBe(true);
    expect(offsetsOf(thread)).toEqual(expected(CRASH_MAIN_THREAD));
    expect(thread.frames[0]!.address).toBe(APP_LOAD + 229796);
    expect(thread.frames[0]!.loadAddress).toBe(APP_LOAD);
    expect(findAppleImage(report, thread.frames[0]!)!.debugId).toBe(APP_UUID);
  });

  test("a hang's tree: the hung thread is the attributed one", () => {
    const report: AppleCrashReport = parseAppleCrashReport(
      toReadableMetricKitStackTrace(HANG_TREE, "hang")!,
    )!;

    expect(offsetsOf(getAttributedAppleThread(report)!)).toEqual(
      expected(HANG_MAIN_THREAD),
    );
  });

  test("opentelemetry-swift's own shape, which drops the addresses, reads the same offsets", () => {
    const report: AppleCrashReport = parseAppleCrashReport(
      toReadableMetricKitStackTrace(
        metricKitSimplifiedTree([
          { frames: CRASH_MAIN_THREAD, attributed: true },
        ]),
        "crash",
      )!,
    )!;
    const thread: AppleCrashThread = getAttributedAppleThread(report)!;

    expect(offsetsOf(thread)).toEqual(expected(CRASH_MAIN_THREAD));
    expect(thread.frames[0]!.address).toBeNull();
    expect(findAppleImage(report, thread.frames[0]!)!.debugId).toBe(APP_UUID);
  });

  test("with no path, the app's binaries are told from Apple's by name", () => {
    const report: AppleCrashReport = parseAppleCrashReport(
      toReadableMetricKitStackTrace(CRASH_TREE, "crash")!,
    )!;

    expect(
      getAttributedAppleThread(report)!.frames.map(
        (frame: AppleCrashFrame): boolean => {
          return isAppleAppFrame(report, frame);
        },
      ),
    ).toEqual([true, true, false, false, false, false, false, true, false]);
  });
});

describe("which binaries are Apple's", () => {
  test("by path: the system's, never the app bundle's", () => {
    expect(
      isAppleSystemBinary({
        name: "Kingfisher",
        path: "/private/var/containers/Bundle/Application/X/MyApp.app/Frameworks/Kingfisher.framework/Kingfisher",
      }),
    ).toBe(false);
    expect(
      isAppleSystemBinary({
        name: "MyWidget",
        path: "/private/var/containers/Bundle/Application/X/MyApp.app/PlugIns/MyWidget.appex/MyWidget",
      }),
    ).toBe(false);
    expect(
      isAppleSystemBinary({
        name: "UIKitCore",
        path: "/System/Library/PrivateFrameworks/UIKitCore.framework/UIKitCore",
      }),
    ).toBe(true);
    expect(
      isAppleSystemBinary({
        name: "libswiftCore.dylib",
        path: "/usr/lib/swift/libswiftCore.dylib",
      }),
    ).toBe(true);
    expect(
      isAppleSystemBinary({
        name: "WebKit",
        path: "/private/preboot/Cryptexes/OS/System/Library/Frameworks/WebKit.framework/WebKit",
      }),
    ).toBe(true);
  });

  test("by name, when there is no path: dyld, any dylib, the frameworks iOS ships", () => {
    for (const name of [
      "dyld",
      "libsystem_kernel.dylib",
      "libobjc.A.dylib",
      "UIKitCore",
      "Foundation",
      "CoreFoundation",
      "SwiftUI",
      "GraphicsServices",
    ]) {
      expect(isAppleSystemBinary({ name })).toBe(true);
    }

    for (const name of ["MyApp", "Kingfisher", "MyAppCore", "Alamofire"]) {
      expect(isAppleSystemBinary({ name })).toBe(false);
    }
  });
});

describe("what is not a crash report", () => {
  test("anything else is null, never thrown at", () => {
    const javaTrace: string = [
      "java.lang.IllegalStateException: checkout failed",
      "\tat com.example.Cart.checkout(Cart.java:42)",
      "\tat com.example.CartActivity.onClick(CartActivity.java:17)",
    ].join("\n");

    for (const text of [
      "",
      "not a report",
      javaTrace,
      "Thread 0 Crashed:\n",
      "Thread 0:\nnot a frame\n",
      undefined as unknown as string,
      42 as unknown as string,
      "x".repeat(5 * 1024 * 1024),
    ]) {
      expect(parseAppleCrashReport(text)).toBeNull();
    }
  });

  test("a frame line with an address too large to hold exactly is no frame", () => {
    expect(
      readAppleFrameLine(
        "0   MyApp                         \t0xffffffffffffffff 0x100004000 + 229796",
        0,
      ),
    ).toBeNull();
  });
});
