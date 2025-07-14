import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { ReactElement } from "react";

const DashboardSideMenu: () => ReactElement = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Workflows",
      items: [
        {
          link: {
            title: "Workflows",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOWS] as Route,
            ),
          },
          icon: IconProp.Workflow,
        },
        {
          link: {
            title: "Global Variables",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOWS_VARIABLES] as Route,
            ),
          },
          icon: IconProp.Variable,
        },
        {
          link: {
            title: "Runs & Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOWS_LOGS] as Route,
            ),
          },
          icon: IconProp.Logs,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
