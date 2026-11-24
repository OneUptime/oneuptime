import { describe, expect, test } from "@jest/globals";
import {
  AppleCrashFrame,
  AppleCrashReport,
  getAttributedAppleThread,
  parseAppleCrashReport,
} from "../../../Utils/Telemetry/AppleCrashReport";
import {
  AppleSymbol,
  AppleSymbolTable,
  decodeAppleSymbols,
  encodeAppleSymbols,
} from "../../../Utils/Telemetry/AppleSymbols";
import {
  AppleSymbolicationResult,
  getAppleReportDebugIds,
  resolveAppleFrame,
  symbolicateAppleReport,
} from "../../../Utils/Telemetry/AppleSymbolicate";
import { toReadableMetricKitStackTrace } from "../../../Utils/Telemetry/MetricKitCallStack";
import { toAppleSymbolDisplayName } from "../../../Utils/Telemetry/SwiftDemangle";
import {
  ExceptionGroupingBasis,
  ExceptionGroupingKey,
  getExceptionGroupingKey,
} from "../../../Server/Utils/Telemetry/ExceptionGrouping";
import {
  APP_UUID,
  APP_UUID_COMPACT,
  CRASH_KSCRASH_REPORT,
  CRASH_MAIN_THREAD,
  CRASH_TREE,
  FixtureFrame,
  HANG_MAIN_THREAD,
  HANG_TREE,
  IDLE_THREAD,
  NEXT_BUILD_UUID,
  NSEXCEPTION_KSCRASH_REPORT,
  NSEXCEPTION_TREE,
  kscrashReport,
  metricKitTree,
} from "./AppleCrashFixtures";

/*
 * #9922: an iOS app's crash and hang stacks, each frame of the app named
 * by the function its build's dSYM says it is in, and grouped by those
 * functions - so one crash is one exception in every release of the app,
 * though its code moves from build to build.
 */

// Where the next build moved the app's code: every function 4 KB later.
const MOVED_BY: number = 4096;

// The app's functions in the build the fixtures crashed in (APP_UUID).
const APP_SYMBOLS: Array<AppleSymbol> = [
  { offset: 20000, name: "main" },
  { offset: 150032, name: "$s5MyApp4CartV3addyyAA4ItemVF" },
  { offset: 188368, name: "$s5MyApp18CartViewControllerC4loadyyKF" },
  { offset: 229064, name: "$s5MyApp18CartViewControllerC8checkoutyyF" },
  { offset: 310000, name: "$s5MyApp18CartViewControllerC5fetch2idS2i_tYaKF" },
  { offset: 310500, name: "$s5MyApp8topLevelyS2i_SitF" },
];

const TEXT_END: number = 400000;

function tableOf(
  symbols: Array<AppleSymbol>,
  textEndOffset: number = TEXT_END,
): AppleSymbolTable {
  return decodeAppleSymbols(encodeAppleSymbols({ symbols, textEndOffset }))!;
}

const BUILD_ONE: AppleSymbolTable = tableOf(APP_SYMBOLS);

// The same functions in the next build: a new UUID, every one moved.
const BUILD_TWO: AppleSymbolTable = tableOf(
  APP_SYMBOLS.map((symbol: AppleSymbol): AppleSymbol => {
    return { offset: symbol.offset + MOVED_BY, name: symbol.name };
  }),
  TEXT_END + MOVED_BY,
);

const TABLES: Map<string, AppleSymbolTable> = new Map<string, AppleSymbolTable>(
  [
    [APP_UUID, BUILD_ONE],
    [NEXT_BUILD_UUID, BUILD_TWO],
  ],
);

// A thread of the next build: the app's frames moved, Apple's as they were.
function inNextBuild(frames: Array<FixtureFrame>): Array<FixtureFrame> {
  return frames.map((frame: FixtureFrame): FixtureFrame => {
    return frame.binaryUUID === APP_UUID
      ? {
          ...frame,
          binaryUUID: NEXT_BUILD_UUID,
          offset: frame.offset + MOVED_BY,
        }
      : frame;
  });
}

const NEXT_BUILD_UUID_COMPACT: string = NEXT_BUILD_UUID.replace(
  /-/g,
  "",
).toLowerCase();

// KSCrash's report of the same crash in the next build.
const NEXT_BUILD_KSCRASH_REPORT: string = kscrashReport({
  exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
  exceptionCodes: "KERN_INVALID_ADDRESS at 0x0000000000000010",
  crashed: inNextBuild(CRASH_MAIN_THREAD),
  others: [IDLE_THREAD],
}).replace(APP_UUID_COMPACT, NEXT_BUILD_UUID_COMPACT);

const NEXT_BUILD_CRASH_TREE: string = metricKitTree([
  { frames: IDLE_THREAD, attributed: false },
  { frames: inNextBuild(CRASH_MAIN_THREAD), attributed: true },
]);

