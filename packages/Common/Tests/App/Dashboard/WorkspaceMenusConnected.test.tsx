import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent } from "@testing-library/react";
import type { Mock } from "jest-mock";
import * as React from "react";
import { FunctionComponent } from "react";

/*
 * "In workspace, we always show two options: Slack and Teams, but both of
 * these are not relevant to a lot of companies ... If a company integrates
 * Slack, show Slack. If a company integrates Teams, show Teams as well.
 * Please do this everywhere else in the project." (the maintainer)
 *
 * Every side menu with a Workspace section, rendered for real against the
 * real RouteMap, for a project with nothing, Slack, Microsoft Teams and both
 * connected. Also what a person sees while the answer is on its way: the
 * menu must never flash the old two entries, or fold and unfold a section
 * under them.
 */

// Badge counts: nothing to count, no network.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
    },
  };
});

import AlertsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/SideMenu";
import IncidentsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/SideMenu";
import MonitorsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu";
import OnCallDutySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/SideMenu";
import ScheduledMaintenanceSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/SideMenu";
import ProjectSettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu";
import UserSettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ConnectedWorkspaces, {
  ConnectedWorkspacesFetcher,
  REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";

interface ProductMenu {
  name: string;
  Menu: FunctionComponent<Record<string, unknown>>;
  landing: string;
  slack: string;
  microsoftTeams: string;
  connect: string;
}

const PRODUCT_MENUS: Array<ProductMenu> = [
  {
    name: "Incidents",
    Menu: IncidentsSideMenu as FunctionComponent<Record<string, unknown>>,
    landing: PageMap.INCIDENTS,
    slack: PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK,
    microsoftTeams: PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    connect: PageMap.INCIDENTS_WORKSPACE_CONNECTIONS,
  },
  {
    name: "Alerts",
    Menu: AlertsSideMenu as FunctionComponent<Record<string, unknown>>,
    landing: PageMap.ALERTS,
    slack: PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK,
    microsoftTeams: PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    connect: PageMap.ALERTS_WORKSPACE_CONNECTIONS,
  },
  {
    name: "Scheduled Maintenance",
    Menu: ScheduledMaintenanceSideMenu as FunctionComponent<
      Record<string, unknown>
    >,
    landing: PageMap.SCHEDULED_MAINTENANCE_EVENTS,
    slack: PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK,
    microsoftTeams:
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    connect: PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTIONS,
  },
  {
    name: "Monitors",
    Menu: MonitorsSideMenu as FunctionComponent<Record<string, unknown>>,
    landing: PageMap.MONITORS,
    slack: PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK,
    microsoftTeams: PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    connect: PageMap.MONITORS_WORKSPACE_CONNECTIONS,
  },
  {
    name: "On-Call",
    Menu: OnCallDutySideMenu as FunctionComponent<Record<string, unknown>>,
    landing: PageMap.ON_CALL_DUTY_POLICIES,
    slack: PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK,
    microsoftTeams: PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    connect: PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTIONS,
  },
];

const PRODUCT_CASES: Array<[string, ProductMenu]> = PRODUCT_MENUS.map(
  (menu: ProductMenu): [string, ProductMenu] => {
    return [menu.name, menu];
  },
);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>((res: (value: T) => void) => {
    resolve = res;
  });

  return { promise, resolve };
}

let fetcher: Mock<ConnectedWorkspacesFetcher>;

function connect(...types: Array<WorkspaceType>): void {
  ConnectedWorkspaces.setConnected(PROJECT_ID, types);
}

function remember(...types: Array<WorkspaceType>): void {
  window.localStorage.setItem(
    `${REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX}${PROJECT_ID}`,
    JSON.stringify(types),
  );
}

async function renderAt(
  Menu: FunctionComponent<Record<string, unknown>>,
  pageMapKey: string,
): Promise<void> {
  goTo(routeFor(pageMapKey));
  await renderMenu(<Menu />);
}

function workspaceLinks(): Array<MenuLink> {
  return linksIn("Workspace");
}

function titles(links: Array<MenuLink>): Array<string> {
  return links.map((link: MenuLink): string => {
    return link.title;
  });
}

beforeEach(() => {
  window.localStorage.clear();
  ConnectedWorkspaces.reset();
  fetcher = jest.fn<ConnectedWorkspacesFetcher>();
  // Nothing asked of the server unless a test says what it answers.
  fetcher.mockImplementation((): Promise<Array<WorkspaceType>> => {
    return new Promise<Array<WorkspaceType>>((): void => {});
  });
  ConnectedWorkspaces.setFetcher(fetcher);
  setViewportWidth(DESKTOP_WIDTH);
  // Inside the project, so routes carry its id.
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
  ConnectedWorkspaces.setFetcher(null);
  ConnectedWorkspaces.reset();
});

