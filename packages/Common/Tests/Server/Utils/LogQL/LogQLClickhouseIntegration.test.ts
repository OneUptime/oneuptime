import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import {
  ClickhousePassword,
  ClickhouseUsername,
} from "../../../../Server/EnvironmentConfig";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import LogQLClickhouseSource from "../../../../Server/Utils/LogQL/LogQLClickhouseSource";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import LogQLEngine, {
  LogQLDirection,
  LogQLResult,
  LogQLStream,
} from "../../../../Utils/LogQL/LogQLEngine";
import {
  PromQLMatrixResultSeries,
  PromQLQueryResult,
  PromQLResultType,
  PromQLVectorResultSample,
} from "../../../../Utils/PromQL/PromQLEngineTypes";
import { PromQLLabels } from "../../../../Utils/PromQL/PromQLLabels";
import { PromQLMatchType } from "../../../../Utils/PromQL/PromQLAst";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * LOGQL OVER A PROJECT'S LOGS IN A REAL CLICKHOUSE (issue #7700).
 *
 * The unit tests hold the statements to their shape; this runs them, and
 * the engine over them, on a table keyed as the product's LogItemV3 is:
 *
 *   - a log query reads the caller's project and services alone, within
 *     retention, newest (or oldest) first, to the nanosecond: from its
 *     start, with it, up to its end;
 *   - line filters and matchers are checked in ClickHouse as the engine
 *     checks them, a regular expression as RE2;
 *   - a count is made in ClickHouse, by the labels a query reads or by
 *     every label, in windows open at their start and closed at their end;
 *   - a pipeline ClickHouse cannot run is run over the lines themselves;
 *   - /series and the levels present read the same logs.
 *
 * Opt in against a local ClickHouse server, for example
 *   docker run --rm -p 127.0.0.1:8193:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 * then TEST_CLICKHOUSE_URL=http://localhost:8193 CLICKHOUSE_PASSWORD=test npx jest <this file>.
 * The suite creates and removes only its own uniquely named database.
 */
