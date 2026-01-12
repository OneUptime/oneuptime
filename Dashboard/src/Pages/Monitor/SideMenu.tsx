import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Monitor from "Common/Models/DatabaseModels/Monitor";
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
            title: "All Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Inoperational",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_INOPERATIONAL] as Route,
            ),
          },
          icon: IconProp.Alert,
          badgeType: BadgeType.DANGER,
          modelType: Monitor,
          countQuery: {
            projectId: props.project?._id,
            currentMonitorStatus: {
              isOperationalState: false,
            },
          },
        },
      ],
    },
  ];

  // Conditionally add Monitor Groups section
  if (props.project?.isFeatureFlagMonitorGroupsEnabled) {
    sections.push({
      title: "Monitor Groups",
      items: [
        {
          link: {
            title: "All Groups",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_GROUPS] as Route,
            ),
          },
          icon: IconProp.Squares,
        },
      ],
    });
  }

  // Add remaining sections
  sections.push(
    {
      title: "Not Being Monitored",
      items: [
        {
          link: {
            title: "Disabled Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_DISABLED] as Route,
            ),
          },
          icon: IconProp.Error,
          badgeType: BadgeType.DANGER,
          modelType: Monitor,
          countQuery: {
            projectId: props.project?._id,
            disableActiveMonitoring: true,
          },
        },
        {
          link: {
            title: "Probe Disconnected",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_PROBE_DISCONNECTED] as Route,
            ),
          },
          icon: IconProp.NoSignal,
          badgeType: BadgeType.DANGER,
          modelType: Monitor,
          countQuery: {
            projectId: props.project?._id,
            isAllProbesDisconnectedFromThisMonitor: true,
          },
        },
        {
          link: {
            title: "Probe Disabled",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_PROBE_DISABLED] as Route,
            ),
          },
          icon: IconProp.EyeSlash,
          badgeType: BadgeType.DANGER,
          modelType: Monitor,
          countQuery: {
            projectId: props.project?._id,
            isNoProbeEnabledOnThisMonitor: true,
          },
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
              RouteMap[PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK] as Route,
            ),
          },
          icon: IconProp.Slack,
        },
        {
          link: {
            title: "Microsoft Teams",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
              ] as Route,
            ),
          },
          icon: IconProp.MicrosoftTeams,
        },
      ],
    },
    {
      title: "Settings",
      items: [
        {
          link: {
            title: "Monitor Status",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS] as Route,
            ),
          },
          icon: IconProp.AltGlobe,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
        {
          link: {
            title: "Secrets",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_SECRETS] as Route,
            ),
          },
          icon: IconProp.Lock,
        },
      ],
    },
  );

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
