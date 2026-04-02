import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Traces",
      items: [
        {
          link: {
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TRACES] as Route,
            ),
          },
          icon: IconProp.Home,
        },
        {
          link: {
            title: "All Spans",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TRACES_LIST] as Route,
            ),
          },
          icon: IconProp.RectangleStack,
        },
      ],
    },
    {
      title: "Help",
      items: [
        {
          link: {
            title: "Setup Guide",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TRACES_DOCUMENTATION] as Route,
            ),
          },
          icon: IconProp.Book,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
