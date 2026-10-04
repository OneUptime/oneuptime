import { getIncidentsBreadcrumbs } from "../../Utils/Breadcrumbs/IncidentBreadcrumbs";
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

const IncidentsLayout: FunctionComponent<LayoutPageComponentProps> = (
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
      title={"Incidents"}
      sideMenu={
        props.hideSideMenu ? undefined : (
          <SideMenu project={props.currentProject || undefined} />
        )
      }
      breadcrumbLinks={
        createPage.breadcrumbLinks || getIncidentsBreadcrumbs(path)
      }
    >
      <Outlet context={createPage.outletContext} />
    </Page>
  );
};

export default IncidentsLayout;
