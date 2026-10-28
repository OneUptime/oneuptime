import {
  DATA_SECURITY_MENU,
  DataSecurityMenuBadge,
  DataSecurityMenuItem,
  DataSecurityMenuSection,
} from "../../Utils/DataSecurityNavigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuItemProps,
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Data Security side menu: its sections and their pages, as
 * DataSecurityNavigation.ts lists them, each page an entry of its own, lit
 * on its page. Beside Issues, how many are still open, in red: that is
 * what needs someone.
 *
 * Settings, Rules, Help and Advanced fold by their titles; Scanning, whose
 * scans are looked at when something needs checking, folds on purpose. The
 * Advanced section holds Archived Stores (PageMap.DATA_SECURITY_STORES_ARCHIVED),
 * the stores gone from their clouds, which the Data Stores list leaves out.
 */

interface MenuBadgeCount {
  modelType: { new (): BaseModel };
  countQuery: Query<BaseModel>;
  badgeType: BadgeType;
}

function getBadgeCount(
  badge: DataSecurityMenuBadge | undefined,
): MenuBadgeCount | undefined {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!badge || !projectId) {
    return undefined;
  }

  // The issues the Issues page opens on: the open ones.
  return {
    modelType: DataSecurityIssue,
    countQuery: {
      projectId: projectId,
      status: DataSecurityIssueStatus.Open,
    } as Query<BaseModel>,
    badgeType: BadgeType.DANGER,
  };
}

const DataSecuritySideMenu: FunctionComponent = (): ReactElement => {
  const sections: Array<SideMenuSectionProps> = DATA_SECURITY_MENU.map(
    (section: DataSecurityMenuSection): SideMenuSectionProps => {
      return {
        title: section.title,
        ...(section.startsCollapsed ? { defaultCollapsed: true } : {}),
        items: section.items.map(
          (item: DataSecurityMenuItem): SideMenuItemProps => {
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

export default DataSecuritySideMenu;
