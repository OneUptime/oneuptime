import PageMap from "../../Utils/PageMap";
import {
  DEVELOPER_DOCS_PAGES,
  DEVELOPER_DOCS_PARENT_PAGES,
  DEVELOPER_DOCS_SECTION_TITLE,
  DeveloperDocsPageDefinition,
  DeveloperDocsPageType,
  DeveloperDocsParentPage,
  DeveloperDocsScope,
  getDeveloperDocsPageKey,
} from "../DeveloperDocs/DeveloperDocsPages";
import { buildInventoryScopeQueryString } from "../Inventory/InventoryScope";
import IconProp from "Common/Types/Icon/IconProp";
import EntitySource from "Common/Types/Telemetry/EntitySource";

/*
 * Every page Search (Cmd/Ctrl+K) can open, as the menus show them.
 *
 * "If I search for API keys or if I search for Delete Project, we do not have
 * that in search. Can you please index more pages that are part of project
 * settings or other pages, for example, on call schedules, on-call policy,
 * and all that stuff?" (the maintainer)
 *
 * Search used to find the products only. It now finds every page a menu
 * links to: each product's lists, rules and settings, Project Settings, your
 * own User Settings and profile, and the tabs of the telemetry products.
 * An area here is one menu, and its sections and page titles are the menu's
 * own, so a result reads the way the menu does ("API Keys", under "Project
 * Settings > Advanced") and opens where the menu would.
 *
 * The menus are React components that load data as they draw, so Search
 * cannot read them while it opens; this list is what it reads instead. Two
 * tests keep the two in step: PageSearchIndexCoversMenus draws every side
 * menu and fails when one of its pages cannot be found by its menu title,
 * and PageSearchIndexCoversRoutes fails when a page in RouteMap is neither
 * here nor listed there as one that must not be offered (with the reason).
 * The Developer pages are not written out: they are added to every area
 * from DeveloperDocsPages.ts, the list their menus are drawn from.
 *
 * Titles and section names are English, as the menus write them; Search
 * translates them when it shows them. Keywords are other words people type
 * for a page ("pager", "rota", "2fa"): lowercase English, never shown.
 *
 * Kept free of React and of Common/UI so the App tests can read it.
 */

// When a page is offered: some exist only on SaaS or behind a project flag.
export enum PageSearchGate {
  // Billing, invoices and AI credits exist only where billing is turned on.
  Billing = "billing",
  // Monitor groups are behind a per-project feature flag.
  MonitorGroups = "monitor-groups",
}

// What someone must be allowed to do for an action to be offered.
export enum PageSearchPermission {
  DeleteProject = "delete-project",
}

/*
 * Something people search for by what they want to do rather than by the
 * page it is done on: "Delete Project" is done on the Danger Zone page.
 * Selecting it opens that page.
 */
export interface PageSearchAction {
  // Stable, and unique in the index: recents remember it.
  id: string;
  title: string;
  keywords?: Array<string> | undefined;
  icon?: IconProp | undefined;
  // Offered only to people who may do it.
  permission?: PageSearchPermission | undefined;
}

export interface PageSearchPage {
  // The page's key in RouteMap: a PageMap key, or a generated Developer page.
  page: PageMap | string;
  title: string;
  icon?: IconProp | undefined;
  keywords?: Array<string> | undefined;
  // A query string the menu's link carries, with its "?".
  queryString?: string | undefined;
  gate?: PageSearchGate | undefined;
  actions?: Array<PageSearchAction> | undefined;
}

export interface PageSearchSection {
  // The menu section the pages sit in. Left out for a product's tabs.
  title?: string | undefined;
  gate?: PageSearchGate | undefined;
  pages: Array<PageSearchPage>;
}

export interface PageSearchArea {
  // Stable id, used in tests and to tell areas apart.
  id: string;
  /*
   * The area's name. A result's breadcrumb starts with the products menu's
   * name for `productPage` when there is one, so the two always agree; this
   * is the name when the products menu has none.
   */
  title: string;
  productPage?: PageMap | undefined;
  icon: IconProp;
  iconColor: string;
  sections: Array<PageSearchSection>;
}

/*
 * Sections and pages several areas share, written once. Each title is the
 * one the menus show.
 */
type PageFunction = (page: PageMap) => PageSearchPage;

const ownerRules: PageFunction = (page: PageMap): PageSearchPage => {
  return {
    page,
    title: "Owner Rules",
    icon: IconProp.User,
    keywords: ["assign owners automatically", "default owners"],
  };
};

const labelRules: PageFunction = (page: PageMap): PageSearchPage => {
  return {
    page,
    title: "Label Rules",
    icon: IconProp.Tag,
    keywords: ["add labels automatically", "auto label"],
  };
};

const customFields: PageFunction = (page: PageMap): PageSearchPage => {
  return { page, title: "Custom Fields", icon: IconProp.TableCells };
};

const archived: PageFunction = (page: PageMap): PageSearchPage => {
  return { page, title: "Archived", icon: IconProp.Archive };
};

const documentation: PageFunction = (page: PageMap): PageSearchPage => {
  return {
    page,
    title: "Documentation",
    icon: IconProp.Book,
    keywords: ["setup guide", "install", "how to connect"],
  };
};

const setupGuide: PageFunction = (page: PageMap): PageSearchPage => {
  return {
    page,
    title: "Setup Guide",
    icon: IconProp.Book,
    keywords: ["documentation", "install", "how to send data"],
  };
};

/*
 * A product's Slack and Microsoft Teams pages: which of its events are sent
 * to which channel. The menu lists only the workspaces the project has
 * connected; Search offers both, because each page says how to connect
 * its workspace when it is not.
 */
const workspaceSection: (pages: {
  slack: PageMap;
  microsoftTeams: PageMap;
}) => PageSearchSection = (pages: {
  slack: PageMap;
  microsoftTeams: PageMap;
}): PageSearchSection => {
  return {
    title: "Workspace",
    pages: [
      {
        page: pages.slack,
        title: "Slack",
        icon: IconProp.Slack,
        keywords: ["slack channel", "slack notifications"],
      },
      {
        page: pages.microsoftTeams,
        title: "Microsoft Teams",
        icon: IconProp.MicrosoftTeams,
        keywords: ["ms teams", "teams channel", "teams notifications"],
      },
    ],
  };
};

/*
 * The AI section of the Incidents and Alerts menus: what OneUptime AI
 * learned (Insights), what it did (Logs), what it may do on its own
 * (Settings) and the rules for its fixes.
 *
 * Each area lists it after its Settings section, though the menu shows it
 * before Workspace: between equally good matches the palette keeps this
 * order, and "incident settings" should open the pages of Incidents >
 * Settings before the AI section's own Settings page.
 */
const incidentAlertAiSection: (pages: {
  insights: PageMap;
  logs: PageMap;
  settings: PageMap;
}) => PageSearchSection = (pages: {
  insights: PageMap;
  logs: PageMap;
  settings: PageMap;
}): PageSearchSection => {
  return {
    title: "AI",
    pages: [
      {
        page: pages.insights,
        title: "Insights",
        icon: IconProp.LightBulb,
        keywords: [
          "ai insights",
          "recurring problems",
          "root causes",
          "what ai found",
        ],
      },
      {
        page: pages.logs,
        title: "Logs",
        icon: IconProp.QueueList,
        keywords: [
          "ai logs",
          "ai activity",
          "ai investigations",
          "ai fixes",
          "ai commands",
        ],
      },
      {
        page: pages.settings,
        title: "Settings",
        icon: IconProp.Settings,
        /*
         * The rules for which incidents (or alerts) are investigated and
         * fixed are under this page's More settings: they had a page of
         * their own, Auto Remediation Rules, which is still how people
         * search for them.
         */
        keywords: [
          "ai settings",
          "ai investigation",
          "root cause",
          "ai limits",
          "auto remediation rules",
          "investigation rules",
          "self healing",
          "auto fix",
        ],
      },
    ],
  };
};

// A resource product's own Settings and Advanced sections.
const resourceSettingsSections: (pages: {
  ownerRules: PageMap;
  labelRules: PageMap;
  archived: PageMap;
  more?: Array<PageSearchPage> | undefined;
}) => Array<PageSearchSection> = (pages: {
  ownerRules: PageMap;
  labelRules: PageMap;
  archived: PageMap;
  more?: Array<PageSearchPage> | undefined;
}): Array<PageSearchSection> => {
  return [
    {
      title: "Settings",
      pages: [
        ownerRules(pages.ownerRules),
        labelRules(pages.labelRules),
        ...(pages.more || []),
      ],
    },
    { title: "Advanced", pages: [archived(pages.archived)] },
  ];
};

const allListPage: (page: PageMap, title: string) => PageSearchPage = (
  page: PageMap,
  title: string,
): PageSearchPage => {
  return { page, title, icon: IconProp.List };
};

