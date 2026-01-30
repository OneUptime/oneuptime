import PageMap from "./PageMap";
import RouteParams from "./RouteParams";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";

export const MonitorsRoutePath: Dictionary<string> = {
  [PageMap.MONITORS_INOPERATIONAL]: "inoperational",
  [PageMap.MONITOR_CREATE]: "create",
  [PageMap.MONITORS_DISABLED]: "disabled",
  [PageMap.MONITORS_PROBE_DISCONNECTED]: "probe-disconnected",
  [PageMap.MONITORS_PROBE_DISABLED]: "probe-disabled",
  [PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK]: "workspace-connection-slack",
  [PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]:
    "workspace-connection-microsoft-teams",

  // Monitor Settings
  [PageMap.MONITORS_SETTINGS]: "settings/status",
  [PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS]: "settings/custom-fields",
  [PageMap.MONITORS_SETTINGS_SECRETS]: "settings/secrets",

  [PageMap.MONITOR_VIEW]: `${RouteParams.ModelID}`,
  [PageMap.MONITOR_VIEW_INTERVAL]: `${RouteParams.ModelID}/interval`,
  [PageMap.MONITOR_VIEW_OWNERS]: `${RouteParams.ModelID}/owners`,
  [PageMap.MONITOR_VIEW_STATUS_TIMELINE]: `${RouteParams.ModelID}/status-timeline`,
  [PageMap.MONITOR_VIEW_INCIDENTS]: `${RouteParams.ModelID}/incidents`,
  [PageMap.MONITOR_VIEW_ALERTS]: `${RouteParams.ModelID}/alerts`,
  [PageMap.MONITOR_VIEW_CUSTOM_FIELDS]: `${RouteParams.ModelID}/custom-fields`,
  [PageMap.MONITOR_VIEW_DELETE]: `${RouteParams.ModelID}/delete`,
  [PageMap.MONITOR_VIEW_SETTINGS]: `${RouteParams.ModelID}/settings`,
  [PageMap.MONITOR_VIEW_CRITERIA]: `${RouteParams.ModelID}/criteria`,
  [PageMap.MONITOR_VIEW_METRICS]: `${RouteParams.ModelID}/metrics`,
  [PageMap.MONITOR_VIEW_PROBES]: `${RouteParams.ModelID}/probes`,
  [PageMap.MONITOR_VIEW_LOGS]: `${RouteParams.ModelID}/logs`,
  [PageMap.MONITOR_VIEW_DOCUMENTATION]: `${RouteParams.ModelID}/documentation`,
};

export const ServiceRoutePath: Dictionary<string> = {
  [PageMap.SERVICE_VIEW]: `${RouteParams.ModelID}`,
  [PageMap.SERVICE_VIEW_OWNERS]: `${RouteParams.ModelID}/owners`,
  [PageMap.SERVICE_VIEW_DEPENDENCIES]: `${RouteParams.ModelID}/dependencies`,
  [PageMap.SERVICE_VIEW_DELETE]: `${RouteParams.ModelID}/delete`,
  [PageMap.SERVICE_VIEW_SETTINGS]: `${RouteParams.ModelID}/settings`,
  [PageMap.SERVICE_VIEW_MONITORS]: `${RouteParams.ModelID}/monitors`,
  [PageMap.SERVICE_VIEW_INCIDENTS]: `${RouteParams.ModelID}/incidents`,
  [PageMap.SERVICE_VIEW_ALERTS]: `${RouteParams.ModelID}/alerts`,
  [PageMap.SERVICE_VIEW_LOGS]: `${RouteParams.ModelID}/logs`,
  [PageMap.SERVICE_VIEW_TRACES]: `${RouteParams.ModelID}/traces`,
  [PageMap.SERVICE_VIEW_METRICS]: `${RouteParams.ModelID}/metrics`,
  [PageMap.SERVICE_VIEW_CODE_REPOSITORIES]: `${RouteParams.ModelID}/code-repositories`,
};

export const CodeRepositoryRoutePath: Dictionary<string> = {
  [PageMap.CODE_REPOSITORY_VIEW]: `${RouteParams.ModelID}`,
  [PageMap.CODE_REPOSITORY_VIEW_DELETE]: `${RouteParams.ModelID}/delete`,
  [PageMap.CODE_REPOSITORY_VIEW_SETTINGS]: `${RouteParams.ModelID}/settings`,
  [PageMap.CODE_REPOSITORY_VIEW_SERVICES]: `${RouteParams.ModelID}/services`,
};

export const WorkflowRoutePath: Dictionary<string> = {
  [PageMap.WORKFLOWS_LOGS]: "logs",
  [PageMap.WORKFLOWS_VARIABLES]: "variables",
  [PageMap.WORKFLOW_VARIABLES]: `${RouteParams.ModelID}/variables`,
  [PageMap.WORKFLOW_BUILDER]: `${RouteParams.ModelID}/builder`,
  [PageMap.WORKFLOW_VIEW]: `${RouteParams.ModelID}`,
  [PageMap.WORKFLOW_LOGS]: `${RouteParams.ModelID}/logs`,
  [PageMap.WORKFLOW_DELETE]: `${RouteParams.ModelID}/delete`,
  [PageMap.WORKFLOW_VIEW_SETTINGS]: `${RouteParams.ModelID}/settings`,
};

export const AIAgentTasksRoutePath: Dictionary<string> = {
  [PageMap.AI_AGENT_TASK_VIEW]: `${RouteParams.ModelID}`,
  [PageMap.AI_AGENT_TASK_VIEW_LOGS]: `${RouteParams.ModelID}/logs`,
  [PageMap.AI_AGENT_TASK_VIEW_PULL_REQUESTS]: `${RouteParams.ModelID}/pull-requests`,
  [PageMap.AI_AGENT_TASK_VIEW_DELETE]: `${RouteParams.ModelID}/delete`,
};

// Logs product routes
export const LogsRoutePath: Dictionary<string> = {
  [PageMap.LOGS]: "",
};

// Metrics product routes
export const MetricsRoutePath: Dictionary<string> = {
  [PageMap.METRICS]: "",
  [PageMap.METRIC_VIEW]: "view",
};

// Traces product routes
export const TracesRoutePath: Dictionary<string> = {
  [PageMap.TRACES]: "",
  [PageMap.TRACE_VIEW]: `view/${RouteParams.ModelID}`,
};

export const ExceptionsRoutePath: Dictionary<string> = {
  [PageMap.EXCEPTIONS]: "unresolved",
  [PageMap.EXCEPTIONS_UNRESOLVED]: "unresolved",
  [PageMap.EXCEPTIONS_RESOLVED]: "resolved",
  [PageMap.EXCEPTIONS_ARCHIVED]: "archived",
  [PageMap.EXCEPTIONS_VIEW_ROOT]: "",
  [PageMap.EXCEPTIONS_VIEW]: `${RouteParams.ModelID}`,
};

export const DashboardsRoutePath: Dictionary<string> = {
  [PageMap.DASHBOARD_VIEW]: `${RouteParams.ModelID}`,
  [PageMap.DASHBOARD_VIEW_OVERVIEW]: `${RouteParams.ModelID}/overview`,
  [PageMap.DASHBOARD_VIEW_DELETE]: `${RouteParams.ModelID}/delete`,
  [PageMap.DASHBOARD_VIEW_SETTINGS]: `${RouteParams.ModelID}/settings`,
};

