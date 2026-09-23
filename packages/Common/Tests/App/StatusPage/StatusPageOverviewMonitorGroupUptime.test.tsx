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
import Dictionary from "../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import Navigation from "../../../UI/Utils/Navigation";
import MonitorGroupMergedDowntimeUtil from "../../../Utils/StatusPage/MonitorGroupMergedDowntimeUtil";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
import Overview from "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";

/*
 * Contract under test - the uptime of a MONITOR GROUP on a status page
 * overview, end to end through the real Overview page.
 *
 * A monitor group is down whenever at least one of its monitors is. The
 * page used to compute its uptime in the browser from monitorStatusTimelines,
 * which arrive under one 10,000 row cap across every monitor on the page,
 * newest first - so on a page with a flapping monitor, from the last few days
 * of the window. The overview now carries each group's merged downtime
 * (monitorGroupMergedDowntime), measured by the server from every row, and
 * every figure on the page that involves a monitor group reads it: the
 * percentage next to the group's name, the rollup of the status page group
 * it sits in, a grid cell, and the overall uptime in the banner.
 *
 * A payload without the field - from a server that predates it - must still
 * render, with those figures taken from the rows as before.
 */

const DAY_MS: number = 24 * 60 * 60 * 1000;
const DAY_SECONDS: number = 86400;
const WINDOW_DAYS: number = 60;

const NOW: Date = new Date("2026-09-22T15:30:00.000Z");
const WINDOW_START: Date = new Date(NOW.getTime() - WINDOW_DAYS * DAY_MS);

const STATUS_PAGE_ID: string = "40000000-0000-4000-8000-000000000001";

const OPERATIONAL_STATUS_ID: string = "10000000-0000-4000-8000-000000000001";
const DEGRADED_STATUS_ID: string = "10000000-0000-4000-8000-000000000002";
const OFFLINE_STATUS_ID: string = "10000000-0000-4000-8000-000000000003";

const DOWNTIME_STATUS_IDS: Array<string> = [
  DEGRADED_STATUS_ID,
  OFFLINE_STATUS_ID,
];

// status page groups.
const INFRASTRUCTURE_GROUP_ID: string = "60000000-0000-4000-8000-000000000001";
const REGIONS_GROUP_ID: string = "60000000-0000-4000-8000-000000000002";

// monitor groups, and their monitors.
const EDGE_ID: string = "70000000-0000-4000-8000-000000000001";
const EU_EDGE_ID: string = "70000000-0000-4000-8000-000000000002";
const EDGE_ROUTER_ID: string = "20000000-0000-4000-8000-000000000001";
const EDGE_SWITCH_ID: string = "20000000-0000-4000-8000-000000000002";
const EU_ROUTER_ID: string = "20000000-0000-4000-8000-000000000003";

const EDGE_NAME: string = "Edge network";
const EU_EDGE_NAME: string = "EU edge";

/*
 * What the server merged over every row of the sixty days: Edge down for
 * 50,000 s (99.035%), EU edge for a day and a half (97.5%).
 */
const EDGE_MERGED: MergedDowntimeTotals = {
  coveredSeconds: WINDOW_DAYS * DAY_SECONDS,
  downtimeSeconds: 50000,
};
const EU_EDGE_MERGED: MergedDowntimeTotals = {
  coveredSeconds: WINDOW_DAYS * DAY_SECONDS,
  downtimeSeconds: 1.5 * DAY_SECONDS,
};

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
 * react-i18next is not initialised in the test environment. This resolves
 * keys against the status page's own English strings, so the figures read
 * the way a visitor reads them: "99.035% uptime".
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
 * The payload.
 * ---------------------------------------------------------------------------
 */

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

interface TimelineRow {
  monitorId: string;
  statusId: string;
  startsAt: Date;
  endsAt: Date | null;
}

/*
 * What survives the row cap for the group monitors: the edge router blipped
 * Offline for a minute yesterday, and everything has been Operational for
 * the two days the cap left. The sixty days before were anything but.
 */
