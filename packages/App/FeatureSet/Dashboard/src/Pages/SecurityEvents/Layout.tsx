import { getSecurityEventsBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import { getActiveSecurityEventsTab } from "../../Utils/SecurityEventsNavigation";
import PageComponentProps from "../PageComponentProps";
import SecurityEventsNavTabs from "../../Components/SecurityEvents/SecurityEventsNavTabs";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

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
