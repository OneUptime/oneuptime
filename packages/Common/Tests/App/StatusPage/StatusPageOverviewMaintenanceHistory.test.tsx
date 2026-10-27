/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
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
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import Navigation from "../../../UI/Utils/Navigation";
import {
  MAINTENANCE_BAR_CLASS_NAME,
  MAINTENANCE_MARK_COLOR,
} from "../../../Utils/StatusPage/HistoryChartBarColors";
import { RGB } from "../../../Types/Color";
import {
  getPillColors,
  PillColors,
} from "../../../UI/Components/Pill/PillColors";
import {
  composite,
  getContrastRatio,
  parseColor,
} from "../../../Utils/ColorContrast";

/*
 * The heaviest wash a Pill lays on a light card (Pill/PillColors): text
 * that reads on it reads on any lighter one.
 */
const PILL_WASH_ALPHA_CEILING: number = 0.16;
import Overview from "../../../../App/FeatureSet/StatusPage/src/Pages/Overview/Overview";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";

/*
 * Contract under test - a status page's 90-day history shows its scheduled
 * maintenance (issue #5236), end to end through the real Overview page.
 *
 * A customer's monitors were Degraded for eight hours of a planned PHP
 * upgrade, and the day's tooltip said exactly that and nothing more: the
 * maintenance that explained it lived only on the Scheduled Maintenance
 * page. Now:
 *
 *   - each resource's bars carry the maintenance of ITS monitors, a monitor
 *     group's through any monitor in it, banded on the days it touched;
 *   - a day's tooltip and dialog list the day's events, in the page's
 *     language, each opening its own page (the preview's own route on a
 *     preview);
 *   - a resource under an event in progress says "Under maintenance";
 *   - a server that sends no maintenance draws the page it always drew.
 */

const NOW: Date = new Date("2026-10-26T15:30:00.000Z");

const STATUS_PAGE_ID: string = "49000000-0000-4000-8000-000000000001";

const API_RESOURCE_ID: string = "39000000-0000-4000-8000-000000000001";
const WEB_RESOURCE_ID: string = "39000000-0000-4000-8000-000000000002";
const EDGE_RESOURCE_ID: string = "39000000-0000-4000-8000-000000000003";

const API_MONITOR_ID: string = "29000000-0000-4000-8000-000000000001";
const WEB_MONITOR_ID: string = "29000000-0000-4000-8000-000000000002";
const EDGE_ROUTER_ID: string = "29000000-0000-4000-8000-000000000003";
const EDGE_GROUP_ID: string = "29100000-0000-4000-8000-000000000001";

const OPERATIONAL_STATUS_ID: string = "19000000-0000-4000-8000-000000000001";

const ONGOING_STATE_ID: string = "59000000-0000-4000-8000-000000000002";
const COMPLETED_STATE_ID: string = "59000000-0000-4000-8000-000000000004";

const PATCH_EVENT_ID: string = "69000000-0000-4000-8000-000000000001";
const UPGRADE_EVENT_ID: string = "69000000-0000-4000-8000-000000000002";
const EDGE_EVENT_ID: string = "69000000-0000-4000-8000-000000000003";

let mockRespondToPost: () => HTTPResponse<JSONObject> =
  (): HTTPResponse<JSONObject> => {
    throw new Error("mockRespondToPost was not set by the test");
  };

let mockLocale: Record<string, unknown> = {};

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
 * react-i18next, answering from the status page's own locale file - English
 * unless a test picks another - so the page reads as a visitor reads it.
 */
