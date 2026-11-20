import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService, {
  ExceptionContent,
} from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import { MAX_JSON_TEXTS_INSIDE_STRINGS } from "Common/Utils/Telemetry/ScrubJsonText";
import {
  SCRUB_MAX_NESTED_VALUES_PER_RECORD,
  SCRUB_MAX_VALUE_DEPTH,
} from "Common/Utils/Telemetry/ScrubNestedValues";
import { maskKeepingEnds } from "Common/Utils/Telemetry/ScrubMask";
import {
  JSON_STYLES,
  Random,
  seededRandom,
} from "Common/Tests/Utils/Telemetry/JsonTextCases";
import {
  expectedReading,
  KeysCaseOptions,
  marksIn,
  randomJsonText,
  readingOf,
  shapeDifference,
} from "Common/Tests/Utils/Telemetry/JsonKeysCases";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SENSITIVE ATTRIBUTE KEYS RULE READS THE KEYS OF A JSON TEXT HELD IN A
 * STRING, IN EVERY TEXT A RECORD STORES (#8993).
 *
 * A keys rule read an attribute's own key, the keys inside a list or a map
 * value and the keys of a JSON log body, but never the keys of a JSON text
 * held in a string: an attribute such as `http.request.body` =
 * `{"password":"hunter2"}`, an AI call's messages, a Fluentd record's array
 * field (stored as its JSON text), or a string of a body that is JSON of
 * its own - a Fluentd/docker `log` field. The password was stored as sent.
 * Through the real LogScrubRuleService and TraceScrubRuleService, with
 * rules compiled by their own getRegexForPattern: the secret under each key
 * is hidden, every other character of the text stays as it was written,
 * and a text that only looks like JSON is left alone. Common's
 * ScrubJsonKeys.test.ts holds the reader itself; the OTLP, Fluentd and
 * syslog routes are in OtelLogsScrubNestedValues, OtelTracesScrubNestedValues
 * and ScrubRulesKeysJsonTextsLogSources.
 * ---------------------------------------------------------------------------
 */

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => ScrubRegExp | null;

interface RuleSpec {
  patternType: string;
  action?: string | undefined;
  fields?: string | undefined;
}

// The project the rules are of: their Hash tokens are keyed with it.
const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a20394",
);

function compile(
  service: unknown,
  rule: LogScrubRule | TraceScrubRule,
  spec: RuleSpec,
): { rule: LogScrubRule | TraceScrubRule; regex: ScrubRegExp } {
  rule.name = "test rule";
  // A Hash rule hashes with its project's key, as the rules ingest loads do.
  rule.projectId = PROJECT_ID;
  rule.patternType = spec.patternType;
  rule.scrubAction = spec.action || "redact";

  if (spec.fields !== undefined) {
    rule.fieldsToScrub = spec.fields;
  }

  const regex: ScrubRegExp | null = (
    service as { getRegexForPattern: GetRegexForPattern }
  ).getRegexForPattern(spec.patternType);

  expect(regex).not.toBeNull();

  return { rule: rule, regex: regex as ScrubRegExp };
}

function logRules(specs: Array<RuleSpec>): never {
  return specs.map((spec: RuleSpec) => {
    return compile(LogScrubRuleService, new LogScrubRule(), spec);
  }) as never;
}

function traceRules(specs: Array<RuleSpec>): never {
  return specs.map((spec: RuleSpec) => {
    return compile(TraceScrubRuleService, new TraceScrubRule(), spec);
  }) as never;
}

const KEYS: RuleSpec = { patternType: "sensitiveKeys" };
const REDACTED: string = "[REDACTED]";

function scrubbedLog(row: JSONObject, specs: Array<RuleSpec>): JSONObject {
  return LogScrubRuleService.scrubLog(row, logRules(specs));
}

function logAttributes(
  attributes: JSONObject,
  specs: Array<RuleSpec> = [KEYS],
): JSONObject {
  return scrubbedLog({ body: "", attributes: attributes }, specs)[
    "attributes"
  ] as JSONObject;
}

function logBody(body: string, specs: Array<RuleSpec> = [KEYS]): string {
  return scrubbedLog({ body: body, attributes: {} }, specs)["body"] as string;
}

