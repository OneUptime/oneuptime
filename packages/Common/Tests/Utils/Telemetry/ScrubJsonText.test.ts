import ScrubJsonTextUtil, {
  MAX_JSON_TEXTS_INSIDE_STRINGS,
  ScrubJsonTexts,
} from "../../../Utils/Telemetry/ScrubJsonText";
import ScrubNestedValuesUtil from "../../../Utils/Telemetry/ScrubNestedValues";
import { maskKeepingEnds } from "../../../Utils/Telemetry/ScrubMask";
import {
  compileScrubRuleCustomRegex,
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
} from "../../../Types/Telemetry/ScrubRule";
import {
  hasLoneSurrogate,
  JSON_STYLES,
  JsonStyle,
  JsonToken,
  randomJsonListOrMap,
  Random,
  readJsonTokens,
  SECRETS,
  seededRandom,
  writeJson,
} from "./JsonTextCases";
import { getJestSpyOn } from "../../Spy";
import crypto from "crypto";
import { describe, expect, test } from "@jest/globals";

/*
 * A PATTERN RULE OVER THE JSON TEXT OF A LIST OR A MAP KEEPS IT JSON (#8923).
 *
 * A structured log body - and an attribute written as JSON - is stored as
 * its JSON text, and a pattern rule used to replace what it found in that
 * text wherever it was: right after an escape it took the escape's letter
 * (`\nada@example.com` -> `\[REDACTED]`, not JSON), on a number it left
 * `[REDACTED]` where a value goes, and a card, Social Security or phone
 * number or an IP address right after `\n`, `\t` or `\r` was not found at
 * all. These tests hold ScrubJsonTextUtil to the module comment: the text
 * stays JSON with the same lists, maps and values, and each string comes
 * out as the same text would sent as an attribute. The property tests run
 * over seeded random JSON texts (JsonTextCases), so a failure names its
 * seed and reproduces.
 */

// The built-in patterns, as the log and trace engines declare them.
const BUILT_IN: Record<string, RegExp> = {
  email: /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,63}/g,
  creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  phoneNumber: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ipAddress: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
};

function builtIn(name: string): ScrubRegExp {
  return scrubRegExpFromBuiltIn(BUILT_IN[name]!);
}

// The custom patterns: they read a JSON text as it is written too.
const CUSTOM: WeakSet<ScrubRegExp> = new WeakSet<ScrubRegExp>();

function custom(source: string): ScrubRegExp {
  const regex: ScrubRegExp | null = compileScrubRuleCustomRegex(source);

  expect(regex).not.toBeNull();
  CUSTOM.add(regex as ScrubRegExp);

  return regex as ScrubRegExp;
}

type Replace = (matchedText: string) => string;

const REDACT: Replace = (): string => {
  return "[REDACTED]";
};

// As the engines mask a custom match or a secret: first and last kept.
const MASK: Replace = maskKeepingEnds;

const HASH: Replace = (match: string): string => {
  return `[HASHED:${crypto.createHash("sha256").update(match).digest("hex").slice(0, 8)}]`;
};

// A replacement holding everything JSON must escape, a lone surrogate too.
const AWKWARD: Replace = (match: string): string => {
  return `"\\\n\u0001}${match.slice(0, 1)}\ud800`;
};

const REPLACEMENTS: Record<string, Replace> = {
  redact: REDACT,
  mask: MASK,
  hash: HASH,
  awkward: AWKWARD,
};

function scrub(
  jsonText: string,
  regex: ScrubRegExp,
  replace: Replace = REDACT,
): string {
  return ScrubJsonTextUtil.scrubJsonText({
    jsonText: jsonText,
    findMatches: (text: string): Array<[number, number]> => {
      return regex.matchRanges(text);
    },
    replaceMatch: replace,
    readsAsWritten: CUSTOM.has(regex),
  });
}

// What the same rule leaves of a text sent as an attribute.
function scrubAsText(
  text: string,
  regex: ScrubRegExp,
  replace: Replace,
): string {
  return regex.replace(text, replace);
}

function isJsonListOrMap(text: string): boolean {
  return ScrubNestedValuesUtil.readJsonListOrMap(text) !== null;
}

