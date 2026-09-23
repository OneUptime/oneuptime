/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
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
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import Navigation from "../../../UI/Utils/Navigation";
import { NO_DATA_BAR_COLOR } from "../../../UI/Components/Graphs/DayUptimeGraph";
import UptimeDailyAggregateUtil from "../../../Utils/StatusPage/UptimeDailyAggregateUtil";
import DayUptimeGraphUtil from "../../../Utils/Uptime/DayUptimeGraphUtil";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
import Overview from "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";

/*
 * Contract under test - the uptime bars and figures of a status page overview
 * for a FLAPPING monitor, end to end through the real Overview page, modelled
 * on status.chainflip.io (lp / auctions / scan).
 *
 * What that page showed, and why:
 *
 *   - The timeline rows arrive under a 10,000 row cap that is global across
 *     the page and newest-first. A flapping monitor writes a row pair every
 *     time it blips, so the cap leaves the browser only the last few days of
 *     a sixty day window. The server's per-day aggregate (uptimeDailyAggregate)
 *     is measured from every row, but the page still let the capped rows
 *     decide the day the cap cuts through, the header uptime and the overall
 *     uptime.
 *
 *   - A blip is Offline at hh:mm:ss.326 and Operational again at .540 of the
 *     SAME second. The browser sorted rows at second granularity, so the pair
 *     kept the server's newest-first order: the still-open Operational row
 *     sorted before the Offline row, took that row's start as its end, and
 *     ended before it began. The monitor's current status then never reached
 *     "now", and today's bar was painted from whatever sliver was left.
 *
 * The time zone half of the bug (UTC buckets drawn on a visitor's local
 * days) is in StatusPageOverviewUptimeBars.NewYork.test.tsx. This file runs
 * in UTC, where bars and buckets share their day boundaries anyway, so what
 * it isolates is the cap and the sort.
 */

const DAY_MS: number = 24 * 60 * 60 * 1000;
const HOUR_MS: number = 60 * 60 * 1000;
const WINDOW_DAYS: number = 60;

/*
 * "Now" is pinned. The page's window is the sixty days before it, and the
 * server's aggregate is cut over exactly the same window.
 */
const NOW: Date = new Date("2026-09-22T15:30:00.000Z");
const WINDOW_START: Date = new Date(NOW.getTime() - WINDOW_DAYS * DAY_MS);

const STATUS_PAGE_ID: string = "40000000-0000-4000-8000-000000000001";
const RESOURCE_ID: string = "30000000-0000-4000-8000-000000000001";
const MONITOR_ID: string = "20000000-0000-4000-8000-000000000001";
const OTHER_MONITOR_ID: string = "20000000-0000-4000-8000-000000000002";
const MONITOR_NAME: string = "lp.chainflip.io";

const OPERATIONAL_STATUS_ID: string = "10000000-0000-4000-8000-000000000001";
const DEGRADED_STATUS_ID: string = "10000000-0000-4000-8000-000000000002";
const OFFLINE_STATUS_ID: string = "10000000-0000-4000-8000-000000000003";

const DOWNTIME_STATUS_IDS: Array<string> = [
  DEGRADED_STATUS_ID,
  OFFLINE_STATUS_ID,
];

// status.chainflip.io's own configuration.
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
 * react-i18next is not initialised in the test environment.
 *
 * Unlike the stub in StatusPageOverviewLiveAndSearch.test.tsx, this one
 * resolves keys against the status page's own English strings, so the page
 * reads here the way a visitor reads it: "98.309% uptime" next to the
 * monitor, "Sep 22, 2026: 99.99% uptime" on a bar. The bars' accessible names
 * are the one place a test can read a day's percentage without hovering, and
 * with bare keys they would say only "uptimeHistory.dayLabel".
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
 * The timeline rows the page receives.
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

/*
 * One blip exactly as production writes it: Offline at .326 and Operational
 * again at .540 of the same wall-clock second.
 */
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
 * What survives the 10,000 row cap on a page with flapping monitors: about
 * two days. The oldest row the page gets is an Operational row that started
 * at 17:47:40.540 on Sep 20 - the cap cut straight through that day. After it
 * the monitor blips every hour, and its last blip is one second after UTC
 * midnight today. It has been Operational ever since, in a row that is
 * still open.
 */
const ROWS: Array<TimelineRow> = rowsFromTransitions([
  {
    at: new Date("2026-09-20T17:47:40.540Z"),
    statusId: OPERATIONAL_STATUS_ID,
  },
  ...hourlyBlips({ from: "2026-09-20T18:47:40", to: "2026-09-21T23:47:40" }),
  ...blip("2026-09-22T00:00:01"),
]);

