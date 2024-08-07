import { getIncidentsBreadcrumbs } from "../../Utils/Breadcrumbs/IncidentBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/src/Components/Page/Page";
import Navigation from "Common/UI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const IncidentsLayout: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Incidents"}
      sideMenu={<SideMenu project={props.currentProject || undefined} />}
      breadcrumbLinks={getIncidentsBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default IncidentsLayout;
