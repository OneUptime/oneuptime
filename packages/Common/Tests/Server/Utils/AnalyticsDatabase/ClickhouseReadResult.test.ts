import ClickhouseReadResult, {
  ClickhouseErrorDetails,
} from "../../../../Server/Utils/AnalyticsDatabase/ClickhouseReadResult";
import QueryTimeoutException from "../../../../Types/Exception/QueryTimeoutException";
import TimeoutException from "../../../../Types/Exception/TimeoutException";
import ServerException from "../../../../Types/Exception/ServerException";
import ExceptionCode from "../../../../Types/Exception/ExceptionCode";
import ErrorClass, {
  declaredErrorClass,
} from "../../../../Types/Telemetry/ErrorClass";
import { ClickHouseError } from "@clickhouse/client";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * Reading a ClickHouse answer (issue #4707).
 *
 * A log search that ran into the 45 s query limit failed with a bare
 * "Server Error": ClickHouse answers a read it stops in ways JSON.parse
 * cannot read, and the SyntaxError reached the API as a 500 and the span as
 * a code fault. These tests feed the reader each of those answers, byte for
 * byte as ClickHouse 24.8 and 26.7 sent them (captured from a real server),
 * and pin what each becomes:
 *
 *   - a stop at the time limit, however it arrives, is a
 *     QueryTimeoutException: 504, Infrastructure, and a message that names
 *     the limit and says what to try;
 *   - any other error ClickHouse reports, before or after the rows, is a
 *     ClickHouseError with its code and type;
 *   - a document is only handed back when it is whole and carries no error,
 *     so partial rows never pass for a complete answer.
 */

const LIMIT_MESSAGE_45: string =
  "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.";

// ClickHouse 26.7's message for a read stopped by max_execution_time.
const TIMEOUT_TEXT_26: string =
  "Code: 159. DB::Exception: Timeout exceeded: elapsed 1061.890 ms, maximum: 1000 ms. (TIMEOUT_EXCEEDED) (version 26.7.13.12 (official build))";

// ClickHouse 24.8's.
const TIMEOUT_TEXT_24: string =
  "Code: 159. DB::Exception: Timeout exceeded: elapsed 1.000686372 seconds, maximum: 1. (TIMEOUT_EXCEEDED) (version 24.8.14.39 (official build))";

const MEMORY_TEXT_26: string =
  "Code: 241. DB::Exception: (total) memory limit exceeded: would use 3.00 GiB (attempt to allocate chunk of 4.00 MiB), maximum: 3.00 GiB. (MEMORY_LIMIT_EXCEEDED) (version 26.7.13.12 (official build))";

const TAG: string = "daphbodqqsmhrswr";

// The first rows of a FORMAT JSON answer, as the server streams them.
const STREAMED_ROWS: string =
  '{\n\t"meta":\n\t[\n\t\t{\n\t\t\t"name": "id",\n\t\t\t"type": "String"\n\t\t}\n\t],\n\n\t"data":\n\t[\n\t\t{\n\t\t\t"id": "44337"\n\t\t},\n\t\t{\n\t\t\t"id": "44347"\n\t\t}';

/*
 * How 26.x ends a body whose query failed after rows were sent: \r\n
 * between the frame's lines, \n inside the message, then the length of the
 * message and the tag again.
 */
function exceptionBlock(message: string, tag: string = TAG): string {
  return `\r\n__exception__\r\n${tag}\r\n${message}\n${message.length + 1} ${tag}\r\n__exception__\r\n`;
}

const WHOLE_DOCUMENT: string =
  '{\n\t"meta": [{"name": "count", "type": "UInt64"}],\n\t"data": [{"count": 42}],\n\t"rows": 1,\n\t"statistics": {"elapsed": 0.01, "rows_read": 42, "bytes_read": 336}\n}\n';

function capture(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the read to fail, and it succeeded.");
}

async function captureAsync(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the read to fail, and it succeeded.");
}

function expectStoppedAtLimit(error: unknown, message: string): void {
  expect(error).toBeInstanceOf(QueryTimeoutException);
  expect(error).toBeInstanceOf(TimeoutException);
  expect((error as QueryTimeoutException).code).toBe(504);
  expect((error as QueryTimeoutException).message).toBe(message);
}

describe("ClickhouseReadResult.isTimeLimitError", () => {
  test.each([
    ["TIMEOUT_EXCEEDED (159)", { code: "159", type: "TIMEOUT_EXCEEDED" }],
    ["TOO_SLOW (160)", { code: "160", type: "TOO_SLOW" }],
    ["a code without a type", { code: "159" }],
    ["a type without a code", { type: "TOO_SLOW" }],
  ])(
    "%s is a stop at the time limit",
    (_name: string, error: Record<string, unknown>) => {
      expect(ClickhouseReadResult.isTimeLimitError(error)).toBe(true);
      expect(
        ClickhouseReadResult.isTimeLimitError(
          new ClickHouseError({
            message: "stopped",
            code: (error as { code?: string }).code || "",
            type: (error as { type?: string }).type || "",
          }),
        ),
      ).toBe(true);
    },
  );

  test("the QueryTimeoutException a stop becomes is one too", () => {
    expect(
      ClickhouseReadResult.isTimeLimitError(
        new QueryTimeoutException(LIMIT_MESSAGE_45),
      ),
    ).toBe(true);
  });

  test.each([
    ["a syntax error", { code: "62", type: "SYNTAX_ERROR" }],
    ["a memory limit", { code: "241", type: "MEMORY_LIMIT_EXCEEDED" }],
    ["a code as a number", { code: 159 }],
    ["a plain Error", new Error("Timeout error.")],
    ["a SyntaxError", new SyntaxError("Unexpected end of JSON input")],
    ["a job timeout", new TimeoutException("Job Timeout")],
    ["null", null],
    ["a string", "159"],
  ])("%s is not", (_name: string, error: unknown) => {
    expect(ClickhouseReadResult.isTimeLimitError(error)).toBe(false);
  });
});

describe("ClickhouseReadResult.getTimeLimitInSeconds", () => {
  test("reads the SETTINGS clause getQuerySettings appends", () => {
    expect(
      ClickhouseReadResult.getTimeLimitInSeconds(
        "SELECT 1 FROM t WHERE TRUE SETTINGS max_execution_time = 45, timeout_overflow_mode = 'throw', max_memory_usage = 3221225472",
      ),
    ).toBe(45);
  });

  test("reads the hand-written form and odd spacing", () => {
    expect(
      ClickhouseReadResult.getTimeLimitInSeconds(
        "SELECT 1 SETTINGS max_execution_time=30",
      ),
    ).toBe(30);
    expect(
      ClickhouseReadResult.getTimeLimitInSeconds(
        "SELECT 1 SETTINGS max_execution_time   =   120",
      ),
    ).toBe(120);
  });

  test("the last one wins: the outer SETTINGS follow any subquery's", () => {
    expect(
      ClickhouseReadResult.getTimeLimitInSeconds(
        "SELECT * FROM (SELECT 1 SETTINGS max_execution_time = 5) SETTINGS max_execution_time = 45",
      ),
    ).toBe(45);
  });

  test("falls back to the per-call settings, a number or a string", () => {
    expect(
      ClickhouseReadResult.getTimeLimitInSeconds("SELECT 1", {
        max_execution_time: 1800,
      }),
    ).toBe(1800);
    expect(
      ClickhouseReadResult.getTimeLimitInSeconds("SELECT 1", {
        max_execution_time: "60" as unknown as number,
      }),
    ).toBe(60);
  });

  test("the statement's own clause wins over the per-call settings", () => {
    expect(
      ClickhouseReadResult.getTimeLimitInSeconds(
        "SELECT 1 SETTINGS max_execution_time = 45",
        { max_execution_time: 1800 },
      ),
    ).toBe(45);
  });

  test.each([
    ["no limit at all", "SELECT 1 FROM t", undefined],
    [
      "the name with no value",
      "SELECT 'max_execution_time' AS name",
      undefined,
    ],
    [
      "a zero limit (no limit)",
      "SELECT 1 SETTINGS max_execution_time = 0",
      undefined,
    ],
    [
      "a value that is not a number",
      "SELECT 1 SETTINGS max_execution_time = x",
      undefined,
    ],
  ])("%s has none", (_name: string, query: string, expected: unknown) => {
    expect(ClickhouseReadResult.getTimeLimitInSeconds(query)).toBe(expected);
  });

  test("a zero or invalid per-call limit is none", () => {
    expect(
      ClickhouseReadResult.getTimeLimitInSeconds("SELECT 1", {
        max_execution_time: 0,
      }),
    ).toBeUndefined();
    expect(
      ClickhouseReadResult.getTimeLimitInSeconds("SELECT 1", {
        max_execution_time: "soon" as unknown as number,
      }),
    ).toBeUndefined();
  });
});

describe("ClickhouseReadResult.getTimeLimitMessage", () => {
  test("names the limit and says what to try", () => {
    expect(ClickhouseReadResult.getTimeLimitMessage(45)).toBe(LIMIT_MESSAGE_45);
  });

  test("one second reads as one", () => {
    expect(ClickhouseReadResult.getTimeLimitMessage(1)).toBe(
      "This query took longer than 1 second and was stopped before it finished. Try a shorter time range or more specific filters.",
    );
  });

  test("without a known limit it still says what happened", () => {
    expect(ClickhouseReadResult.getTimeLimitMessage()).toBe(
      "This query took too long and was stopped before it finished. Try a shorter time range or more specific filters.",
    );
  });
});

describe("ClickhouseReadResult.toReadError", () => {
  test("a ClickHouse stop at the time limit becomes a 504 QueryTimeoutException", () => {
    const error: unknown = ClickhouseReadResult.toReadError(
      new ClickHouseError({
        message: TIMEOUT_TEXT_26,
        code: "159",
        type: "TIMEOUT_EXCEEDED",
      }),
      { timeLimitInSeconds: 45 },
    );

    expectStoppedAtLimit(error, LIMIT_MESSAGE_45);
    expect((error as QueryTimeoutException).code).toBe(
      ExceptionCode.QueryTimeoutException,
    );
  });

  /*
   * A capacity limit, not a defect: the span of a slow search used to
   * record a SyntaxError, which the platform treats as a code fault.
   */
  test("is classed Infrastructure, never a code fault", () => {
    const error: unknown = ClickhouseReadResult.toReadError(
      new ClickHouseError({
        message: TIMEOUT_TEXT_26,
        code: "159",
        type: "TIMEOUT_EXCEEDED",
      }),
    );

    expect(declaredErrorClass(error)?.errorClass).toBe(
      ErrorClass.Infrastructure,
    );
  });

  test("TOO_SLOW, the server giving up up front, is the same answer", () => {
    expectStoppedAtLimit(
      ClickhouseReadResult.toReadError(
        new ClickHouseError({
          message: "Estimated query execution time is too long",
          code: "160",
          type: "TOO_SLOW",
        }),
        { timeLimitInSeconds: 45 },
      ),
      LIMIT_MESSAGE_45,
    );
  });

  test("a QueryTimeoutException passes through as it is", () => {
    const already: QueryTimeoutException = new QueryTimeoutException(
      "Counting every matching span took longer than 45 seconds.",
    );

    expect(ClickhouseReadResult.toReadError(already)).toBe(already);
  });

  test("any other error is left exactly as it was", () => {
    const syntax: ClickHouseError = new ClickHouseError({
      message: "Syntax error",
      code: "62",
      type: "SYNTAX_ERROR",
    });
    const network: Error = new Error("socket hang up");

    expect(ClickhouseReadResult.toReadError(syntax)).toBe(syntax);
    expect(ClickhouseReadResult.toReadError(network)).toBe(network);
  });
});

describe("ClickhouseReadResult.parseErrorText", () => {
  test.each([
    ["26.7", TIMEOUT_TEXT_26],
    ["24.8", TIMEOUT_TEXT_24],
  ])("reads %s's timeout message", (_version: string, text: string) => {
    const details: ClickhouseErrorDetails | null =
      ClickhouseReadResult.parseErrorText(text);

    expect(details).toEqual({
      code: "159",
      type: "TIMEOUT_EXCEEDED",
      message: text,
    });
  });

  test("the type is the last all-caps word in parentheses, wherever the message has others", () => {
    expect(ClickhouseReadResult.parseErrorText(MEMORY_TEXT_26)).toEqual({
      code: "241",
      type: "MEMORY_LIMIT_EXCEEDED",
      message: MEMORY_TEXT_26,
    });

    expect(
      ClickhouseReadResult.parseErrorText(
        "Code: 47. DB::Exception: Unknown identifier (IN SCOPE x) (column `X`): while executing (UNKNOWN_IDENTIFIER) (version 26.7.13.12 (official build))",
      ),
    ).toEqual(
      expect.objectContaining({ code: "47", type: "UNKNOWN_IDENTIFIER" }),
    );
  });

  test("reads the error wherever it starts in the text", () => {
    expect(
      ClickhouseReadResult.parseErrorText(`\n${TAG}\n${TIMEOUT_TEXT_26}`),
    ).toEqual(expect.objectContaining({ code: "159" }));
  });

  test.each([
    ["no error at all", "Everything is fine"],
    ["a code with no number", "Code: . DB::Exception: what"],
    ["empty text", ""],
  ])("%s is not one", (_name: string, text: string) => {
    expect(ClickhouseReadResult.parseErrorText(text)).toBeNull();
  });
});

describe("ClickhouseReadResult.readJson", () => {
  test("a whole document is handed back as it is", () => {
    expect(ClickhouseReadResult.readJson(WHOLE_DOCUMENT)).toEqual({
      meta: [{ name: "count", type: "UInt64" }],
      data: [{ count: 42 }],
      rows: 1,
      statistics: { elapsed: 0.01, rows_read: 42, bytes_read: 336 },
    });
  });

  /*
   * 'break' on a grouped or sorted read (a facet, a histogram, a count, a
   * sorted list): 200 with nothing in it. What the issue's "Server Error"
   * was.
   */
  test("an EMPTY answer to a time-limited read is a stop at its limit", () => {
    expectStoppedAtLimit(
      capture(() => {
        return ClickhouseReadResult.readJson("", { timeLimitInSeconds: 45 });
      }),
      LIMIT_MESSAGE_45,
    );

    expectStoppedAtLimit(
      capture(() => {
        return ClickhouseReadResult.readJson("\r\n \n", {
          timeLimitInSeconds: 45,
        });
      }),
      LIMIT_MESSAGE_45,
    );
  });

  // 'break' on a read that was streaming rows: the document cut off mid-row.
  test("a document CUT OFF mid-row is a stop at its limit, never the rows it had", () => {
    expectStoppedAtLimit(
      capture(() => {
        return ClickhouseReadResult.readJson(STREAMED_ROWS, {
          timeLimitInSeconds: 45,
        });
      }),
      LIMIT_MESSAGE_45,
    );
  });

  test("an answer that ended early with no time limit is not called a timeout — and is never a SyntaxError", () => {
    for (const body of ["", STREAMED_ROWS]) {
      const error: unknown = capture(() => {
        return ClickhouseReadResult.readJson(body);
      });

      expect(error).toBeInstanceOf(ServerException);
      expect(error).not.toBeInstanceOf(TimeoutException);
      expect(error).not.toBeInstanceOf(SyntaxError);
      expect((error as ServerException).message).toBe(
        "The database's answer to this query ended before it was complete.",
      );
    }
  });

  // 'throw' after rows were streamed, on 26.x.
  test("rows followed by 26.x's exception block are a stop at the limit, not the rows", () => {
    expectStoppedAtLimit(
      capture(() => {
        return ClickhouseReadResult.readJson(
          STREAMED_ROWS + exceptionBlock(TIMEOUT_TEXT_26),
          { timeLimitInSeconds: 45, exceptionTag: TAG },
        );
      }),
      LIMIT_MESSAGE_45,
    );
  });

  test("the block is read without the tag header too", () => {
    expectStoppedAtLimit(
      capture(() => {
        return ClickhouseReadResult.readJson(
          STREAMED_ROWS + exceptionBlock(TIMEOUT_TEXT_26),
          { timeLimitInSeconds: 45 },
        );
      }),
      LIMIT_MESSAGE_45,
    );
  });

  test("another error in the block is that error, with its code and type", () => {
    const error: unknown = capture(() => {
      return ClickhouseReadResult.readJson(
        STREAMED_ROWS + exceptionBlock(MEMORY_TEXT_26),
        { timeLimitInSeconds: 45, exceptionTag: TAG },
      );
    });

    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error).toEqual(
      expect.objectContaining({
        code: "241",
        type: "MEMORY_LIMIT_EXCEEDED",
        message: MEMORY_TEXT_26,
      }),
    );
  });

  /*
   * The tag is what tells ClickHouse's block from data: a log line can hold
   * the marker. A body that only looks framed is an answer that ended early.
   */
  test("a block whose tag is not the header's is not taken for ClickHouse's", () => {
    const error: unknown = capture(() => {
      return ClickhouseReadResult.readJson(
        STREAMED_ROWS + exceptionBlock(MEMORY_TEXT_26, "someone-elses-tag"),
        { timeLimitInSeconds: 45, exceptionTag: TAG },
      );
    });

    expectStoppedAtLimit(error, LIMIT_MESSAGE_45);
  });

  test("a log line ending in the marker is data, not an error", () => {
    const loggedMarker: string = `${STREAMED_ROWS},\n\t\t{\n\t\t\t"body": "debug: __exception__`;

    expectStoppedAtLimit(
      capture(() => {
        return ClickhouseReadResult.readJson(loggedMarker, {
          timeLimitInSeconds: 45,
          exceptionTag: TAG,
        });
      }),
      LIMIT_MESSAGE_45,
    );
  });

  /*
   * 'throw' after rows were streamed, on 24.x: the document is finished and
   * parses — with the rows it had and an "exception" member. Read as it
   * was, that is partial rows that look complete.
   */
  test("24.x's whole document with an exception member is the error, never its partial rows", () => {
    const partial: string = JSON.stringify({
      meta: [{ name: "id", type: "String" }],
      data: [{ id: "44337" }, { id: "44347" }],
      rows: 2,
      exception: TIMEOUT_TEXT_24,
    });

    expectStoppedAtLimit(
      capture(() => {
        return ClickhouseReadResult.readJson(partial, {
          timeLimitInSeconds: 45,
        });
      }),
      LIMIT_MESSAGE_45,
    );

    const memory: unknown = capture(() => {
      return ClickhouseReadResult.readJson(
        JSON.stringify({ data: [], exception: MEMORY_TEXT_26 }),
      );
    });

    expect(memory).toEqual(
      expect.objectContaining({ code: "241", type: "MEMORY_LIMIT_EXCEEDED" }),
    );
  });

  test("an exception member that is not ClickHouse's error text still fails the read", () => {
    const error: unknown = capture(() => {
      return ClickhouseReadResult.readJson(
        JSON.stringify({ data: [{ id: "1" }], exception: "Something broke" }),
      );
    });

    expect(error).toBeInstanceOf(ClickHouseError);
    expect((error as ClickHouseError).message).toBe("Something broke");
  });

  test("an empty or non-string exception member is no error", () => {
    expect(
      ClickhouseReadResult.readJson(
        JSON.stringify({ data: [{ id: "1" }], exception: "" }),
      ),
    ).toEqual({ data: [{ id: "1" }], exception: "" });
    expect(ClickhouseReadResult.readJson("[1, 2]")).toEqual([1, 2]);
    expect(ClickhouseReadResult.readJson("null")).toBeNull();
  });

  /*
   * The reader runs on whatever ClickHouse sent, megabytes of rows included,
   * so every step is a scan with indexOf, never a pattern that could go
   * back over the text. Each of these is the worst shape for one step.
   */
  test.each([
    ["a run of open parentheses", "Code: 159. " + "(".repeat(400000)],
    [
      "parenthesised words that are not types",
      "Code: 159. " + "(a)".repeat(140000),
    ],
    ["a huge unclosed type", "Code: 159. (" + "A".repeat(400000)],
    ["markers everywhere", "__exception__\n".repeat(30000)],
    ["a cut-off document", STREAMED_ROWS.repeat(2000)],
  ])("reads %s in linear time", (_name: string, body: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        capture(() => {
          return ClickhouseReadResult.readJson(body, {
            timeLimitInSeconds: 45,
            exceptionTag: TAG,
          });
        });
        ClickhouseReadResult.parseErrorText(body);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("ClickhouseReadResult.guard", () => {
  interface StandIn {
    query_id: string;
    response_headers: Record<string, string>;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
  }

  function resultSet(
    text: string | Error,
    headers: Record<string, string> = {},
  ): StandIn {
    return {
      query_id: "query-1",
      response_headers: headers,
      json: async (): Promise<unknown> => {
        throw new Error("the guarded json() must not call the original");
      },
      text: async (): Promise<string> => {
        if (text instanceof Error) {
          throw text;
        }

        return text;
      },
    };
  }

  test("hands back the same result set, its json() reading the whole answer", async () => {
    const original: StandIn = resultSet(WHOLE_DOCUMENT);
    const guarded: StandIn = ClickhouseReadResult.guard(original, {
      timeLimitInSeconds: 45,
    });

    expect(guarded).toBe(original);
    expect(guarded.query_id).toBe("query-1");
    expect(await guarded.json()).toEqual(
      expect.objectContaining({ data: [{ count: 42 }] }),
    );
  });

  test("an empty answer rejects with the stop, not a SyntaxError", async () => {
    const guarded: StandIn = ClickhouseReadResult.guard(resultSet(""), {
      timeLimitInSeconds: 45,
    });

    expectStoppedAtLimit(
      await captureAsync(() => {
        return guarded.json();
      }),
      LIMIT_MESSAGE_45,
    );
  });

  test("the exception tag comes from the response headers", async () => {
    const guarded: StandIn = ClickhouseReadResult.guard(
      resultSet(STREAMED_ROWS + exceptionBlock(MEMORY_TEXT_26), {
        "x-clickhouse-exception-tag": TAG,
      }),
      { timeLimitInSeconds: 45 },
    );

    expect(
      await captureAsync(() => {
        return guarded.json();
      }),
    ).toEqual(expect.objectContaining({ code: "241" }));

    // A header naming another tag: the block is not ClickHouse's.
    const mismatched: StandIn = ClickhouseReadResult.guard(
      resultSet(STREAMED_ROWS + exceptionBlock(MEMORY_TEXT_26), {
        "x-clickhouse-exception-tag": "another",
      }),
      { timeLimitInSeconds: 45 },
    );

    expectStoppedAtLimit(
      await captureAsync(() => {
        return mismatched.json();
      }),
      LIMIT_MESSAGE_45,
    );
  });

  test("a body that could not be read is rethrown as what it was", async () => {
    const aborted: Error = new Error("aborted");

    expect(
      await captureAsync(() => {
        return ClickhouseReadResult.guard(resultSet(aborted)).json();
      }),
    ).toBe(aborted);

    expectStoppedAtLimit(
      await captureAsync(() => {
        return ClickhouseReadResult.guard(
          resultSet(
            new ClickHouseError({
              message: TIMEOUT_TEXT_26,
              code: "159",
              type: "TIMEOUT_EXCEEDED",
            }),
          ),
          { timeLimitInSeconds: 45 },
        ).json();
      }),
      LIMIT_MESSAGE_45,
    );
  });

  describe("a stand-in with json() and no text() (a test double)", () => {
    test("its document passes through", async () => {
      const guarded: { json: () => Promise<unknown> } =
        ClickhouseReadResult.guard({
          json: async (): Promise<unknown> => {
            return { data: [{ id: "1" }] };
          },
        });

      expect(await guarded.json()).toEqual({ data: [{ id: "1" }] });
    });

    test("a SyntaxError from it is the stop it stands for", async () => {
      const guarded: { json: () => Promise<unknown> } =
        ClickhouseReadResult.guard(
          {
            json: async (): Promise<unknown> => {
              return JSON.parse("");
            },
          },
          { timeLimitInSeconds: 45 },
        );

      expectStoppedAtLimit(
        await captureAsync(() => {
          return guarded.json();
        }),
        LIMIT_MESSAGE_45,
      );
    });

    test("an exception member in its document still fails the read", async () => {
      const guarded: { json: () => Promise<unknown> } =
        ClickhouseReadResult.guard(
          {
            json: async (): Promise<unknown> => {
              return { data: [{ id: "1" }], exception: TIMEOUT_TEXT_24 };
            },
          },
          { timeLimitInSeconds: 45 },
        );

      expectStoppedAtLimit(
        await captureAsync(() => {
          return guarded.json();
        }),
        LIMIT_MESSAGE_45,
      );
    });

    test("any other failure is rethrown, a stop mapped", async () => {
      const failing: Error = new Error("connection reset");

      expect(
        await captureAsync(() => {
          return ClickhouseReadResult.guard({
            json: async (): Promise<unknown> => {
              throw failing;
            },
          }).json();
        }),
      ).toBe(failing);

      expectStoppedAtLimit(
        await captureAsync(() => {
          return ClickhouseReadResult.guard(
            {
              json: async (): Promise<unknown> => {
                throw new ClickHouseError({
                  message: TIMEOUT_TEXT_26,
                  code: "159",
                  type: "TIMEOUT_EXCEEDED",
                });
              },
            },
            { timeLimitInSeconds: 45 },
          ).json();
        }),
        LIMIT_MESSAGE_45,
      );
    });
  });

  test("leaves anything that is not a result set alone", () => {
    expect(ClickhouseReadResult.guard(null)).toBeNull();
    expect(ClickhouseReadResult.guard(undefined)).toBeUndefined();

    const noJson: { query_id: string } = { query_id: "x" };
    expect(ClickhouseReadResult.guard(noJson)).toBe(noJson);
  });
});
