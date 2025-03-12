import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import CountModelSideMenuItem from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import Alert from "Common/Models/DatabaseModels/Alert";
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
            title: "All Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS] as Route,
            ),
          }}
          icon={IconProp.List}
        />

        <CountModelSideMenuItem<Alert>
          link={{
            title: "Active Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.UNRESOLVED_ALERTS] as Route,
            ),
          }}
          icon={IconProp.ExclaimationCircle}
          badgeType={BadgeType.DANGER}
          modelType={Alert}
          countQuery={{
            projectId: props.project?._id,
            currentAlertState: {
              isResolvedState: false,
            },
          }}
        />
      </SideMenuSection>

      <SideMenuSection title="Workspace Connections">
        <SideMenuItem
          link={{
            title: "Slack",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK] as Route,
            ),
          }}
          icon={IconProp.Slack}
        />
        <SideMenuItem
          link={{
            title: "Microsoft Teams",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
              ] as Route,
            ),
          }}
          icon={IconProp.MicrosoftTeams}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
