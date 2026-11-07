import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudCostState,
  addUtcDays,
  fromCloudCostDay,
  startOfUtcDay,
  toCloudCostDay,
} from "../../../../Types/Cloud/CloudCost";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudConnectorCallOptions,
  CloudCostRecord,
  CloudKnownResource,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";
import { AwsCredentials, awsErrorCodeOf, sendAwsRequest } from "./AwsApi";

/*
 * WHAT EACH RESOURCE OF AN AWS ACCOUNT COSTS - opt-in, per connection.
 *
 * Cost Explorer says what an account costs by service and Region
 * (AwsCosts). It says it by resource too, once someone turns on
 * "resource-level data at daily granularity" in the account's Cost
 * Management preferences, for the last 14 days only:
 *
 *   GetCostAndUsageWithResources (AWS JSON 1.1, us-east-1, $0.01 a request)
 *     { TimePeriod, Granularity: "DAILY", Metrics: ["UnblendedCost"],
 *       Filter: SERVICE in the services the account was billed for, and no
 *       credits or refunds (as the account's own read leaves them out),
 *       GroupBy: [SERVICE, RESOURCE_ID], NextPageToken }
 *     -> { ResultsByTime: [{ TimePeriod: { Start }, Groups: [{ Keys:
 *          [service, resource], Metrics: { UnblendedCost } }] }],
 *          NextPageToken }
 *
 * A cost no resource is named for (a service whose resource-level data is
 * not turned on, data transfer, a fee) answers as "NoResourceId".
 *
 * So that it costs little and nothing is read twice, a connection reads it
 * once a day: the first time the 14 days Cost Explorer keeps, after that
 * the last three days again - the ones AWS still finishes - and what it
 * read is kept with the account's costs, where it stays after Cost
 * Explorer has forgotten it. Its pages are bounded (AWS_RESOURCE_COST_MAX_PAGES).
 *
 * What it read is laid over the account's own figures (splitAwsCostsByResource):
 * each figure of a day it covered - a service in a Region - becomes its
 * resources' costs and the rest, not billed to a resource, so the figures
 * still add up to what the account cost. A day it did not cover keeps the
 * resources it was split into before (isServiceTotal).
 */

const PROVIDER_TITLE: string = "AWS";
const RESOURCE_COST_TARGET: string =
  "AWSInsightsIndexService.GetCostAndUsageWithResources";

// The days Cost Explorer keeps resource-level costs for, today among them.
export const AWS_RESOURCE_COST_DAYS: number = 14;

// The days a later read takes again: today and the two before it.
export const AWS_RESOURCE_COST_RECENT_DAYS: number = 3;

// How often the costs per resource are read: once a day.
export const AWS_RESOURCE_COSTS_INTERVAL_MS: number = 24 * 60 * 60 * 1000;

// Pages of one read at most: each is $0.01.
export const AWS_RESOURCE_COST_MAX_PAGES: number = 20;

// The services one read asks for at most, the costliest first.
export const AWS_RESOURCE_COST_MAX_SERVICES: number = 100;

// The IAM action it is read with, as a refusal names it.
export const AWS_RESOURCE_COST_ACTION: string =
  "ce:GetCostAndUsageWithResources";

// A rest smaller than this is float noise, not a cost of its own.
export const AWS_RESOURCE_COST_EPSILON: number = 0.000001;

// What Cost Explorer names a cost no resource is named for.
const NO_RESOURCE_KEYS: ReadonlySet<string> = new Set<string>([
  "",
  "noresourceid",
  "no resource id",
]);

const COST_FILTER_EXCLUDED_RECORD_TYPES: ReadonlyArray<string> = [
  "Credit",
  "Refund",
];

// One day's cost of one resource, as Cost Explorer names them.
export interface AwsResourceCost {
  day: string;
  service: string;
  // Cost Explorer's own id for it: an ARN, or an instance's, volume's or bucket's id.
  resourceId: string;
  currency: string;
  amount: number;
}

