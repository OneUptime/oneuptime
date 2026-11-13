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
import { Gray500 } from "../../../Types/BrandColors";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import Navigation from "../../../UI/Utils/Navigation";
import Overview from "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";

/*
 * A STATUS PAGE WITH MONITORING OFF (#6478), end to end through the real
 * Overview page.
 *
 * A monitor whose monitoring is turned off is not checked: the status it
 * holds is what its last check saw, frozen. The page keeps it, and draws it
 * as Not monitored, in gray, where its status would go - and so a monitor
 * group whose monitors all have it off (the overview's
 * notMonitoredResourceIds). Neither decides another status: a status page
 * group's rollup and a grid cell come from the resources in them that are
 * checked, and read Not monitored when none is. A page nothing on which is
 * checked has no overall status, and its banner says so.
 *
 * An answer without the list - from a server that predates it - draws the
 * page as before.
 */

const NOW: Date = new Date("2026-11-12T10:00:00.000Z");

const STATUS_PAGE_ID: string = "41000000-0000-4000-8000-000000000001";

const OPERATIONAL_STATUS_ID: string = "11000000-0000-4000-8000-000000000001";
const DEGRADED_STATUS_ID: string = "11000000-0000-4000-8000-000000000002";
const OFFLINE_STATUS_ID: string = "11000000-0000-4000-8000-000000000003";

// Status page groups.
const INFRASTRUCTURE_ID: string = "61000000-0000-4000-8000-000000000001";
const RETIRED_ID: string = "61000000-0000-4000-8000-000000000002";
const REGIONS_ID: string = "61000000-0000-4000-8000-000000000003";

// Resources.
const CHECKOUT_ID: string = "31000000-0000-4000-8000-000000000001";
const SEARCH_ID: string = "31000000-0000-4000-8000-000000000002";
const BILLING_ID: string = "31000000-0000-4000-8000-000000000003";
const PAYMENTS_ID: string = "31000000-0000-4000-8000-000000000004";
const EU_EDGE_ID: string = "31000000-0000-4000-8000-000000000005";
const US_EDGE_ID: string = "31000000-0000-4000-8000-000000000006";

// Monitor groups, whose monitors all have monitoring off.
const PAYMENTS_GROUP_ID: string = "71000000-0000-4000-8000-000000000001";
const EU_EDGE_GROUP_ID: string = "71000000-0000-4000-8000-000000000002";

const NOT_MONITORED_IDS: Array<string> = [
  SEARCH_ID,
  BILLING_ID,
  PAYMENTS_ID,
  EU_EDGE_ID,
];

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

// The status page's own English words, as a visitor reads them.
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

function objectId(value: string): { _type: string; value: string } {
  return { _type: "ObjectID", value: value };
}

