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
        /*
         * Readiness sits directly under Policies rather than in "Advanced"
         * because the whole point of the page is that an unreachable responder
         * must be impossible to miss. The compliance report it replaces was
         * buried two products away, under Teams, and off by default — which is
         * precisely why nobody found out they could not be paged.
         */
        {
          link: {
            title: "Readiness",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_READINESS] as Route,
            ),
          },
          icon: IconProp.ShieldCheck,
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
        /*
         * Next to the schedules it exports: the project-wide feed and the
         * pointers to the personal and per-schedule links live here.
         */
        {
          link: {
            title: "Calendar Feeds",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_CALENDAR_FEEDS] as Route,
            ),
          },
          icon: IconProp.Link,
        },
      ],
    },
    {
      title: "Incoming Calls",
      items: [
        {
          link: {
            title: "Incoming Call Policies",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES] as Route,
            ),
          },
          icon: IconProp.IncomingCall,
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
      title: "Workspace",
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
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.Team,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