export const StatusPagesRoutePath: Dictionary<string> = {
  [PageMap.STATUS_PAGE_ANNOUNCEMENTS]: "announcements",
  [PageMap.ANNOUNCEMENT_CREATE]: "announcements/create",
  [PageMap.ANNOUNCEMENT_VIEW]: `announcements/${RouteParams.ModelID}`,

  // Status Pages Settings
  [PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES]:
    "settings/announcement-templates",
  [PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES_VIEW]: `settings/announcement-templates/${RouteParams.ModelID}`,
  [PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES]:
    "settings/subscriber-notification-templates",
  [PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES_VIEW]: `settings/subscriber-notification-templates/${RouteParams.ModelID}`,
  [PageMap.STATUS_PAGES_SETTINGS_CUSTOM_FIELDS]: "settings/custom-fields",
  [PageMap.ANNOUNCEMENT_VIEW_NOTIFICATION_LOGS]: `announcements/${RouteParams.ModelID}/notification-logs`,
  [PageMap.ANNOUNCEMENT_VIEW_DELETE]: `announcements/${RouteParams.ModelID}/delete`,
  [PageMap.STATUS_PAGE_VIEW]: `${RouteParams.ModelID}`,
  [PageMap.STATUS_PAGE_VIEW_BRANDING]: `${RouteParams.ModelID}/branding`,
  [PageMap.STATUS_PAGE_VIEW_OWNERS]: `${RouteParams.ModelID}/owners`,
  [PageMap.STATUS_PAGE_VIEW_GROUPS]: `${RouteParams.ModelID}/groups`,
  [PageMap.STATUS_PAGE_VIEW_DELETE]: `${RouteParams.ModelID}/delete`,
  [PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS]: `${RouteParams.ModelID}/custom-fields`,
  [PageMap.STATUS_PAGE_VIEW_DOMAINS]: `${RouteParams.ModelID}/domains`,
  [PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS]: `${RouteParams.ModelID}/email-subscribers`,
  [PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS]: `${RouteParams.ModelID}/sms-subscribers`,
  [PageMap.STATUS_PAGE_VIEW_SLACK_SUBSCRIBERS]: `${RouteParams.ModelID}/slack-subscribers`,
  [PageMap.STATUS_PAGE_VIEW_MICROSOFT_TEAMS_SUBSCRIBERS]: `${RouteParams.ModelID}/microsoft-teams-subscribers`,
  [PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS]: `${RouteParams.ModelID}/webhook-subscribers`,
  [PageMap.STATUS_PAGE_VIEW_HEADER_STYLE]: `${RouteParams.ModelID}/header-style`,
  [PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE]: `${RouteParams.ModelID}/footer-style`,
  [PageMap.STATUS_PAGE_VIEW_OVERVIEW_PAGE_BRANDING]: `${RouteParams.ModelID}/overview-page-branding`,
  [PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS]: `${RouteParams.ModelID}/private-users`,
  [PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE]: `${RouteParams.ModelID}/navbar-style`,
  [PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS]: `${RouteParams.ModelID}/announcements`,
  [PageMap.STATUS_PAGE_VIEW_EMBEDDED]: `${RouteParams.ModelID}/embedded`,
  [PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS]: `${RouteParams.ModelID}/subscriber-settings`,
  [PageMap.STATUS_PAGE_VIEW_SSO]: `${RouteParams.ModelID}/sso`,
  [PageMap.STATUS_PAGE_VIEW_SCIM]: `${RouteParams.ModelID}/scim`,
  [PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS]: `${RouteParams.ModelID}/custom-code`,
  [PageMap.STATUS_PAGE_VIEW_RESOURCES]: `${RouteParams.ModelID}/resources`,
  [PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS]: `${RouteParams.ModelID}/advanced-options`,
  [PageMap.STATUS_PAGE_VIEW_REPORTS]: `${RouteParams.ModelID}/reports`,
  [PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS]: `${RouteParams.ModelID}/authentication-settings`,
  [PageMap.STATUS_PAGE_VIEW_SETTINGS]: `${RouteParams.ModelID}/settings`,
  [PageMap.STATUS_PAGE_VIEW_NOTIFICATION_LOGS]: `${RouteParams.ModelID}/notification-logs`,
};

export const IncidentsRoutePath: Dictionary<string> = {
  [PageMap.UNRESOLVED_INCIDENTS]: "unresolved",
  [PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK]: "workspace-connection-slack",
  [PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]:
    "workspace-connection-microsoft-teams",
  [PageMap.INCIDENT_CREATE]: "create",

  // Incident Episodes
  [PageMap.INCIDENT_EPISODES]: "episodes",
  [PageMap.UNRESOLVED_INCIDENT_EPISODES]: "episodes/unresolved",
  [PageMap.INCIDENT_EPISODE_CREATE]: "episodes/create",
  [PageMap.INCIDENT_EPISODE_VIEW]: `episodes/${RouteParams.ModelID}`,
  [PageMap.INCIDENT_EPISODE_VIEW_DELETE]: `episodes/${RouteParams.ModelID}/delete`,
  [PageMap.INCIDENT_EPISODE_VIEW_DESCRIPTION]: `episodes/${RouteParams.ModelID}/description`,
  [PageMap.INCIDENT_EPISODE_VIEW_ROOT_CAUSE]: `episodes/${RouteParams.ModelID}/root-cause`,
  [PageMap.INCIDENT_EPISODE_VIEW_POSTMORTEM]: `episodes/${RouteParams.ModelID}/postmortem`,
  [PageMap.INCIDENT_EPISODE_VIEW_REMEDIATION]: `episodes/${RouteParams.ModelID}/remediation`,
  [PageMap.INCIDENT_EPISODE_VIEW_OWNERS]: `episodes/${RouteParams.ModelID}/owners`,
  [PageMap.INCIDENT_EPISODE_VIEW_STATE_TIMELINE]: `episodes/${RouteParams.ModelID}/state-timeline`,
  [PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS]: `episodes/${RouteParams.ModelID}/incidents`,
  [PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE]: `episodes/${RouteParams.ModelID}/internal-notes`,
  [PageMap.INCIDENT_EPISODE_VIEW_MEMBERS]: `episodes/${RouteParams.ModelID}/members`,
  [PageMap.INCIDENT_EPISODE_DOCS]: "episodes/documentation",

  // Incident Settings
  [PageMap.INCIDENTS_SETTINGS_STATE]: "settings/state",
  [PageMap.INCIDENTS_SETTINGS_SEVERITY]: "settings/severity",
  [PageMap.INCIDENTS_SETTINGS_TEMPLATES]: "settings/templates",
  [PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW]: `settings/templates/${RouteParams.ModelID}`,
  [PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES]: "settings/note-templates",
  [PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES_VIEW]: `settings/note-templates/${RouteParams.ModelID}`,
  [PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES]:
    "settings/postmortem-templates",
  [PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES_VIEW]: `settings/postmortem-templates/${RouteParams.ModelID}`,
  [PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS]: "settings/custom-fields",
  [PageMap.INCIDENTS_SETTINGS_GROUPING_RULES]: "settings/grouping-rules",
  [PageMap.INCIDENTS_SETTINGS_SLA_RULES]: "settings/sla-rules",
  [PageMap.INCIDENTS_SETTINGS_ROLES]: "settings/roles",

  [PageMap.INCIDENT_VIEW]: `${RouteParams.ModelID}`,
  [PageMap.INCIDENT_VIEW_STATE_TIMELINE]: `${RouteParams.ModelID}/state-timeline`,
  [PageMap.INCIDENT_VIEW_REMEDIATION]: `${RouteParams.ModelID}/remediation`,
  [PageMap.INCIDENT_VIEW_ROOT_CAUSE]: `${RouteParams.ModelID}/root-cause`,
  [PageMap.INCIDENT_VIEW_POSTMORTEM]: `${RouteParams.ModelID}/postmortem`,
  [PageMap.INCIDENT_VIEW_DESCRIPTION]: `${RouteParams.ModelID}/description`,
  [PageMap.INCIDENT_VIEW_OWNERS]: `${RouteParams.ModelID}/owners`,
  [PageMap.INCIDENT_VIEW_ROLES]: `${RouteParams.ModelID}/roles`,
  [PageMap.INCIDENT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS]: `${RouteParams.ModelID}/on-call-policy-execution-logs`,
  [PageMap.INCIDENT_VIEW_NOTIFICATION_LOGS]: `${RouteParams.ModelID}/notification-logs`,
  [PageMap.INCIDENT_VIEW_AI_LOGS]: `${RouteParams.ModelID}/ai-logs`,
  [PageMap.INCIDENT_VIEW_DELETE]: `${RouteParams.ModelID}/delete`,
  [PageMap.INCIDENT_VIEW_SETTINGS]: `${RouteParams.ModelID}/settings`,
  [PageMap.INCIDENT_VIEW_CUSTOM_FIELDS]: `${RouteParams.ModelID}/custom-fields`,
  [PageMap.INCIDENT_VIEW_INTERNAL_NOTE]: `${RouteParams.ModelID}/internal-notes`,
  [PageMap.INCIDENT_VIEW_PUBLIC_NOTE]: `${RouteParams.ModelID}/public-notes`,
  [PageMap.INCIDENT_VIEW_SLA]: `${RouteParams.ModelID}/sla`,
};

