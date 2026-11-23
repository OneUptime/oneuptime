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
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { Outlet } from "react-router-dom";
import {
  TelemetryIngestionBudgetExplorerBanner,
  fetchProjectTelemetryIngestionBudgetStatus,
} from "../../Components/TelemetryIngestionBudget/ProjectTelemetryIngestionBudget";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { TelemetryIngestionBudgetStatus } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import SecurityEventsReadBudgetBanners, {
  shareOneBudgetsRead,
} from "../../Components/SecurityEvents/RefusedTelemetry/SecurityEventsReadBudgetBanners";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

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

  /*
   * One read of the project's budgets for every banner over the page: its
   * own budget's and those of the logs and traces it reads (#10431).
   */
  const readBudgets: () => Promise<TelemetryIngestionBudgetStatus> =
    useMemo((): (() => Promise<TelemetryIngestionBudgetStatus>) => {
      return shareOneBudgetsRead(fetchProjectTelemetryIngestionBudgetStatus);
    }, []);

  return (
    <Page
      title="Security Events"
      titleRight={<ProductAboutButton product={ProductKey.SecurityEvents} />}
      breadcrumbLinks={nameEntityInTrail({
        links: getSecurityEventsBreadcrumbs(path),
        path: path,
        entityValue: readEntityValueFromQuery(
          Navigation.getQueryStringByName(ENTITY_VALUE_QUERY_PARAM),
        ),
      })}
      sideMenu={<SecurityEventsSideMenu />}
    >
      {/* Only while today's Security Events budget is past its warning or used up. */}
      <TelemetryIngestionBudgetExplorerBanner
        signal={ProductType.SecurityEvents}
        fetchStatus={readBudgets}
      />
      {/*
       * And the logs' while Your logs is on, the traces' while the Traces
       * source is (#10431): a used-up budget there refuses what Security
       * Events reads.
       */}
      <SecurityEventsReadBudgetBanners fetchStatus={readBudgets} />
      <Outlet />
    </Page>
  );
};

export default SecurityEventsLayout;
