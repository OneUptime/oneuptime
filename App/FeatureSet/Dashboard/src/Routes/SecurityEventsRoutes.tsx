import ComponentProps from "../Pages/PageComponentProps";
import SecurityEventsLayout from "../Pages/SecurityEvents/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { SecurityEventsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import SecurityEventsPage from "../Pages/SecurityEvents/Index";
import SecurityEventsCorrelatePage from "../Pages/SecurityEvents/Correlate";
import SecurityEventsDetectionRulesPage from "../Pages/SecurityEvents/DetectionRules";
import SecurityEventsDocumentationPage from "../Pages/SecurityEvents/Documentation";
import SecurityEventsMonitorsPage from "../Pages/SecurityEvents/Monitors";
import SecurityEventsGoogleSecOpsConnectionsPage from "../Pages/SecurityEvents/GoogleSecOpsConnections";

const SecurityEventsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<SecurityEventsLayout {...props} />}>
        <PageRoute
          index
          element={
            <SecurityEventsPage
              {...props}
              pageRoute={RouteMap[PageMap.SECURITY_EVENTS] as Route}
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_CORRELATE] || ""
          }
          element={
            <SecurityEventsCorrelatePage
              {...props}
              pageRoute={RouteMap[PageMap.SECURITY_EVENTS_CORRELATE] as Route}
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_DETECTION_RULES] ||
            ""
          }
          element={
            <SecurityEventsDetectionRulesPage
              {...props}
              pageRoute={
                RouteMap[PageMap.SECURITY_EVENTS_DETECTION_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_MONITORS] || ""}
          element={
            <SecurityEventsMonitorsPage
              {...props}
              pageRoute={RouteMap[PageMap.SECURITY_EVENTS_MONITORS] as Route}
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_CONNECTIONS] || ""
          }
          element={
            <SecurityEventsGoogleSecOpsConnectionsPage
              {...props}
              pageRoute={RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route}
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_DOCUMENTATION] || ""
          }
          element={
            <SecurityEventsDocumentationPage
              {...props}
              pageRoute={
                RouteMap[PageMap.SECURITY_EVENTS_DOCUMENTATION] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default SecurityEventsRoutes;
