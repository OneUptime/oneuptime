/**
 * @timezone America/New_York
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React, { act } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Route from "../../../Types/API/Route";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import {
  UptimeDailyAggregate,
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import Navigation from "../../../UI/Utils/Navigation";
import { NO_DATA_BAR_COLOR } from "../../../UI/Components/Graphs/DayUptimeGraph";
import UptimeDailyAggregateUtil from "../../../Utils/StatusPage/UptimeDailyAggregateUtil";
import DayUptimeGraphUtil from "../../../Utils/Uptime/DayUptimeGraphUtil";
import Overview from "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";

/*
 * Contract under test - the time zone half of the status.chainflip.io grey
 * bars, end to end through the real Overview page, in a New York browser.
 *
 * The overview's uptimeDailyAggregate is cut in UTC days: it is one cached
 * payload per status page, shared by every visitor, so it cannot be cut in
 * each visitor's zone. Before the fix the bars were drawn on the VISITOR's
 * local days and each bar took whichever bucket STARTED inside its local day.
 * A UTC midnight is 20:00 the previous evening in New York, so:
 *
 *   - every bar carried the NEXT UTC day's bucket under its own local date,
 *     so an outage showed up on the day before it happened;
 *   - while the local and UTC dates agree (before 20:00 in New York), no
 *     bucket starts inside today's local day at all, so today's bar had no
 *     reading and fell back to the capped, mis-sorted rows - "no data" on a
 *     monitor that had been up all day.
 *
 * The fix draws the bars on the aggregate's own zone (its `timezone`, UTC for
 * the status page), one bar per bucket, and labels each with its UTC date and
 * " (UTC)" whenever that is not the visitor's own offset.
 *
 * The cap and the sort are covered on their own, in a UTC browser, by
 * StatusPageOverviewUptimeBars.test.tsx; the fixture here is built the same
 * way.
 */

const DAY_MS: number = 24 * 60 * 60 * 1000;
const HOUR_MS: number = 60 * 60 * 1000;
const WINDOW_DAYS: number = 60;

const STATUS_PAGE_ID: string = "40000000-0000-4000-8000-000000000001";
const RESOURCE_ID: string = "30000000-0000-4000-8000-000000000001";
const MONITOR_ID: string = "20000000-0000-4000-8000-000000000001";
const MONITOR_NAME: string = "auctions.chainflip.io";

const OPERATIONAL_STATUS_ID: string = "10000000-0000-4000-8000-000000000001";
const DEGRADED_STATUS_ID: string = "10000000-0000-4000-8000-000000000002";
const OFFLINE_STATUS_ID: string = "10000000-0000-4000-8000-000000000003";

const DOWNTIME_STATUS_IDS: Array<string> = [
  DEGRADED_STATUS_ID,
  OFFLINE_STATUS_ID,
];

const DEFAULT_BAR_COLOR: string = "#5F5F5F";
const GREEN_RULE_COLOR: string = "#46DA93";
const ORANGE_RULE_COLOR: string = "#EC9F0A";
const RED_RULE_COLOR: string = "#F64848";

interface StatusDefinition {
  name: string;
  color: string;
  priority: number;
  isOperationalState: boolean;
}

const STATUSES: Record<string, StatusDefinition> = {
  [OPERATIONAL_STATUS_ID]: {
    name: "Operational",
    color: "#2ab57d",
    priority: 1,
    isOperationalState: true,
  },
  [DEGRADED_STATUS_ID]: {
    name: "Degraded",
    color: "#ffbf53",
    priority: 2,
    isOperationalState: false,
  },
  [OFFLINE_STATUS_ID]: {
    name: "Offline",
    color: "#fd625e",
    priority: 3,
    isOperationalState: false,
  },
};

let mockRespondToPost: () => HTTPResponse<JSONObject> =
  (): HTTPResponse<JSONObject> => {
    throw new Error("mockRespondToPost was not set by the test");
  };

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isLoggedIn: () => {
        return true;
      },
      logout: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: () => {
        return Promise.resolve(mockRespondToPost());
      },
      getDefaultHeaders: () => {
        return {};
      },
      getFriendlyMessage: (error: { message?: string }) => {
        return error?.message || "Something went wrong";
      },
    },
  };
});

