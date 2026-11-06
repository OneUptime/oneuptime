import {
  CloudCostAnomaly,
  addUtcDays,
  fromCloudCostDay,
  roundCost,
  toCloudCostDay,
} from "./CloudCost";

/*
 * A DAY THAT COST FAR MORE THAN USUAL.
 *
 * A budget sees a month: by the time a spike - a runaway job, a service
 * left scaled up, a misconfigured export - adds up to a share of a budget,
 * days of it are spent. So after every read of an account's costs, each of
 * its last 14 full days (the days before the newest one read: a cloud
 * reports the newest late and in part, and a part is never a spike) is held
 * to the 14 days before it:
 *
 *   - a service whose day cost twice its usual day or more;
 *   - the whole account, when its day cost half again its usual or more;
 *
 * each only when it is at least 10 more than usual in the account's
 * currency and 5% of the account's usual day, so a few cents never read as
 * a spike. A day's usual is the median of the 14 days before it - one spike
 * in them moves it little - of the days since the account's first cost: a
 * day before it was read is not a zero, so a day is judged only with 7 of
 * them, and a new account never is. A day with no cost since is a zero, and
 * a service new to the account counts: a whole service appearing is the
 * spike a person most wants to hear of.
 *
 * Kept on the account's cost summary (CloudCostWriter): the newest day
 * first, each day's account first and then its services by how far above
 * usual, at most five a day and twenty in all. Budgets that alert on
 * unusual days alert on each day once (CloudBudgetEvaluator), and Costs
 * lists them. React-free and server-safe.
 */

// The days before the one judged that its usual is taken from.
export const CLOUD_COST_ANOMALY_BASELINE_DAYS: number = 14;

// Of those, the days with a cost an account needs before it is judged.
export const CLOUD_COST_ANOMALY_MIN_HISTORY_DAYS: number = 7;

// A service's day this many times its usual is unusual.
export const CLOUD_COST_ANOMALY_SERVICE_RATIO: number = 2;

// The whole account's day this many times its usual is unusual.
export const CLOUD_COST_ANOMALY_ACCOUNT_RATIO: number = 1.5;

// At least this much more than usual, in the account's currency.
export const CLOUD_COST_ANOMALY_MIN_INCREASE: number = 10;

// And at least this share of the account's usual day, in percent.
export const CLOUD_COST_ANOMALY_MIN_SHARE_PERCENT: number = 5;

// The full days judged after a read: the newest one and those before it.
export const CLOUD_COST_ANOMALY_DAYS_JUDGED: number = 14;

// At most this many of a day are kept on an account's summary.
export const CLOUD_COST_ANOMALIES_PER_DAY: number = 5;

// And at most this many in all.
export const CLOUD_COST_ANOMALIES_KEPT: number = 20;

