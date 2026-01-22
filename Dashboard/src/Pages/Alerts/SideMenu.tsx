import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
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
      title: "Alerts",
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
      title: "Episodes",
      items: [
        {
          link: {
            title: "All Episodes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODES] as Route,
            ),
          },
          icon: IconProp.SquareStack,
        },
        {
          link: {
            title: "Active Episodes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.UNRESOLVED_ALERT_EPISODES] as Route,
            ),
          },
          icon: IconProp.ExclaimationCircle,
          badgeType: BadgeType.WARNING,
          modelType: AlertEpisode,
          countQuery: {
            projectId: props.project?._id,
            resolvedAt: null,
          } as any,
        },
        {
          link: {
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERT_EPISODE_DOCS] as Route,
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
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Alert State",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_STATE] as Route,
            ),
          },
          icon: IconProp.ArrowCircleRight,
        },
        {
          link: {
            title: "Alert Severity",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_SEVERITY] as Route,
            ),
          },
          icon: IconProp.Alert,
        },
        {
          link: {
            title: "Note Templates",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES] as Route,
            ),
          },
          icon: IconProp.Pencil,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
        {
          link: {
            title: "Grouping Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ALERTS_SETTINGS_GROUPING_RULES] as Route,
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
