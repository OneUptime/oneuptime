import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  RumAlertTemplate,
  getRumAlertTemplateById,
} from "Common/Types/Monitor/RumAlertTemplates";
import ProbeApiIngestResponse from "Common/Types/Probe/ProbeApiIngestResponse";
import SessionReplayBudgetMetricType from "Common/Types/Rum/SessionReplayBudgetMetricType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * The session replay budget metrics end to end, over a real ClickHouse.
 *
 * The ingest gate charges the byte counters, the sweep reads them and writes
 * MetricItemV3 rows, the 1-minute materialized view rolls them up, the
 * Metrics monitor worker queries them exactly as it does in production
 * (monitorMetric), and the criteria evaluator decides which of a one-click
 * template's criteria they meet (processMonitorStep).
 *
 * Every other suite for this feature mocks one of those seams. This one is
 * about the seams: that the gate and the sweep agree on the counters, that
 * the rows fit the real table and reach the view a Max query is routed to,
 * that a template's scope and metric name find them, and that 80% and 100%
 * mean what the gate means by them.
 *
 * Postgres is not used: application and project rows, the retention setting
 * and the metric-name catalog are stubbed. The counters live in an in-memory
 * stand-in for Valkey with the commands both sides use, unless the suite is
 * pointed at a real one (below).
 *
 * The App Test workflow provides the ClickHouse server; the guard at the
 * bottom fails the run there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/Rum/SessionReplayBudgetMetricsClickhouse.test.ts
 *
 * Add TEST_VALKEY=true with VALKEY_HOST / VALKEY_PORT / VALKEY_PASSWORD to
 * run the counters on a real Valkey (only this suite's random project ids
 * are touched, and removed afterwards).
 * ------------------------------------------------------------------
 */

// Keep the worker module from touching BullMQ at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The evaluator's import chain loads the native isolated-vm addon; unused here.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

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

import Redis from "Common/Server/Infrastructure/Redis";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import ProjectService from "Common/Server/Services/ProjectService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import SessionReplayBudgetMetrics, {
  SessionReplayBudgetSweepSummary,
} from "Common/Server/Utils/SessionReplay/SessionReplayBudgetMetrics";
import SessionReplayUsage from "Common/Server/Utils/SessionReplay/SessionReplayUsage";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import SessionReplayRateLimiter, {
  SessionReplayLimitDecision,
  SessionReplayLimitOutcome,
} from "../../../../FeatureSet/Telemetry/Utils/SessionReplayRateLimiter";
import { SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY } from "../../../../FeatureSet/Telemetry/Config";
import { monitorMetric } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
const useRealValkey: boolean = process.env["TEST_VALKEY"] === "true";

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `replay_budget_metrics_test_${process.pid}_${Date.now()}`;

const GIB: number = 1024 * 1024 * 1024;
const LIMIT: number = SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY;

const DAILY_NEARLY_SPENT: string =
  "rum-session-replay-daily-budget-nearly-spent";
const DAILY_SPENT: string = "rum-session-replay-daily-budget-spent";
const MONTHLY_NEARLY_SPENT: string =
  "rum-session-replay-monthly-budget-nearly-spent";
const MONTHLY_SPENT: string = "rum-session-replay-monthly-budget-spent";

/*
 * The Valkey commands the gate (INCRBY / DECRBY / EXPIRE) and the readers
 * (GET / MGET) use, with Valkey's integer-counter semantics: a missing key
 * reads as nil and counts from 0.
 */
class InMemoryCounters {
  private readonly values: Map<string, number> = new Map<string, number>();

  public async get(key: string): Promise<string | null> {
    return this.values.has(key) ? String(this.values.get(key)) : null;
  }

  public async mget(keys: Array<string>): Promise<Array<string | null>> {
    return Promise.all(
      keys.map((key: string) => {
        return this.get(key);
      }),
    );
  }

  public async incrby(key: string, bytes: number): Promise<number> {
    const total: number = (this.values.get(key) || 0) + bytes;
    this.values.set(key, total);
    return total;
  }

  public async decrby(key: string, bytes: number): Promise<number> {
    return this.incrby(key, -bytes);
  }

  public async expire(): Promise<number> {
    return 1;
  }

  public async del(...keys: Array<string>): Promise<number> {
    let removed: number = 0;

    for (const key of keys) {
      if (this.values.delete(key)) {
        removed++;
      }
    }

    return removed;
  }
}

