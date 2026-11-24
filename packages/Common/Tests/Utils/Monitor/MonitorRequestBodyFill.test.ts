import { describe, expect, test } from "@jest/globals";
import Dictionary from "../../../Types/Dictionary";
import MonitorRequestBody, {
  MonitorRequestBodyReading,
} from "../../../Utils/Monitor/MonitorRequestBody";
import { getReferencedName } from "../../../Utils/Monitor/MonitorSecretReferences";
import { fillTotpCodes } from "../../../Utils/Monitor/MonitorSecretTotp";
import { TemplatePlaceholder } from "../../../Utils/TemplatePlaceholders";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import JSON5 from "json5";

/*
 * A MONITOR SECRET IS WRITTEN AS ITS PLACE IN A JSON BODY NEEDS IT (#10735).
 *
 * The server filled a {{monitorSecrets.NAME}} into an API monitor's body as
 * plain text, so a password ab"c in {"password": "{{monitorSecrets.P}}"}
 * ended the string early: the body was no JSON any more, and since #9737
 * the check fails at once with "The request body is not valid JSON", and no
 * request goes out. A secret inside a string is now escaped for that
 * string. One on its own is still written as it is: a secret 1,2,3 in
 * [{{monitorSecrets.Ids}}] is three numbers, as it always was, not the
 * string "1,2,3" that escaping everything would make of it.
 */

type Values = Dictionary<string>;

// What the server does: each {{monitorSecrets.NAME}} the values name, filled in.
function fill(body: string, values: Values): string {
  return MonitorRequestBody.fillSecrets(body, new Map(Object.entries(values)));
}

// The value a filled body holds, as the API it is sent to reads it.
function parsed(body: string): unknown {
  const reading: MonitorRequestBodyReading = MonitorRequestBody.read(body);

  expect(reading.isJson).toBe(true);

  return reading.isJson ? reading.value : undefined;
}

// Values that ended a string, or made one no JSON, when written as they are.
const AWKWARD_VALUES: ReadonlyArray<{ name: string; value: string }> = [
  { name: "a double quote", value: 'ab"c' },
  { name: "a backslash", value: "C:\\Users\\ops" },
  { name: "a backslash before a quote", value: 'end\\"' },
  { name: "a line break", value: "line one\nline two" },
  { name: "a carriage return and a tab", value: "a\r\n\tb" },
  { name: "another control character", value: "bell\u0007 and escape\u001b" },
  { name: "unicode", value: "café 日本 😀 Привет" },
  { name: "line and paragraph separators", value: "a\u2028b\u2029c" },
  { name: "braces", value: "{{monitorSecrets.Other}} {}" },
  { name: "a single quote", value: "it's" },
  { name: "everything at once", value: "\"\\\n\t😀'{}" },
];

describe("a secret inside a JSON string is escaped for that string", () => {
  test("the issue's password: ab\"c stays one string", () => {
    const body: string = fill('{"password": "{{monitorSecrets.Password}}"}', {
      Password: 'ab"c',
    });

    expect(body).toBe('{"password": "ab\\"c"}');
    expect(parsed(body)).toEqual({ password: 'ab"c' });
  });

  test.each(AWKWARD_VALUES)(
    "$name reaches the API exactly",
    ({ value }: { name: string; value: string }) => {
      const body: string = fill(
        '{"user": "ops", "password": "{{monitorSecrets.Password}}", "n": 1}',
        { Password: value },
      );

      expect(parsed(body)).toEqual({ user: "ops", password: value, n: 1 });
      // JSON as JSON.parse reads it, so it is sent byte for byte.
      expect(JSON.parse(body)).toEqual({ user: "ops", password: value, n: 1 });
    },
  );

  test("inside a longer string, with text either side", () => {
    const body: string = fill(
      '[{"auth": "Bearer {{monitorSecrets.Token}} (prod)"}]',
      { Token: 'x"y\\z' },
    );

    expect(parsed(body)).toEqual([{ auth: 'Bearer x"y\\z (prod)' }]);
  });

  test("as a key", () => {
    const body: string = fill('{"{{monitorSecrets.Key}}": true}', {
      Key: 'a"b',
    });

    expect(parsed(body)).toEqual({ 'a"b': true });
  });

  test("a quote one value holds never ends the string of the next", () => {
    const body: string = fill(
      '{"a": "{{monitorSecrets.First}}", "b": "{{monitorSecrets.Second}}", "c": {{monitorSecrets.Count}}}',
      { First: '"', Second: '", "injected": "', Count: "3" },
    );

    expect(parsed(body)).toEqual({ a: '"', b: '", "injected": "', c: 3 });
  });

  test("after an escaped quote the string goes on", () => {
    const body: string = fill('{"say": "\\"{{monitorSecrets.Word}}\\""}', {
      Word: 'hi"',
    });

    expect(parsed(body)).toEqual({ say: '"hi""' });
  });

  test("after an escaped backslash the string has ended", () => {
    const body: string = fill(
      '["path\\\\", {{monitorSecrets.Count}}, "{{monitorSecrets.Name}}"]',
      { Count: "2", Name: 'q"' },
    );

    expect(parsed(body)).toEqual(["path\\", 2, 'q"']);
  });

  test("in a JSON5 string in single quotes, a single quote is escaped too", () => {
    const body: string = fill(
      "{user: 'ops', password: '{{monitorSecrets.Password}}',}",
      { Password: `it's "quoted" \\ and\nnew` },
    );

    expect(JSON5.parse(body)).toEqual({
      user: "ops",
      password: `it's "quoted" \\ and\nnew`,
    });
    // Sent as the JSON it stands for, the value whole.
    expect(parsed(body)).toEqual({
      user: "ops",
      password: `it's "quoted" \\ and\nnew`,
    });
  });

  test("a double quote in a single-quoted string, and the reverse", () => {
    expect(
      parsed(
        fill(`['{{monitorSecrets.A}}', "{{monitorSecrets.B}}"]`, {
          A: `"'`,
          B: `'"`,
        }),
      ),
    ).toEqual([`"'`, `'"`]);
  });
});

