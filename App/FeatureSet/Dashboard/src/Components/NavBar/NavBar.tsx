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
import { useTranslation } from "react-i18next";

export interface ComponentProps {
  show: boolean;
}

const DashboardNavbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  if (!props.show) {
    return <></>;
  }

  const essentialsCategory: string = t("navbar.categories.essentials");
  const observabilityCategory: string = t("navbar.categories.observability");
  const analyticsAutomationCategory: string = t(
    "navbar.categories.analyticsAutomation",
  );
  const settingsCategory: string = t("navbar.categories.settings");

  // Build the main navigation items - only Home now
  const navItems: NavItem[] = [
    {
      id: "home-nav-bar-item",
      title: t("navbar.home"),
      icon: IconProp.Home,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
      activeRoute: RouteMap[PageMap.HOME],
    },
  ];

  // Build the products menu items - all products organized by category
  const moreMenuItems: MoreMenuItem[] = [
    // Essentials
    {
      title: t("navbar.items.monitorsTitle"),
      description: t("navbar.items.monitorsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.MONITORS] as Route),
      activeRoute: RouteMap[PageMap.MONITORS],
      icon: IconProp.AltGlobe,
      iconColor: "blue",
      category: essentialsCategory,
    },
    {
      title: t("navbar.items.statusPagesTitle"),
      description: t("navbar.items.statusPagesDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGES] as Route,
      ),
      activeRoute: RouteMap[PageMap.STATUS_PAGES],
      icon: IconProp.CheckCircle,
      iconColor: "emerald",
      category: essentialsCategory,
    },
    {
      title: t("navbar.items.incidentsTitle"),
      description: t("navbar.items.incidentsDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.INCIDENTS],
      icon: IconProp.Alert,
      iconColor: "rose",
      category: essentialsCategory,
    },
    {
      title: t("navbar.items.alertsTitle"),
      description: t("navbar.items.alertsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.ALERTS] as Route),
      activeRoute: RouteMap[PageMap.ALERTS],
      icon: IconProp.ExclaimationCircle,
      iconColor: "amber",
      category: essentialsCategory,
    },
    {
      title: t("navbar.items.onCallDutyTitle"),
      description: t("navbar.items.onCallDutyDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY] as Route,
      ),
      activeRoute: RouteMap[PageMap.ON_CALL_DUTY],
      icon: IconProp.Call,
      iconColor: "stone",
      category: essentialsCategory,
    },
    {
      title: t("navbar.items.scheduledMaintenanceTitle"),
      description: t("navbar.items.scheduledMaintenanceDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS],
      icon: IconProp.Clock,
      iconColor: "cyan",
      category: essentialsCategory,
    },
    // Observability
    {
      title: t("navbar.items.logsTitle"),
      description: t("navbar.items.logsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route),
      activeRoute: RouteMap[PageMap.LOGS],
      icon: IconProp.Logs,
      iconColor: "amber",
      category: observabilityCategory,
    },
    {
      title: t("navbar.items.metricsTitle"),
      description: t("navbar.items.metricsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.METRICS] as Route),
      activeRoute: RouteMap[PageMap.METRICS],
      icon: IconProp.Heartbeat,
      iconColor: "purple",
      category: observabilityCategory,
    },
    {
      title: t("navbar.items.tracesTitle"),
      description: t("navbar.items.tracesDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.TRACES] as Route),
      activeRoute: RouteMap[PageMap.TRACES],
      icon: IconProp.Waterfall,
      iconColor: "yellow",
      category: observabilityCategory,
    },
    {
      title: t("navbar.items.performanceProfilesTitle"),
      description: t("navbar.items.performanceProfilesDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.PROFILES] as Route),
      activeRoute: RouteMap[PageMap.PROFILES],
      icon: IconProp.Fire,
      iconColor: "red",
      category: observabilityCategory,
    },
    {
      title: t("navbar.items.exceptionsTitle"),
      description: t("navbar.items.exceptionsDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS] as Route,
      ),
      activeRoute: RouteMap[PageMap.EXCEPTIONS],
      icon: IconProp.Bug,
      iconColor: "orange",
      category: observabilityCategory,
    },
    {
      title: t("navbar.items.servicesTitle"),
      description: t("navbar.items.servicesDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SERVICES] as Route),
      activeRoute: RouteMap[PageMap.SERVICES],
      icon: IconProp.SquareStack,
      iconColor: "indigo",
      category: observabilityCategory,
    },
    {
      title: t("navbar.items.kubernetesTitle"),
      description: t("navbar.items.kubernetesDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.KUBERNETES_CLUSTERS] as Route,
      ),
      activeRoute: RouteMap[PageMap.KUBERNETES_CLUSTERS],
      icon: IconProp.Kubernetes,
      iconColor: "blue",
      category: observabilityCategory,
    },
    {
      title: t("navbar.items.dockerTitle"),
      description: t("navbar.items.dockerDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DOCKER_HOSTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.DOCKER_HOSTS],
      icon: IconProp.Docker,
      iconColor: "blue",
      category: observabilityCategory,
    },
    // Automation & Analytics
    {
      title: t("navbar.items.dashboardsTitle"),
      description: t("navbar.items.dashboardsDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DASHBOARDS] as Route,
      ),
      activeRoute: RouteMap[PageMap.DASHBOARDS],
      icon: IconProp.ChartPie,
      iconColor: "indigo",
      category: analyticsAutomationCategory,
    },
    {
      title: t("navbar.items.workflowsTitle"),
      description: t("navbar.items.workflowsDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.WORKFLOWS] as Route,
      ),
      activeRoute: RouteMap[PageMap.WORKFLOWS],
      icon: IconProp.FlowDiagram,
      iconColor: "sky",
      category: analyticsAutomationCategory,
    },
    {
      title: t("navbar.items.aiAgentTitle"),
      description: t("navbar.items.aiAgentDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.AI_AGENT_TASKS] as Route,
      ),
      activeRoute: RouteMap[PageMap.AI_AGENT_TASKS],
      icon: IconProp.Brain,
      iconColor: "violet",
      category: analyticsAutomationCategory,
    },
    {
      title: t("navbar.items.codeRepositoriesTitle"),
      description: t("navbar.items.codeRepositoriesDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.CODE_REPOSITORY] as Route,
      ),
      activeRoute: RouteMap[PageMap.CODE_REPOSITORY],
      icon: IconProp.Code,
      iconColor: "gray",
      category: analyticsAutomationCategory,
    },
    // Settings
    {
      title: t("navbar.items.projectSettingsTitle"),
      description: t("navbar.items.projectSettingsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route),
      activeRoute: RouteMap[PageMap.SETTINGS],
      icon: IconProp.Settings,
      iconColor: "slate",
      category: settingsCategory,
    },
  ];

  // Define the right element (User Settings)
  const rightElement: NavItem = {
    id: "user-settings-nav-bar-item",
    title: t("navbar.userSettings"),
    icon: IconProp.User,
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS] as Route,
    ),
    activeRoute: RouteMap[PageMap.USER_SETTINGS],
  };

  // Define the more menu footer
  const moreMenuFooter: any = {
    title: t("navbar.moreFooter.title"),
    description: t("navbar.moreFooter.description"),
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
