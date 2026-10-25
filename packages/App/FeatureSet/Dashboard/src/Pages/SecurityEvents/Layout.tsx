import { getSecurityEventsBreadcrumbs } from "../../Utils/Breadcrumbs";
import { nameEntityInTrail } from "../../Utils/Breadcrumbs/SecurityEventsBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import {
  ENTITY_VALUE_QUERY_PARAM,
  readEntityValueFromQuery,
} from "../../Components/SecurityEvents/EntityRisk/EntityRiskModel";
import PageComponentProps from "../PageComponentProps";
import SecurityEventsSideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

/*
 * Every Security Events page but a case's and a playbook's, which open on
 * their own full-width pages. The side menu is the product's map
 * (SecurityEventsNavigation.ts): a section for each part of Security, and an
 * entry for each of its pages, so a page is only ever its own content - no
 * row of tabs above it. An entity's page (Entity Risk) is named for its
 * entity in the trail, which its query holds.
 */
const SecurityEventsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="Security Events"
      breadcrumbLinks={nameEntityInTrail({
        links: getSecurityEventsBreadcrumbs(path),
        path: path,
        entityValue: readEntityValueFromQuery(
          Navigation.getQueryStringByName(ENTITY_VALUE_QUERY_PARAM),
        ),
      })}
      sideMenu={<SecurityEventsSideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default SecurityEventsLayout;
