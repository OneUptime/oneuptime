import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import LogMonitorResponse from "Common/Types/Monitor/LogMonitor/LogMonitorResponse";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import LogCountBaseline from "Common/Models/AnalyticsModels/LogCountBaseline";
import SpanCountBaseline from "Common/Models/AnalyticsModels/SpanCountBaseline";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import LogCountBaselineService from "Common/Server/Services/LogCountBaselineService";
import SpanCountBaselineService from "Common/Server/Services/SpanCountBaselineService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { CountBaselineSummary } from "Common/Server/Utils/Monitor/Criteria/CountAnomaly";
import LogMonitorCriteria from "Common/Server/Utils/Monitor/Criteria/LogMonitorCriteria";
import CountWindowBaseline, {
  CountBaselinePlan,
  CountBaselineWeek,
} from "Common/Server/Utils/Monitor/CountWindowBaseline";
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
 * A Logs or Traces monitor's baseline against a real ClickHouse server.
 *
 * The unit suites pin the arithmetic and the words of the SQL. What they
 * cannot show is that the SQL does what it says: that the windows it groups
 * by are the ones the plan numbered, across an hour, a midnight and the end
 * of the week, that a conditional count merges as a count does, and that the
 * hours the plan asks for are the ones the materialized views wrote. So
 * this suite builds the rollups and their views from the real models, writes
 * rows as ingest writes them, and reads them back through getBaseline.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/MonitorCountBaselineClickhouse.test.ts
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

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `count_baseline_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const WEEK: number = 7 * DAY;

// A clock hour that has passed, and a window that ends 40 minutes into it.
const hourStart: number = (Math.floor(Date.now() / HOUR) - 2) * HOUR;
const windowEnd: Date = new Date(hourStart + 40 * MINUTE);

// The latest Monday 00:10 UTC behind us: a read here crosses the week's end.
const weekTurn: Date = new Date(
  Math.floor((Date.now() - 4 * DAY) / WEEK) * WEEK + 4 * DAY + 10 * MINUTE,
);

const checkoutId: ObjectID = new ObjectID("7900000000000000000000b1");
const otherServiceId: ObjectID = new ObjectID("7900000000000000000000b2");

let nextProject: number = 1;

// A project of its own, so a test reads only the rows it wrote.
function newProject(): ObjectID {
  const project: ObjectID = new ObjectID(
    `7900000000000000000000${(nextProject++).toString(16).padStart(2, "0")}`,
  );

  return project;
}

interface Rows {
  project: ObjectID;
  time: number;
  count: number;
  matching?: boolean;
  serviceId?: ObjectID;
  connection?: ClickhouseClient;
}

interface ReadFilters {
  project: ObjectID;
  windowEnd?: Date;
  windowSeconds: number;
  matchingOnly?: boolean;
  windowDays?: number;
}

interface Telemetry {
  name: string;
  source: string;
  sourceColumns: string;
  timeColumn: string;
  model: { new (): AnalyticsBaseModel };
  service:
    | typeof LogCountBaselineService
    | typeof SpanCountBaselineService;
  rowOf: (data: { project: ObjectID; matching: boolean }) => JSONObject;
  read: (filters: ReadFilters) => Promise<CountBaselineSummary | null>;
}

const TELEMETRIES: Array<Telemetry> = [
  {
    name: "Logs",
    source: "LogItemV3",
    sourceColumns:
      "projectId String, primaryEntityId String, severityText LowCardinality(String), time DateTime64(9)",
    timeColumn: "time",
    model: LogCountBaseline,
    service: LogCountBaselineService,
    rowOf: (data: { project: ObjectID; matching: boolean }): JSONObject => {
      return { severityText: data.matching ? "Error" : "Information" };
    },
    read: (filters: ReadFilters): Promise<CountBaselineSummary | null> => {
      return LogCountBaselineService.getBaseline({
        projectId: filters.project,
        telemetryServiceIds: [checkoutId],
        severityTexts: filters.matchingOnly ? ["Error"] : undefined,
        windowEnd: filters.windowEnd || windowEnd,
        windowSeconds: filters.windowSeconds,
        windowDays: filters.windowDays,
      });
    },
  },
  {
    name: "Traces",
    source: "SpanItemV3",
    sourceColumns:
      "projectId String, primaryEntityId String, statusCode Nullable(Int32), startTime DateTime64(9)",
    timeColumn: "startTime",
    model: SpanCountBaseline,
    service: SpanCountBaselineService,
    rowOf: (data: { project: ObjectID; matching: boolean }): JSONObject => {
      return { statusCode: data.matching ? 2 : 1 };
    },
    read: (filters: ReadFilters): Promise<CountBaselineSummary | null> => {
      return SpanCountBaselineService.getBaseline({
        projectId: filters.project,
        telemetryServiceIds: [checkoutId],
        spanStatusCodes: filters.matchingOnly ? [2] : undefined,
        windowEnd: filters.windowEnd || windowEnd,
        windowSeconds: filters.windowSeconds,
        windowDays: filters.windowDays,
      });
    },
  },
];

async function createRollup(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  telemetry: Telemetry,
): Promise<void> {
  const model: AnalyticsBaseModel = new telemetry.model();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: telemetry.model,
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${telemetry.source} (${telemetry.sourceColumns}) ENGINE = MergeTree ORDER BY ${telemetry.timeColumn}`,
  });

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });

  // The rollup's own view, read from the table it is written for.
  for (const view of model.materializedViews || []) {
    await client.command({ query: view.query });
  }
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