// What a Hash rule of PROJECT_ID leaves of a text (#10394).
function token(text: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: text });
}

// A request body as an application logs it: a number JSON.parse cannot keep, spaces.
const REQUEST_BODY: string =
  '{ "username": "ada", "password": "hunter2", "id": 12345678901234567890 }';
const REQUEST_BODY_HIDDEN: string =
  '{ "username": "ada", "password": "[REDACTED]", "id": 12345678901234567890 }';

describe("a log's attributes: a JSON text held in a string is read key by key", () => {
  test('http.request.body holding {"password": ...}: the password is hidden, and the text is the same JSON otherwise', () => {
    expect(logAttributes({ "http.request.body": REQUEST_BODY })).toEqual({
      "http.request.body": REQUEST_BODY_HIDDEN,
    });
  });

  test("a Fluentd record's array field, stored as its JSON text, and a JSON text inside a list or a map value", () => {
    expect(
      logAttributes({
        "fluentd.credentials": JSON.stringify([
          { token: "tok-1", scope: "read" },
        ]),
        "request.bodies": [REQUEST_BODY, "plain text"],
        "request.last": { body: REQUEST_BODY, at: 3 },
      }),
    ).toEqual({
      "fluentd.credentials": JSON.stringify([
        { token: REDACTED, scope: "read" },
      ]),
      "request.bodies": [REQUEST_BODY_HIDDEN, "plain text"],
      "request.last": { body: REQUEST_BODY_HIDDEN, at: 3 },
    });
  });

  test("a JSON text with no secret key is the very text it was", () => {
    const texts: Array<string> = [
      '{ "event": "password_reset", "user": "ada" }',
      '[{"tokens_used":{"prompt":12,"completion":30}}]',
      '{"message":"line one\\nline two","n":1.50}',
    ];
    const attributes: JSONObject = logAttributes({
      a: texts[0]!,
      b: texts[1]!,
      c: texts[2]!,
    });

    expect([attributes["a"], attributes["b"], attributes["c"]]).toEqual(texts);
  });

  test("a text that only looks like JSON is kept as it is: the rule reads no free text", () => {
    const attributes: JSONObject = {
      template: "{token}",
      note: "[password reset] for ada",
      cut: '{"password": "hunter2"',
      trailing: '{"password":"hunter2"} and more',
    };

    expect(logAttributes({ ...attributes })).toEqual(attributes);
  });

  test("under a secret key, a JSON text is hidden whole, as any text under one", () => {
    expect(
      logAttributes({ "auth.token": JSON.stringify({ a: "b", n: 1 }) }),
    ).toEqual({ "auth.token": REDACTED });
  });

  test("each action reads the text as it reads, as the same value sent as a map", () => {
    const asMap: JSONObject = { form: { password: "hunter2", user: "ada" } };
    const asJson: JSONObject = {
      form: '{"password":"hunter2","user":"ada"}',
    };

    for (const action of ["redact", "mask", "hash"]) {
      const map: JSONObject = logAttributes(
        JSON.parse(JSON.stringify(asMap)) as JSONObject,
        [{ patternType: "sensitiveKeys", action: action }],
      );
      const json: JSONObject = logAttributes({ ...asJson }, [
        { patternType: "sensitiveKeys", action: action },
      ]);

      expect([action, JSON.parse(json["form"] as string)]).toEqual([
        action,
        map["form"],
      ]);
    }

    expect(
      JSON.parse(
        logAttributes({ ...asJson }, [
          { patternType: "sensitiveKeys", action: "mask" },
        ])["form"] as string,
      ),
    ).toEqual({ password: maskKeepingEnds("hunter2"), user: "ada" });
    expect(
      JSON.parse(
        logAttributes({ ...asJson }, [
          { patternType: "sensitiveKeys", action: "hash" },
        ])["form"] as string,
      ),
    ).toEqual({ password: token("hunter2"), user: "ada" });
  });

  test("with a pattern rule before or after it, both apply and the text stays JSON", () => {
    const attributes: JSONObject = {
      "http.request.body":
        '{"email":"line one\\nada@example.com","api_key":"k-1"}',
    };

    for (const specs of [
      [{ patternType: "email" }, KEYS],
      [KEYS, { patternType: "email" }],
    ]) {
      expect(
        JSON.parse(
          logAttributes({ ...attributes }, specs)[
            "http.request.body"
          ] as string,
        ),
      ).toEqual({ email: "line one\n[REDACTED]", api_key: REDACTED });
    }
  });

  test("a rule saved with a body-only scope still reads the attributes' JSON texts", () => {
    expect(
      logAttributes({ "http.request.body": REQUEST_BODY }, [
        { patternType: "sensitiveKeys", fields: "body" },
      ]),
    ).toEqual({ "http.request.body": REQUEST_BODY_HIDDEN });
  });

  test("a record's own session id is kept, written as JSON or not (#8924)", () => {
    const session: string = '{"token":"recording-1"}';
    const row: JSONObject = scrubbedLog(
      {
        body: "",
        sessionId: session,
        attributes: { "session.id": session, other: session },
      },
      [KEYS],
    );

    expect(row["attributes"]).toEqual({
      "session.id": session,
      other: '{"token":"[REDACTED]"}',
    });
  });
});

