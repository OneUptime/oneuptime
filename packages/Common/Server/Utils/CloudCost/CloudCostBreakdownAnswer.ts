import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CLOUD_COST_ALLOCATION_MAX_DAYS,
  CloudCostAllocationGroupResult,
  CloudCostAllocationWindow,
  getPreviousCloudCostWindow,
  toCloudCostAllocationWindow,
} from "../../../Types/Cloud/CloudCostAllocation";
import {
  CloudCostBasis,
  isCloudCostBasis,
} from "../../../Types/Cloud/CloudCostBasis";
import {
  CloudCostBreakdownComparison,
  CloudCostBreakdownReader,
  CloudCostComparedRest,
  CloudCostComparedShare,
  CloudCostDimension,
  CloudCostPlatformLists,
  compareCloudCostBreakdowns,
  isCloudCostDimension,
  readCloudCostBreakdown,
  readCloudCostBreakdownComparison,
} from "../../../Types/Cloud/CloudCostBreakdowns";
import {
  CLOUD_COST_CSV_REST_NAMES,
  toCloudCostBreakdownCsv,
  toCloudCostComparisonCsv,
} from "../../../Types/Cloud/CloudCostCsv";
import {
  CloudCostReportPeriod,
  getCloudCostReportWindow,
  toCloudCostReportDays,
} from "../../../Types/Cloud/CloudCostReport";
import {
  addUtcDays,
  startOfUtcDay,
  toCloudCostDay,
} from "../../../Types/Cloud/CloudCost";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudCostSettingService from "../../Services/CloudCostSettingService";
import {
  getCloudCostAccountsCurrency,
  getCloudCostServerReader,
  readCloudCostAccounts,
} from "./CloudCostServerReader";

/*
 * A BREAKDOWN OF THE SPEND, BY API AND CLI (#11009).
 *
 *   POST /cloud-cost/breakdown
 *     { by, tagKey?, cloudCostViewId?, period? | startDate + endDate,
 *       cloudAccountIds?, currency?, basis?, compareWithPrevious?, format? }
 *
 * What Cloud > Costs' "Where the money goes" shows - the period's spend by
 * service, Region, account, resource, App Platforms environment or app, a
 * tag's value or a cost view's groups - with the period before beside it,
 * so a finance system can pull last month's chargeback in one call
 * (`oneuptime cloud-cost breakdown --by group --view <id> --period
 * last-month`). It runs the page's own code (CloudCostBreakdowns) on the
 * caller's permissions; with format "csv" it answers the file the page's
 * Download CSV gives.
 */

// What `by` takes, as a person writes it, and the breakdown each names.
const BY_NAMES: Readonly<Record<string, CloudCostDimension>> = {
  service: "service",
  services: "service",
  region: "region",
  regions: "region",
  account: "cloudAccountId",
  accounts: "cloudAccountId",
  cloudaccountid: "cloudAccountId",
  resource: "resourceId",
  resources: "resourceId",
  resourceid: "resourceId",
  environment: "environment",
  environments: "environment",
  app: "app",
  apps: "app",
  tag: "tag",
  tags: "tag",
  group: "group",
  groups: "group",
  "cost-group": "group",
  "cost-groups": "group",
  costgroup: "group",
};

// What `period` takes, and the report period each is worked out as.
export enum CloudCostBreakdownPeriod {
  ThisMonth = "this-month",
  LastMonth = "last-month",
  LastWeek = "last-week",
  Last30Days = "last-30-days",
}

const PERIOD_NAMES: Readonly<Record<string, CloudCostBreakdownPeriod>> = {
  "this-month": CloudCostBreakdownPeriod.ThisMonth,
  "month-to-date": CloudCostBreakdownPeriod.ThisMonth,
  mtd: CloudCostBreakdownPeriod.ThisMonth,
  "last-month": CloudCostBreakdownPeriod.LastMonth,
  "last-week": CloudCostBreakdownPeriod.LastWeek,
  "last-30-days": CloudCostBreakdownPeriod.Last30Days,
};

export interface CloudCostBreakdownRequest {
  by: CloudCostDimension;
  tagKey?: string | undefined;
  viewId?: ObjectID | undefined;
  window: CloudCostAllocationWindow;
  cloudAccountIds?: Array<ObjectID> | undefined;
  currency?: string | undefined;
  basis?: CloudCostBasis | undefined;
  compareWithPrevious: boolean;
  format: "json" | "csv";
}

/*
 * The days a period covers on `now`'s UTC calendar: this month so far,
 * last month, last week (Monday to Sunday) or the last 30 days - the same
 * days Costs' period buttons read.
 */