/*
 * That `scrubbed` is `original` with each string - a key or a value - and
 * each number scrubbed as the same text sent as an attribute, every other
 * token kept, read with JsonTextCases' own reader. A string that is a JSON
 * text of its own is held to the same, one level in.
 */
function expectScrubbedAsAttributes(data: {
  original: string;
  scrubbed: string;
  regex: ScrubRegExp;
  replace: Replace;
  depth: number;
  label: string;
}): void {
  const before: Array<JsonToken> = readJsonTokens(data.original);
  const after: Array<JsonToken> = readJsonTokens(data.scrubbed);

  expect({ label: data.label, tokens: after.length }).toEqual({
    label: data.label,
    tokens: before.length,
  });

  before.forEach((token: JsonToken, index: number): void => {
    const out: JsonToken = after[index]!;

    if (token.kind === "punctuation" || token.kind === "space") {
      expect({ label: data.label, token: out.text }).toEqual({
        label: data.label,
        token: token.text,
      });
      return;
    }

    if (token.kind === "scalar") {
      const asText: string = scrubAsText(token.text, data.regex, data.replace);

      if (asText === token.text) {
        expect({ label: data.label, scalar: out.text }).toEqual({
          label: data.label,
          scalar: token.text,
        });
      } else {
        // A number a rule matched becomes a string of what is left of it.
        expect({
          label: data.label,
          kind: out.kind,
          text: JSON.parse(out.text),
        }).toEqual({ label: data.label, kind: "string", text: asText });
      }
      return;
    }

    expect({ label: data.label, kind: out.kind }).toEqual({
      label: data.label,
      kind: "string",
    });

    const text: string = JSON.parse(token.text) as string;
    const outText: string = JSON.parse(out.text) as string;

    if (data.depth < MAX_JSON_TEXTS_INSIDE_STRINGS && isJsonListOrMap(text)) {
      expect({ label: data.label, json: isJsonListOrMap(outText) }).toEqual({
        label: data.label,
        json: true,
      });
      expectScrubbedAsAttributes({
        ...data,
        original: text,
        scrubbed: outText,
        depth: data.depth + 1,
        label: data.label + " (inside a string)",
      });
      return;
    }

    expect({ label: data.label, text: outText }).toEqual({
      label: data.label,
      text: scrubAsText(text, data.regex, data.replace),
    });
  });
}

// Each case of a property, named by its seed so a failure reproduces.
function forEachCase(
  cases: number,
  firstSeed: number,
  check: (random: Random, seed: number) => void,
): void {
  for (let seed: number = firstSeed; seed < firstSeed + cases; seed++) {
    check(seededRandom(seed), seed);
  }
}

describe("a match right after an escape is replaced after it, and the text stays JSON", () => {
  const ESCAPES: Array<[string, string]> = [
    ["a line feed", "\n"],
    ["a tab", "\t"],
    ["a carriage return", "\r"],
    ["a backspace", "\b"],
    ["a form feed", "\f"],
    ["a quote", '"'],
    ["a control character", "\u0007"],
    ["a character past ASCII written as \\u", "é"],
  ];

  for (const [name, character] of ESCAPES) {
    for (const [action, replace] of Object.entries({
      redact: REDACT,
      mask: MASK,
      hash: HASH,
    })) {
      test(`an address after ${name}, ${action}ed`, () => {
        const body: string = JSON.stringify({
          message: `line one${character}ada@example.com`,
        });
        // Python and others write é as an escape, JSON.stringify does not.
        const written: string = body.replace("é", "\\u00e9");
        const scrubbed: string = scrub(written, builtIn("email"), replace);

        expect(JSON.parse(scrubbed)).toEqual({
          message: `line one${character}${replace("ada@example.com")}`,
        });
      });
    }
  }

  test("after an escaped backslash the letter that follows is the text's own: the match keeps it", () => {
    // The text is `\nada@example.com`: a backslash, then the address nada@.
    const body: string = JSON.stringify({ path: "\\nada@example.com" });

    expect(body).toBe('{"path":"\\\\nada@example.com"}');
    expect(JSON.parse(scrub(body, builtIn("email"), MASK))).toEqual({
      path: "\\" + MASK("nada@example.com"),
    });
  });

  test("the body #8923 names: a map body whose message has an address after a line break", () => {
    const body: string =
      '{"kvlistValue":{"values":[{"key":"message","value":{"stringValue":"line one\\nada@example.com"}}]}}';

    expect(scrub(body, builtIn("email"))).toBe(
      '{"kvlistValue":{"values":[{"key":"message","value":{"stringValue":"line one\\n[REDACTED]"}}]}}',
    );
  });
});

