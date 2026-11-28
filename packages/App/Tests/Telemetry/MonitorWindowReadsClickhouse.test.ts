import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseSettings } from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  CRITERIA_FILTER_KEY_ATTRIBUTE,
  CRITERIA_FILTER_MATCH_METRIC_NAME,
} from "Common/Types/Monitor/CriteriaFilterMatchHistory";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import { MONITOR_STEP_ID_ATTRIBUTE } from "Common/Types/Monitor/MonitorStepSeries";
import ObjectID from "Common/Types/ObjectID";
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
 * The window an over-time filter judges, read by a real ClickHouse server.
 *
 * On 2026-11-28 OneUptime Cloud's ClickHouse, held to 16 cores, ran the
 * read behind "evaluate over time" criteria 18,904 times in 30 minutes, at
 * 17 seconds and 0.8 CPU-seconds each: it went through the generic find,
 * which read `_id` and sorted by it, read the window's granules twice to
 * page exactly (__sortKeyTopValues), and read the attributes map - the
 * widest column - for every row of those granules to find the monitor
 * step's. ClickHouse's liveness probe then failed, and it restarted six
 * times in an hour. MetricService.readMonitorWindowRows reads the same rows
 * in one pass, the sort key in PREWHERE, the map only for the monitor's own
 * rows. This suite loads a monitor's checks among other series' rows with
 * maps of the size telemetry sends, into a table built from the real Metric
 * model behind a Distributed table as production reads it, and shows:
 *
 *  - it reads the rows the find read, for a monitor of one step (its rows
 *    and the rows that name no step), a step of a monitor of several, a
 *    disk of a server and a match history with each row's probe, on both
 *    of ClickHouse's analyzers;
 *  - newest first, so a window cut at its limit keeps its newest rows;
 *  - in one pass that reads no row id, a fraction of the bytes and fewer
 *    rows than the find read for the same window.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/MonitorWindowReadsClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
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

import MetricService from "Common/Server/Services/MetricService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `monitor_window_reads_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;

// The newest check, on the minute an hour ago: inside every row's retention.
const END: Date = new Date(
  Math.floor(Date.now() / MINUTE) * MINUTE - 60 * MINUTE,
);
const WINDOW_START: Date = new Date(END.getTime() - 10 * MINUTE);

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000001128a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000001128a2",
);
// A Website monitor of one step, checked from two probes.
const ONE_STEP_MONITOR: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000001128b1",
);
const ONE_STEP: string = "0192f1a0-0000-7000-8000-0000001128c1";
// An API monitor of two steps.
const TWO_STEP_MONITOR: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000001128b2",
);
const FIRST_STEP: string = "0192f1a0-0000-7000-8000-0000001128c2";
const SECOND_STEP: string = "0192f1a0-0000-7000-8000-0000001128c3";
// A server with two disks.
const SERVER_MONITOR: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000001128b3",
);
const SERVER_STEP: string = "0192f1a0-0000-7000-8000-0000001128c4";
const PROBE_A: string = "0192f1a0-0000-7000-8000-0000001128d1";
const PROBE_B: string = "0192f1a0-0000-7000-8000-0000001128d2";
const FILTER_KEY: string = "5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const OTHER_FILTER_KEY: string = "0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e";

const inThirtyDays: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);
const yesterday: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), -1),
);

interface CheckRow {
  monitorId: ObjectID;
  metricName: string;
  minutesBeforeEnd: number;
  value: number | null;
  attributes: Record<string, string>;
  isExpired?: boolean | undefined;
}

// A check's row, as MonitorMetricUtil writes it: to the second.
function checkRow(row: CheckRow): JSONObject {
  const at: Date = new Date(END.getTime() - row.minutesBeforeEnd * MINUTE);
  const attributes: Record<string, string> = {
    monitorId: row.monitorId.toString(),
    projectId: PROJECT_ID.toString(),
    monitorName: "Checkout",
    ...row.attributes,
  };

  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(at),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: row.monitorId.toString(),
    primaryEntityType: "Monitor",
    name: row.metricName,
    metricPointType: "Sum",
    time: OneUptimeDate.toClickhouseDateTime(at),
    timeUnixNano: String(at.getTime() * 1000000),
    attributes: attributes,
    attributeKeys: Object.keys(attributes).sort(),
    entityKeys: [],
    value: row.value,
    retentionDate: row.isExpired ? yesterday : inThirtyDays,
  };
}

