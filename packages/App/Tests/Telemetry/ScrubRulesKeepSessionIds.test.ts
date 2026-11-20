import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SENSITIVE ATTRIBUTE KEYS RULE KEEPS A RECORD'S OWN SESSION ID (#8924).
 *
 * The rule's key list names "session id", for the login sessions sent as
 * session_id, sessionid, JSESSIONID or in a cookie, so it hid `session.id`
 * too - while ingest had already copied the same value into the record's
 * sessionId column (and, on an AI call, llmConversationId), which no rule
 * reads: session replay joins a recording's logs, spans and exceptions by
 * it, and a session's erasure deletes by it. Hidden in the attribute and
 * shown, searchable, in the column, it protected nothing.
 *
 * Decided: those columns are correlation ids - OpenTelemetry's id of a
 * visit, the random id the recorder files a recording under, an AI chat's
 * id - and stay as they are; the rule now leaves the attribute alone when
 * it holds the record's own id, the very value the column stores, and
 * hides every other value under such a key as before. Through the real
 * LogScrubRuleService and TraceScrubRuleService, rules compiled by their
 * own getRegexForPattern. The OTLP routes are in OtelLogsScrubNestedValues
 * and SessionTraceStateIngest.
 * ---------------------------------------------------------------------------
 */

// What the browser recorder mints, and the page's own OpenTelemetry stamps.
const REPLAY_SESSION: string = "5f2c9e1a7b3d4c6e8f0a1b2c3d4e5f60";
const OTHER_SESSION: string = "11112222333344445555666677778888";

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => ScrubRegExp | null;

function keysRule(
  service: unknown,
  rule: LogScrubRule | TraceScrubRule,
  action: string,
): never {
  rule.name = "secrets";
  rule.patternType = "sensitiveKeys";
  rule.scrubAction = action;

  const regex: ScrubRegExp | null = (
    service as { getRegexForPattern: GetRegexForPattern }
  ).getRegexForPattern("sensitiveKeys");

  expect(regex).not.toBeNull();

  return [{ rule: rule, regex: regex }] as never;
}

function logKeysRule(action: string = "redact"): never {
  return keysRule(LogScrubRuleService, new LogScrubRule(), action);
}

function traceKeysRule(action: string = "redact"): never {
  return keysRule(TraceScrubRuleService, new TraceScrubRule(), action);
}

// The project the rules are of: their Hash tokens are keyed with it.
const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a60394",
);

// What a Hash rule of PROJECT_ID leaves of a text (#10394).
function token(text: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: text });
}

describe("a log: the attribute its session id was read from is kept", () => {
  for (const action of ["redact", "mask", "hash"]) {
    test(`a browser log's resource session.id, under ${action}, and the secrets beside it hidden`, () => {
      const row: JSONObject = LogScrubRuleService.scrubLog(
        {
          body: "clicked checkout",
          sessionId: REPLAY_SESSION,
          attributes: {
            "resource.session.id": REPLAY_SESSION,
            "http.request.header.cookie": ["sessionid=abc123"],
            session_id: "server-login-session",
            password: "hunter2",
          },
        },
        logKeysRule(action),
      );
      const attributes: JSONObject = row["attributes"] as JSONObject;

      expect(row["sessionId"]).toBe(REPLAY_SESSION);
      expect(attributes["resource.session.id"]).toBe(REPLAY_SESSION);
      expect(attributes["session_id"]).not.toBe("server-login-session");
      expect(attributes["password"]).not.toBe("hunter2");
      expect(JSON.stringify(attributes)).not.toContain("abc123");
    });
  }

  test("a log's own session.id is kept, and a resource session.id that holds another session is hidden", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "",
        // Ingest reads session.id first (readSessionIdFromAttributes).
        sessionId: REPLAY_SESSION,
        attributes: {
          "session.id": REPLAY_SESSION,
          "resource.session.id": OTHER_SESSION,
        },
      },
      logKeysRule(),
    );

    expect(row["attributes"]).toEqual({
      "session.id": REPLAY_SESSION,
      "resource.session.id": "[REDACTED]",
    });
  });

  test("a log filed under no session keeps nothing: its session.id holds no id the record stores", () => {
    for (const sessionId of [undefined, ""]) {
      const row: JSONObject = LogScrubRuleService.scrubLog(
        {
          body: "",
          ...(sessionId !== undefined ? { sessionId } : {}),
          attributes: { "session.id": REPLAY_SESSION },
        },
        logKeysRule(),
      );

      expect((row["attributes"] as JSONObject)["session.id"]).toBe(
        "[REDACTED]",
      );
    }
  });

  test("the same key inside a list or a map, or in the body, is read as any other", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: JSON.stringify({ "session.id": REPLAY_SESSION }),
        sessionId: REPLAY_SESSION,
        attributes: {
          "session.id": REPLAY_SESSION,
          visitor: { "session.id": REPLAY_SESSION },
        },
      },
      logKeysRule(),
    );

    expect(row["attributes"]).toEqual({
      "session.id": REPLAY_SESSION,
      visitor: { "session.id": "[REDACTED]" },
    });
    expect(JSON.parse(row["body"] as string)).toEqual({
      "session.id": "[REDACTED]",
    });
  });

  test("a numeric session.id the column holds as text is the record's own too", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "",
        sessionId: "42",
        attributes: { "session.id": 42 },
      },
      logKeysRule(),
    );

    expect((row["attributes"] as JSONObject)["session.id"]).toBe(42);
  });

  test("a pattern rule still reads the value: a custom pattern written for it hides it", () => {
    const rule: LogScrubRule = new LogScrubRule();

    rule.name = "hex ids";
    rule.projectId = PROJECT_ID;
    rule.patternType = "custom";
    rule.customRegex = "[0-9a-f]{32}";
    rule.scrubAction = "hash";

    const regex: ScrubRegExp | null = (
      LogScrubRuleService as unknown as {
        getRegexForPattern: GetRegexForPattern;
      }
    ).getRegexForPattern("custom", "[0-9a-f]{32}");
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "",
        sessionId: REPLAY_SESSION,
        attributes: { "session.id": REPLAY_SESSION },
      },
      [{ rule: rule, regex: regex }] as never,
    );

    expect((row["attributes"] as JSONObject)["session.id"]).toBe(
      token(REPLAY_SESSION),
    );
    // The column is the record's session, whatever the rules.
    expect(row["sessionId"]).toBe(REPLAY_SESSION);
  });
});

