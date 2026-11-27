import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationResult,
  getCloudCostAllocationChange,
} from "./CloudCostAllocation";
import {
  CloudCostBreakdownComparison,
  CloudCostBreakdownResult,
  CloudCostComparedRest,
  CloudCostComparedShare,
  CloudCostDimension,
  CloudCostRest,
  CloudCostRestKind,
  CloudCostShare,
} from "./CloudCostBreakdowns";

/*
 * CLOUD COSTS AS CSV (#11009).
 *
 * Every breakdown on Costs, Savings and a cost group's pages downloads as
 * CSV, and the same files are what the API and the CLI answer with
 * `--csv`, and what a scheduled report attaches - so a file finance pulls
 * from a script is byte for byte the one the page gives. A CSV is read by
 * a program: the headers are fixed English names in snake case, figures
 * are plain numbers in the read's currency (named on every row, with the
 * cost basis), dates are UTC days, and nothing is formatted for a reader.
 *
 * Every text field is quoted, its quotes doubled, and one that starts as a
 * spreadsheet formula would ("=", "+", "-", "@", a tab or a return) starts
 * with an apostrophe instead, so a name a cloud or a person wrote never
 * runs as a formula in the spreadsheet it is opened in. A figure is a
 * figure: a credit's -60 is no formula.
 *
 * React-free and server-safe.
 */

// What starts a spreadsheet formula, which a CSV field must never.
const FORMULA_LEAD: RegExp = /^[=+\-@\t\r]/;

// A CSV field: quoted, its quotes doubled, a formula's lead character defused.
export function toCloudCostCsvField(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) {
    return '""';
  }

  const text: string = typeof value === "number" ? String(value) : value;
  // A figure is a figure: a credit's "-60" is no formula.
  const safe: string =
    typeof value === "string" && FORMULA_LEAD.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

// Rows as a CSV file: a line each, the last one ended too.
export function toCloudCostCsv(
  rows: Array<Array<string | number | null | undefined>>,
): string {
  return `${rows
    .map((row: Array<string | number | null | undefined>): string => {
      return row.map(toCloudCostCsvField).join(",");
    })
    .join("\n")}\n`;
}

