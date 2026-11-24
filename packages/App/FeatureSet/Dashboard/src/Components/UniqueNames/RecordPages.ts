import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { GetRecordPageRoute } from "Common/UI/Components/RecordPage/RecordPageContext";

/*
 * WHERE A RECORD OF A KIND WITH A NAME OF ITS OWN IS OPENED (#10761).
 *
 * A form that warns its name is another record's links to that record
 * (DuplicateNameNotice), and Project Settings links each record of a name
 * the project holds twice, for renaming. A kind with a page of its own is
 * opened there; a kind whose records live in a list (budgets, connections,
 * calendars) opens its list, where the record is found by its name. A kind
 * named here with neither is named without a link.
 *
 * Covers every kind Require Unique Names holds that the Dashboard shows -
 * RequiredUniqueNamesRecordPages (Dashboard tests) holds the list to the
 * models - and the kinds unique always that people open most.
 */

interface RecordPage {
  // The record's own page, its id in the route.
  view?: PageMap | undefined;
  // Else the list it is found in.
  list?: PageMap | undefined;
}

export const RECORD_PAGES: Readonly<Record<string, RecordPage>> = {
  // Held by Require Unique Names.
  Monitor: { view: PageMap.MONITOR_VIEW },
  MonitorGroup: { view: PageMap.MONITOR_GROUP_VIEW },
  Probe: { view: PageMap.MONITORS_SETTINGS_PROBE_VIEW },
  ServiceLevelObjective: { view: PageMap.SLO_VIEW },
  IncomingCallPolicy: { view: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW },
  VideoCallConnection: { list: PageMap.SETTINGS_VIDEO_CALLS },
  CustomRole: { view: PageMap.TEAM_ROLE_VIEW },
  ApiKey: { view: PageMap.SETTINGS_APIKEY_VIEW },
  TelemetryIngestionKey: {
    view: PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW,
  },
  LogPipeline: { view: PageMap.LOGS_SETTINGS_PIPELINE_VIEW },
  TracePipeline: { view: PageMap.TRACES_SETTINGS_PIPELINE_VIEW },
  CloudBudget: { list: PageMap.CLOUD_BUDGETS },
  DataProduct: { view: PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW },
  DataReconciliation: { list: PageMap.DATA_OBSERVABILITY_RECONCILIATIONS },
  DataSecurityCustomDataType: {
    list: PageMap.DATA_SECURITY_SETTINGS_DATA_TYPES,
  },
  SecurityAutomaticResponsePolicy: {
    list: PageMap.SECURITY_AUTOMATIC_RESPONSE,
  },
  SecurityBlocklistFeed: { view: PageMap.SECURITY_BLOCKLIST_FEED_VIEW },
  SecurityEventConnection: { list: PageMap.SECURITY_EVENTS_CONNECTIONS },
  SecurityHunt: { view: PageMap.SECURITY_EVENTS_HUNT_VIEW },
  SecurityPlaybook: { view: PageMap.SECURITY_PLAYBOOK_VIEW },
  ThreatIntelFeed: { list: PageMap.SECURITY_EVENTS_THREAT_INTEL },
  NetworkDeviceDiscoveryScan: { list: PageMap.NETWORK_DEVICE_DISCOVERY },
  ExternalMcpServer: { view: PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVER_VIEW },
  LlmProvider: { view: PageMap.SETTINGS_AI_LLM_PROVIDER_VIEW },
  LlmCostBudget: { list: PageMap.LLM_BUDGETS },
  AuditLogExport: { list: PageMap.SETTINGS_AUDIT_LOGS_EXPORT },
  AlertNoteTemplate: { view: PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES_VIEW },
  IncidentTemplate: { view: PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW },
  IncidentPostmortemTemplate: {
    view: PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES_VIEW,
  },
  IncidentNoteTemplate: {
    view: PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES_VIEW,
  },
  MonitorTemplate: { view: PageMap.MONITORS_SETTINGS_TEMPLATES_VIEW },
  ScheduledMaintenanceNoteTemplate: {
    view: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES_VIEW,
  },
  SecurityCaseNoteTemplate: {
    view: PageMap.SECURITY_EVENTS_SETTINGS_NOTE_TEMPLATE_VIEW,
  },
  ScheduledMaintenanceTemplate: {
    view: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES_VIEW,
  },
  StatusPageAnnouncementTemplate: {
    view: PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES_VIEW,
  },
  StatusPageSubscriberNotificationTemplate: {
    view: PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES_VIEW,
  },
  CloudConnection: { list: PageMap.CLOUD_CONNECT },
  DataBiConnection: { list: PageMap.DATA_OBSERVABILITY_BI_DASHBOARDS },
  DeviceManagementConnection: { list: PageMap.INVENTORY_MANAGED_DEVICES },
  LlmObservabilityConnection: { list: PageMap.LLM_CONNECT },
  NetworkControllerConnection: { list: PageMap.NETWORK_TRAFFIC },
  ScheduledMaintenanceExternalCalendar: {
    list: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CALENDAR,
  },
  SecurityEventDestination: { list: PageMap.SECURITY_EVENTS_CONNECTIONS },

  // Unique always, opened most.
  StatusPage: { view: PageMap.STATUS_PAGE_VIEW },
  Dashboard: { view: PageMap.DASHBOARD_VIEW },
  Workflow: { view: PageMap.WORKFLOW_VIEW },
  Service: { view: PageMap.SERVICE_VIEW },
  Runbook: { view: PageMap.RUNBOOK_VIEW },
  Team: { view: PageMap.TEAM_VIEW },
  OnCallDutyPolicy: { view: PageMap.ON_CALL_DUTY_POLICY_VIEW },
  OnCallDutyPolicySchedule: { view: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW },
  Label: { list: PageMap.SETTINGS_LABELS },
};

// The page a record is opened on, or null for a kind with none here.
export const getRecordPageRoute: GetRecordPageRoute = (data: {
  tableName: string;
  modelId: ObjectID;
}): Route | null => {
  const page: RecordPage | undefined = Object.prototype.hasOwnProperty.call(
    RECORD_PAGES,
    data.tableName,
  )
    ? RECORD_PAGES[data.tableName]
    : undefined;

  if (page?.view && RouteMap[page.view]) {
    return RouteUtil.populateRouteParams(RouteMap[page.view] as Route, {
      modelId: data.modelId,
    });
  }

  if (page?.list && RouteMap[page.list]) {
    return RouteUtil.populateRouteParams(RouteMap[page.list] as Route);
  }

  return null;
};
