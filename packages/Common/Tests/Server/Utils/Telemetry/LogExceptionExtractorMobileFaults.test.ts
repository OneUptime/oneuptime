import LogExceptionExtractor, {
  ExtractedLogException,
  LogExceptionExtractorInput,
} from "../../../../Server/Utils/Telemetry/LogExceptionExtractor";
import {
  ANR_EXCEPTION_MESSAGE,
  ANR_EXCEPTION_TYPE,
  HANG_EXCEPTION_MESSAGE,
  HANG_EXCEPTION_TYPE,
} from "../../../../Utils/Telemetry/MobileAppFaults";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A mobile app's crashes and ANRs, as OpenTelemetry Android reports them:
 * log records that are events (`app.crash`, `device.anr`), never spans.
 *
 * Before, a crash was filed as a handled exception - it sets no
 * exception.escaped, and only that made a log-derived exception unhandled -
 * and an ANR, which carries the main thread's stack and nothing else, was
 * an exception with no type and no message. Now both are unhandled, and an
 * ANR is named.
 */

// OTel severity numbers.
const UNSPECIFIED: number = 0;
const INFO: number = 9;
const ERROR: number = 17;

const CRASH_STACK: string = [
  "java.lang.IllegalStateException: Printer not connected",
  "\tat com.example.kiosk.ReceiptPrinter.print(ReceiptPrinter.kt:42)",
  "\tat com.example.kiosk.CheckoutActivity.onPaid(CheckoutActivity.kt:118)",
  "\tat android.os.Handler.handleCallback(Handler.java:942)",
].join("\n");

const MAIN_THREAD_STACK: string = [
  "\tat java.lang.Thread.sleep(Native Method)",
  "\tat com.example.kiosk.PaymentTerminal.waitForCard(PaymentTerminal.kt:77)",
  "\tat com.example.kiosk.CheckoutActivity.onPay(CheckoutActivity.kt:96)",
  "\tat android.os.Looper.loop(Looper.java:288)",
].join("\n");

function extract(
  overrides: Partial<LogExceptionExtractorInput>,
): ExtractedLogException | null {
  return LogExceptionExtractor.extractFromLogRecord({
    body: "",
    attributes: {},
    severityNumber: UNSPECIFIED,
    hasTraceAndSpan: false,
    ...overrides,
  });
}

function crashAttributes(extra: JSONObject = {}): JSONObject {
  return {
    "event.name": "app.crash",
    "exception.type": "java.lang.IllegalStateException",
    "exception.message": "Printer not connected",
    "exception.stacktrace": CRASH_STACK,
    "thread.id": 2,
    "thread.name": "main",
    ...extra,
  };
}

function anrAttributes(extra: JSONObject = {}): JSONObject {
  return {
    "event.name": "device.anr",
    "exception.stacktrace": MAIN_THREAD_STACK,
    ...extra,
  };
}

describe("a crash (app.crash)", () => {
  test("is an unhandled exception with the type, message and stack it was thrown with", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: crashAttributes(),
    });

    expect(extracted).not.toBeNull();
    expect(extracted!.exceptionType).toBe("java.lang.IllegalStateException");
    expect(extracted!.message).toBe("Printer not connected");
    expect(extracted!.stackTrace).toBe(CRASH_STACK);
    expect(extracted!.escaped).toBe(true);
    expect(JSON.parse(extracted!.parsedFrames).length).toBeGreaterThan(0);
  });

  test("is unhandled at any severity, the SDK's or none", () => {
    for (const severityNumber of [UNSPECIFIED, INFO, ERROR]) {
      expect(
        extract({ attributes: crashAttributes(), severityNumber })?.escaped,
      ).toBe(true);
    }
  });

  test("is unhandled inside a span too", () => {
    expect(
      extract({ attributes: crashAttributes(), hasTraceAndSpan: true })
        ?.escaped,
    ).toBe(true);
  });

  test("an exception.escaped the record does set wins", () => {
    expect(
      extract({ attributes: crashAttributes({ "exception.escaped": false }) })
        ?.escaped,
    ).toBe(false);
  });

  test("keeps its own type: a crash is never renamed", () => {
    expect(extract({ attributes: crashAttributes() })?.exceptionType).not.toBe(
      ANR_EXCEPTION_TYPE,
    );
  });

  test("under the name releases before 1.5.0 sent (device.crash) it is the same", () => {
    expect(
      extract({
        attributes: crashAttributes({ "event.name": "device.crash" }),
      }),
    ).toEqual(extract({ attributes: crashAttributes() }));
  });

  test("with no exception.* attribute, its body's stack trace is read", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: { "event.name": "app.crash" },
      body: CRASH_STACK,
      severityNumber: UNSPECIFIED,
    });

    expect(extracted).not.toBeNull();
    expect(extracted!.exceptionType).toBe("java.lang.IllegalStateException");
    expect(extracted!.message).toBe("Printer not connected");
    expect(extracted!.escaped).toBe(true);
  });

  test("with nothing that says what was thrown, it is no exception", () => {
    expect(
      extract({
        attributes: { "event.name": "app.crash" },
        body: "The app crashed",
      }),
    ).toBeNull();
  });
});

