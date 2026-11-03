import CloudCostService from "../../../../Server/Services/CloudCostService";
import CloudCostWriter, {
  CloudCostSeriesPoint,
  CloudCostWriteResult,
  CloudCostWriteTarget,
} from "../../../../Server/Utils/CloudConnection/CloudCostWriter";
import { CloudCostRecord } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  CloudAccountCostSummary,
  CloudCostState,
} from "../../../../Types/Cloud/CloudCost";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The cost writer keeps a day's rows adding up to the cloud's latest figure:
 * it reads what is stored for the window, one sum per day and series, and
 * writes only the difference. Here with the store stood in: the stored sums
 * the writer reads back, and the rows it inserts. The real ClickHouse runs
 * the same statements in CloudCostWriterClickhouseIntegration.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const CONNECTION: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000c1",
);
const ACCOUNT_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000b1",
);
const OTHER_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000b2",
);
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const WINDOW: { start: Date; end: Date } = {
  start: new Date("2026-11-13T00:00:00.000Z"),
  end: new Date("2026-11-21T00:00:00.000Z"),
};

const TARGET: CloudCostWriteTarget = {
  projectId: PROJECT,
  connectionId: CONNECTION,
  provider: "aws",
  accountRows: new Map([
    ["123456789012", ACCOUNT_ROW],
    ["210987654321", OTHER_ROW],
  ]),
};

function record(overrides: Partial<CloudCostRecord>): CloudCostRecord {
  return {
    accountId: "123456789012",
    day: "2026-11-19",
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "",
    amount: 10,
    currency: "USD",
    ...overrides,
  };
}

function point(overrides: Partial<CloudCostSeriesPoint>): CloudCostSeriesPoint {
  return {
    cloudAccountId: ACCOUNT_ROW.toString(),
    accountId: "123456789012",
    day: "2026-11-19",
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "",
    currency: "USD",
    amount: 10,
    ...overrides,
  };
}

// The stored-sums rows as ClickHouse answers them.
function storedRow(entry: CloudCostSeriesPoint): JSONObject {
  return {
    accountRowId: entry.cloudAccountId,
    cloudAccountName: entry.accountId,
    dayText: entry.day,
    serviceName: entry.service,
    regionName: entry.region,
    resourceKey: entry.resourceId,
    currencyCode: entry.currency,
    total: String(entry.amount),
  };
}

describe("a series and the cloud's records", () => {
  test("a series is its account, day, service, Region, resource and currency", () => {
    expect(CloudCostWriter.seriesKey(point({}))).toBe(
      CloudCostWriter.seriesKey(point({ amount: 99, accountId: "other" })),
    );
    expect(CloudCostWriter.seriesKey(point({}))).not.toBe(
      CloudCostWriter.seriesKey(point({ region: "eu-west-1" })),
    );
    expect(CloudCostWriter.seriesKey(point({}))).not.toBe(
      CloudCostWriter.seriesKey(point({ currency: "EUR" })),
    );
  });

  test("records of one series add up; an account OneUptime holds no row for is left out", () => {
    const { points, withoutAccount } = CloudCostWriter.toSeriesPoints({
      target: TARGET,
      records: [
        record({ amount: 4 }),
        // The same series on a second page.
        record({ amount: 6, accountId: " 123456789012 " }),
        record({ service: "Amazon S3", amount: 1 }),
        record({ accountId: "999999999999", amount: 50 }),
        record({ amount: Number.NaN }),
        record({ currency: "" }),
      ],
    });

    expect(withoutAccount).toBe(1);
    expect(points).toHaveLength(2);
    expect(
      points.find((entry: CloudCostSeriesPoint): boolean => {
        return entry.service === "Amazon EC2";
      })!.amount,
    ).toBe(20);
    expect(
      points.every((entry: CloudCostSeriesPoint): boolean => {
        return entry.currency === "USD";
      }),
    ).toBe(true);
  });
});

