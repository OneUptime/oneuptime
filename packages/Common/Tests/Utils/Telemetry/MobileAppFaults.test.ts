import {
  ANR_EXCEPTION_MESSAGE,
  ANR_EXCEPTION_TYPE,
  APP_NOT_RESPONDING_EXCEPTION_TYPES,
  HANG_EXCEPTION_MESSAGE,
  HANG_EXCEPTION_TYPE,
  METRICKIT_CRASH_EVENT_NAME,
  METRICKIT_HANG_DURATION_ATTRIBUTE,
  METRICKIT_HANG_EVENT_NAME,
  MOBILE_APP_FAULT_EVENT_NAMES,
  MobileAppFaultKind,
  getMobileAppFaultEventName,
  getMobileAppFaultKind,
  isMetricKitFaultEventName,
  readMetricKitDiagnosticName,
  stampMetricKitDiagnosticEventName,
} from "../../../Utils/Telemetry/MobileAppFaults";
import { LogEventNameAttributeKey } from "../../../Types/Log/LogEventName";
import { describe, expect, test } from "@jest/globals";

/*
 * The crash and ANR events a mobile app's OpenTelemetry SDK sends
 * (OpenTelemetry Android's `app.crash` and `device.anr`), read from the
 * `event.name` attribute log ingest stamps them on.
 */

describe("getMobileAppFaultKind", () => {
  test("OpenTelemetry Android's crash event is a crash", () => {
    expect(getMobileAppFaultKind({ "event.name": "app.crash" })).toBe(
      MobileAppFaultKind.Crash,
    );
  });

  test("so is the name releases before 1.5.0 sent it under", () => {
    expect(getMobileAppFaultKind({ "event.name": "device.crash" })).toBe(
      MobileAppFaultKind.Crash,
    );
  });

  test("OpenTelemetry Android's ANR event is an ANR", () => {
    expect(getMobileAppFaultKind({ "event.name": "device.anr" })).toBe(
      MobileAppFaultKind.Anr,
    );
  });

  test("reads the key log ingest stamps an event's name on", () => {
    expect(LogEventNameAttributeKey).toBe("event.name");
  });

  test("a name with spaces around it still counts", () => {
    expect(getMobileAppFaultKind({ "event.name": "  device.anr " })).toBe(
      MobileAppFaultKind.Anr,
    );
  });

  test.each([
    ["another event", { "event.name": "network.change" }],
    ["a jank event", { "event.name": "app.jank" }],
    [
      "a GenAI event",
      { "event.name": "gen_ai.client.inference.operation.details" },
    ],
    ["a name in another case", { "event.name": "DEVICE.CRASH" }],
    ["a name that only starts the same", { "event.name": "app.crash.extra" }],
    ["no event name", { "exception.type": "java.lang.IllegalStateException" }],
    ["an event name that is not text", { "event.name": 42 }],
    ["an empty event name", { "event.name": "" }],
  ])(
    "%s is no fault",
    (_label: string, attributes: Record<string, unknown>) => {
      expect(getMobileAppFaultKind(attributes)).toBeNull();
    },
  );

  test.each([
    ["undefined", undefined],
    ["null", null],
  ])(
    "%s attributes are no fault, and do not throw",
    (_label: string, value: null | undefined) => {
      expect(getMobileAppFaultKind(value)).toBeNull();
    },
  );

  test("the crash attribute is the record's own, never the resource's", () => {
    /*
     * Ingest prefixes resource attributes with "resource.", so an app whose
     * resource somehow named an event would not make every record a crash.
     */
    expect(
      getMobileAppFaultKind({ "resource.event.name": "app.crash" }),
    ).toBeNull();
  });
});

describe("the vocabulary", () => {
  test("every kind has at least one event name, and no name means two kinds", () => {
    const seen: Set<string> = new Set<string>();

    for (const kind of Object.values(MobileAppFaultKind)) {
      const names: ReadonlyArray<string> = MOBILE_APP_FAULT_EVENT_NAMES[kind];
      expect(names.length).toBeGreaterThan(0);

      for (const name of names) {
        expect(seen.has(name)).toBe(false);
        seen.add(name);
      }
    }
  });

  test("an ANR reads as one: Android's own word, and a sentence that says what happened", () => {
    expect(ANR_EXCEPTION_TYPE).toBe("ANR");
    expect(ANR_EXCEPTION_MESSAGE).toMatch(/^Application Not Responding: /);
    expect(ANR_EXCEPTION_MESSAGE).toMatch(/\.$/);
    expect(ANR_EXCEPTION_MESSAGE).toContain("main thread");
  });
});

/*
 * #9712: an iOS app's crashes and hangs, from opentelemetry-swift's MetricKit
 * instrumentation (Sources/Instrumentation/MetricKit/MetricKitInstrumentation
 * .swift): one log record per Apple diagnostic, named
 * `metrickit.diagnostic.<kind>` in its `name` attribute (2.3.0 and later) and
 * in its event name field (2.4.1 and later).
 */
