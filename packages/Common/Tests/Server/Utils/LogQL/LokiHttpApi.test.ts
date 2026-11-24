import {
  LOKI_DEFAULT_LIMIT,
  LOKI_TIMEOUT_MESSAGE,
  LokiCountingSource,
  LokiErrorAnswer,
  parseLokiDuration,
  parseLokiTime,
  readLokiBounds,
  readLokiDirection,
  readLokiInterval,
  readLokiLimit,
  readLokiStep,
  readMatchSelectors,
  runLokiInstantQuery,
  runLokiRangeQuery,
  toLokiErrorAnswer,
} from "../../../../Server/Utils/LogQL/LokiHttpApi";
import { JSONObject } from "../../../../Types/JSON";
import LogQLEngine, {
  LogQLDirection,
  LogQLLinesRequest,
  LogQLLogRow,
  LogQLLogSource,
  LogQLSamplesRequest,
  sourceLineFilters,
} from "../../../../Utils/LogQL/LogQLEngine";
import { LogQLStage } from "../../../../Utils/LogQL/LogQLAst";
import { LogQLPipeline } from "../../../../Utils/LogQL/LogQLPipeline";
import PromQLError, {
  PromQLErrorType,
} from "../../../../Utils/PromQL/PromQLError";
import { PromQLLabels } from "../../../../Utils/PromQL/PromQLLabels";
import { describe, expect, test } from "@jest/globals";

/*
 * The Loki HTTP API's reading and writing (issue #7700): Loki's parameters
 * read as Loki reads them, and answers written in Loki's shapes, so
 * Grafana's Loki data source and logcli read OneUptime unchanged.
 */

const NS: bigint = BigInt(1000000000);
const T0_S: number = 1763632800; // 2025-11-20T10:00:00Z
const T0_NS: bigint = BigInt(T0_S) * NS;

const at: (seconds: number, extraNs: number) => string = (
  seconds: number,
  extraNs: number,
): string => {
  return (BigInt(T0_S + seconds) * NS + BigInt(extraNs)).toString();
};

const CHECKOUT: PromQLLabels = {
  service_name: "checkout",
  detected_level: "info",
};
const CHECKOUT_ERRORS: PromQLLabels = {
  service_name: "checkout",
  detected_level: "error",
};
const BILLING: PromQLLabels = {
  service_name: "billing",
  detected_level: "info",
};

const LOGS: Array<LogQLLogRow> = [
  { timeNs: at(1, 5), labels: CHECKOUT, line: "GET /cart 200" },
  { timeNs: at(2, 0), labels: CHECKOUT_ERRORS, line: "POST /pay 500" },
  { timeNs: at(3, 0), labels: CHECKOUT, line: "GET /cart 200" },
  { timeNs: at(4, 0), labels: BILLING, line: "invoice sent" },
  { timeNs: at(5, 0), labels: CHECKOUT_ERRORS, line: "POST /pay 503" },
];

// Logs held here, read as a source must: by matchers, range and direction.
class HeldLogs implements LogQLLogSource {
  private kept(selector: LogQLLinesRequest["selector"]): Array<LogQLLogRow> {
    const pipeline: LogQLPipeline = new LogQLPipeline({
      kind: "LogSelector",
      matchers: selector.matchers,
      stages: sourceLineFilters(selector) as Array<LogQLStage>,
    });

    return LOGS.filter((row: LogQLLogRow): boolean => {
      return pipeline.run({ line: row.line, labels: row.labels }) !== null;
    });
  }

  public async readLines(request: LogQLLinesRequest): Promise<{
    rows: Array<LogQLLogRow>;
    reachedLimit: boolean;
  }> {
    const rows: Array<LogQLLogRow> = this.kept(request.selector)
      .filter((row: LogQLLogRow): boolean => {
        const time: bigint = BigInt(row.timeNs);
        return time >= request.startNs && time < request.endNs;
      })
      .sort((a: LogQLLogRow, b: LogQLLogRow): number => {
        const order: number = BigInt(a.timeNs) < BigInt(b.timeNs) ? -1 : 1;
        return request.direction === LogQLDirection.Forward ? order : -order;
      });

    return {
      rows: rows.slice(0, request.limit),
      reachedLimit: rows.length > request.limit,
    };
  }

