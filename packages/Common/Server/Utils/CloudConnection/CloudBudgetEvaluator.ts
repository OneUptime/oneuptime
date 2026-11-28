import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudBudget from "../../../Models/DatabaseModels/CloudBudget";
import CloudCostGroup from "../../../Models/DatabaseModels/CloudCostGroup";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CloudBudgetCheckWindow,
  CloudBudgetScope,
  CloudBudgetUnusualDayRule,
  CloudBudgetUnusualDayUnit,
  findCloudBudgetUnusualDays,
  getCloudBudgetCheckWindow,
  getCloudBudgetWindowNoun,
  isCloudBudgetNoticeOnly,
  readCloudBudgetPeriod,
  readCloudBudgetScope,
  readCloudBudgetUnusualDayRule,
  CloudBudgetPeriod,
} from "../../../Types/Cloud/CloudBudget";
import {
  CLOUD_COST_ANOMALY_ACCOUNT_RATIO,
  CLOUD_COST_ANOMALY_BASELINE_DAYS,
  CLOUD_COST_ANOMALY_DAYS_JUDGED,
  CLOUD_COST_ANOMALY_SERVICE_RATIO,
  findCloudCostAnomalies,
  getCloudCostAnomalyRatio,
  getStartedCloudCostAnomalies,
  groupCloudCostAnomaliesByDay,
} from "../../../Types/Cloud/CloudCostAnomaly";
import {
  addUtcDays,
  CloudAccountCostSummary,
  CloudCostAnomaly,
  CloudCostState,
  fromCloudCostDay,
  getCloudAccountCostSummaryInBasis,
  startOfUtcDay,
  toCloudCostDay,
  getPassedCloudBudgetThresholds,
  readCloudAccountCostSummary,
  readCloudBudgetThresholds,
  toCloudBudgetMonth,
  daysInUtcMonth,
} from "../../../Types/Cloud/CloudCost";
import {
  CloudCostBasis,
  isCloudCostBasis,
  resolveCloudCostBasis,
} from "../../../Types/Cloud/CloudCostBasis";
import {
  CloudCostRule,
  readCloudCostRules,
} from "../../../Types/Cloud/CloudCostRules";
import { getCloudProviderLabel } from "../../../Types/Cloud/CloudPlatform";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudBudgetService from "../../Services/CloudBudgetService";
import CloudCostGroupService from "../../Services/CloudCostGroupService";
import CloudCostSettingService from "../../Services/CloudCostSettingService";
import ProjectService from "../../Services/ProjectService";
import CloudBudgetFigures, {
  CloudBudgetFiguresRead,
} from "../CloudCost/CloudBudgetFigures";
import CloudBudgetNotices, {
  CloudBudgetNoticeFacts,
} from "../CloudCost/CloudBudgetNotices";
import CloudBudgetSpendReader, {
  CloudBudgetDailyServiceTotals,
  CloudBudgetScopeRead,
} from "../CloudCost/CloudBudgetSpendReader";
import logger from "../Logger";
import { OwnerNotificationDelivery } from "../Notification/OwnerNotificationDeliveries";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WATCHES A PROJECT'S CLOUD BUDGETS.
 *
 * Each enabled budget (CloudBudget) is compared with what its scope cost in
 * its window so far and is on course to cost by the window's end. A
 * budget raises an alert:
 *
 *   - the first time in a window the spend passes one of its thresholds
 *     (80% and 100% of the budget by default) - one, for the highest it
 *     passed, when a read finds it past several at once. Below 100%, a
 *     budget that names people to tell tells them instead, with no alert
 *     (CloudBudgetNotices): nobody is paged for spend within the budget;
 *   - once a window, when the window is on course to pass the budget while
 *     it has not yet: a warning before the money is spent;
 *   - unless it is told not to, once for each day that cost far more than
 *     usual, the day after: a budget sees a window, and a spike adds up for
 *     days before it passes a share of one. One alert names every service
 *     that ran high that day, and a spike that goes on is told the day it
 *     began.
 *
 * Its people own every alert it raises, so they hear of those too, and its
 * on-call policies are paged by them.
 *
 * Every figure is on the budget's cost basis (CloudCostBasis, #11007): its
 * own, else its project's - amortized unless someone picked another, so a
 * commitment bought up front does not pass a month's budget in a day.
 *
 * Where the figures come from:
 *
 *   - a monthly budget for every account or one - every budget made before
 *     scopes and periods were - from the accounts' cost summaries, written
 *     after every read of their costs (CloudCostWriter), exactly as it
 *     always was: no query over the costs is made;
 *   - every other budget from the costs themselves (CloudBudgetSpendReader):
 *     its scope's days this month and the week before it, for the spend so
 *     far and the pace; its window's earlier months; and, for a window that
 *     runs past this month, the full months OneUptime keeps, to forecast
 *     the months after this one (CloudCostForecast). Its unusual days are
 *     judged on its scope's own daily spend, by the project-wide rule or
 *     its own.
 *
 * A window is a monthly budget's month, a quarterly or yearly budget's
 * period, or the month of a yearly budget split by month, against that
 * month's share (CloudBudget's getCloudBudgetCheckWindow). A budget's
 * alerts are the alerts of the window they were raised in: when the next
 * starts, the spend starts from nothing again, the open ones are resolved
 * and its thresholds may alert anew. Each alert carries a fingerprint of
 * its budget, window and threshold, so one is never raised twice - whatever
 * two workers do at once - and each notice is told once (CloudBudgetNotices).
 *
 * Runs after a connection reads its costs (the project's budgets), every
 * hour (every budget: a window's end comes without a read) and after a
 * budget is saved (that budget).
 */

export interface CloudBudgetAlertState {
  /*
   * The window the alerts are of: "2026-11" for a monthly budget's month,
   * as it always was; "2026-10/3" a quarter, "2026-04/12" a year, and
   * "2026-11/1" a month of a yearly plan (CloudBudgetMonthsWindow.key).
   */
  month: string;
  // The thresholds passed this window, alerted or told, in percent.
  thresholds: Array<number>;
  // Whether the projection alerted this window.
  projection: boolean;
  /*
   * The unusual days alerted this window: "<account row id>|<day>", or
   * "scope|<day>" for a day of a budget's scope as a whole.
   */
  anomalies: Array<string>;
  // The alerts raised this window: resolved when the window is over.
  alertIds: Array<string>;
}

/*
 * A day that cost far more than usual, as a budget sees it: the account -
 * or the budget's scope as a whole - how it is named, and that day's
 * unusual spend: the whole's first, then each service's.
 */
export interface CloudBudgetAnomalyDay {
  accountRowId: string;
  // "the web-prod account (AWS 123456789012)", "the Payments cost group".
  accountScope: string;
  day: string;
  anomalies: Array<CloudCostAnomaly>;
}

export type CloudBudgetAlertKind =
  | { kind: "threshold"; threshold: number }
  | { kind: "projection" }
  | { kind: "anomaly"; anomalyDay: CloudBudgetAnomalyDay };

// The unusual days of a budget's scope as a whole are kept by this name.
export const CLOUD_BUDGET_SCOPE_ANOMALY_ROW: string = "scope";

// What an unusual day is kept as in a budget's window.
export function getCloudBudgetAnomalyKey(data: {
  accountRowId: string;
  day: string;
}): string {
  return `${data.accountRowId}|${data.day}`;
}

/*
 * An unusual day older than this many days is not alerted on: a cloud
 * whose costs were not read for a while reports a spike that is over.
 */
export const CLOUD_BUDGET_ANOMALY_MAX_AGE_DAYS: number = 7;

// The oldest day an unusual day is alerted on, "2026-11-13".
export function getCloudBudgetOldestAnomalyDay(now: Date): string {
  return toCloudCostDay(
    addUtcDays(startOfUtcDay(now), -CLOUD_BUDGET_ANOMALY_MAX_AGE_DAYS),
  );
}

/*
 * A cost day ("2026-11-19") as an alert says it: "Nov 19" in its title,
 * "November 19, 2026" in its description - words a phone call reads out
 * and an SMS fits, rather than digits and dashes. A cost day is a UTC day,
 * so it is written in UTC whatever the server's own zone.
 */
const ALERT_SHORT_DAY_FORMAT: Intl.DateTimeFormat = new Intl.DateTimeFormat(
  "en-US",
  { timeZone: "UTC", month: "short", day: "numeric" },
);
const ALERT_LONG_DAY_FORMAT: Intl.DateTimeFormat = new Intl.DateTimeFormat(
  "en-US",
  { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" },
);
// A plan month as an alert names it: "November".
const ALERT_MONTH_FORMAT: Intl.DateTimeFormat = new Intl.DateTimeFormat(
  "en-US",
  { timeZone: "UTC", month: "long" },
);

export function formatCloudBudgetAlertDay(
  day: string,
  length: "short" | "long",
): string {
  const date: Date = fromCloudCostDay(day);

  if (Number.isNaN(date.getTime())) {
    return day;
  }

  return (
    length === "short" ? ALERT_SHORT_DAY_FORMAT : ALERT_LONG_DAY_FORMAT
  ).format(date);
}

export interface CloudBudgetSpend {
  spent: number;
  projected: number;
  // Accounts counted: read this month, in the budget's currency.
  accountsCounted: number;
  // Accounts read in another currency, left out.
  accountsInOtherCurrencies: number;
  /*
   * The services that cost the most this month in the accounts counted, the
   * most first: what an alert names as where the money went.
   */
  topServices: Array<{ service: string; amount: number }>;
}

// How many services an alert names as where the money went.
export const CLOUD_BUDGET_ALERT_SERVICES: number = 3;

// Each basis as an alert says it: "This month's amortized cloud spend".
export const CLOUD_BUDGET_BASIS_WORDS: Readonly<
  Record<CloudCostBasis, string>
> = {
  [CloudCostBasis.Billed]: "billed",
  [CloudCostBasis.Amortized]: "amortized",
  [CloudCostBasis.Net]: "net",
};

export interface CloudBudgetDecision {
  raise: Array<CloudBudgetAlertKind>;
  state: CloudBudgetAlertState;
  // Last window's alerts, to resolve.
  resolveAlertIds: Array<string>;
}

/*
 * A window as an alert says it, for every budget but a monthly one read
 * from its accounts' summaries, whose alerts keep the words they always
 * had (describe with no window).
 */
export interface CloudBudgetDescribedWindow {
  noun: "month" | "quarter" | "year";
  // The month of a yearly plan, against its share.
  isPlanMonth: boolean;
  // The window's last day, at its start (UTC).
  lastDay: Date;
  // Whether it holds months after this one, projected as forecast.
  hasLaterMonths: boolean;
  // A plan month's year: the budget's amount.
  yearAmount?: number | undefined;
  /*
   * What a day of its scope as a whole is held to, for its unusual days:
   * the budget's own rule, or the project-wide one.
   */
  unusualDayRule?: CloudBudgetUnusualDayRule | null | undefined;
  // How the scope as a whole is named in an unusual day's list.
  wholeName?: string | undefined;
}

export function readCloudBudgetAlertState(
  value: unknown,
): CloudBudgetAlertState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  if (typeof record["month"] !== "string" || !record["month"]) {
    return null;
  }

  return {
    month: record["month"],
    thresholds: Array.isArray(record["thresholds"])
      ? (record["thresholds"] as Array<unknown>)
          .map((entry: unknown): number => {
            return Number(entry);
          })
          .filter((entry: number): boolean => {
            return Number.isFinite(entry);
          })
      : [],
    projection: record["projection"] === true,
    anomalies: Array.isArray(record["anomalies"])
      ? (record["anomalies"] as Array<unknown>).filter(
          (entry: unknown): entry is string => {
            return typeof entry === "string" && entry.length > 0;
          },
        )
      : [],
    alertIds: Array.isArray(record["alertIds"])
      ? ((record["alertIds"] as Array<unknown>).filter(
          (entry: unknown): boolean => {
            return typeof entry === "string" && ObjectID.isValidUUID(entry);
          },
        ) as Array<string>)
      : [],
  };
}

// An amount as an alert says it: "$4,120.00", "4.120,00 €" left to English.
export function formatCloudBudgetAmount(
  amount: number,
  currency: string,
): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

// The word a window's noun is in a sentence of an alert: "This quarter's".
function windowPossessive(window: CloudBudgetDescribedWindow): string {
  if (window.isPlanMonth) {
    return `${ALERT_MONTH_FORMAT.format(window.lastDay)}'s`;
  }

  return `This ${window.noun}'s`;
}

// How a window's projection was made, in an alert's words.
function projectionPhrase(window: CloudBudgetDescribedWindow): string {
  return window.hasLaterMonths
    ? "With the rest of this month at the pace of the last full week and the months after it as forecast"
    : "At the pace of the last full week";
}

// What a window's amount is, in an alert's words: "the $1,000.00 budget".
function amountPhrase(
  window: CloudBudgetDescribedWindow | undefined,
  amount: string,
  currency: string,
): string {
  if (window?.isPlanMonth && window.yearAmount !== undefined) {
    return `its ${amount} share of the ${formatCloudBudgetAmount(window.yearAmount, currency)} yearly budget`;
  }

  return `the ${amount} budget`;
}

// What a budget's per-check reads share, across a run over many budgets.
interface EvaluationRun {
  projectNames: Map<string, string>;
  // Each project's cost basis, read once a run.
  projectBases: Map<string, CloudCostBasis>;
}

// What a budget's check found: its window, its spend, and its unusual days.
interface CloudBudgetCheck {
  window: CloudBudgetCheckWindow;
  // The window's figures, as decide reads them.
  spend: CloudBudgetSpend;
  monthSpent: number;
  monthProjected: number;
  periodSpent: number;
  periodProjected: number;
  anomalyDays: Array<CloudBudgetAnomalyDay>;
  // How an alert names what the budget counts.
  scope: string;
  // How an alert says the window: none for a budget read from summaries.
  describedWindow?: CloudBudgetDescribedWindow | undefined;
  // The read of its scope, for what an alert names as where the money went.
  read?: CloudBudgetScopeRead | undefined;
  // The cost group's team, told with the budget's own people.
  costGroupTeamId?: ObjectID | undefined;
  // The cost the figures are: the budget's basis.
  basis: CloudCostBasis;
}

export default class CloudBudgetEvaluator {
  /*
   * What a budget's accounts spent this month and are on course to spend,
   * in its currency: an account whose costs were not read this month, or
   * are billed in another currency, is not counted.
   */
  public static computeSpend(data: {
    currency: string;
    summaries: Array<CloudAccountCostSummary | null>;
    now: Date;
  }): CloudBudgetSpend {
    const month: string = toCloudBudgetMonth(data.now);
    const spend: CloudBudgetSpend = {
      spent: 0,
      projected: 0,
      accountsCounted: 0,
      accountsInOtherCurrencies: 0,
      topServices: [],
    };
    const services: Map<string, number> = new Map();

    for (const summary of data.summaries) {
      if (
        !summary ||
        summary.state !== CloudCostState.Reading ||
        !summary.readAt ||
        toCloudBudgetMonth(new Date(summary.readAt)) !== month
      ) {
        continue;
      }

      if (summary.currency.toUpperCase() !== data.currency.toUpperCase()) {
        spend.accountsInOtherCurrencies++;
        continue;
      }

      spend.accountsCounted++;
      spend.spent += summary.monthToDate;
      spend.projected += summary.projectedMonth;

      for (const entry of summary.topServices) {
        services.set(
          entry.service,
          (services.get(entry.service) || 0) + entry.amount,
        );
      }
    }

    spend.spent = Math.round(spend.spent * 100) / 100;
    spend.projected = Math.round(spend.projected * 100) / 100;
    spend.topServices = Array.from(services.entries())
      .map(
        ([service, amount]: [string, number]): {
          service: string;
          amount: number;
        } => {
          return { service, amount: Math.round(amount * 100) / 100 };
        },
      )
      .filter((entry: { service: string; amount: number }): boolean => {
        return entry.service.length > 0 && entry.amount >= 0.01;
      })
      .sort(
        (
          a: { service: string; amount: number },
          b: { service: string; amount: number },
        ): number => {
          return b.amount - a.amount || a.service.localeCompare(b.service);
        },
      )
      .slice(0, CLOUD_BUDGET_ALERT_SERVICES);

    return spend;
  }

  /*
   * What a budget does now: the alerts it raises - the highest threshold it
   * passed for the first time this window, and its projection when the
   * window is on course to pass it - and its state for the window. A
   * window is the month, unless a key of another is handed.
   */
  public static decide(data: {
    amount: number;
    thresholds: Array<number>;
    alertOnProjection: boolean;
    // Whether a day that cost far more than usual alerts.
    alertOnAnomaly?: boolean | undefined;
    // The unusual days of what it counts, their newest full day.
    anomalyDays?: Array<CloudBudgetAnomalyDay> | undefined;
    spend: CloudBudgetSpend;
    state: CloudBudgetAlertState | null;
    now: Date;
    // The window's key (CloudBudgetMonthsWindow.key): the month when absent.
    windowKey?: string | undefined;
  }): CloudBudgetDecision {
    const month: string = data.windowKey || toCloudBudgetMonth(data.now);
    const isNewMonth: boolean = !data.state || data.state.month !== month;
    const resolveAlertIds: Array<string> =
      isNewMonth && data.state ? [...data.state.alertIds] : [];
    const oldestAnomalyDay: string = getCloudBudgetOldestAnomalyDay(data.now);
    const state: CloudBudgetAlertState = isNewMonth
      ? {
          month,
          thresholds: [],
          projection: false,
          /*
           * Last window's unusual days that can still be read again: the
           * last day of a month is judged on the first of the next.
           */
          anomalies: (data.state?.anomalies || []).filter(
            (key: string): boolean => {
              return key.slice(key.lastIndexOf("|") + 1) >= oldestAnomalyDay;
            },
          ),
          alertIds: [],
        }
      : {
          month,
          thresholds: [...data.state!.thresholds],
          projection: data.state!.projection,
          anomalies: [...(data.state!.anomalies || [])],
          alertIds: [...data.state!.alertIds],
        };

    const raise: Array<CloudBudgetAlertKind> = [];

    // Nothing was read this window: nothing is known to have been spent.
    if (data.spend.accountsCounted === 0) {
      return { raise, state, resolveAlertIds };
    }

    const passed: Array<number> = getPassedCloudBudgetThresholds({
      spent: data.spend.spent,
      amount: data.amount,
      thresholds: data.thresholds,
    });
    const newlyPassed: Array<number> = passed.filter(
      (threshold: number): boolean => {
        return !state.thresholds.includes(threshold);
      },
    );

    if (newlyPassed.length > 0) {
      raise.push({
        kind: "threshold",
        threshold: newlyPassed[newlyPassed.length - 1]!,
      });
      state.thresholds = Array.from(
        new Set<number>([...state.thresholds, ...newlyPassed]),
      ).sort((a: number, b: number): number => {
        return a - b;
      });
    }

    if (
      data.alertOnProjection &&
      !state.projection &&
      data.amount > 0 &&
      data.spend.projected >= data.amount &&
      data.spend.spent < data.amount
    ) {
      raise.push({ kind: "projection" });
      state.projection = true;
    }

    // Each unusual day, once.
    if (data.alertOnAnomaly !== false) {
      for (const anomalyDay of data.anomalyDays || []) {
        const key: string = getCloudBudgetAnomalyKey(anomalyDay);

        if (
          anomalyDay.anomalies.length === 0 ||
          state.anomalies.includes(key)
        ) {
          continue;
        }

        raise.push({ kind: "anomaly", anomalyDay });
        state.anomalies.push(key);
      }
    }

    return { raise, state, resolveAlertIds };
  }

  /*
   * The unusual days a budget's accounts had, as it sees them: only an
   * account it counts - read this month, billed in its currency - and only
   * days of the last week, newest first. A spike that goes on for days is
   * told the day it began: a service that ran high the day before too is
   * left out of a day. A day already told is left to decide, so a day a
   * read missed is told when the next read finds it.
   */
  public static getAnomalyDays(data: {
    currency: string;
    accounts: Array<{
      id: string;
      scope: string;
      summary: CloudAccountCostSummary | null;
    }>;
    now: Date;
  }): Array<CloudBudgetAnomalyDay> {
    const month: string = toCloudBudgetMonth(data.now);
    const oldestDay: string = getCloudBudgetOldestAnomalyDay(data.now);
    const days: Array<CloudBudgetAnomalyDay> = [];

    for (const account of data.accounts) {
      const summary: CloudAccountCostSummary | null = account.summary;

      if (
        !summary ||
        summary.state !== CloudCostState.Reading ||
        !summary.readAt ||
        toCloudBudgetMonth(new Date(summary.readAt)) !== month ||
        summary.currency.toUpperCase() !== data.currency.toUpperCase()
      ) {
        continue;
      }

      for (const group of getStartedCloudCostAnomalies(
        groupCloudCostAnomaliesByDay(summary.anomalies || []),
      )) {
        if (group.day >= oldestDay) {
          days.push({
            accountRowId: account.id,
            accountScope: account.scope,
            day: group.day,
            anomalies: group.anomalies,
          });
        }
      }
    }

    return days;
  }

  /*
   * The unusual days of a budget's scope as a whole, from its own daily
   * spend by service: by the budget's own rule - the scope's day at least
   * its amount or percent above usual - or else the project-wide one, the
   * scope's day at one and a half times its usual and a service's at
   * twice. Only the last week's, a spike that goes on told the day it
   * began.
   */
  public static getScopeAnomalyDays(data: {
    dailyServiceTotals: CloudBudgetDailyServiceTotals;
    rule: CloudBudgetUnusualDayRule | null;
    scope: string;
    now: Date;
  }): Array<CloudBudgetAnomalyDay> {
    let latestDay: string | undefined = undefined;

    for (const [day, services] of data.dailyServiceTotals) {
      let total: number = 0;

      for (const amount of services.values()) {
        total += amount;
      }

      if (total !== 0 && (!latestDay || day > latestDay)) {
        latestDay = day;
      }
    }

    const anomalies: Array<CloudCostAnomaly> = data.rule
      ? findCloudBudgetUnusualDays({
          dailyServiceTotals: data.dailyServiceTotals,
          latestDay,
          rule: data.rule,
        })
      : findCloudCostAnomalies({
          dailyServiceTotals: data.dailyServiceTotals,
          latestDay,
        });
    const oldestDay: string = getCloudBudgetOldestAnomalyDay(data.now);
    const grouped: Array<{ day: string; anomalies: Array<CloudCostAnomaly> }> =
      groupCloudCostAnomaliesByDay(anomalies);
    /*
     * A budget's own rule judges the scope as a whole: a spike that goes on
     * is the scope running high the day before too. Its services are named
     * beside it, not judged.
     */
    const started: Array<{ day: string; anomalies: Array<CloudCostAnomaly> }> =
      data.rule
        ? grouped.filter((group: { day: string }): boolean => {
            const dayBefore: string = toCloudCostDay(
              addUtcDays(fromCloudCostDay(group.day), -1),
            );

            return !grouped.some((other: { day: string }): boolean => {
              return other.day === dayBefore;
            });
          })
        : getStartedCloudCostAnomalies(grouped);

    return started
      .filter((group: { day: string }): boolean => {
        return group.day >= oldestDay;
      })
      .map(
        (group: {
          day: string;
          anomalies: Array<CloudCostAnomaly>;
        }): CloudBudgetAnomalyDay => {
          return {
            accountRowId: CLOUD_BUDGET_SCOPE_ANOMALY_ROW,
            accountScope: data.scope,
            day: group.day,
            anomalies: group.anomalies,
          };
        },
      );
  }

  // The fingerprint an alert of a budget's window and threshold is kept apart by.
  public static getFingerprint(data: {
    budgetId: string;
    month: string;
    alert: CloudBudgetAlertKind;
  }): string {
    let kind: string = "projection";

    if (data.alert.kind === "threshold") {
      kind = `threshold-${data.alert.threshold}`;
    } else if (data.alert.kind === "anomaly") {
      kind = `anomaly-${data.alert.anomalyDay.accountRowId}-${data.alert.anomalyDay.day}`;
    }

    return `cloud-budget:${data.budgetId}:${data.month}:${kind}`;
  }

  /*
   * Who an unusual day's alert names in its title: the account - or the
   * scope - when it ran high as a whole (its services' spikes are part of
   * it), or the service that ran furthest above its usual and how many more
   * did - "Amazon EC2 and 2 more services" - so the title never reads as if
   * one service was all of it. The description names every one.
   */
  public static getAnomalyTitleSubject(
    anomalyDay: CloudBudgetAnomalyDay,
  ): string {
    const first: CloudCostAnomaly | undefined = anomalyDay.anomalies[0];

    if (!first || !first.service) {
      return anomalyDay.accountScope;
    }

    const more: number = anomalyDay.anomalies.length - 1;

    if (more <= 0) {
      return first.service;
    }

    return `${first.service} and ${more} more ${more === 1 ? "service" : "services"}`;
  }

  /*
   * One unusual service or account, in a sentence of an alert: "Amazon EC2
   * cost $412.00, 2.3 times its usual $180.00", "the account as a whole cost
   * ...", "AWS Glue cost $40.00, where it usually costs nothing".
   */
  public static describeAnomaly(
    anomaly: CloudCostAnomaly,
    currency: string,
    wholeName: string = "the account as a whole",
  ): string {
    const what: string = anomaly.service || wholeName;
    const amount: string = formatCloudBudgetAmount(anomaly.amount, currency);

    if (anomaly.usual <= 0) {
      return `${what} cost ${amount}, where it usually costs nothing`;
    }

    const ratio: number = getCloudCostAnomalyRatio(anomaly);

    return `${what} cost ${amount}, ${(Math.round(ratio * 10) / 10).toFixed(1)} times its usual ${formatCloudBudgetAmount(anomaly.usual, currency)}`;
  }

  /*
   * What makes a day unusual, as an alert says it: the project-wide rule,
   * or a budget's own.
   */
  public static describeUnusualDayRule(data: {
    window?: CloudBudgetDescribedWindow | undefined;
    currency: string;
  }): string {
    const rule: CloudBudgetUnusualDayRule | null | undefined =
      data.window?.unusualDayRule;
    const usual: string = `A day's usual is the median of the ${CLOUD_COST_ANOMALY_BASELINE_DAYS} days before it`;

    if (rule) {
      return rule.unit === CloudBudgetUnusualDayUnit.Percent
        ? `${usual}: this budget calls a day unusual at ${rule.threshold}% above its usual, and at least ${formatCloudBudgetAmount(10, data.currency)} more.`
        : `${usual}: this budget calls a day unusual at ${formatCloudBudgetAmount(rule.threshold, data.currency)} above its usual.`;
    }

    if (data.window?.wholeName) {
      return `${usual}: a service is unusual at ${CLOUD_COST_ANOMALY_SERVICE_RATIO} times its usual day, the budget's costs as a whole at ${CLOUD_COST_ANOMALY_ACCOUNT_RATIO} times.`;
    }

    return `${usual}: a service is unusual at ${CLOUD_COST_ANOMALY_SERVICE_RATIO} times its usual day, the account as a whole at ${CLOUD_COST_ANOMALY_ACCOUNT_RATIO} times.`;
  }

  /*
   * What an alert says, in English: its title, its description - what was
   * spent, of what, and where the window is heading - and its root cause,
   * where the money went: the services that cost the most in it. An alert
   * whose scope named no service has no root cause, rather than its
   * description said a second time under it.
   *
   * With no window, a monthly budget's words as they always were.
   */
  public static describe(data: {
    budgetName: string;
    scope: string;
    amount: number;
    currency: string;
    spend: CloudBudgetSpend;
    alert: CloudBudgetAlertKind;
    // The cost the budget watches; said in its words when given.
    basis?: CloudCostBasis | undefined;
    now: Date;
    window?: CloudBudgetDescribedWindow | undefined;
  }): { title: string; description: string; rootCause?: string | undefined } {
    // "amortized cloud spend": which of the three costs the figures are.
    const spendWords: string = data.basis
      ? `${CLOUD_BUDGET_BASIS_WORDS[data.basis]} cloud spend`
      : "cloud spend";
    const amount: string = formatCloudBudgetAmount(data.amount, data.currency);
    const spent: string = formatCloudBudgetAmount(
      data.spend.spent,
      data.currency,
    );
    const projected: string = formatCloudBudgetAmount(
      data.spend.projected,
      data.currency,
    );
    const percent: number =
      data.amount > 0 ? Math.round((data.spend.spent / data.amount) * 100) : 0;
    const window: CloudBudgetDescribedWindow | undefined = data.window;
    const daysLeft: number = window
      ? Math.max(
          0,
          Math.round(
            (startOfUtcDay(window.lastDay).getTime() -
              startOfUtcDay(data.now).getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : Math.max(0, daysInUtcMonth(data.now) - data.now.getUTCDate());
    const noun: string = window ? window.noun : "month";
    const possessive: string = window
      ? windowPossessive(window)
      : "This month's";
    const days: string = `${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
    const ofTheBudget: string = amountPhrase(window, amount, data.currency);
    const howProjected: string = window
      ? projectionPhrase(window)
      : "At the pace of the last full week";

    const rootCause: string | undefined =
      CloudBudgetEvaluator.describeTopServices(
        data.spend.topServices,
        data.currency,
        window ? noun : "month",
      );

    if (data.alert.kind === "anomaly") {
      const anomalyDay: CloudBudgetAnomalyDay = data.alert.anomalyDay;
      const named: Array<string> = anomalyDay.anomalies.map(
        (anomaly: CloudCostAnomaly): string => {
          return CloudBudgetEvaluator.describeAnomaly(
            anomaly,
            data.currency,
            window?.wholeName || "the account as a whole",
          );
        },
      );
      const list: string =
        named.length === 1
          ? named[0]!
          : `${named.slice(0, -1).join("; ")}; and ${named[named.length - 1]}`;

      return {
        title: `Cloud budget "${data.budgetName}": ${CloudBudgetEvaluator.getAnomalyTitleSubject(
          anomalyDay,
        )} cost far more than usual on ${formatCloudBudgetAlertDay(anomalyDay.day, "short")}`,
        description: `On ${formatCloudBudgetAlertDay(anomalyDay.day, "long")}, in ${anomalyDay.accountScope}, ${list}. ${CloudBudgetEvaluator.describeUnusualDayRule(
          { window, currency: data.currency },
        )} ${window ? `${possessive} spend` : "This month's spend"} is ${spent} of ${ofTheBudget} (${percent}%), on course for ${projected}.`,
      };
    }

    if (data.alert.kind === "threshold") {
      return {
        title: `Cloud budget "${data.budgetName}" passed ${data.alert.threshold}%`,
        description: `${possessive} ${spendWords} for ${data.scope} is ${spent} of ${ofTheBudget} (${percent}%), with ${days} of the ${noun} to go. ${howProjected}, the ${noun} is on course for ${projected}.`,
        rootCause,
      };
    }

    // "this quarter's" inside the sentence; a month's name keeps its capital.
    const possessiveInSentence: string = possessive.startsWith("This ")
      ? `this ${possessive.slice("This ".length)}`
      : possessive;

    return {
      title: `Cloud budget "${data.budgetName}" is on course to be passed`,
      description: `${howProjected}, ${possessiveInSentence} ${spendWords} for ${data.scope} is on course for ${projected}, over ${ofTheBudget}. ${spent} (${percent}%) is spent so far, with ${days} to go.`,
      rootCause,
    };
  }

  /*
   * Where the money went, as an alert's root cause: "What cost the most this
   * month: Amazon EC2 ($437.87), Amazon S3 ($272.74) and AWS Lambda
   * ($34.84)." Nothing when no service was named.
   */
  public static describeTopServices(
    services: Array<{ service: string; amount: number }>,
    currency: string,
    noun: string = "month",
  ): string | undefined {
    const named: Array<string> = services.map(
      (entry: { service: string; amount: number }): string => {
        return `${entry.service} (${formatCloudBudgetAmount(entry.amount, currency)})`;
      },
    );

    if (named.length === 0) {
      return undefined;
    }

    const list: string =
      named.length === 1
        ? named[0]!
        : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;

    return `What cost the most this ${noun}: ${list}.`;
  }

  /*
   * Whether a budget is checked from its accounts' cost summaries, as every
   * budget was before scopes and periods: a monthly one, for every account
   * or one, with the project-wide unusual-day rule.
   */
  public static isSummaryBudget(budget: CloudBudget): boolean {
    const scope: CloudBudgetScope = readCloudBudgetScope({
      scope: budget.scope,
      cloudAccountId: budget.cloudAccountId,
    });

    return (
      (scope === CloudBudgetScope.AllAccounts ||
        scope === CloudBudgetScope.Account) &&
      readCloudBudgetPeriod(budget.period) === CloudBudgetPeriod.Month &&
      !readCloudBudgetUnusualDayRule({
        threshold: budget.unusualDayThreshold,
        unit: budget.unusualDayThresholdUnit,
      })
    );
  }

  @CaptureSpan()
  public static async evaluateBudgetById(budgetId: ObjectID): Promise<void> {
    const budget: CloudBudget | null = await CloudBudgetService.findOneById({
      id: budgetId,
      select: CloudBudgetEvaluator.BUDGET_SELECT,
      props: { isRoot: true },
    });

    if (budget) {
      await CloudBudgetEvaluator.evaluate(budget, {
        projectNames: new Map(),
        projectBases: new Map(),
      });
    }
  }

  // Every enabled budget of a project: after its accounts' costs are read.
  @CaptureSpan()
  public static async evaluateProject(projectId: ObjectID): Promise<number> {
    const budgets: Array<CloudBudget> = await CloudBudgetService.findBy({
      query: { projectId, isEnabled: true },
      select: CloudBudgetEvaluator.BUDGET_SELECT,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
    const run: EvaluationRun = {
      projectNames: new Map(),
      projectBases: new Map(),
    };

    for (const budget of budgets) {
      await CloudBudgetEvaluator.evaluate(budget, run);
    }

    return budgets.length;
  }

  /*
   * Every enabled budget of every project: the hourly worker. The people a
   * stopped run left untold of a threshold are told first.
   */
  @CaptureSpan()
  public static async evaluateAll(): Promise<number> {
    const run: EvaluationRun = {
      projectNames: new Map(),
      projectBases: new Map(),
    };

    await CloudBudgetNotices.resume({
      readFacts: (data: {
        budgetId: ObjectID;
        threshold: number;
      }): Promise<CloudBudgetNoticeFacts | null> => {
        return CloudBudgetEvaluator.readNoticeFacts({ ...data, run });
      },
    });

    const budgets: Array<CloudBudget> = await CloudBudgetService.findBy({
      query: { isEnabled: true },
      select: CloudBudgetEvaluator.BUDGET_SELECT,
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    for (const budget of budgets) {
      await CloudBudgetEvaluator.evaluate(budget, run);
    }

    return budgets.length;
  }

  /*
   * The basis a budget watches: its own, else its project's (read once per
   * project for a run over many budgets), else the default.
   */
  public static async getBudgetBasis(
    budget: CloudBudget,
    projectBases: Map<string, CloudCostBasis>,
  ): Promise<CloudCostBasis> {
    if (isCloudCostBasis(budget.costBasis)) {
      return budget.costBasis;
    }

    const projectKey: string = budget.projectId!.toString();
    let projectBasis: CloudCostBasis | undefined = projectBases.get(projectKey);

    if (!projectBasis) {
      projectBasis = await CloudCostSettingService.getCostBasisOfProject(
        budget.projectId!,
      );
      projectBases.set(projectKey, projectBasis);
    }

    return resolveCloudCostBasis(projectBasis);
  }

  public static readonly BUDGET_SELECT: {
    _id: true;
    projectId: true;
    name: true;
    isEnabled: true;
    scope: true;
    cloudAccountId: true;
    cloudCostGroupId: true;
    filterRules: true;
    monthlyAmount: true;
    currency: true;
    costBasis: true;
    period: true;
    fiscalYearStartMonth: true;
    planSplit: true;
    monthlyPlan: true;
    alertThresholds: true;
    alertOnProjection: true;
    alertOnAnomaly: true;
    unusualDayThreshold: true;
    unusualDayThresholdUnit: true;
    alertSeverityId: true;
    alertState: true;
    notifyCostGroupTeam: true;
    spentThisMonth: true;
    projectedThisMonth: true;
    spentThisPeriod: true;
    projectedThisPeriod: true;
    onCallDutyPolicies: { _id: true };
    notifyUsers: { _id: true };
    notifyTeams: { _id: true };
  } = {
    _id: true,
    projectId: true,
    name: true,
    isEnabled: true,
    scope: true,
    cloudAccountId: true,
    cloudCostGroupId: true,
    filterRules: true,
    monthlyAmount: true,
    currency: true,
    costBasis: true,
    period: true,
    fiscalYearStartMonth: true,
    planSplit: true,
    monthlyPlan: true,
    alertThresholds: true,
    alertOnProjection: true,
    alertOnAnomaly: true,
    unusualDayThreshold: true,
    unusualDayThresholdUnit: true,
    alertSeverityId: true,
    alertState: true,
    notifyCostGroupTeam: true,
    spentThisMonth: true,
    projectedThisMonth: true,
    spentThisPeriod: true,
    projectedThisPeriod: true,
    onCallDutyPolicies: { _id: true },
    notifyUsers: { _id: true },
    notifyTeams: { _id: true },
  };

  /*
   * A monthly budget for every account or one, from its accounts' cost
   * summaries: exactly as every budget was checked before.
   */
  private static async checkFromSummaries(
    budget: CloudBudget,
    now: Date,
    basis: CloudCostBasis,
  ): Promise<CloudBudgetCheck> {
    const summaryOf: (
      account: CloudAccount,
    ) => CloudAccountCostSummary | null = (
      account: CloudAccount,
    ): CloudAccountCostSummary | null => {
      const summary: CloudAccountCostSummary | null =
        readCloudAccountCostSummary(account.costSummary);

      return summary ? getCloudAccountCostSummaryInBasis(summary, basis) : null;
    };
    const accounts: Array<CloudAccount> = await CloudAccountService.findBy({
      query: budget.cloudAccountId
        ? { projectId: budget.projectId!, _id: budget.cloudAccountId }
        : { projectId: budget.projectId! },
      select: {
        _id: true,
        name: true,
        provider: true,
        accountId: true,
        costSummary: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    const currency: string = (budget.currency || "USD").toUpperCase();
    const spend: CloudBudgetSpend = CloudBudgetEvaluator.computeSpend({
      currency,
      summaries: accounts.map(summaryOf),
      now,
    });

    return {
      window: getCloudBudgetCheckWindow({
        period: CloudBudgetPeriod.Month,
        fiscalYearStartMonth: 1,
        amount: Number(budget.monthlyAmount) || 0,
        planSplit: null,
        monthlyPlan: null,
        now,
      }),
      spend,
      monthSpent: spend.spent,
      monthProjected: spend.projected,
      periodSpent: spend.spent,
      periodProjected: spend.projected,
      anomalyDays: CloudBudgetEvaluator.getAnomalyDays({
        currency,
        accounts: accounts.map(
          (
            account: CloudAccount,
          ): {
            id: string;
            scope: string;
            summary: CloudAccountCostSummary | null;
          } => {
            return {
              id: account.id?.toString() || "",
              scope: CloudBudgetEvaluator.getAccountScope(account),
              summary: summaryOf(account),
            };
          },
        ),
        now,
      }),
      scope:
        budget.cloudAccountId && accounts[0]
          ? CloudBudgetEvaluator.getAccountScope(accounts[0])
          : "every cloud account of the project",
      basis,
    };
  }

  // A budget's filter, as stored; nothing when it no longer reads.
  public static readFilterRules(value: unknown): Array<CloudCostRule> {
    try {
      return readCloudCostRules(value);
    } catch {
      return [];
    }
  }

  /*
   * How an alert names what a budget counts: every account, the account,
   * the cost group, or the costs its filter counts. Null for a budget whose
   * account or group is gone: it is not checked until it is pointed at
   * another, or deleted.
   */
  private static async getScopeWords(data: {
    budget: CloudBudget;
    scope: CloudBudgetScope;
  }): Promise<{ words: string; costGroupTeamId?: ObjectID } | null> {
    if (data.scope === CloudBudgetScope.AllAccounts) {
      return { words: "every cloud account of the project" };
    }

    if (data.scope === CloudBudgetScope.Filter) {
      return { words: "the costs its filter counts" };
    }

    if (data.scope === CloudBudgetScope.Account) {
      if (!data.budget.cloudAccountId) {
        return null;
      }

      const account: CloudAccount | null = await CloudAccountService.findOneBy({
        query: {
          _id: data.budget.cloudAccountId,
          projectId: data.budget.projectId!,
        },
        select: { _id: true, name: true, provider: true, accountId: true },
        props: { isRoot: true },
      });

      return account
        ? { words: CloudBudgetEvaluator.getAccountScope(account) }
        : null;
    }

    if (!data.budget.cloudCostGroupId) {
      return null;
    }

    const group: CloudCostGroup | null = await CloudCostGroupService.findOneBy({
      query: {
        _id: data.budget.cloudCostGroupId,
        projectId: data.budget.projectId!,
      },
      select: { _id: true, name: true, teamId: true },
      props: { isRoot: true },
    });

    if (!group) {
      return null;
    }

    return {
      words: `the ${group.name || "cost group"} cost group`,
      ...(group.teamId ? { costGroupTeamId: group.teamId } : {}),
    };
  }

  /*
   * Every budget but a summary one, from its scope's costs: its window so
   * far, this month at the last full week's pace, its later months as
   * forecast, and its unusual days. Null for a budget whose account or
   * cost group is gone.
   */
  private static async checkFromCosts(
    budget: CloudBudget,
    now: Date,
    basis: CloudCostBasis,
  ): Promise<CloudBudgetCheck | null> {
    const scope: CloudBudgetScope = readCloudBudgetScope({
      scope: budget.scope,
      cloudAccountId: budget.cloudAccountId,
    });
    const scopeWords: {
      words: string;
      costGroupTeamId?: ObjectID;
    } | null = await CloudBudgetEvaluator.getScopeWords({ budget, scope });

    if (!scopeWords) {
      logger.debug(
        `Cloud budget ${budget.id!.toString()}: its ${scope === CloudBudgetScope.CostGroup ? "cost group" : "account"} is gone, so it is not checked.`,
      );
      return null;
    }

    const currency: string = (budget.currency || "USD").toUpperCase();
    const window: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
      period: budget.period,
      fiscalYearStartMonth: budget.fiscalYearStartMonth,
      amount: Number(budget.monthlyAmount) || 0,
      planSplit: budget.planSplit,
      monthlyPlan: budget.monthlyPlan,
      now,
    });
    const read: CloudBudgetScopeRead = {
      projectId: budget.projectId!,
      scope,
      cloudAccountId: budget.cloudAccountId || null,
      cloudCostGroupId: budget.cloudCostGroupId || null,
      filterRules: CloudBudgetEvaluator.readFilterRules(budget.filterRules),
      currency,
      basis,
      props: { isRoot: true },
      now,
    };
    const figures: CloudBudgetFiguresRead = await CloudBudgetFigures.read({
      read,
      window,
      now,
    });

    const rule: CloudBudgetUnusualDayRule | null =
      readCloudBudgetUnusualDayRule({
        threshold: budget.unusualDayThreshold,
        unit: budget.unusualDayThresholdUnit,
      });
    let anomalyDays: Array<CloudBudgetAnomalyDay> = [];

    if (budget.alertOnAnomaly !== false) {
      const today: Date = startOfUtcDay(now);

      anomalyDays = CloudBudgetEvaluator.getScopeAnomalyDays({
        dailyServiceTotals: await CloudBudgetSpendReader.readDaysByService(
          read,
          addUtcDays(
            today,
            -(
              CLOUD_COST_ANOMALY_DAYS_JUDGED + CLOUD_COST_ANOMALY_BASELINE_DAYS
            ),
          ),
          today,
        ),
        rule,
        scope: scopeWords.words,
        now,
      });
    }

    const noun: "month" | "quarter" | "year" = getCloudBudgetWindowNoun(window);
    const thisMonth: string = toCloudBudgetMonth(now);

    return {
      window,
      spend: {
        spent: figures.window.spent,
        projected: figures.window.projected,
        accountsCounted: figures.hasData ? 1 : 0,
        accountsInOtherCurrencies: 0,
        topServices: [],
      },
      monthSpent: figures.window.monthSpent,
      monthProjected: figures.window.monthProjected,
      periodSpent: figures.period.spent,
      periodProjected: figures.period.projected,
      anomalyDays,
      scope: scopeWords.words,
      describedWindow: {
        noun,
        isPlanMonth: window.isPlanMonth,
        lastDay: window.lastDay,
        hasLaterMonths: window.months.some((month: string): boolean => {
          return month > thisMonth;
        }),
        yearAmount: window.isPlanMonth
          ? Number(budget.monthlyAmount) || 0
          : undefined,
        unusualDayRule: rule,
        wholeName: "the budget's costs as a whole",
      },
      read,
      ...(scopeWords.costGroupTeamId
        ? { costGroupTeamId: scopeWords.costGroupTeamId }
        : {}),
      basis,
    };
  }

  /*
   * The people a budget tells: those it names, the members of the teams it
   * names, and - a cost group's budget - the members of the group's team,
   * each once, who may read the project's budgets. And the ids an alert's
   * owners are made of.
   */
  private static async getPeople(data: {
    budget: CloudBudget;
    costGroupTeamId?: ObjectID | undefined;
  }): Promise<{
    readers: Array<User>;
    ownerUserIds: Array<ObjectID>;
    ownerTeamIds: Array<ObjectID>;
  }> {
    const ownerUserIds: Array<ObjectID> = (data.budget.notifyUsers || [])
      .map((user: User): ObjectID | null => {
        return user.id || null;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });
    const ownerTeamIds: Array<ObjectID> = (data.budget.notifyTeams || [])
      .map((team: Team): ObjectID | null => {
        return team.id || null;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

    if (
      data.costGroupTeamId &&
      data.budget.notifyCostGroupTeam !== false &&
      !ownerTeamIds.some((id: ObjectID): boolean => {
        return id.toString() === data.costGroupTeamId!.toString();
      })
    ) {
      ownerTeamIds.push(data.costGroupTeamId);
    }

    if (ownerUserIds.length === 0 && ownerTeamIds.length === 0) {
      return { readers: [], ownerUserIds, ownerTeamIds };
    }

    const people: Array<User> = await CloudBudgetNotices.getPeople({
      projectId: data.budget.projectId!,
      userIds: ownerUserIds,
      teamIds: ownerTeamIds,
    });

    return {
      readers: await CloudBudgetNotices.whoCanRead({
        projectId: data.budget.projectId!,
        people,
      }),
      ownerUserIds,
      ownerTeamIds,
    };
  }

  private static async getProjectName(
    projectId: ObjectID,
    run: EvaluationRun,
  ): Promise<string> {
    const key: string = projectId.toString();
    const known: string | undefined = run.projectNames.get(key);

    if (known !== undefined) {
      return known;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { name: true },
      props: { isRoot: true },
    });
    const name: string = project?.name || "";

    run.projectNames.set(key, name);

    return name;
  }

  /*
   * One budget: its spend, its page's figures, the alerts it raises and
   * the notices it sends, and last window's alerts it resolves. Never
   * throws: one budget's trouble is logged and never stops the others.
   */
  private static async evaluate(
    budget: CloudBudget,
    run: EvaluationRun,
  ): Promise<void> {
    if (!budget.id || !budget.projectId) {
      return;
    }

    try {
      const now: Date = OneUptimeDate.getCurrentDate();
      // The cost it watches: its own basis, else the project's.
      const basis: CloudCostBasis = await CloudBudgetEvaluator.getBudgetBasis(
        budget,
        run.projectBases,
      );
      const check: CloudBudgetCheck | null =
        CloudBudgetEvaluator.isSummaryBudget(budget)
          ? await CloudBudgetEvaluator.checkFromSummaries(budget, now, basis)
          : await CloudBudgetEvaluator.checkFromCosts(budget, now, basis);

      if (!check) {
        return;
      }

      const currency: string = (budget.currency || "USD").toUpperCase();
      const amount: number = check.window.amount;
      const decision: CloudBudgetDecision = CloudBudgetEvaluator.decide({
        amount,
        thresholds: readCloudBudgetThresholds(budget.alertThresholds),
        alertOnProjection: budget.alertOnProjection !== false,
        alertOnAnomaly: budget.alertOnAnomaly !== false,
        anomalyDays: check.anomalyDays,
        spend: check.spend,
        state: readCloudBudgetAlertState(budget.alertState),
        now,
        windowKey: check.window.key,
      });

      for (const alertId of decision.resolveAlertIds) {
        await CloudBudgetEvaluator.resolveAlert({
          projectId: budget.projectId,
          alertId: new ObjectID(alertId),
          previousWindowKey:
            readCloudBudgetAlertState(budget.alertState)?.month || "",
        });
      }

      const notices: Array<{
        delivery: OwnerNotificationDelivery;
        facts: CloudBudgetNoticeFacts;
      }> = [];

      if (decision.raise.length > 0 && budget.isEnabled !== false) {
        const people: {
          readers: Array<User>;
          ownerUserIds: Array<ObjectID>;
          ownerTeamIds: Array<ObjectID>;
        } = await CloudBudgetEvaluator.getPeople({
          budget,
          costGroupTeamId: check.costGroupTeamId,
        });

        // Where the money went: read once, for the alerts that name it.
        if (
          check.read &&
          decision.raise.some((kind: CloudBudgetAlertKind): boolean => {
            return kind.kind !== "anomaly";
          })
        ) {
          check.spend.topServices =
            await CloudBudgetSpendReader.readTopServices(
              check.read,
              check.window.start,
              startOfUtcDay(now),
              CLOUD_BUDGET_ALERT_SERVICES,
            );
        }

        for (const alertKind of decision.raise) {
          if (
            alertKind.kind === "threshold" &&
            isCloudBudgetNoticeOnly({
              threshold: alertKind.threshold,
              hasPeopleToNotify: people.readers.length > 0,
            })
          ) {
            notices.push({
              delivery: await CloudBudgetNotices.plan({
                projectId: budget.projectId,
                budgetId: budget.id,
                windowKey: decision.state.month,
                threshold: alertKind.threshold,
                people: people.readers,
              }),
              facts: await CloudBudgetEvaluator.toNoticeFacts({
                budget,
                check,
                amount,
                currency,
                threshold: alertKind.threshold,
                now,
                run,
              }),
            });
            continue;
          }

          const alertId: ObjectID | null = await CloudBudgetEvaluator.raise({
            budget,
            scope: check.scope,
            amount,
            currency,
            spend: check.spend,
            alert: alertKind,
            month: decision.state.month,
            basis: check.basis,
            now,
            window: check.describedWindow,
            ownerUserIds: people.ownerUserIds,
            ownerTeamIds: people.ownerTeamIds,
          });

          if (alertId) {
            decision.state.alertIds.push(alertId.toString());
          }
        }
      }

      await CloudBudgetService.updateOneById({
        id: budget.id,
        data: {
          spentThisMonth: check.monthSpent,
          projectedThisMonth: check.monthProjected,
          spentThisPeriod: check.periodSpent,
          projectedThisPeriod: check.periodProjected,
          lastCheckedAt: now,
          alertState: decision.state as unknown as JSONObject,
        } as never,
        props: { isRoot: true, ignoreHooks: true },
      });

      // Each told once the budget keeps the threshold as passed.
      for (const notice of notices) {
        await CloudBudgetNotices.tell(notice);
      }
    } catch (error) {
      logger.error(
        `Cloud budget ${budget.id.toString()} could not be checked: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // What a threshold's notice says: the alert's words, and the budget's page.
  private static async toNoticeFacts(data: {
    budget: CloudBudget;
    check: CloudBudgetCheck;
    amount: number;
    currency: string;
    threshold: number;
    now: Date;
    run: EvaluationRun;
  }): Promise<CloudBudgetNoticeFacts> {
    const words: {
      title: string;
      description: string;
      rootCause?: string | undefined;
    } = CloudBudgetEvaluator.describe({
      budgetName: data.budget.name || "Cloud budget",
      scope: data.check.scope,
      amount: data.amount,
      currency: data.currency,
      spend: data.check.spend,
      alert: { kind: "threshold", threshold: data.threshold },
      basis: data.check.basis,
      now: data.now,
      window: data.check.describedWindow,
    });

    return {
      budgetId: data.budget.id!,
      projectId: data.budget.projectId!,
      budgetName: data.budget.name || "Cloud budget",
      projectName: await CloudBudgetEvaluator.getProjectName(
        data.budget.projectId!,
        data.run,
      ),
      threshold: data.threshold,
      title: words.title,
      description: words.description,
      rootCause: words.rootCause,
      budgetLink: await CloudBudgetNotices.getBudgetLink({
        projectId: data.budget.projectId!,
        budgetId: data.budget.id!,
      }),
    };
  }

  /*
   * A threshold's notice a stopped run left untold, told with what the
   * budget says now: its figures as last checked. Null for a budget gone,
   * or turned off.
   */
  private static async readNoticeFacts(data: {
    budgetId: ObjectID;
    threshold: number;
    run: EvaluationRun;
  }): Promise<CloudBudgetNoticeFacts | null> {
    const budget: CloudBudget | null = await CloudBudgetService.findOneById({
      id: data.budgetId,
      select: CloudBudgetEvaluator.BUDGET_SELECT,
      props: { isRoot: true },
    });

    if (!budget || !budget.id || !budget.projectId || !budget.isEnabled) {
      return null;
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const window: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
      period: budget.period,
      fiscalYearStartMonth: budget.fiscalYearStartMonth,
      amount: Number(budget.monthlyAmount) || 0,
      planSplit: budget.planSplit,
      monthlyPlan: budget.monthlyPlan,
      now,
    });
    const scope: CloudBudgetScope = readCloudBudgetScope({
      scope: budget.scope,
      cloudAccountId: budget.cloudAccountId,
    });
    const scopeWords: {
      words: string;
      costGroupTeamId?: ObjectID;
    } | null = await CloudBudgetEvaluator.getScopeWords({ budget, scope });
    const isMonth: boolean = window.isPlanMonth || window.months.length === 1;
    const thisMonth: string = toCloudBudgetMonth(now);
    const basis: CloudCostBasis = await CloudBudgetEvaluator.getBudgetBasis(
      budget,
      data.run.projectBases,
    );

    return CloudBudgetEvaluator.toNoticeFacts({
      budget,
      check: {
        window,
        spend: {
          spent:
            Number(isMonth ? budget.spentThisMonth : budget.spentThisPeriod) ||
            0,
          projected:
            Number(
              isMonth ? budget.projectedThisMonth : budget.projectedThisPeriod,
            ) || 0,
          accountsCounted: 1,
          accountsInOtherCurrencies: 0,
          topServices: [],
        },
        monthSpent: Number(budget.spentThisMonth) || 0,
        monthProjected: Number(budget.projectedThisMonth) || 0,
        periodSpent: Number(budget.spentThisPeriod) || 0,
        periodProjected: Number(budget.projectedThisPeriod) || 0,
        anomalyDays: [],
        scope: scopeWords?.words || "the costs it counts",
        describedWindow: {
          noun: getCloudBudgetWindowNoun(window),
          isPlanMonth: window.isPlanMonth,
          lastDay: window.lastDay,
          hasLaterMonths: window.months.some((month: string): boolean => {
            return month > thisMonth;
          }),
          yearAmount: window.isPlanMonth
            ? Number(budget.monthlyAmount) || 0
            : undefined,
        },
        basis,
      },
      amount: window.amount,
      currency: (budget.currency || "USD").toUpperCase(),
      threshold: data.threshold,
      now,
      run: data.run,
    });
  }

  // An account as an alert names it: "the web-prod account (AWS 123456789012)".
  public static getAccountScope(account: CloudAccount): string {
    return `the ${account.name || account.accountId} account (${getCloudProviderLabel(
      (account.provider as string) || "",
    )} ${account.accountId || ""})`;
  }

  // The severity of a budget's alerts: its own, else the project's least severe.
  private static async getSeverityId(
    budget: CloudBudget,
  ): Promise<ObjectID | null> {
    if (budget.alertSeverityId) {
      return budget.alertSeverityId;
    }

    const severity: AlertSeverity | null = await AlertSeverityService.findOneBy(
      {
        query: { projectId: budget.projectId! },
        select: { _id: true },
        sort: { order: SortOrder.Descending },
        props: { isRoot: true },
      },
    );

    return severity?.id || null;
  }

  /*
   * One alert, unless one of its fingerprint is open already (two workers
   * at once). Returns the alert's id, or null when none was raised. The
   * budget's people own it, so they hear of it.
   */
  private static async raise(data: {
    budget: CloudBudget;
    scope: string;
    amount: number;
    currency: string;
    spend: CloudBudgetSpend;
    alert: CloudBudgetAlertKind;
    month: string;
    basis?: CloudCostBasis | undefined;
    now: Date;
    window?: CloudBudgetDescribedWindow | undefined;
    ownerUserIds?: Array<ObjectID> | undefined;
    ownerTeamIds?: Array<ObjectID> | undefined;
  }): Promise<ObjectID | null> {
    const projectId: ObjectID = data.budget.projectId!;
    const fingerprint: string = CloudBudgetEvaluator.getFingerprint({
      budgetId: data.budget.id!.toString(),
      month: data.month,
      alert: data.alert,
    });

    const open: Array<Alert> = await AlertService.findBy({
      query: {
        projectId,
        seriesFingerprint: fingerprint,
        currentAlertStateId: new Includes(
          await AlertStateService.getUnresolvedAlertStateIds(projectId),
        ),
      },
      select: { _id: true },
      skip: 0,
      limit: 1,
      props: { isRoot: true },
    });

    if (open.length > 0) {
      return null;
    }

    const severityId: ObjectID | null =
      await CloudBudgetEvaluator.getSeverityId(data.budget);

    if (!severityId) {
      logger.error(
        `Cloud budget ${data.budget.id!.toString()}: the project has no alert severity, so its alert could not be raised.`,
      );
      return null;
    }

    const words: {
      title: string;
      description: string;
      rootCause?: string | undefined;
    } = CloudBudgetEvaluator.describe({
      budgetName: data.budget.name || "Cloud budget",
      scope: data.scope,
      amount: data.amount,
      currency: data.currency,
      spend: data.spend,
      alert: data.alert,
      basis: data.basis,
      now: data.now,
      window: data.window,
    });

    const alert: Alert = new Alert();
    alert.projectId = projectId;
    alert.title = words.title;
    alert.description = words.description;

    // Where the money went; never the description a second time.
    if (words.rootCause) {
      alert.rootCause = words.rootCause;
    }
    alert.alertSeverityId = severityId;
    alert.seriesFingerprint = fingerprint;
    alert.isCreatedAutomatically = true;

    const policies: Array<OnCallDutyPolicy> = (
      data.budget.onCallDutyPolicies || []
    ).filter((policy: OnCallDutyPolicy): boolean => {
      return Boolean(policy.id);
    });

    if (policies.length > 0) {
      alert.onCallDutyPolicies = policies.map(
        (policy: OnCallDutyPolicy): OnCallDutyPolicy => {
          const stub: OnCallDutyPolicy = new OnCallDutyPolicy();
          stub.id = policy.id!;
          return stub;
        },
      );
    }

    const ownerUserIds: Array<ObjectID> = data.ownerUserIds || [];
    const ownerTeamIds: Array<ObjectID> = data.ownerTeamIds || [];
    const created: Alert = await AlertService.create({
      data: alert,
      props: { isRoot: true },
      ...(ownerUserIds.length > 0 || ownerTeamIds.length > 0
        ? {
            miscDataProps: {
              ownerUsers: ownerUserIds,
              ownerTeams: ownerTeamIds,
            } as unknown as JSONObject,
          }
        : {}),
    });

    return created?.id || null;
  }

  /*
   * Resolves a last window's alert; one resolved already is left as it is.
   * Its timeline says which window is over: the month, as it always did, or
   * the quarter or the year.
   */
  private static async resolveAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    previousWindowKey?: string | undefined;
  }): Promise<void> {
    const key: string = data.previousWindowKey || "";
    /*
     * Each a whole sentence, so the alert's timeline reads it in the
     * reader's language (Utils/Monitor/StatusChangeNotes): a window's noun
     * put into one sentence would be read in English on every page.
     */
    const rootCause: string = key.endsWith("/3")
      ? "Resolved by OneUptime: the quarter this cloud budget alert was raised in is over."
      : key.endsWith("/12")
        ? "Resolved by OneUptime: the year this cloud budget alert was raised in is over."
        : "Resolved by OneUptime: the month this cloud budget alert was raised in is over.";

    try {
      const timeline: AlertStateTimeline = new AlertStateTimeline();
      timeline.alertId = data.alertId;
      timeline.projectId = data.projectId;
      timeline.alertStateId =
        await AlertStateTimelineService.getResolvedStateIdForProject(
          data.projectId,
        );
      timeline.rootCause = rootCause;

      await AlertStateTimelineService.create({
        data: timeline,
        props: { isRoot: true },
      });
    } catch (error) {
      if (
        error instanceof BadDataException &&
        error.message === "Alert state cannot be same as previous state."
      ) {
        return;
      }

      logger.error(
        `A cloud budget alert ${data.alertId.toString()} could not be resolved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