describe("a secret on its own is written as it is, as it always was", () => {
  test("the issue's fragment: 1,2,3 is three numbers, not a string", () => {
    const body: string = fill("[{{monitorSecrets.Ids}}]", { Ids: "1,2,3" });

    expect(body).toBe("[1,2,3]");
    expect(parsed(body)).toEqual([1, 2, 3]);
  });

  test("a number, true and null as values", () => {
    expect(
      parsed(
        fill(
          '{"count": {{monitorSecrets.Count}}, "on": {{monitorSecrets.On}}, "none": {{monitorSecrets.None}}}',
          { Count: "42", On: "true", None: "null" },
        ),
      ),
    ).toEqual({ count: 42, on: true, none: null });
  });

  test("JSON text of its own: an object, a string literal", () => {
    const body: string = fill(
      '{"filter": {{monitorSecrets.Filter}}, "name": {{monitorSecrets.Name}}}',
      { Filter: '{"region": "eu", "tags": ["a"]}', Name: '"ab\\"c"' },
    );

    expect(parsed(body)).toEqual({
      filter: { region: "eu", tags: ["a"] },
      name: 'ab"c',
    });
  });

  test("the whole body", () => {
    const body: string = fill("{{monitorSecrets.Body}}", {
      Body: '[{"id": 1}]',
    });

    expect(body).toBe('[{"id": 1}]');
  });

  test("a value that is no JSON there is written as it is: the body says so, not the fill", () => {
    const body: string = fill('{"a": {{monitorSecrets.Word}}}', {
      Word: 'say "hi"',
    });

    expect(body).toBe('{"a": say "hi"}');
    expect(MonitorRequestBody.read(body).isJson).toBe(false);
  });

  test("in a comment, a quote opens no string", () => {
    const body: string = fill(
      '// a "quoted" note\n/* and "another */ {"a": {{monitorSecrets.N}}, "b": "{{monitorSecrets.S}}"}',
      { N: "5", S: 'x"y' },
    );

    expect(parsed(body)).toEqual({ a: 5, b: 'x"y' });
  });

  test("in a comment, a placeholder is written as it is", () => {
    const body: string = fill('{"a": 1} // sent by {{monitorSecrets.Team}}', {
      Team: 'ops"',
    });

    expect(body).toBe('{"a": 1} // sent by ops"');
  });
});

