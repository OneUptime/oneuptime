import { getAlertsBreadcrumbs } from "../../Utils/Breadcrumbs/AlertBreadcrumbs";
import {
  CreatePageBreadcrumbsSlot,
  useCreatePageBreadcrumbsSlot,
} from "../../Components/CreateFromRecord/CreatePageBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const AlertsLayout: FunctionComponent<LayoutPageComponentProps> = (
  props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  /*
   * The create page, opened from a record's tab, draws its trail back
   * through that tab here (Components/CreateFromRecord).
   */
  const createPage: CreatePageBreadcrumbsSlot = useCreatePageBreadcrumbsSlot();

  return (
    <Page
      title={"Alerts"}
      sideMenu={
        props.hideSideMenu ? undefined : (
          <SideMenu project={props.currentProject || undefined} />
        )
      }
      breadcrumbLinks={createPage.breadcrumbLinks || getAlertsBreadcrumbs(path)}
    >
      <Outlet context={createPage.outletContext} />
    </Page>
  );
};

export default AlertsLayout;
