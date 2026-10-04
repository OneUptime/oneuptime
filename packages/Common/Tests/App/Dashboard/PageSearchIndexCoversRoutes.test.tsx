import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import Route from "../../../Types/API/Route";
import { MoreMenuItem, NavItem } from "../../../UI/Components/Navbar/NavBar";
import { goTo, PROJECT_ID } from "./SideMenuHarness";
import {
  getPageSearchIndexEntries,
  PageSearchIndexEntry,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import { getPageSearchAreas } from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import useDashboardNavigationItems, {
  DashboardNavigationItems,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/NavigationItems";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { MOVED_INCIDENT_FORM_PATHS } from "../../../../App/FeatureSet/Dashboard/src/Routes/IncidentsRoutes";
import { MOVED_RUNNER_SETTINGS_PATHS } from "../../../../App/FeatureSet/Dashboard/src/Routes/SettingsRoutes";
import { MOVED_ON_CALL_RULES_PATHS } from "../../../Types/NotificationRule/OnCallRuleKind";

/*
 * Every page of the Dashboard that can be opened without a record is either
 * offered by Search (Cmd/Ctrl+K) or listed below with the reason it is not.
 *
 * A page is "offered" when Search lists it: as a page of PageSearchIndex.ts,
 * as a product (the products menu's own catalog), or through one of the
 * palette's actions and quick links. A new page in RouteMap fails here
 * until it is one of those or is listed below, so a page cannot be added
 * that nobody can find by searching for it.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, defaultValue?: unknown): string => {
          return typeof defaultValue === "string" ? defaultValue : key;
        },
      };
    },
  };
});

/*
 * Pages the palette opens from its actions and quick links rather than as
 * search results (DashboardCommandPalette.tsx).
 */
const OPENED_BY_PALETTE_ACTIONS: Readonly<Partial<Record<PageMap, string>>> = {
  [PageMap.INCIDENT_CREATE]: "Declare Incident",
  [PageMap.MONITOR_CREATE]: "Create Monitor",
  [PageMap.ALERT_CREATE]: "Create Alert",
  [PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE]: "Create Scheduled Maintenance",
  [PageMap.ANNOUNCEMENT_CREATE]: "Create Announcement",
  [PageMap.ACTIVE_INCIDENTS]: "Active Incidents (quick link)",
  [PageMap.MY_ON_CALL_POLICIES]: "My On-Call Policies (quick link)",
  [PageMap.PROJECT_INVITATIONS]: "Project Invitations (quick link)",
  [PageMap.LOGOUT]: "Log out",
};

/*
 * Pages that can be opened without a record but are not offered, and why.
 */
const NOT_OFFERED: Readonly<Partial<Record<PageMap, string>>> = {
  [PageMap.INIT]: "the dashboard's entry: it opens a project",
  [PageMap.INIT_PROJECT]: "a project's address: it opens Home",
  [PageMap.WELCOME]: "the first-run welcome, shown once",
  [PageMap.PROJECT_SSO]: "the sign-in step of a project that requires SSO",
  [PageMap.HOME_NOT_OPERATIONAL_MONITORS]:
    "a Home tab: Monitors > Not Operational is offered",
  [PageMap.HOME_ACTIVE_ALERTS]: "a Home tab: Alerts > Active Alerts is offered",
  [PageMap.HOME_ACTIVE_EPISODES]:
    "a Home tab: Alerts > Active Episodes is offered",
  [PageMap.HOME_ACTIVE_INCIDENT_EPISODES]:
    "a Home tab: Incidents > Active Episodes is offered",
  [PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS]:
    "a Home tab: Scheduled Maintenance > Ongoing Events is offered",
  [PageMap.MONITORS_WORKSPACE_CONNECTIONS]:
    "Connect Slack or Teams: connected from Project Settings > Slack / Microsoft Teams",
  [PageMap.INCIDENTS_WORKSPACE_CONNECTIONS]:
    "Connect Slack or Teams: connected from Project Settings > Slack / Microsoft Teams",
  [PageMap.ALERTS_WORKSPACE_CONNECTIONS]:
    "Connect Slack or Teams: connected from Project Settings > Slack / Microsoft Teams",
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTIONS]:
    "Connect Slack or Teams: connected from Project Settings > Slack / Microsoft Teams",
  [PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTIONS]:
    "Connect Slack or Teams: connected from Project Settings > Slack / Microsoft Teams",
  [PageMap.INCIDENT_EPISODE_CREATE]:
    "an episode is created from Incidents > All Episodes, which is offered",
  [PageMap.ALERT_EPISODE_CREATE]:
    "an episode is created from Alerts > All Episodes, which is offered",
  [PageMap.ACTIVE_ALERTS]:
    "across all projects, from the header; each project's Active Alerts is offered",
  [PageMap.ACTIVE_ALERT_EPISODES]:
    "across all projects, from the header; each project's Active Episodes is offered",
  [PageMap.ACTIVE_INCIDENT_EPISODES]:
    "across all projects, from the header; each project's Active Episodes is offered",
  [PageMap.METRIC_VIEW]: "one metric's chart: it needs the metric to show",
  [PageMap.EXCEPTIONS_RESOLVED]:
    "an old address of the Exceptions list, which has a status filter now",
  [PageMap.EXCEPTIONS_ARCHIVED]:
    "an old address of the Exceptions list, which has a status filter now",
  [PageMap.EXCEPTIONS_VIEW_ROOT]:
    "the prefix an exception's own pages hang off; the Exceptions product is offered",
  [PageMap.INVENTORY_VIEW_ROOT]:
    "the prefix an item's own pages hang off; it forwards to All Items, which is offered",
  [PageMap.AUTOMATION_SCRIPTS]: "in RouteMap, but no page is mounted there",
  [PageMap.REPORTS]: "in RouteMap, but no page is mounted there",
  [PageMap.ERROR_TRACKER]: "in RouteMap, but no page is mounted there",
};

let productPaths: Set<string> = new Set<string>();

let catalog: DashboardNavigationItems | null = null;

const ReadCatalog: FunctionComponent = (): ReactElement => {
  catalog = useDashboardNavigationItems();
  return <></>;
};

beforeAll(() => {
  goTo(`/dashboard/${PROJECT_ID}/home`);
  render(<ReadCatalog />);
  const items: DashboardNavigationItems = catalog!;
  cleanup();

  productPaths = new Set<string>(
    ([...items.navItems, ...items.moreMenuItems, items.rightElement] as Array<
      NavItem | MoreMenuItem
    >).map((item: NavItem | MoreMenuItem): string => {
      return item.route.toString();
    }),
  );
});

const indexEntries: Array<PageSearchIndexEntry> = getPageSearchIndexEntries(
  getPageSearchAreas(),
);

const indexedKeys: Set<string> = new Set<string>(
  indexEntries.map((entry: PageSearchIndexEntry): string => {
    return entry.page.page;
  }),
);

// The path a RouteMap key opens in this project.
function routePathOf(key: string): string {
  return RouteUtil.populateRouteParams(RouteMap[key] as Route).toString();
}

// A page that needs no record: no placeholder left once the project is in.
function isOpenableWithoutARecord(key: string): boolean {
  const template: string = (RouteMap[key] as Route).toString();
  return !template.endsWith("/*") && !routePathOf(key).includes(":");
}

function isOffered(key: string): boolean {
  return (
    indexedKeys.has(key) ||
    productPaths.has(routePathOf(key)) ||
    Boolean(OPENED_BY_PALETTE_ACTIONS[key as PageMap])
  );
}

describe("every page that needs no record is offered by Search, or says why not", () => {
  test("RouteMap has hundreds of such pages, and Search offers most of them", () => {
    goTo(`/dashboard/${PROJECT_ID}/home`);

    const openable: Array<string> = Object.keys(RouteMap).filter(
      isOpenableWithoutARecord,
    );
    const offered: Array<string> = openable.filter(isOffered);

    expect(openable.length).toBeGreaterThanOrEqual(400);
    expect(offered.length / openable.length).toBeGreaterThan(0.9);
  });

  test("no page is missing: each is offered or listed with its reason", () => {
    goTo(`/dashboard/${PROJECT_ID}/home`);

    const missing: Array<string> = Object.keys(RouteMap)
      .filter(isOpenableWithoutARecord)
      .filter((key: string): boolean => {
        return !isOffered(key) && !NOT_OFFERED[key as PageMap];
      })
      .map((key: string): string => {
        return `${key} (${routePathOf(key)})`;
      });

    /*
     * A page listed here is in RouteMap and needs no record, but Search
     * cannot find it. Add it to PageSearchIndex.ts, in the area and section
     * of the menu that links to it, or list it in NOT_OFFERED above with the
     * reason it must not be offered.
     */
    expect(missing).toEqual([]);
  });

  test("the reasons are not stale: a listed page exists, needs no record, and is really not offered", () => {
    goTo(`/dashboard/${PROJECT_ID}/home`);

    for (const key of Object.keys(NOT_OFFERED)) {
      expect({ key, inRouteMap: Boolean(RouteMap[key]) }).toEqual({
        key,
        inRouteMap: true,
      });
      expect({ key, openable: isOpenableWithoutARecord(key) }).toEqual({
        key,
        openable: true,
      });
      expect({ key, offered: isOffered(key) }).toEqual({
        key,
        offered: false,
      });
    }

    for (const key of Object.keys(OPENED_BY_PALETTE_ACTIONS)) {
      expect({ key, indexed: indexedKeys.has(key) }).toEqual({
        key,
        indexed: false,
      });
    }
  });

  test("every page of the index is a page of RouteMap", () => {
    const unknown: Array<string> = indexEntries
      .filter((entry: PageSearchIndexEntry): boolean => {
        return !RouteMap[entry.page.page];
      })
      .map((entry: PageSearchIndexEntry): string => {
        return `${entry.area.id}: ${entry.page.title} (${entry.page.page})`;
      });

    expect(unknown).toEqual([]);
  });

  test("Search never offers a page that moved: those addresses only forward to their new page", () => {
    goTo(`/dashboard/${PROJECT_ID}/home`);

    const movedPaths: Array<string> = [
      ...Object.values(MOVED_RUNNER_SETTINGS_PATHS).map((part: string) => {
        return `/settings/${part}`;
      }),
      ...Object.values(MOVED_INCIDENT_FORM_PATHS).map((part: string) => {
        return `/incidents/${part}`;
      }),
      ...Object.keys(MOVED_ON_CALL_RULES_PATHS).map((part: string) => {
        return `/user-settings/${part}`;
      }),
    ];

    expect(movedPaths.length).toBeGreaterThan(0);

    for (const entry of indexEntries) {
      const routePath: string = routePathOf(entry.page.page);

      for (const moved of movedPaths) {
        expect({
          page: entry.page.title,
          moved: routePath.endsWith(moved.replace(/\/:[A-Za-z]+$/, "")),
        }).toEqual({ page: entry.page.title, moved: false });
      }
    }
  });
});