const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `logql_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000007700",
);
const OTHER_PROJECT: string = "0192f1a0-0000-7000-8000-000000007701";
const CHECKOUT: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000077c1");
const BILLING: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000077b1");
// A service of the project the caller may not read.
const PAYROLL: string = "0192f1a0-0000-7000-8000-0000000077d1";

const NS: bigint = BigInt(1000000000);

// A whole minute ten minutes ago: every log below is in the last hour.
const T_MS: number = Math.floor(Date.now() / 60000) * 60000 - 10 * 60000;
const T_NS: bigint = BigInt(T_MS) * BigInt(1000000);

const after: (seconds: number, extraNs?: number) => bigint = (
  seconds: number,
  extraNs: number = 0,
): bigint => {
  return T_NS + BigInt(seconds) * NS + BigInt(extraNs);
};

const GET_INFO: PromQLLabels = {
  detected_level: "info",
  http_method: "GET",
  service_name: "checkout",
};
const POST_ERROR: PromQLLabels = {
  detected_level: "error",
  http_method: "POST",
  service_name: "checkout",
};

let client: ClickHouseClient;

const rowsOf: (statement: Statement) => Promise<Array<JSONObject>> = async (
  statement: Statement,
): Promise<Array<JSONObject>> => {
  const result: { json: () => Promise<unknown> } = await client.query({
    query: statement.query,
    query_params: statement.query_params,
    format: "JSON",
  });

  return ((await result.json()) as { data: Array<JSONObject> }).data;
};

const source: () => LogQLClickhouseSource = (): LogQLClickhouseSource => {
  return new LogQLClickhouseSource({
    projectId: PROJECT_ID,
    // The services the caller may read: not payroll.
    serviceFilter: { serviceIds: [CHECKOUT, BILLING] },
    readRows: rowsOf,
  });
};

const engine: () => LogQLEngine = (): LogQLEngine => {
  return new LogQLEngine(source());
};

const streamsOf: (result: LogQLResult) => Array<LogQLStream> = (
  result: LogQLResult,
): Array<LogQLStream> => {
  if (result.resultType !== "streams") {
    throw new Error("not streams");
  }

  return result.streams;
};

const vectorOf: (
  result: LogQLResult,
) => Array<{ labels: PromQLLabels; value: number }> = (
  result: LogQLResult,
): Array<{ labels: PromQLLabels; value: number }> => {
  if (
    result.resultType !== "metric" ||
    result.result.resultType !== PromQLResultType.Vector
  ) {
    throw new Error("not a vector");
  }

  return result.result.samples.map(
    (
      sample: PromQLVectorResultSample,
    ): { labels: PromQLLabels; value: number } => {
      return { labels: sample.labels, value: sample.value };
    },
  );
};

integration("LogQL over a project's logs in a real ClickHouse", () => {
  beforeAll(async (): Promise<void> => {
    // The real ClickHouse HTTP client needs Node timers with unref().
    jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
    jest.spyOn(globalThis, "clearTimeout").mockImplementation(nodeClearTimeout);

    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "This integration suite requires a local ClickHouse server.",
      );
    }

    const admin: ClickHouseClient = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
    });
    await admin.command({ query: `CREATE DATABASE ${database}` });
    await admin.close();

    client = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
      database,
      request_timeout: 120000,
    });

    const line: (data: {
      project?: string;
      service: string;
      at: bigint;
      severity: "Info" | "Error";
      body: string;
      attributes: Record<string, string>;
      expired?: boolean;
    }) => string = (data: {
      project?: string;
      service: string;
      at: bigint;
      severity: "Info" | "Error";
      body: string;
      attributes: Record<string, string>;
      expired?: boolean;
    }): string => {
      const attributes: string = Object.entries(data.attributes)
        .map(([key, value]: [string, string]): string => {
          return `'${key}', '${value}'`;
        })
        .join(", ");

      return `('${data.project || PROJECT_ID.toString()}', '${data.service}', fromUnixTimestamp64Nano(toInt64(${data.at.toString()})), ${data.at.toString()}, '${data.severity}', ${data.severity === "Error" ? 17 : 9}, '${data.body}', map(${attributes}), ${data.expired ? "today() - 1" : "today() + 15"})`;
    };

    const checkout: (method: string) => Record<string, string> = (
      method: string,
    ): Record<string, string> => {
      return { "resource.service.name": "checkout", "http.method": method };
    };

    await client.command({
      query:
        "CREATE TABLE LogItemV3 (projectId String, primaryEntityId String, time DateTime64(9), timeUnixNano UInt64, severityText LowCardinality(String), severityNumber Int32, body Nullable(String), attributes Map(String, String), retentionDate Date) ENGINE = MergeTree PARTITION BY toYYYYMMDD(time) PRIMARY KEY (projectId, time, primaryEntityId) ORDER BY (projectId, time, primaryEntityId)",
    });
    await client.command({
      query: `INSERT INTO LogItemV3 (projectId, primaryEntityId, time, timeUnixNano, severityText, severityNumber, body, attributes, retentionDate) VALUES ${[
        line({
          service: CHECKOUT.toString(),
          at: after(0),
          severity: "Info",
          body: "GET /cart 200",
          attributes: checkout("GET"),
        }),
        line({
          service: CHECKOUT.toString(),
          at: after(1, 5),
          severity: "Info",
          body: "GET /cart 200",
          attributes: checkout("GET"),
        }),
        line({
          service: CHECKOUT.toString(),
          at: after(2),
          severity: "Error",
          body: '{"method":"POST","path":"/pay","status":500}',
          attributes: checkout("POST"),
        }),
        line({
          service: CHECKOUT.toString(),
          at: after(3),
          severity: "Info",
          body: "GET /cart 200",
          attributes: checkout("GET"),
        }),
        line({
          service: BILLING.toString(),
          at: after(4),
          severity: "Info",
          body: "invoice sent",
          attributes: { "resource.service.name": "billing" },
        }),
        line({
          service: CHECKOUT.toString(),
          at: after(60),
          severity: "Info",
          body: "GET /cart 200",
          attributes: checkout("GET"),
        }),
        line({
          service: CHECKOUT.toString(),
          at: after(65),
          severity: "Error",
          body: '{"method":"POST","path":"/pay","status":503}',
          attributes: checkout("POST"),
        }),
        // Never read: another project's, a service the caller may not read, past retention.
        line({
          project: OTHER_PROJECT,
          service: CHECKOUT.toString(),
          at: after(5),
          severity: "Info",
          body: "GET /cart 200 elsewhere",
          attributes: checkout("GET"),
        }),
        line({
          service: PAYROLL,
          at: after(6),
          severity: "Info",
          body: "GET /cart 200 payroll",
          attributes: checkout("GET"),
        }),
        line({
          service: CHECKOUT.toString(),
          at: after(7),
          severity: "Info",
          body: "GET /cart 200 expired",
          attributes: checkout("GET"),
          expired: true,
        }),
      ].join(", ")}`,
    });
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      await client.close();
    }
  });

  test("a log query reads the caller's logs alone, newest first, to the nanosecond", async () => {
    const streams: Array<LogQLStream> = streamsOf(
      await engine().rangeQuery({
        query: '{service_name="checkout"}',
        startMs: T_MS,
        endMs: T_MS + 120000,
        stepMs: 1000,
        limit: 100,
        direction: LogQLDirection.Backward,
      }),
    );

    expect(streams).toEqual([
      {
        labels: POST_ERROR,
        values: [
          [
            after(65).toString(),
            '{"method":"POST","path":"/pay","status":503}',
          ],
          [after(2).toString(), '{"method":"POST","path":"/pay","status":500}'],
        ],
      },
      {
        labels: GET_INFO,
        values: [
          [after(60).toString(), "GET /cart 200"],
          [after(3).toString(), "GET /cart 200"],
          [after(1, 5).toString(), "GET /cart 200"],
          [after(0).toString(), "GET /cart 200"],
        ],
      },
    ]);
  });

  test("oldest first going forward, up to the limit", async () => {
    const streams: Array<LogQLStream> = streamsOf(
      await engine().rangeQuery({
        query: '{service_name=~"check.+"}',
        startMs: T_MS,
        endMs: T_MS + 120000,
        stepMs: 1000,
        limit: 2,
        direction: LogQLDirection.Forward,
      }),
    );

    expect(streams).toEqual([
      {
        labels: GET_INFO,
        values: [
          [after(0).toString(), "GET /cart 200"],
          [after(1, 5).toString(), "GET /cart 200"],
        ],
      },
    ]);
  });

  test("line filters are checked as text and as RE2", async () => {
    for (const query of [
      '{service_name="checkout"} |= "pay"',
      '{service_name="checkout"} |~ "GET|POST" != "cart"',
      '{service_name="checkout", detected_level="error"}',
    ]) {
      const streams: Array<LogQLStream> = streamsOf(
        await engine().rangeQuery({
          query,
          startMs: T_MS,
          endMs: T_MS + 120000,
          stepMs: 1000,
          limit: 100,
          direction: LogQLDirection.Backward,
        }),
      );

      expect({ query, streams }).toEqual({
        query,
        streams: [
          {
            labels: POST_ERROR,
            values: [
              [
                after(65).toString(),
                '{"method":"POST","path":"/pay","status":503}',
              ],
              [
                after(2).toString(),
                '{"method":"POST","path":"/pay","status":500}',
              ],
            ],
          },
        ],
      });
    }
  });

  test("a count by level is made in ClickHouse, in a window open at its start", async () => {
    // (T, T + 60s]: the log at T is out, the one at T + 60s in.
    expect(
      vectorOf(
        await engine().instantQuery({
          query:
            'sum by (detected_level) (count_over_time({service_name="checkout"}[1m]))',
          timeMs: T_MS + 60000,
        }),
      ),
    ).toEqual([
      { labels: { detected_level: "error" }, value: 1 },
      { labels: { detected_level: "info" }, value: 3 },
    ]);
  });

  test("a count by every label keeps each label set apart", async () => {
    expect(
      vectorOf(
        await engine().instantQuery({
          query: 'count_over_time({service_name=~"checkout|billing"}[1m])',
          timeMs: T_MS + 60000,
        }),
      ),
    ).toEqual([
      {
        labels: {
          detected_level: "error",
          http_method: "POST",
          service_name: "checkout",
        },
        value: 1,
      },
      // Prometheus' order (labels.Compare): http_method before service_name.
      {
        labels: {
          detected_level: "info",
          http_method: "GET",
          service_name: "checkout",
        },
        value: 3,
      },
      { labels: { detected_level: "info", service_name: "billing" }, value: 1 },
    ]);
  });

  test("a range query counts each step's window", async () => {
    const result: LogQLResult = await engine().rangeQuery({
      query: 'sum(count_over_time({service_name="checkout"}[1m]))',
      startMs: T_MS + 60000,
      endMs: T_MS + 120000,
      stepMs: 60000,
      limit: 100,
      direction: LogQLDirection.Backward,
    });

    if (result.resultType !== "metric") {
      throw new Error("not a metric");
    }

    const matrix: PromQLQueryResult = result.result;

    if (matrix.resultType !== PromQLResultType.Matrix) {
      throw new Error("not a matrix");
    }

    expect(
      matrix.series.map((series: PromQLMatrixResultSeries) => {
        return series.points;
      }),
    ).toEqual([
      [
        { timestampMs: T_MS + 60000, value: 4 },
        { timestampMs: T_MS + 120000, value: 1 },
      ],
    ]);
  });

  test("a pipeline ClickHouse cannot run is run over the lines", async () => {
    expect(
      vectorOf(
        await engine().instantQuery({
          query:
            'sum(count_over_time({service_name="checkout"} | json | __error__="" | status >= 500 [2m]))',
          timeMs: T_MS + 120000,
        }),
      ),
    ).toEqual([{ labels: {}, value: 2 }]);
  });

  test("series and the levels present read the same logs", async () => {
    const sets: Array<PromQLLabels> = await source().readLabelSets({
      matchers: [
        {
          name: "service_name",
          type: PromQLMatchType.Equal,
          value: "checkout",
        },
      ],
      startNs: T_NS,
      endNs: after(120),
      limit: 100,
    });

    expect(sets).toHaveLength(2);
    expect(sets).toEqual(expect.arrayContaining([GET_INFO, POST_ERROR]));

    expect(
      (
        await source().readDetectedLevels({ startNs: T_NS, endNs: after(120) })
      ).sort(),
    ).toEqual(["error", "info"]);
  });
});