describe("what comes right after an escape is found, as in the text the application wrote", () => {
  for (const [name, secrets] of Object.entries(SECRETS)) {
    for (const character of ["\n", "\t", "\r"]) {
      test(`${name} at the start of a line (after ${JSON.stringify(character)})`, () => {
        const secret: string = secrets[0]!;
        const body: string = JSON.stringify({
          message: `first line${character}${secret} second line`,
        });
        const scrubbed: string = scrub(body, builtIn(name));

        expect(scrubbed).not.toContain(secret);
        expect(JSON.parse(scrubbed)).toEqual({
          message: `first line${character}[REDACTED] second line`,
        });
      });
    }
  }

  test("a secret written with an escape of its own is found", () => {
    expect(
      JSON.parse(scrub('{"to":"ada\\u0040example.com"}', builtIn("email"))),
    ).toEqual({ to: "[REDACTED]" });
    expect(
      JSON.parse(
        scrub('{"message":"caf\\u00e9 10.0.0.12"}', builtIn("ipAddress")),
      ),
    ).toEqual({ message: "café [REDACTED]" });
  });

  test("a pattern written against the escapes as stored still finds them", () => {
    // A line feed written as backslash and n, as a person reads the stored body.
    expect(
      JSON.parse(scrub('{"m":"one\\ntwo"}', custom("one\\\\ntwo"))),
    ).toEqual({ m: "[REDACTED]" });
    // A path's backslashes as stored, doubled.
    expect(
      JSON.parse(
        scrub(
          '{"p":"C:\\\\Users\\\\ada"}',
          custom("C:\\\\\\\\Users\\\\\\\\\\w+"),
        ),
      ),
    ).toEqual({ p: "[REDACTED]" });
    // And as the application wrote them, single.
    expect(
      JSON.parse(
        scrub('{"p":"C:\\\\Users\\\\ada"}', custom("C:\\\\Users\\\\\\w+")),
      ),
    ).toEqual({ p: "[REDACTED]" });
  });

  test("a built-in pattern reads only the text the application wrote, as it reads an attribute", () => {
    /*
     * As stored, `\n+1 555.123.4567` has a word boundary between the n and
     * the +, which the text - a line break, then + - does not: the + stays,
     * as it does in the same text sent as an attribute.
     */
    const phone: string = "line\n+1 555.123.4567";

    expect(
      JSON.parse(scrub(JSON.stringify({ m: phone }), builtIn("phoneNumber"))),
    ).toEqual({ m: builtIn("phoneNumber").replace(phone, REDACT) });
    expect(builtIn("phoneNumber").replace(phone, REDACT)).toBe(
      "line\n+[REDACTED]",
    );

    /*
     * As stored, `1120\u0035500` ends a Social Security number at the
     * backslash. The application wrote 078-05-11205500 - no such number.
     */
    expect(scrub('{"m":"078-05-1120\\u0035500"}', builtIn("ssn"))).toBe(
      '{"m":"078-05-1120\\u0035500"}',
    );
  });

  test("a pattern written against the JSON text, quotes and all, still matches it", () => {
    const body: string = JSON.stringify({ user: "ada", password: "hunter2" });

    expect(JSON.parse(scrub(body, custom('"password":"[^"]*"')))).toEqual({
      user: "ada",
      "[REDACTED]": "[REDACTED]",
    });
    expect(JSON.parse(scrub(body, custom('(?<="password":")[^"]+')))).toEqual({
      user: "ada",
      password: "[REDACTED]",
    });
  });
});