export function getCloudCostBreakdownPeriodWindow(data: {
  period: CloudCostBreakdownPeriod;
  now: Date;
}): CloudCostAllocationWindow {
  if (data.period === CloudCostBreakdownPeriod.Last30Days) {
    const today: Date = startOfUtcDay(data.now);
    return { start: addUtcDays(today, -29), lastDay: today };
  }

  return getCloudCostReportWindow({
    period:
      data.period === CloudCostBreakdownPeriod.LastMonth
        ? CloudCostReportPeriod.LastMonth
        : data.period === CloudCostBreakdownPeriod.LastWeek
          ? CloudCostReportPeriod.LastWeek
          : CloudCostReportPeriod.MonthToDate,
    at: data.now,
    timezone: "UTC",
  });
}

function readId(value: unknown, name: string): ObjectID {
  const text: string =
    value && typeof value === "object" && "_id" in value
      ? String((value as JSONObject)["_id"])
      : String(value || "").trim();

  if (!ObjectID.isValidUUID(text)) {
    throw new BadDataException(`Send ${name} as an ID.`);
  }

  return new ObjectID(text);
}

function readDate(value: unknown, name: string): Date {
  const date: Date =
    typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : value && typeof value === "object" && "value" in value
        ? new Date(String((value as JSONObject)["value"]))
        : new Date(Number.NaN);

  if (!Number.isFinite(date.getTime())) {
    throw new BadDataException(`Send ${name} as a date, such as 2026-11-01.`);
  }

  return date;
}

// A breakdown's request body, read: refused with what to fix.
export function readCloudCostBreakdownBody(
  body: unknown,
  now: Date,
): CloudCostBreakdownRequest {
  const data: JSONObject =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)
      : {};

  const byText: string = String(data["by"] ?? data["dimension"] ?? "service")
    .trim()
    .toLowerCase();
  const by: CloudCostDimension | undefined =
    BY_NAMES[byText] ||
    (isCloudCostDimension(data["by"]) ? (data["by"] as CloudCostDimension) : undefined);

  if (!by) {
    throw new BadDataException(
      "Send by as one of service, region, account, resource, environment, app, tag or group.",
    );
  }

  const tagKey: string | undefined =
    typeof data["tagKey"] === "string" && data["tagKey"].trim()
      ? data["tagKey"].trim()
      : undefined;

  if (by === "tag" && !tagKey) {
    throw new BadDataException(
      "A breakdown by tag needs its tagKey, such as team.",
    );
  }

  if (tagKey && tagKey.length > 128) {
    throw new BadDataException("A tag's key is at most 128 characters.");
  }

  const viewValue: unknown = data["cloudCostViewId"] ?? data["viewId"];
  const viewId: ObjectID | undefined =
    viewValue === undefined || viewValue === null || viewValue === ""
      ? undefined
      : readId(viewValue, "cloudCostViewId");

  if (by === "group" && !viewId) {
    throw new BadDataException(
      "A breakdown by cost group needs the cost view whose groups it is by: send its cloudCostViewId.",
    );
  }

  let window: CloudCostAllocationWindow;

  if (data["startDate"] !== undefined || data["endDate"] !== undefined) {
    window = toCloudCostAllocationWindow({
      startDate: readDate(data["startDate"], "startDate"),
      endDate: readDate(data["endDate"], "endDate"),
    });
  } else {
    const periodText: string = String(data["period"] ?? "this-month")
      .trim()
      .toLowerCase();
    const period: CloudCostBreakdownPeriod | undefined =
      PERIOD_NAMES[periodText];

    if (!period) {
      throw new BadDataException(
        "Send period as this-month, last-month, last-week or last-30-days, or send startDate and endDate.",
      );
    }

    window = getCloudCostBreakdownPeriodWindow({ period, now });
  }

  const accounts: unknown = data["cloudAccountIds"];

  if (accounts !== undefined && accounts !== null && !Array.isArray(accounts)) {
    throw new BadDataException("Send cloudAccountIds as a list of IDs.");
  }

  const basis: unknown = data["basis"] ?? data["costBasis"];

  if (basis !== undefined && basis !== null && basis !== "" && !isCloudCostBasis(basis)) {
    throw new BadDataException("Send basis as billed, amortized or net.");
  }

  const format: string = String(data["format"] ?? "json").trim().toLowerCase();

  if (format !== "json" && format !== "csv") {
    throw new BadDataException("Send format as json or csv.");
  }

  return {
    by,
    tagKey,
    viewId,
    window,
    cloudAccountIds: Array.isArray(accounts)
      ? accounts.map((id: unknown): ObjectID => {
          return readId(id, "each of cloudAccountIds");
        })
      : undefined,
    currency:
      typeof data["currency"] === "string" && data["currency"].trim()
        ? data["currency"].trim().toUpperCase()
        : undefined,
    basis: isCloudCostBasis(basis) ? basis : undefined,
    compareWithPrevious: data["compareWithPrevious"] !== false,
    format: format as "json" | "csv",
  };
}

