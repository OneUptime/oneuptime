import { getTelemetryBreadcrumbs } from "../../../../Utils/Breadcrumbs";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import PageComponentProps from "../../../PageComponentProps";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import PageMap from "../../../../Utils/PageMap";

const MetricsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  if (path.endsWith("exceptions")) {
    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.TELEMETRY_EXCEPTIONS_UNRESOLVED]!,
      ),
    );

    return <></>;
  }

  return (
    <Page
      title="Exception Explorer"
      breadcrumbLinks={getTelemetryBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default MetricsLayout;
