import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Home's side menu (Pages/Home/SideMenu.tsx), on the lists Home opens.
 *
 * Home used to BE the Active Incidents table, so the menu's "Active
 * Incidents" entry was Home itself and nothing in it named the page as an
 * overview. Now Active Incidents is a page of its own and every list keeps
 * its badge. The overview draws every list the menu holds, so it has no menu
 * (Pages/Home/Layout.tsx): the lists do, and its Home > Overview leads back.
 * The Not Operational badge counts what its list shows: archived monitors
 * are not checked, so their frozen status is not a problem, and the list
 * leaves them out.
 */

const countMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          if (options && typeof options === "object") {
            return (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return typeof options === "string" ? options : key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

import HomeLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/Layout";
import HomeSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import {
  activeLinkTitles,
  DESKTOP_WIDTH,
  goTo,
  linksIn,
  PROJECT_ID,
  renderMenu,
  routeFor,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

function project(): Project {
  const value: Project = new Project();
  value._id = PROJECT_ID;
  return value;
}

async function renderHomeMenu(): Promise<void> {
  await renderMenu(<HomeSideMenu project={project()} />);
}

// The real Home layout at an address, with a stand-in for the page it holds.
async function renderLayoutAt(path: string): Promise<void> {
  goTo(path);
  await renderMenu(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <RouterRoute
          path="/dashboard/:projectId/home/*"
          element={
            <HomeLayout
              pageRoute={new Route(path)}
              currentProject={project()}
              hasPaymentMethod={false}
            />
          }
        >
          <RouterRoute index element={<div data-testid="home-outlet" />} />
          <RouterRoute path="*" element={<div data-testid="home-outlet" />} />
        </RouterRoute>
      </Routes>
    </MemoryRouter>,
  );
}

// Every list Home opens, each drawn with the side menu.
const HOME_LISTS: Array<string> = [
  PageMap.HOME_ACTIVE_INCIDENTS,
  PageMap.HOME_ACTIVE_INCIDENT_EPISODES,
  PageMap.HOME_ACTIVE_ALERTS,
  PageMap.HOME_ACTIVE_EPISODES,
  PageMap.HOME_NOT_OPERATIONAL_MONITORS,
  PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
];

interface CountRequest {
  modelType: unknown;
  query: Record<string, unknown>;
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  /*
   * The project's id in the address is what the menu fills its links with,
   * and the menu is drawn on Home's lists, not on the overview.
   */
  goTo(`/dashboard/${PROJECT_ID}/home/active-incidents`);
  countMock.mockImplementation(() => {
    return Promise.resolve(0);
  });
});

afterEach(() => {
  cleanup();
  countMock.mockReset();
});

describe("Home's side menu", () => {
  test("opens on Home > Overview, then every list Home links to", async () => {
    await renderHomeMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Home",
      "Incidents",
      "Alerts",
      "Monitors",
      "Scheduled Events",
    ]);
    expect(linksIn("Home")).toEqual([
      { title: "Overview", href: routeFor(PageMap.HOME) },
    ]);
  });

  test("Active Incidents is a page of its own, not Home", async () => {
    await renderHomeMenu();

    const incidents: Array<{ title: string; href: string }> =
      linksIn("Incidents");

    expect(incidents[0]).toEqual({
      title: "Active Incidents",
      href: routeFor(PageMap.HOME_ACTIVE_INCIDENTS),
    });
    expect(incidents[0]!.href).not.toBe(routeFor(PageMap.HOME));
    expect(incidents[0]!.href).toBe(
      `/dashboard/${PROJECT_ID}/home/active-incidents`,
    );
    expect(incidents[1]).toEqual({
      title: "Active Episodes",
      href: routeFor(PageMap.HOME_ACTIVE_INCIDENT_EPISODES),
    });
  });

  test("the other lists keep their addresses", async () => {
    await renderHomeMenu();

    expect(linksIn("Alerts")).toEqual([
      { title: "Active Alerts", href: routeFor(PageMap.HOME_ACTIVE_ALERTS) },
      {
        title: "Active Episodes",
        href: routeFor(PageMap.HOME_ACTIVE_EPISODES),
      },
    ]);
    expect(linksIn("Monitors")).toEqual([
      {
        title: "Not Operational",
        href: routeFor(PageMap.HOME_NOT_OPERATIONAL_MONITORS),
      },
    ]);
    expect(linksIn("Scheduled Events")).toEqual([
      {
        title: "Ongoing",
        href: routeFor(PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS),
      },
    ]);
  });

  test("on a list, that list is the page you are on, and Overview leads back to Home", async () => {
    await renderHomeMenu();

    expect(activeLinkTitles()).toEqual(["Active Incidents"]);
    expect(linksIn("Home")).toEqual([
      { title: "Overview", href: routeFor(PageMap.HOME) },
    ]);

    cleanup();
    goTo(routeFor(PageMap.HOME_NOT_OPERATIONAL_MONITORS));
    await renderHomeMenu();

    expect(activeLinkTitles()).toEqual(["Not Operational"]);
  });

  test("the Not Operational badge counts what its list shows: archived monitors left out", async () => {
    await renderHomeMenu();

    await waitFor(() => {
      expect(
        countMock.mock.calls.some((call: Array<unknown>): boolean => {
          return (call[0] as CountRequest).modelType === Monitor;
        }),
      ).toBe(true);
    });

    const monitorCounts: Array<CountRequest> = countMock.mock.calls
      .map((call: Array<unknown>): CountRequest => {
        return call[0] as CountRequest;
      })
      .filter((request: CountRequest): boolean => {
        return request.modelType === Monitor;
      });

    expect(monitorCounts.length).toBeGreaterThanOrEqual(1);
    for (const request of monitorCounts) {
      expect(request.query["isArchived"]).toBe(false);
      expect(request.query["currentMonitorStatus"]).toEqual({
        isOperationalState: false,
      });
    }
  });

  test("Overview carries no badge: only the six lists are counted", async () => {
    await renderHomeMenu();

    await waitFor(() => {
      expect(countMock.mock.calls.length).toBeGreaterThanOrEqual(6);
    });

    const counted: Set<unknown> = new Set(
      countMock.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as CountRequest).modelType;
      }),
    );

    expect(counted).toEqual(
      new Set([
        Incident,
        IncidentEpisode,
        Alert,
        AlertEpisode,
        Monitor,
        ScheduledMaintenance,
      ]),
    );
  });
});

describe("where Home draws its side menu", () => {
  test("the overview has none: it draws every list itself, and takes the full width", async () => {
    for (const path of [
      `/dashboard/${PROJECT_ID}/home/`,
      `/dashboard/${PROJECT_ID}/home`,
    ]) {
      await renderLayoutAt(path);

      expect(document.querySelector('[data-testid="home-outlet"]')).not.toBe(
        null,
      );
      expect({ path, sections: sectionTitlesInOrder() }).toEqual({
        path,
        sections: [],
      });

      cleanup();
    }
  });

  test("every list Home opens has it, and its Overview leads back", async () => {
    for (const list of HOME_LISTS) {
      await renderLayoutAt(routeFor(list));

      expect(document.querySelector('[data-testid="home-outlet"]')).not.toBe(
        null,
      );
      expect({ list, sections: sectionTitlesInOrder() }).toEqual({
        list,
        sections: [
          "Home",
          "Incidents",
          "Alerts",
          "Monitors",
          "Scheduled Events",
        ],
      });
      expect(linksIn("Home")).toEqual([
        { title: "Overview", href: routeFor(PageMap.HOME) },
      ]);

      cleanup();
    }
  });
});
