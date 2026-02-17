import ComponentProps from "../Pages/PageComponentProps";
import SettingsLayout from "../Pages/Settings/Layout";

import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, SettingsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import ProjectSettings from "../Pages/Settings/ProjectSettings";
import SettingsApiKeys from "../Pages/Settings/APIKeys";

import SettingsUsers from "../Pages/Settings/Users";

import SettingsUserView from "../Pages/Settings/UserView";

import SettingsApiKeyView from "../Pages/Settings/APIKeyView";

import SettingsIngestionKeys from "../Pages/Settings/TelemetryIngestionKeys";

import SettingsIngestionKeyView from "../Pages/Settings/TelemetryIngestionKeyView";

import SettingLabels from "../Pages/Settings/Labels";

import SettingProbes from "../Pages/Settings/Probes";

import SettingAIAgents from "../Pages/Settings/AIAgents";

import SettingsAIAgentView from "../Pages/Settings/AIAgentView";

import SettingLlmProviders from "../Pages/Settings/LlmProviders";

import SettingsLlmProviderView from "../Pages/Settings/LlmProviderView";

import SettingsAIBilling from "../Pages/Settings/AIBillingSettings";

import SettingFeatureFlags from "../Pages/Settings/FeatureFlags";
import SettingsTeams from "../Pages/Settings/Teams";
import SettingsTeamView from "../Pages/Settings/TeamView";

import SettingsProbeView from "../Pages/Settings/ProbeView";

import SettingsDomains from "../Pages/Settings/Domains";

import SettingsBilling from "../Pages/Settings/Billing";
import SettingsSSO from "../Pages/Settings/SSO";

import SettingsSCIM from "../Pages/Settings/SCIM";

import SettingsNotificationLogs from "../Pages/Settings/NotificationLogs";
import SettingsAILogs from "../Pages/Settings/AILogs";
import SettingsNotifications from "../Pages/Settings/NotificationSettings";
import SettingsInvoices from "../Pages/Settings/Invoices";

import SettingsMicrosoftTeamsIntegration from "../Pages/Settings/MicrosoftTeamsIntegration";

import SettingsUsageHistory from "../Pages/Settings/UsageHistory";

import SettingsSlackIntegration from "../Pages/Settings/SlackIntegration";
import SettingsAuditLogs from "../Pages/Settings/AuditLogs";

const SettingsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute
        path={SettingsRoutePath[PageMap.SETTINGS] || ""}
        element={<SettingsLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <ProjectSettings
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_NOTIFICATION_LOGS)}
          element={
            <SettingsNotificationLogs
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_NOTIFICATION_LOGS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_AI_LOGS)}
          element={
            <SettingsAILogs
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_AI_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_USAGE_HISTORY)}
          element={
            <SettingsUsageHistory
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_USAGE_HISTORY] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_FEATURE_FLAGS)}
          element={
            <SettingFeatureFlags
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_FEATURE_FLAGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_NOTIFICATION_SETTINGS,
          )}
          element={
            <SettingsNotifications
              {...props}
              pageRoute={
                RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_SLACK_INTEGRATION)}
          element={
            <SettingsSlackIntegration
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_SLACK_INTEGRATION] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
          )}
          element={
            <SettingsMicrosoftTeamsIntegration
              {...props}
              pageRoute={
                RouteMap[PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_SSO)}
          element={
            <SettingsSSO
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_SSO] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_SCIM)}
          element={
            <SettingsSCIM
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_SCIM] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_DOMAINS)}
          element={
            <SettingsDomains
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_DOMAINS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_APIKEYS)}
          element={
            <SettingsApiKeys
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_APIKEYS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_APIKEY_VIEW, 2)}
          element={
            <SettingsApiKeyView
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS,
          )}
          element={
            <SettingsIngestionKeys
              {...props}
              pageRoute={
                RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW,
            2,
          )}
          element={
            <SettingsIngestionKeyView
              {...props}
              pageRoute={
                RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_BILLING)}
          element={
            <SettingsBilling
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_BILLING] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_BILLING_INVOICES)}
          element={
            <SettingsInvoices
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_BILLING_INVOICES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_LABELS)}
          element={
            <SettingLabels
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_LABELS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_PROBES)}
          element={
            <SettingProbes
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_PROBES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_AI_AGENTS)}
          element={
            <SettingAIAgents
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_AI_AGENTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_AI_AGENT_VIEW, 2)}
          element={
            <SettingsAIAgentView
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_AI_AGENT_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_LLM_PROVIDERS)}
          element={
            <SettingLlmProviders
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_LLM_PROVIDERS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_TEAMS)}
          element={
            <SettingsTeams
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_TEAMS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_USERS)}
          element={
            <SettingsUsers
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_USERS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_TEAM_VIEW, 2)}
          element={
            <SettingsTeamView
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_TEAM_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_USER_VIEW, 2)}
          element={
            <SettingsUserView
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_USER_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_PROBE_VIEW, 2)}
          element={
            <SettingsProbeView
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_PROBE_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_LLM_PROVIDER_VIEW,
            2,
          )}
          element={
            <SettingsLlmProviderView
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_LLM_PROVIDER_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_AI_BILLING)}
          element={
            <SettingsAIBilling
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_AI_BILLING] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_AUDIT_LOGS)}
          element={
            <SettingsAuditLogs
              {...props}
              pageRoute={RouteMap[PageMap.SETTINGS_AUDIT_LOGS] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default SettingsRoutes;
