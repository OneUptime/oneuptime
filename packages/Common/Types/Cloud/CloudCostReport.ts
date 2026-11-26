import moment from "moment-timezone";
import { translationKey } from "../Translator";
import {
  addUtcDays,
  addUtcMonths,
  fromCloudCostDay,
  startOfUtcMonth,
  toCloudCostDay,
} from "./CloudCost";
import {
  CloudCostAllocationWindow,
  getPreviousCloudCostWindow,
} from "./CloudCostAllocation";

/*
 * CLOUD COST REPORTS (#11009): WHAT THE CLOUDS COST, SENT TO THE PEOPLE WHO
 * READ IT RATHER THAN OPEN A COST TOOL.
 *
 * A report says what it covers - every account, one account, a cost group
 * or a cost view with all its groups - which period (last week, last month
 * or the month so far) and on which cost basis (billed, amortized or net).
 * It goes out weekly or monthly, on the workspace summaries' schedule rules
 * (WorkspaceSummaryScheduleUtil), in its creator's time zone: by email to
 * people, teams and, for Cloud admins, any address, and as a short message
 * to Slack and Microsoft Teams channels. A report over a cost view can send
 * each group that has a team its own section, to that team.
 *
 * Its figures are worked out by the code the Costs page runs
 * (CloudCostBreakdowns), over the same rows, so a report and the page agree
 * for the same days and basis. Every period is whole UTC days, as the
 * clouds bill: the time zone picks which days "last week" means, not where
 * a day starts.
 *
 * React-free and server-safe: the worker that sends reports, the API that
 * stores them and the Dashboard's form share it.
 */

// What a report covers.
export enum CloudCostReportScope {
  // Every account of the project.
  AllAccounts = "AllAccounts",
  // One account (CloudAccount).
  Account = "Account",
  // One cost group (CloudCostGroup), as its view allocates it.
  CostGroup = "CostGroup",
  // A cost view (CloudCostView) with all its groups and what is unallocated.
  CostView = "CostView",
}

// The days a report covers, from the day it is sent.
export enum CloudCostReportPeriod {
  // Monday to Sunday of the week before the one it is sent in.
  LastWeek = "LastWeek",
  // The calendar month before the one it is sent in.
  LastMonth = "LastMonth",
  // From the 1st of the month it is sent in to the day it is sent.
  MonthToDate = "MonthToDate",
}

export function isCloudCostReportScope(
  value: unknown,
): value is CloudCostReportScope {
  return (
    typeof value === "string" &&
    (Object.values(CloudCostReportScope) as Array<string>).includes(value)
  );
}

export function isCloudCostReportPeriod(
  value: unknown,
): value is CloudCostReportPeriod {
  return (
    typeof value === "string" &&
    (Object.values(CloudCostReportPeriod) as Array<string>).includes(value)
  );
}

export const CLOUD_COST_REPORT_SCOPE_LABELS: Readonly<
  Record<CloudCostReportScope, string>
> = {
  [CloudCostReportScope.AllAccounts]: translationKey("Every account"),
  [CloudCostReportScope.Account]: translationKey("One account"),
  [CloudCostReportScope.CostGroup]: translationKey("A cost group"),
  [CloudCostReportScope.CostView]: translationKey("A cost view"),
};

export const CLOUD_COST_REPORT_PERIOD_LABELS: Readonly<
  Record<CloudCostReportPeriod, string>
> = {
  [CloudCostReportPeriod.LastWeek]: translationKey("Last week"),
  [CloudCostReportPeriod.LastMonth]: translationKey("Last month"),
  [CloudCostReportPeriod.MonthToDate]: translationKey("Month to date"),
};

// What the period before a report's is called, beside its change.
export const CLOUD_COST_REPORT_PREVIOUS_LABELS: Readonly<
  Record<CloudCostReportPeriod, string>
> = {
  [CloudCostReportPeriod.LastWeek]: translationKey("the week before"),
  [CloudCostReportPeriod.LastMonth]: translationKey("the month before"),
  [CloudCostReportPeriod.MonthToDate]: translationKey(
    "last month by the same day",
  ),
};

/*
 * The most a report sends to: people and teams together, addresses, and
 * channels. A report is read for each person it goes to, so a list of
 * hundreds would be hundreds of reads; a team stands for its members.
 */
export const CLOUD_COST_REPORT_MAX_EMAIL_ADDRESSES: number = 25;
export const CLOUD_COST_REPORT_MAX_CHANNELS: number = 10;
// The most people one send reaches, a group's teams' members included.
export const CLOUD_COST_REPORT_MAX_PEOPLE: number = 200;

