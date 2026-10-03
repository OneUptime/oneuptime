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
 * the uptime history window and the "Powered by OneUptime" line.
 *
 * It replaced six cards with an Edit dialog each. Every control saves its
 * own column at once: switches when pressed, a number of days when the box
 * is left or Enter is pressed. A list that is off does not offer its history
 * and labels. Controls are locked while they save and for someone who may
 * not edit the page, roll back with the reason when the server refuses, and
 * name the plan they need.
 *
 * Only the network, the permission gate and the plan are stubbed; the card,
 * its rows, the switches and the number boxes are the real ones.
 */

/*
 * A refused request is an async function that throws, not
 * mockRejectedValue: the card's imports load zone.js, whose patched Promise
 * reports a rejected one as unhandled although the card catches it.
 */
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
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
  DISPLAY_DAYS,
  DISPLAY_SECTIONS,
  DISPLAY_SETTING_COLUMNS,
  DISPLAY_SWITCHES,
  DisplayDaysColumn,
  DisplayDaysDefinition,
  DisplaySectionDefinition,
  DisplaySettingColumn,
  DisplaySwitchColumn,
  DisplaySwitchDefinition,
  getDisplayDaysTestId,
  getDisplaySectionTestId,
  getDisplaySwitchTestId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
import IncidentStatusPageScopeCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const STATUS_PAGE_ID: string = "5b5b5b5b-0000-4000-8000-0000000000bb";

type StoredColumns = Partial<Record<DisplaySettingColumn, boolean | number>>;

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
  hidePoweredByOneUptimeBranding: false,
};

let stored: StoredColumns | null | Error = null;
let gate: PermissionGateResult = { isAllowed: true };
let plan: PlanType | null = null;

beforeEach(() => {
  stored = { ...NEW_PAGE };
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

    return page;
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
  test("asks once for the card's fourteen columns and nothing else", async () => {
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
      hidePoweredByOneUptimeBranding: true,
    });
    expect(DISPLAY_SETTING_COLUMNS).toHaveLength(14);
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

    expect(screen.getAllByRole("switch")).toHaveLength(9);
    expect(screen.getAllByRole("spinbutton")).toHaveLength(5);
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

    // Stored as "do not hide it", shown as a switch that is on.
    expect(switchFor("hidePoweredByOneUptimeBranding")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("shows each setting as the page has it", async () => {
    stored = {
      ...NEW_PAGE,
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

    // Hidden: the switch that shows it is off.
    expect(switchFor("hidePoweredByOneUptimeBranding")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("a page with no value for a setting shows the model's default for it", async () => {
    stored = {};

    await renderCard();
    await loaded();

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

    // No switch: the uptime bars are always there.
    expect(within(section).queryByRole("switch")).toBeNull();
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
