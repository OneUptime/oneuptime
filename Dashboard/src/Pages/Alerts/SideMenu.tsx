import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Alert from "Common/Models/DatabaseModels/Alert";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  project?: Project | undefined;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Overview",
      items: [
        {
          link: {
            title: "All Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Active Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.UNRESOLVED_ALERTS] as Route,
            ),
          },
          icon: IconProp.ExclaimationCircle,
          badgeType: BadgeType.DANGER,
          modelType: Alert,
          countQuery: {
            projectId: props.project?._id,
            currentAlertState: {
              isResolvedState: false,
            },
          } as any,
        },
      ],
    },
    {
      title: "Workspace Connections",
      items: [
        {
          link: {
            title: "Slack",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK] as Route,
            ),
          },
          icon: IconProp.Slack,
        },
        {
          link: {
            title: "Microsoft Teams",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
              ] as Route,
            ),
          },
          icon: IconProp.MicrosoftTeams,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
