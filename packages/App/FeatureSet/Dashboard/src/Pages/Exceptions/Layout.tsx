import { getExceptionsBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getActiveExceptionsTab } from "../../Utils/ExceptionsNavigation";
import PageComponentProps from "../PageComponentProps";
import ExceptionsNavTabs from "../../Components/Exceptions/ExceptionsNavTabs";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const ExceptionsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  if (path.endsWith("exceptions") || path.endsWith("exceptions/*")) {
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[PageMap.EXCEPTIONS]!),
    );

    return <></>;
  }

  return (
    <Page
      title="Exceptions"
      breadcrumbLinks={getExceptionsBreadcrumbs(path)}
      headerRight={<ExceptionsNavTabs active={getActiveExceptionsTab(path)} />}
    >
      <Outlet />
    </Page>
  );
};

export default ExceptionsLayout;
