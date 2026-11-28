import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getWorkspaceSummaryTabQuery } from "../Workspace/WorkspaceSummaryTab";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import { RecordPageFields } from "Common/Types/Database/RecordPageFields";
import ObjectID from "Common/Types/ObjectID";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import {
  GetNoRecordPageNote,
  GetRecordPageRoute,
  RecordPages,
} from "Common/UI/Components/RecordPage/RecordPageContext";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHERE A RECORD OF A KIND WITH A NAME OF ITS OWN IS OPENED (#10761).
 *
 * A form that warns its name is another record's links to that record
 * (DuplicateNameNotice), and Project Settings links each record of a name
 * the project holds twice, for renaming. A kind with a page of its own is
 * opened there; a kind whose records live in a list (budgets, connections,
 * calendars) opens its list, where the record is found by its name.
 *
 * A kind opened under another record or page is opened there from what the
 * server sends beside the record (#11020, Types/Database/RecordPageFields):
 * an OpenStack budget on its cloud's Spend page, a workspace notification
 * summary on the Summary tab of its workspace's Incidents or Alerts page.
 * The server sends those only where the reader may read them; without them
 * the record is named without a link. A kind no Dashboard page shows says
 * so in words of its own (noPage), rather than being named as if it had a
 * page somewhere: AI agents.
 *
 * Covers every kind Require Unique Names holds - RequiredUniqueNamesRecordPages
 * (Dashboard tests) holds the list to the models - and the kinds unique
 * always that people open most.
 */

// A page a record opens under, worked out from its page fields.
interface PageUnder {
  page: PageMap;
  // The id the page's address takes: the parent's.
  modelId?: string | undefined;
  // Its query: the tab it opens on.
  query?: Dictionary<string> | undefined;
}

interface RecordPage {
  // The record's own page, its id in the route.
  view?: PageMap | undefined;
  // Else the list it is found in.
  list?: PageMap | undefined;
  // Else the page it opens under, from its page fields; null without them.
  under?: ((fields: RecordPageFields) => PageUnder | null) | undefined;
  // Else what says the kind is shown on no page at all, in English.
  noPage?: string | undefined;
}

// AI agents are set up where they run, and no Dashboard page lists them.
export const AI_AGENTS_HAVE_NO_PAGE: string = translationKey(
  "AI agents have no page in the dashboard: rename one with the API or Terraform.",
);

// The page of each workspace that holds its incident and its alert summaries.
const WORKSPACE_SUMMARY_PAGES: Readonly<
  Record<WorkspaceType, { incidents: PageMap; alerts: PageMap }>
> = {
  [WorkspaceType.Slack]: {
    incidents: PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK,
    alerts: PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK,
  },
  [WorkspaceType.MicrosoftTeams]: {
    incidents: PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    alerts: PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
  },
  [WorkspaceType.Mattermost]: {
    incidents: PageMap.INCIDENTS_WORKSPACE_CONNECTION_MATTERMOST,
    alerts: PageMap.ALERTS_WORKSPACE_CONNECTION_MATTERMOST,
  },
};

// Which product's page a summary of each type is set on.
const SUMMARY_SECTION: Readonly<
  Record<WorkspaceNotificationSummaryType, "incidents" | "alerts">
> = {
  [WorkspaceNotificationSummaryType.Incident]: "incidents",
  [WorkspaceNotificationSummaryType.IncidentEpisode]: "incidents",
  [WorkspaceNotificationSummaryType.Alert]: "alerts",
  [WorkspaceNotificationSummaryType.AlertEpisode]: "alerts",
};

// A key of the map itself, never one its prototype lends it ("constructor").
const hasOwn: (
  record: Readonly<Record<string, unknown>>,
  key: string,
) => boolean = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean => {
  return Object.prototype.hasOwnProperty.call(record, key);
};

// A summary's page: its workspace's, of Incidents or of Alerts, on its Summary tab.
export const getWorkspaceSummaryPage: (
  fields: RecordPageFields,
) => PageUnder | null = (fields: RecordPageFields): PageUnder | null => {
  const workspaceType: string = fields["workspaceType"] || "";
  const summaryType: string = fields["summaryType"] || "";

  if (
    !hasOwn(WORKSPACE_SUMMARY_PAGES, workspaceType) ||
    !hasOwn(SUMMARY_SECTION, summaryType)
  ) {
    return null;
  }

  const pages: { incidents: PageMap; alerts: PageMap } =
    WORKSPACE_SUMMARY_PAGES[workspaceType as WorkspaceType];

  return {
    page: pages[
      SUMMARY_SECTION[summaryType as WorkspaceNotificationSummaryType]
    ],
    query: getWorkspaceSummaryTabQuery(),
  };
};

// A budget's page: its OpenStack cloud's Spend page.
export const getOpenStackBudgetPage: (
  fields: RecordPageFields,
) => PageUnder | null = (fields: RecordPageFields): PageUnder | null => {
  const cloudId: string = fields["openStackCloudId"] || "";

  if (!ObjectID.isValidUUID(cloudId)) {
    return null;
  }

  return { page: PageMap.OPENSTACK_CLOUD_VIEW_SPEND, modelId: cloudId };
};

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
  // Opened under another record or page, from its page fields (#11020).
  OpenStackBudget: { under: getOpenStackBudgetPage },
  WorkspaceNotificationSummary: { under: getWorkspaceSummaryPage },
  // Shown on no page at all.
  AIAgent: { noPage: AI_AGENTS_HAVE_NO_PAGE },

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

// The kind's entry, or undefined for a kind with none (or no kind at all).
const getRecordPage: (tableName: string) => RecordPage | undefined = (
  tableName: string,
): RecordPage | undefined => {
  return hasOwn(RECORD_PAGES, tableName) ? RECORD_PAGES[tableName] : undefined;
};

// The page a record is opened on, or null for a kind with none here.
export const getRecordPageRoute: GetRecordPageRoute = (data: {
  tableName: string;
  modelId: ObjectID;
  pageFields?: RecordPageFields | undefined;
}): Route | null => {
  const page: RecordPage | undefined = getRecordPage(data.tableName);

  if (page?.view && RouteMap[page.view]) {
    return RouteUtil.populateRouteParams(RouteMap[page.view] as Route, {
      modelId: data.modelId,
    });
  }

  if (page?.list && RouteMap[page.list]) {
    return RouteUtil.populateRouteParams(RouteMap[page.list] as Route);
  }

  if (page?.under && data.pageFields) {
    const under: PageUnder | null = page.under(data.pageFields);

    if (!under || !RouteMap[under.page]) {
      return null;
    }

    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[under.page] as Route,
      under.modelId ? { modelId: new ObjectID(under.modelId) } : undefined,
    );

    return under.query ? route.addQueryParams(under.query) : route;
  }

  return null;
};

// What says a kind is shown on no page at all, or null for any other.
export const getNoRecordPageNote: GetNoRecordPageNote = (
  tableName: string,
): string | null => {
  return getRecordPage(tableName)?.noPage || null;
};

// The Dashboard's answer, for every form and list that links a record.
export const DASHBOARD_RECORD_PAGES: RecordPages = {
  getRoute: getRecordPageRoute,
  getNoPageNote: getNoRecordPageNote,
};
