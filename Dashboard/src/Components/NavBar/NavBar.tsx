import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import NavBar, {
  NavItem,
  MoreMenuItem,
} from "Common/UI/Components/Navbar/NavBar";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  show: boolean;
}

const DashboardNavbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.show) {
    return <></>;
  }

  // Build the main navigation items
  const navItems: NavItem[] = [
    {
      id: "home-nav-bar-item",
      title: "Home",
      icon: IconProp.Home,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
      activeRoute: RouteMap[PageMap.HOME],
    },
    {
      id: "monitors-nav-bar-item",
      title: "Monitors",
      icon: IconProp.AltGlobe,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.MONITORS] as Route),
      activeRoute: RouteMap[PageMap.MONITORS],
    },
    {
      id: "alerts-nav-bar-item",
      title: "Alerts",
      icon: IconProp.ExclaimationCircle,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.ALERTS] as Route),
      activeRoute: RouteMap[PageMap.ALERTS],
    },
    {
      id: "incidents-nav-bar-item",
      title: "Incidents",
      icon: IconProp.Alert,
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.INCIDENTS],
    },
    {
      id: "telemetry-nav-bar-item",
      title: "Telemetry and APM",
      icon: IconProp.Cube,
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.TELEMETRY] as Route,
      ),
      activeRoute: RouteMap[PageMap.TELEMETRY],
    },
    {
      id: "status-pages-nav-bar-item",
      title: "Status Pages",
      icon: IconProp.CheckCircle,
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGES] as Route,
      ),
      activeRoute: RouteMap[PageMap.STATUS_PAGES],
    },
    {
      id: "dashboards-nav-bar-item",
      title: "Dashboards",
      icon: IconProp.Window,
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DASHBOARDS] as Route,
      ),
      activeRoute: RouteMap[PageMap.DASHBOARDS],
    },
  ];

  // Build the "More" menu items
  const moreMenuItems: MoreMenuItem[] = [
    {
      title: "AI Agent",
      description: "Manage tasks assigned to AI agents for automated operations.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.AI_AGENT_TASKS] as Route,
      ),
      icon: IconProp.Bolt,
    },
    {
      title: "Service Catalog",
      description: "Manage your services and their dependencies.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SERVICE_CATALOG] as Route,
      ),
      icon: IconProp.SquareStack,
    },
    {
      title: "Code Repositories",
      description: "Connect and manage your GitHub and GitLab repositories.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.CODE_REPOSITORY] as Route,
      ),
      icon: IconProp.Code,
    },
    {
      title: "Scheduled Maintenance",
      description: "Manage your scheduled maintenance events.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
      ),
      icon: IconProp.Clock,
    },
    {
      title: "On-Call Duty",
      description: "Manage your on-call schedules, escalations and more.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY] as Route,
      ),
      icon: IconProp.Call,
    },
    {
      title: "Workflows",
      description: "Integrate OneUptime with the rest of your ecosystem.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.WORKFLOWS] as Route,
      ),
      icon: IconProp.Workflow,
    },
    {
      title: "Project Settings",
      description: "Review or manage settings related to this project here.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route),
      icon: IconProp.Settings,
    },
  ];

  // Define the right element (User Settings)
  const rightElement: NavItem = {
    id: "user-settings-nav-bar-item",
    title: "User Settings",
    icon: IconProp.User,
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS] as Route,
    ),
    activeRoute: RouteMap[PageMap.USER_SETTINGS],
  };

  // Define the more menu footer
  const moreMenuFooter: any = {
    title: "Report a bug or request a feature.",
    description:
      "We embrace open-source! Please report any issue you find and make feature requests on GitHub.",
    link: URL.fromString(
      "https://github.com/OneUptime/oneuptime/issues/new/choose",
    ),
  };

  return (
    <NavBar
      items={navItems}
      rightElement={rightElement}
      moreMenuItems={moreMenuItems}
      moreMenuFooter={moreMenuFooter}
    />
  );
};

export default DashboardNavbar;
