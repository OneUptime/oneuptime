import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import PatternWorkScope from "Common/Server/Utils/PatternWorkScope";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import LogScrubField from "Common/Types/Log/LogScrubField";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import { clearLinearRegExpCache } from "Common/Utils/LinearRegExp/PatternCache";
import { PatternWorkAllowance } from "Common/Utils/LinearRegExp/PatternWork";
import {
  SCRUB_MAX_NESTED_VALUES_PER_RECORD,
  SCRUB_MAX_VALUE_DEPTH,
} from "Common/Utils/Telemetry/ScrubNestedValues";
import crypto from "crypto";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * SCRUB RULES READ THE TEXT INSIDE LISTS AND NESTED VALUES (#6397).
 *
 * TraceScrubRuleService and LogScrubRuleService skipped every attribute
 * value that was not a text, so a list or a nested value - an HTTP header's
 * values, a process's command line, a key-value list inside a list - was
 * stored as it arrived: an Email rule never saw an address inside a list,
 * and a Sensitive Attribute Keys rule left the values of an
 * `http.request.header.authorization` list in the clear. Span link
 * attributes were never scrubbed at all.
 *
 * Both engines now read every text inside such a value and keep its shape
 * (Common/Utils/Telemetry/ScrubNestedValues). Rules are compiled through
 * each service's real getRegexForPattern, so the built-in patterns are the
 * ones production uses. Real OTLP payloads on each route are in
 * OtelLogsScrubNestedValues and OtelTracesScrubNestedValues.
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

function compile(
  service: unknown,
  rule: LogScrubRule | TraceScrubRule,
  spec: RuleSpec,
): CompiledRule {
  rule.name = "test rule";
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

function logRules(specs: Array<RuleSpec>): Array<CompiledRule> {
  return specs.map((spec: RuleSpec): CompiledRule => {
    return compile(LogScrubRuleService, new LogScrubRule(), spec);
  });
}

function traceRules(specs: Array<RuleSpec>): Array<CompiledRule> {
  return specs.map((spec: RuleSpec): CompiledRule => {
    return compile(TraceScrubRuleService, new TraceScrubRule(), spec);
  });
}

interface Engine {
  name: string;
  // A record's attribute map after the rules, as one log or one span.
  scrubAttributes: (
    attributes: JSONObject,
    specs: Array<RuleSpec>,
  ) => JSONObject;
}

const ENGINES: Array<Engine> = [
  {
    name: "LogScrubRuleService",
    scrubAttributes: (
      attributes: JSONObject,
      specs: Array<RuleSpec>,
    ): JSONObject => {
      const row: JSONObject = LogScrubRuleService.scrubLog(
        { body: "", attributes: attributes },
        logRules(specs) as never,
      );

      return row["attributes"] as JSONObject;
    },
  },
  {
    name: "TraceScrubRuleService",
    scrubAttributes: (
      attributes: JSONObject,
      specs: Array<RuleSpec>,
    ): JSONObject => {
      const row: JSONObject = TraceScrubRuleService.scrubSpan(
        { name: "", attributes: attributes, events: [], links: [] },
        traceRules(specs) as never,
      );

      return row["attributes"] as JSONObject;
    },
  },
];

const EMAIL_MASK: RuleSpec = { patternType: "email", action: "mask" };
const SENSITIVE_KEYS: RuleSpec = { patternType: "sensitiveKeys" };

function sha8(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 8);
}

// `inner` inside `lists` lists, one in the other.
function nest(inner: unknown, lists: number): unknown {
  let value: unknown = inner;

  for (let level: number = 0; level < lists; level++) {
    value = [value];
  }

  return value;
}

function unnest(value: unknown, lists: number): unknown {
  let inner: unknown = value;

  for (let level: number = 0; level < lists; level++) {
    inner = (inner as Array<unknown>)[0];
  }

  return inner;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    const map: Record<string, unknown> = value as Record<string, unknown>;

    for (const key of Object.keys(map)) {
      deepFreeze(map[key]);
    }

    Object.freeze(value);
  }

  return value;
}

