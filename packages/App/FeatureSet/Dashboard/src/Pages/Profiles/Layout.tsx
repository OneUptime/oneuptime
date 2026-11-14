import { getProfilesBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import PageComponentProps from "../PageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import { TelemetryIngestionBudgetExplorerBanner } from "../../Components/TelemetryIngestionBudget/ProjectTelemetryIngestionBudget";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

/*
 * One product, one name (#6817: no longer "the Profiler" or "Performance
 * Profiles"). Every page under Profiles carries a
 * "Profiles — <section>" title that matches its side-menu entry, so
 * the user never has to guess whether "insights", "raw profiles" and
 * "find what's slow" are the same thing. Each title is one key, so the
 * Page draws it in the reader's language like the breadcrumbs beside it.
 */
function getPageTitle(path: string): string {
  if (path === RouteUtil.getRouteString(PageMap.PROFILES_INSIGHTS)) {
    return translationKey("Profiles — All profiles");
  }
  if (path === RouteUtil.getRouteString(PageMap.PROFILES_DOCUMENTATION)) {
    return translationKey("Profiles — Setup guide");
  }
  if (path === RouteUtil.getRouteString(PageMap.PROFILES_AI_INSIGHTS)) {
    return translationKey("Profiles — AI insights");
  }
  if (path === RouteUtil.getRouteString(PageMap.PROFILES_AI_INSIGHT_VIEW)) {
    return translationKey("Profiles — AI insight");
  }
  if (path === RouteUtil.getRouteString(PageMap.PROFILES_AI_LOGS)) {
    return translationKey("Profiles — AI logs");
  }
  if (path === RouteUtil.getRouteString(PageMap.PROFILES_AI_SETTINGS)) {
    return translationKey("Profiles — AI settings");
  }
  return translationKey("Profiles — Overview");
}

const ProfilesLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title={getPageTitle(path)}
      titleRight={<ProductAboutButton product={ProductKey.Profiles} />}
      breadcrumbLinks={getProfilesBreadcrumbs(path)}
      sideMenu={<SideMenu />}
    >
      {/* Only while today's Profiles budget is past its warning or used up. */}
      <TelemetryIngestionBudgetExplorerBanner signal={ProductType.Profiles} />
      <Outlet />
    </Page>
  );
};

export default ProfilesLayout;
