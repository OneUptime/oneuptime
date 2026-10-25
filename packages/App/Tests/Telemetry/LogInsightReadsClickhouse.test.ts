import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { LogInsightEvidence } from "Common/Types/AI/AIInsightEvidence";
import AIInsightType from "Common/Types/AI/AIInsightType";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import { LogInsightKind, LogLoggingGap } from "Common/Utils/Logs/LogInsight";
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
 * Logs' AI section, against a real ClickHouse server: the five reads its
 * detector makes once an hour (Common/Server/Services/LogAggregationService)
 * and the detector's whole look (LogProblemDetector) over a fixture of three
 * services' logs and spans - so the SQL is proven on the engine, not only on
 * the string it builds:
 *
 *   - checkout logs one payment error 2,100 times (half with where in the
 *     code it was logged), one with an exception 300 times - the Exceptions
 *     product's - and a rare one 15 times: one Error Log;
 *   - billing logs 20,000 lines, 70% of them one cache hit, none with a
 *     trace id, while it sends spans: a Noisy Log, and Missing Logging (no
 *     trace context);
 *   - payments' POST /charge fails 40 times in 400 requests, and none of the
 *     failed requests logged, while its other logs carry trace ids: Missing
 *     Logging (failures that write no log line).
 *
 * Every read is checked on the default analyzer and on the older one
 * (enable_analyzer = 0), as servers still configured that way read them.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/LogInsightReadsClickhouse.test.ts
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

