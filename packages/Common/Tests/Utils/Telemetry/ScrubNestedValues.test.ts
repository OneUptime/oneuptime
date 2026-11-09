import { describe, expect, test } from "@jest/globals";
import ScrubNestedValuesUtil, {
  SCRUB_MAX_NESTED_VALUES_PER_RECORD,
  SCRUB_MAX_VALUE_DEPTH,
  ScrubNestedValuesAllowance,
} from "../../../Utils/Telemetry/ScrubNestedValues";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * The text inside a list or a nested value, as a scrub rule reads it
 * (#6397). The rules used to read text values only: an address inside a
 * list, or the values of an `http.request.header.authorization` list, were
 * stored as they arrived. These drive the walk the log and trace scrub rules
 * share - its shapes, that it never changes what it was given, the keys a
 * Sensitive Attribute Keys rule reads inside a value, and the bounds that
 * keep a record quick to scrub whatever its shape.
 */

// A rule as the services hand it over: one text in, its scrubbed text out.
function scrubSecretWord(text: string): string {
  return text.split("secret").join("[SCRUBBED]");
}

const SENSITIVE_KEY: RegExp = /(password|token|authorization|cookie)/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function hide(_text: string): string {
  return "[REDACTED]";
}

// `text` inside `lists` lists, one in the other: nest("a", 2) is [["a"]].
function nest(text: string, lists: number): unknown {
  let value: unknown = text;

  for (let level: number = 0; level < lists; level++) {
    value = [value];
  }

  return value;
}

// What lies `lists` lists inside a value nest built.
function unnest(value: unknown, lists: number): unknown {
  let inner: unknown = value;

  for (let level: number = 0; level < lists; level++) {
    inner = (inner as Array<unknown>)[0];
  }

  return inner;
}

// Freezes a value and everything inside it, so a write throws.
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }

    Object.freeze(value);
  }

  return value;
}

function newAllowance(): ScrubNestedValuesAllowance {
  return ScrubNestedValuesUtil.newRecordAllowance();
}

