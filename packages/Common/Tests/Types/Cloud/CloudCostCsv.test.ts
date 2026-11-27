import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationResult,
} from "../../../Types/Cloud/CloudCostAllocation";
import { CloudCostBasis } from "../../../Types/Cloud/CloudCostBasis";
import {
  CLOUD_COST_CSV_DIMENSION_COLUMNS,
  CLOUD_COST_CSV_REST_NAMES,
  getCloudCostFileName,
  getCloudCostGroupNames,
  getCloudCostRestName,
  toCloudCostAllocationCsv,
  toCloudCostBreakdownCsv,
  toCloudCostComparisonCsv,
  toCloudCostCsv,
  toCloudCostCsvAmount,
  toCloudCostCsvField,
  toCloudCostDailyCsv,
  toCloudCostFileNamePart,
  toCloudCostGroupSpendCsv,
  toCloudCostSavingsCsv,
} from "../../../Types/Cloud/CloudCostCsv";
import { CLOUD_COST_DIMENSIONS } from "../../../Types/Cloud/CloudCostBreakdowns";
import { describe, expect, test } from "@jest/globals";

/*
 * THE CSV DOWNLOADS (#11009): every breakdown on Costs, Savings and a cost
 * group's page, the API's format "csv" and a report's attachment - each
 * file's columns, its rows in the page's order, its figures and its name.
 */

