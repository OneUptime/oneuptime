import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import PositiveNumber from "Common/Types/PositiveNumber";
import { getOccurrenceFingerprintQuery } from "Common/Types/Telemetry/ExceptionGroupFingerprints";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ------------------------------------------------------------------
 * The AI insight scan's exception counts against a real ClickHouse server
 * (issue #6085).
 *
 * The scan's spike detector counted each candidate exception's occurrences
 * in two windows - the last hour and the day before it - with two counts a
 * candidate: up to 50 statements a project every 15 minutes. It now counts
 * every candidate's in one statement, by fingerprint
 * (AnalyticsDatabaseService.countPerValueInWindows), and sums each
 * candidate's group. This suite holds the one statement to the two counts
 * on a real server: for every group - one fingerprint, several merged into
 * one, a fingerprint with no occurrence - the sums are the counts, with
 * occurrences on every edge of both windows (the spike window's start is in
 * both, as InBetween has it), just outside them, of another project, and
 * past their retention.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/ExceptionSpikeCountsClickhouse.test.ts
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

import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `exception_spike_counts_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("8800000000000000000000c1");
const otherProjectId: ObjectID = new ObjectID("8800000000000000000000c2");
const serviceId: ObjectID = new ObjectID("8800000000000000000000d1");

const HOUR_MS: number = 60 * 60 * 1000;

// The scan's clock and windows, as the detector has them.
const now: Date = new Date(
  Math.floor(Date.now() / 1000) * 1000 - 2 * 24 * HOUR_MS,
);
const recentWindowStart: Date = new Date(now.getTime() - HOUR_MS);
const priorWindowStart: Date = new Date(
  recentWindowStart.getTime() - 24 * HOUR_MS,
);

// Every edge of both windows, either side of it, and inside them.
const EDGES: Array<Date> = [
  now,
  new Date(now.getTime() - 1),
  new Date(now.getTime() + 1),
  recentWindowStart,
  new Date(recentWindowStart.getTime() - 1),
  new Date(recentWindowStart.getTime() + 1),
  priorWindowStart,
  new Date(priorWindowStart.getTime() - 1),
  new Date(priorWindowStart.getTime() + 1),
  new Date(now.getTime() - 20 * 60 * 1000),
  new Date(priorWindowStart.getTime() + 12 * HOUR_MS),
];

// The candidates' groups: each exception's own fingerprint, then those merged into it.
const GROUPS: Array<Array<string>> = [
  ["checkout-fp"],
  ["billing-fp", "billing-merged-a", "billing-merged-b"],
  ["quiet-fp"],
  ["search-fp", "search-merged"],
];

interface OccurrenceFixture {
  projectId?: ObjectID;
  fingerprint: string;
  time: Date;
  expired?: boolean;
}

function fixtures(): Array<OccurrenceFixture> {
  const rows: Array<OccurrenceFixture> = [];
  let count: number = 1;

  for (const group of GROUPS) {
    for (const fingerprint of group) {
      if (fingerprint === "quiet-fp") {
        continue;
      }

      for (const edge of EDGES) {
        // A different number of occurrences at each edge, so none can stand in for another.
        for (let index: number = 0; index < count % 4; index++) {
          rows.push({ fingerprint, time: edge });
        }

        count++;
      }

      rows.push({ projectId: otherProjectId, fingerprint, time: now });
      rows.push({ fingerprint, time: recentWindowStart, expired: true });
    }
  }

  // A fingerprint no candidate has.
  rows.push({ fingerprint: "nobody-fp", time: now });

  return rows;
}

function occurrenceRow(fixture: OccurrenceFixture): JSONObject {
  const retention: Date = fixture.expired
    ? OneUptimeDate.addRemoveDays(new Date(), -2)
    : OneUptimeDate.addRemoveDays(new Date(), 30);

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: (fixture.projectId || projectId).toString(),
    primaryEntityId: serviceId.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(fixture.time),
    timeUnixNano: String(fixture.time.getTime() * 1000000),
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

// What the detector's two counts of a group counted: the last hour, the day before.
async function twoCounts(group: Array<string>): Promise<Array<number>> {
  const fingerprint: string | Includes = getOccurrenceFingerprintQuery(group);
  const counts: Array<number> = [];

  for (const [startsAt, endsAt] of [
    [recentWindowStart, now],
    [priorWindowStart, recentWindowStart],
  ] as Array<[Date, Date]>) {
    const count: PositiveNumber = await ExceptionInstanceService.countBy({
      query: {
        projectId: projectId,
        fingerprint,
        time: new InBetween(startsAt, endsAt),
      } as never,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    counts.push(count.toNumber());
  }

  return counts;
}

integration("the AI insight scan's exception counts against ClickHouse", () => {
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
      fixtures().map(occurrenceRow),
      {
        clickhouseSettings: { wait_for_async_insert: 1 },
      },
    );
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(ExceptionInstanceService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      await client.close();
    }
  });

  test("one statement counts what two counts a candidate counted, for every candidate", async () => {
    const execute: SpyInstance<typeof ExceptionInstanceService.executeQuery> =
      jest.spyOn(ExceptionInstanceService, "executeQuery");

    const counted: Map<
      string,
      Array<number>
    > = await ExceptionInstanceService.countPerValueInWindows({
      query: {
        projectId: projectId,
        fingerprint: new Includes(GROUPS.flat()),
      } as never,
      valueColumnName: "fingerprint",
      timeColumnName: "time",
      windows: [
        { startsAt: recentWindowStart, endsAt: now },
        { startsAt: priorWindowStart, endsAt: recentWindowStart },
      ],
      props: { isRoot: true },
    });

    // One statement, for all of them.
    expect(execute).toHaveBeenCalledTimes(1);
    execute.mockRestore();

    for (const group of GROUPS) {
      const summed: Array<number> = [0, 0];

      for (const fingerprint of group) {
        const counts: Array<number> = counted.get(fingerprint) || [0, 0];
        summed[0]! += counts[0]!;
        summed[1]! += counts[1]!;
      }

      expect({ group, counts: summed }).toEqual({
        group,
        counts: await twoCounts(group),
      });
    }

    // The edges count as both ends in: something in each window of each busy group.
    expect((await twoCounts(["checkout-fp"]))[0]).toBeGreaterThan(0);
    expect((await twoCounts(["checkout-fp"]))[1]).toBeGreaterThan(0);

    // A fingerprint with no occurrence in either window is not there at all.
    expect(counted.has("quiet-fp")).toBe(false);
    // Nor one the query did not name, of this project or of another.
    expect(counted.has("nobody-fp")).toBe(false);
  });

  test("no window: nothing is counted, and nothing is asked", async () => {
    const execute: SpyInstance<typeof ExceptionInstanceService.executeQuery> =
      jest.spyOn(ExceptionInstanceService, "executeQuery");

    expect(
      await ExceptionInstanceService.countPerValueInWindows({
        query: { projectId: projectId } as never,
        valueColumnName: "fingerprint",
        timeColumnName: "time",
        windows: [],
        props: { isRoot: true },
      }),
    ).toEqual(new Map<string, Array<number>>());
    expect(execute).not.toHaveBeenCalled();
    execute.mockRestore();
  });
});

describe("the AI insight scan's exception counts ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