const ROWS: Array<TimelineRow> = [
  {
    monitorId: EDGE_SWITCH_ID,
    statusId: OPERATIONAL_STATUS_ID,
    startsAt: new Date(NOW.getTime() - 2 * DAY_MS),
    endsAt: null,
  },
  {
    monitorId: EDGE_ROUTER_ID,
    statusId: OFFLINE_STATUS_ID,
    startsAt: new Date(NOW.getTime() - DAY_MS),
    endsAt: new Date(NOW.getTime() - DAY_MS + 60 * 1000),
  },
  {
    monitorId: EDGE_ROUTER_ID,
    statusId: OPERATIONAL_STATUS_ID,
    startsAt: new Date(NOW.getTime() - DAY_MS + 60 * 1000),
    endsAt: null,
  },
  {
    monitorId: EU_ROUTER_ID,
    statusId: OPERATIONAL_STATUS_ID,
    startsAt: new Date(NOW.getTime() - 2 * DAY_MS),
    endsAt: null,
  },
];

// Newest first, the order the server sends them in (startsAt DESC).
function rowsAsSentByTheServer(): JSONArray {
  return [...ROWS]
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

function monitorGroupResourceJson(data: {
  id: string;
  name: string;
  monitorGroupId: string;
  statusPageGroupId: string;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}): JSONObject {
  const json: JSONObject = {
    _id: data.id,
    displayName: data.name,
    showCurrentStatus: true,
    showUptimePercent: true,
    uptimePercentPrecision: UptimePrecision.THREE_DECIMAL,
    showStatusHistoryChart: true,
    order: 1,
    monitorGroupId: objectId(data.monitorGroupId),
    statusPageGroupId: objectId(data.statusPageGroupId),
  };

  if (data.rowAxisValue && data.columnAxisValue) {
    json["rowAxisValue"] = data.rowAxisValue;
    json["columnAxisValue"] = data.columnAxisValue;
  }

  return json;
}

/*
 * Infrastructure (a list, reporting its uptime) -> Edge network, a monitor
 * group of the edge router and switch.
 * Regions (a grid, EU x Edge) -> EU edge, a monitor group of the EU router.
 */
function overviewPayload(data: {
  monitorGroupMergedDowntime: JSONObject | undefined;
}): JSONObject {
  const payload: JSONObject = {
    statusPage: {
      _id: STATUS_PAGE_ID,
      defaultBarColor: color("#5F5F5F"),
      // ids only, as production sends them.
      downtimeMonitorStatuses: DOWNTIME_STATUS_IDS.map(
        (statusId: string): JSONObject => {
          return { _id: statusId };
        },
      ),
      showOverallUptimePercentOnStatusPage: true,
      overallUptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
      showUptimeHistoryInDays: WINDOW_DAYS,
    },
    resourceGroups: [
      {
        _id: INFRASTRUCTURE_GROUP_ID,
        name: "Infrastructure",
        order: 1,
        isExpandedByDefault: true,
        showCurrentStatus: true,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
        viewMode: StatusPageGroupViewMode.List,
      },
      {
        _id: REGIONS_GROUP_ID,
        name: "Regions",
        order: 2,
        isExpandedByDefault: true,
        showCurrentStatus: true,
        showUptimePercent: false,
        viewMode: StatusPageGroupViewMode.Grid,
        rowAxisValues: "EU",
        columnAxisValues: "Edge",
      },
    ],
    statusPageResources: [
      monitorGroupResourceJson({
        id: "30000000-0000-4000-8000-000000000001",
        name: EDGE_NAME,
        monitorGroupId: EDGE_ID,
        statusPageGroupId: INFRASTRUCTURE_GROUP_ID,
      }),
      monitorGroupResourceJson({
        id: "30000000-0000-4000-8000-000000000002",
        name: EU_EDGE_NAME,
        monitorGroupId: EU_EDGE_ID,
        statusPageGroupId: REGIONS_GROUP_ID,
        rowAxisValue: "EU",
        columnAxisValue: "Edge",
      }),
    ],
    monitorStatuses: [
      statusJson(OPERATIONAL_STATUS_ID),
      statusJson(DEGRADED_STATUS_ID),
      statusJson(OFFLINE_STATUS_ID),
    ],
    monitorStatusTimelines: rowsAsSentByTheServer(),
    // this page's monitors are all in groups, so the aggregate has no reading for either resource.
    uptimeDailyAggregate: {
      monitors: [],
      isComplete: true,
      completeFrom: null,
      timezone: "UTC",
    },
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
    timelineIncidents: [],
    monitorsInGroup: JSONFunctions.serialize({
      [EDGE_ID]: [new ObjectID(EDGE_ROUTER_ID), new ObjectID(EDGE_SWITCH_ID)],
      [EU_EDGE_ID]: [new ObjectID(EU_ROUTER_ID)],
    }),
    monitorGroupCurrentStatuses: JSONFunctions.serialize({
      [EDGE_ID]: new ObjectID(OPERATIONAL_STATUS_ID),
      [EU_EDGE_ID]: new ObjectID(OPERATIONAL_STATUS_ID),
    }),
    overallStatus: statusJson(OPERATIONAL_STATUS_ID),
  };

  if (data.monitorGroupMergedDowntime) {
    payload["monitorGroupMergedDowntime"] = data.monitorGroupMergedDowntime;
  }

  return payload;
}

// The field in its wire format, as the overview endpoint serves it.
function mergedDowntimeJson(
  byMonitorGroupId: Dictionary<MergedDowntimeTotals>,
): JSONObject {
  return JSON.parse(
    JSON.stringify(MonitorGroupMergedDowntimeUtil.toJSON(byMonitorGroupId)),
  ) as JSONObject;
}

function serve(monitorGroupMergedDowntime: JSONObject | undefined): void {
  mockRespondToPost = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(
      200,
      overviewPayload({ monitorGroupMergedDowntime }),
      {},
    );
  };
}

