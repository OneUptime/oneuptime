import { getRunbooksBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import RunbookSideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const RunbooksLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Runbooks"}
      breadcrumbLinks={getRunbooksBreadcrumbs(path)}
      sideMenu={<RunbookSideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default RunbooksLayout;
