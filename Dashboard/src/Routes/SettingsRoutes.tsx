import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import SettingsLayout from "../Pages/Settings/Layout";

import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, SettingsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  FunctionComponent,
  LazyExoticComponent,
  ReactElement,
  Suspense,
  lazy,
} from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
const ProjectSettings: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/ProjectSettings");
  });
const SettingsApiKeys: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/APIKeys");
  });

const SettingsUsers: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/Users");
  });

const SettingsUserView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/UserView");
  });

const SettingsApiKeyView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/APIKeyView");
});

const SettingsIngestionKeys: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/TelemetryIngestionKeys");
});

const SettingsIngestionKeyView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/TelemetryIngestionKeyView");
});

const SettingLabels: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/Labels");
  });

const SettingProbes: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/Probes");
  });

const SettingAIAgents: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/AIAgents");
  });

const SettingsAIAgentView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/AIAgentView");
});

const SettingLlmProviders: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/LlmProviders");
});

const SettingsLlmProviderView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/LlmProviderView");
});

const SettingsAIBilling: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/AIBillingSettings");
});

const SettingFeatureFlags: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/FeatureFlags");
});
const SettingsTeams: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/Teams");
  });
const SettingsTeamView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/TeamView");
  });

const SettingsProbeView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/ProbeView");
});

const SettingsDomains: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/Domains");
  });

const SettingsBilling: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/Billing");
  });
const SettingsSSO: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/SSO");
  });

const SettingsSCIM: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/SCIM");
  });

const SettingsNotificationLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/NotificationLogs");
});
const SettingsAILogs: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/AILogs");
  });
const SettingsNotifications: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/NotificationSettings");
});
const SettingsInvoices: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/Invoices");
  });

const SettingsMicrosoftTeamsIntegration: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/MicrosoftTeamsIntegration");
});

const SettingsUsageHistory: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/UsageHistory");
});

const SettingsSlackIntegration: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/SlackIntegration");
});

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
            <Suspense fallback={Loader}>
              <ProjectSettings
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_NOTIFICATION_LOGS)}
          element={
            <Suspense fallback={Loader}>
              <SettingsNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_NOTIFICATION_LOGS] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_AI_LOGS)}
          element={
            <Suspense fallback={Loader}>
              <SettingsAILogs
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_AI_LOGS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_USAGE_HISTORY)}
          element={
            <Suspense fallback={Loader}>
              <SettingsUsageHistory
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_USAGE_HISTORY] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_FEATURE_FLAGS)}
          element={
            <Suspense fallback={Loader}>
              <SettingFeatureFlags
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_FEATURE_FLAGS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_NOTIFICATION_SETTINGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <SettingsNotifications
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_SLACK_INTEGRATION)}
          element={
            <Suspense fallback={Loader}>
              <SettingsSlackIntegration
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_SLACK_INTEGRATION] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
          )}
          element={
            <Suspense fallback={Loader}>
              <SettingsMicrosoftTeamsIntegration
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_SSO)}
          element={
            <Suspense fallback={Loader}>
              <SettingsSSO
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_SSO] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_SCIM)}
          element={
            <Suspense fallback={Loader}>
              <SettingsSCIM
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_SCIM] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_DOMAINS)}
          element={
            <Suspense fallback={Loader}>
              <SettingsDomains
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_DOMAINS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_APIKEYS)}
          element={
            <Suspense fallback={Loader}>
              <SettingsApiKeys
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_APIKEYS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_APIKEY_VIEW, 2)}
          element={
            <Suspense fallback={Loader}>
              <SettingsApiKeyView
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS,
          )}
          element={
            <Suspense fallback={Loader}>
              <SettingsIngestionKeys
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW,
            2,
          )}
          element={
            <Suspense fallback={Loader}>
              <SettingsIngestionKeyView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_BILLING)}
          element={
            <Suspense fallback={Loader}>
              <SettingsBilling
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_BILLING] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_BILLING_INVOICES)}
          element={
            <Suspense fallback={Loader}>
              <SettingsInvoices
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_BILLING_INVOICES] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_LABELS)}
          element={
            <Suspense fallback={Loader}>
              <SettingLabels
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_LABELS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_PROBES)}
          element={
            <Suspense fallback={Loader}>
              <SettingProbes
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_PROBES] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_AI_AGENTS)}
          element={
            <Suspense fallback={Loader}>
              <SettingAIAgents
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_AI_AGENTS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_AI_AGENT_VIEW, 2)}
          element={
            <Suspense fallback={Loader}>
              <SettingsAIAgentView
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_AI_AGENT_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_LLM_PROVIDERS)}
          element={
            <Suspense fallback={Loader}>
              <SettingLlmProviders
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_LLM_PROVIDERS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_TEAMS)}
          element={
            <Suspense fallback={Loader}>
              <SettingsTeams
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_TEAMS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_USERS)}
          element={
            <Suspense fallback={Loader}>
              <SettingsUsers
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_USERS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_TEAM_VIEW, 2)}
          element={
            <Suspense fallback={Loader}>
              <SettingsTeamView
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_TEAM_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_USER_VIEW, 2)}
          element={
            <Suspense fallback={Loader}>
              <SettingsUserView
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_USER_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_PROBE_VIEW, 2)}
          element={
            <Suspense fallback={Loader}>
              <SettingsProbeView
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_PROBE_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_LLM_PROVIDER_VIEW,
            2,
          )}
          element={
            <Suspense fallback={Loader}>
              <SettingsLlmProviderView
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_LLM_PROVIDER_VIEW] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_AI_BILLING)}
          element={
            <Suspense fallback={Loader}>
              <SettingsAIBilling
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_AI_BILLING] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default SettingsRoutes;
