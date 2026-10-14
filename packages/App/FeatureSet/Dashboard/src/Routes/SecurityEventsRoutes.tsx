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
import SecurityEventsConnectionsPage from "../Pages/SecurityEvents/Connections";
import SecurityEventsThreatIntelPage from "../Pages/SecurityEvents/ThreatIntel";
import SecurityOverviewPage from "../Pages/SecurityEvents/Overview";
import SecurityCasesPage from "../Pages/SecurityEvents/Cases";
import SecurityCaseViewPage from "../Pages/SecurityEvents/CaseView";
import SecurityEntitiesPage from "../Pages/SecurityEvents/Entities";
import RuleLibraryPage from "../Pages/SecurityEvents/RuleLibrary";
import AttackCoveragePage from "../Pages/SecurityEvents/AttackCoverage";
import SecurityPlaybooksPage from "../Pages/SecurityEvents/Playbooks";
import SecurityPlaybookViewPage from "../Pages/SecurityEvents/PlaybookView";
import SecurityPlaybookRunsPage from "../Pages/SecurityEvents/PlaybookRuns";

/*
 * Every page under the product's side menu renders inside its layout; a
 * case and a playbook are each worked on a full-width page of their own,
 * outside it.
 */
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
          path={SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_OVERVIEW] || ""}
          element={
            <SecurityOverviewPage
              {...props}
              pageRoute={RouteMap[PageMap.SECURITY_EVENTS_OVERVIEW] as Route}
            />
          }
        />
        <PageRoute
          path={SecurityEventsRoutePath[PageMap.SECURITY_CASES] || ""}
          element={
            <SecurityCasesPage
              {...props}
              pageRoute={RouteMap[PageMap.SECURITY_CASES] as Route}
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
          path={SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_ENTITIES] || ""}
          element={
            <SecurityEntitiesPage
              {...props}
              pageRoute={RouteMap[PageMap.SECURITY_EVENTS_ENTITIES] as Route}
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
          path={
            SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_RULE_LIBRARY] || ""
          }
          element={
            <RuleLibraryPage
              {...props}
              pageRoute={
                RouteMap[PageMap.SECURITY_EVENTS_RULE_LIBRARY] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_ATTACK_COVERAGE] ||
            ""
          }
          element={
            <AttackCoveragePage
              {...props}
              pageRoute={
                RouteMap[PageMap.SECURITY_EVENTS_ATTACK_COVERAGE] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_THREAT_INTEL] || ""
          }
          element={
            <SecurityEventsThreatIntelPage
              {...props}
              pageRoute={
                RouteMap[PageMap.SECURITY_EVENTS_THREAT_INTEL] as Route
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
          path={SecurityEventsRoutePath[PageMap.SECURITY_PLAYBOOKS] || ""}
          element={
            <SecurityPlaybooksPage
              {...props}
              pageRoute={RouteMap[PageMap.SECURITY_PLAYBOOKS] as Route}
            />
          }
        />
        <PageRoute
          path={SecurityEventsRoutePath[PageMap.SECURITY_PLAYBOOK_RUNS] || ""}
          element={
            <SecurityPlaybookRunsPage
              {...props}
              pageRoute={RouteMap[PageMap.SECURITY_PLAYBOOK_RUNS] as Route}
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_CONNECTIONS] || ""
          }
          element={
            <SecurityEventsConnectionsPage
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
      <PageRoute
        path={SecurityEventsRoutePath[PageMap.SECURITY_CASE_VIEW] || ""}
        element={
          <SecurityCaseViewPage
            {...props}
            pageRoute={RouteMap[PageMap.SECURITY_CASE_VIEW] as Route}
          />
        }
      />
      <PageRoute
        path={SecurityEventsRoutePath[PageMap.SECURITY_PLAYBOOK_VIEW] || ""}
        element={
          <SecurityPlaybookViewPage
            {...props}
            pageRoute={RouteMap[PageMap.SECURITY_PLAYBOOK_VIEW] as Route}
          />
        }
      />
    </Routes>
  );
};

export default SecurityEventsRoutes;