// The real page chrome renders breadcrumbs, which need a router.
jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Components/Page/Page",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return <div>{props.children}</div>;
      },
    };
  },
);

/*
 * react-i18next is not initialised in the test environment. Keys resolve
 * against the status page's own English strings, so a bar's accessible name
 * reads "Sep 23, 2026 (UTC): 93.33% uptime" - the one place a test can read
 * a day's date and percentage without hovering.
 */
jest.mock("react-i18next", () => {
  const english: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const lookUp: (key: string, isFlatKey: boolean) => string | undefined = (
    key: string,
    isFlatKey: boolean,
  ): string | undefined => {
    const path: Array<string> = isFlatKey ? [key] : key.split(".");
    let node: unknown = english;

    for (const part of path) {
      if (!node || typeof node !== "object") {
        return undefined;
      }

      node = (node as Record<string, unknown>)[part];
    }

    return typeof node === "string" ? node : undefined;
  };

  // Stable between renders, as a real i18next translation function is.
  const t: (
    key: string,
    opts?: { defaultValue?: string } & Record<string, unknown>,
  ) => string = (
    key: string,
    opts?: { defaultValue?: string } & Record<string, unknown>,
  ): string => {
    let out: string =
      lookUp(key, opts?.["keySeparator"] === false) ??
      opts?.defaultValue ??
      key;

    for (const name of Object.keys(opts || {})) {
      const raw: unknown = (opts as Record<string, unknown>)[name];

      if (
        name === "defaultValue" ||
        (typeof raw !== "string" && typeof raw !== "number")
      ) {
        continue;
      }

      out = out.split(`{{${name}}}`).join(String(raw));
    }

    return out;
  };

  return {
    initReactI18next: {
      type: "3rdParty",
      init: () => {},
    },
    useTranslation: () => {
      return {
        t: t,
        i18n: { resolvedLanguage: "en", language: "en" },
      };
    },
  };
});

/*
 * ---------------------------------------------------------------------------
 * The fixture: capped rows and the server's UTC buckets.
 * ---------------------------------------------------------------------------
 */

interface Transition {
  at: Date;
  statusId: string;
}

interface TimelineRow {
  statusId: string;
  startsAt: Date;
  endsAt: Date | null;
}

interface Scenario {
  now: Date;
  windowStart: Date;
  rows: Array<TimelineRow>;
  buckets: Array<UptimeDayBucket>;
}

// Offline at .326 and Operational again at .540 of the same second.
function blip(second: string): Array<Transition> {
  return [
    { at: new Date(`${second}.326Z`), statusId: OFFLINE_STATUS_ID },
    { at: new Date(`${second}.540Z`), statusId: OPERATIONAL_STATUS_ID },
  ];
}

function hourlyBlips(data: { from: string; to: string }): Array<Transition> {
  const transitions: Array<Transition> = [];

  for (
    let time: number = new Date(`${data.from}.000Z`).getTime();
    time <= new Date(`${data.to}.000Z`).getTime();
    time += HOUR_MS
  ) {
    transitions.push(...blip(new Date(time).toISOString().slice(0, 19)));
  }

  return transitions;
}

// Each row runs to the next transition; the last one is still open.
function rowsFromTransitions(
  transitions: Array<Transition>,
): Array<TimelineRow> {
  return transitions.map(
    (transition: Transition, index: number): TimelineRow => {
      const next: Transition | undefined = transitions[index + 1];

      return {
        statusId: transition.statusId,
        startsAt: transition.at,
        endsAt: next ? next.at : null,
      };
    },
  );
}

/*
 * Offline time on the days whose rows the cap dropped: a little every day,
 * and one real outage on Aug 15 (UTC) - the day the tests watch move.
 */
function droppedOfflineSeconds(dayStart: Date): number {
  if (dayStart.toISOString().slice(0, 10) === "2026-08-15") {
    return 50000;
  }

  return 300 + (dayStart.getUTCDate() % 4) * 100;
}

