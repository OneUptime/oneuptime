import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import NavBar, { NavItem } from "Common/UI/Components/Navbar/NavBar";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const DashboardNavbar: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  const navItems: NavItem[] = [
    {
      id: "users-nav-bar-item",
      title: t("navbar.users"),
      icon: IconProp.User,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
    },
    {
      id: "projects-nav-bar-item",
      title: t("navbar.projects"),
      icon: IconProp.Folder,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.PROJECTS] as Route),
    },
    {
      id: "more-nav-bar-item",
      title: t("navbar.more"),
      icon: IconProp.More,
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.MORE_EMAIL] as Route,
      ),
    },
    {
      id: "settings-nav-bar-item",
      title: t("navbar.settings"),
      icon: IconProp.Settings,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route),
    },
  ];

  return <NavBar items={navItems} />;
};

export default DashboardNavbar;