describe("an ANR (device.anr)", () => {
  test("is an unhandled exception named ANR, with the main thread's stack", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: anrAttributes(),
    });

    expect(extracted).not.toBeNull();
    expect(extracted!.exceptionType).toBe(ANR_EXCEPTION_TYPE);
    expect(extracted!.message).toBe(ANR_EXCEPTION_MESSAGE);
    expect(extracted!.stackTrace).toBe(MAIN_THREAD_STACK);
    expect(extracted!.escaped).toBe(true);
  });

  test("a type or a message the SDK sends wins over the name OneUptime gives it", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: anrAttributes({
        "exception.type": "ApplicationNotResponding",
        "exception.message": "Input dispatching timed out",
      }),
    });

    expect(extracted!.exceptionType).toBe("ApplicationNotResponding");
    expect(extracted!.message).toBe("Input dispatching timed out");
  });

  test("with its stack only in the body, the body's stack is kept", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: { "event.name": "device.anr" },
      body: CRASH_STACK,
    });

    expect(extracted!.exceptionType).toBe(ANR_EXCEPTION_TYPE);
    expect(extracted!.message).toBe(ANR_EXCEPTION_MESSAGE);
    expect(extracted!.stackTrace).toBe(CRASH_STACK);
    expect(extracted!.escaped).toBe(true);
  });

  test("counts even with no stack at all: that it happened is the fact", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: { "event.name": "device.anr" },
      body: "",
    });

    expect(extracted).toEqual({
      exceptionType: ANR_EXCEPTION_TYPE,
      message: ANR_EXCEPTION_MESSAGE,
      stackTrace: "",
      parsedFrames: "[]",
      escaped: true,
    });
  });

  test("two ANRs blocked in different places are two exceptions; the same place is one", () => {
    const here: ExtractedLogException | null = extract({
      attributes: anrAttributes(),
    });
    const sameAgain: ExtractedLogException | null = extract({
      attributes: anrAttributes(),
    });
    const elsewhere: ExtractedLogException | null = extract({
      attributes: anrAttributes({ "exception.stacktrace": CRASH_STACK }),
    });

    // The fingerprint hashes type, message and stack (ExceptionUtil).
    expect(sameAgain).toEqual(here);
    expect(elsewhere!.stackTrace).not.toBe(here!.stackTrace);
    expect(elsewhere!.exceptionType).toBe(here!.exceptionType);
  });
});

describe("everything else is as it was", () => {
  test("a log with exception.* attributes and no fault event keeps escaped unknown", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: {
        "exception.type": "java.io.IOException",
        "exception.message": "Broken pipe",
      },
      severityNumber: ERROR,
    });

    expect(extracted!.escaped).toBeNull();
  });

  test("an exception.stacktrace with no type and no fault event is not named ANR", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: { "exception.stacktrace": MAIN_THREAD_STACK },
      severityNumber: ERROR,
    });

    expect(extracted!.exceptionType).toBe("");
    expect(extracted!.message).toBe("");
    expect(extracted!.escaped).toBeNull();
  });

  test("another event with no exception in it is no exception", () => {
    expect(
      extract({
        attributes: { "event.name": "network.change" },
        body: "network changed",
        severityNumber: INFO,
      }),
    ).toBeNull();
  });

  test("an INFO log that only mentions a stack is still not body-scanned", () => {
    expect(
      extract({ body: CRASH_STACK, severityNumber: INFO, attributes: {} }),
    ).toBeNull();
  });
});

/*
 * #9712: an iOS app's crashes and hangs, as opentelemetry-swift's MetricKit
 * instrumentation reports them (MetricKitInstrumentation.swift's
 * reportDiagnostics): one log record per Apple diagnostic, the attributes
 * exactly as it builds them. A crash's type and message come from the
 * Objective-C exception (iOS 17+), else the Mach exception, else the
 * signal; a hang has only its call stack and its duration. Both stacks are
 * Apple's call stack tree as JSON.
 */
