import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Project from "Common/Models/DatabaseModels/Project";
import Service from "Common/Models/DatabaseModels/Service";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import ExceptionMonitorResponse, {
  ExceptionLearnedBaseline,
} from "Common/Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import ExceptionMonitorCriteria from "Common/Server/Utils/Monitor/Criteria/ExceptionMonitorCriteria";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * An Exceptions monitor's learned baseline against a real ClickHouse server.
 *
 * The unit suites pin the hours asked for and the arithmetic. What they
 * cannot show is what the read COUNTS: that the earlier weeks are the same
 * rows the window's own count would pick (filters, entities, left-out
 * exceptions, the project), that countPerWindow's windows land on the ones
 * the baseline zero-fills, whatever their length, and that a check judges
 * the count against them. So this suite runs monitorException, the function
 * the telemetry monitor worker calls, over rows in a table built from the
 * real ExceptionInstance model.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/MonitorExceptionLearnedBaselineClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

/*
 * The worker transitively loads the native `isolated-vm` addon through the
 * criteria evaluator. Nothing here evaluates JavaScript expressions.
 */
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

// The cache only saves a read: every check here reads ClickHouse.
jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: { getJSONObject: jest.fn(), setJSON: jest.fn() },
  };
});

/*
 * Postgres says which exceptions are resolved and how old a service is. The
 * ClickHouse side is what this suite is about, so each test says.
 */