  public async readSamples(request: LogQLSamplesRequest): Promise<{
    rows: Array<LogQLLogRow>;
    reachedLimit: boolean;
  }> {
    const rows: Array<LogQLLogRow> = this.kept(request.selector).filter(
      (row: LogQLLogRow): boolean => {
        const time: bigint = BigInt(row.timeNs);
        return time > request.startNs && time <= request.endNs;
      },
    );

    return { rows, reachedLimit: false };
  }
}

const engineOver: () => {
  engine: LogQLEngine;
  source: LokiCountingSource;
} = (): { engine: LogQLEngine; source: LokiCountingSource } => {
  const source: LokiCountingSource = new LokiCountingSource(new HeldLogs());
  return { engine: new LogQLEngine(source), source };
};

const dataOf: (body: JSONObject) => JSONObject = (
  body: JSONObject,
): JSONObject => {
  expect(body["status"]).toBe("success");
  return body["data"] as JSONObject;
};

describe("Loki's parameters", () => {
  test.each([
    ["1763632800", T0_NS],
    ["1763632800000000000", T0_NS],
    ["1763632800.5", T0_NS + BigInt(500000000)],
    // A fraction is read to the millisecond, as Loki reads it.
    ["1763632800.0004", T0_NS],
    ["2025-11-20T10:00:00Z", T0_NS],
    ["2025-11-20T10:00:00.123456789Z", T0_NS + BigInt(123456789)],
    ["2025-11-20T12:00:00+02:00", T0_NS],
  ])("the time %s is %s nanoseconds", (text: string, expected: bigint) => {
    expect(parseLokiTime(text, "start", BigInt(0))).toBe(expected);
  });

  test("an empty time is the default, and a wrong one is refused by name", () => {
    expect(parseLokiTime("", "end", BigInt(7))).toBe(BigInt(7));
    expect(parseLokiTime(undefined, "end", BigInt(7))).toBe(BigInt(7));
    expect(() => {
      return parseLokiTime("yesterday", "start", BigInt(0));
    }).toThrow(`could not parse 'start' parameter: "yesterday" is not a time`);
  });

  test.each([
    ["15", 15000],
    ["0.5", 500],
    ["1m30s", 90000],
    // What Grafana sends: whole milliseconds.
    ["60000ms", 60000],
  ])("the step %s is %d ms", (text: string, expected: number) => {
    expect(parseLokiDuration(text)).toBe(expected);
  });

  test("a step that is no duration is refused in Loki's words", () => {
    expect(() => {
      return parseLokiDuration("soon");
    }).toThrow('cannot parse "soon" to a valid duration');
  });

  test("a range is the hour before its end by default, or `since` before it", () => {
    const now: bigint = T0_NS;

    expect(readLokiBounds({}, now)).toEqual({
      startNs: now - BigInt(3600) * NS,
      endNs: now,
    });
    expect(readLokiBounds({ since: "5m" }, now)).toEqual({
      startNs: now - BigInt(300) * NS,
      endNs: now,
    });
    // An end still to come: `since` is counted back from now.
    expect(
      readLokiBounds({ since: "5m", end: String(T0_S + 600) }, now),
    ).toEqual({
      startNs: now - BigInt(300) * NS,
      endNs: now + BigInt(600) * NS,
    });
    expect(() => {
      return readLokiBounds({ since: "a while" }, now);
    }).toThrow("could not parse 'since' parameter");
  });

  test("limit is 100 by default, above 0, and at most 5,000 lines for a log query", () => {
    expect(readLokiLimit({}, true)).toBe(LOKI_DEFAULT_LIMIT);
    expect(readLokiLimit({ limit: "1000" }, true)).toBe(1000);
    expect(() => {
      return readLokiLimit({ limit: "0" }, true);
    }).toThrow("limit must be a positive value");
    expect(() => {
      return readLokiLimit({ limit: "5001" }, true);
    }).toThrow(
      "max entries limit per query exceeded, limit > max_entries_limit_per_query (5001 > 5000)",
    );
    // A metric query's limit is not read.
    expect(readLokiLimit({ limit: "10000" }, false)).toBe(10000);
    expect(() => {
      return readLokiLimit({ limit: "many" }, true);
    }).toThrow("could not parse 'limit' parameter");
  });

  test("direction is backward by default, in any case", () => {
    expect(readLokiDirection({})).toBe(LogQLDirection.Backward);
    expect(readLokiDirection({ direction: "FORWARD" })).toBe(
      LogQLDirection.Forward,
    );
    expect(() => {
      return readLokiDirection({ direction: "up" });
    }).toThrow("invalid direction 'up'");
  });

  test("the step is a 250th of the range by default, and 11,000 steps at most", () => {
    const hour: { startNs: bigint; endNs: bigint } = {
      startNs: T0_NS,
      endNs: T0_NS + BigInt(3600) * NS,
    };

    expect(readLokiStep({}, hour)).toBe(14000);
    expect(readLokiStep({}, { startNs: T0_NS, endNs: T0_NS })).toBe(1000);
    // 11,000 steps after the first are allowed, as Loki allows them.
    expect(
      readLokiStep(
        { step: "1" },
        { startNs: T0_NS, endNs: T0_NS + BigInt(11000) * NS },
      ),
    ).toBe(1000);
    expect(() => {
      return readLokiStep(
        { step: "1" },
        { startNs: T0_NS, endNs: T0_NS + BigInt(11001) * NS },
      );
    }).toThrow(
      "exceeded maximum resolution of 11,000 points per timeseries. Try increasing the value of the step parameter",
    );
    expect(() => {
      return readLokiStep({ step: "0" }, hour);
    }).toThrow(
      "zero or negative query resolution step widths are not accepted",
    );
  });

  test("an interval is 0 by default, and never below it", () => {
    expect(readLokiInterval({})).toBe(0);
    expect(readLokiInterval({ interval: "2s" })).toBe(2000);
    expect(() => {
      return readLokiInterval({ interval: "-1" });
    }).toThrow("interval must be >= 0");
  });

  test("match[] takes stream selectors, each once", () => {
    expect(
      readMatchSelectors({
        "match[]": ['{service_name="checkout"}', '{service_name="checkout"}'],
      }),
    ).toHaveLength(1);
    expect(() => {
      return readMatchSelectors({
        "match[]": 'count_over_time({service_name="checkout"}[1m])',
      });
    }).toThrow("match[] takes a stream selector");
  });
});

