import RequestBodyJson from "../../../Server/Utils/RequestBodyJson";
import {
  LARGE_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
} from "../../../Server/Utils/RequestBodyLimit";
import {
  TOO_MANY_JSON_VALUES_TYPE,
  getTooManyJsonValuesMessage,
} from "../../../Server/Utils/RequestBodyRefusal";
import JsonElementCounter, {
  JsonElementLimit,
} from "../../../Utils/JsonElementCount";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A JSON STREAM - JSON OBJECTS ONE AFTER ANOTHER - IS READ AS ITS RECORDS,
 * EACH COUNTED BEFORE IT IS PARSED (#10796).
 *
 * Fluent Bit's http output with format json_stream appends each record's
 * JSON to the last with no separator (flb_pack_msgpack_to_json_format: "no
 * separators, e.g: {'ts':abc,'k1':1}{'ts':abc,'k1':2}{N}") and sends it as
 * application/json (plugins/out_http/http.c, FLB_HTTP_MIME_JSON). That is no
 * one JSON document, so it was refused 400 and Fluent Bit dropped the batch.
 * RequestBodyJson.parseStream reads it as its records, held to the route's
 * limit as a JSON body is, each record counted before JSON.parse sees it -
 * and answers null for a body that is no such stream, for its caller to
 * refuse as the JSON it is not.
 */

const json: (value: unknown) => string = (value: unknown): string => {
  return JSON.stringify(value);
};

const stream: (body: string) => Array<unknown> | null = (
  body: string,
): Array<unknown> | null => {
  return RequestBodyJson.parseStream(
    Buffer.from(body),
    LARGE_REQUEST_BODY_LIMIT,
  );
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

/*
 * Records as Fluent Bit's http output writes them: its time under
 * json_date_key ("date" by default, seconds as a double) and the record's
 * own keys, compact JSON (flb_msgpack_raw_to_json_sds).
 */
const FLUENT_BIT_RECORDS: Array<Record<string, unknown>> = [
  {
    date: 1795255200.123456,
    log: "order placed",
    level: "info",
    kubernetes: { pod_name: "checkout-7d9f", labels: { app: "checkout" } },
  },
  {
    date: 1795255201.5,
    log: 'payment declined: "card expired" {code: 402}',
    level: "error",
  },
  { date: 1795255202, log: "ü 中 🚀", tags: ["a", 1, true, null] },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("parseStream reads JSON objects one after another as records", () => {
  test("records as Fluent Bit's json_stream writes them: each record's JSON appended to the last, no separator", () => {
    expect(stream(FLUENT_BIT_RECORDS.map(json).join(""))).toEqual(
      FLUENT_BIT_RECORDS,
    );
  });

  test("the same records with whitespace between them: a line feed after each, as Fluentd's HTTP output sends them as application/json without json_array, CRLF, spaces and tabs", () => {
    for (const separator of ["\n", "\r\n", " ", "\t", "\n\n", " \r\n\t "]) {
      for (const body of [
        FLUENT_BIT_RECORDS.map(json).join(separator),
        `${separator}${FLUENT_BIT_RECORDS.map(json).join(separator)}${separator}`,
        FLUENT_BIT_RECORDS.map((record: Record<string, unknown>): string => {
          return `${json(record)}${separator}`;
        }).join(""),
      ]) {
        expect({ separator, records: stream(body) }).toEqual({
          separator,
          records: FLUENT_BIT_RECORDS,
        });
      }
    }
  });

  test("indented records, as a person writes them, are records too", () => {
    expect(
      stream(
        FLUENT_BIT_RECORDS.map((record: Record<string, unknown>): string => {
          return JSON.stringify(record, null, 2);
        }).join("\n"),
      ),
    ).toEqual(FLUENT_BIT_RECORDS);
  });

  test("two records are a stream", () => {
    expect(stream(`${json(FLUENT_BIT_RECORDS[0])}{}`)).toEqual([
      FLUENT_BIT_RECORDS[0],
      {},
    ]);
    expect(stream("{} {}")).toEqual([{}, {}]);
  });

  /*
   * One object alone is one JSON document, which RequestBodyJson.parse
   * reads; a caller reads a stream only once parse refused the body. So a
   * body of one value is no stream - valid or broken - and is not handed to
   * JSON.parse a second time: broken JSON of one object, the commonest
   * kind, costs one parse, not two.
   */
  test("one object alone is no stream, valid or broken, and is never parsed here", () => {
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    for (const body of [
      json(FLUENT_BIT_RECORDS[0]),
      "{}",
      ` \n${json(FLUENT_BIT_RECORDS[1])}\r\n `,
      '{"log":"a",}',
      '{"log": undefined}',
      `{"log":"${"a".repeat(64 * 1024)}",}`,
    ]) {
      expect({ body: body.slice(0, 40), records: stream(body) }).toEqual({
        body: body.slice(0, 40),
        records: null,
      });
    }

    expect(parse).not.toHaveBeenCalled();
  });

  test("a brace, bracket, quote or backslash inside a string ends no record", () => {
    const records: Array<Record<string, unknown>> = [
      { message: "}{" },
      { message: '"}]', path: "C:\\logs\\" },
      { message: "\\", next: '\\\\"{' },
      { "}": "{", "[": ["]", "}", { "\\": '"' }] },
    ];

    expect(stream(records.map(json).join(""))).toEqual(records);
  });

  test("records hold objects and arrays nested as deep as they like", () => {
    const records: Array<Record<string, unknown>> = [
      { a: { b: { c: { d: [[[{ e: [] }]]] } } } },
      { list: [{}, [], [[]], { x: [1, { y: null }] }] },
    ];

    expect(stream(records.map(json).join(""))).toEqual(records);
  });

  test("UTF-8 beyond ASCII is read as it was sent", () => {
    const records: Array<Record<string, unknown>> = [
      { message: "naïve — 日本語" },
      { message: "😀", ключ: "значение" },
    ];

    expect(stream(records.map(json).join(""))).toEqual(records);
  });

  test("reads a Uint8Array that is a view into a larger buffer, as its own bytes", () => {
    const body: Buffer = Buffer.from(
      `{"garbage":"before"}|${json({ message: "a" })}${json({ message: "b" })}|garbage after`,
    );
    const start: number = body.indexOf("|") + 1;
    const end: number = body.lastIndexOf("|");
    const view: Uint8Array = new Uint8Array(
      body.buffer,
      body.byteOffset + start,
      end - start,
    );

    expect(RequestBodyJson.parseStream(view, LARGE_REQUEST_BODY_LIMIT)).toEqual(
      [{ message: "a" }, { message: "b" }],
    );
  });

  test("each record is parsed on its own, never the body as one text", () => {
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    stream(FLUENT_BIT_RECORDS.map(json).join(""));

    expect(
      (parse.mock.calls as Array<Array<unknown>>).map(
        (call: Array<unknown>): unknown => {
          return call[0];
        },
      ),
    ).toEqual(FLUENT_BIT_RECORDS.map(json));
  });
});

/*
 * How a stream is told from broken JSON: every piece of the body must be a
 * JSON object that parses, with nothing but whitespace between them. Any
 * other body is no stream, and is answered null - its caller refuses it 400,
 * as the JSON it is not - never read as some of its records.
 */
describe("parseStream answers null for a body that is no stream of JSON objects", () => {
  test.each([
    ["an empty body", ""],
    ["whitespace alone", " \r\n\t\n"],
    ["a record that does not close", '{"message":"order placed"'],
    ["a stream whose last record is cut off", '{"message":"a"}{"message":"b'],
    ["a brace that closes nothing", '{"message":"a"}}'],
    ["records separated by commas", '{"message":"a"},{"message":"b"}'],
    ["an array where a record starts", '{"message":"a"}[{"message":"b"}]'],
    ["an array first", '[{"message":"a"}]{"message":"b"}'],
    ["a string after a record", '{"message":"a"}"text"'],
    ["a number after a record", '{"message":"a"} 42'],
    ["true after a record", '{"message":"a"}true'],
    ["null after a record", '{"message":"a"}null'],
    ["text after a record", '{"message":"a"}order placed'],
    ["text alone", "order placed"],
    ["a record JSON.parse refuses", '{"message":}{"message":"b"}'],
    ["keys in single quotes", "{'message':'a'}{'message':'b'}"],
    ["a record closed by a bracket", '{"message":"a"]{"message":"b"}'],
    ["a trailing comma inside a record", '{"message":"a",}{"message":"b"}'],
    ["a byte-order mark before the records", '\uFEFF{"a":1}{"b":2}'],
  ])("%s", (_what: string, body: string) => {
    expect(stream(body)).toBeNull();
  });

  test("a record that does not parse ends the read: no record after it is handed to JSON.parse", () => {
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    expect(
      stream(`${json({ a: 1 })}{"b":}${json({ c: 3 })}${json({ d: 4 })}`),
    ).toBeNull();
    // The first record, and the one that failed: never the two after it.
    expect(
      (parse.mock.calls as Array<Array<unknown>>).map(
        (call: Array<unknown>): unknown => {
          return call[0];
        },
      ),
    ).toEqual([json({ a: 1 }), '{"b":}']);
  });

  test("a piece that is no record is never handed to JSON.parse at all", () => {
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    expect(stream(`${json({ a: 1 })} order placed ${json({ b: 2 })}`)).toBe(
      null,
    );
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe("parseStream counts every record before JSON.parse sees it", () => {
  test("a body over the limit's values is refused 413 at the record that passes it, in the words a JSON body gets", () => {
    // 60 values a record: the second record passes the 100.
    const record: string = json({
      values: Array.from({ length: 57 }, (): number => {
        return 1;
      }),
    });
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    const error: unknown = refusalOf(() => {
      return RequestBodyJson.parseStream(Buffer.from(record.repeat(3)), SMALL);
    });

    expect(error).toMatchObject({
      type: TOO_MANY_JSON_VALUES_TYPE,
      status: 413,
      expose: true,
      passed: JsonElementLimit.Values,
      limit: SMALL.values,
      message: getTooManyJsonValuesMessage(JsonElementLimit.Values, 100),
    });
    // The first record alone was parsed: the one that passed the limit never was.
    expect(parse).toHaveBeenCalledTimes(1);
  });

  test("the objects, arrays and strings among them are held to their own limit", () => {
    const limit: RequestBodyLimit = {
      bytes: 1024 * 1024,
      values: 10000,
      objectsArraysAndStrings: 9,
    };

    // An object, a key, an array and two strings a record: the second passes the 9.
    expect(
      refusalOf(() => {
        return RequestBodyJson.parseStream(
          Buffer.from(`${json({ m: ["a", "b"] })}${json({ m: ["c", "d"] })}`),
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
      RequestBodyJson.parseStream(
        Buffer.from(`${json({ a: 1 })}${json({ b: 2 })}`),
        limit,
      ),
    ).toEqual([{ a: 1 }, { b: 2 }]);
    expect(
      refusalOf(() => {
        return RequestBodyJson.parseStream(
          Buffer.from(`${json({ a: 1 })}${json({ b: 2 })}{}`),
          limit,
        );
      }),
    ).toMatchObject({ status: 413, passed: JsonElementLimit.Values });
  });

  test("a stream is held to the count of the same bytes as one body: the records' counts add up", () => {
    const body: Buffer = Buffer.from(FLUENT_BIT_RECORDS.map(json).join("\n"));
    const whole: number = JsonElementCounter.countBytes(
      body,
      LARGE_REQUEST_BODY_LIMIT,
    ).values;

    // Exactly the whole body's values: read. One fewer: refused.
    expect(
      RequestBodyJson.parseStream(body, {
        bytes: 1024 * 1024,
        values: whole,
        objectsArraysAndStrings: whole,
      }),
    ).toEqual(FLUENT_BIT_RECORDS);
    expect(
      refusalOf(() => {
        return RequestBodyJson.parseStream(body, {
          bytes: 1024 * 1024,
          values: whole - 1,
          objectsArraysAndStrings: whole,
        });
      }),
    ).toMatchObject({ status: 413, limit: whole - 1 });
  });

  test("a large route's 1,000,000 values: a million empty records are read, one more is refused", () => {
    expect(
      RequestBodyJson.parseStream(
        Buffer.from("{}".repeat(1000000)),
        LARGE_REQUEST_BODY_LIMIT,
      ),
    ).toHaveLength(1000000);
    expect(
      refusalOf(() => {
        return RequestBodyJson.parseStream(
          Buffer.from("{}".repeat(1000001)),
          LARGE_REQUEST_BODY_LIMIT,
        );
      }),
    ).toMatchObject({
      status: 413,
      limit: LARGE_REQUEST_BODY_LIMIT.values,
    });
  }, 120000);
});

describe("a stream is read as the same records as one JSON array", () => {
  const RANDOM: SeededRandom = seededRandom(10796);

  const WORDS: Array<string> = [
    "order",
    "placed",
    "ü",
    "中",
    '"quoted"',
    "back\\slash",
    "tab\there",
    "line\nfeed",
    "{brace}",
    "}{",
    "[bracket]",
    "\\",
    "",
  ];

  const word: () => string = (): string => {
    return WORDS[RANDOM(WORDS.length)]!;
  };

  // A record as Fluent Bit sends one: its time, strings, numbers, a map, a list.
  const record: () => Record<string, unknown> = (): Record<string, unknown> => {
    const value: Record<string, unknown> = {
      date: 1795255200 + RANDOM(100000) / 1000,
      log: `${word()} ${word()}`,
      level: ["info", "warn", "error"][RANDOM(3)],
      count: RANDOM(1000) - 500,
    };

    if (RANDOM(2) === 0) {
      value["kubernetes"] = { pod_name: word(), labels: { app: word() } };
    }

    if (RANDOM(2) === 0) {
      value["tags"] = [word(), RANDOM(10), RANDOM(2) === 0, null, {}];
    }

    return value;
  };

  // Nothing, as json_stream sends; a line feed, as Fluentd's records come; and the rest.
  const SEPARATORS: Array<string> = ["", "", "\n", "\r\n", " ", "\n\t "];

  test("for 500 batches of drawn records and separators", () => {
    for (let batch: number = 0; batch < 500; batch++) {
      const records: Array<Record<string, unknown>> = Array.from(
        { length: 2 + RANDOM(19) },
        record,
      );
      const body: string = records
        .map((item: Record<string, unknown>): string => {
          return `${json(item)}${SEPARATORS[RANDOM(SEPARATORS.length)]}`;
        })
        .join("");

      expect({ batch, records: stream(body) }).toEqual({
        batch,
        records: JSON.parse(json(records)),
      });
    }
  });

  test("for 500 drawn batches cut short anywhere, never some of the records: the whole stream or null", () => {
    for (let batch: number = 0; batch < 500; batch++) {
      const records: Array<Record<string, unknown>> = Array.from(
        { length: 2 + RANDOM(5) },
        record,
      );
      const body: string = records.map(json).join("");
      const cut: number = 1 + RANDOM(body.length - 1);
      const read: Array<unknown> | null = stream(body.slice(0, cut));

      /*
       * Cut after the second record or a later one, the records before the
       * cut are a stream of their own; cut after the first, it is one
       * document; cut inside a record, the body is no stream.
       */
      const whole: number = records.findIndex(
        (_: Record<string, unknown>, index: number): boolean => {
          return (
            records
              .slice(0, index + 1)
              .map(json)
              .join("").length === cut
          );
        },
      );

      expect({ batch, cut, read }).toEqual({
        batch,
        cut,
        read: whole < 1 ? null : JSON.parse(json(records.slice(0, whole + 1))),
      });
    }
  });
});
