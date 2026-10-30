import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import { ExceptionListStats } from "Common/Types/Telemetry/ExceptionListStats";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
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
 * The exceptions list's affected users and trend charts against a real
 * ClickHouse server.
 *
 * The unit suite (Common ExceptionListStatsReader.test.ts) pins the SQL the
 * reader sends. What only a server shows is what it COUNTS: that users are
 * distinct and an occurrence naming nobody counts nobody, that each
 * occurrence lands in the right one of the 24 bars - the range's first and
 * last instants included - and that the project, the range, the
 * fingerprints, the retention and the caller's read scope all narrow both
 * reads. So this suite runs ExceptionListStatsReader.read, exactly as the
 * route calls it, over rows in a table built from the real ExceptionInstance
 * model (its userId column included).
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/ExceptionListStatsClickhouse.test.ts
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

/*
 * The exception groups live in Postgres: the caller's read of them is
 * stubbed, and each test says which exceptions it may read. So is the
 * caller's telemetry scope, which each test sets.
 */
jest.mock("Common/Server/Services/TelemetryExceptionService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Telemetry/TelemetryReadAccess", () => {
  return {
    __esModule: true,
    default: { getServiceFilter: jest.fn() },
  };
});

import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import TelemetryReadAccess from "Common/Server/Utils/Telemetry/TelemetryReadAccess";
import ExceptionListStatsReader from "Common/Server/Utils/Telemetry/ExceptionListStatsReader";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `exception_list_stats_test_${process.pid}_${Date.now()}`;

const findBy: jest.Mock =
  TelemetryExceptionService.findBy as unknown as jest.Mock;
const getServiceFilter: jest.Mock =
  TelemetryReadAccess.getServiceFilter as unknown as jest.Mock;

const projectId: ObjectID = new ObjectID("8800000000000000000000a1");
const otherProjectId: ObjectID = new ObjectID("8800000000000000000000a2");
const checkoutServiceId: ObjectID = new ObjectID("8800000000000000000000b1");
const billingServiceId: ObjectID = new ObjectID("8800000000000000000000b2");

const CHECKOUT: string = "30000000-0000-4000-8000-0000000000c1";
const BILLING: string = "30000000-0000-4000-8000-0000000000c2";
const QUIET: string = "30000000-0000-4000-8000-0000000000c3";

const HOUR_MS: number = 60 * 60 * 1000;
// A 24-hour range of whole hours: bar N holds hour N.
const rangeEnd: Date = new Date(
  Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS,
);
const rangeStart: Date = new Date(rangeEnd.getTime() - 24 * HOUR_MS);

interface OccurrenceFixture {
  projectId?: ObjectID;
  serviceId?: ObjectID;
  fingerprint: string;
  userId?: string | undefined;
  // Milliseconds after the range's start.
  at: number;
  expired?: boolean;
}

const occurrences: Array<OccurrenceFixture> = [
  // checkout-fp: three users, one of them twice, one occurrence naming nobody.
  { fingerprint: "checkout-fp", userId: "ana", at: 0 },
  { fingerprint: "checkout-fp", userId: "ana", at: 30 * 60 * 1000 },
  { fingerprint: "checkout-fp", userId: "ben", at: 5 * HOUR_MS + 1000 },
  { fingerprint: "checkout-fp", userId: "cy", at: 5 * HOUR_MS + 2000 },
  { fingerprint: "checkout-fp", userId: "", at: 5 * HOUR_MS + 3000 },
  { fingerprint: "checkout-fp", userId: undefined, at: 23 * HOUR_MS },
  // The range's very last instant: the last bar.
  { fingerprint: "checkout-fp", userId: "dee", at: 24 * HOUR_MS },
  // Outside the range on either side: not counted.
  { fingerprint: "checkout-fp", userId: "early", at: -1000 },
  { fingerprint: "checkout-fp", userId: "late", at: 24 * HOUR_MS + 1000 },
  // Past its retention: not counted.
  { fingerprint: "checkout-fp", userId: "expired", at: HOUR_MS, expired: true },
  // Another project with the same fingerprint: not counted.
  {
    projectId: otherProjectId,
    fingerprint: "checkout-fp",
    userId: "other-project",
    at: HOUR_MS,
  },

  // billing-fp, in another service: one user, three occurrences.
  {
    serviceId: billingServiceId,
    fingerprint: "billing-fp",
    userId: "zed",
    at: 10 * HOUR_MS,
  },
  {
    serviceId: billingServiceId,
    fingerprint: "billing-fp",
    userId: "zed",
    at: 10 * HOUR_MS + 1,
  },
  {
    serviceId: billingServiceId,
    fingerprint: "billing-fp",
    userId: "zed",
    at: 11 * HOUR_MS,
  },

  // A fingerprint nobody asked about.
  { fingerprint: "unrelated-fp", userId: "ana", at: HOUR_MS },
];