const OLDEST_ROW_STARTS_AT: Date = ROWS[0]!.startsAt;

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

/*
 * ---------------------------------------------------------------------------
 * The server's per-day aggregate.
 * ---------------------------------------------------------------------------
 */

/*
 * Offline time on the days whose rows the cap dropped. Every day had a
 * little; two had real outages, and the day the cap cut through lost a 90
 * minute outage along with its morning rows.
 */
const DROPPED_OUTAGE_SECONDS: Record<string, number> = {
  "2026-08-15": 50000,
  "2026-08-30": 7200,
  "2026-09-20": 5400,
};

function droppedOfflineSeconds(dayStart: Date): number {
  const day: string = dayStart.toISOString().slice(0, 10);

  return DROPPED_OUTAGE_SECONDS[day] ?? 300 + (dayStart.getUTCDate() % 4) * 100;
}

/*
 * UTC day buckets over the window, the shape getDailyUptimeAggregate returns:
 * the first bucket clipped to the window start, the last ending now, every
 * second covered. The part of a day the page still has rows for is measured
 * from those rows, as the server measures it; the part before the oldest row
 * stands for the rows the cap dropped.
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

const BUCKETS: Array<UptimeDayBucket> = buildBuckets({
  windowStart: WINDOW_START,
  now: NOW,
  rows: ROWS,
});

// The aggregate in its wire format, as the overview endpoint serves it.
function aggregateJson(monitorId: string): JSONObject {
  const aggregate: UptimeDailyAggregate = {
    monitors: [{ monitorId: new ObjectID(monitorId), buckets: BUCKETS }],
    isComplete: true,
    completeFrom: null,
    timezone: "UTC",
  };

  return UptimeDailyAggregateUtil.toJSON(aggregate);
}

/*
 * ---------------------------------------------------------------------------
 * The overview payload.
 * ---------------------------------------------------------------------------
 */

