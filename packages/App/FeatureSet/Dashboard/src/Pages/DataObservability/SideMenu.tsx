import {
  DATA_OBSERVABILITY_MENU,
  DataObservabilityMenuItem,
  DataObservabilityMenuSection,
} from "../../Utils/DataObservabilityNavigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import SideMenu, {
  SideMenuItemProps,
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Data Observability side menu: its sections and their pages, as
 * DataObservabilityNavigation.ts lists them - the everyday pages first,
 * then Quality (the rules the data keeps) and Usage (who relies on it and
 * what it costs), with Rules, Help and Advanced folded by their titles.
 */
const DataObservabilitySideMenu: FunctionComponent = (): ReactElement => {
  const sections: Array<SideMenuSectionProps> = DATA_OBSERVABILITY_MENU.map(
    (section: DataObservabilityMenuSection): SideMenuSectionProps => {
      return {
        title: section.title,
        items: section.items.map(
          (item: DataObservabilityMenuItem): SideMenuItemProps => {
            return {
              link: {
                title: item.title,
                to: RouteUtil.populateRouteParams(RouteMap[item.page] as Route),
              },
              icon: item.icon,
            };
          },
        ),
      };
    },
  );

  return <SideMenu sections={sections} />;
};

export default DataObservabilitySideMenu;
