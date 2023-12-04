import React, { FunctionComponent, ReactElement } from 'react';
import { Routes, Route as PageRoute } from 'react-router';
import Route from 'Common/Types/API/Route';
import RouteMap, { SettingsRoutePath } from '../Utils/RouteMap';
import PageMap from '../Utils/PageMap';
import ComponentProps from '../Pages/PageComponentProps';

// Pages
import ProjectSettings from '../Pages/Settings/ProjectSettings';
import SettingsApiKeys from '../Pages/Settings/APIKeys';
import SettingsApiKeyView from '../Pages/Settings/APIKeyView';
import SettingLabels from '../Pages/Settings/Labels';
import SettingProbes from '../Pages/Settings/Probes';
import SettingCustomSMTP from '../Pages/Settings/CustomSMTP';
import SettingFeatureFlags from '../Pages/Settings/FeatureFlags';
import SettingsTeams from '../Pages/Settings/Teams';
import SettingsTeamView from '../Pages/Settings/TeamView';
import SettingsMonitors from '../Pages/Settings/MonitorStatus';
import SettingsIncidents from '../Pages/Settings/IncidentState';
import SettingsScheduledMaintenanceState from '../Pages/Settings/ScheduledMaintenanceState';
import SettingsDomains from '../Pages/Settings/Domains';
import SettingsIncidentSeverity from '../Pages/Settings/IncidentSeverity';
import SettingsBilling from '../Pages/Settings/Billing';
import SettingsSSO from '../Pages/Settings/SSO';
import SettingsSmsLog from '../Pages/Settings/SmsLog';
import SettingsCallLog from '../Pages/Settings/CallLog';
import SettingsEmailLog from '../Pages/Settings/EmailLog';
import SettingsCallSms from '../Pages/Settings/CallSms';
import SettingsInvoices from '../Pages/Settings/Invoices';
import MonitorCustomFields from '../Pages/Settings/MonitorCustomFields';
import StatusPageCustomFields from '../Pages/Settings/StatusPageCustomFields';
import IncidentCustomFields from '../Pages/Settings/IncidentCustomFields';
import OnCallDutyPolicyCustomFields from '../Pages/Settings/OnCallDutyPolicyCustomFields';
import ScheduledMaintenanceCustomFields from '../Pages/Settings/ScheduledMaintenanceCusomFields';
import IncidentTemplates from '../Pages/Settings/IncidentTemplates';
import IncidentTemplatesView from '../Pages/Settings/IncidentTemplatesView';
import IncidentNoteTemplates from '../Pages/Settings/IncidentNoteTemplates';
import IncidentNoteTemplateView from '../Pages/Settings/IncidentNoteTemplateView';

import ScheduledMaintenanceNoteTemplates from '../Pages/Settings/ScheduledMaintenanceNoteTemplates';
import ScheduledMaintenanceNoteTemplateView from '../Pages/Settings/ScheduledMaintenanceNoteTemplateView';

