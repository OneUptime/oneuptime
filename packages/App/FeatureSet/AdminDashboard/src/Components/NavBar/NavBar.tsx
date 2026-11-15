import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import NavBar, {
  MoreMenuItem,
  NavItem,
} from "Common/UI/Components/Navbar/NavBar";
import { BILLING_ENABLED } from "Common/UI/Config";
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

  /*
   * Only top-level pages go in the menu. Sections that have their own side menu
   * (Settings, with all its notification/auth/AI/data sub-pages) are
   * represented by a single entry — the side menu handles the rest, same as the
   * main dashboard.
   */
  const managementCategory: string = "Management";
  const monitoringCategory: string = "Monitoring";
  const toolsCategory: string = "Tools";
  const settingsCategory: string = "Settings";

  const moreMenuItems: MoreMenuItem[] = [
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
    // Licenses are issued and tracked on the hosted oneuptime.com only.
    ...(BILLING_ENABLED
      ? [
          {
            title: "Enterprise Licenses",
            description:
              "Self-hosted enterprise licenses, seat usage and expiry.",
            route: RouteUtil.populateRouteParams(
              RouteMap[PageMap.ENTERPRISE_LICENSES] as Route,
            ),
            activeRoute: RouteMap[PageMap.ENTERPRISE_LICENSES],
            icon: IconProp.Lock,
            iconColor: "violet",
            category: managementCategory,
          } as MoreMenuItem,
        ]
      : []),
    {
      title: "Telemetry Usage",
      description: "How much telemetry each project sends, heaviest first.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.TELEMETRY_USAGE] as Route,
      ),
      activeRoute: RouteMap[PageMap.TELEMETRY_USAGE],
      icon: IconProp.ChartBar,
      iconColor: "indigo",
      category: monitoringCategory,
    },
    {
      title: "OneUptime Health",
      description: "Live status, datastore capacity and queue backlogs.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.HEALTH] as Route),
      activeRoute: RouteMap[PageMap.HEALTH],
      icon: IconProp.Heart,
      iconColor: "rose",
      category: monitoringCategory,
    },
    /*
     * What people told this server about how things went (#6832): the
     * question at the end of a guided setup, Give feedback, Was this clear?
     * and the first-week check-in, with Ask AI's thumbs.
     */
    {
      title: "Feedback",
      description: "What people said was hard, and how each setup went.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.FEEDBACK] as Route),
      activeRoute: RouteMap[PageMap.FEEDBACK],
      icon: IconProp.ChatBubbleLeftRight,
      iconColor: "violet",
      category: monitoringCategory,
    },
    {
      title: "Send Email",
      description: "Send a broadcast email to all users.",
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.MORE_EMAIL] as Route,
      ),
      activeRoute: RouteMap[PageMap.MORE_EMAIL],
      icon: IconProp.Email,
      iconColor: "cyan",
      category: toolsCategory,
    },
    /*
     * What a self-hosted server still needs, and the tests that prove it
     * (the setup checklist). OneUptime Cloud is not set up this way.
     */
    ...(BILLING_ENABLED
      ? []
      : [
          {
            title: "Server Setup",
            description:
              "What this server still needs: email, HTTPS, sign-ups and more.",
            route: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVER_SETUP] as Route,
            ),
            activeRoute: RouteMap[PageMap.SERVER_SETUP],
            icon: IconProp.CheckCircle,
            iconColor: "green",
            category: settingsCategory,
          } as MoreMenuItem,
        ]),
    {
      title: "Settings",
      description:
        "Authentication, notifications, probes, AI, data retention and more.",
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route),
      activeRoute: new Route("/admin/settings"),
      icon: IconProp.Settings,
      iconColor: "slate",
      category: settingsCategory,
    },
  ];

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
      moreMenuItems={moreMenuItems}
      moreMenuFooter={moreMenuFooter}
      moreMenuTitle="Menu"
      moreMenuSearchPlaceholder="Search admin…"
      // The box's name, without the placeholder's "…" (#7486).
      moreMenuSearchLabel="Search admin"
      moreMenuNoResultsText="No results found."
      moreMenuKeyboardHint="↑↓ navigate · ↵ open · esc close"
      /*
       * No Recently visited row here: the menu shows all of its products at
       * once, and the row only drew them twice (NavBarMenuModal).
       */
    />
  );
};

export default DashboardNavbar;