// The median of a set of amounts; 0 for none.
export function getCloudCostMedian(amounts: Array<number>): number {
  const sorted: Array<number> = amounts
    .filter((amount: number): boolean => {
      return Number.isFinite(amount);
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });

  if (sorted.length === 0) {
    return 0;
  }

  const middle: number = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/*
 * The newest day judged: the full day before the newest one read.
 * Undefined with no day read.
 */
export function getCloudCostAnomalyDay(
  latestDay: string | undefined,
): string | undefined {
  if (!latestDay) {
    return undefined;
  }

  const latest: Date = fromCloudCostDay(latestDay);

  return Number.isNaN(latest.getTime())
    ? undefined
    : toCloudCostDay(addUtcDays(latest, -1));
}

// How many times its usual a day cost; Infinity for a day with no usual.
export function getCloudCostAnomalyRatio(anomaly: CloudCostAnomaly): number {
  return anomaly.usual > 0 ? anomaly.amount / anomaly.usual : Infinity;
}

// How far above its usual a day cost, in its currency.
export function getCloudCostAnomalyIncrease(anomaly: CloudCostAnomaly): number {
  return anomaly.amount - anomaly.usual;
}

/*
 * One day's unusual spend against the 14 days before it: the account's
 * own first, then each service's by how far above usual. Nothing for an
 * account without 7 of them since its first cost.
 */
export function findCloudCostDayAnomalies(data: {
  // Each day's cost by service, in one currency: "2026-11-02" -> service -> amount.
  dailyServiceTotals: Map<string, Map<string, number>>;
  // The day judged, "2026-11-19".
  day: string;
}): Array<CloudCostAnomaly> {
  const judged: Date = fromCloudCostDay(data.day);

  if (Number.isNaN(judged.getTime())) {
    return [];
  }

  // The account's first day with a cost: the days before it were not read.
  let firstCostDay: string | undefined = undefined;

  for (const [day, services] of data.dailyServiceTotals) {
    let total: number = 0;

    for (const amount of services.values()) {
      total += amount;
    }

    if (total > 0 && (!firstCostDay || day < firstCostDay)) {
      firstCostDay = day;
    }
  }

  const baselineDays: Array<string> = [];

  for (let back: number = CLOUD_COST_ANOMALY_BASELINE_DAYS; back >= 1; back--) {
    const day: string = toCloudCostDay(addUtcDays(judged, -back));

    if (firstCostDay && day >= firstCostDay) {
      baselineDays.push(day);
    }
  }

  if (baselineDays.length < CLOUD_COST_ANOMALY_MIN_HISTORY_DAYS) {
    return [];
  }

  const dayTotal: (day: string) => number = (day: string): number => {
    let total: number = 0;

    for (const amount of (
      data.dailyServiceTotals.get(day) || new Map<string, number>()
    ).values()) {
      total += amount;
    }

    return total;
  };

  const accountDays: Array<number> = baselineDays.map(dayTotal);
  const accountUsual: number = getCloudCostMedian(accountDays);
  const minIncrease: number = Math.max(
    CLOUD_COST_ANOMALY_MIN_INCREASE,
    (accountUsual * CLOUD_COST_ANOMALY_MIN_SHARE_PERCENT) / 100,
  );

  const isUnusual: (check: {
    amount: number;
    usual: number;
    ratio: number;
  }) => boolean = (check: {
    amount: number;
    usual: number;
    ratio: number;
  }): boolean => {
    return (
      check.amount >= check.usual * check.ratio &&
      check.amount - check.usual >= minIncrease
    );
  };

  const anomalies: Array<CloudCostAnomaly> = [];
  const accountAmount: number = dayTotal(data.day);

  if (
    isUnusual({
      amount: accountAmount,
      usual: accountUsual,
      ratio: CLOUD_COST_ANOMALY_ACCOUNT_RATIO,
    })
  ) {
    anomalies.push({
      day: data.day,
      service: "",
      amount: roundCost(accountAmount),
      usual: roundCost(accountUsual),
    });
  }

  const services: Array<CloudCostAnomaly> = [];

  for (const [service, amount] of data.dailyServiceTotals.get(data.day) ||
    new Map<string, number>()) {
    const usual: number = getCloudCostMedian(
      baselineDays.map((day: string): number => {
        return data.dailyServiceTotals.get(day)?.get(service) || 0;
      }),
    );

    if (isUnusual({ amount, usual, ratio: CLOUD_COST_ANOMALY_SERVICE_RATIO })) {
      services.push({
        day: data.day,
        service,
        amount: roundCost(amount),
        usual: roundCost(usual),
      });
    }
  }

  services.sort((a: CloudCostAnomaly, b: CloudCostAnomaly): number => {
    return (
      getCloudCostAnomalyIncrease(b) - getCloudCostAnomalyIncrease(a) ||
      a.service.localeCompare(b.service)
    );
  });

  return [...anomalies, ...services].slice(0, CLOUD_COST_ANOMALIES_PER_DAY);
}

// An account's unusual days: each of its last full days, newest first.
export function findCloudCostAnomalies(data: {
  // Each day's cost by service, in one currency: "2026-11-02" -> service -> amount.
  dailyServiceTotals: Map<string, Map<string, number>>;
  // The newest day the cloud reported: the days before it are judged.
  latestDay: string | undefined;
  // How many full days are judged, newest first.
  days?: number | undefined;
}): Array<CloudCostAnomaly> {
  const newest: string | undefined = getCloudCostAnomalyDay(data.latestDay);

  if (!newest) {
    return [];
  }

  const anomalies: Array<CloudCostAnomaly> = [];
  const newestDate: Date = fromCloudCostDay(newest);
  const days: number = data.days ?? CLOUD_COST_ANOMALY_DAYS_JUDGED;

  for (let back: number = 0; back < days; back++) {
    anomalies.push(
      ...findCloudCostDayAnomalies({
        dailyServiceTotals: data.dailyServiceTotals,
        day: toCloudCostDay(addUtcDays(newestDate, -back)),
      }),
    );
  }

  return anomalies.slice(0, CLOUD_COST_ANOMALIES_KEPT);
}

/*
 * Unusual days grouped by day, newest first, each day's as kept: what a
 * budget alerts on once a day and Costs lists.
 */
export function groupCloudCostAnomaliesByDay(
  anomalies: Array<CloudCostAnomaly>,
): Array<{ day: string; anomalies: Array<CloudCostAnomaly> }> {
  const byDay: Map<string, Array<CloudCostAnomaly>> = new Map();

  for (const anomaly of anomalies) {
    byDay.set(anomaly.day, [...(byDay.get(anomaly.day) || []), anomaly]);
  }

  return Array.from(byDay.entries())
    .sort(
      (
        a: [string, Array<CloudCostAnomaly>],
        b: [string, Array<CloudCostAnomaly>],
      ): number => {
        return b[0].localeCompare(a[0]);
      },
    )
    .map(([day, entries]: [string, Array<CloudCostAnomaly>]) => {
      return { day, anomalies: entries };
    });
}

/*
 * Each day's unusual spend that began that day: a service - or the whole
 * account - that ran high the day before too is the same spike going on,
 * told the day it began. A day left with nothing that began is left out.
 */
export function getStartedCloudCostAnomalies(
  groups: Array<{ day: string; anomalies: Array<CloudCostAnomaly> }>,
): Array<{ day: string; anomalies: Array<CloudCostAnomaly> }> {
  const servicesByDay: Map<string, Set<string>> = new Map();

  for (const group of groups) {
    servicesByDay.set(
      group.day,
      new Set<string>(
        group.anomalies.map((anomaly: CloudCostAnomaly): string => {
          return anomaly.service;
        }),
      ),
    );
  }

  const started: Array<{ day: string; anomalies: Array<CloudCostAnomaly> }> =
    [];

  for (const group of groups) {
    const dayBefore: Set<string> =
      servicesByDay.get(
        toCloudCostDay(addUtcDays(fromCloudCostDay(group.day), -1)),
      ) || new Set<string>();
    const anomalies: Array<CloudCostAnomaly> = group.anomalies.filter(
      (anomaly: CloudCostAnomaly): boolean => {
        return !dayBefore.has(anomaly.service);
      },
    );

    if (anomalies.length > 0) {
      started.push({ day: group.day, anomalies });
    }
  }

  return started;
}
