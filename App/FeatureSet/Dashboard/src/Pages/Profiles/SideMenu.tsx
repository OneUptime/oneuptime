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
      title: "Performance",
      items: [
        {
          link: {
            title: "All Profiles",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROFILES] as Route,
            ),
          },
          icon: IconProp.Fire,
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
              RouteMap[PageMap.PROFILES_DOCUMENTATION] as Route,
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
