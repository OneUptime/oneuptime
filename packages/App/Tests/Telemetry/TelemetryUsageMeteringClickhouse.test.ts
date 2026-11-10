import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import TelemetryUsageBilling from "Common/Models/DatabaseModels/TelemetryUsageBilling";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import OneUptimeDate from "Common/Types/Date";
import Decimal from "Common/Types/Decimal";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Metering without billing (issue #5916), against a real ClickHouse.
 *
 * Billing's usage scan - one byteSize(*) aggregation per table, grouped by
 * (primaryEntityId, primaryEntityType) - is what a server without billing
 * meters with too. The unit suites (Common's TelemetryUsageMetering) mock
 * the scan; this one runs it, over the real Log, Span and ExceptionInstance
 * tables, and shows that what metering stages is exactly what ClickHouse
 * holds: per resource, of the one project, of the one UTC day, with
 * OneUptime's own monitor telemetry left out, at no cost.
 *
 * Postgres is not used: the usage rows are kept in memory, and the
 * resources' retention is stubbed.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/TelemetryUsageMeteringClickhouse.test.ts
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

// Billing off: the install this metering is for.
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    IsBillingEnabled: false,
  };
});

import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryUsageBillingService, {
  TelemetryResourceUsage,
} from "Common/Server/Services/TelemetryUsageBillingService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `telemetry_usage_metering_test_${process.pid}_${Date.now()}`;

const DAY_MS: number = 24 * 60 * 60 * 1000;
const TODAY: number = Math.floor(Date.now() / DAY_MS) * DAY_MS;
// Two days of the week metering looks back over, and two it never counts.
const YESTERDAY: Date = new Date(TODAY - DAY_MS);
const THREE_DAYS_AGO: Date = new Date(TODAY - 3 * DAY_MS);
const TEN_DAYS_AGO: Date = new Date(TODAY - 10 * DAY_MS);
const TODAY_NOON: Date = new Date(TODAY + 12 * 60 * 60 * 1000);

const PROJECT_ID: ObjectID = new ObjectID(
  "5916aaaa-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5916bbbb-0000-4000-8000-000000000002",
);
const SERVICE_ID: string = "5916cccc-0000-4000-8000-000000000003";
const HOST_ID: string = "5916dddd-0000-4000-8000-000000000004";
const MONITOR_ID: string = "5916eeee-0000-4000-8000-000000000005";

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 60),
);

let rowNumber: number = 0;

function at(day: Date, minutes: number): Date {
  return new Date(day.getTime() + minutes * 60 * 1000);
}

function logRow(data: {
  projectId: ObjectID;
  entityId: string;
  entityType: ServiceType;
  time: Date;
  body: string;
}): JSONObject {
  rowNumber++;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: data.projectId.toString(),
    primaryEntityId: data.entityId,
    primaryEntityType: data.entityType,
    time: OneUptimeDate.toClickhouseDateTime64(data.time),
    timeUnixNano: String(data.time.getTime() * 1000000 + rowNumber),
    severityText: "Information",
    severityNumber: 9,
    attributes: { "http.route": "/checkout", n: String(rowNumber) },
    attributeKeys: ["http.route", "n"],
    entityKeys: [],
    traceId: "",
    spanId: "",
    body: data.body,
    retentionDate: retentionDate,
  };
}

function spanRow(time: Date, name: string): JSONObject {
  rowNumber++;
  const nanos: number = time.getTime() * 1000000;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    startTime: OneUptimeDate.toClickhouseDateTime64(time),
    endTime: OneUptimeDate.toClickhouseDateTime64(at(time, 1)),
    startTimeUnixNano: String(nanos),
    endTimeUnixNano: String(nanos + 60 * 1000000000),
    durationUnixNano: String(60 * 1000000000),
    traceId: `trace-${rowNumber}`,
    spanId: `span-${rowNumber}`,
    name: name,
    attributes: { "http.route": "/checkout" },
    attributeKeys: ["http.route"],
    entityKeys: [],
    retentionDate: retentionDate,
  };
}

