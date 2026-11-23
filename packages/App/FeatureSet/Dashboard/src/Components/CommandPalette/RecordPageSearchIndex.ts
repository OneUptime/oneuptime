import PageMap from "../../Utils/PageMap";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_PARENT_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
  DeveloperDocsParentPage,
  DeveloperDocsScope,
  getDeveloperDocsPageKey,
} from "../DeveloperDocs/DeveloperDocsPages";
import { DEVELOPER_PAGE_KEYWORDS } from "./PageSearchIndex";

/*
 * Every page a record's own menu links to, so Search (Cmd/Ctrl+K) can open
 * them (#9204): a status page's Settings, Single Sign-On, Subscribers or
 * Branding, a monitor's Criteria, a Kubernetes cluster's Pods.
 *
 * PageSearchIndex.ts lists the pages that open without a record. These need
 * one, so Search offers them two ways:
 *
 *  - On a record's page, its other pages are found by their names alone:
 *    "sso" on a status page opens that status page's Single Sign-On.
 *  - Anywhere, a page's name with a record's name or its kind finds it for
 *    the matching records the person can see: "status page sso", "acme
 *    subscribers". Records are looked up as the record search looks them up,
 *    a few kinds at a time (RecordPageSearch.ts).
 *
 * A kind is one record menu, and its sections and titles are the menu's own,
 * in English (Search translates them). A page keeps the titles it had before
 * it was renamed ("Advanced Settings", "OIDC", "Email Subscribers"), found
 * as its title is. Keywords are other words people type for it: lowercase
 * English, never shown. The Developer pages are not written out: they are added from
 * DeveloperDocsPages.ts, the list the menus draw them from.
 *
 * RecordPageSearchIndexCoversMenus (Common's tests) draws every record menu
 * for real and fails when one of its pages is not here under its menu's
 * section and title, so a page added to a menu is checked the day it is
 * written.
 *
 * Kept free of React, models and Common/UI so the App tests can read it.
 */

export interface RecordPageSearchPage {
  // The page's key in RouteMap: a PageMap key, or a generated Developer page.
  page: PageMap | string;
  // The menu section it sits in.
  section: string;
  title: string;
  /*
   * The titles it had before it was renamed (#9205, #9218): found as its
   * title is, so "sso" on a status page opens its Single Sign-On before
   * Project Settings' SSO.
   */
  formerTitles?: Array<string> | undefined;
  keywords?: Array<string> | undefined;
  // A query string the menu's link carries, with its "?".
  queryString?: string | undefined;
}

export interface RecordPageSearchKind {
  // Stable id: the record search's spec id where there is one.
  id: string;
  /*
   * The PageSearchArea of the product the record is in: a result's
   * breadcrumb starts with its name, and its icon is the product's.
   */
  area: string;
  // The menu files, under the Dashboard's src, that draw these pages.
  menus: Array<string>;
  // What one record is called, in English: "Status Page".
  recordName: string;
  // Words that name the kind in a search: "status page", "status pages".
  keywords: Array<string>;
  pages: Array<RecordPageSearchPage>;
}

/*
 * Other words for pages many records have under the same title. Added to
 * every page of that title.
 */
const KEYWORDS_BY_TITLE: Readonly<Record<string, Array<string>>> = {
  "Audit Logs": ["history", "audit trail", "activity log"],
  Owners: ["owner", "ownership"],
  "Custom Fields": ["fields"],
  "Notification Logs": ["sent notifications"],
  "Private Notes": ["internal notes"],
};