const NEXT_BUILD_HANG_TREE: string = metricKitTree([
  { frames: inNextBuild(HANG_MAIN_THREAD), attributed: true },
  { frames: IDLE_THREAD, attributed: false },
]);

function drawn(tree: string, kind: "crash" | "hang"): string {
  return toReadableMetricKitStackTrace(tree, kind)!;
}

function symbolicated(
  text: string,
  tables: Map<string, AppleSymbolTable> = TABLES,
): AppleSymbolicationResult {
  return symbolicateAppleReport({
    report: parseAppleCrashReport(text)!,
    tables,
    displayName: toAppleSymbolDisplayName,
  });
}

// The attributed thread's frames, as grouping reads them back.
function attributedFrames(text: string): Array<string> {
  const report: AppleCrashReport = parseAppleCrashReport(text)!;

  return getAttributedAppleThread(report)!.frames.map(
    (frame: AppleCrashFrame): string => {
      return frame.symbol
        ? `${frame.binaryName}: ${frame.symbol}`
        : `${frame.binaryName} + ${frame.offset}`;
    },
  );
}

function groupingKey(
  exceptionType: string,
  stackTrace: string,
): ExceptionGroupingKey {
  return getExceptionGroupingKey({
    exceptionType,
    message: "Could not access memory",
    stackTrace,
  });
}

describe("the builds a report asks for", () => {
  test("the app's own binaries, once each: Apple's are in no app's dSYMs", () => {
    expect(
      getAppleReportDebugIds(parseAppleCrashReport(CRASH_KSCRASH_REPORT)!),
    ).toEqual([APP_UUID]);
    expect(
      getAppleReportDebugIds(
        parseAppleCrashReport(drawn(CRASH_TREE, "crash"))!,
      ),
    ).toEqual([APP_UUID]);
    expect(
      getAppleReportDebugIds(parseAppleCrashReport(drawn(HANG_TREE, "hang"))!),
    ).toEqual([APP_UUID]);
  });

  test("a report KSCrash cut before its binary images names no build to ask for", () => {
    const cut: string = kscrashReport({
      exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
      exceptionCodes: "KERN_INVALID_ADDRESS at 0x0000000000000010",
      crashed: CRASH_MAIN_THREAD,
      withImages: false,
    });

    expect(getAppleReportDebugIds(parseAppleCrashReport(cut)!)).toEqual([]);
  });
});

describe("the function a frame is in", () => {
  function frameAt(index: number, offset: number): AppleCrashFrame {
    return {
      index,
      binaryName: "MyApp",
      offset,
      address: null,
      loadAddress: null,
      symbol: null,
      symbolOffset: null,
      lineIndex: 0,
    };
  }

  test("the innermost frame is where the code was", () => {
    expect(resolveAppleFrame(frameAt(0, 229064), BUILD_ONE)).toEqual({
      name: "$s5MyApp18CartViewControllerC8checkoutyyF",
      symbolOffset: 0,
    });
  });

  test("a caller's frame is the return address, read one byte earlier: a call that ends its function names that function, not the next", () => {
    // checkout() starts at 229064: a call at load()'s very end returns there.
    expect(resolveAppleFrame(frameAt(1, 229064), BUILD_ONE)).toEqual({
      name: "$s5MyApp18CartViewControllerC4loadyyKF",
      symbolOffset: 229064 - 188368,
    });
    expect(resolveAppleFrame(frameAt(1, 188420), BUILD_ONE)).toEqual({
      name: "$s5MyApp18CartViewControllerC4loadyyKF",
      symbolOffset: 52,
    });
  });

  test("no function before the first symbol or past the end of the code", () => {
    expect(resolveAppleFrame(frameAt(0, 100), BUILD_ONE)).toBe(null);
    expect(resolveAppleFrame(frameAt(0, TEXT_END), BUILD_ONE)).toBe(null);
    expect(
      resolveAppleFrame({ ...frameAt(0, 0), offset: null }, BUILD_ONE),
    ).toBe(null);
  });
});