jest.mock("react-i18next", () => {
  const lookUp: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    let node: unknown = mockLocale;

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

function locale(language: string): Record<string, unknown> {
  return jest.requireActual(
    `../../../../App/FeatureSet/StatusPage/src/Locales/${language}.json`,
  ) as Record<string, unknown>;
}

function objectId(value: string): { _type: string; value: string } {
  return { _type: "ObjectID", value: value };
}

function color(value: string): { _type: string; value: string } {
  return { _type: "Color", value: value };
}

function dateTime(value: Date): { _type: string; value: string } {
  return { _type: "DateTime", value: value.toISOString() };
}

function stateJson(data: {
  id: string;
  name: string;
  order: number;
  color: string;
  flag: string;
}): JSONObject {
  return {
    _id: data.id,
    name: data.name,
    order: data.order,
    color: color(data.color),
    isScheduledState: data.flag === "scheduled",
    isOngoingState: data.flag === "ongoing",
    isEndedState: data.flag === "ended",
    isResolvedState: data.flag === "completed",
  };
}

const STATES: JSONArray = [
  stateJson({
    id: "59000000-0000-4000-8000-000000000001",
    name: "Scheduled",
    order: 1,
    color: "#000000",
    flag: "scheduled",
  }),
  stateJson({
    id: ONGOING_STATE_ID,
    name: "Ongoing",
    order: 2,
    color: "#eab308",
    flag: "ongoing",
  }),
  stateJson({
    id: "59000000-0000-4000-8000-000000000003",
    name: "Ended",
    order: 3,
    color: "#4a4a4a",
    flag: "ended",
  }),
  stateJson({
    id: COMPLETED_STATE_ID,
    name: "Completed",
    order: 4,
    color: "#16a34a",
    flag: "completed",
  }),
];

function stateById(id: string): JSONObject {
  return STATES.find((state: unknown): boolean => {
    return (state as JSONObject)["_id"] === id;
  }) as JSONObject;
}

function eventJson(data: {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  stateId: string;
  monitorIds: Array<string>;
}): JSONObject {
  return {
    _id: data.id,
    title: data.title,
    startsAt: dateTime(data.startsAt),
    endsAt: dateTime(data.endsAt),
    currentScheduledMaintenanceState: stateById(data.stateId),
    monitors: data.monitorIds.map((id: string): JSONObject => {
      return { _id: id };
    }),
  };
}

// The issue's own event: 18:00 CEST on Oct 21 into Oct 22.
const PATCH_EVENT: JSONObject = eventJson({
  id: PATCH_EVENT_ID,
  title: "PHP security patches",
  startsAt: new Date("2026-10-21T16:00:00.000Z"),
  endsAt: new Date("2026-10-22T00:00:00.000Z"),
  stateId: COMPLETED_STATE_ID,
  monitorIds: [API_MONITOR_ID],
});

// Under way now, on the same monitor.
const UPGRADE_EVENT: JSONObject = eventJson({
  id: UPGRADE_EVENT_ID,
  title: "Database upgrade",
  startsAt: new Date("2026-10-26T14:00:00.000Z"),
  endsAt: new Date("2026-10-26T18:00:00.000Z"),
  stateId: ONGOING_STATE_ID,
  monitorIds: [API_MONITOR_ID],
});

// On a monitor of the Edge group.
const EDGE_EVENT: JSONObject = eventJson({
  id: EDGE_EVENT_ID,
  title: "Router firmware",
  startsAt: new Date("2026-10-23T02:00:00.000Z"),
  endsAt: new Date("2026-10-23T03:00:00.000Z"),
  stateId: COMPLETED_STATE_ID,
  monitorIds: [EDGE_ROUTER_ID],
});

function monitorResourceJson(data: {
  id: string;
  name: string;
  monitorId: string;
  order: number;
}): JSONObject {
  return {
    _id: data.id,
    displayName: data.name,
    showCurrentStatus: true,
    showUptimePercent: false,
    uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
    showStatusHistoryChart: true,
    order: data.order,
    monitorId: objectId(data.monitorId),
    monitor: {
      _id: data.monitorId,
      currentMonitorStatusId: objectId(OPERATIONAL_STATUS_ID),
    },
  };
}

function overviewPayload(data: {
  timelineScheduledMaintenanceEvents?: JSONArray | undefined;
}): JSONObject {
  const payload: JSONObject = {
    statusPage: {
      _id: STATUS_PAGE_ID,
      defaultBarColor: color("#16a34a"),
      downtimeMonitorStatuses: [],
      showOverallUptimePercentOnStatusPage: false,
      showUptimeHistoryInDays: 10,
    },
    resourceGroups: [],
    statusPageResources: [
      monitorResourceJson({
        id: API_RESOURCE_ID,
        name: "Public API",
        monitorId: API_MONITOR_ID,
        order: 1,
      }),
      monitorResourceJson({
        id: WEB_RESOURCE_ID,
        name: "Website",
        monitorId: WEB_MONITOR_ID,
        order: 2,
      }),
      {
        _id: EDGE_RESOURCE_ID,
        displayName: "Edge network",
        showCurrentStatus: true,
        showUptimePercent: false,
        showStatusHistoryChart: true,
        order: 3,
        monitorGroupId: objectId(EDGE_GROUP_ID),
      },
    ],
    monitorStatuses: [
      {
        _id: OPERATIONAL_STATUS_ID,
        name: "Operational",
        color: color("#16a34a"),
        priority: 1,
        isOperationalState: true,
      },
    ],
    monitorStatusTimelines: [],
    statusPageHistoryChartBarColorRules: [],
    incidentStateTimelines: [],
    scheduledMaintenanceStateTimelines: [],
    scheduledMaintenanceStates: STATES,
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
      [EDGE_GROUP_ID]: [new ObjectID(EDGE_ROUTER_ID)],
    }),
    monitorGroupCurrentStatuses: JSONFunctions.serialize({
      [EDGE_GROUP_ID]: new ObjectID(OPERATIONAL_STATUS_ID),
    }),
    overallStatus: {
      _id: OPERATIONAL_STATUS_ID,
      name: "Operational",
      color: color("#16a34a"),
      priority: 1,
      isOperationalState: true,
    },
  };

  if (data.timelineScheduledMaintenanceEvents) {
    payload["timelineScheduledMaintenanceEvents"] =
      data.timelineScheduledMaintenanceEvents;
  }

  return payload;
}

