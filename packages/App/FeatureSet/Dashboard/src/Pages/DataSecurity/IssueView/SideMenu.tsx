import {
  DATA_SECURITY_ISSUE_MENU,
  IssueViewMenuItem,
  IssueViewMenuSection,
} from "../../../Components/DataSecurity/IssueViewMenu";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
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
 * A data security issue's own side menu (IssueViewMenu.ts): its Overview
 * and Timeline, and under Advanced, Delete Issue - each entry lit on its
 * own page. Advanced folds by its title, as every record's does, and opens
 * by itself on its own page.
 */
const DataSecurityIssueSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const sections: Array<SideMenuSectionProps> = DATA_SECURITY_ISSUE_MENU.map(
    (section: IssueViewMenuSection): SideMenuSectionProps => {
      return {
        title: section.title,
        items: section.items.map(
          (item: IssueViewMenuItem): SideMenuItemProps => {
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
            };
          },
        ),
      };
    },
  );

  return <SideMenu sections={sections} />;
};

export default DataSecurityIssueSideMenu;
