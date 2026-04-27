import { getLogsBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import LogsNavTabs, { LogsTabKey } from "../../Components/Logs/LogsNavTabs";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const getActiveLogsTab: (path: string) => LogsTabKey = (
  path: string,
): LogsTabKey => {
  if (path.includes("/logs/settings")) {
    return "settings";
  }
  if (path.includes("/logs/insights")) {
    return "insights";
  }
  if (path.includes("/logs/documentation")) {
    return "setup";
  }
  return "viewer";
};

const LogsLayout: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="Logs"
      breadcrumbLinks={getLogsBreadcrumbs(path)}
      headerRight={<LogsNavTabs active={getActiveLogsTab(path)} />}
    >
      <Outlet />
    </Page>
  );
};

export default LogsLayout;
