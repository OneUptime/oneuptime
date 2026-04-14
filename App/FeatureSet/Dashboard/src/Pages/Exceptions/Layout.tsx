import { getExceptionsBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
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
      RouteUtil.populateRouteParams(RouteMap[PageMap.EXCEPTIONS_OVERVIEW]!),
    );

    return <></>;
  }

  return (
    <Page
      title="Exceptions"
      breadcrumbLinks={getExceptionsBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default ExceptionsLayout;