describe("a log's body: the JSON texts its strings hold are read too", () => {
  test("a Fluentd or docker record's log field holding the application's JSON line", () => {
    const body: string = JSON.stringify({
      log: '{"level":"info","token":"tok-2","msg":"paid"}\n',
      stream: "stdout",
    });

    expect(logBody(body)).toBe(body.replace('\\"tok-2\\"', '\\"[REDACTED]\\"'));
  });

  test("a map body sent over OTLP, its string value a JSON text, the field gRPC adds kept as text", () => {
    const body: string = JSON.stringify({
      kvlistValue: {
        values: [
          {
            key: "log",
            value: {
              stringValue: '{"password":"p-3","user":"ada"}',
              value: "stringValue",
            },
          },
        ],
      },
    });

    expect(logBody(body)).toBe(body.replace('\\"p-3\\"', '\\"[REDACTED]\\"'));
  });

  test(`a JSON text ${MAX_JSON_TEXTS_INSIDE_STRINGS} strings deep is read key by key, one deeper is hidden whole when it names a secret`, () => {
    const chain: (levels: number) => string = (levels: number): string => {
      let text: string = '{"password":"deepest","user":"ada"}';

      for (let level: number = 0; level < levels; level++) {
        text = JSON.stringify({ level: level, payload: text });
      }

      return text;
    };
    const read: (text: string, levels: number) => unknown = (
      text: string,
      levels: number,
    ): unknown => {
      let value: unknown = JSON.parse(text);

      for (let level: number = 0; level < levels; level++) {
        value = JSON.parse((value as Record<string, string>)["payload"]!);
      }

      return value;
    };

    expect(
      read(
        logBody(chain(MAX_JSON_TEXTS_INSIDE_STRINGS)),
        MAX_JSON_TEXTS_INSIDE_STRINGS,
      ),
    ).toEqual({ password: REDACTED, user: "ada" });
    expect(
      read(
        logBody(chain(MAX_JSON_TEXTS_INSIDE_STRINGS + 1)),
        MAX_JSON_TEXTS_INSIDE_STRINGS,
      ),
    ).toEqual({ level: 0, payload: REDACTED });
  });
});

