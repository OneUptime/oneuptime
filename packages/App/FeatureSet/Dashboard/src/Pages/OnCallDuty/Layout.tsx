import { getOnCallDutyBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Dictionary from "Common/Types/Dictionary";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const PageTitleMap: Dictionary<string> = {
  [RouteUtil.getLastPathForKey(PageMap.ON_CALL_DUTY_POLICIES)]:
    "On-Call Policies",
  [RouteUtil.getLastPathForKey(PageMap.ON_CALL_DUTY_READINESS)]:
    "On-Call Readiness",
  [RouteUtil.getLastPathForKey(PageMap.ON_CALL_DUTY_SCHEDULES)]:
    "On-Call Schedules",
  [RouteUtil.getLastPathForKey(PageMap.ON_CALL_DUTY_EXECUTION_LOGS)]:
    "On-Call Logs",
  [RouteUtil.getLastPathForKey(PageMap.ON_CALLDUTY_USER_TIME_LOGS)]:
    "User On-Call Time",
  [RouteUtil.getLastPathForKey(PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES)]:
    "User Overrides",
};

const OnCallDutyLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const lastPath: string = RouteUtil.getLastPath(path);
  return (
    <Page
      title={PageTitleMap[lastPath]}
      titleRight={<ProductAboutButton product={ProductKey.OnCall} />}
      breadcrumbLinks={getOnCallDutyBreadcrumbs(path)}
      sideMenu={<DashboardSideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default OnCallDutyLayout;