export const RECORD_PAGE_SEARCH_KINDS: ReadonlyArray<RecordPageSearchKind> = [
  {
    id: "status-pages",
    area: "status-pages",
    menus: ["Pages/StatusPages/View/SideMenu.tsx"],
    recordName: "Status Page",
    keywords: ["status page", "status pages", "public status page"],
    pages: [
      {
        page: PageMap.STATUS_PAGE_VIEW,
        section: "Overview",
        title: "Overview",
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS,
        section: "Overview",
        title: "Announcements",
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_OWNERS,
        section: "Overview",
        title: "Owners",
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_RESOURCES,
        section: "Resources",
        title: "Monitors",
        keywords: ["resources", "groups", "components"],
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_MONITOR_RULES,
        section: "Rules",
        title: "Monitor Rules",
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_SUBSCRIBERS,
        section: "Subscribers",
        title: "Subscribers",
        formerTitles: [
          "Email Subscribers",
          "SMS Subscribers",
          "Slack Subscribers",
          "Microsoft Teams Subscribers",
          "MS Teams Subscribers",
          "Webhook Subscribers",
        ],
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS,
        section: "Subscribers",
        title: "Subscriber Settings",
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_NOTIFICATION_LOGS,
        section: "Subscribers",
        title: "Notification Logs",
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_BRANDING,
        section: "Branding",
        title: "Branding",
        formerTitles: [
          "Essential Branding",
          "Header",
          "Footer",
          "Languages",
          "Overview Page",
        ],
        keywords: ["logo", "favicon", "colors"],
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_DOMAINS,
        section: "Branding",
        title: "Custom Domains",
        keywords: ["custom domain", "cname"],
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS,
        section: "Branding",
        title: "HTML, CSS & JavaScript",
        keywords: [
          "custom code",
          "custom css",
          "custom html",
          "custom javascript",
        ],
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS,
        section: "Security",
        title: "Access",
        formerTitles: ["Authentication Settings"],
        keywords: ["password", "private status page", "who can see"],
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS,
        section: "Security",
        title: "Private Users",
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_SSO,
        section: "Security",
        title: "Single Sign-On",
        formerTitles: ["SSO", "OIDC"],
        keywords: ["saml", "openid connect"],
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_SCIM,
        section: "Security",
        title: "SCIM",
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_MCP,
        section: "Advanced",
        title: "MCP",
        keywords: ["mcp server"],
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_EMBEDDED,
        section: "Advanced",
        title: "Embedded Status",
        keywords: ["embed", "badge", "widget"],
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_REPORTS,
        section: "Advanced",
        title: "Reports",
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS,
        section: "Advanced",
        title: "Custom Fields",
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
        formerTitles: ["Advanced Settings"],
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.STATUS_PAGE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Status Page",
      },
    ],
  },
  {
    id: "monitors",
    area: "monitors",
    menus: ["Pages/Monitor/View/SideMenu.tsx"],
    recordName: "Monitor",
    keywords: ["monitor", "monitors", "check"],
    pages: [
      { page: PageMap.MONITOR_VIEW, section: "Overview", title: "Overview" },
      {
        page: PageMap.MONITOR_VIEW_METRICS,
        section: "Overview",
        title: "Metrics",
      },
      {
        page: PageMap.MONITOR_VIEW_STATUS_TIMELINE,
        section: "Overview",
        title: "Status Timeline",
      },
      { page: PageMap.MONITOR_VIEW_SLOS, section: "Overview", title: "SLOs" },
      {
        page: PageMap.MONITOR_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.MONITOR_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.MONITOR_VIEW_NOTIFICATION_LOGS,
        section: "Activity",
        title: "Notification Logs",
      },
      {
        page: PageMap.MONITOR_VIEW_LOGS,
        section: "Activity",
        title: "Monitoring Logs",
      },
      {
        page: PageMap.MONITOR_VIEW_CRITERIA,
        section: "Configuration",
        title: "Criteria",
      },
      {
        page: PageMap.MONITOR_VIEW_DEPENDENCIES,
        section: "Configuration",
        title: "Dependencies",
      },
      {
        page: PageMap.MONITOR_VIEW_PROBES,
        section: "Configuration",
        title: "Probes & Interval",
        formerTitles: ["Probes", "Interval"],
      },
      {
        page: PageMap.MONITOR_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.MONITOR_VIEW_CUSTOM_FIELDS,
        section: "Advanced",
        title: "Custom Fields",
      },
      {
        page: PageMap.MONITOR_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.MONITOR_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.MONITOR_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Monitor",
      },
    ],
  },
  {
    id: "incidents",
    area: "incidents",
    menus: ["Pages/Incidents/View/SideMenu.tsx"],
    recordName: "Incident",
    keywords: ["incident", "incidents", "outage"],
    pages: [
      { page: PageMap.INCIDENT_VIEW, section: "Overview", title: "Overview" },
      {
        page: PageMap.INCIDENT_VIEW_STATE_TIMELINE,
        section: "Overview",
        title: "State Timeline",
      },
      { page: PageMap.INCIDENT_VIEW_SLA, section: "Overview", title: "SLA" },
      {
        page: PageMap.INCIDENT_VIEW_DESCRIPTION,
        section: "Investigation",
        title: "Description",
      },
      {
        page: PageMap.INCIDENT_VIEW_ROOT_CAUSE,
        section: "Investigation",
        title: "Root Cause",
      },
      {
        page: PageMap.INCIDENT_VIEW_REMEDIATION,
        section: "Investigation",
        title: "Remediation",
      },
      {
        page: PageMap.INCIDENT_VIEW_RUNBOOKS,
        section: "Investigation",
        title: "Runbooks",
      },
      {
        page: PageMap.INCIDENT_VIEW_POSTMORTEM,
        section: "Investigation",
        title: "Postmortem",
      },
      {
        page: PageMap.INCIDENT_VIEW_ALERTS,
        section: "Investigation",
        title: "Linked Alerts",
      },
      { page: PageMap.INCIDENT_VIEW_ROLES, section: "Team", title: "Roles" },
      {
        page: PageMap.INCIDENT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS,
        section: "Team",
        title: "On-Call Executions",
      },
      { page: PageMap.INCIDENT_VIEW_OWNERS, section: "Team", title: "Owners" },
      {
        page: PageMap.INCIDENT_VIEW_NOTIFICATION_LOGS,
        section: "Notifications",
        title: "Notification Logs",
      },
      {
        page: PageMap.INCIDENT_VIEW_AI_LOGS,
        section: "Notifications",
        title: "AI Logs",
      },
      {
        page: PageMap.INCIDENT_VIEW_INTERNAL_NOTE,
        section: "Notes",
        title: "Private Notes",
      },
      {
        page: PageMap.INCIDENT_VIEW_PUBLIC_NOTE,
        section: "Notes",
        title: "Public Notes",
      },
      {
        page: PageMap.INCIDENT_VIEW_CUSTOM_FIELDS,
        section: "Advanced",
        title: "Custom Fields",
      },
      {
        page: PageMap.INCIDENT_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.INCIDENT_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.INCIDENT_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Incident",
      },
    ],
  },
  {
    id: "alerts",
    area: "alerts",
    menus: ["Pages/Alerts/View/SideMenu.tsx"],
    recordName: "Alert",
    keywords: ["alert", "alerts"],
    pages: [
      { page: PageMap.ALERT_VIEW, section: "Overview", title: "Overview" },
      {
        page: PageMap.ALERT_VIEW_STATE_TIMELINE,
        section: "Overview",
        title: "State Timeline",
      },
      {
        page: PageMap.ALERT_VIEW_DESCRIPTION,
        section: "Investigation",
        title: "Description",
      },
      {
        page: PageMap.ALERT_VIEW_ROOT_CAUSE,
        section: "Investigation",
        title: "Root Cause",
      },
      {
        page: PageMap.ALERT_VIEW_REMEDIATION,
        section: "Investigation",
        title: "Remediation",
      },
      {
        page: PageMap.ALERT_VIEW_RUNBOOKS,
        section: "Investigation",
        title: "Runbooks",
      },
      {
        page: PageMap.ALERT_VIEW_INCIDENTS,
        section: "Investigation",
        title: "Linked Incidents",
      },
      {
        page: PageMap.ALERT_VIEW_INTERNAL_NOTE,
        section: "Investigation",
        title: "Private Notes",
      },
      {
        page: PageMap.ALERT_VIEW_ON_CALL_POLICY_EXECUTION_LOGS,
        section: "Team",
        title: "On-Call Executions",
      },
      { page: PageMap.ALERT_VIEW_OWNERS, section: "Team", title: "Owners" },
      {
        page: PageMap.ALERT_VIEW_NOTIFICATION_LOGS,
        section: "Notifications",
        title: "Notification Logs",
      },
      {
        page: PageMap.ALERT_VIEW_AI_LOGS,
        section: "Notifications",
        title: "AI Logs",
      },
      {
        page: PageMap.ALERT_VIEW_CUSTOM_FIELDS,
        section: "Advanced",
        title: "Custom Fields",
      },
      {
        page: PageMap.ALERT_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.ALERT_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.ALERT_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Alert",
      },
    ],
  },
  {
    id: "on-call-policies",
    area: "on-call-duty",
    menus: ["Pages/OnCallDuty/OnCallDutyPolicy/SideMenu.tsx"],
    recordName: "On-Call Policy",
    keywords: [
      "on-call policy",
      "on-call policies",
      "escalation policy",
      "on-call duty policy",
    ],
    pages: [
      {
        page: PageMap.ON_CALL_DUTY_POLICY_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
        section: "Basic",
        title: "Escalation Rules",
      },
      {
        page: PageMap.ON_CALL_DUTY_POLICY_VIEW_OWNERS,
        section: "Basic",
        title: "Owners",
      },
      {
        page: PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS,
        section: "Logs",
        title: "Execution Logs",
      },
      {
        page: PageMap.ON_CALL_DUTY_POLICY_VIEW_NOTIFICATION_LOGS,
        section: "Logs",
        title: "Notification Logs",
      },
      {
        page: PageMap.ON_CALL_DUTY_POLICY_VIEW_USER_OVERRIDES,
        section: "Advanced",
        title: "User Overrides",
      },
      {
        page: PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS,
        section: "Advanced",
        title: "Custom Fields",
      },
      {
        page: PageMap.ON_CALL_DUTY_POLICY_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.ON_CALL_DUTY_POLICY_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Policy",
        formerTitles: ["Archive or Delete"],
      },
    ],
  },
  {
    id: "on-call-schedules",
    area: "on-call-duty",
    menus: ["Pages/OnCallDuty/OnCallDutySchedule/SideMenu.tsx"],
    recordName: "On-Call Schedule",
    keywords: ["on-call schedule", "on-call schedules", "rota", "rotation"],
    pages: [
      {
        page: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS,
        section: "Basic",
        title: "Layers",
      },
      {
        page: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_NOTIFICATION_LOGS,
        section: "Basic",
        title: "Notification Logs",
      },
      {
        page: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_OWNERS,
        section: "Basic",
        title: "Owners",
      },
      {
        page: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Schedule",
      },
    ],
  },
  {
    id: "incoming-call-policies",
    area: "on-call-duty",
    menus: ["Pages/OnCallDuty/IncomingCallPolicy/SideMenu.tsx"],
    recordName: "Incoming Call Policy",
    keywords: [
      "incoming call policy",
      "incoming call policies",
      "phone number",
      "hotline",
    ],
    pages: [
      {
        page: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION,
        section: "Basic",
        title: "Escalation Rules",
      },
      {
        page: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS,
        section: "Basic",
        title: "Call Logs",
      },
      {
        page: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_OWNERS,
        section: "Basic",
        title: "Owners",
      },
      {
        page: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Policy",
      },
    ],
  },
  {
    id: "scheduled-maintenance",
    area: "scheduled-maintenance",
    menus: ["Pages/ScheduledMaintenanceEvents/View/SideMenu.tsx"],
    recordName: "Maintenance Event",
    keywords: [
      "maintenance event",
      "maintenance events",
      "scheduled maintenance",
      "maintenance",
    ],
    pages: [
      {
        page: PageMap.SCHEDULED_MAINTENANCE_VIEW,
        section: "Overview",
        title: "Overview",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE,
        section: "Overview",
        title: "State Timeline",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_VIEW_DESCRIPTION,
        section: "Overview",
        title: "Description",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_VIEW_RUNBOOKS,
        section: "Overview",
        title: "Runbooks",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS,
        section: "Overview",
        title: "Owners",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_VIEW_NOTIFICATION_LOGS,
        section: "Notifications",
        title: "Notification Logs",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_VIEW_AI_LOGS,
        section: "Notifications",
        title: "AI Logs",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE,
        section: "Notes",
        title: "Private Notes",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE,
        section: "Notes",
        title: "Public Notes",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS,
        section: "Advanced",
        title: "Custom Fields",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Maintenance Event",
        formerTitles: ["Delete Event"],
      },
    ],
  },
  {
    id: "services",
    area: "services",
    menus: ["Pages/Service/View/SideMenu.tsx"],
    recordName: "Service",
    keywords: ["service", "services"],
    pages: [
      { page: PageMap.SERVICE_VIEW, section: "Basic", title: "Overview" },
      {
        page: PageMap.SERVICE_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      { page: PageMap.SERVICE_VIEW_SLOS, section: "Basic", title: "SLOs" },
      { page: PageMap.SERVICE_VIEW_OWNERS, section: "Basic", title: "Owners" },
      { page: PageMap.SERVICE_VIEW_FEED, section: "Basic", title: "Feed" },
      { page: PageMap.SERVICE_VIEW_LOGS, section: "Telemetry", title: "Logs" },
      {
        page: PageMap.SERVICE_VIEW_SECURITY_EVENTS,
        section: "Telemetry",
        title: "Security Events",
        keywords: ["security", "siem", "threats"],
      },
      {
        page: PageMap.SERVICE_VIEW_TRACES,
        section: "Telemetry",
        title: "Traces",
      },
      {
        page: PageMap.SERVICE_VIEW_METRICS,
        section: "Telemetry",
        title: "Metrics",
      },
      {
        page: PageMap.SERVICE_VIEW_PROFILES,
        section: "Telemetry",
        title: "Profiles",
        formerTitles: ["Performance Profiles"],
        keywords: ["profiling"],
      },
      {
        page: PageMap.SERVICE_VIEW_EXCEPTIONS,
        section: "Telemetry",
        title: "Exceptions",
      },
      {
        page: PageMap.SERVICE_VIEW_SOURCE_MAPS,
        section: "Telemetry",
        title: "Source Maps",
      },
      {
        page: PageMap.SERVICE_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.SERVICE_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.SERVICE_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.SERVICE_VIEW_DATA_SECURITY,
        section: "Security",
        title: "Data Security",
        keywords: ["sensitive data", "pii", "telemetry"],
      },
      {
        page: PageMap.SERVICE_VIEW_COMPLIANCE,
        section: "Security",
        title: "Compliance",
        keywords: [
          "gdpr",
          "hipaa",
          "pci dss",
          "soc 2",
          "iso 27001",
          "frameworks",
        ],
      },
      {
        page: PageMap.SERVICE_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.SERVICE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.SERVICE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Service",
      },
    ],
  },
  {
    id: "hosts",
    area: "hosts",
    menus: ["Pages/Host/View/SideMenu.tsx"],
    recordName: "Host",
    keywords: ["host", "hosts", "server"],
    pages: [
      { page: PageMap.HOST_VIEW, section: "Basic", title: "Overview" },
      { page: PageMap.HOST_VIEW_TOPOLOGY, section: "Basic", title: "Topology" },
      {
        page: PageMap.HOST_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.HOST_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Collector",
        formerTitles: ["Documentation"],
        keywords: ["install agent"],
      },
      { page: PageMap.HOST_VIEW_AI_INSIGHTS, section: "AI", title: "Insights" },
      { page: PageMap.HOST_VIEW_AI_LOGS, section: "AI", title: "Logs" },
      { page: PageMap.HOST_VIEW_AI_AGENT, section: "AI", title: "AI agent" },
      {
        page: PageMap.HOST_VIEW_METRICS,
        section: "Observability",
        title: "Metrics",
      },
      {
        page: PageMap.HOST_VIEW_PROCESSES,
        section: "Observability",
        title: "Processes",
      },
      { page: PageMap.HOST_VIEW_LOGS, section: "Observability", title: "Logs" },
      {
        page: PageMap.HOST_VIEW_SECURITY_EVENTS,
        section: "Observability",
        title: "Security Events",
        keywords: ["security", "siem", "threats"],
      },
      {
        page: PageMap.HOST_VIEW_TRACES,
        section: "Observability",
        title: "Traces",
      },
      {
        page: PageMap.HOST_VIEW_PROFILES,
        section: "Observability",
        title: "Profiles",
        formerTitles: ["Performance Profiles"],
        keywords: ["profiling"],
      },
      {
        page: PageMap.HOST_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      { page: PageMap.HOST_VIEW_ALERTS, section: "Activity", title: "Alerts" },
      {
        page: PageMap.HOST_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      { page: PageMap.HOST_VIEW_OWNERS, section: "Advanced", title: "Owners" },
      { page: PageMap.HOST_VIEW_FEED, section: "Advanced", title: "Feed" },
      {
        page: PageMap.HOST_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.HOST_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.HOST_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Host",
      },
    ],
  },
  {
    id: "dashboards",
    area: "dashboards",
    menus: ["Pages/Dashboards/View/SideMenu.tsx"],
    recordName: "Dashboard",
    keywords: ["dashboard", "dashboards"],
    pages: [
      { page: PageMap.DASHBOARD_VIEW, section: "Basic", title: "Dashboard" },
      {
        page: PageMap.DASHBOARD_VIEW_OVERVIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS,
        section: "Basic",
        title: "Sharing",
        formerTitles: ["Authentication"],
        keywords: ["public link", "who can view"],
      },
      {
        page: PageMap.DASHBOARD_VIEW_BRANDING,
        section: "Public Link",
        title: "Branding",
      },
      {
        page: PageMap.DASHBOARD_VIEW_CUSTOM_DOMAINS,
        section: "Public Link",
        title: "Custom Domains",
      },
      {
        page: PageMap.DASHBOARD_VIEW_PRIVATE_USERS,
        section: "Public Link",
        title: "Private Users",
        keywords: ["sign in", "invite"],
      },
      {
        page: PageMap.DASHBOARD_VIEW_SINGLE_SIGN_ON,
        section: "Public Link",
        title: "Single Sign-On",
        keywords: ["sso", "saml", "oidc"],
      },
      {
        page: PageMap.DASHBOARD_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.DASHBOARD_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.DASHBOARD_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.DASHBOARD_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Dashboard",
        formerTitles: ["Delete"],
      },
    ],
  },
  {
    id: "workflows",
    area: "workflows",
    menus: ["Pages/Workflow/View/SideMenu.tsx"],
    recordName: "Workflow",
    keywords: ["workflow", "workflows"],
    pages: [
      { page: PageMap.WORKFLOW_VIEW, section: "Basic", title: "Overview" },
      { page: PageMap.WORKFLOW_BUILDER, section: "Basic", title: "Builder" },
      {
        page: PageMap.WORKFLOW_VARIABLES,
        section: "Basic",
        title: "Workflow Variables",
      },
      {
        page: PageMap.WORKFLOW_LOGS,
        section: "Basic",
        title: "Runs",
        formerTitles: ["Runs & Logs"],
        keywords: ["logs"],
      },
      {
        page: PageMap.WORKFLOW_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
        // What a workflow runs as is set here (#9695).
        keywords: ["run as", "permissions"],
      },
      {
        page: PageMap.WORKFLOW_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.WORKFLOW_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.WORKFLOW_DELETE,
        section: "Advanced",
        title: "Delete Workflow",
      },
    ],
  },
  {
    id: "runbooks",
    area: "runbooks",
    menus: ["Pages/Runbook/View/SideMenu.tsx"],
    recordName: "Runbook",
    keywords: ["runbook", "runbooks"],
    pages: [
      { page: PageMap.RUNBOOK_VIEW, section: "Basic", title: "Overview" },
      { page: PageMap.RUNBOOK_VIEW_STEPS, section: "Basic", title: "Steps" },
      {
        page: PageMap.RUNBOOK_VIEW_TRIGGERS,
        section: "Settings",
        title: "Triggers",
      },
      {
        page: PageMap.RUNBOOK_VIEW_VARIABLES,
        section: "Settings",
        title: "Variables",
      },
      {
        page: PageMap.RUNBOOK_VIEW_SETTINGS,
        section: "Settings",
        title: "Settings",
      },
      {
        page: PageMap.RUNBOOK_VIEW_EXECUTIONS,
        section: "Advanced",
        title: "Executions",
      },
      {
        page: PageMap.RUNBOOK_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.RUNBOOK_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.RUNBOOK_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Runbook",
      },
    ],
  },
  {
    id: "teams",
    area: "teams",
    menus: ["Pages/Teams/View/SideMenu.tsx"],
    recordName: "Team",
    keywords: ["team", "teams"],
    pages: [
      { page: PageMap.TEAM_VIEW, section: "Overview", title: "Team Details" },
      {
        page: PageMap.TEAM_VIEW_ON_CALL_SCHEDULES,
        section: "Overview",
        title: "On-Call Schedules",
      },
      {
        page: PageMap.TEAM_VIEW_MEMBERS,
        section: "Members & Access",
        title: "Members",
      },
      {
        page: PageMap.TEAM_VIEW_PERMISSIONS,
        section: "Members & Access",
        title: "Permissions",
        formerTitles: ["Block Permissions"],
      },
      {
        page: PageMap.TEAM_VIEW_CUSTOM_FIELDS,
        section: "Settings",
        title: "Custom Fields",
      },
      {
        page: PageMap.TEAM_VIEW_AUDIT_LOGS,
        section: "Settings",
        title: "Audit Logs",
      },
      {
        page: PageMap.TEAM_VIEW_DELETE,
        section: "Settings",
        title: "Delete Team",
      },
    ],
  },
  /*
   * A custom role's page and, from the registry, its Developer pages
   * (#10139): "incident responder api" opens that role's API page.
   */
  {
    id: "custom-roles",
    area: "teams",
    menus: ["Pages/Teams/RoleViewSideMenu.tsx"],
    recordName: "Custom Role",
    keywords: ["custom role", "custom roles"],
    pages: [
      {
        page: PageMap.TEAM_ROLE_VIEW,
        section: "Custom Role",
        title: "Overview",
      },
    ],
  },
  {
    id: "users",
    area: "users",
    menus: ["Pages/Users/View/SideMenu.tsx"],
    recordName: "User",
    keywords: ["user", "users", "member"],
    pages: [
      { page: PageMap.USER_VIEW, section: "Overview", title: "Profile" },
      { page: PageMap.USER_VIEW_TEAMS, section: "Overview", title: "Teams" },
      {
        page: PageMap.USER_VIEW_DELETE,
        section: "Settings",
        title: "Remove from Project",
        keywords: ["remove user", "delete user"],
      },
    ],
  },
  {
    id: "incident-episodes",
    area: "incidents",
    menus: ["Pages/Incidents/EpisodeView/SideMenu.tsx"],
    recordName: "Incident Episode",
    keywords: ["incident episode", "incident episodes", "episode"],
    pages: [
      {
        page: PageMap.INCIDENT_EPISODE_VIEW,
        section: "Overview",
        title: "Overview",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_STATE_TIMELINE,
        section: "Overview",
        title: "State Timeline",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS,
        section: "Overview",
        title: "Member Incidents",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_DESCRIPTION,
        section: "Investigation",
        title: "Description",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_ROOT_CAUSE,
        section: "Investigation",
        title: "Root Cause",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_REMEDIATION,
        section: "Investigation",
        title: "Remediation Notes",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_POSTMORTEM,
        section: "Investigation",
        title: "Postmortem",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_MEMBERS,
        section: "Team",
        title: "Roles",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_OWNERS,
        section: "Team",
        title: "Owners",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE,
        section: "Notes",
        title: "Private Notes",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_PUBLIC_NOTE,
        section: "Notes",
        title: "Public Notes",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.INCIDENT_EPISODE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Episode",
      },
    ],
  },
  {
    id: "alert-episodes",
    area: "alerts",
    menus: ["Pages/Alerts/EpisodeView/SideMenu.tsx"],
    recordName: "Alert Episode",
    keywords: ["alert episode", "alert episodes", "episode"],
    pages: [
      {
        page: PageMap.ALERT_EPISODE_VIEW,
        section: "Overview",
        title: "Overview",
      },
      {
        page: PageMap.ALERT_EPISODE_VIEW_STATE_TIMELINE,
        section: "Overview",
        title: "State Timeline",
      },
      {
        page: PageMap.ALERT_EPISODE_VIEW_ALERTS,
        section: "Overview",
        title: "Member Alerts",
      },
      {
        page: PageMap.ALERT_EPISODE_VIEW_OWNERS,
        section: "Overview",
        title: "Owners",
      },
      {
        page: PageMap.ALERT_EPISODE_VIEW_DESCRIPTION,
        section: "Investigation",
        title: "Description",
      },
      {
        page: PageMap.ALERT_EPISODE_VIEW_ROOT_CAUSE,
        section: "Investigation",
        title: "Root Cause",
      },
      {
        page: PageMap.ALERT_EPISODE_VIEW_REMEDIATION,
        section: "Investigation",
        title: "Remediation Notes",
      },
      {
        page: PageMap.ALERT_EPISODE_VIEW_INTERNAL_NOTE,
        section: "Investigation",
        title: "Private Notes",
      },
      {
        page: PageMap.ALERT_EPISODE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.ALERT_EPISODE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Episode",
      },
    ],
  },
  {
    id: "announcements",
    area: "status-pages",
    menus: [
      "Pages/StatusPages/View/AnnouncementSideMenu.tsx",
      "Pages/StatusPages/AnnouncementSideMenu.tsx",
    ],
    recordName: "Announcement",
    keywords: ["announcement", "announcements"],
    pages: [
      { page: PageMap.ANNOUNCEMENT_VIEW, section: "Basic", title: "Overview" },
      {
        page: PageMap.ANNOUNCEMENT_VIEW_NOTIFICATION_LOGS,
        section: "Basic",
        title: "Notification Logs",
      },
      {
        page: PageMap.ANNOUNCEMENT_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Announcement",
      },
      {
        page: PageMap.ANNOUNCEMENT_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
    ],
  },
  {
    id: "monitor-groups",
    area: "monitors",
    menus: ["Pages/MonitorGroup/View/SideMenu.tsx"],
    recordName: "Monitor Group",
    keywords: ["monitor group", "monitor groups"],
    pages: [
      {
        page: PageMap.MONITOR_GROUP_VIEW,
        section: "Overview",
        title: "Overview",
      },
      {
        page: PageMap.MONITOR_GROUP_VIEW_MONITORS,
        section: "Overview",
        title: "Monitors",
      },
      {
        page: PageMap.MONITOR_GROUP_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.MONITOR_GROUP_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.MONITOR_GROUP_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.MONITOR_GROUP_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.MONITOR_GROUP_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Group",
      },
    ],
  },
  {
    id: "slos",
    area: "slos",
    menus: ["Pages/Slo/View/SideMenu.tsx"],
    recordName: "SLO",
    keywords: ["slo", "slos", "service level objective"],
    pages: [
      { page: PageMap.SLO_VIEW, section: "Overview", title: "Overview" },
      {
        page: PageMap.SLO_VIEW_MONITORS,
        section: "Overview",
        title: "Monitors",
      },
      { page: PageMap.SLO_VIEW_METRICS, section: "Overview", title: "Metrics" },
      {
        page: PageMap.SLO_VIEW_MONTHLY_REPORT,
        section: "Overview",
        title: "Monthly Report",
      },
      {
        page: PageMap.SLO_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      { page: PageMap.SLO_VIEW_ALERTS, section: "Activity", title: "Alerts" },
      { page: PageMap.SLO_VIEW_FEED, section: "Activity", title: "Feed" },
      {
        page: PageMap.SLO_VIEW_MONITOR_RULES,
        section: "Rules",
        title: "Monitor Rules",
      },
      {
        page: PageMap.SLO_VIEW_BURN_RATE_RULES,
        section: "Rules",
        title: "Burn Rate Rules",
      },
      {
        page: PageMap.SLO_VIEW_ERROR_BUDGET_POLICY,
        section: "Rules",
        title: "Error Budget Policy",
      },
      { page: PageMap.SLO_VIEW_OWNERS, section: "Management", title: "Owners" },
      {
        page: PageMap.SLO_VIEW_SETTINGS,
        section: "Management",
        title: "Settings",
      },
      {
        page: PageMap.SLO_VIEW_AUDIT_LOGS,
        section: "Management",
        title: "Audit Logs",
      },
      {
        page: PageMap.SLO_VIEW_DELETE,
        section: "Management",
        title: "Delete SLO",
      },
    ],
  },
  {
    id: "security-cases",
    area: "security-events",
    menus: ["Pages/SecurityEvents/CaseView/SideMenu.tsx"],
    recordName: "Case",
    keywords: ["security case", "case", "cases"],
    pages: [
      {
        page: PageMap.SECURITY_CASE_VIEW,
        section: "Overview",
        title: "Overview",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_TIMELINE,
        section: "Overview",
        title: "Timeline",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_STORY,
        section: "Investigation",
        title: "Story",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_DETECTIONS,
        section: "Investigation",
        title: "Detections",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_ENTITIES,
        section: "Investigation",
        title: "Entities",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_CONNECTED_SIGNALS,
        section: "Investigation",
        title: "Connected Signals",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_EVIDENCE,
        section: "Investigation",
        title: "Evidence",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_TASKS,
        section: "Investigation",
        title: "Tasks",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_PLAYBOOK_RUNS,
        section: "Investigation",
        title: "Playbooks",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_NOTES,
        section: "Notes",
        title: "Private Notes",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_CUSTOM_FIELDS,
        section: "Advanced",
        title: "Custom Fields",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.SECURITY_CASE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Case",
      },
    ],
  },
  {
    id: "exceptions",
    area: "exceptions",
    menus: ["Pages/Exceptions/View/SideMenu.tsx"],
    recordName: "Exception",
    keywords: ["exception", "exceptions", "error"],
    pages: [
      {
        page: PageMap.EXCEPTIONS_VIEW,
        section: "Investigate",
        title: "Overview",
      },
      {
        page: PageMap.EXCEPTIONS_VIEW_STACK_TRACE,
        section: "Investigate",
        title: "Stack Trace",
      },
      {
        page: PageMap.EXCEPTIONS_VIEW_OCCURRENCES,
        section: "Investigate",
        title: "Occurrences",
      },
      {
        page: PageMap.EXCEPTIONS_VIEW_CONTEXT,
        section: "Investigate",
        title: "Context",
      },
      {
        page: PageMap.EXCEPTIONS_VIEW_LOGS,
        section: "Investigate",
        title: "Logs",
      },
      {
        page: PageMap.EXCEPTIONS_VIEW_AI_ASSISTANCE,
        section: "Resolve",
        title: "Fix with AI",
        formerTitles: ["AI Assistance"],
      },
      {
        page: PageMap.EXCEPTIONS_VIEW_SETTINGS,
        section: "Manage",
        title: "Settings",
      },
      {
        page: PageMap.EXCEPTIONS_VIEW_AUDIT_LOGS,
        section: "Manage",
        title: "Audit Logs",
      },
    ],
  },
  {
    id: "code-repositories",
    area: "code",
    menus: ["Pages/Code/Repository/SideMenu.tsx"],
    recordName: "Repository",
    keywords: ["repository", "repositories", "repo"],
    pages: [
      {
        page: PageMap.CODE_REPOSITORY_VIEW,
        section: "Repository",
        title: "Tasks",
      },
      {
        page: PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS,
        section: "Repository",
        title: "Production Reviews",
      },
      {
        page: PageMap.CODE_REPOSITORY_VIEW_SETTINGS,
        section: "Repository",
        title: "Settings",
      },
      {
        page: PageMap.CODE_REPOSITORY_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.CODE_REPOSITORY_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Repository",
      },
    ],
  },
  {
    id: "inventory-items",
    area: "inventory",
    menus: ["Pages/Inventory/View/SideMenu.tsx"],
    recordName: "Inventory Item",
    keywords: ["inventory item", "inventory items", "item"],
    pages: [
      { page: PageMap.INVENTORY_VIEW, section: "Item", title: "Overview" },
      {
        page: PageMap.INVENTORY_VIEW_RELATIONSHIPS,
        section: "Item",
        title: "Connections",
      },
      {
        page: PageMap.INVENTORY_VIEW_CUSTOM_FIELDS,
        section: "Item",
        title: "Custom Fields",
      },
      {
        page: PageMap.INVENTORY_VIEW_LOGS,
        section: "Telemetry",
        title: "Logs",
      },
      {
        page: PageMap.INVENTORY_VIEW_TRACES,
        section: "Telemetry",
        title: "Traces",
      },
      {
        page: PageMap.INVENTORY_VIEW_METRICS,
        section: "Telemetry",
        title: "Metrics",
      },
      {
        page: PageMap.INVENTORY_VIEW_PROFILES,
        section: "Telemetry",
        title: "Profiles",
        formerTitles: ["Performance Profiles"],
        keywords: ["profiling"],
      },
      {
        page: PageMap.INVENTORY_VIEW_EXCEPTIONS,
        section: "Telemetry",
        title: "Exceptions",
      },
      {
        page: PageMap.INVENTORY_VIEW_INCIDENTS,
        section: "Operations",
        title: "Incidents",
      },
      {
        page: PageMap.INVENTORY_VIEW_ALERTS,
        section: "Operations",
        title: "Alerts",
      },
      {
        page: PageMap.INVENTORY_VIEW_SCHEDULED_MAINTENANCE,
        section: "Operations",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.INVENTORY_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.INVENTORY_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.INVENTORY_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Item",
      },
    ],
  },
  {
    id: "database-servers",
    area: "databases",
    menus: ["Pages/Database/View/SideMenu.tsx"],
    recordName: "Database",
    keywords: ["database", "databases", "database server"],
    pages: [
      {
        page: PageMap.DATABASE_SERVER_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_AI_INSIGHTS,
        section: "AI",
        title: "Insights",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_AI_LOGS,
        section: "AI",
        title: "Logs",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_AI_AGENT,
        section: "AI",
        title: "AI agent",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_METRICS,
        section: "Observability",
        title: "Metrics",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_LOGS,
        section: "Observability",
        title: "Logs",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_TRACES,
        section: "Observability",
        title: "Traces",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_RECOMMENDATIONS,
        section: "Activity",
        title: "Recommendations",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_DATA_SECURITY,
        section: "Security",
        title: "Data Security",
        keywords: ["sensitive data", "pii", "data store"],
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_COMPLIANCE,
        section: "Security",
        title: "Compliance",
        keywords: [
          "gdpr",
          "hipaa",
          "pci dss",
          "soc 2",
          "iso 27001",
          "frameworks",
        ],
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_ENDPOINTS,
        section: "Advanced",
        title: "Endpoints",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_FEED,
        section: "Advanced",
        title: "Feed",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.DATABASE_SERVER_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Database",
      },
    ],
  },
  {
    id: "message-queues",
    area: "queues",
    menus: ["Pages/MessageQueue/View/SideMenu.tsx"],
    recordName: "Queue",
    keywords: ["queue", "queues", "message queue"],
    pages: [
      { page: PageMap.MESSAGE_QUEUE_VIEW, section: "Basic", title: "Overview" },
      {
        page: PageMap.MESSAGE_QUEUE_VIEW_TOPOLOGY,
        section: "Basic",
        title: "Topology",
      },
      {
        page: PageMap.MESSAGE_QUEUE_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.MESSAGE_QUEUE_VIEW_TRACES,
        section: "Observability",
        title: "Traces",
      },
      {
        page: PageMap.MESSAGE_QUEUE_VIEW_METRICS,
        section: "Observability",
        title: "Metrics",
      },
      {
        page: PageMap.MESSAGE_QUEUE_VIEW_OWNERS,
        section: "Settings",
        title: "Owners",
      },
      {
        page: PageMap.MESSAGE_QUEUE_VIEW_SETTINGS,
        section: "Settings",
        title: "Settings",
      },
      {
        page: PageMap.MESSAGE_QUEUE_VIEW_DOCUMENTATION,
        section: "Settings",
        title: "Documentation",
      },
      {
        page: PageMap.MESSAGE_QUEUE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.MESSAGE_QUEUE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Queue",
      },
    ],
  },
  {
    id: "rum-applications",
    area: "rum",
    menus: ["Pages/Rum/View/SideMenu.tsx"],
    recordName: "Application",
    keywords: ["rum application", "rum app", "application", "app"],
    pages: [
      {
        page: PageMap.RUM_APPLICATION_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_METRICS,
        section: "Observability",
        title: "Metrics",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_LOGS,
        section: "Observability",
        title: "Logs",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_TRACES,
        section: "Observability",
        title: "Traces",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_CLIENTS,
        section: "Observability",
        title: "Clients",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_USERS,
        section: "Product Analytics",
        title: "Users",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_SESSIONS,
        section: "Product Analytics",
        title: "Sessions",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_EVENTS,
        section: "Product Analytics",
        title: "Events",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_FUNNELS,
        section: "Product Analytics",
        title: "Funnels",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_RETENTION,
        section: "Product Analytics",
        title: "User Retention",
        formerTitles: ["Retention"],
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_USER_FLOWS,
        section: "Product Analytics",
        title: "User Flows",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_PRODUCT_ANALYTICS_SETTINGS,
        section: "Product Analytics",
        title: "Analytics Settings",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY,
        section: "Session Replay",
        title: "Session Replay",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_USERS,
        section: "Session Replay",
        title: "Replay Users",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_HEALTH,
        section: "Session Replay",
        title: "Health",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS,
        section: "Session Replay",
        title: "Replay Policy",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_FRUSTRATION_SIGNALS,
        section: "Session Replay",
        title: "Frustration Signals",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_AUDIT,
        section: "Session Replay",
        title: "Replay Access Log",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_DOCUMENTATION,
        section: "Session Replay",
        title: "Documentation",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.RUM_APPLICATION_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Application",
      },
    ],
  },
  {
    id: "kubernetes-clusters",
    area: "kubernetes",
    menus: ["Pages/Kubernetes/View/SideMenu.tsx"],
    recordName: "Kubernetes Cluster",
    keywords: ["kubernetes cluster", "kubernetes", "k8s", "cluster"],
    pages: [
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_TOPOLOGY,
        section: "Basic",
        title: "Topology",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_INSIGHTS,
        section: "Basic",
        title: "Resource Usage",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_COSTS,
        section: "Basic",
        title: "Costs",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_AI_INSIGHTS,
        section: "AI",
        title: "Insights",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS,
        section: "AI",
        title: "Logs",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT,
        section: "AI",
        title: "Agent",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_METRICS,
        section: "Telemetry",
        title: "Metrics",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_TRACES,
        section: "Telemetry",
        title: "Traces",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_LOGS,
        section: "Telemetry",
        title: "Logs",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS,
        section: "Telemetry",
        title: "Events",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS,
        section: "Telemetry",
        title: "Security Events",
        keywords: ["security", "audit log", "siem", "threats"],
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_PROFILES,
        section: "Telemetry",
        title: "Profiles",
        formerTitles: ["Performance Profiles"],
        keywords: ["profiling"],
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACES,
        section: "Workloads",
        title: "Namespaces",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_PODS,
        section: "Workloads",
        title: "Pods",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTS,
        section: "Workloads",
        title: "Deployments",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSETS,
        section: "Workloads",
        title: "StatefulSets",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSETS,
        section: "Workloads",
        title: "DaemonSets",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_JOBS,
        section: "Workloads",
        title: "Jobs",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOBS,
        section: "Workloads",
        title: "CronJobs",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINERS,
        section: "Workloads",
        title: "Containers",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_NODES,
        section: "Infrastructure",
        title: "Nodes",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_PVCS,
        section: "Infrastructure",
        title: "PVCs",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_PVS,
        section: "Infrastructure",
        title: "PVs",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_HPAS,
        section: "Scaling",
        title: "HPAs",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_VPAS,
        section: "Scaling",
        title: "VPAs",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_CONTROL_PLANE,
        section: "Observability",
        title: "Control Plane",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_SERVICE_MESH,
        section: "Observability",
        title: "Service Mesh",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_DATA_SECURITY,
        section: "Security",
        title: "Data Security",
        keywords: ["sensitive data", "pii", "data stores", "databases"],
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE,
        section: "Security",
        title: "Compliance",
        keywords: [
          "gdpr",
          "hipaa",
          "pci dss",
          "soc 2",
          "iso 27001",
          "frameworks",
        ],
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_FEED,
        section: "Advanced",
        title: "Feed",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.KUBERNETES_CLUSTER_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Cluster",
      },
    ],
  },
  {
    id: "docker-hosts",
    area: "docker",
    menus: ["Pages/Docker/View/SideMenu.tsx"],
    recordName: "Docker Host",
    keywords: ["docker host", "docker", "host"],
    pages: [
      { page: PageMap.DOCKER_HOST_VIEW, section: "Basic", title: "Overview" },
      {
        page: PageMap.DOCKER_HOST_VIEW_TOPOLOGY,
        section: "Basic",
        title: "Topology",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_CONTAINERS,
        section: "Basic",
        title: "Containers",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_AI_INSIGHTS,
        section: "AI",
        title: "Insights",
      },
      { page: PageMap.DOCKER_HOST_VIEW_AI_LOGS, section: "AI", title: "Logs" },
      {
        page: PageMap.DOCKER_HOST_VIEW_AI_AGENT,
        section: "AI",
        title: "AI agent",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_METRICS,
        section: "Observability",
        title: "Metrics",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_LOGS,
        section: "Observability",
        title: "Logs",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_SECURITY_EVENTS,
        section: "Observability",
        title: "Security Events",
        keywords: ["security", "siem", "threats"],
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_TRACES,
        section: "Observability",
        title: "Traces",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_PROFILES,
        section: "Observability",
        title: "Profiles",
        formerTitles: ["Performance Profiles"],
        keywords: ["profiling"],
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_DATA_SECURITY,
        section: "Security",
        title: "Data Security",
        keywords: ["sensitive data", "pii", "data stores", "databases"],
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_COMPLIANCE,
        section: "Security",
        title: "Compliance",
        keywords: [
          "gdpr",
          "hipaa",
          "pci dss",
          "soc 2",
          "iso 27001",
          "frameworks",
        ],
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_FEED,
        section: "Advanced",
        title: "Feed",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.DOCKER_HOST_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Host",
      },
    ],
  },
  {
    id: "docker-swarm-clusters",
    area: "docker-swarm",
    menus: ["Pages/DockerSwarm/View/SideMenu.tsx"],
    recordName: "Docker Swarm Cluster",
    keywords: ["docker swarm cluster", "docker swarm", "swarm", "cluster"],
    pages: [
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW,
        section: "Overview",
        title: "Overview",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_TOPOLOGY,
        section: "Overview",
        title: "Topology",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_INSIGHTS,
        section: "Overview",
        title: "Resource Usage",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_RECOMMENDATIONS,
        section: "Overview",
        title: "Recommendations",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_INSIGHTS,
        section: "AI",
        title: "Insights",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_LOGS,
        section: "AI",
        title: "Logs",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_AGENT,
        section: "AI",
        title: "AI agent",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICES,
        section: "Workloads",
        title: "Services",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASKS,
        section: "Workloads",
        title: "Tasks",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_STACKS,
        section: "Workloads",
        title: "Stacks",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODES,
        section: "Infrastructure",
        title: "Nodes",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_NETWORKS,
        section: "Infrastructure",
        title: "Networks",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_VOLUMES,
        section: "Infrastructure",
        title: "Volumes",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_SECRETS,
        section: "Config",
        title: "Secrets",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_CONFIGS,
        section: "Config",
        title: "Configs",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_METRICS,
        section: "Telemetry",
        title: "Metrics",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_LOGS,
        section: "Telemetry",
        title: "Logs",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_FEED,
        section: "Advanced",
        title: "Feed",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_DOCUMENTATION,
        section: "Advanced",
        title: "Documentation",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Cluster",
      },
    ],
  },
  {
    id: "podman-hosts",
    area: "podman",
    menus: ["Pages/Podman/View/SideMenu.tsx"],
    recordName: "Podman Host",
    keywords: ["podman host", "podman", "host"],
    pages: [
      { page: PageMap.PODMAN_HOST_VIEW, section: "Basic", title: "Overview" },
      {
        page: PageMap.PODMAN_HOST_VIEW_TOPOLOGY,
        section: "Basic",
        title: "Topology",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_CONTAINERS,
        section: "Basic",
        title: "Containers",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_AI_INSIGHTS,
        section: "AI",
        title: "Insights",
      },
      { page: PageMap.PODMAN_HOST_VIEW_AI_LOGS, section: "AI", title: "Logs" },
      {
        page: PageMap.PODMAN_HOST_VIEW_AI_AGENT,
        section: "AI",
        title: "AI agent",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_METRICS,
        section: "Observability",
        title: "Metrics",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_LOGS,
        section: "Observability",
        title: "Logs",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_SECURITY_EVENTS,
        section: "Observability",
        title: "Security Events",
        keywords: ["security", "siem", "threats"],
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_TRACES,
        section: "Observability",
        title: "Traces",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_PROFILES,
        section: "Observability",
        title: "Profiles",
        formerTitles: ["Performance Profiles"],
        keywords: ["profiling"],
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_DATA_SECURITY,
        section: "Security",
        title: "Data Security",
        keywords: ["sensitive data", "pii", "data stores", "databases"],
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_COMPLIANCE,
        section: "Security",
        title: "Compliance",
        keywords: [
          "gdpr",
          "hipaa",
          "pci dss",
          "soc 2",
          "iso 27001",
          "frameworks",
        ],
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_FEED,
        section: "Advanced",
        title: "Feed",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.PODMAN_HOST_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Host",
      },
    ],
  },
  {
    id: "serverless-functions",
    area: "serverless",
    menus: ["Pages/Serverless/View/SideMenu.tsx"],
    recordName: "Function",
    keywords: ["serverless function", "function", "lambda", "serverless"],
    pages: [
      {
        page: PageMap.SERVERLESS_FUNCTION_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.SERVERLESS_FUNCTION_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.SERVERLESS_FUNCTION_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.SERVERLESS_FUNCTION_VIEW_METRICS,
        section: "Observability",
        title: "Metrics",
      },
      {
        page: PageMap.SERVERLESS_FUNCTION_VIEW_LOGS,
        section: "Observability",
        title: "Logs",
      },
      {
        page: PageMap.SERVERLESS_FUNCTION_VIEW_SECURITY_EVENTS,
        section: "Observability",
        title: "Security Events",
      },
      {
        page: PageMap.SERVERLESS_FUNCTION_VIEW_TRACES,
        section: "Observability",
        title: "Traces",
      },
      {
        page: PageMap.SERVERLESS_FUNCTION_VIEW_INSTANCES,
        section: "Observability",
        title: "Instances",
      },
      {
        page: PageMap.SERVERLESS_FUNCTION_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.SERVERLESS_FUNCTION_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.SERVERLESS_FUNCTION_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Function",
      },
    ],
  },
  {
    id: "app-platform-environments",
    area: "app-platforms",
    menus: ["Pages/AppPlatforms/View/SideMenu.tsx"],
    recordName: "Environment",
    keywords: ["environment", "app platform", "app platforms"],
    pages: [
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APPS,
        section: "Workloads",
        title: "Apps",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INSTANCES,
        section: "Workloads",
        title: "Instances",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_METRICS,
        section: "Observability",
        title: "Metrics",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_LOGS,
        section: "Observability",
        title: "Logs",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_TRACES,
        section: "Observability",
        title: "Traces",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_FEED,
        section: "Observability",
        title: "Feed",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Environment",
      },
    ],
  },
  {
    id: "cloud-accounts",
    area: "cloud",
    menus: ["Pages/Cloud/Accounts/View/SideMenu.tsx"],
    recordName: "Cloud Account",
    keywords: [
      "cloud account",
      "cloud accounts",
      "account",
      "aws account",
      "azure subscription",
      "gcp project",
    ],
    pages: [
      { page: PageMap.CLOUD_ACCOUNT_VIEW, section: "Basic", title: "Overview" },
      {
        page: PageMap.CLOUD_ACCOUNT_VIEW_RESOURCES,
        section: "Basic",
        title: "Resources",
      },
      {
        page: PageMap.CLOUD_ACCOUNT_VIEW_TOPOLOGY,
        section: "Basic",
        title: "Topology",
      },
      {
        page: PageMap.CLOUD_ACCOUNT_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.CLOUD_ACCOUNT_VIEW_COSTS,
        section: "Basic",
        title: "Costs",
      },
      {
        page: PageMap.CLOUD_ACCOUNT_VIEW_AI_LOGS,
        section: "AI",
        title: "Logs",
      },
      {
        page: PageMap.CLOUD_ACCOUNT_VIEW_AI_AGENT,
        section: "AI",
        title: "AI agent",
      },
      {
        page: PageMap.CLOUD_ACCOUNT_VIEW_CHANGES,
        section: "Activity",
        title: "Changes",
      },
      {
        page: PageMap.CLOUD_ACCOUNT_VIEW_FEED,
        section: "Activity",
        title: "Feed",
      },
      {
        page: PageMap.CLOUD_ACCOUNT_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.CLOUD_ACCOUNT_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.CLOUD_ACCOUNT_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Account",
      },
    ],
  },
  {
    id: "cloud-resources",
    area: "cloud",
    menus: ["Pages/Cloud/View/SideMenu.tsx"],
    recordName: "Cloud Resource",
    keywords: ["cloud resource", "cloud resources", "resource"],
    pages: [
      {
        page: PageMap.CLOUD_RESOURCE_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_METRICS,
        section: "Observability",
        title: "Metrics",
      },
      /*
       * Not its Logs, Recommendations or Security Events (#9779): its menu
       * draws each only for a resource that has them - logs a stream sends,
       * a type monitors are recommended for, an ID or a name an event can
       * name it by - so Search does not offer them for every resource.
       */
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_FEED,
        section: "Observability",
        title: "Feed",
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_CHANGES,
        section: "Activity",
        title: "Changes",
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_DATA_SECURITY,
        section: "Security",
        title: "Data Security",
        keywords: ["sensitive data", "pii", "data store", "bucket"],
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_COMPLIANCE,
        section: "Security",
        title: "Compliance",
        keywords: [
          "gdpr",
          "hipaa",
          "pci dss",
          "soc 2",
          "iso 27001",
          "frameworks",
        ],
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.CLOUD_RESOURCE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Resource",
      },
    ],
  },
  {
    id: "proxmox-clusters",
    area: "proxmox",
    menus: ["Pages/Proxmox/View/SideMenu.tsx"],
    recordName: "Proxmox Cluster",
    keywords: ["proxmox cluster", "proxmox", "cluster"],
    pages: [
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_TOPOLOGY,
        section: "Basic",
        title: "Topology",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_INSIGHTS,
        section: "Basic",
        title: "Resource Usage",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_AI_INSIGHTS,
        section: "AI",
        title: "Insights",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_AI_LOGS,
        section: "AI",
        title: "Logs",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_AI_AGENT,
        section: "AI",
        title: "AI agent",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_METRICS,
        section: "Telemetry",
        title: "Metrics",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_LOGS,
        section: "Telemetry",
        title: "Logs",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_NODES,
        section: "Resources",
        title: "Nodes",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_GUESTS,
        section: "Resources",
        title: "Guests",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_STORAGE,
        section: "Resources",
        title: "Storage",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_FEED,
        section: "Advanced",
        title: "Feed",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.PROXMOX_CLUSTER_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Cluster",
      },
    ],
  },
  {
    id: "openstack-clouds",
    area: "openstack",
    menus: ["Pages/OpenStack/View/SideMenu.tsx"],
    recordName: "OpenStack Cloud",
    keywords: ["openstack cloud", "openstack", "cloud"],
    pages: [
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_TOPOLOGY,
        section: "Basic",
        title: "Topology",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_CAPACITY,
        section: "Basic",
        title: "Capacity",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_SPEND,
        section: "Basic",
        title: "Spend",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_AI_INSIGHTS,
        section: "AI",
        title: "Insights",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_AI_LOGS,
        section: "AI",
        title: "Logs",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_AI_AGENT,
        section: "AI",
        title: "AI agent",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_SERVICES,
        section: "Control Plane",
        title: "Services",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_CONTROL_PLANE,
        section: "Control Plane",
        title: "What It Stands On",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS,
        section: "Compute",
        title: "Hypervisors",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES,
        section: "Compute",
        title: "Instances",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_FLAVORS,
        section: "Compute",
        title: "Flavors",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONES,
        section: "Compute",
        title: "Availability Zones",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATES,
        section: "Compute",
        title: "Aggregates",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS,
        section: "Network",
        title: "Networks",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_SUBNETS,
        section: "Network",
        title: "Subnets",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS,
        section: "Network",
        title: "Routers",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS,
        section: "Network",
        title: "Floating IPs",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENTS,
        section: "Network",
        title: "Network Agents",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES,
        section: "Storage",
        title: "Volumes",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOLS,
        section: "Storage",
        title: "Storage Pools",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_SNAPSHOTS,
        section: "Storage",
        title: "Snapshots and Backups",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_IMAGES,
        section: "Storage",
        title: "Images",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_PROJECTS,
        section: "Tenancy",
        title: "Projects",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_DOMAINS,
        section: "Tenancy",
        title: "Domains",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_METRICS,
        section: "Telemetry",
        title: "Metrics",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_LOGS,
        section: "Telemetry",
        title: "Logs",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_SECURITY_EVENTS,
        section: "Telemetry",
        title: "Security Events",
        keywords: ["security", "siem", "threats"],
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_TRACES,
        section: "Telemetry",
        title: "Traces",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_CHECKS,
        section: "Telemetry",
        title: "Checks",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_RECOMMENDATIONS,
        section: "Telemetry",
        title: "Recommendations",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_STATUS_PAGES,
        section: "Activity",
        title: "Status Pages",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_FEED,
        section: "Advanced",
        title: "Feed",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.OPENSTACK_CLOUD_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Cloud",
      },
    ],
  },
  {
    id: "vmware-vcenters",
    area: "vmware",
    menus: ["Pages/VMware/View/SideMenu.tsx"],
    recordName: "vCenter",
    keywords: ["vcenter", "vmware", "vsphere"],
    pages: [
      {
        page: PageMap.VMWARE_VCENTER_VIEW,
        section: "Basic",
        title: "Overview",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_TOPOLOGY,
        section: "Basic",
        title: "Topology",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_INSIGHTS,
        section: "Basic",
        title: "Resource Usage",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_AI_INSIGHTS,
        section: "AI",
        title: "Insights",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_AI_LOGS,
        section: "AI",
        title: "Logs",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_AI_AGENT,
        section: "AI",
        title: "AI agent",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_METRICS,
        section: "Telemetry",
        title: "Metrics",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_LOGS,
        section: "Telemetry",
        title: "Logs",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_HOSTS,
        section: "Resources",
        title: "Hosts",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES,
        section: "Resources",
        title: "Virtual Machines",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_DATASTORES,
        section: "Resources",
        title: "Datastores",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_CLUSTERS,
        section: "Resources",
        title: "Clusters",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_RESOURCE_POOLS,
        section: "Resources",
        title: "Resource Pools",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_FEED,
        section: "Advanced",
        title: "Feed",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.VMWARE_VCENTER_VIEW_DELETE,
        section: "Advanced",
        title: "Delete vCenter",
      },
    ],
  },
  {
    id: "ceph-clusters",
    area: "ceph",
    menus: ["Pages/Ceph/View/SideMenu.tsx"],
    recordName: "Ceph Cluster",
    keywords: ["ceph cluster", "ceph", "cluster"],
    pages: [
      { page: PageMap.CEPH_CLUSTER_VIEW, section: "Basic", title: "Overview" },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_TOPOLOGY,
        section: "Basic",
        title: "Topology",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_INSIGHTS,
        section: "Basic",
        title: "Resource Usage",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_AI_INSIGHTS,
        section: "AI",
        title: "Insights",
      },
      { page: PageMap.CEPH_CLUSTER_VIEW_AI_LOGS, section: "AI", title: "Logs" },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_AI_AGENT,
        section: "AI",
        title: "AI agent",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_METRICS,
        section: "Telemetry",
        title: "Metrics",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_LOGS,
        section: "Telemetry",
        title: "Logs",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_OSDS,
        section: "Storage",
        title: "OSDs",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_POOLS,
        section: "Storage",
        title: "Pools",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_DAEMONS,
        section: "Storage",
        title: "Daemons",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_CLUSTER_LOG,
        section: "Observability",
        title: "Cluster Log",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_FEED,
        section: "Advanced",
        title: "Feed",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.CEPH_CLUSTER_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Cluster",
      },
    ],
  },
  {
    id: "storage-arrays",
    area: "storage-arrays",
    menus: ["Pages/StorageArray/View/SideMenu.tsx"],
    recordName: "Storage Array",
    keywords: ["storage array", "storage arrays", "san", "nas"],
    pages: [
      { page: PageMap.STORAGE_ARRAY_VIEW, section: "Basic", title: "Overview" },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_TOPOLOGY,
        section: "Basic",
        title: "Topology",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_INSIGHTS,
        section: "Basic",
        title: "Resource Usage",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_METRICS,
        section: "Telemetry",
        title: "Metrics",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_LOGS,
        section: "Telemetry",
        title: "Logs",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_FEED,
        section: "Advanced",
        title: "Feed",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.STORAGE_ARRAY_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Storage Array",
      },
    ],
  },
  {
    id: "network-devices",
    area: "network",
    menus: ["Pages/NetworkDevice/View/SideMenu.tsx"],
    recordName: "Network Device",
    keywords: ["network device", "device", "router", "switch"],
    pages: [
      {
        page: PageMap.NETWORK_DEVICE_VIEW,
        section: "Device",
        title: "Overview",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_INTERFACES,
        section: "Device",
        title: "Interfaces",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_METRICS,
        section: "Device",
        title: "Metrics",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_TRAFFIC,
        section: "Device",
        title: "Traffic",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_EVENTS,
        section: "Device",
        title: "Events",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_LOGS,
        section: "Device",
        title: "Logs",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_SECURITY_EVENTS,
        section: "Device",
        title: "Security Events",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_MONITORS,
        section: "Device",
        title: "Monitors",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_TABLES,
        section: "More",
        title: "SNMP Tables",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK,
        section: "More",
        title: "SNMP Walk",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_WIFI,
        section: "More",
        title: "Wi-Fi",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_OWNERS,
        section: "Manage",
        title: "Owners",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_SETTINGS,
        section: "Manage",
        title: "Settings",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_AUDIT_LOGS,
        section: "Manage",
        title: "Audit Logs",
      },
      {
        page: PageMap.NETWORK_DEVICE_VIEW_DELETE,
        section: "Manage",
        title: "Delete Device",
      },
    ],
  },
  {
    id: "network-sites",
    area: "network",
    menus: ["Pages/NetworkSite/View/SideMenu.tsx"],
    recordName: "Network Site",
    keywords: ["network site", "site", "location"],
    pages: [
      { page: PageMap.NETWORK_SITE_VIEW, section: "Site", title: "Overview" },
      {
        page: PageMap.NETWORK_SITE_VIEW_DEVICES,
        section: "Site",
        title: "Devices",
      },
      {
        page: PageMap.NETWORK_SITE_VIEW_TRAFFIC,
        section: "Site",
        title: "Traffic",
      },
      {
        page: PageMap.NETWORK_SITE_VIEW_CHILD_SITES,
        section: "Site",
        title: "Child Sites",
      },
      {
        page: PageMap.NETWORK_SITE_VIEW_ENDPOINTS,
        section: "Site",
        title: "Discovered Devices",
        formerTitles: ["Endpoints"],
      },
      {
        page: PageMap.NETWORK_SITE_VIEW_STATUS_TIMELINE,
        section: "Site",
        title: "Status Timeline",
      },
      {
        page: PageMap.NETWORK_SITE_VIEW_SCHEDULED_MAINTENANCE,
        section: "Site",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.NETWORK_SITE_VIEW_SETTINGS,
        section: "Manage",
        title: "Settings",
      },
      {
        page: PageMap.NETWORK_SITE_VIEW_AUDIT_LOGS,
        section: "Manage",
        title: "Audit Logs",
      },
      {
        page: PageMap.NETWORK_SITE_VIEW_DELETE,
        section: "Manage",
        title: "Delete Site",
      },
    ],
  },
  {
    id: "iot-fleets",
    area: "iot",
    menus: ["Pages/IoT/View/SideMenu.tsx"],
    recordName: "IoT Fleet",
    keywords: ["iot fleet", "fleet", "iot"],
    pages: [
      { page: PageMap.IOT_FLEET_VIEW, section: "Basic", title: "Overview" },
      {
        page: PageMap.IOT_FLEET_VIEW_RECOMMENDATIONS,
        section: "Basic",
        title: "Recommendations",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_DOCUMENTATION,
        section: "Basic",
        title: "Documentation",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_METRICS,
        section: "Telemetry",
        title: "Metrics",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_LOGS,
        section: "Telemetry",
        title: "Logs",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_DEVICES,
        section: "Resources",
        title: "Devices",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_DEVICE_REGISTRY,
        section: "Resources",
        title: "Device Registry",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_INCIDENTS,
        section: "Activity",
        title: "Incidents",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_ALERTS,
        section: "Activity",
        title: "Alerts",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_SCHEDULED_MAINTENANCE,
        section: "Activity",
        title: "Scheduled Maintenance",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_OWNERS,
        section: "Advanced",
        title: "Owners",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.IOT_FLEET_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Fleet",
      },
    ],
  },
  {
    id: "data-observability-stores",
    area: "data-observability",
    menus: ["Pages/DataObservability/View/SideMenu.tsx"],
    recordName: "Database",
    keywords: ["database", "data store", "warehouse"],
    pages: [
      {
        page: PageMap.DATA_OBSERVABILITY_STORE_VIEW,
        section: "Database",
        title: "Overview",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_STORE_VIEW_TABLES,
        section: "Database",
        title: "Tables",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS,
        section: "Database",
        title: "Recommendations",
      },
    ],
  },
  {
    id: "data-observability-tables",
    area: "data-observability",
    menus: ["Pages/DataObservability/TableView/SideMenu.tsx"],
    recordName: "Table",
    keywords: ["table", "tables", "data table"],
    pages: [
      {
        page: PageMap.DATA_OBSERVABILITY_TABLE_VIEW,
        section: "Table",
        title: "Overview",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLE_VIEW_COLUMNS,
        section: "Table",
        title: "Columns",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLE_VIEW_METRICS,
        section: "Table",
        title: "Metrics",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLE_VIEW_TIMELINE,
        section: "Table",
        title: "Timeline",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS,
        section: "Table",
        title: "Checks",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLE_VIEW_LINEAGE,
        section: "Table",
        title: "Lineage",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLE_VIEW_OWNERS,
        section: "Table",
        title: "Owners",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLE_VIEW_SERVICES,
        section: "Table",
        title: "Services",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLE_VIEW_SETTINGS,
        section: "Advanced",
        title: "Settings",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_TABLE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Table",
      },
    ],
  },
  {
    id: "data-pipelines",
    area: "data-observability",
    menus: ["Pages/DataPipeline/View/SideMenu.tsx"],
    recordName: "Pipeline",
    keywords: ["pipeline", "data pipeline", "job"],
    pages: [
      {
        page: PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW,
        section: "Pipeline",
        title: "Overview",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW_RECOMMENDATIONS,
        section: "Pipeline",
        title: "Recommendations",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW_CIRCUIT_BREAKER,
        section: "Pipeline",
        title: "Circuit Breaker",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW_OWNERS,
        section: "Pipeline",
        title: "Owners",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
    ],
  },
  {
    id: "data-products",
    area: "data-observability",
    menus: ["Pages/DataProduct/View/SideMenu.tsx"],
    recordName: "Data Product",
    keywords: ["data product", "data products"],
    pages: [
      {
        page: PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW,
        section: "Data Product",
        title: "Overview",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_SETTINGS,
        section: "Data Product",
        title: "Settings",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Data Product",
      },
    ],
  },
  {
    id: "data-security-stores",
    area: "data-security",
    menus: ["Pages/DataSecurity/StoreView/SideMenu.tsx"],
    recordName: "Data Store",
    keywords: ["data store", "data stores", "bucket"],
    pages: [
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW,
        section: "Data Store",
        title: "Overview",
      },
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW_INSIDE,
        section: "Data Store",
        title: "What's Inside",
      },
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW_ACCESS,
        section: "Data Store",
        title: "Who Can Reach It",
      },
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW_ISSUES,
        section: "Data Store",
        title: "Issues",
      },
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW_FLOWS,
        section: "Data Store",
        title: "Data Flows",
      },
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW_SCANS,
        section: "Data Store",
        title: "Scans",
      },
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW_TIMELINE,
        section: "Data Store",
        title: "Timeline",
      },
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW_OWNERS,
        section: "Settings",
        title: "Owners",
      },
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW_SETTINGS,
        section: "Settings",
        title: "Settings",
      },
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW_IMPACT_ASSESSMENT,
        section: "Settings",
        title: "Impact Assessment",
      },
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.DATA_SECURITY_STORE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Data Store",
      },
    ],
  },
  {
    id: "data-security-issues",
    area: "data-security",
    menus: ["Pages/DataSecurity/IssueView/SideMenu.tsx"],
    recordName: "Issue",
    keywords: ["data security issue", "issue", "finding"],
    pages: [
      {
        page: PageMap.DATA_SECURITY_ISSUE_VIEW,
        section: "Overview",
        title: "Overview",
      },
      {
        page: PageMap.DATA_SECURITY_ISSUE_VIEW_TIMELINE,
        section: "Overview",
        title: "Timeline",
      },
      {
        page: PageMap.DATA_SECURITY_ISSUE_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.DATA_SECURITY_ISSUE_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Issue",
      },
    ],
  },
  {
    id: "forms",
    area: "forms",
    menus: ["Pages/Forms/View/SideMenu.tsx"],
    recordName: "Form",
    keywords: ["form", "forms"],
    pages: [
      { page: PageMap.FORM_VIEW, section: "Form", title: "Build" },
      {
        page: PageMap.FORM_VIEW_TEMPLATES,
        section: "Form",
        title: "Templates",
      },
      {
        page: PageMap.FORM_VIEW_ON_SUBMIT,
        section: "Form",
        title: "On Submit",
      },
      { page: PageMap.FORM_VIEW_SHARE, section: "Form", title: "Share" },
      {
        page: PageMap.FORM_VIEW_CUSTOM_DOMAINS,
        section: "Form",
        title: "Custom Domains",
      },
      {
        page: PageMap.FORM_VIEW_PRIVATE_USERS,
        section: "Form",
        title: "Private Users",
        keywords: ["sign in", "invite"],
      },
      {
        page: PageMap.FORM_VIEW_SINGLE_SIGN_ON,
        section: "Form",
        title: "Single Sign-On",
        keywords: ["sso", "saml", "oidc"],
      },
      {
        page: PageMap.FORM_VIEW_SUBMISSIONS,
        section: "Form",
        title: "Submissions",
      },
      {
        page: PageMap.FORM_VIEW_DUPLICATE,
        section: "Advanced",
        title: "Duplicate Form",
      },
      {
        page: PageMap.FORM_VIEW_AUDIT_LOGS,
        section: "Advanced",
        title: "Audit Logs",
      },
      {
        page: PageMap.FORM_VIEW_DELETE,
        section: "Advanced",
        title: "Delete Form",
      },
    ],
  },
];

