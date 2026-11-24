import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService, {
  ExceptionContent,
} from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import LogScrubField from "Common/Types/Log/LogScrubField";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import {
  SCRUB_MAX_NESTED_VALUES_PER_RECORD,
  SCRUB_MAX_VALUE_DEPTH,
} from "Common/Utils/Telemetry/ScrubNestedValues";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHAT THE SCRUB RULES DID NOT READ (#6513, a follow-up of #6397).
 *
 * Three texts reached storage past rules meant to remove them:
 *
 *   - a log body sent as a map or a list is stored as its JSON text, which a
 *     Sensitive Attribute Keys rule never read, so a password under a key
 *     inside it was stored as sent;
 *   - no trace rule read a span's status message, nor an event's name, so
 *     an address or a token repeated there was stored as sent;
 *   - an exception's type, copied out of its span event's exception.type,
 *     was stored as it came, where the span's own copy was scrubbed.
 *
 * Now a Sensitive Attribute Keys rule reads the keys of a body that is a
 * map or a list, within the record's bounds, and keeps the body's form; All
 * reaches a span's status message and its events' names; and the rules that
 * scrub a span's events scrub the exception's type. Rules are compiled with
 * each service's real getRegexForPattern. Real OTLP payloads on each route
 * are in OtelLogsScrubNestedValues and OtelTracesScrubNestedValues, and
 * the stored rows in ScrubMoreFieldsClickhouse.
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
  "0193b0a1-0000-7000-8000-000000a10394",
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

const SENSITIVE_KEYS: RuleSpec = { patternType: "sensitiveKeys" };
const EMAIL_MASK: RuleSpec = { patternType: "email", action: "mask" };

const EMAIL: string = "ada.lovelace@example.com";
const EMAIL_MASKED: string = "a***@***.com";

// What a Hash rule of PROJECT_ID leaves of a text (#10394).
function token(text: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: text });
}

// The body a log is stored with, after the rules.
function scrubbedBody(body: string, specs: Array<RuleSpec>): string {
  return LogScrubRuleService.scrubLog(
    { body: body, attributes: {} },
    logRules(specs),
  )["body"] as string;
}

/*
 * A body as OTLP sends a key-value list (`kvlistValue`), a list
 * (`arrayValue`) and a text, and as ingest stores a map or a list body: its
 * JSON text (OtelLogsIngestService).
 */
function pairs(entries: Array<[string, JSONObject]>): JSONArray {
  return entries.map(([key, value]: [string, JSONObject]): JSONObject => {
    return { key: key, value: value };
  });
}

function kv(entries: Array<[string, JSONObject]>): JSONObject {
  return { kvlistValue: { values: pairs(entries) } };
}

function arr(...values: Array<JSONObject>): JSONObject {
  return { arrayValue: { values: values } };
}

function str(value: string): JSONObject {
  return { stringValue: value };
}

function stored(body: JSONObject): string {
  return JSON.stringify(body);
}

