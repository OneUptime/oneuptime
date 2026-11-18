import {
  ANR_EXCEPTION_MESSAGE,
  ANR_EXCEPTION_TYPE,
  MOBILE_APP_FAULT_EVENT_NAMES,
  MobileAppFaultKind,
  getMobileAppFaultKind,
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
