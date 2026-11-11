import { DATA_DASHBOARD_USAGE_WINDOW_DAYS } from "../../../../Types/DataObservability/DataDashboardActivity";
import { JSONObject } from "../../../../Types/JSON";
import BiRequestError from "./BiRequestError";
import { BiUsageRange, BiUsageRead, BiViewTally } from "./BiUsage";

/*
 * WHO OPENS EACH POWER BI REPORT AND DASHBOARD, FROM ITS ACTIVITY LOG.
 *
 * Power BI's admin activity events API (admin/activityevents) lists what
 * everyone in the tenant did. It is read the way it allows:
 *
 *  - A request covers one UTC day at most, and only the last 28 days. Power
 *    BI splits a request into its hours anyway - each hour a page of its
 *    own, empty or not - so it is read an hour a request.
 *  - 200 requests an hour. A read sends at most 100, so a Read Now in the
 *    same hour as the hourly read still fits.
 *  - An event can take up to an hour to appear, so the newest hour read is
 *    the one that ended an hour ago.
 *  - A page holds 5,000 to 10,000 events and names the next one
 *    (continuationToken) until the last; a page can be empty and still not
 *    be the last.
 *  - $filter takes Activity and UserId with eq and and only, so views of
 *    reports (ViewReport) and of dashboards (ViewDashboard) are read one
 *    after the other.
 *
 * The hours read are a range kept on the BI tool. Each read adds the hours
 * since, oldest first, then goes back an hour at a time until the 28 days
 * are read: the first read shows the last few days, and the rest fills in
 * over the hours after. An hour counts once both activities are read in
 * full; one cut short by the budget or an error is read again next time.
 */

export interface PowerBiUsageCursor {
  from: Date | null;
  until: Date | null;
}

// The requests one read may send: half of what Power BI allows an hour.
export const POWER_BI_ACTIVITY_REQUEST_BUDGET: number = 100;

// How long an event can take to appear in the activity log.
const ACTIVITY_DELAY_IN_MS: number = 60 * 60 * 1000;

const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

// Room between the oldest hour asked for and the 28 days Power BI reads back.
const OLDEST_HOUR_SLACK_IN_MS: number = 5 * 60 * 1000;

// Pages of one hour of one activity, at most: a page holds thousands of events.
const MAX_PAGES_PER_HOUR: number = 50;

const MAX_ID_LENGTH: number = 100;
const MAX_VIEWER_LENGTH: number = 320;
const MAX_TOKEN_LENGTH: number = 10_000;

export enum PowerBiViewActivity {
  ViewReport = "ViewReport",
  ViewDashboard = "ViewDashboard",
}

const VIEW_ACTIVITIES: ReadonlyArray<PowerBiViewActivity> = [
  PowerBiViewActivity.ViewReport,
  PowerBiViewActivity.ViewDashboard,
];

// Where an event names the item viewed, in the order it is looked for.
const ITEM_ID_FIELDS: Readonly<Record<PowerBiViewActivity, Array<string>>> = {
  // A report viewed in an app names the app's copy, and the report it copies.
  [PowerBiViewActivity.ViewReport]: ["AppReportId", "ReportId", "ArtifactId"],
  [PowerBiViewActivity.ViewDashboard]: ["DashboardId", "ArtifactId"],
};

export interface PowerBiActivityPage {
  events: Array<JSONObject>;
  // The next page's token; null on the last page.
  continuationToken: string | null;
}

