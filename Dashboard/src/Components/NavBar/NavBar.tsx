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

  // Build the main navigation items - only Home now
  const navItems: NavItem[] = [
    {
      id: "home-nav-bar-item",
      title: "Home",
      icon: IconProp.Home,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
      activeRoute: RouteMap[PageMap.HOME],
    },
  ];

  // Build the products menu items - all products organized by category
  const moreMenuItems: MoreMenuItem[] = [
    // Essentials
    {
      title: "Monitors",
      description: "Monitor any resource.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.MONITORS] as Route),
      activeRoute: RouteMap[PageMap.MONITORS],
      icon: IconProp.AltGlobe,
      iconColor: "blue",
      category: "Essentials",
    },
    {
      title: "Status Pages",
      description: "Real-time status updates.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGES] as Route,
      ),
      activeRoute: RouteMap[PageMap.STATUS_PAGES],
      icon: IconProp.CheckCircle,
      iconColor: "emerald",
      category: "Essentials",
    },
    {
      title: "Incidents",
      description: "Detect and resolve fast.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.INCIDENTS],
      icon: IconProp.Alert,
      iconColor: "rose",
      category: "Essentials",
    },
    {
      title: "Alerts",
      description: "Notification management.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.ALERTS] as Route),
      activeRoute: RouteMap[PageMap.ALERTS],
      icon: IconProp.ExclaimationCircle,
      iconColor: "amber",
      category: "Essentials",
    },
    {
      title: "On-Call Duty",
      description: "Smart routing & escalations.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY] as Route,
      ),
      activeRoute: RouteMap[PageMap.ON_CALL_DUTY],
      icon: IconProp.Call,
      iconColor: "stone",
      category: "Essentials",
    },
    {
      title: "Scheduled Maintenance",
      description: "Plan and manage maintenance.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS],
      icon: IconProp.Clock,
      iconColor: "cyan",
      category: "Essentials",
    },
    // Observability
    {
      title: "Logs",
      description: "Search and analyze logs.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route),
      activeRoute: RouteMap[PageMap.LOGS],
      icon: IconProp.Logs,
      iconColor: "amber",
      category: "Observability",
    },
    {
      title: "Metrics",
      description: "Monitor system metrics.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.METRICS] as Route),
      activeRoute: RouteMap[PageMap.METRICS],
      icon: IconProp.Heartbeat,
      iconColor: "purple",
      category: "Observability",
    },
    {
      title: "Traces",
      description: "Distributed tracing analysis.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.TRACES] as Route),
      activeRoute: RouteMap[PageMap.TRACES],
      icon: IconProp.Waterfall,
      iconColor: "yellow",
      category: "Observability",
    },
    {
      title: "Exceptions",
      description: "Catch and fix bugs early.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS] as Route,
      ),
      activeRoute: RouteMap[PageMap.EXCEPTIONS],
      icon: IconProp.Bug,
      iconColor: "orange",
      category: "Observability",
    },
    {
      title: "Services",
      description: "Manage service dependencies.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SERVICES] as Route),
      activeRoute: RouteMap[PageMap.SERVICES],
      icon: IconProp.SquareStack,
      iconColor: "indigo",
      category: "Observability",
    },
    // Automation & Analytics
    {
      title: "Dashboards",
      description: "Visualize all your data.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DASHBOARDS] as Route,
      ),
      activeRoute: RouteMap[PageMap.DASHBOARDS],
      icon: IconProp.ChartPie,
      iconColor: "indigo",
      category: "Analytics & Automation",
    },
    {
      title: "Workflows",
      description: "No-code automation builder.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.WORKFLOWS] as Route,
      ),
      activeRoute: RouteMap[PageMap.WORKFLOWS],
      icon: IconProp.FlowDiagram,
      iconColor: "sky",
      category: "Analytics & Automation",
    },
    {
      title: "AI Agent",
      description: "AI-powered issue resolution.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.AI_AGENT_TASKS] as Route,
      ),
      activeRoute: RouteMap[PageMap.AI_AGENT_TASKS],
      icon: IconProp.Brain,
      iconColor: "violet",
      category: "Analytics & Automation",
    },
    {
      title: "Code Repositories",
      description: "GitHub and GitLab integrations.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.CODE_REPOSITORY] as Route,
      ),
      activeRoute: RouteMap[PageMap.CODE_REPOSITORY],
      icon: IconProp.Code,
      iconColor: "gray",
      category: "Analytics & Automation",
    },
    // Settings
    {
      title: "Project Settings",
      description: "Configure your project.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route),
      activeRoute: RouteMap[PageMap.SETTINGS],
      icon: IconProp.Settings,
      iconColor: "slate",
      category: "Settings",
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