beforeEach(() => {
  clearLinearRegExpCache();
});

describe.each(ENGINES)(
  "$name: the texts inside a list or a nested value",
  ({ scrubAttributes }: Engine) => {
    test("masks an address in each text of a list, keeping its length, its order and the values that are not text", () => {
      expect(
        scrubAttributes(
          {
            "user.emails": [
              "ada@example.com",
              7,
              2.5,
              true,
              null,
              "no address here",
              "write to bob@example.org",
            ],
          },
          [EMAIL_MASK],
        ),
      ).toEqual({
        "user.emails": [
          "a***@***.com",
          7,
          2.5,
          true,
          null,
          "no address here",
          "write to b***@***.org",
        ],
      });
    });

    test("masks the texts of lists inside lists, and of the maps a key-value list inside a list becomes", () => {
      expect(
        scrubAttributes(
          {
            matrix: [
              ["ada@example.com", ["deep down bob@example.org"]],
              [1.5, false, []],
            ],
            // TelemetryUtil.getAttributes: a kvlist in a list, keys prefixed.
            contacts: [
              {
                "contacts.name": "Ada",
                "contacts.email": "ada@example.com",
                "contacts.age": 36,
                "contacts.tags": ["vip", "ada@example.com"],
              },
            ],
            plain: "ada@example.com",
          },
          [EMAIL_MASK],
        ),
      ).toEqual({
        matrix: [
          ["a***@***.com", ["deep down b***@***.org"]],
          [1.5, false, []],
        ],
        contacts: [
          {
            "contacts.name": "Ada",
            "contacts.email": "a***@***.com",
            "contacts.age": 36,
            "contacts.tags": ["vip", "a***@***.com"],
          },
        ],
        plain: "a***@***.com",
      });
    });

    test.each([
      [
        "creditCard",
        "mask",
        "card 4111-1111-1111-1111",
        "card ****-****-****-1111",
      ],
      ["ssn", "mask", "ssn 123-45-6789", "ssn ***-**-6789"],
      ["phoneNumber", "mask", "call 555-123-4567", "call ***-***-4567"],
      ["ipAddress", "mask", "from 10.0.0.1", "from ***.***.***.***"],
      ["email", "redact", "to ada@example.com", "to [REDACTED]"],
      [
        "email",
        "hash",
        "to ada@example.com",
        `to [HASHED:${sha8("ada@example.com")}]`,
      ],
    ])(
      "%s, %s: the rule reads inside a list",
      (patternType: string, action: string, text: string, scrubbed: string) => {
        expect(
          scrubAttributes({ list: [[text], { "list.inner": text }] }, [
            { patternType: patternType, action: action },
          ]),
        ).toEqual({ list: [[scrubbed], { "list.inner": scrubbed }] });
      },
    );

    test("a custom pattern reads inside a list", () => {
      expect(
        scrubAttributes(
          { "deploy.args": ["--key", "SECRET-ABC123", "run SECRET-X9 now", 5] },
          [{ patternType: "custom", customRegex: "SECRET-[A-Z0-9]+" }],
        ),
      ).toEqual({
        "deploy.args": ["--key", "[REDACTED]", "run [REDACTED] now", 5],
      });
    });

    test("Sensitive Attribute Keys hides each text of a list or map under a key that names a secret - numbers and true or false kept", () => {
      expect(
        scrubAttributes(
          {
            "http.request.header.authorization": ["Bearer abc.def"],
            "http.request.header.cookie": ["session=1", "theme=dark"],
            "http.request.header.accept": ["text/html"],
            // Keys are read, not values: a pattern rule finds this one.
            "process.command_args": ["node", "app.js", "--password", "x"],
            "gen_ai.usage.input_tokens": 120,
            "auth.token.valid": true,
            "db.connections": [
              {
                "db.connections.host": "db1",
                "db.connections.password": "pw1",
              },
            ],
            // A scope's attributes, kept as OTLP sent them.
            "scope.attributes": [
              { key: "api_key", value: { stringValue: "k-123" } },
              { key: "library", value: { stringValue: "otel" } },
            ],
          },
          [SENSITIVE_KEYS],
        ),
      ).toEqual({
        "http.request.header.authorization": ["[REDACTED]"],
        "http.request.header.cookie": ["[REDACTED]", "[REDACTED]"],
        "http.request.header.accept": ["text/html"],
        "process.command_args": ["node", "app.js", "--password", "x"],
        "gen_ai.usage.input_tokens": 120,
        "auth.token.valid": true,
        "db.connections": [
          {
            "db.connections.host": "db1",
            "db.connections.password": "[REDACTED]",
          },
        ],
        "scope.attributes": [
          { key: "api_key", value: { stringValue: "[REDACTED]" } },
          { key: "library", value: { stringValue: "otel" } },
        ],
      });
    });

    test("Mask and Hash under a sensitive key act on each text of the list", () => {
      expect(
        scrubAttributes(
          { "http.request.header.authorization": ["Bearer abc.def", "ab"] },
          [{ patternType: "sensitiveKeys", action: "mask" }],
        ),
      ).toEqual({
        "http.request.header.authorization": ["B************f", "***"],
      });
      expect(
        scrubAttributes({ "http.request.header.cookie": ["a=1", "b=2"] }, [
          { patternType: "sensitiveKeys", action: "hash" },
        ]),
      ).toEqual({
        "http.request.header.cookie": [
          `[HASHED:${sha8("a=1")}]`,
          `[HASHED:${sha8("b=2")}]`,
        ],
      });
    });

    test("a rule that changes nothing leaves each list the very list it was", () => {
      const tags: Array<string> = ["a", "b"];
      const scrubbed: JSONObject = scrubAttributes({ tags: tags }, [
        EMAIL_MASK,
        SENSITIVE_KEYS,
      ]);

      expect(scrubbed["tags"]).toBe(tags);
    });

    test("a list a resource shares with every record under it stays as it arrived, each record scrubbed", () => {
      const owners: unknown = deepFreeze([
        "ada@example.com",
        ["bob@example.org"],
      ]);
      const headers: unknown = deepFreeze(["Bearer abc"]);

      for (let record: number = 0; record < 3; record++) {
        expect(
          scrubAttributes(
            {
              "resource.owners": owners as JSONObject,
              "resource.header.authorization": headers as JSONObject,
            },
            [EMAIL_MASK, SENSITIVE_KEYS],
          ),
        ).toEqual({
          "resource.owners": ["a***@***.com", ["b***@***.org"]],
          "resource.header.authorization": ["[REDACTED]"],
        });
      }

      expect(owners).toEqual(["ada@example.com", ["bob@example.org"]]);
      expect(headers).toEqual(["Bearer abc"]);
    });

    test(`a value nested deeper than ${SCRUB_MAX_VALUE_DEPTH} lists is held as its JSON text, and masked as text`, () => {
      const scrubbed: JSONObject = scrubAttributes(
        {
          fits: nest("ada@example.com", SCRUB_MAX_VALUE_DEPTH) as JSONObject,
          deep: nest(
            "ada@example.com",
            SCRUB_MAX_VALUE_DEPTH + 8,
          ) as JSONObject,
        },
        [EMAIL_MASK],
      );

      expect(unnest(scrubbed["fits"], SCRUB_MAX_VALUE_DEPTH)).toBe(
        "a***@***.com",
      );
      expect(scrubbed["deep"]).toBe(
        JSON.stringify(nest("a***@***.com", SCRUB_MAX_VALUE_DEPTH + 8)),
      );
    });

    test(`past ${SCRUB_MAX_NESTED_VALUES_PER_RECORD} values in a record's lists and maps, the values past it are held as text, and masked as text`, () => {
      const first: Array<string> = new Array<string>(
        SCRUB_MAX_NESTED_VALUES_PER_RECORD,
      ).fill("x");
      const scrubbed: JSONObject = scrubAttributes(
        {
          first: first,
          second: ["ada@example.com", 1],
          huge: new Array<string>(SCRUB_MAX_NESTED_VALUES_PER_RECORD * 3).fill(
            "bob@example.org",
          ),
        },
        [EMAIL_MASK],
      );

      expect(scrubbed["first"]).toBe(first);
      expect(scrubbed["second"]).toBe('["a***@***.com",1]');
      expect(scrubbed["huge"]).toBe(
        JSON.stringify(
          new Array<string>(SCRUB_MAX_NESTED_VALUES_PER_RECORD * 3).fill(
            "b***@***.org",
          ),
        ),
      );
    });

    test("a hostile record meets every kind of rule in time in line with its size, each value still scrubbed", () => {
      const LIMIT_IN_MS: number = 2000;
      // Every pattern, a custom one and a keys rule, as a project can hold them.
      const everyRule: Array<RuleSpec> = [
        EMAIL_MASK,
        { patternType: "creditCard", action: "mask" },
        { patternType: "ssn", action: "mask" },
        { patternType: "phoneNumber", action: "mask" },
        { patternType: "ipAddress", action: "mask" },
        { patternType: "custom", customRegex: "SECRET-[A-Z0-9]+" },
        SENSITIVE_KEYS,
      ];

      const run: FastestRun<JSONObject> = fastestRun({
        run: (): JSONObject => {
          // Made again for each attempt: the services write into it.
          const attributes: JSONObject = {
            deep: nest("ada@example.com", 50_000) as JSONObject,
            wide: new Array<string>(100_000).fill("ada@example.com"),
          };

          // A hundred lists of a hundred fill the record's allowance.
          for (let index: number = 0; index < 300; index++) {
            attributes[`list${index}`] = new Array<string>(100).fill(
              "SECRET-X1 from 10.0.0.1",
            );
          }

          return scrubAttributes(attributes, everyRule);
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(run.inMs).toBeLessThan(LIMIT_IN_MS);
      expect(run.result["deep"]).toBe(
        JSON.stringify(nest("a***@***.com", 50_000)),
      );
      expect(run.result["wide"]).toBe(
        JSON.stringify(new Array<string>(100_000).fill("a***@***.com")),
      );
      expect(run.result["list99"]).toEqual(
        new Array<string>(100).fill("[REDACTED] from ***.***.***.***"),
      );
      expect(run.result["list100"]).toBe(
        JSON.stringify(
          new Array<string>(100).fill("[REDACTED] from ***.***.***.***"),
        ),
      );
    });

    test("Sensitive Attribute Keys hides a held value whole when it names a secret anywhere, and keeps one that names none", () => {
      expect(
        scrubAttributes(
          {
            deepSecret: nest(
              { password: "pw" },
              SCRUB_MAX_VALUE_DEPTH + 2,
            ) as JSONObject,
            deepPlain: nest(
              { user: "u" },
              SCRUB_MAX_VALUE_DEPTH + 2,
            ) as JSONObject,
            arrivedAsText: "my password is safe with me",
          },
          [SENSITIVE_KEYS],
        ),
      ).toEqual({
        deepSecret: "[REDACTED]",
        deepPlain: JSON.stringify(
          nest({ user: "u" }, SCRUB_MAX_VALUE_DEPTH + 2),
        ),
        arrivedAsText: "my password is safe with me",
      });
    });
  },
);

describe("a project's pattern work allowance, inside lists", () => {
  function logCustom(pattern: string): Array<CompiledRule> {
    return logRules([{ patternType: "custom", customRegex: pattern }]);
  }

  test("once the batch's allowance is spent, a custom rule scrubs each text of a list whole - its shape and numbers kept", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 0,
    });
    allowance.charge(1);

    const row: JSONObject = PatternWorkScope.run(allowance, (): JSONObject => {
      return LogScrubRuleService.scrubLog(
        {
          body: "",
          attributes: { "deploy.args": ["--key", "SECRET-ABC", 3, ["x"]] },
        },
        logCustom("SECRET-[A-Z]+") as never,
      );
    });

    expect((row["attributes"] as JSONObject)["deploy.args"]).toEqual([
      "[REDACTED]",
      "[REDACTED]",
      3,
      ["[REDACTED]"],
    ]);
  });

  test("with no pool at all, the texts inside each record's lists add their share: a custom rule masks every one of them exactly", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 0,
      workPerRecordText: 2048,
      workPerRecordCharacter: 128,
    });
    const rules: Array<CompiledRule> = logCustom("token=\\w+");

    const rows: Array<JSONObject> = PatternWorkScope.run(
      allowance,
      (): Array<JSONObject> => {
        const scrubbed: Array<JSONObject> = [];

        for (let index: number = 0; index < 300; index++) {
          scrubbed.push(
            LogScrubRuleService.scrubLog(
              {
                body: "",
                attributes: {
                  "http.request.header.x_debug": [
                    `token=abc${index} ok`,
                    [`and token=def${index}`],
                  ],
                },
              },
              rules as never,
            ),
          );
        }

        return scrubbed;
      },
    );

    for (const row of rows) {
      expect(
        (row["attributes"] as JSONObject)["http.request.header.x_debug"],
      ).toEqual(["[REDACTED] ok", ["and [REDACTED]"]]);
    }

    expect(allowance.stoppedQuestions).toBe(0);
  });

  test("a long text as deep inside a span's event or link value as a rule reads adds its share too: a custom rule masks it exactly", () => {
    const allowance: PatternWorkAllowance = new PatternWorkAllowance({
      pool: 0,
      workPerRecordText: 2048,
      workPerRecordCharacter: 128,
    });
    const rules: Array<CompiledRule> = traceRules([
      { patternType: "custom", customRegex: "token=\\w+" },
    ]);
    // Longer than the grant of the span's own short texts covers.
    const filler: string = "x".repeat(3000);
    const deepest: (index: number) => JSONObject = (
      index: number,
    ): JSONObject => {
      return nest(
        `${filler} token=abc${index} ok`,
        SCRUB_MAX_VALUE_DEPTH,
      ) as JSONObject;
    };

    const rows: Array<JSONObject> = PatternWorkScope.run(
      allowance,
      (): Array<JSONObject> => {
        const scrubbed: Array<JSONObject> = [];

        for (let index: number = 0; index < 20; index++) {
          scrubbed.push(
            TraceScrubRuleService.scrubSpan(
              {
                name: "",
                attributes: {},
                events: [{ name: "e", attributes: { value: deepest(index) } }],
                links: [{ attributes: { value: deepest(index) } }],
              },
              rules as never,
            ),
          );
        }

        return scrubbed;
      },
    );

    for (const row of rows) {
      for (const part of ["events", "links"]) {
        const value: unknown = (
          (row[part] as Array<JSONObject>)[0]!["attributes"] as JSONObject
        )["value"];

        expect(unnest(value, SCRUB_MAX_VALUE_DEPTH)).toBe(
          `${filler} [REDACTED] ok`,
        );
      }
    }

    expect(allowance.stoppedQuestions).toBe(0);
  });
});