describe("a match is replaced inside the values it covers, and only there", () => {
  test("a number a rule matches becomes a string of what is left of it", () => {
    expect(scrub('{"phone":5551234567}', builtIn("phoneNumber"))).toBe(
      '{"phone":"[REDACTED]"}',
    );
    expect(
      scrub('{"cards":[4111111111111111,1]}', builtIn("creditCard"), MASK),
    ).toBe(`{"cards":["${MASK("4111111111111111")}",1]}`);
    // A minus sign the match did not take stays in the string.
    expect(scrub('{"n":-5551234567}', builtIn("phoneNumber"))).toBe(
      '{"n":"-[REDACTED]"}',
    );
    // Two matches in one number.
    expect(scrub('{"n":12345678}', custom("\\d{4}"))).toBe(
      '{"n":"[REDACTED][REDACTED]"}',
    );
    // true, false and null too, when a pattern matches them.
    expect(scrub('{"a":null,"b":true,"c":false}', custom("null|true"))).toBe(
      '{"a":"[REDACTED]","b":"[REDACTED]","c":false}',
    );
  });

  test("a match across values hides the part of each it covers, and keeps the punctuation", () => {
    const body: string = JSON.stringify({ a: "x secret=abc", b: "def y" });

    // \S+ reads on past the quote, the comma and the next key.
    expect(JSON.parse(scrub(body, custom("secret=\\S+")))).toEqual({
      a: "x [REDACTED]",
      "[REDACTED]": "[REDACTED] y",
    });
  });

  test("a match of punctuation alone hides nothing", () => {
    const body: string = '{"a": [1, 2], "b": {}}';

    expect(scrub(body, custom('[{}\\[\\]:,"]'))).toBe(body);
  });

  test("a match of no text hides nothing", () => {
    const body: string = JSON.stringify({ a: "xyz" });

    expect(scrub(body, custom("q*"))).toBe(body);
  });

  test("spaces and line breaks between values are kept", () => {
    const body: string = JSON.stringify(
      { a: ["ada@example.com", { b: "x\n10.0.0.1" }] },
      null,
      2,
    );
    const scrubbed: string = scrub(
      scrub(body, builtIn("email")),
      builtIn("ipAddress"),
    );

    expect(scrubbed).toBe(
      JSON.stringify({ a: ["[REDACTED]", { b: "x\n[REDACTED]" }] }, null, 2),
    );
  });

  test("the parts of a text no match covers are kept as they were written", () => {
    const body: string =
      '{"note":"caf\\u00e9 \\/ ada@example.com \\u00e9","other":"\\u0041"}';

    expect(scrub(body, builtIn("email"))).toBe(
      '{"note":"caf\\u00e9 \\/ [REDACTED] \\u00e9","other":"\\u0041"}',
    );
  });

  test("a text no match is found in comes back as the very text", () => {
    const body: string = '{"a":"b\\nc","n":[1,2,3]}';

    expect(scrub(body, builtIn("email"))).toBe(body);
  });

  test("a match over the whole text - the work allowance spent - hides every string and number, and the text stays JSON", () => {
    const body: string = JSON.stringify({
      a: "x",
      b: [1, "y\n", null],
      'k"': false,
      e: "",
    });
    const scrubbed: string = ScrubJsonTextUtil.scrubJsonText({
      jsonText: body,
      findMatches: (text: string): Array<[number, number]> => {
        return [[0, text.length]];
      },
      replaceMatch: REDACT,
      readsAsWritten: false,
    });

    // An empty string has nothing to hide.
    expect(scrubbed).toBe(
      '{"[REDACTED]":"[REDACTED]","[REDACTED]":["[REDACTED]","[REDACTED]","[REDACTED]"],"[REDACTED]":"[REDACTED]","[REDACTED]":""}',
    );
  });

  test("a replacement is written as JSON writes it: quotes, backslashes, control characters and a lone surrogate escaped", () => {
    const scrubbed: string = scrub(
      '{"to":"ada@example.com"}',
      builtIn("email"),
      AWKWARD,
    );

    expect(JSON.parse(scrubbed)).toEqual({ to: AWKWARD("ada@example.com") });
    expect(scrubbed).toBe('{"to":"\\"\\\\\\n\\u0001}a\\ud800"}');
  });
});

