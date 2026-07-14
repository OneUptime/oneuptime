import React, { FunctionComponent, ReactElement } from "react";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import IconProp from "Common/Types/Icon/IconProp";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Overview">
        <SideMenuItem
          link={{
            title: "Tasks",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENT_TASKS] as Route,
            ),
          }}
          icon={IconProp.List}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