/*
 * The Developer pages (Terraform, Crossplane, API, CLI, AI Assistants) of a kind, from
 * the list its menu draws its Developer section from.
 */
const getDeveloperPages: (
  kind: RecordPageSearchKind,
) => Array<RecordPageSearchPage> = (
  kind: RecordPageSearchKind,
): Array<RecordPageSearchPage> => {
  const pageKeys: Set<string> = new Set<string>(
    kind.pages.map((page: RecordPageSearchPage): string => {
      return page.page;
    }),
  );

  return DEVELOPER_DOCS_PARENT_PAGES.filter(
    (parent: DeveloperDocsParentPage): boolean => {
      return (
        parent.scope === DeveloperDocsScope.View && pageKeys.has(parent.pageKey)
      );
    },
  ).flatMap((parent: DeveloperDocsParentPage): Array<RecordPageSearchPage> => {
    return DEVELOPER_DOCS_PAGES.map(
      (definition: DeveloperDocsPageDefinition): RecordPageSearchPage => {
        return {
          page: getDeveloperDocsPageKey(parent.pageKey, definition.type),
          section: DEVELOPER_DOCS_SECTION_TITLE,
          title: definition.title,
          keywords: DEVELOPER_PAGE_KEYWORDS[definition.type],
        };
      },
    );
  });
};

let kindsWithDeveloperPages: Array<RecordPageSearchKind> | null = null;

/**
 * Every kind, with its Developer pages and the keywords its titles share
 * with other kinds' pages. What Search reads; built once.
 */
export const getRecordPageSearchKinds: () => Array<RecordPageSearchKind> =
  (): Array<RecordPageSearchKind> => {
    if (kindsWithDeveloperPages) {
      return kindsWithDeveloperPages;
    }

    kindsWithDeveloperPages = RECORD_PAGE_SEARCH_KINDS.map(
      (kind: RecordPageSearchKind): RecordPageSearchKind => {
        const pages: Array<RecordPageSearchPage> = [
          ...kind.pages,
          ...getDeveloperPages(kind),
        ].map((page: RecordPageSearchPage): RecordPageSearchPage => {
          const shared: Array<string> = KEYWORDS_BY_TITLE[page.title] || [];

          if (shared.length === 0) {
            return page;
          }

          return {
            ...page,
            keywords: [...(page.keywords || []), ...shared],
          };
        });

        return { ...kind, pages };
      },
    );

    return kindsWithDeveloperPages;
  };
