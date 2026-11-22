import { describe, expect, test } from "@jest/globals";
import {
  JsonSyntaxCheckResult,
  checkJsonSyntax,
} from "../../../Types/Code/JsonSyntax";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRequestBody, {
  MonitorRequestBodyReading,
  REQUEST_BODY_NOT_JSON_MESSAGE,
} from "../../../Utils/Monitor/MonitorRequestBody";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * AN API MONITOR'S REQUEST BODY IS ANY JSON VALUE, SENT AS WRITTEN (#9737).
 *
 * The probe read a body with JSONFunctions.parseJSONObject, so a body that
 * was an array - "[{\"id\": 1}]" - or a single value threw "Expected
 * JSONObject, but got JSONArray" and was never sent: every check failed.
 * Every reader reads a body through MonitorRequestBody now, and these are
 * the answers they all share: what is a body, what is refused, and what an
 * attempt sends.
 */

const ARRAY_BODY: string = '[{"id": 1}, {"id": 2}]';

// Bodies that are JSON as written, each of a different kind.
const JSON_BODIES: ReadonlyArray<{ name: string; body: string }> = [
  { name: "an object", body: '{"status": "ok", "count": 2}' },
  { name: "an array", body: ARRAY_BODY },
  { name: "an empty array", body: "[]" },
  { name: "an empty object", body: "{}" },
  { name: "a string", body: '"hello"' },
  { name: "a number", body: "42" },
  { name: "a negative fraction", body: "-0.5" },
  { name: "true", body: "true" },
  { name: "false", body: "false" },
  { name: "null", body: "null" },
  { name: "nested arrays", body: "[[1, [2, [3]]], {}]" },
  { name: "laid out over lines", body: '[\n  {\n    "id": 1\n  }\n]\n' },
];

// Bodies JSON5 reads, as the probe always has: sent as the JSON they stand for.
const JSON5_BODIES: ReadonlyArray<{
  name: string;
  body: string;
  json: string;
}> = [
  { name: "a trailing comma", body: '{"a": 1,}', json: '{"a":1}' },
  { name: "single quotes", body: "['a', 'b']", json: '["a","b"]' },
  { name: "an unquoted key", body: "{a: [1, 2]}", json: '{"a":[1,2]}' },
  {
    name: "a comment",
    body: '// the batch\n[{"id": 1}]',
    json: '[{"id":1}]',
  },
  { name: "a hexadecimal number", body: "[0x1F]", json: "[31]" },
];

// Bodies that are not JSON, whatever placeholders they hold.
const NOT_JSON_BODIES: ReadonlyArray<{ name: string; body: string }> = [
  { name: "plain text", body: "hello world" },
  { name: "XML", body: "<ping><id>1</id></ping>" },
  { name: "form fields", body: "a=1&b=2" },
  { name: "an unclosed array", body: '[{"id": 1}' },
  { name: "a missing value", body: '{"a": }' },
  { name: "two values", body: "[1] [2]" },
  { name: "an unclosed string", body: '["text]' },
];

// Placeholders the server or the probe fill in, wherever they stand.
const BODIES_WITH_PLACEHOLDERS: ReadonlyArray<{ name: string; body: string }> =
  [
    {
      name: "inside a string",
      body: '[{"token": "Bearer {{monitorSecrets.ApiKey}}"}]',
    },
    { name: "as a whole value", body: '{"count": {{monitorSecrets.Count}}}' },
    { name: "as an array element", body: "[{{monitorSecrets.Id}}, 2]" },
    { name: "as a key", body: '{"{{monitorSecrets.Key}}": true}' },
    { name: "as the whole body", body: "{{monitorSecrets.Body}}" },
    {
      name: "a one-time code",
      body: '[{"otp": "{{monitorSecrets.LoginCode}}"}]',
    },
    {
      name: "in a loop",
      body: "[{{#each monitorSecrets.Ids}}{{this}},{{/each}} 0]",
    },
  ];

