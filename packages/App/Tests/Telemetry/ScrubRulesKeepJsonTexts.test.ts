import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import SessionReplayScrubService from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";
import TraceScrubRuleService, {
  ExceptionContent,
} from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import LogScrubField from "Common/Types/Log/LogScrubField";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import ScrubNestedValuesUtil, {
  SCRUB_MAX_NESTED_VALUES_PER_RECORD,
} from "Common/Utils/Telemetry/ScrubNestedValues";
import {
  hasLoneSurrogate,
  JSON_STYLES,
  JsonToken,
  randomJsonListOrMap,
  Random,
  readJsonTokens,
  seededRandom,
  writeJson,
} from "Common/Tests/Utils/Telemetry/JsonTextCases";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A PATTERN RULE KEEPS A JSON TEXT JSON, IN EVERY TEXT A RECORD STORES (#8923).
 *
 * A log body sent as a map or a list is stored as its JSON text, and so is
 * an attribute an application writes as JSON (an AI call's messages) or one
 * held as its JSON text because it was too large to read value by value. A
 * pattern rule used to read such a text as plain text: a match right after
 * an escape left `\[REDACTED]`, a match on a number left `[REDACTED]` where
 * a value goes, and a card, Social Security or phone number or an IP address
 * at the start of a line - after `\n` - was not found at all. Through the
 * real LogScrubRuleService and TraceScrubRuleService, with rules compiled
 * by their own getRegexForPattern: the texts stay JSON and are read as the
 * application wrote them; a plain text is scrubbed as it always was. The
 * JSON texts are JsonTextCases' seeded random ones, so a failure names its
 * seed. Common's ScrubJsonText.test.ts holds the rest.
 * ---------------------------------------------------------------------------
 */

type GetRegexForPattern = (
  patternType: string,
  customRegex?: string,
) => ScrubRegExp | null;

interface RuleSpec {
  patternType: string;
  action?: string | undefined;
  customRegex?: string | undefined;
  fields?: string | undefined;
}

interface CompiledRule {
  rule: LogScrubRule | TraceScrubRule;
  regex: ScrubRegExp;
}

// The project the rules are of: their Hash tokens are keyed with it.
const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000a30393",
);

function compile(
  service: unknown,
  rule: LogScrubRule | TraceScrubRule,
  spec: RuleSpec,
): CompiledRule {
  rule.name = "test rule";
  // A Hash rule hashes with its project's key, as the rules ingest loads do.
  rule.projectId = PROJECT_ID;
  rule.patternType = spec.patternType;
  rule.scrubAction = spec.action || "redact";

  if (spec.customRegex !== undefined) {
    rule.customRegex = spec.customRegex;
  }

  if (spec.fields !== undefined) {
    rule.fieldsToScrub = spec.fields;
  }

  const regex: ScrubRegExp | null = (
    service as { getRegexForPattern: GetRegexForPattern }
  ).getRegexForPattern(spec.patternType, spec.customRegex);

  expect(regex).not.toBeNull();

  return { rule: rule, regex: regex as ScrubRegExp };
}

function logRules(specs: Array<RuleSpec>): never {
  return specs.map((spec: RuleSpec): CompiledRule => {
    return compile(LogScrubRuleService, new LogScrubRule(), spec);
  }) as never;
}

function traceRules(specs: Array<RuleSpec>): never {
  return specs.map((spec: RuleSpec): CompiledRule => {
    return compile(TraceScrubRuleService, new TraceScrubRule(), spec);
  }) as never;
}

function scrubbedLog(row: JSONObject, specs: Array<RuleSpec>): JSONObject {
  return LogScrubRuleService.scrubLog(row, logRules(specs));
}

function scrubbedBody(body: string, specs: Array<RuleSpec>): string {
  return scrubbedLog({ body: body, attributes: {} }, specs)["body"] as string;
}

function isJsonListOrMap(text: string): boolean {
  return ScrubNestedValuesUtil.readJsonListOrMap(text) !== null;
}

const BUILT_INS: Array<string> = [
  "email",
  "creditCard",
  "ssn",
  "phoneNumber",
  "ipAddress",
];

const ACTIONS: Array<string> = ["redact", "mask", "hash"];

// What starts a line in an application's text, and what JSON writes for it.
const LINE_STARTS: Array<[string, string]> = [
  ["email", "ada@example.com"],
  ["creditCard", "4111 1111 1111 1111"],
  ["ssn", "123-45-6789"],
  ["phoneNumber", "555-123-4567"],
  // A public address: a private one is no one's, and is kept (#10393).
  ["ipAddress", "203.0.113.12"],
];

describe("a structured log body stays JSON under every pattern rule", () => {
  for (const [patternType, secret] of LINE_STARTS) {
    for (const action of ACTIONS) {
      test(`${patternType}, ${action}: a value at the start of a line is hidden, and the body is the same JSON`, () => {
        const body: string = JSON.stringify({
          kvlistValue: {
            values: [
              {
                key: "message",
                value: { stringValue: `first line\n${secret}\tafter` },
              },
              { key: "retries", value: { intValue: "2" } },
            ],
          },
        });
        const scrubbed: string = scrubbedBody(body, [
          { patternType: patternType, action: action },
        ]);
        const message: string = (
          ((JSON.parse(scrubbed) as JSONObject)["kvlistValue"] as JSONObject)[
            "values"
          ] as JSONArray
        )[0]!["value"]!["stringValue" as never] as string;

        expect(scrubbed).not.toContain(secret);
        expect(message.startsWith("first line\n")).toBe(true);
        expect(message.endsWith("\tafter")).toBe(true);
        expect(
          scrubbed.replace(/"stringValue":"[^"\\]*(?:\\.[^"\\]*)*"/, ""),
        ).toBe(body.replace(/"stringValue":"[^"\\]*(?:\\.[^"\\]*)*"/, ""));
      });
    }
  }

  test("a number a rule matches becomes a string, and the body is still JSON", () => {
    expect(
      scrubbedBody('{"user":"ada","phone":5551234567}', [
        { patternType: "phoneNumber" },
      ]),
    ).toBe('{"user":"ada","phone":"[REDACTED]"}');
  });

  test("a custom pattern written against the JSON text still hides what it was written for", () => {
    const body: string = JSON.stringify({ user: "ada", password: "hunter2" });

    expect(
      JSON.parse(
        scrubbedBody(body, [
          { patternType: "custom", customRegex: '(?<="password":")[^"]+' },
        ]),
      ),
    ).toEqual({ user: "ada", password: "[REDACTED]" });
  });

  test("with a Sensitive Attribute Keys rule, in either order: the keys read and the patterns found", () => {
    const body: string = JSON.stringify({
      message: "signed in\nada@example.com",
      password: "hunter2",
    });

    for (const specs of [
      [{ patternType: "email" }, { patternType: "sensitiveKeys" }],
      [{ patternType: "sensitiveKeys" }, { patternType: "email" }],
    ]) {
      expect(JSON.parse(scrubbedBody(body, specs))).toEqual({
        message: "signed in\n[REDACTED]",
        password: "[REDACTED]",
      });
    }
  });

  test("a Fluentd record's log line, itself JSON, stays JSON inside the body", () => {
    const body: string = JSON.stringify({
      log: JSON.stringify({ level: "info", msg: "paid\n4111 1111 1111 1111" }),
      stream: "stdout",
    });
    const scrubbed: JSONObject = JSON.parse(
      scrubbedBody(body, [{ patternType: "creditCard", action: "mask" }]),
    ) as JSONObject;

    expect(JSON.parse(scrubbed["log"] as string)).toEqual({
      level: "info",
      msg: "paid\n****-****-****-1111",
    });
  });

  test("a plain body is scrubbed as it always was", () => {
    // A real line break, not JSON's escape: the address is found as before.
    expect(
      scrubbedBody("line one\nada@example.com", [{ patternType: "email" }]),
    ).toBe("line one\n[REDACTED]");
    // Text that only starts like JSON is plain text too.
    expect(
      scrubbedBody('{"broken": "ada@example.com"', [{ patternType: "email" }]),
    ).toBe('{"broken": "[REDACTED]"');
  });

  test("a body only a Body Only rule reads is kept JSON too, and an Attributes Only rule leaves it", () => {
    const body: string = JSON.stringify({ m: "x\n203.0.113.12" });

    expect(
      scrubbedBody(body, [
        { patternType: "ipAddress", fields: LogScrubField.Body },
      ]),
    ).toBe(JSON.stringify({ m: "x\n[REDACTED]" }));
    expect(
      scrubbedBody(body, [
        { patternType: "ipAddress", fields: LogScrubField.Attributes },
      ]),
    ).toBe(body);
  });
});

describe("an attribute written as JSON stays JSON", () => {
  const messages: string = JSON.stringify([
    { role: "user", content: "my card is\n4111 1111 1111 1111" },
    { role: "assistant", content: "Thanks, I have noted ada@example.com" },
  ]);

  test("a span's AI messages: a card number at the start of a line is found, and the messages stay JSON", () => {
    const span: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "chat",
        attributes: { "gen_ai.input.messages": messages },
        events: [
          {
            name: "gen_ai.user.message",
            attributes: { content: messages },
          },
        ],
        links: [{ attributes: { context: messages } }],
      },
      traceRules([
        { patternType: "creditCard", action: "mask" },
        { patternType: "email", action: "redact" },
      ]),
    );
    const expected: Array<JSONObject> = [
      { role: "user", content: "my card is\n****-****-****-1111" },
      { role: "assistant", content: "Thanks, I have noted [REDACTED]" },
    ];

    expect(
      JSON.parse(
        (span["attributes"] as JSONObject)["gen_ai.input.messages"] as string,
      ),
    ).toEqual(expected);
    expect(
      JSON.parse(
        ((span["events"] as JSONArray)[0]!["attributes"] as JSONObject)[
          "content"
        ] as string,
      ),
    ).toEqual(expected);
    expect(
      JSON.parse(
        ((span["links"] as JSONArray)[0]!["attributes"] as JSONObject)[
          "context"
        ] as string,
      ),
    ).toEqual(expected);
  });

  test("a log's attribute, and an exception's message written as JSON", () => {
    const log: JSONObject = scrubbedLog(
      { body: "", attributes: { "request.body": messages } },
      [{ patternType: "creditCard" }],
    );

    expect(
      JSON.parse((log["attributes"] as JSONObject)["request.body"] as string),
    ).toEqual([
      { role: "user", content: "my card is\n[REDACTED]" },
      { role: "assistant", content: "Thanks, I have noted ada@example.com" },
    ]);

    const content: ExceptionContent =
      TraceScrubRuleService.scrubExceptionContent(
        {
          message: JSON.stringify({ error: "declined\n4111 1111 1111 1111" }),
          stackTrace: "at pay()\n4111 1111 1111 1111",
          exceptionType: "CardError",
          attributes: {},
        },
        traceRules([
          { patternType: "creditCard", fields: TraceScrubField.Events },
        ]),
      );

    expect(JSON.parse(content.message)).toEqual({
      error: "declined\n[REDACTED]",
    });
    // A plain text, as before.
    expect(content.stackTrace).toBe("at pay()\n[REDACTED]");
  });

  test("a value too large to read value by value is held as its JSON text, and stays JSON", () => {
    const wide: Array<string> = new Array<string>(
      SCRUB_MAX_NESTED_VALUES_PER_RECORD + 1,
    ).fill("x");

    wide[7] = "line\nada@example.com";

    const log: JSONObject = scrubbedLog(
      { body: "", attributes: { wide: wide } },
      [{ patternType: "email" }],
    );
    const held: unknown = (log["attributes"] as JSONObject)["wide"];

    expect(typeof held).toBe("string");
    expect((JSON.parse(held as string) as Array<string>)[7]).toBe(
      "line\n[REDACTED]",
    );
  });
});

describe("a masked value keeps whole characters", () => {
  test("a custom match and a secret that start or end with an emoji are never split", () => {
    const log: JSONObject = scrubbedLog(
      {
        body: "token=😀abc😀 done",
        attributes: { password: "😀hunter2😀" },
      },
      [
        { patternType: "custom", customRegex: "😀abc😀", action: "mask" },
        { patternType: "sensitiveKeys", action: "mask" },
      ],
    );

    expect(log["body"]).toBe("token=😀***😀 done");
    expect((log["attributes"] as JSONObject)["password"]).toBe("😀*******😀");

    const span: JSONObject = TraceScrubRuleService.scrubSpan(
      { name: "😀abc😀", attributes: {}, events: [], links: [] },
      traceRules([
        { patternType: "custom", customRegex: "😀abc😀", action: "mask" },
      ]),
    );

    expect(hasLoneSurrogate(span["name"] as string)).toBe(false);
    expect(span["name"]).toBe("😀***😀");
  });

  test("the session replay scrubber masks the same way", () => {
    const applyScrubAction: (
      match: string,
      action: string,
      patternType: string,
    ) => string = (
      SessionReplayScrubService as unknown as {
        applyScrubAction: (
          match: string,
          action: string,
          patternType: string,
        ) => string;
      }
    ).applyScrubAction.bind(SessionReplayScrubService);

    expect(applyScrubAction("😀abc😀", "mask", "custom")).toBe("😀***😀");
    expect(applyScrubAction("hunter2", "mask", "sensitiveKeys")).toBe(
      "h*****2",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * PROPERTIES through scrubLog, with the rules a project can save: every
 * built-in pattern under every action, a few custom patterns that read past
 * what a value is, and all of them at once.
 * ---------------------------------------------------------------------------
 */
describe("properties of a structured body through scrubLog", () => {
  const RULE_SETS: Array<[string, Array<RuleSpec>]> = [
    ...BUILT_INS.flatMap(
      (patternType: string): Array<[string, Array<RuleSpec>]> => {
        return ACTIONS.map((action: string): [string, Array<RuleSpec>] => {
          return [`${patternType} ${action}`, [{ patternType, action }]];
        });
      },
    ),
    ["custom \\S+", [{ patternType: "custom", customRegex: "\\S+" }]],
    ['custom [^"]+', [{ patternType: "custom", customRegex: '[^"]+' }]],
    ["custom \\\\.", [{ patternType: "custom", customRegex: "\\\\." }]],
    [
      "custom \\d+ masked",
      [{ patternType: "custom", customRegex: "\\d+", action: "mask" }],
    ],
    [
      "every kind at once",
      [
        ...BUILT_INS.map((patternType: string): RuleSpec => {
          return { patternType, action: "mask" };
        }),
        { patternType: "custom", customRegex: "token[0-9]*" },
        { patternType: "sensitiveKeys", action: "hash" },
      ],
    ],
  ];

  for (const [name, specs] of RULE_SETS) {
    test(`${name}: a body stays JSON with the same punctuation, and its strings stay strings`, () => {
      for (let seed: number = 20000; seed < 20040; seed++) {
        const random: Random = seededRandom(seed);

        for (const style of JSON_STYLES) {
          const body: string = writeJson(
            randomJsonListOrMap(random, { jsonInsideStrings: 1 }),
            style,
            random,
          );
          const scrubbed: string = scrubbedBody(body, specs);
          const label: string = `seed ${seed} ${style}: ${body}`;

          expect({ label, json: isJsonListOrMap(scrubbed) }).toEqual({
            label,
            json: true,
          });

          /*
           * Every token kept, a Sensitive Attribute Keys rule's too: it
           * replaces only the texts it hides, where they are written
           * (#8993), where it used to write the body again with
           * JSON.stringify's spaces.
           */
          const before: Array<JsonToken> = readJsonTokens(body);
          const after: Array<JsonToken> = readJsonTokens(scrubbed);
          const shape: (tokens: Array<JsonToken>) => Array<string> = (
            tokens: Array<JsonToken>,
          ): Array<string> => {
            return tokens.map((token: JsonToken): string => {
              return token.kind === "string" || token.kind === "scalar"
                ? "value"
                : token.text;
            });
          };

          expect({ label, shape: shape(after) }).toEqual({
            label,
            shape: shape(before),
          });

          before.forEach((token: JsonToken, index: number): void => {
            if (token.kind === "string") {
              expect({ label, kind: after[index]!.kind }).toEqual({
                label,
                kind: "string",
              });
            }
          });
        }
      }
    });
  }
});