describe("within the record's bounds", () => {
  test(`a JSON text of more than ${SCRUB_MAX_NESTED_VALUES_PER_RECORD} values in an attribute is read key by key up to the bound, the rest as text`, () => {
    const contacts: Array<unknown> = [];

    for (let index: number = 0; index < 6_000; index++) {
      contacts.push({ email: `user${index}@example.com`, password: "pw" });
    }

    const attributes: JSONObject = logAttributes({
      "http.response.body": JSON.stringify({ contacts: contacts }),
    });
    const read: { contacts: Array<unknown> } = JSON.parse(
      attributes["http.response.body"] as string,
    );

    expect(read.contacts[1_998]).toEqual({
      email: "user1998@example.com",
      password: REDACTED,
    });
    expect(read.contacts[1_999]).toBe(REDACTED);
    expect(attributes["http.response.body"]).not.toContain('"pw"');
  });

  test("the record's lists and maps, its body and the JSON texts its attributes hold share one allowance", () => {
    // 9,000 values in a list attribute, then the body's 2 and 500 small maps.
    const row: JSONObject = scrubbedLog(
      {
        body: JSON.stringify({ password: "p-body", n: 1 }),
        attributes: {
          wide: new Array<number>(9_000).fill(1),
          "request.body": JSON.stringify(
            new Array<number>(997)
              .fill(0)
              .map((_value: number, index: number) => {
                return { token: `t-${index}` };
              }),
          ),
          "late.body": '{"token":"t-late","n":1}',
        },
      },
      [KEYS],
    );
    const attributes: JSONObject = row["attributes"] as JSONObject;

    expect(row["body"]).toBe('{"password":"[REDACTED]","n":1}');
    // 10,000 - 9,000 - 2 = 998: the list's 997 items fit, their maps do not all.
    expect(attributes["request.body"]).not.toContain("t-0");
    expect(attributes["request.body"]).not.toContain("t-996");
    // Nothing left: read as one text, which names a secret.
    expect(attributes["late.body"]).toBe(REDACTED);
  });

  test("every keys rule reads within the same bounds", () => {
    // 9,500 values in a list attribute: 500 left for each rule.
    const row: JSONObject = scrubbedLog(
      {
        body: "",
        attributes: {
          wide: new Array<number>(9_500).fill(1),
          "request.body": JSON.stringify(
            new Array<number>(400)
              .fill(0)
              .map((_value: number, index: number) => {
                return { token: `t-${index}`, n: index };
              }),
          ),
        },
      },
      [KEYS, { patternType: "sensitiveKeys", action: "hash" }],
    );
    const read: Array<unknown> = JSON.parse(
      (row["attributes"] as JSONObject)["request.body"] as string,
    );

    /*
     * Each rule reads the list's 400 items and 50 of its maps, the rest as
     * text. Had the second rule read what the first left, it would have
     * found nothing left and hidden the whole text as one.
     */
    expect(read).toHaveLength(400);
    expect(read[0]).toEqual({ token: token(REDACTED), n: 0 });
    expect(read[49]).toEqual({ token: token(REDACTED), n: 49 });
    // Hidden whole by the first; a text in a list, which the second keeps.
    expect(read[50]).toBe(REDACTED);
  });

  test(`a JSON text's own ${SCRUB_MAX_VALUE_DEPTH} levels: a part deeper is hidden whole when it names a secret`, () => {
    let deep: unknown = { password: "pw-deep" };

    for (let level: number = 0; level < SCRUB_MAX_VALUE_DEPTH; level++) {
      deep = { f: deep };
    }

    const attributes: JSONObject = logAttributes({
      "request.body": JSON.stringify({ deep: deep, user: "ada" }),
    });

    expect(attributes["request.body"]).not.toContain("pw-deep");
    expect(
      (JSON.parse(attributes["request.body"] as string) as JSONObject)["user"],
    ).toBe("ada");
  });
});

