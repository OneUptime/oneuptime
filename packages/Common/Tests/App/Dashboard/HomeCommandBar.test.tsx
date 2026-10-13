import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The top of Home (Components/Home/HomeCommandBar.tsx): a search box that
 * opens the command palette, and as few buttons as will do - Declare
 * Incident, and one Create menu for monitors, maintenance and announcements.
 * Each action is offered only to someone who may do it, by the palette's own
 * rule (computeCreateActionGates).
 */

const analyticsMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();
const dispatchMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          return (
            (options as { defaultValue?: string } | undefined)?.defaultValue ??
            key
          );
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (...args: Array<unknown>) => {
        return analyticsMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
      isOnThisPage: () => {
        return false;
      },
      getCurrentPath: () => {
        return { toString: () => "/" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/GlobalEvents", () => {
  return {
    __esModule: true,
    default: {
      dispatchEvent: (...args: Array<unknown>) => {
        return dispatchMock(...args);
      },
      addEventListener: () => {
        // nothing listens here
      },
      removeEventListener: () => {
        // nothing listens here
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectId;
      },
    },
  };
});

import HomeCommandBar, {
  DECLARE_INCIDENT_ACTION,
  getHomeQuickActions,
  HomeQuickAction,
  HomeQuickActions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeCommandBar";
import { PaletteCreateActionGates } from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "65f00000000000000000cccc";
let currentProjectId: ObjectID | null = new ObjectID(PROJECT_ID);

function gates(
  overrides: Partial<PaletteCreateActionGates> = {},
): PaletteCreateActionGates {
  return {
    canCreateIncident: true,
    canCreateMonitor: true,
    canCreateAlert: true,
    canCreateScheduledMaintenance: true,
    canCreateAnnouncement: true,
    ...overrides,
  };
}

const NOTHING: PaletteCreateActionGates = gates({
  canCreateIncident: false,
  canCreateMonitor: false,
  canCreateAlert: false,
  canCreateScheduledMaintenance: false,
  canCreateAnnouncement: false,
});

function routeOf(pageMap: PageMap): string {
  return RouteMap[pageMap]!.toString().replace(":projectId", PROJECT_ID);
}

function renderBar(allowed: PaletteCreateActionGates = gates()): void {
  render(
    <MemoryRouter>
      <HomeCommandBar projectId={PROJECT_ID} gates={allowed} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  currentProjectId = new ObjectID(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  analyticsMock.mockReset();
  navigateMock.mockReset();
  dispatchMock.mockReset();
});

describe("search", () => {
  test("is a search box that opens the command palette, and is recorded", () => {
    renderBar();

    const search: HTMLElement = screen.getByTestId("home-search");
    expect(search).toHaveTextContent(
      "Search monitors, incidents, status pages and more…",
    );

    fireEvent.click(search);

    expect(dispatchMock).toHaveBeenCalledWith(EventName.COMMAND_PALETTE_TOGGLE);
    expect(analyticsMock).toHaveBeenCalledWith("dashboard/home/search-opened", {
      projectId: PROJECT_ID,
    });
  });

  test("teaches the palette's chord, and says it to assistive tech", () => {
    renderBar();

    const search: HTMLElement = screen.getByTestId("home-search");
    expect(search.getAttribute("aria-keyshortcuts")).toMatch(/K/);
    // The keycaps: the modifier and K.
    expect(search).toHaveTextContent("K");
  });

  test("is there for everyone, even someone who may create nothing", () => {
    renderBar(NOTHING);

    expect(screen.getByTestId("home-search")).toBeVisible();
    expect(screen.queryByTestId("home-quick-actions")).toBeNull();
  });
});

describe("the actions", () => {
  test("Declare Incident opens the declare form, and is recorded", () => {
    renderBar();

    const declare: HTMLElement = screen.getByTestId(
      "home-quick-action-declare-incident",
    );
    expect(declare).toHaveTextContent("Declare Incident");
    expect(declare.closest("a")?.getAttribute("href")).toBe(
      routeOf(PageMap.INCIDENT_CREATE),
    );

    fireEvent.click(declare);

    expect(analyticsMock).toHaveBeenCalledWith("dashboard/home/quick-action", {
      projectId: PROJECT_ID,
      action: "declare-incident",
    });
  });

  test("the rest are one Create menu: monitor, maintenance, announcement", async () => {
    renderBar();

    // Folded until opened.
    expect(
      screen.queryByTestId("home-quick-action-create-monitor"),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Create"));
    });

    const items: Array<string> = screen
      .getAllByRole("menuitem")
      .map((item: HTMLElement): string => {
        return item.textContent?.trim() || "";
      });
    expect(items).toEqual([
      "Create Monitor",
      "Schedule Maintenance",
      "Create Announcement",
    ]);
  });

  test("picking from the menu opens that create page, and is recorded", async () => {
    renderBar();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Create"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("home-quick-action-schedule-maintenance"));
    });

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      routeOf(PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE),
    );
    expect(analyticsMock).toHaveBeenCalledWith("dashboard/home/quick-action", {
      projectId: PROJECT_ID,
      action: "schedule-maintenance",
    });
  });

  test("one thing to create is a button, not a menu", () => {
    renderBar(
      gates({
        canCreateIncident: false,
        canCreateScheduledMaintenance: false,
        canCreateAnnouncement: false,
      }),
    );

    const monitor: HTMLElement = screen.getByTestId(
      "home-quick-action-create-monitor",
    );
    expect(monitor.closest("a")?.getAttribute("href")).toBe(
      routeOf(PageMap.MONITOR_CREATE),
    );
    expect(screen.queryByLabelText("Create")).toBeNull();
    expect(
      screen.queryByTestId("home-quick-action-declare-incident"),
    ).toBeNull();
  });

  test("someone who may only declare incidents sees only that", () => {
    renderBar(
      gates({
        canCreateMonitor: false,
        canCreateScheduledMaintenance: false,
        canCreateAnnouncement: false,
      }),
    );

    expect(
      screen.getByTestId("home-quick-action-declare-incident"),
    ).toBeVisible();
    expect(screen.queryByLabelText("Create")).toBeNull();
  });
});