function exceptionRow(time: Date, message: string): JSONObject {
  rowNumber++;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000 + rowNumber),
    exceptionType: "TypeError",
    message: message,
    stackTrace: `TypeError: ${message}\n    at checkout (app.js:${rowNumber}:1)`,
    fingerprint: `fingerprint-${rowNumber}`,
    attributes: {},
    attributeKeys: [],
    retentionDate: retentionDate,
  };
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

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

type ConnectedService =
  | typeof LogService
  | typeof SpanService
  | typeof ExceptionInstanceService;

const SERVICES: Array<ConnectedService> = [
  LogService,
  SpanService,
  ExceptionInstanceService,
];

// The bytes ClickHouse itself says each resource's rows of a window take.
async function bytesByEntity(
  client: ClickhouseClient,
  table: string,
  timestampColumn: string,
  projectId: ObjectID,
  start: Date,
): Promise<Record<string, number>> {
  const result: { data: Array<JSONObject> } = (await (
    await client.query({
      query: `SELECT primaryEntityId, sum(byteSize(*)) AS bytes FROM ${database}.${table} WHERE projectId = {projectId:String} AND ${timestampColumn} >= {start:DateTime64(9)} AND ${timestampColumn} <= {end:DateTime64(9)} GROUP BY primaryEntityId`,
      query_params: {
        projectId: projectId.toString(),
        start: OneUptimeDate.toClickhouseDateTime64(start),
        end: OneUptimeDate.toClickhouseDateTime64(
          new Date(start.getTime() + DAY_MS - 1),
        ),
      },
      format: "JSON",
    })
  ).json()) as { data: Array<JSONObject> };

  const bytes: Record<string, number> = {};

  for (const row of result.data) {
    bytes[row["primaryEntityId"] as string] = Number(row["bytes"]);
  }

  return bytes;
}

interface StagedRow {
  productType: ProductType;
  day: string;
  primaryEntityId: string;
  primaryEntityType: ServiceType | undefined;
  dataIngestedInGB: number;
  // Of that, the exceptions (issue #6356): Traces rows only, else null.
  exceptionDataIngestedInGB: number | null;
  totalCostInUSD: number;
  isReportedToBillingProvider: boolean;
}