describe("a span: its attributes, its events' and its links' JSON texts are read, and its exception's", () => {
  const MESSAGES: string = JSON.stringify([
    {
      role: "assistant",
      tool_calls: [
        {
          function: {
            name: "login",
            arguments: JSON.stringify({ username: "ada", password: "hunter2" }),
          },
        },
      ],
    },
  ]);

  function span(): JSONObject {
    return {
      name: "POST /login",
      attributes: {
        "http.request.body": REQUEST_BODY,
        "gen_ai.output.messages": MESSAGES,
      },
      events: [
        { name: "request", attributes: { payload: REQUEST_BODY } },
        {
          name: "exception",
          attributes: {
            "exception.message": '{"error":"declined","card_number":"4111"}',
          },
        },
      ],
      links: [{ attributes: { "link.payload": REQUEST_BODY } }],
    };
  }

  for (const fields of [TraceScrubField.All, TraceScrubField.Name]) {
    test(`a keys rule, saved with ${fields}, hides the secret in each`, () => {
      const scrubbed: JSONObject = TraceScrubRuleService.scrubSpan(
        span(),
        traceRules([{ patternType: "sensitiveKeys", fields: fields }]),
      );
      const attributes: JSONObject = scrubbed["attributes"] as JSONObject;
      const events: JSONArray = scrubbed["events"] as JSONArray;

      expect(attributes["http.request.body"]).toBe(REQUEST_BODY_HIDDEN);
      expect(
        JSON.parse(
          (
            (
              JSON.parse(
                attributes["gen_ai.output.messages"] as string,
              ) as Array<JSONObject>
            )[0]!["tool_calls"] as Array<JSONObject>
          )[0]!["function"]!["arguments" as never] as string,
        ),
      ).toEqual({ username: "ada", password: REDACTED });
      expect((events[0]!["attributes"] as JSONObject)["payload"]).toBe(
        REQUEST_BODY_HIDDEN,
      );
      expect(
        (events[1]!["attributes"] as JSONObject)["exception.message"],
      ).toBe('{"error":"declined","card_number":"[REDACTED]"}');
      expect(
        ((scrubbed["links"] as JSONArray)[0]!["attributes"] as JSONObject)[
          "link.payload"
        ],
      ).toBe(REQUEST_BODY_HIDDEN);
      expect(JSON.stringify(scrubbed)).not.toContain("hunter2");
    });
  }

  test("an exception's message, stack trace and type are read as the event attributes they were copied from", () => {
    const rules: never = traceRules([
      { patternType: "creditCard", action: "mask" },
      { patternType: "sensitiveKeys", action: "hash" },
    ]);
    const message: string =
      '{"error":"declined\\n4111 1111 1111 1111","card_number":"4111","request":"{\\"token\\":\\"t-1\\"}"}';
    const content: ExceptionContent =
      TraceScrubRuleService.scrubExceptionContent(
        {
          message: message,
          stackTrace: '["at pay()",{"api_key":"k-1"}]',
          exceptionType: '{"secret":"s-1"}',
          attributes: { "exception.details": REQUEST_BODY },
        },
        rules,
      );
    const spanRow: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "pay",
        attributes: {},
        events: [
          {
            name: "exception",
            attributes: {
              "exception.message": message,
              "exception.stacktrace": '["at pay()",{"api_key":"k-1"}]',
              "exception.type": '{"secret":"s-1"}',
              "exception.details": REQUEST_BODY,
            },
          },
        ],
        links: [],
      },
      rules,
    );
    const event: JSONObject = (spanRow["events"] as JSONArray)[0]![
      "attributes"
    ] as JSONObject;

    // The exception row holds what the span row's event holds.
    expect(content.message).toBe(event["exception.message"]);
    expect(content.stackTrace).toBe(event["exception.stacktrace"]);
    expect(content.exceptionType).toBe(event["exception.type"]);
    expect(content.attributes["exception.details"]).toBe(
      event["exception.details"],
    );
    expect(JSON.parse(content.message)).toEqual({
      error: "declined\n****-****-****-1111",
      card_number: token("4111"),
      request: `{"token":"${token("t-1")}"}`,
    });
    expect(JSON.parse(content.stackTrace)).toEqual([
      "at pay()",
      { api_key: token("k-1") },
    ]);
    expect(content.exceptionType).toBe(`{"secret":"${token("s-1")}"}`);
  });

  test("an exception with no type keeps none, and a plain message is kept", () => {
    const content: ExceptionContent =
      TraceScrubRuleService.scrubExceptionContent(
        { message: "declined", stackTrace: "at pay()", attributes: {} },
        traceRules([KEYS]),
      );

    expect(content).toEqual({
      message: "declined",
      stackTrace: "at pay()",
      attributes: {},
    });
  });

  test("a span's own session id is kept, an event's is read as any other value (#8924)", () => {
    const session: string = '{"token":"recording-1"}';
    const scrubbed: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "chat",
        sessionId: session,
        attributes: { "session.id": session },
        events: [{ name: "e", attributes: { note: session } }],
        links: [],
      },
      traceRules([KEYS]),
    );

    expect((scrubbed["attributes"] as JSONObject)["session.id"]).toBe(session);
    expect(
      ((scrubbed["events"] as JSONArray)[0]!["attributes"] as JSONObject)[
        "note"
      ],
    ).toBe('{"token":"[REDACTED]"}');
  });
});