describe("a crash KSCrash reported, symbolicated", () => {
  const result: AppleSymbolicationResult = symbolicated(CRASH_KSCRASH_REPORT);

  test("names each of the app's frames by its function, beside where it was", () => {
    expect(result.resolvedFrames).toBe(3);

    const lines: Array<string> = result.text.split("\n");

    expect(lines).toContain(
      "0   MyApp                          0x000000010003c1a4 0x100004000 + 229796 (CartViewController.checkout() + 732)",
    );
    expect(lines).toContain(
      "1   MyApp                          0x0000000100032004 0x100004000 + 188420 (CartViewController.load() + 52)",
    );
    expect(lines).toContain(
      "7   MyApp                          0x0000000100008f60 0x100004000 + 20320 (main + 320)",
    );
  });

  test("leaves Apple's frames and everything else of the report as it was", () => {
    const before: Array<string> = CRASH_KSCRASH_REPORT.split("\n");
    const after: Array<string> = result.text.split("\n");

    expect(after).toHaveLength(before.length);

    const changed: Array<number> = [];

    before.forEach((line: string, index: number) => {
      if (after[index] !== line) {
        changed.push(index);
      }
    });

    expect(changed).toHaveLength(3);

    for (const index of changed) {
      expect(before[index]).toMatch(/^\d+\s+MyApp\s/);
    }

    expect(after).toContain("Exception Type:  EXC_BAD_ACCESS (SIGSEGV)");
    expect(after).toContain(
      "2   UIKitCore                     \t0x00000001a3b4c5d8 0x1a3a00000 + 1361368",
    );
  });

  test("reads back with each frame's function and its offset, so grouping and a later dSYM still have both", () => {
    expect(attributedFrames(result.text)).toEqual([
      "MyApp: CartViewController.checkout()",
      "MyApp: CartViewController.load()",
      "UIKitCore + 1361368",
      "UIKitCore + 1053236",
      "CoreFoundation + 1233892",
      "GraphicsServices + 6956",
      "UIKitCore + 2744560",
      "MyApp: main",
      "dyld + 41300",
    ]);

    const report: AppleCrashReport = parseAppleCrashReport(result.text)!;
    const first: AppleCrashFrame = getAttributedAppleThread(report)!.frames[0]!;

    expect(first.offset).toBe(229796);
    expect(first.symbolOffset).toBe(732);
  });

  test("an uncaught exception's backtrace is named too", () => {
    const named: AppleSymbolicationResult = symbolicated(
      NSEXCEPTION_KSCRASH_REPORT,
    );

    // The three app frames of the crashed thread, and of the backtrace.
    expect(named.resolvedFrames).toBe(6);
    expect(named.text).toContain("(Cart.add(_:) + 208)");
  });

  test("with no table for its build, nothing is named and the text is the report's", () => {
    const none: AppleSymbolicationResult = symbolicated(
      CRASH_KSCRASH_REPORT,
      new Map<string, AppleSymbolTable>(),
    );

    expect(none.resolvedFrames).toBe(0);
    expect(none.text).toBe(CRASH_KSCRASH_REPORT);
  });

  test("another build's table names none of this build's frames", () => {
    const other: AppleSymbolicationResult = symbolicated(
      CRASH_KSCRASH_REPORT,
      new Map<string, AppleSymbolTable>([[NEXT_BUILD_UUID, BUILD_TWO]]),
    );

    expect(other.resolvedFrames).toBe(0);
  });

  test("a name with nothing to show leaves its frame as it was, and a name is kept on its line", () => {
    const blank: AppleSymbolicationResult = symbolicateAppleReport({
      report: parseAppleCrashReport(CRASH_KSCRASH_REPORT)!,
      tables: TABLES,
      displayName: (): string => {
        return "  ";
      },
    });

    expect(blank.resolvedFrames).toBe(0);
    expect(blank.text).toBe(CRASH_KSCRASH_REPORT);

    const broken: AppleSymbolicationResult = symbolicateAppleReport({
      report: parseAppleCrashReport(CRASH_KSCRASH_REPORT)!,
      tables: TABLES,
      displayName: (symbol: string): string => {
        return `${symbol}\nThread 9 Crashed:`;
      },
    });

    expect(broken.text.split("\n")).toHaveLength(
      CRASH_KSCRASH_REPORT.split("\n").length,
    );
    expect(broken.text).not.toContain("\nThread 9 Crashed:");
  });
});

describe("MetricKit's crash and hang, symbolicated", () => {
  test("the crashed thread's app frames are named; the threads around it stay as drawn", () => {
    const crash: string = drawn(CRASH_TREE, "crash");
    const result: AppleSymbolicationResult = symbolicated(crash);

    expect(result.resolvedFrames).toBe(3);
    expect(attributedFrames(result.text)).toEqual([
      "MyApp: CartViewController.checkout()",
      "MyApp: CartViewController.load()",
      "UIKitCore + 1361368",
      "UIKitCore + 1053236",
      "CoreFoundation + 1233892",
      "GraphicsServices + 6956",
      "UIKitCore + 2744560",
      "MyApp: main",
      "dyld + 41300",
    ]);
  });

  test("a hang's waiting thread reads by the app's functions it was waiting in", () => {
    const result: AppleSymbolicationResult = symbolicated(
      drawn(HANG_TREE, "hang"),
    );

    expect(attributedFrames(result.text).slice(0, 4)).toEqual([
      "libsystem_kernel.dylib + 4812",
      "Foundation + 501236",
      "MyApp: topLevel(_:_:)",
      "MyApp: CartViewController.fetch(id:)",
    ]);
  });
});

