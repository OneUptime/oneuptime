import ComponentProps from "../Pages/PageComponentProps";
import SecurityEventsLayout from "../Pages/SecurityEvents/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, {
  RouteUtil,
  SecurityEventsRoutePath,
} from "../Utils/RouteMap";
import {
  SECURITY_CASE_QUEUE_VIEWS,
  SecurityCaseQueueView,
} from "../Components/SecurityCase/SecurityCaseQueueViews";
import {
  SECURITY_PLAYBOOK_RUN_VIEWS,
  SecurityPlaybookRunView,
} from "../Components/SecurityPlaybook/SecurityPlaybookRunViews";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Navigate, Route as PageRoute, Routes } from "react-router-dom";

// Pages
import SecurityEventsPage from "../Pages/SecurityEvents/Index";
import SecurityEventsCorrelatePage from "../Pages/SecurityEvents/Correlate";
import SecurityEventsDetectionRulesPage from "../Pages/SecurityEvents/DetectionRules";
import SecurityEventsDocumentationPage from "../Pages/SecurityEvents/Documentation";
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
import SecurityProtectedEntitiesPage from "../Pages/SecurityEvents/ProtectedEntities";
import SecurityEventsWorkspaceConnectionSlackPage from "../Pages/SecurityEvents/WorkspaceConnectionSlack";
import SecurityEventsWorkspaceConnectionMicrosoftTeamsPage from "../Pages/SecurityEvents/WorkspaceConnectionMicrosoftTeams";
import WorkspaceConnectionsOverview from "../Components/Workspace/WorkspaceConnectionsOverview";
import SecurityEventsAISettingsPage from "../Pages/SecurityEvents/AISettings";
import SecurityCasePrioritiesPage from "../Pages/SecurityEvents/Settings/CasePriorities";
import SecurityCaseStatusesPage from "../Pages/SecurityEvents/Settings/CaseStatuses";

/*
 * Every page under the product's side menu renders inside its layout; a
 * case and a playbook are each worked on a full-width page of their own,
 * outside it. The case queue's pages and the two runs pages are one page
 * component each, mounted once per page with the list it shows - and keyed
 * by it, so going from one to the next starts the page afresh. The
 * Workspace pages - Slack, Microsoft Teams, and the page that connects one
 * - are every product's, here for security cases.
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
        {SECURITY_CASE_QUEUE_VIEWS.map(
          (view: SecurityCaseQueueView): ReactElement => {
            return (
              <PageRoute
                key={view.page}
                path={SecurityEventsRoutePath[view.page] || ""}
                element={
                  <SecurityCasesPage
                    {...props}
                    key={view.key}
                    view={view.key}
                    pageRoute={RouteMap[view.page] as Route}
                  />
                }
              />
            );
          },
        )}
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
        {/*
         * Security Events monitors are listed with every other monitor, so
         * the old address opens Monitors (SECURITY_EVENTS_REDIRECTED_PAGES).
         */}
        <PageRoute
          path={SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_MONITORS] || ""}
          element={
            <Navigate
              replace={true}
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITORS] as Route,
              ).toString()}
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
        {SECURITY_PLAYBOOK_RUN_VIEWS.map(
          (view: SecurityPlaybookRunView): ReactElement => {
            return (
              <PageRoute
                key={view.page}
                path={SecurityEventsRoutePath[view.page] || ""}
                element={
                  <SecurityPlaybookRunsPage
                    {...props}
                    key={view.key}
                    view={view.key}
                    pageRoute={RouteMap[view.page] as Route}
                  />
                }
              />
            );
          },
        )}
        <PageRoute
          path={
            SecurityEventsRoutePath[PageMap.SECURITY_PROTECTED_ENTITIES] || ""
          }
          element={
            <SecurityProtectedEntitiesPage
              {...props}
              pageRoute={RouteMap[PageMap.SECURITY_PROTECTED_ENTITIES] as Route}
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
        <PageRoute
          path={
            SecurityEventsRoutePath[
              PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK
            ] || ""
          }
          element={
            <SecurityEventsWorkspaceConnectionSlackPage
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[
              PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
            ] || ""
          }
          element={
            <SecurityEventsWorkspaceConnectionMicrosoftTeamsPage
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[
              PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTIONS
            ] || ""
          }
          element={
            <WorkspaceConnectionsOverview
              slackPage={PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK}
              microsoftTeamsPage={
                PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
              }
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[PageMap.SECURITY_EVENTS_SETTINGS_AI] || ""
          }
          element={
            <SecurityEventsAISettingsPage
              {...props}
              pageRoute={RouteMap[PageMap.SECURITY_EVENTS_SETTINGS_AI] as Route}
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[
              PageMap.SECURITY_EVENTS_SETTINGS_CASE_PRIORITIES
            ] || ""
          }
          element={
            <SecurityCasePrioritiesPage
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SECURITY_EVENTS_SETTINGS_CASE_PRIORITIES
                ] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            SecurityEventsRoutePath[
              PageMap.SECURITY_EVENTS_SETTINGS_CASE_STATUSES
            ] || ""
          }
          element={
            <SecurityCaseStatusesPage
              {...props}
              pageRoute={
                RouteMap[PageMap.SECURITY_EVENTS_SETTINGS_CASE_STATUSES] as Route
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
