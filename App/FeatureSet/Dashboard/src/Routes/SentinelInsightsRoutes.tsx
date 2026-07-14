import ComponentProps from "../Pages/PageComponentProps";
import SentinelInsightsLayout from "../Pages/SentinelInsights/Layout";
import SentinelInsightViewLayout from "../Pages/SentinelInsights/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, {
  RouteUtil,
  SentinelInsightsRoutePath,
} from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import SentinelInsights from "../Pages/SentinelInsights/Insights";

import SentinelInsightsSettings from "../Pages/SentinelInsights/Settings";

import SentinelInsightView from "../Pages/SentinelInsights/View/Index";

/*
 * The static "settings" child and the dynamic ":id" detail child are
 * siblings under /ai/insights/* — the router ranks the static segment
 * higher, so the settings page never resolves as an insight id.
 */
const SentinelInsightsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<SentinelInsightsLayout {...props} />}>
        <PageRoute
          index
          element={
            <SentinelInsights
              {...props}
              pageRoute={RouteMap[PageMap.SENTINEL_INSIGHTS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SENTINEL_INSIGHTS_SETTINGS)}
          element={
            <SentinelInsightsSettings
              {...props}
              pageRoute={RouteMap[PageMap.SENTINEL_INSIGHTS_SETTINGS] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={SentinelInsightsRoutePath[PageMap.SENTINEL_INSIGHT_VIEW] || ""}
        element={<SentinelInsightViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <SentinelInsightView
              {...props}
              pageRoute={RouteMap[PageMap.SENTINEL_INSIGHT_VIEW] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default SentinelInsightsRoutes;
