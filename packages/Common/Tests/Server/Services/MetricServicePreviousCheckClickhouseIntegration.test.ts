import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import MetricService, {
  MonitorPreviousCheckRow,
} from "../../../Server/Services/MetricService";
import {
  ClickhousePassword,
  ClickhouseUsername,
} from "../../../Server/EnvironmentConfig";
import { getClickhouseDatabaseName } from "../../../Server/Utils/AnalyticsDatabase/ClusterConfig";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import PreviousCheckComparison from "../../../Server/Utils/Monitor/Criteria/PreviousCheckComparison";
import { CheckWindowJudgement } from "../../../Server/Utils/Monitor/Criteria/CheckWindowCounts";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  PreviousCheckChangeType,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  CRITERIA_FILTER_KEY_ATTRIBUTE,
  CRITERIA_FILTER_MATCH_METRIC_NAME,
} from "../../../Types/Monitor/CriteriaFilterMatchHistory";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A CHECK'S PREVIOUS CHECK, READ BY A REAL CLICKHOUSE (#10821).
 *
 * MetricService.readPreviousMonitorChecks against the product's own Metric
 * table (created from its model), with rows written as a monitor's checks
 * write them - to the second, one row a series a check:
 *
 *  - the newest row before the check, per probe, never the check's own row
 *    written the same second;
 *  - a probe whose previous check is older than the window has none;
 *  - each disk of a disk series on its own;
 *  - a match history, by its filter key;
 *  - rows past their retention date, rows with no value and other monitors'
 *    rows are left out - the value is Nullable, which an aggregate must read
 *    as a value (#10780 found arraySum refusing it);
 *  - one bounded read: the monitor's own granules, over a day of checks.
 *
 * Opt in against a local ClickHouse server, for example
 *   docker run --rm -d --name <a name of your own> -p 127.0.0.1:8194:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7.38.18
 * then TEST_CLICKHOUSE_URL=http://localhost:8194 CLICKHOUSE_PASSWORD=test npx jest <this file>.
 * The suite creates and removes only its own uniquely named database.
 */
const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(600000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `previous_check_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000010821a",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000010821b",
);
const SERVER_MONITOR_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000010821c",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000010821d",
);
const PROBE_A: string = "0192f1a0-0000-7000-8000-0000000108a1";
const PROBE_B: string = "0192f1a0-0000-7000-8000-0000000108b1";
const PROBE_C: string = "0192f1a0-0000-7000-8000-0000000108c1";
const FILTER_KEY: string = "a8d1f2c3b4e5f60718293a4b5c6d7e8f";
const OTHER_FILTER_KEY: string = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

const MINUTE: number = 60 * 1000;

/*
 * When the check being judged began to be written: half a second into a
 * second, as MonitorResource takes it, its rows stamped with that second.
 */
const WRITTEN_AT: Date = new Date(
  Math.floor((Date.now() - 2 * MINUTE) / 1000) * 1000 + 300,
);

let client: ClickHouseClient;
const queryIds: Array<string> = [];
// The database the product's statements name, swapped for this suite's own.
const defaultDatabase: string = getClickhouseDatabaseName();

// A row of a check, as MonitorMetricUtil writes one: to the second.
function checkRow(input: {
  monitorId?: ObjectID;
  metricName: string;
  msBeforeWritten: number;
  value: number | null;
  attributes?: Record<string, string>;
  isExpired?: boolean;
}): JSONObject {
  const at: Date = new Date(WRITTEN_AT.getTime() - input.msBeforeWritten);
  const attributes: Record<string, string> = {
    monitorId: (input.monitorId || MONITOR_ID).toString(),
    projectId: PROJECT_ID.toString(),
    ...input.attributes,
  };

  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(at),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: (input.monitorId || MONITOR_ID).toString(),
    primaryEntityType: "Monitor",
    name: input.metricName,
    metricPointType: "Sum",
    time: OneUptimeDate.toClickhouseDateTime(at),
    timeUnixNano: String(at.getTime() * 1_000_000),
    attributes: attributes,
    attributeKeys: Object.keys(attributes).sort(),
    value: input.value,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      new Date(Date.now() + (input.isExpired ? -1 : 30) * 24 * 60 * MINUTE),
    ),
  };
}

// The rows a check of probe `probeId` wrote `minutesBefore` the one judged.
function responseTime(
  probeId: string,
  minutesBefore: number,
  value: number | null,
  extra: Partial<Parameters<typeof checkRow>[0]> = {},
): JSONObject {
  return checkRow({
    metricName: MonitorMetricType.ResponseTime,
    msBeforeWritten: minutesBefore * MINUTE,
    value: value,
    attributes: { probeId: probeId },
    ...extra,
  });
}

async function run(statement: Statement | string): Promise<Array<JSONObject>> {
  const id: string = `prev_check_${queryIds.length}_${Date.now()}`;
  queryIds.push(id);

  const isStatement: boolean = statement instanceof Statement;
  const query: string = (
    isStatement ? (statement as Statement).query : (statement as string)
  )
    .split(`${defaultDatabase}.`)
    .join(`${database}.`);

  const queryParams: Record<string, unknown> = isStatement
    ? Object.fromEntries(
        Object.entries((statement as Statement).query_params).map(
          ([key, value]: [string, unknown]): [string, unknown] => {
            return [key, value === defaultDatabase ? database : value];
          },
        ),
      )
    : {};

  const result: { json: () => Promise<unknown> } = await client.query({
    query: query,
    query_params: queryParams,
    query_id: id,
    format: "JSON",
  });

  return ((await result.json()) as { data: Array<JSONObject> }).data;
}

async function lastReadRows(): Promise<number> {
  await client.command({ query: "SYSTEM FLUSH LOGS" });

  const rows: Array<JSONObject> = (
    (await (
      await client.query({
        query: `SELECT read_rows FROM system.query_log WHERE query_id = {id:String} AND type = 'QueryFinish'`,
        query_params: { id: queryIds[queryIds.length - 1] || "" },
        format: "JSON",
      })
    ).json()) as { data: Array<JSONObject> }
  ).data;

  return Number(rows[0]?.["read_rows"] || 0);
}

function read(
  overrides: Partial<
    Parameters<typeof MetricService.readPreviousMonitorChecks>[0]
  > = {},
): Promise<Array<MonitorPreviousCheckRow>> {
  return MetricService.readPreviousMonitorChecks({
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    metricName: MonitorMetricType.ResponseTime,
    windowStart: new Date(WRITTEN_AT.getTime() - 5 * MINUTE),
    before: WRITTEN_AT,
    groupByAttributeKeys: ["probeId"],
    ...overrides,
  });
}

function byGroup(
  rows: Array<MonitorPreviousCheckRow>,
): Record<string, { value: number; minutesBefore: number }> {
  const groups: Record<string, { value: number; minutesBefore: number }> = {};

  for (const row of rows) {
    groups[Object.values(row.group).join("|")] = {
      value: row.value,
      minutesBefore:
        Math.round(((WRITTEN_AT.getTime() - row.at.getTime()) / MINUTE) * 10) /
        10,
    };
  }

  return groups;
}

integration("a check's previous check, in a real ClickHouse", () => {
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

    client = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
      request_timeout: 300000,
    });

    /*
     * The table reads go through, as the model keeps it: the product writes
     * its DDL ON CLUSTER, a Replicated local table behind a Distributed
     * MetricItemV3 with these columns and this sort key, which needs a
     * Keeper this container does not run.
     */
    for (const query of [
      `CREATE DATABASE ${database}`,
      `CREATE TABLE ${database}.MetricItemV3 (projectId String, primaryEntityId String, primaryEntityType Nullable(String), name String, metricPointType Nullable(String), time DateTime64(9), timeUnixNano UInt64, attributes Map(String, String), attributeKeys Array(String), value Nullable(Double), retentionDate DateTime, _id String, createdAt DateTime) ENGINE = MergeTree PARTITION BY toYYYYMMDD(time) PRIMARY KEY (projectId, name, primaryEntityId, time) ORDER BY (projectId, name, primaryEntityId, time)`,
    ]) {
      await client.command({ query: query });
    }

    const rows: Array<JSONObject> = [
      // Probe A, every minute: 400, then 410, then this check's 820.
      responseTime(PROBE_A, 3, 400),
      responseTime(PROBE_A, 2, 380),
      responseTime(PROBE_A, 1, 410),
      // This check, written the second the judgement began.
      checkRow({
        metricName: MonitorMetricType.ResponseTime,
        msBeforeWritten: 300,
        value: 820,
        attributes: { probeId: PROBE_A },
      }),
      // Probe B: only a check 10 minutes ago, past a 5-minute window.
      responseTime(PROBE_B, 10, 900),
      // Probe C: a newer check with no value, and one past its retention.
      responseTime(PROBE_C, 4, 250),
      responseTime(PROBE_C, 2, null),
      responseTime(PROBE_C, 1, 999, { isExpired: true }),
      // Another monitor's checks, newer than any of these.
      responseTime(PROBE_A, 0.5, 5, { monitorId: OTHER_MONITOR_ID }),
      // A server's disks: no probe, a diskPath each.
      ...[
        { diskPath: "/", values: [50, 51] },
        { diskPath: "/data", values: [40, 70] },
      ].flatMap((disk: { diskPath: string; values: Array<number> }) => {
        return disk.values.map((value: number, index: number): JSONObject => {
          return checkRow({
            monitorId: SERVER_MONITOR_ID,
            metricName: MonitorMetricType.DiskUsagePercent,
            msBeforeWritten: (disk.values.length - index) * MINUTE,
            value: value,
            attributes: { diskPath: disk.diskPath },
          });
        });
      }),
      // A body check's match history, and another filter's beside it.
      checkRow({
        metricName: CRITERIA_FILTER_MATCH_METRIC_NAME,
        msBeforeWritten: 2 * MINUTE,
        value: 1,
        attributes: {
          probeId: PROBE_A,
          [CRITERIA_FILTER_KEY_ATTRIBUTE]: FILTER_KEY,
        },
      }),
      checkRow({
        metricName: CRITERIA_FILTER_MATCH_METRIC_NAME,
        msBeforeWritten: MINUTE,
        value: 0,
        attributes: {
          probeId: PROBE_A,
          [CRITERIA_FILTER_KEY_ATTRIBUTE]: FILTER_KEY,
        },
      }),
      checkRow({
        metricName: CRITERIA_FILTER_MATCH_METRIC_NAME,
        msBeforeWritten: 0.5 * MINUTE,
        value: 1,
        attributes: {
          probeId: PROBE_A,
          [CRITERIA_FILTER_KEY_ATTRIBUTE]: OTHER_FILTER_KEY,
        },
      }),
    ];

    await client.insert({
      table: `${database}.MetricItemV3`,
      values: rows,
      format: "JSONEachRow",
    });

    // A busier day of the monitor's checks around them: 3 probes a minute.
    await client.command({
      query: `INSERT INTO ${database}.MetricItemV3 (projectId, primaryEntityId, primaryEntityType, name, metricPointType, time, timeUnixNano, attributes, attributeKeys, value, retentionDate, _id, createdAt) SELECT '${PROJECT_ID.toString()}', ['${MONITOR_ID.toString()}', '${OTHER_MONITOR_ID.toString()}'][number % 2 + 1], 'Monitor', '${MonitorMetricType.ResponseTime}', 'Sum', toDateTime64(toDateTime(${Math.floor(WRITTEN_AT.getTime() / 1000)}) - toIntervalMinute(10 + intDiv(number, 6)), 9), 0, map('probeId', concat('day-probe-', toString(intDiv(number, 2) % 3))), ['probeId'], rand() % 1000, now() + toIntervalDay(30), generateUUIDv4(), now() FROM numbers(${24 * 60 * 6})`,
    });

    jest.spyOn(MetricService, "executeQuery").mockImplementation((async (
      statement: Statement | string,
    ): Promise<unknown> => {
      const data: Array<JSONObject> = await run(statement);

      return {
        json: (): Promise<unknown> => {
          return Promise.resolve({ data });
        },
      };
    }) as never);
  });

  afterAll(async (): Promise<void> => {
    // Closed while the client still has Node's timers to close with.
    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      await client.close();
    }

    jest.restoreAllMocks();
  });

  test("each probe's newest check before this one, never this check's own row", async () => {
    const groups: Record<string, { value: number; minutesBefore: number }> =
      byGroup(await read());

    // Probe A: 410, a minute before - not this check's 820, written this second.
    expect(groups[PROBE_A]).toEqual({ value: 410, minutesBefore: 1 });
    // Probe B's only check is 10 minutes old: none in a 5-minute window.
    expect(groups[PROBE_B]).toBeUndefined();
    // Probe C: its check with no value and its expired one are left out.
    expect(groups[PROBE_C]).toEqual({ value: 250, minutesBefore: 4 });
  });

  test("a check written later reads this one as its previous", async () => {
    const groups: Record<string, { value: number; minutesBefore: number }> =
      byGroup(
        await read({
          before: new Date(WRITTEN_AT.getTime() + MINUTE),
        }),
      );

    expect(groups[PROBE_A]?.value).toBe(820);
  });

  test("a longer window reaches a probe's older check", async () => {
    const groups: Record<string, { value: number; minutesBefore: number }> =
      byGroup(
        await read({
          windowStart: new Date(WRITTEN_AT.getTime() - 15 * MINUTE),
        }),
      );

    expect(groups[PROBE_B]).toEqual({ value: 900, minutesBefore: 10 });
  });

  test("each disk of a server's disk series on its own", async () => {
    const groups: Record<string, { value: number; minutesBefore: number }> =
      byGroup(
        await read({
          monitorId: SERVER_MONITOR_ID,
          metricName: MonitorMetricType.DiskUsagePercent,
          groupByAttributeKeys: ["probeId", "diskPath"],
        }),
      );

    expect(groups).toEqual({
      "|/": { value: 51, minutesBefore: 1 },
      "|/data": { value: 70, minutesBefore: 1 },
    });
  });

  test("a match history, by its filter key", async () => {
    const groups: Record<string, { value: number; minutesBefore: number }> =
      byGroup(
        await read({
          metricName: CRITERIA_FILTER_MATCH_METRIC_NAME,
          attributes: { [CRITERIA_FILTER_KEY_ATTRIBUTE]: FILTER_KEY },
        }),
      );

    expect(groups).toEqual({ [PROBE_A]: { value: 0, minutesBefore: 1 } });
  });

  test("one bounded read: the monitor's own rows of the window, not the day's", async () => {
    await read();

    const readRows: number = await lastReadRows();

    // A day of two monitors' checks from three probes: 8,640 rows.
    expect(readRows).toBeGreaterThan(0);
    expect(readRows).toBeLessThanOrEqual(8192 * 2);
  });

  test("a filter judged against its previous check, read here", async () => {
    const filter: CriteriaFilter = {
      checkOn: CheckOn.ResponseTime,
      filterType: FilterType.GreaterThan,
      value: undefined,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 5,
        evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
        changeType: PreviousCheckChangeType.Percentage,
        changeValue: 50,
      },
    };

    const judgement: CheckWindowJudgement =
      await PreviousCheckComparison.judgeFilter({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        monitorStepId: ObjectID.generate(),
        monitorType: MonitorType.Website,
        probeId: PROBE_A,
        criteriaFilter: filter,
        checkWrittenAt: WRITTEN_AT,
        isMetOnThisCheck: async (): Promise<boolean> => {
          return false;
        },
        judgeThisCheck: async (
          thisCheck: CriteriaFilter,
        ): Promise<string | null> => {
          // This check's 820 against 410 + 50%.
          return 820 > (thisCheck.value as number)
            ? `Response Time (in ms) is 820, which is greater than ${thisCheck.value}.`
            : null;
        },
      });

    expect(judgement.rootCause).toBe(
      "Response Time (in ms) is more than 50% above the previous check. The previous check, 1 minute ago, read 410, so this check needed more than 615: Response Time (in ms) is 820, which is greater than 615.",
    );
  });
});
