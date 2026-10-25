import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SECURITY_EVENTS_MENU,
  SECURITY_EVENTS_WORKSPACE_SECTION_BEFORE,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
} from "../../Utils/SecurityEventsNavigation";
import {
  SecurityEventsBadgeCount,
  getSecurityEventsBadgeCount,
} from "../../Components/SecurityEvents/SecurityEventsBadgeCount";
import { useWorkspaceSideMenuSection } from "../../Components/Workspace/WorkspaceSideMenuSection";
import useSecurityCaseValues from "../../Components/SecurityCase/useSecurityCaseValues";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import SideMenu, {
  SideMenuItemProps,
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Security Events side menu: its sections and their pages, as
 * SecurityEventsNavigation.ts lists them. Every page is an entry of its
 * own, lit on its page. The counts beside Open Cases, Assigned to Me and
 * Waiting for Approval come from SecurityEventsBadgeCount, each counting
 * what its page lists.
 *
 * Before Connections, the Workspace section: the security cases' Slack and
 * Microsoft Teams pages, only for the workspaces the project has connected,
 * or one entry to connect one when it has none (WorkspaceSideMenuSection.ts),
 * as every product's menu draws it.
 *
 * The case counts wait for the project's case statuses: which cases are
 * open is what those count as.
 */
/*
 * The page an entry is lit for besides its own: one of its detail pages
 * (an entity's page, for Entity Risk), when that is the page you are on.
 */
function getActiveDetailRoute(item: SecurityEventsMenuItem): Route | undefined {
  for (const page of item.detailPages || []) {
    const route: Route = RouteUtil.populateRouteParams(RouteMap[page] as Route);

    if (Navigation.isOnThisPage(route)) {
      return route;
    }
  }

  return undefined;
}

const SecurityEventsSideMenu: FunctionComponent = (): ReactElement => {
  const { values } = useSecurityCaseValues();

  const workspaceSection: SideMenuSectionProps | null =
    useWorkspaceSideMenuSection({
      slack: PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK,
      microsoftTeams:
        PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      connect: PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTIONS,
    });

  const sections: Array<SideMenuSectionProps> = SECURITY_EVENTS_MENU.map(
    (section: SecurityEventsMenuSection): SideMenuSectionProps => {
      return {
        title: section.title,
        ...(section.startsCollapsed ? { defaultCollapsed: true } : {}),
        items: section.items.map(
          (item: SecurityEventsMenuItem): SideMenuItemProps => {
            const count: SecurityEventsBadgeCount | undefined =
              getSecurityEventsBadgeCount(
                item.badge,
                values ? values.statuses : null,
              );
            const activeRoute: Route | undefined = getActiveDetailRoute(item);

            return {
              link: {
                title: item.title,
                to: RouteUtil.populateRouteParams(RouteMap[item.page] as Route),
              },
              ...(activeRoute ? { activeRoute } : {}),
              icon: item.icon,
              ...(count
                ? {
                    modelType: count.modelType,
                    countQuery: count.countQuery,
                    ...(count.badgeType !== undefined
                      ? { badgeType: count.badgeType }
                      : {}),
                  }
                : {}),
            };
          },
        ),
      };
    },
  );

  if (workspaceSection) {
    const before: number = sections.findIndex(
      (section: SideMenuSectionProps): boolean => {
        return section.title === SECURITY_EVENTS_WORKSPACE_SECTION_BEFORE;
      },
    );

    sections.splice(
      before === -1 ? sections.length : before,
      0,
      workspaceSection,
    );
  }

  return <SideMenu sections={sections} />;
};

export default SecurityEventsSideMenu;
