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
const SettingsApiKeyView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/APIKeyView");
});
const SettingLabels: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/Labels");
  });
const SettingProbes: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/Probes");
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
const SettingsMonitors: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/MonitorStatus");
  });
const SettingsIncidents: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/IncidentState");
});
const SettingsScheduledMaintenanceState: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/ScheduledMaintenanceState");
});
const SettingsDomains: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/Domains");
  });
const SettingsIncidentSeverity: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/IncidentSeverity");
});
const SettingsBilling: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/Billing");
  });
const SettingsSSO: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/SSO");
  });
const SettingsSmsLog: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/SmsLog");
  });
const SettingsCallLog: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/CallLog");
  });
const SettingsEmailLog: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/EmailLog");
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
const MonitorCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/MonitorCustomFields");
});

const MonitorSecrets: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Settings/MonitorSecrets");
  });

const StatusPageCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/StatusPageCustomFields");
});
const IncidentCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/IncidentCustomFields");
});
const OnCallDutyPolicyCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/OnCallDutyPolicyCustomFields");
});
const ScheduledMaintenanceCustomFields: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/ScheduledMaintenanceCusomFields");
});
const IncidentTemplates: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/IncidentTemplates");
});
const IncidentTemplatesView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/IncidentTemplatesView");
});
const IncidentNoteTemplates: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/IncidentNoteTemplates");
});
const IncidentNoteTemplateView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/IncidentNoteTemplateView");
});

const ScheduledMaintenanceNoteTemplates: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/ScheduledMaintenanceNoteTemplates");
});
const ScheduledMaintenanceNoteTemplateView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/ScheduledMaintenanceNoteTemplateView");
});

const SettingsUsageHistory: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Settings/UsageHistory");
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
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_SMS_LOGS)}
          element={
            <Suspense fallback={Loader}>
              <SettingsSmsLog
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_SMS_LOGS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_INCIDENT_TEMPLATES,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentTemplates
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_INCIDENT_TEMPLATES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_INCIDENT_TEMPLATES_VIEW,
            2,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentTemplatesView
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_INCIDENT_TEMPLATES_VIEW] as Route
                }
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
            PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentNoteTemplates
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES_VIEW,
            2,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentNoteTemplateView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES_VIEW
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceNoteTemplates
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES_VIEW,
            2,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceNoteTemplateView
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES_VIEW
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_CALL_LOGS)}
          element={
            <Suspense fallback={Loader}>
              <SettingsCallLog
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_CALL_LOGS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_EMAIL_LOGS)}
          element={
            <Suspense fallback={Loader}>
              <SettingsEmailLog
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_EMAIL_LOGS] as Route}
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
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_MONITORS_STATUS)}
          element={
            <Suspense fallback={Loader}>
              <SettingsMonitors
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_MONITORS_STATUS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_INCIDENTS_STATE)}
          element={
            <Suspense fallback={Loader}>
              <SettingsIncidents
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_INCIDENTS_STATE] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE,
          )}
          element={
            <Suspense fallback={Loader}>
              <SettingsScheduledMaintenanceState
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE
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
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_INCIDENTS_SEVERITY,
          )}
          element={
            <Suspense fallback={Loader}>
              <SettingsIncidentSeverity
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_INCIDENTS_SEVERITY] as Route
                }
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
            PageMap.SETTINGS_MONITOR_CUSTOM_FIELDS,
          )}
          element={
            <Suspense fallback={Loader}>
              <MonitorCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_MONITOR_CUSTOM_FIELDS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SETTINGS_MONITOR_SECRETS)}
          element={
            <Suspense fallback={Loader}>
              <MonitorSecrets
                {...props}
                pageRoute={RouteMap[PageMap.SETTINGS_MONITOR_SECRETS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_STATUS_PAGE_CUSTOM_FIELDS,
          )}
          element={
            <Suspense fallback={Loader}>
              <StatusPageCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_STATUS_PAGE_CUSTOM_FIELDS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_SCHEDULED_MAINTENANCE_CUSTOM_FIELDS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ScheduledMaintenanceCustomFields
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SETTINGS_SCHEDULED_MAINTENANCE_CUSTOM_FIELDS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_INCIDENT_CUSTOM_FIELDS,
          )}
          element={
            <Suspense fallback={Loader}>
              <IncidentCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.SETTINGS_INCIDENT_CUSTOM_FIELDS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SETTINGS_ON_CALL_DUTY_POLICY_CUSTOM_FIELDS,
          )}
          element={
            <Suspense fallback={Loader}>
              <OnCallDutyPolicyCustomFields
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SETTINGS_ON_CALL_DUTY_POLICY_CUSTOM_FIELDS
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
      </PageRoute>
    </Routes>
  );
};

export default SettingsRoutes;