describe("grouped by function, the same in every release", () => {
  test("without dSYMs, a crash groups by its offsets, which hold within one build only", () => {
    const one: ExceptionGroupingKey = groupingKey(
      "EXC_BAD_ACCESS",
      CRASH_KSCRASH_REPORT,
    );
    const two: ExceptionGroupingKey = groupingKey(
      "EXC_BAD_ACCESS",
      NEXT_BUILD_KSCRASH_REPORT,
    );

    expect(one.basis).toBe(ExceptionGroupingBasis.InAppFrames);
    expect(one.parts).toEqual([
      "MyApp|+229796",
      "MyApp|+188420",
      "MyApp|+20320",
    ]);
    expect(two.parts).not.toEqual(one.parts);
  });

  test("with each build's dSYM, the same crash in two builds is one exception", () => {
    const one: ExceptionGroupingKey = groupingKey(
      "EXC_BAD_ACCESS",
      symbolicated(CRASH_KSCRASH_REPORT).text,
    );
    const two: ExceptionGroupingKey = groupingKey(
      "EXC_BAD_ACCESS",
      symbolicated(NEXT_BUILD_KSCRASH_REPORT).text,
    );

    expect(one).toEqual({
      basis: ExceptionGroupingBasis.InAppFrames,
      exceptionType: "EXC_BAD_ACCESS",
      parts: [
        "MyApp|CartViewController.checkout()",
        "MyApp|CartViewController.load()",
        "MyApp|main",
      ],
    });
    expect(two).toEqual(one);
  });

  test("and so is MetricKit's report of it, in either build", () => {
    const kscrash: ExceptionGroupingKey = groupingKey(
      "EXC_BAD_ACCESS",
      symbolicated(CRASH_KSCRASH_REPORT).text,
    );

    for (const tree of [CRASH_TREE, NEXT_BUILD_CRASH_TREE]) {
      expect(
        groupingKey("EXC_BAD_ACCESS", symbolicated(drawn(tree, "crash")).text),
      ).toEqual(kscrash);
    }
  });

  test("a hang in two builds is one exception too", () => {
    expect(
      groupingKey("Hang", symbolicated(drawn(HANG_TREE, "hang")).text),
    ).toEqual(
      groupingKey(
        "Hang",
        symbolicated(drawn(NEXT_BUILD_HANG_TREE, "hang")).text,
      ),
    );
  });

  test("a frame the device named, mangled, groups with the one a dSYM named", () => {
    const deviceNamed: string = CRASH_KSCRASH_REPORT.replace(
      "0x000000010003c1a4 0x100004000 + 229796",
      "0x000000010003c1a4 $s5MyApp18CartViewControllerC8checkoutyyF + 732",
    )
      .replace(
        "0x0000000100032004 0x100004000 + 188420",
        "0x0000000100032004 $s5MyApp18CartViewControllerC4loadyyKF + 52",
      )
      .replace(
        "0x0000000100008f60 0x100004000 + 20320",
        "0x0000000100008f60 main + 320",
      );

    expect(groupingKey("EXC_BAD_ACCESS", deviceNamed)).toEqual(
      groupingKey("EXC_BAD_ACCESS", symbolicated(CRASH_KSCRASH_REPORT).text),
    );
  });

  test("a different crash in the same function is still told apart by what called it", () => {
    const elsewhere: string = kscrashReport({
      exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
      exceptionCodes: "KERN_INVALID_ADDRESS at 0x0000000000000010",
      crashed: [
        CRASH_MAIN_THREAD[0]!,
        { ...CRASH_MAIN_THREAD[1]!, offset: 150100 },
        ...CRASH_MAIN_THREAD.slice(2),
      ],
    });

    expect(
      groupingKey("EXC_BAD_ACCESS", symbolicated(elsewhere).text).parts,
    ).toEqual([
      "MyApp|CartViewController.checkout()",
      "MyApp|Cart.add(_:)",
      "MyApp|main",
    ]);
  });

  test("an NSException KSCrash and MetricKit both reported groups by the same app functions", () => {
    const kscrash: ExceptionGroupingKey = groupingKey(
      "NSRangeException",
      symbolicated(NSEXCEPTION_KSCRASH_REPORT).text,
    );
    const metricKit: ExceptionGroupingKey = groupingKey(
      "NSRangeException",
      symbolicated(drawn(NSEXCEPTION_TREE, "crash")).text,
    );

    expect(kscrash.parts).toEqual([
      "MyApp|Cart.add(_:)",
      "MyApp|CartViewController.load()",
      "MyApp|main",
    ]);
    expect(metricKit).toEqual(kscrash);
  });
});