async function renderOverview(): Promise<void> {
  await act(async () => {
    render(<Overview pageRoute={new Route("/")} onLoadComplete={() => {}} />);
  });
}

/*
 * ---------------------------------------------------------------------------
 * The expected figures.
 * ---------------------------------------------------------------------------
 */

function merged(
  totals: MergedDowntimeTotals,
  precision: UptimePrecision,
): number {
  const percent: number | null =
    UptimeUtil.calculateUptimePercentOfCoveredSeconds({
      coveredSeconds: totals.coveredSeconds,
      downtimeSeconds: totals.downtimeSeconds,
      precision: precision,
    });

  if (percent === null) {
    throw new Error("The fixture's merged downtime must cover time.");
  }

  return percent;
}

// What the page showed before: the group's capped rows, merged in the browser.
function fromTheRows(
  monitorIds: Array<string>,
  precision: UptimePrecision,
): number {
  const rows: Array<MonitorStatusTimeline> = BaseModel.fromJSONArray(
    rowsAsSentByTheServer(),
    MonitorStatusTimeline,
  ).filter((row: MonitorStatusTimeline) => {
    return monitorIds.includes(row.monitorId?.toString() || "");
  });

  return UptimeUtil.calculateUptimePercentage(
    rows,
    precision,
    BaseModel.fromJSONArray(
      DOWNTIME_STATUS_IDS.map((statusId: string): JSONObject => {
        return { _id: statusId };
      }),
      MonitorStatus,
    ),
    { startDate: WINDOW_START, endDate: NOW },
  );
}

const EDGE_MONITORS: Array<string> = [EDGE_ROUTER_ID, EDGE_SWITCH_ID];
const EU_EDGE_MONITORS: Array<string> = [EU_ROUTER_ID];

/*
 * ---------------------------------------------------------------------------
 * Reading the page.
 * ---------------------------------------------------------------------------
 */

// A resource's header row: its name, and its uptime or status beside it.
function uptimeNextToTheName(name: string): string {
  const headerRow: HTMLElement =
    screen.getByText(name).parentElement!.parentElement!;

  return headerRow.textContent || "";
}

// The figure a status page group's header shows for its whole subtree.
function rollupOf(groupName: string): string {
  const header: HTMLElement | undefined = screen
    .getAllByTestId("status-page-group-header")
    .find((candidate: HTMLElement): boolean => {
      return within(candidate).queryByText(groupName) !== null;
    });

  if (!header) {
    throw new Error(`No status page group is named ${groupName}.`);
  }

  return (
    within(header).getByTestId("status-page-group-rollup").textContent || ""
  );
}

function banner(): HTMLElement {
  return document.getElementById("overview-alert")!;
}