function color(value: string): { _type: string; value: string } {
  return { _type: "Color", value: value };
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

function monitorResourceJson(data: {
  id: string;
  name: string;
  statusId: string;
  statusPageGroupId: string;
  order: number;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}): JSONObject {
  const json: JSONObject = {
    _id: data.id,
    displayName: data.name,
    showCurrentStatus: true,
    showUptimePercent: false,
    showStatusHistoryChart: false,
    order: data.order,
    monitorId: objectId(`${data.id.slice(0, -1)}9`),
    monitor: {
      _id: `${data.id.slice(0, -1)}9`,
      currentMonitorStatusId: objectId(data.statusId),
    },
    statusPageGroupId: objectId(data.statusPageGroupId),
  };

  if (data.rowAxisValue && data.columnAxisValue) {
    json["rowAxisValue"] = data.rowAxisValue;
    json["columnAxisValue"] = data.columnAxisValue;
  }

  return json;
}

function monitorGroupResourceJson(data: {
  id: string;
  name: string;
  monitorGroupId: string;
  statusPageGroupId: string;
  order: number;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}): JSONObject {
  const json: JSONObject = {
    _id: data.id,
    displayName: data.name,
    showCurrentStatus: true,
    showUptimePercent: false,
    showStatusHistoryChart: false,
    order: data.order,
    monitorGroupId: objectId(data.monitorGroupId),
    statusPageGroupId: objectId(data.statusPageGroupId),
  };

  if (data.rowAxisValue && data.columnAxisValue) {
    json["rowAxisValue"] = data.rowAxisValue;
    json["columnAxisValue"] = data.columnAxisValue;
  }

  return json;
}

function groupJson(data: {
  id: string;
  name: string;
  order: number;
  viewMode?: StatusPageGroupViewMode | undefined;
}): JSONObject {
  const json: JSONObject = {
    _id: data.id,
    name: data.name,
    order: data.order,
    isExpandedByDefault: true,
    showCurrentStatus: true,
    showUptimePercent: false,
    viewMode: data.viewMode || StatusPageGroupViewMode.List,
  };

  if (data.viewMode === StatusPageGroupViewMode.Grid) {
    json["rowAxisValues"] = "EU,US";
    json["columnAxisValues"] = "Edge";
  }

  return json;
}

/*
 * Infrastructure (a list): Checkout API, checked and Operational; Search,
 * off and left at Offline.
 * Retired (a list): Billing, off and left at Offline; Payments, a monitor
 * group whose monitors are all off.
 * Regions (a grid, EU and US by Edge): EU edge, a monitor group whose
 * monitors are all off; US edge, checked and Degraded.
 */
function departmentResources(): Array<JSONObject> {
  return [
    monitorResourceJson({
      id: CHECKOUT_ID,
      name: "Checkout API",
      statusId: OPERATIONAL_STATUS_ID,
      statusPageGroupId: INFRASTRUCTURE_ID,
      order: 1,
    }),
    monitorResourceJson({
      id: SEARCH_ID,
      name: "Search",
      statusId: OFFLINE_STATUS_ID,
      statusPageGroupId: INFRASTRUCTURE_ID,
      order: 2,
    }),
    monitorResourceJson({
      id: BILLING_ID,
      name: "Billing",
      statusId: OFFLINE_STATUS_ID,
      statusPageGroupId: RETIRED_ID,
      order: 3,
    }),
    monitorGroupResourceJson({
      id: PAYMENTS_ID,
      name: "Payments",
      monitorGroupId: PAYMENTS_GROUP_ID,
      statusPageGroupId: RETIRED_ID,
      order: 4,
    }),
    monitorGroupResourceJson({
      id: EU_EDGE_ID,
      name: "EU edge",
      monitorGroupId: EU_EDGE_GROUP_ID,
      statusPageGroupId: REGIONS_ID,
      order: 5,
      rowAxisValue: "EU",
      columnAxisValue: "Edge",
    }),
    monitorResourceJson({
      id: US_EDGE_ID,
      name: "US edge",
      statusId: DEGRADED_STATUS_ID,
      statusPageGroupId: REGIONS_ID,
      order: 6,
      rowAxisValue: "US",
      columnAxisValue: "Edge",
    }),
  ];
}

function overviewPayload(data: {
  resources: Array<JSONObject>;
  overallStatusId: string | null;
  notMonitoredResourceIds: Array<string> | undefined;
}): JSONObject {
  const payload: JSONObject = {
    statusPage: {
      _id: STATUS_PAGE_ID,
      defaultBarColor: color("#5F5F5F"),
      downtimeMonitorStatuses: [{ _id: OFFLINE_STATUS_ID }],
      showOverallUptimePercentOnStatusPage: false,
      showUptimeHistoryInDays: 30,
    },
    resourceGroups: [
      groupJson({ id: INFRASTRUCTURE_ID, name: "Infrastructure", order: 1 }),
      groupJson({ id: RETIRED_ID, name: "Retired", order: 2 }),
      groupJson({
        id: REGIONS_ID,
        name: "Regions",
        order: 3,
        viewMode: StatusPageGroupViewMode.Grid,
      }),
    ],
    statusPageResources: data.resources,
    monitorStatuses: [
      statusJson(OPERATIONAL_STATUS_ID),
      statusJson(DEGRADED_STATUS_ID),
      statusJson(OFFLINE_STATUS_ID),
    ],
    monitorStatusTimelines: [],
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
      [PAYMENTS_GROUP_ID]: [
        new ObjectID("21000000-0000-4000-8000-000000000001"),
      ],
      [EU_EDGE_GROUP_ID]: [
        new ObjectID("21000000-0000-4000-8000-000000000002"),
      ],
    }),
    // The server leaves a group whose monitors are all off out.
    monitorGroupCurrentStatuses: JSONFunctions.serialize({}),
    overallStatus: data.overallStatusId
      ? statusJson(data.overallStatusId)
      : null,
  };

  if (data.notMonitoredResourceIds) {
    payload["notMonitoredResourceIds"] = data.notMonitoredResourceIds;
  }

  return payload;
}