/*
 * UTC day buckets over the window, as getDailyUptimeAggregate returns them:
 * first bucket clipped to the window start, last ending now, every second
 * covered. The part of a day the page still has rows for is measured from
 * those rows; the part before the oldest row stands for the dropped rows.
 */
function buildBuckets(data: {
  windowStart: Date;
  now: Date;
  rows: Array<TimelineRow>;
}): Array<UptimeDayBucket> {
  const buckets: Array<UptimeDayBucket> = [];
  const oldestRowStart: number = data.rows[0]!.startsAt.getTime();
  const firstDay: Date = new Date(data.windowStart.getTime());
  firstDay.setUTCHours(0, 0, 0, 0);

  for (
    let dayStart: number = firstDay.getTime();
    dayStart < data.now.getTime();
    dayStart += DAY_MS
  ) {
    const start: number = Math.max(dayStart, data.windowStart.getTime());
    const end: number = Math.min(dayStart + DAY_MS, data.now.getTime());

    const seconds: Map<string, number> = new Map<string, number>();

    const add: (statusId: string, value: number) => void = (
      statusId: string,
      value: number,
    ): void => {
      if (value > 0) {
        seconds.set(statusId, (seconds.get(statusId) || 0) + value);
      }
    };

    const droppedSeconds: number =
      Math.max(0, Math.min(end, oldestRowStart) - start) / 1000;

    if (droppedSeconds > 0) {
      const offline: number = Math.min(
        droppedOfflineSeconds(new Date(dayStart)),
        droppedSeconds,
      );

      add(OFFLINE_STATUS_ID, offline);
      add(OPERATIONAL_STATUS_ID, droppedSeconds - offline);
    }

    for (const row of data.rows) {
      const rowStart: number = Math.max(row.startsAt.getTime(), start);
      const rowEnd: number = Math.min(
        row.endsAt ? row.endsAt.getTime() : data.now.getTime(),
        end,
      );

      if (rowEnd > rowStart) {
        add(row.statusId, (rowEnd - rowStart) / 1000);
      }
    }

    const statusDurations: Array<UptimeStatusDuration> = [
      OPERATIONAL_STATUS_ID,
      DEGRADED_STATUS_ID,
      OFFLINE_STATUS_ID,
    ]
      .filter((statusId: string): boolean => {
        return seconds.has(statusId);
      })
      .map((statusId: string): UptimeStatusDuration => {
        return {
          monitorStatusId: new ObjectID(statusId),
          seconds: seconds.get(statusId)!,
        };
      });

    buckets.push({
      bucketStart: new Date(start),
      bucketEnd: new Date(end),
      daySeconds: (end - start) / 1000,
      coveredSeconds: statusDurations.reduce(
        (sum: number, duration: UptimeStatusDuration): number => {
          return sum + duration.seconds;
        },
        0,
      ),
      statusDurations: statusDurations,
    });
  }

  return buckets;
}

function buildScenario(data: {
  now: string;
  transitions: Array<Transition>;
}): Scenario {
  const now: Date = new Date(data.now);
  // the page's window and the server's are both the sixty days before now.
  const windowStart: Date = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const rows: Array<TimelineRow> = rowsFromTransitions(data.transitions);

  return {
    now: now,
    windowStart: windowStart,
    rows: rows,
    buckets: buildBuckets({ windowStart: windowStart, now: now, rows: rows }),
  };
}

/*
 * 22:30 on Sep 22 in New York, which is 02:30 on Sep 23 in UTC: the visitor's
 * date is a day behind the aggregate's. The monitor blipped hourly through
 * Sep 22 (UTC), then had a ten minute outage at 00:30 UTC on Sep 23 and has
 * been Operational since, in a row that is still open.
 */
const EVENING: Scenario = buildScenario({
  now: "2026-09-23T02:30:00.000Z",
  transitions: [
    {
      at: new Date("2026-09-21T01:47:40.540Z"),
      statusId: OPERATIONAL_STATUS_ID,
    },
    ...hourlyBlips({ from: "2026-09-21T02:47:40", to: "2026-09-22T23:47:40" }),
    { at: new Date("2026-09-23T00:30:00.000Z"), statusId: OFFLINE_STATUS_ID },
    {
      at: new Date("2026-09-23T00:40:00.000Z"),
      statusId: OPERATIONAL_STATUS_ID,
    },
  ],
});

