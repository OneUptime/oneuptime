import { describe, expect, test } from "@jest/globals";
import LogEventName, {
  LOG_EVENT_NAME_MAX_LENGTH,
  LogEventNameAttributeKey,
} from "../../../Types/Log/LogEventName";
import { LlmLogEventNameAttributeKey } from "../../../Types/Telemetry/LlmConventions";

/*
 * A log record that is an event names it in its `event.name` attribute (the
 * old Events API, most instrumentations) or in the LogRecord's own
 * event_name field (newer SDKs: Python's from 1.39). Log ingest stamps the
 * field onto the attribute, so every event is found by one key.
 */

describe("the event name a log record sends in its own field", () => {
  test("as OTLP/JSON, protobufjs and the gRPC loader spell it, or snake_case", () => {
    expect(LogEventName.fromRecord({ eventName: "gen_ai.user.message" })).toBe(
      "gen_ai.user.message",
    );
    expect(LogEventName.fromRecord({ event_name: "gen_ai.choice" })).toBe(
      "gen_ai.choice",
    );
  });

  test("camelCase wins when a record somehow carries both", () => {
    expect(
      LogEventName.fromRecord({
        eventName: "gen_ai.choice",
        event_name: "gen_ai.user.message",
      }),
    ).toBe("gen_ai.choice");
  });

  test("trimmed; blank, missing or not text is no name", () => {
    expect(LogEventName.fromRecord({ eventName: "  gen_ai.choice \n" })).toBe(
      "gen_ai.choice",
    );
    expect(LogEventName.fromRecord({ eventName: "   " })).toBe("");
    expect(LogEventName.fromRecord({ eventName: "" })).toBe("");
    expect(LogEventName.fromRecord({})).toBe("");
    expect(LogEventName.fromRecord({ eventName: 12 })).toBe("");
    expect(LogEventName.fromRecord({ eventName: { name: "x" } })).toBe("");
    expect(LogEventName.fromRecord({ eventName: null })).toBe("");
  });

  test("a record that is not an object has none", () => {
    expect(LogEventName.fromRecord(null)).toBe("");
    expect(LogEventName.fromRecord(undefined)).toBe("");
    expect(LogEventName.fromRecord("gen_ai.choice")).toBe("");
    expect(LogEventName.fromRecord(["gen_ai.choice"])).toBe("");
    expect(LogEventName.fromRecord(42)).toBe("");
  });

  test("a name past the longest kept is not one", () => {
    const longest: string = "e".repeat(LOG_EVENT_NAME_MAX_LENGTH);

    expect(LogEventName.fromRecord({ eventName: longest })).toBe(longest);
    expect(LogEventName.fromRecord({ eventName: `${longest}e` })).toBe("");
    // A megabyte of name is turned away without being copied anywhere.
    expect(
      LogEventName.fromRecord({ eventName: "e".repeat(1024 * 1024) }),
    ).toBe("");
  });
});

describe("stamping it onto the attribute map", () => {
  test("the key the GenAI reads look for", () => {
    expect(LogEventNameAttributeKey).toBe("event.name");
    expect(LlmLogEventNameAttributeKey).toBe(LogEventNameAttributeKey);
  });

  test("a record that names itself only in the field gets the attribute", () => {
    const attributes: Record<string, unknown> = {
      "gen_ai.system": "openai",
    };

    expect(
      LogEventName.stampOnAttributes(attributes, {
        eventName: "gen_ai.user.message",
      }),
    ).toBe(true);
    expect(attributes).toEqual({
      "gen_ai.system": "openai",
      "event.name": "gen_ai.user.message",
    });
  });

  test("what the record's own attribute says wins", () => {
    const attributes: Record<string, unknown> = {
      "event.name": "gen_ai.choice",
    };

    expect(
      LogEventName.stampOnAttributes(attributes, {
        eventName: "gen_ai.user.message",
      }),
    ).toBe(false);
    expect(attributes["event.name"]).toBe("gen_ai.choice");
  });

  test("a blank or empty attribute is filled from the field", () => {
    for (const blank of ["", "   ", null, undefined]) {
      const attributes: Record<string, unknown> = { "event.name": blank };

      expect(
        LogEventName.stampOnAttributes(attributes, {
          eventName: "gen_ai.choice",
        }),
      ).toBe(true);
      expect(attributes["event.name"]).toBe("gen_ai.choice");
    }
  });

  test("an attribute that is not text is left as it came", () => {
    const attributes: Record<string, unknown> = { "event.name": 7 };

    expect(
      LogEventName.stampOnAttributes(attributes, {
        eventName: "gen_ai.choice",
      }),
    ).toBe(false);
    expect(attributes["event.name"]).toBe(7);
  });

  test("a record without a name adds nothing", () => {
    const attributes: Record<string, unknown> = { "http.route": "/orders" };

    expect(LogEventName.stampOnAttributes(attributes, {})).toBe(false);
    expect(
      LogEventName.stampOnAttributes(attributes, { eventName: "  " }),
    ).toBe(false);
    expect(LogEventName.stampOnAttributes(attributes, null)).toBe(false);
    expect(attributes).toEqual({ "http.route": "/orders" });
  });
});