describe("the differences to write", () => {
  test("a day already stored writes only what it grew by; a day it has not, all of it", () => {
    const deltas: Array<CloudCostSeriesPoint> = CloudCostWriter.computeDeltas({
      desired: [point({ amount: 25 }), point({ day: "2026-11-20", amount: 3 })],
      stored: [point({ amount: 20 })],
      window: WINDOW,
    });

    expect(deltas).toEqual([
      point({ amount: 5 }),
      point({ day: "2026-11-20", amount: 3 }),
    ]);
  });

  test("a figure the cloud corrected down is a negative row, and a series it no longer reports is cancelled", () => {
    const deltas: Array<CloudCostSeriesPoint> = CloudCostWriter.computeDeltas({
      desired: [point({ amount: 7 })],
      stored: [point({ amount: 10 }), point({ service: "Amazon S3", amount: 2 })],
      window: WINDOW,
    });

    expect(deltas).toEqual([
      point({ amount: -3 }),
      point({ service: "Amazon S3", amount: -2 }),
    ]);
  });

  test("what already matches writes nothing, float noise included", () => {
    expect(
      CloudCostWriter.computeDeltas({
        desired: [point({ amount: 0.1 + 0.2 })],
        stored: [point({ amount: 0.3 })],
        window: WINDOW,
      }),
    ).toEqual([]);
  });

  test("a row that landed twice is taken back", () => {
    expect(
      CloudCostWriter.computeDeltas({
        desired: [point({ amount: 10 })],
        stored: [point({ amount: 10 }), point({ amount: 10 })],
        window: WINDOW,
      }),
    ).toEqual([point({ amount: -10 })]);
  });

  test("only days inside the window are kept in step", () => {
    expect(
      CloudCostWriter.computeDeltas({
        desired: [point({ day: "2026-11-12", amount: 5 })],
        stored: [point({ day: "2026-11-21", amount: 5 })],
        window: WINDOW,
      }),
    ).toEqual([]);
  });
});

describe("what is read and written", () => {
  test("the stored sums are one row per account, day and series, of the accounts asked for, in the window", () => {
    const statement: Statement = CloudCostWriter.buildStoredSumsStatement({
      projectId: PROJECT,
      cloudAccountIds: [ACCOUNT_ROW.toString()],
      window: WINDOW,
    });

    expect(Object.values(statement.query_params)).toContain("CloudCostV1");
    expect(statement.query).toContain("sum(cost) AS total");
    expect(statement.query).toContain("toString(toDate(day, 'UTC')) AS dayText");
    expect(statement.query).toContain(
      "GROUP BY accountRowId, dayText, serviceName, regionName, resourceKey, currencyCode",
    );
    // A read is bounded: it fails rather than run on.
    expect(statement.query).toContain("max_execution_time");
    expect(Object.values(statement.query_params)).toContain(
      PROJECT.toString(),
    );
  });

  test("stored sums are read back as points; a row without a day or a number is skipped", () => {
    expect(
      CloudCostWriter.readStoredSums([
        storedRow(point({ amount: 12.5 })),
        { ...storedRow(point({})), total: "not a number" },
        { ...storedRow(point({})), dayText: "" },
        { ...storedRow(point({})), currencyCode: "" },
      ]),
    ).toEqual([point({ amount: 12.5 }), point({})]);
  });

  test("a delta is a row of the cost table, stamped with when it was read", () => {
    const rows: Array<JSONObject> = CloudCostWriter.buildRows({
      target: TARGET,
      deltas: [point({ amount: -3 })],
      now: NOW,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: PROJECT.toString(),
      cloudAccountId: ACCOUNT_ROW.toString(),
      cloudConnectionId: CONNECTION.toString(),
      provider: "aws",
      accountId: "123456789012",
      day: "2026-11-19 00:00:00",
      service: "Amazon EC2",
      region: "us-east-1",
      resourceId: "",
      cost: -3,
      currency: "USD",
      readAt: "2026-11-20 12:00:00",
    });
    expect(typeof rows[0]!["_id"]).toBe("string");
  });
});