// Whether Cost Explorer's key names a resource.
export function isAwsResourceKey(key: string): boolean {
  return !NO_RESOURCE_KEYS.has((key || "").trim().toLowerCase());
}

/*
 * The days a read takes: the 14 Cost Explorer keeps the first time (and
 * after a read missed for longer), else the last three again - and never
 * before the first day the account's own read covers, which the writer
 * brings in line.
 */
export function getAwsResourceCostWindow(data: {
  now: Date;
  lastReadAt?: string | undefined;
}): { start: Date; end: Date; isFirstRead: boolean } {
  const today: Date = startOfUtcDay(data.now);
  const end: Date = addUtcDays(today, 1);
  const oldest: Date = addUtcDays(today, -(AWS_RESOURCE_COST_DAYS - 1));
  const last: number = Date.parse(data.lastReadAt || "");

  if (!Number.isFinite(last)) {
    return { start: oldest, end, isFirstRead: true };
  }

  // Missed for longer than a few days: the days since, all of them.
  const since: Date = addUtcDays(startOfUtcDay(new Date(last)), -2);
  const recent: Date = addUtcDays(today, -(AWS_RESOURCE_COST_RECENT_DAYS - 1));
  const start: Date = since < recent ? since : recent;

  return { start: start < oldest ? oldest : start, end, isFirstRead: false };
}

// Whether the costs per resource are due: never read, or read a day ago.
export function isAwsResourceCostsDue(data: {
  now: Date;
  lastReadAt?: string | undefined;
}): boolean {
  const last: number = Date.parse(data.lastReadAt || "");

  return (
    !Number.isFinite(last) ||
    data.now.getTime() - last >= AWS_RESOURCE_COSTS_INTERVAL_MS
  );
}

function readAmount(value: unknown): number {
  const amount: number =
    typeof value === "number" ? value : Number(readText(value));
  return Number.isFinite(amount) ? amount : 0;
}

/*
 * Each day's cost of each resource of the services asked, over the
 * window. `complete` is false when it stopped at its page limit: what it
 * read is then not used, so no day is split from part of its resources.
 */
export async function readAwsResourceCosts(data: {
  credentials: AwsCredentials;
  region: string;
  services: Array<string>;
  start: Date;
  end: Date;
  options: CloudConnectorCallOptions;
  budget: CloudReadBudget;
}): Promise<{ costs: Array<AwsResourceCost>; complete: boolean }> {
  const costs: Array<AwsResourceCost> = [];

  if (data.services.length === 0) {
    return { costs, complete: true };
  }

  let token: string = "";

  for (let page: number = 0; page < AWS_RESOURCE_COST_MAX_PAGES; page++) {
    const body: JSONObject = {
      TimePeriod: {
        Start: toCloudCostDay(data.start),
        End: toCloudCostDay(data.end),
      },
      Granularity: "DAILY",
      Metrics: ["UnblendedCost"],
      Filter: {
        And: [
          {
            Dimensions: {
              Key: "SERVICE",
              Values: data.services.slice(0, AWS_RESOURCE_COST_MAX_SERVICES),
            },
          },
          {
            Not: {
              Dimensions: {
                Key: "RECORD_TYPE",
                Values: [...COST_FILTER_EXCLUDED_RECORD_TYPES],
              },
            },
          },
        ],
      },
      GroupBy: [
        { Type: "DIMENSION", Key: "SERVICE" },
        { Type: "DIMENSION", Key: "RESOURCE_ID" },
      ],
    };

    if (token) {
      body["NextPageToken"] = token;
    }

    const answer: { json: JSONObject } = await sendAwsRequest({
      transport: data.options.transport,
      credentials: data.credentials,
      service: "ce",
      region: data.region,
      target: RESOURCE_COST_TARGET,
      jsonVersion: "1.1",
      body,
      step: "resource cost request",
      providerTitle: PROVIDER_TITLE,
      now: data.options.now,
      timeoutInMs: data.options.requestTimeoutInMs,
      sleep: data.options.sleep,
      budget: data.budget,
    });

    for (const rawPeriod of readArray(answer.json["ResultsByTime"])) {
      const period: JSONObject = readObject(rawPeriod);
      const day: string = readText(
        readObject(period["TimePeriod"])["Start"],
      ).slice(0, 10);

      if (!day) {
        continue;
      }

      for (const rawGroup of readArray(period["Groups"])) {
        const group: JSONObject = readObject(rawGroup);
        const keys: Array<string> = readArray(group["Keys"]).map(
          (key: unknown): string => {
            return readText(key);
          },
        );
        const metric: JSONObject = readObject(
          readObject(group["Metrics"])["UnblendedCost"],
        );
        const amount: number = readAmount(metric["Amount"]);
        const resourceId: string = (keys[1] || "").trim();

        if (amount === 0 || !isAwsResourceKey(resourceId)) {
          continue;
        }

        costs.push({
          day,
          service: keys[0] || "",
          resourceId,
          currency: readText(metric["Unit"]) || CLOUD_COST_DEFAULT_CURRENCY,
          amount,
        });
      }
    }

    const next: string = readText(answer.json["NextPageToken"]);

    if (!next || next === token) {
      return { costs, complete: true };
    }

    token = next;
  }

  return { costs, complete: false };
}