export const AlertsRoutePath: Dictionary<string> = {
  [PageMap.UNRESOLVED_ALERTS]: "unresolved",
  [PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK]: "workspace-connection-slack",
  [PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]:
    "workspace-connection-microsoft-teams",

  // Alert Episodes
  [PageMap.ALERT_EPISODES]: "episodes",
  [PageMap.UNRESOLVED_ALERT_EPISODES]: "episodes/unresolved",
  [PageMap.ALERT_EPISODE_CREATE]: "episodes/create",
  [PageMap.ALERT_EPISODE_VIEW]: `episodes/${RouteParams.ModelID}`,
  [PageMap.ALERT_EPISODE_VIEW_DELETE]: `episodes/${RouteParams.ModelID}/delete`,
  [PageMap.ALERT_EPISODE_VIEW_DESCRIPTION]: `episodes/${RouteParams.ModelID}/description`,
  [PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE]: `episodes/${RouteParams.ModelID}/root-cause`,
  [PageMap.ALERT_EPISODE_VIEW_OWNERS]: `episodes/${RouteParams.ModelID}/owners`,
  [PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE]: `episodes/${RouteParams.ModelID}/state-timeline`,
  [PageMap.ALERT_EPISODE_VIEW_ALERTS]: `episodes/${RouteParams.ModelID}/alerts`,
  [PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE]: `episodes/${RouteParams.ModelID}/internal-notes`,
  [PageMap.ALERT_EPISODE_VIEW_REMEDIATION]: `episodes/${RouteParams.ModelID}/remediation`,
  [PageMap.ALERT_EPISODE_DOCS]: "episodes/documentation",

  // Alert Settings
  [PageMap.ALERTS_SETTINGS_STATE]: "settings/state",
  [PageMap.ALERTS_SETTINGS_SEVERITY]: "settings/severity",
  [PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES]: "settings/note-templates",
  [PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES_VIEW]: `settings/note-templates/${RouteParams.ModelID}`,
  [PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS]: "settings/custom-fields",
  [PageMap.ALERTS_SETTINGS_GROUPING_RULES]: "settings/grouping-rules",

  [PageMap.ALERT_VIEW]: `${RouteParams.ModelID}`,
  [PageMap.ALERT_VIEW_STATE_TIMELINE]: `${RouteParams.ModelID}/state-timeline`,
  [PageMap.ALERT_VIEW_OWNERS]: `${RouteParams.ModelID}/owners`,
  [PageMap.ALERT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS]: `${RouteParams.ModelID}/on-call-policy-execution-logs`,
  [PageMap.ALERT_VIEW_NOTIFICATION_LOGS]: `${RouteParams.ModelID}/notification-logs`,
  [PageMap.ALERT_VIEW_AI_LOGS]: `${RouteParams.ModelID}/ai-logs`,
  [PageMap.ALERT_VIEW_DELETE]: `${RouteParams.ModelID}/delete`,
  [PageMap.ALERT_VIEW_DESCRIPTION]: `${RouteParams.ModelID}/description`,
  [PageMap.ALERT_VIEW_ROOT_CAUSE]: `${RouteParams.ModelID}/root-cause`,
  [PageMap.ALERT_VIEW_REMEDIATION]: `${RouteParams.ModelID}/remediation`,
  [PageMap.ALERT_VIEW_CUSTOM_FIELDS]: `${RouteParams.ModelID}/custom-fields`,
  [PageMap.ALERT_VIEW_INTERNAL_NOTE]: `${RouteParams.ModelID}/internal-notes`,
};

export const ScheduledMaintenanceEventsRoutePath: Dictionary<string> = {
  [PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS]: "ongoing",
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK]:
    "workspace-connection-slack",
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]:
    "workspace-connection-microsoft-teams",
  [PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE]: "create",

  // Scheduled Maintenance Settings
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_STATE]: "settings/state",
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES]:
    "settings/templates",
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES_VIEW]: `settings/templates/${RouteParams.ModelID}`,
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES]:
    "settings/note-templates",
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES_VIEW]: `settings/note-templates/${RouteParams.ModelID}`,
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS]:
    "settings/custom-fields",

  [PageMap.SCHEDULED_MAINTENANCE_VIEW]: `${RouteParams.ModelID}`,
  [PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS]: `${RouteParams.ModelID}/owners`,
  [PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE]: `${RouteParams.ModelID}/state-timeline`,
  [PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE]: `${RouteParams.ModelID}/delete`,
  [PageMap.SCHEDULED_MAINTENANCE_VIEW_DESCRIPTION]: `${RouteParams.ModelID}/description`,
  [PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE]: `${RouteParams.ModelID}/internal-notes`,
  [PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE]: `${RouteParams.ModelID}/public-notes`,
  [PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS]: `${RouteParams.ModelID}/custom-fields`,
  [PageMap.SCHEDULED_MAINTENANCE_VIEW_SETTINGS]: `${RouteParams.ModelID}/settings`,
  [PageMap.SCHEDULED_MAINTENANCE_VIEW_NOTIFICATION_LOGS]: `${RouteParams.ModelID}/notification-logs`,
  [PageMap.SCHEDULED_MAINTENANCE_VIEW_AI_LOGS]: `${RouteParams.ModelID}/ai-logs`,
};

export const SettingsRoutePath: Dictionary<string> = {
  [PageMap.SETTINGS_DANGERZONE]: "danger-zone",
  [PageMap.SETTINGS_NOTIFICATION_SETTINGS]: "notification-settings",
  [PageMap.SETTINGS_NOTIFICATION_LOGS]: "notification-logs",
  [PageMap.SETTINGS_AI_LOGS]: "ai-logs",
  [PageMap.SETTINGS_APIKEYS]: `api-keys`,
  [PageMap.SETTINGS_APIKEY_VIEW]: `api-keys/${RouteParams.ModelID}`,
  [PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS]: `telemetry-ingestion-keys`,
  [PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW]: `telemetry-ingestion-keys/${RouteParams.ModelID}`,
  [PageMap.SETTINGS_SLACK_INTEGRATION]: "slack-integration",
  [PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION]: "microsoft-teams-integration",

  [PageMap.SETTINGS_DOMAINS]: "domains",
  [PageMap.SETTINGS_FEATURE_FLAGS]: "feature-flags",
  [PageMap.SETTINGS_SSO]: "sso",
  [PageMap.SETTINGS_SCIM]: "scim",
  [PageMap.SETTINGS_TEAMS]: "teams",
  [PageMap.SETTINGS_USERS]: "users",
  [PageMap.SETTINGS_USER_VIEW]: `users/${RouteParams.ModelID}`,

  [PageMap.SETTINGS_BILLING]: "billing",
  [PageMap.SETTINGS_BILLING_INVOICES]: "invoices",
  [PageMap.SETTINGS_USAGE_HISTORY]: "usage-history",
  [PageMap.SETTINGS_TEAM_VIEW]: `teams/${RouteParams.ModelID}`,
  [PageMap.SETTINGS_PROBE_VIEW]: `probes/${RouteParams.ModelID}`,
  [PageMap.SETTINGS_LABELS]: "labels",
  [PageMap.SETTINGS_PROBES]: "probes",
  [PageMap.SETTINGS_AI_AGENTS]: "ai-agents",
  [PageMap.SETTINGS_AI_AGENT_VIEW]: `ai-agents/${RouteParams.ModelID}`,
  [PageMap.SETTINGS_LLM_PROVIDERS]: "llm-provider",
  [PageMap.SETTINGS_LLM_PROVIDER_VIEW]: `llm-provider/${RouteParams.ModelID}`,
  [PageMap.SETTINGS_AI_BILLING]: "ai-credits",
};

