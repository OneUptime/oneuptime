import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import NavBar, {
  MoreMenuItem,
  NavItem,
} from "Common/UI/Components/Navbar/NavBar";
import React, { FunctionComponent, ReactElement } from "react";

const DashboardNavbar: FunctionComponent = (): ReactElement => {
  /*
   * Primary nav item. The shared NavBar renders this as the "Home" breadcrumb
   * root, then a "/ <active section>" dropdown built from moreMenuItems.
   */
  const navItems: NavItem[] = [
    {
      id: "home-nav-bar-item",
      title: "Home",
      icon: IconProp.Home,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
      activeRoute: RouteMap[PageMap.HOME],
    },
  ];

  const managementCategory: string = "Management";
  const monitoringCategory: string = "Monitoring";
  const notificationsCategory: string = "Notifications";
  const authenticationCategory: string = "Authentication";
  const aiCategory: string = "AI";
  const dataCategory: string = "Data";
  const toolsCategory: string = "Tools";

  const moreMenuItems: MoreMenuItem[] = [
    // Management
    {
      title: "Users",
      description: "Manage all users across the instance.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
      activeRoute: RouteMap[PageMap.USERS],
      icon: IconProp.User,
      iconColor: "blue",
      category: managementCategory,
    },
    {
      title: "Projects",
      description: "View and manage every project.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECTS] as Route),
      activeRoute: RouteMap[PageMap.PROJECTS],
      icon: IconProp.Folder,
      iconColor: "emerald",
      category: managementCategory,
    },
    // Monitoring
    {
      title: "Instance Health",
      description: "Live status, datastore capacity and queue backlogs.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.HEALTH] as Route),
      activeRoute: RouteMap[PageMap.HEALTH],
      icon: IconProp.Heartbeat,
      iconColor: "rose",
      category: monitoringCategory,
    },
    {
      title: "Global Probes",
      description: "Manage global monitoring probes.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_PROBES] as Route,
      ),
      activeRoute: RouteMap[PageMap.SETTINGS_PROBES],
      icon: IconProp.Signal,
      iconColor: "indigo",
      category: monitoringCategory,
    },
    // Notifications
    {
      title: "Email",
      description: "Configure SMTP and email delivery.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_SMTP] as Route,
      ),
      activeRoute: RouteMap[PageMap.SETTINGS_SMTP],
      icon: IconProp.Email,
      iconColor: "blue",
      category: notificationsCategory,
    },
    {
      title: "Call & SMS",
      description: "Configure call and SMS notifications.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_CALL_AND_SMS] as Route,
      ),
      activeRoute: RouteMap[PageMap.SETTINGS_CALL_AND_SMS],
      icon: IconProp.Call,
      iconColor: "stone",
      category: notificationsCategory,
    },
    {
      title: "WhatsApp",
      description: "Configure WhatsApp notifications.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_WHATSAPP] as Route,
      ),
      activeRoute: RouteMap[PageMap.SETTINGS_WHATSAPP],
      icon: IconProp.WhatsApp,
      iconColor: "emerald",
      category: notificationsCategory,
    },
    {
      title: "Telegram",
      description: "Configure Telegram notifications.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_TELEGRAM] as Route,
      ),
      activeRoute: RouteMap[PageMap.SETTINGS_TELEGRAM],
      icon: IconProp.Telegram,
      iconColor: "sky",
      category: notificationsCategory,
    },
    // Authentication
    {
      title: "Authentication",
      description: "Single sign-on and sign-in configuration.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_AUTHENTICATION] as Route,
      ),
      activeRoute: RouteMap[PageMap.SETTINGS_AUTHENTICATION],
      icon: IconProp.Lock,
      iconColor: "amber",
      category: authenticationCategory,
    },
    {
      title: "API Keys",
      description: "Manage global API keys.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_API_KEY] as Route,
      ),
      activeRoute: RouteMap[PageMap.SETTINGS_API_KEY],
      icon: IconProp.Code,
      iconColor: "gray",
      category: authenticationCategory,
    },
    // AI
    {
      title: "AI Agents",
      description: "Configure global AI agents.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_AI_AGENTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.SETTINGS_AI_AGENTS],
      icon: IconProp.Automation,
      iconColor: "violet",
      category: aiCategory,
    },
    {
      title: "LLM Providers",
      description: "Configure large language model providers.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_LLM_PROVIDERS] as Route,
      ),
      activeRoute: RouteMap[PageMap.SETTINGS_LLM_PROVIDERS],
      icon: IconProp.Brain,
      iconColor: "purple",
      category: aiCategory,
    },
    // Data
    {
      title: "Data Retention",
      description: "Set telemetry and log retention windows.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_DATA_RETENTION] as Route,
      ),
      activeRoute: RouteMap[PageMap.SETTINGS_DATA_RETENTION],
      icon: IconProp.Database,
      iconColor: "teal",
      category: dataCategory,
    },
    // Tools
    {
      title: "Send Email",
      description: "Send a broadcast email to all users.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SEND_EMAIL] as Route,
      ),
      activeRoute: RouteMap[PageMap.SEND_EMAIL],
      icon: IconProp.Email,
      iconColor: "cyan",
      category: toolsCategory,
    },
  ];

  // Right-aligned shortcut to the settings hub (highlights across all settings pages).
  const rightElement: NavItem = {
    id: "settings-nav-bar-item",
    title: "Settings",
    icon: IconProp.Settings,
    route: RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route),
    activeRoute: new Route("/admin/settings"),
  };

  const moreMenuFooter: {
    title: string;
    description: string;
    link: URL;
  } = {
    title: "Need help?",
    description: "Report an issue or request a feature on GitHub.",
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
