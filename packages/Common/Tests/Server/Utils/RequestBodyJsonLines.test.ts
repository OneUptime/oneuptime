import RequestBodyJson, {
  MAX_UNPARSED_JSON_LINES,
  NDJSON_CONTENT_TYPES,
  isNdjsonContentType,
} from "../../../Server/Utils/RequestBodyJson";
import {
  LARGE_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
} from "../../../Server/Utils/RequestBodyLimit";
import {
  TOO_MANY_JSON_VALUES_TYPE,
  getTooManyJsonValuesMessage,
} from "../../../Server/Utils/RequestBodyRefusal";
import { JsonElementLimit } from "../../../Utils/JsonElementCount";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A BODY OF NEWLINE-DELIMITED JSON IS READ AS ITS VALUES, A LINE AT A TIME,
 * EACH LINE COUNTED BEFORE IT IS PARSED (#10769).
 *
 * Fluentd's HTTP output sends application/x-ndjson, one record a line,
 * unless json_array is set, and Fluent Bit's http output does with format
 * json_lines. RequestBodyJson.parseLines reads such a body as its values,
 * held to the route's limit as a JSON body is, before JSON.parse sees a
 * line: a line that is no JSON is kept as its text.
 */

const json: (value: unknown) => string = (value: unknown): string => {
  return JSON.stringify(value);
};

const lines: (...items: Array<string>) => Buffer = (
  ...items: Array<string>
): Buffer => {
  return Buffer.from(items.join("\n"));
};

// A limit small enough to cross in a test.
const SMALL: RequestBodyLimit = {
  bytes: 1024 * 1024,
  values: 100,
  objectsArraysAndStrings: 100,
};

const refusalOf: (run: () => unknown) => unknown = (
  run: () => unknown,
): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }

  return null;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isNdjsonContentType", () => {
  test.each([
    ["application/x-ndjson", true],
    ["application/ndjson", true],
    ["application/jsonl", true],
    ["Application/X-NDJSON", true],
    ["application/x-ndjson; charset=utf-8", true],
    ["  application/jsonl ;q=1", true],
    ["application/json", false],
    ["application/x-ndjson+json", false],
    ["text/plain", false],
    ["application/x-protobuf", false],
    ["", false],
  ])("%s: %s", (contentType: string, expected: boolean) => {
    expect(isNdjsonContentType(contentType)).toBe(expected);
  });

  test("no Content-Type is none", () => {
    expect(isNdjsonContentType(undefined)).toBe(false);
  });

  test("names the types Fluentd and Fluent Bit send, and JSON Lines'", () => {
    // Fluentd's out_http and Fluent Bit's FLB_HTTP_MIME_NDJSON; jsonlines.org's.
    expect([...NDJSON_CONTENT_TYPES]).toEqual([
      "application/x-ndjson",
      "application/ndjson",
      "application/jsonl",
    ]);
  });
});

