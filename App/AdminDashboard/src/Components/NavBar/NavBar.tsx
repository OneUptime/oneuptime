import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import NavBar, { NavItem } from "Common/UI/Components/Navbar/NavBar";
import React, { FunctionComponent, ReactElement } from "react";

const DashboardNavbar: FunctionComponent = (): ReactElement => {
  // Build the navigation items
  const navItems: NavItem[] = [
    {
      id: "users-nav-bar-item",
      title: "Users",
      icon: IconProp.User,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
    },
    {
      id: "projects-nav-bar-item",
      title: "Projects",
      icon: IconProp.Folder,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECTS] as Route),
    },
    {
      id: "settings-nav-bar-item",
      title: "Settings",
      icon: IconProp.Settings,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route),
    },
  ];

  return <NavBar items={navItems} />;
};

export default DashboardNavbar;
