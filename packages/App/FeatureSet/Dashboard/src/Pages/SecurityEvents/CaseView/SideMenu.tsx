import {
  SecurityCaseMenuBadgeCount,
  getSecurityCaseMenuBadgeCount,
} from "../../../Components/SecurityCase/SecurityCaseMenuBadgeCount";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  SECURITY_CASE_MENU,
  SecurityCaseMenuItem,
  SecurityCaseMenuSection,
} from "../../../Utils/SecurityCaseNavigation";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import SideMenu, {
  SideMenuItemProps,
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * A security case's own side menu: its sections and pages, as
 * SecurityCaseNavigation.ts lists them, each entry lit on its own page -
 * the sections an incident's, alert's and scheduled maintenance event's
 * menus have, where a case has pages for them. Advanced folds by its title,
 * as theirs does, and opens by itself on its own pages.
 *
 * Beside Playbooks, how many of the case's runs wait for an approval
 * (SecurityCaseMenuBadgeCount.ts): seen from any page of the case.
 */
const SecurityCaseSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const sections: Array<SideMenuSectionProps> = SECURITY_CASE_MENU.map(
    (section: SecurityCaseMenuSection): SideMenuSectionProps => {
      return {
        title: section.title,
        items: section.items.map(
          (item: SecurityCaseMenuItem): SideMenuItemProps => {
            const count: SecurityCaseMenuBadgeCount | undefined =
              getSecurityCaseMenuBadgeCount(item.badge, props.modelId);

            return {
              link: {
                title: item.title,
                to: RouteUtil.populateRouteParams(
                  RouteMap[item.page] as Route,
                  { modelId: props.modelId },
                ),
              },
              icon: item.icon,
              ...(item.isDestructive ? { className: "danger-on-hover" } : {}),
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

export default SecurityCaseSideMenu;