integration("Metering without billing against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const originals: Map<ConnectedService, ServiceConnection> = new Map();
  let staged: Array<StagedRow>;

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

    for (const modelType of [Log, Span, ExceptionInstance]) {
      await createTable(client, clickhouse, modelType);
    }

    for (const service of SERVICES) {
      originals.set(service, {
        database: service.database,
        databaseClient: service.databaseClient,
        ingestDatabase: service.ingestDatabase,
        ingestDatabaseClient: service.ingestDatabaseClient,
      });

      service.database = clickhouse;
      service.databaseClient = client;
      service.ingestDatabase = clickhouse;
      service.ingestDatabaseClient = client;
    }

    const longBody: string = "checkout failed while charging the card ".repeat(
      40,
    );

    await LogService.insertJsonRows(
      [
        // The project's service, yesterday: four logs of different sizes.
        logRow({
          projectId: PROJECT_ID,
          entityId: SERVICE_ID,
          entityType: ServiceType.OpenTelemetry,
          time: at(YESTERDAY, 5),
          body: "short",
        }),
        logRow({
          projectId: PROJECT_ID,
          entityId: SERVICE_ID,
          entityType: ServiceType.OpenTelemetry,
          time: at(YESTERDAY, 600),
          body: longBody,
        }),
        logRow({
          projectId: PROJECT_ID,
          entityId: SERVICE_ID,
          entityType: ServiceType.OpenTelemetry,
          time: at(YESTERDAY, 1200),
          body: longBody,
        }),
        logRow({
          projectId: PROJECT_ID,
          entityId: SERVICE_ID,
          entityType: ServiceType.OpenTelemetry,
          // The last minute of the UTC day still counts for it.
          time: at(YESTERDAY, 24 * 60 - 1),
          body: "late",
        }),
        // Its host, yesterday.
        logRow({
          projectId: PROJECT_ID,
          entityId: HOST_ID,
          entityType: ServiceType.Host,
          time: at(YESTERDAY, 30),
          body: "kernel: eth0 link up",
        }),
        logRow({
          projectId: PROJECT_ID,
          entityId: HOST_ID,
          entityType: ServiceType.Host,
          time: at(YESTERDAY, 31),
          body: "systemd: started nginx",
        }),
        // A monitor's own logs: OneUptime's, never counted.
        logRow({
          projectId: PROJECT_ID,
          entityId: MONITOR_ID,
          entityType: ServiceType.Monitor,
          time: at(YESTERDAY, 40),
          body: longBody,
        }),
        // Telemetry that named no service: the project's own id.
        logRow({
          projectId: PROJECT_ID,
          entityId: PROJECT_ID.toString(),
          entityType: ServiceType.Unknown,
          time: at(YESTERDAY, 50),
          body: "who sent this",
        }),
        // The service, three days ago.
        logRow({
          projectId: PROJECT_ID,
          entityId: SERVICE_ID,
          entityType: ServiceType.OpenTelemetry,
          time: at(THREE_DAYS_AGO, 60),
          body: longBody,
        }),
        // Outside the week, and today: never counted.
        logRow({
          projectId: PROJECT_ID,
          entityId: SERVICE_ID,
          entityType: ServiceType.OpenTelemetry,
          time: at(TEN_DAYS_AGO, 60),
          body: longBody,
        }),
        logRow({
          projectId: PROJECT_ID,
          entityId: SERVICE_ID,
          entityType: ServiceType.OpenTelemetry,
          time: TODAY_NOON,
          body: longBody,
        }),
        // Another project's logs, yesterday: never this project's.
        logRow({
          projectId: OTHER_PROJECT_ID,
          entityId: SERVICE_ID,
          entityType: ServiceType.OpenTelemetry,
          time: at(YESTERDAY, 70),
          body: longBody,
        }),
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    await SpanService.insertJsonRows(
      [
        spanRow(at(YESTERDAY, 100), "GET /checkout"),
        spanRow(at(YESTERDAY, 101), "POST /charge"),
        spanRow(at(YESTERDAY, 102), "SELECT orders"),
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    await ExceptionInstanceService.insertJsonRows(
      [
        exceptionRow(at(YESTERDAY, 103), "card is undefined"),
        exceptionRow(at(YESTERDAY, 104), "amount is NaN"),
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );
  });

  afterAll(async (): Promise<void> => {
    for (const [service, original] of originals) {
      Object.assign(service, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  beforeEach((): void => {
    staged = [];

    // The usage rows, in memory: none staged before the run.
    jest
      .spyOn(TelemetryUsageBillingService, "findBy")
      .mockImplementation((async (): Promise<Array<TelemetryUsageBilling>> => {
        return [];
      }) as never);
    jest
      .spyOn(TelemetryUsageBillingService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(TelemetryUsageBillingService, "create")
      .mockImplementation((async (args: {
        data: TelemetryUsageBilling;
      }): Promise<TelemetryUsageBilling> => {
        staged.push({
          productType: args.data.productType!,
          day: args.data.day!,
          primaryEntityId: args.data.primaryEntityId!.toString(),
          primaryEntityType: args.data.primaryEntityType,
          dataIngestedInGB: Number(
            (args.data.dataIngestedInGB as Decimal).value,
          ),
          exceptionDataIngestedInGB:
            args.data.exceptionDataIngestedInGB instanceof Decimal
              ? Number(args.data.exceptionDataIngestedInGB.value)
              : null,
          totalCostInUSD: Number((args.data.totalCostInUSD as Decimal).value),
          isReportedToBillingProvider: Boolean(
            args.data.isReportedToBillingProvider,
          ),
        });

        return args.data;
      }) as never);

    jest
      .spyOn(
        TelemetryUsageBillingService as unknown as {
          buildTelemetryRetentionMap: () => Promise<Map<string, number>>;
        },
        "buildTelemetryRetentionMap",
      )
      .mockResolvedValue(new Map<string, number>([[HOST_ID, 30]]));
    jest
      .spyOn(
        TelemetryUsageBillingService as unknown as {
          getProjectDefaultRetentionInDays: () => Promise<number>;
        },
        "getProjectDefaultRetentionInDays",
      )
      .mockResolvedValue(15);
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("counts each resource's bytes of the day exactly as ClickHouse holds them", async () => {
    const usage: Map<string, TelemetryResourceUsage> =
      await TelemetryUsageBillingService.getTelemetryUsageByResource({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
        startDate: YESTERDAY,
        endDate: OneUptimeDate.getEndOfDay(YESTERDAY, "UTC"),
      });

    const expected: Record<string, number> = await bytesByEntity(
      client,
      new Log().tableName,
      "time",
      PROJECT_ID,
      YESTERDAY,
    );

    expect(Array.from(usage.keys()).sort()).toEqual(
      [SERVICE_ID, HOST_ID, PROJECT_ID.toString()].sort(),
    );

    for (const [entityId, resource] of usage) {
      expect({ entityId, bytes: resource.bytes }).toEqual({
        entityId,
        bytes: expected[entityId],
      });
      expect(resource.bytes).toBeGreaterThan(0);
    }

    expect(usage.get(SERVICE_ID)!.primaryEntityType).toBe(
      ServiceType.OpenTelemetry,
    );
    expect(usage.get(HOST_ID)!.primaryEntityType).toBe(ServiceType.Host);
    expect(usage.get(PROJECT_ID.toString())!.primaryEntityType).toBe(
      ServiceType.Unknown,
    );

    // The monitor's logs are in ClickHouse, and are not usage.
    expect(expected[MONITOR_ID]).toBeGreaterThan(0);
    expect(usage.has(MONITOR_ID)).toBe(false);
  });

  test("counts a trace day's spans and the exceptions recorded with them, together", async () => {
    const usage: Map<string, TelemetryResourceUsage> =
      await TelemetryUsageBillingService.getTelemetryUsageByResource({
        projectId: PROJECT_ID,
        productType: ProductType.Traces,
        startDate: YESTERDAY,
        endDate: OneUptimeDate.getEndOfDay(YESTERDAY, "UTC"),
      });

    const spans: Record<string, number> = await bytesByEntity(
      client,
      new Span().tableName,
      "startTime",
      PROJECT_ID,
      YESTERDAY,
    );
    const exceptions: Record<string, number> = await bytesByEntity(
      client,
      new ExceptionInstance().tableName,
      "time",
      PROJECT_ID,
      YESTERDAY,
    );

    expect(spans[SERVICE_ID]).toBeGreaterThan(0);
    expect(exceptions[SERVICE_ID]).toBeGreaterThan(0);
    expect(usage.get(SERVICE_ID)!.bytes).toBe(
      spans[SERVICE_ID]! + exceptions[SERVICE_ID]!,
    );

    /*
     * Issue #6356: and how many of those bytes the exception rows were,
     * exactly as ClickHouse holds them - a part of the bytes the traces are
     * billed for, never more on top of them.
     */
    expect(usage.get(SERVICE_ID)!.exceptionBytes).toBe(
      exceptions[SERVICE_ID],
    );
    expect(
      usage.get(SERVICE_ID)!.bytes - usage.get(SERVICE_ID)!.exceptionBytes!,
    ).toBe(spans[SERVICE_ID]);
  });

  test("gives no other signal an exceptions part, though the exception table has rows that day", async () => {
    const usage: Map<string, TelemetryResourceUsage> =
      await TelemetryUsageBillingService.getTelemetryUsageByResource({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
        startDate: YESTERDAY,
        endDate: OneUptimeDate.getEndOfDay(YESTERDAY, "UTC"),
      });

    expect(usage.size).toBeGreaterThan(0);

    for (const [entityId, resource] of usage) {
      expect({ entityId, exceptionBytes: resource.exceptionBytes }).toEqual({
        entityId,
        exceptionBytes: undefined,
      });
    }
  });

  test("meters the week's days that have telemetry, at no cost, and never today, an older day or another project", async () => {
    for (const productType of [ProductType.Logs, ProductType.Traces]) {
      await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: productType,
      });
    }

    const yesterdayDay: string =
      OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: YESTERDAY,
        timezone: "UTC",
        format: "MMM DD, YYYY",
      });
    const threeDaysAgoDay: string =
      OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: THREE_DAYS_AGO,
        timezone: "UTC",
        format: "MMM DD, YYYY",
      });

    expect(
      staged
        .map((row: StagedRow): string => {
          return `${row.productType} ${row.day} ${row.primaryEntityId}`;
        })
        .sort(),
    ).toEqual(
      [
        `${ProductType.Logs} ${yesterdayDay} ${SERVICE_ID}`,
        `${ProductType.Logs} ${yesterdayDay} ${HOST_ID}`,
        `${ProductType.Logs} ${yesterdayDay} ${PROJECT_ID.toString()}`,
        `${ProductType.Logs} ${threeDaysAgoDay} ${SERVICE_ID}`,
        `${ProductType.Traces} ${yesterdayDay} ${SERVICE_ID}`,
      ].sort(),
    );

    const logBytes: Record<string, number> = await bytesByEntity(
      client,
      new Log().tableName,
      "time",
      PROJECT_ID,
      YESTERDAY,
    );
    const serviceYesterday: StagedRow = staged.find((row: StagedRow) => {
      return (
        row.productType === ProductType.Logs &&
        row.day === yesterdayDay &&
        row.primaryEntityId === SERVICE_ID
      );
    })!;

    expect(serviceYesterday.dataIngestedInGB).toBe(
      logBytes[SERVICE_ID]! / (1024 * 1024 * 1024),
    );
    // A logs row records no exceptions part.
    expect(serviceYesterday.exceptionDataIngestedInGB).toBeNull();

    /*
     * The traces row keeps everything its spans and exceptions take, as it
     * is billed, and records the exceptions' part of it (issue #6356).
     */
    const spanBytes: Record<string, number> = await bytesByEntity(
      client,
      new Span().tableName,
      "startTime",
      PROJECT_ID,
      YESTERDAY,
    );
    const exceptionBytes: Record<string, number> = await bytesByEntity(
      client,
      new ExceptionInstance().tableName,
      "time",
      PROJECT_ID,
      YESTERDAY,
    );
    const tracesYesterday: StagedRow = staged.find((row: StagedRow) => {
      return (
        row.productType === ProductType.Traces &&
        row.day === yesterdayDay &&
        row.primaryEntityId === SERVICE_ID
      );
    })!;

    expect(tracesYesterday.dataIngestedInGB).toBe(
      (spanBytes[SERVICE_ID]! + exceptionBytes[SERVICE_ID]!) /
        (1024 * 1024 * 1024),
    );
    expect(tracesYesterday.exceptionDataIngestedInGB).toBe(
      exceptionBytes[SERVICE_ID]! / (1024 * 1024 * 1024),
    );

    for (const row of staged) {
      expect(row.totalCostInUSD).toBe(0);
      expect(row.isReportedToBillingProvider).toBe(false);
      expect(row.primaryEntityId).not.toBe(MONITOR_ID);
    }
  });
});

describe("Telemetry usage metering ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
