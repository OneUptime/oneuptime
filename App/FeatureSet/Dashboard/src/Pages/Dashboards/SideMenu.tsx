import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { ReactElement } from "react";

const DashboardsSideMenu: () => ReactElement = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Dashboards",
      items: [
        {
          link: {
            title: "Dashboards",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARDS] as Route,
            ),
          },
          icon: IconProp.Window,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARDS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.DASHBOARDS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardsSideMenu;