const METRICKIT_CRASH_TREE: string = JSON.stringify({
  callStackPerThread: true,
  callStacks: [
    {
      threadAttributed: true,
      callStackFrames: [
        {
          binaryUUID: "70B89F27-1634-3580-A695-57CDB41D7743",
          offsetAddress: 165304,
          binaryName: "Storefront",
        },
        {
          binaryUUID: "77A62F2E-8212-30F3-84C1-E8497440ACF8",
          offsetAddress: 6948,
          binaryName: "libdyld.dylib",
        },
      ],
    },
  ],
});

// What 2.3.0 to 2.5.1 sent: Apple's own shape, frames nested.
const METRICKIT_HANG_TREE_APPLE_SHAPE: string = JSON.stringify({
  callStacks: [
    {
      threadAttributed: true,
      callStackRootFrames: [
        {
          binaryUUID: "A1B2C3D4-5678-90AB-CDEF-1234567890AB",
          offsetIntoBinaryTextSegment: 42000,
          sampleCount: 20,
          binaryName: "Storefront",
          address: 4295009000,
          subFrames: [
            {
              binaryUUID: "77A62F2E-8212-30F3-84C1-E8497440ACF8",
              offsetIntoBinaryTextSegment: 6948,
              sampleCount: 20,
              binaryName: "UIKitCore",
              address: 7449245604,
            },
          ],
        },
      ],
    },
  ],
  callStackPerThread: true,
});

// A crash diagnostic of 2.4.1 and later: the event name and the `name` attribute.
function metricKitCrashAttributes(extra: JSONObject = {}): JSONObject {
  return {
    "event.name": "metrickit.diagnostic.crash",
    name: "metrickit.diagnostic.crash",
    "metrickit.diagnostic.crash.exception.code": 1,
    "metrickit.diagnostic.crash.exception.signal": 11,
    "metrickit.diagnostic.crash.exception.signal.name": "SIGSEGV",
    "metrickit.diagnostic.crash.exception.signal.description":
      "segmentation violation",
    "metrickit.diagnostic.crash.exception.mach_exception.type": 1,
    "metrickit.diagnostic.crash.exception.mach_exception.name":
      "EXC_BAD_ACCESS",
    "metrickit.diagnostic.crash.exception.mach_exception.description":
      "Could not access memory",
    "exception.type": "EXC_BAD_ACCESS",
    "exception.message": "Could not access memory",
    "exception.stacktrace": METRICKIT_CRASH_TREE,
    ...extra,
  };
}

function metricKitHangAttributes(extra: JSONObject = {}): JSONObject {
  return {
    "event.name": "metrickit.diagnostic.hang",
    name: "metrickit.diagnostic.hang",
    "metrickit.diagnostic.hang.hang_duration": 3.2,
    "exception.stacktrace": METRICKIT_HANG_TREE_APPLE_SHAPE,
    ...extra,
  };
}

describe("an iOS crash (metrickit.diagnostic.crash)", () => {
  test("is an unhandled exception with the Mach exception's type and description", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: metricKitCrashAttributes(),
    });

    expect(extracted).not.toBeNull();
    expect(extracted!.exceptionType).toBe("EXC_BAD_ACCESS");
    expect(extracted!.message).toBe("Could not access memory");
    expect(extracted!.escaped).toBe(true);
  });

  test("its stack is the crashed thread, readable, never the JSON it came as", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: metricKitCrashAttributes(),
    });

    expect(extracted!.stackTrace).toBe(
      [
        "Thread 0 Crashed:",
        "0   Storefront                     Storefront + 165304",
        "1   libdyld.dylib                  libdyld.dylib + 6948",
        "",
        "Binary Images:",
        "Storefront <70B89F27-1634-3580-A695-57CDB41D7743>",
        "libdyld.dylib <77A62F2E-8212-30F3-84C1-E8497440ACF8>",
      ].join("\n"),
    );
  });

  test("an Objective-C exception (iOS 17+) reads as itself", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: metricKitCrashAttributes({
        "metrickit.diagnostic.crash.exception.objc.name":
          "NSInvalidArgumentException",
        "metrickit.diagnostic.crash.exception.objc.message":
          "-[__NSCFNumber length]: unrecognized selector sent to instance 0x8000000000000000",
        "exception.type": "NSInvalidArgumentException",
        "exception.message":
          "-[__NSCFNumber length]: unrecognized selector sent to instance 0x8000000000000000",
      }),
    });

    expect(extracted!.exceptionType).toBe("NSInvalidArgumentException");
    expect(extracted!.message).toContain("unrecognized selector");
  });

  test("2.3.0, which named the crash only in its name attribute, is read the same", () => {
    const attributes: JSONObject = metricKitCrashAttributes();
    delete attributes["event.name"];

    const extracted: ExtractedLogException | null = extract({
      attributes: attributes,
    });

    expect(extracted!.exceptionType).toBe("EXC_BAD_ACCESS");
    expect(extracted!.escaped).toBe(true);
    expect(extracted!.stackTrace.startsWith("Thread 0 Crashed:")).toBe(true);
  });

  test("a stack that is no call stack tree is kept as sent", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: metricKitCrashAttributes({
        "exception.stacktrace": "not a tree",
      }),
    });

    expect(extracted!.stackTrace).toBe("not a tree");
  });
});

