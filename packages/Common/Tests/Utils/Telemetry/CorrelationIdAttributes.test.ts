import {
  CORRELATION_ID_ATTRIBUTE_KEYS,
  correlationIdAttributeKeys,
  readSessionIdFromAttributes,
  SESSION_ID_ATTRIBUTE_KEYS,
} from "../../../Utils/Telemetry/CorrelationIdAttributes";
import ScrubNestedValuesUtil from "../../../Utils/Telemetry/ScrubNestedValues";
import { LlmConversationIdAttributeKeys } from "../../../Types/Telemetry/LlmConventions";
import { describe, expect, test } from "@jest/globals";

/*
 * The ids a record is filed under - its session, an AI call's
 * conversation - and the attributes they are read from (#8924): ingest
 * reads the session id with readSessionIdFromAttributes, and a Sensitive
 * Attribute Keys rule keeps the attributes correlationIdAttributeKeys
 * names, as the record's columns keep the same values.
 */
describe("readSessionIdFromAttributes: what ingest stores as a record's sessionId", () => {
  test("the span's or log's own session.id first, then the resource's", () => {
    expect(SESSION_ID_ATTRIBUTE_KEYS).toEqual([
      "session.id",
      "resource.session.id",
    ]);
    expect(
      readSessionIdFromAttributes({
        "session.id": "own",
        "resource.session.id": "resource",
      }),
    ).toBe("own");
    expect(readSessionIdFromAttributes({ "resource.session.id": "r" })).toBe(
      "r",
    );
  });

  test("an empty text, a list or a map is no id: the next key is read", () => {
    expect(
      readSessionIdFromAttributes({
        "session.id": "",
        "resource.session.id": "resource",
      }),
    ).toBe("resource");
    expect(
      readSessionIdFromAttributes({
        "session.id": ["a"],
        "resource.session.id": { id: "b" },
      }),
    ).toBe("");
  });

  test("a number or true or false is read as text", () => {
    expect(readSessionIdFromAttributes({ "session.id": 42 })).toBe("42");
    expect(readSessionIdFromAttributes({ "session.id": 0 })).toBe("0");
    expect(readSessionIdFromAttributes({ "session.id": false })).toBe("false");
  });

  test("nothing read is no session", () => {
    expect(readSessionIdFromAttributes(undefined)).toBe("");
    expect(readSessionIdFromAttributes({})).toBe("");
    expect(readSessionIdFromAttributes({ session_id: "login" })).toBe("");
  });
});

describe("correlationIdAttributeKeys: the attributes that hold the record's own id", () => {
  test("the attribute holding the value the sessionId column stores", () => {
    expect(
      correlationIdAttributeKeys({
        sessionId: "s-1",
        attributes: {
          "session.id": "s-1",
          "resource.session.id": "s-2",
          session_id: "s-1",
        },
      }),
    ).toEqual(new Set(["session.id"]));
    expect(
      correlationIdAttributeKeys({
        sessionId: "s-2",
        attributes: { "session.id": "s-1", "resource.session.id": "s-2" },
      }),
    ).toEqual(new Set(["resource.session.id"]));
  });

  test("a number the column holds as text is the record's own", () => {
    expect(
      correlationIdAttributeKeys({
        sessionId: "42",
        attributes: { "session.id": 42 },
      }),
    ).toEqual(new Set(["session.id"]));
  });

  test("an AI call's conversation keys holding its llmConversationId, read trimmed", () => {
    expect(
      correlationIdAttributeKeys({
        sessionId: "",
        llmConversationId: "chat-9",
        attributes: {
          "gen_ai.conversation.id": "chat-9",
          "langfuse.session.id": " chat-9 ",
          "traceloop.association.properties.session_id": "chat-10",
        },
      }),
    ).toEqual(new Set(["gen_ai.conversation.id", "langfuse.session.id"]));
  });

  test("a record filed under no id, or with no attributes, keeps nothing", () => {
    for (const record of [
      { attributes: { "session.id": "s-1" } },
      { sessionId: "", attributes: { "session.id": "" } },
      { sessionId: 7, attributes: { "session.id": 7 } },
      { sessionId: "s-1" },
      { sessionId: "s-1", attributes: "s-1" },
    ]) {
      expect(correlationIdAttributeKeys(record)).toEqual(new Set());
    }
  });

  test("CORRELATION_ID_ATTRIBUTE_KEYS: every key an id can be read from, and no other", () => {
    // session.id is both: a visit's id, and an AI chat's.
    expect([...CORRELATION_ID_ATTRIBUTE_KEYS].sort()).toEqual(
      [
        ...new Set([
          ...SESSION_ID_ATTRIBUTE_KEYS,
          ...LlmConversationIdAttributeKeys,
        ]),
      ].sort(),
    );
    expect(CORRELATION_ID_ATTRIBUTE_KEYS.has("session_id")).toBe(false);
    expect(CORRELATION_ID_ATTRIBUTE_KEYS.has("sessionid")).toBe(false);
  });
});

// The words this suite's keys rule names a secret by.
const SECRET_WORDS: RegExp = /session[._-]?id|password/i;

describe("hideAttributeTextsUnderSensitiveKeys: keptKeys, the map's own keys only", () => {
  const isSensitive: (key: string) => boolean = (key: string): boolean => {
    return SECRET_WORDS.test(key);
  };
  const hide: (text: string) => string = (): string => {
    return "[REDACTED]";
  };

  test("a kept key's value stays, the same key inside a value and every other secret is hidden", () => {
    const attributes: Record<string, unknown> = {
      "session.id": "s-1",
      session_id: "login",
      password: "hunter2",
      visitor: { "session.id": "s-1" },
      list: [{ key: "session.id", value: { stringValue: "s-1" } }],
    };

    ScrubNestedValuesUtil.hideAttributeTextsUnderSensitiveKeys(
      attributes,
      isSensitive,
      hide,
      new Set<string>(),
      new Set<string>(["session.id"]),
    );

    expect(attributes).toEqual({
      "session.id": "s-1",
      session_id: "[REDACTED]",
      password: "[REDACTED]",
      visitor: { "session.id": "[REDACTED]" },
      list: [{ key: "session.id", value: { stringValue: "[REDACTED]" } }],
    });
  });

  test("without keptKeys, every value under such a key is hidden, as before", () => {
    const attributes: Record<string, unknown> = { "session.id": "s-1" };

    ScrubNestedValuesUtil.hideAttributeTextsUnderSensitiveKeys(
      attributes,
      isSensitive,
      hide,
      new Set<string>(),
    );

    expect(attributes).toEqual({ "session.id": "[REDACTED]" });
  });
});
