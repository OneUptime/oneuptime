import {
  CloudTagCoverageCount,
  CloudTagProblem,
  CloudTagSuggestion,
  CloudTagSuggestionSource,
} from "./CloudRequiredTags";

/*
 * WHAT CLOUD > TAGS AND AN ACCOUNT'S TAGS READ (#11012): how much of each
 * account's spend and resources carry its required tags, the trend of
 * both, and the resources that lack one - the costliest first, each with
 * the value OneUptime suggests and the command that applies it.
 *
 * One read, by the server (CloudTagCoverageReader), as the reader may read
 * the accounts: these are its wire shapes, and the Dashboard reads them
 * back with care (readCloudTagCoverage).
 *
 *   - Spend: the last 30 days of each account's costs, by the tags each
 *     cost was read with - worked out when read, so a changed rule
 *     restates the past. AWS costs carry tags only with Costs per
 *     resource on: such an account's spend is "not measured", never 0%.
 *   - Resources: every resource the account's connection lists, by the
 *     tags it carries now.
 *   - The trend: each of the last 12 weeks, spend by the costs and
 *     resources by the count OneUptime keeps each day.
 */

// POST /cloud-required-tag/coverage, with { cloudAccountId } for one account.
export const CLOUD_TAG_COVERAGE_ROUTE: string = "coverage";

// The days spend coverage is measured over.
export const CLOUD_TAG_COVERAGE_DAYS: number = 30;

// The weeks the trend goes back.
export const CLOUD_TAG_TREND_WEEKS: number = 12;

// The resources without a required tag listed, the costliest first.
export const CLOUD_TAG_UNTAGGED_LIMIT: number = 50;

// Whether an account's spend could be measured.
export enum CloudTagSpendState {
  Measured = "measured",
  // No costs read for it in the period.
  NoCosts = "no-costs",
  // AWS, read without its resources (Costs per resource off): no tags on its costs.
  AwsWithoutResources = "aws-without-resources",
}

// A share of spend (in the currency) or of resources (a count), whole and by key.
export interface CloudTagCoverageBreakdown {
  all: CloudTagCoverageCount;
  // By the required key in lower case.
  byKey: Record<string, CloudTagCoverageCount>;
}

export interface CloudTagAccountCoverageJSON {
  // The CloudAccount row.
  cloudAccountId: string;
  name: string;
  provider: string;
  // Its id in its cloud.
  accountId: string;
  // The keys required in it, as written.
  keys: Array<string>;
  spendState: CloudTagSpendState;
  currency: string;
  spend: CloudTagCoverageBreakdown | null;
  resources: CloudTagCoverageBreakdown;
}

export interface CloudTagTrendPointJSON {
  // The week's Monday, "2026-11-16".
  week: string;
  spend: CloudTagCoverageCount | null;
  resources: CloudTagCoverageCount | null;
}

// One required tag a resource lacks, as the page draws it.
export interface CloudTagMissingJSON {
  key: string;
  problem: CloudTagProblem;
  // What it carries instead, when the value is not allowed.
  value?: string | undefined;
  suggestion?: CloudTagSuggestion | undefined;
  // The command that applies the suggested value in its cloud.
  command?: string | undefined;
}

export interface CloudTagUntaggedResourceJSON {
  cloudResourceId: string;
  name: string;
  provider: string;
  type: string;
  cloudAccountId: string | null;
  accountName: string;
  // What it cost over the period, when its cloud bills it by name.
  spend: number | null;
  currency: string;
  missing: Array<CloudTagMissingJSON>;
  // The code that declares it, when its tags say ('CloudFormation stack "web"', "Terraform").
  declaredCode: string | null;
}

// A required tag as the page names it.
export interface CloudTagRequiredJSON {
  key: string;
  allowedValues: Array<string>;
  // The CloudAccount row it is for; null for every account.
  cloudAccountId: string | null;
}

export interface CloudTagCoverageJSON {
  hasRules: boolean;
  // The required tags the shares are of: the project's and the accounts' own.
  requiredTags: Array<CloudTagRequiredJSON>;
  currency: string;
  periodDays: number;
  accounts: Array<CloudTagAccountCoverageJSON>;
  // Every account together: spend in the currency, resources counted.
  total: {
    spend: CloudTagCoverageBreakdown | null;
    resources: CloudTagCoverageBreakdown;
  };
  trend: Array<CloudTagTrendPointJSON>;
  untagged: Array<CloudTagUntaggedResourceJSON>;
  // How many resources lack a required tag, of which `untagged` lists the first.
  untaggedCount: number;
}

/*
 * ---------------------------------------------------------------------------
 * Read back with care: an answer the page cannot read is no answer
 * ---------------------------------------------------------------------------
 */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function count(value: unknown): number {
  const number: number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function readCloudTagCoverageCount(
  value: unknown,
): CloudTagCoverageCount {
  const data: Record<string, unknown> = record(value);

  return { covered: count(data["covered"]), total: count(data["total"]) };
}

function readBreakdown(value: unknown): CloudTagCoverageBreakdown | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data: Record<string, unknown> = record(value);
  const byKey: Record<string, CloudTagCoverageCount> = {};

  for (const [key, entry] of Object.entries(record(data["byKey"]))) {
    if (key) {
      byKey[key] = readCloudTagCoverageCount(entry);
    }
  }

  return { all: readCloudTagCoverageCount(data["all"]), byKey };
}

const EMPTY_BREAKDOWN: CloudTagCoverageBreakdown = {
  all: { covered: 0, total: 0 },
  byKey: {},
};