/*
 * 15:30 on Sep 22 in New York, 19:30 on Sep 22 in UTC: the same date in both.
 * Exactly production's shape - the last blip was 12:47:40.326 -> .540 UTC the
 * day before, and the monitor has been Operational all of today.
 */
const AFTERNOON: Scenario = buildScenario({
  now: "2026-09-22T19:30:00.000Z",
  transitions: [
    {
      at: new Date("2026-09-20T12:47:40.540Z"),
      statusId: OPERATIONAL_STATUS_ID,
    },
    ...hourlyBlips({ from: "2026-09-20T13:47:40", to: "2026-09-21T12:47:40" }),
  ],
});

type ObjectIdJson = { _type: string; value: string };

function objectId(value: string): ObjectIdJson {
  return { _type: "ObjectID", value: value };
}

function color(value: string): { _type: string; value: string } {
  return { _type: "Color", value: value };
}

function dateTime(value: Date): { _type: string; value: string } {
  return { _type: "DateTime", value: value.toISOString() };
}

function statusJson(statusId: string): JSONObject {
  const status: StatusDefinition = STATUSES[statusId]!;

  return {
    _id: statusId,
    name: status.name,
    color: color(status.color),
    priority: status.priority,
    isOperationalState: status.isOperationalState,
  };
}

// Newest first, the order the server sends them in (startsAt DESC).
function rowsAsSentByTheServer(rows: Array<TimelineRow>): JSONArray {
  return rows
    .map((row: TimelineRow, index: number): JSONObject => {
      return {
        _id: `timeline-${index}`,
        monitorId: objectId(MONITOR_ID),
        monitorStatusId: objectId(row.statusId),
        monitorStatus: statusJson(row.statusId),
        startsAt: dateTime(row.startsAt),
        endsAt: row.endsAt ? dateTime(row.endsAt) : null,
      };
    })
    .reverse();
}

function overviewPayload(scenario: Scenario): JSONObject {
  const aggregate: UptimeDailyAggregate = {
    monitors: [
      { monitorId: new ObjectID(MONITOR_ID), buckets: scenario.buckets },
    ],
    isComplete: true,
    completeFrom: null,
    timezone: "UTC",
  };

  return {
    statusPage: {
      _id: STATUS_PAGE_ID,
      defaultBarColor: color(DEFAULT_BAR_COLOR),
      downtimeMonitorStatuses: DOWNTIME_STATUS_IDS.map(
        (statusId: string): JSONObject => {
          return { _id: statusId };
        },
      ),
      showOverallUptimePercentOnStatusPage: false,
      overallUptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
      showUptimeHistoryInDays: WINDOW_DAYS,
    },
    resourceGroups: [],
    statusPageResources: [
      {
        _id: RESOURCE_ID,
        displayName: MONITOR_NAME,
        showCurrentStatus: true,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.THREE_DECIMAL,
        showStatusHistoryChart: true,
        order: 1,
        monitorId: objectId(MONITOR_ID),
        monitor: {
          _id: MONITOR_ID,
          currentMonitorStatusId: objectId(OPERATIONAL_STATUS_ID),
        },
      },
    ],
    monitorStatuses: [
      statusJson(OPERATIONAL_STATUS_ID),
      statusJson(DEGRADED_STATUS_ID),
      statusJson(OFFLINE_STATUS_ID),
    ],
    monitorStatusTimelines: rowsAsSentByTheServer(scenario.rows),
    uptimeDailyAggregate: UptimeDailyAggregateUtil.toJSON(aggregate),
    statusPageHistoryChartBarColorRules: [
      {
        _id: "50000000-0000-4000-8000-000000000001",
        uptimePercentGreaterThanOrEqualTo: "97",
        barColor: color(GREEN_RULE_COLOR),
        order: 1,
      },
      {
        _id: "50000000-0000-4000-8000-000000000002",
        uptimePercentGreaterThanOrEqualTo: "50",
        barColor: color(ORANGE_RULE_COLOR),
        order: 2,
      },
      {
        _id: "50000000-0000-4000-8000-000000000003",
        uptimePercentGreaterThanOrEqualTo: "0",
        barColor: color(RED_RULE_COLOR),
        order: 3,
      },
    ],
    incidentStateTimelines: [],
    scheduledMaintenanceStateTimelines: [],
    scheduledMaintenanceEvents: [],
    scheduledMaintenanceEventsPublicNotes: [],
    activeAnnouncements: [],
    activeIncidents: [],
    activeEpisodes: [],
    incidentPublicNotes: [],
    episodePublicNotes: [],
    episodeStateTimelines: [],
    timelineIncidents: [],
    monitorsInGroup: {},
    monitorGroupCurrentStatuses: {},
    overallStatus: statusJson(OPERATIONAL_STATUS_ID),
  };
}