describe("parseLines reads one value a line", () => {
  test("records as Fluentd's json formatter writes them, a line feed after each", () => {
    const records: Array<Record<string, unknown>> = [
      { message: "order placed", level: "info" },
      { message: "payment declined", level: "error", code: 402 },
    ];

    expect(
      RequestBodyJson.parseLines(
        Buffer.from(`${json(records[0])}\n${json(records[1])}\n`),
        LARGE_REQUEST_BODY_LIMIT,
      ),
    ).toEqual(records);
  });

  test("the same records with or without a last line feed, with CRLF, blank lines and spaces around", () => {
    const record: Record<string, unknown> = { message: "a", nested: { b: 1 } };
    const expected: Array<unknown> = [record, record, record];

    for (const body of [
      `${json(record)}\n${json(record)}\n${json(record)}`,
      `${json(record)}\r\n${json(record)}\r\n${json(record)}\r\n`,
      `\n\n${json(record)}\n   \n\t${json(record)}  \r\n\r\n${json(record)}\n\n`,
    ]) {
      expect(
        RequestBodyJson.parseLines(Buffer.from(body), LARGE_REQUEST_BODY_LIMIT),
      ).toEqual(expected);
    }
  });

  test("an empty body, or one of blank lines, has no values", () => {
    for (const body of ["", "\n", "\r\n\r\n", "   \n\t\n"]) {
      expect(
        RequestBodyJson.parseLines(Buffer.from(body), LARGE_REQUEST_BODY_LIMIT),
      ).toEqual([]);
    }
  });

  test("a line of text is kept as its text, trimmed, between the records", () => {
    expect(
      RequestBodyJson.parseLines(
        lines(
          "  order placed  ",
          json({ message: "payment declined" }),
          "2026-11-22 10:00:01 WARN retrying\r",
          json({ message: "retried" }),
        ),
        LARGE_REQUEST_BODY_LIMIT,
      ),
    ).toEqual([
      "order placed",
      { message: "payment declined" },
      "2026-11-22 10:00:01 WARN retrying",
      { message: "retried" },
    ]);
  });

  test("an array and a string are parsed; a number, true, false and null are kept as their text", () => {
    expect(
      RequestBodyJson.parseLines(
        lines(
          json([{ message: "a" }, { message: "b" }]),
          json("a message with \"quotes\" and a \\n"),
          "42",
          "1.50",
          "true",
          "null",
        ),
        LARGE_REQUEST_BODY_LIMIT,
      ),
    ).toEqual([
      [{ message: "a" }, { message: "b" }],
      'a message with "quotes" and a \\n',
      "42",
      "1.50",
      "true",
      "null",
    ]);
  });

  test("a line that looks like JSON and does not parse is kept as its text", () => {
    expect(
      RequestBodyJson.parseLines(
        lines(
          "{not json}",
          '{"cut": "off',
          "[1, 2",
          '"unclosed',
          json({ message: "after them" }),
        ),
        LARGE_REQUEST_BODY_LIMIT,
      ),
    ).toEqual([
      "{not json}",
      '{"cut": "off',
      "[1, 2",
      '"unclosed',
      { message: "after them" },
    ]);
  });

  test("UTF-8 beyond ASCII is read as it was sent, in records and in text", () => {
    expect(
      RequestBodyJson.parseLines(
        lines(json({ message: "ü 中 🚀" }), "naïve — 日本語"),
        LARGE_REQUEST_BODY_LIMIT,
      ),
    ).toEqual([{ message: "ü 中 🚀" }, "naïve — 日本語"]);
  });

  test("reads a Uint8Array that is a view into a larger buffer, as its own bytes", () => {
    const body: Buffer = Buffer.from(
      `garbage before|${json({ message: "a" })}\n${json({ message: "b" })}|garbage after`,
    );
    const start: number = body.indexOf("|") + 1;
    const end: number = body.lastIndexOf("|");
    const view: Uint8Array = new Uint8Array(
      body.buffer,
      body.byteOffset + start,
      end - start,
    );

    expect(RequestBodyJson.parseLines(view, LARGE_REQUEST_BODY_LIMIT)).toEqual(
      [{ message: "a" }, { message: "b" }],
    );
  });
});

describe("parseLines counts every line before JSON.parse sees it", () => {
  test("a body over the limit's values is refused 413 at the line that passes it, in the words a JSON body gets", () => {
    // 60 values a line: the second line passes the 100.
    const line: string = json(Array.from({ length: 59 }, (): number => 1));
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    const error: unknown = refusalOf(() => {
      return RequestBodyJson.parseLines(lines(line, line, line), SMALL);
    });

    expect(error).toMatchObject({
      type: TOO_MANY_JSON_VALUES_TYPE,
      status: 413,
      expose: true,
      passed: JsonElementLimit.Values,
      limit: SMALL.values,
      message: getTooManyJsonValuesMessage(JsonElementLimit.Values, 100),
    });
    // The first line alone was parsed: the one that passed the limit never was.
    expect(parse).toHaveBeenCalledTimes(1);
  });

  test("the objects, arrays and strings among them are held to their own limit", () => {
    const limit: RequestBodyLimit = {
      bytes: 1024 * 1024,
      values: 10000,
      objectsArraysAndStrings: 9,
    };

    // An array and four strings a line: the second line passes the 9.
    expect(
      refusalOf(() => {
        return RequestBodyJson.parseLines(
          lines(json(["a", "b", "c", "d"]), json(["e", "f", "g", "h"])),
          limit,
        );
      }),
    ).toMatchObject({
      status: 413,
      passed: JsonElementLimit.ObjectsArraysAndStrings,
      limit: 9,
    });
  });

  test("exactly the limit is read; one value more is refused", () => {
    const limit: RequestBodyLimit = {
      bytes: 1024 * 1024,
      values: 6,
      objectsArraysAndStrings: 6,
    };

    // {"a":1} is an object, a key and a number: 3 values, 2 of them objects or strings.
    expect(
      RequestBodyJson.parseLines(lines(json({ a: 1 }), json({ b: 2 })), limit),
    ).toEqual([{ a: 1 }, { b: 2 }]);
    expect(
      refusalOf(() => {
        return RequestBodyJson.parseLines(
          lines(json({ a: 1 }), json({ b: 2 }), "x"),
          limit,
        );
      }),
    ).toMatchObject({ status: 413, passed: JsonElementLimit.Values });
  });

  test("a quote left open on one line hides none of the next lines from the count", () => {
    /*
     * Counted as one text, the open quote would make every line after it a
     * string - one value - while each line is still parsed on its own.
     */
    const bomb: string = json(Array.from({ length: 200 }, (): number => 0));

    expect(
      refusalOf(() => {
        return RequestBodyJson.parseLines(lines('"', bomb, bomb), SMALL);
      }),
    ).toMatchObject({ status: 413, passed: JsonElementLimit.Values });
  });

  test("every line counts one value at least: a body holds no more lines than the limit has values", () => {
    // A line of separators alone counts no value of its own.
    const body: Buffer = Buffer.from("}\n".repeat(SMALL.values + 1));

    expect(
      refusalOf(() => {
        return RequestBodyJson.parseLines(body, SMALL);
      }),
    ).toMatchObject({ status: 413, passed: JsonElementLimit.Values });
    expect(
      RequestBodyJson.parseLines(
        Buffer.from("}\n".repeat(SMALL.values)),
        SMALL,
      ),
    ).toHaveLength(SMALL.values);
  });

  test("lines of text are held to the limit too: each becomes a log", () => {
    expect(
      refusalOf(() => {
        return RequestBodyJson.parseLines(
          Buffer.from("order placed\n".repeat(SMALL.values)),
          SMALL,
        );
      }),
    ).toMatchObject({ status: 413 });
  });

  test("a large route's 1,000,000 values: a million empty records are read, one more is refused", () => {
    expect(
      RequestBodyJson.parseLines(
        Buffer.from("{}\n".repeat(1000000)),
        LARGE_REQUEST_BODY_LIMIT,
      ),
    ).toHaveLength(1000000);
    expect(
      refusalOf(() => {
        return RequestBodyJson.parseLines(
          Buffer.from("{}\n".repeat(1000001)),
          LARGE_REQUEST_BODY_LIMIT,
        );
      }),
    ).toMatchObject({
      status: 413,
      limit: LARGE_REQUEST_BODY_LIMIT.values,
    });
  }, 120000);
});

