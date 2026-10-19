import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  getSecurityEventsMenuItemPages,
} from "../../Utils/SecurityEventsNavigation";
import {
  SecurityEventsBadgeCount,
  getSecurityEventsBadgeCount,
} from "../../Components/SecurityEvents/SecurityEventsBadgeCount";
import Route from "Common/Types/API/Route";
import SideMenu, {
  SideMenuItemProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

function routeOf(page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route);
}

/*
 * The page of an entry's group the person is on, so the entry stays lit
 * on its tabs too (Rule Library under Detections, Playbook Runs under
 * Playbooks).
 */
function getActiveRoute(item: SecurityEventsMenuItem): Route | undefined {
  const activePage: PageMap | undefined = getSecurityEventsMenuItemPages(
    item,
  ).find((page: PageMap): boolean => {
    return Navigation.isOnThisPage(routeOf(page));
  });

  return activePage ? routeOf(activePage) : undefined;
}

/*
 * The live counts beside an entry (the open cases, the playbook runs
 * waiting for an approval) come from SecurityEventsBadgeCount, which the
 * page tabs read too.
 */
const SecurityEventsSideMenu: FunctionComponent = (): ReactElement => {
  const items: Array<SideMenuItemProps> = SECURITY_EVENTS_MENU.map(
    (item: SecurityEventsMenuItem): SideMenuItemProps => {
      const count: SecurityEventsBadgeCount | undefined =
        getSecurityEventsBadgeCount(item.badge);
      const activeRoute: Route | undefined = getActiveRoute(item);

      return {
        link: {
          title: item.title,
          to: routeOf(item.page),
        },
        icon: item.icon,
        ...(activeRoute ? { activeRoute } : {}),
        ...(count
          ? {
              modelType: count.modelType,
              countQuery: count.countQuery,
              badgeType: count.badgeType,
            }
          : {}),
      };
    },
  );

  return <SideMenu items={items} />;
};

export default SecurityEventsSideMenu;
