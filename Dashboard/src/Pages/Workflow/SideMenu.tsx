import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/src/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/src/Components/SideMenu/SideMenuItem";
import React, { ReactElement } from "react";

const DashboardSideMenu: () => ReactElement = (): ReactElement => {
  return (
    <SideMenu>
      <SideMenuItem
        link={{
          title: "Workflows",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.WORKFLOWS] as Route,
          ),
        }}
        icon={IconProp.Workflow}
      />
      <SideMenuItem
        link={{
          title: "Global Variables",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.WORKFLOWS_VARIABLES] as Route,
          ),
        }}
        icon={IconProp.Variable}
      />

      <SideMenuItem
        link={{
          title: "Runs & Logs",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.WORKFLOWS_LOGS] as Route,
          ),
        }}
        icon={IconProp.Logs}
      />
    </SideMenu>
  );
};

export default DashboardSideMenu;