describe("the body there is to send", () => {
  test("is the text as written, every kind of JSON value included", () => {
    for (const { body } of JSON_BODIES) {
      expect(MonitorRequestBody.getText(body)).toBe(body);
    }
  });

  test("is none for an empty box, or one of only whitespace", () => {
    for (const empty of ["", " ", "\n", "\t \r\n "]) {
      expect(MonitorRequestBody.getText(empty)).toBeUndefined();
    }
  });

  test("is none for anything that is not text", () => {
    for (const notText of [undefined, null, 42, true, {}, [], { a: 1 }]) {
      expect(MonitorRequestBody.getText(notText)).toBeUndefined();
    }
  });
});

describe("a body as stored, read as text", () => {
  test("text is kept exactly as written, JSON5 and whitespace too", () => {
    for (const body of [
      ARRAY_BODY,
      "  [1, 2]  \n",
      "{a: 1,}",
      "not json",
      "",
      "{{monitorSecrets.Body}}",
    ]) {
      expect(MonitorRequestBody.readWritten(body)).toBe(body);
    }
  });

  test("none is none", () => {
    expect(MonitorRequestBody.readWritten(undefined)).toBeUndefined();
    expect(MonitorRequestBody.readWritten(null)).toBeUndefined();
  });

  test("a body an API client wrote as a JSON value is that value's JSON", () => {
    expect(MonitorRequestBody.readWritten([{ id: 1 }, { id: 2 }])).toBe(
      '[\n  {\n    "id": 1\n  },\n  {\n    "id": 2\n  }\n]',
    );
    expect(MonitorRequestBody.readWritten({ status: "ok" })).toBe(
      '{\n  "status": "ok"\n}',
    );
    expect(MonitorRequestBody.readWritten(42)).toBe("42");
    expect(MonitorRequestBody.readWritten(false)).toBe("false");
    expect(MonitorRequestBody.readWritten([])).toBe("[]");
  });

  test("a value it reads as text is the same value read back", () => {
    const random: SeededRandom = seededRandom(9737);

    for (let draw: number = 0; draw < 200; draw++) {
      // A string is text already, and null is no body: both are read as such above.
      const value: unknown = drawJsonValue(random, 3);

      if (typeof value === "string" || value === null) {
        continue;
      }

      const text: string | undefined = MonitorRequestBody.readWritten(value);

      expect(typeof text).toBe("string");
      expect(JSON.parse(text as string)).toEqual(value);
      expect(MonitorRequestBody.getProblem(text)).toBeNull();
    }
  });
});