export const OnCallDutyRoutePath: Dictionary<string> = {
  [PageMap.ON_CALL_DUTY_SCHEDULES]: "schedules",

  // On-Call Duty Settings
  [PageMap.ON_CALL_DUTY_SETTINGS_CUSTOM_FIELDS]: "settings/custom-fields",
  [PageMap.ON_CALL_DUTY_SCHEDULE_VIEW]: `schedules/${RouteParams.ModelID}`,
  [PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE]: `schedules/${RouteParams.ModelID}/delete`,
  [PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS]: `schedules/${RouteParams.ModelID}/layers`,
  [PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_NOTIFICATION_LOGS]: `schedules/${RouteParams.ModelID}/notification-logs`,
  [PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_SETTINGS]: `schedules/${RouteParams.ModelID}/settings`,
  [PageMap.ON_CALL_DUTY_POLICIES]: "policies",
  [PageMap.ON_CALL_DUTY_POLICY_VIEW]: `policies/${RouteParams.ModelID}`,
  [PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE]: `policies/${RouteParams.ModelID}/delete`,
  [PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS]: `policies/${RouteParams.ModelID}/execution-logs`,
  [PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS]: `policies/${RouteParams.ModelID}/custom-fields`,
  [PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW]: `policies/${RouteParams.ModelID}/execution-logs/${RouteParams.SubModelID}`,
  [PageMap.ON_CALL_DUTY_POLICY_VIEW_NOTIFICATION_LOGS]: `policies/${RouteParams.ModelID}/notification-logs`,
  //owners
  [PageMap.ON_CALL_DUTY_POLICY_VIEW_OWNERS]: `policies/${RouteParams.ModelID}/owners`,
  [PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION]: `policies/${RouteParams.ModelID}/escalation`,
  [PageMap.ON_CALL_DUTY_EXECUTION_LOGS]: "execution-logs",
  [PageMap.ON_CALLDUTY_USER_TIME_LOGS]: "user-time-logs",
  [PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES]: "user-overrides",
  [PageMap.ON_CALL_DUTY_POLICY_VIEW_USER_OVERRIDES]: `policies/${RouteParams.ModelID}/user-overrides`,
  [PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE]: `execution-logs/${RouteParams.ModelID}`,
  //slack
  [PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK]:
    "workspace-connection-slack",
  [PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]:
    "workspace-connection-microsoft-teams",

  // Incoming Call Policy
  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES]: "incoming-call-policies",
  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW]: `incoming-call-policies/${RouteParams.ModelID}`,
  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION]: `incoming-call-policies/${RouteParams.ModelID}/escalation`,
  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS]: `incoming-call-policies/${RouteParams.ModelID}/logs`,
  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOG_VIEW]: `incoming-call-policies/${RouteParams.ModelID}/logs/${RouteParams.SubModelID}`,
  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS]: `incoming-call-policies/${RouteParams.ModelID}/settings`,
  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE]: `incoming-call-policies/${RouteParams.ModelID}/delete`,
  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DOCS]: `incoming-call-policies/${RouteParams.ModelID}/docs`,
};

export const MonitorGroupRoutePath: Dictionary<string> = {
  [PageMap.MONITOR_GROUP_VIEW]: `${RouteParams.ModelID}`,
  [PageMap.MONITOR_GROUP_VIEW_OWNERS]: `${RouteParams.ModelID}/owners`,
  [PageMap.MONITOR_GROUP_VIEW_INCIDENTS]: `${RouteParams.ModelID}/incidents`,
  [PageMap.MONITOR_GROUP_VIEW_ALERTS]: `${RouteParams.ModelID}/alerts`,
  [PageMap.MONITOR_GROUP_VIEW_DELETE]: `${RouteParams.ModelID}/delete`,
  [PageMap.MONITOR_GROUP_VIEW_MONITORS]: `${RouteParams.ModelID}/monitors`,
};

export const UserSettingsRoutePath: Dictionary<string> = {
  [PageMap.USER_SETTINGS]: "notification-methods",
  [PageMap.USER_SETTINGS_CUSTOM_FIELDS]: "custom-fields",
  [PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS]: "notification-settings",
  [PageMap.USER_SETTINGS_NOTIFICATION_METHODS]: "notification-methods",
  [PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES]: "incident-on-call-rules",
  [PageMap.USER_SETTINGS_SLACK_INTEGRATION]: "slack-integration",
  [PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION]:
    "microsoft-teams-integration",
  [PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES]: "alert-on-call-rules",
  [PageMap.USER_SETTINGS_EPISODE_ON_CALL_RULES]: "episode-on-call-rules",
  [PageMap.USER_SETTINGS_ON_CALL_LOGS]: "on-call-logs",
  [PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE]: `on-call-logs/${RouteParams.ModelID}`,
  [PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS]:
    "incoming-call-phone-numbers",
};