// A figure as a CSV holds it: to the hundredth of a cent, never "-0".
export function toCloudCostCsvAmount(amount: number): number {
  const rounded: number = Math.round((Number(amount) || 0) * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/*
 * A change in percent, to one decimal - "" when there is nothing to
 * compare with.
 */
function toChangePercent(current: number, previous: number): string | number {
  const change: number | null = getCloudCostAllocationChange({
    current,
    previous,
  });

  return change === null ? "" : Math.round(change * 10) / 10;
}

/*
 * ---------------------------------------------------------------------------
 * A cost view's allocation: the month's chargeback
 * ---------------------------------------------------------------------------
 */

/*
 * A view's figures as a CSV: one row per group and bucket, then the
 * unallocated - what finance pulls the month's chargeback from. Figures in
 * the read's currency and on its cost basis (billed, amortized or net),
 * both said on each row, plain numbers (a CSV is read by a program).
 */
export function toCloudCostAllocationCsv(
  allocation: CloudCostAllocationResult,
): string {
  const basis: string = allocation.basis || "";
  const rows: Array<Array<string | number>> = [
    [
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
    ],
  ];

  for (const group of allocation.groups) {
    rows.push([
      group.name,
      group.id,
      allocation.start,
      allocation.currency,
      basis,
      group.total,
      group.cloud,
      group.lineItems,
      group.sharedIn,
      group.sharedOut,
    ]);
  }

  rows.push([
    "Unallocated",
    "",
    allocation.start,
    allocation.currency,
    basis,
    allocation.unallocated.total,
    allocation.unallocated.cloud,
    allocation.unallocated.lineItems,
    0,
    0,
  ]);

  return toCloudCostCsv(rows);
}

/*
 * ---------------------------------------------------------------------------
 * A breakdown: Costs' "Where the money goes"
 * ---------------------------------------------------------------------------
 */

// What each breakdown's first column is called.
export const CLOUD_COST_CSV_DIMENSION_COLUMNS: Readonly<
  Record<CloudCostDimension, string>
> = {
  service: "service",
  region: "region",
  cloudAccountId: "account",
  resourceId: "resource",
  environment: "environment",
  app: "app",
  tag: "tag_value",
  group: "cost_group",
};

// The rest of a breakdown's spend, as a row names it.
export const CLOUD_COST_CSV_REST_NAMES: Readonly<
  Record<CloudCostRestKind, string>
> = {
  "not-in-environment": "Not in an App Platforms environment",
  "not-one-app": "Billed to an environment as a whole",
  "without-tag": "Without the tag",
  "not-in-group": "Unallocated",
};

export interface CloudCostCsvContext {
  dimension: CloudCostDimension;
  // The first and last day read, "2026-11-01".
  start: string;
  lastDay: string;
  currency: string;
  // billed, amortized or net.
  basis?: string | undefined;
  // The tag broken down by, for a breakdown by tag.
  tagKey?: string | undefined;
  /*
   * Each share's name as the page shows it, by its key: an account's name,
   * a group's, an environment's. A key with none is written as its key.
   */
  names?: Map<string, string> | undefined;
}

/*
 * A breakdown as a CSV: one row per share, the costliest first, then a row
 * for each part of the rest (what is in no environment, what does not
 * carry the tag, what no group takes) with no key - the rows add up to the
 * period's spend, as the card's list and the lines under it do.
 */
export function toCloudCostBreakdownCsv(data: {
  breakdown: CloudCostBreakdownResult;
  context: CloudCostCsvContext;
}): string {
  const context: CloudCostCsvContext = data.context;
  const rows: Array<Array<string | number>> = [
    [
      CLOUD_COST_CSV_DIMENSION_COLUMNS[context.dimension],
      "key",
      ...(context.dimension === "tag" ? ["tag_key"] : []),
      "period_start",
      "period_end",
      "currency",
      "cost_basis",
      "amount",
    ],
  ];

  const row: (name: string, key: string, amount: number) => void = (
    name: string,
    key: string,
    amount: number,
  ): void => {
    rows.push([
      name,
      key,
      ...(context.dimension === "tag" ? [context.tagKey || ""] : []),
      context.start,
      context.lastDay,
      context.currency,
      context.basis || "",
      toCloudCostCsvAmount(amount),
    ]);
  };

  for (const share of data.breakdown.shares) {
    row(getShareName(share, context), share.key, share.amount);
  }

  for (const rest of data.breakdown.rest) {
    row(CLOUD_COST_CSV_REST_NAMES[rest.kind], "", rest.amount);
  }

  return toCloudCostCsv(rows);
}

/*
 * A breakdown against the period before as a CSV: what the API and the
 * CLI answer with --csv, and the attachment of a scheduled report. Each
 * row holds both periods' amounts and the change between them.
 */
export function toCloudCostComparisonCsv(data: {
  comparison: CloudCostBreakdownComparison;
  context: CloudCostCsvContext & {
    previousStart: string;
    previousLastDay: string;
  };
}): string {
  const context: CloudCostCsvContext & {
    previousStart: string;
    previousLastDay: string;
  } = data.context;
  const rows: Array<Array<string | number>> = [
    [
      CLOUD_COST_CSV_DIMENSION_COLUMNS[context.dimension],
      "key",
      ...(context.dimension === "tag" ? ["tag_key"] : []),
      "period_start",
      "period_end",
      "previous_period_start",
      "previous_period_end",
      "currency",
      "cost_basis",
      "amount",
      "previous_amount",
      "change_percent",
    ],
  ];

  const row: (
    name: string,
    key: string,
    amount: number,
    previousAmount: number,
  ) => void = (
    name: string,
    key: string,
    amount: number,
    previousAmount: number,
  ): void => {
    rows.push([
      name,
      key,
      ...(context.dimension === "tag" ? [context.tagKey || ""] : []),
      context.start,
      context.lastDay,
      context.previousStart,
      context.previousLastDay,
      context.currency,
      context.basis || "",
      toCloudCostCsvAmount(amount),
      toCloudCostCsvAmount(previousAmount),
      toChangePercent(amount, previousAmount),
    ]);
  };

  for (const share of data.comparison.shares as Array<CloudCostComparedShare>) {
    row(
      getShareName(share, context),
      share.key,
      share.amount,
      share.previousAmount,
    );
  }

  for (const rest of data.comparison.rest as Array<CloudCostComparedRest>) {
    row(
      CLOUD_COST_CSV_REST_NAMES[rest.kind],
      "",
      rest.amount,
      rest.previousAmount,
    );
  }

  return toCloudCostCsv(rows);
}

function getShareName(
  share: CloudCostShare,
  context: CloudCostCsvContext,
): string {
  const name: string | undefined = context.names?.get(share.key);

  if (name) {
    return name;
  }

  if (!share.key) {
    // A cost with no Region, no resource or no service name.
    return context.dimension === "region"
      ? "No Region"
      : context.dimension === "resourceId"
        ? "Not billed to a resource"
        : context.dimension === "service"
          ? "Unnamed service"
          : "";
  }

  return share.key;
}

// The names a cost view's groups go by, for a breakdown by group.
export function getCloudCostGroupNames(
  groups: Array<CloudCostAllocationGroupResult> | undefined,
): Map<string, string> {
  return new Map(
    (groups || []).map(
      (group: CloudCostAllocationGroupResult): [string, string] => {
        return [group.id, group.name];
      },
    ),
  );
}

/*
 * ---------------------------------------------------------------------------
 * A cost group's page
 * ---------------------------------------------------------------------------
 */

/*
 * A cost group's figures as its page shows them, in one CSV: its charge
 * day by day (or month by month), then the services, resources and
 * accounts it is charged for most - each row saying which list it is of.
 */
export function toCloudCostGroupSpendCsv(data: {
  group: CloudCostAllocationGroupResult;
  buckets: Array<string>;
  start: string;
  lastDay: string;
  currency: string;
  basis?: string | undefined;
  accountNames?: Map<string, string> | undefined;
}): string {
  const rows: Array<Array<string | number>> = [
    [
      "breakdown",
      "key",
      "name",
      "period_start",
      "period_end",
      "currency",
      "cost_basis",
      "amount",
    ],
  ];
  const row: (
    breakdown: string,
    key: string,
    name: string,
    amount: number,
  ) => void = (
    breakdown: string,
    key: string,
    name: string,
    amount: number,
  ): void => {
    rows.push([
      breakdown,
      key,
      name,
      data.start,
      data.lastDay,
      data.currency,
      data.basis || "",
      toCloudCostCsvAmount(amount),
    ]);
  };

  data.buckets.forEach((bucket: string, index: number): void => {
    row("day", bucket, bucket, data.group.series[index] || 0);
  });

  for (const share of data.group.topServices || []) {
    row("service", share.key, share.key || "Unnamed service", share.amount);
  }

  for (const share of data.group.topResources || []) {
    row(
      "resource",
      share.key,
      share.key || "Not billed to a resource",
      share.amount,
    );
  }

  for (const share of data.group.topAccounts || []) {
    row(
      "account",
      share.key,
      data.accountNames?.get(share.key) || share.key,
      share.amount,
    );
  }

  return toCloudCostCsv(rows);
}

/*
 * ---------------------------------------------------------------------------
 * Each day's spend
 * ---------------------------------------------------------------------------
 */

// Each day's spend as a CSV: a row a day, the days with none as 0.
export function toCloudCostDailyCsv(data: {
  points: Array<{ x: Date; y: number }>;
  currency: string;
  basis?: string | undefined;
}): string {
  return toCloudCostCsv([
    ["day", "currency", "cost_basis", "amount"],
    ...data.points.map(
      (point: { x: Date; y: number }): Array<string | number> => {
        return [
          point.x.toISOString().slice(0, 10),
          data.currency,
          data.basis || "",
          toCloudCostCsvAmount(point.y),
        ];
      },
    ),
  ]);
}

/*
 * ---------------------------------------------------------------------------
 * Savings waiting
 * ---------------------------------------------------------------------------
 */

// One saving as Cloud > Savings lists it (CloudCostRecommendation).
export interface CloudCostSavingCsvRow {
  // What to do, as the page words it.
  recommendation: string;
  kind: string;
  resourceName: string;
  resourceId: string;
  resourceType: string;
  account: string;
  provider: string;
  region: string;
  currentConfiguration: string;
  recommendedConfiguration: string;
  monthlySavings: number;
  monthlyCost: number | null;
  currency: string;
  source: string;
}

/*
 * The savings as a CSV: one row per saving, the largest first, with the
 * page's own columns - what to do, to which resource, what would change
 * and what it saves a month.
 */
export function toCloudCostSavingsCsv(
  rows: Array<CloudCostSavingCsvRow>,
): string {
  return toCloudCostCsv([
    [
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
    ],
    ...rows.map((row: CloudCostSavingCsvRow): Array<string | number> => {
      return [
        row.recommendation,
        row.kind,
        row.resourceName,
        row.resourceId,
        row.resourceType,
        row.account,
        row.provider,
        row.region,
        row.currentConfiguration,
        row.recommendedConfiguration,
        toCloudCostCsvAmount(row.monthlySavings),
        row.monthlyCost === null ? "" : toCloudCostCsvAmount(row.monthlyCost),
        row.currency,
        row.source,
      ];
    }),
  ]);
}

/*
 * ---------------------------------------------------------------------------
 * File names
 * ---------------------------------------------------------------------------
 *
 * A downloaded file says what is in it: what it is, how it is broken down
 * (with the tag or the cost view), the accounts it is over when not every
 * one, its days and its cost basis - "cloud-costs-by-service-amortized-
 * 2026-11-01-to-2026-11-30.csv" - so a folder of them reads as a list.
 */

// A part of a file name: letters, digits and dashes, at most 40 of them.
export function toCloudCostFileNamePart(value: string): string {
  return (value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function getCloudCostFileName(data: {
  // "cloud-costs", "cloud-daily-spend", "cloud-savings", "cloud-costs-focus-1.2".
  what: string;
  dimension?: CloudCostDimension | undefined;
  tagKey?: string | undefined;
  viewName?: string | undefined;
  // The account it is over, when it is over one.
  accountName?: string | undefined;
  basis?: string | undefined;
  start?: string | undefined;
  lastDay?: string | undefined;
  extension?: string | undefined;
}): string {
  const parts: Array<string> = [data.what];

  if (data.dimension) {
    parts.push(
      `by-${CLOUD_COST_CSV_DIMENSION_COLUMNS[data.dimension].replace(/_/g, "-")}`,
    );
  }

  if (data.dimension === "tag" && data.tagKey) {
    parts.push(toCloudCostFileNamePart(data.tagKey));
  }

  if (data.dimension === "group" && data.viewName) {
    parts.push(toCloudCostFileNamePart(data.viewName));
  }

  if (data.accountName) {
    parts.push(toCloudCostFileNamePart(data.accountName));
  }

  if (data.basis) {
    parts.push(toCloudCostFileNamePart(data.basis));
  }

  if (data.start && data.lastDay) {
    parts.push(
      data.start === data.lastDay
        ? data.start
        : `${data.start}-to-${data.lastDay}`,
    );
  }

  return `${parts
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join("-")}.${data.extension || "csv"}`;
}

// What a rest line says, for a CSV row's name.
export function getCloudCostRestName(rest: CloudCostRest): string {
  return CLOUD_COST_CSV_REST_NAMES[rest.kind];
}
