import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
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
      title: "Episodes",
      items: [
        {
          link: {
            title: "All Episodes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_EPISODES] as Route,
            ),
          },
          icon: IconProp.SquareStack3D,
        },
        {
          link: {
            title: "Active Episodes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.UNRESOLVED_INCIDENT_EPISODES] as Route,
            ),
          },
          icon: IconProp.Alert,
          badgeType: BadgeType.DANGER,
          modelType: IncidentEpisode,
          countQuery: {
            projectId: props.project?._id,
            resolvedAt: null,
          } as any,
        },
        {
          link: {
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENT_EPISODE_DOCS] as Route,
            ),
          },
          icon: IconProp.Book,
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
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Incident State",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_STATE] as Route,
            ),
          },
          icon: IconProp.ArrowCircleRight,
        },
        {
          link: {
            title: "Incident Severity",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_SEVERITY] as Route,
            ),
          },
          icon: IconProp.Alert,
        },
        {
          link: {
            title: "Incident Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.Template,
        },
        {
          link: {
            title: "Note Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.Pencil,
        },
        {
          link: {
            title: "Postmortem Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES
              ] as Route,
            ),
          },
          icon: IconProp.Book,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
        {
          link: {
            title: "Grouping Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_GROUPING_RULES] as Route,
            ),
          },
          icon: IconProp.Filter,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