function serve(payload: JSONObject): void {
  mockRespondToPost = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, payload, {});
  };
}

function serveDepartment(): void {
  serve(
    overviewPayload({
      resources: departmentResources(),
      // US edge is Degraded: the worst of what is checked.
      overallStatusId: DEGRADED_STATUS_ID,
      notMonitoredResourceIds: NOT_MONITORED_IDS,
    }),
  );
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

// A resource's header row: its name, and its status beside it.
function headerOf(name: string): HTMLElement {
  return screen
    .getByText(name)
    .closest("[data-testid='status-page-resource-header']") as HTMLElement;
}

// The reading a status page group's header shows for its whole subtree.
function rollupOf(groupName: string): HTMLElement {
  const header: HTMLElement | undefined = screen
    .getAllByTestId("status-page-group-header")
    .find((candidate: HTMLElement): boolean => {
      return within(candidate).queryByText(groupName) !== null;
    });

  if (!header) {
    throw new Error(`No status page group is named ${groupName}.`);
  }

  return within(header).getByTestId("status-page-group-rollup");
}

// A grid cell, by the names of the resources in it.
function cellOf(resourceNames: string): HTMLElement {
  const cell: Element | null = document.querySelector(
    `[title="${resourceNames}"]`,
  );

  if (!cell) {
    throw new Error(`No grid cell holds ${resourceNames}.`);
  }

  return cell as HTMLElement;
}

describe("Status page overview - monitors whose monitoring is off", () => {
  const navigate: typeof Navigation.navigate = Navigation.navigate;

  beforeEach(() => {
    localStorage.clear();
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

  test("a monitor whose monitoring is off says Not monitored where its status goes, never the Offline it was left at", async () => {
    serveDepartment();
    await renderOverview();

    const search: HTMLElement = headerOf("Search");

    expect(
      within(search).getByTestId("resource-not-monitored"),
    ).toHaveTextContent("Not monitored");
    expect(search.textContent).not.toContain("Offline");
  });

  test("it says it in gray, the page's color for Not monitored", async () => {
    serveDepartment();
    await renderOverview();

    const words: HTMLElement = within(headerOf("Search")).getByTestId(
      "resource-not-monitored",
    );

    expect(words).toHaveStyle({ color: Gray500.toString() });
    expect(words).not.toHaveStyle({
      color: STATUSES[OFFLINE_STATUS_ID]!.color,
    });
  });

  test("a monitor group whose monitors all have monitoring off says Not monitored", async () => {
    serveDepartment();
    await renderOverview();

    expect(
      within(headerOf("Payments")).getByTestId("resource-not-monitored"),
    ).toHaveTextContent("Not monitored");
  });

  test("a resource still checked shows its status, as before", async () => {
    serveDepartment();
    await renderOverview();

    const checkout: HTMLElement = headerOf("Checkout API");

    expect(
      within(checkout).queryByTestId("resource-not-monitored"),
    ).not.toBeInTheDocument();
    expect(checkout.textContent).toContain("Operational");
  });

  test("a group with a resource still checked rolls up from those alone", async () => {
    serveDepartment();
    await renderOverview();

    // Search's frozen Offline is not Infrastructure's.
    expect(rollupOf("Infrastructure")).toHaveTextContent("Operational");
    expect(rollupOf("Infrastructure").textContent).not.toContain("Offline");
  });

  test("a group nothing in which is checked rolls up to Not monitored", async () => {
    serveDepartment();
    await renderOverview();

    expect(rollupOf("Retired")).toHaveTextContent("Not monitored");
    expect(rollupOf("Retired").textContent).not.toContain("Offline");
  });

  test("a grid cell nothing in which is checked says Not monitored; one checked says its status", async () => {
    serveDepartment();
    await renderOverview();

    expect(cellOf("EU edge")).toHaveTextContent("Not monitored");
    expect(cellOf("EU edge").textContent).not.toContain("%");
    expect(cellOf("US edge")).toHaveTextContent("Degraded");
  });

  test("the banner names the worst status of what is checked", async () => {
    serveDepartment();
    await renderOverview();

    const banner: HTMLElement = document.getElementById("overview-alert")!;

    expect(banner).toHaveTextContent("Degraded");
    expect(banner.textContent).not.toContain("Offline");
    expect(
      screen.queryByTestId("overview-not-monitored-alert"),
    ).not.toBeInTheDocument();
  });

  test("a page whose checked resources are all Operational says all the monitored ones are, not all of them", async () => {
    // Checkout API is checked and Operational; Search is Not monitored.
    serve(
      overviewPayload({
        resources: departmentResources().filter(
          (resource: JSONObject): boolean => {
            return [CHECKOUT_ID, SEARCH_ID].includes(resource["_id"] as string);
          },
        ),
        overallStatusId: OPERATIONAL_STATUS_ID,
        notMonitoredResourceIds: [SEARCH_ID],
      }),
    );
    await renderOverview();

    const banner: HTMLElement = document.getElementById("overview-alert")!;

    expect(banner).toHaveTextContent("All monitored Resources are Operational");
    expect(banner.textContent).not.toContain("All Resources are");
    // Search is still drawn below it, as Not monitored.
    expect(
      within(headerOf("Search")).getByTestId("resource-not-monitored"),
    ).toHaveTextContent("Not monitored");
  });

  test("a page whose every resource is checked and Operational says all of them are, as before", async () => {
    serve(
      overviewPayload({
        resources: departmentResources().filter(
          (resource: JSONObject): boolean => {
            return resource["_id"] === CHECKOUT_ID;
          },
        ),
        overallStatusId: OPERATIONAL_STATUS_ID,
        notMonitoredResourceIds: [],
      }),
    );
    await renderOverview();

    expect(document.getElementById("overview-alert")).toHaveTextContent(
      "All Resources are Operational",
    );
    expect(
      screen.queryByText(/All monitored Resources/),
    ).not.toBeInTheDocument();
  });

  test("a page nothing on which is checked says so in its banner", async () => {
    serve(
      overviewPayload({
        resources: departmentResources().filter(
          (resource: JSONObject): boolean => {
            return NOT_MONITORED_IDS.includes(resource["_id"] as string);
          },
        ),
        overallStatusId: null,
        notMonitoredResourceIds: NOT_MONITORED_IDS,
      }),
    );
    await renderOverview();

    expect(
      screen.getByTestId("overview-not-monitored-alert"),
    ).toHaveTextContent("No Resources are monitored right now");

    // Never "All Resources are Operational" for a page nothing checks.
    expect(screen.queryByText(/All Resources are/)).not.toBeInTheDocument();
  });

  test("an answer from a server older than the list draws the page as before", async () => {
    serve(
      overviewPayload({
        resources: departmentResources(),
        overallStatusId: OFFLINE_STATUS_ID,
        notMonitoredResourceIds: undefined,
      }),
    );
    await renderOverview();

    expect(screen.queryByText("Not monitored")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("resource-not-monitored"),
    ).not.toBeInTheDocument();
    expect(headerOf("Search").textContent).toContain("Offline");
  });

  test("an empty page draws no Not monitored banner", async () => {
    serve(
      overviewPayload({
        resources: [],
        overallStatusId: null,
        notMonitoredResourceIds: [],
      }),
    );
    await renderOverview();

    expect(
      screen.queryByTestId("overview-not-monitored-alert"),
    ).not.toBeInTheDocument();
  });
});
