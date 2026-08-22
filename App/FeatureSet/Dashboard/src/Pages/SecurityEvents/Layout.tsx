import { getSecurityEventsBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import SecurityEventsNavTabs, {
  SecurityEventsTabKey,
} from "../../Components/SecurityEvents/SecurityEventsNavTabs";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const getActiveSecurityEventsTab: (path: string) => SecurityEventsTabKey = (
  path: string,
): SecurityEventsTabKey => {
  if (path.includes("/security-events/correlate")) {
    return "correlate";
  }
  if (path.includes("/security-events/detection-rules")) {
    return "detection-rules";
  }
  if (path.includes("/security-events/documentation")) {
    return "setup";
  }
  return "events";
};

const SecurityEventsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="Security Events"
      breadcrumbLinks={getSecurityEventsBreadcrumbs(path)}
      headerRight={
        <SecurityEventsNavTabs active={getActiveSecurityEventsTab(path)} />
      }
    >
      <Outlet />
    </Page>
  );
};

export default SecurityEventsLayout;