describe("Status page overview - the uptime of a monitor group", () => {
  const navigate: typeof Navigation.navigate = Navigation.navigate;

  beforeEach(() => {
    localStorage.clear();
    LocalStorage.setItem("statusPageId", new ObjectID(STATUS_PAGE_ID));
    window.history.replaceState({}, "", "/");
    Navigation.navigate = (): void => {};
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    Navigation.navigate = navigate;
  });

  /*
   * Not a regression test: it pins that the fixture's two accounts of each
   * group genuinely disagree, so the tests below can tell which one the page
   * used.
   */
  test("the capped rows and the merged downtime disagree about both groups", () => {
    expect(merged(EDGE_MERGED, UptimePrecision.THREE_DECIMAL)).toBe(99.035);
    expect(fromTheRows(EDGE_MONITORS, UptimePrecision.THREE_DECIMAL)).toBe(
      99.965,
    );

    expect(merged(EU_EDGE_MERGED, UptimePrecision.THREE_DECIMAL)).toBe(97.5);
    expect(fromTheRows(EU_EDGE_MONITORS, UptimePrecision.THREE_DECIMAL)).toBe(
      100,
    );
  });

  describe("with the merged downtime in the payload", () => {
    beforeEach(() => {
      serve(
        mergedDowntimeJson({
          [EDGE_ID]: EDGE_MERGED,
          [EU_EDGE_ID]: EU_EDGE_MERGED,
        }),
      );
    });

    test("the uptime next to the group's name is its merged downtime, not the rows the cap left", async () => {
      await renderOverview();

      expect(
        screen.getByText(
          `${merged(EDGE_MERGED, UptimePrecision.THREE_DECIMAL)}% uptime`,
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          `${fromTheRows(EDGE_MONITORS, UptimePrecision.THREE_DECIMAL)}% uptime`,
        ),
      ).not.toBeInTheDocument();
      expect(uptimeNextToTheName(EDGE_NAME)).toContain("99.035% uptime");
    });

    test("the status page group it sits in rolls it up from the merged downtime", async () => {
      await renderOverview();

      // one resource, measured at the group's precision.
      expect(rollupOf("Infrastructure")).toBe(
        `${merged(EDGE_MERGED, UptimePrecision.TWO_DECIMAL)}% uptime`,
      );
      expect(rollupOf("Infrastructure")).toBe("99.03% uptime");
    });

    test("a grid cell holding a monitor group reads its merged downtime", async () => {
      await renderOverview();

      expect(screen.getByText("97.50% uptime")).toBeInTheDocument();
      expect(screen.queryByText("100.00% uptime")).not.toBeInTheDocument();
    });

    test("the overall uptime in the banner is averaged from the merged downtime", async () => {
      await renderOverview();

      // Infrastructure is the only group that reports; Regions does not.
      expect(within(banner()).getByText("99.03% uptime")).toBeInTheDocument();
    });
  });

  describe("without a merged reading for a group", () => {
    interface FallbackCase {
      name: string;
      monitorGroupMergedDowntime: () => JSONObject | undefined;
    }

    const FALLBACK_CASES: Array<FallbackCase> = [
      {
        // a server that predates the field.
        name: "the payload carries no merged downtime at all",
        monitorGroupMergedDowntime: (): JSONObject | undefined => {
          return undefined;
        },
      },
      {
        name: "the server recorded nothing for either group",
        monitorGroupMergedDowntime: (): JSONObject | undefined => {
          return mergedDowntimeJson({
            [EDGE_ID]: { coveredSeconds: 0, downtimeSeconds: 0 },
            [EU_EDGE_ID]: { coveredSeconds: 0, downtimeSeconds: 0 },
          });
        },
      },
    ];

    test.each(FALLBACK_CASES)(
      "the page still renders, every group figure taken from the rows as before, when $name",
      async (fallbackCase: FallbackCase) => {
        serve(fallbackCase.monitorGroupMergedDowntime());

        await renderOverview();

        const edgeFromTheRows: number = fromTheRows(
          EDGE_MONITORS,
          UptimePrecision.THREE_DECIMAL,
        );

        expect(uptimeNextToTheName(EDGE_NAME)).toContain(
          `${edgeFromTheRows}% uptime`,
        );
        expect(rollupOf("Infrastructure")).toBe(
          `${fromTheRows(EDGE_MONITORS, UptimePrecision.TWO_DECIMAL)}% uptime`,
        );
        expect(screen.getByText("100.00% uptime")).toBeInTheDocument();
        expect(
          within(banner()).getByText(
            `${fromTheRows(EDGE_MONITORS, UptimePrecision.TWO_DECIMAL)}% uptime`,
          ),
        ).toBeInTheDocument();
      },
    );
  });
});
