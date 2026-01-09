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
      title: "Logs",
      items: [
        {
          link: {
            title: "All Logs",
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route),
          },
          icon: IconProp.Logs,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
