import {
  addUtcDays,
  addUtcMonths,
  startOfUtcDay,
  startOfUtcMonth,
} from "Common/Types/Cloud/CloudCost";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { CloudCostDimension } from "./CloudCostReads";

/*
 * HOW THE COSTS PAGES BREAK THE SPEND DOWN.
 *
 * "Where the money goes" lists what cost the most in a period - this
 * month, last month or the last 30 days, in UTC days as the clouds bill -
 * by service, Region, account or resource. React-free: App tests read the
 * windows and the names a breakdown's keys are drawn with.
 */

export enum CloudCostPeriod {
  ThisMonth = "this-month",
  LastMonth = "last-month",
  Last30Days = "last-30-days",
}

export const CLOUD_COST_PERIOD_OPTIONS: Array<{
  label: string;
  value: CloudCostPeriod;
}> = [
  { label: translationKey("This month"), value: CloudCostPeriod.ThisMonth },
  { label: translationKey("Last month"), value: CloudCostPeriod.LastMonth },
  { label: translationKey("Last 30 days"), value: CloudCostPeriod.Last30Days },
];

// A period's first and last moment: whole UTC days, up to now.
export function getCloudCostPeriodWindow(
  period: CloudCostPeriod,
  now: Date,
): { start: Date; end: Date } {
  const monthStart: Date = startOfUtcMonth(now);

  if (period === CloudCostPeriod.LastMonth) {
    return {
      start: addUtcMonths(monthStart, -1),
      end: new Date(monthStart.getTime() - 1),
    };
  }

  if (period === CloudCostPeriod.Last30Days) {
    return { start: addUtcDays(startOfUtcDay(now), -29), end: now };
  }

  return { start: monthStart, end: now };
}

export const CLOUD_COST_DIMENSION_OPTIONS: Array<{
  label: string;
  value: CloudCostDimension;
}> = [
  { label: translationKey("Services"), value: "service" },
  { label: translationKey("Regions"), value: "region" },
  { label: translationKey("Accounts"), value: "cloudAccountId" },
  { label: translationKey("Resources"), value: "resourceId" },
];

// A cost with no value for the dimension, as its row is named.
export const NO_REGION: string = translationKey("No Region");
export const NO_RESOURCE: string = translationKey("Not billed to a resource");
export const UNKNOWN_ACCOUNT: string = translationKey(
  "An account since removed",
);
export const UNNAMED_SERVICE: string = translationKey("Unnamed service");

export interface CloudCostShareLabel {
  // English to translate (`isTranslated` false), or as written.
  label: string;
  isAsWritten: boolean;
  // The whole key, under the pointer, for a label cut from it.
  title?: string | undefined;
}

/*
 * A resource's name from the id its cloud bills it under: the last part of
 * an Azure ARM id (".../virtualMachines/web-1") or a Google Cloud resource
 * name, the whole of anything else (an AWS ARN's resource after its last
 * "/" or ":").
 */
export function getCloudCostResourceName(resourceId: string): string {
  const trimmed: string = (resourceId || "").trim().replace(/\/+$/, "");

  if (!trimmed) {
    return "";
  }

  const slash: number = trimmed.lastIndexOf("/");

  if (slash >= 0 && slash < trimmed.length - 1) {
    return trimmed.slice(slash + 1);
  }

  const colon: number = trimmed.lastIndexOf(":");

  if (colon >= 0 && colon < trimmed.length - 1) {
    return trimmed.slice(colon + 1);
  }

  return trimmed;
}

export function getCloudCostShareLabel(data: {
  dimension: CloudCostDimension;
  key: string;
  // CloudAccount id -> its name.
  accountNames: Map<string, string>;
}): CloudCostShareLabel {
  const key: string = data.key || "";

  if (data.dimension === "cloudAccountId") {
    const name: string | undefined = data.accountNames.get(key);
    return name
      ? { label: name, isAsWritten: true }
      : { label: UNKNOWN_ACCOUNT, isAsWritten: false };
  }

  if (!key) {
    return {
      label:
        data.dimension === "region"
          ? NO_REGION
          : data.dimension === "resourceId"
            ? NO_RESOURCE
            : UNNAMED_SERVICE,
      isAsWritten: false,
    };
  }

  if (data.dimension === "resourceId") {
    const name: string = getCloudCostResourceName(key);
    return { label: name, isAsWritten: true, title: key };
  }

  return { label: key, isAsWritten: true };
}
