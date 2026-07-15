import ComponentProps from "../Pages/PageComponentProps";
import AIInsightsLayout from "../Pages/AIInsights/Layout";
import AIInsightViewLayout from "../Pages/AIInsights/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, AIInsightsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import AIInsights from "../Pages/AIInsights/Insights";

import AIInsightsSettings from "../Pages/AIInsights/Settings";

import AIInsightView from "../Pages/AIInsights/View/Index";

/*
 * The static "settings" child and the dynamic ":id" detail child are
 * siblings under /ai/insights/* — the router ranks the static segment
 * higher, so the settings page never resolves as an insight id.
 */
const AIInsightsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<AIInsightsLayout {...props} />}>
        <PageRoute
          index
          element={
            <AIInsights
              {...props}
              pageRoute={RouteMap[PageMap.AI_INSIGHTS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.AI_INSIGHTS_SETTINGS)}
          element={
            <AIInsightsSettings
              {...props}
              pageRoute={RouteMap[PageMap.AI_INSIGHTS_SETTINGS] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={AIInsightsRoutePath[PageMap.AI_INSIGHT_VIEW] || ""}
        element={<AIInsightViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <AIInsightView
              {...props}
              pageRoute={RouteMap[PageMap.AI_INSIGHT_VIEW] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default AIInsightsRoutes;