interface Fixture {
  projectId: ObjectID;
  // Records, with a 1 GiB monthly budget.
  budgeted: ObjectID;
  // Records, with no monthly budget.
  unbudgeted: ObjectID;
}

type Verdict = "breach" | "healthy" | "none";

interface Evaluation {
  verdict: Verdict;
  values: Array<number>;
  rootCause: string | null;
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

function newFixture(): Fixture {
  return {
    projectId: ObjectID.generate(),
    budgeted: ObjectID.generate(),
    unbudgeted: ObjectID.generate(),
  };
}

function applicationRow(data: {
  id: ObjectID;
  projectId: ObjectID;
  name: string;
  monthlyBudgetInGB?: number | undefined;
}): RumApplication {
  const row: RumApplication = new RumApplication();
  row.id = data.id;
  row.projectId = data.projectId;
  row.name = data.name;

  if (data.monthlyBudgetInGB !== undefined) {
    row.sessionReplayMonthlyBudgetInGB = data.monthlyBudgetInGB;
  }

  return row;
}

/*
 * A table built from the model's own columns, keys and engine. The analytics
 * schema in production is a Replicated local table behind a Distributed one
 * (a "cluster of one" even on a single node); the CI server has no cluster,
 * and the column types - which are what an insert has to fit - are the same.
 */
async function createTable(data: {
  client: ClickhouseClient;
  clickhouse: ClickhouseDatabase;
  modelType: { new (): AnalyticsBaseModel };
  engine: string;
}): Promise<void> {
  const model: AnalyticsBaseModel = new data.modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: data.modelType,
      database: data.clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await data.client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${data.engine} PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

integration("session replay budget metrics against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: ServiceConnection | undefined;
  let counters: InMemoryCounters | null = null;

  // What the sweep registered, as the catalog would hand it back to the worker.
  const catalog: Dictionary<MetricType> = {};
  const fixtures: Array<Fixture> = [];

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

    // connect() creates the database it is pointed at.
    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable({
      client: client,
      clickhouse: clickhouse,
      modelType: Metric as unknown as { new (): AnalyticsBaseModel },
      engine: "MergeTree",
    });
    await createTable({
      client: client,
      clickhouse: clickhouse,
      modelType: MetricItemAggMV1m as unknown as { new (): AnalyticsBaseModel },
      engine: "AggregatingMergeTree",
    });

    // The model's own view, verbatim; its table names resolve in `database`.
    for (const view of new MetricItemAggMV1m().materializedViews || []) {
      await client.command({ query: view.query });
    }

    original = {
      database: MetricService.database,
      databaseClient: MetricService.databaseClient,
      ingestDatabase: MetricService.ingestDatabase,
      ingestDatabaseClient: MetricService.ingestDatabaseClient,
    };

    MetricService.database = clickhouse;
    MetricService.databaseClient = client;
    MetricService.ingestDatabase = clickhouse;
    MetricService.ingestDatabaseClient = client;

    if (useRealValkey) {
      await Redis.connect();
    }
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(MetricService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }

    if (useRealValkey) {
      const valkey: ReturnType<typeof Redis.getClient> = Redis.getClient();

      for (const fixture of fixtures) {
        await valkey?.del(
          SessionReplayUsage.getDailyProjectByteKey(fixture.projectId),
          SessionReplayUsage.getMonthlyApplicationByteKey({
            projectId: fixture.projectId,
            rumApplicationId: fixture.budgeted,
          }),
        );
      }

      await Redis.disconnect();
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The stores this suite does not use, stubbed per test: Postgres (the
   * project's two recording applications, the project with replay allowed,
   * no retention override, a catalog that remembers what the sweep
   * registered - the worker reads units back from it) and, unless a real
   * Valkey was asked for, the counters.
   */
  function stubStores(fixture: Fixture): void {
    let applicationPagesServed: number = 0;

    jest
      .spyOn(RumApplicationService, "findBy")
      .mockImplementation(async (): Promise<Array<RumApplication>> => {
        applicationPagesServed++;

        if (applicationPagesServed > 1) {
          return [];
        }

        return [
          applicationRow({
            id: fixture.budgeted,
            projectId: fixture.projectId,
            name: "Checkout",
            monthlyBudgetInGB: 1,
          }),
          applicationRow({
            id: fixture.unbudgeted,
            projectId: fixture.projectId,
            name: "Marketing site",
          }),
        ];
      });

    jest
      .spyOn(ProjectService, "findBy")
      .mockImplementation(async (): Promise<Array<Project>> => {
        const project: Project = new Project();
        project.id = fixture.projectId;
        return [project];
      });

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockImplementation(async (): Promise<GlobalConfig | null> => {
        return null;
      });

    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          Object.assign(catalog, data.metricNameServiceNameMap);
        },
      );

    jest
      .spyOn(MetricTypeService, "findBy")
      .mockImplementation(async (): Promise<Array<MetricType>> => {
        return Object.values(catalog);
      });

    if (!useRealValkey) {
      counters = counters || new InMemoryCounters();

      jest
        .spyOn(Redis, "getClient")
        .mockReturnValue(
          counters as unknown as ReturnType<typeof Redis.getClient>,
        );
      jest.spyOn(Redis, "isConnected").mockReturnValue(true);
    }
  }

  function track(fixture: Fixture): Fixture {
    fixtures.push(fixture);
    stubStores(fixture);
    return fixture;
  }

  async function charge(data: {
    fixture: Fixture;
    bytes: number;
  }): Promise<SessionReplayLimitDecision> {
    return SessionReplayRateLimiter.consumeByteBudget({
      projectId: data.fixture.projectId,
      bytes: data.bytes,
    });
  }

  async function storedRows(fixture: Fixture): Promise<Array<JSONObject>> {
    const result: Awaited<ReturnType<ClickhouseClient["query"]>> =
      await client.query({
        query: `SELECT name, primaryEntityId, primaryEntityType, metricPointType, value, attributes, attributeKeys FROM ${database}.MetricItemV3 WHERE projectId = {projectId:String} ORDER BY primaryEntityId, name`,
        query_params: { projectId: fixture.projectId.toString() },
        format: "JSONEachRow",
      });

    return (await result.json()) as Array<JSONObject>;
  }

  /*
   * One sweep, then wait until everything it wrote is readable: inserts are
   * asynchronous, and the test should not depend on how soon they land.
   */
  async function sweep(
    fixture: Fixture,
  ): Promise<SessionReplayBudgetSweepSummary> {
    const summary: SessionReplayBudgetSweepSummary =
      await SessionReplayBudgetMetrics.publishAll({
        dailyByteLimit: LIMIT,
      });

    const deadline: number = Date.now() + 30000;

    while ((await storedRows(fixture)).length < summary.rowsWritten) {
      if (Date.now() > deadline) {
        throw new Error(
          `Fewer than ${summary.rowsWritten} rows became readable in 30s.`,
        );
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 200);
      });
    }

