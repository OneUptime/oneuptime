import ScrubJsonKeysUtil, {
  ScrubJsonKeysRule,
} from "../../../Utils/Telemetry/ScrubJsonKeys";
import {
  MAX_JSON_TEXTS_INSIDE_STRINGS,
  ScrubJsonTexts,
} from "../../../Utils/Telemetry/ScrubJsonText";
import ScrubNestedValuesUtil, {
  SCRUB_MAX_NESTED_VALUES_PER_RECORD,
  SCRUB_MAX_VALUE_DEPTH,
  ScrubNestedValuesAllowance,
} from "../../../Utils/Telemetry/ScrubNestedValues";
import { maskKeepingEnds } from "../../../Utils/Telemetry/ScrubMask";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { getJestSpyOn } from "../../Spy";
import { JSON_STYLES, JsonStyle, Random, seededRandom } from "./JsonTextCases";
import {
  expectedReading,
  isSensitiveKey,
  JSON_TEXTS_READ,
  KeysCaseOptions,
  marksIn,
  randomJsonText,
  readingOf,
  shapeDifference,
} from "./JsonKeysCases";
import crypto from "crypto";
import { isDeepStrictEqual } from "util";
import { describe, expect, test } from "@jest/globals";

/*
 * A SENSITIVE ATTRIBUTE KEYS RULE READS THE KEYS OF A JSON TEXT HELD IN A
 * STRING (#8993).
 *
 * An attribute whose value is a JSON text - `http.request.body` =
 * `{"password":"hunter2"}`, an AI call's messages - and a string inside a
 * body that is JSON of its own - a Fluentd/docker `log` field - were never
 * read key by key: the attribute's own key names no secret, and the
 * password was stored as sent. These tests hold ScrubJsonKeysUtil to its
 * module comment: the texts under a secret key are hidden, a JSON text in
 * a string is read the same way down to MAX_JSON_TEXTS_INSIDE_STRINGS, and
 * nothing else of the text changes - its numbers, spaces, escapes and keys
 * stay as they were written - within the record's bounds. The property
 * tests run over seeded random JSON texts held in strings (JsonKeysCases),
 * so a failure names its seed.
 */

const REDACTED: string = "[REDACTED]";

function redact(): string {
  return REDACTED;
}

function hash(text: string): string {
  return `[HASHED:${crypto.createHash("sha256").update(text).digest("hex").slice(0, 8)}]`;
}

// A replacement holding everything JSON must escape, a lone surrogate too.
function awkward(text: string): string {
  return `"\\\n\u0001}${text.slice(0, 1)}\ud800`;
}

function ruleOf(data: {
  hideText?: (text: string) => string;
  remaining?: number;
  jsonTexts?: ScrubJsonTexts;
}): ScrubJsonKeysRule {
  return {
    isSensitiveKey: isSensitiveKey,
    hideText: data.hideText || redact,
    allowance: {
      remaining:
        data.remaining === undefined
          ? SCRUB_MAX_NESTED_VALUES_PER_RECORD
          : data.remaining,
    },
    jsonTexts: data.jsonTexts || new ScrubJsonTexts(),
  };
}

function hide(
  text: string,
  hideText: (text: string) => string = redact,
): string {
  return ScrubJsonKeysUtil.hideUnderSensitiveKeys(text, ruleOf({ hideText }));
}

function hideWithin(
  text: string,
  allowance: ScrubNestedValuesAllowance,
): string {
  const rule: ScrubJsonKeysRule = ruleOf({});

  rule.allowance = allowance;

  return ScrubJsonKeysUtil.hideUnderSensitiveKeys(text, rule);
}

// `inner` inside `maps` maps, one in the other, each under `key`.
function nestMaps(inner: unknown, maps: number, key: string): unknown {
  let value: unknown = inner;

  for (let level: number = 0; level < maps; level++) {
    value = { [key]: value };
  }

  return value;
}

// A body as OTLP sends a key-value list, stored as ingest stores it.
function otlpMap(entries: Array<[string, unknown]>): Record<string, unknown> {
  return {
    kvlistValue: {
      values: entries.map(([key, value]: [string, unknown]): unknown => {
        return { key: key, value: value };
      }),
    },
  };
}