describe("product menus list only the connected workspaces", () => {
  test.each(PRODUCT_CASES)(
    "%s: nothing connected, one entry to its own connect page",
    async (_name: string, menu: ProductMenu) => {
      connect();
      await renderAt(menu.Menu, menu.landing);

      expect(workspaceLinks()).toEqual([
        { title: "Connect Slack or Teams", href: routeFor(menu.connect) },
      ]);
    },
  );

  test.each(PRODUCT_CASES)(
    "%s: Slack connected, Slack only",
    async (_name: string, menu: ProductMenu) => {
      connect(WorkspaceType.Slack);
      await renderAt(menu.Menu, menu.landing);

      expect(workspaceLinks()).toEqual([
        { title: "Slack", href: routeFor(menu.slack) },
      ]);
    },
  );

  test.each(PRODUCT_CASES)(
    "%s: Microsoft Teams connected, Microsoft Teams only",
    async (_name: string, menu: ProductMenu) => {
      connect(WorkspaceType.MicrosoftTeams);
      await renderAt(menu.Menu, menu.landing);

      expect(workspaceLinks()).toEqual([
        { title: "Microsoft Teams", href: routeFor(menu.microsoftTeams) },
      ]);
    },
  );

  test.each(PRODUCT_CASES)(
    "%s: both connected, Slack then Microsoft Teams",
    async (_name: string, menu: ProductMenu) => {
      connect(WorkspaceType.MicrosoftTeams, WorkspaceType.Slack);
      await renderAt(menu.Menu, menu.landing);

      expect(workspaceLinks()).toEqual([
        { title: "Slack", href: routeFor(menu.slack) },
        { title: "Microsoft Teams", href: routeFor(menu.microsoftTeams) },
      ]);
    },
  );

  test.each(PRODUCT_CASES)(
    "%s: the section keeps its place and stays folded, whatever is connected",
    async (_name: string, menu: ProductMenu) => {
      const orders: Array<Array<string>> = [];

      for (const types of [
        [],
        [WorkspaceType.Slack],
        [WorkspaceType.MicrosoftTeams],
        [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
      ]) {
        connect(...types);
        await renderAt(menu.Menu, menu.landing);

        orders.push(sectionTitlesInOrder());
        expect(isExpanded("Workspace")).toBe(false);
        expect(sectionBody("Workspace")).toHaveClass(
          "max-h-0",
          "opacity-0",
          "invisible",
        );

        cleanup();
      }

      expect(
        new Set(
          orders.map((order: Array<string>): string => {
            return order.join(" / ");
          }),
        ).size,
      ).toBe(1);
      expect(orders[0]).toContain("Workspace");
    },
  );

  test.each(PRODUCT_CASES)(
    "%s: the connect page opens Workspace by itself and marks its entry",
    async (_name: string, menu: ProductMenu) => {
      connect();
      await renderAt(menu.Menu, menu.connect);

      expect(isExpanded("Workspace")).toBe(true);
      expect(sectionBody("Workspace")).not.toHaveClass("invisible");
      expect(activeLinkTitles()).toEqual(["Connect Slack or Teams"]);
    },
  );

  test.each(PRODUCT_CASES)(
    "%s: a connected workspace's page opens Workspace and marks it",
    async (_name: string, menu: ProductMenu) => {
      connect(WorkspaceType.Slack, WorkspaceType.MicrosoftTeams);
      await renderAt(menu.Menu, menu.microsoftTeams);

      expect(isExpanded("Workspace")).toBe(true);
      expect(activeLinkTitles()).toEqual(["Microsoft Teams"]);
    },
  );

  test.each(PRODUCT_CASES)(
    "%s: the page of a workspace that is not connected (a bookmark) is still listed while you are on it",
    async (_name: string, menu: ProductMenu) => {
      connect(WorkspaceType.Slack);
      await renderAt(menu.Menu, menu.microsoftTeams);

      expect(titles(workspaceLinks())).toEqual(["Slack", "Microsoft Teams"]);
      expect(activeLinkTitles()).toEqual(["Microsoft Teams"]);
      expect(isExpanded("Workspace")).toBe(true);
    },
  );

  test.each(PRODUCT_CASES)(
    "%s: if asking fails, both are listed, as before",
    async (_name: string, menu: ProductMenu) => {
      fetcher.mockRejectedValue(new Error("Permission denied"));
      await renderAt(menu.Menu, menu.landing);

      expect(workspaceLinks()).toEqual([
        { title: "Slack", href: routeFor(menu.slack) },
        { title: "Microsoft Teams", href: routeFor(menu.microsoftTeams) },
      ]);
    },
  );

  test("Workspace opens with a click and shows the one entry", async () => {
    connect();
    await renderAt(IncidentsSideMenu, PageMap.INCIDENTS);

    fireEvent.click(sectionToggle("Workspace"));

    expect(isExpanded("Workspace")).toBe(true);
    expect(titles(workspaceLinks())).toEqual(["Connect Slack or Teams"]);
  });

  test("on a phone, the connect page is named Workspace / Connect Slack or Teams", async () => {
    setViewportWidth(MOBILE_WIDTH);
    connect();
    await renderAt(IncidentsSideMenu, PageMap.INCIDENTS_WORKSPACE_CONNECTIONS);

    expect(mobileSummaryText()).toContain("Workspace / Connect Slack or Teams");
  });
});

describe("no flash while the answer is on its way", () => {
  test.each(PRODUCT_CASES)(
    "%s: the remembered answer is drawn on first paint, and the same answer changes nothing",
    async (_name: string, menu: ProductMenu) => {
      remember(WorkspaceType.MicrosoftTeams);
      const answer: Deferred<Array<WorkspaceType>> =
        deferred<Array<WorkspaceType>>();
      fetcher.mockReturnValue(answer.promise);

      await renderAt(menu.Menu, menu.landing);

      const beforeAnswer: Array<MenuLink> = workspaceLinks();
      const sectionsBefore: Array<string> = sectionTitlesInOrder();

      expect(beforeAnswer).toEqual([
        { title: "Microsoft Teams", href: routeFor(menu.microsoftTeams) },
      ]);

      await act(async () => {
        answer.resolve([WorkspaceType.MicrosoftTeams]);
        await answer.promise;
      });

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(workspaceLinks()).toEqual(beforeAnswer);
      expect(sectionTitlesInOrder()).toEqual(sectionsBefore);
    },
  );

  test.each(PRODUCT_CASES)(
    "%s: never the old two entries while waiting with nothing remembered",
    async (_name: string, menu: ProductMenu) => {
      await renderAt(menu.Menu, menu.landing);

      expect(titles(workspaceLinks())).toEqual(["Connect Slack or Teams"]);
      expect(isExpanded("Workspace")).toBe(false);
    },
  );

  test.each(PRODUCT_CASES)(
    "%s: on a workspace page the section is open from the first paint and stays open",
    async (_name: string, menu: ProductMenu) => {
      const answer: Deferred<Array<WorkspaceType>> =
        deferred<Array<WorkspaceType>>();
      fetcher.mockReturnValue(answer.promise);

      await renderAt(menu.Menu, menu.microsoftTeams);

      expect(isExpanded("Workspace")).toBe(true);
      expect(titles(workspaceLinks())).toEqual(["Microsoft Teams"]);
      expect(activeLinkTitles()).toEqual(["Microsoft Teams"]);

      await act(async () => {
        answer.resolve([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);
        await answer.promise;
      });

      expect(isExpanded("Workspace")).toBe(true);
      expect(titles(workspaceLinks())).toEqual(["Slack", "Microsoft Teams"]);
      expect(activeLinkTitles()).toEqual(["Microsoft Teams"]);
    },
  );

  test("a different answer than the remembered one replaces the entries in the folded section", async () => {
    remember(WorkspaceType.Slack);
    const answer: Deferred<Array<WorkspaceType>> =
      deferred<Array<WorkspaceType>>();
    fetcher.mockReturnValue(answer.promise);

    await renderAt(AlertsSideMenu, PageMap.ALERTS);

    expect(titles(workspaceLinks())).toEqual(["Slack"]);

    await act(async () => {
      answer.resolve([]);
      await answer.promise;
    });

    expect(titles(workspaceLinks())).toEqual(["Connect Slack or Teams"]);
    expect(isExpanded("Workspace")).toBe(false);
  });
});

describe("User Settings lists the connected workspaces, or none at all", () => {
  const SECTIONS_WITHOUT_WORKSPACE: Array<string> = [
    "Get Started",
    "Alerts & Notifications",
    "Incident On-Call",
    "Alert On-Call",
    "On-Call Logs",
    "Incoming Call Policy",
    "Calendar",
    "Profile",
  ];

  test("nothing connected: no Workspace section", async () => {
    connect();
    await renderAt(UserSettingsSideMenu, PageMap.USER_SETTINGS_SETUP);

    expect(sectionTitlesInOrder()).toEqual(SECTIONS_WITHOUT_WORKSPACE);
  });

  test.each([
    [[WorkspaceType.Slack], ["Slack"]],
    [[WorkspaceType.MicrosoftTeams], ["Microsoft Teams"]],
    [
      [WorkspaceType.MicrosoftTeams, WorkspaceType.Slack],
      ["Slack", "Microsoft Teams"],
    ],
  ])(
    "%j connected: a Workspace section, last, with %j",
    async (types: Array<WorkspaceType>, expected: Array<string>) => {
      connect(...types);
      await renderAt(UserSettingsSideMenu, PageMap.USER_SETTINGS_SETUP);

      expect(sectionTitlesInOrder()).toEqual([
        ...SECTIONS_WITHOUT_WORKSPACE,
        "Workspace",
      ]);
      expect(titles(workspaceLinks())).toEqual(expected);
      expect(isExpanded("Workspace")).toBe(false);
    },
  );

  test("its entries are the pages that link your own account", async () => {
    connect(WorkspaceType.Slack, WorkspaceType.MicrosoftTeams);
    await renderAt(UserSettingsSideMenu, PageMap.USER_SETTINGS_SETUP);

    expect(workspaceLinks()).toEqual([
      {
        title: "Slack",
        href: routeFor(PageMap.USER_SETTINGS_SLACK_INTEGRATION),
      },
      {
        title: "Microsoft Teams",
        href: routeFor(PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION),
      },
    ]);
  });

  test("the Slack page of a project without Slack still shows where you are", async () => {
    connect();
    await renderAt(
      UserSettingsSideMenu,
      PageMap.USER_SETTINGS_SLACK_INTEGRATION,
    );

    expect(titles(workspaceLinks())).toEqual(["Slack"]);
    expect(isExpanded("Workspace")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Slack"]);
  });

  test("while the first answer is on its way the section is left out, and arrives last without moving anything above it", async () => {
    const answer: Deferred<Array<WorkspaceType>> =
      deferred<Array<WorkspaceType>>();
    fetcher.mockReturnValue(answer.promise);

    await renderAt(UserSettingsSideMenu, PageMap.USER_SETTINGS_SETUP);

    expect(sectionTitlesInOrder()).toEqual(SECTIONS_WITHOUT_WORKSPACE);

    await act(async () => {
      answer.resolve([WorkspaceType.MicrosoftTeams]);
      await answer.promise;
    });

    expect(sectionTitlesInOrder()).toEqual([
      ...SECTIONS_WITHOUT_WORKSPACE,
      "Workspace",
    ]);
    expect(titles(workspaceLinks())).toEqual(["Microsoft Teams"]);
  });

  test("if asking fails, both are listed, as before", async () => {
    fetcher.mockRejectedValue(new Error("Permission denied"));
    await renderAt(UserSettingsSideMenu, PageMap.USER_SETTINGS_SETUP);

    expect(titles(workspaceLinks())).toEqual(["Slack", "Microsoft Teams"]);
  });
});

/*
 * Project Settings is where a workspace is connected (or disconnected), so
 * both stay listed there in every project: hiding the one not connected
 * would hide the only way to connect it.
 */
describe("Project Settings keeps both: it is where they are connected", () => {
  test.each([
    [[]],
    [[WorkspaceType.Slack]],
    [[WorkspaceType.MicrosoftTeams]],
    [[WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]],
  ])(
    "with %j connected, Workspace lists Slack and Microsoft Teams",
    async (types: Array<WorkspaceType>) => {
      connect(...types);
      await renderAt(ProjectSettingsSideMenu, PageMap.SETTINGS);

      expect(workspaceLinks()).toEqual([
        { title: "Slack", href: routeFor(PageMap.SETTINGS_SLACK_INTEGRATION) },
        {
          title: "Microsoft Teams",
          href: routeFor(PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION),
        },
      ]);
    },
  );

  test("and does not ask which are connected", async () => {
    await renderAt(ProjectSettingsSideMenu, PageMap.SETTINGS);

    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("one answer for the whole page", () => {
  test("a menu asks the server once, however often it re-renders or remounts", async () => {
    fetcher.mockResolvedValue([WorkspaceType.Slack]);

    await renderAt(IncidentsSideMenu, PageMap.INCIDENTS);
    cleanup();
    await renderAt(IncidentsSideMenu, PageMap.INCIDENT_EPISODES);
    cleanup();
    await renderAt(AlertsSideMenu, PageMap.ALERTS);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(titles(workspaceLinks())).toEqual(["Slack"]);
  });
});