function occurrenceRow(fixture: OccurrenceFixture): JSONObject {
  const time: Date = new Date(rangeStart.getTime() + fixture.at);
  const retention: Date = fixture.expired
    ? OneUptimeDate.addRemoveDays(new Date(), -2)
    : OneUptimeDate.addRemoveDays(new Date(), 30);

  const row: JSONObject = {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: (fixture.projectId || projectId).toString(),
    primaryEntityId: (fixture.serviceId || checkoutServiceId).toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000),
    exceptionType: "TypeError",
    stackTrace: "",
    message: "cart is undefined",
    spanStatusCode: 2,
    escaped: false,
    traceId: "",
    spanId: "",
    fingerprint: fixture.fingerprint,
    spanName: "",
    release: "",
    environment: "",
    parsedFrames: "",
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    retentionDate: OneUptimeDate.toClickhouseDateTime(retention).substring(
      0,
      10,
    ),
  };

  // undefined leaves the column out, the way a row from before it reads.
  if (fixture.userId !== undefined) {
    row["userId"] = fixture.userId;
  }

  return row;
}

function group(
  id: string,
  fingerprint: string,
  serviceId: ObjectID,
): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  exception._id = id;
  exception.fingerprint = fingerprint;
  exception.primaryEntityId = serviceId;
  return exception;
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

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

async function read(ids: Array<string>): Promise<ExceptionListStats> {
  return ExceptionListStatsReader.read({
    telemetryExceptionIds: ids.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    startTime: rangeStart,
    endTime: rangeEnd,
    props: { tenantId: projectId, userId: ObjectID.generate() },
  });
}

integration("the exceptions list's stats against ClickHouse", () => {
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
      occurrences.map(occurrenceRow),
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
    findBy
      .mockReset()
      .mockResolvedValue([
        group(CHECKOUT, "checkout-fp", checkoutServiceId),
        group(BILLING, "billing-fp", billingServiceId),
        group(QUIET, "quiet-fp", checkoutServiceId),
      ] as never);
    getServiceFilter.mockReset().mockResolvedValue({
      serviceIds: [checkoutServiceId, billingServiceId],
    } as never);
  });

  test("users are distinct, and occurrences that name nobody count nobody", async () => {
    const stats: ExceptionListStats = await read([CHECKOUT, BILLING, QUIET]);
    const users: Array<number | null> = stats.items.map(
      (item: { affectedUsers: number | null }) => {
        return item.affectedUsers;
      },
    );

    // ana, ben, cy and dee - not early, late, expired or the other project's.
    expect(users).toEqual([4, 1, 0]);
  });

  test("each occurrence in the range lands in its hour's bar, the last instant in the last", async () => {
    const stats: ExceptionListStats = await read([CHECKOUT, BILLING]);
    const checkout: Array<number> = stats.items[0]!.trend;
    const billing: Array<number> = stats.items[1]!.trend;

    expect(stats.bucketSizeInSeconds).toBe(3600);
    expect(checkout[0]).toBe(2);
    expect(checkout[5]).toBe(3);
    expect(checkout[23]).toBe(2);
    expect(
      checkout.reduce((a: number, b: number) => {
        return a + b;
      }),
    ).toBe(7);
    expect(billing[10]).toBe(2);
    expect(billing[11]).toBe(1);
    expect(
      billing.reduce((a: number, b: number) => {
        return a + b;
      }),
    ).toBe(3);
  });

  test("an exception with no occurrence in the range has a flat trend", async () => {
    const stats: ExceptionListStats = await read([QUIET]);

    expect(stats.items[0]!.trend).toEqual(new Array(24).fill(0));
  });

  test("the caller's read scope narrows both reads", async () => {
    getServiceFilter.mockResolvedValue({
      serviceIds: [checkoutServiceId],
    } as never);

    const stats: ExceptionListStats = await read([CHECKOUT, BILLING]);

    expect(stats.items[0]!.affectedUsers).toBe(4);
    expect(stats.items[1]!.affectedUsers).toBe(0);
    expect(
      stats.items[1]!.trend.reduce((a: number, b: number) => {
        return a + b;
      }),
    ).toBe(0);
  });

  test("an exception the caller may not read is not answered for", async () => {
    findBy.mockResolvedValue([
      group(CHECKOUT, "checkout-fp", checkoutServiceId),
    ] as never);

    const stats: ExceptionListStats = await read([CHECKOUT, BILLING]);

    expect(
      stats.items.map((item: { telemetryExceptionId: string }) => {
        return item.telemetryExceptionId;
      }),
    ).toEqual([CHECKOUT]);
  });
});

describe("the exceptions list's stats ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
