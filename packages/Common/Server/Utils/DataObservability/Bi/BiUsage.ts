import {
  DATA_DASHBOARD_USAGE_WINDOW_DAYS,
  DataDashboardUsageSummary,
  DataDashboardViewer,
  MAX_DATA_DASHBOARD_TOP_VIEWERS,
} from "../../../../Types/DataObservability/DataDashboardActivity";

/*
 * A DASHBOARD'S VIEWS, COUNTED OVER THE LAST 28 DAYS.
 *
 * A tool's activity log is read an hour at a time (PowerBiActivity), and
 * what each hour says - who viewed which dashboard, and how often - is added
 * to the dashboard's ledger: its views by day, and each viewer's views by
 * day. The ledger says which hours it holds, so an hour read twice is added
 * once: the tool's range of hours read is kept after its dashboards are, and
 * a read that stopped in between reads those hours again. Days older than
 * the window are dropped as they pass, and the views, viewers and top
 * viewers shown are counted from what is left.
 */

// One viewer's views of one dashboard in one hour.
export interface BiViewTally {
  // The dashboard, by its id in the tool.
  externalId: string;
  // As the tool names them, in lower case; empty when it names nobody.
  viewer: string;
  // The hour's start: 2026-11-09T10:00:00.000Z.
  hour: string;
  views: number;
  lastViewedAt: string;
}

// Hours read, from one hour's start up to another's: [from, until).
export interface BiUsageRange {
  from: string;
  until: string;
}

export interface BiUsageRead {
  // The hours read before: what every dashboard's ledger holds already.
  previous: BiUsageRange;
  // The hours read now, those before included.
  range: BiUsageRange;
  tallies: Array<BiViewTally>;
}

export interface BiUsageLedger {
  from: string | null;
  until: string | null;
  lastViewedAt: string | null;
  // Views by UTC day: { "2026-11-09": 12 }.
  days: Record<string, number>;
  viewers: Record<
    string,
    { lastViewedAt: string; days: Record<string, number> }
  >;
}

export interface BiUsageSummary {
  viewCount: number;
  viewerCount: number;
  lastViewedAt: Date | null;
  summary: DataDashboardUsageSummary;
}

/*
 * The most viewers a ledger keeps, the latest first: views by day stay
 * exact, and a dashboard opened by more people than this counts this many.
 */
export const MAX_LEDGER_VIEWERS: number = 500;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// A day as a ledger keys it: 2026-11-09.
const DAY_KEY: RegExp = /^\d{4}-\d{2}-\d{2}$/;

// Usage counted from less than this much of the window says since when.
const SINCE_SLACK_IN_MS: number = DAY_IN_MS;

function isTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function time(value: string): number {
  return Date.parse(value);
}

function readDays(value: unknown): Record<string, number> {
  const days: Record<string, number> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return days;
  }

  for (const [day, views] of Object.entries(value as Record<string, unknown>)) {
    if (
      DAY_KEY.test(day) &&
      typeof views === "number" &&
      Number.isFinite(views) &&
      views > 0
    ) {
      days[day] = Math.floor(views);
    }
  }

  return days;
}

export function emptyBiUsageLedger(): BiUsageLedger {
  return { from: null, until: null, lastViewedAt: null, days: {}, viewers: {} };
}

// A ledger as kept, or an empty one: nothing kept is trusted to fit.
export function readBiUsageLedger(value: unknown): BiUsageLedger {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyBiUsageLedger();
  }

  const kept: Record<string, unknown> = value as Record<string, unknown>;
  const viewers: BiUsageLedger["viewers"] = {};
  const keptViewers: unknown = kept["viewers"];

  if (
    keptViewers &&
    typeof keptViewers === "object" &&
    !Array.isArray(keptViewers)
  ) {
    for (const [viewer, entry] of Object.entries(
      keptViewers as Record<string, unknown>,
    )) {
      const item: Record<string, unknown> =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : {};

      if (viewer && isTime(item["lastViewedAt"])) {
        viewers[viewer] = {
          lastViewedAt: item["lastViewedAt"],
          days: readDays(item["days"]),
        };
      }
    }
  }

  const from: unknown = kept["from"];
  const until: unknown = kept["until"];

  return {
    from: isTime(from) && isTime(until) ? from : null,
    until: isTime(from) && isTime(until) ? until : null,
    lastViewedAt: isTime(kept["lastViewedAt"]) ? kept["lastViewedAt"] : null,
    days: readDays(kept["days"]),
    viewers,
  };
}

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

// The first day counted: 28 days with today's.
function getWindowStartDay(now: Date): string {
  return utcDay(
    now.getTime() - (DATA_DASHBOARD_USAGE_WINDOW_DAYS - 1) * DAY_IN_MS,
  );
}

function later(a: string | null, b: string): string {
  return a && time(a) >= time(b) ? a : b;
}

/*
 * A dashboard's ledger with a read's hours added: each tally of an hour the
 * ledger does not hold yet. A ledger that does not hold every hour read
 * before - a dashboard new to the tool, or one kept when the tool's range
 * started over - is taken as holding exactly those: the dashboard was not
 * there to be viewed, or its views then are gone from the window.
 */