describe("a log body sent as a map or a list: a Sensitive Attribute Keys rule reads its keys", () => {
  const BODY: JSONObject = kv([
    ["message", str(`login by ${EMAIL}`)],
    ["password", str("pw-3")],
    ["retries", { intValue: "2" }],
    ["db", kv([["db.connection_token", str("conn-tok-1")]])],
    ["codes", arr({ intValue: "1" }, str("plain"))],
  ]);

  test("the value under a secret key is hidden, its pair's key and every other value kept", () => {
    expect(scrubbedBody(stored(BODY), [SENSITIVE_KEYS])).toBe(
      stored(
        kv([
          ["message", str(`login by ${EMAIL}`)],
          ["password", str("[REDACTED]")],
          ["retries", { intValue: "2" }],
          ["db", kv([["db.connection_token", str("[REDACTED]")]])],
          ["codes", arr({ intValue: "1" }, str("plain"))],
        ]),
      ),
    );
  });

  test.each([
    ["redact", "[REDACTED]"],
    ["mask", "p***3"],
    ["hash", token("pw-3")],
  ])(
    "%s writes what it writes for an attribute",
    (action: string, hidden: string) => {
      const body: string = stored(kv([["password", str("pw-3")]]));

      expect(
        scrubbedBody(body, [{ patternType: "sensitiveKeys", action: action }]),
      ).toBe(stored(kv([["password", str(hidden)]])));
      expect(
        (
          LogScrubRuleService.scrubLog(
            { body: "", attributes: { password: "pw-3" } },
            logRules([{ patternType: "sensitiveKeys", action: action }]),
          )["attributes"] as JSONObject
        )["password"],
      ).toBe(hidden);
    },
  );

  test("a body sent as a list: the values under a secret key in each map in it", () => {
    const body: JSONObject = arr(
      kv([
        ["user", str("ada")],
        ["api_key", str("key-1")],
      ]),
      str("a text in a list holds no key"),
    );

    expect(scrubbedBody(stored(body), [SENSITIVE_KEYS])).toBe(
      stored(
        arr(
          kv([
            ["user", str("ada")],
            ["api_key", str("[REDACTED]")],
          ]),
          str("a text in a list holds no key"),
        ),
      ),
    );
  });

  test("the field gRPC adds to name a value's kind is text under the secret too, as in a scope's pairs", () => {
    const body: JSONObject = {
      kvlistValue: {
        values: [
          {
            key: "session_token",
            value: { stringValue: "s-1", value: "stringValue" },
          },
        ],
      },
      value: "kvlistValue",
    };

    expect(scrubbedBody(stored(body), [SENSITIVE_KEYS])).toBe(
      stored({
        kvlistValue: {
          values: [
            {
              key: "session_token",
              value: { stringValue: "[REDACTED]", value: "[REDACTED]" },
            },
          ],
        },
        value: "kvlistValue",
      }),
    );
  });

  test("a body that names no secret is the very text it was, and so is plain text", () => {
    const plainMap: string = stored(
      kv([
        ["message", str("nothing to hide")],
        ["count", { intValue: "3" }],
      ]),
    );

    expect(scrubbedBody(plainMap, [SENSITIVE_KEYS])).toBe(plainMap);
    // A text body is text: a pattern rule's to read, not a keys rule's.
    expect(scrubbedBody("password=hunter2 token=t-1", [SENSITIVE_KEYS])).toBe(
      "password=hunter2 token=t-1",
    );
    // Text that only looks like JSON is text too.
    expect(scrubbedBody('{"password": "unterminated', [SENSITIVE_KEYS])).toBe(
      '{"password": "unterminated',
    );
  });

  test("a body written as JSON - a Fluentd record, a JSON line - is read the same way", () => {
    expect(
      scrubbedBody(
        '{"level":"info","msg":"login","password":"hunter2","user":{"auth_token":"t-9","id":7}}',
        [SENSITIVE_KEYS],
      ),
    ).toBe(
      '{"level":"info","msg":"login","password":"[REDACTED]","user":{"auth_token":"[REDACTED]","id":7}}',
    );
    // Written with spaces: kept as it is when nothing is hidden...
    expect(
      scrubbedBody('{ "level": "info", "msg": "login" }', [SENSITIVE_KEYS]),
    ).toBe('{ "level": "info", "msg": "login" }');
    // ...and when a secret is hidden: only the secret changes (#8993).
    expect(
      scrubbedBody('{ "msg": "login", "password": "hunter2" }', [
        SENSITIVE_KEYS,
      ]),
    ).toBe('{ "msg": "login", "password": "[REDACTED]" }');
  });

  test("a key written with an escape is read as the key it is, and stays written so", () => {
    expect(
      scrubbedBody('{"pass\\u0077ord":"hunter2","note":"a\\nb"}', [
        SENSITIVE_KEYS,
      ]),
    ).toBe('{"pass\\u0077ord":"[REDACTED]","note":"a\\nb"}');
  });

  test("the numbers, spaces and keys of a body it hides a secret in stay as they were written (#8993)", () => {
    const body: string =
      '{\n  "user_id": 12345678901234567890,\n  "amount": 1.50,\n  "10": "ten",\n  "2": "two",\n  "password": "a",\n  "password": "b"\n}';

    // Parsed and written again, the id lost digits, 1.50 became 1.5, "2" moved and one password was dropped.
    expect(scrubbedBody(body, [SENSITIVE_KEYS])).toBe(
      body.split('"a"').join('"[REDACTED]"').split('"b"').join('"[REDACTED]"'),
    );
  });

  test("a rule saved with a body-only scope still reads the body's keys", () => {
    expect(
      scrubbedBody(stored(kv([["password", str("pw-3")]])), [
        { patternType: "sensitiveKeys", fields: LogScrubField.Body },
      ]),
    ).toBe(stored(kv([["password", str("[REDACTED]")]])));
  });

  test("the keys are read whatever the order of the list, and an address after an escape leaves the body JSON (#8923)", () => {
    const body: string = stored(
      kv([
        ["message", str(`line one\n${EMAIL}`)],
        ["password", str("pw-3")],
      ]),
    );
    /*
     * The Email rule alone. Its match used to take the escape's letter
     * with it - `n` + the address - and leave `\[REDACTED]`, which is not
     * JSON. The address is matched as written, after the line break.
     */
    const emailOnly: string = scrubbedBody(body, [
      { patternType: "email", action: "redact" },
    ]);

    expect(emailOnly).toBe(
      stored(
        kv([
          ["message", str("line one\n[REDACTED]")],
          ["password", str("pw-3")],
        ]),
      ),
    );

    const both: string = scrubbedBody(body, [
      { patternType: "email", action: "redact" },
      SENSITIVE_KEYS,
    ]);

    expect(JSON.parse(both)).toEqual(
      kv([
        ["message", str("line one\n[REDACTED]")],
        ["password", str("[REDACTED]")],
      ]),
    );
  });

  test("a pattern rule still reads the body as its text, and masks inside it", () => {
    expect(scrubbedBody(stored(BODY), [EMAIL_MASK, SENSITIVE_KEYS])).toBe(
      stored(
        kv([
          ["message", str(`login by ${EMAIL_MASKED}`)],
          ["password", str("[REDACTED]")],
          ["retries", { intValue: "2" }],
          ["db", kv([["db.connection_token", str("[REDACTED]")]])],
          ["codes", arr({ intValue: "1" }, str("plain"))],
        ]),
      ),
    );
  });

  test("each Sensitive Attribute Keys rule reads it, in the order of the list", () => {
    expect(
      scrubbedBody(stored(kv([["password", str("pw-3")]])), [
        { patternType: "sensitiveKeys", action: "redact" },
        { patternType: "sensitiveKeys", action: "hash" },
      ]),
    ).toBe(stored(kv([["password", str(token("[REDACTED]"))]])));
  });

  test("a log without a Sensitive Attribute Keys rule keeps its body as the pattern rules leave it", () => {
    const body: string = stored(kv([["password", str("pw-3")]]));

    expect(scrubbedBody(body, [EMAIL_MASK])).toBe(body);
  });
});