describe("a match never splits a character", () => {
  test("a surrogate pair written as it is", () => {
    expect(
      JSON.parse(scrub(JSON.stringify({ t: "a😀b" }), custom("a.|.b"), MASK)),
    ).toEqual({ t: "***" + "***" });
    const brackets: Replace = (match: string): string => {
      return `<${match}>`;
    };

    // a + the first half of 😀 ends after the second half.
    expect(
      JSON.parse(scrub(JSON.stringify({ t: "a😀b" }), custom("a."), brackets)),
    ).toEqual({ t: "<a😀>b" });
    // The second half of 😀 + b starts after it.
    expect(
      JSON.parse(scrub(JSON.stringify({ t: "a😀b" }), custom(".b"), brackets)),
    ).toEqual({ t: "a😀<b>" });
  });

  test("a surrogate pair written as two escapes", () => {
    const brackets: Replace = (match: string): string => {
      return `<${match}>`;
    };

    expect(
      JSON.parse(scrub('{"t":"a\\ud83d\\ude00b"}', custom("a."), brackets)),
    ).toEqual({ t: "<a😀>b" });
    expect(
      JSON.parse(scrub('{"t":"a\\ud83d\\ude00b"}', custom(".b"), brackets)),
    ).toEqual({ t: "a😀<b>" });
  });

  test("an escape: a match of its letters alone hides nothing, one that ends inside it hides it whole", () => {
    // The `u00` of \u00e9 is not text the application wrote.
    expect(scrub('{"t":"caf\\u00e9"}', custom("u00"))).toBe(
      '{"t":"caf\\u00e9"}',
    );
    // A backslash is the start of an escape: the match takes all of it.
    expect(JSON.parse(scrub('{"t":"ab\\"cd"}', custom("b\\\\")))).toEqual({
      t: "a[REDACTED]cd",
    });
  });
});

describe("a JSON text held in a string is read as JSON too, and stays JSON", () => {
  test("a Fluentd record's log line, with an address after a line break in it", () => {
    const line: string = JSON.stringify({
      level: "info",
      msg: "signed in\nada@example.com",
    });
    const body: string = JSON.stringify({ log: line, stream: "stdout" });
    const scrubbed: Record<string, string> = JSON.parse(
      scrub(body, builtIn("email")),
    ) as Record<string, string>;

    expect(JSON.parse(scrubbed["log"]!)).toEqual({
      level: "info",
      msg: "signed in\n[REDACTED]",
    });
    expect(scrubbed["stream"]).toBe("stdout");
  });

  test("a card number at the start of a line inside it is found", () => {
    const body: string = JSON.stringify({
      log: JSON.stringify({ msg: "paid with\n4111 1111 1111 1111" }),
    });
    const scrubbed: Record<string, string> = JSON.parse(
      scrub(body, builtIn("creditCard")),
    ) as Record<string, string>;

    expect(JSON.parse(scrubbed["log"]!)).toEqual({
      msg: "paid with\n[REDACTED]",
    });
  });

  test("a pattern over its keys keeps it JSON", () => {
    const body: string = JSON.stringify({
      payload: JSON.stringify({ password: "hunter2", user: "ada" }),
    });
    const scrubbed: Record<string, string> = JSON.parse(
      scrub(body, custom('"password":"[^"]*"')),
    ) as Record<string, string>;

    expect(JSON.parse(scrubbed["payload"]!)).toEqual({
      "[REDACTED]": "[REDACTED]",
      user: "ada",
    });
  });

  test(`up to ${MAX_JSON_TEXTS_INSIDE_STRINGS} deep; deeper, a JSON text is a text like any other`, () => {
    let value: unknown = { ip: "x\n10.0.0.1" };

    for (
      let level: number = 0;
      level <= MAX_JSON_TEXTS_INSIDE_STRINGS;
      level++
    ) {
      value = { inside: JSON.stringify(value) };
    }

    const body: string = JSON.stringify(value);
    const scrubbed: string = scrub(body, builtIn("ipAddress"));

    // Still JSON at the top, and each level that was read stays JSON.
    let level: unknown = JSON.parse(scrubbed);

    for (
      let depth: number = 0;
      depth < MAX_JSON_TEXTS_INSIDE_STRINGS;
      depth++
    ) {
      level = JSON.parse((level as Record<string, string>)["inside"]!);
    }

    expect(typeof (level as Record<string, string>)["inside"]).toBe("string");
  });
});

