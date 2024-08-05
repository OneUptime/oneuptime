import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "CommonUI/src/Components/Badge/Badge";
import CountModelSideMenuItem from "CommonUI/src/Components/SideMenu/CountModelSideMenuItem";
import SideMenu from "CommonUI/src/Components/SideMenu/SideMenu";
import SideMenuItem from "CommonUI/src/Components/SideMenu/SideMenuItem";
import SideMenuSection from "CommonUI/src/Components/SideMenu/SideMenuSection";
import Project from "Common/AppModels/Models/Project";
import ScheduledMaintenance from "Common/AppModels/Models/ScheduledMaintenance";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  project?: Project | undefined;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Overview">
        <SideMenuItem
          link={{
            title: "All Events",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
            ),
          }}
          icon={IconProp.List}
        />

        <CountModelSideMenuItem<ScheduledMaintenance>
          link={{
            title: "Ongoing Events",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS] as Route,
            ),
          }}
          icon={IconProp.Clock}
          badgeType={BadgeType.WARNING}
          modelType={ScheduledMaintenance}
          countQuery={{
            projectId: props.project?._id,
            currentScheduledMaintenanceState: {
              isOngoingState: true,
            },
          }}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