describe("a structured body is read within the record's bounds", () => {
  // `inner` inside `levels` OTLP key-value lists, each under the key `f`.
  function deepKv(inner: JSONObject, levels: number): JSONObject {
    let value: JSONObject = inner;

    for (let level: number = 0; level < levels; level++) {
      value = kv([["f", value]]);
    }

    return value;
  }

  test(`a part nested past ${SCRUB_MAX_VALUE_DEPTH} levels is hidden whole when it names a secret, and the rest of the body is kept`, () => {
    // A Kubernetes object: its managed fields run deep, its spec does not.
    const body: JSONObject = kv([
      ["kind", str("Pod")],
      ["metadata", kv([["name", str("checkout-1")]])],
      [
        "spec",
        kv([
          ["serviceAccountToken", kv([["path", str("token")]])],
          ["image", str("checkout:1.4.0")],
        ]),
      ],
      ["managedFields", deepKv(kv([["f:secretKeyRef", kv([])]]), 10)],
      ["deepPlain", deepKv(kv([["f:image", kv([])]]), 10)],
    ]);
    const scrubbed: JSONObject = JSON.parse(
      scrubbedBody(stored(body), [SENSITIVE_KEYS]),
    ) as JSONObject;
    const entries: Record<string, unknown> = {};

    for (const pair of (scrubbed["kvlistValue"] as JSONObject)[
      "values"
    ] as Array<JSONObject>) {
      entries[pair["key"] as string] = pair["value"];
    }

    // Read key by key: the token's texts hidden, everything else as it was.
    expect(entries["kind"]).toEqual(str("Pod"));
    expect(entries["metadata"]).toEqual(kv([["name", str("checkout-1")]]));
    expect(JSON.stringify(entries["spec"])).toContain("checkout:1.4.0");
    expect(JSON.stringify(entries["spec"])).not.toContain('"token"');
    // Past the bound and naming no secret: kept as the map it is.
    expect(entries["deepPlain"]).toEqual(deepKv(kv([["f:image", kv([])]]), 10));
    // Past the bound and naming one: the part at the bound hidden whole.
    expect(JSON.stringify(entries["managedFields"])).not.toContain(
      "secretKeyRef",
    );
    expect(JSON.stringify(entries["managedFields"])).toContain("[REDACTED]");
  });

  test(`the body shares the record's ${SCRUB_MAX_NESTED_VALUES_PER_RECORD} values with its attributes, after them`, () => {
    const body: string = JSON.stringify({
      first: { password: "pw-1" },
      second: { token: "t-2" },
      third: ["the secret token is t-3", "x"],
    });
    const attributes: JSONObject = {
      // Leaves the body 4 values: its 3 entries and "first"'s 1.
      big: new Array<string>(SCRUB_MAX_NESTED_VALUES_PER_RECORD - 4).fill("x"),
    };

    const row: JSONObject = LogScrubRuleService.scrubLog(
      { body: body, attributes: attributes },
      logRules([SENSITIVE_KEYS]),
    );

    expect(Array.isArray((row["attributes"] as JSONObject)["big"])).toBe(true);
    expect(JSON.parse(row["body"] as string)).toEqual({
      first: { password: "[REDACTED]" },
      // Past the allowance: read as text, which names a secret.
      second: "[REDACTED]",
      third: "[REDACTED]",
    });

    // With the record's whole allowance, each is read key by key.
    expect(JSON.parse(scrubbedBody(body, [SENSITIVE_KEYS]))).toEqual({
      first: { password: "[REDACTED]" },
      second: { token: "[REDACTED]" },
      third: ["the secret token is t-3", "x"],
    });
  });
});