describe("what the form, the API and the code editor refuse", () => {
  test.each(JSON_BODIES)("$name is a body", ({ body }: { body: string }) => {
    expect(MonitorRequestBody.getProblem(body)).toBeNull();
    expect(
      MonitorRequestBody.getUnreadableError({
        monitorType: MonitorType.API,
        requestBody: body,
      }),
    ).toBeNull();
  });

  test.each(JSON5_BODIES)(
    "JSON5 with $name is a body, as the probe reads one",
    ({ body }: { body: string }) => {
      expect(MonitorRequestBody.getProblem(body)).toBeNull();
    },
  );

  test.each(BODIES_WITH_PLACEHOLDERS)(
    "a placeholder $name is a body",
    ({ body }: { body: string }) => {
      expect(MonitorRequestBody.getProblem(body)).toBeNull();
    },
  );

  test("no body is a body", () => {
    for (const empty of [undefined, null, "", "   \n"]) {
      expect(MonitorRequestBody.getProblem(empty)).toBeNull();
      expect(
        MonitorRequestBody.getUnreadableError({
          monitorType: MonitorType.API,
          requestBody: empty,
        }),
      ).toBeNull();
    }
  });

  test.each(NOT_JSON_BODIES)(
    "$name is refused, with where it stops being JSON",
    ({ body }: { body: string }) => {
      const problem: JsonSyntaxCheckResult | null =
        MonitorRequestBody.getProblem(body);

      expect(problem).not.toBeNull();
      expect(problem!.isValid).toBe(false);
      expect(problem!.line).toEqual(expect.any(Number));
      expect(problem!.column).toEqual(expect.any(Number));
      expect(
        MonitorRequestBody.getUnreadableError({
          monitorType: MonitorType.API,
          requestBody: body,
        }),
      ).toBe(REQUEST_BODY_NOT_JSON_MESSAGE);
    },
  );

  test("a placeholder does not make text JSON", () => {
    expect(
      MonitorRequestBody.getProblem("token={{monitorSecrets.ApiKey}}"),
    ).not.toBeNull();
  });

  test("only an API monitor's body is judged: no other type sends one", () => {
    for (const monitorType of [
      MonitorType.Website,
      MonitorType.Ping,
      MonitorType.IncomingRequest,
      undefined,
      null,
    ]) {
      expect(
        MonitorRequestBody.getUnreadableError({
          monitorType: monitorType,
          requestBody: "<ping/>",
        }),
      ).toBeNull();
    }
  });

  test("the sentence says what is wrong and what to do, as a sentence", () => {
    expect(REQUEST_BODY_NOT_JSON_MESSAGE).toBe(
      "This API monitor's request body is not valid JSON. Use an object, an array or a single value such as a string or a number, or leave the body empty.",
    );
  });

  test("the code editor's status line agrees with the form on every body", () => {
    for (const body of [
      ...JSON_BODIES.map((entry: { body: string }): string => {
        return entry.body;
      }),
      ...JSON5_BODIES.map((entry: { body: string }): string => {
        return entry.body;
      }),
      ...NOT_JSON_BODIES.map((entry: { body: string }): string => {
        return entry.body;
      }),
      ...BODIES_WITH_PLACEHOLDERS.map((entry: { body: string }): string => {
        return entry.body;
      }),
    ]) {
      // The editor of the form's field is handed allowJSON5, as the probe reads.
      expect({
        body,
        refused: !checkJsonSyntax(body, { allowJSON5: true }).isValid,
      }).toEqual({
        body,
        refused: MonitorRequestBody.getProblem(body) !== null,
      });
    }
  });
});

describe("what an attempt sends", () => {
  test.each(JSON_BODIES)(
    "$name: the text as written, byte for byte",
    ({ body }: { body: string }) => {
      const reading: MonitorRequestBodyReading = MonitorRequestBody.read(body);

      expect(reading).toEqual({
        isJson: true,
        json: body,
        value: JSON.parse(body),
      });
    },
  );

  test("no number is rounded, no key moved or dropped", () => {
    for (const body of [
      "[12345678901234567890]",
      '{"price": 1.10, "big": 1e400}',
      '{"b": 1, "a": 2, "b": 3}',
      '{"__proto__": {"admin": true}}',
      '["caf\\u00e9", "\\ud83d\\ude00"]',
    ]) {
      const reading: MonitorRequestBodyReading = MonitorRequestBody.read(body);

      expect(reading.isJson).toBe(true);
      expect(reading.isJson && reading.json).toBe(body);
    }
  });

  test.each(JSON5_BODIES)(
    "JSON5 with $name: the JSON it stands for",
    ({ body, json }: { body: string; json: string }) => {
      const reading: MonitorRequestBodyReading = MonitorRequestBody.read(body);

      expect(reading.isJson).toBe(true);
      expect(reading.isJson && reading.json).toBe(json);
    },
  );

  test.each(NOT_JSON_BODIES)(
    "$name: nothing, and where it stops being JSON",
    ({ body }: { body: string }) => {
      const reading: MonitorRequestBodyReading = MonitorRequestBody.read(body);

      expect(reading.isJson).toBe(false);

      if (!reading.isJson) {
        expect(reading.line).toBeGreaterThanOrEqual(1);
        expect(reading.column).toBeGreaterThanOrEqual(1);
      }
    },
  );

  test("a placeholder left as written is not JSON once it is sent", () => {
    expect(
      MonitorRequestBody.read('{"count": {{monitorSecrets.Missing}}}').isJson,
    ).toBe(false);
    // Inside a string it is text like any other, sent as written.
    expect(
      MonitorRequestBody.read('["{{monitorSecrets.Missing}}"]').isJson,
    ).toBe(true);
  });

  test("every value, written any way JSON is written, is sent as written", () => {
    const random: SeededRandom = seededRandom(20240304);

    for (let draw: number = 0; draw < 300; draw++) {
      const value: unknown = drawJsonValue(random, 4);
      const indent: string | number | undefined = [undefined, 2, "\t", 4][
        random(4)
      ];
      const body: string = JSON.stringify(value, null, indent);

      expect(MonitorRequestBody.getProblem(body)).toBeNull();

      const reading: MonitorRequestBodyReading = MonitorRequestBody.read(body);

      expect(reading.isJson).toBe(true);

      if (reading.isJson) {
        expect(reading.json).toBe(body);
        expect(reading.value).toEqual(value);
      }
    }
  });
});

