import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  WORKSPACE_MENU_ENTRY_ICONS,
  WORKSPACE_MENU_ENTRY_ORDER,
  WORKSPACE_MENU_ENTRY_TITLES,
  WORKSPACE_SECTION_TITLE,
  WorkspaceMenuEntry,
  WorkspaceMenuPages,
  getWorkspaceMenuEntries,
  getWorkspaceSideMenuSection,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSideMenuSection";
import { WorkspaceConnections } from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  SideMenuItemProps,
  SideMenuSectionProps,
} from "../../../UI/Components/SideMenu/SideMenu";
import { isTitleCollapsedByDefault } from "../../../UI/Components/SideMenu/SideMenuSectionState";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

/*
 * "Can we please show options that are integrated with oneuptime? If a
 * company integrates Slack, show Slack. If a company integrates Teams, show
 * Teams as well." (the maintainer)
 *
 * The rules every Workspace section follows, without a menu around them.
 * The menus themselves are rendered in WorkspaceMenusConnected.test.tsx.
 */

const { Slack, MicrosoftTeams, Connect } = WorkspaceMenuEntry;

function known(
  connected: Array<WorkspaceType>,
  isFresh: boolean = true,
): WorkspaceConnections {
  return { connected, isFresh, error: null };
}

const LOADING: WorkspaceConnections = {
  connected: null,
  isFresh: false,
  error: null,
};

const FAILED: WorkspaceConnections = {
  connected: null,
  isFresh: false,
  error: "Request failed",
};

const NOWHERE: (entry: WorkspaceMenuEntry) => boolean = (): boolean => {
  return false;
};

function onPage(
  page: WorkspaceMenuEntry,
): (entry: WorkspaceMenuEntry) => boolean {
  return (entry: WorkspaceMenuEntry): boolean => {
    return entry === page;
  };
}

describe("which entries a product menu lists (it has a connect page)", () => {
  test.each([
    ["nothing connected", known([]), [Connect]],
    ["Slack connected", known([WorkspaceType.Slack]), [Slack]],
    [
      "Microsoft Teams connected",
      known([WorkspaceType.MicrosoftTeams]),
      [MicrosoftTeams],
    ],
    [
      "both connected",
      known([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]),
      [Slack, MicrosoftTeams],
    ],
    [
      "Slack remembered from the last visit",
      known([WorkspaceType.Slack], false),
      [Slack],
    ],
    ["nothing remembered as connected", known([], false), [Connect]],
    ["the first answer still on its way", LOADING, [Connect]],
    ["asking failed with nothing known", FAILED, [Slack, MicrosoftTeams]],
    [
      "a refresh failed after Slack was known",
      {
        connected: [WorkspaceType.Slack],
        isFresh: true,
        error: "Request failed",
      },
      [Slack],
    ],
  ])(
    "%s: %j",
    (
      _case: string,
      connections: WorkspaceConnections,
      expected: Array<WorkspaceMenuEntry>,
    ) => {
      expect(
        getWorkspaceMenuEntries({
          connections,
          hasConnectPage: true,
          isCurrentPage: NOWHERE,
        }),
      ).toEqual(expected);
    },
  );
});

describe("which entries User Settings lists (no connect page)", () => {
  test.each([
    ["nothing connected", known([]), []],
    ["Slack connected", known([WorkspaceType.Slack]), [Slack]],
    [
      "Microsoft Teams connected",
      known([WorkspaceType.MicrosoftTeams]),
      [MicrosoftTeams],
    ],
    [
      "both connected",
      known([WorkspaceType.MicrosoftTeams, WorkspaceType.Slack]),
      [Slack, MicrosoftTeams],
    ],
    ["the first answer still on its way", LOADING, []],
    ["asking failed with nothing known", FAILED, [Slack, MicrosoftTeams]],
  ])(
    "%s: %j",
    (
      _case: string,
      connections: WorkspaceConnections,
      expected: Array<WorkspaceMenuEntry>,
    ) => {
      expect(
        getWorkspaceMenuEntries({
          connections,
          hasConnectPage: false,
          isCurrentPage: NOWHERE,
        }),
      ).toEqual(expected);
    },
  );

  test("never lists the connect entry, even when asked about it as the current page", () => {
    expect(
      getWorkspaceMenuEntries({
        connections: known([]),
        hasConnectPage: false,
        isCurrentPage: onPage(Connect),
      }),
    ).toEqual([]);
  });
});