import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import ServiceService from "Common/Server/Services/ServiceService";
import AnalyticsDatabaseService, {
  ClickHouseSettings,
} from "Common/Server/Services/AnalyticsDatabaseService";
import LogAggregationService, {
  ErrorPatternCodeLocation,
  ServiceLogHealthRow,
  ServiceLogPattern,
  ServiceLogPatterns,
  TopErrorPattern,
} from "Common/Server/Services/LogAggregationService";
import LogProblemDetector from "Common/Server/Utils/AI/SRE/Insights/Detectors/LogProblemDetector";
import { InsightCandidate } from "Common/Server/Utils/AI/SRE/Insights/Types";
import LlmConversationPrivacy from "Common/Server/Utils/LlmObservability/LlmConversationPrivacy";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `log_insight_reads_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
// The look's clock: every row sits in the hour before it.
const NOW: Date = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
const WINDOW_START: Date = new Date(NOW.getTime() - 60 * MINUTE);

const PROJECT_ID: ObjectID = new ObjectID(
  "5a660000-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5a660000-0000-4000-8000-000000000002";
const BILLING: string = "5a660000-0000-4000-8000-000000000003";
const PAYMENTS: string = "5a660000-0000-4000-8000-000000000004";

const PAYMENT_ERRORS: number = 2100;
const EXCEPTION_ERRORS: number = 300;
const RARE_ERRORS: number = 15;
const CHECKOUT_INFO: number = 1000;
const BILLING_LINES: number = 20000;
const CACHE_HITS: number = 14000;
const PAYMENTS_LINES: number = 600;
const CHARGE_REQUESTS: number = 400;
const CHARGE_FAILURES: number = 40;

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

// A spread of times inside the hour, the newest ten minutes before NOW.
function timeOf(index: number, rows: number): Date {
  return new Date(
    WINDOW_START.getTime() + MINUTE + Math.floor((index * 49 * MINUTE) / rows),
  );
}

function hex(seed: number, length: number): string {
  return seed.toString(16).padStart(length, "0").slice(-length);
}

function traceIdOf(prefix: number, index: number): string {
  return `${hex(prefix, 8)}${hex(index, 24)}`;
}

function uuidOf(index: number): string {
  return `${hex(index, 8)}-1111-4222-8333-${hex(index * 7, 12)}`;
}

function logRow(data: {
  serviceId: string;
  time: Date;
  severity: LogSeverity;
  body: string;
  traceId?: string | undefined;
  attributes?: Record<string, string> | undefined;
}): JSONObject {
  const attributes: Record<string, string> = data.attributes || {};

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: data.serviceId,
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(data.time),
    timeUnixNano: String(data.time.getTime() * 1000000),
    severityText: data.severity,
    severityNumber:
      data.severity === LogSeverity.Error
        ? 17
        : data.severity === LogSeverity.Debug
          ? 5
          : 9,
    attributes,
    attributeKeys: Object.keys(attributes).sort(),
    entityKeys: [],
    traceId: data.traceId || "",
    spanId: data.traceId ? hex(7, 16) : "",
    body: data.body,
    retentionDate,
  };
}

function spanRow(data: {
  serviceId: string;
  index: number;
  name: string;
  failed: boolean;
  traceId: string;
}): JSONObject {
  const start: Date = timeOf(data.index, CHARGE_REQUESTS);
  const startNs: string = String(BigInt(start.getTime()) * BigInt(1000000));
  const durationNs: number = 12 * 1000000;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: data.serviceId,
    primaryEntityType: "Service",
    startTime: OneUptimeDate.toClickhouseDateTime64(start),
    endTime: OneUptimeDate.toClickhouseDateTime64(start),
    startTimeUnixNano: startNs,
    endTimeUnixNano: String(BigInt(startNs) + BigInt(durationNs)),
    durationUnixNano: String(durationNs),
    traceId: data.traceId,
    spanId: hex(data.index + 1, 16),
    parentSpanId: "",
    attributes: { "http.method": "POST" },
    attributeKeys: ["http.method"],
    entityKeys: [],
    statusCode: data.failed ? SpanStatus.Error : SpanStatus.Ok,
    name: data.name,
    kind: "SPAN_KIND_SERVER",
    isRootSpan: true,
    retentionDate,
  };
}

function fixtureLogs(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (let index: number = 0; index < PAYMENT_ERRORS; index++) {
    rows.push(
      logRow({
        serviceId: CHECKOUT,
        time: timeOf(index, PAYMENT_ERRORS),
        severity: LogSeverity.Error,
        body: `Payment provider returned 402: card declined for order ${uuidOf(index)}`,
        traceId: traceIdOf(1, index),
        attributes:
          index % 2 === 0
            ? {
                "code.filepath": "src/payments/client.py",
                "code.function": "charge",
                "code.lineno": "88",
              }
            : {},
      }),
    );
  }

  // An error with an exception: the Exceptions product's, not an error log.
  for (let index: number = 0; index < EXCEPTION_ERRORS; index++) {
    rows.push(
      logRow({
        serviceId: CHECKOUT,
        time: timeOf(index, EXCEPTION_ERRORS),
        severity: LogSeverity.Error,
        body: "Ledger lookup crashed while settling the order",
        traceId: traceIdOf(2, index),
        attributes: {
          "exception.type": "KeyError",
          "exception.message": "ledger",
        },
      }),
    );
  }

  for (let index: number = 0; index < RARE_ERRORS; index++) {
    rows.push(
      logRow({
        serviceId: CHECKOUT,
        time: timeOf(index, RARE_ERRORS),
        severity: LogSeverity.Error,
        body: `Coupon sync skipped for batch ${index}`,
      }),
    );
  }

  for (let index: number = 0; index < CHECKOUT_INFO; index++) {
    rows.push(
      logRow({
        serviceId: CHECKOUT,
        time: timeOf(index, CHECKOUT_INFO),
        severity: LogSeverity.Information,
        body: `request served in ${index % 90} ms`,
        traceId: traceIdOf(3, index),
      }),
    );
  }

  for (let index: number = 0; index < BILLING_LINES; index++) {
    rows.push(
      logRow({
        serviceId: BILLING,
        time: timeOf(index, BILLING_LINES),
        severity:
          index < CACHE_HITS ? LogSeverity.Debug : LogSeverity.Information,
        body:
          index < CACHE_HITS
            ? `cache hit for key ${uuidOf(index)}`
            : `invoice ${uuidOf(index)} rendered for tenant ${index % 50}`,
      }),
    );
  }

  for (let index: number = 0; index < PAYMENTS_LINES; index++) {
    rows.push(
      logRow({
        serviceId: PAYMENTS,
        time: timeOf(index, PAYMENTS_LINES),
        severity: LogSeverity.Information,
        body: `charge accepted for ${uuidOf(index)}`,
        traceId: traceIdOf(4, index),
      }),
    );
  }

  return rows;
}

function fixtureSpans(): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (let index: number = 0; index < CHARGE_REQUESTS; index++) {
    const failed: boolean = index % (CHARGE_REQUESTS / CHARGE_FAILURES) === 0;

    rows.push(
      spanRow({
        serviceId: PAYMENTS,
        index,
        name: "POST /charge",
        failed,
        // A failed request's trace holds no log line of payments.
        traceId: failed ? traceIdOf(5, index) : traceIdOf(6, index),
      }),
    );
  }

  // Billing is traced, so its logs could carry trace ids.
  for (let index: number = 0; index < 200; index++) {
    rows.push(
      spanRow({
        serviceId: BILLING,
        index,
        name: "GET /invoices",
        failed: false,
        traceId: traceIdOf(7, index),
      }),
    );
  }

  return rows;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
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
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

interface Connection {
  database: ClickhouseDatabase;
  client: ClickhouseClient;
}

const logService: AnalyticsDatabaseService<AnalyticsBaseModel> =
  LogService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>;
const spanService: AnalyticsDatabaseService<AnalyticsBaseModel> =
  SpanService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>;

function useConnection(connection: Connection): void {
  for (const service of [logService, spanService]) {
    service.database = connection.database;
    service.databaseClient = connection.client;
    service.ingestDatabase = connection.database;
    service.ingestDatabaseClient = connection.client;
  }
}

function serviceRows(): Array<Service> {
  return [
    [CHECKOUT, "checkout"],
    [BILLING, "billing"],
    [PAYMENTS, "payments"],
  ].map(([id, name]: Array<string>): Service => {
    const row: Service = new Service();
    row.id = new ObjectID(id!);
    row.name = name!;
    return row;
  });
}

integration("Logs' AI section, against ClickHouse", () => {
  let options: ClickHouseClientConfigOptions;
  let current: Connection;
  let older: Connection | null = null;
  let original: Array<Record<string, unknown>> = [];

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
      request_timeout: 60000,
      compression: { request: true, response: true },
    };

    const clickhouse: ClickhouseDatabase = new ClickhouseDatabase(options);
    const client: ClickhouseClient = await clickhouse.connect(options);

    current = { database: clickhouse, client };

    await createTable(client, clickhouse, Log);
    await createTable(
      client,
      clickhouse,
      Span as unknown as { new (): AnalyticsBaseModel },
    );

    await client.insert({
      table: `${database}.${new Log().tableName}`,
      values: fixtureLogs(),
      format: "JSONEachRow",
    });
    await client.insert({
      table: `${database}.${new Span().tableName}`,
      values: fixtureSpans(),
      format: "JSONEachRow",
    });

    // The older analyzer, under whichever of its names this server knows.
    const found: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
      format: "JSONEachRow",
    });
    const [setting] = (await found.json()) as Array<{ name: string }>;

    if (setting) {
      const olderOptions: ClickHouseClientConfigOptions = {
        ...options,
        clickhouse_settings: { [setting.name]: 0 } as ClickHouseSettings,
      };
      const olderDatabase: ClickhouseDatabase = new ClickhouseDatabase(
        olderOptions,
      );

      older = {
        database: olderDatabase,
        client: await olderDatabase.connect(olderOptions),
      };
    }

    original = [logService, spanService].map(
      (service: AnalyticsDatabaseService<AnalyticsBaseModel>) => {
        return {
          database: service.database,
          databaseClient: service.databaseClient,
          ingestDatabase: service.ingestDatabase,
          ingestDatabaseClient: service.ingestDatabaseClient,
        };
      },
    );

    useConnection(current);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    useConnection(current);
  });

  afterAll(async (): Promise<void> => {
    [logService, spanService].forEach(
      (
        service: AnalyticsDatabaseService<AnalyticsBaseModel>,
        index: number,
      ) => {
        if (original[index]) {
          Object.assign(service, original[index]);
        }
      },
    );

    if (current) {
      await current.client.command({
        query: `DROP DATABASE IF EXISTS ${database}`,
      });
      await current.database.disconnect();
    }

    if (older) {
      await older.database.disconnect();
    }
  });

  // Each check, on the default analyzer and on the older one.
  async function onBothAnalyzers(check: () => Promise<void>): Promise<void> {
    useConnection(current);
    await check();

    if (older) {
      useConnection(older);
      await check();
      useConnection(current);
    }
  }

  test("every service's logs over the hour: all of them, the errors, the ones with a trace id", async () => {
    await onBothAnalyzers(async (): Promise<void> => {
      const rows: Array<ServiceLogHealthRow> =
        await LogAggregationService.getServiceLogHealth({
          projectId: PROJECT_ID,
          startTime: WINDOW_START,
          endTime: NOW,
          limit: 200,
        });

      expect(rows).toEqual([
        {
          primaryEntityId: BILLING,
          logCount: BILLING_LINES,
          errorLogCount: 0,
          tracedLogCount: 0,
        },
        {
          primaryEntityId: CHECKOUT,
          logCount:
            PAYMENT_ERRORS + EXCEPTION_ERRORS + RARE_ERRORS + CHECKOUT_INFO,
          errorLogCount: PAYMENT_ERRORS + EXCEPTION_ERRORS + RARE_ERRORS,
          tracedLogCount: PAYMENT_ERRORS + EXCEPTION_ERRORS + CHECKOUT_INFO,
        },
        {
          primaryEntityId: PAYMENTS,
          logCount: PAYMENTS_LINES,
          errorLogCount: 0,
          tracedLogCount: PAYMENTS_LINES,
        },
      ]);
    });
  });

  test("a service's error messages without an exception, and where they were logged", async () => {
    await onBothAnalyzers(async (): Promise<void> => {
      const patterns: Array<TopErrorPattern> =
        await LogAggregationService.getTopErrorPatterns({
          projectId: PROJECT_ID,
          startTime: WINDOW_START,
          endTime: NOW,
          serviceIds: [new ObjectID(CHECKOUT)],
          excludeExceptionRecords: true,
          limit: 10,
        });

      expect(
        patterns.map((row: TopErrorPattern): [string, number] => {
          return [row.pattern, row.count];
        }),
      ).toEqual([
        [
          "Payment provider returned <num>: card declined for order <uuid>",
          PAYMENT_ERRORS,
        ],
        ["Coupon sync skipped for batch <num>", RARE_ERRORS],
      ]);

      const locations: Array<ErrorPatternCodeLocation> =
        await LogAggregationService.getErrorPatternCodeLocations({
          projectId: PROJECT_ID,
          startTime: WINDOW_START,
          endTime: NOW,
          serviceIds: [new ObjectID(CHECKOUT)],
          excludeExceptionRecords: true,
          pattern: patterns[0]!.pattern,
          limit: 3,
        });

      expect(locations).toEqual([
        {
          filePath: "src/payments/client.py",
          functionName: "charge",
          lineNumber: "88",
          count: PAYMENT_ERRORS / 2,
        },
      ]);
    });
  });

  test("without excludeExceptionRecords, Top errors still counts the exception's lines", async () => {
    const patterns: Array<TopErrorPattern> =
      await LogAggregationService.getTopErrorPatterns({
        projectId: PROJECT_ID,
        startTime: WINDOW_START,
        endTime: NOW,
        serviceIds: [new ObjectID(CHECKOUT)],
        limit: 10,
      });

    expect(
      patterns.some((row: TopErrorPattern): boolean => {
        return row.pattern.startsWith("Ledger lookup crashed");
      }),
    ).toBe(true);
  });

  test("a sample of a busy service's lines, by message, with how many were read", async () => {
    await onBothAnalyzers(async (): Promise<void> => {
      const whole: ServiceLogPatterns =
        await LogAggregationService.getServiceLogPatterns({
          projectId: PROJECT_ID,
          serviceId: new ObjectID(BILLING),
          startTime: WINDOW_START,
          endTime: NOW,
          sampleSize: 100000,
          limit: 5,
        });

      expect(whole.sampledLogCount).toBe(BILLING_LINES);
      expect(whole.patterns[0]).toMatchObject({
        pattern: "cache hit for key <uuid>",
        count: CACHE_HITS,
        severities: [LogSeverity.Debug],
      });

      // A smaller sample reads no more than it is asked to.
      const sampled: ServiceLogPatterns =
        await LogAggregationService.getServiceLogPatterns({
          projectId: PROJECT_ID,
          serviceId: new ObjectID(BILLING),
          startTime: WINDOW_START,
          endTime: NOW,
          sampleSize: 5000,
          limit: 5,
        });

      expect(sampled.sampledLogCount).toBe(5000);
      expect(
        sampled.patterns.reduce(
          (total: number, row: ServiceLogPattern): number => {
            return total + row.count;
          },
          0,
        ),
      ).toBeLessThanOrEqual(5000);
    });
  });

  test("the service's lines in given traces: none in the failed requests, all in the logged ones", async () => {
    await onBothAnalyzers(async (): Promise<void> => {
      const failed: Map<string, number> =
        await LogAggregationService.getServiceLogCountsByTrace({
          projectId: PROJECT_ID,
          serviceId: new ObjectID(PAYMENTS),
          startTime: WINDOW_START,
          endTime: NOW,
          traceIds: [traceIdOf(5, 0), traceIdOf(5, 10)],
        });

      expect(failed.size).toBe(0);

      const logged: Map<string, number> =
        await LogAggregationService.getServiceLogCountsByTrace({
          projectId: PROJECT_ID,
          serviceId: new ObjectID(PAYMENTS),
          startTime: WINDOW_START,
          endTime: NOW,
          traceIds: [traceIdOf(4, 0), "ffffffffffffffffffffffffffffffff"],
        });

      expect(Array.from(logged.entries())).toEqual([[traceIdOf(4, 0), 1]]);
    });
  });

  test("the whole look files the four findings the fixture holds, and no other", async () => {
    jest
      .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
      .mockResolvedValue([]);
    jest.spyOn(ServiceService, "findBy").mockResolvedValue(serviceRows());

    const found: Array<InsightCandidate> = await LogProblemDetector.look({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(
      found.map((candidate: InsightCandidate): [string, string] => {
        return [candidate.insightType, candidate.title];
      }),
    ).toEqual([
      [
        AIInsightType.LogErrorPattern,
        'checkout logged "Payment provider returned <num>: card declined for order <uuid>" 2,100 times in an hour',
      ],
      [
        AIInsightType.LogMissingLogging,
        "POST /charge in payments fails without logging",
      ],
      [
        AIInsightType.LogMissingLogging,
        "billing's logs carry no trace context",
      ],
      [
        AIInsightType.LogNoisyPattern,
        '"cache hit for key <uuid>" is 70% of billing\'s logs',
      ],
    ]);

    const error: LogInsightEvidence = found[0]!.evidence.log!;

    expect(error.kind).toBe(LogInsightKind.Error);
    // The longest run of its own words, as written in its lines.
    expect(error.searchText).toBe("Payment provider returned");
    expect(error.codeLocations).toEqual([
      {
        filePath: "src/payments/client.py",
        functionName: "charge",
        lineNumber: 88,
      },
    ]);

    const silent: LogInsightEvidence = found[1]!.evidence.log!;

    expect(silent).toMatchObject({
      gap: LogLoggingGap.SilentFailures,
      operationName: "POST /charge",
      operationSpanCount: CHARGE_REQUESTS,
      failedSpanCount: CHARGE_FAILURES,
      failedSampleSize: 20,
    });

    const noisy: LogInsightEvidence = found[3]!.evidence.log!;

    expect(noisy).toMatchObject({
      patternCount: CACHE_HITS,
      patternPercent: 70,
      sampledLogCount: BILLING_LINES,
      searchText: "cache hit for key",
    });

    // No line as it was logged reaches a finding.
    for (const candidate of found) {
      expect(JSON.stringify(candidate)).not.toContain(uuidOf(7));
    }
  });
});

describe("Log insight reads ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
