import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Dashboard's five event layouts - an incident's, an alert's, a
 * scheduled maintenance event's and both kinds of episode's - head every
 * page under them with the event's number, then its title: "INC-18
 * Manually declared", in the heading, the trail and the browser tab. Each
 * layout hands ModelPage a model that numbers its records, and ModelPage
 * reads the number with the title (ModelPageNumbersTheRecord).
 *
 * The real layouts, trails and route map under a router at each layout's
 * own address, against a fake ModelAPI. Only the side menus (their links
 * read counts of their own) are replaced.
 */

const PROJECT_ID: string = "65f00000-0000-4000-8000-00000000aaaa";
const RECORD_ID: string = "65f00000-0000-4000-8000-00000000bbbb";

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: (): string => {
            return "65f00000-0000-4000-8000-00000000aaaa";
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (): void => {},
    },
  };
});

function sideMenuStub(): { __esModule: true; default: () => ReactElement } {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <nav data-testid="event-side-menu">Side menu</nav>;
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/SideMenu",
  () => {
    return sideMenuStub();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/SideMenu",
  () => {
    return sideMenuStub();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/SideMenu",
  () => {
    return sideMenuStub();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/SideMenu",
  () => {
    return sideMenuStub();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/SideMenu",
  () => {
    return sideMenuStub();
  },
);

import IncidentViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Layout";
import AlertViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Layout";
import ScheduledMaintenanceViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Layout";
import IncidentEpisodeViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/Layout";
import AlertEpisodeViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/Layout";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

// A run of white space, the heading's no-break space among it.
const WHITE_SPACE_RUN: RegExp = /\s+/g;

interface LayoutCase {
  name: string;
  Layout: React.FunctionComponent<any>;
  modelType: { new (): BaseModel };
  viewPage: PageMap;
  // A page under the record's own, in its side menu.
  subPage: PageMap;
  subPageTitle: string;
  trail: Array<string>;
  numberColumn: string;
  number: string;
  title: string;
}

const CASES: Array<LayoutCase> = [
  {
    name: "an incident",
    Layout: IncidentViewLayout,
    modelType: Incident,
    viewPage: PageMap.INCIDENT_VIEW,
    subPage: PageMap.INCIDENT_VIEW_OWNERS,
    subPageTitle: "Owners",
    trail: ["Project", "Incidents"],
    numberColumn: "incidentNumber",
    number: "INC-18",
    title: "Manually declared",
  },
  {
    name: "an alert",
    Layout: AlertViewLayout,
    modelType: Alert,
    viewPage: PageMap.ALERT_VIEW,
    subPage: PageMap.ALERT_VIEW_DESCRIPTION,
    subPageTitle: "Description",
    trail: ["Project", "Alerts"],
    numberColumn: "alertNumber",
    number: "ALT-7",
    title: "CPU high on web-1",
  },
  {
    name: "a scheduled maintenance event",
    Layout: ScheduledMaintenanceViewLayout,
    modelType: ScheduledMaintenance,
    viewPage: PageMap.SCHEDULED_MAINTENANCE_VIEW,
    subPage: PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS,
    subPageTitle: "Owners",
    trail: ["Project", "Scheduled Maintenance Events"],
    numberColumn: "scheduledMaintenanceNumber",
    number: "SM-3",
    title: "Primary database failover drill",
  },
  {
    name: "an incident episode",
    Layout: IncidentEpisodeViewLayout,
    modelType: IncidentEpisode,
    viewPage: PageMap.INCIDENT_EPISODE_VIEW,
    subPage: PageMap.INCIDENT_EPISODE_VIEW_OWNERS,
    subPageTitle: "Owners",
    trail: ["Project", "Incidents", "Episodes"],
    numberColumn: "episodeNumber",
    number: "IE-2",
    title: "Checkout degradation",
  },
  {
    name: "an alert episode",
    Layout: AlertEpisodeViewLayout,
    modelType: AlertEpisode,
    viewPage: PageMap.ALERT_EPISODE_VIEW,
    subPage: PageMap.ALERT_EPISODE_VIEW_OWNERS,
    subPageTitle: "Owners",
    trail: ["Project", "Alerts", "Episodes"],
    numberColumn: "episodeNumber",
    number: "AE-4",
    title: "Payment webhook failures",
  },
];

function addressOf(page: PageMap): string {
  return (RouteMap[page] as Route)
    .toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", RECORD_ID);
}

function recordOf(layoutCase: LayoutCase): BaseModel {
  const record: BaseModel = new layoutCase.modelType();
  record.id = new ObjectID(RECORD_ID);
  const values: JSONObject = record as unknown as JSONObject;
  values["title"] = layoutCase.title;
  values[layoutCase.numberColumn] = 18;
  values[`${layoutCase.numberColumn}WithPrefix`] = layoutCase.number;
  values["labels"] = [];
  return record;
}

async function renderLayoutAt(
  layoutCase: LayoutCase,
  page: PageMap,
): Promise<void> {
  const address: string = addressOf(page);

  // Where the layout's trail reads the page from.
  Navigation.setLocation({
    pathname: address,
    search: "",
    hash: "",
    state: null,
    key: "event-layout",
  });
  window.history.replaceState(null, "", address);

  const Layout: React.FunctionComponent<any> = layoutCase.Layout;

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[address]}>
        <Routes>
          <PageRoute
            path={(RouteMap[layoutCase.viewPage] as Route).toString()}
            element={<Layout />}
          >
            <PageRoute
              index
              element={<div data-testid="event-page-body">Overview</div>}
            />
            <PageRoute
              path="*"
              element={<div data-testid="event-page-body">Sub-page</div>}
            />
          </PageRoute>
        </Routes>
      </MemoryRouter>,
    );
  });
}

