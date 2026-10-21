import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
} from "../../Utils/SecurityEventsNavigation";
import {
  SecurityEventsBadgeCount,
  getSecurityEventsBadgeCount,
} from "../../Components/SecurityEvents/SecurityEventsBadgeCount";
import Route from "Common/Types/API/Route";
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
 */
const SecurityEventsSideMenu: FunctionComponent = (): ReactElement => {
  const sections: Array<SideMenuSectionProps> = SECURITY_EVENTS_MENU.map(
    (section: SecurityEventsMenuSection): SideMenuSectionProps => {
      return {
        title: section.title,
        ...(section.startsCollapsed ? { defaultCollapsed: true } : {}),
        items: section.items.map(
          (item: SecurityEventsMenuItem): SideMenuItemProps => {
            const count: SecurityEventsBadgeCount | undefined =
              getSecurityEventsBadgeCount(item.badge);

            return {
              link: {
                title: item.title,
                to: RouteUtil.populateRouteParams(RouteMap[item.page] as Route),
              },
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

  return <SideMenu sections={sections} />;
};

export default SecurityEventsSideMenu;