describe("the page you are on is always listed", () => {
  test.each([
    [
      "the Microsoft Teams page of a Slack-only project",
      known([WorkspaceType.Slack]),
      true,
      MicrosoftTeams,
      [Slack, MicrosoftTeams],
    ],
    [
      "the Slack page of a Teams-only project",
      known([WorkspaceType.MicrosoftTeams]),
      true,
      Slack,
      [Slack, MicrosoftTeams],
    ],
    [
      "the connect page once Slack is connected",
      known([WorkspaceType.Slack]),
      true,
      Connect,
      [Slack, Connect],
    ],
    [
      "the Slack page while the first answer is on its way",
      LOADING,
      true,
      Slack,
      [Slack],
    ],
    [
      "the Microsoft Teams page while the first answer is on its way",
      LOADING,
      true,
      MicrosoftTeams,
      [MicrosoftTeams],
    ],
    [
      "the connect page while the first answer is on its way",
      LOADING,
      true,
      Connect,
      [Connect],
    ],
    [
      "User Settings' Slack page in a project with nothing connected",
      known([]),
      false,
      Slack,
      [Slack],
    ],
    [
      "User Settings' Microsoft Teams page while the first answer is on its way",
      LOADING,
      false,
      MicrosoftTeams,
      [MicrosoftTeams],
    ],
    [
      "the Slack page of a project with nothing connected",
      known([]),
      true,
      Slack,
      [Slack, Connect],
    ],
    [
      "the connect page after asking failed",
      FAILED,
      true,
      Connect,
      [Slack, MicrosoftTeams, Connect],
    ],
  ])(
    "%s",
    (
      _case: string,
      connections: WorkspaceConnections,
      hasConnectPage: boolean,
      currentPage: WorkspaceMenuEntry,
      expected: Array<WorkspaceMenuEntry>,
    ) => {
      expect(
        getWorkspaceMenuEntries({
          connections,
          hasConnectPage,
          isCurrentPage: onPage(currentPage),
        }),
      ).toEqual(expected);
    },
  );

  /*
   * While the first answer is on its way, the section already holds the
   * entry of the page you are on. So the section that is open because you
   * are on one of its pages stays open when the answer arrives: it never
   * folds and unfolds again under you.
   */
  test("on a workspace page, the entry is listed before and after the answer", () => {
    for (const connections of [
      LOADING,
      known([]),
      known([WorkspaceType.Slack]),
      known([WorkspaceType.MicrosoftTeams]),
      FAILED,
    ]) {
      expect(
        getWorkspaceMenuEntries({
          connections,
          hasConnectPage: true,
          isCurrentPage: onPage(MicrosoftTeams),
        }),
      ).toContain(MicrosoftTeams);
    }
  });
});