const SettingsRoutes: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Routes>
            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS] || ''}
                element={
                    <ProjectSettings
                        {...props}
                        pageRoute={RouteMap[PageMap.SETTINGS] as Route}
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_SMS_LOGS] || ''}
                element={
                    <SettingsSmsLog
                        {...props}
                        pageRoute={RouteMap[PageMap.SETTINGS_SMS_LOGS] as Route}
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[PageMap.SETTINGS_INCIDENT_TEMPLATES] || ''
                }
                element={
                    <IncidentTemplates
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap.SETTINGS_INCIDENT_TEMPLATES
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[
                        PageMap.SETTINGS_INCIDENT_TEMPLATES_VIEW
                    ] || ''
                }
                element={
                    <IncidentTemplatesView
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap.SETTINGS_INCIDENT_TEMPLATES_VIEW
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_FEATURE_FLAGS] || ''}
                element={
                    <SettingFeatureFlags
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.SETTINGS_FEATURE_FLAGS] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[
                        PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES
                    ] || ''
                }
                element={
                    <IncidentNoteTemplates
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[
                        PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES_VIEW
                    ] || ''
                }
                element={
                    <IncidentNoteTemplateView
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap.SETTINGS_INCIDENT_NOTE_TEMPLATES_VIEW
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[
                        PageMap.SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES
                    ] || ''
                }
                element={
                    <ScheduledMaintenanceNoteTemplates
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap
                                    .SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[
                        PageMap
                            .SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES_VIEW
                    ] || ''
                }
                element={
                    <ScheduledMaintenanceNoteTemplateView
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap
                                    .SETTINGS_SCHEDULED_MAINTENANCE_NOTE_TEMPLATES_VIEW
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_CALL_LOGS] || ''}
                element={
                    <SettingsCallLog
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.SETTINGS_CALL_LOGS] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_EMAIL_LOGS] || ''}
                element={
                    <SettingsEmailLog
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.SETTINGS_EMAIL_LOGS] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_CALL_SMS] || ''}
                element={
                    <SettingsCallSms
                        {...props}
                        pageRoute={RouteMap[PageMap.SETTINGS_CALL_SMS] as Route}
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_MONITORS_STATUS] || ''}
                element={
                    <SettingsMonitors
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.SETTINGS_MONITORS_STATUS] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_INCIDENTS_STATE] || ''}
                element={
                    <SettingsIncidents
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.SETTINGS_INCIDENTS_STATE] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[
                        PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE
                    ] || ''
                }
                element={
                    <SettingsScheduledMaintenanceState
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_SSO] || ''}
                element={
                    <SettingsSSO
                        {...props}
                        pageRoute={RouteMap[PageMap.SETTINGS_SSO] as Route}
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[PageMap.SETTINGS_INCIDENTS_SEVERITY] || ''
                }
                element={
                    <SettingsIncidentSeverity
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap.SETTINGS_INCIDENTS_SEVERITY
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_DOMAINS] || ''}
                element={
                    <SettingsDomains
                        {...props}
                        pageRoute={RouteMap[PageMap.SETTINGS_DOMAINS] as Route}
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_CUSTOM_SMTP] || ''}
                element={
                    <SettingCustomSMTP
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.SETTINGS_CUSTOM_SMTP] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_APIKEYS] || ''}
                element={
                    <SettingsApiKeys
                        {...props}
                        pageRoute={RouteMap[PageMap.SETTINGS_APIKEYS] as Route}
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_APIKEY_VIEW] || ''}
                element={
                    <SettingsApiKeyView
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[PageMap.SETTINGS_MONITOR_CUSTOM_FIELDS] ||
                    ''
                }
                element={
                    <MonitorCustomFields
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap.SETTINGS_MONITOR_CUSTOM_FIELDS
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[
                        PageMap.SETTINGS_STATUS_PAGE_CUSTOM_FIELDS
                    ] || ''
                }
                element={
                    <StatusPageCustomFields
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap.SETTINGS_STATUS_PAGE_CUSTOM_FIELDS
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[
                        PageMap.SETTINGS_SCHEDULED_MAINTENANCE_CUSTOM_FIELDS
                    ] || ''
                }
                element={
                    <ScheduledMaintenanceCustomFields
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap
                                    .SETTINGS_SCHEDULED_MAINTENANCE_CUSTOM_FIELDS
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[
                        PageMap.SETTINGS_INCIDENT_CUSTOM_FIELDS
                    ] || ''
                }
                element={
                    <IncidentCustomFields
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap.SETTINGS_INCIDENT_CUSTOM_FIELDS
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[
                        PageMap.SETTINGS_ON_CALL_DUTY_POLICY_CUSTOM_FIELDS
                    ] || ''
                }
                element={
                    <OnCallDutyPolicyCustomFields
                        {...props}
                        pageRoute={
                            RouteMap[
                                PageMap
                                    .SETTINGS_ON_CALL_DUTY_POLICY_CUSTOM_FIELDS
                            ] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_BILLING] || ''}
                element={
                    <SettingsBilling
                        {...props}
                        pageRoute={RouteMap[PageMap.SETTINGS_BILLING] as Route}
                    />
                }
            />

            <PageRoute
                path={
                    SettingsRoutePath[PageMap.SETTINGS_BILLING_INVOICES] || ''
                }
                element={
                    <SettingsInvoices
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.SETTINGS_BILLING_INVOICES] as Route
                        }
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_LABELS] || ''}
                element={
                    <SettingLabels
                        {...props}
                        pageRoute={RouteMap[PageMap.SETTINGS_LABELS] as Route}
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_PROBES] || ''}
                element={
                    <SettingProbes
                        {...props}
                        pageRoute={RouteMap[PageMap.SETTINGS_PROBES] as Route}
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_TEAMS] || ''}
                element={
                    <SettingsTeams
                        {...props}
                        pageRoute={RouteMap[PageMap.SETTINGS_TEAMS] as Route}
                    />
                }
            />

            <PageRoute
                path={SettingsRoutePath[PageMap.SETTINGS_TEAM_VIEW] || ''}
                element={
                    <SettingsTeamView
                        {...props}
                        pageRoute={
                            RouteMap[PageMap.SETTINGS_TEAM_VIEW] as Route
                        }
                    />
                }
            />
        </Routes>
    );
};

export default SettingsRoutes;