async function renderOverview(): Promise<void> {
  await act(async () => {
    render(<Overview pageRoute={new Route("/")} onLoadComplete={() => {}} />);
  });
}

/*
 * ---------------------------------------------------------------------------
 * Reading the page.
 * ---------------------------------------------------------------------------
 */

const MONTHS: Array<string> = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// A bucket's date as the bar must name it: its UTC date, marked as UTC.
function utcDayLabel(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(
    2,
    "0",
  )}, ${date.getUTCFullYear()} (UTC)`;
}

// jsdom reports a style colour as rgb().
function rgb(hex: string): string {
  const value: number = parseInt(hex.replace("#", ""), 16);

  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

function ruleColorFor(percent: number): string {
  if (percent >= 97) {
    return GREEN_RULE_COLOR;
  }

  if (percent >= 50) {
    return ORANGE_RULE_COLOR;
  }

  return RED_RULE_COLOR;
}

// A bucket's uptime, the way the bar computes it from a reading.
function bucketUptimePercent(bucket: UptimeDayBucket): number {
  const downtime: number = Math.min(
    bucket.statusDurations.reduce(
      (sum: number, duration: UptimeStatusDuration): number => {
        return DOWNTIME_STATUS_IDS.includes(duration.monitorStatusId.toString())
          ? sum + duration.seconds
          : sum;
      },
      0,
    ),
    bucket.coveredSeconds,
  );
  const uptime: number = bucket.coveredSeconds - downtime;

  return (uptime / (downtime + uptime)) * 100;
}

function expectedBarLabel(bucket: UptimeDayBucket): string {
  return `${utcDayLabel(bucket.bucketStart)}: ${DayUptimeGraphUtil.formatUptimePercentForLabel(
    bucketUptimePercent(bucket),
  )}% uptime`;
}

function expectedBarColor(bucket: UptimeDayBucket): string {
  return rgb(ruleColorFor(bucketUptimePercent(bucket)));
}

function bars(): Array<HTMLElement> {
  return screen.getAllByTestId("uptime-bar");
}

function barLabel(bar: HTMLElement): string {
  return bar.getAttribute("aria-label") || "";
}

function barColor(bar: HTMLElement): string {
  return bar.style.backgroundColor;
}

function barForDay(day: string): HTMLElement {
  const bar: HTMLElement | undefined = bars().find(
    (candidate: HTMLElement): boolean => {
      return barLabel(candidate).startsWith(`${day}:`);
    },
  );

  if (!bar) {
    throw new Error(
      `No bar is labelled ${day}. Labels: ${bars().map(barLabel).join(" | ")}`,
    );
  }

  return bar;
}

function serveTheOverviewAt(scenario: Scenario): void {
  const navigate: typeof Navigation.navigate = Navigation.navigate;

  beforeEach(() => {
    localStorage.clear();
    LocalStorage.setItem("statusPageId", new ObjectID(STATUS_PAGE_ID));
    window.history.replaceState({}, "", "/");
    Navigation.navigate = (): void => {};
    jest.useFakeTimers();
    jest.setSystemTime(scenario.now);
    mockRespondToPost = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(200, overviewPayload(scenario), {});
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    Navigation.navigate = navigate;
  });
}

describe("Status page overview in New York - the fixture", () => {
  // Not a regression test: it pins what the scenarios below depend on.
  test("the process is in New York, and the two scenarios straddle 20:00 local, when the UTC date rolls over", () => {
    // EDT, four hours behind UTC, throughout the window.
    expect(EVENING.now.getTimezoneOffset()).toBe(240);
    expect(EVENING.windowStart.getTimezoneOffset()).toBe(240);

    // the visitor's date is a day behind the aggregate's...
    expect(EVENING.now.getDate()).toBe(22);
    expect(EVENING.now.getUTCDate()).toBe(23);

    // ...and here the two agree.
    expect(AFTERNOON.now.getDate()).toBe(22);
    expect(AFTERNOON.now.getUTCDate()).toBe(22);
  });

  test("each scenario's buckets are sixty-one UTC days, the window clipped at both ends", () => {
    for (const scenario of [EVENING, AFTERNOON]) {
      expect(scenario.buckets).toHaveLength(61);
      expect(scenario.buckets[0]!.bucketStart.toISOString()).toBe(
        scenario.windowStart.toISOString(),
      );
      expect(scenario.buckets[1]!.bucketStart.getUTCHours()).toBe(0);
      expect(
        scenario.buckets[scenario.buckets.length - 1]!.bucketEnd.toISOString(),
      ).toBe(scenario.now.toISOString());

      for (const bucket of scenario.buckets) {
        expect(bucket.coveredSeconds).toBeCloseTo(bucket.daySeconds, 3);
      }
    }

    expect(
      EVENING.buckets[EVENING.buckets.length - 1]!.bucketStart.toISOString(),
    ).toBe("2026-09-23T00:00:00.000Z");
  });
});

describe("Status page overview in New York - in the evening, when the UTC date is already tomorrow", () => {
  serveTheOverviewAt(EVENING);

  /*
   * One bar per bucket, in order, each named by its bucket's UTC date.
   *
   * Before the fix the bars were the visitor's local days, labelled with
   * local dates and no zone: bar "Sep 22, 2026" carried the Sep 23 UTC
   * bucket, bar "Aug 14, 2026" carried Aug 15's, and so on down the strip.
   */
  test("the strip has one bar per UTC bucket, each labelled with its bucket's UTC date and painted from it", async () => {
    await renderOverview();

    const renderedBars: Array<HTMLElement> = bars();

    expect(renderedBars).toHaveLength(EVENING.buckets.length);
    expect(renderedBars.map(barLabel)).toEqual(
      EVENING.buckets.map(expectedBarLabel),
    );
    expect(renderedBars.map(barColor)).toEqual(
      EVENING.buckets.map(expectedBarColor),
    );

    for (const bar of renderedBars) {
      expect(barColor(bar)).not.toBe(rgb(DEFAULT_BAR_COLOR));
      expect(barColor(bar)).not.toBe(rgb(NO_DATA_BAR_COLOR.toString()));
    }
  });

  /*
   * Today's UTC bucket - 00:00 to 02:30 on Sep 23, with a ten minute outage
   * in it - is the last bar, under its own date.
   *
   * Before the fix the last bar was the visitor's Sep 22: labelled "Sep 22,
   * 2026", and, having events of its own, painted from the local day's rows
   * - 600 s down in about 22.5 hours, ~99.3%, green. The outage's 93.33% was
   * not on any bar.
   */
  test("the last bar is painted from today's UTC bucket, and says which day that is", async () => {
    await renderOverview();

    const lastBar: HTMLElement = bars()[bars().length - 1]!;

    expect(barLabel(lastBar)).toBe("Sep 23, 2026 (UTC): 93.33% uptime");
    expect(barColor(lastBar)).toBe(rgb(ORANGE_RULE_COLOR));
    expect(barLabel(lastBar)).not.toContain("no data");
  });

  /*
   * A fourteen hour outage on Aug 15 (UTC), long before the rows the page
   * holds. Before the fix it was drawn on the bar the visitor saw as Aug 14:
   * a status page telling New York the outage happened the day before it did.
   */
  test("an outage lands on the bar for its own UTC day, not on the local day before it", async () => {
    await renderOverview();

    const outageDay: HTMLElement = barForDay("Aug 15, 2026 (UTC)");

    expect(barLabel(outageDay)).toBe("Aug 15, 2026 (UTC): 42.13% uptime");
    expect(barColor(outageDay)).toBe(rgb(RED_RULE_COLOR));

    expect(barColor(barForDay("Aug 14, 2026 (UTC)"))).toBe(
      rgb(GREEN_RULE_COLOR),
    );
    expect(barColor(barForDay("Aug 16, 2026 (UTC)"))).toBe(
      rgb(GREEN_RULE_COLOR),
    );

    const redBars: Array<HTMLElement> = bars().filter(
      (bar: HTMLElement): boolean => {
        return barColor(bar) === rgb(RED_RULE_COLOR);
      },
    );

    expect(redBars).toHaveLength(1);
    expect(redBars[0]).toBe(outageDay);
  });
});

describe("Status page overview in New York - in the afternoon, when the local and UTC dates agree", () => {
  serveTheOverviewAt(AFTERNOON);

  /*
   * status.chainflip.io's own shape: last blip 12:47:40.326 -> .540 UTC
   * yesterday, Operational ever since in an open row.
   *
   * Before the fix today's LOCAL day ran from 04:00 UTC, and the UTC Sep 22
   * bucket starts at 00:00 UTC - inside the local Sep 21 - so today's bar had
   * no reading. It fell back to the rows, where the open row, sorted ahead of
   * the Offline row from its own second, ended before it began and never
   * reached today. No reading and no events: "Sep 22, 2026: no data", on a
   * monitor that had been up all day.
   */
  test("today's bar is painted from today's UTC bucket instead of being left with no reading", async () => {
    await renderOverview();

    const today: HTMLElement = bars()[bars().length - 1]!;

    expect(barLabel(today)).toBe("Sep 22, 2026 (UTC): 100% uptime");
    expect(barLabel(today)).not.toContain("no data");
    expect(barColor(today)).toBe(rgb(GREEN_RULE_COLOR));
  });

  test("every bar has its bucket: none is grey and none says no data", async () => {
    await renderOverview();

    const renderedBars: Array<HTMLElement> = bars();

    expect(renderedBars).toHaveLength(AFTERNOON.buckets.length);
    expect(renderedBars.map(barLabel)).toEqual(
      AFTERNOON.buckets.map(expectedBarLabel),
    );
    expect(renderedBars.map(barColor)).toEqual(
      AFTERNOON.buckets.map(expectedBarColor),
    );

    for (const bar of renderedBars) {
      expect(barColor(bar)).not.toBe(rgb(DEFAULT_BAR_COLOR));
      expect(barColor(bar)).not.toBe(rgb(NO_DATA_BAR_COLOR.toString()));
      expect(barLabel(bar)).not.toContain("no data");
    }
  });

  /*
   * The header figure comes from the same buckets as the bars, whatever the
   * visitor's zone: a sum over buckets does not depend on where the day
   * boundaries are drawn.
   */
  test("the uptime next to the monitor's name is the buckets' figure", async () => {
    const fromTheBuckets: number | null =
      UptimeDailyAggregateUtil.getUptimePercent({
        buckets: AFTERNOON.buckets,
        downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
        precision: UptimePrecision.THREE_DECIMAL,
      });

    expect(fromTheBuckets).not.toBeNull();

    await renderOverview();

    expect(screen.getByText(MONITOR_NAME)).toBeInTheDocument();
    expect(screen.getByText(`${fromTheBuckets}% uptime`)).toBeInTheDocument();
  });
});

/*
 * 19:30 EST on Dec 14 (00:30 UTC Dec 15). Sixty days back crosses the Nov 1
 * fall-back, so the visitor's "sixty days ago" (sixty CALENDAR days in New
 * York) is 23:30 UTC on Oct 15 while the server's window - exactly sixty
 * times 24 hours, its process runs in UTC - starts at 00:30 UTC on Oct 16.
 */
const FALL_BACK_EVENING: Scenario = buildScenario({
  now: "2026-12-15T00:30:00.000Z",
  transitions: [
    {
      at: new Date("2026-12-13T12:47:40.540Z"),
      statusId: OPERATIONAL_STATUS_ID,
    },
    ...hourlyBlips({ from: "2026-12-13T13:47:40", to: "2026-12-14T12:47:40" }),
  ],
});

/*
 * The server built the payload five seconds before UTC midnight. The same
 * cached payload is served eight seconds later, when the visitor's clock is
 * already on Sep 23 (UTC).
 */
const JUST_BEFORE_UTC_MIDNIGHT: Scenario = buildScenario({
  now: "2026-09-22T23:59:55.000Z",
  transitions: [
    {
      at: new Date("2026-09-20T12:47:40.540Z"),
      statusId: OPERATIONAL_STATUS_ID,
    },
    ...hourlyBlips({ from: "2026-09-20T13:47:40", to: "2026-09-21T12:47:40" }),
  ],
});

describe("Status page overview in New York - the strip is drawn over the server's window", () => {
  describe("an evening whose sixty days cross the fall-back", () => {
    serveTheOverviewAt(FALL_BACK_EVENING);

    /*
     * Drawn over the visitor's own window, the strip started on Oct 15
     * (UTC) - a day the server never bucketed - and drew sixty-two bars, the
     * first of them grey and "no data". It happened every evening from 19:00
     * to 20:00 for the sixty days after each autumn clock change.
     */
    test("there is one bar per bucket and the first one is the server's first bucket", async () => {
      expect(FALL_BACK_EVENING.buckets).toHaveLength(61);
      expect(FALL_BACK_EVENING.buckets[0]!.bucketStart.toISOString()).toBe(
        "2026-10-16T00:30:00.000Z",
      );

      await renderOverview();

      const renderedBars: Array<HTMLElement> = bars();

      expect(renderedBars).toHaveLength(FALL_BACK_EVENING.buckets.length);
      expect(renderedBars.map(barLabel)).toEqual(
        FALL_BACK_EVENING.buckets.map(expectedBarLabel),
      );

      for (const bar of renderedBars) {
        expect(barLabel(bar)).not.toContain("no data");
        expect(barColor(bar)).not.toBe(rgb(NO_DATA_BAR_COLOR.toString()));
      }
    });
  });

  describe("a cached payload served just after UTC midnight", () => {
    const navigate: typeof Navigation.navigate = Navigation.navigate;

    beforeEach(() => {
      localStorage.clear();
      LocalStorage.setItem("statusPageId", new ObjectID(STATUS_PAGE_ID));
      window.history.replaceState({}, "", "/");
      Navigation.navigate = (): void => {};
      jest.useFakeTimers();
      // the visitor's clock is eight seconds past the payload's "now".
      jest.setSystemTime(new Date("2026-09-23T00:00:03.000Z"));
      mockRespondToPost = (): HTTPResponse<JSONObject> => {
        return new HTTPResponse<JSONObject>(
          200,
          overviewPayload(JUST_BEFORE_UTC_MIDNIGHT),
          {},
        );
      };
    });

    afterEach(() => {
      jest.useRealTimers();
      Navigation.navigate = navigate;
    });

    /*
     * Drawn from the visitor's clock, the last bar was Sep 23 (UTC), which
     * the payload has no bucket for: today's bar, grey and "no data" - the
     * symptom this whole change is about - for up to a minute and a quarter
     * after every UTC midnight, or longer on a fast clock.
     */
    test("the last bar is the newest bucket's day, painted from it", async () => {
      await renderOverview();

      const renderedBars: Array<HTMLElement> = bars();

      expect(renderedBars).toHaveLength(
        JUST_BEFORE_UTC_MIDNIGHT.buckets.length,
      );
      expect(barLabel(renderedBars[renderedBars.length - 1]!)).toBe(
        expectedBarLabel(
          JUST_BEFORE_UTC_MIDNIGHT.buckets[
            JUST_BEFORE_UTC_MIDNIGHT.buckets.length - 1
          ]!,
        ),
      );

      for (const bar of renderedBars) {
        expect(barLabel(bar)).not.toContain("no data");
      }
    });
  });
});