describe("a span: its own session and conversation ids are kept, an event's and a link's are not", () => {
  test("a browser span's session.id, the one its sessionId stores", () => {
    const span: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "documentLoad",
        sessionId: REPLAY_SESSION,
        attributes: {
          "session.id": REPLAY_SESSION,
          "http.request.header.authorization": "Bearer abc",
        },
        events: [
          {
            name: "click",
            attributes: { "session.id": REPLAY_SESSION },
          },
        ],
        links: [{ attributes: { "session.id": REPLAY_SESSION } }],
      },
      traceKeysRule(),
    );

    expect(span["attributes"]).toEqual({
      "session.id": REPLAY_SESSION,
      "http.request.header.authorization": "[REDACTED]",
    });
    expect(
      ((span["events"] as JSONArray)[0] as JSONObject)["attributes"],
    ).toEqual({ "session.id": "[REDACTED]" });
    expect(
      ((span["links"] as JSONArray)[0] as JSONObject)["attributes"],
    ).toEqual({ "session.id": "[REDACTED]" });
  });

  test("a backend span filed under the recorder's session keeps hiding a session.id of its own", () => {
    // The recorder's trace-state member decided sessionId; the backend set its own.
    const span: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "POST /checkout",
        sessionId: REPLAY_SESSION,
        attributes: { "session.id": "php-login-session-0f9e" },
        events: [],
        links: [],
      },
      traceKeysRule("mask"),
    );

    expect((span["attributes"] as JSONObject)["session.id"]).not.toBe(
      "php-login-session-0f9e",
    );
  });

  test("an AI call's conversation id, the one its llmConversationId stores, and only that one", () => {
    const span: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "chat gpt-4o",
        sessionId: "",
        llmConversationId: "chat-2024-11",
        attributes: {
          "langfuse.session.id": "chat-2024-11",
          "traceloop.association.properties.session_id": "another-chat",
          "ai.telemetry.metadata.sessionId": " chat-2024-11 ",
          "gen_ai.request.model": "gpt-4o",
        },
        events: [],
        links: [],
      },
      traceKeysRule(),
    );

    expect(span["attributes"]).toEqual({
      "langfuse.session.id": "chat-2024-11",
      "traceloop.association.properties.session_id": "[REDACTED]",
      // Read as the conversation reads it: trimmed.
      "ai.telemetry.metadata.sessionId": " chat-2024-11 ",
      "gen_ai.request.model": "gpt-4o",
    });
  });

  test("an AI call whose session.id is both its session and its conversation keeps it", () => {
    const span: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "chat",
        sessionId: "chat-7",
        llmConversationId: "chat-7",
        attributes: { "session.id": "chat-7" },
        events: [],
        links: [],
      },
      traceKeysRule("hash"),
    );

    expect((span["attributes"] as JSONObject)["session.id"]).toBe("chat-7");
  });
});
