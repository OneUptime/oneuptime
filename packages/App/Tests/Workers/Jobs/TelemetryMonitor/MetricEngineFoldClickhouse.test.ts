import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import {
  ENGINE_FOLD_AGGREGATIONS,
  StoredPoint,
  engineExpression,
  engineFold,
  isPresent,
} from "Common/Tests/Types/Monitor/MetricEngineFold";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * The metric engine's folds against a real ClickHouse server.
 *
 * Common's MessageQueueAlertTemplates suite evaluates every queue alert
 * template over broker-shaped rows through engineFold, a port of the SQL
 * MetricService folds a monitor query's one-minute buckets with, and pins
 * that SQL verbatim. What a string comparison cannot show is that ClickHouse
 * computes what the port says: multiIf over NULLs, a Summary point with no
 * samples, a CloudWatch period whose engine Max is its mean. So this suite
 * runs the engine's own expression for every aggregation the port models
 * over literal rows and holds the answer to engineFold. It lives here, not
 * in Common, because the App Test workflow is the one that provides a
 * ClickHouse server.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/MetricEngineFoldClickhouse.test.ts
 *
 * The suite only runs SELECTs over literal rows and creates nothing. The
 * App Test workflow provides the server; the guard at the bottom fails the
 * run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

/*
 * One bucket of stored rows per case: the shapes a queue's broker metrics
 * arrive in, and the corners of the fold.
 */
const BUCKETS: Array<[string, Array<StoredPoint>]> = [
  [
    "one CloudWatch period of twelve failures",
    [{ value: 12, count: 12, sum: 12, min: null, max: null }],
  ],
  [
    "the same CloudWatch period reported twice",
    [
      { value: 12, count: 12, sum: 12, min: null, max: null },
      { value: 12, count: 12, sum: 12, min: null, max: null },
    ],
  ],
  [
    "a CloudWatch level: five samples averaging 1,000",
    [{ value: 5000, count: 5, sum: 5000, min: null, max: null }],
  ],
  [
    "a Summary point with no samples",
    [{ value: 0, count: 0, sum: 0, min: null, max: null }],
  ],
  ["scalar gauge samples", [{ value: 1200 }, { value: 50 }, { value: 7.5 }]],
  [
    "a histogram point that carries its min and max",
    [{ value: 30, count: 3, sum: 30, min: 2, max: 20 }],
  ],
  [
    "scalar and distribution rows in one bucket",
    [
      { value: 4 },
      { value: 30, count: 3, sum: 30, min: null, max: null },
      { value: 9, count: 1, sum: 9, min: 9, max: 9 },
    ],
  ],
];

function sqlNumber(value: number | null | undefined): string {
  return isPresent(value) ? String(value) : "NULL";
}

// The rows of one bucket as a ClickHouse values() table of Metric's columns.
function valuesTable(points: Array<StoredPoint>): string {
  const rows: string = points
    .map((point: StoredPoint): string => {
      return `(${sqlNumber(point.value)}, ${sqlNumber(
        point.count,
      )}, ${sqlNumber(point.sum)}, ${sqlNumber(point.min)}, ${sqlNumber(
        point.max,
      )})`;
    })
    .join(", ");

  return `values('value Nullable(Float64), count Nullable(UInt64), sum Nullable(Float64), min Nullable(Float64), max Nullable(Float64)', ${rows})`;
}

integration("The metric engine's folds on a real ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    // "default" always exists, so connecting creates nothing.
    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: "default",
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);
  });

  afterAll(async (): Promise<void> => {
    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test.each(BUCKETS)(
    "%s folds exactly as the model says, for every aggregation",
    async (_name: string, points: Array<StoredPoint>) => {
      for (const aggregationType of ENGINE_FOLD_AGGREGATIONS) {
        const result: { data: Array<{ folded: number | null }> } = (await (
          await client.query({
            query: `SELECT ${engineExpression(
              aggregationType,
            )} AS folded FROM ${valuesTable(points)}`,
            format: "JSON",
          })
        ).json()) as { data: Array<{ folded: number | null }> };

        expect({
          aggregationType: aggregationType,
          folded: result.data[0]!.folded,
        }).toEqual({
          aggregationType: aggregationType,
          folded: engineFold(points, aggregationType),
        });
      }
    },
  );
});

describe("Metric engine fold ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