describe("an iOS hang (metrickit.diagnostic.hang)", () => {
  test("is an unhandled exception named Hang, with a sentence that says what happened", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: metricKitHangAttributes(),
    });

    expect(extracted).not.toBeNull();
    expect(extracted!.exceptionType).toBe(HANG_EXCEPTION_TYPE);
    expect(extracted!.message).toBe(HANG_EXCEPTION_MESSAGE);
    expect(extracted!.escaped).toBe(true);
  });

  test("never an ANR: an iOS hang keeps Apple's word", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: metricKitHangAttributes(),
    });

    expect(extracted!.exceptionType).not.toBe(ANR_EXCEPTION_TYPE);
    expect(extracted!.message).not.toBe(ANR_EXCEPTION_MESSAGE);
  });

  test("its stack is the main thread that hung, with Apple's addresses", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: metricKitHangAttributes(),
    });
    const lines: Array<string> = extracted!.stackTrace.split("\n");

    expect(lines[0]).toBe("Thread 0 Hung:");
    expect(lines[1]).toMatch(
      /^0 {3}Storefront {21}0x[0-9a-f]{16} 0x[0-9a-f]+ \+ 42000$/,
    );
    expect(lines[2]).toMatch(/^1 {3}UIKitCore/);
  });

  test("2.3.0's hang, named only in its name attribute, is a hang too", () => {
    const attributes: JSONObject = metricKitHangAttributes();
    delete attributes["event.name"];

    expect(extract({ attributes: attributes })!.exceptionType).toBe(
      HANG_EXCEPTION_TYPE,
    );
  });

  test("one with no stack at all still counts, as a hang that happened", () => {
    const extracted: ExtractedLogException | null = extract({
      attributes: {
        "event.name": "metrickit.diagnostic.hang",
        "metrickit.diagnostic.hang.hang_duration": 1.4,
      },
    });

    expect(extracted).not.toBeNull();
    expect(extracted!.exceptionType).toBe(HANG_EXCEPTION_TYPE);
    expect(extracted!.message).toBe(HANG_EXCEPTION_MESSAGE);
    expect(extracted!.stackTrace).toBe("");
    expect(extracted!.escaped).toBe(true);
  });

  test("every hang has the same type and message, so hangs group by their stack", () => {
    const short: ExtractedLogException | null = extract({
      attributes: metricKitHangAttributes({
        "metrickit.diagnostic.hang.hang_duration": 0.3,
      }),
    });
    const long: ExtractedLogException | null = extract({
      attributes: metricKitHangAttributes({
        "metrickit.diagnostic.hang.hang_duration": 9.7,
      }),
    });

    // The fingerprint hashes type, message and stack (ExceptionUtil).
    expect(long).toEqual(short);
  });
});

describe("MetricKit's other diagnostics are no exception", () => {
  test.each([
    [
      "a CPU exception",
      {
        "event.name": "metrickit.diagnostic.cpu_exception",
        "metrickit.diagnostic.cpu_exception.total_cpu_time": 92.5,
      },
    ],
    [
      "a disk write exception",
      {
        "event.name": "metrickit.diagnostic.disk_write_exception",
        "metrickit.diagnostic.disk_write_exception.total_writes_caused": 1.1e9,
      },
    ],
    [
      "a slow launch",
      {
        "event.name": "metrickit.diagnostic.app_launch",
        "metrickit.diagnostic.app_launch.launch_duration": 4.2,
      },
    ],
  ])("%s", (_label: string, attributes: JSONObject) => {
    expect(extract({ attributes: attributes })).toBeNull();
  });
});
