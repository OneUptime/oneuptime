import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * "What your status page shows", the one card on a status page's Advanced
 * Settings for what visitors see: a switch per list (incidents, episodes,
 * announcements, scheduled maintenance), how far back each goes, its labels,
 * the page's uptime - the uptime history window, the overall uptime
 * percentage with its precision, and which statuses count as downtime - and
 * the "Powered by OneUptime" line.
 *
 * It replaced eight cards with an Edit dialog each. Every control saves its
 * own column at once: switches when pressed, a number of days when the box
 * is left or Enter is pressed, a precision or a status when it is picked. A
 * list that is off does not offer its history and labels, and the overall
 * uptime percentage that is off does not offer its precision. Switches and
 * boxes are locked while they save, the dropdowns never (a pick made
 * meanwhile waits its turn), and all are locked for someone who may not edit
 * the page, roll back with the reason when the server refuses, and name the
 * plan they need.
 *
 * Only the network, the permission gate and the plan are stubbed; the card,
 * its rows, the switches, the number boxes and the dropdowns (react-select)
 * are the real ones.
 */

/*
 * A refused request is an async function that throws, not
 * mockRejectedValue: the card's imports load zone.js, whose patched Promise
 * reports a rejected one as unhandled although the card catches it.
 */
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import StatusPageDisplaySettingsCard, {
  STATUS_PAGE_DISPLAY_SETTINGS_CARD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCard";
import StatusPageDisplaySettingsCopy, {
  DISPLAY_CHOICES,
  DISPLAY_DAYS,
  DISPLAY_SECTIONS,
  DISPLAY_SETTING_COLUMNS,
  DISPLAY_STATUSES,
  DISPLAY_SWITCHES,
  DisplayChoiceColumn,
  DisplayDaysColumn,
  DisplayDaysDefinition,
  DisplaySectionDefinition,
  DisplaySettingColumn,
  DisplayStatusesColumn,
  DisplaySwitchColumn,
  DisplaySwitchDefinition,
  DisplayValueColumn,
  getDisplayChoiceTestId,
  getDisplayDaysTestId,
  getDisplaySectionTestId,
  getDisplayStatusesTestId,
  getDisplaySwitchTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
import IncidentStatusPageScopeCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const STATUS_PAGE_ID: string = "5b5b5b5b-0000-4000-8000-0000000000bb";

type StoredColumns = Partial<
  Record<DisplayValueColumn, boolean | number | string>
>;

// A new status page, as the columns' defaults leave it.
const NEW_PAGE: StoredColumns = {
  showIncidentsOnStatusPage: true,
  showIncidentHistoryInDays: 14,
  showIncidentLabelsOnStatusPage: false,
  onlyShowScopedIncidents: false,
  showEpisodesOnStatusPage: true,
  showEpisodeHistoryInDays: 14,
  showEpisodeLabelsOnStatusPage: false,
  showAnnouncementsOnStatusPage: true,
  showAnnouncementHistoryInDays: 14,
  showScheduledMaintenanceEventsOnStatusPage: true,
  showScheduledEventHistoryInDays: 14,
  showScheduledEventLabelsOnStatusPage: false,
  showUptimeHistoryInDays: 90,
  showOverallUptimePercentOnStatusPage: false,
  overallUptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
  hidePoweredByOneUptimeBranding: false,
};

// The project's monitor statuses, as the server lists them.
const OPERATIONAL_ID: string = "6c6c6c6c-0000-4000-8000-000000000001";
const DEGRADED_ID: string = "6c6c6c6c-0000-4000-8000-000000000002";
const OFFLINE_ID: string = "6c6c6c6c-0000-4000-8000-000000000003";
const MAINTENANCE_ID: string = "6c6c6c6c-0000-4000-8000-000000000004";

function monitorStatus(data: {
  id: string;
  name: string;
  color: string;
  priority: number;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = data.id;
  status.name = data.name;
  status.color = new Color(data.color);
  status.priority = data.priority;
  return status;
}

const PROJECT_STATUSES: Array<MonitorStatus> = [
  monitorStatus({
    id: OPERATIONAL_ID,
    name: "Operational",
    color: "#22c55e",
    priority: 1,
  }),
  monitorStatus({
    id: DEGRADED_ID,
    name: "Degraded",
    color: "#eab308",
    priority: 2,
  }),
  monitorStatus({
    id: OFFLINE_ID,
    name: "Offline",
    color: "#ef4444",
    priority: 3,
  }),
  monitorStatus({
    id: MAINTENANCE_ID,
    name: "Under Maintenance",
    color: "#6366f1",
    priority: 4,
  }),
];

function statusesNamed(...names: Array<string>): Array<MonitorStatus> {
  return names.map((name: string): MonitorStatus => {
    return PROJECT_STATUSES.find((status: MonitorStatus): boolean => {
      return status.name === name;
    })!;
  });
}

let stored: StoredColumns | null | Error = null;
// What a new page counts as downtime: the statuses that are not operational.
let storedStatuses: Array<MonitorStatus> = [];
let projectStatuses: Array<MonitorStatus> | Error = PROJECT_STATUSES;
let gate: PermissionGateResult = { isAllowed: true };
let plan: PlanType | null = null;

beforeEach(() => {
  stored = { ...NEW_PAGE };
  storedStatuses = statusesNamed("Degraded", "Offline");
  projectStatuses = PROJECT_STATUSES;
  gate = { isAllowed: true };
  plan = null;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (!stored) {
      return null;
    }

    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;

    for (const [column, value] of Object.entries(stored)) {
      (page as unknown as Record<string, unknown>)[column] = value;
    }

    page.downtimeMonitorStatuses = storedStatuses;

    return page;
  });

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    if (projectStatuses instanceof Error) {
      throw projectStatuses;
    }

    return {
      data: projectStatuses,
      count: projectStatuses.length,
      skip: 0,
      limit: 10000,
    };
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return plan;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <StatusPageDisplaySettingsCard
        statusPageId={new ObjectID(STATUS_PAGE_ID)}
      />,
    );
  });

  await waitFor(() => {
    expect(getItemMock).toHaveBeenCalled();
  });
}

async function loaded(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.getByTestId(getDisplaySectionTestId("powered-by")),
    ).toBeInTheDocument();
  });
}

function switchFor(column: DisplaySwitchColumn): HTMLElement {
  return screen.getByTestId(getDisplaySwitchTestId(column));
}

function querySwitchFor(column: DisplaySwitchColumn): HTMLElement | null {
  return screen.queryByTestId(getDisplaySwitchTestId(column));
}

function switchRowFor(column: DisplaySwitchColumn): HTMLElement {
  return screen.getByTestId(`${getDisplaySwitchTestId(column)}-row`);
}

function daysFor(column: DisplayDaysColumn): HTMLInputElement {
  return screen.getByTestId(getDisplayDaysTestId(column)) as HTMLInputElement;
}

function queryDaysFor(column: DisplayDaysColumn): HTMLElement | null {
  return screen.queryByTestId(getDisplayDaysTestId(column));
}

function daysRowFor(column: DisplayDaysColumn): HTMLElement {
  return screen.getByTestId(`${getDisplayDaysTestId(column)}-row`);
}

const PRECISION: DisplayChoiceColumn = "overallUptimePercentPrecision";
const DOWNTIME: DisplayStatusesColumn = "downtimeMonitorStatuses";
const OVERALL: DisplaySwitchColumn = "showOverallUptimePercentOnStatusPage";

function choiceRowFor(column: DisplayChoiceColumn): HTMLElement {
  return screen.getByTestId(`${getDisplayChoiceTestId(column)}-row`);
}

function queryChoiceRowFor(column: DisplayChoiceColumn): HTMLElement | null {
  return screen.queryByTestId(`${getDisplayChoiceTestId(column)}-row`);
}

function statusesRowFor(column: DisplayStatusesColumn): HTMLElement {
  return screen.getByTestId(`${getDisplayStatusesTestId(column)}-row`);
}

/*
 * The dropdowns' inputs, found in their rows. A locked react-select hides
 * its input (visibility: hidden), which takes its name out of the
 * accessibility tree, so the names are checked where the dropdowns are not
 * locked.
 */
