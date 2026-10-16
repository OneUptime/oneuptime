import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import { MARKETPLACE_USAGE_UNIT_IN_USD } from "Common/Types/Marketplace/MarketplacePurchase";
import {
  MarketplaceUsageMonth,
  MarketplaceUsageSummary,
} from "Common/Types/Marketplace/MarketplaceUsageSummary";

/*
 * Reading the server's month-by-month summary of a marketplace-billed
 * project's charges (GET /marketplace/usage), defensively: anything that is
 * not one reads as nothing to show.
 */

const MONTH_PATTERN: RegExp = /^\d{4}-\d{2}$/;

const readAmount: (value: unknown) => number = (value: unknown): number => {
  const number: number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export const parseMarketplaceUsage: (
  data: JSONObject | null | undefined,
) => MarketplaceUsageSummary | null = (
  data: JSONObject | null | undefined,
): MarketplaceUsageSummary | null => {
  if (!data || typeof data !== "object" || !Array.isArray(data["months"])) {
    return null;
  }

  const marketplace: unknown = data["marketplace"];
  const unit: number = readAmount(data["usageUnitInUSD"]);

  const months: Array<MarketplaceUsageMonth> = [];

  for (const entry of data["months"] as Array<unknown>) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const month: JSONObject = entry as JSONObject;

    if (
      typeof month["month"] !== "string" ||
      !MONTH_PATTERN.test(month["month"])
    ) {
      continue;
    }

    months.push({
      month: month["month"],
      billedUnits: readAmount(month["billedUnits"]),
      pendingUnits: readAmount(month["pendingUnits"]),
      usersInUSD: readAmount(month["usersInUSD"]),
      activeMonitorsInUSD: readAmount(month["activeMonitorsInUSD"]),
      telemetryInUSD: readAmount(month["telemetryInUSD"]),
      smsOrCallBalanceInUSD: readAmount(month["smsOrCallBalanceInUSD"]),
      aiBalanceInUSD: readAmount(month["aiBalanceInUSD"]),
    });
  }

  return {
    marketplace: CloudMarketplaceUtil.isCloudMarketplace(marketplace)
      ? (marketplace as CloudMarketplace)
      : null,
    usageUnitInUSD: unit || MARKETPLACE_USAGE_UNIT_IN_USD,
    months: months,
  };
};

// What the month's usage units come to, billed and still to be confirmed.
export const getMonthTotalInUSD: (
  month: MarketplaceUsageMonth,
  usageUnitInUSD: number,
) => number = (
  month: MarketplaceUsageMonth,
  usageUnitInUSD: number,
): number => {
  return (
    Math.round(
      (month.billedUnits + month.pendingUnits) * usageUnitInUSD * 100,
    ) / 100
  );
};

// "$12.34": every amount with its cents, so a column lines up.
export const formatUSD: (amount: number) => string = (
  amount: number,
): string => {
  return `$${(Math.round(amount * 100) / 100).toFixed(2)}`;
};

// "October 2026", in the reader's language, for a "2026-10" month.
export const formatMonth: (
  month: string,
  locale?: string | undefined,
) => string = (month: string, locale?: string | undefined): string => {
  const [year, monthNumber] = month.split("-").map(Number);

  if (!year || !monthNumber) {
    return month;
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  } catch {
    return month;
  }
};
