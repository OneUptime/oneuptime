import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/src/Components/Badge/Badge";
import CountModelSideMenuItem from "Common/UI/src/Components/SideMenu/CountModelSideMenuItem";
import SideMenu from "Common/UI/src/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/src/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/src/Components/SideMenu/SideMenuSection";
import Incident from "Common/Models/DatabaseModels/Incident";
import Project from "Common/Models/DatabaseModels/Project";
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
            title: "All Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS] as Route,
            ),
          }}
          icon={IconProp.List}
        />

        <CountModelSideMenuItem<Incident>
          link={{
            title: "Active Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.UNRESOLVED_INCIDENTS] as Route,
            ),
          }}
          icon={IconProp.Alert}
          badgeType={BadgeType.DANGER}
          modelType={Incident}
          countQuery={{
            projectId: props.project?._id,
            currentIncidentState: {
              isResolvedState: false,
            },
          }}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