function fixtures(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (let minute: number = 0; minute <= 30; minute++) {
    // Probe A names the step; probe B's rows before five minutes ago do not.
    rows.push(
      checkRow({
        monitorId: ONE_STEP_MONITOR,
        metricName: MonitorMetricType.ResponseTime,
        minutesBeforeEnd: minute,
        value: 100 + minute,
        attributes: { probeId: PROBE_A, [MONITOR_STEP_ID_ATTRIBUTE]: ONE_STEP },
      }),
      checkRow({
        monitorId: ONE_STEP_MONITOR,
        metricName: MonitorMetricType.ResponseTime,
        minutesBeforeEnd: minute,
        value: 200 + minute,
        attributes:
          minute < 5
            ? { probeId: PROBE_B, [MONITOR_STEP_ID_ATTRIBUTE]: ONE_STEP }
            : { probeId: PROBE_B },
      }),
      // Its online series beside it: another series of the same monitor.
      checkRow({
        monitorId: ONE_STEP_MONITOR,
        metricName: MonitorMetricType.IsOnline,
        minutesBeforeEnd: minute,
        value: 1,
        attributes: { probeId: PROBE_A, [MONITOR_STEP_ID_ATTRIBUTE]: ONE_STEP },
      }),
      // Each step of the monitor of two: a fast page and a slow one.
      checkRow({
        monitorId: TWO_STEP_MONITOR,
        metricName: MonitorMetricType.ResponseTime,
        minutesBeforeEnd: minute,
        value: 10 + minute,
        attributes: {
          probeId: PROBE_A,
          [MONITOR_STEP_ID_ATTRIBUTE]: FIRST_STEP,
        },
      }),
      checkRow({
        monitorId: TWO_STEP_MONITOR,
        metricName: MonitorMetricType.ResponseTime,
        minutesBeforeEnd: minute,
        value: 900 + minute,
        attributes: {
          probeId: PROBE_A,
          [MONITOR_STEP_ID_ATTRIBUTE]: SECOND_STEP,
        },
      }),
      // A server's two disks.
      ...["/", "/data"].map((diskPath: string): JSONObject => {
        return checkRow({
          monitorId: SERVER_MONITOR,
          metricName: MonitorMetricType.DiskUsagePercent,
          minutesBeforeEnd: minute,
          value: diskPath === "/" ? 40 : 70 + minute / 10,
          attributes: {
            diskPath: diskPath,
            [MONITOR_STEP_ID_ATTRIBUTE]: SERVER_STEP,
          },
        });
      }),
      // A body check's match history from each probe, and another filter's.
      checkRow({
        monitorId: ONE_STEP_MONITOR,
        metricName: CRITERIA_FILTER_MATCH_METRIC_NAME,
        minutesBeforeEnd: minute,
        value: minute % 3 === 0 ? 0 : 1,
        attributes: {
          probeId: minute % 2 === 0 ? PROBE_A : PROBE_B,
          [CRITERIA_FILTER_KEY_ATTRIBUTE]: FILTER_KEY,
          [MONITOR_STEP_ID_ATTRIBUTE]: ONE_STEP,
        },
      }),
      checkRow({
        monitorId: ONE_STEP_MONITOR,
        metricName: CRITERIA_FILTER_MATCH_METRIC_NAME,
        minutesBeforeEnd: minute,
        value: 1,
        attributes: {
          probeId: PROBE_A,
          [CRITERIA_FILTER_KEY_ATTRIBUTE]: OTHER_FILTER_KEY,
          [MONITOR_STEP_ID_ATTRIBUTE]: ONE_STEP,
        },
      }),
    );
  }

  // Never read: a check with no value, one past its retention, and a step the monitor no longer has.
  rows.push(
    checkRow({
      monitorId: ONE_STEP_MONITOR,
      metricName: MonitorMetricType.ResponseTime,
      minutesBeforeEnd: 2.5,
      value: null,
      attributes: { probeId: PROBE_A, [MONITOR_STEP_ID_ATTRIBUTE]: ONE_STEP },
    }),
    checkRow({
      monitorId: ONE_STEP_MONITOR,
      metricName: MonitorMetricType.ResponseTime,
      minutesBeforeEnd: 3.5,
      value: 9999,
      attributes: { probeId: PROBE_A, [MONITOR_STEP_ID_ATTRIBUTE]: ONE_STEP },
      isExpired: true,
    }),
    checkRow({
      monitorId: ONE_STEP_MONITOR,
      metricName: MonitorMetricType.ResponseTime,
      minutesBeforeEnd: 1.5,
      value: 7777,
      attributes: {
        probeId: PROBE_A,
        [MONITOR_STEP_ID_ATTRIBUTE]: "0192f1a0-0000-7000-8000-0000001128cf",
      },
    }),
  );

  return rows;
}