describe("scrubTexts keeps a value's shape", () => {
  test("scrubs each text of a list, keeping its length and order", () => {
    expect(
      ScrubNestedValuesUtil.scrubTexts(
        ["a secret", "plain", "secret again"],
        scrubSecretWord,
      ),
    ).toEqual(["a [SCRUBBED]", "plain", "[SCRUBBED] again"]);
  });

  test("scrubs the texts of lists inside lists, at every level", () => {
    expect(
      ScrubNestedValuesUtil.scrubTexts(
        [["secret", ["x", ["deep secret"]]], "secret"],
        scrubSecretWord,
      ),
    ).toEqual([["[SCRUBBED]", ["x", ["deep [SCRUBBED]"]]], "[SCRUBBED]"]);
  });

  test("scrubs the texts of the maps a key-value list inside a list becomes, keeping their keys", () => {
    // What TelemetryUtil.getAttributes makes of [{kvlist: user=..., id=7}].
    const value: Array<unknown> = [
      { "users.name": "secret agent", "users.id": 7 },
      { "users.name": "someone", "users.tags": ["secret", "public"] },
    ];

    expect(ScrubNestedValuesUtil.scrubTexts(value, scrubSecretWord)).toEqual([
      { "users.name": "[SCRUBBED] agent", "users.id": 7 },
      { "users.name": "someone", "users.tags": ["[SCRUBBED]", "public"] },
    ]);
  });

  test("leaves numbers, true or false and empty values where they are, with their types", () => {
    const value: Array<unknown> = [
      1,
      2.5,
      true,
      false,
      null,
      "secret",
      { count: 3, ok: false, nothing: null },
    ];
    const scrubbed: Array<unknown> = ScrubNestedValuesUtil.scrubTexts(
      value,
      scrubSecretWord,
    ) as Array<unknown>;

    expect(scrubbed).toEqual([
      1,
      2.5,
      true,
      false,
      null,
      "[SCRUBBED]",
      { count: 3, ok: false, nothing: null },
    ]);
    expect(typeof scrubbed[0]).toBe("number");
    expect(typeof scrubbed[2]).toBe("boolean");
    expect(scrubbed[4]).toBeNull();
  });

  test("hands every text to the rule, numbers never", () => {
    const seen: Array<string> = [];

    ScrubNestedValuesUtil.scrubTexts(
      ["a", 1, [true, "b", { c: "c", d: 4 }], null],
      (text: string): string => {
        seen.push(text);
        return text;
      },
    );

    expect(seen).toEqual(["a", "b", "c"]);
  });

  test("scrubs a text on its own, and leaves a number, true or false or an empty value", () => {
    expect(ScrubNestedValuesUtil.scrubTexts("secret", scrubSecretWord)).toBe(
      "[SCRUBBED]",
    );
    expect(ScrubNestedValuesUtil.scrubTexts(42, scrubSecretWord)).toBe(42);
    expect(ScrubNestedValuesUtil.scrubTexts(false, scrubSecretWord)).toBe(
      false,
    );
    expect(ScrubNestedValuesUtil.scrubTexts(null, scrubSecretWord)).toBeNull();
    expect(
      ScrubNestedValuesUtil.scrubTexts(undefined, scrubSecretWord),
    ).toBeUndefined();
  });

  test("keeps empty lists and maps", () => {
    const value: Array<unknown> = [[], {}, "secret"];

    expect(ScrubNestedValuesUtil.scrubTexts(value, scrubSecretWord)).toEqual([
      [],
      {},
      "[SCRUBBED]",
    ]);
  });

  test("reads inside a list or a map only: a Buffer or a Date is left as it is", () => {
    const buffer: Buffer = Buffer.from("secret");
    const date: Date = new Date(0);
    const scrubbed: Array<unknown> = ScrubNestedValuesUtil.scrubTexts(
      [buffer, date],
      scrubSecretWord,
    ) as Array<unknown>;

    expect(scrubbed[0]).toBe(buffer);
    expect(scrubbed[1]).toBe(date);
    expect(ScrubNestedValuesUtil.isNested(buffer)).toBe(false);
    expect(ScrubNestedValuesUtil.isNested(date)).toBe(false);
    expect(ScrubNestedValuesUtil.isNested([])).toBe(true);
    expect(ScrubNestedValuesUtil.isNested({})).toBe(true);
    expect(ScrubNestedValuesUtil.isNested(Object.create(null))).toBe(true);
    expect(ScrubNestedValuesUtil.isNested("text")).toBe(false);
    expect(ScrubNestedValuesUtil.isNested(null)).toBe(false);
  });
});

