import ClickhouseReadResult, {
  ClickhouseRowsRead,
  ROWS_FORMAT,
} from "../../../../Server/Utils/AnalyticsDatabase/ClickhouseReadResult";
import EventLoop, { EventLoopBudget } from "../../../../Server/Utils/EventLoop";
import QueryTimeoutException from "../../../../Types/Exception/QueryTimeoutException";
import ServerException from "../../../../Types/Exception/ServerException";
import { JSONObject } from "../../../../Types/JSON";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { ClickHouseError } from "@clickhouse/client";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * READING A CLICKHOUSE ANSWER ROW BY ROW, AS IT ARRIVES (issue #10316).
 *
 * A grouped Metrics read is a row per series and bucket: 40,000 rows and
 * 10 MB of JSON a read for the #10108 fleet, read whole as text and parsed
 * in one JSON.parse that held the event loop for 50 to 75 ms. readRows reads
 * the answer as JSONCompactEachRowWithNames, a line at a time as its bytes
 * arrive, and hands the event loop back between rows. These tests pin that
 * it reads exactly what readJson reads of the same answer in FORMAT JSON -
 * on large answers and on the small ones that go wrong (empty, one row,
 * cut anywhere, inside a character too) - that every way ClickHouse 24.8
 * and 26.7 end an answer early is the error readJson makes of it, and that
 * it hands the event loop back. The answers' shapes - the names line on an
 * empty answer, the 26.x block, the 24.x error row - were captured from real
 * servers of both versions.
 */

const LIMIT_MESSAGE_45: string =
  "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.";

const INCOMPLETE_MESSAGE: string =
  "The database's answer to this query ended before it was complete.";

const TIMEOUT_TEXT_26: string =
  "Code: 159. DB::Exception: Timeout exceeded: elapsed 1061.890 ms, maximum: 1000 ms. (TIMEOUT_EXCEEDED) (version 26.7.13.12 (official build))";

const TIMEOUT_TEXT_24: string =
  "Code: 159. DB::Exception: Timeout exceeded: elapsed 1.000686372 seconds, maximum: 1. (TIMEOUT_EXCEEDED) (version 24.8.14.39 (official build))";

const MEMORY_TEXT_26: string =
  "Code: 241. DB::Exception: (total) memory limit exceeded: would use 3.00 GiB (attempt to allocate chunk of 4.00 MiB), maximum: 3.00 GiB. (MEMORY_LIMIT_EXCEEDED) (version 26.7.13.12 (official build))";

const THROW_IF_TEXT_24: string =
  "Code: 395. DB::Exception: boom after rows: while executing 'FUNCTION throwIf(equals(__table1.number, 5000_UInt16) :: 0, 'boom after rows'_String :: 2) -> throwIf(equals(__table1.number, 5000_UInt16), 'boom after rows'_String) UInt8 : 3'. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 24.8.14.39 (official build))";

const TAG: string = "ltstoiprrmfwblyw";

/*
 * How 26.x ends a body whose query failed after rows were sent (captured
 * from 26.7.38.18): \r\n between the frame's lines, \n inside the message,
 * then the length of the message and the tag again.
 */
function exceptionBlock(message: string, tag: string = TAG): string {
  return `\r\n__exception__\r\n${tag}\r\n${message}\n${message.length + 1} ${tag}\r\n__exception__\r\n`;
}

const COLUMNS: Array<string> = ["value", "time", "attributes"];

// An answer as JSONCompactEachRowWithNames: the names, then a line a row.
function eachRowAnswer(
  columns: Array<string>,
  rows: Array<Array<unknown>>,
): string {
  return [columns, ...rows]
    .map((line: Array<unknown>): string => {
      return `${JSON.stringify(line)}\n`;
    })
    .join("");
}

// The same answer as FORMAT JSON, as readJson reads it.
function jsonAnswer(
  columns: Array<string>,
  rows: Array<Array<unknown>>,
): string {
  return JSON.stringify({
    meta: columns.map((name: string) => {
      return { name: name, type: "String" };
    }),
    data: rows.map((row: Array<unknown>): JSONObject => {
      const item: JSONObject = {};
      columns.forEach((column: string, index: number) => {
        item[column] = row[index] as JSONObject[string];
      });
      return item;
    }),
    rows: rows.length,
  });
}

// A response body: its chunks, each on a later turn, then maybe a failure.
function bodyOf(
  chunks: Array<Buffer | string | Uint8Array>,
  failure?: Error,
): AsyncIterable<unknown> & { returned: () => boolean } {
  let returned: boolean = false;

  return {
    returned: (): boolean => {
      return returned;
    },
    [Symbol.asyncIterator]: (): AsyncIterator<unknown> => {
      let index: number = 0;

      return {
        next: async (): Promise<IteratorResult<unknown>> => {
          await Promise.resolve();

          if (index < chunks.length) {
            return { done: false, value: chunks[index++] };
          }

          if (failure) {
            throw failure;
          }

          return { done: true, value: undefined };
        },
        return: async (): Promise<IteratorResult<unknown>> => {
          returned = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
}

// The bytes of a text, cut wherever the draws say: inside characters too.
function cutAnywhere(
  text: string,
  random: SeededRandom,
  largestChunk: number,
): Array<Buffer> {
  const bytes: Buffer = Buffer.from(text, "utf8");
  const chunks: Array<Buffer> = [];
  let offset: number = 0;

  while (offset < bytes.length) {
    const size: number = 1 + random(largestChunk);
    chunks.push(bytes.subarray(offset, offset + size));
    offset += size;
  }

  return chunks;
}

async function readAll(
  body: AsyncIterable<unknown>,
  options: Parameters<typeof ClickhouseReadResult.readRows>[2] = {},
): Promise<{ rows: Array<JSONObject>; read: ClickhouseRowsRead }> {
  const rows: Array<JSONObject> = [];
  const read: ClickhouseRowsRead = await ClickhouseReadResult.readRows(
    body,
    (row: JSONObject): void => {
      rows.push(row);
    },
    options,
  );

  return { rows, read };
}

async function failureOf(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the read to fail, and it succeeded.");
}

// Texts a series' labels hold: every script, escapes and a NUL among them.
const LABEL_TEXTS: Array<string> = [
  "docker-host-0001.prod.fleet.internal",
  "checkout-api-1-0",
  "é→😀\n\t\\",
  "中文服务-東京",
  "خدمة الدفع",
  "שירות",
  "é combining",
  'quote " and backslash \\',
  "nul\u0000inside",
  "",
  "🇩🇪🏳️‍🌈",
  "a".repeat(300),
];

// A grouped read's rows: a value, a minute, the series' labels.
function groupedRows(
  count: number,
  random: SeededRandom,
): Array<Array<unknown>> {
  const rows: Array<Array<unknown>> = [];

  for (let index: number = 0; index < count; index++) {
    const pick: number = random(6);
    const value: unknown =
      pick === 0
        ? null
        : pick === 1
          ? String(index * 1000003)
          : pick === 2
            ? -index / 7
            : pick === 3
              ? 1.5e21
              : index;

    rows.push([
      value,
      `2026-11-17 10:${String(index % 60).padStart(2, "0")}:00.000000000`,
      {
        "resource.host.name": LABEL_TEXTS[random(LABEL_TEXTS.length)]!,
        "resource.container.name": `${LABEL_TEXTS[random(LABEL_TEXTS.length)]!}-${index}`,
      },
    ]);
  }

  return rows;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ClickhouseReadResult.readRows reads what readJson reads", () => {
  test("40,000 rows of a grouped read, cut into chunks of every size, inside characters too", async () => {
    const random: SeededRandom = seededRandom(10316);
    const rows: Array<Array<unknown>> = groupedRows(40_000, random);
    const expected: Array<JSONObject> = ClickhouseReadResult.readJson<{
      data: Array<JSONObject>;
    }>(jsonAnswer(COLUMNS, rows)).data;

    for (const largestChunk of [1_000, 16_384, 65_536, 2_000_000]) {
      const read: { rows: Array<JSONObject>; read: ClickhouseRowsRead } =
        await readAll(
          bodyOf(
            cutAnywhere(eachRowAnswer(COLUMNS, rows), random, largestChunk),
          ),
        );

      expect(read.read).toEqual({ columns: COLUMNS, rowCount: 40_000 });
      expect(read.rows).toEqual(expected);
    }
  });

  test("a body cut at every byte, and one a byte at a time: the same rows", async () => {
    const rows: Array<Array<unknown>> = [
      [1, "2026-11-17 10:04:00.000000000", { 'k"q': "é→😀\n\t\\" }],
      [null, "2026-11-17 10:05:00.000000000", { 中文: "عربي 🇩🇪" }],
      ["18446744073709551615", "2026-11-17 10:06:00.000000000", {}],
    ];
    const text: string = eachRowAnswer(COLUMNS, rows);
    const bytes: Buffer = Buffer.from(text, "utf8");
    const expected: Array<JSONObject> = ClickhouseReadResult.readJson<{
      data: Array<JSONObject>;
    }>(jsonAnswer(COLUMNS, rows)).data;

    for (let cut: number = 0; cut <= bytes.length; cut++) {
      const read: { rows: Array<JSONObject> } = await readAll(
        bodyOf([bytes.subarray(0, cut), bytes.subarray(cut)]),
      );
      expect(read.rows).toEqual(expected);
    }

    const byteAtATime: Array<Buffer> = [];
    for (let offset: number = 0; offset < bytes.length; offset++) {
      byteAtATime.push(bytes.subarray(offset, offset + 1));
    }

    expect((await readAll(bodyOf(byteAtATime))).rows).toEqual(expected);
  });

  test("chunks as text and as plain byte arrays read the same as Buffers", async () => {
    const rows: Array<Array<unknown>> = groupedRows(50, seededRandom(1));
    const text: string = eachRowAnswer(COLUMNS, rows);
    const bytes: Buffer = Buffer.from(text, "utf8");
    const expected: Array<JSONObject> = (await readAll(bodyOf([bytes]))).rows;

    expect((await readAll(bodyOf([text]))).rows).toEqual(expected);
    expect((await readAll(bodyOf([new Uint8Array(bytes)]))).rows).toEqual(
      expected,
    );
  });

  test("an answer with no rows is its names line, and reads as no rows", async () => {
    // As 24.8 and 26.7 both answer an empty result.
    const read: { rows: Array<JSONObject>; read: ClickhouseRowsRead } =
      await readAll(bodyOf(['["value", "time"]\n']));

    expect(read.rows).toEqual([]);
    expect(read.read).toEqual({ columns: ["value", "time"], rowCount: 0 });
  });

  test("one row", async () => {
    const read: { rows: Array<JSONObject> } = await readAll(
      bodyOf([
        '["value", "time", "attributes"]\n[0.5, "2026-11-17 10:04:00", {"resource.host.name":"h1"}]\n',
      ]),
    );

    expect(read.rows).toEqual([
      {
        value: 0.5,
        time: "2026-11-17 10:04:00",
        attributes: { "resource.host.name": "h1" },
      },
    ]);
  });

  test("a row's values are keyed as FORMAT JSON keys them: a later column of one name wins, and __proto__ is a key", async () => {
    const read: { rows: Array<JSONObject> } = await readAll(
      bodyOf(['["a", "a", "__proto__"]\n[1, 2, {"polluted": true}]\n']),
    );

    const expected: Array<JSONObject> = ClickhouseReadResult.readJson<{
      data: Array<JSONObject>;
    }>('{"data": [{"a": 1, "a": 2, "__proto__": {"polluted": true}}]}').data;

    expect(read.rows).toEqual(expected);
    expect(Object.getPrototypeOf(read.rows[0])).toBe(Object.prototype);
    expect(Object.keys(read.rows[0]!)).toEqual(["a", "__proto__"]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe("ClickhouseReadResult.readRows: an answer that ended early is never passed off as whole", () => {
  const incompleteBodies: Array<[string, Array<string>]> = [
    ["an empty body", []],
    ["a body of nothing but a line break", ["\n"]],
    ["names cut off", ['["value", "ti']],
    ["a row cut off", ['["value", "time"]\n[1, "2026-11-17 1']],
    [
      "a whole row without its newline",
      ['["value", "time"]\n[1, "2026-11-17 10:04:00"]'],
    ],
    ["a line that is no JSON", ['["value", "time"]\n[1, "x"]\n{not json\n']],
    ["names that are not a list of texts", ['{"value": 1}\n[1]\n']],
    [
      "a row of the wrong length that is no error",
      ['["value", "time"]\n[1, "2026-11-17 10:04:00", 3]\n'],
    ],
    [
      "the start of an error block with no end",
      ['["value"]\n[1]\n\r\n__exception__\r\n' + TAG + "\r\nCode: 241."],
    ],
  ];

  test.each(incompleteBodies)(
    "%s: the answer is reported as incomplete",
    async (_name: string, chunks: Array<string>) => {
      const error: unknown = await failureOf(() => {
        return readAll(bodyOf(chunks));
      });

      expect(error).toBeInstanceOf(ServerException);
      expect((error as Error).message).toBe(INCOMPLETE_MESSAGE);
    },
  );

  test.each(incompleteBodies)(
    "%s, of a read with a time limit: it was stopped at the limit",
    async (_name: string, chunks: Array<string>) => {
      const error: unknown = await failureOf(() => {
        return readAll(bodyOf(chunks), { timeLimitInSeconds: 45 });
      });

      expect(error).toBeInstanceOf(QueryTimeoutException);
      expect((error as Error).message).toBe(LIMIT_MESSAGE_45);
    },
  );

  test("no rows are handed on past the line that broke", async () => {
    const rows: Array<JSONObject> = [];

    await failureOf(() => {
      return ClickhouseReadResult.readRows(
        bodyOf(['["value"]\n[1]\n[2]\n{broken\n[3]\n']),
        (row: JSONObject): void => {
          rows.push(row);
        },
      );
    });

    expect(rows).toEqual([{ value: 1 }, { value: 2 }]);
  });
});

describe("ClickhouseReadResult.readRows: ClickHouse's error after the rows", () => {
  const rowsSoFar: string = eachRowAnswer(
    ["value", "t"],
    [
      ["0", 0],
      ["1", 0],
    ],
  );

  test("26.x: a stop at the time limit, in its block, is a QueryTimeoutException", async () => {
    const error: unknown = await failureOf(() => {
      return readAll(bodyOf([rowsSoFar + exceptionBlock(TIMEOUT_TEXT_26)]), {
        exceptionTag: TAG,
        timeLimitInSeconds: 45,
      });
    });

    expect(error).toBeInstanceOf(QueryTimeoutException);
    expect((error as Error).message).toBe(LIMIT_MESSAGE_45);
  });

  test("26.x: any other error in its block is a ClickHouseError with its code and type", async () => {
    const error: unknown = await failureOf(() => {
      return readAll(bodyOf([rowsSoFar + exceptionBlock(MEMORY_TEXT_26)]), {
        exceptionTag: TAG,
      });
    });

    expect(error).toBeInstanceOf(ClickHouseError);
    expect((error as ClickHouseError).code).toBe("241");
    expect((error as ClickHouseError).type).toBe("MEMORY_LIMIT_EXCEEDED");
  });

  test("26.x drops the connection right after the block: still its error, not the socket's", async () => {
    // As 26.7.38.18 does: the whole block, then ECONNRESET "aborted".
    const aborted: Error = Object.assign(new Error("aborted"), {
      code: "ECONNRESET",
    });
    const text: string = rowsSoFar + exceptionBlock(MEMORY_TEXT_26);
    const error: unknown = await failureOf(() => {
      return readAll(bodyOf(cutAnywhere(text, seededRandom(26), 40), aborted), {
        exceptionTag: TAG,
      });
    });

    expect(error).toBeInstanceOf(ClickHouseError);
    expect((error as ClickHouseError).code).toBe("241");
  });

  test("a block the X-ClickHouse-Exception-Tag does not frame is not taken for an error", async () => {
    const error: unknown = await failureOf(() => {
      return readAll(
        bodyOf([rowsSoFar + exceptionBlock(MEMORY_TEXT_26, "someothertag")]),
        { exceptionTag: TAG },
      );
    });

    expect(error).toBeInstanceOf(ServerException);
    expect((error as Error).message).toBe(INCOMPLETE_MESSAGE);
  });

  test("24.x: the error row after the rows, a stop at the time limit, is a QueryTimeoutException", async () => {
    const error: unknown = await failureOf(() => {
      return readAll(
        bodyOf([rowsSoFar + `${JSON.stringify([TIMEOUT_TEXT_24])}\n`]),
        { timeLimitInSeconds: 45 },
      );
    });

    expect(error).toBeInstanceOf(QueryTimeoutException);
    expect((error as Error).message).toBe(LIMIT_MESSAGE_45);
  });

  test("24.x: any other error row is a ClickHouseError with its code and type", async () => {
    // As 24.8.14.39 ends the body, even under http_wait_end_of_query.
    const error: unknown = await failureOf(() => {
      return readAll(
        bodyOf([rowsSoFar + `${JSON.stringify([THROW_IF_TEXT_24])}\n`]),
      );
    });

    expect(error).toBeInstanceOf(ClickHouseError);
    expect((error as ClickHouseError).code).toBe("395");
    expect((error as ClickHouseError).type).toBe(
      "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
    );
  });

  test('24.x\'s JSONEachRow form, {"exception": ...}, is read the same', async () => {
    const error: unknown = await failureOf(() => {
      return readAll(
        bodyOf([
          rowsSoFar + `${JSON.stringify({ exception: MEMORY_TEXT_26 })}\n`,
        ]),
      );
    });

    expect(error).toBeInstanceOf(ClickHouseError);
    expect((error as ClickHouseError).code).toBe("241");
  });

  test("a body that fails part way with no error of ClickHouse's in it fails as it failed", async () => {
    const aborted: Error = new Error("aborted");
    const error: unknown = await failureOf(() => {
      return readAll(bodyOf([rowsSoFar], aborted));
    });

    expect(error).toBe(aborted);

    const timedOut: ClickHouseError = new ClickHouseError({
      code: "159",
      type: "TIMEOUT_EXCEEDED",
      message: TIMEOUT_TEXT_26,
    });
    const stopped: unknown = await failureOf(() => {
      return readAll(bodyOf([rowsSoFar], timedOut), {
        timeLimitInSeconds: 45,
      });
    });

    expect(stopped).toBeInstanceOf(QueryTimeoutException);
  });
});

describe("ClickhouseReadResult.readRows lets the response go when it stops early", () => {
  test("a row onRow refuses stops the read, and the rest of the body is not read", async () => {
    const body: AsyncIterable<unknown> & { returned: () => boolean } = bodyOf([
      '["value"]\n[1]\n',
      "[2]\n",
      "[3]\n",
    ]);
    const refused: Error = new Error("refused");

    const error: unknown = await failureOf(() => {
      return ClickhouseReadResult.readRows(body, (row: JSONObject): void => {
        if (row["value"] === 2) {
          throw refused;
        }
      });
    });

    expect(error).toBe(refused);
    expect(body.returned()).toBe(true);
  });

  test("a body read to its end is not let go a second time", async () => {
    const body: AsyncIterable<unknown> & { returned: () => boolean } = bodyOf([
      '["value"]\n[1]\n',
    ]);

    await readAll(body);

    expect(body.returned()).toBe(false);
  });
});

describe("ClickhouseReadResult.readRows hands the event loop back between rows", () => {
  test("about every 20 ms of work, whatever the chunks: one chunk of 5,000 rows too", async () => {
    let now: number = 0;
    let handBacks: number = 0;

    // Each look at the clock: half a millisecond of work.
    jest.spyOn(EventLoop, "now").mockImplementation((): number => {
      now += 0.5;
      return now;
    });
    jest
      .spyOn(EventLoop, "yieldToEventLoop")
      .mockImplementation(async (): Promise<void> => {
        handBacks++;
      });

    const rows: Array<Array<unknown>> = groupedRows(5_000, seededRandom(5));
    const read: { rows: Array<JSONObject> } = await readAll(
      bodyOf([eachRowAnswer(COLUMNS, rows)]),
    );

    expect(read.rows).toHaveLength(5_000);
    // 5,000 rows at half a millisecond each: some 2.5 s of work.
    expect(handBacks).toBeGreaterThanOrEqual(100);
    expect(handBacks).toBeLessThan(5_000);
  });

  test("hands it to the event loop itself: work queued before the read runs during it", async () => {
    let now: number = 0;

    // A millisecond a look: the budget is spent every twenty rows.
    jest.spyOn(EventLoop, "now").mockImplementation((): number => {
      now += 1;
      return now;
    });

    let ranDuringRead: boolean = false;
    let isReading: boolean = true;

    /*
     * A timer: the event loop's own turn in this environment, which has no
     * setImmediate (EventLoop.yieldToEventLoop turns it with one too).
     */
    setTimeout((): void => {
      ranDuringRead = isReading;
    }, 0);

    await readAll(
      bodyOf([eachRowAnswer(COLUMNS, groupedRows(500, seededRandom(6)))]),
    );
    isReading = false;

    expect(ranDuringRead).toBe(true);
  });

  test("keeps the caller's budget, so a read and the work around it share one clock", async () => {
    const budget: EventLoopBudget = new EventLoopBudget();
    let looks: number = 0;
    let handBacks: number = 0;

    jest.spyOn(budget, "isSpent").mockImplementation((): boolean => {
      looks++;
      return true;
    });
    jest
      .spyOn(budget, "handBack")
      .mockImplementation(async (): Promise<void> => {
        handBacks++;
      });

    await readAll(bodyOf(['["value"]\n[1]\n[2]\n[3]\n']), { budget });

    // Once after each line: the names and three rows.
    expect(looks).toBe(4);
    expect(handBacks).toBe(4);
  });
});

describe("ClickhouseReadResult.withRowsFormat", () => {
  test("asks for the row format after the statement, as the client asks for a format", () => {
    expect(ROWS_FORMAT).toBe("JSONCompactEachRowWithNames");
    expect(ClickhouseReadResult.withRowsFormat("SELECT 1")).toBe(
      "SELECT 1\nFORMAT JSONCompactEachRowWithNames",
    );
    expect(
      ClickhouseReadResult.withRowsFormat(
        "  SELECT value FROM Metric SETTINGS max_execution_time = 45 ;; ; \n",
      ),
    ).toBe(
      "SELECT value FROM Metric SETTINGS max_execution_time = 45\nFORMAT JSONCompactEachRowWithNames",
    );
  });
});