function isSpendState(value: unknown): value is CloudTagSpendState {
  return Object.values(CloudTagSpendState).includes(
    value as CloudTagSpendState,
  );
}

function isProblem(value: unknown): value is CloudTagProblem {
  return Object.values(CloudTagProblem).includes(value as CloudTagProblem);
}

function readSuggestion(value: unknown): CloudTagSuggestion | undefined {
  const data: Record<string, unknown> = record(value);
  const source: unknown = data["source"];

  if (
    !text(data["key"]) ||
    !text(data["value"]) ||
    !Object.values(CloudTagSuggestionSource).includes(
      source as CloudTagSuggestionSource,
    )
  ) {
    return undefined;
  }

  const suggestion: CloudTagSuggestion = {
    key: text(data["key"]),
    value: text(data["value"]),
    source: source as CloudTagSuggestionSource,
  };

  if (text(data["detail"])) {
    suggestion.detail = text(data["detail"]);
  }

  if (typeof data["count"] === "number" && data["count"] > 0) {
    suggestion.count = data["count"];
  }

  return suggestion;
}

export function readCloudTagMissing(
  value: unknown,
): CloudTagMissingJSON | null {
  const data: Record<string, unknown> = record(value);

  if (!text(data["key"]) || !isProblem(data["problem"])) {
    return null;
  }

  const missing: CloudTagMissingJSON = {
    key: text(data["key"]),
    problem: data["problem"],
  };

  if (text(data["value"])) {
    missing.value = text(data["value"]);
  }

  const suggestion: CloudTagSuggestion | undefined = readSuggestion(
    data["suggestion"],
  );

  if (suggestion) {
    missing.suggestion = suggestion;
  }

  if (text(data["command"])) {
    missing.command = text(data["command"]);
  }

  return missing;
}

function readList<T>(
  value: unknown,
  read: (entry: unknown) => T | null,
): Array<T> {
  if (!Array.isArray(value)) {
    return [];
  }

  const list: Array<T> = [];

  for (const entry of value) {
    const read_: T | null = read(entry);

    if (read_ !== null) {
      list.push(read_);
    }
  }

  return list;
}

export function readCloudTagCoverage(value: unknown): CloudTagCoverageJSON {
  const data: Record<string, unknown> = record(value);
  const total: Record<string, unknown> = record(data["total"]);

  return {
    hasRules: data["hasRules"] === true,
    requiredTags: readList(
      data["requiredTags"],
      (entry: unknown): CloudTagRequiredJSON | null => {
        const tag: Record<string, unknown> = record(entry);

        if (!text(tag["key"])) {
          return null;
        }

        return {
          key: text(tag["key"]),
          allowedValues: readList(
            tag["allowedValues"],
            (value: unknown): string | null => {
              return text(value) || null;
            },
          ),
          cloudAccountId: text(tag["cloudAccountId"]) || null,
        };
      },
    ),
    currency: text(data["currency"]) || "USD",
    periodDays: count(data["periodDays"]) || CLOUD_TAG_COVERAGE_DAYS,
    accounts: readList(
      data["accounts"],
      (entry: unknown): CloudTagAccountCoverageJSON | null => {
        const account: Record<string, unknown> = record(entry);

        if (!text(account["cloudAccountId"])) {
          return null;
        }

        return {
          cloudAccountId: text(account["cloudAccountId"]),
          name: text(account["name"]),
          provider: text(account["provider"]),
          accountId: text(account["accountId"]),
          keys: readList(account["keys"], (key: unknown): string | null => {
            return text(key) || null;
          }),
          spendState: isSpendState(account["spendState"])
            ? account["spendState"]
            : CloudTagSpendState.NoCosts,
          currency: text(account["currency"]) || "USD",
          spend: readBreakdown(account["spend"]),
          resources: readBreakdown(account["resources"]) || EMPTY_BREAKDOWN,
        };
      },
    ),
    total: {
      spend: readBreakdown(total["spend"]),
      resources: readBreakdown(total["resources"]) || EMPTY_BREAKDOWN,
    },
    trend: readList(
      data["trend"],
      (entry: unknown): CloudTagTrendPointJSON | null => {
        const point: Record<string, unknown> = record(entry);

        if (!text(point["week"])) {
          return null;
        }

        return {
          week: text(point["week"]),
          spend: point["spend"]
            ? readCloudTagCoverageCount(point["spend"])
            : null,
          resources: point["resources"]
            ? readCloudTagCoverageCount(point["resources"])
            : null,
        };
      },
    ),
    untagged: readList(
      data["untagged"],
      (entry: unknown): CloudTagUntaggedResourceJSON | null => {
        const resource: Record<string, unknown> = record(entry);

        if (!text(resource["cloudResourceId"])) {
          return null;
        }

        const spend: number = Number(resource["spend"]);

        return {
          cloudResourceId: text(resource["cloudResourceId"]),
          name: text(resource["name"]),
          provider: text(resource["provider"]),
          type: text(resource["type"]),
          cloudAccountId: text(resource["cloudAccountId"]) || null,
          accountName: text(resource["accountName"]),
          spend:
            resource["spend"] === null || !Number.isFinite(spend)
              ? null
              : spend,
          currency: text(resource["currency"]) || "USD",
          missing: readList(resource["missing"], readCloudTagMissing),
          declaredCode: text(resource["declaredCode"]) || null,
        };
      },
    ),
    untaggedCount: count(data["untaggedCount"]),
  };
}
