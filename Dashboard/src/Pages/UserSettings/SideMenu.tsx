import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Navigation from "Common/UI/Utils/Navigation";
import React, { ReactElement } from "react";

const DashboardSideMenu: () => ReactElement = (): ReactElement => {
  let subItemMenuLink: Link | undefined = undefined;

  if (
    Navigation.isOnThisPage(
      RouteMap[PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE]!,
    )
  ) {
    subItemMenuLink = {
      title: "Timeline",
      to: Navigation.getCurrentRoute(),
    };
  }

  const sections: SideMenuSectionProps[] = [
    {
      title: "Profile",
      items: [
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
    {
      title: "Alerts & Notifications",
      items: [
        {
          link: {
            title: "Notification Methods",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_METHODS] as Route,
            ),
          },
          icon: IconProp.Bell,
        },
        {
          link: {
            title: "Notification Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS] as Route,
            ),
          },
          icon: IconProp.Settings,
        },
      ],
    },
    {
      title: "On-Call",
      items: [
        {
          link: {
            title: "Incident On-Call Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES] as Route,
            ),
          },
          icon: IconProp.Alert,
        },
        {
          link: {
            title: "Alert On-Call Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES] as Route,
            ),
          },
          icon: IconProp.ExclaimationCircle,
        },
        {
          link: {
            title: "Episode On-Call Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_EPISODE_ON_CALL_RULES] as Route,
            ),
          },
          icon: IconProp.Squares,
        },
        {
          link: {
            title: "On-Call Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS_ON_CALL_LOGS] as Route,
            ),
          },
          icon: IconProp.Logs,
          subItemIcon: IconProp.Clock,
          subItemLink: subItemMenuLink,
        },
      ],
    },
    {
      title: "Incoming Call Policy",
      items: [
        {
          link: {
            title: "Incoming Phone Numbers",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS
              ] as Route,
            ),
          },
          icon: IconProp.Call,
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
              RouteMap[PageMap.USER_SETTINGS_SLACK_INTEGRATION] as Route,
            ),
          },
          icon: IconProp.Slack,
        },
        {
          link: {
            title: "Microsoft Teams",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION
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