describe("a write", () => {
  let stored: Array<JSONObject> = [];
  let inserted: Array<Array<JSONObject>> = [];
  let statements: Array<Statement> = [];

  beforeEach(() => {
    stored = [];
    inserted = [];
    statements = [];

    jest
      .spyOn(CloudCostService, "executeQuery")
      .mockImplementation(async (statement: Statement): Promise<never> => {
        statements.push(statement);
        return {
          json: async (): Promise<{ data: Array<JSONObject> }> => {
            return { data: stored };
          },
        } as never;
      });
    jest
      .spyOn(CloudCostService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        inserted.push(rows);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes the differences for the accounts read, and only theirs", async () => {
    stored = [storedRow(point({ amount: 20 }))];

    const result: CloudCostWriteResult = await CloudCostWriter.write({
      target: TARGET,
      window: WINDOW,
      records: [
        record({ amount: 25 }),
        // An account that could not be read is never corrected.
        record({ accountId: "210987654321", amount: 999 }),
      ],
      accountsRead: new Set(["123456789012"]),
      now: NOW,
    });

    expect(result).toEqual({
      seriesCount: 1,
      rowsWritten: 1,
      recordsWithoutAccount: 0,
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.map((row: JSONObject) => row["cost"])).toEqual([5]);
    // The stored sums asked for are the read account's alone.
    expect(Object.values(statements[0]!.query_params)).toContainEqual(
      expect.arrayContaining([ACCOUNT_ROW.toString()]),
    );
  });

  test("nothing changed is nothing written", async () => {
    stored = [storedRow(point({ amount: 10 }))];

    const result: CloudCostWriteResult = await CloudCostWriter.write({
      target: TARGET,
      window: WINDOW,
      records: [record({ amount: 10 })],
      accountsRead: new Set(["123456789012"]),
      now: NOW,
    });

    expect(result.rowsWritten).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  test("no account read reads nothing and writes nothing", async () => {
    const result: CloudCostWriteResult = await CloudCostWriter.write({
      target: TARGET,
      window: WINDOW,
      records: [record({})],
      accountsRead: new Set(),
      now: NOW,
    });

    expect(result.rowsWritten).toBe(0);
    expect(statements).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });
});

describe("an account's summary from what is stored", () => {
  test("its daily totals and this month's services, in the currency most of its cost is in", () => {
    const summaries: Map<string, CloudAccountCostSummary> =
      CloudCostWriter.summarizePoints({
        points: [
          point({ day: "2026-10-05", amount: 300 }),
          point({ day: "2026-11-19", amount: 40 }),
          point({ day: "2026-11-19", service: "Amazon S3", amount: 5 }),
          point({ day: "2026-11-18", amount: 40 }),
          // A stray row in another currency is left out.
          point({ day: "2026-11-18", currency: "EUR", amount: 1 }),
          point({ cloudAccountId: OTHER_ROW.toString(), amount: 1000 }),
        ],
        cloudAccountIds: [ACCOUNT_ROW.toString()],
        now: NOW,
      });

    const summary: CloudAccountCostSummary = summaries.get(
      ACCOUNT_ROW.toString(),
    )!;

    expect(summaries.size).toBe(1);
    expect(summary.state).toBe(CloudCostState.Reading);
    expect(summary.currency).toBe("USD");
    expect(summary.monthToDate).toBe(85);
    expect(summary.lastMonth).toBe(300);
    expect(summary.topServices).toEqual([
      { service: "Amazon EC2", amount: 80 },
      { service: "Amazon S3", amount: 5 },
    ]);
  });

  test("the window a summary needs: last month and the 30 days back, through today", () => {
    expect(CloudCostWriter.getSummaryWindow(NOW)).toEqual({
      start: new Date("2026-10-01T00:00:00.000Z"),
      end: new Date("2026-11-21T00:00:00.000Z"),
    });
    // On the first of March, 30 days back is in January.
    expect(
      CloudCostWriter.getSummaryWindow(new Date("2026-03-01T08:00:00.000Z"))
        .start,
    ).toEqual(new Date("2026-01-31T00:00:00.000Z"));
  });
});