/*
 * `inner` as a JSON text held in a string, `levels` times: the JSON text of
 * {level, payload: <the one inside>}, the innermost holding `inner`.
 */
function jsonInStrings(inner: unknown, levels: number): string {
  let text: string = JSON.stringify(inner);

  for (let level: number = 0; level < levels; level++) {
    text = JSON.stringify({ level: level, payload: text });
  }

  return text;
}

// The innermost value of what jsonInStrings wrote, `levels` deep.
function payloadOf(text: string, levels: number): unknown {
  let value: unknown = JSON.parse(text);

  for (let level: number = 0; level < levels; level++) {
    value = JSON.parse((value as Record<string, string>)["payload"]!);
  }

  return value;
}

describe("a Sensitive Attribute Keys rule reads the keys of a JSON text held in a string (#8993)", () => {
  test("an attribute's JSON text: the password inside is hidden, and the text is still JSON", () => {
    expect(hide('{"password":"hunter2"}')).toBe('{"password":"[REDACTED]"}');
    expect(
      JSON.parse(
        hide(
          JSON.stringify({
            method: "POST",
            path: "/login",
            form: { username: "ada", password: "hunter2", remember: true },
          }),
        ),
      ),
    ).toEqual({
      method: "POST",
      path: "/login",
      form: { username: "ada", password: REDACTED, remember: true },
    });
  });

  test("a Fluentd or docker record's `log` field: the application's JSON line inside the body is read too", () => {
    const record: string = JSON.stringify({
      log: JSON.stringify({ level: "info", token: "t-1", msg: "paid" }) + "\n",
      stream: "stdout",
      time: "2026-11-16T10:11:12.000Z",
    });
    const hidden: Record<string, string> = JSON.parse(hide(record));

    expect(hidden["stream"]).toBe("stdout");
    expect(hidden["log"]!.endsWith("\n")).toBe(true);
    expect(JSON.parse(hidden["log"]!)).toEqual({
      level: "info",
      token: REDACTED,
      msg: "paid",
    });
    expect(hide(record)).not.toContain("t-1");
  });

  test("a Kubernetes object's last applied configuration: the secret's data is hidden, the rest of both kept", () => {
    const applied: string = JSON.stringify({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "db" },
      stringData: { password: "s3cr3t", host: "db.internal" },
    });
    const object: string = JSON.stringify({
      kind: "Secret",
      metadata: {
        name: "db",
        annotations: {
          "kubectl.kubernetes.io/last-applied-configuration": applied,
        },
      },
    });
    const hidden: Record<
      string,
      Record<string, Record<string, string>>
    > = JSON.parse(hide(object));
    const appliedAfter: string =
      hidden["metadata"]!["annotations"]![
        "kubectl.kubernetes.io/last-applied-configuration"
      ]!;

    expect(JSON.parse(appliedAfter)).toEqual({
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "db" },
      stringData: { password: REDACTED, host: "db.internal" },
    });
    expect(hidden["metadata"]!["name"]).toBe("db");
  });

  test("an OTLP pair's value, whichever comes first, and the field gRPC adds to name its kind", () => {
    expect(hide('{"key":"db.password","value":{"stringValue":"pw"}}')).toBe(
      '{"key":"db.password","value":{"stringValue":"[REDACTED]"}}',
    );
    expect(hide('{"value":{"stringValue":"pw"},"key":"db.password"}')).toBe(
      '{"value":{"stringValue":"[REDACTED]"},"key":"db.password"}',
    );
    expect(
      hide(
        '[{"key":"api_key","value":{"stringValue":"k-1","value":"stringValue"}},{"key":"user","value":{"stringValue":"ada"}}]',
      ),
    ).toBe(
      '[{"key":"api_key","value":{"stringValue":"[REDACTED]","value":"[REDACTED]"}},{"key":"user","value":{"stringValue":"ada"}}]',
    );
  });

  test("a key written with escapes, or in any case, is read as it reads", () => {
    expect(hide('{"pass\\u0077ord":"x"}')).toBe(
      '{"pass\\u0077ord":"[REDACTED]"}',
    );
    expect(hide('{"Authorization":"Bearer x","COOKIE":"a=1"}')).toBe(
      '{"Authorization":"[REDACTED]","COOKIE":"[REDACTED]"}',
    );
  });

  test("every text under a secret key is hidden, at every level below it; numbers, true, false and null are kept", () => {
    expect(
      hide(
        '{"secret":[1,"a",{"b":"c","d":[true,null,"e"]},2.5],"user":"ada","api_key":12345}',
      ),
    ).toBe(
      '{"secret":[1,"[REDACTED]",{"b":"[REDACTED]","d":[true,null,"[REDACTED]"]},2.5],"user":"ada","api_key":12345}',
    );
  });

  test("a JSON text held under a secret key is hidden whole, as any text under one", () => {
    expect(hide(JSON.stringify({ token: JSON.stringify({ a: "b" }) }))).toBe(
      '{"token":"[REDACTED]"}',
    );
  });

  test("a hidden text is what the rule makes of the text as it reads, written as JSON writes a string", () => {
    const seen: Array<string> = [];

    hide('{"password":"h\\u00e9llo\\n\\"x\\""}', (text: string): string => {
      seen.push(text);
      return REDACTED;
    });

    expect(seen).toEqual(['héllo\n"x"']);
    expect(hide('{"password":"h\\u00e9llo"}', maskKeepingEnds)).toBe(
      '{"password":"h***o"}',
    );
    expect(hide('{"password":"hunter2"}', hash)).toBe(
      `{"password":"${hash("hunter2")}"}`,
    );

    // Whatever it holds: quotes, a backslash, a control character, half a pair.
    const written: string = hide('{"password":"x","note":"y"}', awkward);

    expect(JSON.parse(written)).toEqual({ password: awkward("x"), note: "y" });
  });
});

