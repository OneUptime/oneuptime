import CloudCostService from "../../../../Server/Services/CloudCostService";
import CloudCostWriter, {
  CloudCostSeriesPoint,
  CloudCostWriteResult,
  CloudCostWriteTarget,
} from "../../../../Server/Utils/CloudConnection/CloudCostWriter";
import { CloudCostRecord } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { CloudAccountCostSummary } from "../../../../Types/Cloud/CloudCost";
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
 * The cost writer, with each cost's tags and with AWS's whole-service
 * figures: a series is also its set of tags (a resource tagged anew is a
 * series of its new tags from the next read of a day, and the old one is
 * taken back), a row carries its tags, the stored sums read them back, an
 * account's summary says which tags its costs carry - and a figure that is
 * the whole of its service and Region keeps its resources' series and
 * brings the rest in line, so the day still adds up.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const CONNECTION: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000c1",
);
const ACCOUNT_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000b1",
);
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const WINDOW: { start: Date; end: Date } = {
  start: new Date("2026-11-13T00:00:00.000Z"),
  end: new Date("2026-11-21T00:00:00.000Z"),
};
const WEB_1: string = "arn:aws:ec2:us-east-1:123456789012:instance/i-0web1";
const WEB_2: string = "arn:aws:ec2:us-east-1:123456789012:instance/i-0web2";

const TARGET: CloudCostWriteTarget = {
  projectId: PROJECT,
  connectionId: CONNECTION,
  provider: "aws",
  accountRows: new Map([["123456789012", ACCOUNT_ROW]]),
};

function point(overrides: Partial<CloudCostSeriesPoint>): CloudCostSeriesPoint {
  return {
    cloudAccountId: ACCOUNT_ROW.toString(),
    accountId: "123456789012",
    day: "2026-11-19",
    service: "Amazon EC2",
    region: "us-east-1",
    resourceId: "",
    currency: "USD",
    tags: {},
    amount: 10,
    ...overrides,
  };
}

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

function storedRow(entry: CloudCostSeriesPoint): JSONObject {
  return {
    accountRowId: entry.cloudAccountId,
    cloudAccountName: entry.accountId,
    dayText: entry.day,
    serviceName: entry.service,
    regionName: entry.region,
    resourceKey: entry.resourceId,
    currencyCode: entry.currency,
    tagMap: entry.tags,
    total: String(entry.amount),
  };
}

