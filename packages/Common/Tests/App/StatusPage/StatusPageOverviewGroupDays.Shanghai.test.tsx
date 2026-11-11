/**
 * @timezone Asia/Shanghai
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
import JSONFunctions from "../../../Types/JSONFunctions";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import {
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import ColorClass from "../../../Types/Color";
import Navigation from "../../../UI/Utils/Navigation";
import MonitorGroupUptimeDailyAggregateUtil from "../../../Utils/StatusPage/MonitorGroupUptimeDailyAggregateUtil";
import UptimeDailyAggregateUtil from "../../../Utils/StatusPage/UptimeDailyAggregateUtil";
import DayUptimeGraphUtil, {
  UptimeGraphDay,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import Event from "../../../Utils/Uptime/Event";
import MonitorEvent from "../../../Utils/Uptime/MonitorEvent";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
import WorstStatusTimeline from "../../../Utils/Uptime/WorstStatusTimeline";
import Overview from "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";

/*
 * Issue #6697, end to end through the real Overview page, in a browser in
 * Shanghai (UTC+8).
 *
 * A monitor group of nine monitors: eight of them Offline across the whole
 * of 7 November, one Operational throughout, and a minute's outage at 15:36
 * CST on 6 November with an incident declared at that minute.
 *
 * The page used to draw every bar as a UTC day, labelled "(UTC)", while its
 * tooltip listed the incident at 15:36 CST - and it merged the group's rows
 * in the browser by comparing each with the last one it kept, so 7 November
 * read as nine days (eight of Offline) and 6 November as sixteen hours.
 *
 * Now the page asks for its history in the visitor's zone, every bar is a
 * Shanghai day, and the group's days come from the server: the worst status
 * among its monitors at each instant, at most a day each.
 *
 * The server is stood in for by a reference written apart from it: the rows
 * as events (UptimeUtil.getMonitorEventsForId), merged by worst status
 * (WorstStatusTimeline), cut into the zone's days (DayUptimeGraphUtil) -
 * which the SQL is checked against on Postgres.
 */

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;
const WINDOW_DAYS: number = 10;

// 13:00 in Shanghai on 11 November.
const NOW: Date = new Date("2026-11-11T05:00:00.000Z");
const WINDOW_START: Date = new Date(NOW.getTime() - WINDOW_DAYS * DAY_MS);

const STATUS_PAGE_ID: string = "40000000-0000-4000-8000-000000000001";
const GROUP_RESOURCE_ID: string = "30000000-0000-4000-8000-000000000001";
const MONITOR_RESOURCE_ID: string = "30000000-0000-4000-8000-000000000002";
const CHECKOUT_GROUP_ID: string = "70000000-0000-4000-8000-000000000001";
const API_MONITOR_ID: string = "20000000-0000-4000-8000-000000000010";
const INCIDENT_ID: string = "50000000-0000-4000-8000-000000000001";

const OPERATIONAL_STATUS_ID: string = "10000000-0000-4000-8000-000000000001";
const DEGRADED_STATUS_ID: string = "10000000-0000-4000-8000-000000000002";
const OFFLINE_STATUS_ID: string = "10000000-0000-4000-8000-000000000003";

const DOWNTIME_STATUS_IDS: Array<string> = [
  DEGRADED_STATUS_ID,
  OFFLINE_STATUS_ID,
];

const CHECKOUT_NAME: string = "Checkout";
const API_NAME: string = "API";

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