export interface CloudCostBreakdownAnswerShare {
  key: string;
  name: string;
  amount: number;
  previousAmount?: number | undefined;
}

export interface CloudCostBreakdownAnswerRest {
  kind: string;
  name: string;
  amount: number;
  previousAmount?: number | undefined;
}

export interface CloudCostBreakdownAnswer {
  by: CloudCostDimension;
  tagKey?: string | undefined;
  cloudCostViewId?: string | undefined;
  viewName?: string | undefined;
  currency: string;
  basis: CloudCostBasis;
  start: string;
  lastDay: string;
  previousStart?: string | undefined;
  previousLastDay?: string | undefined;
  total: number;
  previousTotal?: number | undefined;
  shares: Array<CloudCostBreakdownAnswerShare>;
  rest: Array<CloudCostBreakdownAnswerRest>;
  readAt: string;
}

// What a share is called: an account's or a group's name, or its key.
function getNames(data: {
  by: CloudCostDimension;
  accounts: Array<CloudAccount>;
  groups?: Array<CloudCostAllocationGroupResult> | undefined;
  lists?: CloudCostPlatformLists | undefined;
}): Map<string, string> {
  const names: Map<string, string> = new Map();

  if (data.by === "cloudAccountId") {
    for (const account of data.accounts) {
      if (account.id) {
        names.set(
          account.id.toString(),
          account.name || account.accountId || account.id.toString(),
        );
      }
    }
  }

  if (data.by === "group") {
    for (const group of data.groups || []) {
      names.set(group.id, group.name);
    }
  }

  if (data.by === "environment") {
    for (const environment of data.lists?.environments || []) {
      names.set(environment.id, environment.name);
    }
  }

  if (data.by === "app") {
    for (const app of data.lists?.apps || []) {
      names.set(app.id, app.name);
    }
  }

  return names;
}

function getShareName(data: {
  key: string;
  by: CloudCostDimension;
  names: Map<string, string>;
}): string {
  const known: string | undefined = data.names.get(data.key);

  if (known) {
    return known;
  }

  if (data.by === "cloudAccountId" && data.key) {
    return "An account since removed";
  }

  if (!data.key) {
    return data.by === "region"
      ? "No Region"
      : data.by === "resourceId"
        ? "Not billed to a resource"
        : data.by === "service"
          ? "Unnamed service"
          : "";
  }

  return data.key;
}

/*
 * The breakdown, as the caller may read it: in the currency asked (else
 * the one most of the project's accounts are billed in), on the basis asked
 * (else the project's), with the period before when asked.
 */
