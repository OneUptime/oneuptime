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
            title: "All Tasks",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENT_TASKS] as Route,
            ),
          }}
          icon={IconProp.List}
        />
      </SideMenuSection>

      <SideMenuSection title="By Status">
        <SideMenuItem
          link={{
            title: "Scheduled",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENT_TASKS_SCHEDULED] as Route,
            ),
          }}
          icon={IconProp.Clock}
        />

        <SideMenuItem
          link={{
            title: "In Progress",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENT_TASKS_IN_PROGRESS] as Route,
            ),
          }}
          icon={IconProp.Activity}
        />

        <SideMenuItem
          link={{
            title: "Completed",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENT_TASKS_COMPLETED] as Route,
            ),
          }}
          icon={IconProp.Check}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