describe("an iOS app's MetricKit diagnostics", () => {
  test("a MetricKit crash is a crash, and a hang its own kind", () => {
    expect(
      getMobileAppFaultKind({ "event.name": "metrickit.diagnostic.crash" }),
    ).toBe(MobileAppFaultKind.Crash);
    expect(
      getMobileAppFaultKind({ "event.name": "metrickit.diagnostic.hang" }),
    ).toBe(MobileAppFaultKind.Hang);
    expect(METRICKIT_CRASH_EVENT_NAME).toBe("metrickit.diagnostic.crash");
    expect(METRICKIT_HANG_EVENT_NAME).toBe("metrickit.diagnostic.hang");
  });

  test("2.3.0 named a diagnostic only in its name attribute, which is read too", () => {
    const attributes: Record<string, unknown> = {
      name: "metrickit.diagnostic.hang",
      "metrickit.diagnostic.hang.hang_duration": 2.5,
      "exception.stacktrace": "{}",
    };

    expect(getMobileAppFaultKind(attributes)).toBe(MobileAppFaultKind.Hang);
    expect(getMobileAppFaultEventName(attributes)).toBe(
      "metrickit.diagnostic.hang",
    );
  });

  test("a name attribute outside MetricKit's namespace is never a fault", () => {
    for (const name of ["app.crash", "device.anr", "checkout", "metrickit."]) {
      expect(getMobileAppFaultKind({ name: name })).toBeNull();
      expect(readMetricKitDiagnosticName({ name: name })).toBeNull();
    }
  });

  test("MetricKit's other diagnostics are named, but are no fault", () => {
    for (const kind of [
      "cpu_exception",
      "disk_write_exception",
      "app_launch",
    ]) {
      const name: string = `metrickit.diagnostic.${kind}`;

      expect(readMetricKitDiagnosticName({ name: name })).toBe(name);
      expect(getMobileAppFaultKind({ "event.name": name })).toBeNull();
      expect(getMobileAppFaultKind({ name: name })).toBeNull();
    }
  });

  test("an event name wins over a name attribute that disagrees", () => {
    expect(
      getMobileAppFaultEventName({
        "event.name": "metrickit.diagnostic.crash",
        name: "metrickit.diagnostic.hang",
      }),
    ).toBe("metrickit.diagnostic.crash");
  });

  test("isMetricKitFaultEventName tells MetricKit's names from Android's", () => {
    expect(isMetricKitFaultEventName("metrickit.diagnostic.crash")).toBe(true);
    expect(isMetricKitFaultEventName("metrickit.diagnostic.hang")).toBe(true);
    expect(isMetricKitFaultEventName("app.crash")).toBe(false);
    expect(isMetricKitFaultEventName(null)).toBe(false);
  });

  test("a hang reads as one: Apple's own word, and a sentence that says what happened", () => {
    expect(HANG_EXCEPTION_TYPE).toBe("Hang");
    expect(HANG_EXCEPTION_MESSAGE).toMatch(/^Hang: /);
    expect(HANG_EXCEPTION_MESSAGE).toMatch(/\.$/);
    expect(HANG_EXCEPTION_MESSAGE).toContain("main thread");
    // A sentence of its own: never the ANR's, which names Android's word.
    expect(HANG_EXCEPTION_MESSAGE).not.toBe(ANR_EXCEPTION_MESSAGE);
  });

  test("a freeze is either type, on every platform", () => {
    expect([...APP_NOT_RESPONDING_EXCEPTION_TYPES]).toEqual(["ANR", "Hang"]);
  });

  test("the hang duration's key is MetricKit's own", () => {
    expect(METRICKIT_HANG_DURATION_ATTRIBUTE).toBe(
      "metrickit.diagnostic.hang.hang_duration",
    );
  });
});

describe("stampMetricKitDiagnosticEventName", () => {
  test("stamps a 2.3.0 diagnostic's name on event.name", () => {
    const attributes: Record<string, unknown> = {
      name: "metrickit.diagnostic.crash",
    };

    expect(stampMetricKitDiagnosticEventName(attributes)).toBe(true);
    expect(attributes["event.name"]).toBe("metrickit.diagnostic.crash");
  });

  test("stamps MetricKit's other diagnostics too: every one is an event", () => {
    const attributes: Record<string, unknown> = {
      name: "metrickit.diagnostic.cpu_exception",
    };

    expect(stampMetricKitDiagnosticEventName(attributes)).toBe(true);
    expect(attributes["event.name"]).toBe("metrickit.diagnostic.cpu_exception");
  });

  test("leaves a record that names its own event alone", () => {
    const attributes: Record<string, unknown> = {
      "event.name": "metrickit.diagnostic.hang",
      name: "metrickit.diagnostic.crash",
    };

    expect(stampMetricKitDiagnosticEventName(attributes)).toBe(false);
    expect(attributes["event.name"]).toBe("metrickit.diagnostic.hang");
  });

  test("fills an empty event.name", () => {
    const attributes: Record<string, unknown> = {
      "event.name": "  ",
      name: "metrickit.diagnostic.hang",
    };

    expect(stampMetricKitDiagnosticEventName(attributes)).toBe(true);
    expect(attributes["event.name"]).toBe("metrickit.diagnostic.hang");
  });

  test.each([
    ["a name outside MetricKit", { name: "checkout" }],
    ["no name", { "exception.type": "EXC_BAD_ACCESS" }],
    ["a name that is not text", { name: 7 }],
  ])("%s is not stamped", (_label: string, raw: Record<string, unknown>) => {
    const attributes: Record<string, unknown> = { ...raw };

    expect(stampMetricKitDiagnosticEventName(attributes)).toBe(false);
    expect(attributes["event.name"]).toBeUndefined();
  });

  test("null and undefined attributes are left, and do not throw", () => {
    expect(stampMetricKitDiagnosticEventName(null)).toBe(false);
    expect(stampMetricKitDiagnosticEventName(undefined)).toBe(false);
  });
});