/*
 * The day a report is sent on, as its time zone's calendar has it:
 * "2026-11-30" for 09:00 on Monday in Sydney, though it is still Sunday in
 * UTC. A time zone moment does not know is read as UTC.
 */
export function getCloudCostReportLocalDay(data: {
  at: Date;
  timezone?: string | undefined;
}): string {
  const zone: string =
    data.timezone && moment.tz.zone(data.timezone) ? data.timezone : "UTC";

  return moment.tz(data.at, zone).format("YYYY-MM-DD");
}

/*
 * The whole UTC days a report sent at `at` covers, both ends included:
 *
 *   - last week: Monday to Sunday of the week before the one the report is
 *     sent in, by its time zone's calendar - the week that just ended, for
 *     a report sent on a Monday morning anywhere;
 *   - last month: the calendar month before the one it is sent in;
 *   - month to date: from the 1st of the month it is sent in to the day it
 *     is sent, as Costs' "This month" reads it then. Sent on the 1st, that
 *     is the 1st alone, so a monthly report is best of last month.
 *
 * The days are UTC's, as the clouds bill: a cloud's "Sunday" is the UTC
 * day, wherever the report is read.
 */
export function getCloudCostReportWindow(data: {
  period: CloudCostReportPeriod;
  at: Date;
  timezone?: string | undefined;
}): CloudCostAllocationWindow {
  const day: Date = fromCloudCostDay(
    getCloudCostReportLocalDay({ at: data.at, timezone: data.timezone }),
  );

  if (data.period === CloudCostReportPeriod.LastWeek) {
    // Monday is 1 and Sunday 7, as ISO 8601 counts the days of a week.
    const isoWeekday: number = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    const thisMonday: Date = addUtcDays(day, -(isoWeekday - 1));

    return {
      start: addUtcDays(thisMonday, -7),
      lastDay: addUtcDays(thisMonday, -1),
    };
  }

  const monthStart: Date = startOfUtcMonth(day);

  if (data.period === CloudCostReportPeriod.LastMonth) {
    return {
      start: addUtcMonths(monthStart, -1),
      lastDay: addUtcDays(monthStart, -1),
    };
  }

  return { start: monthStart, lastDay: day };
}

/*
 * The days a report's period is compared with: the week before, the month
 * before, or last month by the same day - as a cost view's allocation and
 * the cost groups compare theirs (getPreviousCloudCostWindow).
 */
export function getCloudCostReportPreviousWindow(
  window: CloudCostAllocationWindow,
): CloudCostAllocationWindow {
  return getPreviousCloudCostWindow(window);
}

// A window's days as text: { start: "2026-11-16", lastDay: "2026-11-22" }.
export function toCloudCostReportDays(window: CloudCostAllocationWindow): {
  start: string;
  lastDay: string;
} {
  return {
    start: toCloudCostDay(window.start),
    lastDay: toCloudCostDay(window.lastDay),
  };
}

/*
 * An address a report may be sent to, as typed: trimmed and in lower case,
 * or null when it is not one. Deliberately plain - something@somewhere.tld
 * with no spaces - since the mail server is the judge of the rest.
 */
const EMAIL_ADDRESS: RegExp = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/;

export function toCloudCostReportEmailAddress(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const address: string = value.trim().toLowerCase();

  return address.length > 0 && address.length <= 254 && EMAIL_ADDRESS.test(address)
    ? address
    : null;
}

/*
 * A report's addresses as they are kept: each once, in the order given.
 * Refused, with what to fix, when one is not an address or there are more
 * than a report sends to.
 */
export function readCloudCostReportEmailAddresses(
  value: unknown,
): Array<string> {
  if (value === null || value === undefined || value === "") {
    return [];
  }

  const items: Array<unknown> = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,;]+/)
      : [value];
  const addresses: Array<string> = [];

  for (const item of items) {
    if (typeof item === "string" && !item.trim()) {
      continue;
    }

    const address: string | null = toCloudCostReportEmailAddress(item);

    if (!address) {
      throw new Error(
        `"${String(item).slice(0, 100)}" is not an email address. Write each address as name@example.com.`,
      );
    }

    if (!addresses.includes(address)) {
      addresses.push(address);
    }
  }

  if (addresses.length > CLOUD_COST_REPORT_MAX_EMAIL_ADDRESSES) {
    throw new Error(
      `A report goes to at most ${CLOUD_COST_REPORT_MAX_EMAIL_ADDRESSES} addresses. Send it to a team instead, or to a mailing list's address.`,
    );
  }

  return addresses;
}