describe("the section", () => {
  const PAGES: WorkspaceMenuPages = {
    slack: PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK,
    microsoftTeams: PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    connect: PageMap.INCIDENTS_WORKSPACE_CONNECTIONS,
  };

  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/incidents`);
  });

  function itemsOf(
    section: SideMenuSectionProps | null,
  ): Array<{ title: string; href: string; icon: IconProp | undefined }> {
    return (section?.items || []).map(
      (
        item: SideMenuItemProps,
      ): { title: string; href: string; icon: IconProp | undefined } => {
        return {
          title: item.link.title,
          href: item.link.to.toString(),
          icon: item.icon,
        };
      },
    );
  }

  test("is titled Workspace, a title every menu folds by default", () => {
    const section: SideMenuSectionProps | null = getWorkspaceSideMenuSection({
      pages: PAGES,
      connections: known([WorkspaceType.Slack]),
    });

    expect(section?.title).toBe("Workspace");
    expect(WORKSPACE_SECTION_TITLE).toBe("Workspace");
    expect(isTitleCollapsedByDefault(WORKSPACE_SECTION_TITLE)).toBe(true);
    // Folded by its title, so it must not override that itself.
    expect(section?.defaultCollapsed).toBeUndefined();
  });

  test("with nothing connected it holds one entry, to the product's own connect page", () => {
    expect(
      itemsOf(
        getWorkspaceSideMenuSection({
          pages: PAGES,
          connections: known([]),
        }),
      ),
    ).toEqual([
      {
        title: "Connect Slack or Teams",
        href: routeFor(PageMap.INCIDENTS_WORKSPACE_CONNECTIONS),
        icon: IconProp.ChatBubbleLeftRight,
      },
    ]);
  });

  test("with both connected it holds Slack, then Microsoft Teams, at the product's own pages", () => {
    expect(
      itemsOf(
        getWorkspaceSideMenuSection({
          pages: PAGES,
          connections: known([
            WorkspaceType.MicrosoftTeams,
            WorkspaceType.Slack,
          ]),
        }),
      ),
    ).toEqual([
      {
        title: "Slack",
        href: routeFor(PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK),
        icon: IconProp.Slack,
      },
      {
        title: "Microsoft Teams",
        href: routeFor(PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS),
        icon: IconProp.MicrosoftTeams,
      },
    ]);
  });

  test("every link carries the real project id", () => {
    for (const item of itemsOf(
      getWorkspaceSideMenuSection({
        pages: PAGES,
        connections: FAILED,
      }),
    )) {
      expect(item.href).toContain(`/dashboard/${PROJECT_ID}/incidents/`);
      expect(item.href).not.toContain(":projectId");
    }
  });

  test("is null when it has nothing to list, so the menu leaves it out", () => {
    expect(
      getWorkspaceSideMenuSection({
        pages: {
          slack: PageMap.USER_SETTINGS_SLACK_INTEGRATION,
          microsoftTeams: PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
        },
        connections: known([]),
      }),
    ).toBeNull();
  });

  test("asks the given test of 'the page you are on', and lists that page", () => {
    const teamsRoute: string = routeFor(
      PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    );

    expect(
      itemsOf(
        getWorkspaceSideMenuSection({
          pages: PAGES,
          connections: known([WorkspaceType.Slack]),
          isOnPage: (route: Route): boolean => {
            return route.toString() === teamsRoute;
          },
        }),
      ).map((item: { title: string }): string => {
        return item.title;
      }),
    ).toEqual(["Slack", "Microsoft Teams"]);
  });

  test("by default asks Navigation, so the current URL counts", () => {
    goTo(routeFor(PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS));

    expect(
      itemsOf(
        getWorkspaceSideMenuSection({
          pages: PAGES,
          connections: known([]),
        }),
      ).map((item: { title: string }): string => {
        return item.title;
      }),
    ).toEqual(["Microsoft Teams", "Connect Slack or Teams"]);
  });

  test("names, icons and order are one table, with an entry for each kind", () => {
    expect(WORKSPACE_MENU_ENTRY_ORDER).toEqual([
      Slack,
      MicrosoftTeams,
      Connect,
    ]);
    expect(WORKSPACE_MENU_ENTRY_TITLES).toEqual({
      [Slack]: "Slack",
      [MicrosoftTeams]: "Microsoft Teams",
      [Connect]: "Connect Slack or Teams",
    });
    expect(WORKSPACE_MENU_ENTRY_ICONS).toEqual({
      [Slack]: IconProp.Slack,
      [MicrosoftTeams]: IconProp.MicrosoftTeams,
      [Connect]: IconProp.ChatBubbleLeftRight,
    });
  });
});