    return summary;
  }

  /*
   * What the Metrics monitor worker does on a tick for a monitor created from
   * the template: monitorMetric queries ClickHouse, and processMonitorStep
   * picks the first criteria the response meets - the same two calls
   * processTelemetryMonitorEvaluationFromQueue makes.
   */
  async function evaluate(data: {
    fixture: Fixture;
    templateId: string;
    rumApplicationId: ObjectID;
  }): Promise<Evaluation> {
    const template: RumAlertTemplate | undefined = getRumAlertTemplateById(
      data.templateId,
    );

    if (!template) {
      throw new Error(`Missing template ${data.templateId}`);
    }

    const step: MonitorStep = template.getMonitorStep({
      rumApplicationId: data.rumApplicationId.toString(),
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Checkout",
    });

    const [breach, healthy]: Array<MonitorCriteriaInstance> =
      step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.projectId = data.fixture.projectId;
    monitor.monitorType = MonitorType.Metrics;
    monitor.name = "Checkout - budget";

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: step,
      monitorId: monitor.id!,
      projectId: data.fixture.projectId,
    });

    const ingest: ProbeApiIngestResponse =
      await MonitorCriteriaEvaluator.processMonitorStep({
        dataToProcess: response,
        monitorStep: step,
        monitor: monitor,
        probeApiIngestResponse: {
          monitorId: monitor.id!,
          rootCause: null,
        },
        evaluationSummary: {
          criteriaResults: [],
          events: [],
        } as unknown as MonitorEvaluationSummary,
      });

    const first: AggregatedResult | undefined = response.metricResult[0];

    return {
      verdict:
        ingest.criteriaMetId === breach?.data?.id
          ? "breach"
          : ingest.criteriaMetId === healthy?.data?.id
            ? "healthy"
            : "none",
      values: (first?.data || []).map((point: AggregateModel) => {
        return Number(point.value);
      }),
      rootCause: ingest.rootCause,
    };
  }

  test("the gate's counters become rows in the real table, keyed to each recording application", async () => {
    const fixture: Fixture = track(newFixture());

    const decision: SessionReplayLimitDecision = await charge({
      fixture: fixture,
      bytes: Math.ceil(LIMIT * 0.85),
    });

    expect(decision.outcome).toBe(SessionReplayLimitOutcome.Allowed);

    await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
      projectId: fixture.projectId,
      rumApplicationId: fixture.budgeted,
      bytes: Math.ceil(GIB * 0.9),
      budgetBytes: GIB,
    });

    const summary: SessionReplayBudgetSweepSummary = await sweep(fixture);

    expect(summary.stopReason).toBe("done");
    // The daily pair on both applications, the monthly pair on the budgeted one.
    expect(summary.rowsWritten).toBe(6);

    const rows: Array<JSONObject> = await storedRows(fixture);

    expect(rows).toHaveLength(6);

    for (const row of rows) {
      expect(row["primaryEntityType"]).toBe(ServiceType.RealUserMonitor);
      expect(row["metricPointType"]).toBe("Gauge");
    }

    const daily: Array<JSONObject> = rows.filter((row: JSONObject) => {
      return (
        row["name"] === SessionReplayBudgetMetricType.ProjectDailyUsedPercent
      );
    });

    expect(
      daily
        .map((row: JSONObject) => {
          return `${row["primaryEntityId"]}=${Number(row["value"])}`;
        })
        .sort(),
    ).toEqual(
      [
        `${fixture.budgeted.toString()}=85`,
        `${fixture.unbudgeted.toString()}=85`,
      ].sort(),
    );

    for (const row of daily) {
      expect(row["attributes"]).toEqual({
        projectId: fixture.projectId.toString(),
      });
      expect(row["attributeKeys"]).toEqual(["projectId"]);
    }

    const monthly: JSONObject | undefined = rows.find((row: JSONObject) => {
      return (
        row["name"] ===
        SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent
      );
    });

    expect(monthly?.["primaryEntityId"]).toBe(fixture.budgeted.toString());
    expect(Number(monthly?.["value"])).toBe(90);
    expect(monthly?.["attributes"]).toEqual({
      projectId: fixture.projectId.toString(),
      rumApplicationId: fixture.budgeted.toString(),
      rumApplicationName: "Checkout",
    });
  });

  test("the rows reach the 1-minute view that a Max monitor query is routed to", async () => {
    const fixture: Fixture = track(newFixture());

    await charge({ fixture: fixture, bytes: Math.ceil(LIMIT * 0.5) });
    await sweep(fixture);

    const result: Awaited<ReturnType<ClickhouseClient["query"]>> =
      await client.query({
        query: `SELECT primaryEntityId, maxMerge(valueMaxState) AS maxValue FROM ${database}.MetricItemAggMV1m WHERE projectId = {projectId:String} AND name = {name:String} GROUP BY primaryEntityId ORDER BY primaryEntityId`,
        query_params: {
          projectId: fixture.projectId.toString(),
          name: SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
        },
        format: "JSONEachRow",
      });

    const rows: Array<JSONObject> = (await result.json()) as Array<JSONObject>;

    expect(
      rows.map((row: JSONObject) => {
        return Number(row["maxValue"]);
      }),
    ).toEqual([50, 50]);
  });

  test("a one-click template finds its application's series and fires at 80%, not one byte earlier", async () => {
    const eightyPercent: number = Math.ceil((LIMIT * 80) / 100);

    const below: Fixture = track(newFixture());
    await charge({ fixture: below, bytes: eightyPercent - 1 });
    await sweep(below);
    jest.restoreAllMocks();

    const above: Fixture = track(newFixture());
    await charge({ fixture: above, bytes: eightyPercent });
    await sweep(above);

    const quiet: Evaluation = await evaluate({
      fixture: below,
      templateId: DAILY_NEARLY_SPENT,
      rumApplicationId: below.budgeted,
    });

    expect(quiet.values).toEqual([79.99]);
    expect(quiet.verdict).toBe("healthy");

    const firing: Evaluation = await evaluate({
      fixture: above,
      templateId: DAILY_NEARLY_SPENT,
      rumApplicationId: above.budgeted,
    });

    expect(firing.values).toEqual([80]);
    expect(firing.verdict).toBe("breach");
    expect(firing.rootCause).toBeTruthy();

    // The Critical template waits for the budget to actually be spent.
    expect(
      (
        await evaluate({
          fixture: above,
          templateId: DAILY_SPENT,
          rumApplicationId: above.budgeted,
        })
      ).verdict,
    ).toBe("healthy");
  });

  test("a budget spent through the real gate reads 100 or more and fires the Critical template on every recording application", async () => {
    const fixture: Fixture = track(newFixture());
    const request: number = Math.floor(LIMIT * 0.6);

    expect((await charge({ fixture: fixture, bytes: request })).outcome).toBe(
      SessionReplayLimitOutcome.Allowed,
    );

    // This one crosses the limit: refused, but it stays charged.
    expect((await charge({ fixture: fixture, bytes: request })).outcome).toBe(
      SessionReplayLimitOutcome.BudgetExhausted,
    );

    // Every later refusal is refunded, so the counter does not move.
    expect((await charge({ fixture: fixture, bytes: request })).outcome).toBe(
      SessionReplayLimitOutcome.BudgetExhausted,
    );

    await sweep(fixture);

    const expected: number = Math.floor(((2 * request) / LIMIT) * 10000) / 100;

    expect(expected).toBeGreaterThanOrEqual(100);

    for (const rumApplicationId of [fixture.budgeted, fixture.unbudgeted]) {
      const spent: Evaluation = await evaluate({
        fixture: fixture,
        templateId: DAILY_SPENT,
        rumApplicationId: rumApplicationId,
      });

      expect(spent.values).toEqual([expected]);
      expect(spent.verdict).toBe("breach");
    }
  });

  test("the monthly templates read only the budgeted application's own series", async () => {
    const fixture: Fixture = track(newFixture());

    await SessionReplayRateLimiter.consumeApplicationMonthlyBudget({
      projectId: fixture.projectId,
      rumApplicationId: fixture.budgeted,
      bytes: Math.ceil(GIB * 0.95),
      budgetBytes: GIB,
    });

    await sweep(fixture);

    const budgeted: Evaluation = await evaluate({
      fixture: fixture,
      templateId: MONTHLY_NEARLY_SPENT,
      rumApplicationId: fixture.budgeted,
    });

    expect(budgeted.values).toEqual([95]);
    expect(budgeted.verdict).toBe("breach");

    expect(
      (
        await evaluate({
          fixture: fixture,
          templateId: MONTHLY_SPENT,
          rumApplicationId: fixture.budgeted,
        })
      ).verdict,
    ).toBe("healthy");

    // No budget, no series: nothing to evaluate, so no criteria is met.
    const unbudgeted: Evaluation = await evaluate({
      fixture: fixture,
      templateId: MONTHLY_NEARLY_SPENT,
      rumApplicationId: fixture.unbudgeted,
    });

    expect(unbudgeted.values).toEqual([]);
    expect(unbudgeted.verdict).toBe("none");
  });

  test("a monitor on an application of another project sees nothing", async () => {
    const fixture: Fixture = track(newFixture());
    const stranger: Fixture = newFixture();

    await charge({ fixture: fixture, bytes: LIMIT });
    await sweep(fixture);

    const result: Evaluation = await evaluate({
      fixture: stranger,
      templateId: DAILY_SPENT,
      rumApplicationId: stranger.budgeted,
    });

    expect(result.values).toEqual([]);
    expect(result.verdict).toBe("none");
  });

  test("zero usage writes nothing, so a template meets no criteria", async () => {
    const fixture: Fixture = track(newFixture());

    const summary: SessionReplayBudgetSweepSummary = await sweep(fixture);

    expect(summary.rowsWritten).toBe(0);
    expect(await storedRows(fixture)).toEqual([]);
    expect(
      (
        await evaluate({
          fixture: fixture,
          templateId: DAILY_NEARLY_SPENT,
          rumApplicationId: fixture.budgeted,
        })
      ).verdict,
    ).toBe("none");
  });

  test("points older than the template's 15-minute window no longer count", async () => {
    const fixture: Fixture = track(newFixture());

    await charge({ fixture: fixture, bytes: LIMIT });

    // A sweep that ran 20 minutes ago, before the budget recovered.
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(OneUptimeDate.addRemoveMinutes(new Date(), -20));

    await sweep(fixture);

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockRestore();

    const stale: Evaluation = await evaluate({
      fixture: fixture,
      templateId: DAILY_SPENT,
      rumApplicationId: fixture.budgeted,
    });

    expect(stale.values).toEqual([]);
    expect(stale.verdict).toBe("none");
  });
});

describe("session replay budget ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