function precisionBox(): HTMLElement {
  return within(choiceRowFor(PRECISION)).getByRole("combobox", {
    hidden: true,
  });
}

function downtimeBox(): HTMLElement {
  return within(statusesRowFor(DOWNTIME)).getByRole("combobox", {
    hidden: true,
  });
}

// What the precision dropdown shows as picked.
function shownPrecision(): string {
  const row: HTMLElement = choiceRowFor(PRECISION);

  return (
    row.querySelector(".ou-select__single-value")?.textContent ||
    row.querySelector(".ou-select__placeholder")?.textContent ||
    ""
  );
}

// The names on the downtime chips, in order.
function downtimeChips(): Array<string> {
  return Array.from(
    statusesRowFor(DOWNTIME).querySelectorAll(".ou-select__multi-value__label"),
  ).map((chip: Element): string => {
    return (chip.textContent || "").trim();
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

// The options a dropdown offers, read from its open menu.
function offeredBy(box: HTMLElement): Array<string> {
  fireEvent.keyDown(box, { key: "ArrowDown", code: "ArrowDown" });

  const labels: Array<string> = screen
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return (option.textContent || "").trim();
    });

  fireEvent.keyDown(box, { key: "Escape", code: "Escape" });

  return labels;
}

async function pickFrom(box: HTMLElement, label: string): Promise<void> {
  fireEvent.keyDown(box, { key: "ArrowDown", code: "ArrowDown" });

  const option: HTMLElement = screen.getByRole("option", { name: label });

  fireEvent.mouseDown(option);
  fireEvent.click(option);
  await flush();
}

async function removeChip(name: string): Promise<void> {
  const remove: HTMLElement = within(statusesRowFor(DOWNTIME)).getByRole(
    "button",
    { name: `Remove ${name}` },
  );

  fireEvent.click(remove);
  await flush();
}

function updatesOf(column: string): Array<Record<string, unknown>> {
  return updateByIdMock.mock.calls
    .map((call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as Record<string, unknown>)["data"] as Record<
        string,
        unknown
      >;
    })
    .filter((data: Record<string, unknown>): boolean => {
      return column in data;
    });
}

function definitionOf(column: DisplaySwitchColumn): DisplaySwitchDefinition {
  return DISPLAY_SWITCHES.find(
    (candidate: DisplaySwitchDefinition): boolean => {
      return candidate.column === column;
    },
  )!;
}

function daysDefinitionOf(column: DisplayDaysColumn): DisplayDaysDefinition {
  return DISPLAY_DAYS.find((candidate: DisplayDaysDefinition): boolean => {
    return candidate.column === column;
  })!;
}

async function press(column: DisplaySwitchColumn): Promise<void> {
  await act(async () => {
    fireEvent.click(switchFor(column));
  });
}

// Types a number into a box and leaves it, as a person would.
async function typeDays(
  column: DisplayDaysColumn,
  text: string,
  leaveWith: "blur" | "enter" = "blur",
): Promise<void> {
  const box: HTMLInputElement = daysFor(column);

  await act(async () => {
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: text } });
  });

  await act(async () => {
    if (leaveWith === "enter") {
      fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    } else {
      fireEvent.blur(box);
    }
  });
}

function lastUpdate(): Record<string, unknown> {
  expect(updateByIdMock).toHaveBeenCalled();
  return updateByIdMock.mock.calls[
    updateByIdMock.mock.calls.length - 1
  ]![0] as Record<string, unknown>;
}

const LIST_SWITCHES: Array<DisplaySwitchColumn> = [
  "showIncidentsOnStatusPage",
  "showEpisodesOnStatusPage",
  "showAnnouncementsOnStatusPage",
  "showScheduledMaintenanceEventsOnStatusPage",
];