describe("only what is hidden changes", () => {
  test("numbers JSON.parse cannot keep stay as they are written", () => {
    const text: string =
      '{"user_id":12345678901234567890,"amount":1.50,"zero":-0.0,"huge":1E400,"tiny":1e-7,"password":"x"}';

    expect(hide(text)).toBe(text.replace('"x"', '"[REDACTED]"'));
  });

  test("spaces, indentation and line ends stay as they are", () => {
    const text: string =
      '{\r\n    "user" : "ada" ,\r\n    "token"  :  "t-1"\r\n}\n';

    expect(hide(text)).toBe(text.replace('"t-1"', '"[REDACTED]"'));
  });

  test("the escapes of every text it keeps stay as they are written", () => {
    const text: string =
      '{"note":"caf\\u00e9 \\/ \\ud83d\\ude00","password":"x","path":"a\\/b"}';

    expect(hide(text)).toBe(text.replace('"x"', '"[REDACTED]"'));
  });

  test("a key written twice is read both times", () => {
    expect(hide('{"password":"a","user":"ada","password":"b"}')).toBe(
      '{"password":"[REDACTED]","user":"ada","password":"[REDACTED]"}',
    );
    // JSON.parse keeps the last one only; the first is hidden too.
    expect(hide('{"a":{"password":"x"},"a":[1,2]}')).toBe(
      '{"a":{"password":"[REDACTED]"},"a":[1,2]}',
    );
  });

  test("keys keep their order, numbered keys too", () => {
    const text: string = '{"b":1,"10":{"token":"t"},"2":"two","a":"x"}';

    // JSON.parse would put "2" and "10" first.
    expect(hide(text)).toBe(
      '{"b":1,"10":{"token":"[REDACTED]"},"2":"two","a":"x"}',
    );
  });

  test("a text with nothing to hide is the very same string", () => {
    for (const text of [
      '{"user":"ada","items":[1,2,3]}',
      '{"event":"password_reset","note":"the token expired"}',
      '[{"tokens_used":{"prompt":12,"completion":30}}]',
      '{"message":"line one\\nline two","path":"a\\/b"}',
      JSON.stringify({ log: JSON.stringify({ level: "info", msg: "ok" }) }),
      '{"password":12,"api_key":null,"secret":true}',
    ]) {
      const kept: string = hide(text);

      expect(kept).toBe(text);
    }
  });

  test("the text around a JSON text in a string keeps its escapes too", () => {
    const text: string =
      '{"log":"{\\"token\\":\\"t-1\\"}","note":"caf\\u00e9","n":1.50}';

    expect(hide(text)).toBe(
      '{"log":"{\\"token\\":\\"[REDACTED]\\"}","note":"caf\\u00e9","n":1.50}',
    );
  });

  test("a JSON text in a string keeps its own spaces and numbers", () => {
    const inner: string =
      '{\n  "token": "t-1",\n  "id": 12345678901234567890\n}';
    const hidden: string = hide(JSON.stringify({ log: inner }));

    expect(JSON.parse(hidden)).toEqual({
      log: '{\n  "token": "[REDACTED]",\n  "id": 12345678901234567890\n}',
    });
  });
});