/*
 * In the order ties are broken in: when several pages match equally well
 * ("slack", "custom fields"), Project Settings comes first, then the
 * products in the products menu's order, then the people and your own
 * pages.
 */
export const PAGE_SEARCH_AREAS: ReadonlyArray<PageSearchArea> = [
  {
    id: "project-settings",
    title: "Project Settings",
    productPage: PageMap.SETTINGS,
    icon: IconProp.Settings,
    iconColor: "slate",
    sections: [
      {
        title: "Basic",
        pages: [
          {
            page: PageMap.SETTINGS,
            title: "Project",
            icon: IconProp.Folder,
            keywords: [
              "project name",
              "rename project",
              "project id",
              "data residency",
            ],
          },
          {
            page: PageMap.SETTINGS_LABELS,
            title: "Labels",
            icon: IconProp.Label,
            keywords: ["tags", "create label"],
          },
        ],
      },
      {
        title: "Workspace",
        pages: [
          {
            page: PageMap.SETTINGS_SLACK_INTEGRATION,
            title: "Slack",
            icon: IconProp.Slack,
            keywords: ["connect slack", "slack integration", "chat"],
          },
          {
            page: PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
            title: "Microsoft Teams",
            icon: IconProp.MicrosoftTeams,
            keywords: [
              "connect microsoft teams",
              "ms teams",
              "teams integration",
              "chat",
            ],
          },
        ],
      },
      {
        title: "Telemetry & APM",
        pages: [
          {
            page: PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS,
            title: "Ingestion Keys",
            icon: IconProp.Terminal,
            keywords: [
              "telemetry ingestion keys",
              "opentelemetry",
              "otel",
              "otlp",
              "send telemetry",
            ],
          },
          {
            page: PageMap.SETTINGS_TELEMETRY_SETTINGS,
            title: "Data Retention",
            icon: IconProp.Settings,
            keywords: [
              "retention",
              "telemetry settings",
              "how long data is kept",
            ],
          },
        ],
      },
      {
        title: "Notifications",
        pages: [
          {
            page: PageMap.SETTINGS_NOTIFICATION_SETTINGS,
            title: "Notification Settings",
            icon: IconProp.Settings,
            keywords: [
              "sms",
              "phone call",
              "whatsapp",
              "telegram",
              "custom smtp",
              "email server",
              "twilio",
              "balance",
              "auto recharge",
            ],
          },
          {
            page: PageMap.SETTINGS_NOTIFICATION_LOGS,
            title: "Notification Logs",
            icon: IconProp.Bell,
            keywords: ["sms logs", "email logs", "call logs", "delivery"],
          },
          {
            page: PageMap.SETTINGS_MOBILE_APPS,
            title: "Mobile Apps",
            icon: IconProp.DevicePhoneMobile,
            keywords: ["ios", "android", "push notifications", "phone app"],
          },
        ],
      },
      {
        title: "AI",
        pages: [
          {
            page: PageMap.SETTINGS_AI_FEATURES,
            title: "AI Features",
            icon: IconProp.Sparkles,
            keywords: ["enable ai", "turn on ai", "artificial intelligence"],
          },
          {
            page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
            title: "LLM Providers",
            icon: IconProp.Brain,
            keywords: [
              "openai",
              "anthropic",
              "claude",
              "gpt",
              "model provider",
              "ai provider",
            ],
          },
          {
            page: PageMap.SETTINGS_AI_CREDITS,
            title: "AI Credits",
            icon: IconProp.Billing,
            gate: PageSearchGate.Billing,
            keywords: ["buy ai credits", "ai usage"],
          },
          {
            page: PageMap.SETTINGS_AI_LOGS,
            title: "AI Logs",
            icon: IconProp.Logs,
            keywords: ["llm logs", "ai usage"],
          },
          {
            page: PageMap.SETTINGS_MCP_SERVER,
            title: "MCP Server",
            icon: IconProp.Terminal,
            keywords: ["model context protocol", "cursor", "ai assistant"],
          },
        ],
      },
      {
        title: "Advanced",
        pages: [
          {
            page: PageMap.SETTINGS_DOMAINS,
            title: "Domains",
            icon: IconProp.Globe,
            keywords: ["custom domain", "verify domain", "dns", "txt record"],
          },
          {
            page: PageMap.SETTINGS_APIKEYS,
            title: "API Keys",
            icon: IconProp.Terminal,
            keywords: [
              "api token",
              "access token",
              "create api key",
              "new api key",
            ],
          },
          {
            page: PageMap.SETTINGS_FEATURE_FLAGS,
            title: "Feature Flags",
            icon: IconProp.Flag,
            keywords: ["beta features", "experimental", "early access"],
          },
        ],
      },
      {
        title: "Billing and Invoices",
        gate: PageSearchGate.Billing,
        pages: [
          {
            page: PageMap.SETTINGS_BILLING,
            title: "Billing",
            icon: IconProp.Billing,
            keywords: [
              "plan",
              "subscription",
              "upgrade",
              "change plan",
              "payment method",
              "credit card",
            ],
          },
          {
            page: PageMap.SETTINGS_USAGE_HISTORY,
            title: "Usage History",
            icon: IconProp.ChartBar,
            keywords: ["usage", "data ingested"],
          },
          {
            page: PageMap.SETTINGS_BILLING_INVOICES,
            title: "Invoices",
            icon: IconProp.TextFile,
            keywords: ["receipts", "payments"],
          },
        ],
      },
      {
        title: "Security",
        pages: [
          {
            page: PageMap.SETTINGS_SSO,
            title: "SSO",
            icon: IconProp.Lock,
            keywords: [
              "single sign-on",
              "saml",
              "okta",
              "azure ad",
              "entra id",
              "identity provider",
            ],
          },
          {
            page: PageMap.SETTINGS_OIDC,
            title: "OIDC",
            icon: IconProp.Lock,
            keywords: ["openid connect", "oauth", "single sign-on"],
          },
          {
            page: PageMap.SETTINGS_SCIM,
            title: "SCIM",
            icon: IconProp.Refresh,
            keywords: ["user provisioning", "directory sync", "sync users"],
          },
        ],
      },
      {
        title: "Audit Logs",
        pages: [
          {
            page: PageMap.SETTINGS_AUDIT_LOGS,
            title: "Audit Logs",
            icon: IconProp.List,
            keywords: ["activity log", "audit trail", "who changed"],
          },
          {
            page: PageMap.SETTINGS_AUDIT_LOGS_SETTINGS,
            title: "Settings",
            icon: IconProp.Settings,
            keywords: ["audit log settings", "audit log retention"],
          },
        ],
      },
      {
        title: "Danger Zone",
        pages: [
          {
            page: PageMap.SETTINGS_DANGERZONE,
            title: "Danger Zone",
            icon: IconProp.Error,
            keywords: ["delete project", "remove project"],
            actions: [
              {
                id: "delete-project",
                title: "Delete Project",
                icon: IconProp.Trash,
                keywords: ["remove project", "close project"],
                permission: PageSearchPermission.DeleteProject,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "monitors",
    title: "Monitors",
    productPage: PageMap.MONITORS,
    icon: IconProp.AltGlobe,
    iconColor: "blue",
    sections: [
      {
        title: "Monitors",
        pages: [
          allListPage(PageMap.MONITORS, "All Monitors"),
          {
            page: PageMap.MONITOR_GROUPS,
            title: "Monitor Groups",
            icon: IconProp.Squares,
            gate: PageSearchGate.MonitorGroups,
          },
        ],
      },
      {
        title: "Attention Required",
        pages: [
          {
            page: PageMap.MONITORS_INOPERATIONAL,
            title: "Not Operational",
            icon: IconProp.Alert,
            keywords: ["down monitors", "offline monitors", "failing"],
          },
          {
            page: PageMap.MONITORS_DISABLED,
            title: "Disabled",
            icon: IconProp.Error,
            keywords: ["disabled monitors", "paused monitors"],
          },
          {
            page: PageMap.MONITORS_PROBE_DISCONNECTED,
            title: "Probe Disconnected",
            icon: IconProp.NoSignal,
          },
          {
            page: PageMap.MONITORS_PROBE_DISABLED,
            title: "Probe Disabled",
            icon: IconProp.EyeSlash,
          },
        ],
      },
      workspaceSection({
        slack: PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK,
        microsoftTeams: PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      }),
      {
        title: "Settings",
        pages: [
          {
            page: PageMap.MONITORS_SETTINGS,
            title: "Monitor Status",
            icon: IconProp.AltGlobe,
            keywords: ["monitor statuses", "operational", "degraded"],
          },
          customFields(PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS),
          {
            page: PageMap.MONITORS_SETTINGS_SECRETS,
            title: "Secrets",
            icon: IconProp.Lock,
            keywords: ["monitor secrets", "credentials", "passwords"],
          },
          {
            page: PageMap.MONITORS_SETTINGS_TEMPLATES,
            title: "Templates",
            icon: IconProp.Template,
            keywords: ["monitor templates"],
          },
          ownerRules(PageMap.MONITORS_SETTINGS_OWNER_RULES),
          labelRules(PageMap.MONITORS_SETTINGS_LABEL_RULES),
          {
            page: PageMap.MONITORS_SETTINGS_PROBES,
            title: "Probes",
            icon: IconProp.Signal,
            keywords: ["custom probe", "private probe", "probe locations"],
          },
        ],
      },
      { title: "Advanced", pages: [archived(PageMap.MONITORS_ARCHIVED)] },
    ],
  },
  {
    id: "incidents",
    title: "Incidents",
    productPage: PageMap.INCIDENTS,
    icon: IconProp.Alert,
    iconColor: "rose",
    sections: [
      {
        title: "Overview",
        pages: [
          allListPage(PageMap.INCIDENTS, "All Incidents"),
          {
            page: PageMap.UNRESOLVED_INCIDENTS,
            title: "Active Incidents",
            icon: IconProp.Alert,
            keywords: ["open incidents", "ongoing incidents", "unresolved"],
          },
        ],
      },
      {
        title: "Episodes",
        pages: [
          {
            page: PageMap.INCIDENT_EPISODES,
            title: "All Episodes",
            icon: IconProp.SquareStack3D,
            keywords: ["incident episodes", "grouped incidents"],
          },
          {
            page: PageMap.UNRESOLVED_INCIDENT_EPISODES,
            title: "Active Episodes",
            icon: IconProp.Alert,
          },
          {
            page: PageMap.INCIDENT_EPISODE_DOCS,
            title: "Documentation",
            icon: IconProp.Book,
            keywords: ["how episodes work"],
          },
        ],
      },
      workspaceSection({
        slack: PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK,
        microsoftTeams: PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      }),
      {
        title: "Rules",
        pages: [
          {
            page: PageMap.INCIDENTS_SETTINGS_GROUPING_RULES,
            title: "Grouping Rules",
            icon: IconProp.Filter,
            keywords: ["episode rules", "group incidents", "deduplicate"],
          },
          {
            page: PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES,
            title: "On-Call Rules",
            icon: IconProp.Call,
            keywords: ["who gets paged", "paging", "page on-call"],
          },
          ownerRules(PageMap.INCIDENTS_SETTINGS_OWNER_RULES),
          {
            page: PageMap.INCIDENTS_SETTINGS_RUNBOOK_RULES,
            title: "Runbook Rules",
            icon: IconProp.BookOpen,
          },
          {
            page: PageMap.INCIDENTS_SETTINGS_PRIVACY_RULES,
            title: "Privacy Rules",
            icon: IconProp.Lock,
            keywords: ["private incidents", "visibility"],
          },
          labelRules(PageMap.INCIDENTS_SETTINGS_LABEL_RULES),
          {
            page: PageMap.INCIDENTS_SETTINGS_SLA_RULES,
            title: "SLA Rules",
            icon: IconProp.Clock,
            keywords: ["service level agreement", "response time"],
          },
          {
            page: PageMap.INCIDENTS_SETTINGS_REMINDER_RULES,
            title: "Reminder Rules",
            icon: IconProp.Bell,
            keywords: ["reminders"],
          },
        ],
      },
      {
        title: "Settings",
        pages: [
          {
            page: PageMap.INCIDENTS_SETTINGS_STATE,
            title: "Incident State",
            icon: IconProp.ArrowCircleRight,
            keywords: ["acknowledged", "resolved", "incident status"],
          },
          {
            page: PageMap.INCIDENTS_SETTINGS_SEVERITY,
            title: "Incident Severity",
            icon: IconProp.Alert,
            keywords: ["priority", "sev1", "p1"],
          },
          {
            page: PageMap.INCIDENTS_SETTINGS_TEMPLATES,
            title: "Incident Templates",
            icon: IconProp.Template,
          },
          {
            page: PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES,
            title: "Note Templates",
            icon: IconProp.Pencil,
          },
          {
            page: PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES,
            title: "Postmortem Templates",
            icon: IconProp.Book,
            keywords: ["post mortem", "retrospective", "rca"],
          },
          customFields(PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS),
          {
            page: PageMap.INCIDENTS_SETTINGS_ROLES,
            title: "Incident Roles",
            icon: IconProp.User,
            keywords: ["incident commander"],
          },
          {
            page: PageMap.INCIDENTS_SETTINGS_MEASUREMENTS,
            title: "Measurements",
            icon: IconProp.Clock,
            keywords: ["mttr", "mtta", "time to resolve", "time to mitigate"],
          },
          {
            page: PageMap.INCIDENTS_SETTINGS_LINKED_ALERTS,
            title: "Linked Alerts",
            icon: IconProp.Link,
          },
          {
            page: PageMap.INCIDENTS_SETTINGS_NUMBER_PREFIX,
            title: "Number Prefix",
            icon: IconProp.Hashtag,
            keywords: ["incident number"],
          },
        ],
      },
      incidentAlertAiSection({
        insights: PageMap.INCIDENTS_AI_INSIGHTS,
        logs: PageMap.INCIDENTS_AI_LOGS,
        settings: PageMap.INCIDENTS_SETTINGS_AI,
      }),
    ],
  },
  {
    id: "alerts",
    title: "Alerts",
    productPage: PageMap.ALERTS,
    icon: IconProp.ExclaimationCircle,
    iconColor: "amber",
    sections: [
      {
        title: "Alerts",
        pages: [
          allListPage(PageMap.ALERTS, "All Alerts"),
          {
            page: PageMap.UNRESOLVED_ALERTS,
            title: "Active Alerts",
            icon: IconProp.ExclaimationCircle,
            keywords: ["open alerts", "unresolved"],
          },
        ],
      },
      {
        title: "Episodes",
        pages: [
          {
            page: PageMap.ALERT_EPISODES,
            title: "All Episodes",
            icon: IconProp.SquareStack,
            keywords: ["alert episodes", "grouped alerts"],
          },
          {
            page: PageMap.UNRESOLVED_ALERT_EPISODES,
            title: "Active Episodes",
            icon: IconProp.ExclaimationCircle,
          },
          {
            page: PageMap.ALERT_EPISODE_DOCS,
            title: "Documentation",
            icon: IconProp.Book,
            keywords: ["how episodes work"],
          },
        ],
      },
      workspaceSection({
        slack: PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK,
        microsoftTeams: PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      }),
      {
        title: "Rules",
        pages: [
          {
            page: PageMap.ALERTS_SETTINGS_GROUPING_RULES,
            title: "Grouping Rules",
            icon: IconProp.Filter,
            keywords: ["episode rules", "group alerts", "deduplicate"],
          },
          {
            page: PageMap.ALERTS_SETTINGS_ON_CALL_RULES,
            title: "On-Call Rules",
            icon: IconProp.Call,
            keywords: ["who gets paged", "paging", "page on-call"],
          },
          ownerRules(PageMap.ALERTS_SETTINGS_OWNER_RULES),
          {
            page: PageMap.ALERTS_SETTINGS_RUNBOOK_RULES,
            title: "Runbook Rules",
            icon: IconProp.BookOpen,
          },
          {
            page: PageMap.ALERTS_SETTINGS_PRIVACY_RULES,
            title: "Privacy Rules",
            icon: IconProp.Lock,
            keywords: ["private alerts", "visibility"],
          },
          labelRules(PageMap.ALERTS_SETTINGS_LABEL_RULES),
          {
            page: PageMap.ALERTS_SETTINGS_REMINDER_RULES,
            title: "Reminder Rules",
            icon: IconProp.Bell,
            keywords: ["reminders"],
          },
        ],
      },
      {
        title: "Settings",
        pages: [
          {
            page: PageMap.ALERTS_SETTINGS_STATE,
            title: "Alert State",
            icon: IconProp.ArrowCircleRight,
            keywords: ["acknowledged", "resolved", "alert status"],
          },
          {
            page: PageMap.ALERTS_SETTINGS_SEVERITY,
            title: "Alert Severity",
            icon: IconProp.Alert,
            keywords: ["priority"],
          },
          {
            page: PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES,
            title: "Note Templates",
            icon: IconProp.Pencil,
          },
          customFields(PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS),
          {
            page: PageMap.ALERTS_SETTINGS_MEASUREMENTS,
            title: "Measurements",
            icon: IconProp.Clock,
            keywords: ["mtta", "time to resolve"],
          },
          {
            page: PageMap.ALERTS_SETTINGS_NUMBER_PREFIX,
            title: "Number Prefix",
            icon: IconProp.Hashtag,
            keywords: ["alert number"],
          },
        ],
      },
      incidentAlertAiSection({
        insights: PageMap.ALERTS_AI_INSIGHTS,
        logs: PageMap.ALERTS_AI_LOGS,
        settings: PageMap.ALERTS_SETTINGS_AI,
      }),
    ],
  },
  {
    id: "on-call-duty",
    title: "On-Call Duty",
    productPage: PageMap.ON_CALL_DUTY,
    icon: IconProp.Call,
    iconColor: "stone",
    sections: [
      {
        title: "Policies",
        pages: [
          {
            page: PageMap.ON_CALL_DUTY_POLICIES,
            title: "On-Call Policies",
            icon: IconProp.Call,
            keywords: [
              "escalation",
              "escalation policies",
              "escalation rules",
              "paging policy",
              "pager",
              "create on-call policy",
            ],
          },
          {
            page: PageMap.ON_CALL_DUTY_READINESS,
            title: "Readiness",
            icon: IconProp.ShieldCheck,
            keywords: ["can be paged", "coverage", "unreachable responders"],
          },
        ],
      },
      {
        title: "Schedules",
        pages: [
          {
            page: PageMap.ON_CALL_DUTY_SCHEDULES,
            title: "On-Call Schedules",
            icon: IconProp.Calendar,
            keywords: [
              "rota",
              "rotation",
              "roster",
              "shifts",
              "who is on call",
              "create on-call schedule",
            ],
          },
          {
            page: PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE,
            title: "Schedule Timeline",
            icon: IconProp.ViewColumns,
            keywords: ["rota", "who is on call", "calendar"],
          },
          {
            page: PageMap.ON_CALL_DUTY_CALENDAR_FEEDS,
            title: "Calendar Feeds",
            icon: IconProp.Link,
            keywords: ["ical", "ics", "google calendar", "outlook"],
          },
        ],
      },
      {
        title: "Incoming Calls",
        pages: [
          {
            page: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES,
            title: "Incoming Call Policies",
            icon: IconProp.IncomingCall,
            keywords: ["hotline", "phone number", "call routing"],
          },
        ],
      },
      {
        title: "Advanced",
        pages: [
          {
            page: PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES,
            title: "User Overrides",
            icon: IconProp.User,
            keywords: ["vacation", "time off", "cover", "swap shift"],
          },
          {
            page: PageMap.ON_CALL_DUTY_EXECUTION_LOGS,
            title: "Execution Logs",
            icon: IconProp.Logs,
            keywords: ["paging logs", "escalation logs"],
          },
          {
            page: PageMap.ON_CALL_DUTY_POLICIES_ARCHIVED,
            title: "Archived Policies",
            icon: IconProp.Archive,
          },
        ],
      },
      {
        title: "Reports",
        pages: [
          {
            page: PageMap.ON_CALLDUTY_USER_TIME_LOGS,
            title: "User On Call Time",
            icon: IconProp.Clock,
            keywords: ["on-call hours", "time report"],
          },
        ],
      },
      workspaceSection({
        slack: PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK,
        microsoftTeams:
          PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      }),
      {
        title: "Settings",
        pages: [
          customFields(PageMap.ON_CALL_DUTY_SETTINGS_CUSTOM_FIELDS),
          labelRules(PageMap.ON_CALL_DUTY_SETTINGS_LABEL_RULES),
          ownerRules(PageMap.ON_CALL_DUTY_SETTINGS_OWNER_RULES),
        ],
      },
    ],
  },
  {
    id: "status-pages",
    title: "Status Pages",
    productPage: PageMap.STATUS_PAGES,
    icon: IconProp.CheckCircle,
    iconColor: "emerald",
    sections: [
      {
        title: "Status Pages",
        pages: [
          {
            page: PageMap.STATUS_PAGES,
            title: "All Status Pages",
            icon: IconProp.CheckCircle,
            keywords: ["create status page", "public status page"],
          },
        ],
      },
      {
        title: "More",
        pages: [
          {
            page: PageMap.STATUS_PAGE_ANNOUNCEMENTS,
            title: "Announcements",
            icon: IconProp.Announcement,
            keywords: ["status page notice", "post an update"],
          },
        ],
      },
      {
        title: "Settings",
        pages: [
          {
            page: PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES,
            title: "Announcement Templates",
            icon: IconProp.Announcement,
          },
          {
            page: PageMap.STATUS_PAGES_SETTINGS_SUBSCRIBER_NOTIFICATION_TEMPLATES,
            title: "Subscriber Templates",
            icon: IconProp.Email,
            keywords: ["subscriber emails", "subscriber notification"],
          },
          customFields(PageMap.STATUS_PAGES_SETTINGS_CUSTOM_FIELDS),
          ownerRules(PageMap.STATUS_PAGES_SETTINGS_OWNER_RULES),
          labelRules(PageMap.STATUS_PAGES_SETTINGS_LABEL_RULES),
        ],
      },
      { title: "Advanced", pages: [archived(PageMap.STATUS_PAGES_ARCHIVED)] },
    ],
  },
  {
    id: "scheduled-maintenance",
    title: "Scheduled Maintenance",
    productPage: PageMap.SCHEDULED_MAINTENANCE_EVENTS,
    icon: IconProp.Clock,
    iconColor: "cyan",
    sections: [
      {
        title: "Overview",
        pages: [
          allListPage(PageMap.SCHEDULED_MAINTENANCE_EVENTS, "All Events"),
          {
            page: PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
            title: "Ongoing Events",
            icon: IconProp.Clock,
            keywords: ["maintenance in progress"],
          },
        ],
      },
      workspaceSection({
        slack: PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK,
        microsoftTeams:
          PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      }),
      {
        title: "Rules",
        pages: [
          ownerRules(PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_OWNER_RULES),
          {
            page: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_RUNBOOK_RULES,
            title: "Runbook Rules",
            icon: IconProp.BookOpen,
          },
          labelRules(PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_LABEL_RULES),
          {
            page: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_REMINDER_RULES,
            title: "Reminder Rules",
            icon: IconProp.Bell,
            keywords: ["reminders"],
          },
        ],
      },
      {
        title: "Settings",
        pages: [
          {
            page: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_STATE,
            title: "Event State",
            icon: IconProp.ArrowCircleRight,
            keywords: ["maintenance states"],
          },
          {
            page: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES,
            title: "Event Templates",
            icon: IconProp.Template,
            keywords: ["maintenance templates"],
          },
          {
            page: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES,
            title: "Note Templates",
            icon: IconProp.Pencil,
          },
          customFields(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS,
          ),
          {
            page: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_MEASUREMENTS,
            title: "Measurements",
            icon: IconProp.Clock,
          },
          {
            page: PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NUMBER_PREFIX,
            title: "Number Prefix",
            icon: IconProp.Hashtag,
          },
        ],
      },
    ],
  },
  {
    id: "slos",
    title: "SLOs",
    productPage: PageMap.SLOS,
    icon: IconProp.Gauge,
    iconColor: "violet",
    sections: [
      {
        title: "Service Level Objectives",
        pages: [{ page: PageMap.SLOS, title: "SLOs", icon: IconProp.Gauge }],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.SLOS_SETTINGS_OWNER_RULES,
        labelRules: PageMap.SLOS_SETTINGS_LABEL_RULES,
        archived: PageMap.SLOS_ARCHIVED,
      }),
    ],
  },
  {
    id: "logs",
    title: "Logs",
    productPage: PageMap.LOGS,
    icon: IconProp.Logs,
    iconColor: "amber",
    sections: [
      {
        pages: [
          {
            page: PageMap.LOGS,
            title: "Viewer",
            icon: IconProp.List,
            keywords: ["log search", "log explorer", "search logs"],
          },
          {
            page: PageMap.LOGS_INSIGHTS,
            title: "Insights",
            icon: IconProp.ChartBar,
            keywords: ["log patterns", "top errors"],
          },
          setupGuide(PageMap.LOGS_DOCUMENTATION),
        ],
      },
      {
        title: "Log Settings",
        pages: [
          {
            page: PageMap.LOGS_SETTINGS_PIPELINES,
            title: "Pipelines",
            icon: IconProp.Logs,
            keywords: ["log pipelines", "parse logs", "processors"],
          },
          {
            page: PageMap.LOGS_SETTINGS_DROP_FILTERS,
            title: "Drop Filters",
            icon: IconProp.Filter,
            keywords: ["drop logs", "reduce log volume"],
          },
          {
            page: PageMap.LOGS_SETTINGS_SCRUB_RULES,
            title: "Scrub Rules",
            icon: IconProp.ShieldCheck,
            keywords: ["pii", "redact", "mask sensitive data"],
          },
          {
            page: PageMap.LOGS_SETTINGS_RECORDING_RULES,
            title: "Recording Rules",
            icon: IconProp.Calculator,
            keywords: ["log metrics", "logs to metrics", "derived metrics"],
          },
        ],
      },
    ],
  },
  {
    id: "metrics",
    title: "Metrics",
    productPage: PageMap.METRICS,
    icon: IconProp.Heartbeat,
    iconColor: "purple",
    sections: [
      {
        pages: [
          {
            page: PageMap.METRICS,
            title: "Viewer",
            icon: IconProp.List,
            keywords: ["metric explorer", "search metrics"],
          },
          {
            page: PageMap.METRICS_INSIGHTS,
            title: "Insights",
            icon: IconProp.ChartBar,
          },
          setupGuide(PageMap.METRICS_DOCUMENTATION),
        ],
      },
      {
        title: "Metric Settings",
        pages: [
          {
            page: PageMap.METRICS_SETTINGS_PIPELINE_RULES,
            title: "Pipeline Rules",
            icon: IconProp.Filter,
            keywords: ["metric pipelines", "drop metrics"],
          },
          {
            page: PageMap.METRICS_SETTINGS_RECORDING_RULES,
            title: "Recording Rules",
            icon: IconProp.Calculator,
            keywords: ["derived metrics", "prometheus recording rules"],
          },
        ],
      },
    ],
  },
  {
    id: "traces",
    title: "Traces",
    productPage: PageMap.TRACES,
    icon: IconProp.Waterfall,
    iconColor: "yellow",
    sections: [
      {
        pages: [
          {
            page: PageMap.TRACES,
            title: "Viewer",
            icon: IconProp.List,
            keywords: ["trace search", "spans", "search traces"],
          },
          {
            page: PageMap.TRACES_INSIGHTS,
            title: "Insights",
            icon: IconProp.ChartBar,
          },
          setupGuide(PageMap.TRACES_DOCUMENTATION),
        ],
      },
      {
        title: "Trace Settings",
        pages: [
          {
            page: PageMap.TRACES_SETTINGS_PIPELINES,
            title: "Pipelines",
            icon: IconProp.Activity,
            keywords: ["trace pipelines", "span processors"],
          },
          {
            page: PageMap.TRACES_SETTINGS_DROP_FILTERS,
            title: "Drop Filters",
            icon: IconProp.Filter,
            keywords: ["drop spans", "sampling"],
          },
          {
            page: PageMap.TRACES_SETTINGS_SCRUB_RULES,
            title: "Scrub Rules",
            icon: IconProp.ShieldCheck,
            keywords: ["pii", "redact", "mask sensitive data"],
          },
          {
            page: PageMap.TRACES_SETTINGS_RECORDING_RULES,
            title: "Recording Rules",
            icon: IconProp.Calculator,
            keywords: ["span metrics"],
          },
        ],
      },
    ],
  },
  {
    id: "profiles",
    title: "Performance Profiles",
    productPage: PageMap.PROFILES,
    icon: IconProp.Fire,
    iconColor: "red",
    sections: [
      {
        title: "Profiler",
        pages: [
          {
            page: PageMap.PROFILES,
            title: "Overview",
            icon: IconProp.Bolt,
            keywords: ["flame graph", "cpu profiling"],
          },
          {
            page: PageMap.PROFILES_INSIGHTS,
            title: "All profiles",
            icon: IconProp.List,
          },
        ],
      },
      {
        title: "Help",
        pages: [
          {
            page: PageMap.PROFILES_DOCUMENTATION,
            title: "Setup guide",
            icon: IconProp.Book,
            keywords: ["documentation", "install"],
          },
        ],
      },
    ],
  },
  {
    id: "exceptions",
    title: "Exceptions",
    productPage: PageMap.EXCEPTIONS,
    icon: IconProp.Bug,
    iconColor: "orange",
    sections: [
      {
        pages: [
          {
            page: PageMap.EXCEPTIONS,
            title: "Exceptions",
            icon: IconProp.Alert,
          },
          {
            page: PageMap.EXCEPTIONS_OVERVIEW,
            title: "Insights",
            icon: IconProp.ChartBar,
            keywords: ["error trends", "top errors"],
          },
          setupGuide(PageMap.EXCEPTIONS_DOCUMENTATION),
        ],
      },
    ],
  },
  {
    id: "llm",
    title: "AI / LLM",
    productPage: PageMap.LLM,
    icon: IconProp.Sparkles,
    iconColor: "violet",
    sections: [
      {
        pages: [
          {
            page: PageMap.LLM_OVERVIEW,
            title: "Overview",
            icon: IconProp.ChartBar,
          },
          {
            page: PageMap.LLM_USAGE,
            title: "Usage",
            icon: IconProp.ChartBar,
            keywords: ["tokens", "llm cost"],
          },
          {
            page: PageMap.LLM_CALLS,
            title: "LLM Calls",
            icon: IconProp.List,
            keywords: ["prompts", "completions"],
          },
          {
            page: PageMap.LLM_BUDGETS,
            title: "Budgets",
            icon: IconProp.Billing,
            keywords: ["llm spend limit"],
          },
          {
            page: PageMap.LLM_PRICING,
            title: "Pricing",
            icon: IconProp.Billing,
            keywords: ["model prices", "token prices"],
          },
          {
            page: PageMap.LLM_DOCUMENTATION,
            title: "Setup",
            icon: IconProp.Book,
            keywords: ["setup guide", "documentation"],
          },
        ],
      },
    ],
  },
  {
    id: "security-events",
    title: "Security Events",
    productPage: PageMap.SECURITY_EVENTS,
    icon: IconProp.ShieldExclamation,
    iconColor: "rose",
    sections: [
      {
        pages: [
          {
            page: PageMap.SECURITY_EVENTS,
            title: "Events",
            icon: IconProp.List,
            keywords: ["siem", "security logs"],
          },
          {
            page: PageMap.SECURITY_EVENTS_CORRELATE,
            title: "Correlate",
            icon: IconProp.Link,
          },
          {
            page: PageMap.SECURITY_EVENTS_DETECTION_RULES,
            title: "Detection Rules",
            icon: IconProp.Filter,
            keywords: ["sigma rules", "threat detection"],
          },
          {
            page: PageMap.SECURITY_EVENTS_THREAT_INTEL,
            title: "Threat Intel",
            icon: IconProp.ShieldExclamation,
            keywords: [
              "threat intelligence",
              "indicators of compromise",
              "ioc",
            ],
          },
          {
            page: PageMap.SECURITY_EVENTS_MONITORS,
            title: "Monitors",
            icon: IconProp.AltGlobe,
            keywords: ["security monitors"],
          },
          {
            page: PageMap.SECURITY_EVENTS_CONNECTIONS,
            title: "Connections",
            icon: IconProp.Link,
            keywords: ["security sources", "connect a source"],
          },
          setupGuide(PageMap.SECURITY_EVENTS_DOCUMENTATION),
        ],
      },
    ],
  },
  {
    id: "ai-insights",
    title: "Insights",
    productPage: PageMap.AI_INSIGHTS,
    icon: IconProp.LightBulb,
    iconColor: "violet",
    sections: [
      {
        title: "Overview",
        pages: [
          {
            page: PageMap.AI_INSIGHTS,
            title: "Insights",
            icon: IconProp.LightBulb,
          },
          {
            page: PageMap.AI_INSIGHTS_SETTINGS,
            title: "Settings",
            icon: IconProp.Settings,
            keywords: ["insight settings"],
          },
        ],
      },
    ],
  },
  {
    id: "code",
    title: "Code",
    icon: IconProp.CPUChip,
    iconColor: "violet",
    sections: [
      {
        title: "Code",
        pages: [
          {
            page: PageMap.AI_AGENT_TASKS,
            title: "Tasks",
            icon: IconProp.CPUChip,
            keywords: ["ai agent tasks", "pull requests", "fixes"],
          },
          {
            page: PageMap.CODE_REPOSITORY,
            title: "Code Repositories",
            icon: IconProp.Code,
            keywords: ["github", "gitlab", "repository", "connect repository"],
          },
        ],
      },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    productPage: PageMap.INVENTORY,
    icon: IconProp.Cube,
    iconColor: "indigo",
    sections: [
      {
        title: "Inventory",
        pages: [
          {
            page: PageMap.INVENTORY,
            title: "Overview",
            icon: IconProp.ChartBar,
          },
          allListPage(PageMap.INVENTORY_ITEMS, "All Items"),
          {
            page: PageMap.TOPOLOGY,
            title: "Topology Map",
            icon: IconProp.FlowDiagram,
            keywords: ["dependency map", "service map"],
          },
          {
            page: PageMap.INVENTORY_ITEMS,
            title: "Gone Quiet",
            icon: IconProp.ExclaimationCircle,
            queryString: buildInventoryScopeQueryString({
              source: EntitySource.Discovered,
              staleOnly: true,
            }),
            keywords: ["stale", "no recent telemetry"],
          },
        ],
      },
      {
        title: "By Source",
        pages: [
          {
            page: PageMap.INVENTORY_ITEMS,
            title: "Discovered",
            icon: IconProp.Sparkles,
            queryString: buildInventoryScopeQueryString({
              source: EntitySource.Discovered,
            }),
          },
          {
            page: PageMap.INVENTORY_ITEMS,
            title: "Mirrored",
            icon: IconProp.Copy,
            queryString: buildInventoryScopeQueryString({
              source: EntitySource.Inventory,
            }),
          },
          {
            page: PageMap.INVENTORY_ITEMS,
            title: "Added by You",
            icon: IconProp.User,
            queryString: buildInventoryScopeQueryString({
              source: EntitySource.Manual,
            }),
            keywords: ["manual items"],
          },
        ],
      },
      {
        title: "Settings",
        pages: [customFields(PageMap.INVENTORY_SETTINGS_CUSTOM_FIELDS)],
      },
      {
        title: "Help",
        pages: [documentation(PageMap.INVENTORY_DOCUMENTATION)],
      },
      { title: "Advanced", pages: [archived(PageMap.INVENTORY_ARCHIVED)] },
    ],
  },
  {
    id: "services",
    title: "Services",
    productPage: PageMap.SERVICES,
    icon: IconProp.SquareStack,
    iconColor: "indigo",
    sections: [
      {
        title: "Services",
        pages: [allListPage(PageMap.SERVICES, "All Services")],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.SERVICE_SETTINGS_OWNER_RULES,
        labelRules: PageMap.SERVICE_SETTINGS_LABEL_RULES,
        archived: PageMap.SERVICE_ARCHIVED,
      }),
    ],
  },
  {
    id: "databases",
    title: "Databases",
    productPage: PageMap.DATABASE_SERVERS,
    icon: IconProp.Database,
    iconColor: "indigo",
    sections: [
      {
        title: "Databases",
        pages: [
          allListPage(PageMap.DATABASE_SERVERS, "All Databases"),
          documentation(PageMap.DATABASE_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.DATABASE_SETTINGS_OWNER_RULES,
        labelRules: PageMap.DATABASE_SETTINGS_LABEL_RULES,
        archived: PageMap.DATABASE_ARCHIVED,
      }),
    ],
  },
  {
    id: "queues",
    title: "Queues",
    productPage: PageMap.MESSAGE_QUEUES,
    icon: IconProp.QueueList,
    iconColor: "indigo",
    sections: [
      {
        title: "Queues",
        pages: [
          allListPage(PageMap.MESSAGE_QUEUES, "All Queues"),
          documentation(PageMap.MESSAGE_QUEUES_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES,
        labelRules: PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES,
        archived: PageMap.MESSAGE_QUEUES_ARCHIVED,
      }),
    ],
  },
  {
    id: "rum",
    title: "Real User Monitoring",
    productPage: PageMap.RUM_APPLICATIONS,
    icon: IconProp.Globe,
    iconColor: "blue",
    sections: [
      {
        title: "Real User Monitoring",
        pages: [allListPage(PageMap.RUM_APPLICATIONS, "All Applications")],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.RUM_SETTINGS_OWNER_RULES,
        labelRules: PageMap.RUM_SETTINGS_LABEL_RULES,
        archived: PageMap.RUM_ARCHIVED,
        more: [
          {
            page: PageMap.RUM_SETTINGS_SESSION_REPLAY,
            title: "Session Replay",
            icon: IconProp.Film,
            keywords: ["session recording", "replay retention"],
          },
        ],
      }),
    ],
  },
  {
    id: "hosts",
    title: "Hosts",
    productPage: PageMap.HOSTS,
    icon: IconProp.Server,
    iconColor: "slate",
    sections: [
      {
        title: "Hosts",
        pages: [
          allListPage(PageMap.HOSTS, "All Hosts"),
          documentation(PageMap.HOST_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.HOST_SETTINGS_OWNER_RULES,
        labelRules: PageMap.HOST_SETTINGS_LABEL_RULES,
        archived: PageMap.HOST_ARCHIVED,
      }),
    ],
  },
  {
    id: "kubernetes",
    title: "Kubernetes",
    productPage: PageMap.KUBERNETES_CLUSTERS,
    icon: IconProp.Kubernetes,
    iconColor: "blue",
    sections: [
      {
        title: "Kubernetes",
        pages: [
          allListPage(PageMap.KUBERNETES_CLUSTERS, "All Clusters"),
          {
            page: PageMap.KUBERNETES_COSTS,
            title: "Costs",
            icon: IconProp.Billing,
            keywords: ["kubernetes cost", "spend"],
          },
          documentation(PageMap.KUBERNETES_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.KUBERNETES_SETTINGS_OWNER_RULES,
        labelRules: PageMap.KUBERNETES_SETTINGS_LABEL_RULES,
        archived: PageMap.KUBERNETES_ARCHIVED,
      }),
    ],
  },
  {
    id: "docker",
    title: "Docker",
    productPage: PageMap.DOCKER_HOSTS,
    icon: IconProp.Docker,
    iconColor: "blue",
    sections: [
      {
        title: "Docker",
        pages: [
          allListPage(PageMap.DOCKER_HOSTS, "All Hosts"),
          documentation(PageMap.DOCKER_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.DOCKER_SETTINGS_OWNER_RULES,
        labelRules: PageMap.DOCKER_SETTINGS_LABEL_RULES,
        archived: PageMap.DOCKER_ARCHIVED,
      }),
    ],
  },
  {
    id: "docker-swarm",
    title: "Docker Swarm",
    productPage: PageMap.DOCKER_SWARM_CLUSTERS,
    icon: IconProp.DockerSwarm,
    iconColor: "blue",
    sections: [
      {
        title: "Docker Swarm",
        pages: [
          allListPage(PageMap.DOCKER_SWARM_CLUSTERS, "All Clusters"),
          documentation(PageMap.DOCKER_SWARM_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.DOCKER_SWARM_SETTINGS_OWNER_RULES,
        labelRules: PageMap.DOCKER_SWARM_SETTINGS_LABEL_RULES,
        archived: PageMap.DOCKER_SWARM_ARCHIVED,
      }),
    ],
  },
  {
    id: "podman",
    title: "Podman",
    productPage: PageMap.PODMAN_HOSTS,
    icon: IconProp.Podman,
    iconColor: "blue",
    sections: [
      {
        title: "Podman",
        pages: [
          allListPage(PageMap.PODMAN_HOSTS, "All Hosts"),
          documentation(PageMap.PODMAN_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.PODMAN_SETTINGS_OWNER_RULES,
        labelRules: PageMap.PODMAN_SETTINGS_LABEL_RULES,
        archived: PageMap.PODMAN_ARCHIVED,
      }),
    ],
  },
  {
    id: "serverless",
    title: "Serverless",
    productPage: PageMap.SERVERLESS_FUNCTIONS,
    icon: IconProp.Bolt,
    iconColor: "blue",
    sections: [
      {
        title: "Serverless",
        pages: [allListPage(PageMap.SERVERLESS_FUNCTIONS, "All Functions")],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.SERVERLESS_SETTINGS_OWNER_RULES,
        labelRules: PageMap.SERVERLESS_SETTINGS_LABEL_RULES,
        archived: PageMap.SERVERLESS_ARCHIVED,
      }),
    ],
  },
  {
    id: "cloud",
    title: "Cloud",
    productPage: PageMap.CLOUD_RESOURCES,
    icon: IconProp.Cloud,
    iconColor: "blue",
    sections: [
      {
        title: "Cloud",
        pages: [
          allListPage(PageMap.CLOUD_RESOURCES, "All Environments"),
          {
            ...allListPage(PageMap.CLOUD_MONITORED_RESOURCES, "All Resources"),
            keywords: [
              "iaas",
              "paas",
              "virtual machines",
              "load balancers",
              "buckets",
              "managed databases",
              "azure monitor",
              "cloudwatch",
              "cloud monitoring",
            ],
          },
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.CLOUD_SETTINGS_OWNER_RULES,
        labelRules: PageMap.CLOUD_SETTINGS_LABEL_RULES,
        archived: PageMap.CLOUD_ARCHIVED,
      }),
    ],
  },
  {
    id: "proxmox",
    title: "Proxmox",
    productPage: PageMap.PROXMOX_CLUSTERS,
    icon: IconProp.Proxmox,
    iconColor: "blue",
    sections: [
      {
        title: "Proxmox",
        pages: [
          allListPage(PageMap.PROXMOX_CLUSTERS, "All Clusters"),
          documentation(PageMap.PROXMOX_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.PROXMOX_SETTINGS_OWNER_RULES,
        labelRules: PageMap.PROXMOX_SETTINGS_LABEL_RULES,
        archived: PageMap.PROXMOX_ARCHIVED,
      }),
    ],
  },
  {
    id: "vmware",
    title: "VMware",
    productPage: PageMap.VMWARE_VCENTERS,
    icon: IconProp.VMware,
    iconColor: "blue",
    sections: [
      {
        title: "VMware",
        pages: [
          allListPage(PageMap.VMWARE_VCENTERS, "All vCenters"),
          documentation(PageMap.VMWARE_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.VMWARE_SETTINGS_OWNER_RULES,
        labelRules: PageMap.VMWARE_SETTINGS_LABEL_RULES,
        archived: PageMap.VMWARE_ARCHIVED,
      }),
    ],
  },
  {
    id: "ceph",
    title: "Ceph",
    productPage: PageMap.CEPH_CLUSTERS,
    icon: IconProp.Ceph,
    iconColor: "blue",
    sections: [
      {
        title: "Ceph",
        pages: [
          allListPage(PageMap.CEPH_CLUSTERS, "All Clusters"),
          documentation(PageMap.CEPH_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.CEPH_SETTINGS_OWNER_RULES,
        labelRules: PageMap.CEPH_SETTINGS_LABEL_RULES,
        archived: PageMap.CEPH_ARCHIVED,
      }),
    ],
  },
  {
    id: "storage-arrays",
    title: "Storage Arrays",
    productPage: PageMap.STORAGE_ARRAYS,
    icon: IconProp.StorageArray,
    iconColor: "blue",
    sections: [
      {
        title: "Storage Arrays",
        pages: [
          allListPage(PageMap.STORAGE_ARRAYS, "All Storage Arrays"),
          documentation(PageMap.STORAGE_ARRAYS_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.STORAGE_ARRAYS_SETTINGS_OWNER_RULES,
        labelRules: PageMap.STORAGE_ARRAYS_SETTINGS_LABEL_RULES,
        archived: PageMap.STORAGE_ARRAYS_ARCHIVED,
      }),
    ],
  },
  {
    id: "network",
    title: "Network",
    productPage: PageMap.NETWORK_OVERVIEW,
    icon: IconProp.Signal,
    iconColor: "indigo",
    sections: [
      {
        title: "Network",
        pages: [
          {
            page: PageMap.NETWORK_OVERVIEW,
            title: "Overview",
            icon: IconProp.Window,
          },
          {
            page: PageMap.NETWORK_DEVICES,
            title: "Devices",
            icon: IconProp.Signal,
            keywords: ["network devices", "routers", "switches", "snmp"],
          },
          {
            page: PageMap.NETWORK_SITES,
            title: "Sites",
            icon: IconProp.BuildingOffice,
            keywords: ["network sites", "locations", "offices"],
          },
          {
            page: PageMap.NETWORK_DEVICE_ENDPOINTS,
            title: "Endpoints",
            icon: IconProp.Squares,
          },
          {
            page: PageMap.NETWORK_DEVICE_DISCOVERY,
            title: "Discovery Scans",
            icon: IconProp.Search,
            keywords: ["scan network", "find devices"],
          },
        ],
      },
      {
        title: "Topology",
        pages: [
          {
            page: PageMap.NETWORK_SITE_MAP,
            title: "Network Map",
            icon: IconProp.Map,
            /*
             * The top of the map, as the menu opens it: an empty site
             * resets a map that is drilled into a site
             * (getNetworkMapRootRoute).
             */
            queryString: "?site=",
            keywords: ["site map"],
          },
          {
            page: PageMap.NETWORK_DEVICE_TOPOLOGY,
            title: "Device Topology",
            icon: IconProp.Graph,
          },
          {
            page: PageMap.NETWORK_DEVICE_LATENCY_MATRIX,
            title: "Latency Matrix",
            icon: IconProp.TableCells,
          },
          {
            page: PageMap.NETWORK_SITE_LINKS,
            title: "Site Links",
            icon: IconProp.Link,
          },
          {
            page: PageMap.NETWORK_DEVICE_LINKS,
            title: "Device Links",
            icon: IconProp.Link,
          },
        ],
      },
      {
        title: "Rules",
        pages: [
          {
            page: PageMap.NETWORK_DEVICE_SETTINGS_AUTO_IMPORT_RULES,
            title: "Auto Import Rules",
            icon: IconProp.Download,
          },
          {
            page: PageMap.NETWORK_SITE_ASSIGNMENT_RULES,
            title: "Site Assignment Rules",
            icon: IconProp.Filter,
          },
          ownerRules(PageMap.NETWORK_DEVICE_SETTINGS_OWNER_RULES),
          labelRules(PageMap.NETWORK_DEVICE_SETTINGS_LABEL_RULES),
          {
            page: PageMap.NETWORK_DEVICE_SETTINGS_LINK_RULES,
            title: "Link Rules",
            icon: IconProp.Link,
          },
        ],
      },
      {
        title: "Settings",
        pages: [
          {
            page: PageMap.NETWORK_DEVICE_SETTINGS_DEVICE_ROLES,
            title: "Device Roles",
            icon: IconProp.Identification,
          },
          {
            page: PageMap.NETWORK_DEVICE_SETTINGS_OID_TEMPLATES,
            title: "OID Collection Templates",
            icon: IconProp.List,
            keywords: ["snmp oids"],
          },
          {
            page: PageMap.NETWORK_DEVICE_SETTINGS_SNMP_CREDENTIAL_PROFILES,
            title: "SNMP Credentials",
            icon: IconProp.Key,
            keywords: ["community string", "snmp v3"],
          },
          {
            page: PageMap.NETWORK_DEVICE_SETTINGS_ALERT_POLICIES,
            title: "Alert Policies",
            icon: IconProp.Alert,
          },
          {
            page: PageMap.NETWORK_SITE_SETTINGS_SITE_TYPES,
            title: "Site Types",
            icon: IconProp.Layers,
          },
        ],
      },
      {
        title: "Advanced",
        pages: [
          {
            page: PageMap.NETWORK_DEVICE_ARCHIVED,
            title: "Archived Devices",
            icon: IconProp.Archive,
          },
        ],
      },
    ],
  },
  {
    id: "iot",
    title: "IoT",
    productPage: PageMap.IOT_FLEETS,
    icon: IconProp.IoT,
    iconColor: "blue",
    sections: [
      {
        title: "IoT",
        pages: [
          allListPage(PageMap.IOT_FLEETS, "All Fleets"),
          documentation(PageMap.IOT_DOCUMENTATION),
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.IOT_SETTINGS_OWNER_RULES,
        labelRules: PageMap.IOT_SETTINGS_LABEL_RULES,
        archived: PageMap.IOT_ARCHIVED,
      }),
    ],
  },
  {
    id: "dashboards",
    title: "Dashboards",
    productPage: PageMap.DASHBOARDS,
    icon: IconProp.ChartPie,
    iconColor: "indigo",
    sections: [
      {
        title: "Dashboards",
        pages: [
          {
            page: PageMap.DASHBOARDS,
            title: "Dashboards",
            icon: IconProp.Window,
          },
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.DASHBOARDS_SETTINGS_OWNER_RULES,
        labelRules: PageMap.DASHBOARDS_SETTINGS_LABEL_RULES,
        archived: PageMap.DASHBOARDS_ARCHIVED,
        more: [
          {
            page: PageMap.DASHBOARDS_SETTINGS_DATA_SOURCES,
            title: "Data Sources",
            icon: IconProp.Database,
            keywords: ["prometheus", "external data"],
          },
        ],
      }),
    ],
  },
  {
    id: "workflows",
    title: "Workflows",
    productPage: PageMap.WORKFLOWS,
    icon: IconProp.FlowDiagram,
    iconColor: "sky",
    sections: [
      {
        title: "Workflows",
        pages: [
          {
            page: PageMap.WORKFLOWS,
            title: "Workflows",
            icon: IconProp.Workflow,
          },
          {
            page: PageMap.WORKFLOWS_VARIABLES,
            title: "Global Variables",
            icon: IconProp.Variable,
            keywords: ["workflow variables", "secrets"],
          },
        ],
      },
      {
        title: "Logs",
        pages: [
          {
            page: PageMap.WORKFLOWS_LOGS,
            title: "Runs",
            icon: IconProp.Logs,
            keywords: ["workflow runs", "workflow logs", "executions"],
          },
        ],
      },
      ...resourceSettingsSections({
        ownerRules: PageMap.WORKFLOWS_SETTINGS_OWNER_RULES,
        labelRules: PageMap.WORKFLOWS_SETTINGS_LABEL_RULES,
        archived: PageMap.WORKFLOWS_ARCHIVED,
      }),
    ],
  },
  {
    id: "runbooks",
    title: "Runbooks",
    productPage: PageMap.RUNBOOKS,
    icon: IconProp.BookOpen,
    iconColor: "teal",
    sections: [
      {
        title: "Runbooks",
        pages: [
          {
            page: PageMap.RUNBOOKS,
            title: "Runbooks",
            icon: IconProp.BookOpen,
          },
          {
            page: PageMap.RUNBOOKS_EXECUTIONS,
            title: "Executions",
            icon: IconProp.Play,
            keywords: ["runbook runs"],
          },
        ],
      },
      {
        title: "Runners",
        pages: [
          {
            page: PageMap.RUNBOOKS_RUNNERS,
            title: "Runners",
            icon: IconProp.Terminal,
            keywords: ["runbook runners", "agents"],
          },
          {
            page: PageMap.RUNBOOKS_RUNNER_CREDENTIALS,
            title: "Credentials",
            icon: IconProp.Key,
            keywords: ["runner credentials"],
          },
        ],
      },
      {
        title: "Settings",
        pages: [
          {
            page: PageMap.RUNBOOKS_SECRETS,
            title: "Secrets",
            icon: IconProp.Lock,
            keywords: ["runbook secrets"],
          },
          ownerRules(PageMap.RUNBOOKS_SETTINGS_OWNER_RULES),
          labelRules(PageMap.RUNBOOKS_SETTINGS_LABEL_RULES),
        ],
      },
    ],
  },
  {
    id: "forms",
    title: "Forms",
    productPage: PageMap.FORMS,
    icon: IconProp.ClipboardDocumentList,
    iconColor: "teal",
    sections: [
      {
        title: "Forms",
        pages: [
          {
            page: PageMap.FORMS,
            title: "Forms",
            icon: IconProp.ClipboardDocumentList,
          },
          {
            page: PageMap.FORMS_SUBMISSIONS,
            title: "Submissions",
            icon: IconProp.InboxStack,
            keywords: ["form submissions", "responses"],
          },
        ],
      },
    ],
  },
  {
    id: "users",
    title: "Users",
    productPage: PageMap.USERS,
    icon: IconProp.User,
    iconColor: "blue",
    sections: [
      {
        title: "Users",
        pages: [
          {
            page: PageMap.USERS,
            title: "All Users",
            icon: IconProp.User,
            keywords: ["invite user", "members", "team members", "people"],
          },
        ],
      },
      {
        title: "Settings",
        pages: [customFields(PageMap.USER_CUSTOM_FIELDS)],
      },
    ],
  },
  {
    id: "teams",
    title: "Teams",
    productPage: PageMap.TEAMS,
    icon: IconProp.Team,
    iconColor: "emerald",
    sections: [
      {
        title: "Teams",
        pages: [
          {
            page: PageMap.TEAMS,
            title: "All Teams",
            icon: IconProp.Team,
            keywords: ["create team", "groups", "permissions", "roles"],
          },
        ],
      },
      {
        title: "Settings",
        pages: [customFields(PageMap.TEAM_CUSTOM_FIELDS)],
      },
    ],
  },
  {
    id: "user-settings",
    title: "User Settings",
    productPage: PageMap.USER_SETTINGS,
    icon: IconProp.User,
    iconColor: "slate",
    sections: [
      {
        title: "Get Started",
        pages: [
          {
            page: PageMap.USER_SETTINGS_SETUP,
            title: "Setup Checklist",
            icon: IconProp.ClipboardDocumentCheck,
            keywords: ["get started", "onboarding"],
          },
        ],
      },
      {
        title: "Alerts & Notifications",
        pages: [
          {
            page: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
            title: "Notification Methods",
            icon: IconProp.Bell,
            keywords: [
              "add phone number",
              "sms",
              "email",
              "push",
              "contact methods",
            ],
          },
          {
            page: PageMap.USER_SETTINGS_ON_CALL_RULES,
            title: "On-Call Rules",
            icon: IconProp.BellRinging,
            keywords: ["how i get paged", "my notification rules"],
          },
          {
            page: PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS,
            title: "Notification Settings",
            icon: IconProp.Settings,
            keywords: ["my notifications", "notification preferences"],
          },
          {
            page: PageMap.USER_SETTINGS_EMAIL_PREFERENCES,
            title: "Email Preferences",
            icon: IconProp.Envelope,
            keywords: ["unsubscribe", "email digest"],
          },
        ],
      },
      {
        title: "On-Call Logs",
        pages: [
          {
            page: PageMap.USER_SETTINGS_ON_CALL_LOGS,
            title: "On-Call Logs",
            icon: IconProp.Logs,
            keywords: ["my pages", "paging history"],
          },
        ],
      },
      {
        title: "Incoming Call Policy",
        pages: [
          {
            page: PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS,
            title: "Incoming Phone Numbers",
            icon: IconProp.Call,
          },
        ],
      },
      {
        title: "Calendar",
        pages: [
          {
            page: PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED,
            title: "Calendar Feed",
            icon: IconProp.Calendar,
            keywords: ["ical", "ics", "my on-call calendar"],
          },
        ],
      },
      {
        title: "Profile",
        pages: [customFields(PageMap.USER_SETTINGS_CUSTOM_FIELDS)],
      },
      {
        title: "Workspace",
        pages: [
          {
            page: PageMap.USER_SETTINGS_SLACK_INTEGRATION,
            title: "Slack",
            icon: IconProp.Slack,
            keywords: ["link my slack account"],
          },
          {
            page: PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
            title: "Microsoft Teams",
            icon: IconProp.MicrosoftTeams,
            keywords: ["link my microsoft teams account"],
          },
        ],
      },
    ],
  },
  {
    id: "user-profile",
    title: "User Profile",
    icon: IconProp.User,
    iconColor: "slate",
    sections: [
      {
        title: "Basic",
        pages: [
          {
            page: PageMap.USER_PROFILE_OVERVIEW,
            title: "Overview",
            icon: IconProp.Info,
            keywords: ["my profile", "profile", "my name", "my email"],
          },
          {
            page: PageMap.USER_PROFILE_PICTURE,
            title: "Profile Picture",
            icon: IconProp.Image,
            keywords: ["avatar", "photo"],
          },
        ],
      },
      {
        title: "Security",
        pages: [
          {
            page: PageMap.USER_PROFILE_PASSWORD,
            title: "Password Management",
            icon: IconProp.Lock,
            keywords: ["change password", "reset password", "update password"],
          },
          {
            page: PageMap.USER_PASSKEYS,
            title: "Passkeys",
            icon: IconProp.Fingerprint,
            keywords: ["security key", "webauthn", "touch id", "face id"],
          },
          {
            page: PageMap.USER_TWO_FACTOR_AUTH,
            title: "Two-factor authentication",
            icon: IconProp.ShieldCheck,
            keywords: ["2fa", "mfa", "authenticator app", "otp"],
          },
        ],
      },
      {
        title: "Danger Zone",
        pages: [
          {
            page: PageMap.USER_PROFILE_DELETE,
            title: "Delete Account",
            icon: IconProp.Trash,
            keywords: ["close my account", "remove my account"],
          },
        ],
      },
    ],
  },
];

// Other words for the Developer pages, which share their titles everywhere.
const DEVELOPER_PAGE_KEYWORDS: Readonly<
  Record<DeveloperDocsPageType, Array<string>>
> = {
  [DeveloperDocsPageType.Terraform]: [
    "terraform provider",
    "infrastructure as code",
    "iac",
  ],
  [DeveloperDocsPageType.Api]: ["rest api", "api reference", "curl"],
  [DeveloperDocsPageType.AiAssistants]: ["mcp", "claude", "cursor"],
};

/*
 * The Developer pages (Terraform, API, AI Assistants) of the resources an
 * area lists, from the same list the menus draw their Developer section
 * from, so a resource that gets them is searchable without a line here.
 */
const getDeveloperSection: (
  area: PageSearchArea,
) => PageSearchSection | null = (
  area: PageSearchArea,
): PageSearchSection | null => {
  const pageKeys: Set<string> = new Set<string>();

  for (const section of area.sections) {
    for (const page of section.pages) {
      pageKeys.add(page.page);
    }
  }

  const parents: Array<DeveloperDocsParentPage> =
    DEVELOPER_DOCS_PARENT_PAGES.filter(
      (parent: DeveloperDocsParentPage): boolean => {
        return (
          parent.scope === DeveloperDocsScope.List &&
          pageKeys.has(parent.pageKey)
        );
      },
    );

  if (parents.length === 0) {
    return null;
  }

  return {
    title: DEVELOPER_DOCS_SECTION_TITLE,
    pages: parents.flatMap(
      (parent: DeveloperDocsParentPage): Array<PageSearchPage> => {
        return DEVELOPER_DOCS_PAGES.map(
          (definition: DeveloperDocsPageDefinition): PageSearchPage => {
            return {
              page: getDeveloperDocsPageKey(parent.pageKey, definition.type),
              title: definition.title,
              icon: definition.icon,
              keywords: DEVELOPER_PAGE_KEYWORDS[definition.type],
            };
          },
        );
      },
    ),
  };
};

/**
 * Every area with its generated Developer section, in tie-break order. What
 * Search reads.
 */
export const getPageSearchAreas: () => Array<PageSearchArea> =
  (): Array<PageSearchArea> => {
    return PAGE_SEARCH_AREAS.map((area: PageSearchArea): PageSearchArea => {
      const developerSection: PageSearchSection | null =
        getDeveloperSection(area);

      if (!developerSection) {
        return area;
      }

      return { ...area, sections: [...area.sections, developerSection] };
    });
  };