describe("reading the status page", () => {
  test("asks once for the card's seventeen columns and nothing else", async () => {
    await renderCard();
    await loaded();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["select"]).toEqual({
      showIncidentsOnStatusPage: true,
      showIncidentHistoryInDays: true,
      showIncidentLabelsOnStatusPage: true,
      onlyShowScopedIncidents: true,
      showEpisodesOnStatusPage: true,
      showEpisodeHistoryInDays: true,
      showEpisodeLabelsOnStatusPage: true,
      showAnnouncementsOnStatusPage: true,
      showAnnouncementHistoryInDays: true,
      showScheduledMaintenanceEventsOnStatusPage: true,
      showScheduledEventHistoryInDays: true,
      showScheduledEventLabelsOnStatusPage: true,
      showUptimeHistoryInDays: true,
      showOverallUptimePercentOnStatusPage: true,
      overallUptimePercentPrecision: true,
      // What each chip shows.
      downtimeMonitorStatuses: { _id: true, name: true, color: true },
      hidePoweredByOneUptimeBranding: true,
    });
    expect(DISPLAY_SETTING_COLUMNS).toHaveLength(17);
  });

  test("asks once for the project's monitor statuses, in their colours and priority order, for the downtime picker", async () => {
    await renderCard();
    await loaded();
    await flush();

    expect(getListMock).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = getListMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(MonitorStatus);
    expect(request["select"]).toEqual({
      _id: true,
      name: true,
      color: true,
      priority: true,
    });
    expect(request["sort"]).toEqual({ priority: SortOrder.Ascending });
  });

  test("is one card, saying what it is for", async () => {
    await renderCard();
    await loaded();

    expect(
      screen.getByText(StatusPageDisplaySettingsCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(StatusPageDisplaySettingsCopy.cardDescription),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("card")).toHaveLength(1);
  });

  test("has no Edit button and no dialog: nothing to open before changing something", async () => {
    await renderCard();
    await loaded();

    expect(screen.queryByText("Edit Settings")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-button")).not.toBeInTheDocument();
  });

  test("lists incidents, episodes, announcements, scheduled maintenance, uptime history, then the Powered by line", async () => {
    await renderCard();
    await loaded();

    const card: HTMLElement = screen.getByTestId(
      STATUS_PAGE_DISPLAY_SETTINGS_CARD_TEST_ID,
    );

    const ids: Array<string | null> = Array.from(
      card.querySelectorAll('[data-testid^="status-page-display-section-"]'),
    ).map((element: Element): string | null => {
      return element.getAttribute("data-testid");
    });

    expect(ids).toEqual([
      "status-page-display-section-incidents",
      "status-page-display-section-episodes",
      "status-page-display-section-announcements",
      "status-page-display-section-scheduled-maintenance",
      "status-page-display-section-uptime-history",
      "status-page-display-section-powered-by",
    ]);
    expect(
      DISPLAY_SECTIONS.map((section: DisplaySectionDefinition): string => {
        return section.id;
      }),
    ).toEqual([
      "incidents",
      "episodes",
      "announcements",
      "scheduled-maintenance",
      "uptime-history",
      "powered-by",
    ]);
  });

  test("names every switch by its title, and every number box by its setting", async () => {
    await renderCard();
    await loaded();

    for (const definition of DISPLAY_SWITCHES) {
      expect(screen.getByRole("switch", { name: definition.title })).toBe(
        switchFor(definition.column),
      );
    }

    for (const definition of DISPLAY_DAYS) {
      expect(screen.getByRole("spinbutton", { name: definition.label })).toBe(
        daysFor(definition.column),
      );
    }

    expect(screen.getAllByRole("switch")).toHaveLength(10);
    expect(screen.getAllByRole("spinbutton")).toHaveLength(5);

    // The downtime picker; the precision only while the overall % is on.
    expect(screen.getAllByRole("combobox")).toEqual([downtimeBox()]);
  });

  test("keeps the names the settings have always had, and the scope switch's own copy", async () => {
    expect(
      DISPLAY_SWITCHES.map((definition: DisplaySwitchDefinition): string => {
        return definition.title;
      }),
    ).toEqual([
      "Show Incidents",
      "Show Incident Labels",
      IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle,
      "Show Episodes",
      "Show Episode Labels",
      "Show Announcements",
      "Show Scheduled Maintenance Events",
      "Show Event Labels",
      "Show Overall Uptime Percent",
      "Show Powered By OneUptime Branding",
    ]);

    await renderCard();
    await loaded();

    expect(
      within(switchRowFor("onlyShowScopedIncidents")).getByText(
        IncidentStatusPageScopeCopy.onlyShowScopedIncidentsDescription,
      ),
    ).toBeInTheDocument();
  });

  test("a new page shows every list, with 14 days of history, no labels, all incidents, 90 days of uptime and the Powered by line", async () => {
    await renderCard();
    await loaded();

    for (const column of LIST_SWITCHES) {
      expect(switchFor(column)).toHaveAttribute("aria-checked", "true");
    }

    for (const column of [
      "showIncidentLabelsOnStatusPage",
      "showEpisodeLabelsOnStatusPage",
      "showScheduledEventLabelsOnStatusPage",
      "onlyShowScopedIncidents",
    ] as Array<DisplaySwitchColumn>) {
      expect(switchFor(column)).toHaveAttribute("aria-checked", "false");
    }

    for (const column of [
      "showIncidentHistoryInDays",
      "showEpisodeHistoryInDays",
      "showAnnouncementHistoryInDays",
      "showScheduledEventHistoryInDays",
    ] as Array<DisplayDaysColumn>) {
      expect(daysFor(column)).toHaveValue(14);
    }

    expect(daysFor("showUptimeHistoryInDays")).toHaveValue(90);

    // No overall uptime percentage, so no precision to pick.
    expect(switchFor(OVERALL)).toHaveAttribute("aria-checked", "false");
    expect(queryChoiceRowFor(PRECISION)).toBeNull();

    // The statuses that are not operational count as downtime.
    expect(downtimeChips()).toEqual(["Degraded", "Offline"]);

    // Stored as "do not hide it", shown as a switch that is on.
    expect(switchFor("hidePoweredByOneUptimeBranding")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("shows each setting as the page has it", async () => {
    storedStatuses = statusesNamed("Offline");
    stored = {
      ...NEW_PAGE,
      showOverallUptimePercentOnStatusPage: true,
      overallUptimePercentPrecision: UptimePrecision.THREE_DECIMAL,
      showIncidentHistoryInDays: 30,
      showIncidentLabelsOnStatusPage: true,
      onlyShowScopedIncidents: true,
      showEpisodeHistoryInDays: 3,
      showEpisodeLabelsOnStatusPage: true,
      showAnnouncementHistoryInDays: 60,
      showScheduledEventHistoryInDays: 7,
      showScheduledEventLabelsOnStatusPage: true,
      showUptimeHistoryInDays: 45,
      hidePoweredByOneUptimeBranding: true,
    };

    await renderCard();
    await loaded();

    for (const column of [
      "showIncidentLabelsOnStatusPage",
      "onlyShowScopedIncidents",
      "showEpisodeLabelsOnStatusPage",
      "showScheduledEventLabelsOnStatusPage",
    ] as Array<DisplaySwitchColumn>) {
      expect(switchFor(column)).toHaveAttribute("aria-checked", "true");
    }

    expect(daysFor("showIncidentHistoryInDays")).toHaveValue(30);
    expect(daysFor("showEpisodeHistoryInDays")).toHaveValue(3);
    expect(daysFor("showAnnouncementHistoryInDays")).toHaveValue(60);
    expect(daysFor("showScheduledEventHistoryInDays")).toHaveValue(7);
    expect(daysFor("showUptimeHistoryInDays")).toHaveValue(45);

    expect(switchFor(OVERALL)).toHaveAttribute("aria-checked", "true");
    expect(shownPrecision()).toBe("99.999%");
    expect(downtimeChips()).toEqual(["Offline"]);

    // Hidden: the switch that shows it is off.
    expect(switchFor("hidePoweredByOneUptimeBranding")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("a page with no value for a setting shows the model's default for it", async () => {
    stored = { showOverallUptimePercentOnStatusPage: true };

    await renderCard();
    await loaded();

    // Two decimals: the precision's own default.
    expect(shownPrecision()).toBe("99.99%");

    for (const column of LIST_SWITCHES) {
      expect(switchFor(column)).toHaveAttribute("aria-checked", "true");
    }

    expect(switchFor("showIncidentLabelsOnStatusPage")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(daysFor("showIncidentHistoryInDays")).toHaveValue(14);
    expect(daysFor("showUptimeHistoryInDays")).toHaveValue(90);
    expect(switchFor("hidePoweredByOneUptimeBranding")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a page with no value for any setting shows the overall uptime percentage off, the default", async () => {
    stored = {};

    await renderCard();
    await loaded();

    expect(switchFor(OVERALL)).toHaveAttribute("aria-checked", "false");
    expect(queryChoiceRowFor(PRECISION)).toBeNull();
  });

  test("a page that is not there says so, with nothing to change", async () => {
    stored = null;

    await renderCard();

    await waitFor(() => {
      expect(
        screen.getByText(StatusPageDisplaySettingsCopy.notFound),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  test("a read that fails says why, with nothing to change, and can be tried again", async () => {
    stored = new Error("The server is down for maintenance.");

    await renderCard();

    await waitFor(() => {
      expect(
        screen.getByText("The server is down for maintenance."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    stored = { ...NEW_PAGE };

    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(STATUS_PAGE_DISPLAY_SETTINGS_CARD_TEST_ID),
        ).getByTestId("refresh-button"),
      );
    });

    await loaded();
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });
});

describe("flipping a switch", () => {
  test.each(
    DISPLAY_SWITCHES.map((definition: DisplaySwitchDefinition) => {
      return [definition.column];
    }),
  )(
    "%s saves that column of this page, at once, and nothing else",
    async (column: DisplaySwitchColumn) => {
      await renderCard();
      await loaded();

      const before: boolean =
        switchFor(column).getAttribute("aria-checked") === "true";

      await press(column);

      await waitFor(() => {
        expect(switchFor(column)).toHaveAttribute(
          "aria-checked",
          before ? "false" : "true",
        );
      });

      expect(updateByIdMock).toHaveBeenCalledTimes(1);

      const request: Record<string, unknown> = lastUpdate();

      expect(request["modelType"]).toBe(StatusPage);
      expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);

      // The switch shows the opposite of what the inverted column stores.
      const stored: boolean = definitionOf(column).isInverted
        ? before
        : !before;

      expect(request["data"]).toEqual({ [column]: stored });
    },
  );

  test("turning the Powered by line off stores that it is hidden, and on again that it is not", async () => {
    await renderCard();
    await loaded();

    await press("hidePoweredByOneUptimeBranding");

    await waitFor(() => {
      expect(lastUpdate()["data"]).toEqual({
        hidePoweredByOneUptimeBranding: true,
      });
    });

    await waitFor(() => {
      expect(switchFor("hidePoweredByOneUptimeBranding")).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    await press("hidePoweredByOneUptimeBranding");

    await waitFor(() => {
      expect(lastUpdate()["data"]).toEqual({
        hidePoweredByOneUptimeBranding: false,
      });
    });
    expect(switchFor("hidePoweredByOneUptimeBranding")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("is locked while the change is saved, without holding up the others", async () => {
    let finish: () => void = (): void => {};

    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    await renderCard();
    await loaded();

    await press("showEpisodeLabelsOnStatusPage");

    expect(switchFor("showEpisodeLabelsOnStatusPage")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(switchFor("showEpisodeLabelsOnStatusPage")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // A second press while it saves does nothing.
    await press("showEpisodeLabelsOnStatusPage");
    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    expect(switchFor("showIncidentLabelsOnStatusPage")).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(daysFor("showUptimeHistoryInDays")).not.toHaveAttribute("readonly");

    await act(async () => {
      finish();
    });

    await waitFor(() => {
      expect(switchFor("showEpisodeLabelsOnStatusPage")).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
    expect(switchFor("showEpisodeLabelsOnStatusPage")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a refused save moves the switch back, and says why under it", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "Please upgrade your plan to Growth to access this feature",
      );
    });

    await renderCard();
    await loaded();

    await press("showScheduledEventLabelsOnStatusPage");

    await waitFor(() => {
      expect(
        within(switchRowFor("showScheduledEventLabelsOnStatusPage")).getByRole(
          "alert",
        ),
      ).toHaveTextContent(
        "Please upgrade your plan to Growth to access this feature",
      );
    });
    expect(switchFor("showScheduledEventLabelsOnStatusPage")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    // Only that row says so.
    expect(
      within(switchRowFor("showEpisodeLabelsOnStatusPage")).queryByRole(
        "alert",
      ),
    ).not.toBeInTheDocument();
  });
});

describe("a list that is off", () => {
  test.each([
    [
      "showIncidentsOnStatusPage",
      "showIncidentHistoryInDays",
      "showIncidentLabelsOnStatusPage",
    ],
    [
      "showEpisodesOnStatusPage",
      "showEpisodeHistoryInDays",
      "showEpisodeLabelsOnStatusPage",
    ],
    [
      "showScheduledMaintenanceEventsOnStatusPage",
      "showScheduledEventHistoryInDays",
      "showScheduledEventLabelsOnStatusPage",
    ],
  ] as Array<[DisplaySwitchColumn, DisplayDaysColumn, DisplaySwitchColumn]>)(
    "turning %s off takes away its history and labels, which then change nothing",
    async (
      list: DisplaySwitchColumn,
      days: DisplayDaysColumn,
      labels: DisplaySwitchColumn,
    ) => {
      await renderCard();
      await loaded();

      expect(queryDaysFor(days)).toBeInTheDocument();
      expect(querySwitchFor(labels)).toBeInTheDocument();

      await press(list);

      await waitFor(() => {
        expect(queryDaysFor(days)).not.toBeInTheDocument();
      });
      expect(querySwitchFor(labels)).not.toBeInTheDocument();

      await waitFor(() => {
        expect(switchFor(list)).not.toHaveAttribute("aria-disabled", "true");
      });

      await press(list);

      await waitFor(() => {
        expect(queryDaysFor(days)).toBeInTheDocument();
      });
      expect(querySwitchFor(labels)).toBeInTheDocument();
    },
  );

  test("turning announcements off takes away how far back they go", async () => {
    await renderCard();
    await loaded();

    await press("showAnnouncementsOnStatusPage");

    await waitFor(() => {
      expect(
        queryDaysFor("showAnnouncementHistoryInDays"),
      ).not.toBeInTheDocument();
    });
  });

  test("says what off means: hidden from visitors, and subscribers are not told", async () => {
    await renderCard();
    await loaded();

    // Nothing to say while it is on.
    expect(
      within(switchRowFor("showIncidentsOnStatusPage")).queryByText(
        StatusPageDisplaySettingsCopy.hiddenListDescription,
      ),
    ).not.toBeInTheDocument();

    await press("showIncidentsOnStatusPage");

    await waitFor(() => {
      expect(
        within(switchRowFor("showIncidentsOnStatusPage")).getByText(
          StatusPageDisplaySettingsCopy.hiddenListDescription,
        ),
      ).toBeInTheDocument();
    });

    // The others are still on, and say nothing.
    expect(
      within(switchRowFor("showEpisodesOnStatusPage")).queryByText(
        StatusPageDisplaySettingsCopy.hiddenListDescription,
      ),
    ).not.toBeInTheDocument();
  });

  test("keeps Only Show Incidents Scoped to This Page while incidents are off: it still decides which episodes reach the page", async () => {
    stored = { ...NEW_PAGE, showIncidentsOnStatusPage: false };

    await renderCard();
    await loaded();

    expect(querySwitchFor("onlyShowScopedIncidents")).toBeInTheDocument();
    expect(querySwitchFor("showIncidentLabelsOnStatusPage")).toBeNull();
    expect(queryDaysFor("showIncidentHistoryInDays")).toBeNull();

    await press("onlyShowScopedIncidents");

    await waitFor(() => {
      expect(lastUpdate()["data"]).toEqual({ onlyShowScopedIncidents: true });
    });
  });

  test("a page loaded with a list off offers only that list's switch", async () => {
    stored = {
      ...NEW_PAGE,
      showEpisodesOnStatusPage: false,
      showAnnouncementsOnStatusPage: false,
    };

    await renderCard();
    await loaded();

    const episodes: HTMLElement = screen.getByTestId(
      getDisplaySectionTestId("episodes"),
    );

    expect(within(episodes).getAllByRole("switch")).toHaveLength(1);
    expect(within(episodes).queryByRole("spinbutton")).toBeNull();
    expect(
      within(episodes).getByText(
        StatusPageDisplaySettingsCopy.hiddenListDescription,
      ),
    ).toBeInTheDocument();

    expect(
      within(
        screen.getByTestId(getDisplaySectionTestId("announcements")),
      ).queryByRole("spinbutton"),
    ).toBeNull();

    // The lists that are on keep theirs.
    expect(daysFor("showIncidentHistoryInDays")).toBeInTheDocument();
  });

  test("turned on again, its history and labels are as last saved, not as first read", async () => {
    await renderCard();
    await loaded();

    await press("showIncidentLabelsOnStatusPage");
    await waitFor(() => {
      expect(switchFor("showIncidentLabelsOnStatusPage")).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    await typeDays("showIncidentHistoryInDays", "30");
    await waitFor(() => {
      expect(lastUpdate()["data"]).toEqual({ showIncidentHistoryInDays: 30 });
    });

    await press("showIncidentsOnStatusPage");
    await waitFor(() => {
      expect(queryDaysFor("showIncidentHistoryInDays")).toBeNull();
    });
    await waitFor(() => {
      expect(switchFor("showIncidentsOnStatusPage")).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    await press("showIncidentsOnStatusPage");

    await waitFor(() => {
      expect(daysFor("showIncidentHistoryInDays")).toHaveValue(30);
    });
    expect(switchFor("showIncidentLabelsOnStatusPage")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a refused attempt to hide a list leaves its history and labels where they were", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "Please upgrade your plan to Growth to access this feature",
      );
    });

    await renderCard();
    await loaded();

    await press("showIncidentsOnStatusPage");

    await waitFor(() => {
      expect(
        within(switchRowFor("showIncidentsOnStatusPage")).getByRole("alert"),
      ).toBeInTheDocument();
    });

    expect(switchFor("showIncidentsOnStatusPage")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(daysFor("showIncidentHistoryInDays")).toBeInTheDocument();
    expect(switchFor("showIncidentLabelsOnStatusPage")).toBeInTheDocument();
  });
});

describe("how many days", () => {
  test("reads as a sentence with the number in it", async () => {
    await renderCard();
    await loaded();

    const row: HTMLElement = daysRowFor("showIncidentHistoryInDays");

    // The words, read in order, with the box's value where the box is.
    const walker: TreeWalker = document.createTreeWalker(
      row,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    const words: Array<string> = [];

    for (
      let node: Node | null = walker.nextNode();
      node;
      node = walker.nextNode()
    ) {
      if (node.nodeType === Node.TEXT_NODE) {
        words.push(node.textContent || "");
      } else if ((node as Element).tagName === "INPUT") {
        words.push(` [${(node as HTMLInputElement).value}] `);
      }
    }

    expect(words.join("").replace(/\s+/g, " ").trim()).toBe(
      "Show the last [14] days",
    );

    // The words are apart in the text itself, not only on screen.
    expect(row).toHaveTextContent("Show the last days");
  });

  test("says day, not days, for one", async () => {
    stored = { ...NEW_PAGE, showAnnouncementHistoryInDays: 1 };

    await renderCard();
    await loaded();

    expect(daysRowFor("showAnnouncementHistoryInDays")).toHaveTextContent(
      /Show the last\s*day$/,
    );
    expect(daysRowFor("showIncidentHistoryInDays")).toHaveTextContent(
      /Show the last\s*days$/,
    );
  });

  test.each(
    DISPLAY_DAYS.map((definition: DisplayDaysDefinition) => {
      return [definition.column];
    }),
  )(
    "%s saves the new number when the box is left, and only that column",
    async (column: DisplayDaysColumn) => {
      await renderCard();
      await loaded();

      await typeDays(column, "21");

      await waitFor(() => {
        expect(updateByIdMock).toHaveBeenCalledTimes(1);
      });

      const request: Record<string, unknown> = lastUpdate();

      expect(request["modelType"]).toBe(StatusPage);
      expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
      expect(request["data"]).toEqual({ [column]: 21 });

      await waitFor(() => {
        expect(
          screen.getByTestId(`${getDisplayDaysTestId(column)}-status`),
        ).toHaveTextContent(StatusPageDisplaySettingsCopy.saved);
      });
      expect(daysFor(column)).toHaveValue(21);
    },
  );

  test("Enter saves too, and leaving the box afterwards does not save again", async () => {
    await renderCard();
    await loaded();

    await typeDays("showEpisodeHistoryInDays", "7", "enter");

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(lastUpdate()["data"]).toEqual({ showEpisodeHistoryInDays: 7 });

    await act(async () => {
      fireEvent.blur(daysFor("showEpisodeHistoryInDays"));
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });

  test("Escape puts back the number the page has, and nothing is saved", async () => {
    await renderCard();
    await loaded();

    const box: HTMLInputElement = daysFor("showEpisodeHistoryInDays");

    await act(async () => {
      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: "0" } });
    });

    // A number it cannot take, said so on Enter...
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    });
    expect(
      screen.getByTestId(
        `${getDisplayDaysTestId("showEpisodeHistoryInDays")}-error`,
      ),
    ).toBeInTheDocument();

    // ...and taken back with Escape, the message with it.
    await act(async () => {
      fireEvent.keyDown(box, { key: "Escape", code: "Escape" });
    });

    expect(daysFor("showEpisodeHistoryInDays")).toHaveValue(14);
    expect(
      screen.queryByTestId(
        `${getDisplayDaysTestId("showEpisodeHistoryInDays")}-error`,
      ),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.blur(daysFor("showEpisodeHistoryInDays"));
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("leaving the box with the number the page already has saves nothing", async () => {
    await renderCard();
    await loaded();

    await typeDays("showIncidentHistoryInDays", "14");
    await typeDays("showIncidentHistoryInDays", "014");

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(daysFor("showIncidentHistoryInDays")).toHaveValue(14);
    expect(
      screen.getByTestId(
        `${getDisplayDaysTestId("showIncidentHistoryInDays")}-status`,
      ),
    ).not.toHaveTextContent(StatusPageDisplaySettingsCopy.saved);
  });

  test.each([[""], ["0"], ["-3"], ["2.5"]])(
    "%j is not a number of days: nothing is sent, and the box says what to type",
    async (text: string) => {
      await renderCard();
      await loaded();

      await typeDays("showAnnouncementHistoryInDays", text);

      expect(updateByIdMock).not.toHaveBeenCalled();

      const error: HTMLElement = screen.getByTestId(
        `${getDisplayDaysTestId("showAnnouncementHistoryInDays")}-error`,
      );

      expect(error).toHaveTextContent(StatusPageDisplaySettingsCopy.daysTooFew);
      expect(error).toHaveAttribute("role", "alert");

      const box: HTMLInputElement = daysFor("showAnnouncementHistoryInDays");

      expect(box).toHaveAttribute("aria-invalid", "true");
      expect(box.getAttribute("aria-describedby")).toBe(error.id);

      // Typing again clears it, and a good number saves.
      await typeDays("showAnnouncementHistoryInDays", "5");

      await waitFor(() => {
        expect(lastUpdate()["data"]).toEqual({
          showAnnouncementHistoryInDays: 5,
        });
      });
      expect(
        screen.queryByTestId(
          `${getDisplayDaysTestId("showAnnouncementHistoryInDays")}-error`,
        ),
      ).not.toBeInTheDocument();
    },
  );

  test("uptime history stops at 90 days, the most the bars cover", async () => {
    await renderCard();
    await loaded();

    expect(daysDefinitionOf("showUptimeHistoryInDays").maxDays).toBe(90);

    await typeDays("showUptimeHistoryInDays", "91");

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId(
        `${getDisplayDaysTestId("showUptimeHistoryInDays")}-error`,
      ),
    ).toHaveTextContent("Enter a whole number of days between 1 and 90.");

    await typeDays("showUptimeHistoryInDays", "90");
    await typeDays("showUptimeHistoryInDays", "30");

    await waitFor(() => {
      expect(lastUpdate()["data"]).toEqual({ showUptimeHistoryInDays: 30 });
    });
  });

  test("the lists have no upper limit, as before", async () => {
    await renderCard();
    await loaded();

    await typeDays("showIncidentHistoryInDays", "365");

    await waitFor(() => {
      expect(lastUpdate()["data"]).toEqual({
        showIncidentHistoryInDays: 365,
      });
    });
  });

  test("the uptime row says what the number is for, and the box points at it", async () => {
    await renderCard();
    await loaded();

    const section: HTMLElement = screen.getByTestId(
      getDisplaySectionTestId("uptime-history"),
    );

    expect(
      within(section).getByText(StatusPageDisplaySettingsCopy.uptimeTitle),
    ).toBeInTheDocument();

    const description: HTMLElement = within(section).getByText(
      "How many days the uptime bars and uptime percentages cover, up to 90.",
    );

    expect(
      daysFor("showUptimeHistoryInDays").getAttribute("aria-describedby"),
    ).toBe(description.id);

    // No switch of its own, the uptime bars are always there: only the overall %.
    expect(within(section).getAllByRole("switch")).toEqual([
      switchFor(OVERALL),
    ]);
  });

  test("is locked while it saves, then says Saved", async () => {
    let finish: () => void = (): void => {};

    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    await renderCard();
    await loaded();

    await typeDays("showScheduledEventHistoryInDays", "10");

    const status: HTMLElement = screen.getByTestId(
      `${getDisplayDaysTestId("showScheduledEventHistoryInDays")}-status`,
    );

    expect(daysFor("showScheduledEventHistoryInDays")).toHaveAttribute(
      "readonly",
    );
    expect(status).toHaveTextContent(StatusPageDisplaySettingsCopy.saving);
    expect(status).toHaveAttribute("role", "status");

    await act(async () => {
      finish();
    });

    await waitFor(() => {
      expect(status).toHaveTextContent(StatusPageDisplaySettingsCopy.saved);
    });
    expect(daysFor("showScheduledEventHistoryInDays")).not.toHaveAttribute(
      "readonly",
    );

    // Typing again takes the Saved away until the next save.
    await act(async () => {
      fireEvent.change(daysFor("showScheduledEventHistoryInDays"), {
        target: { value: "11" },
      });
    });
    expect(status).not.toHaveTextContent(StatusPageDisplaySettingsCopy.saved);
  });

  test("a refused number goes back to the one the page has, with the reason", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "Please upgrade your plan to Growth to access this feature",
      );
    });

    await renderCard();
    await loaded();

    await typeDays("showEpisodeHistoryInDays", "30");

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${getDisplayDaysTestId("showEpisodeHistoryInDays")}-error`,
        ),
      ).toHaveTextContent(
        "Please upgrade your plan to Growth to access this feature",
      );
    });
    expect(daysFor("showEpisodeHistoryInDays")).toHaveValue(14);
    expect(
      screen.getByTestId(
        `${getDisplayDaysTestId("showEpisodeHistoryInDays")}-status`,
      ),
    ).not.toHaveTextContent(StatusPageDisplaySettingsCopy.saved);
  });
});

describe("the overall uptime percentage", () => {
  test("sits in the uptime row, under the number of days, saying what visitors see", async () => {
    await renderCard();
    await loaded();

    const section: HTMLElement = screen.getByTestId(
      getDisplaySectionTestId("uptime-history"),
    );

    expect(
      within(section).getByRole("switch", {
        name: "Show Overall Uptime Percent",
      }),
    ).toBe(switchFor(OVERALL));
    expect(
      within(switchRowFor(OVERALL)).getByText(
        StatusPageDisplaySettingsCopy.overallUptimeDescription,
      ),
    ).toBeInTheDocument();

    // The days first, then the switch.
    const days: HTMLElement = daysFor("showUptimeHistoryInDays");

    expect(
      days.compareDocumentPosition(switchFor(OVERALL)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("off, as a new page has it, offers no precision: the precision is of that percentage alone", async () => {
    await renderCard();
    await loaded();

    expect(switchFor(OVERALL)).toHaveAttribute("aria-checked", "false");
    expect(queryChoiceRowFor(PRECISION)).toBeNull();
  });

  test("turning it on saves the switch alone, and offers the precision the page has", async () => {
    await renderCard();
    await loaded();

    await press(OVERALL);

    await waitFor(() => {
      expect(choiceRowFor(PRECISION)).toBeInTheDocument();
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(lastUpdate()["data"]).toEqual({
      showOverallUptimePercentOnStatusPage: true,
    });
    expect(shownPrecision()).toBe("99.99%");
    expect(
      screen.getByRole("combobox", {
        name: StatusPageDisplaySettingsCopy.precisionLabel,
      }),
    ).toBe(precisionBox());
  });

  test("turning it off takes the precision away, and saves the switch alone", async () => {
    stored = { ...NEW_PAGE, showOverallUptimePercentOnStatusPage: true };

    await renderCard();
    await loaded();

    expect(choiceRowFor(PRECISION)).toBeInTheDocument();

    await press(OVERALL);

    await waitFor(() => {
      expect(queryChoiceRowFor(PRECISION)).toBeNull();
    });
    expect(lastUpdate()["data"]).toEqual({
      showOverallUptimePercentOnStatusPage: false,
    });
  });

  test("offers every precision, fewest decimals first, each as a visitor would read it", async () => {
    stored = { ...NEW_PAGE, showOverallUptimePercentOnStatusPage: true };

    await renderCard();
    await loaded();

    expect(offeredBy(precisionBox())).toEqual([
      "99%",
      "99.9%",
      "99.99%",
      "99.999%",
    ]);
  });

  test.each([
    [UptimePrecision.NO_DECIMAL, "99%"],
    [UptimePrecision.ONE_DECIMAL, "99.9%"],
    [UptimePrecision.TWO_DECIMAL, "99.99%"],
    [UptimePrecision.THREE_DECIMAL, "99.999%"],
  ])("a page stored with %s shows %s", async (value: string, shown: string) => {
    stored = {
      ...NEW_PAGE,
      showOverallUptimePercentOnStatusPage: true,
      overallUptimePercentPrecision: value,
    };

    await renderCard();
    await loaded();

    expect(shownPrecision()).toBe(shown);
  });

  test("a precision the list does not know is shown as it is stored", async () => {
    stored = {
      ...NEW_PAGE,
      showOverallUptimePercentOnStatusPage: true,
      overallUptimePercentPrecision: "Five Decimal",
    };

    await renderCard();
    await loaded();

    expect(shownPrecision()).toBe("Five Decimal");
    expect(offeredBy(precisionBox())).toEqual([
      "99%",
      "99.9%",
      "99.99%",
      "99.999%",
      "Five Decimal",
    ]);
  });

  test("picking a precision saves that column alone, at once, and says so", async () => {
    stored = { ...NEW_PAGE, showOverallUptimePercentOnStatusPage: true };

    await renderCard();
    await loaded();

    await pickFrom(precisionBox(), "99.9%");

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = lastUpdate();

    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["data"]).toEqual({
      overallUptimePercentPrecision: UptimePrecision.ONE_DECIMAL,
    });
    expect(shownPrecision()).toBe("99.9%");
    expect(
      screen.getByTestId(`${getDisplayChoiceTestId(PRECISION)}-status`),
    ).toHaveTextContent(StatusPageDisplaySettingsCopy.saved);

    // No dialog, no Save button.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  test("picking what the page has saves nothing", async () => {
    stored = { ...NEW_PAGE, showOverallUptimePercentOnStatusPage: true };

    await renderCard();
    await loaded();

    await pickFrom(precisionBox(), "99.99%");

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId(`${getDisplayChoiceTestId(PRECISION)}-status`),
    ).toHaveTextContent("");
  });

  test("says Saving… while the pick is on its way, and stays usable, so a second pick is saved after it and the last one wins", async () => {
    stored = { ...NEW_PAGE, showOverallUptimePercentOnStatusPage: true };

    const finishers: Array<() => void> = [];

    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finishers.push((): void => {
          resolve({});
        });
      });
    });

    await renderCard();
    await loaded();

    await pickFrom(precisionBox(), "99%");

    expect(
      screen.getByTestId(`${getDisplayChoiceTestId(PRECISION)}-status`),
    ).toHaveTextContent(StatusPageDisplaySettingsCopy.saving);
    expect(precisionBox()).not.toBeDisabled();

    await pickFrom(precisionBox(), "99.9%");
    await pickFrom(precisionBox(), "99.999%");

    // One request at a time.
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(shownPrecision()).toBe("99.999%");

    await act(async () => {
      finishers[0]!();
    });
    await flush();

    // Only the last waiting pick is sent.
    expect(updateByIdMock).toHaveBeenCalledTimes(2);
    expect(lastUpdate()["data"]).toEqual({
      overallUptimePercentPrecision: UptimePrecision.THREE_DECIMAL,
    });

    await act(async () => {
      finishers[1]!();
    });
    await flush();

    expect(shownPrecision()).toBe("99.999%");
    expect(
      screen.getByTestId(`${getDisplayChoiceTestId(PRECISION)}-status`),
    ).toHaveTextContent(StatusPageDisplaySettingsCopy.saved);
    expect(updateByIdMock).toHaveBeenCalledTimes(2);
  });

  test("a refused pick goes back to the page's precision, with the reason", async () => {
    stored = { ...NEW_PAGE, showOverallUptimePercentOnStatusPage: true };

    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to update this Status Page.");
    });

    await renderCard();
    await loaded();

    await pickFrom(precisionBox(), "99%");

    const error: HTMLElement = screen.getByTestId(
      `${getDisplayChoiceTestId(PRECISION)}-error`,
    );

    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(
      "You do not have permission to update this Status Page.",
    );
    expect(shownPrecision()).toBe("99.99%");

    // A new pick clears it.
    updateByIdMock.mockResolvedValue({} as never);
    await pickFrom(precisionBox(), "99.9%");

    expect(
      screen.queryByTestId(`${getDisplayChoiceTestId(PRECISION)}-error`),
    ).toBeNull();
    expect(shownPrecision()).toBe("99.9%");
  });

  test("turned off and on again, the precision is as last saved, not as first read", async () => {
    stored = { ...NEW_PAGE, showOverallUptimePercentOnStatusPage: true };

    await renderCard();
    await loaded();

    await pickFrom(precisionBox(), "99%");
    expect(lastUpdate()["data"]).toEqual({
      overallUptimePercentPrecision: UptimePrecision.NO_DECIMAL,
    });

    await press(OVERALL);
    await waitFor(() => {
      expect(queryChoiceRowFor(PRECISION)).toBeNull();
    });
    await waitFor(() => {
      expect(switchFor(OVERALL)).not.toHaveAttribute("aria-disabled", "true");
    });

    await press(OVERALL);

    await waitFor(() => {
      expect(shownPrecision()).toBe("99%");
    });
  });

  test("a refused attempt to turn it on (it needs the Scale plan) offers no precision", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "Please upgrade your plan to Scale to access this feature",
      );
    });

    await renderCard();
    await loaded();

    await press(OVERALL);

    await waitFor(() => {
      expect(
        within(switchRowFor(OVERALL)).getByRole("alert"),
      ).toHaveTextContent(
        "Please upgrade your plan to Scale to access this feature",
      );
    });
    expect(switchFor(OVERALL)).toHaveAttribute("aria-checked", "false");
    expect(queryChoiceRowFor(PRECISION)).toBeNull();
  });

  /*
   * The bug this row fixes: the precision shared an Edit dialog with the
   * switch, the dialog sent both, and the server refuses a write that
   * carries the Scale plan's switch on a lower plan - so a page whose
   * overall percentage was on (turned on on Scale, or by the API) could not
   * have its precision changed at all.
   */
  test("on a plan below Scale, the switch names Scale, and the precision still saves, on its own", async () => {
    plan = PlanType.Growth;
    stored = { ...NEW_PAGE, showOverallUptimePercentOnStatusPage: true };

    getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    ).mockImplementation((needed: unknown): boolean => {
      return needed === PlanType.Free || needed === PlanType.Growth;
    });

    await renderCard();
    await loaded();

    expect(within(switchRowFor(OVERALL)).getByTestId("pill")).toHaveTextContent(
      "Scale Plan",
    );
    expect(
      within(choiceRowFor(PRECISION)).queryByTestId("pill"),
    ).not.toBeInTheDocument();

    await pickFrom(precisionBox(), "99.999%");

    expect(updatesOf(PRECISION)).toEqual([
      { overallUptimePercentPrecision: UptimePrecision.THREE_DECIMAL },
    ]);
    expect(updatesOf(OVERALL)).toEqual([]);
  });
});

describe("what counts as downtime", () => {
  test("is in the uptime row, last, named for what it does, saying what it does", async () => {
    await renderCard();
    await loaded();
    await flush();

    const section: HTMLElement = screen.getByTestId(
      getDisplaySectionTestId("uptime-history"),
    );

    expect(
      within(section).getByTestId(`${getDisplayStatusesTestId(DOWNTIME)}-row`),
    ).toBe(statusesRowFor(DOWNTIME));
    expect(
      screen.getByRole("combobox", {
        name: StatusPageDisplaySettingsCopy.downtimeLabel,
      }),
    ).toBe(downtimeBox());
    expect(
      screen.getByTestId(`${getDisplayStatusesTestId(DOWNTIME)}-description`),
    ).toHaveTextContent(StatusPageDisplaySettingsCopy.downtimeDescription);

    // After the overall uptime percentage.
    expect(
      switchFor(OVERALL).compareDocumentPosition(downtimeBox()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("shows the page's statuses as chips, each in its own colour", async () => {
    await renderCard();
    await loaded();
    await flush();

    expect(downtimeChips()).toEqual(["Degraded", "Offline"]);

    const dots: Array<string | null> = Array.from(
      statusesRowFor(DOWNTIME).querySelectorAll(
        ".ou-select__multi-value__label [title]",
      ),
    ).map((dot: Element): string | null => {
      return dot.getAttribute("title");
    });

    expect(dots).toEqual(["#eab308", "#ef4444"]);
  });

  test("offers the project's other statuses, in priority order", async () => {
    await renderCard();
    await loaded();
    await flush();

    // The picked ones are chips already.
    expect(offeredBy(downtimeBox())).toEqual([
      "Operational",
      "Under Maintenance",
    ]);
  });

  test("adding a status saves the statuses alone, by id, at once, and says so", async () => {
    await renderCard();
    await loaded();
    await flush();

    await pickFrom(downtimeBox(), "Under Maintenance");

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = lastUpdate();

    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["data"]).toEqual({
      downtimeMonitorStatuses: [DEGRADED_ID, OFFLINE_ID, MAINTENANCE_ID],
    });
    expect(downtimeChips()).toEqual([
      "Degraded",
      "Offline",
      "Under Maintenance",
    ]);
    expect(
      screen.getByTestId(`${getDisplayStatusesTestId(DOWNTIME)}-status`),
    ).toHaveTextContent(StatusPageDisplaySettingsCopy.saved);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("taking a status off saves the rest", async () => {
    await renderCard();
    await loaded();
    await flush();

    await removeChip("Degraded");

    expect(lastUpdate()["data"]).toEqual({
      downtimeMonitorStatuses: [OFFLINE_ID],
    });
    expect(downtimeChips()).toEqual(["Offline"]);
  });

  test("the last status cannot be taken off: nothing is sent, the chip stays, and the row says why", async () => {
    storedStatuses = statusesNamed("Offline");

    await renderCard();
    await loaded();
    await flush();

    await removeChip("Offline");

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(downtimeChips()).toEqual(["Offline"]);

    const error: HTMLElement = screen.getByTestId(
      `${getDisplayStatusesTestId(DOWNTIME)}-error`,
    );

    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(
      StatusPageDisplaySettingsCopy.downtimeKeepOne,
    );

    // Adding one clears it and saves.
    await pickFrom(downtimeBox(), "Degraded");

    expect(
      screen.queryByTestId(`${getDisplayStatusesTestId(DOWNTIME)}-error`),
    ).toBeNull();
    expect(lastUpdate()["data"]).toEqual({
      downtimeMonitorStatuses: [OFFLINE_ID, DEGRADED_ID],
    });
  });

  test("has no clear-all control: the list always keeps a status", async () => {
    await renderCard();
    await loaded();
    await flush();

    expect(
      statusesRowFor(DOWNTIME).querySelector(".ou-select__clear-indicator"),
    ).toBeNull();
  });

  test("a refused change puts back the page's statuses, with the reason", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Monitor status not found.");
    });

    await renderCard();
    await loaded();
    await flush();

    await pickFrom(downtimeBox(), "Operational");

    expect(
      screen.getByTestId(`${getDisplayStatusesTestId(DOWNTIME)}-error`),
    ).toHaveTextContent("Monitor status not found.");
    expect(downtimeChips()).toEqual(["Degraded", "Offline"]);
    expect(
      screen.getByTestId(`${getDisplayStatusesTestId(DOWNTIME)}-status`),
    ).toHaveTextContent("");
  });

  test("is never locked while it saves: a change made meanwhile is saved after it, and the last one wins", async () => {
    const finishers: Array<() => void> = [];

    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finishers.push((): void => {
          resolve({});
        });
      });
    });

    await renderCard();
    await loaded();
    await flush();

    await pickFrom(downtimeBox(), "Under Maintenance");

    expect(downtimeBox()).not.toBeDisabled();
    expect(
      screen.getByTestId(`${getDisplayStatusesTestId(DOWNTIME)}-status`),
    ).toHaveTextContent(StatusPageDisplaySettingsCopy.saving);

    await removeChip("Degraded");
    await pickFrom(downtimeBox(), "Operational");

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(downtimeChips()).toEqual([
      "Offline",
      "Under Maintenance",
      "Operational",
    ]);

    await act(async () => {
      finishers[0]!();
    });
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(2);
    expect(lastUpdate()["data"]).toEqual({
      downtimeMonitorStatuses: [OFFLINE_ID, MAINTENANCE_ID, OPERATIONAL_ID],
    });

    await act(async () => {
      finishers[1]!();
    });
    await flush();

    expect(
      screen.getByTestId(`${getDisplayStatusesTestId(DOWNTIME)}-status`),
    ).toHaveTextContent(StatusPageDisplaySettingsCopy.saved);
  });

  test("a page with none (only the API leaves a page so) says every uptime percentage reads 100%, and a pick saves", async () => {
    storedStatuses = [];

    await renderCard();
    await loaded();
    await flush();

    expect(downtimeChips()).toEqual([]);
    expect(
      screen.getByTestId(`${getDisplayStatusesTestId(DOWNTIME)}-description`),
    ).toHaveTextContent(StatusPageDisplaySettingsCopy.downtimeEmptyDescription);
    expect(statusesRowFor(DOWNTIME)).toHaveTextContent(
      StatusPageDisplaySettingsCopy.downtimePlaceholder,
    );

    await pickFrom(downtimeBox(), "Offline");

    expect(lastUpdate()["data"]).toEqual({
      downtimeMonitorStatuses: [OFFLINE_ID],
    });
    expect(
      screen.getByTestId(`${getDisplayStatusesTestId(DOWNTIME)}-description`),
    ).toHaveTextContent(StatusPageDisplaySettingsCopy.downtimeDescription);
  });

  test("when the project's statuses cannot be read it says why, and the page's chips still show", async () => {
    projectStatuses = new Error("The server is down for maintenance.");

    await renderCard();
    await loaded();
    await flush();

    expect(
      screen.getByTestId(`${getDisplayStatusesTestId(DOWNTIME)}-load-error`),
    ).toHaveTextContent("The server is down for maintenance.");
    expect(downtimeChips()).toEqual(["Degraded", "Offline"]);

    // The rest of the card is untouched.
    expect(switchFor("showIncidentsOnStatusPage")).toBeInTheDocument();
  });

  test("a status the project's list leaves out stays a chip of its own, and can be taken off", async () => {
    const retired: MonitorStatus = monitorStatus({
      id: "6c6c6c6c-0000-4000-8000-000000000009",
      name: "Retired",
      color: "#000000",
      priority: 9,
    });

    storedStatuses = [...statusesNamed("Offline"), retired];

    await renderCard();
    await loaded();
    await flush();

    expect(downtimeChips()).toEqual(["Offline", "Retired"]);

    await removeChip("Retired");

    expect(lastUpdate()["data"]).toEqual({
      downtimeMonitorStatuses: [OFFLINE_ID],
    });
  });
});

describe("who may change them", () => {
  test("the gate is asked about updating a status page", async () => {
    await renderCard();
    await loaded();

    const calls: Array<Array<unknown>> = (
      PermissionGate.check as unknown as MockFunction
    ).mock.calls as Array<Array<unknown>>;

    expect(calls.length).toBeGreaterThan(0);

    for (const [model, action] of calls) {
      expect(model).toBeInstanceOf(StatusPage);
      expect(action).toBe(ModelAction.Update);
    }
  });

  test("someone who may not edit the page sees everything locked, with the reason, and nothing is saved", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You do not have permission to update this Status Page.",
    };
    stored = { ...NEW_PAGE, showOverallUptimePercentOnStatusPage: true };

    await renderCard();
    await loaded();

    for (const definition of DISPLAY_SWITCHES) {
      expect(switchFor(definition.column)).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }

    for (const definition of DISPLAY_DAYS) {
      expect(daysFor(definition.column)).toHaveAttribute("readonly");
    }

    // The precision and the downtime statuses too, still showing their values.
    expect(precisionBox()).toBeDisabled();
    expect(shownPrecision()).toBe("99.99%");
    expect(downtimeBox()).toBeDisabled();
    expect(downtimeChips()).toEqual(["Degraded", "Offline"]);
    expect(offeredBy(precisionBox())).toEqual([]);
    expect(offeredBy(downtimeBox())).toEqual([]);

    expect(
      screen.getAllByText(
        "You do not have permission to update this Status Page.",
      ).length,
    ).toBeGreaterThan(0);

    await press("showIncidentsOnStatusPage");
    await typeDays("showUptimeHistoryInDays", "30");

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(switchFor("showIncidentsOnStatusPage")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("plans", () => {
  test("with no plan to go by (billing off, or not loaded), nothing names a plan", async () => {
    plan = null;
    const accessible: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    );

    await renderCard();
    await loaded();

    expect(screen.queryByTestId("pill")).not.toBeInTheDocument();
    expect(accessible).not.toHaveBeenCalled();
  });

  test("on the Free plan, each setting the Free plan cannot change names the plan it needs, beside it", async () => {
    plan = PlanType.Free;
    // On, so its precision is drawn too.
    stored = { ...NEW_PAGE, showOverallUptimePercentOnStatusPage: true };

    getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    ).mockImplementation((needed: unknown, current: unknown): boolean => {
      expect(current).toBe(PlanType.Free);
      return needed === PlanType.Free;
    });

    await renderCard();
    await loaded();

    const statusPage: StatusPage = new StatusPage();

    const rowOf: (column: DisplaySettingColumn) => HTMLElement = (
      column: DisplaySettingColumn,
    ): HTMLElement => {
      if (
        DISPLAY_CHOICES.some((definition: { column: string }) => {
          return definition.column === column;
        })
      ) {
        return choiceRowFor(column as DisplayChoiceColumn);
      }

      if (
        DISPLAY_STATUSES.some((definition: { column: string }) => {
          return definition.column === column;
        })
      ) {
        return statusesRowFor(column as DisplayStatusesColumn);
      }

      return DISPLAY_DAYS.some((definition: DisplayDaysDefinition) => {
        return definition.column === column;
      })
        ? daysRowFor(column as DisplayDaysColumn)
        : switchRowFor(column as DisplaySwitchColumn);
    };

    for (const column of DISPLAY_SETTING_COLUMNS) {
      const billing: { update?: PlanType } | undefined =
        statusPage.getColumnBillingAccessControl(column);
      const needed: PlanType | undefined = billing?.update;

      if (!needed || needed === PlanType.Free) {
        expect({
          column: column,
          pill: within(rowOf(column)).queryByTestId("pill"),
        }).toEqual({ column: column, pill: null });
        continue;
      }

      expect(within(rowOf(column)).getByTestId("pill")).toHaveTextContent(
        `${needed} Plan`,
      );
    }

    /*
     * The overall uptime percentage needs Scale to be switched; its
     * precision and the downtime statuses, every plan.
     */
    expect(within(switchRowFor(OVERALL)).getByTestId("pill")).toHaveTextContent(
      "Scale Plan",
    );
    expect(
      within(choiceRowFor(PRECISION)).queryByTestId("pill"),
    ).not.toBeInTheDocument();
    expect(
      within(statusesRowFor(DOWNTIME)).queryByTestId("pill"),
    ).not.toBeInTheDocument();

    /*
     * As the model has it today: the four lists, their labels and how far
     * back episodes go from Growth; hiding the Powered by line from Scale;
     * the other history windows and the scope switch on every plan.
     */
    for (const column of [
      ...LIST_SWITCHES,
      "showIncidentLabelsOnStatusPage",
      "showEpisodeLabelsOnStatusPage",
      "showScheduledEventLabelsOnStatusPage",
    ] as Array<DisplaySwitchColumn>) {
      expect(
        within(switchRowFor(column)).getByTestId("pill"),
      ).toHaveTextContent("Growth Plan");
    }

    expect(
      within(daysRowFor("showEpisodeHistoryInDays")).getByTestId("pill"),
    ).toHaveTextContent("Growth Plan");
    expect(
      within(switchRowFor("hidePoweredByOneUptimeBranding")).getByTestId(
        "pill",
      ),
    ).toHaveTextContent("Scale Plan");

    for (const column of [
      "showIncidentHistoryInDays",
      "showAnnouncementHistoryInDays",
      "showScheduledEventHistoryInDays",
      "showUptimeHistoryInDays",
    ] as Array<DisplayDaysColumn>) {
      expect(
        within(daysRowFor(column)).queryByTestId("pill"),
      ).not.toBeInTheDocument();
    }

    expect(
      within(switchRowFor("onlyShowScopedIncidents")).queryByTestId("pill"),
    ).not.toBeInTheDocument();
  });

  test("on the Free plan, the free settings next to a paid one still save on their own", async () => {
    plan = PlanType.Free;

    getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    ).mockImplementation((needed: unknown): boolean => {
      return needed === PlanType.Free;
    });

    await renderCard();
    await loaded();

    await typeDays("showIncidentHistoryInDays", "30");
    await waitFor(() => {
      expect(lastUpdate()["data"]).toEqual({ showIncidentHistoryInDays: 30 });
    });

    await press("onlyShowScopedIncidents");
    await waitFor(() => {
      expect(lastUpdate()["data"]).toEqual({ onlyShowScopedIncidents: true });
    });

    await pickFrom(downtimeBox(), "Under Maintenance");
    await waitFor(() => {
      expect(lastUpdate()["data"]).toEqual({
        downtimeMonitorStatuses: [DEGRADED_ID, OFFLINE_ID, MAINTENANCE_ID],
      });
    });

    // Each request carried its own column alone.
    for (const call of updateByIdMock.mock.calls) {
      expect(
        Object.keys(
          (call[0] as Record<string, unknown>)["data"] as Record<
            string,
            unknown
          >,
        ),
      ).toHaveLength(1);
    }
  });

  test("the plan's name is beside a switch, not part of its name", async () => {
    plan = PlanType.Free;
    getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    ).mockImplementation((): boolean => {
      return false;
    });

    await renderCard();
    await loaded();

    expect(
      screen.getByRole("switch", {
        name: definitionOf("showIncidentsOnStatusPage").title,
      }),
    ).toBe(switchFor("showIncidentsOnStatusPage"));
  });
});