describe("parseLines tries no more than MAX_UNPARSED_JSON_LINES lines that do not parse", () => {
  test("past them, the rest are kept as text untried, records among them too", () => {
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");
    const broken: Array<string> = Array.from(
      { length: MAX_UNPARSED_JSON_LINES + 50 },
      (_: unknown, index: number): string => {
        return `{broken ${index}}`;
      },
    );
    const after: string = json({ message: "after them" });

    const values: Array<unknown> = RequestBodyJson.parseLines(
      lines(...broken, after),
      LARGE_REQUEST_BODY_LIMIT,
    );

    expect(values).toEqual([...broken, after]);
    expect(parse).toHaveBeenCalledTimes(MAX_UNPARSED_JSON_LINES);
  });

  test("below them, a record after broken lines is still read", () => {
    const values: Array<unknown> = RequestBodyJson.parseLines(
      lines("{broken}", "{broken}", json({ message: "read" })),
      LARGE_REQUEST_BODY_LIMIT,
    );

    expect(values).toEqual(["{broken}", "{broken}", { message: "read" }]);
  });

  test("is a thousand", () => {
    expect(MAX_UNPARSED_JSON_LINES).toBe(1000);
  });
});

describe("a body of lines is read as the same body as one JSON array", () => {
  const RANDOM: SeededRandom = seededRandom(10769);

  const WORDS: Array<string> = [
    "order",
    "placed",
    "ü",
    "中",
    "\"quoted\"",
    "back\\slash",
    "tab\there",
    "line\nfeed",
    "{brace}",
    "[bracket]",
    "",
  ];

  const word: () => string = (): string => {
    return WORDS[RANDOM(WORDS.length)]!;
  };

  // A record as a logger writes one: strings, numbers, a nested object, a list.
  const record: () => Record<string, unknown> = (): Record<string, unknown> => {
    const value: Record<string, unknown> = {
      message: `${word()} ${word()}`,
      level: ["info", "warn", "error"][RANDOM(3)],
      count: RANDOM(1000) - 500,
    };

    if (RANDOM(2) === 0) {
      value["kubernetes"] = { pod_name: word(), labels: { app: word() } };
    }

    if (RANDOM(2) === 0) {
      value["tags"] = [word(), RANDOM(10), RANDOM(2) === 0];
    }

    return value;
  };

  const ENDINGS: Array<string> = ["\n", "\r\n", "\n\n", " \n", "\n\t\n"];

  test("for 500 batches of drawn records and line endings", () => {
    for (let batch: number = 0; batch < 500; batch++) {
      const records: Array<Record<string, unknown>> = Array.from(
        { length: 1 + RANDOM(20) },
        record,
      );
      const body: string = records
        .map((item: Record<string, unknown>): string => {
          return `${json(item)}${ENDINGS[RANDOM(ENDINGS.length)]}`;
        })
        .join("");

      expect(
        RequestBodyJson.parseLines(Buffer.from(body), LARGE_REQUEST_BODY_LIMIT),
      ).toEqual(JSON.parse(json(records)));
    }
  });
});