describe("Loki's answers", () => {
  test("a log query answers streams newest first, in Loki's shape and order", async () => {
    const { engine, source } = engineOver();
    const body: JSONObject = await runLokiRangeQuery({
      engine,
      source,
      params: {
        query: '{service_name="checkout"}',
        start: at(0, 0),
        end: at(10, 0),
        limit: "3",
      },
      nowNs: T0_NS + BigInt(60) * NS,
    });
    const data: JSONObject = dataOf(body);

    expect(data["resultType"]).toBe("streams");
    // By each stream's labels as text: error before info.
    expect(data["result"]).toEqual([
      {
        stream: CHECKOUT_ERRORS,
        values: [
          [at(5, 0), "POST /pay 503"],
          [at(2, 0), "POST /pay 500"],
        ],
      },
      { stream: CHECKOUT, values: [[at(3, 0), "GET /cart 200"]] },
    ]);

    const summary: JSONObject = (data["stats"] as JSONObject)[
      "summary"
    ] as JSONObject;

    expect(summary["totalEntriesReturned"]).toBe(3);
    expect(summary["totalLinesProcessed"]).toBe(3);
    expect(summary["totalBytesProcessed"]).toBe(
      "POST /pay 503".length + "GET /cart 200".length + "POST /pay 500".length,
    );
    expect(Object.keys(summary).sort()).toEqual(
      [
        "bytesProcessedPerSecond",
        "execTime",
        "linesProcessedPerSecond",
        "queueTime",
        "shards",
        "splits",
        "subqueries",
        "totalBytesProcessed",
        "totalEntriesReturned",
        "totalLinesProcessed",
        "totalPostFilterLines",
        "totalStructuredMetadataBytesProcessed",
      ].sort(),
    );
  });

  test("forward, with an interval, keeps lines that far apart across streams", async () => {
    const { engine, source } = engineOver();
    const data: JSONObject = dataOf(
      await runLokiRangeQuery({
        engine,
        source,
        params: {
          query: '{service_name=~".+"}',
          start: at(0, 0),
          end: at(10, 0),
          direction: "forward",
          interval: "2s",
        },
        nowNs: T0_NS,
      }),
    );

    /*
     * The line at 1s and 5ns, then the first at least 2s after it, 4s: the
     * one at 3s is 5ns too close. Then nothing 2s after 4s.
     */
    expect(data["result"]).toEqual([
      { stream: BILLING, values: [[at(4, 0), "invoice sent"]] },
      { stream: CHECKOUT, values: [[at(1, 5), "GET /cart 200"]] },
    ]);
  });

  test('a metric query over a range answers a matrix of [seconds, "value"]', async () => {
    const { engine, source } = engineOver();
    const data: JSONObject = dataOf(
      await runLokiRangeQuery({
        engine,
        source,
        params: {
          query:
            'sum by (detected_level) (count_over_time({service_name="checkout"}[5s]))',
          start: String(T0_S + 5),
          end: String(T0_S + 10),
          step: "5s",
        },
        nowNs: T0_NS,
      }),
    );

    expect(data["resultType"]).toBe("matrix");
    expect(data["result"]).toEqual([
      {
        metric: { detected_level: "error" },
        values: [[T0_S + 5, "2"]],
      },
      {
        metric: { detected_level: "info" },
        values: [[T0_S + 5, "2"]],
      },
    ]);
  });

  test("Grafana's health check, vector(1)+vector(1), answers 2", async () => {
    const { engine, source } = engineOver();
    const data: JSONObject = dataOf(
      await runLokiInstantQuery({
        engine,
        source,
        params: { query: "vector(1)+vector(1)", time: at(0, 0) },
        nowNs: T0_NS,
      }),
    );

    expect(data["resultType"]).toBe("vector");
    expect(data["result"]).toEqual([{ metric: {}, value: [T0_S, "2"] }]);
  });

  test("an instant log query is refused in Loki's words, as a 400", async () => {
    const { engine, source } = engineOver();
    let answer: LokiErrorAnswer | undefined;

    try {
      await runLokiInstantQuery({
        engine,
        source,
        params: { query: '{service_name="checkout"}' },
        nowNs: T0_NS,
      });
    } catch (error: unknown) {
      answer = toLokiErrorAnswer(error);
    }

    expect(answer).toEqual({
      statusCode: 400,
      text: "log queries are not supported as an instant query type, please change your query to a range query type",
    });
  });

  test("a range that ends before it starts is refused", async () => {
    const { engine, source } = engineOver();

    await expect(
      runLokiRangeQuery({
        engine,
        source,
        params: {
          query: '{service_name="checkout"}',
          start: at(10, 0),
          end: at(0, 0),
        },
        nowNs: T0_NS,
      }),
    ).rejects.toThrow(
      "end timestamp must not be before or equal to start time",
    );
  });

  test("a query is required", async () => {
    const { engine, source } = engineOver();

    await expect(
      runLokiRangeQuery({ engine, source, params: {}, nowNs: T0_NS }),
    ).rejects.toThrow("The query parameter is required");
  });

  test("a stop at the time limit is a 504 in Loki's words; any other error is the server's", () => {
    expect(
      toLokiErrorAnswer(new PromQLError("too slow", PromQLErrorType.Timeout)),
    ).toEqual({ statusCode: 504, text: LOKI_TIMEOUT_MESSAGE });
    expect(
      toLokiErrorAnswer(
        new PromQLError(
          "maximum of series (500) reached for a single query",
          PromQLErrorType.Execution,
        ),
      ),
    ).toEqual({
      statusCode: 400,
      text: "maximum of series (500) reached for a single query",
    });
    expect(toLokiErrorAnswer(new Error("database down"))).toBeUndefined();
  });
});
