import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  WorkspaceConnections,
  useWorkspaceConnections,
} from "../../Utils/Workspace/ConnectedWorkspaces";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import type {
  SideMenuItemProps,
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * The Workspace section of a side menu: one entry per chat workspace the
 * project has connected, instead of Slack and Microsoft Teams for everybody.
 *
 * - Slack connected: Slack. Microsoft Teams connected: Microsoft Teams. Both:
 *   both, Slack first.
 * - Neither: one entry, "Connect Slack or Teams", to a page that shows the
 *   two side by side, says what each would do here and connects them. A menu
 *   without such a page (User Settings, whose pages link your own account to
 *   a workspace the project already has) has no Workspace section at all.
 * - The page you are on is always listed, so the menu never hides where you
 *   are: open the Microsoft Teams page of a Slack-only project from a
 *   bookmark and its entry is there, marked, while you are on it.
 * - Not known yet (a first visit, before the answer arrives): only the entry
 *   of the page you are on, or else the connect entry. The section is folded
 *   on every other page, so nothing visible changes when the answer lands.
 * - Not known because asking failed: Slack and Microsoft Teams, as before.
 *   Nothing is hidden on a guess.
 */

export const WORKSPACE_SECTION_TITLE: string = "Workspace";

export enum WorkspaceMenuEntry {
  Slack = "Slack",
  MicrosoftTeams = "MicrosoftTeams",
  Connect = "Connect",
}

// The order entries are listed in: the workspaces, then the way to connect one.
export const WORKSPACE_MENU_ENTRY_ORDER: ReadonlyArray<WorkspaceMenuEntry> = [
  WorkspaceMenuEntry.Slack,
  WorkspaceMenuEntry.MicrosoftTeams,
  WorkspaceMenuEntry.Connect,
];

export const WORKSPACE_MENU_ENTRY_TITLES: Readonly<
  Record<WorkspaceMenuEntry, string>
> = {
  [WorkspaceMenuEntry.Slack]: "Slack",
  [WorkspaceMenuEntry.MicrosoftTeams]: "Microsoft Teams",
  [WorkspaceMenuEntry.Connect]: "Connect Slack or Teams",
};

export const WORKSPACE_MENU_ENTRY_ICONS: Readonly<
  Record<WorkspaceMenuEntry, IconProp>
> = {
  [WorkspaceMenuEntry.Slack]: IconProp.Slack,
  [WorkspaceMenuEntry.MicrosoftTeams]: IconProp.MicrosoftTeams,
  [WorkspaceMenuEntry.Connect]: IconProp.ChatBubbleLeftRight,
};

const ENTRY_FOR_WORKSPACE: Readonly<Record<WorkspaceType, WorkspaceMenuEntry>> =
  {
    [WorkspaceType.Slack]: WorkspaceMenuEntry.Slack,
    [WorkspaceType.MicrosoftTeams]: WorkspaceMenuEntry.MicrosoftTeams,
  };

export interface WorkspaceMenuPages {
  slack: PageMap;
  microsoftTeams: PageMap;
  /*
   * The page a project with nothing connected is sent to. Left out, a menu
   * with nothing connected has no Workspace section.
   */
  connect?: PageMap | undefined;
}

export interface WorkspaceMenuEntriesInput {
  connections: WorkspaceConnections;
  hasConnectPage: boolean;
  isCurrentPage: (entry: WorkspaceMenuEntry) => boolean;
}

// Which entries a Workspace section lists, in menu order. See the rules above.
export function getWorkspaceMenuEntries(
  input: WorkspaceMenuEntriesInput,
): Array<WorkspaceMenuEntry> {
  const listed: Set<WorkspaceMenuEntry> = new Set();
  const connected: ReadonlyArray<WorkspaceType> | null =
    input.connections.connected;

  for (const entry of WORKSPACE_MENU_ENTRY_ORDER) {
    if (entry === WorkspaceMenuEntry.Connect && !input.hasConnectPage) {
      continue;
    }

    if (input.isCurrentPage(entry)) {
      listed.add(entry);
    }
  }

  if (connected) {
    for (const workspaceType of connected) {
      listed.add(ENTRY_FOR_WORKSPACE[workspaceType]);
    }

    if (connected.length === 0 && input.hasConnectPage) {
      listed.add(WorkspaceMenuEntry.Connect);
    }
  } else if (input.connections.error) {
    listed.add(WorkspaceMenuEntry.Slack);
    listed.add(WorkspaceMenuEntry.MicrosoftTeams);
  } else if (listed.size === 0 && input.hasConnectPage) {
    listed.add(WorkspaceMenuEntry.Connect);
  }

  return WORKSPACE_MENU_ENTRY_ORDER.filter(
    (entry: WorkspaceMenuEntry): boolean => {
      return listed.has(entry);
    },
  );
}

export interface WorkspaceSideMenuSectionInput {
  pages: WorkspaceMenuPages;
  connections: WorkspaceConnections;
  // Whether a route is the page the user is on. Navigation's answer by default.
  isOnPage?: ((route: Route) => boolean) | undefined;
}

/*
 * The section itself, or null when it has nothing to list. Titled
 * "Workspace", so it starts folded in every menu (SideMenuSectionState.ts)
 * and opens by itself on its own pages.
 */
export function getWorkspaceSideMenuSection(
  input: WorkspaceSideMenuSectionInput,
): SideMenuSectionProps | null {
  const isOnPage: (route: Route) => boolean =
    input.isOnPage ||
    ((route: Route): boolean => {
      return Navigation.isOnThisPage(route);
    });

  type PageOfEntryFunction = (entry: WorkspaceMenuEntry) => PageMap | null;

  const pageOfEntry: PageOfEntryFunction = (
    entry: WorkspaceMenuEntry,
  ): PageMap | null => {
    if (entry === WorkspaceMenuEntry.Slack) {
      return input.pages.slack;
    }

    if (entry === WorkspaceMenuEntry.MicrosoftTeams) {
      return input.pages.microsoftTeams;
    }

    return input.pages.connect || null;
  };

  type RouteOfEntryFunction = (entry: WorkspaceMenuEntry) => Route | null;

  const routeOfEntry: RouteOfEntryFunction = (
    entry: WorkspaceMenuEntry,
  ): Route | null => {
    const page: PageMap | null = pageOfEntry(entry);

    if (!page || !RouteMap[page]) {
      return null;
    }

    return RouteUtil.populateRouteParams(RouteMap[page] as Route);
  };

  const entries: Array<WorkspaceMenuEntry> = getWorkspaceMenuEntries({
    connections: input.connections,
    hasConnectPage: Boolean(input.pages.connect),
    isCurrentPage: (entry: WorkspaceMenuEntry): boolean => {
      const route: Route | null = routeOfEntry(entry);

      return route ? isOnPage(route) : false;
    },
  });

  const items: Array<SideMenuItemProps> = [];

  for (const entry of entries) {
    const route: Route | null = routeOfEntry(entry);

    if (!route) {
      continue;
    }

    items.push({
      link: {
        title: WORKSPACE_MENU_ENTRY_TITLES[entry],
        to: route,
      },
      icon: WORKSPACE_MENU_ENTRY_ICONS[entry],
    });
  }

  if (items.length === 0) {
    return null;
  }

  return {
    title: WORKSPACE_SECTION_TITLE,
    items: items,
  };
}

// The section for the current project, updated when the answer arrives.
export function useWorkspaceSideMenuSection(
  pages: WorkspaceMenuPages,
): SideMenuSectionProps | null {
  const connections: WorkspaceConnections = useWorkspaceConnections();

  return getWorkspaceSideMenuSection({
    pages: pages,
    connections: connections,
  });
}