export function mergeBiUsage(data: {
  ledger: BiUsageLedger;
  read: BiUsageRead;
  // This dashboard's tallies of the read.
  tallies: Array<BiViewTally>;
  now: Date;
}): BiUsageLedger {
  const previous: BiUsageRange = data.read.previous;
  const holdsPrevious: boolean = Boolean(
    data.ledger.from &&
      data.ledger.until &&
      time(data.ledger.from) <= time(previous.from) &&
      time(data.ledger.until) >= time(previous.until),
  );
  const from: string = holdsPrevious ? data.ledger.from! : previous.from;
  const until: string = holdsPrevious ? data.ledger.until! : previous.until;
  const ledger: BiUsageLedger = {
    from,
    until,
    lastViewedAt: data.ledger.lastViewedAt,
    days: { ...data.ledger.days },
    viewers: {},
  };

  for (const [viewer, entry] of Object.entries(data.ledger.viewers)) {
    ledger.viewers[viewer] = {
      lastViewedAt: entry.lastViewedAt,
      days: { ...entry.days },
    };
  }

  for (const tally of data.tallies) {
    const hour: number = time(tally.hour);

    if (
      !Number.isFinite(hour) ||
      !(tally.views > 0) ||
      !isTime(tally.lastViewedAt) ||
      (hour >= time(from) && hour < time(until))
    ) {
      continue;
    }

    const day: string = utcDay(hour);

    ledger.days[day] = (ledger.days[day] || 0) + tally.views;
    ledger.lastViewedAt = later(ledger.lastViewedAt, tally.lastViewedAt);

    if (tally.viewer) {
      const entry: { lastViewedAt: string; days: Record<string, number> } =
        ledger.viewers[tally.viewer] || {
          lastViewedAt: tally.lastViewedAt,
          days: {},
        };

      entry.days[day] = (entry.days[day] || 0) + tally.views;
      entry.lastViewedAt = later(entry.lastViewedAt, tally.lastViewedAt);
      ledger.viewers[tally.viewer] = entry;
    }
  }

  ledger.from =
    time(data.read.range.from) < time(from) ? data.read.range.from : from;
  ledger.until =
    time(data.read.range.until) > time(until) ? data.read.range.until : until;

  // Days that left the window are dropped, and viewers with none left.
  const firstDay: string = getWindowStartDay(data.now);

  for (const day of Object.keys(ledger.days)) {
    if (day < firstDay) {
      delete ledger.days[day];
    }
  }

  for (const [viewer, entry] of Object.entries(ledger.viewers)) {
    for (const day of Object.keys(entry.days)) {
      if (day < firstDay) {
        delete entry.days[day];
      }
    }

    if (Object.keys(entry.days).length === 0) {
      delete ledger.viewers[viewer];
    }
  }

  const viewers: Array<string> = Object.keys(ledger.viewers);

  if (viewers.length > MAX_LEDGER_VIEWERS) {
    viewers
      .sort((a: string, b: string): number => {
        return (
          time(ledger.viewers[b]!.lastViewedAt) -
          time(ledger.viewers[a]!.lastViewedAt)
        );
      })
      .slice(MAX_LEDGER_VIEWERS)
      .forEach((viewer: string): void => {
        delete ledger.viewers[viewer];
      });
  }

  return ledger;
}

function sumDays(days: Record<string, number>, firstDay: string): number {
  let views: number = 0;

  for (const [day, count] of Object.entries(days)) {
    if (day >= firstDay) {
      views += count;
    }
  }

  return views;
}

// What a ledger says of the last 28 days: views, viewers, the latest view, and who views most.
export function summarizeBiUsage(
  ledger: BiUsageLedger,
  now: Date,
): BiUsageSummary {
  const firstDay: string = getWindowStartDay(now);
  const viewers: Array<DataDashboardViewer> = [];

  for (const [viewer, entry] of Object.entries(ledger.viewers)) {
    const views: number = sumDays(entry.days, firstDay);

    if (views > 0) {
      viewers.push({ viewer, views, lastViewedAt: entry.lastViewedAt });
    }
  }

  viewers.sort((a: DataDashboardViewer, b: DataDashboardViewer): number => {
    return b.views - a.views || time(b.lastViewedAt) - time(a.lastViewedAt);
  });

  const windowStart: number =
    now.getTime() - DATA_DASHBOARD_USAGE_WINDOW_DAYS * DAY_IN_MS;

  return {
    viewCount: sumDays(ledger.days, firstDay),
    viewerCount: viewers.length,
    lastViewedAt: ledger.lastViewedAt ? new Date(ledger.lastViewedAt) : null,
    summary: {
      since:
        ledger.from && time(ledger.from) > windowStart + SINCE_SLACK_IN_MS
          ? ledger.from
          : null,
      topViewers: viewers.slice(0, MAX_DATA_DASHBOARD_TOP_VIEWERS),
    },
  };
}

// A read's tallies, by the dashboard they are of.
export function groupBiViewTallies(
  tallies: Array<BiViewTally>,
): Map<string, Array<BiViewTally>> {
  const grouped: Map<string, Array<BiViewTally>> = new Map();

  for (const tally of tallies) {
    const list: Array<BiViewTally> = grouped.get(tally.externalId) || [];

    list.push(tally);
    grouped.set(tally.externalId, list);
  }

  return grouped;
}
