import LogExceptionExtractor, {
  ExtractedLogException,
  LogExceptionExtractorInput,
} from "../../../../Server/Utils/Telemetry/LogExceptionExtractor";
import {
  ANR_EXCEPTION_MESSAGE,
  ANR_EXCEPTION_TYPE,
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