let clickhouse: ClickhouseDatabase;
let client: ClickhouseClient;
let options: ClickHouseClientConfigOptions;
let measureSettings: ClickHouseSettings = {};

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
}

let original: ServiceConnection;

// A window's row as both reads hand it back: its time, value and probe.
interface WindowRow {
  at: string;
  value: number;
  probeId: string;
}

/*
 * The rows with a value: the find handed back rows with none too, which
 * every reader of a window then left out (EvaluateOverTime,
 * CriteriaFilterMatchHistory); the window read leaves them out itself.
 */
function toWindowRows(metrics: Array<Metric>): Array<WindowRow> {
  return metrics
    .filter((metric: Metric): boolean => {
      return metric.value !== undefined && metric.value !== null;
    })
    .map((metric: Metric): WindowRow => {
      return {
        at: OneUptimeDate.fromString(metric.time as Date).toISOString(),
        value: Number(metric.value),
        probeId: String(metric.attributes?.["probeId"] || ""),
      };
    });
}

// The same rows in one order: a tie on time may come either way round.
function sorted(rows: Array<WindowRow>): Array<WindowRow> {
  return [...rows].sort((a: WindowRow, b: WindowRow): number => {
    return (
      a.at.localeCompare(b.at) ||
      a.value - b.value ||
      a.probeId.localeCompare(b.probeId)
    );
  });
}

interface WindowScope {
  name: string;
  monitorId: ObjectID;
  metricName: string;
  // The filter the find read the window by, as EvaluateOverTime built it.
  findAttributes: JSONObject;
  // The same filter, as the window read takes it.
  attributes: Record<string, string | Array<string>>;
  readsProbe: boolean;
  expectedCount: number;
}

const SCOPES: Array<WindowScope> = [
  {
    name: "a monitor of one step: its rows and the rows that name no step",
    monitorId: ONE_STEP_MONITOR,
    metricName: MonitorMetricType.ResponseTime,
    findAttributes: {
      [MONITOR_STEP_ID_ATTRIBUTE]: new Includes([ONE_STEP, ""]),
    },
    attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: [ONE_STEP, ""] },
    readsProbe: false,
    // Eleven minutes of two probes; the empty, expired and other step's rows left out.
    expectedCount: 22,
  },
  {
    name: "a step of a monitor of several: that step's rows alone",
    monitorId: TWO_STEP_MONITOR,
    metricName: MonitorMetricType.ResponseTime,
    findAttributes: { [MONITOR_STEP_ID_ATTRIBUTE]: SECOND_STEP },
    attributes: { [MONITOR_STEP_ID_ATTRIBUTE]: [SECOND_STEP] },
    readsProbe: false,
    expectedCount: 11,
  },
  {
    name: "a disk of a server, within its step",
    monitorId: SERVER_MONITOR,
    metricName: MonitorMetricType.DiskUsagePercent,
    findAttributes: {
      diskPath: "/data",
      [MONITOR_STEP_ID_ATTRIBUTE]: SERVER_STEP,
    },
    attributes: {
      diskPath: "/data",
      [MONITOR_STEP_ID_ATTRIBUTE]: [SERVER_STEP],
    },
    readsProbe: false,
    expectedCount: 11,
  },
  {
    name: "a match history, by its filter key, with each row's probe",
    monitorId: ONE_STEP_MONITOR,
    metricName: CRITERIA_FILTER_MATCH_METRIC_NAME,
    findAttributes: { [CRITERIA_FILTER_KEY_ATTRIBUTE]: FILTER_KEY },
    attributes: { [CRITERIA_FILTER_KEY_ATTRIBUTE]: FILTER_KEY },
    readsProbe: true,
    expectedCount: 11,
  },
];

