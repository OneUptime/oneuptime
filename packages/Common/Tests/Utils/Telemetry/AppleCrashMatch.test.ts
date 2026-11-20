import { describe, expect, test } from "@jest/globals";
import {
  AppleCrashSignature,
  MATCH_WINDOW_MS,
  buildAppleCrashSignature,
  countAgreeingOutermostFrames,
  findAppleCrashPartner,
  isSameAppleCrash,
  readAppleExceptionType,
} from "../../../Utils/Telemetry/AppleCrashMatch";
import {
  AppleCrashReport,
  parseAppleCrashReport,
} from "../../../Utils/Telemetry/AppleCrashReport";
import { toReadableMetricKitStackTrace } from "../../../Utils/Telemetry/MetricKitCallStack";
import {
  CRASHED_AT,
  CRASH_KSCRASH_REPORT,
  CRASH_MAIN_THREAD,
  FixtureFrame,
  IDLE_THREAD,
  METRICKIT_PERIOD_END,
  NSEXCEPTION_KSCRASH_REPORT,
  NSEXCEPTION_TREE,
  kscrashReport,
  metricKitTree,
} from "./AppleCrashFixtures";

/*
 * #9923: an iOS app that registers both of opentelemetry-swift's crash
 * reporters reports each crash twice - KSCrash on the next launch, MetricKit
 * up to a day later. The two are one crash only when everything both say
 * agrees; a near miss - another install, another signal, another app frame,
 * the same reporter twice - is two crashes, and both are counted.
 */

const INSTALL: string = "E621E1F8-C36C-495A-93FC-0C247A3E6E5F";

function report(text: string): AppleCrashReport {
  return parseAppleCrashReport(text)!;
}

function kscrash(
  overrides: Partial<{
    text: string;
    install: string;
    time: Date;
    exceptionType: string;
  }> = {},
): AppleCrashSignature {
  return buildAppleCrashSignature({
    reporter: "kscrash",
    install: overrides.install ?? INSTALL,
    time: overrides.time ?? CRASHED_AT,
    report: report(overrides.text ?? CRASH_KSCRASH_REPORT),
    exceptionType: overrides.exceptionType ?? "EXC_BAD_ACCESS (SIGSEGV)",
  })!;
}

function metricKit(
  overrides: Partial<{
    tree: string;
    install: string;
    time: Date;
    exceptionType: string;
    signalName: string;
    machExceptionName: string;
    objcExceptionName: string;
  }> = {},
): AppleCrashSignature {
  return buildAppleCrashSignature({
    reporter: "metrickit",
    install: overrides.install ?? INSTALL,
    time: overrides.time ?? METRICKIT_PERIOD_END,
    report: report(
      toReadableMetricKitStackTrace(
        overrides.tree ??
          metricKitTree([
            { frames: IDLE_THREAD, attributed: false },
            { frames: CRASH_MAIN_THREAD, attributed: true },
          ]),
        "crash",
      )!,
    ),
    exceptionType: overrides.exceptionType ?? "EXC_BAD_ACCESS",
    signalName: overrides.signalName ?? "SIGSEGV",
    machExceptionName: overrides.machExceptionName ?? "EXC_BAD_ACCESS",
    objcExceptionName: overrides.objcExceptionName,
  })!;
}

// The crash's main thread with one of the app's frames somewhere else.
function withAppFrameMoved(by: number): Array<FixtureFrame> {
  return CRASH_MAIN_THREAD.map((frame: FixtureFrame, index: number) => {
    return index === 1 ? { ...frame, offset: frame.offset + by } : frame;
  });
}

describe("what a report says about its crash", () => {
  test("KSCrash's exception type names the Mach exception and the signal, or the signal, or the exception", () => {
    expect(readAppleExceptionType("EXC_BAD_ACCESS (SIGSEGV)")).toEqual({
      machException: "EXC_BAD_ACCESS",
      signal: "SIGSEGV",
      exceptionName: null,
    });
    expect(readAppleExceptionType("SIGABRT")).toEqual({
      machException: null,
      signal: "SIGABRT",
      exceptionName: null,
    });
    expect(readAppleExceptionType("EXC_BREAKPOINT")).toEqual({
      machException: "EXC_BREAKPOINT",
      signal: null,
      exceptionName: null,
    });
    expect(readAppleExceptionType("NSRangeException")).toEqual({
      machException: null,
      signal: null,
      exceptionName: "NSRangeException",
    });
    // A report KSCrash could not decode is typed "crash": that names nothing.
    expect(readAppleExceptionType("crash").exceptionName).toBeNull();
    expect(readAppleExceptionType(undefined).exceptionName).toBeNull();
  });

  test("a KSCrash signature: the install, the crash's time, the header's exception and the crashed thread's frames", () => {
    const signature: AppleCrashSignature = kscrash();

    expect(signature).toMatchObject({
      reporter: "kscrash",
      install: INSTALL,
      time: CRASHED_AT.getTime(),
      signal: "SIGSEGV",
      machException: "EXC_BAD_ACCESS",
      exceptionName: null,
    });
    expect(
      signature.frames.map((frame: { binary: string; offset: number }) => {
        return `${frame.binary} + ${frame.offset}`;
      }),
    ).toEqual(
      CRASH_MAIN_THREAD.map((frame: FixtureFrame) => {
        return `${frame.binaryName} + ${frame.offset}`;
      }),
    );
    expect(signature.frames[0]!.isApp).toBe(true);
    expect(signature.frames[2]!.isApp).toBe(false);
  });

  test("a MetricKit signature reads its signal and exception from its own attributes", () => {
    expect(metricKit({ objcExceptionName: "NSRangeException" })).toMatchObject({
      reporter: "metrickit",
      signal: "SIGSEGV",
      machException: "EXC_BAD_ACCESS",
      exceptionName: "NSRangeException",
    });
  });

  test("a report whose crashed thread KSCrash cut off has no signature: no other thread stands in for it", () => {
    const cut: string = CRASH_KSCRASH_REPORT.replace(
      "Thread 0 Crashed:",
      "Thread 0:",
    ).replace("Triggered by Thread:  0", "");

    expect(
      buildAppleCrashSignature({
        reporter: "kscrash",
        install: INSTALL,
        time: CRASHED_AT,
        report: report(cut),
        exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
      }),
    ).toBeNull();
  });
});