describe("what is filled, and where", () => {
  test("a placeholder with no value is left as written", () => {
    expect(
      fill(
        '{"a": "{{monitorSecrets.Missing}}", "b": {{monitorSecrets.Gone}}}',
        {
          Other: '"',
        },
      ),
    ).toBe('{"a": "{{monitorSecrets.Missing}}", "b": {{monitorSecrets.Gone}}}');
  });

  test("a placeholder that names no secret is left as written", () => {
    expect(
      fill('{"a": "{{ monitorSecrets.Spaced }}", "b": "{{other.Name}}"}', {
        Spaced: '"',
        Name: '"',
      }),
    ).toBe('{"a": "{{ monitorSecrets.Spaced }}", "b": "{{other.Name}}"}');
  });

  test("a body with no placeholder is the body", () => {
    expect(fill('{"a": "b"}', { A: '"' })).toBe('{"a": "b"}');
    expect(fill("", { A: '"' })).toBe("");
  });

  test.each([
    { name: "XML", body: "<login><pass>{{monitorSecrets.P}}</pass></login>" },
    { name: "form fields", body: "user=ops&pass={{monitorSecrets.P}}" },
    { name: "plain text", body: 'token "{{monitorSecrets.P}}"' },
  ])(
    "a body that is not JSON ($name) is filled as it is",
    ({ body }: { name: string; body: string }) => {
      expect(fill(body, { P: 'a"b\\c\nd' })).toBe(
        body.replace("{{monitorSecrets.P}}", 'a"b\\c\nd'),
      );
    },
  );

  test("every placeholder of a body is filled, each once", () => {
    expect(
      fill(
        '["{{monitorSecrets.A}}", {{monitorSecrets.A}}, "{{monitorSecrets.A}}{{monitorSecrets.A}}"]',
        { A: "7" },
      ),
    ).toBe('["7", 7, "77"]');
  });

  test("a value holding a placeholder is not filled again", () => {
    expect(
      parsed(
        fill('["{{monitorSecrets.A}}", "{{monitorSecrets.B}}"]', {
          A: "{{monitorSecrets.B}}",
          B: "b",
        }),
      ),
    ).toEqual(["{{monitorSecrets.B}}", "b"]);
  });

  test("$ patterns in a value are taken literally", () => {
    expect(
      parsed(fill('{"a": "{{monitorSecrets.A}}"}', { A: "$& $1 $' $`" })),
    ).toEqual({ a: "$& $1 $' $`" });
  });

  test("no values leave the body as written", () => {
    const body: string = '{"a": "{{monitorSecrets.A}}"}';

    expect(MonitorRequestBody.fillSecrets(body, new Map())).toBe(body);
  });

  test("any placeholder can be filled: each is asked for, in order, once", () => {
    const asked: Array<string> = [];

    const body: string = MonitorRequestBody.fillPlaceholders({
      body: '["{{a}}", {{b}}, "{{monitorSecrets.C}}"]',
      getValue: (placeholder: TemplatePlaceholder): string | undefined => {
        asked.push(placeholder.inner);

        return getReferencedName(placeholder) === null ? '"' : undefined;
      },
    });

    expect(asked).toEqual(["a", "b", "monitorSecrets.C"]);
    expect(body).toBe('["\\"", ", "{{monitorSecrets.C}}"]');
  });
});

describe("the probe's one-time codes agree", () => {
  /*
   * The probe fills a one-time code into each attempt's body itself
   * (MonitorSecretTotp's fillTotpCodes), as it is. A code is digits, so
   * that is what this fill writes too, inside a string and on its own.
   */
  test.each([
    '{"otp": "{{monitorSecrets.Code}}"}',
    '{"otp": {{monitorSecrets.Code}}}',
    '[{"otp": "{{monitorSecrets.Code}}"}, {{monitorSecrets.Code}}]',
    "{otp: '{{monitorSecrets.Code}}'}",
    "code={{monitorSecrets.Code}}",
  ])("%s", (body: string) => {
    const random: SeededRandom = seededRandom(10735);

    for (let draw: number = 0; draw < 20; draw++) {
      const code: string = String(random(1000000)).padStart(6, "0");

      expect(fill(body, { Code: code })).toBe(
        fillTotpCodes(body, { Code: code }),
      );
    }
  });
});

// Text a drawn secret is built from: whatever a secret can hold.
const SECRET_PIECES: ReadonlyArray<string> = [
  "a",
  "Z",
  "0",
  " ",
  '"',
  "'",
  "\\",
  "\n",
  "\r",
  "\t",
  "\u0000",
  "\u001f",
  "\u2028",
  "é",
  "日本",
  "😀",
  "{",
  "}",
  "[",
  ",",
  ":",
  "/",
  "*",
  "$&",
];

const drawSecret: (random: SeededRandom) => string = (
  random: SeededRandom,
): string => {
  let text: string = "";

  for (let piece: number = random(12); piece > 0; piece--) {
    text += SECRET_PIECES[random(SECRET_PIECES.length)];
  }

  return text;
};

describe("any secret inside a string, in any body, reaches the API exactly", () => {
  test("drawn secrets in drawn bodies", () => {
    const random: SeededRandom = seededRandom(107350);

    for (let draw: number = 0; draw < 400; draw++) {
      const first: string = drawSecret(random);
      const second: string = drawSecret(random);
      const count: number = random(1000);
      const layouts: Array<{ body: string; value: unknown }> = [
        {
          body: '{"a": "{{monitorSecrets.First}}", "b": [{{monitorSecrets.Count}}, "x{{monitorSecrets.Second}}y"]}',
          value: { a: first, b: [count, `x${second}y`] },
        },
        {
          body: '[\n  "{{monitorSecrets.Second}}",\n  {"k": "{{monitorSecrets.First}}"}\n]',
          value: [second, { k: first }],
        },
        {
          body: '{first: \'{{monitorSecrets.First}}\', /* " */ second: "{{monitorSecrets.Second}}", count: {{monitorSecrets.Count}},}',
          value: { first: first, second: second, count: count },
        },
        {
          body: '"{{monitorSecrets.First}}{{monitorSecrets.Second}}"',
          value: `${first}${second}`,
        },
      ];
      const layout: { body: string; value: unknown } = layouts[
        random(layouts.length)
      ] as { body: string; value: unknown };

      const body: string = fill(layout.body, {
        First: first,
        Second: second,
        Count: String(count),
      });

      expect({ draw, value: parsed(body) }).toEqual({
        draw,
        value: layout.value,
      });
    }
  });
});