// The file as a spreadsheet reads it: rows of fields, quotes undone.
function readCsv(text: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];
  let row: Array<string> = [];
  let field: string = "";
  let isQuoted: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const char: string = text.charAt(index);

    if (isQuoted) {
      if (char === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        isQuoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      isQuoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  return rows;
}

function group(
  overrides: Partial<CloudCostAllocationGroupResult>,
): CloudCostAllocationGroupResult {
  return {
    id: "g-1",
    name: "Payments",
    isShared: false,
    total: 0,
    cloud: 0,
    lineItems: 0,
    sharedIn: 0,
    sharedOut: 0,
    series: [],
    ...overrides,
  } as CloudCostAllocationGroupResult;
}

describe("a CSV field", () => {
  test("is quoted, its quotes doubled, and a text never starts a formula", () => {
    expect(toCloudCostCsvField("Amazon EC2")).toBe('"Amazon EC2"');
    expect(toCloudCostCsvField('a "b" c')).toBe('"a ""b"" c"');
    expect(toCloudCostCsvField("=HYPERLINK(1)")).toBe('"\'=HYPERLINK(1)"');
    expect(toCloudCostCsvField("+1")).toBe('"\'+1"');
    expect(toCloudCostCsvField("-cmd")).toBe('"\'-cmd"');
    expect(toCloudCostCsvField("@SUM")).toBe('"\'@SUM"');
    expect(toCloudCostCsvField(null)).toBe('""');
    expect(toCloudCostCsvField(undefined)).toBe('""');
  });

  test("a figure is a figure: a credit's minus is kept", () => {
    expect(toCloudCostCsvField(-60)).toBe('"-60"');
    expect(toCloudCostCsvField(12.5)).toBe('"12.5"');
  });

  test("every line ends, the last one too", () => {
    expect(
      toCloudCostCsv([
        ["a", 1],
        ["b", 2],
      ]),
    ).toBe('"a","1"\n"b","2"\n');
  });

  test("an amount keeps four places and is never -0", () => {
    expect(toCloudCostCsvAmount(0.1 + 0.2)).toBe(0.3);
    expect(toCloudCostCsvAmount(12.345678)).toBe(12.3457);
    expect(Object.is(toCloudCostCsvAmount(-0.00001), 0)).toBe(true);
    expect(toCloudCostCsvAmount(Number.NaN)).toBe(0);
  });
});

describe("a breakdown as CSV", () => {
  const context: {
    start: string;
    lastDay: string;
    currency: string;
    basis: string;
  } = {
    start: "2026-11-01",
    lastDay: "2026-11-30",
    currency: "USD",
    basis: CloudCostBasis.Amortized,
  };

  test("by service: a row a share, the costliest first, then what it leaves out", () => {
    const rows: Array<Array<string>> = readCsv(
      toCloudCostBreakdownCsv({
        breakdown: {
          shares: [
            { key: "Amazon EC2", amount: 420.123456 },
            { key: "", amount: 3 },
          ],
          rest: [],
          total: 423.123456,
        },
        context: { ...context, dimension: "service" },
      }),
    );

    expect(rows).toEqual([
      [
        "service",
        "key",
        "period_start",
        "period_end",
        "currency",
        "cost_basis",
        "amount",
      ],
      [
        "Amazon EC2",
        "Amazon EC2",
        "2026-11-01",
        "2026-11-30",
        "USD",
        "amortized",
        "420.1235",
      ],
      // A cost with no service name, worded as the page words it.
      [
        "Unnamed service",
        "",
        "2026-11-01",
        "2026-11-30",
        "USD",
        "amortized",
        "3",
      ],
    ]);
  });

  test("by account: each account by the name the page shows, its ID beside it", () => {
    const rows: Array<Array<string>> = readCsv(
      toCloudCostBreakdownCsv({
        breakdown: {
          shares: [
            { key: "acc-1", amount: 10 },
            { key: "acc-gone", amount: 2 },
          ],
          rest: [],
          total: 12,
        },
        context: {
          ...context,
          dimension: "cloudAccountId",
          names: new Map([["acc-1", "Production AWS"]]),
        },
      }),
    );

    expect(rows[0]![0]).toBe("account");
    expect(rows[1]!.slice(0, 2)).toEqual(["Production AWS", "acc-1"]);
    expect(rows[2]!.slice(0, 2)).toEqual(["acc-gone", "acc-gone"]);
  });

  test("by tag: the tag's key in a column of its own, and what carries no value said last", () => {
    const rows: Array<Array<string>> = readCsv(
      toCloudCostBreakdownCsv({
        breakdown: {
          shares: [{ key: "payments", amount: 420 }],
          rest: [{ kind: "without-tag", amount: 1110 }],
          total: 1530,
        },
        context: { ...context, dimension: "tag", tagKey: "team" },
      }),
    );

    expect(rows[0]).toEqual([
      "tag_value",
      "key",
      "tag_key",
      "period_start",
      "period_end",
      "currency",
      "cost_basis",
      "amount",
    ]);
    expect(rows[1]).toEqual([
      "payments",
      "payments",
      "team",
      "2026-11-01",
      "2026-11-30",
      "USD",
      "amortized",
      "420",
    ]);
    expect(rows[2]!.slice(0, 3)).toEqual(["Without the tag", "", "team"]);
    expect(rows[2]![7]).toBe("1110");
  });

  test("by Region and by resource: the costs billed to none are named, not blank", () => {
    const region: Array<Array<string>> = readCsv(
      toCloudCostBreakdownCsv({
        breakdown: { shares: [{ key: "", amount: 1 }], rest: [], total: 1 },
        context: { ...context, dimension: "region" },
      }),
    );
    const resource: Array<Array<string>> = readCsv(
      toCloudCostBreakdownCsv({
        breakdown: { shares: [{ key: "", amount: 1 }], rest: [], total: 1 },
        context: { ...context, dimension: "resourceId" },
      }),
    );

    expect(region[1]![0]).toBe("No Region");
    expect(resource[1]![0]).toBe("Not billed to a resource");
  });

  test("every breakdown names its first column", () => {
    for (const dimension of CLOUD_COST_DIMENSIONS) {
      expect(CLOUD_COST_CSV_DIMENSION_COLUMNS[dimension]).toMatch(/^[a-z_]+$/);
    }
  });

  test("every rest of a breakdown has its words", () => {
    expect(getCloudCostRestName({ kind: "not-in-group", amount: 1 })).toBe(
      "Unallocated",
    );

    for (const words of Object.values(CLOUD_COST_CSV_REST_NAMES)) {
      expect(words.length).toBeGreaterThan(0);
    }
  });

  test("against the period before: both periods' days and amounts, and the change in percent", () => {
    const rows: Array<Array<string>> = readCsv(
      toCloudCostComparisonCsv({
        comparison: {
          shares: [
            { key: "Amazon EC2", amount: 300, previousAmount: 200 },
            { key: "Amazon S3", amount: 50, previousAmount: 100 },
            { key: "Amazon Bedrock", amount: 25, previousAmount: 0 },
          ],
          rest: [{ kind: "not-in-group", amount: 10, previousAmount: 10 }],
          total: 385,
          previousTotal: 310,
        },
        context: {
          ...context,
          dimension: "service",
          previousStart: "2026-10-01",
          previousLastDay: "2026-10-31",
        },
      }),
    );

    expect(rows[0]).toEqual([
      "service",
      "key",
      "period_start",
      "period_end",
      "previous_period_start",
      "previous_period_end",
      "currency",
      "cost_basis",
      "amount",
      "previous_amount",
      "change_percent",
    ]);
    expect(rows[1]).toEqual([
      "Amazon EC2",
      "Amazon EC2",
      "2026-11-01",
      "2026-11-30",
      "2026-10-01",
      "2026-10-31",
      "USD",
      "amortized",
      "300",
      "200",
      "50",
    ]);
    expect(rows[2]![10]).toBe("-50");
    // Nothing before: no percentage, rather than an infinite one.
    expect(rows[3]![10]).toBe("");
    expect(rows[4]!.slice(0, 2)).toEqual(["Unallocated", ""]);
    expect(rows[4]![10]).toBe("0");
  });
});

describe("a cost view's groups as CSV", () => {
  const allocation: CloudCostAllocationResult = {
    viewId: "view-1",
    viewName: "By team",
    start: "2026-11-01",
    currency: "USD",
    basis: CloudCostBasis.Billed,
    total: 1530,
    buckets: ["2026-11-01"],
    groups: [
      group({
        id: "g-pay",
        name: "Payments",
        total: 420,
        cloud: 400,
        lineItems: 20,
        sharedIn: 30,
        sharedOut: 0,
      }),
      group({
        id: "g-data",
        name: "Data, EU",
        total: 150,
        cloud: 150,
      }),
    ],
    unallocated: {
      total: 960,
      cloud: 950,
      lineItems: 10,
      series: [],
    },
  } as unknown as CloudCostAllocationResult;

  test("a row a group, with where its spend came from, then what no group takes", () => {
    const rows: Array<Array<string>> = readCsv(
      toCloudCostAllocationCsv(allocation),
    );

    expect(rows[0]).toEqual([
      "group",
      "group_id",
      "period_start",
      "currency",
      "cost_basis",
      "total",
      "cloud",
      "line_items",
      "shared_in",
      "shared_out",
    ]);
    expect(rows[1]).toEqual([
      "Payments",
      "g-pay",
      "2026-11-01",
      "USD",
      "billed",
      "420",
      "400",
      "20",
      "30",
      "0",
    ]);
    expect(rows[2]![0]).toBe("Data, EU");
    expect(rows[3]).toEqual([
      "Unallocated",
      "",
      "2026-11-01",
      "USD",
      "billed",
      "960",
      "950",
      "10",
      "0",
      "0",
    ]);
  });

  test("the groups' names by their IDs", () => {
    expect(getCloudCostGroupNames(allocation.groups)).toEqual(
      new Map([
        ["g-pay", "Payments"],
        ["g-data", "Data, EU"],
      ]),
    );
    expect(getCloudCostGroupNames(undefined).size).toBe(0);
  });
});

describe("a cost group's page as CSV", () => {
  test("each day, then its top services, resources and accounts", () => {
    const rows: Array<Array<string>> = readCsv(
      toCloudCostGroupSpendCsv({
        group: group({
          series: [10, 0, 12.5],
          topServices: [
            { key: "Amazon EC2", amount: 20 },
            { key: "", amount: 2.5 },
          ],
          topResources: [{ key: "i-0pay", amount: 15 }],
          topAccounts: [{ key: "acc-1", amount: 22.5 }],
        } as Partial<CloudCostAllocationGroupResult>),
        buckets: ["2026-11-01", "2026-11-02", "2026-11-03"],
        start: "2026-11-01",
        lastDay: "2026-11-03",
        currency: "EUR",
        basis: "net",
        accountNames: new Map([["acc-1", "Shop EU"]]),
      }),
    );

    expect(rows[0]).toEqual([
      "breakdown",
      "key",
      "name",
      "period_start",
      "period_end",
      "currency",
      "cost_basis",
      "amount",
    ]);
    expect(
      rows.slice(1).map((row: Array<string>): Array<string> => {
        return [row[0]!, row[1]!, row[2]!, row[7]!];
      }),
    ).toEqual([
      ["day", "2026-11-01", "2026-11-01", "10"],
      ["day", "2026-11-02", "2026-11-02", "0"],
      ["day", "2026-11-03", "2026-11-03", "12.5"],
      ["service", "Amazon EC2", "Amazon EC2", "20"],
      ["service", "", "Unnamed service", "2.5"],
      ["resource", "i-0pay", "i-0pay", "15"],
      ["account", "acc-1", "Shop EU", "22.5"],
    ]);
  });
});

describe("each day's spend as CSV", () => {
  test("a row a UTC day, the days with none as 0", () => {
    expect(
      readCsv(
        toCloudCostDailyCsv({
          points: [
            { x: new Date("2026-11-01T00:00:00Z"), y: 5 },
            { x: new Date("2026-11-02T00:00:00Z"), y: 0 },
          ],
          currency: "USD",
          basis: "billed",
        }),
      ),
    ).toEqual([
      ["day", "currency", "cost_basis", "amount"],
      ["2026-11-01", "USD", "billed", "5"],
      ["2026-11-02", "USD", "billed", "0"],
    ]);
  });
});

describe("Savings as CSV", () => {
  test("every recommendation the page lists, a monthly cost left empty where none is known", () => {
    const rows: Array<Array<string>> = readCsv(
      toCloudCostSavingsCsv([
        {
          recommendation: "Stop the idle instance",
          kind: "idle",
          resourceName: "=cmd|' /C calc'!A0",
          resourceId: "i-0idle",
          resourceType: "EC2 instance",
          account: "Production AWS",
          provider: "aws",
          region: "us-east-1",
          currentConfiguration: "m5.large",
          recommendedConfiguration: "",
          monthlySavings: 69.12345,
          monthlyCost: null,
          currency: "USD",
          source: "AWS Cost Optimization Hub",
        },
      ]),
    );

    expect(rows[0]).toEqual([
      "recommendation",
      "kind",
      "resource",
      "resource_id",
      "resource_type",
      "account",
      "cloud",
      "region",
      "current",
      "recommended",
      "monthly_savings",
      "monthly_cost",
      "currency",
      "source",
    ]);
    // A resource named like a formula is written as text.
    expect(rows[1]![2]).toBe("'=cmd|' /C calc'!A0");
    expect(rows[1]![10]).toBe("69.1235");
    expect(rows[1]![11]).toBe("");
  });
});

describe("a download's file name", () => {
  test("says what it is, by what, the view, the account, the basis and the days", () => {
    expect(
      getCloudCostFileName({
        what: "cloud-costs",
        dimension: "group",
        viewName: "By team",
        basis: "amortized",
        start: "2026-11-01",
        lastDay: "2026-11-30",
      }),
    ).toBe(
      "cloud-costs-by-cost-group-by-team-amortized-2026-11-01-to-2026-11-30.csv",
    );
    expect(
      getCloudCostFileName({
        what: "cloud-costs",
        dimension: "tag",
        tagKey: "Team Name",
        accountName: "Production AWS",
        basis: "net",
        start: "2026-11-02",
        lastDay: "2026-11-02",
      }),
    ).toBe(
      "cloud-costs-by-tag-value-team-name-production-aws-net-2026-11-02.csv",
    );
    expect(
      getCloudCostFileName({
        what: "cloud-costs-focus-1.2",
        start: "2026-10-01",
        lastDay: "2026-10-31",
      }),
    ).toBe("cloud-costs-focus-1.2-2026-10-01-to-2026-10-31.csv");
  });

  test("a part is letters, digits and dashes, accents dropped, at most 40 long", () => {
    expect(toCloudCostFileNamePart("Équipe Données / Prod")).toBe(
      "equipe-donnees-prod",
    );
    expect(toCloudCostFileNamePart("../../etc/passwd")).toBe("etc-passwd");
    expect(toCloudCostFileNamePart("a".repeat(60))).toHaveLength(40);
    expect(toCloudCostFileNamePart(`${"a".repeat(39)} b`)).toBe("a".repeat(39));
    // A name in another script is left out rather than mangled.
    expect(toCloudCostFileNamePart("コスト")).toBe("");
    expect(
      getCloudCostFileName({
        what: "cloud-costs",
        dimension: "group",
        viewName: "コスト",
        start: "2026-11-01",
        lastDay: "2026-11-30",
      }),
    ).toBe("cloud-costs-by-cost-group-2026-11-01-to-2026-11-30.csv");
  });
});