function textOf(element: Element): string {
  return (element.textContent || "").replace(WHITE_SPACE_RUN, " ").trim();
}

function trailText(): Array<string> {
  const nav: HTMLElement = screen.getByRole("navigation", {
    name: "Breadcrumb",
  });
  return within(nav)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return textOf(item);
    });
}

beforeEach(() => {
  document.title = "OneUptime";
});

afterEach(() => {
  cleanup();
  getItemMock.mockReset();
  (Navigation as unknown as { location: unknown }).location = undefined;
  window.history.replaceState(null, "", "/");
});

describe.each(CASES.map((layoutCase: LayoutCase) => [layoutCase.name, layoutCase]))(
  "%s's layout",
  (_name: unknown, value: unknown) => {
    const layoutCase: LayoutCase = value as LayoutCase;
    const named: string = `${layoutCase.number} ${layoutCase.title}`;

    test("reads the record's number with its title", async () => {
      getItemMock.mockResolvedValue(recordOf(layoutCase));
      await renderLayoutAt(layoutCase, layoutCase.viewPage);

      const select: JSONObject = (
        getItemMock.mock.calls[0]![0] as { select: JSONObject }
      ).select;
      expect(select).toMatchObject({
        title: true,
        [layoutCase.numberColumn]: true,
        [`${layoutCase.numberColumn}WithPrefix`]: true,
      });
    });

    test("its own page is headed, trailed and tabbed by the number, then the title", async () => {
      getItemMock.mockResolvedValue(recordOf(layoutCase));
      await renderLayoutAt(layoutCase, layoutCase.viewPage);

      expect(textOf(screen.getByRole("heading", { level: 1 }))).toBe(named);
      expect(trailText()).toEqual([...layoutCase.trail, named]);
      expect(document.title).toBe(
        `OneUptime | ${layoutCase.trail.join(" - ")} - ${named}`,
      );
    });

    test(`a page under it (${layoutCase.subPageTitle}) is too`, async () => {
      getItemMock.mockResolvedValue(recordOf(layoutCase));
      await renderLayoutAt(layoutCase, layoutCase.subPage);

      expect(screen.getByTestId("event-page-body")).toHaveTextContent(
        "Sub-page",
      );
      expect(textOf(screen.getByRole("heading", { level: 1 }))).toBe(named);
      expect(trailText()).toEqual([
        ...layoutCase.trail,
        named,
        layoutCase.subPageTitle,
      ]);
      expect(document.title).toBe(
        `OneUptime | ${layoutCase.trail.join(" - ")} - ${named} - ${layoutCase.subPageTitle}`,
      );
    });
  },
);