function overviewPayload(data: {
  uptimeDailyAggregate: JSONObject | undefined;
  showOverallUptimePercentOnStatusPage?: boolean | undefined;
}): JSONObject {
  const payload: JSONObject = {
    statusPage: {
      _id: STATUS_PAGE_ID,
      defaultBarColor: color(DEFAULT_BAR_COLOR),
      // ids only, as production sends them.
      downtimeMonitorStatuses: DOWNTIME_STATUS_IDS.map(
        (statusId: string): JSONObject => {
          return { _id: statusId };
        },
      ),
      showOverallUptimePercentOnStatusPage: Boolean(
        data.showOverallUptimePercentOnStatusPage,
      ),
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
    monitorStatusTimelines: rowsAsSentByTheServer(ROWS),
    // status.chainflip.io's rules, thresholds as strings as the wire has them.
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

  if (data.uptimeDailyAggregate) {
    payload["uptimeDailyAggregate"] = data.uptimeDailyAggregate;
  }

  return payload;
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

function utcDateLabel(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(
    2,
    "0",
  )}, ${date.getUTCFullYear()}`;
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
  return `${utcDateLabel(bucket.bucketStart)}: ${DayUptimeGraphUtil.formatUptimePercentForLabel(
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

function rowModels(): Array<MonitorStatusTimeline> {
  return BaseModel.fromJSONArray(
    rowsAsSentByTheServer(ROWS),
    MonitorStatusTimeline,
  );
}

function downtimeStatusModels(): Array<MonitorStatus> {
  return BaseModel.fromJSONArray(
    DOWNTIME_STATUS_IDS.map((statusId: string): JSONObject => {
      return { _id: statusId };
    }),
    MonitorStatus,
  );
}

// What the pre-fix page showed: uptime over the rows that survived the cap.
function uptimeFromTheCappedRows(precision: UptimePrecision): number {
  return UptimeUtil.calculateUptimePercentage(
    rowModels(),
    precision,
    downtimeStatusModels(),
    { startDate: WINDOW_START, endDate: NOW },
  );
}

function uptimeFromTheBuckets(precision: UptimePrecision): number {
  const percent: number | null = UptimeDailyAggregateUtil.getUptimePercent({
    buckets: BUCKETS,
    downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
    precision: precision,
  });

  if (percent === null) {
    throw new Error("The fixture's buckets must cover time.");
  }

  return percent;
}

function pinTheClockAndServeTheOverview(): void {
  const navigate: typeof Navigation.navigate = Navigation.navigate;

  beforeEach(() => {
    localStorage.clear();
    LocalStorage.setItem("statusPageId", new ObjectID(STATUS_PAGE_ID));
    window.history.replaceState({}, "", "/");
    Navigation.navigate = (): void => {};
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockRespondToPost = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        overviewPayload({ uptimeDailyAggregate: aggregateJson(MONITOR_ID) }),
        {},
      );
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    Navigation.navigate = navigate;
  });
}

describe("Status page overview - the fixture looks like status.chainflip.io", () => {
  /*
   * Not a regression test: it pins the shape of the data the tests below
   * rely on, so a later edit to the fixture cannot quietly stop it from
   * modelling the production page.
   */
  test("the rows are two days of the window, newest first, blipping within one second, ending in an open Operational row", () => {
    const sent: JSONArray = rowsAsSentByTheServer(ROWS);
    const newest: JSONObject = sent[0]!;

    expect(newest["endsAt"]).toBeNull();
    expect((newest["monitorStatus"] as JSONObject)["name"]).toBe("Operational");
    expect(
      ((sent[1]!["monitorStatus"] as JSONObject)["name"] as string) +
        " " +
        ((sent[1]!["startsAt"] as JSONObject)["value"] as string),
    ).toBe("Offline 2026-09-22T00:00:01.326Z");

    // two days and a bit of a sixty day window.
    expect(NOW.getTime() - OLDEST_ROW_STARTS_AT.getTime()).toBeLessThan(
      3 * DAY_MS,
    );

    const sameSecondPairs: number = ROWS.filter(
      (row: TimelineRow, index: number): boolean => {
        const next: TimelineRow | undefined = ROWS[index + 1];

        return Boolean(
          next &&
            row.statusId === OFFLINE_STATUS_ID &&
            Math.floor(row.startsAt.getTime() / 1000) ===
              Math.floor(next.startsAt.getTime() / 1000),
        );
      },
    ).length;

    expect(sameSecondPairs).toBe(31);
  });

  test("the buckets are UTC days over the whole window, every second of it covered", () => {
    expect(BUCKETS).toHaveLength(61);
    expect(BUCKETS[0]!.bucketStart.toISOString()).toBe(
      WINDOW_START.toISOString(),
    );
    expect(BUCKETS[1]!.bucketStart.toISOString()).toBe(
      "2026-07-25T00:00:00.000Z",
    );
    expect(BUCKETS[BUCKETS.length - 1]!.bucketEnd.toISOString()).toBe(
      NOW.toISOString(),
    );

    for (const bucket of BUCKETS) {
      expect(bucket.coveredSeconds).toBeCloseTo(bucket.daySeconds, 3);
      expect(
        bucket.statusDurations.some((duration: UptimeStatusDuration) => {
          return duration.monitorStatusId.toString() === OFFLINE_STATUS_ID;
        }),
      ).toBe(true);
    }

    expect(
      UptimeDailyAggregateUtil.fromJSON(aggregateJson(MONITOR_ID)).timezone,
    ).toBe("UTC");
  });
});

describe("Status page overview - bars of a flapping monitor under the row cap", () => {
  pinTheClockAndServeTheOverview();

  /*
   * The whole strip at once: sixty-one bars, sixty-one buckets, each bar its
   * own bucket's rule colour and percentage.
   *
   * Before the fix two of these bars were not: the day the cap cut through
   * (Sep 20) was painted from the six hours of rows that survived, ~100% and
   * green, and today was painted from the 1.3 seconds of events the mis-sorted
   * open row left behind, 83.86% and orange (see the two tests below).
   */
  test("no bar is grey: every one of the sixty-one days is painted by a colour rule from its own bucket", async () => {
    await renderOverview();

    const renderedBars: Array<HTMLElement> = bars();

    expect(renderedBars).toHaveLength(BUCKETS.length);
    expect(renderedBars.map(barLabel)).toEqual(BUCKETS.map(expectedBarLabel));
    expect(renderedBars.map(barColor)).toEqual(BUCKETS.map(expectedBarColor));

    for (const bar of renderedBars) {
      expect(barColor(bar)).not.toBe(rgb(DEFAULT_BAR_COLOR));
      expect(barColor(bar)).not.toBe(rgb(NO_DATA_BAR_COLOR.toString()));
      expect(barLabel(bar)).not.toContain("no data");
    }
  });

  /*
   * Root cause 1. The monitor blipped at 00:00:01.326 and has been
   * Operational since 00:00:01.540, in a row that is still open.
   *
   * Before the fix the browser sorted rows to the second, so the open row
   * stayed ahead of the Offline row from the same second, took its start as
   * its end, and became an event from 00:00:01.540 to 00:00:01.326. Today
   * then held 1.326 s of Operational from the previous row, the 0.214 s blip,
   * and -0.214 s from the broken open row: 1.112 / 1.326 = 83.86%, orange. The
   * fifteen and a half hours since were not on the bar at all.
   */
  test("today's bar is green and reads as a measured day, although the open row starts in the same second as the Offline row before it", async () => {
    await renderOverview();

    const today: HTMLElement = bars()[bars().length - 1]!;

    expect(barLabel(today)).toBe("Sep 22, 2026: 99.99% uptime");
    expect(barLabel(today)).not.toContain("no data");
    expect(barColor(today)).toBe(rgb(GREEN_RULE_COLOR));
    expect(barColor(today)).not.toBe(rgb(DEFAULT_BAR_COLOR));
  });

  /*
   * Root cause 2, the partial day. The cap keeps only the newest rows, so the
   * day it cuts through keeps its evening and loses its morning - including,
   * here, a 90 minute outage.
   *
   * Before the fix a reading decided a day only when the day had NO events,
   * so Sep 20 was painted from the six hours of rows after 17:47:40: ~100%,
   * green. Its bucket says 93.75%.
   */
  test("the day the row cap cuts through is painted from its bucket, not from the hours of rows that survived", async () => {
    await renderOverview();

    const cutThrough: HTMLElement = barForDay("Sep 20, 2026");

    expect(barLabel(cutThrough)).toBe("Sep 20, 2026: 93.75% uptime");
    expect(barColor(cutThrough)).toBe(rgb(ORANGE_RULE_COLOR));
  });

  /*
   * Root cause 2, the dropped days. Every day before Sep 20 has no rows at
   * all on this page. On production those days were painted the page's grey
   * default colour at "100%"; here each must carry its own bucket.
   *
   * A browser in UTC already had this before the fix - a day with no events
   * was decided by its reading - so in this file it is a guard. In New York
   * the same days were paired with the NEXT day's bucket, which
   * StatusPageOverviewUptimeBars.NewYork.test.tsx pins.
   */
  test("days older than the rows are painted from their buckets: a rule colour and the bucket's own percentage", async () => {
    await renderOverview();

    const olderBuckets: Array<UptimeDayBucket> = BUCKETS.filter(
      (bucket: UptimeDayBucket): boolean => {
        return bucket.bucketEnd.getTime() <= OLDEST_ROW_STARTS_AT.getTime();
      },
    );

    expect(olderBuckets).toHaveLength(58);

    const olderBars: Array<HTMLElement> = bars().slice(0, olderBuckets.length);

    expect(olderBars.map(barLabel)).toEqual(olderBuckets.map(expectedBarLabel));
    expect(olderBars.map(barColor)).toEqual(olderBuckets.map(expectedBarColor));

    // one of each rule, so the colour is visibly chosen by the percentage.
    expect(barLabel(barForDay("Aug 15, 2026"))).toBe(
      "Aug 15, 2026: 42.13% uptime",
    );
    expect(barColor(barForDay("Aug 15, 2026"))).toBe(rgb(RED_RULE_COLOR));
    expect(barLabel(barForDay("Aug 30, 2026"))).toBe(
      "Aug 30, 2026: 91.67% uptime",
    );
    expect(barColor(barForDay("Aug 30, 2026"))).toBe(rgb(ORANGE_RULE_COLOR));
    expect(barColor(barForDay("Aug 29, 2026"))).toBe(rgb(GREEN_RULE_COLOR));
  });
});

describe("Status page overview - uptime figures of a flapping monitor under the row cap", () => {
  pinTheClockAndServeTheOverview();

  /*
   * Root cause 2, the header. Before the fix the percentage next to the
   * monitor's name was UptimeUtil.calculateUptimePercentage over the capped
   * rows: two days of blips, 99.995%, for a monitor whose sixty days - with
   * a fourteen hour outage in them - were nowhere near that. Production read
   * 99.876% for a monitor that was up 99.667%.
   */
  test("the uptime next to the monitor's name is measured from the buckets, not from the capped rows", async () => {
    const fromTheBuckets: number = uptimeFromTheBuckets(
      UptimePrecision.THREE_DECIMAL,
    );
    const fromTheRows: number = uptimeFromTheCappedRows(
      UptimePrecision.THREE_DECIMAL,
    );

    // the two genuinely disagree, or this test would prove nothing.
    expect(fromTheBuckets).not.toBe(fromTheRows);
    expect(fromTheBuckets).toBeLessThan(99);
    expect(fromTheRows).toBeGreaterThan(99.99);

    await renderOverview();

    expect(screen.getByText(`${fromTheBuckets}% uptime`)).toBeInTheDocument();
    expect(
      screen.queryByText(`${fromTheRows}% uptime`),
    ).not.toBeInTheDocument();
  });

  /*
   * Root cause 2, the banner. The overall figure is the average over the
   * page's resources - one here - and was computed from the same capped rows.
   */
  test("with the overall uptime shown, the banner's figure is measured from the buckets too", async () => {
    mockRespondToPost = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        overviewPayload({
          uptimeDailyAggregate: aggregateJson(MONITOR_ID),
          showOverallUptimePercentOnStatusPage: true,
        }),
        {},
      );
    };

    // one resource, so the average of one reading, rounded as every figure is.
    const overallFromTheBuckets: number = UptimeUtil.roundToPrecision({
      number: uptimeFromTheBuckets(UptimePrecision.TWO_DECIMAL),
      precision: UptimePrecision.TWO_DECIMAL,
    });
    const overallFromTheRows: number = UptimeUtil.roundToPrecision({
      number: uptimeFromTheCappedRows(UptimePrecision.TWO_DECIMAL),
      precision: UptimePrecision.TWO_DECIMAL,
    });

    expect(overallFromTheBuckets).not.toBe(overallFromTheRows);

    await renderOverview();

    const banner: HTMLElement = document.getElementById("overview-alert")!;

    expect(banner).toBeInTheDocument();
    expect(
      within(banner).getByText(`${overallFromTheBuckets}% uptime`),
    ).toBeInTheDocument();
    expect(
      within(banner).queryByText(`${overallFromTheRows}% uptime`),
    ).not.toBeInTheDocument();
  });
});

describe("Status page overview - a monitor the aggregate does not know about", () => {
  pinTheClockAndServeTheOverview();

  interface FallbackCase {
    name: string;
    uptimeDailyAggregate: JSONObject | undefined;
  }

  const FALLBACK_CASES: Array<FallbackCase> = [
    {
      // a monitor added to the page after the cached aggregate was computed.
      name: "the aggregate only has buckets for another monitor",
      uptimeDailyAggregate: aggregateJson(OTHER_MONITOR_ID),
    },
    {
      // a server that predates the aggregate.
      name: "the payload carries no aggregate at all",
      uptimeDailyAggregate: undefined,
    },
  ];

  /*
   * Buckets that cover nothing fall back to the rows. That path must still
   * render, and it is where the sort fix shows on its own: with no reading
   * for today, today's bar IS its events. Before the fix it was 83.86% and
   * orange (see "today's bar is green" above); with the open row sorted
   * after the Offline row it runs to now and today is 99.99%.
   */
  test.each(FALLBACK_CASES)(
    "it still renders, its uptime taken from the rows, when $name",
    async (fallbackCase: FallbackCase) => {
      mockRespondToPost = (): HTTPResponse<JSONObject> => {
        return new HTTPResponse<JSONObject>(
          200,
          overviewPayload({
            uptimeDailyAggregate: fallbackCase.uptimeDailyAggregate,
          }),
          {},
        );
      };

      await renderOverview();

      expect(screen.getByText(MONITOR_NAME)).toBeInTheDocument();
      expect(
        screen.getByText(
          `${uptimeFromTheCappedRows(UptimePrecision.THREE_DECIMAL)}% uptime`,
        ),
      ).toBeInTheDocument();

      const renderedBars: Array<HTMLElement> = bars();

      expect(renderedBars).toHaveLength(61);

      const today: HTMLElement = renderedBars[renderedBars.length - 1]!;

      expect(barLabel(today)).toBe("Sep 22, 2026: 99.99% uptime");
      expect(barColor(today)).toBe(rgb(GREEN_RULE_COLOR));

      // the rows' oldest day still has rows, so it is measured, not "no data".
      expect(barLabel(barForDay("Sep 20, 2026"))).not.toContain("no data");

      /*
       * With neither rows nor a bucket, a day says so. It is never the
       * operator's grey, which reads as "up" on this page.
       */
      const dayWithNothing: HTMLElement = barForDay("Aug 15, 2026");

      expect(barLabel(dayWithNothing)).toBe("Aug 15, 2026: no data");
      expect(barColor(dayWithNothing)).toBe(rgb(NO_DATA_BAR_COLOR.toString()));

      for (const bar of renderedBars) {
        expect(barColor(bar)).not.toBe(rgb(DEFAULT_BAR_COLOR));
      }
    },
  );
});