describe("one crash, reported twice", () => {
  test("a signal crash: KSCrash on the next launch, MetricKit at the end of its day - one crash", () => {
    expect(isSameAppleCrash(kscrash(), metricKit())).toBe(true);
    // Either way round.
    expect(isSameAppleCrash(metricKit(), kscrash())).toBe(true);
  });

  test("an uncaught NSException: KSCrash's throw backtrace and MetricKit's aborted thread agree from main up to the throw", () => {
    const fromKSCrash: AppleCrashSignature = buildAppleCrashSignature({
      reporter: "kscrash",
      install: INSTALL,
      time: CRASHED_AT,
      report: report(NSEXCEPTION_KSCRASH_REPORT),
      exceptionType: "NSRangeException",
    })!;
    const fromMetricKit: AppleCrashSignature = metricKit({
      tree: NSEXCEPTION_TREE,
      exceptionType: "NSRangeException",
      signalName: "SIGABRT",
      machExceptionName: "EXC_CRASH",
      objcExceptionName: "NSRangeException",
    });

    expect(fromKSCrash.machException).toBe("EXC_CRASH");
    expect(fromKSCrash.signal).toBe("SIGABRT");
    expect(
      countAgreeingOutermostFrames(fromKSCrash.frames, fromMetricKit.frames),
    ).toBe(9);
    expect(isSameAppleCrash(fromKSCrash, fromMetricKit)).toBe(true);
  });

  test("an iOS 16 MetricKit report, which names no Objective-C exception, still pairs with KSCrash's named one", () => {
    const fromKSCrash: AppleCrashSignature = buildAppleCrashSignature({
      reporter: "kscrash",
      install: INSTALL,
      time: CRASHED_AT,
      report: report(NSEXCEPTION_KSCRASH_REPORT),
      exceptionType: "NSRangeException",
    })!;

    expect(
      isSameAppleCrash(
        fromKSCrash,
        metricKit({
          tree: NSEXCEPTION_TREE,
          exceptionType: "EXC_CRASH",
          signalName: "SIGABRT",
          machExceptionName: "EXC_CRASH",
        }),
      ),
    ).toBe(true);
  });

  test("KSCrash stamped at the next launch, when it could not restore the crash's time, is still within the window", () => {
    expect(
      isSameAppleCrash(
        kscrash({ time: new Date(METRICKIT_PERIOD_END.getTime() + 3600000) }),
        metricKit(),
      ),
    ).toBe(true);
  });
});