function monitorId(n: number): string {
  return `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const CHECKOUT_MONITOR_IDS: Array<string> = Array.from(
  { length: 9 },
  (_: unknown, index: number) => {
    return monitorId(index + 1);
  },
);

interface TimelineRow {
  monitorId: string;
  statusId: string;
  startsAt: Date;
  endsAt: Date | null;
}

// 7 November in Shanghai: 16:00 UTC on the 6th to 16:00 UTC on the 7th.
const SHANGHAI_NOV_7_START: number = Date.parse("2026-11-06T16:00:00.000Z");
// 15:36 CST on 6 November.
const BLIP_START: Date = new Date("2026-11-06T07:36:00.000Z");
const BLIP_END: Date = new Date("2026-11-06T07:37:00.000Z");

function checkoutRows(): Array<TimelineRow> {
  const rows: Array<TimelineRow> = [];

  // eight monitors Offline from n hours before 7 November to n hours after it.
  for (let n: number = 1; n <= 8; n++) {
    const id: string = monitorId(n);
    const offlineFrom: Date = new Date(SHANGHAI_NOV_7_START - n * HOUR_MS);
    const offlineTo: Date = new Date(
      SHANGHAI_NOV_7_START + DAY_MS + n * HOUR_MS,
    );

    if (n === 1) {
      rows.push(
        {
          monitorId: id,
          statusId: OPERATIONAL_STATUS_ID,
          startsAt: WINDOW_START,
          endsAt: BLIP_START,
        },
        {
          monitorId: id,
          statusId: OFFLINE_STATUS_ID,
          startsAt: BLIP_START,
          endsAt: BLIP_END,
        },
        {
          monitorId: id,
          statusId: OPERATIONAL_STATUS_ID,
          startsAt: BLIP_END,
          endsAt: offlineFrom,
        },
      );
    } else {
      rows.push({
        monitorId: id,
        statusId: OPERATIONAL_STATUS_ID,
        startsAt: WINDOW_START,
        endsAt: offlineFrom,
      });
    }

    rows.push(
      {
        monitorId: id,
        statusId: OFFLINE_STATUS_ID,
        startsAt: offlineFrom,
        endsAt: offlineTo,
      },
      {
        monitorId: id,
        statusId: OPERATIONAL_STATUS_ID,
        startsAt: offlineTo,
        endsAt: null,
      },
    );
  }

  // the ninth is Operational throughout.
  rows.push({
    monitorId: monitorId(9),
    statusId: OPERATIONAL_STATUS_ID,
    startsAt: WINDOW_START,
    endsAt: null,
  });

  return rows;
}

function apiRows(): Array<TimelineRow> {
  return [
    {
      monitorId: API_MONITOR_ID,
      statusId: OPERATIONAL_STATUS_ID,
      startsAt: WINDOW_START,
      endsAt: null,
    },
  ];
}

function toTimeline(row: TimelineRow): MonitorStatusTimeline {
  const status: StatusDefinition = STATUSES[row.statusId]!;
  const monitorStatus: MonitorStatus = new MonitorStatus();
  monitorStatus.id = new ObjectID(row.statusId);
  monitorStatus.name = status.name;
  monitorStatus.priority = status.priority;
  monitorStatus.color = new ColorClass(status.color);

  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = new ObjectID(row.monitorId);
  timeline.monitorStatusId = new ObjectID(row.statusId);
  timeline.monitorStatus = monitorStatus;
  timeline.startsAt = row.startsAt;

  if (row.endsAt) {
    timeline.endsAt = row.endsAt;
  }

  return timeline;
}

/*
 * The server, stood in for: the monitors' rows as events, merged by the
 * worst status (the page's downtime statuses first), cut into the zone's
 * days over the window.
 */
function serverDays(data: {
  monitorIds: Array<string>;
  rows: Array<TimelineRow>;
  timezone: string;
}): Array<UptimeDayBucket> {
  const timelines: Array<MonitorStatusTimeline> = data.rows.map(toTimeline);
  const events: Array<MonitorEvent> = [];

  for (const id of data.monitorIds) {
    events.push(
      ...UptimeUtil.getMonitorEventsForId(new ObjectID(id), timelines, {
        startDate: WINDOW_START,
        endDate: NOW,
      }),
    );
  }

  const merged: Array<Event> = WorstStatusTimeline.merge(events, {
    downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
  });

  return DayUptimeGraphUtil.getDays({
    startDate: WINDOW_START,
    endDate: NOW,
    timezone: data.timezone,
  }).map((day: UptimeGraphDay): UptimeDayBucket => {
    const bucketStart: number = Math.max(
      day.startOfDay.getTime(),
      WINDOW_START.getTime(),
    );
    const bucketEnd: number = Math.min(
      day.endOfDay.getTime() + 1,
      NOW.getTime(),
    );
    const secondsByStatus: Map<string, number> = new Map<string, number>();
    let covered: number = 0;

    for (const piece of merged) {
      const from: number = Math.max(piece.startDate.getTime(), bucketStart);
      const to: number = Math.min(piece.endDate.getTime(), bucketEnd);

      if (to <= from) {
        continue;
      }

      const id: string = piece.eventStatusId.toString();
      secondsByStatus.set(
        id,
        (secondsByStatus.get(id) || 0) + (to - from) / 1000,
      );
      covered += (to - from) / 1000;
    }

    return {
      bucketStart: new Date(bucketStart),
      bucketEnd: new Date(bucketEnd),
      daySeconds: Math.round((bucketEnd - bucketStart) / 1000),
      coveredSeconds: covered,
      statusDurations: Array.from(secondsByStatus.entries()).map(
        ([id, seconds]: [string, number]): UptimeStatusDuration => {
          return { monitorStatusId: new ObjectID(id), seconds: seconds };
        },
      ),
    };
  });
}

/*
 * ---------------------------------------------------------------------------
 * The page's surroundings.
 * ---------------------------------------------------------------------------
 */

let mockRespondToPost: () => HTTPResponse<JSONObject> =
  (): HTTPResponse<JSONObject> => {
    throw new Error("mockRespondToPost was not set by the test");
  };

const mockPosts: Array<{ data?: JSONObject }> = [];

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
      post: (request: { data?: JSONObject }) => {
        mockPosts.push(request);
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

jest.mock("react-i18next", () => {
  const english: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const lookUp: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    let node: unknown = english;

    for (const part of key.split(".")) {
      if (!node || typeof node !== "object") {
        return undefined;
      }

      node = (node as Record<string, unknown>)[part];
    }

    return typeof node === "string" ? node : undefined;
  };

  const t: (
    key: string,
    opts?: { defaultValue?: string } & Record<string, unknown>,
  ) => string = (
    key: string,
    opts?: { defaultValue?: string } & Record<string, unknown>,
  ): string => {
    let out: string = lookUp(key) ?? opts?.defaultValue ?? key;

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
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => {
      return { t: t, i18n: { resolvedLanguage: "en", language: "en" } };
    },
  };
});

/*
 * ---------------------------------------------------------------------------
 * The payload.
 * ---------------------------------------------------------------------------
 */

function objectId(value: string): JSONObject {
  return { _type: "ObjectID", value: value };
}

function color(value: string): JSONObject {
  return { _type: "Color", value: value };
}

function dateTime(value: Date): JSONObject {
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

// newest first, as the server sends them.
function rowsAsSentByTheServer(): JSONArray {
  return [...checkoutRows(), ...apiRows()]
    .sort((a: TimelineRow, b: TimelineRow): number => {
      return b.startsAt.getTime() - a.startsAt.getTime();
    })
    .map((row: TimelineRow, index: number): JSONObject => {
      return {
        _id: `timeline-${index}`,
        monitorId: objectId(row.monitorId),
        monitorStatusId: objectId(row.statusId),
        monitorStatus: statusJson(row.statusId),
        startsAt: dateTime(row.startsAt),
        endsAt: row.endsAt ? dateTime(row.endsAt) : null,
      };
    });
}

function overviewPayload(data: {
  // the zone the server cut the history in; none from a server that predates it.
  historyTimezone: string | null;
}): JSONObject {
  const payload: JSONObject = {
    statusPage: {
      _id: STATUS_PAGE_ID,
      defaultBarColor: color("#5F5F5F"),
      downtimeMonitorStatuses: DOWNTIME_STATUS_IDS.map(
        (statusId: string): JSONObject => {
          return { _id: statusId };
        },
      ),
      showUptimeHistoryInDays: WINDOW_DAYS,
    },
    resourceGroups: [],
    statusPageResources: [
      {
        _id: GROUP_RESOURCE_ID,
        displayName: CHECKOUT_NAME,
        showCurrentStatus: true,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
        showStatusHistoryChart: true,
        order: 1,
        monitorGroupId: objectId(CHECKOUT_GROUP_ID),
      },
      {
        _id: MONITOR_RESOURCE_ID,
        displayName: API_NAME,
        showCurrentStatus: true,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
        showStatusHistoryChart: true,
        order: 2,
        monitorId: objectId(API_MONITOR_ID),
        monitor: {
          _id: API_MONITOR_ID,
          currentMonitorStatusId: objectId(OPERATIONAL_STATUS_ID),
        },
      },
    ],
    monitorStatuses: [
      statusJson(OPERATIONAL_STATUS_ID),
      statusJson(DEGRADED_STATUS_ID),
      statusJson(OFFLINE_STATUS_ID),
    ],
    monitorStatusTimelines: rowsAsSentByTheServer(),
    statusPageHistoryChartBarColorRules: [],
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
    timelineIncidents: [
      {
        _id: INCIDENT_ID,
        title: "Checkout payments failing",
        declaredAt: dateTime(BLIP_START),
        monitors: [{ _id: monitorId(1) }],
        incidentSeverity: { name: "Major", color: color("#F64848") },
      },
    ],
    monitorsInGroup: JSONFunctions.serialize({
      [CHECKOUT_GROUP_ID]: CHECKOUT_MONITOR_IDS.map((id: string) => {
        return new ObjectID(id);
      }),
    }),
    monitorGroupCurrentStatuses: JSONFunctions.serialize({
      [CHECKOUT_GROUP_ID]: new ObjectID(OPERATIONAL_STATUS_ID),
    }),
    overallStatus: statusJson(OPERATIONAL_STATUS_ID),
  };

  if (data.historyTimezone) {
    const timezone: string = data.historyTimezone;

    payload["uptimeDailyAggregate"] = JSON.parse(
      JSON.stringify(
        UptimeDailyAggregateUtil.toJSON({
          monitors: [
            {
              monitorId: new ObjectID(API_MONITOR_ID),
              buckets: serverDays({
                monitorIds: [API_MONITOR_ID],
                rows: apiRows(),
                timezone: timezone,
              }),
            },
          ],
          isComplete: true,
          completeFrom: null,
          timezone: timezone,
        }),
      ),
    ) as JSONObject;

    payload["monitorGroupUptimeDailyAggregate"] = JSON.parse(
      JSON.stringify(
        MonitorGroupUptimeDailyAggregateUtil.toJSON({
          monitorGroups: [
            {
              monitorGroupId: new ObjectID(CHECKOUT_GROUP_ID),
              buckets: serverDays({
                monitorIds: CHECKOUT_MONITOR_IDS,
                rows: checkoutRows(),
                timezone: timezone,
              }),
            },
          ],
          timezone: timezone,
        }),
      ),
    ) as JSONObject;
  }

  return payload;
}

function serve(data: { historyTimezone: string | null }): void {
  mockRespondToPost = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, overviewPayload(data), {});
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

// the strip of the resource with this name.
function barsOf(name: string): Array<HTMLElement> {
  const header: HTMLElement = screen
    .getAllByTestId("status-page-resource-header")
    .find((element: HTMLElement) => {
      return element.textContent?.includes(name);
    })!;

  const resource: HTMLElement = header.parentElement!.parentElement!;

  return within(resource).getAllByTestId("uptime-bar");
}

function barNamed(name: string, dateLabel: string): HTMLElement {
  const bar: HTMLElement | undefined = barsOf(name).find(
    (element: HTMLElement) => {
      return (element.getAttribute("aria-label") || "").startsWith(dateLabel);
    },
  );

  if (!bar) {
    throw new Error(
      `No bar of ${name} for ${dateLabel}: ${barsOf(name)
        .map((element: HTMLElement) => {
          return element.getAttribute("aria-label");
        })
        .join(" | ")}`,
    );
  }

  return bar;
}

async function openDay(name: string, dateLabel: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(barNamed(name, dateLabel));
  });

  return screen.getByRole("dialog");
}

function duration(seconds: number): string {
  return OneUptimeDate.secondsToFormattedFriendlyTimeString(seconds);
}

describe("Status page overview in Shanghai - a monitor group's days (issue #6697)", () => {
  const navigate: typeof Navigation.navigate = Navigation.navigate;

  beforeEach(() => {
    localStorage.clear();
    mockPosts.length = 0;
    StatusPageUtil.setStatusPageId(new ObjectID(STATUS_PAGE_ID));
    window.history.replaceState({}, "", "/");
    Navigation.navigate = (): void => {};
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    Navigation.navigate = navigate;
  });

  test("the browser shows its times in Shanghai", () => {
    expect(OneUptimeDate.getCurrentTimezone()).toBe("Asia/Shanghai");
  });

  test("asks for the uptime history in the visitor's own zone", async () => {
    serve({ historyTimezone: "Asia/Shanghai" });

    await renderOverview();

    expect(mockPosts).toHaveLength(1);
    expect(mockPosts[0]!.data).toEqual({ timezone: "Asia/Shanghai" });
  });

  describe("with the history cut in Shanghai", () => {
    beforeEach(() => {
      serve({ historyTimezone: "Asia/Shanghai" });
    });

    test("every bar is a Shanghai day, named without a zone, and today's is the visitor's today", async () => {
      await renderOverview();

      for (const name of [CHECKOUT_NAME, API_NAME]) {
        const labels: Array<string> = barsOf(name).map((bar: HTMLElement) => {
          return bar.getAttribute("aria-label") || "";
        });

        expect(
          labels.some((label: string) => {
            return label.includes("(");
          }),
        ).toBe(false);

        // 13:00 on 11 November in Shanghai is the last bar.
        expect(labels[labels.length - 1]).toMatch(/^Nov 11, 2026:/);
      }

      // and one grid: column i is the same day on both rows.
      expect(
        barsOf(CHECKOUT_NAME).map((bar: HTMLElement) => {
          return (bar.getAttribute("aria-label") || "").split(":")[0];
        }),
      ).toEqual(
        barsOf(API_NAME).map((bar: HTMLElement) => {
          return (bar.getAttribute("aria-label") || "").split(":")[0];
        }),
      );
    });

    test("7 November, every monitor but one Offline all day, is one day of Offline - not nine days", async () => {
      await renderOverview();

      expect(
        barNamed(CHECKOUT_NAME, "Nov 07, 2026").getAttribute("aria-label"),
      ).toBe("Nov 07, 2026: 0% uptime");

      const dialog: HTMLElement = await openDay(CHECKOUT_NAME, "Nov 07, 2026");

      expect(within(dialog).getByText("Offline")).toBeInTheDocument();
      expect(within(dialog).getByText(duration(86400))).toBeInTheDocument();
      expect(within(dialog).queryByText("Operational")).not.toBeInTheDocument();
    });

    test("6 November adds up to the whole day, and lists the 15:36 CST incident on it", async () => {
      await renderOverview();

      // eight hours from M8's outage, a minute from M1's blip: 28,860 s of 86,400.
      const uptime: string = DayUptimeGraphUtil.formatUptimePercentForLabel(
        ((86400 - 28860) / 86400) * 100,
      );

      expect(
        barNamed(CHECKOUT_NAME, "Nov 06, 2026").getAttribute("aria-label"),
      ).toBe(`Nov 06, 2026: ${uptime}% uptime, 1 incidents`);

      const dialog: HTMLElement = await openDay(CHECKOUT_NAME, "Nov 06, 2026");

      expect(within(dialog).getByText(duration(28860))).toBeInTheDocument();
      expect(
        within(dialog).getByText(duration(86400 - 28860)),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText("Checkout payments failing"),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            BLIP_START,
            false,
          ),
          { exact: false },
        ),
      ).toBeInTheDocument();
      expect(dialog.textContent).toContain("CST");
    });

    test("the incident is on 6 November's bar only, not on the UTC day before or after", async () => {
      await renderOverview();

      const withIncidents: Array<string> = barsOf(CHECKOUT_NAME)
        .map((bar: HTMLElement) => {
          return bar.getAttribute("aria-label") || "";
        })
        .filter((label: string) => {
          return label.includes("incidents");
        });

      expect(withIncidents).toEqual([
        expect.stringMatching(/^Nov 06, 2026:/) as unknown as string,
      ]);
    });

    test("the group's uptime beside its name is the sum of its days", async () => {
      await renderOverview();

      const days: Array<UptimeDayBucket> = serverDays({
        monitorIds: CHECKOUT_MONITOR_IDS,
        rows: checkoutRows(),
        timezone: "Asia/Shanghai",
      });

      const expected: number | null = UptimeDailyAggregateUtil.getUptimePercent(
        {
          buckets: days,
          downtimeMonitorStatusIds: DOWNTIME_STATUS_IDS,
          precision: UptimePrecision.TWO_DECIMAL,
        },
      );

      expect(expected).not.toBeNull();
      expect(screen.getByText(`${expected}% uptime`)).toBeInTheDocument();
    });
  });

  test("from a server that sends no group days, the rows are merged by the worst status: still a day of Offline", async () => {
    serve({ historyTimezone: null });

    await renderOverview();

    const dialog: HTMLElement = await openDay(CHECKOUT_NAME, "Nov 07, 2026");

    expect(within(dialog).getByText("Offline")).toBeInTheDocument();
    expect(within(dialog).getByText(duration(86400))).toBeInTheDocument();
    expect(within(dialog).queryByText("Operational")).not.toBeInTheDocument();
  });

  describe("when the server could only cut UTC days", () => {
    beforeEach(() => {
      serve({ historyTimezone: "UTC" });
    });

    test("each bar says it is a UTC day, and lists its incidents on the UTC clock", async () => {
      await renderOverview();

      // 07:36 UTC on 6 November is on the UTC day of 6 November.
      const bar: HTMLElement = barNamed(CHECKOUT_NAME, "Nov 06, 2026 (UTC)");

      expect(bar.getAttribute("aria-label")).toContain("1 incidents");

      const dialog: HTMLElement = await openDay(
        CHECKOUT_NAME,
        "Nov 06, 2026 (UTC)",
      );

      expect(dialog.textContent).toContain(
        OneUptimeDate.getDateAsFormattedStringInTimezone({
          date: BLIP_START,
          timezone: "UTC",
        }),
      );
      expect(dialog.textContent).not.toContain("CST");
    });
  });
});
