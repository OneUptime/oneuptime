import { getExceptionsBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import ExceptionsNavTabs, {
  ExceptionsTabKey,
} from "../../Components/Exceptions/ExceptionsNavTabs";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const getActiveExceptionsTab = (path: string): ExceptionsTabKey => {
  if (path.includes("/exceptions/unresolved")) {
    return "unresolved";
  }
  if (path.includes("/exceptions/resolved")) {
    return "resolved";
  }
  if (path.includes("/exceptions/archived")) {
    return "archived";
  }
  if (path.includes("/exceptions/documentation")) {
    return "setup";
  }
  return "overview";
};

const ExceptionsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  if (path.endsWith("exceptions") || path.endsWith("exceptions/*")) {
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[PageMap.EXCEPTIONS_OVERVIEW]!),
    );

    return <></>;
  }

  return (
    <Page
      title="Exceptions"
      breadcrumbLinks={getExceptionsBreadcrumbs(path)}
      headerRight={
        <ExceptionsNavTabs active={getActiveExceptionsTab(path)} />
      }
    >
      <Outlet />
    </Page>
  );
};

export default ExceptionsLayout;