/*
 * The services a read asks for: those the account was billed for on the
 * window's days, the costliest first.
 */
export function getAwsResourceCostServices(data: {
  records: Array<CloudCostRecord>;
  start: Date;
  end: Date;
}): Array<string> {
  const startDay: string = toCloudCostDay(data.start);
  const endDay: string = toCloudCostDay(data.end);
  const totals: Map<string, number> = new Map();

  for (const record of data.records) {
    if (record.day < startDay || record.day >= endDay || !record.service) {
      continue;
    }

    totals.set(
      record.service,
      (totals.get(record.service) || 0) + Math.abs(record.amount),
    );
  }

  return Array.from(totals.entries())
    .sort((a: [string, number], b: [string, number]): number => {
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([service]: [string, number]): string => {
      return service;
    })
    .slice(0, AWS_RESOURCE_COST_MAX_SERVICES);
}

// The part of an ARN after its last "/" or ":": an instance's id, a bucket's name.
export function getAwsArnTail(value: string): string {
  const colon: number = value.lastIndexOf(":");
  const slash: number = value.lastIndexOf("/");
  const cut: number = Math.max(colon, slash);
  return cut >= 0 && cut < value.length - 1 ? value.slice(cut + 1) : value;
}

/*
 * An ARN's parts: arn:<partition>:<service>:<region>:<account>:<resource>.
 * Null for anything else.
 */
export function parseAwsArn(
  value: string,
): { service: string; region: string; accountId: string } | null {
  const parts: Array<string> = (value || "").trim().split(":");

  if (parts.length < 6 || parts[0] !== "arn") {
    return null;
  }

  return {
    service: parts[2] || "",
    region: parts[3] || "",
    accountId: parts[4] || "",
  };
}

/*
 * Where one of Cost Explorer's resources is kept: under the id OneUptime
 * holds the resource by (its Provider Resource ID - an EC2 instance's ARN,
 * where Cost Explorer says "i-0abc") so its page and its right-sizing find
 * its costs, in its account and Region. A resource OneUptime does not hold
 * is kept under Cost Explorer's own id, its account and Region read from
 * its ARN - or, for a plain id, the account read when it is the only one.
 */
export interface AwsResourcePlace {
  resourceKey: string;
  accountId: string;
  region: string;
}

export class AwsResourcePlaces {
  private byArn: Map<string, CloudKnownResource> = new Map();
  private byTail: Map<string, Array<CloudKnownResource>> = new Map();
  private onlyAccountId: string;

  public constructor(data: {
    knownResources: Array<CloudKnownResource>;
    // The one account read, for an id that names none; "" for an organization.
    onlyAccountId: string;
  }) {
    this.onlyAccountId = data.onlyAccountId;

    for (const resource of data.knownResources) {
      const id: string = (resource.providerResourceId || "").trim();

      if (!id) {
        continue;
      }

      this.byArn.set(id.toLowerCase(), resource);

      const tail: string = getAwsArnTail(id).toLowerCase();
      this.byTail.set(tail, [...(this.byTail.get(tail) || []), resource]);
    }
  }

  public placeOf(resourceId: string): AwsResourcePlace | null {
    const id: string = resourceId.trim();
    const exact: CloudKnownResource | undefined = this.byArn.get(
      id.toLowerCase(),
    );
    const known: CloudKnownResource | undefined = exact || this.findByTail(id);

    if (known) {
      return {
        resourceKey: known.providerResourceId.trim(),
        accountId: known.accountId || this.onlyAccountId,
        region: known.region || "",
      };
    }

    const arn: { region: string; accountId: string } | null = parseAwsArn(id);

    if (arn) {
      return {
        resourceKey: id,
        accountId: arn.accountId || this.onlyAccountId,
        region: arn.region,
      };
    }

    // A plain id (an instance's, a bucket's) of the one account read.
    return this.onlyAccountId
      ? { resourceKey: id, accountId: this.onlyAccountId, region: "" }
      : null;
  }

  /*
   * A resource held under an ARN Cost Explorer names by its tail only
   * ("i-0abc", a bucket's name): found when one resource has that tail,
   * else none - two of one name are never guessed between.
   */
  private findByTail(id: string): CloudKnownResource | undefined {
    if (parseAwsArn(id)) {
      return undefined;
    }

    const found: Array<CloudKnownResource> =
      this.byTail.get(id.toLowerCase()) || [];

    return found.length === 1 ? found[0] : undefined;
  }
}

/*
 * The account's figures with the resources' costs laid over them.
 *
 * A figure - an account's service, in a Region, on a day - of a day the
 * resource read covered becomes its resources' costs and the rest, not
 * billed to a resource. A resource goes under the figure of its own Region,
 * else under the service's only figure of the day (an organization's are by
 * account and service alone), else it stays in the rest: it is never
 * counted twice. The rest is never below nothing: when the resources come
 * to more than a figure read a little earlier, they are the newer figure.
 *
 * A figure of a day it did not cover is the whole of its service and
 * Region (isServiceTotal): what it was split into before is kept, and the
 * rest is brought in line.
 */
export function splitAwsCostsByResource(data: {
  records: Array<CloudCostRecord>;
  resourceCosts: Array<AwsResourceCost>;
  // The days the resource read covered in full.
  coveredDays: Set<string>;
  places: AwsResourcePlaces;
}): Array<CloudCostRecord> {
  const groupKey: (
    accountId: string,
    day: string,
    service: string,
    region: string,
  ) => string = (
    accountId: string,
    day: string,
    service: string,
    region: string,
  ): string => {
    return JSON.stringify([accountId.toLowerCase(), day, service, region]);
  };

  // The figures of the days covered, and each service's Regions on each day.
  const figures: Map<string, CloudCostRecord> = new Map();
  const regionsOf: Map<string, Set<string>> = new Map();

  for (const record of data.records) {
    if (!data.coveredDays.has(record.day)) {
      continue;
    }

    const key: string = groupKey(
      record.accountId,
      record.day,
      record.service,
      record.region,
    );
    const existing: CloudCostRecord | undefined = figures.get(key);

    figures.set(
      key,
      existing
        ? { ...existing, amount: existing.amount + record.amount }
        : { ...record },
    );

    const serviceKey: string = JSON.stringify([
      record.accountId.toLowerCase(),
      record.day,
      record.service,
    ]);
    regionsOf.set(
      serviceKey,
      new Set<string>([
        ...Array.from(regionsOf.get(serviceKey) || []),
        record.region,
      ]),
    );
  }

  // Each figure's resources, by where they go.
  const resourcesOf: Map<string, Map<string, number>> = new Map();

  for (const cost of data.resourceCosts) {
    if (!data.coveredDays.has(cost.day)) {
      continue;
    }

    const place: AwsResourcePlace | null = data.places.placeOf(cost.resourceId);

    if (!place) {
      continue;
    }

    let key: string = groupKey(
      place.accountId,
      cost.day,
      cost.service,
      place.region,
    );

    if (!figures.has(key)) {
      const regions: Array<string> = Array.from(
        regionsOf.get(
          JSON.stringify([
            place.accountId.toLowerCase(),
            cost.day,
            cost.service,
          ]),
        ) || [],
      );

      if (regions.length !== 1) {
        continue;
      }

      key = groupKey(place.accountId, cost.day, cost.service, regions[0]!);
    }

    const resources: Map<string, number> = resourcesOf.get(key) || new Map();
    resources.set(
      place.resourceKey,
      (resources.get(place.resourceKey) || 0) + cost.amount,
    );
    resourcesOf.set(key, resources);
  }

  const records: Array<CloudCostRecord> = [];

  for (const record of data.records) {
    if (!data.coveredDays.has(record.day)) {
      records.push({ ...record, isServiceTotal: true });
    }
  }

  for (const [key, figure] of figures) {
    const resources: Map<string, number> = resourcesOf.get(key) || new Map();
    let placed: number = 0;

    for (const [resourceKey, amount] of resources) {
      if (amount === 0) {
        continue;
      }

      placed += amount;
      records.push({
        accountId: figure.accountId,
        day: figure.day,
        service: figure.service,
        region: figure.region,
        resourceId: resourceKey,
        currency: figure.currency,
        amount,
      });
    }

    // Exact, not rounded: the parts add up to the figure.
    const rest: number = Math.max(0, figure.amount - placed);

    if (rest >= AWS_RESOURCE_COST_EPSILON) {
      records.push({ ...figure, resourceId: "", amount: rest });
    }
  }

  return records;
}

/*
 * Why the costs per resource could not be read, in words the person can
 * act on: resource-level data not turned on, the action not allowed, or
 * anything else, read again tomorrow.
 */
export function describeAwsResourceCostFailure(error: unknown): {
  state: CloudCostState;
  message: string;
} {
  if (error instanceof CloudReadBudgetSpent) {
    return {
      state: CloudCostState.Failed,
      message:
        "The read reached its limit before the costs per resource: they are read again tomorrow.",
    };
  }

  const body: string =
    error instanceof LlmProviderError
      ? error.responseBody || error.message
      : error instanceof Error
        ? error.message
        : String(error);
  const code: string = awsErrorCodeOf(body);
  const lower: string = body.toLowerCase();

  if (
    code === "DataUnavailableException" ||
    lower.includes("resource-level") ||
    lower.includes("resource level") ||
    lower.includes("opt in") ||
    lower.includes("opt-in")
  ) {
    return {
      state: CloudCostState.NotSetUp,
      message:
        "Resource-level data is not turned on for this account. Turn on resource-level data at daily granularity in the AWS Billing and Cost Management console's Cost Management preferences, from the organization's management account: AWS prepares it within 48 hours.",
    };
  }

  if (
    error instanceof LlmProviderError &&
    error.kind === CloudConnectionFailureKind.Permission
  ) {
    return {
      state: CloudCostState.NotAllowed,
      message: `The role may not read costs per resource (${AWS_RESOURCE_COST_ACTION}). Run the setup command again to allow it.`,
    };
  }

  return {
    state: CloudCostState.Failed,
    message: (error instanceof Error ? error.message : String(error)).slice(
      0,
      500,
    ),
  };
}

// The days of a window, each as "2026-11-02".
export function getCloudCostDays(window: {
  start: Date;
  end: Date;
}): Set<string> {
  const days: Set<string> = new Set<string>();

  for (
    let day: Date = startOfUtcDay(window.start);
    day.getTime() < window.end.getTime();
    day = addUtcDays(day, 1)
  ) {
    days.add(toCloudCostDay(day));
  }

  return days;
}

// The earlier of two windows' starts, as the day it is.
export function getEarlierCostDay(a: Date, b: Date): Date {
  return fromCloudCostDay(
    toCloudCostDay(a) < toCloudCostDay(b)
      ? toCloudCostDay(a)
      : toCloudCostDay(b),
  );
}