describe("what it does not read: text that only looks like JSON, and free text", () => {
  test("a text that is not the JSON text of a list or a map is kept as it is", () => {
    for (const text of [
      "{token}",
      "[password reset] for ada",
      '{"password": "cut short',
      '{"password":"x"} and then some',
      "password=hunter2",
      '"password"',
      "42",
      "",
      "   ",
      "[1, 2,]",
      "{'password': 'single quotes'}",
      ' {"password":"x"}',
    ]) {
      expect([text, hide(text)]).toEqual([text, text]);
    }
  });

  test("a string inside a JSON text that only looks like JSON stays as it is", () => {
    const text: string = JSON.stringify({
      a: "{token}",
      b: "[password] rotated",
      c: '{"password": "cut short',
      d: '  {"a":1}  tail',
    });

    expect(hide(text)).toBe(text);
  });

  test("a list holds no key: a secret word in it is a value", () => {
    const text: string = '["password","token",["secret"]]';

    expect(hide(text)).toBe(text);
  });

  test("a text that names no secret and holds no escape is not even parsed", () => {
    const parse: ReturnType<typeof getJestSpyOn> = getJestSpyOn(JSON, "parse");

    try {
      expect(hide('{"user":"ada","items":[1,2]}')).toBe(
        '{"user":"ada","items":[1,2]}',
      );
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  test("each JSON text of a record is parsed once to know it is one, however many rules read it", () => {
    const jsonTexts: ScrubJsonTexts = new ScrubJsonTexts();
    const parse: ReturnType<typeof getJestSpyOn> = getJestSpyOn(JSON, "parse");
    let text: string = '{"user":"ada","password":"x"}';

    try {
      for (const hideText of [redact, hash, maskKeepingEnds]) {
        text = ScrubJsonKeysUtil.hideUnderSensitiveKeys(
          text,
          ruleOf({ hideText, jsonTexts }),
        );
      }

      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  });
});

describe(`JSON texts inside strings, ${MAX_JSON_TEXTS_INSIDE_STRINGS} deep as a pattern rule reads them`, () => {
  test(`a JSON text ${MAX_JSON_TEXTS_INSIDE_STRINGS} strings deep is read key by key`, () => {
    const text: string = jsonInStrings(
      { password: "deepest", user: "ada" },
      MAX_JSON_TEXTS_INSIDE_STRINGS,
    );
    const hidden: string = hide(text);

    expect(payloadOf(hidden, MAX_JSON_TEXTS_INSIDE_STRINGS)).toEqual({
      password: REDACTED,
      user: "ada",
    });
    expect(hidden).not.toContain("deepest");
  });

  test("a secret key at every level of JSON in strings is hidden, the levels kept", () => {
    let value: unknown = { token: "t-4" };

    for (let level: number = 3; level >= 0; level--) {
      value = { token: `t-${level}`, payload: JSON.stringify(value) };
    }

    const hidden: string = hide(JSON.stringify(value));

    expect(readingOf(hidden)).toEqual(
      expectedReading(JSON.stringify(value), redact),
    );

    for (let level: number = 0; level <= 4; level++) {
      expect(hidden).not.toContain(`t-${level}`);
    }
  });

  test("a JSON text deeper than that is read as its text: hidden whole when it names a secret, kept when it names none", () => {
    const deeper: number = MAX_JSON_TEXTS_INSIDE_STRINGS + 1;
    const secret: string = hide(
      jsonInStrings({ password: "deepest", user: "ada" }, deeper),
    );
    const plain: string = jsonInStrings({ name: "ada", user: "ada" }, deeper);

    expect(secret).not.toContain("deepest");
    expect(payloadOf(secret, MAX_JSON_TEXTS_INSIDE_STRINGS)).toEqual({
      level: 0,
      payload: REDACTED,
    });
    expect(hide(plain)).toBe(plain);

    // A key written with escapes counts there too.
    const escaped: string = jsonInStrings(JSON.parse('{"x":1}'), 0).replace(
      '"x"',
      '"pass\\u0077ord"',
    );
    let text: string = escaped;

    for (let level: number = 0; level < deeper; level++) {
      text = JSON.stringify({ level: level, payload: text });
    }

    expect(payloadOf(hide(text), MAX_JSON_TEXTS_INSIDE_STRINGS)).toEqual({
      level: 0,
      payload: REDACTED,
    });
  });
});

describe("within the record's bounds", () => {
  test("counts the values it reads, at every level and in every JSON text, against the record's allowance", () => {
    const allowance: ScrubNestedValuesAllowance = { remaining: 100 };

    // The map's 3 entries, the list's 3 items, its map's 1 entry, and the 2 in the string.
    hideWithin(
      JSON.stringify({
        a: "x",
        b: ["y", "z", { c: "w" }],
        d: JSON.stringify({ token: "t", e: 1 }),
      }),
      allowance,
    );

    expect(allowance.remaining).toBe(100 - 9);
  });

  test("a part past what the record has left is read as its JSON text: hidden whole when it names a secret, kept when it names none", () => {
    // 3 entries at the top, then 3 under "first": 6 values fit.
    const text: string = JSON.stringify({
      first: { password: "pw-1", note: "a", other: "b" },
      second: ["nothing", "to", "hide", "here"],
      third: ["the token is t-1", "x", "y", "z"],
    });
    const allowance: ScrubNestedValuesAllowance = { remaining: 6 };

    expect(hideWithin(text, allowance)).toBe(
      JSON.stringify({
        first: { password: REDACTED, note: "a", other: "b" },
        // Past the allowance and naming no secret: kept as the list it is.
        second: ["nothing", "to", "hide", "here"],
        // Past the allowance and naming one: hidden whole.
        third: REDACTED,
      }),
    );
    expect(allowance.remaining).toBe(0);
  });

  test("a part under a secret key past the bounds is hidden whole, whatever its text says", () => {
    expect(
      hideWithin(JSON.stringify({ apiToken: ["plain", "words", "only"] }), {
        remaining: 1,
      }),
    ).toBe('{"apiToken":"[REDACTED]"}');
  });

  test("a JSON text of more values than the record has left is read as one text", () => {
    expect(hideWithin('{"a":1,"token":"t"}', { remaining: 1 })).toBe(REDACTED);
    expect(hideWithin('{"a":1,"b":"t"}', { remaining: 1 })).toBe(
      '{"a":1,"b":"t"}',
    );
    // In a string: the string is hidden whole, the text around it kept.
    expect(
      hideWithin(JSON.stringify({ log: '{"a":1,"token":"t"}', n: 1 }), {
        remaining: 3,
      }),
    ).toBe('{"log":"[REDACTED]","n":1}');
  });

  test("a part past the bounds whose secret key is written with escapes is hidden whole too", () => {
    expect(
      hideWithin('{"first":[{"pass\\u0077ord":"x"}],"n":1}', { remaining: 2 }),
    ).toBe('{"first":"[REDACTED]","n":1}');
  });

  test(`a part nested deeper than ${SCRUB_MAX_VALUE_DEPTH} levels is read as its JSON text: hidden whole when it names a secret, kept when it names none`, () => {
    const deepSecret: unknown = nestMaps(
      { password: "pw-1" },
      SCRUB_MAX_VALUE_DEPTH,
      "f",
    );
    const deepPlain: unknown = nestMaps(
      { name: "nginx" },
      SCRUB_MAX_VALUE_DEPTH,
      "f",
    );
    const text: string = JSON.stringify({
      kind: "Pod",
      metadata: { name: "checkout-1" },
      managed: deepSecret,
      plain: deepPlain,
    });
    const hidden: Record<string, unknown> = JSON.parse(hide(text));

    // The rest of the text is read key by key, and kept.
    expect(hidden["kind"]).toBe("Pod");
    expect(hidden["metadata"]).toEqual({ name: "checkout-1" });
    // The deep part naming no secret is kept as it is, a map.
    expect(hidden["plain"]).toEqual(deepPlain);
    // The deep part naming one: the map at the bound is hidden whole.
    expect(JSON.stringify(hidden["managed"])).not.toContain("pw-1");
    expect(JSON.stringify(hidden["managed"])).toBe(
      JSON.stringify(nestMaps(REDACTED, SCRUB_MAX_VALUE_DEPTH - 1, "f")),
    );
  });

  test(`a part exactly ${SCRUB_MAX_VALUE_DEPTH} levels deep is still read key by key`, () => {
    const text: string = JSON.stringify(
      nestMaps(
        { password: "pw-1", name: "kept" },
        SCRUB_MAX_VALUE_DEPTH - 1,
        "f",
      ),
    );

    expect(JSON.parse(hide(text))).toEqual(
      nestMaps(
        { password: REDACTED, name: "kept" },
        SCRUB_MAX_VALUE_DEPTH - 1,
        "f",
      ),
    );
  });

  test(`a JSON text in a string has ${SCRUB_MAX_VALUE_DEPTH} levels of its own`, () => {
    const inner: string = JSON.stringify(
      nestMaps({ password: "pw-1" }, SCRUB_MAX_VALUE_DEPTH - 1, "f"),
    );
    const text: string = JSON.stringify(nestMaps(inner, 20, "g"));
    let innerAfter: unknown = JSON.parse(hide(text));

    while (typeof innerAfter !== "string") {
      innerAfter = (innerAfter as Record<string, unknown>)["g"];
    }

    expect(JSON.parse(innerAfter as string)).toEqual(
      nestMaps({ password: REDACTED }, SCRUB_MAX_VALUE_DEPTH - 1, "f"),
    );
  });

  test(`a JSON text of more than ${SCRUB_MAX_NESTED_VALUES_PER_RECORD} values is read key by key up to the bound, the rest as text`, () => {
    const contacts: Array<unknown> = [];

    for (let index: number = 0; index < 6_000; index++) {
      contacts.push({ email: `user${index}@example.com`, password: "pw" });
    }

    const text: string = JSON.stringify({ contacts: contacts });
    const hidden: { contacts: Array<unknown> } = JSON.parse(hide(text));

    // 1 entry and 6,000 items, then 2 entries a contact while it lasts.
    expect(hidden.contacts[0]).toEqual({
      email: "user0@example.com",
      password: REDACTED,
    });
    expect(hidden.contacts[1_998]).toEqual({
      email: "user1998@example.com",
      password: REDACTED,
    });
    // Past it, each contact is read as its text, which names a secret.
    expect(hidden.contacts[1_999]).toBe(REDACTED);
    expect(hidden.contacts[5_999]).toBe(REDACTED);
    expect(JSON.stringify(hidden)).not.toContain('"pw"');
  });

  test("the JSON texts in a record's strings share its allowance", () => {
    const part: () => string = (): string => {
      return JSON.stringify(
        new Array<number>(4_000)
          .fill(0)
          .map((_value: number, index: number) => {
            return index === 0 ? { token: "t" } : index;
          }),
      );
    };
    const text: string = JSON.stringify([part(), part(), part()]);
    const hidden: Array<string> = JSON.parse(hide(text));

    // 3 items, then 4,000 and the first's 1, then the second's: 8,005.
    expect(JSON.parse(hidden[0]!)[0]).toEqual({ token: REDACTED });
    expect(JSON.parse(hidden[1]!)[0]).toEqual({ token: REDACTED });
    // The third would take the record past the bound: read as one text.
    expect(hidden[2]).toBe(REDACTED);
  });

  test("a hostile text - a million values, 100,000 levels deep, JSON texts in strings - is read in time in line with its size", () => {
    const LIMIT_IN_MS: number = 2000;
    const text: string = JSON.stringify({
      wide: new Array<string>(1_000_000).fill("a password"),
      deep: nestMaps({ token: "tok-zz9" }, 100_000, "f"),
      held: new Array<string>(2_000).fill(
        jsonInStrings(
          { token: "tok-zz9", n: 1 },
          MAX_JSON_TEXTS_INSIDE_STRINGS + 2,
        ),
      ),
    });
    const run: FastestRun<string> = fastestRun({
      run: (): string => {
        return hide(text);
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(run.inMs).toBeLessThan(LIMIT_IN_MS);
    // Written with its escapes at every depth, the token's own letters as they are.
    expect(run.result).not.toContain("tok-zz9");
    expect(JSON.parse(run.result)["held"]).toHaveLength(2_000);
  });
});

/*
 * ---------------------------------------------------------------------------
 * THE SAME VALUE SENT AS A MAP, or written as a JSON text: a rule hides the
 * same texts either way (ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys
 * reads the map, which is what the JSON text of it is read as).
 * ---------------------------------------------------------------------------
 */
describe("a JSON text is read as the same value sent as a map", () => {
  test("hides the texts under a secret key, an OTLP pair's included, and keeps every other value", () => {
    const body: Record<string, unknown> = otlpMap([
      ["message", { stringValue: "login from a new device" }],
      ["password", { stringValue: "pw-1" }],
      ["retries", { intValue: 3 }],
      [
        "request",
        otlpMap([
          ["path", { stringValue: "/login" }],
          ["authorization", { stringValue: "Bearer abc" }],
        ]),
      ],
    ]);

    expect(JSON.parse(hide(JSON.stringify(body)))).toEqual(
      otlpMap([
        ["message", { stringValue: "login from a new device" }],
        ["password", { stringValue: REDACTED }],
        ["retries", { intValue: 3 }],
        [
          "request",
          otlpMap([
            ["path", { stringValue: "/login" }],
            ["authorization", { stringValue: REDACTED }],
          ]),
        ],
      ]),
    );
  });

  test("hides every text under a map key that names a secret, numbers and true or false kept", () => {
    expect(
      JSON.parse(
        hide(
          JSON.stringify({
            user: "ada",
            session_token: { value: "t-1", scopes: ["read", "write"], ttl: 60 },
            auth: { passwordHash: "h-1", mfa: true },
            tags: ["password-reset"],
          }),
        ),
      ),
    ).toEqual({
      user: "ada",
      session_token: {
        value: REDACTED,
        scopes: [REDACTED, REDACTED],
        ttl: 60,
      },
      auth: { passwordHash: REDACTED, mfa: true },
      // A text in a list holds no key.
      tags: ["password-reset"],
    });
  });

  test("within the bounds, it hides what scrubTextsUnderSensitiveKeys hides", () => {
    const values: Array<unknown> = [
      otlpMap([["db.password", { stringValue: "pw" }]]),
      [{ token: "t" }, { name: "x", cookie: ["a", "b"] }],
      { a: { b: { c: { authorization: "Bearer x", d: 1 } } } },
      [
        { key: "api.token.list", value: { arrayValue: { values: ["t1"] } } },
        { key: "user.name", value: { stringValue: "my password" } },
      ],
      {
        key: "session_token",
        value: { stringValue: "s3cr3t", value: "stringValue" },
      },
    ];

    for (const value of values) {
      expect(JSON.parse(hide(JSON.stringify(value)))).toEqual(
        ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys(
          value,
          isSensitiveKey,
          redact,
        ),
      );
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * PROPERTIES, over seeded random JSON texts holding JSON texts in their
 * strings (JsonKeysCases), each written compact, indented or escaped, with
 * secrets under keys at every level of them.
 * ---------------------------------------------------------------------------
 */
function forEachCase(
  cases: number,
  firstSeed: number,
  check: (random: Random, seed: number) => void,
): void {
  for (let seed: number = firstSeed; seed < firstSeed + cases; seed++) {
    check(seededRandom(seed), seed);
  }
}

function randomCase(
  random: Random,
  jsonInsideStrings: number,
  style: JsonStyle,
): string {
  const options: KeysCaseOptions = {
    jsonInsideStrings: jsonInsideStrings,
    marks: { next: 0 },
  };

  return randomJsonText(random, options, false, style);
}

const ACTIONS: Array<[string, (text: string) => string]> = [
  ["redact", redact],
  ["mask", maskKeepingEnds],
  ["hash", hash],
  ["awkward", awkward],
];

describe("properties over random JSON texts held in strings", () => {
  const CASES: number = 150;

  for (const style of JSON_STYLES) {
    for (let levels: number = 0; levels <= JSON_TEXTS_READ; levels++) {
      test(`${style}, ${levels} levels of JSON in strings: still JSON, every secret hidden, every other text and the shape kept`, () => {
        forEachCase(
          CASES,
          3000 + levels * 1000,
          (random: Random, seed: number) => {
            const text: string = randomCase(random, levels, style);
            const hidden: string = hide(text);
            const label: string = `seed ${seed}: ${text}`;

            // The same reading the same value sent as a map gets.
            expect({ label, reading: readingOf(hidden) }).toEqual({
              label,
              reading: expectedReading(text, redact),
            });
            // The same tokens: numbers, spaces and kept texts as written.
            expect({ label, shape: shapeDifference(text, hidden) }).toEqual({
              label,
              shape: null,
            });
            // Nothing under a secret key is left, at any depth...
            expect({ label, secrets: [...marksIn(hidden, true)] }).toEqual({
              label,
              secrets: [],
            });
            // ...and everything else is.
            expect({
              label,
              plain: [...marksIn(hidden, false)].sort(),
            }).toEqual({ label, plain: [...marksIn(text, false)].sort() });
            // Hidden again, it is as it was: nothing left to hide.
            expect({ label, again: hide(hidden) === hidden }).toEqual({
              label,
              again: true,
            });

            // With nothing to hide, the very same string.
            if (
              isDeepStrictEqual(expectedReading(text, redact), readingOf(text))
            ) {
              expect({ label, same: hidden === text }).toEqual({
                label,
                same: true,
              });
            }
          },
        );
      });
    }
  }

  for (const [name, action] of ACTIONS) {
    test(`${name}: each hidden text is what the action makes of it, and the text stays JSON of the same shape`, () => {
      forEachCase(CASES, 9000, (random: Random, seed: number) => {
        const text: string = randomCase(
          random,
          2,
          JSON_STYLES[seed % JSON_STYLES.length]!,
        );
        const hidden: string = hide(text, action);
        const label: string = `seed ${seed}: ${text}`;

        expect({ label, reading: readingOf(hidden) }).toEqual({
          label,
          reading: expectedReading(text, action),
        });
        expect({ label, shape: shapeDifference(text, hidden) }).toEqual({
          label,
          shape: null,
        });
      });
    });
  }

  test(`past ${MAX_JSON_TEXTS_INSIDE_STRINGS} levels: a deeper JSON text is hidden whole when it names a secret, and nothing under a secret key is left`, () => {
    forEachCase(CASES, 12000, (random: Random, seed: number) => {
      const text: string = randomCase(
        random,
        MAX_JSON_TEXTS_INSIDE_STRINGS + 1,
        JSON_STYLES[seed % JSON_STYLES.length]!,
      );
      const hidden: string = hide(text);
      const label: string = `seed ${seed}: ${text}`;

      expect({ label, reading: readingOf(hidden) }).toEqual({
        label,
        reading: expectedReading(text, redact),
      });
      expect({ label, shape: shapeDifference(text, hidden) }).toEqual({
        label,
        shape: null,
      });
      expect({ label, secrets: [...marksIn(hidden, true)] }).toEqual({
        label,
        secrets: [],
      });
    });
  });
});
