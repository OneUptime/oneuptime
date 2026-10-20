import ObjectID from "Common/Types/ObjectID";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import LogCountBaseline from "Common/Models/AnalyticsModels/LogCountBaseline";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricBaselineHourly from "Common/Models/AnalyticsModels/MetricBaselineHourly";
import Span from "Common/Models/AnalyticsModels/Span";
import SpanCountBaseline from "Common/Models/AnalyticsModels/SpanCountBaseline";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import CountAnomaly, {
  CountBaselineStats,
} from "Common/Server/Utils/Monitor/Criteria/CountAnomaly";
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
 * CorrectBaselineViewHourOfWeek and the baseline readers against a real
 * ClickHouse.
 *
 * The unit suites pin the statements. This one shows what they do. It
 * builds the three baseline tables and their sources the way an existing
 * install has them - local tables from the models, a Distributed table in
 * front of each baseline, the views with the old mode-1 weekday - writes a
 * week of telemetry through those views, one hour of every day, and checks
 * every one of the 168 hour-of-week cells against the telemetry behind it:
 *
 *   - the old views put Monday at 232..255, and a single-slot lookup reads
 *     the next day's history;
 *   - the readers already return each cell's own history before the views
 *     change;
 *   - two migrations run at once while telemetry keeps arriving lose and
 *     double nothing, leave the stored rows as they are, and leave every
 *     view on the model's encoding;
 *   - with both encodings in the same cells, down to the same minute, the
 *     readers still return exactly the telemetry behind each cell;
 *   - a view re-created with the old definition afterwards does not break
 *     the readers, and the next run corrects it; a view missing on the host
 *     is created from the corrected model.
 *
 * The CI server is a single node without Keeper, so ON CLUSTER is left out
 * of the statements; the stock config's one-node cluster `default` stands in
 * for the install's cluster in the Distributed tables and in the migration's
 * clusterAllReplicas() check. The telemetry is dated relative to today, so
 * it falls inside the readers' window whenever this runs.
 *
 * The App Test workflow provides the ClickHouse server; the guard at the
 * bottom fails the run there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/CorrectBaselineViewHourOfWeekClickhouse.test.ts
 * ------------------------------------------------------------------
 */

const STAND_IN_CLUSTER: string = "default";

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

jest.mock("Common/Server/Utils/AnalyticsDatabase/ClusterConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/AnalyticsDatabase/ClusterConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    getClickhouseClusterName: (): string => {
      return "default";
    },
    onClusterClause: (): string => {
      return "";
    },
    applyClusterToMaterializedViewQuery: (query: string): string => {
      return (
        actual["applyClusterToMaterializedViewQuery"] as (q: string) => string
      )(query).replace(/ ON CLUSTER '[^']*'/, "");
    },
  };
});