describe("near misses: two crashes, never one", () => {
  test("the same reporter twice: a reporter never reports one crash twice", () => {
    expect(isSameAppleCrash(kscrash(), kscrash())).toBe(false);
    expect(isSameAppleCrash(metricKit(), metricKit())).toBe(false);
  });

  test("another install, or none", () => {
    expect(
      isSameAppleCrash(
        kscrash(),
        metricKit({ install: "5B1F6D2E-0D5A-4A7B-9E3C-2F8B6A1D4C70" }),
      ),
    ).toBe(false);
    expect(
      isSameAppleCrash(kscrash({ install: "" }), metricKit({ install: "" })),
    ).toBe(false);
  });

  test("further apart than a day and two hours", () => {
    expect(
      isSameAppleCrash(
        kscrash(),
        metricKit({
          time: new Date(CRASHED_AT.getTime() + MATCH_WINDOW_MS + 1),
        }),
      ),
    ).toBe(false);
    expect(
      isSameAppleCrash(
        kscrash(),
        metricKit({ time: new Date(CRASHED_AT.getTime() + MATCH_WINDOW_MS) }),
      ),
    ).toBe(true);
    expect(MATCH_WINDOW_MS).toBe(26 * 60 * 60 * 1000);
  });

  test("another signal, Mach exception or exception name", () => {
    expect(
      isSameAppleCrash(kscrash(), metricKit({ signalName: "SIGBUS" })),
    ).toBe(false);
    expect(
      isSameAppleCrash(
        kscrash(),
        metricKit({ machExceptionName: "EXC_BREAKPOINT" }),
      ),
    ).toBe(false);
    expect(
      isSameAppleCrash(
        kscrash({ exceptionType: "NSInvalidArgumentException" }),
        metricKit({ objcExceptionName: "NSRangeException" }),
      ),
    ).toBe(false);
  });

  test("the same signal at another place in the app's code: one app frame elsewhere", () => {
    expect(
      isSameAppleCrash(
        kscrash(),
        metricKit({
          tree: metricKitTree([
            { frames: withAppFrameMoved(16), attributed: true },
          ]),
        }),
      ),
    ).toBe(false);
  });

  test("the same code, called from elsewhere: the frames under it differ", () => {
    const calledFromElsewhere: Array<FixtureFrame> = CRASH_MAIN_THREAD.map(
      (frame: FixtureFrame, index: number) => {
        return index === CRASH_MAIN_THREAD.length - 2
          ? { ...frame, offset: frame.offset + 4 }
          : frame;
      },
    );

    expect(
      isSameAppleCrash(
        kscrash(),
        metricKit({
          tree: metricKitTree([
            { frames: calledFromElsewhere, attributed: true },
          ]),
        }),
      ),
    ).toBe(false);
  });

  test("another build of the app: its code moved, its offsets with it", () => {
    const nextBuild: Array<FixtureFrame> = CRASH_MAIN_THREAD.map(
      (frame: FixtureFrame) => {
        return frame.binaryName === "MyApp"
          ? { ...frame, offset: frame.offset + 512 }
          : frame;
      },
    );

    expect(
      isSameAppleCrash(
        kscrash(),
        metricKit({
          tree: metricKitTree([{ frames: nextBuild, attributed: true }]),
        }),
      ),
    ).toBe(false);
  });

  test("a crash in Apple's code alone must agree frame for frame, and on enough frames", () => {
    const systemOnly: Array<FixtureFrame> = CRASH_MAIN_THREAD.filter(
      (frame: FixtureFrame) => {
        return frame.binaryName !== "MyApp";
      },
    );
    const systemReport: string = kscrashReport({
      exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
      exceptionCodes: "KERN_INVALID_ADDRESS at 0x0000000000000010",
      crashed: systemOnly,
    });
    const fromKSCrash: AppleCrashSignature = kscrash({ text: systemReport });

    expect(
      isSameAppleCrash(
        fromKSCrash,
        metricKit({
          tree: metricKitTree([{ frames: systemOnly, attributed: true }]),
        }),
      ),
    ).toBe(true);
    // One frame more at the top: Apple's code alone, but not the same.
    expect(
      isSameAppleCrash(
        fromKSCrash,
        metricKit({
          tree: metricKitTree([
            {
              frames: [IDLE_THREAD[0]!, ...systemOnly],
              attributed: true,
            },
          ]),
        }),
      ),
    ).toBe(false);

    const twoFrames: Array<FixtureFrame> = systemOnly.slice(-2);

    expect(
      isSameAppleCrash(
        kscrash({
          text: kscrashReport({
            exceptionType: "EXC_BAD_ACCESS (SIGSEGV)",
            exceptionCodes: "KERN_INVALID_ADDRESS at 0x0000000000000010",
            crashed: twoFrames,
          }),
        }),
        metricKit({
          tree: metricKitTree([{ frames: twoFrames, attributed: true }]),
        }),
      ),
    ).toBe(false);
  });
});

describe("each report pairs once, the nearest in time first", () => {
  interface Entry {
    id: string;
    signature: AppleCrashSignature;
    pairedWith?: string | null;
  }

  test("a crash loop's reports pair in the order they happened", () => {
    const first: Entry = {
      id: "k1",
      signature: kscrash({ time: new Date("2026-11-19T10:00:00.000Z") }),
    };
    const second: Entry = {
      id: "k2",
      signature: kscrash({ time: new Date("2026-11-19T10:02:00.000Z") }),
    };

    expect(
      findAppleCrashPartner(
        metricKit({ time: new Date("2026-11-19T10:01:50.000Z") }),
        [first, second],
      )!.id,
    ).toBe("k2");
  });

  test("a report already paired is never paired again: two crashes stay two", () => {
    const paired: Entry = {
      id: "k1",
      signature: kscrash(),
      pairedWith: "m1",
    };

    expect(findAppleCrashPartner(metricKit(), [paired])).toBeNull();
  });

  test("nothing that is the same crash is no partner", () => {
    expect(
      findAppleCrashPartner(metricKit(), [
        { id: "k1", signature: kscrash({ install: "another" }) },
        { id: "m0", signature: metricKit() },
      ]),
    ).toBeNull();
  });
});
