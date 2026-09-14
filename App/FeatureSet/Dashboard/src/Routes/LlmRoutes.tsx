import ComponentProps from "../Pages/PageComponentProps";
import LlmLayout from "../Pages/Llm/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { LlmRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import LlmOverview from "../Pages/Llm/Overview";
import LlmUsage from "../Pages/Llm/Usage";
import LlmCalls from "../Pages/Llm/Calls";
import LlmBudgets from "../Pages/Llm/Budgets";
import LlmPricing from "../Pages/Llm/Pricing";
import LlmDocumentationPage from "../Pages/Llm/Documentation";

const LlmRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<LlmLayout {...props} />}>
        <PageRoute
          index
          element={
            <LlmOverview
              {...props}
              pageRoute={RouteMap[PageMap.LLM] as Route}
            />
          }
        />

        <PageRoute
          path={LlmRoutePath[PageMap.LLM_OVERVIEW] || ""}
          element={
            <LlmOverview
              {...props}
              pageRoute={RouteMap[PageMap.LLM_OVERVIEW] as Route}
            />
          }
        />

        <PageRoute
          path={LlmRoutePath[PageMap.LLM_USAGE] || ""}
          element={
            <LlmUsage
              {...props}
              pageRoute={RouteMap[PageMap.LLM_USAGE] as Route}
            />
          }
        />

        <PageRoute
          path={LlmRoutePath[PageMap.LLM_CALLS] || ""}
          element={
            <LlmCalls
              {...props}
              pageRoute={RouteMap[PageMap.LLM_CALLS] as Route}
            />
          }
        />

        <PageRoute
          path={LlmRoutePath[PageMap.LLM_BUDGETS] || ""}
          element={
            <LlmBudgets
              {...props}
              pageRoute={RouteMap[PageMap.LLM_BUDGETS] as Route}
            />
          }
        />

        <PageRoute
          path={LlmRoutePath[PageMap.LLM_PRICING] || ""}
          element={
            <LlmPricing
              {...props}
              pageRoute={RouteMap[PageMap.LLM_PRICING] as Route}
            />
          }
        />

        <PageRoute
          path={LlmRoutePath[PageMap.LLM_DOCUMENTATION] || ""}
          element={
            <LlmDocumentationPage
              {...props}
              pageRoute={RouteMap[PageMap.LLM_DOCUMENTATION] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default LlmRoutes;