// Each resource's strip, in the page's order: API, Website, Edge network.
function strips(): Array<HTMLElement> {
  return screen.getAllByTestId("day-uptime-graph");
}

function barOn(strip: HTMLElement, label: string): HTMLElement {
  const bar: HTMLElement | undefined = within(strip)
    .getAllByTestId("uptime-bar")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.getAttribute("aria-label") || "").startsWith(
        `${label}:`,
      );
    });

  if (!bar) {
    throw new Error(`No bar is labelled ${label}`);
  }

  return bar;
}

function bandedDays(strip: HTMLElement): Array<string> {
  return within(strip)
    .getAllByTestId("uptime-bar")
    .filter((bar: HTMLElement): boolean => {
      return bar.classList.contains(MAINTENANCE_BAR_CLASS_NAME);
    })
    .map((bar: HTMLElement): string => {
      return (bar.getAttribute("aria-label") || "").split(":")[0] || "";
    });
}

async function renderOverview(): Promise<void> {
  await act(async () => {
    render(<Overview pageRoute={new Route("/")} onLoadComplete={() => {}} />);
  });

  await act(async () => {
    await Promise.resolve();
  });
}

let navigated: Array<string> = [];
const realNavigate: typeof Navigation.navigate = Navigation.navigate;

beforeEach(() => {
  navigated = [];
  mockLocale = locale("en");
  localStorage.clear();
  StatusPageUtil.setStatusPageId(new ObjectID(STATUS_PAGE_ID));
  window.history.replaceState({}, "", "/");
  Navigation.navigate = (route: unknown): void => {
    navigated.push(String(route));
  };
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
  OneUptimeDate.setUserTimezone("Europe/Paris" as Timezone);
  mockRespondToPost = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(
      200,
      overviewPayload({
        timelineScheduledMaintenanceEvents: [
          UPGRADE_EVENT,
          EDGE_EVENT,
          PATCH_EVENT,
        ],
      }),
      {},
    );
  };
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
  Navigation.navigate = realNavigate;
});

describe("Status page overview - each resource carries its own monitors' maintenance", () => {
  test("the page draws a strip per resource", async () => {
    await renderOverview();

    expect(strips()).toHaveLength(3);
  });

  test("a monitor's strip bands the days its events touched", async () => {
    await renderOverview();

    // The patch ran from Oct 21 into midnight; the upgrade runs today.
    expect(bandedDays(strips()[0]!)).toEqual(["Oct 21, 2026", "Oct 26, 2026"]);
  });

  test("a resource whose monitor no event holds has no band", async () => {
    await renderOverview();

    expect(bandedDays(strips()[1]!)).toEqual([]);
  });

  test("a monitor group's strip carries the events of the monitors in it", async () => {
    await renderOverview();

    expect(bandedDays(strips()[2]!)).toEqual(["Oct 23, 2026"]);
  });

  test("a bar's name says how much maintenance its day had", async () => {
    await renderOverview();

    expect(barOn(strips()[0]!, "Oct 21, 2026").getAttribute("aria-label")).toBe(
      "Oct 21, 2026: no data, 1 scheduled maintenance event",
    );
  });

  test("a server that sends no maintenance draws the page it always drew", async () => {
    mockRespondToPost = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(200, overviewPayload({}), {});
    };

    await renderOverview();

    for (const strip of strips()) {
      expect(bandedDays(strip)).toEqual([]);
    }

    expect(
      screen.queryByTestId("resource-under-maintenance"),
    ).not.toBeInTheDocument();
  });
});