const RouteMap: Dictionary<Route> = {
  [PageMap.INIT]: new Route(`/dashboard`),

  [PageMap.WELCOME]: new Route(`/dashboard/welcome`),

  [PageMap.PROJECT_SSO]: new Route(`/dashboard/${RouteParams.ProjectID}/sso`),

  [PageMap.INIT_PROJECT]: new Route(`/dashboard/${RouteParams.ProjectID}`),

  [PageMap.HOME]: new Route(`/dashboard/${RouteParams.ProjectID}/home/`),

  [PageMap.HOME_NOT_OPERATIONAL_MONITORS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/home/monitors-inoperational`,
  ),

  [PageMap.HOME_ACTIVE_ALERTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/home/active-alerts`,
  ),

  [PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/home/scheduled-maintenance-ongoing`,
  ),

  [PageMap.HOME_ACTIVE_EPISODES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/home/active-episodes`,
  ),

  [PageMap.HOME_ACTIVE_INCIDENT_EPISODES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/home/active-incident-episodes`,
  ),

  [PageMap.MONITORS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/*`,
  ),
  [PageMap.MONITORS]: new Route(`/dashboard/${RouteParams.ProjectID}/monitors`),

  [PageMap.MONITORS_INOPERATIONAL]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITORS_INOPERATIONAL]
    }`,
  ),

  [PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK]
    }`,
  ),

  [PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]
    }`,
  ),

  [PageMap.MONITOR_CREATE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_CREATE]
    }`,
  ),

  [PageMap.MONITORS_DISABLED]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITORS_DISABLED]
    }`,
  ),

  [PageMap.MONITORS_PROBE_DISABLED]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITORS_PROBE_DISABLED]
    }`,
  ),

  [PageMap.MONITORS_PROBE_DISCONNECTED]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITORS_PROBE_DISCONNECTED]
    }`,
  ),

  [PageMap.MONITOR_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW]
    }`,
  ),

  [PageMap.MONITOR_VIEW_INTERVAL]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_INTERVAL]
    }`,
  ),

  [PageMap.MONITOR_VIEW_DOCUMENTATION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_DOCUMENTATION]
    }`,
  ),

  [PageMap.MONITOR_VIEW_OWNERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_OWNERS]
    }`,
  ),

  [PageMap.MONITOR_VIEW_STATUS_TIMELINE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_STATUS_TIMELINE]
    }`,
  ),

  [PageMap.MONITOR_VIEW_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_CUSTOM_FIELDS]
    }`,
  ),

  [PageMap.MONITOR_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_DELETE]
    }`,
  ),

  [PageMap.MONITOR_VIEW_INCIDENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_INCIDENTS]
    }`,
  ),

  [PageMap.MONITOR_VIEW_ALERTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_ALERTS]
    }`,
  ),

  [PageMap.MONITOR_VIEW_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_SETTINGS]
    }`,
  ),

  [PageMap.MONITOR_VIEW_PROBES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_PROBES]
    }`,
  ),

  [PageMap.MONITOR_VIEW_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_LOGS]
    }`,
  ),

  [PageMap.MONITOR_VIEW_CRITERIA]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_CRITERIA]
    }`,
  ),

  [PageMap.MONITOR_VIEW_METRICS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITOR_VIEW_METRICS]
    }`,
  ),

  // Monitor Settings Routes
  [PageMap.MONITORS_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITORS_SETTINGS]
    }`,
  ),

  [PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS]
    }`,
  ),

  [PageMap.MONITORS_SETTINGS_SECRETS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitors/${
      MonitorsRoutePath[PageMap.MONITORS_SETTINGS_SECRETS]
    }`,
  ),

  [PageMap.ALERTS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/*`,
  ),

  [PageMap.ALERTS]: new Route(`/dashboard/${RouteParams.ProjectID}/alerts`),

  [PageMap.UNRESOLVED_ALERTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.UNRESOLVED_ALERTS]
    }`,
  ),

  [PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK]
    }`,
  ),

  [PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]
    }`,
  ),

  [PageMap.ALERT_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW]
    }`,
  ),

  [PageMap.ALERT_VIEW_STATE_TIMELINE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW_STATE_TIMELINE]
    }`,
  ),

  [PageMap.ALERT_VIEW_OWNERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW_OWNERS]
    }`,
  ),

  [PageMap.ALERT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS]
    }`,
  ),

  [PageMap.ALERT_VIEW_NOTIFICATION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW_NOTIFICATION_LOGS]
    }`,
  ),

  [PageMap.ALERT_VIEW_AI_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW_AI_LOGS]
    }`,
  ),

  [PageMap.ALERT_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW_DELETE]
    }`,
  ),

  [PageMap.ALERT_VIEW_DESCRIPTION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW_DESCRIPTION]
    }`,
  ),

  [PageMap.ALERT_VIEW_ROOT_CAUSE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW_ROOT_CAUSE]
    }`,
  ),

  [PageMap.ALERT_VIEW_REMEDIATION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW_REMEDIATION]
    }`,
  ),

  [PageMap.ALERT_VIEW_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW_CUSTOM_FIELDS]
    }`,
  ),

  [PageMap.ALERT_VIEW_INTERNAL_NOTE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_VIEW_INTERNAL_NOTE]
    }`,
  ),

  // Alert Settings Routes
  [PageMap.ALERTS_SETTINGS_STATE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERTS_SETTINGS_STATE]
    }`,
  ),

  [PageMap.ALERTS_SETTINGS_SEVERITY]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERTS_SETTINGS_SEVERITY]
    }`,
  ),

  [PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES]
    }`,
  ),

  [PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES_VIEW]
    }`,
  ),

  [PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS]
    }`,
  ),

  [PageMap.ALERTS_SETTINGS_GROUPING_RULES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERTS_SETTINGS_GROUPING_RULES]
    }`,
  ),

  // Alert Episodes
  [PageMap.ALERT_EPISODES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODES]
    }`,
  ),

  [PageMap.UNRESOLVED_ALERT_EPISODES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.UNRESOLVED_ALERT_EPISODES]
    }`,
  ),

  [PageMap.ALERT_EPISODE_CREATE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODE_CREATE]
    }`,
  ),

  [PageMap.ALERT_EPISODE_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODE_VIEW]
    }`,
  ),

  [PageMap.ALERT_EPISODE_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODE_VIEW_DELETE]
    }`,
  ),

  [PageMap.ALERT_EPISODE_VIEW_DESCRIPTION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODE_VIEW_DESCRIPTION]
    }`,
  ),

  [PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE]
    }`,
  ),

  [PageMap.ALERT_EPISODE_VIEW_OWNERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODE_VIEW_OWNERS]
    }`,
  ),

  [PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE]
    }`,
  ),

  [PageMap.ALERT_EPISODE_VIEW_ALERTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODE_VIEW_ALERTS]
    }`,
  ),

  [PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE]
    }`,
  ),

  [PageMap.ALERT_EPISODE_VIEW_REMEDIATION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODE_VIEW_REMEDIATION]
    }`,
  ),

  [PageMap.ALERT_EPISODE_DOCS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/alerts/${
      AlertsRoutePath[PageMap.ALERT_EPISODE_DOCS]
    }`,
  ),

  // Incidents

  [PageMap.INCIDENTS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/*`,
  ),

  [PageMap.INCIDENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents`,
  ),

  [PageMap.UNRESOLVED_INCIDENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.UNRESOLVED_INCIDENTS]
    }`,
  ),

  [PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK]
    }`,
  ),

  [PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]
    }`,
  ),

  [PageMap.INCIDENT_CREATE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_CREATE]
    }`,
  ),

  // Incident Episodes
  [PageMap.INCIDENT_EPISODES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODES]
    }`,
  ),

  [PageMap.UNRESOLVED_INCIDENT_EPISODES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.UNRESOLVED_INCIDENT_EPISODES]
    }`,
  ),

  [PageMap.INCIDENT_EPISODE_CREATE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_CREATE]
    }`,
  ),

  [PageMap.INCIDENT_EPISODE_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW]
    }`,
  ),

  [PageMap.INCIDENT_EPISODE_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW_DELETE]
    }`,
  ),

  [PageMap.INCIDENT_EPISODE_VIEW_DESCRIPTION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW_DESCRIPTION]
    }`,
  ),

  [PageMap.INCIDENT_EPISODE_VIEW_ROOT_CAUSE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW_ROOT_CAUSE]
    }`,
  ),

  [PageMap.INCIDENT_EPISODE_VIEW_POSTMORTEM]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW_POSTMORTEM]
    }`,
  ),

  [PageMap.INCIDENT_EPISODE_VIEW_REMEDIATION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW_REMEDIATION]
    }`,
  ),

  [PageMap.INCIDENT_EPISODE_VIEW_OWNERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW_OWNERS]
    }`,
  ),

  [PageMap.INCIDENT_EPISODE_VIEW_STATE_TIMELINE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW_STATE_TIMELINE]
    }`,
  ),

  [PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS]
    }`,
  ),

  [PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE]
    }`,
  ),
  [PageMap.INCIDENT_EPISODE_VIEW_MEMBERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_VIEW_MEMBERS]
    }`,
  ),
  [PageMap.INCIDENT_EPISODE_DOCS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_EPISODE_DOCS]
    }`,
  ),

  [PageMap.USER_PROFILE_OVERVIEW]: new Route(
    `/dashboard/user-profile/overview`,
  ),
  [PageMap.USER_PROFILE_PASSWORD]: new Route(
    `/dashboard/user-profile/password-management`,
  ),
  [PageMap.USER_TWO_FACTOR_AUTH]: new Route(
    `/dashboard/user-profile/two-factor-auth`,
  ),
  [PageMap.USER_PROFILE_PICTURE]: new Route(
    `/dashboard/user-profile/profile-picture`,
  ),
  [PageMap.USER_PROFILE_DELETE]: new Route(
    `/dashboard/user-profile/delete-account`,
  ),

  [PageMap.ACTIVE_INCIDENTS]: new Route(`/dashboard/active-incidents`),

  [PageMap.ACTIVE_ALERTS]: new Route(`/dashboard/active-alerts`),

  [PageMap.PROJECT_INVITATIONS]: new Route(`/dashboard/project-invitations`),

  [PageMap.INCIDENT_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_STATE_TIMELINE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_STATE_TIMELINE]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_REMEDIATION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_REMEDIATION]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_ROOT_CAUSE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_ROOT_CAUSE]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_POSTMORTEM]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_POSTMORTEM]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_DESCRIPTION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_DESCRIPTION]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_OWNERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_OWNERS]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_ROLES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_ROLES]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_NOTIFICATION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_NOTIFICATION_LOGS]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_AI_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_AI_LOGS]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_DELETE]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_SETTINGS]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_CUSTOM_FIELDS]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_INTERNAL_NOTE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_INTERNAL_NOTE]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_PUBLIC_NOTE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_PUBLIC_NOTE]
    }`,
  ),

  [PageMap.INCIDENT_VIEW_SLA]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENT_VIEW_SLA]
    }`,
  ),

  // Incident Settings Routes
  [PageMap.INCIDENTS_SETTINGS_STATE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_STATE]
    }`,
  ),

  [PageMap.INCIDENTS_SETTINGS_SEVERITY]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_SEVERITY]
    }`,
  ),

  [PageMap.INCIDENTS_SETTINGS_TEMPLATES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_TEMPLATES]
    }`,
  ),

  [PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW]
    }`,
  ),

  [PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES]
    }`,
  ),

  [PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES_VIEW]
    }`,
  ),

  [PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES]
    }`,
  ),

  [PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES_VIEW]
    }`,
  ),

  [PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS]
    }`,
  ),

  [PageMap.INCIDENTS_SETTINGS_GROUPING_RULES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_GROUPING_RULES]
    }`,
  ),

  [PageMap.INCIDENTS_SETTINGS_SLA_RULES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_SLA_RULES]
    }`,
  ),

  [PageMap.INCIDENTS_SETTINGS_ROLES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/incidents/${
      IncidentsRoutePath[PageMap.INCIDENTS_SETTINGS_ROLES]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/*`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_EVENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events`,
  ),

  [PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]:
    new Route(
      `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
        ScheduledMaintenanceEventsRoutePath[
          PageMap
            .SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
        ]
      }`,
    ),

  [PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[PageMap.SCHEDULED_MAINTENANCE_VIEW]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_VIEW_DESCRIPTION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_VIEW_DESCRIPTION
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_VIEW_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_VIEW_SETTINGS
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_VIEW_NOTIFICATION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_VIEW_NOTIFICATION_LOGS
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_VIEW_AI_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_VIEW_AI_LOGS
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE
      ]
    }`,
  ),

  // Scheduled Maintenance Settings Routes
  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_STATE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_STATE
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES_VIEW
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES
      ]
    }`,
  ),

  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES_VIEW]:
    new Route(
      `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
        ScheduledMaintenanceEventsRoutePath[
          PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES_VIEW
        ]
      }`,
    ),

  [PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/scheduled-maintenance-events/${
      ScheduledMaintenanceEventsRoutePath[
        PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS
      ]
    }`,
  ),

  [PageMap.SERVICE_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/*`,
  ),

  [PageMap.SERVICES]: new Route(`/dashboard/${RouteParams.ProjectID}/service`),

  // Root-level Service pages
  [PageMap.SERVICE_DEPENDENCY_GRAPH]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/dependency-graph`,
  ),

  [PageMap.SERVICE_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW]
    }`,
  ),

  [PageMap.SERVICE_VIEW_OWNERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW_OWNERS]
    }`,
  ),

  [PageMap.SERVICE_VIEW_DEPENDENCIES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW_DEPENDENCIES]
    }`,
  ),

  [PageMap.SERVICE_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW_DELETE]
    }`,
  ),

  [PageMap.SERVICE_VIEW_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW_SETTINGS]
    }`,
  ),

  [PageMap.SERVICE_VIEW_MONITORS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW_MONITORS]
    }`,
  ),

  [PageMap.SERVICE_VIEW_INCIDENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW_INCIDENTS]
    }`,
  ),

  [PageMap.SERVICE_VIEW_ALERTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW_ALERTS]
    }`,
  ),

  [PageMap.SERVICE_VIEW_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW_LOGS]
    }`,
  ),

  [PageMap.SERVICE_VIEW_TRACES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW_TRACES]
    }`,
  ),

  [PageMap.SERVICE_VIEW_METRICS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW_METRICS]
    }`,
  ),

  [PageMap.SERVICE_VIEW_CODE_REPOSITORIES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/service/${
      ServiceRoutePath[PageMap.SERVICE_VIEW_CODE_REPOSITORIES]
    }`,
  ),

  // Code Repository

  [PageMap.CODE_REPOSITORY_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/code-repository/*`,
  ),

  [PageMap.CODE_REPOSITORY]: new Route(
    `/dashboard/${RouteParams.ProjectID}/code-repository`,
  ),

  [PageMap.CODE_REPOSITORY_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/code-repository/${
      CodeRepositoryRoutePath[PageMap.CODE_REPOSITORY_VIEW]
    }`,
  ),

  [PageMap.CODE_REPOSITORY_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/code-repository/${
      CodeRepositoryRoutePath[PageMap.CODE_REPOSITORY_VIEW_DELETE]
    }`,
  ),

  [PageMap.CODE_REPOSITORY_VIEW_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/code-repository/${
      CodeRepositoryRoutePath[PageMap.CODE_REPOSITORY_VIEW_SETTINGS]
    }`,
  ),

  [PageMap.CODE_REPOSITORY_VIEW_SERVICES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/code-repository/${
      CodeRepositoryRoutePath[PageMap.CODE_REPOSITORY_VIEW_SERVICES]
    }`,
  ),

  // Dashboards

  [PageMap.DASHBOARDS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/dashboards/*`,
  ),

  [PageMap.DASHBOARDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/dashboards`,
  ),

  [PageMap.DASHBOARD_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/dashboards/${
      DashboardsRoutePath[PageMap.DASHBOARD_VIEW]
    }`,
  ),

  [PageMap.DASHBOARD_VIEW_OVERVIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/dashboards/${
      DashboardsRoutePath[PageMap.DASHBOARD_VIEW_OVERVIEW]
    }`,
  ),

  [PageMap.DASHBOARD_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/dashboards/${
      DashboardsRoutePath[PageMap.DASHBOARD_VIEW_DELETE]
    }`,
  ),

  [PageMap.DASHBOARD_VIEW_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/dashboards/${
      DashboardsRoutePath[PageMap.DASHBOARD_VIEW_SETTINGS]
    }`,
  ),

  // Status Pages

  [PageMap.STATUS_PAGES_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/*`,
  ),

  [PageMap.STATUS_PAGES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages`,
  ),

  [PageMap.STATUS_PAGE_ANNOUNCEMENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_ANNOUNCEMENTS]
    }`,
  ),

  [PageMap.ANNOUNCEMENT_CREATE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.ANNOUNCEMENT_CREATE]
    }`,
  ),

  [PageMap.ANNOUNCEMENT_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.ANNOUNCEMENT_VIEW]
    }`,
  ),

  [PageMap.ANNOUNCEMENT_VIEW_NOTIFICATION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.ANNOUNCEMENT_VIEW_NOTIFICATION_LOGS]
    }`,
  ),

  [PageMap.ANNOUNCEMENT_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.ANNOUNCEMENT_VIEW_DELETE]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_BRANDING]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_BRANDING]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_OWNERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_OWNERS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_REPORTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_REPORTS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_GROUPS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_GROUPS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_DELETE]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_DOMAINS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_DOMAINS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_SLACK_SUBSCRIBERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_SLACK_SUBSCRIBERS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_MICROSOFT_TEAMS_SUBSCRIBERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_MICROSOFT_TEAMS_SUBSCRIBERS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_HEADER_STYLE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_HEADER_STYLE]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_OVERVIEW_PAGE_BRANDING]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_OVERVIEW_PAGE_BRANDING]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_EMBEDDED]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_EMBEDDED]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_SSO]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_SSO]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_SCIM]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_SCIM]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_RESOURCES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_RESOURCES]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_SETTINGS]
    }`,
  ),

  [PageMap.STATUS_PAGE_VIEW_NOTIFICATION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGE_VIEW_NOTIFICATION_LOGS]
    }`,
  ),

  // Status Pages Settings Routes
  [PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES]
    }`,
  ),

  [PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[
        PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES_VIEW
      ]
    }`,
  ),

  [PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[
        PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES
      ]
    }`,
  ),

  [PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES_VIEW]:
    new Route(
      `/dashboard/${RouteParams.ProjectID}/status-pages/${
        StatusPagesRoutePath[
          PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES_VIEW
        ]
      }`,
    ),

  [PageMap.STATUS_PAGES_SETTINGS_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/status-pages/${
      StatusPagesRoutePath[PageMap.STATUS_PAGES_SETTINGS_CUSTOM_FIELDS]
    }`,
  ),

  [PageMap.AUTOMATION_SCRIPTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/automation-scripts/`,
  ),

  [PageMap.ON_CALL_DUTY_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/*`,
  ),

  [PageMap.ON_CALL_DUTY]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/policies`,
  ),

  [PageMap.ON_CALL_DUTY_SCHEDULES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SCHEDULES]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_SCHEDULE_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_NOTIFICATION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_NOTIFICATION_LOGS]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_SETTINGS]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_POLICIES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/policies`,
  ),

  [PageMap.ON_CALL_DUTY_EXECUTION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_EXECUTION_LOGS]
    }`,
  ),

  [PageMap.ON_CALLDUTY_USER_TIME_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALLDUTY_USER_TIME_LOGS]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES]}`,
  ),

  [PageMap.ON_CALL_DUTY_POLICY_VIEW_USER_OVERRIDES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_VIEW_USER_OVERRIDES]
    }`,
  ),

  // on call policy owners.
  [PageMap.ON_CALL_DUTY_POLICY_VIEW_OWNERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_VIEW_OWNERS]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_POLICY_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_VIEW]
    }`,
  ),

  // on call slack
  [PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[
        PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
      ]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_POLICY_VIEW_NOTIFICATION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_VIEW_NOTIFICATION_LOGS]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION]
    }`,
  ),

  // On-Call Duty Settings Routes
  [PageMap.ON_CALL_DUTY_SETTINGS_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_SETTINGS_CUSTOM_FIELDS]
    }`,
  ),

  // Incoming Call Policy Routes
  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[
        PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION
      ]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOG_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[
        PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOG_VIEW
      ]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[
        PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS
      ]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE]
    }`,
  ),

  [PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DOCS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/on-call-duty/${
      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DOCS]
    }`,
  ),

  [PageMap.REPORTS]: new Route(`/dashboard/${RouteParams.ProjectID}/reports/`),

  [PageMap.ERROR_TRACKER]: new Route(
    `/dashboard/${RouteParams.ProjectID}/error-tracker/`,
  ),

  // Logs Product Routes
  [PageMap.LOGS_ROOT]: new Route(`/dashboard/${RouteParams.ProjectID}/logs/*`),

  [PageMap.LOGS]: new Route(`/dashboard/${RouteParams.ProjectID}/logs`),

  // Metrics Product Routes
  [PageMap.METRICS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/metrics/*`,
  ),

  [PageMap.METRICS]: new Route(`/dashboard/${RouteParams.ProjectID}/metrics`),

  [PageMap.METRIC_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/metrics/${
      MetricsRoutePath[PageMap.METRIC_VIEW]
    }`,
  ),

  // Traces Product Routes
  [PageMap.TRACES_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/traces/*`,
  ),

  [PageMap.TRACES]: new Route(`/dashboard/${RouteParams.ProjectID}/traces`),

  [PageMap.TRACE_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/traces/${
      TracesRoutePath[PageMap.TRACE_VIEW]
    }`,
  ),

  // User Settings Routes
  [PageMap.USER_SETTINGS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/*`,
  ),

  [PageMap.USER_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS]
    }`,
  ),

  [PageMap.USER_SETTINGS_CUSTOM_FIELDS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS_CUSTOM_FIELDS]
    }`,
  ),

  [PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS]
    }`,
  ),

  [PageMap.USER_SETTINGS_NOTIFICATION_METHODS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS_NOTIFICATION_METHODS]
    }`,
  ),

  [PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES]
    }`,
  ),

  [PageMap.USER_SETTINGS_SLACK_INTEGRATION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS_SLACK_INTEGRATION]
    }`,
  ),

  [PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION]
    }`,
  ),

  [PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES]
    }`,
  ),

  [PageMap.USER_SETTINGS_EPISODE_ON_CALL_RULES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS_EPISODE_ON_CALL_RULES]
    }`,
  ),

  [PageMap.USER_SETTINGS_ON_CALL_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS_ON_CALL_LOGS]
    }`,
  ),

  [PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE]
    }`,
  ),

  [PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/user-settings/${
      UserSettingsRoutePath[PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS]
    }`,
  ),

  // Settings Routes
  [PageMap.SETTINGS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/*`,
  ),

  [PageMap.SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/`,
  ),
  [PageMap.SETTINGS_DANGERZONE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_DANGERZONE]
    }`,
  ),

  [PageMap.SETTINGS_NOTIFICATION_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_NOTIFICATION_SETTINGS]
    }`,
  ),

  [PageMap.SETTINGS_NOTIFICATION_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_NOTIFICATION_LOGS]
    }`,
  ),

  [PageMap.SETTINGS_AI_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_AI_LOGS]
    }`,
  ),

  [PageMap.SETTINGS_APIKEYS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_APIKEYS]
    }`,
  ),

  [PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS]
    }`,
  ),

  [PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW]
    }`,
  ),

  [PageMap.SETTINGS_APIKEY_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_APIKEY_VIEW]
    }`,
  ),

  [PageMap.SETTINGS_SLACK_INTEGRATION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_SLACK_INTEGRATION]
    }`,
  ),

  [PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION]
    }`,
  ),

  [PageMap.SETTINGS_DOMAINS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_DOMAINS]
    }`,
  ),

  [PageMap.SETTINGS_FEATURE_FLAGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_FEATURE_FLAGS]
    }`,
  ),

  [PageMap.SETTINGS_SSO]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_SSO]
    }`,
  ),

  [PageMap.SETTINGS_SCIM]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_SCIM]
    }`,
  ),

  [PageMap.SETTINGS_TEAMS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_TEAMS]
    }`,
  ),

  [PageMap.SETTINGS_USERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_USERS]
    }`,
  ),

  [PageMap.SETTINGS_USER_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_USER_VIEW]
    }`,
  ),

  [PageMap.SETTINGS_BILLING]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_BILLING]
    }`,
  ),

  [PageMap.SETTINGS_BILLING_INVOICES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_BILLING_INVOICES]
    }`,
  ),

  [PageMap.SETTINGS_USAGE_HISTORY]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_USAGE_HISTORY]
    }`,
  ),

  [PageMap.SETTINGS_TEAM_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_TEAM_VIEW]
    }`,
  ),

  [PageMap.SETTINGS_PROBE_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_PROBE_VIEW]
    }`,
  ),

  // labels.
  [PageMap.SETTINGS_LABELS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_LABELS]
    }`,
  ),

  // Probes.
  [PageMap.SETTINGS_PROBES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_PROBES]
    }`,
  ),

  // AI Agents.
  [PageMap.SETTINGS_AI_AGENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_AI_AGENTS]
    }`,
  ),
  [PageMap.SETTINGS_AI_AGENT_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_AI_AGENT_VIEW]
    }`,
  ),

  // LLM Providers.
  [PageMap.SETTINGS_LLM_PROVIDERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_LLM_PROVIDERS]
    }`,
  ),
  [PageMap.SETTINGS_LLM_PROVIDER_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_LLM_PROVIDER_VIEW]
    }`,
  ),

  // AI Billing
  [PageMap.SETTINGS_AI_BILLING]: new Route(
    `/dashboard/${RouteParams.ProjectID}/settings/${
      SettingsRoutePath[PageMap.SETTINGS_AI_BILLING]
    }`,
  ),

  // workflows.
  [PageMap.WORKFLOWS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/workflows/*`,
  ),
  [PageMap.WORKFLOWS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/workflows`,
  ),

  [PageMap.WORKFLOWS_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/workflows/${
      WorkflowRoutePath[PageMap.WORKFLOWS_LOGS]
    }`,
  ),

  [PageMap.WORKFLOWS_VARIABLES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/workflows/${
      WorkflowRoutePath[PageMap.WORKFLOWS_VARIABLES]
    }`,
  ),

  [PageMap.WORKFLOW_VARIABLES]: new Route(
    `/dashboard/${RouteParams.ProjectID}/workflows/${
      WorkflowRoutePath[PageMap.WORKFLOW_VARIABLES]
    }`,
  ),

  [PageMap.WORKFLOW_BUILDER]: new Route(
    `/dashboard/${RouteParams.ProjectID}/workflows/${
      WorkflowRoutePath[PageMap.WORKFLOW_BUILDER]
    }`,
  ),

  [PageMap.WORKFLOW_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/workflows/${
      WorkflowRoutePath[PageMap.WORKFLOW_VIEW]
    }`,
  ),

  [PageMap.WORKFLOW_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/workflows/${
      WorkflowRoutePath[PageMap.WORKFLOW_LOGS]
    }`,
  ),

  [PageMap.WORKFLOW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/workflows/${
      WorkflowRoutePath[PageMap.WORKFLOW_DELETE]
    }`,
  ),

  [PageMap.WORKFLOW_VIEW_SETTINGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/workflows/${
      WorkflowRoutePath[PageMap.WORKFLOW_VIEW_SETTINGS]
    }`,
  ),

  // logout.
  [PageMap.LOGOUT]: new Route(`/dashboard/logout`),

  [PageMap.MONITOR_GROUPS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitor-groups/*`,
  ),

  [PageMap.MONITOR_GROUPS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitor-groups`,
  ),

  [PageMap.MONITOR_GROUP_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitor-groups/${
      MonitorGroupRoutePath[PageMap.MONITOR_GROUP_VIEW]
    }`,
  ),

  [PageMap.MONITOR_GROUP_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitor-groups/${
      MonitorGroupRoutePath[PageMap.MONITOR_GROUP_VIEW_DELETE]
    }`,
  ),

  [PageMap.MONITOR_GROUP_VIEW_MONITORS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitor-groups/${
      MonitorGroupRoutePath[PageMap.MONITOR_GROUP_VIEW_MONITORS]
    }`,
  ),

  [PageMap.MONITOR_GROUP_VIEW_OWNERS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitor-groups/${
      MonitorGroupRoutePath[PageMap.MONITOR_GROUP_VIEW_OWNERS]
    }`,
  ),

  [PageMap.MONITOR_GROUP_VIEW_INCIDENTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitor-groups/${
      MonitorGroupRoutePath[PageMap.MONITOR_GROUP_VIEW_INCIDENTS]
    }`,
  ),

  [PageMap.MONITOR_GROUP_VIEW_ALERTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/monitor-groups/${
      MonitorGroupRoutePath[PageMap.MONITOR_GROUP_VIEW_ALERTS]
    }`,
  ),

  // AI Agent Tasks
  [PageMap.AI_AGENT_TASKS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/ai-agent-tasks/*`,
  ),

  [PageMap.AI_AGENT_TASKS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/ai-agent-tasks`,
  ),

  [PageMap.AI_AGENT_TASK_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/ai-agent-tasks/${
      AIAgentTasksRoutePath[PageMap.AI_AGENT_TASK_VIEW]
    }`,
  ),

  [PageMap.AI_AGENT_TASK_VIEW_LOGS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/ai-agent-tasks/${
      AIAgentTasksRoutePath[PageMap.AI_AGENT_TASK_VIEW_LOGS]
    }`,
  ),

  [PageMap.AI_AGENT_TASK_VIEW_PULL_REQUESTS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/ai-agent-tasks/${
      AIAgentTasksRoutePath[PageMap.AI_AGENT_TASK_VIEW_PULL_REQUESTS]
    }`,
  ),

  [PageMap.AI_AGENT_TASK_VIEW_DELETE]: new Route(
    `/dashboard/${RouteParams.ProjectID}/ai-agent-tasks/${
      AIAgentTasksRoutePath[PageMap.AI_AGENT_TASK_VIEW_DELETE]
    }`,
  ),

  // Exceptions (standalone menu item)
  [PageMap.EXCEPTIONS_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/exceptions/*`,
  ),

  [PageMap.EXCEPTIONS]: new Route(
    `/dashboard/${RouteParams.ProjectID}/exceptions/${
      ExceptionsRoutePath[PageMap.EXCEPTIONS]
    }`,
  ),

  [PageMap.EXCEPTIONS_UNRESOLVED]: new Route(
    `/dashboard/${RouteParams.ProjectID}/exceptions/${
      ExceptionsRoutePath[PageMap.EXCEPTIONS_UNRESOLVED]
    }`,
  ),

  [PageMap.EXCEPTIONS_RESOLVED]: new Route(
    `/dashboard/${RouteParams.ProjectID}/exceptions/${
      ExceptionsRoutePath[PageMap.EXCEPTIONS_RESOLVED]
    }`,
  ),

  [PageMap.EXCEPTIONS_ARCHIVED]: new Route(
    `/dashboard/${RouteParams.ProjectID}/exceptions/${
      ExceptionsRoutePath[PageMap.EXCEPTIONS_ARCHIVED]
    }`,
  ),

  [PageMap.EXCEPTIONS_VIEW_ROOT]: new Route(
    `/dashboard/${RouteParams.ProjectID}/exceptions`,
  ),

  [PageMap.EXCEPTIONS_VIEW]: new Route(
    `/dashboard/${RouteParams.ProjectID}/exceptions/${
      ExceptionsRoutePath[PageMap.EXCEPTIONS_VIEW]
    }`,
  ),
};

export class RouteUtil {
  public static isGlobalRoute(route: Route): boolean {
    if (
      route.toString() ===
        RouteMap[PageMap.USER_PROFILE_OVERVIEW]?.toString() ||
      route.toString() ===
        RouteMap[PageMap.USER_PROFILE_PASSWORD]?.toString() ||
      route.toString() === RouteMap[PageMap.USER_PROFILE_PICTURE]?.toString() ||
      route.toString() === RouteMap[PageMap.USER_PROFILE_DELETE]?.toString() ||
      route.toString() === RouteMap[PageMap.PROJECT_INVITATIONS]?.toString() ||
      route.toString() === RouteMap[PageMap.ACTIVE_INCIDENTS]?.toString()
    ) {
      return true;
    }
    return false;
  }

  public static populateRouteParams(
    route: Route,
    props?: {
      modelId?: ObjectID | string | undefined;
      subModelId?: ObjectID | string | undefined;
    },
  ): Route {
    // populate projectid
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    const tempRoute: Route = new Route(route.toString());

    if (projectId) {
      route = tempRoute.addRouteParam(
        RouteParams.ProjectID,
        projectId?.toString(),
      );
    }

    if (props && props.modelId) {
      route = tempRoute.addRouteParam(
        RouteParams.ModelID,
        props.modelId.toString(),
      );
    }

    if (props && props.subModelId) {
      route = tempRoute.addRouteParam(
        RouteParams.SubModelID,
        props.subModelId.toString(),
      );
    }

    return tempRoute;
  }

  public static getRoutes(): Array<{ path: string }> {
    return Object.values(RouteMap).map((route: Route) => {
      return {
        path: route.toString(),
      };
    });
  }

  public static getRouteString(key: string): string {
    return RouteMap[key]?.toString() || "";
  }

  public static getLastPath(path: string): string {
    const paths: string[] = path.split("/");
    return paths[paths.length - 1] || "";
  }

  public static getLastPathForKey(key: string, count: number = 1): string {
    const routePath: string = RouteMap[key]?.toString() || "";
    const paths: string[] = routePath.split("/");
    if (count === 1) {
      return paths[paths.length - 1] || "";
    }
    return paths.splice(paths.length - count, count).join("/");
  }
}

export default RouteMap;