describe("a span's status message and its events' names: All reaches them", () => {
  function span(): JSONObject {
    return {
      name: "POST /checkout",
      statusMessage: `card declined for ${EMAIL}`,
      attributes: { "user.email": EMAIL },
      events: [
        {
          name: `retrying for ${EMAIL}`,
          attributes: { "retry.owner": EMAIL },
        },
      ],
      links: [],
    };
  }

  function scrubbed(fields: string, specs?: Array<RuleSpec>): JSONObject {
    return TraceScrubRuleService.scrubSpan(
      span(),
      traceRules(
        specs || [{ patternType: "email", action: "mask", fields: fields }],
      ),
    );
  }

  function eventName(row: JSONObject): unknown {
    return (row["events"] as Array<JSONObject>)[0]!["name"];
  }

  test("All scrubs the status message and the event names", () => {
    const row: JSONObject = scrubbed(TraceScrubField.All);

    expect(row["statusMessage"]).toBe(`card declined for ${EMAIL_MASKED}`);
    expect(eventName(row)).toBe(`retrying for ${EMAIL_MASKED}`);
    expect(JSON.stringify(row)).not.toContain(EMAIL);
  });

  test("a rule left without fields scrubs them, as All", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      span(),
      traceRules([{ patternType: "email", action: "mask" }]),
    );

    expect(row["statusMessage"]).toBe(`card declined for ${EMAIL_MASKED}`);
    expect(eventName(row)).toBe(`retrying for ${EMAIL_MASKED}`);
  });

  test.each([
    [TraceScrubField.Name, "the span's name"],
    [TraceScrubField.Attributes, "the attributes"],
    [TraceScrubField.Events, "the events' attributes"],
  ])("a rule for %s alone leaves them: it reads %s", (fields: string) => {
    const row: JSONObject = scrubbed(fields);

    expect(row["statusMessage"]).toBe(`card declined for ${EMAIL}`);
    expect(eventName(row)).toBe(`retrying for ${EMAIL}`);
  });

  test("Event Attributes Only still scrubs the events' attributes, and nothing else of the event", () => {
    const row: JSONObject = scrubbed(TraceScrubField.Events);
    const event: JSONObject = (row["events"] as Array<JSONObject>)[0]!;

    expect((event["attributes"] as JSONObject)["retry.owner"]).toBe(
      EMAIL_MASKED,
    );
    expect(event["name"]).toBe(`retrying for ${EMAIL}`);
  });

  test("a custom pattern and every action reach the status message", () => {
    const custom: JSONObject = scrubbed(TraceScrubField.All, [
      {
        patternType: "custom",
        customRegex: "card [a-z]+",
        action: "redact",
        fields: TraceScrubField.All,
      },
    ]);

    expect(custom["statusMessage"]).toBe(`[REDACTED] for ${EMAIL}`);

    const hashed: JSONObject = scrubbed(TraceScrubField.All, [
      { patternType: "email", action: "hash", fields: TraceScrubField.All },
    ]);

    expect(hashed["statusMessage"]).toBe(`card declined for ${token(EMAIL)}`);
  });

  test("a Sensitive Attribute Keys rule reads no free text: the status message and event names stay", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "login",
        statusMessage: "password rejected",
        attributes: { password: "pw" },
        events: [{ name: "token refresh", attributes: { token: "t" } }],
        links: [],
      },
      traceRules([SENSITIVE_KEYS]),
    );

    expect(row["statusMessage"]).toBe("password rejected");
    expect(eventName(row)).toBe("token refresh");
    expect((row["attributes"] as JSONObject)["password"]).toBe("[REDACTED]");
    expect(
      ((row["events"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
        "token"
      ],
    ).toBe("[REDACTED]");
  });

  test("an empty or missing status message, and an event without a name, are left as they are", () => {
    const row: JSONObject = TraceScrubRuleService.scrubSpan(
      {
        name: "GET /",
        statusMessage: "",
        attributes: {},
        events: [{ attributes: { owner: EMAIL } }, null],
        links: [],
      },
      traceRules([EMAIL_MASK]),
    );

    expect(row["statusMessage"]).toBe("");
    expect((row["events"] as Array<JSONObject>)[0]!["name"]).toBeUndefined();
    expect(
      ((row["events"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
        "owner"
      ],
    ).toBe(EMAIL_MASKED);

    const noStatus: JSONObject = TraceScrubRuleService.scrubSpan(
      { name: "GET /", attributes: {}, events: [], links: [] },
      traceRules([EMAIL_MASK]),
    );

    expect("statusMessage" in noStatus).toBe(false);
  });

  test("a span without a status message asks no rule about one: most spans set none", () => {
    const rules: Array<CompiledRule> = traceRules([
      { patternType: "email", action: "mask" },
      { patternType: "custom", customRegex: "secret-[0-9]+", action: "redact" },
    ]) as unknown as Array<CompiledRule>;
    const asked: Array<string> = [];

    for (const compiled of rules) {
      const regex: ScrubRegExp = compiled.regex;

      compiled.regex = {
        source: regex.source,
        flags: regex.flags,
        test: (text: string): boolean => {
          asked.push(text);
          return regex.test(text);
        },
        replace: (
          text: string,
          replacer: (matchedText: string) => string,
        ): string => {
          asked.push(text);
          return regex.replace(text, replacer);
        },
        matchRanges: (text: string): Array<[number, number]> => {
          asked.push(text);
          return regex.matchRanges(text);
        },
      };
    }

    TraceScrubRuleService.scrubSpan(
      {
        name: "GET /",
        statusMessage: "",
        attributes: {},
        events: [],
        links: [],
      },
      rules as never,
    );

    // The name, once for each rule: never the empty status message.
    expect(asked).toEqual(["GET /", "GET /"]);
  });
});