describe("Status page overview - a resource under maintenance says so", () => {
  test("the resource an event in progress holds says Under maintenance, beside its name", async () => {
    await renderOverview();

    const chips: Array<HTMLElement> = screen.getAllByTestId(
      "resource-under-maintenance",
    );

    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent("Under maintenance");
    expect(
      within(chips[0]!.parentElement as HTMLElement).getByText("Public API"),
    ).toBeInTheDocument();
  });

  test("says it in the product's Pill, in the band's blue, with the wrench - readable on its wash", async () => {
    await renderOverview();

    const pill: HTMLElement = within(
      screen.getByTestId("resource-under-maintenance"),
    ).getByTestId("pill");
    const tone: PillColors = getPillColors(MAINTENANCE_MARK_COLOR);
    const text: RGB = parseColor(tone.light.textColor)!;

    expect(pill).toHaveTextContent("Under maintenance");
    // The wrench in the dot's place.
    expect(pill.querySelector("svg")).not.toBeNull();
    expect(within(pill).queryByTestId("pill-dot")).not.toBeInTheDocument();
    // A deeper shade of the band's blue: the blue itself read at 3.2:1.
    expect(pill.style.color).toBe(
      `rgb(${text.red}, ${text.green}, ${text.blue})`,
    );
    expect(pill.style.backgroundColor).toBe(tone.light.backgroundColor);
    expect(
      getContrastRatio(
        text,
        composite(
          parseColor(MAINTENANCE_MARK_COLOR)!,
          PILL_WASH_ALPHA_CEILING,
          { red: 255, green: 255, blue: 255 },
        ),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    // The dark theme's own shade (html.dark [data-ou-pill]).
    expect(pill).toHaveAttribute("data-ou-pill");
  });

  test("an event that is over puts nothing under maintenance", async () => {
    mockRespondToPost = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        overviewPayload({
          timelineScheduledMaintenanceEvents: [PATCH_EVENT, EDGE_EVENT],
        }),
        {},
      );
    };

    await renderOverview();

    expect(
      screen.queryByTestId("resource-under-maintenance"),
    ).not.toBeInTheDocument();
  });

  test("in the page's language", async () => {
    mockLocale = locale("de");

    await renderOverview();

    expect(screen.getByTestId("resource-under-maintenance")).toHaveTextContent(
      "In Wartung",
    );
  });
});

describe("Status page overview - a day's maintenance, told and opened", () => {
  test("the tooltip lists the day's event with its window and state", async () => {
    await renderOverview();

    fireEvent.mouseEnter(barOn(strips()[0]!, "Oct 21, 2026"));

    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    const tooltip: HTMLElement = screen.getByRole("tooltip");

    expect(tooltip).toHaveTextContent("Scheduled maintenance");
    expect(tooltip).toHaveTextContent("PHP security patches");
    expect(tooltip).toHaveTextContent("Oct 21, 18:00 – Oct 22, 02:00 CEST");
    expect(tooltip).toHaveTextContent("Completed");
  });

  test("the day dialog lists it, and opening it goes to the event's page", async () => {
    await renderOverview();

    fireEvent.click(barOn(strips()[0]!, "Oct 21, 2026"));

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Scheduled maintenance" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("No incidents were reported on this day."),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: /PHP security patches/ }),
    );

    expect(navigated).toHaveLength(1);
    expect(navigated[0]).toContain(`/scheduled-events/${PATCH_EVENT_ID}`);
    expect(navigated[0]).not.toContain("/status-page/");
  });

  test("on a preview, an event opens the preview's own page", async () => {
    window.history.replaceState({}, "", `/status-page/${STATUS_PAGE_ID}/`);

    await renderOverview();

    fireEvent.click(barOn(strips()[2]!, "Oct 23, 2026"));

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Router firmware/,
      }),
    );

    expect(navigated[0]).toContain(
      `/status-page/${STATUS_PAGE_ID}/scheduled-events/${EDGE_EVENT_ID}`,
    );
  });

  test("the dialog speaks the page's language", async () => {
    mockLocale = locale("de");

    await renderOverview();

    const bar: HTMLElement = barOn(strips()[0]!, "Oct 21, 2026");

    // The bar's name too: "keine Daten, 1 geplante Wartung".
    expect(bar.getAttribute("aria-label")).toBe(
      "Oct 21, 2026: keine Daten, 1 geplante Wartung",
    );

    fireEvent.click(bar);

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Geplante Wartung" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("An diesem Tag wurden keine Vorfälle gemeldet."),
    ).toBeInTheDocument();
  });
});
