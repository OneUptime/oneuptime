import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Incident from "Common/Models/DatabaseModels/Incident";
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
            title: "All Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Active Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.UNRESOLVED_INCIDENTS] as Route,
            ),
          },
          icon: IconProp.Alert,
          badgeType: BadgeType.DANGER,
          modelType: Incident,
          countQuery: {
            projectId: props.project?._id,
            currentIncidentState: {
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
              RouteMap[PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK] as Route,
            ),
          },
          icon: IconProp.Slack,
        },
        {
          link: {
            title: "Microsoft Teams",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
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