import { LogCountBaselineService } from "Common/Server/Services/LogCountBaselineService";
import {
  BaselineSummary,
  MetricBaselineService,
} from "Common/Server/Services/MetricBaselineService";
import MetricService from "Common/Server/Services/MetricService";
import { SpanCountBaselineService } from "Common/Server/Services/SpanCountBaselineService";
import {
  applyClusterToMaterializedViewQuery,
  getStorageTableName,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import CorrectBaselineViewHourOfWeek from "../../../FeatureSet/Workers/DataMigrations/CorrectBaselineViewHourOfWeek";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `baseline_view_hour_of_week_test_${process.pid}_${Date.now()}`;

const projectId: string = ObjectID.generate().toString();
const serviceId: string = ObjectID.generate().toString();

const ALL_CELLS: Array<number> = Array.from(
  { length: 168 },
  (_: unknown, i: number) => {
    return i;
  },
);

type ModelType = { new (): AnalyticsBaseModel };

interface Pairing {
  baseline: ModelType;
  source: ModelType;
  // The timestamp column the view reads.
  timeColumn: string;
  // Inserts `rows` source rows from `at` (a ClickHouse DateTime expression).
  insert: (at: string, rows: number) => string;
  // How many raw samples the baseline counts: rows for Log/Span, points for Metric.
  mergedTotal: string;
}

const PAIRINGS: Array<Pairing> = [
  {
    baseline: LogCountBaseline,
    source: Log,
    timeColumn: "time",
    insert: (at: string, rows: number): string => {
      return `INSERT INTO ${getStorageTableName(new Log().tableName)} (projectId, primaryEntityId, severityText, time, timeUnixNano) SELECT '${projectId}', '${serviceId}', 'Information', ${at} + toIntervalSecond(number), 0 FROM numbers(${rows})`;
    },
    mergedTotal: "countMerge(logCountState)",
  },
  {
    baseline: SpanCountBaseline,
    source: Span,
    timeColumn: "startTime",
    insert: (at: string, rows: number): string => {
      return `INSERT INTO ${getStorageTableName(new Span().tableName)} (projectId, primaryEntityId, startTime, statusCode) SELECT '${projectId}', '${serviceId}', ${at} + toIntervalSecond(number), 0 FROM numbers(${rows})`;
    },
    mergedTotal: "countMerge(spanCountState)",
  },
  {
    baseline: MetricBaselineHourly,
    source: Metric,
    timeColumn: "time",
    // The value grows with the second, so mean, min and max differ per cell.
    insert: (at: string, rows: number): string => {
      return `INSERT INTO ${getStorageTableName(new Metric().tableName)} (projectId, name, primaryEntityId, time, value) SELECT '${projectId}', 'requests', '${serviceId}', ${at} + toIntervalSecond(number), toFloat64(toHour(${at}) * 100 + number) FROM numbers(${rows})`;
    },
    mergedTotal: "countMerge(sampleCountState)",
  },
];

// Midnight `daysAgo` days back, plus `hour`.
function at(daysAgo: number, hour: number): string {
  return `toDateTime(today() - ${daysAgo}) + toIntervalHour(${hour})`;
}

// A different number of rows for each of the 168 hours of the written week.
function rowsFor(daysAgo: number, hour: number): number {
  return daysAgo * 24 + hour;
}

// A view as an install created it before the fix: mode 1, minus one.
function oldViewQuery(model: AnalyticsBaseModel, timeColumn: string): string {
  return applyClusterToMaterializedViewQuery(
    model.materializedViews[0]!.query,
  ).replace(
    `toDayOfWeek(${timeColumn}) - 1`,
    `toDayOfWeek(${timeColumn}, 1) - 1`,
  );
}

integration("CorrectBaselineViewHourOfWeek against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let metricBaselines: MetricBaselineService;
  let logBaselines: LogCountBaselineService;
  let spanBaselines: SpanCountBaselineService;
  let originalDatabaseName: string | undefined;
  let original:
    | Pick<
        typeof MetricService,
        | "database"
        | "databaseClient"
        | "migrationDatabase"
        | "migrationDatabaseClient"
      >
    | undefined;

  async function rows<T>(query: string): Promise<Array<T>> {
    const result: Awaited<ReturnType<ClickhouseClient["query"]>> =
      await client.query({ query: query, format: "JSONEachRow" });

    return (await result.json()) as Array<T>;
  }

  async function run(query: string): Promise<void> {
    await client.command({ query: query });
  }

  async function createLocalTable(modelType: ModelType): Promise<void> {
    const model: AnalyticsBaseModel = new modelType();
    const generator: StatementGenerator<AnalyticsBaseModel> =
      new StatementGenerator<AnalyticsBaseModel>({
        modelType: modelType,
        database: clickhouse,
      });

    const columns: Statement = generator.toColumnsCreateStatement(
      model.tableColumns,
    );

    await client.command({
      query: `CREATE TABLE ${database}.${getStorageTableName(model.tableName)} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")}) SETTINGS ${model.tableSettings}`,
      query_params: columns.query_params,
    });
  }

  // The source rows behind hour-of-week cell `cell`, inside the readers' window.
  function cellOfSource(p: Pairing, cell: number): string {
    const t: string = p.timeColumn;
    return `FROM ${database}.${getStorageTableName(new p.source().tableName)}
      WHERE projectId = '${projectId}'
        AND toDayOfWeek(${t}) = ${Math.floor(cell / 24) + 1}
        AND toHour(${t}) = ${cell % 24}
        AND toDate(${t}) >= today() - INTERVAL ${MetricBaselineService.DEFAULT_WINDOW_DAYS} DAY`;
  }

  // What a count baseline must report: the stats of the per-minute counts.
  async function expectedCount(
    p: Pairing,
    cell: number,
  ): Promise<CountBaselineStats | null> {
    const t: string = p.timeColumn;
    const perMinute: Array<{ c: string }> = await rows<{ c: string }>(
      `SELECT count() AS c ${cellOfSource(p, cell)} GROUP BY toDate(${t}), toMinute(${t})`,
    );

    return CountAnomaly.computeStats(
      perMinute.map((r: { c: string }) => {
        return Number(r.c);
      }),
    );
  }

  async function expectedMetric(cell: number): Promise<{
    sampleCount: number;
    mean: number;
    stddev: number;
    minObserved: number;
    maxObserved: number;
  }> {
    const result: Array<Record<string, string>> = await rows<
      Record<string, string>
    >(
      `SELECT count() AS n, avg(value) AS mean, stddevPop(value) AS sd, min(value) AS lo, max(value) AS hi ${cellOfSource(PAIRINGS[2]!, cell)}`,
    );
    const r: Record<string, string> = result[0]!;

    return {
      sampleCount: Number(r["n"]),
      mean: Number(r["mean"]),
      stddev: Number(r["sd"]),
      minObserved: Number(r["lo"]),
      maxObserved: Number(r["hi"]),
    };
  }

  async function expectReadersMatchTelemetry(): Promise<void> {
    for (const cell of ALL_CELLS) {
      for (const [service, pairing] of [
        [logBaselines, PAIRINGS[0]!],
        [spanBaselines, PAIRINGS[1]!],
      ] as Array<
        [LogCountBaselineService | SpanCountBaselineService, Pairing]
      >) {
        const summary: CountBaselineStats | null = await service.getBaseline({
          projectId,
          hourOfWeek: cell,
        });
        const expected: CountBaselineStats | null = await expectedCount(
          pairing,
          cell,
        );

        // Summed in a different order, so the deviation can differ in the last bit.
        const { stddev, madSigma, ...exact } = expected!;
        expect({ cell, ...summary }).toMatchObject({ cell, ...exact });
        expect(summary!.stddev).toBeCloseTo(stddev, 9);
        expect(summary!.madSigma).toBeCloseTo(madSigma, 9);
      }

      const metric: BaselineSummary | null = await metricBaselines.getBaseline({
        projectId,
        metricName: "requests",
        hourOfWeek: cell,
      });
      const expected: Awaited<ReturnType<typeof expectedMetric>> =
        await expectedMetric(cell);

      expect({
        cell,
        n: metric?.sampleCount,
        lo: metric?.minObserved,
        hi: metric?.maxObserved,
      }).toEqual({
        cell,
        n: expected.sampleCount,
        lo: expected.minObserved,
        hi: expected.maxObserved,
      });
      expect(metric!.mean).toBeCloseTo(expected.mean, 9);
      expect(metric!.stddev).toBeCloseTo(expected.stddev, 9);
    }
  }

  async function hourRangeOn(
    p: Pairing,
    daysAgo: number,
  ): Promise<{ lo: number; hi: number }> {
    const result: Array<{ lo: number; hi: number }> = await rows<{
      lo: number;
      hi: number;
    }>(
      `SELECT min(hourOfWeek) AS lo, max(hourOfWeek) AS hi
      FROM ${database}.${getStorageTableName(new p.baseline().tableName)}
      WHERE projectId = '${projectId}' AND day = today() - ${daysAgo}`,
    );

    return { lo: Number(result[0]!.lo), hi: Number(result[0]!.hi) };
  }

  async function viewQueryOf(p: Pairing): Promise<string> {
    const result: Array<{ q: string }> = await rows<{ q: string }>(
      `SELECT create_table_query AS q FROM system.tables WHERE database = '${database}' AND name = '${new p.baseline().materializedViews[0]!.name}'`,
    );

    return result[0]?.q || "";
  }

  // Raw samples written vs samples the baseline holds, and its stored rows.
  async function totalsOf(
    p: Pairing,
  ): Promise<{ raw: string; merged: string; storedRows: string }> {
    const source: string = getStorageTableName(new p.source().tableName);
    const baseline: string = getStorageTableName(new p.baseline().tableName);
    const result: Array<{ raw: string; merged: string; storedRows: string }> =
      await rows<{ raw: string; merged: string; storedRows: string }>(
        `SELECT
          toString((SELECT count() FROM ${database}.${source} WHERE projectId = '${projectId}')) AS raw,
          toString((SELECT ${p.mergedTotal} FROM ${database}.${baseline} WHERE projectId = '${projectId}')) AS merged,
          toString((SELECT count() FROM ${database}.${baseline} WHERE projectId = '${projectId}' AND day < today())) AS storedRows`,
      );

    return result[0]!;
  }

  async function writeWeek(): Promise<void> {
    for (const p of PAIRINGS) {
      for (let daysAgo: number = 1; daysAgo <= 7; daysAgo++) {
        for (let hour: number = 0; hour < 24; hour++) {
          await run(p.insert(at(daysAgo, hour), rowsFor(daysAgo, hour)));
        }
      }
    }
  }

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
      /*
       * execute() leaves each response unread, which keeps its socket out of
       * the pool for a while; with the client's default of 10, the
       * migration's statements would wait tens of seconds for one.
       */
      max_open_connections: 50,
    };

    // connect() creates the database it is pointed at.
    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    for (const p of PAIRINGS) {
      await createLocalTable(p.source);
      await createLocalTable(p.baseline);

      const baseline: AnalyticsBaseModel = new p.baseline();
      const local: string = getStorageTableName(baseline.tableName);

      // The app-facing table, in front of the local one as on the cluster.
      await run(
        `CREATE TABLE ${database}.${baseline.tableName} AS ${database}.${local} ENGINE = Distributed('${STAND_IN_CLUSTER}', '${database}', '${local}', ${baseline.shardingKey})`,
      );

      await run(oldViewQuery(baseline, p.timeColumn));
    }

    await writeWeek();

    metricBaselines = new MetricBaselineService(clickhouse);
    logBaselines = new LogCountBaselineService(clickhouse);
    spanBaselines = new SpanCountBaselineService(clickhouse);

    original = {
      database: MetricService.database,
      databaseClient: MetricService.databaseClient,
      migrationDatabase: MetricService.migrationDatabase,
      migrationDatabaseClient: MetricService.migrationDatabaseClient,
    };

    MetricService.database = clickhouse;
    MetricService.databaseClient = client;
    MetricService.migrationDatabase = clickhouse;
    MetricService.migrationDatabaseClient = client;

    originalDatabaseName = process.env["CLICKHOUSE_DATABASE"];
    process.env["CLICKHOUSE_DATABASE"] = database;
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(MetricService, original);
    }

    if (originalDatabaseName === undefined) {
      delete process.env["CLICKHOUSE_DATABASE"];
    } else {
      process.env["CLICKHOUSE_DATABASE"] = originalDatabaseName;
    }

    if (client) {
      await client.command({
        query: `DROP DATABASE IF EXISTS ${database} SYNC`,
      });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the old views put Monday at 232..255, and a single-slot lookup reads the next day", async () => {
    const monday: number = Number(
      (
        await rows<{ d: string }>(
          "SELECT toString(toRelativeDayNum(today()) - toRelativeDayNum(toMonday(today() - 1))) AS d",
        )
      )[0]!.d,
    );

    for (const p of PAIRINGS) {
      expect(await hourRangeOn(p, monday)).toEqual({ lo: 232, hi: 255 });
    }

    // What the readers did before: Monday 13:00 at hourOfWeek = 13 is Tuesday's.
    const singleSlot: Array<{ c: string }> = await rows<{ c: string }>(
      `SELECT toString(countMerge(logCountState)) AS c FROM ${database}.LogCountBaseline WHERE projectId = '${projectId}' AND hourOfWeek = 13`,
    );
    const tuesday: number = monday === 1 ? 7 : monday - 1;
    expect(Number(singleSlot[0]!.c)).toBe(rowsFor(tuesday, 13));
  });

  test("the readers return each cell's own history before the views change", async () => {
    await expectReadersMatchTelemetry();
  });

  test("two runs at once, with telemetry arriving, lose and double nothing and rewrite no row", async () => {
    const before: Array<{ storedRows: string }> = [];
    for (const p of PAIRINGS) {
      before.push(await totalsOf(p));
    }

    let writing: boolean = true;
    const writer: Promise<void> = (async (): Promise<void> => {
      while (writing) {
        for (const p of PAIRINGS) {
          await run(p.insert("now()", 3));
        }
      }
    })();

    await Promise.all([
      new CorrectBaselineViewHourOfWeek().migrate(),
      new CorrectBaselineViewHourOfWeek().migrate(),
    ]);
    writing = false;
    await writer;

    for (const [i, p] of PAIRINGS.entries()) {
      const view: string = await viewQueryOf(p);
      expect(
        CorrectBaselineViewHourOfWeek.carriesModelEncoding(
          view,
          new p.baseline().materializedViews[0]!,
        ),
      ).toBe(true);
      expect(view).not.toMatch(/toDayOfWeek\([^)]*, 1\)/);

      const after: { raw: string; merged: string; storedRows: string } =
        await totalsOf(p);
      expect(after.merged).toBe(after.raw);
      expect(after.storedRows).toBe(before[i]!.storedRows);
    }
  });

  test("with both encodings in the same cells and minutes, the readers return exactly the telemetry", async () => {
    // The same seconds again, now through the corrected views.
    for (const p of PAIRINGS) {
      for (let daysAgo: number = 1; daysAgo <= 7; daysAgo++) {
        for (let hour: number = 0; hour < 24; hour += 5) {
          await run(p.insert(at(daysAgo, hour), 4));
        }
      }
    }

    await expectReadersMatchTelemetry();

    /*
     * The chart band carries each cell's own mean. computeHourOfWeek reads
     * the process timezone, so each point is built in it.
     */
    for (const cell of ALL_CELLS) {
      const point: Date = new Date();
      point.setDate(
        point.getDate() -
          ((point.getDay() + 6) % 7) +
          Math.floor(cell / 24) -
          7,
      );
      point.setHours(cell % 24, 0, 0, 0);

      const band: Array<{ mean: number }> = await metricBaselines.getBandSeries(
        {
          projectId,
          metricName: "requests",
          startTime: point,
          endTime: point,
          intervalMinutes: 60,
          sigmaCount: 3,
        },
      );
      expect({ cell, points: band.length }).toEqual({ cell, points: 1 });
      expect(band[0]!.mean).toBeCloseTo((await expectedMetric(cell)).mean, 9);
    }
  });

  test("a view re-created with the old definition keeps the readers right, and the next run corrects it", async () => {
    const logs: Pairing = PAIRINGS[0]!;
    const view: string = new LogCountBaseline().materializedViews[0]!.name;

    await run(`DROP VIEW ${database}.${view} SYNC`);
    await run(oldViewQuery(new LogCountBaseline(), logs.timeColumn));
    for (let daysAgo: number = 1; daysAgo <= 7; daysAgo++) {
      await run(logs.insert(at(daysAgo, 13), 6));
    }

    await expectReadersMatchTelemetry();

    await new CorrectBaselineViewHourOfWeek().migrate();
    expect(
      CorrectBaselineViewHourOfWeek.carriesModelEncoding(
        await viewQueryOf(logs),
        new LogCountBaseline().materializedViews[0]!,
      ),
    ).toBe(true);
  });

  test("a view missing on the host is created from the corrected model", async () => {
    const spans: Pairing = PAIRINGS[1]!;
    const view: string = new SpanCountBaseline().materializedViews[0]!.name;

    await run(`DROP VIEW ${database}.${view} SYNC`);

    await new CorrectBaselineViewHourOfWeek().migrate();

    expect(
      CorrectBaselineViewHourOfWeek.carriesModelEncoding(
        await viewQueryOf(spans),
        new SpanCountBaseline().materializedViews[0]!,
      ),
    ).toBe(true);
  });

  test("a run on corrected views changes none of them", async () => {
    const views: Array<string> = [];
    for (const p of PAIRINGS) {
      views.push(await viewQueryOf(p));
    }

    await new CorrectBaselineViewHourOfWeek().migrate();

    for (const [i, p] of PAIRINGS.entries()) {
      expect(await viewQueryOf(p)).toBe(views[i]);
    }
  });

  test("a cell lookup stays on the sort key", async () => {
    const plan: Array<{ explain: string }> = await rows<{ explain: string }>(
      `EXPLAIN indexes = 1 SELECT countMerge(sampleCountState) FROM ${database}.MetricBaselineHourlyLocal WHERE projectId = '${projectId}' AND name = 'requests' AND ${MetricBaselineService.hourOfWeekCellFilter(13)}`,
    );

    expect(
      plan
        .map((r: { explain: string }) => {
          return r.explain;
        })
        .join("\n"),
    ).toMatch(/hourOfWeek in 2-element set/);
  });
});

describe("baseline hour-of-week ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