/*
 * ---------------------------------------------------------------------------
 * PROPERTIES through scrubLog and scrubSpan, over JsonKeysCases' seeded
 * random JSON texts held in strings: in an attribute, inside a list value,
 * in a body, in an event's and a link's attributes.
 * ---------------------------------------------------------------------------
 */
function randomCase(random: Random, seed: number): string {
  const options: KeysCaseOptions = {
    jsonInsideStrings: seed % (MAX_JSON_TEXTS_INSIDE_STRINGS + 1),
    marks: { next: 0 },
  };

  return randomJsonText(
    random,
    options,
    false,
    JSON_STYLES[seed % JSON_STYLES.length]!,
  );
}

function expectHidden(data: {
  label: string;
  before: string;
  after: string;
}): void {
  const label: string = data.label;

  expect({ label, reading: readingOf(data.after) }).toEqual({
    label,
    reading: expectedReading(data.before, (): string => {
      return REDACTED;
    }),
  });
  expect({ label, shape: shapeDifference(data.before, data.after) }).toEqual({
    label,
    shape: null,
  });
  expect({ label, secrets: [...marksIn(data.after, true)] }).toEqual({
    label,
    secrets: [],
  });
  expect({ label, plain: [...marksIn(data.after, false)].sort() }).toEqual({
    label,
    plain: [...marksIn(data.before, false)].sort(),
  });
}

describe("properties through the scrub services", () => {
  const CASES: number = 120;

  test("a log: every JSON text in its attributes, a list value and its body, read as the same value sent as a map", () => {
    for (let seed: number = 50000; seed < 50000 + CASES; seed++) {
      const random: Random = seededRandom(seed);
      const attribute: string = randomCase(random, seed);
      const item: string = randomCase(random, seed + 1);
      const body: string = randomCase(random, seed + 2);
      const row: JSONObject = scrubbedLog(
        {
          body: body,
          attributes: { "http.request.body": attribute, items: [item, 1] },
        },
        [{ patternType: "email" }, KEYS, { patternType: "ipAddress" }],
      );
      const attributes: JSONObject = row["attributes"] as JSONObject;

      expectHidden({
        label: `seed ${seed} attribute: ${attribute}`,
        before: attribute,
        after: attributes["http.request.body"] as string,
      });
      expectHidden({
        label: `seed ${seed} item: ${item}`,
        before: item,
        after: (attributes["items"] as Array<string>)[0]!,
      });
      expectHidden({
        label: `seed ${seed} body: ${body}`,
        before: body,
        after: row["body"] as string,
      });
    }
  });

  test("a span: every JSON text in its attributes, its events' and its links'", () => {
    for (let seed: number = 60000; seed < 60000 + CASES; seed++) {
      const random: Random = seededRandom(seed);
      const texts: Array<string> = [0, 1, 2].map((offset: number): string => {
        return randomCase(random, seed + offset);
      });
      const scrubbed: JSONObject = TraceScrubRuleService.scrubSpan(
        {
          name: "op",
          attributes: { "gen_ai.input.messages": texts[0]! },
          events: [{ name: "e", attributes: { payload: texts[1]! } }],
          links: [{ attributes: { context: texts[2]! } }],
        },
        traceRules([KEYS, { patternType: "creditCard", action: "mask" }]),
      );
      const after: Array<string> = [
        (scrubbed["attributes"] as JSONObject)[
          "gen_ai.input.messages"
        ] as string,
        ((scrubbed["events"] as JSONArray)[0]!["attributes"] as JSONObject)[
          "payload"
        ] as string,
        ((scrubbed["links"] as JSONArray)[0]!["attributes"] as JSONObject)[
          "context"
        ] as string,
      ];

      texts.forEach((before: string, index: number): void => {
        expectHidden({
          label: `seed ${seed} text ${index}: ${before}`,
          before: before,
          after: after[index]!,
        });
      });
    }
  });
});