describe("scrubText: a JSON text is kept JSON, any other text is scrubbed as it always was", () => {
  test("plain text, and text that only looks like JSON, as the pattern replaces it", () => {
    for (const text of [
      "line one\nada@example.com",
      "{not json ada@example.com",
      "[ada@example.com",
      '"ada@example.com"',
      "",
    ]) {
      expect(
        ScrubJsonTextUtil.scrubText({
          text: text,
          findMatches: (value: string): Array<[number, number]> => {
            return builtIn("email").matchRanges(value);
          },
          replaceMatch: MASK,
          readsAsWritten: false,
          jsonTexts: new ScrubJsonTexts(),
        }),
      ).toBe(builtIn("email").replace(text, MASK));
    }
  });

  test("a JSON text is read with its escapes", () => {
    expect(
      ScrubJsonTextUtil.scrubText({
        text: '  {"m":"a\\nada@example.com"}',
        findMatches: (value: string): Array<[number, number]> => {
          return builtIn("email").matchRanges(value);
        },
        replaceMatch: REDACT,
        readsAsWritten: false,
        jsonTexts: new ScrubJsonTexts(),
      }),
    ).toBe('  {"m":"a\\n[REDACTED]"}');
  });

  test("each text of a record is parsed once, however many rules read it", () => {
    const jsonTexts: ScrubJsonTexts = new ScrubJsonTexts();
    const parse: ReturnType<typeof getJestSpyOn> = getJestSpyOn(JSON, "parse");
    let text: string = JSON.stringify({ a: "ada@example.com", b: "10.0.0.1" });

    try {
      for (const name of ["email", "ipAddress", "ssn", "phoneNumber"]) {
        text = ScrubJsonTextUtil.scrubText({
          text: text,
          findMatches: (value: string): Array<[number, number]> => {
            return builtIn(name).matchRanges(value);
          },
          replaceMatch: REDACT,
          readsAsWritten: false,
          jsonTexts: jsonTexts,
        });
      }

      // Once to know it is JSON; what each rule wrote is known to be.
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }

    expect(text).toBe('{"a":"[REDACTED]","b":"[REDACTED]"}');
  });

  test("mayBeJsonListOrMap looks past JSON's spaces at the first character", () => {
    expect(ScrubJsonTextUtil.mayBeJsonListOrMap(' \t\n\r{"a":1}')).toBe(true);
    expect(ScrubJsonTextUtil.mayBeJsonListOrMap("[1]")).toBe(true);
    expect(ScrubJsonTextUtil.mayBeJsonListOrMap('"text"')).toBe(false);
    expect(ScrubJsonTextUtil.mayBeJsonListOrMap("\u00a0{}")).toBe(false);
    expect(ScrubJsonTextUtil.mayBeJsonListOrMap("   ")).toBe(false);
    expect(ScrubJsonTextUtil.mayBeJsonListOrMap("")).toBe(false);
  });
});

/*
 * ---------------------------------------------------------------------------
 * PROPERTIES, over seeded random lists and maps (JsonTextCases): escapes,
 * accented and astral characters, U+2028, secrets at every boundary - as
 * keys, as numbers, and inside JSON texts held in strings - each written
 * compact, indented and escaped.
 * ---------------------------------------------------------------------------
 */