describe("LogScrubRuleService: a log's body and its fields to scrub", () => {
  test("a rule scoped to the body leaves attribute lists alone; one scoped to attributes masks them", () => {
    const record: () => JSONObject = (): JSONObject => {
      return {
        body: "from ada@example.com",
        attributes: { "user.emails": ["ada@example.com"] },
      };
    };

    const bodyOnly: JSONObject = LogScrubRuleService.scrubLog(
      record(),
      logRules([{ ...EMAIL_MASK, fields: LogScrubField.Body }]) as never,
    );

    expect(bodyOnly["body"]).toBe("from a***@***.com");
    expect(bodyOnly["attributes"]).toEqual({
      "user.emails": ["ada@example.com"],
    });

    const attributesOnly: JSONObject = LogScrubRuleService.scrubLog(
      record(),
      logRules([{ ...EMAIL_MASK, fields: LogScrubField.Attributes }]) as never,
    );

    expect(attributesOnly["body"]).toBe("from ada@example.com");
    expect(attributesOnly["attributes"]).toEqual({
      "user.emails": ["a***@***.com"],
    });
  });

  test("a Sensitive Attribute Keys rule saved for the body still reads the keys inside attribute values", () => {
    const row: JSONObject = LogScrubRuleService.scrubLog(
      {
        body: "",
        attributes: { "http.request.header.authorization": ["Bearer abc"] },
      },
      logRules([{ ...SENSITIVE_KEYS, fields: LogScrubField.Body }]) as never,
    );

    expect(row["attributes"]).toEqual({
      "http.request.header.authorization": ["[REDACTED]"],
    });
  });

  test("a body that arrived as a map or a list is its JSON text: a pattern rule masks inside it, a keys rule does not read it", () => {
    // What logs ingest stores for a kvlistValue body.
    const body: string = JSON.stringify({
      kvlistValue: {
        values: [
          { key: "email", value: { stringValue: "ada@example.com" } },
          { key: "password", value: { stringValue: "pw" } },
        ],
      },
    });

    const row: JSONObject = LogScrubRuleService.scrubLog(
      { body: body, attributes: {} },
      logRules([EMAIL_MASK, SENSITIVE_KEYS]) as never,
    );

    expect(row["body"]).toBe(body.replace("ada@example.com", "a***@***.com"));
  });
});

