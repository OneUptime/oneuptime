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

const DashboardSideMenu: () => JSX.Element = (): ReactElement => {
  let subItemMenuLink: Link | undefined = undefined;

  if (
    Navigation.isOnThisPage(
      RouteMap[PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE]!,
    )
  ) {
    subItemMenuLink = {
      title: "Timeline",
      to: Navigation.getCurrentRoute(),
    };
  }

  const sections: SideMenuSectionProps[] = [
    {
      title: "Policies",
      items: [
        {
          link: {
            title: "On-Call Policies",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route,
            ),
          },
          icon: IconProp.Call,
        },
      ],
    },
    {
      title: "Schedules",
      items: [
        {
          link: {
            title: "On-Call Schedules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES] as Route,
            ),
          },
          icon: IconProp.Calendar,
        },
      ],
    },
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "User Overrides",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Execution Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_EXECUTION_LOGS] as Route,
            ),
          },
          icon: IconProp.Logs,
          subItemIcon: IconProp.Clock,
          subItemLink: subItemMenuLink,
        },
      ],
    },
    {
      title: "Reports",
      items: [
        {
          link: {
            title: "User On Call Time",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALLDUTY_USER_TIME_LOGS] as Route,
            ),
          },
          icon: IconProp.Clock,
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
              RouteMap[
                PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK
              ] as Route,
            ),
          },
          icon: IconProp.Slack,
        },
        {
          link: {
            title: "Microsoft Teams",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
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
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_SETTINGS_CUSTOM_FIELDS] as Route,
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