describe("an exception's type is scrubbed with the rest of its content", () => {
  function content(): ExceptionContent {
    return {
      message: `declined for ${EMAIL}`,
      stackTrace: "at charge (pay.js:1)",
      exceptionType: `CardDeclined[${EMAIL}]`,
      attributes: { "exception.code": "402" },
    };
  }

  test.each([[TraceScrubField.All], [TraceScrubField.Events]])(
    "by a rule for %s, as the span event's exception.type is",
    (fields: string) => {
      const scrubbed: ExceptionContent =
        TraceScrubRuleService.scrubExceptionContent(
          content(),
          traceRules([
            { patternType: "email", action: "mask", fields: fields },
          ]),
        );

      expect(scrubbed.exceptionType).toBe(`CardDeclined[${EMAIL_MASKED}]`);
      expect(scrubbed.message).toBe(`declined for ${EMAIL_MASKED}`);
    },
  );

  test.each([[TraceScrubField.Name], [TraceScrubField.Attributes]])(
    "never by a rule for %s alone",
    (fields: string) => {
      const scrubbed: ExceptionContent =
        TraceScrubRuleService.scrubExceptionContent(
          content(),
          traceRules([
            { patternType: "email", action: "mask", fields: fields },
          ]),
        );

      expect(scrubbed).toEqual(content());
    },
  );

  test("a type that is not handed over is not made up", () => {
    const scrubbed: ExceptionContent =
      TraceScrubRuleService.scrubExceptionContent(
        {
          message: `declined for ${EMAIL}`,
          stackTrace: "",
          attributes: {},
        },
        traceRules([EMAIL_MASK]),
      );

    expect("exceptionType" in scrubbed).toBe(false);
    expect(scrubbed.message).toBe(`declined for ${EMAIL_MASKED}`);
  });

  test("a Sensitive Attribute Keys rule reads no free text: the type stays", () => {
    const scrubbed: ExceptionContent =
      TraceScrubRuleService.scrubExceptionContent(
        { ...content(), exceptionType: "TokenExpiredError" },
        traceRules([SENSITIVE_KEYS]),
      );

    expect(scrubbed.exceptionType).toBe("TokenExpiredError");
  });
});

describe("each Sensitive Attribute Keys rule reads a structured body within the same bounds", () => {
  test("a body that fits once is read key by key by every rule, not as text by the second", () => {
    // 1 entry, 3,000 contacts and 2 entries each: 9,001 values, which fit once.
    const contacts: Array<JSONObject> = [];

    for (let index: number = 0; index < 3_000; index++) {
      contacts.push({ email: `user${index}@example.com`, password: "pw" });
    }

    const body: JSONObject = JSON.parse(
      scrubbedBody(JSON.stringify({ contacts: contacts }), [
        { patternType: "sensitiveKeys", action: "redact" },
        { patternType: "sensitiveKeys", action: "hash" },
      ]),
    ) as JSONObject;
    const stored: Array<JSONObject> = body["contacts"] as Array<JSONObject>;

    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(3_000);
    expect(stored[2_999]).toEqual({
      email: "user2999@example.com",
      password: token("[REDACTED]"),
    });
  });
});