describe("scrubTexts never changes what it was given", () => {
  test("a frozen value is scrubbed into a copy, and stays as it arrived", () => {
    const value: unknown = deepFreeze([
      "secret",
      ["kept", { inner: ["secret"], untouched: ["x"] }],
      { "a.b": "secret" },
    ]);
    const before: string = JSON.stringify(value);

    const scrubbed: unknown = ScrubNestedValuesUtil.scrubTexts(
      value,
      scrubSecretWord,
    );

    expect(JSON.stringify(value)).toBe(before);
    expect(scrubbed).toEqual([
      "[SCRUBBED]",
      ["kept", { inner: ["[SCRUBBED]"], untouched: ["x"] }],
      { "a.b": "[SCRUBBED]" },
    ]);
  });

  test("returns the very value when no text in it changed", () => {
    const value: Array<unknown> = ["a", ["b", { c: "c" }], 1];

    expect(ScrubNestedValuesUtil.scrubTexts(value, scrubSecretWord)).toBe(
      value,
    );
  });

  test("copies only the lists and maps on the way to a changed text", () => {
    const untouchedList: Array<unknown> = ["x", "y"];
    const untouchedMap: Record<string, unknown> = { z: "z" };
    const changedBranch: Array<unknown> = ["secret"];
    const value: Array<unknown> = [untouchedList, untouchedMap, changedBranch];

    const scrubbed: Array<unknown> = ScrubNestedValuesUtil.scrubTexts(
      value,
      scrubSecretWord,
    ) as Array<unknown>;

    expect(scrubbed).not.toBe(value);
    expect(scrubbed[0]).toBe(untouchedList);
    expect(scrubbed[1]).toBe(untouchedMap);
    expect(scrubbed[2]).not.toBe(changedBranch);
    expect(changedBranch).toEqual(["secret"]);
  });

  test("a value shared by many records - a resource's, a scope's - stays as it arrived for the next one", () => {
    const shared: Array<unknown> = ["owner secret", ["secret"]];
    const first: unknown = ScrubNestedValuesUtil.scrubTexts(
      shared,
      scrubSecretWord,
    );
    const second: unknown = ScrubNestedValuesUtil.scrubTexts(
      shared,
      (text: string): string => {
        return text.toUpperCase();
      },
    );

    expect(shared).toEqual(["owner secret", ["secret"]]);
    expect(first).toEqual(["owner [SCRUBBED]", ["[SCRUBBED]"]]);
    expect(second).toEqual(["OWNER SECRET", ["SECRET"]]);
  });

  test("a key named __proto__, as JSON reads one, is scrubbed as a key: no prototype changes", () => {
    const value: Record<string, unknown> = JSON.parse(
      '{"__proto__": {"polluted": "secret"}, "other": "secret"}',
    ) as Record<string, unknown>;

    const scrubbed: Record<string, unknown> = ScrubNestedValuesUtil.scrubTexts(
      value,
      scrubSecretWord,
    ) as Record<string, unknown>;

    expect(Object.getPrototypeOf(scrubbed)).toBe(Object.prototype);
    expect(Object.keys(scrubbed)).toEqual(["__proto__", "other"]);
    expect(
      Object.getOwnPropertyDescriptor(scrubbed, "__proto__")?.value,
    ).toEqual({ polluted: "[SCRUBBED]" });
    expect(scrubbed["other"]).toBe("[SCRUBBED]");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test("a map without a prototype stays one", () => {
    const value: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    value["a"] = "secret";

    const scrubbed: Record<string, unknown> = ScrubNestedValuesUtil.scrubTexts(
      value,
      scrubSecretWord,
    ) as Record<string, unknown>;

    expect(Object.getPrototypeOf(scrubbed)).toBeNull();
    expect(scrubbed["a"]).toBe("[SCRUBBED]");
    expect(value["a"]).toBe("secret");
  });
});

describe("scrubTextsUnderSensitiveKeys reads the keys inside a value", () => {
  test("hides every text under a map key that names a secret, at every level below it", () => {
    const value: Record<string, unknown> = {
      "headers.authorization": ["Bearer abc", "Basic xyz"],
      "headers.accept": ["text/html"],
      nested: {
        password: { first: "p1", more: ["p2", 3, true, null] },
        user: "ana",
      },
    };

    expect(
      ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys(
        value,
        isSensitiveKey,
        hide,
      ),
    ).toEqual({
      "headers.authorization": ["[REDACTED]", "[REDACTED]"],
      "headers.accept": ["text/html"],
      nested: {
        password: { first: "[REDACTED]", more: ["[REDACTED]", 3, true, null] },
        user: "ana",
      },
    });
  });

  test("reads the key of each OTLP key-value pair, as a scope's attributes keep them", () => {
    const scopeAttributes: Array<unknown> = [
      { key: "library.language", value: { stringValue: "nodejs" } },
      { key: "db.password", value: { stringValue: "hunter2" } },
      {
        key: "api.token.list",
        value: {
          arrayValue: {
            values: [{ stringValue: "t1" }, { intValue: "12" }],
          },
        },
      },
      { key: "retries", value: { intValue: 3 } },
    ];

    expect(
      ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys(
        scopeAttributes,
        isSensitiveKey,
        hide,
      ),
    ).toEqual([
      { key: "library.language", value: { stringValue: "nodejs" } },
      { key: "db.password", value: { stringValue: "[REDACTED]" } },
      {
        key: "api.token.list",
        value: {
          arrayValue: {
            values: [{ stringValue: "[REDACTED]" }, { intValue: "[REDACTED]" }],
          },
        },
      },
      { key: "retries", value: { intValue: 3 } },
    ]);
  });

  test("hides the field gRPC adds to name a pair's kind too: it is text under the secret", () => {
    // proto-loader with oneofs: true adds `value`, naming the field set.
    const pair: Record<string, unknown> = {
      key: "session_token",
      value: { stringValue: "s3cr3t", value: "stringValue" },
    };

    expect(
      ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys(
        pair,
        isSensitiveKey,
        hide,
      ),
    ).toEqual({
      key: "session_token",
      value: { stringValue: "[REDACTED]", value: "[REDACTED]" },
    });
  });

  test("keeps the texts under no such key, and texts in a list hold no key", () => {
    const value: Array<unknown> = [
      "a password in a text",
      { user: "token in a value", count: 2 },
      { key: "user.name", value: { stringValue: "my password" } },
    ];

    expect(
      ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys(
        value,
        isSensitiveKey,
        hide,
      ),
    ).toBe(value);
  });

  test("reads a key in any case, as the rule's pattern does", () => {
    expect(
      ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys(
        [{ "X-Auth-TOKEN": "abc" }],
        isSensitiveKey,
        hide,
      ),
    ).toEqual([{ "X-Auth-TOKEN": "[REDACTED]" }]);
  });

  test("leaves a text on its own, or a number, as it is: an attribute's own key is the caller's", () => {
    expect(
      ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys(
        "password",
        isSensitiveKey,
        hide,
      ),
    ).toBe("password");
    expect(
      ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys(
        5,
        isSensitiveKey,
        hide,
      ),
    ).toBe(5);
  });

  test("never changes what it was given", () => {
    const value: unknown = deepFreeze({
      cookie: ["a=1", "b=2"],
      kept: ["c"],
    });

    expect(
      ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys(
        value,
        isSensitiveKey,
        hide,
      ),
    ).toEqual({ cookie: ["[REDACTED]", "[REDACTED]"], kept: ["c"] });
    expect(value).toEqual({ cookie: ["a=1", "b=2"], kept: ["c"] });
  });
});

describe("an attribute map, as the services scrub one", () => {
  test("scrubAttributeTexts scrubs text values and the texts inside lists and maps, in place", () => {
    const attributes: Record<string, unknown> = {
      message: "a secret",
      tags: ["secret", "public"],
      "user.roles": [["secret"]],
      count: 4,
      ok: true,
      nothing: null,
    };

    ScrubNestedValuesUtil.scrubAttributeTexts(attributes, scrubSecretWord);

    expect(attributes).toEqual({
      message: "a [SCRUBBED]",
      tags: ["[SCRUBBED]", "public"],
      "user.roles": [["[SCRUBBED]"]],
      count: 4,
      ok: true,
      nothing: null,
    });
  });

  test("hideAttributeTextsUnderSensitiveKeys hides each text of a value whose key names a secret, numbers kept", () => {
    const attributes: Record<string, unknown> = {
      "http.request.header.authorization": ["Bearer abc"],
      "http.request.header.cookie": ["a=1", "b=2"],
      "db.password": "hunter2",
      "gen_ai.usage.input_tokens": 120,
      "auth.token.valid": true,
      "http.request.header.accept": ["*/*"],
      "scope.attributes": [
        { key: "db.password", value: { stringValue: "x" } },
        { key: "lib", value: { stringValue: "y" } },
      ],
    };

    ScrubNestedValuesUtil.hideAttributeTextsUnderSensitiveKeys(
      attributes,
      isSensitiveKey,
      hide,
      new Set<string>(),
    );

    expect(attributes).toEqual({
      "http.request.header.authorization": ["[REDACTED]"],
      "http.request.header.cookie": ["[REDACTED]", "[REDACTED]"],
      "db.password": "[REDACTED]",
      "gen_ai.usage.input_tokens": 120,
      "auth.token.valid": true,
      "http.request.header.accept": ["*/*"],
      "scope.attributes": [
        { key: "db.password", value: { stringValue: "[REDACTED]" } },
        { key: "lib", value: { stringValue: "y" } },
      ],
    });
  });

  test("a value held as text is hidden whole when it names a secret anywhere; a text that arrived as text is not", () => {
    const attributes: Record<string, unknown> = {
      held: '[{"password":"p"}]',
      heldPlain: '["a","b"]',
      arrivedAsText: "reset your password here",
    };

    ScrubNestedValuesUtil.hideAttributeTextsUnderSensitiveKeys(
      attributes,
      isSensitiveKey,
      hide,
      new Set<string>(["held", "heldPlain"]),
    );

    expect(attributes).toEqual({
      held: "[REDACTED]",
      heldPlain: '["a","b"]',
      arrivedAsText: "reset your password here",
    });
  });
});

describe("holdOversizedValuesAsText bounds what the rules read value by value", () => {
  test(`a text inside ${SCRUB_MAX_VALUE_DEPTH} lists is read value by value; inside one more, the value is held as its JSON text`, () => {
    const attributes: Record<string, unknown> = {
      deepest: nest("secret", SCRUB_MAX_VALUE_DEPTH),
      tooDeep: nest("secret", SCRUB_MAX_VALUE_DEPTH + 1),
    };
    const tooDeepText: string = JSON.stringify(attributes["tooDeep"]);

    const held: Set<string> = ScrubNestedValuesUtil.holdOversizedValuesAsText(
      attributes,
      newAllowance(),
    );

    expect([...held]).toEqual(["tooDeep"]);
    expect(Array.isArray(attributes["deepest"])).toBe(true);
    expect(attributes["tooDeep"]).toBe(tooDeepText);

    ScrubNestedValuesUtil.scrubAttributeTexts(attributes, scrubSecretWord);

    expect(unnest(attributes["deepest"], SCRUB_MAX_VALUE_DEPTH)).toBe(
      "[SCRUBBED]",
    );
    expect(attributes["tooDeep"]).toBe(
      tooDeepText.split("secret").join("[SCRUBBED]"),
    );
  });

  test("an empty list or map takes nothing, at any depth", () => {
    // An empty list one level past the deepest a rule reads.
    let emptyDeep: unknown = [];

    for (let level: number = 0; level < SCRUB_MAX_VALUE_DEPTH; level++) {
      emptyDeep = [emptyDeep];
    }

    const attributes: Record<string, unknown> = {
      emptyDeep: emptyDeep,
      empty: [],
      emptyMap: {},
    };
    const allowance: ScrubNestedValuesAllowance = newAllowance();

    expect(
      ScrubNestedValuesUtil.holdOversizedValuesAsText(attributes, allowance)
        .size,
    ).toBe(0);
    expect(attributes["emptyDeep"]).toBe(emptyDeep);
    // Each of the lists around it holds one value.
    expect(allowance.remaining).toBe(
      SCRUB_MAX_NESTED_VALUES_PER_RECORD - SCRUB_MAX_VALUE_DEPTH,
    );
  });

  test(`a record's lists and maps are read value by value up to ${SCRUB_MAX_NESTED_VALUES_PER_RECORD} values; a value past that is held as text`, () => {
    const fits: Array<string> = new Array<string>(
      SCRUB_MAX_NESTED_VALUES_PER_RECORD,
    ).fill("secret");
    const attributes: Record<string, unknown> = {
      fits: fits,
      next: ["secret"],
      emptyAfter: [],
      text: "secret",
    };
    const allowance: ScrubNestedValuesAllowance = newAllowance();

    const held: Set<string> = ScrubNestedValuesUtil.holdOversizedValuesAsText(
      attributes,
      allowance,
    );

    expect([...held]).toEqual(["next"]);
    expect(allowance.remaining).toBe(0);
    expect(attributes["fits"]).toBe(fits);
    expect(attributes["next"]).toBe('["secret"]');
    expect(attributes["emptyAfter"]).toEqual([]);
    expect(attributes["text"]).toBe("secret");
  });

  test("one value of more values than the allowance is held, and the values after it still fit", () => {
    const attributes: Record<string, unknown> = {
      huge: new Array<string>(SCRUB_MAX_NESTED_VALUES_PER_RECORD + 1).fill("a"),
      after: new Array<string>(SCRUB_MAX_NESTED_VALUES_PER_RECORD).fill("b"),
    };
    const allowance: ScrubNestedValuesAllowance = newAllowance();

    expect([
      ...ScrubNestedValuesUtil.holdOversizedValuesAsText(attributes, allowance),
    ]).toEqual(["huge"]);
    expect(typeof attributes["huge"]).toBe("string");
    expect(Array.isArray(attributes["after"])).toBe(true);
    expect(allowance.remaining).toBe(0);
  });

  test("counts the values at every level, a map's entries included", () => {
    // 100 lists of 99 texts: 100 + 9,900 values.
    const exactly: Array<Array<string>> = [];
    // 100 lists of 100 texts: 100 + 10,000 values.
    const oneListTooMany: Array<Array<string>> = [];
    const mapOfLists: Record<string, unknown> = {};

    for (let index: number = 0; index < 100; index++) {
      exactly.push(new Array<string>(99).fill("x"));
      oneListTooMany.push(new Array<string>(100).fill("x"));
      mapOfLists[`key${index}`] = new Array<string>(99).fill("x");
    }

    expect(
      ScrubNestedValuesUtil.holdOversizedValuesAsText(
        { value: exactly },
        newAllowance(),
      ).size,
    ).toBe(0);
    expect(
      ScrubNestedValuesUtil.holdOversizedValuesAsText(
        { value: oneListTooMany },
        newAllowance(),
      ).size,
    ).toBe(1);
    expect(
      ScrubNestedValuesUtil.holdOversizedValuesAsText(
        { value: mapOfLists },
        newAllowance(),
      ).size,
    ).toBe(0);

    // A map of two entries, one a list of one: three values.
    const allowance: ScrubNestedValuesAllowance = newAllowance();
    ScrubNestedValuesUtil.holdOversizedValuesAsText(
      { one: { a: 1, b: [2] }, text: "not inside a list" },
      allowance,
    );

    expect(allowance.remaining).toBe(SCRUB_MAX_NESTED_VALUES_PER_RECORD - 3);
  });

  test("the maps of one record - a span's, its events', its links' - share its allowance", () => {
    const allowance: ScrubNestedValuesAllowance = newAllowance();
    const spanAttributes: Record<string, unknown> = {
      list: new Array<number>(6_000).fill(1),
    };
    const eventAttributes: Record<string, unknown> = {
      list: new Array<number>(6_000).fill(2),
    };

    ScrubNestedValuesUtil.holdOversizedValuesAsText(spanAttributes, allowance);
    ScrubNestedValuesUtil.holdOversizedValuesAsText(eventAttributes, allowance);

    expect(Array.isArray(spanAttributes["list"])).toBe(true);
    expect(eventAttributes["list"]).toBe(
      JSON.stringify(new Array<number>(6_000).fill(2)),
    );
  });

  test("holds a value as exactly the text the tables store for it: its JSON text", () => {
    const value: Array<unknown> = [
      1,
      2.5,
      1e21,
      true,
      null,
      'é \u{1F600} \\ "',
      { "a.b": [] },
      nest("x", SCRUB_MAX_VALUE_DEPTH + 1),
    ];
    const attributes: Record<string, unknown> = { value: value };

    ScrubNestedValuesUtil.holdOversizedValuesAsText(attributes, newAllowance());

    expect(attributes["value"]).toBe(JSON.stringify(value));
    expect(JSON.parse(attributes["value"] as string)).toEqual(value);
  });

  test("never changes a list or map it holds: the record's map gets the text", () => {
    const shared: unknown = deepFreeze(
      nest("secret", SCRUB_MAX_VALUE_DEPTH + 5),
    );
    const first: Record<string, unknown> = { "resource.deep": shared };
    const second: Record<string, unknown> = { "resource.deep": shared };

    ScrubNestedValuesUtil.holdOversizedValuesAsText(first, newAllowance());
    ScrubNestedValuesUtil.holdOversizedValuesAsText(second, newAllowance());

    expect(first["resource.deep"]).toBe(JSON.stringify(shared));
    expect(second["resource.deep"]).toBe(JSON.stringify(shared));
    expect(unnest(shared, SCRUB_MAX_VALUE_DEPTH + 5)).toBe("secret");
  });

  test("a value too deep that JSON cannot write - none ingest builds - is held as an empty text", () => {
    const circular: Array<unknown> = [];
    circular.push(circular);
    const attributes: Record<string, unknown> = {
      circular: circular,
      big: [BigInt(1)],
    };
    const allowance: ScrubNestedValuesAllowance = newAllowance();

    expect([
      ...ScrubNestedValuesUtil.holdOversizedValuesAsText(attributes, allowance),
    ]).toEqual(["circular"]);
    expect(attributes["circular"]).toBe("");
    // A list that fits is left for the rules, which never write it out.
    expect(Array.isArray(attributes["big"])).toBe(true);
  });
});

describe("without the hold first, the walk still stops at its depth", () => {
  test("a pattern rule reads the rest of a value as its JSON text, storing that text only when it changed it", () => {
    const deep: unknown = nest("secret", SCRUB_MAX_VALUE_DEPTH + 3);
    const scrubbed: unknown = ScrubNestedValuesUtil.scrubTexts(
      deep,
      scrubSecretWord,
    );

    expect(unnest(scrubbed, SCRUB_MAX_VALUE_DEPTH)).toBe(
      JSON.stringify(nest("[SCRUBBED]", 3)),
    );

    const untouched: unknown = nest("plain", SCRUB_MAX_VALUE_DEPTH + 3);

    expect(ScrubNestedValuesUtil.scrubTexts(untouched, scrubSecretWord)).toBe(
      untouched,
    );
  });

  test("a sensitive-keys rule hides the rest of a value whole when its text names a secret", () => {
    let deep: unknown = { password: "p" };
    for (let level: number = 0; level < SCRUB_MAX_VALUE_DEPTH + 2; level++) {
      deep = [deep];
    }

    const hidden: unknown = ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys(
      deep,
      isSensitiveKey,
      hide,
    );

    expect(unnest(hidden, SCRUB_MAX_VALUE_DEPTH)).toBe("[REDACTED]");

    let plain: unknown = { user: "u" };
    for (let level: number = 0; level < SCRUB_MAX_VALUE_DEPTH + 2; level++) {
      plain = [plain];
    }

    expect(
      ScrubNestedValuesUtil.scrubTextsUnderSensitiveKeys(
        plain,
        isSensitiveKey,
        hide,
      ),
    ).toBe(plain);
  });
});

describe("a hostile record is scrubbed in time in line with its size", () => {
  const LIMIT_IN_MS: number = 2000;

  // The rules a record of each shape meets: a pattern rule, then a keys rule.
  function scrubRecord(attributes: Record<string, unknown>): void {
    const held: Set<string> = ScrubNestedValuesUtil.holdOversizedValuesAsText(
      attributes,
      newAllowance(),
    );

    ScrubNestedValuesUtil.scrubAttributeTexts(attributes, scrubSecretWord);
    ScrubNestedValuesUtil.hideAttributeTextsUnderSensitiveKeys(
      attributes,
      isSensitiveKey,
      hide,
      held,
    );
  }

  test("a value 200,000 lists deep is held as one text, and never reaches the call stack's end", () => {
    const run: FastestRun<Record<string, unknown>> = fastestRun({
      run: (): Record<string, unknown> => {
        const attributes: Record<string, unknown> = {
          deep: nest("a secret", 200_000),
        };
        scrubRecord(attributes);
        return attributes;
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(run.inMs).toBeLessThan(LIMIT_IN_MS);
    expect(run.result["deep"]).toBe(
      "[".repeat(200_000) + '"a [SCRUBBED]"' + "]".repeat(200_000),
    );
  });

  test("a million values in one list, and a thousand lists of a thousand, are read as text past the allowance", () => {
    const run: FastestRun<Record<string, unknown>> = fastestRun({
      run: (): Record<string, unknown> => {
        const attributes: Record<string, unknown> = {
          wide: new Array<string>(1_000_000).fill("a secret"),
        };

        for (let index: number = 0; index < 1000; index++) {
          attributes[`list${index}`] = new Array<string>(1000).fill("secret");
        }

        scrubRecord(attributes);
        return attributes;
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(run.inMs).toBeLessThan(LIMIT_IN_MS);
    expect(typeof run.result["wide"]).toBe("string");
    // Ten lists of a thousand fill the allowance; the rest are texts.
    expect(Array.isArray(run.result["list9"])).toBe(true);
    expect((run.result["list9"] as Array<string>)[999]).toBe("[SCRUBBED]");
    expect(typeof run.result["list10"]).toBe("string");
    expect(run.result["list999"]).not.toContain('"secret"');
  });
});
