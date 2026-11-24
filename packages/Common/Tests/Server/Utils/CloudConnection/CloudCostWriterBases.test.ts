import CloudCostWriter, {
  CloudCostSeriesPoint,
  CloudCostWriteTarget,
  getCloudCostPointAmount,
} from "../../../../Server/Utils/CloudConnection/CloudCostWriter";
import { CloudCostRecord } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { CloudAccountCostSummary } from "../../../../Types/Cloud/CloudCost";
import {
  CLOUD_COST_BASES,
  CloudCostBasis,
} from "../../../../Types/Cloud/CloudCostBasis";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The writer on every basis (#11007): billed, amortized and net are each
 * kept by the same difference-append, so a day read ten times sums to the
 * cloud's latest figure on all three - and a read that brought only some
 * bases (an Azure subscription between its daily reads of actual cost)
 * leaves the others as they are. The real ClickHouse runs the same in
 * CloudCostWriterClickhouseIntegration.
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
    amortizedAmount: 10,
    netAmount: 10,
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

// A series' sum on each basis over what is stored.
function sumOf(
  stored: Array<CloudCostSeriesPoint>,
  basis: CloudCostBasis,
  where: Partial<CloudCostSeriesPoint> = {},
): number {
  return stored
    .filter((entry: CloudCostSeriesPoint): boolean => {
      return Object.entries(where).every(([key, value]: [string, unknown]) => {
        return (entry as unknown as Record<string, unknown>)[key] === value;
      });
    })
    .reduce((sum: number, entry: CloudCostSeriesPoint): number => {
      return sum + getCloudCostPointAmount(entry, basis);
    }, 0);
}

describe("a point's figure on each basis", () => {
  test("its own where it has one, its billed figure where it has none", () => {
    const withAll: CloudCostSeriesPoint = point({
      amount: 0,
      amortizedAmount: 12,
      netAmount: -3,
    });

    expect(getCloudCostPointAmount(withAll, CloudCostBasis.Billed)).toBe(0);
    expect(getCloudCostPointAmount(withAll, CloudCostBasis.Amortized)).toBe(12);
    expect(getCloudCostPointAmount(withAll, CloudCostBasis.Net)).toBe(-3);

    const billedOnly: CloudCostSeriesPoint = point({
      amount: 7,
      amortizedAmount: undefined,
      netAmount: undefined,
    });

    expect(getCloudCostPointAmount(billedOnly, CloudCostBasis.Amortized)).toBe(
      7,
    );
    expect(getCloudCostPointAmount(billedOnly, CloudCostBasis.Net)).toBe(7);
    expect(
      getCloudCostPointAmount(
        point({ amount: 7, amortizedAmount: Number.NaN }),
        CloudCostBasis.Amortized,
      ),
    ).toBe(7);
  });
});

describe("the cloud's records as points", () => {
  test("records of one series add up on every basis; a record with none of its own counts billed on each", () => {
    const { points } = CloudCostWriter.toSeriesPoints({
      target: TARGET,
      records: [
        record({ amount: 0, amortizedAmount: 4, netAmount: 3 }),
        record({ amount: 5, amortizedAmount: 2, netAmount: 1 }),
        // A cost with no amortized or net figure of its own: the same on each.
        record({ amount: 1 }),
      ],
    });

    expect(points).toHaveLength(1);
    expect(points[0]!.amount).toBe(6);
    expect(points[0]!.amortizedAmount).toBe(7);
    expect(points[0]!.netAmount).toBe(5);
  });
});

describe("the differences on each basis", () => {
  test("a first read writes all three", () => {
    expect(
      CloudCostWriter.computeDeltas({
        desired: [point({ amount: 0, amortizedAmount: 24, netAmount: 20 })],
        stored: [],
        window: WINDOW,
      }),
    ).toEqual([point({ amount: 0, amortizedAmount: 24, netAmount: 20 })]);
  });

  test("only the bases that changed carry a difference; the others are written as nothing", () => {
    expect(
      CloudCostWriter.computeDeltas({
        desired: [point({ amount: 10, amortizedAmount: 14, netAmount: 9 })],
        stored: [point({ amount: 10, amortizedAmount: 12, netAmount: 9 })],
        window: WINDOW,
      }),
    ).toEqual([point({ amount: 0, amortizedAmount: 2, netAmount: 0 })]);
  });

  test("a series no basis changed writes no row", () => {
    expect(
      CloudCostWriter.computeDeltas({
        desired: [point({ amount: 0.1 + 0.2, amortizedAmount: 5, netAmount: 4 })],
        stored: [point({ amount: 0.3, amortizedAmount: 5, netAmount: 4 })],
        window: WINDOW,
      }),
    ).toEqual([]);
  });

  test("a row stored before the bases - its amortized and net its billed - is brought in line", () => {
    // What the column's DEFAULT reads for a row written before amortizedCost.
    const old: CloudCostSeriesPoint = point({
      amount: 8760,
      amortizedAmount: 8760,
      netAmount: 8760,
      service: "Savings Plans for AWS Compute usage",
    });

    expect(
      CloudCostWriter.computeDeltas({
        desired: [
          point({
            service: "Savings Plans for AWS Compute usage",
            amount: 8760,
            amortizedAmount: 0,
            netAmount: 0,
          }),
        ],
        stored: [old],
        window: WINDOW,
      }),
    ).toEqual([
      point({
        service: "Savings Plans for AWS Compute usage",
        amount: 0,
        amortizedAmount: -8760,
        netAmount: -8760,
      }),
    ]);
  });

  test("a series the cloud no longer reports is cancelled on every basis", () => {
    expect(
      CloudCostWriter.computeDeltas({
        desired: [],
        stored: [point({ amount: 3, amortizedAmount: 4, netAmount: -1 })],
        window: WINDOW,
      }),
    ).toEqual([point({ amount: -3, amortizedAmount: -4, netAmount: 1 })]);
  });

  test("a credit only the net read sees is a series of its own, nothing billed or amortized", () => {
    expect(
      CloudCostWriter.computeDeltas({
        desired: [
          point({
            service: "AWS Support (Business)",
            amount: 0,
            amortizedAmount: 0,
            netAmount: -250,
          }),
        ],
        stored: [],
        window: WINDOW,
      }),
    ).toEqual([
      point({
        service: "AWS Support (Business)",
        amount: 0,
        amortizedAmount: 0,
        netAmount: -250,
      }),
    ]);
  });
});

describe("a read that brought only some bases", () => {
  test("keeps the billed figure stored when only amortized and net were read", () => {
    const deltas: Array<CloudCostSeriesPoint> = CloudCostWriter.computeDeltas({
      // The billed figure is nothing: the read did not bring it.
      desired: [point({ amount: 0, amortizedAmount: 11, netAmount: 11 })],
      stored: [point({ amount: 10, amortizedAmount: 10, netAmount: 10 })],
      window: WINDOW,
      bases: [CloudCostBasis.Amortized, CloudCostBasis.Net],
    });

    expect(deltas).toEqual([
      point({ amount: 0, amortizedAmount: 1, netAmount: 1 }),
    ]);
  });

  test("a series gone from the amortized read is cancelled there only", () => {
    const deltas: Array<CloudCostSeriesPoint> = CloudCostWriter.computeDeltas({
      desired: [],
      stored: [point({ amount: 10, amortizedAmount: 6, netAmount: 6 })],
      window: WINDOW,
      bases: [CloudCostBasis.Amortized, CloudCostBasis.Net],
    });

    expect(deltas).toEqual([
      point({ amount: 0, amortizedAmount: -6, netAmount: -6 }),
    ]);
  });

  test("nothing changes where the read's bases already match, whatever the others say", () => {
    expect(
      CloudCostWriter.computeDeltas({
        desired: [point({ amount: 999, amortizedAmount: 6, netAmount: 6 })],
        stored: [point({ amount: 10, amortizedAmount: 6, netAmount: 6 })],
        window: WINDOW,
        bases: [CloudCostBasis.Amortized, CloudCostBasis.Net],
      }),
    ).toEqual([]);
  });
});

describe("a whole-service figure on each basis", () => {
  test("its resources stay, and the rest takes up each basis's difference", () => {
    const deltas: Array<CloudCostSeriesPoint> = CloudCostWriter.computeDeltas({
      desired: [
        point({
          amount: 100,
          amortizedAmount: 140,
          netAmount: 120,
          isServiceTotal: true,
        }),
      ],
      stored: [
        point({
          resourceId: "i-0abc",
          amount: 60,
          amortizedAmount: 90,
          netAmount: 85,
        }),
        point({ amount: 30, amortizedAmount: 40, netAmount: 40 }),
      ],
      window: WINDOW,
    });

    expect(deltas).toEqual([
      point({ amount: 10, amortizedAmount: 10, netAmount: -5 }),
    ]);
  });
});

/*
 * A day read ten times: today grows, a cloud corrects yesterday, a series
 * comes and goes, and amortized and net move apart from billed - after each
 * read, every series' stored sum is the cloud's latest figure, on every
 * basis.
 */
describe("a day read ten times", () => {
  test("sums to the cloud's latest figure on all three bases after every read", () => {
    let stored: Array<CloudCostSeriesPoint> = [];
    const reads: Array<Array<CloudCostSeriesPoint>> = [];

    for (let read: number = 1; read <= 10; read++) {
      reads.push([
        point({
          amount: read * 3,
          amortizedAmount: 50 + read * 2,
          netAmount: 40 + read,
        }),
        // A Savings Plan's fee: billed once, spread when amortized.
        point({
          service: "Savings Plans for AWS Compute usage",
          amount: read >= 2 ? 8760 : 0,
          amortizedAmount: read >= 2 ? 24 : 0,
          netAmount: read >= 2 ? 24 : 0,
        }),
        // A credit the net read sees from the fifth read on, then corrected.
        ...(read >= 5
          ? [
              point({
                service: "Credits",
                amount: 0,
                amortizedAmount: 0,
                netAmount: read === 5 ? -100 : -80,
              }),
            ]
          : []),
        // A series reported for three reads only.
        ...(read >= 3 && read <= 5
          ? [point({ service: "Amazon S3", amount: 1, amortizedAmount: 1, netAmount: 1 })]
          : []),
      ]);
    }

    for (const desired of reads) {
      const deltas: Array<CloudCostSeriesPoint> = CloudCostWriter.computeDeltas(
        { desired, stored, window: WINDOW },
      );
      stored = [...stored, ...deltas];

      for (const basis of CLOUD_COST_BASES) {
        for (const series of [
          "Amazon EC2",
          "Savings Plans for AWS Compute usage",
          "Credits",
          "Amazon S3",
        ]) {
          const want: number = desired
            .filter((entry: CloudCostSeriesPoint): boolean => {
              return entry.service === series;
            })
            .reduce((sum: number, entry: CloudCostSeriesPoint): number => {
              return sum + getCloudCostPointAmount(entry, basis);
            }, 0);

          expect(sumOf(stored, basis, { service: series })).toBeCloseTo(
            want,
            6,
          );
        }
      }
    }

    // And a read once more with nothing new writes nothing.
    expect(
      CloudCostWriter.computeDeltas({
        desired: reads[reads.length - 1]!,
        stored,
        window: WINDOW,
      }),
    ).toEqual([]);
  });

  test("reads that alternate between every basis and amortized alone keep billed as the last read of it said", () => {
    let stored: Array<CloudCostSeriesPoint> = [];

    for (let read: number = 1; read <= 10; read++) {
      const isBilledRead: boolean = read % 2 === 1;
      const desired: Array<CloudCostSeriesPoint> = [
        point({
          amount: isBilledRead ? read * 10 : 0,
          amortizedAmount: read * 7,
          netAmount: read * 7,
        }),
      ];

      stored = [
        ...stored,
        ...CloudCostWriter.computeDeltas({
          desired,
          stored,
          window: WINDOW,
          bases: isBilledRead
            ? undefined
            : [CloudCostBasis.Amortized, CloudCostBasis.Net],
        }),
      ];

      // Billed: the last read that brought it.
      const lastBilledRead: number = isBilledRead ? read : read - 1;
      expect(sumOf(stored, CloudCostBasis.Billed)).toBeCloseTo(
        lastBilledRead * 10,
        6,
      );
      expect(sumOf(stored, CloudCostBasis.Amortized)).toBeCloseTo(read * 7, 6);
      expect(sumOf(stored, CloudCostBasis.Net)).toBeCloseTo(read * 7, 6);
    }
  });
});

describe("the stored sums and the rows written", () => {
  test("the stored-sums query sums every basis's column", () => {
    const statement: Statement = CloudCostWriter.buildStoredSumsStatement({
      projectId: PROJECT,
      cloudAccountIds: [ACCOUNT_ROW.toString()],
      window: WINDOW,
    });

    expect(statement.query).toContain("sum(cost) AS total");
    expect(statement.query).toContain("sum(amortizedCost) AS amortizedTotal");
    expect(statement.query).toContain("sum(netCost) AS netTotal");
  });

  test("stored sums are read back on every basis, a missing one as billed", () => {
    const rows: Array<JSONObject> = [
      {
        accountRowId: ACCOUNT_ROW.toString(),
        cloudAccountName: "123456789012",
        dayText: "2026-11-19",
        serviceName: "Amazon EC2",
        regionName: "us-east-1",
        resourceKey: "",
        currencyCode: "USD",
        tagMap: {},
        total: "10",
        amortizedTotal: "14.5",
        netTotal: "-2",
      },
      {
        accountRowId: ACCOUNT_ROW.toString(),
        cloudAccountName: "123456789012",
        dayText: "2026-11-18",
        serviceName: "Amazon S3",
        regionName: "",
        resourceKey: "",
        currencyCode: "USD",
        tagMap: {},
        total: "3",
      },
    ];

    const points: Array<CloudCostSeriesPoint> =
      CloudCostWriter.readStoredSums(rows);

    expect(points[0]!.amount).toBe(10);
    expect(points[0]!.amortizedAmount).toBe(14.5);
    expect(points[0]!.netAmount).toBe(-2);
    expect(points[1]!.amortizedAmount).toBe(3);
    expect(points[1]!.netAmount).toBe(3);
  });

  test("each row carries its difference on every basis", () => {
    const rows: Array<JSONObject> = CloudCostWriter.buildRows({
      target: TARGET,
      deltas: [
        point({ amount: 0, amortizedAmount: 2.5, netAmount: -1 }),
        // A difference with no basis of its own writes its billed one on each.
        point({ amount: 4, amortizedAmount: undefined, netAmount: undefined }),
      ],
      now: NOW,
    });

    expect(rows[0]).toMatchObject({ cost: 0, amortizedCost: 2.5, netCost: -1 });
    expect(rows[1]).toMatchObject({ cost: 4, amortizedCost: 4, netCost: 4 });
  });
});

describe("an account's summary on each basis", () => {
  test("a Savings Plan bought all upfront spikes the billed month and not the amortized one", () => {
    const points: Array<CloudCostSeriesPoint> = [];

    // Fourteen ordinary days, then the purchase on Nov 17.
    for (let day: number = 1; day <= 19; day++) {
      const text: string = `2026-11-${String(day).padStart(2, "0")}`;

      points.push(
        point({
          day: text,
          service: "Amazon EC2",
          // Covered by the plan from the 17th: billed nothing, amortized its share.
          amount: day >= 17 ? 0 : 30,
          amortizedAmount: day >= 17 ? 22 : 30,
          netAmount: day >= 17 ? 22 : 28,
        }),
      );
    }

    points.push(
      point({
        day: "2026-11-17",
        service: "Savings Plans for AWS Compute usage",
        amount: 8760,
        amortizedAmount: 2,
        netAmount: 2,
      }),
    );

    const summary: CloudAccountCostSummary = CloudCostWriter.summarizePoints({
      points,
      cloudAccountIds: [ACCOUNT_ROW.toString()],
      now: NOW,
    }).get(ACCOUNT_ROW.toString())!;

    // Billed: sixteen days of usage, the fee, and nothing for the covered days.
    expect(summary.monthToDate).toBeCloseTo(16 * 30 + 8760, 4);
    expect(summary.bases!.amortized!.monthToDate).toBeCloseTo(
      16 * 30 + 3 * 22 + 2,
      4,
    );
    expect(summary.bases!.net!.monthToDate).toBeCloseTo(16 * 28 + 3 * 22 + 2, 4);
    // The billed fee is an unusual day; amortized, there is none.
    expect(
      (summary.anomalies || []).some(
        (anomaly: { day: string }): boolean => {
          return anomaly.day === "2026-11-17";
        },
      ),
    ).toBe(true);
    expect(summary.bases!.amortized!.anomalies).toBeUndefined();
    // What cost the most this month, on each basis.
    expect(summary.topServices[0]!.service).toBe(
      "Savings Plans for AWS Compute usage",
    );
    expect(summary.bases!.amortized!.topServices[0]!.service).toBe(
      "Amazon EC2",
    );
  });

  test("an account in two currencies is summed in the one most of its billed cost is in, on every basis", () => {
    const summary: CloudAccountCostSummary = CloudCostWriter.summarizePoints({
      points: [
        point({ amount: 100, amortizedAmount: 90, netAmount: 80 }),
        point({
          currency: "EUR",
          service: "Amazon S3",
          amount: 5,
          amortizedAmount: 500,
          netAmount: 500,
        }),
      ],
      cloudAccountIds: [ACCOUNT_ROW.toString()],
      now: NOW,
    }).get(ACCOUNT_ROW.toString())!;

    expect(summary.currency).toBe("USD");
    expect(summary.bases!.amortized!.monthToDate).toBe(90);
    expect(summary.bases!.net!.monthToDate).toBe(80);
  });
});