describe("TraceScrubRuleService: a span's events and links", () => {
  function span(): JSONObject {
    return {
      name: "GET ada@example.com",
      attributes: { "user.emails": ["ada@example.com"] },
      events: [
        {
          name: "retry",
          attributes: { "event.emails": ["ada@example.com"] },
        },
      ],
      links: [
        {
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "00f067aa0ba902b7",
          attributes: {
            "link.emails": ["ada@example.com"],
            "link.owner": "ada@example.com",
          },
        },
      ],
    };
  }

  interface Scrubbed {
    name: unknown;
    attributes: unknown;
    events: unknown;
    links: unknown;
  }

  function scrubbedParts(fields: string): Scrubbed {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      span(),
      traceRules([{ ...EMAIL_MASK, fields: fields }]) as never,
    );

    return {
      name: row["name"],
      attributes: (row["attributes"] as JSONObject)["user.emails"],
      events: (
        (row["events"] as Array<JSONObject>)[0]!["attributes"] as JSONObject
      )["event.emails"],
      links: (row["links"] as Array<JSONObject>)[0]!["attributes"],
    };
  }

  const MASKED_LINK: JSONObject = {
    "link.emails": ["a***@***.com"],
    "link.owner": "a***@***.com",
  };
  const CLEAR_LINK: JSONObject = {
    "link.emails": ["ada@example.com"],
    "link.owner": "ada@example.com",
  };

  test("a link's attributes are scrubbed by the rules that scrub the span's attributes: Attributes and All", () => {
    expect(scrubbedParts(TraceScrubField.Attributes)).toEqual({
      name: "GET ada@example.com",
      attributes: ["a***@***.com"],
      events: ["ada@example.com"],
      links: MASKED_LINK,
    });
    expect(scrubbedParts(TraceScrubField.All)).toEqual({
      name: "GET a***@***.com",
      attributes: ["a***@***.com"],
      events: ["a***@***.com"],
      links: MASKED_LINK,
    });
  });

  test("never by a rule for the name or the events alone", () => {
    expect(scrubbedParts(TraceScrubField.Name)).toEqual({
      name: "GET a***@***.com",
      attributes: ["ada@example.com"],
      events: ["ada@example.com"],
      links: CLEAR_LINK,
    });
    expect(scrubbedParts(TraceScrubField.Events)).toEqual({
      name: "GET ada@example.com",
      attributes: ["ada@example.com"],
      events: ["a***@***.com"],
      links: CLEAR_LINK,
    });
  });

  test("Sensitive Attribute Keys hides a link's secret attributes, whatever fields the rule was saved with", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "consume",
        attributes: {},
        events: [],
        links: [
          {
            attributes: {
              "auth.token": ["t-1", "t-2"],
              "link.reason": "retry-of",
              "messaging.headers": [
                { "messaging.headers.authorization": "Bearer x" },
              ],
            },
          },
        ],
      },
      traceRules([
        { ...SENSITIVE_KEYS, fields: TraceScrubField.Name },
      ]) as never,
    );

    expect((row["links"] as Array<JSONObject>)[0]!["attributes"]).toEqual({
      "auth.token": ["[REDACTED]", "[REDACTED]"],
      "link.reason": "retry-of",
      "messaging.headers": [
        { "messaging.headers.authorization": "[REDACTED]" },
      ],
    });
  });

  test("a span's events and links share the record's allowance: what lies past it is held as text", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "batch",
        attributes: { list: new Array<number>(6_000).fill(1) },
        events: [{ name: "e", attributes: { list: ["ada@example.com"] } }],
        links: [
          {
            attributes: {
              list: new Array<string>(4_000).fill("ada@example.com"),
            },
          },
        ],
      },
      traceRules([EMAIL_MASK]) as never,
    );

    // 6,000 + 1 values fit; the link's 4,000 would take the span past it.
    expect(Array.isArray((row["attributes"] as JSONObject)["list"])).toBe(true);
    expect(
      ((row["events"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
        "list"
      ],
    ).toEqual(["a***@***.com"]);
    expect(
      ((row["links"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
        "list"
      ],
    ).toBe(JSON.stringify(new Array<string>(4_000).fill("a***@***.com")));
  });

  test("an exception's attributes: a list masked in the copy, what the span event holds left for the span's own pass", () => {
    const details: Array<unknown> = [
      "ada@example.com",
      { "x.email": "bob@example.org" },
    ];
    const attributes: JSONObject = {
      "exception.details": details as JSONArray,
      "http.request.header.cookie": ["a=1"],
    };

    const scrubbed: {
      message: string;
      stackTrace: string;
      attributes: JSONObject;
    } = TraceScrubRuleService.scrubExceptionContent(
      {
        message: "failed for ada@example.com",
        stackTrace: "at handler",
        attributes: attributes,
      },
      traceRules([EMAIL_MASK, SENSITIVE_KEYS]) as never,
    );

    expect(scrubbed).toEqual({
      message: "failed for a***@***.com",
      stackTrace: "at handler",
      attributes: {
        "exception.details": ["a***@***.com", { "x.email": "b***@***.org" }],
        "http.request.header.cookie": ["[REDACTED]"],
      },
    });
    expect(attributes["exception.details"]).toBe(details);
    expect(details).toEqual([
      "ada@example.com",
      { "x.email": "bob@example.org" },
    ]);
  });

  test("an exception's value too deep for the rules is held as its JSON text, as the span event's is", () => {
    const deep: unknown = nest("ada@example.com", SCRUB_MAX_VALUE_DEPTH + 4);
    const rules: Array<CompiledRule> = traceRules([EMAIL_MASK]);
    const expected: string = JSON.stringify(
      nest("a***@***.com", SCRUB_MAX_VALUE_DEPTH + 4),
    );

    const exception: {
      message: string;
      stackTrace: string;
      attributes: JSONObject;
    } = TraceScrubRuleService.scrubExceptionContent(
      { message: "", stackTrace: "", attributes: { deep: deep as JSONObject } },
      rules as never,
    );
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "",
        attributes: {},
        events: [
          { name: "exception", attributes: { deep: deep as JSONObject } },
        ],
        links: [],
      },
      rules as never,
    );

    expect(exception.attributes["deep"]).toBe(expected);
    expect(
      ((row["events"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
        "deep"
      ],
    ).toBe(expected);
  });
});