integration("A log or span count's baseline against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let zoned: ClickhouseDatabase;
  let zonedClient: ClickhouseClient;
  const originals: Array<{
    telemetry: Telemetry;
    connection: ServiceConnection;
  }> = [];

  // Rows as ingest writes them: UTC text with no zone.
  async function write(telemetry: Telemetry, rows: Rows): Promise<void> {
    const connection: ClickhouseClient = rows.connection || client;

    await connection.insert({
      table: `${database}.${telemetry.source}`,
      format: "JSONEachRow",
      values: new Array<number>(rows.count)
        .fill(0)
        .map((_: number, index: number): JSONObject => {
          return {
            projectId: rows.project.toString(),
            primaryEntityId: (rows.serviceId || checkoutId).toString(),
            [telemetry.timeColumn]: OneUptimeDate.toClickhouseDateTime64(
              new Date(rows.time + index * 10),
            ),
            ...telemetry.rowOf({
              project: rows.project,
              matching: rows.matching ?? true,
            }),
          };
        }),
    });
  }

  /*
   * A count in every window of a plan, in a minute inside it, written as
   * rows and returned as the counts the read should find.
   */
  async function fill(
    telemetry: Telemetry,
    data: {
      project: ObjectID;
      plan: CountBaselinePlan;
      countOf: (week: CountBaselineWeek, index: number) => number;
      matching?: boolean;
      connection?: ClickhouseClient;
    },
  ): Promise<Array<Array<number>>> {
    const weeks: Array<Array<number>> = [];

    for (const week of data.plan.weeks) {
      const counts: Array<number> = [];

      for (let index: number = 0; index < week.windowCount; index++) {
        const count: number = data.countOf(week, index);
        const minutes: number = data.plan.windowMinutes;
        const time: number =
          (week.firstWindow + index) * minutes * MINUTE +
          (index % minutes) * MINUTE;

        counts.push(count);

        await write(telemetry, {
          project: data.project,
          time,
          count,
          ...(data.matching !== undefined ? { matching: data.matching } : {}),
          ...(data.connection ? { connection: data.connection } : {}),
        });
      }

      weeks.push(counts);
    }

    return weeks;
  }

  const busyCount: (week: CountBaselineWeek, index: number) => number = (
    week: CountBaselineWeek,
    index: number,
  ): number => {
    return 8 + week.weeksBack + (index % 5);
  };

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
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    /*
     * A server in another zone, without one to hand: every statement of a
     * session in that zone reads and writes as such a server does.
     */
    const zonedOptions: ClickHouseClientConfigOptions = {
      ...options,
      clickhouse_settings: { session_timezone: "Asia/Tokyo" },
    };

    zoned = new ClickhouseDatabase(zonedOptions);
    zonedClient = await zoned.connect(zonedOptions);

    for (const telemetry of TELEMETRIES) {
      await createRollup(client, clickhouse, telemetry);

      originals.push({
        telemetry,
        connection: {
          database: telemetry.service.database,
          databaseClient: telemetry.service.databaseClient,
          ingestDatabase: telemetry.service.ingestDatabase,
          ingestDatabaseClient: telemetry.service.ingestDatabaseClient,
        },
      });

      telemetry.service.database = clickhouse;
      telemetry.service.databaseClient = client;
      telemetry.service.ingestDatabase = clickhouse;
      telemetry.service.ingestDatabaseClient = client;
    }
  });

  afterAll(async (): Promise<void> => {
    for (const original of originals) {
      Object.assign(original.telemetry.service, original.connection);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (zoned) {
      await zoned.disconnect();
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  describe.each(TELEMETRIES)("$name", (telemetry: Telemetry) => {
    test.each([
      ["a minute", 60],
      ["15 minutes", 900],
      ["an hour", 3600],
    ])(
      "the windows of %s it folds are the ones the plan asks for",
      async (_: string, windowSeconds: number) => {
        const project: ObjectID = newProject();
        const plan: CountBaselinePlan = CountWindowBaseline.getPlan({
          windowEnd,
          windowSeconds,
        });

        const weeks: Array<Array<number>> = await fill(telemetry, {
          project,
          plan,
          countOf: busyCount,
        });

        expect(await telemetry.read({ project, windowSeconds })).toEqual(
          CountWindowBaseline.summarize({ plan, weeks }),
        );
      },
    );

    test("it holds across the end of the week", async () => {
      const project: ObjectID = newProject();
      const plan: CountBaselinePlan = CountWindowBaseline.getPlan({
        windowEnd: weekTurn,
        windowSeconds: 300,
      });

      expect(plan.hoursOfWeek).toContain(167);
      expect(plan.hoursOfWeek).toContain(0);

      const weeks: Array<Array<number>> = await fill(telemetry, {
        project,
        plan,
        countOf: busyCount,
      });

      expect(
        await telemetry.read({
          project,
          windowEnd: weekTurn,
          windowSeconds: 300,
        }),
      ).toEqual(CountWindowBaseline.summarize({ plan, weeks }));
    });

    test("the hour being judged is not part of it, however much it held", async () => {
      const project: ObjectID = newProject();
      const plan: CountBaselinePlan = CountWindowBaseline.getPlan({
        windowEnd,
        windowSeconds: 900,
      });

      await fill(telemetry, { project, plan, countOf: busyCount });

      const before: CountBaselineSummary | null = await telemetry.read({
        project,
        windowSeconds: 900,
      });

      await write(telemetry, {
        project,
        time: windowEnd.getTime() - 5 * MINUTE,
        count: 500,
      });

      expect(await telemetry.read({ project, windowSeconds: 900 })).toEqual(
        before,
      );
    });

    test("only the monitor's project and services are read", async () => {
      const project: ObjectID = newProject();
      const plan: CountBaselinePlan = CountWindowBaseline.getPlan({
        windowEnd,
        windowSeconds: 900,
      });

      const weeks: Array<Array<number>> = await fill(telemetry, {
        project,
        plan,
        countOf: busyCount,
      });

      const time: number =
        plan.weeks[0]!.firstWindow * plan.windowMinutes * MINUTE;

      await write(telemetry, {
        project,
        time,
        count: 50,
        serviceId: otherServiceId,
      });
      await write(telemetry, { project: newProject(), time, count: 50 });

      expect(await telemetry.read({ project, windowSeconds: 900 })).toEqual(
        CountWindowBaseline.summarize({ plan, weeks }),
      );
    });

    test("a filter counts what it matches, and what it does not still says the service was there", async () => {
      const project: ObjectID = newProject();
      const plan: CountBaselinePlan = CountWindowBaseline.getPlan({
        windowEnd,
        windowSeconds: 900,
      });

      await fill(telemetry, {
        project,
        plan,
        countOf: busyCount,
        matching: false,
      });

      const summary: CountBaselineSummary | null = await telemetry.read({
        project,
        windowSeconds: 900,
        matchingOnly: true,
      });

      expect(summary).toMatchObject({ mean: 0, isReliable: true });

      const weeks: Array<Array<number>> = await fill(telemetry, {
        project,
        plan,
        countOf: busyCount,
        matching: true,
      });

      expect(
        await telemetry.read({
          project,
          windowSeconds: 900,
          matchingOnly: true,
        }),
      ).toEqual(CountWindowBaseline.summarize({ plan, weeks }));
    });

    test("a service quiet through the weeks read has a baseline of quiet", async () => {
      const project: ObjectID = newProject();

      await write(telemetry, {
        project,
        time: hourStart - 40 * DAY,
        count: 3,
      });

      expect(
        await telemetry.read({ project, windowSeconds: 900 }),
      ).toMatchObject({ mean: 0, isReliable: true });
    });

    test("a service never heard from has none", async () => {
      expect(
        await telemetry.read({ project: newProject(), windowSeconds: 900 }),
      ).toBeNull();
    });

    test("a service nine days old has one week of history, and is still learning", async () => {
      const project: ObjectID = newProject();

      await write(telemetry, {
        project,
        time: windowEnd.getTime() - 9 * DAY,
        count: 3,
      });

      expect(
        await telemetry.read({ project, windowSeconds: 900 }),
      ).toMatchObject({ isReliable: false });
    });

    test("in a server of another zone the hours are the same hours", async () => {
      const project: ObjectID = newProject();
      const plan: CountBaselinePlan = CountWindowBaseline.getPlan({
        windowEnd,
        windowSeconds: 900,
      });

      const weeks: Array<Array<number>> = await fill(telemetry, {
        project,
        plan,
        countOf: busyCount,
        connection: zonedClient,
      });

      telemetry.service.databaseClient = zonedClient;

      try {
        expect(await telemetry.read({ project, windowSeconds: 900 })).toEqual(
          CountWindowBaseline.summarize({ plan, weeks }),
        );
      } finally {
        telemetry.service.databaseClient = client;
      }
    });
  });

  describe("a Logs monitor's criteria, end to end", () => {
    const logs: Telemetry = TELEMETRIES[0]!;

    const spike: CriteriaFilter = {
      checkOn: CheckOn.LogCount,
      filterType: FilterType.AnomalouslyHigh,
      value: undefined,
    };

    function stepFor(windowSeconds: number): MonitorStep {
      const step: MonitorStep = new MonitorStep();

      step.data = {
        id: ObjectID.generate().toString(),
        monitorCriteria: { data: undefined } as never,
      } as unknown as MonitorStep["data"];
      step.data!.logMonitor = {
        ...MonitorStepLogMonitorUtil.getDefault(),
        telemetryServiceIds: [checkoutId],
        lastXSecondsOfLogs: windowSeconds,
      };

      return step;
    }

    function judge(project: ObjectID, logCount: number): Promise<string | null> {
      const response: Partial<LogMonitorResponse> = {
        projectId: project,
        monitorId: ObjectID.generate(),
        logCount,
        logQuery: {},
        evaluatedUntil: windowEnd,
      };

      return LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response as LogMonitorResponse,
        criteriaFilter: spike,
        monitorStep: stepFor(900),
      });
    }

    test("a window is judged against the rollup the view wrote", async () => {
      const project: ObjectID = newProject();

      await fill(logs, {
        project,
        plan: CountWindowBaseline.getPlan({ windowEnd, windowSeconds: 900 }),
        countOf: busyCount,
      });

      expect(await judge(project, 11)).toBeNull();
      expect(await judge(project, 500)).toContain(
        "above the same-hour baseline",
      );
    });
  });
});

describe("Log and span count baseline ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
