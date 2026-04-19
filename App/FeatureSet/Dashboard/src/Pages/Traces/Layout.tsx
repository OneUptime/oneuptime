import { getTracesBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import TracesNavTabs, {
  TracesTabKey,
} from "../../Components/Traces/TracesNavTabs";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const getActiveTracesTab: (path: string) => TracesTabKey = (
  path: string,
): TracesTabKey => {
  if (path.includes("/traces/settings")) {
    return "settings";
  }
  if (path.includes("/traces/insights")) {
    return "insights";
  }
  if (path.includes("/traces/documentation")) {
    return "setup";
  }
  return "viewer";
};

const TracesLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="Traces"
      breadcrumbLinks={getTracesBreadcrumbs(path)}
      headerRight={<TracesNavTabs active={getActiveTracesTab(path)} />}
    >
      <Outlet />
    </Page>
  );
};

export default TracesLayout;