export interface PowerBiView {
  externalId: string;
  viewer: string;
  at: Date;
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().slice(0, maxLength)
    : "";
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

// One page of activity events: its events, and the token of the next page while there is one.
export function readPowerBiActivityPage(body: unknown): PowerBiActivityPage {
  const page: JSONObject = readObject(body);
  const events: Array<JSONObject> = (
    Array.isArray(page["activityEventEntities"])
      ? page["activityEventEntities"]
      : []
  )
    .map(readObject)
    .filter((event: JSONObject): boolean => {
      return Object.keys(event).length > 0;
    });
  const token: string = readText(page["continuationToken"], MAX_TOKEN_LENGTH);

  return {
    events,
    continuationToken: page["lastResultSet"] === true || !token ? null : token,
  };
}

/*
 * A view of a listed report or dashboard, from an event: whose, of what, and
 * when. An event of any other activity, of an item not listed, or that says
 * the view failed, is no view.
 */
export function readPowerBiView(
  event: JSONObject,
  // Each listed item's id, in lower case, to the id it is listed under.
  items: Map<string, string>,
): PowerBiView | null {
  const activity: PowerBiViewActivity | undefined = VIEW_ACTIVITIES.find(
    (candidate: PowerBiViewActivity): boolean => {
      return (
        candidate.toLowerCase() ===
        readText(event["Activity"], 100).toLowerCase()
      );
    },
  );
  const at: number = Date.parse(readText(event["CreationTime"], 100));

  if (!activity || event["IsSuccess"] === false || !Number.isFinite(at)) {
    return null;
  }

  for (const field of ITEM_ID_FIELDS[activity]) {
    const externalId: string | undefined = items.get(
      readText(event[field], MAX_ID_LENGTH).toLowerCase(),
    );

    if (externalId) {
      return {
        externalId,
        viewer: (
          readText(event["UserId"], MAX_VIEWER_LENGTH) ||
          readText(event["UserKey"], MAX_VIEWER_LENGTH)
        ).toLowerCase(),
        at: new Date(at),
      };
    }
  }

  return null;
}

// Views counted by item, viewer and hour.
export function tallyPowerBiViews(
  views: Array<PowerBiView>,
): Array<BiViewTally> {
  const tallies: Map<string, BiViewTally> = new Map();

  for (const view of views) {
    const hour: string = new Date(
      Math.floor(view.at.getTime() / HOUR_IN_MS) * HOUR_IN_MS,
    ).toISOString();
    const key: string = `${view.externalId}\u0000${view.viewer}\u0000${hour}`;
    const tally: BiViewTally = tallies.get(key) || {
      externalId: view.externalId,
      viewer: view.viewer,
      hour,
      views: 0,
      lastViewedAt: view.at.toISOString(),
    };

    tally.views++;

    if (view.at.toISOString() > tally.lastViewedAt) {
      tally.lastViewedAt = view.at.toISOString();
    }

    tallies.set(key, tally);
  }

  return Array.from(tallies.values());
}

/*
 * A token as Power BI gives it is already URL-encoded, and one may not be:
 * either way it is sent encoded once.
 */
export function encodeContinuationToken(token: string): string {
  let raw: string = token;

  try {
    raw = decodeURIComponent(token);
  } catch {
    // Not encoded: a % of its own.
  }

  return encodeURIComponent(raw);
}

// The first page of one hour of one activity.
export function getPowerBiActivityPath(
  hourStart: Date,
  activity: PowerBiViewActivity,
): string {
  const start: string = hourStart.toISOString();
  // The hour's last instant: a request's two times are in the same UTC day.
  const end: string = new Date(
    hourStart.getTime() + HOUR_IN_MS - 1,
  ).toISOString();

  return `/admin/activityevents?startDateTime='${start}'&endDateTime='${end}'&$filter=${encodeURIComponent(
    `Activity eq '${activity}'`,
  )}`;
}

// The page after, as Power BI's own continuationUri asks for it.
export function getPowerBiContinuationPath(
  token: string,
  activity: PowerBiViewActivity,
): string {
  return `/admin/activityevents?continuationToken='${encodeContinuationToken(
    token,
  )}'&$filter=${encodeURIComponent(`Activity eq '${activity}'`)}`;
}

function floorToHour(at: number): number {
  return Math.floor(at / HOUR_IN_MS) * HOUR_IN_MS;
}

function ceilToHour(at: number): number {
  return Math.ceil(at / HOUR_IN_MS) * HOUR_IN_MS;
}

class BudgetSpent extends Error {}

export async function readPowerBiUsage(data: {
  // A GET of a path of Power BI's REST API, answering its JSON.
  get: (path: string) => Promise<unknown>;
  cursor: PowerBiUsageCursor;
  now: Date;
  // Each listed report's and dashboard's id, in lower case, to its id as listed.
  items: Map<string, string>;
  requestBudget?: number | undefined;
}): Promise<{ usage: BiUsageRead; warning: string | null }> {
  const budget: number = data.requestBudget ?? POWER_BI_ACTIVITY_REQUEST_BUDGET;
  // The newest hour read has ended an hour ago; the oldest is in Power BI's 28 days.
  const end: number = floorToHour(data.now.getTime() - ACTIVITY_DELAY_IN_MS);
  const oldest: number = ceilToHour(
    data.now.getTime() -
      DATA_DASHBOARD_USAGE_WINDOW_DAYS * DAY_IN_MS +
      OLDEST_HOUR_SLACK_IN_MS,
  );
  let from: number | null = data.cursor.from?.getTime() ?? null;
  let until: number | null = data.cursor.until?.getTime() ?? null;

  // Nothing read yet, or only hours Power BI no longer has: start from the newest.
  if (
    from === null ||
    until === null ||
    !Number.isFinite(from) ||
    !Number.isFinite(until) ||
    from > until ||
    until > end ||
    until < oldest ||
    from % HOUR_IN_MS !== 0 ||
    until % HOUR_IN_MS !== 0
  ) {
    from = end;
    until = end;
  }

  const previous: BiUsageRange = {
    from: new Date(from).toISOString(),
    until: new Date(until).toISOString(),
  };
  const tallies: Array<BiViewTally> = [];
  let requests: number = 0;

  const readHour: (hourStart: number) => Promise<Array<BiViewTally>> = async (
    hourStart: number,
  ): Promise<Array<BiViewTally>> => {
    const views: Array<PowerBiView> = [];

    for (const activity of VIEW_ACTIVITIES) {
      let path: string = getPowerBiActivityPath(new Date(hourStart), activity);

      for (let page: number = 0; ; page++) {
        if (requests >= budget) {
          throw new BudgetSpent();
        }

        if (page >= MAX_PAGES_PER_HOUR) {
          throw new Error(
            `Power BI's activity log did not end after ${MAX_PAGES_PER_HOUR} pages of one hour.`,
          );
        }

        requests++;

        const read: PowerBiActivityPage = readPowerBiActivityPage(
          await data.get(path),
        );

        for (const event of read.events) {
          const view: PowerBiView | null = readPowerBiView(event, data.items);

          if (view) {
            views.push(view);
          }
        }

        if (!read.continuationToken) {
          break;
        }

        path = getPowerBiContinuationPath(read.continuationToken, activity);
      }
    }

    return tallyPowerBiViews(views);
  };

  let warning: string | null = null;

  try {
    // The hours since the last read, oldest first.
    for (let hour: number = until; hour < end; hour += HOUR_IN_MS) {
      tallies.push(...(await readHour(hour)));
      until = hour + HOUR_IN_MS;
    }

    // Then back through the 28 days, newest first.
    for (
      let hour: number = from - HOUR_IN_MS;
      hour >= oldest;
      hour -= HOUR_IN_MS
    ) {
      tallies.push(...(await readHour(hour)));
      from = hour;
    }
  } catch (error) {
    // A spent budget is no failure: the next read goes on from here.
    if (!(error instanceof BudgetSpent)) {
      warning =
        error instanceof BiRequestError && error.statusCode === 429
          ? "Views were not all read: Power BI allows 200 requests of its activity log an hour, and the rest is read next hour."
          : `Views were not all read: ${
              error instanceof Error ? error.message : String(error)
            }`;
    }
  }

  return {
    usage: {
      previous,
      range: {
        from: new Date(from).toISOString(),
        until: new Date(until).toISOString(),
      },
      tallies,
    },
    warning,
  };
}