describe("a series and its tags", () => {
  test("one set of tags is one series, however its keys were ordered; another set is another series", () => {
    expect(
      CloudCostWriter.seriesKey(point({ tags: { team: "web", env: "prod" } })),
    ).toBe(
      CloudCostWriter.seriesKey(point({ tags: { env: "prod", team: "web" } })),
    );
    expect(
      CloudCostWriter.seriesKey(point({ tags: { team: "web" } })),
    ).not.toBe(CloudCostWriter.seriesKey(point({ tags: { team: "data" } })));
    expect(CloudCostWriter.seriesKey(point({ tags: {} }))).not.toBe(
      CloudCostWriter.seriesKey(point({ tags: { team: "web" } })),
    );
  });

  test("a record's tags are kept as normalizeCloudCostTags keeps them; a record of one series on two pages is added up", () => {
    const { points } = CloudCostWriter.toSeriesPoints({
      target: TARGET,
      records: [
        record({ resourceId: WEB_1, amount: 4, tags: { " team ": "web" } }),
        record({ resourceId: WEB_1, amount: 6, tags: { team: "web" } }),
        record({ resourceId: WEB_2, amount: 1 }),
      ],
    });

    expect(points).toEqual([
      point({ resourceId: WEB_1, amount: 10, tags: { team: "web" } }),
      point({ resourceId: WEB_2, amount: 1, tags: {} }),
    ]);
  });

  test("a resource tagged anew: its day is a series of the new tags, and the old one is taken back", () => {
    const deltas: Array<CloudCostSeriesPoint> = CloudCostWriter.computeDeltas({
      desired: [
        point({ resourceId: WEB_1, amount: 30, tags: { team: "data" } }),
      ],
      stored: [point({ resourceId: WEB_1, amount: 30, tags: { team: "web" } })],
      window: WINDOW,
    });

    expect(deltas).toEqual([
      point({ resourceId: WEB_1, amount: 30, tags: { team: "data" } }),
      point({ resourceId: WEB_1, amount: -30, tags: { team: "web" } }),
    ]);
  });

  test("the stored sums are grouped by the tags too, and read them back", () => {
    const statement: Statement = CloudCostWriter.buildStoredSumsStatement({
      projectId: PROJECT,
      cloudAccountIds: [ACCOUNT_ROW.toString()],
      window: WINDOW,
    });

    expect(statement.query).toContain("tags AS tagMap");
    expect(statement.query).toContain(
      "GROUP BY accountRowId, dayText, serviceName, regionName, resourceKey, currencyCode, tagMap",
    );
    expect(
      CloudCostWriter.readStoredSums([
        storedRow(point({ tags: { team: "web", env: "prod" } })),
        { ...storedRow(point({})), tagMap: null },
        { ...storedRow(point({})), tagMap: ["team", "web"] },
      ]).map((entry: CloudCostSeriesPoint) => {
        return entry.tags;
      }),
    ).toEqual([{ env: "prod", team: "web" }, {}, {}]);
  });

  test("a row carries its tags, the keys in order", () => {
    const rows: Array<JSONObject> = CloudCostWriter.buildRows({
      target: TARGET,
      deltas: [point({ tags: { team: "web", env: "prod" } })],
      now: NOW,
    });

    expect(rows[0]!["tags"]).toEqual({ env: "prod", team: "web" });
    expect(Object.keys(rows[0]!["tags"] as JSONObject)).toEqual([
      "env",
      "team",
    ]);
  });
});

describe("a figure that is the whole of its service and Region", () => {
  test("its resources' series are kept; the rest takes up what the figure grew by", () => {
    const deltas: Array<CloudCostSeriesPoint> = CloudCostWriter.computeDeltas({
      desired: [point({ amount: 110, isServiceTotal: true })],
      stored: [
        point({ resourceId: WEB_1, amount: 60, tags: { team: "web" } }),
        point({ resourceId: WEB_2, amount: 30 }),
        point({ amount: 10 }),
      ],
      window: WINDOW,
    });

    expect(deltas).toEqual([point({ amount: 10 })]);
  });

  test("a figure corrected down takes the rest down, even below nothing: the day still adds up", () => {
    const deltas: Array<CloudCostSeriesPoint> = CloudCostWriter.computeDeltas({
      desired: [point({ amount: 85, isServiceTotal: true })],
      stored: [
        point({ resourceId: WEB_1, amount: 60 }),
        point({ resourceId: WEB_2, amount: 30 }),
        point({ amount: 10 }),
      ],
      window: WINDOW,
    });

    expect(deltas).toEqual([point({ amount: -15 })]);
  });

  test("a figure that matches what is stored writes nothing; one never split is a plain difference", () => {
    expect(
      CloudCostWriter.computeDeltas({
        desired: [point({ amount: 100, isServiceTotal: true })],
        stored: [
          point({ resourceId: WEB_1, amount: 70 }),
          point({ amount: 30 }),
        ],
        window: WINDOW,
      }),
    ).toEqual([]);
    expect(
      CloudCostWriter.computeDeltas({
        desired: [point({ amount: 40, isServiceTotal: true })],
        stored: [point({ amount: 25 })],
        window: WINDOW,
      }),
    ).toEqual([point({ amount: 15 })]);
    // Never stored at all: all of it, as the rest.
    expect(
      CloudCostWriter.computeDeltas({
        desired: [point({ amount: 40, isServiceTotal: true })],
        stored: [],
        window: WINDOW,
      }),
    ).toEqual([point({ amount: 40 })]);
  });

  test("only its own service, Region and day: a whole-service figure of one never touches another's series", () => {
    const deltas: Array<CloudCostSeriesPoint> = CloudCostWriter.computeDeltas({
      desired: [
        point({ amount: 100, isServiceTotal: true }),
        // The day was read in full: its series in step as ever.
        point({ day: "2026-11-20", resourceId: WEB_1, amount: 5 }),
      ],
      stored: [
        point({ resourceId: WEB_1, amount: 100 }),
        point({ day: "2026-11-20", resourceId: WEB_1, amount: 3 }),
        point({ day: "2026-11-20", resourceId: WEB_2, amount: 4 }),
        point({ region: "eu-west-1", amount: 8 }),
      ],
      window: WINDOW,
    });

    expect(deltas).toEqual([
      point({ day: "2026-11-20", resourceId: WEB_1, amount: 2 }),
      point({ day: "2026-11-20", resourceId: WEB_2, amount: -4 }),
      point({ region: "eu-west-1", amount: -8 }),
    ]);
  });

  test("records of a whole-service figure are kept as one point each, without resource or tags", () => {
    const { points } = CloudCostWriter.toSeriesPoints({
      target: TARGET,
      records: [
        record({ amount: 60, isServiceTotal: true, tags: { team: "web" } }),
        record({ amount: 40, isServiceTotal: true }),
        record({ service: "Amazon S3", amount: 5, isServiceTotal: true }),
      ],
    });

    expect(points).toEqual([
      point({ amount: 100, isServiceTotal: true }),
      point({ service: "Amazon S3", amount: 5, isServiceTotal: true }),
    ]);
  });
});

