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
    />
  );
};

export default DashboardNavbar;