describe("properties over random JSON texts", () => {
  const CASES: number = 120;

  for (const style of JSON_STYLES) {
    for (const name of Object.keys(BUILT_IN)) {
      for (const [action, replace] of Object.entries(REPLACEMENTS)) {
        test(`${style}, ${name}, ${action}: still JSON, and each string and number as the same text sent as an attribute`, () => {
          forEachCase(CASES, 1000, (random: Random, seed: number): void => {
            const body: string = writeJson(
              randomJsonListOrMap(random, { jsonInsideStrings: 2 }),
              style,
              random,
            );
            const scrubbed: string = scrub(body, builtIn(name), replace);
            const label: string = `seed ${seed}: ${body}`;

            expect({ label, json: isJsonListOrMap(scrubbed) }).toEqual({
              label,
              json: true,
            });
            expectScrubbedAsAttributes({
              original: body,
              scrubbed: scrubbed,
              regex: builtIn(name),
              replace: replace,
              depth: 0,
              label: label,
            });
          });
        });
      }
    }
  }

  /*
   * Custom patterns that read past what a value is: quotes, backslashes,
   * escape letters, punctuation, numbers and literals, single code units,
   * spaces, look-behinds - and one that matches no text.
   */
  const ADVERSARIAL: Array<string> = [
    ".",
    "\\S+",
    '[^"]+',
    '"[^"]*"',
    "\\\\",
    "\\\\.",
    "n",
    "u00",
    "[{}\\[\\]:,]",
    "\\d+",
    "true|false|null",
    ".{3}",
    '(?<=")\\w+',
    "\\s+",
    "[\\s\\S]{5}",
    "\\\\u[0-9a-f]{4}",
    "x*",
    "[^\\x00-\\x7f]",
    "\\b\\w",
  ];

  for (const style of JSON_STYLES) {
    for (const source of ADVERSARIAL) {
      test(`${style}, custom ${source}: still JSON, the same tokens, and no character split`, () => {
        const regex: ScrubRegExp = custom(source);

        forEachCase(60, 5000, (random: Random, seed: number): void => {
          const body: string = writeJson(
            randomJsonListOrMap(random, { jsonInsideStrings: 1 }),
            style,
            random,
          );
          const label: string = `seed ${seed}: ${body}`;

          for (const replace of [REDACT, MASK, AWKWARD]) {
            const scrubbed: string = scrub(body, regex, replace);

            expect({ label, json: isJsonListOrMap(scrubbed) }).toEqual({
              label,
              json: true,
            });

            const before: Array<JsonToken> = readJsonTokens(body);
            const after: Array<JsonToken> = readJsonTokens(scrubbed);

            // The same punctuation and spaces, and every value still one.
            expect({
              label,
              tokens: after.map((token: JsonToken): string => {
                return token.kind === "string" || token.kind === "scalar"
                  ? "value"
                  : token.text;
              }),
            }).toEqual({
              label,
              tokens: before.map((token: JsonToken): string => {
                return token.kind === "string" || token.kind === "scalar"
                  ? "value"
                  : token.text;
              }),
            });

            // Strings stay strings; only a matched number becomes one.
            before.forEach((token: JsonToken, index: number): void => {
              const out: JsonToken = after[index]!;

              if (token.kind !== "string") {
                return;
              }

              expect({ label, kind: out.kind }).toEqual({
                label,
                kind: "string",
              });

              /*
               * A character the text had whole is never split. (The
               * awkward replacement writes a lone surrogate of its own.)
               */
              if (
                replace !== AWKWARD &&
                !hasLoneSurrogate(JSON.parse(token.text) as string)
              ) {
                expect({
                  label,
                  split: hasLoneSurrogate(JSON.parse(out.text) as string),
                }).toEqual({ label, split: false });
              }
            });
          }
        });
      });
    }
  }

  test("a text no rule matches comes back as the very text, written any way", () => {
    forEachCase(200, 9000, (random: Random): void => {
      const style: JsonStyle = JSON_STYLES[Math.floor(random() * 3)]!;
      const body: string = writeJson(
        randomJsonListOrMap(random, { jsonInsideStrings: 2 }),
        style,
        random,
      );

      expect(scrub(body, custom("NO-SUCH-TEXT-[0-9]{40}"))).toBe(body);
    });
  });

  test("scrubbing twice with a rule whose replacement it does not match changes nothing more", () => {
    forEachCase(200, 12000, (random: Random): void => {
      const body: string = writeJson(
        randomJsonListOrMap(random, { jsonInsideStrings: 2 }),
        "escaped",
        random,
      );

      for (const name of Object.keys(BUILT_IN)) {
        const once: string = scrub(body, builtIn(name));

        expect(scrub(once, builtIn(name))).toBe(once);
      }
    });
  });
});
