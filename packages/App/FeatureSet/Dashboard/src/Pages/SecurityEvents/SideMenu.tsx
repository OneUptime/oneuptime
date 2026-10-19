import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuBadge,
  SecurityEventsMenuItem,
  getSecurityEventsMenuItemPages,
} from "../../Utils/SecurityEventsNavigation";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuItemProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import { OPEN_SECURITY_CASE_STATUSES } from "Common/Types/SecurityCase/SecurityCaseStatus";
import SecurityPlaybookRunStatus from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import React, { FunctionComponent, ReactElement } from "react";

interface MenuBadgeCount {
  modelType: { new (): BaseModel };
  countQuery: Query<BaseModel>;
  badgeType: BadgeType;
}

/*
 * The live counts beside an entry: the open cases, and the playbook runs
 * waiting for somebody to approve a step. Both are read with the person's
 * own permissions, so a role that cannot read cases sees no number at all.
 */
function getBadgeCount(
  badge: SecurityEventsMenuBadge | undefined,
): MenuBadgeCount | undefined {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();

  if (!badge || !projectId) {
    return undefined;
  }

  switch (badge) {
    case "openCases":
      return {
        modelType: SecurityCase,
        countQuery: {
          projectId: projectId,
          status: new Includes([...OPEN_SECURITY_CASE_STATUSES]),
        } as Query<BaseModel>,
        badgeType: BadgeType.DANGER,
      };
    case "runsWaitingForApproval":
      return {
        modelType: SecurityPlaybookRun,
        countQuery: {
          projectId: projectId,
          status: SecurityPlaybookRunStatus.WaitingForApproval,
        } as Query<BaseModel>,
        badgeType: BadgeType.WARNING,
      };
    default:
      return undefined;
  }
}

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

const SecurityEventsSideMenu: FunctionComponent = (): ReactElement => {
  const items: Array<SideMenuItemProps> = SECURITY_EVENTS_MENU.map(
    (item: SecurityEventsMenuItem): SideMenuItemProps => {
      const count: MenuBadgeCount | undefined = getBadgeCount(item.badge);
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
