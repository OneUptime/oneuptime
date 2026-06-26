import { getLlmBreadcrumbs } from "../../Utils/Breadcrumbs/LlmBreadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import LlmNavTabs, { LlmTabKey } from "../../Components/AI/LlmNavTabs";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const getActiveLlmTab: (path: string) => LlmTabKey = (
  path: string,
): LlmTabKey => {
  if (path.includes("/llm/calls")) {
    return "calls";
  }
  if (path.includes("/llm/documentation")) {
    return "setup";
  }
  return "overview";
};

const LlmLayout: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  if (path.endsWith("llm") || path.endsWith("llm/*")) {
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[PageMap.LLM_OVERVIEW]!),
    );

    return <></>;
  }

  return (
    <Page
      title="AI / LLM Observability"
      breadcrumbLinks={getLlmBreadcrumbs(path)}
      headerRight={<LlmNavTabs active={getActiveLlmTab(path)} />}
    >
      <Outlet />
    </Page>
  );
};

export default LlmLayout;