jest.mock("Common/Server/Services/TelemetryExceptionService", () => {
  return {
    __esModule: true,
    default: {
      getResolvedOrArchivedFingerprints: jest.fn(),
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ServiceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
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

import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ProjectService from "Common/Server/Services/ProjectService";
import ServiceService from "Common/Server/Services/ServiceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import { monitorException } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `exception_baseline_test_${process.pid}_${Date.now()}`;

const resolvedFingerprints: jest.Mock =
  TelemetryExceptionService.getResolvedOrArchivedFingerprints as unknown as jest.Mock;
const findServices: jest.Mock = ServiceService.findBy as unknown as jest.Mock;
const findProject: jest.Mock =
  ProjectService.findOneById as unknown as jest.Mock;

const projectId: ObjectID = new ObjectID("7800000000000000000000a1");
const otherProjectId: ObjectID = new ObjectID("7800000000000000000000a2");
const checkoutServiceId: ObjectID = new ObjectID("7800000000000000000000b1");

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const WEEK: number = 7 * DAY;

// A clock hour that has passed, and a window that ends 40 minutes into it.
const hourStart: number = (Math.floor(Date.now() / HOUR) - 2) * HOUR;
const evaluateUntil: Date = new Date(hourStart + 40 * MINUTE);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

interface Occurrences {
  // Whole weeks before the hour; 0 is the hour itself.
  weeksBack: number;
  minute: number;
  count: number;
  projectId?: ObjectID;
  environment?: string;
  fingerprint?: string;
  exceptionType?: string;
  message?: string;
  entityKeys?: Array<string>;
}

/*
 * What the monitor below matches, in the four 15-minute windows of the same
 * hour one and two weeks back. The third window of the first week is empty:
 * nothing happened, and that counts.
 */
const MATCHING_COUNTS: Array<Array<number>> = [
  [4, 6, 0, 2],
  [5, 5, 1, 3],
];

const matching: Array<Occurrences> = MATCHING_COUNTS.flatMap(
  (counts: Array<number>, week: number): Array<Occurrences> => {
    return counts.map((count: number, window: number): Occurrences => {
      return { weeksBack: week + 1, minute: window * 15 + 2, count };
    });
  },
);

// In the same hours, all of which a narrower monitor must leave out.
const others: Array<Occurrences> = [
  {
    weeksBack: 1,
    minute: 5,
    count: 50,
    exceptionType: "TimeoutError",
    message: "upstream timed out",
    fingerprint: "timeout",
  },
  { weeksBack: 1, minute: 20, count: 30, environment: "staging" },
  { weeksBack: 2, minute: 35, count: 20, entityKeys: ["host:other"] },
  {
    weeksBack: 1,
    minute: 50,
    count: 100,
    exceptionType: "LegacyError",
    message: "legacy failure",
    fingerprint: "old-noise",
  },
  { weeksBack: 2, minute: 5, count: 40, projectId: otherProjectId },
];

const occurrences: Array<Occurrences> = [
  ...matching,
  ...others,
  // The window being judged, which is never its own baseline.
  { weeksBack: 0, minute: 30, count: 60 },
];

function occurrenceRows(fixture: Occurrences): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (let index: number = 0; index < fixture.count; index++) {
    const time: Date = new Date(
      hourStart -
        fixture.weeksBack * WEEK +
        fixture.minute * MINUTE +
        index * 100,
    );

    rows.push({
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
      projectId: (fixture.projectId || projectId).toString(),
      primaryEntityId: checkoutServiceId.toString(),
      primaryEntityType: "Service",
      time: OneUptimeDate.toClickhouseDateTime64(time),
      timeUnixNano: String(time.getTime() * 1000000),
      exceptionType: fixture.exceptionType || "TypeError",
      stackTrace: "",
      message: fixture.message || "cart is undefined",
      spanStatusCode: 2,
      escaped: false,
      traceId: "",
      spanId: "",
      fingerprint: fixture.fingerprint || "cart",
      spanName: "",
      release: "",
      parsedFrames: "",
      attributes: {},
      attributeKeys: [],
      entityKeys: fixture.entityKeys || ["host:checkout"],
      environment: fixture.environment || "production",
      retentionDate: retentionDate,
    });
  }

  return rows;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new ExceptionInstance();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: ExceptionInstance as unknown as { new (): AnalyticsBaseModel },
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

const spike: CriteriaFilter = {
  checkOn: CheckOn.ExceptionCount,
  filterType: FilterType.AnomalouslyHigh,
  value: undefined,
  metricMonitorOptions: {
    anomalyDetection: { sensitivity: AnomalyDetectionSensitivity.Medium },
  },
};

// A step with the spike rule, over the filters each test names.
function stepWith(config: Partial<MonitorStepExceptionMonitor>): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorType: MonitorType.Exceptions,
    monitorName: "Checkout",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = { ...instance.data!, filters: [spike] };
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [instance] };
  step.setMonitorCriteria(criteria);
  step.setExceptionMonitor({
    ...MonitorStepExceptionMonitorUtil.getDefault(),
    telemetryServiceIds: [checkoutServiceId],
    lastXSecondsOfExceptions: 900,
    ...config,
  });
  return step;
}

async function check(
  config: Partial<MonitorStepExceptionMonitor>,
): Promise<ExceptionMonitorResponse> {
  return monitorException({
    monitorStep: stepWith(config),
    monitorId: ObjectID.generate(),
    projectId: projectId,
    evaluateUntil: evaluateUntil,
  });
}

function baselineOf(
  response: ExceptionMonitorResponse,
): ExceptionLearnedBaseline {
  expect(response.exceptionLearnedBaselines).toHaveLength(1);

  return response.exceptionLearnedBaselines![0]!;
}

// Everything the baseline's windows held, however many there are.
function totalOf(baseline: ExceptionLearnedBaseline): number {
  return Math.round(baseline.mean * baseline.sampleCount);
}

const narrow: Partial<MonitorStepExceptionMonitor> = {
  exceptionTypes: ["TypeError"],
  environments: ["production"],
  message: "cart",
  entityKeys: ["host:checkout"],
};

const MATCHING_TOTAL: number = MATCHING_COUNTS.flat().reduce(
  (total: number, count: number): number => {
    return total + count;
  },
  0,
);

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

integration(
  "An Exceptions monitor's learned baseline against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: ServiceConnection | undefined;

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

      await createTable(client, clickhouse);

      original = {
        database: ExceptionInstanceService.database,
        databaseClient: ExceptionInstanceService.databaseClient,
        ingestDatabase: ExceptionInstanceService.ingestDatabase,
        ingestDatabaseClient: ExceptionInstanceService.ingestDatabaseClient,
      };

      ExceptionInstanceService.database = clickhouse;
      ExceptionInstanceService.databaseClient = client;
      ExceptionInstanceService.ingestDatabase = clickhouse;
      ExceptionInstanceService.ingestDatabaseClient = client;

      await ExceptionInstanceService.insertJsonRows(
        occurrences.flatMap(occurrenceRows),
        { clickhouseSettings: { wait_for_async_insert: 1 } },
      );
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(ExceptionInstanceService, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    beforeEach(() => {
      const service: Service = new Service();
      service.createdAt = new Date(Date.now() - 365 * DAY);

      const project: Project = new Project();
      project.createdAt = new Date(Date.now() - 400 * DAY);

      resolvedFingerprints.mockReset().mockResolvedValue([]);
      findServices.mockReset().mockResolvedValue([service]);
      findProject.mockReset().mockResolvedValue(project);
    });

    test("the fixture loaded every occurrence", async () => {
      const count: { toNumber: () => number } =
        await ExceptionInstanceService.countBy({
          query: {},
          skip: 0,
          limit: 1000000,
          props: { isRoot: true },
        });

      expect(count.toNumber()).toBe(
        occurrences.reduce((total: number, fixture: Occurrences): number => {
          return total + fixture.count;
        }, 0),
      );
    });

    test("a narrow monitor's baseline holds only what its own filters match, windows without any included", async () => {
      const response: ExceptionMonitorResponse = await check(narrow);
      const baseline: ExceptionLearnedBaseline = baselineOf(response);

      expect(response.exceptionCount).toBe(60);
      expect(baseline).toMatchObject({
        windowDays: 14,
        windowSeconds: 900,
        weeksOfHistory: 2,
        sampleCount: 8,
        minObserved: 0,
        maxObserved: 6,
      });
      expect(baseline.mean).toBeCloseTo(MATCHING_TOTAL / 8);
    });

    test("the monitor's service alone counts everything of the project in those hours", async () => {
      expect(totalOf(baselineOf(await check({})))).toBe(
        MATCHING_TOTAL + 50 + 30 + 20 + 100,
      );
    });

    test.each([
      ["an exception type", { exceptionTypes: ["TimeoutError"] }, 50],
      ["a message", { message: "upstream" }, 50],
      ["an environment", { environments: ["staging"] }, 30],
      ["an infrastructure entity", { entityKeys: ["host:other"] }, 20],
    ])(
      "%s narrows the history as it narrows the count",
      async (
        _name: string,
        config: Partial<MonitorStepExceptionMonitor>,
        total: number,
      ) => {
        expect(totalOf(baselineOf(await check(config)))).toBe(total);
      },
    );

    test("an exception resolved now leaves the baseline with the count", async () => {
      resolvedFingerprints.mockResolvedValue(["old-noise"]);

      expect(totalOf(baselineOf(await check({})))).toBe(
        MATCHING_TOTAL + 50 + 30 + 20,
      );
    });

    test("counting resolved exceptions too keeps them in", async () => {
      resolvedFingerprints.mockResolvedValue(["old-noise"]);

      expect(
        totalOf(
          baselineOf(
            await check({ includeResolved: true, includeArchived: true }),
          ),
        ),
      ).toBe(MATCHING_TOTAL + 50 + 30 + 20 + 100);
    });

    test("the window being judged is not its own baseline", async () => {
      const baseline: ExceptionLearnedBaseline = baselineOf(
        await check(narrow),
      );

      expect(baseline.maxObserved).toBe(6);
    });

    test.each([
      [60],
      [300],
      // Not a divisor of an hour: its windows start anywhere in it.
      [420],
      [600],
      [1800],
      [3600],
      [21600],
      [86400],
    ])(
      "every occurrence lands in a window of %s seconds",
      async (lastXSecondsOfExceptions: number) => {
        const baseline: ExceptionLearnedBaseline = baselineOf(
          await check({ ...narrow, lastXSecondsOfExceptions }),
        );

        expect(baseline.weeksOfHistory).toBe(2);
        expect(totalOf(baseline)).toBe(MATCHING_TOTAL);
      },
    );

    test("a window that straddles two hours reads both", async () => {
      const baseline: ExceptionLearnedBaseline = baselineOf(
        await monitorException({
          monitorStep: stepWith(narrow),
          monitorId: ObjectID.generate(),
          projectId: projectId,
          evaluateUntil: new Date(hourStart + HOUR + 5 * MINUTE),
        }),
      );

      expect(baseline.sampleCount).toBe(16);
      expect(totalOf(baseline)).toBe(MATCHING_TOTAL);
    });

    test("the spike is judged against what was read, and says the range", async () => {
      const response: ExceptionMonitorResponse = await check(narrow);

      const message: string | null =
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response,
          criteriaFilter: spike,
        });

      expect(message).toContain(
        "Exception count 60 over the last 15 minutes is above the",
      );
      expect(message).toContain("expected for this hour of the week");
      expect(message).toContain("8 windows over 2 weeks");
    });

    test("a service nine days old has no second week, and alerts on nothing", async () => {
      const young: Service = new Service();
      young.createdAt = new Date(Date.now() - 9 * DAY);
      findServices.mockResolvedValue([young]);

      const response: ExceptionMonitorResponse = await check(narrow);

      expect(baselineOf(response).weeksOfHistory).toBe(1);
      expect(
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response,
          criteriaFilter: spike,
        }),
      ).toBeNull();
    });
  },
);

describe("Exceptions monitor learned baseline ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