// The window as the find through findBy read it, before readMonitorWindowRows.
function findWindow(scope: WindowScope): Promise<Array<Metric>> {
  return MetricService.findBy({
    query: {
      projectId: PROJECT_ID,
      time: new InBetween(WINDOW_START, END),
      primaryEntityId: scope.monitorId,
      name: scope.metricName,
      attributes: scope.findAttributes,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: { isRoot: true },
    select: scope.readsProbe
      ? { value: true, time: true, attributes: true }
      : { value: true, time: true },
    sort: { time: SortOrder.Descending },
  });
}

function readWindow(
  scope: WindowScope,
  limit: number = LIMIT_PER_PROJECT,
): Promise<Array<Metric>> {
  return MetricService.readMonitorWindowRows({
    projectId: PROJECT_ID,
    monitorId: scope.monitorId,
    metricName: scope.metricName,
    windowStart: WINDOW_START,
    windowEnd: END,
    attributes: scope.attributes,
    ...(scope.readsProbe ? { readAttributeKeys: ["probeId"] } : {}),
    limit: limit,
  });
}

// Runs `read` with MetricService reading through `connection`.
async function readingThrough<T>(
  connection: ServiceConnection,
  read: () => Promise<T>,
): Promise<T> {
  const own: ServiceConnection = {
    database: MetricService.database,
    databaseClient: MetricService.databaseClient,
  };

  MetricService.database = connection.database;
  MetricService.databaseClient = connection.databaseClient;

  try {
    return await read();
  } finally {
    Object.assign(MetricService, own);
  }
}

/*
 * A connection that reads with ClickHouse's older analyzer, as a server or
 * profile that sets enable_analyzer = 0 still does; null without it.
 */
async function connectWithOlderAnalyzer(): Promise<ServiceConnection | null> {
  const found: { json: () => Promise<unknown> } = await client.query({
    query:
      "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
    format: "JSONEachRow",
  });
  const [setting] = (await found.json()) as Array<{ name: string }>;

  if (!setting) {
    return null;
  }

  const olderOptions: ClickHouseClientConfigOptions = {
    ...options,
    clickhouse_settings: { [setting.name]: 0 } as ClickHouseSettings,
  };
  const olderDatabase: ClickhouseDatabase = new ClickhouseDatabase(
    olderOptions,
  );
  const olderClient: ClickhouseClient =
    await olderDatabase.connect(olderOptions);

  return { database: olderDatabase, databaseClient: olderClient };
}

// The statement a read sends, captured as it is sent and run as usual.
async function statementOf(read: () => Promise<unknown>): Promise<Statement> {
  const sent: Array<Statement> = [];
  const executeQuery: typeof MetricService.executeQuery =
    MetricService.executeQuery.bind(MetricService);

  const spy: ReturnType<typeof jest.spyOn> = jest
    .spyOn(MetricService, "executeQuery")
    .mockImplementation((async (
      statement: Statement,
      ...rest: Array<never>
    ) => {
      sent.push(statement);
      return executeQuery(statement, ...rest);
    }) as never);

  try {
    await read();
  } finally {
    spy.mockRestore();
  }

  expect(sent).toHaveLength(1);

  return sent[0]!;
}

interface ReadCost {
  readRows: number;
  readBytes: number;
  columns: Array<string>;
}

/*
 * What one statement cost ClickHouse, from its own query log: every entry of
 * the read, the initial one and any it sent a shard. The log entry is
 * written after the answer is sent, so the flush is repeated until it is there.
 */
async function costOf(statement: {
  query: string;
  query_params: Record<string, unknown>;
}): Promise<ReadCost> {
  const queryId: string = `monitor-window-${ObjectID.generate().toString()}`;

  const result: { json: () => Promise<unknown> } = await client.query({
    query: statement.query,
    query_params: statement.query_params,
    format: "JSONEachRow",
    query_id: queryId,
    clickhouse_settings: measureSettings,
  });
  await result.json();

  for (let attempt: number = 0; attempt < 100; attempt++) {
    await client.command({ query: "SYSTEM FLUSH LOGS" });

    const logged: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT sum(read_rows) AS readRows, sum(read_bytes) AS readBytes, groupUniqArrayArray(columns) AS columns, count() AS entries FROM system.query_log WHERE type = 'QueryFinish' AND (query_id = {id:String} OR initial_query_id = {id:String})",
      query_params: { id: queryId },
      format: "JSONEachRow",
    });

    const [row] = (await logged.json()) as Array<{
      readRows: string | number;
      readBytes: string | number;
      columns: Array<string>;
      entries: string | number;
    }>;

    if (Number(row!.entries) > 0) {
      return {
        readRows: Number(row!.readRows),
        readBytes: Number(row!.readBytes),
        columns: row!.columns,
      };
    }

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`No query_log entry for ${queryId}.`);
}

