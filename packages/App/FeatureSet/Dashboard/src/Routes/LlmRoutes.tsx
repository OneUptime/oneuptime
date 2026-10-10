import ComponentProps from "../Pages/PageComponentProps";
import LlmLayout from "../Pages/Llm/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { LlmRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";
import MovedPageRedirect from "../Components/Routing/MovedPageRedirect";

// Pages
import LlmConversations from "../Pages/Llm/Conversations";
import LlmConversationViewPage from "../Pages/Llm/ConversationView";
import LlmAlerts from "../Pages/Llm/Alerts";
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
            <LlmConversations
              {...props}
              pageRoute={RouteMap[PageMap.LLM] as Route}
            />
          }
        />

        {/*
         * The Overview page was folded into Conversations, which carries its
         * numbers above the list. Old links and bookmarks land there.
         */}
        <PageRoute
          path={LlmRoutePath[PageMap.LLM_OVERVIEW] || ""}
          element={<MovedPageRedirect pageMap={PageMap.LLM_CONVERSATIONS} />}
        />

        <PageRoute
          path={LlmRoutePath[PageMap.LLM_CONVERSATIONS] || ""}
          element={
            <LlmConversations
              {...props}
              pageRoute={RouteMap[PageMap.LLM_CONVERSATIONS] as Route}
            />
          }
        />

        <PageRoute
          path={LlmRoutePath[PageMap.LLM_CONVERSATION_VIEW] || ""}
          element={
            <LlmConversationViewPage
              {...props}
              pageRoute={RouteMap[PageMap.LLM_CONVERSATION_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={LlmRoutePath[PageMap.LLM_ALERTS] || ""}
          element={
            <LlmAlerts
              {...props}
              pageRoute={RouteMap[PageMap.LLM_ALERTS] as Route}
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