describe("a body sent as a form's fields", () => {
  test("when the Content-Type, named in any case, is a form", () => {
    for (const headers of [
      { "Content-Type": "application/x-www-form-urlencoded" },
      { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      { "CONTENT-TYPE": "Application/X-WWW-Form-Urlencoded" },
      { "Content-Type": "multipart/form-data; boundary=x" },
    ]) {
      expect(MonitorRequestBody.isSentAsForm(headers)).toBe(true);
    }
  });

  test("never otherwise", () => {
    for (const headers of [
      undefined,
      {},
      { "Content-Type": "application/json" },
      { "Content-Type": "text/plain" },
      { Accept: "application/x-www-form-urlencoded" },
      { "X-Content-Type": "multipart/form-data" },
    ]) {
      expect(MonitorRequestBody.isSentAsForm(headers)).toBe(false);
    }
  });

  test("only an object has fields", () => {
    expect(MonitorRequestBody.isObject({ a: 1 })).toBe(true);
    expect(MonitorRequestBody.isObject({})).toBe(true);

    for (const value of [[], [{ a: 1 }], "a=1", 1, true, null, undefined]) {
      expect(MonitorRequestBody.isObject(value)).toBe(false);
    }
  });
});

// Text a drawn string is built from: letters, scripts, escapes, emoji.
const STRING_PIECES: ReadonlyArray<string> = [
  "a",
  "Z",
  "0",
  " ",
  "é",
  "日本",
  "مرحبا",
  '"',
  "\\",
  "/",
  "\n",
  "\t",
  // A line separator, which JSON keeps in a string.
  String.fromCharCode(0x2028),
  "😀",
  "{",
  "}",
  "[",
  ",",
  ":",
];

const drawString: (random: SeededRandom) => string = (
  random: SeededRandom,
): string => {
  let text: string = "";

  for (let piece: number = random(6); piece > 0; piece--) {
    text += STRING_PIECES[random(STRING_PIECES.length)];
  }

  return text;
};

// A JSON value: an object, an array or a single value, nested up to `depth`.
const drawJsonValue: (random: SeededRandom, depth: number) => unknown = (
  random: SeededRandom,
  depth: number,
): unknown => {
  const kind: number = random(depth > 0 ? 8 : 6);

  switch (kind) {
    case 0:
      return null;
    case 1:
      return random(2) === 0;
    case 2:
      return random(2000001) - 1000000;
    case 3:
      return (random(2000001) - 1000000) / 64;
    case 4:
    case 5:
      return drawString(random);
    case 6: {
      const items: Array<unknown> = [];

      for (let item: number = random(4); item > 0; item--) {
        items.push(drawJsonValue(random, depth - 1));
      }

      return items;
    }
    default: {
      const object: Record<string, unknown> = {};

      for (let key: number = random(4); key > 0; key--) {
        object[`${drawString(random)}${key}`] = drawJsonValue(
          random,
          depth - 1,
        );
      }

      return object;
    }
  }
};