describe("an account's summary says which tags its costs carry", () => {
  test("of the last 30 days, in its currency, the costliest first", () => {
    const summaries: Map<string, CloudAccountCostSummary> =
      CloudCostWriter.summarizePoints({
        cloudAccountIds: [ACCOUNT_ROW.toString()],
        now: NOW,
        points: [
          point({ amount: 50, tags: { team: "web", env: "prod" } }),
          point({ amount: 20, tags: { team: "data" } }),
          point({ day: "2026-10-01", amount: 900, tags: { owner: "ana" } }),
          point({ amount: 5, currency: "EUR", tags: { region: "eu" } }),
          point({ amount: 300 }),
        ],
      });

    expect(summaries.get(ACCOUNT_ROW.toString())!.tagKeys).toEqual([
      { key: "team", amount: 70 },
      { key: "env", amount: 50 },
    ]);
  });

  test("none carried: none said", () => {
    const summaries: Map<string, CloudAccountCostSummary> =
      CloudCostWriter.summarizePoints({
        cloudAccountIds: [ACCOUNT_ROW.toString()],
        now: NOW,
        points: [point({ amount: 50 })],
      });

    expect(summaries.get(ACCOUNT_ROW.toString())!.tagKeys).toBeUndefined();
  });
});

describe("a write with tags and whole-service figures", () => {
  let stored: Array<JSONObject> = [];
  let inserted: Array<Array<JSONObject>> = [];

  beforeEach(() => {
    stored = [];
    inserted = [];

    jest
      .spyOn(CloudCostService, "executeQuery")
      .mockImplementation(async (): Promise<never> => {
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

  test("an AWS day not read again keeps its resources: only the rest is written", async () => {
    stored = [
      storedRow(
        point({ resourceId: WEB_1, amount: 60, tags: { team: "web" } }),
      ),
      storedRow(point({ amount: 30 })),
    ];

    const result: CloudCostWriteResult = await CloudCostWriter.write({
      target: TARGET,
      window: WINDOW,
      records: [record({ amount: 95, isServiceTotal: true })],
      accountsRead: new Set(["123456789012"]),
      now: NOW,
    });

    expect(result.rowsWritten).toBe(1);
    expect(inserted[0]).toHaveLength(1);
    expect(inserted[0]![0]).toMatchObject({
      resourceId: "",
      cost: 5,
      tags: {},
    });
  });
});