describe("getHomeQuickActions", () => {
  function keys(actions: Array<HomeQuickAction>): Array<string> {
    return actions.map((action: HomeQuickAction): string => {
      return action.key;
    });
  }

  test("everything allowed", () => {
    const actions: HomeQuickActions = getHomeQuickActions(gates());

    expect(actions.declareIncident?.key).toBe(DECLARE_INCIDENT_ACTION.key);
    expect(actions.declareIncident?.pageMap).toBe(PageMap.INCIDENT_CREATE);
    expect(keys(actions.create)).toEqual([
      "create-monitor",
      "schedule-maintenance",
      "create-announcement",
    ]);
  });

  test("nothing allowed", () => {
    const actions: HomeQuickActions = getHomeQuickActions(NOTHING);

    expect(actions.declareIncident).toBeNull();
    expect(actions.create).toEqual([]);
  });

  test("each gate controls its own action only", () => {
    expect(
      keys(getHomeQuickActions(gates({ canCreateMonitor: false })).create),
    ).toEqual(["schedule-maintenance", "create-announcement"]);
    expect(
      keys(
        getHomeQuickActions(gates({ canCreateScheduledMaintenance: false }))
          .create,
      ),
    ).toEqual(["create-monitor", "create-announcement"]);
    expect(
      keys(getHomeQuickActions(gates({ canCreateAnnouncement: false })).create),
    ).toEqual(["create-monitor", "schedule-maintenance"]);
    // Creating an alert by hand is not offered on Home: the palette has it.
    expect(
      keys(getHomeQuickActions(gates({ canCreateAlert: false })).create),
    ).toEqual(["create-monitor", "schedule-maintenance", "create-announcement"]);
  });

  test("every action opens a page that exists", () => {
    const actions: HomeQuickActions = getHomeQuickActions(gates());

    for (const action of [actions.declareIncident!, ...actions.create]) {
      expect(RouteMap[action.pageMap]).toBeDefined();
    }
  });
});