integration(
  "the window an over-time filter judges, in a real ClickHouse",
  () => {
    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      options = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database: database,
        request_timeout: 240000,
      };

      // Connecting creates the database.
      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      // Measured without the query condition cache, so a repeat read is not cheaper for an earlier one.
      const conditionCache: { json: () => Promise<unknown> } =
        await client.query({
          query:
            "SELECT count() AS present FROM system.settings WHERE name = 'use_query_condition_cache'",
          format: "JSONEachRow",
        });
      const [cache] = (await conditionCache.json()) as Array<{
        present: string | number;
      }>;
      measureSettings = (
        Number(cache!.present) > 0 ? { use_query_condition_cache: 0 } : {}
      ) as ClickHouseSettings;

      /*
       * The model's own table, and the Distributed table the service reads in
       * front of it, over the server's one-shard `default` cluster, as
       * production reads it.
       */
      const model: AnalyticsBaseModel = new Metric();
      const generator: StatementGenerator<AnalyticsBaseModel> =
        new StatementGenerator<AnalyticsBaseModel>({
          modelType: Metric,
          database: clickhouse,
        });
      const columns: Statement = generator.toColumnsCreateStatement(
        model.tableColumns,
      );

      await client.command({
        query: `CREATE TABLE ${database}.${model.tableName}Local (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
        query_params: columns.query_params,
      });
      await client.command({
        query: `CREATE TABLE ${database}.${model.tableName} AS ${database}.${model.tableName}Local ENGINE = Distributed('default', ${database}, ${model.tableName}Local, ${model.shardingKey || "rand()"})`,
      });

      await client.insert({
        table: `${database}.${model.tableName}Local`,
        values: fixtures(),
        format: "JSONEachRow",
      });

      /*
       * Other series' rows around them, written in the same minutes: 4,000
       * monitors of the project checked every minute, and the project's and
       * another project's telemetry, with maps of the size telemetry sends -
       * about 450 bytes a row. They fill the granules the monitor's own rows
       * are in, which is what the find read the map of.
       */
      await client.command({
        query: `INSERT INTO ${database}.${model.tableName}Local (projectId, primaryEntityId, primaryEntityType, name, metricPointType, time, timeUnixNano, attributes, attributeKeys, entityKeys, value, retentionDate, _id, createdAt)
        SELECT
          if(number % 3 = 0, '${OTHER_PROJECT_ID.toString()}', '${PROJECT_ID.toString()}'),
          concat('0192f1a0-0000-7000-8000-', leftPad(toString(number % 4000), 12, '0')),
          'Monitor',
          arrayElement(['${MonitorMetricType.ResponseTime}', '${MonitorMetricType.IsOnline}', 'http.server.duration', 'system.cpu.utilization'], 1 + intDiv(number, 4000) % 4),
          'Sum',
          toDateTime64(${Math.floor(END.getTime() / 1000)} - (intDiv(number, 16000) % 31) * 60, 9) AS rowTime,
          toUInt64(toUnixTimestamp64Nano(rowTime)),
          map('monitorId', toString(number % 4000), 'probeId', '${PROBE_A}', 'monitorStepId', toString(generateUUIDv4(number % 4000)), 'http.route', '/api/v1/orders/{id}/items', 'service.instance.id', toString(generateUUIDv4(number)), 'host.name', concat('ip-10-0-', toString(number % 256), '.ec2.internal'), 'k8s.pod.name', concat('checkout-7f9c8d-', hex(number % 65536)), 'telemetry.sdk.version', '1.26.0', 'monitorName', concat('A monitor with a name of some length ', toString(number % 4000))) AS rowAttributes,
          arraySort(mapKeys(rowAttributes)),
          [],
          number % 1000,
          '${inThirtyDays}',
          toString(generateUUIDv4(number + 1)),
          now()
        FROM numbers(${16000 * 31})`,
      });

      await client.command({
        query: `OPTIMIZE TABLE ${database}.${model.tableName}Local FINAL`,
      });

      original = {
        database: MetricService.database,
        databaseClient: MetricService.databaseClient,
      };

      MetricService.database = clickhouse;
      MetricService.databaseClient = client;
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        MetricService.database = original.database;
        MetricService.databaseClient = original.databaseClient;
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
        await client.close();
      }
    });

    describe.each(SCOPES)("$name", (scope: WindowScope) => {
      test("reads the rows the find read, on both analyzers", async () => {
        const found: Array<WindowRow> = toWindowRows(await findWindow(scope));
        const read: Array<WindowRow> = toWindowRows(await readWindow(scope));

        expect(read).toHaveLength(scope.expectedCount);
        expect(sorted(read)).toEqual(sorted(found));

        if (scope.readsProbe) {
          expect(
            new Set(
              read.map((row: WindowRow): string => {
                return row.probeId;
              }),
            ),
          ).toEqual(new Set([PROBE_A, PROBE_B]));
        }

        const older: ServiceConnection | null =
          await connectWithOlderAnalyzer();

        if (older) {
          try {
            const readOlder: Array<WindowRow> = toWindowRows(
              await readingThrough(older, (): Promise<Array<Metric>> => {
                return readWindow(scope);
              }),
            );

            expect(sorted(readOlder)).toEqual(sorted(found));
          } finally {
            await older.databaseClient?.close();
          }
        }
      });
    });

    test("hands the rows back newest first, so a window cut at its limit keeps its newest", async () => {
      const all: Array<WindowRow> = toWindowRows(await readWindow(SCOPES[1]!));

      expect(
        all.map((row: WindowRow): string => {
          return row.at;
        }),
      ).toEqual(
        [...all]
          .map((row: WindowRow): string => {
            return row.at;
          })
          .sort()
          .reverse(),
      );

      const cut: Array<WindowRow> = toWindowRows(
        await readWindow(SCOPES[1]!, 3),
      );

      expect(cut).toEqual(all.slice(0, 3));
      expect(cut[0]!.at).toBe(END.toISOString());
    });

    test("reads the window in one pass, with no row id and a fraction of the bytes the find read", async () => {
      const scope: WindowScope = SCOPES[0]!;

      const find: ReadCost = await costOf(
        await statementOf((): Promise<unknown> => {
          return findWindow(scope);
        }),
      );
      const read: ReadCost = await costOf(
        await statementOf((): Promise<unknown> => {
          return readWindow(scope);
        }),
      );

      // The find read `_id` to sort by; the window read never does.
      expect(
        find.columns.some((column: string): boolean => {
          return column.endsWith("._id");
        }),
      ).toBe(true);
      expect(
        read.columns.some((column: string): boolean => {
          return column.endsWith("._id");
        }),
      ).toBe(false);

      // One pass over the granules the key selects, not two.
      expect(read.readRows).toBeLessThan(find.readRows);

      // And the map read for the monitor's own rows alone.
      expect(read.readBytes * 2).toBeLessThan(find.readBytes);
    });

  },
);

describe("Monitor window ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