export async function answerCloudCostBreakdown(data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  request: CloudCostBreakdownRequest;
  now?: Date | undefined;
  reader?: CloudCostBreakdownReader | undefined;
}): Promise<CloudCostBreakdownAnswer> {
  const request: CloudCostBreakdownRequest = data.request;
  const now: Date = data.now || new Date();
  const reader: CloudCostBreakdownReader =
    data.reader ||
    getCloudCostServerReader({
      projectId: data.projectId,
      props: data.props,
      now,
    });

  /*
   * The caller's accounts: what a breakdown by account is named by, and -
   * when no currency is asked - the currency Costs would show them in.
   */
  const [basis, accounts]: [CloudCostBasis, Array<CloudAccount>] =
    await Promise.all([
      request.basis
        ? Promise.resolve(request.basis)
        : CloudCostSettingService.getCostBasisOfProject(data.projectId),
      request.by === "cloudAccountId" || !request.currency
        ? readCloudCostAccounts({ projectId: data.projectId, props: data.props })
        : Promise.resolve([]),
    ]);
  const currency: string =
    request.currency || getCloudCostAccountsCurrency(accounts);

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BadDataException(
      "The currency must be a three-letter code such as USD or EUR.",
    );
  }

  const window: CloudCostAllocationWindow = request.window;
  const previous: CloudCostAllocationWindow = getPreviousCloudCostWindow(window);
  const days: { start: string; lastDay: string } = toCloudCostReportDays(window);
  const scope: {
    projectId: ObjectID;
    cloudAccountIds?: Array<ObjectID> | undefined;
    currency: string;
    startDate: Date;
    endDate: Date;
    basis: CloudCostBasis;
  } = {
    projectId: data.projectId,
    cloudAccountIds: request.cloudAccountIds,
    currency,
    startDate: window.start,
    // The last day's rows: CloudCost.day is a day's start.
    endDate: new Date(addUtcDays(window.lastDay, 1).getTime() - 1),
    basis,
  };

  const lists: CloudCostPlatformLists | undefined =
    request.by === "environment" || request.by === "app"
      ? await reader.readPlatformLists()
      : undefined;

  let comparison: CloudCostBreakdownComparison;

  if (request.compareWithPrevious) {
    comparison = await readCloudCostBreakdownComparison(
      {
        ...reader,
        // The lists, once: both periods name the same environments and apps.
        readPlatformLists: async (): Promise<CloudCostPlatformLists> => {
          return lists || { environments: [], apps: [] };
        },
      },
      {
        scope,
        previousStartDate: previous.start,
        previousEndDate: new Date(addUtcDays(previous.lastDay, 1).getTime() - 1),
        dimension: request.by,
        tagKey: request.tagKey,
        viewId: request.viewId,
      },
    );
  } else {
    // The period alone: each share as the page lists it.
    comparison = compareCloudCostBreakdowns({
      current: await readCloudCostBreakdown(reader, {
        scope,
        dimension: request.by,
        tagKey: request.tagKey,
        viewId: request.viewId,
        lists,
      }),
      previous: { shares: [], rest: [], total: 0 },
    });
  }

  const names: Map<string, string> = getNames({
    by: request.by,
    accounts,
    groups: comparison.groups,
    lists,
  });

  const viewName: string | undefined = comparison.viewName;

  return {
    by: request.by,
    ...(request.tagKey ? { tagKey: request.tagKey } : {}),
    ...(request.viewId ? { cloudCostViewId: request.viewId.toString() } : {}),
    ...(viewName ? { viewName } : {}),
    currency,
    basis,
    start: days.start,
    lastDay: days.lastDay,
    ...(request.compareWithPrevious
      ? {
          previousStart: toCloudCostDay(previous.start),
          previousLastDay: toCloudCostDay(previous.lastDay),
          previousTotal: comparison.previousTotal,
        }
      : {}),
    total: comparison.total,
    shares: comparison.shares.map(
      (share: CloudCostComparedShare): CloudCostBreakdownAnswerShare => {
        return {
          key: share.key,
          name: getShareName({ key: share.key, by: request.by, names }),
          amount: share.amount,
          ...(request.compareWithPrevious
            ? { previousAmount: share.previousAmount }
            : {}),
        };
      },
    ),
    rest: comparison.rest.map(
      (rest: CloudCostComparedRest): CloudCostBreakdownAnswerRest => {
        return {
          kind: rest.kind,
          name: CLOUD_COST_CSV_REST_NAMES[rest.kind],
          amount: rest.amount,
          ...(request.compareWithPrevious
            ? { previousAmount: rest.previousAmount }
            : {}),
        };
      },
    ),
    readAt: now.toISOString(),
  };
}

/*
 * The answer as the CSV the page's Download CSV gives - with the period
 * before's columns when it was read - each share by the name it is shown
 * by.
 */
export function toCloudCostBreakdownAnswerCsv(
  answer: CloudCostBreakdownAnswer,
): string {
  const names: Map<string, string> = new Map(
    answer.shares.map((share: CloudCostBreakdownAnswerShare): [string, string] => {
      return [share.key, share.name];
    }),
  );
  const context: {
    dimension: CloudCostDimension;
    start: string;
    lastDay: string;
    currency: string;
    basis: string;
    tagKey?: string | undefined;
    names: Map<string, string>;
  } = {
    dimension: answer.by,
    start: answer.start,
    lastDay: answer.lastDay,
    currency: answer.currency,
    basis: answer.basis,
    tagKey: answer.tagKey,
    names,
  };

  if (answer.previousStart && answer.previousLastDay) {
    return toCloudCostComparisonCsv({
      comparison: {
        shares: answer.shares.map((share: CloudCostBreakdownAnswerShare) => {
          return {
            key: share.key,
            amount: share.amount,
            previousAmount: share.previousAmount || 0,
          };
        }),
        rest: answer.rest.map((rest: CloudCostBreakdownAnswerRest) => {
          return {
            kind: rest.kind as CloudCostComparedRest["kind"],
            amount: rest.amount,
            previousAmount: rest.previousAmount || 0,
          };
        }),
        total: answer.total,
        previousTotal: answer.previousTotal || 0,
      },
      context: {
        ...context,
        previousStart: answer.previousStart,
        previousLastDay: answer.previousLastDay,
      },
    });
  }

  return toCloudCostBreakdownCsv({
    breakdown: {
      shares: answer.shares.map((share: CloudCostBreakdownAnswerShare) => {
        return { key: share.key, amount: share.amount };
      }),
      rest: answer.rest.map((rest: CloudCostBreakdownAnswerRest) => {
        return {
          kind: rest.kind as CloudCostComparedRest["kind"],
          amount: rest.amount,
        };
      }),
      total: answer.total,
    },
    context,
  });
}

// The longest window a breakdown reads: what the costs table keeps.
export const CLOUD_COST_BREAKDOWN_MAX_DAYS: number =
  CLOUD_COST_ALLOCATION_MAX_DAYS;
