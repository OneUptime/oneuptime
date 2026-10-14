import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuBadge,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
} from "../../Utils/SecurityEventsNavigation";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuItemProps,
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
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

const SecurityEventsSideMenu: FunctionComponent = (): ReactElement => {
  const sections: Array<SideMenuSectionProps> = SECURITY_EVENTS_MENU.map(
    (section: SecurityEventsMenuSection): SideMenuSectionProps => {
      return {
        title: section.title,
        defaultCollapsed: section.startsCollapsed || false,
        items: section.items.map(
          (item: SecurityEventsMenuItem): SideMenuItemProps => {
            const count: MenuBadgeCount | undefined = getBadgeCount(item.badge);

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
                    badgeType: count.badgeType,
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
