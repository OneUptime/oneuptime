export interface NavLink {
  // Stable English title — also used as a translation key.
  title: string;
  url: string;
}

export interface NavGroup {
  // Stable English title — also used as a translation key.
  title: string;
  /*
   * The sidebar section the group is listed under, by its stable English
   * title (a translation key under navSections). Groups of one section are
   * kept together, in the order the sections are listed in DocsNavSections.
   */
  section: string;
  links: NavLink[];
}

// Localized variants used at render time.
export interface LocalizedNavLink {
  title: string;
  url: string;
}

export interface LocalizedNavGroup {
  // Canonical English title, preserved for icon lookup across languages.
  key: string;
  title: string;
  links: LocalizedNavLink[];
  // Canonical English title of the group's section, and its translation.
  sectionKey?: string | undefined;
  sectionTitle?: string | undefined;
  // The group's icon: the inner markup of a 24x24 outline SVG.
  icon?: string | undefined;
}

/*
 * The sidebar's sections, in order. They follow what a reader comes to do:
 * get started, watch their systems, respond when something breaks, look
 * into their telemetry, automate, connect other tools, build on the API,
 * administer a project, and run OneUptime themselves.
 */
export const DocsNavSections: Array<string> = [
  "Get Started",
  "Monitoring",
  "Incident Response",
  "Observability",
  "Automation & AI",
  "Integrations",
  "Developers",
  "Administration",
  "Self-Hosting",
];

/*
 * The canonical navigation tree. Titles here are English and double as
 * translation keys (see Utils/I18n.ts). URLs never change when a page moves
 * to another group or section: the dashboard, the website and search engines
 * link to them.
 */
const DocsNav: NavGroup[] = [
  {
    title: "Introduction",
    section: "Get Started",
    links: [
      {
        title: "Getting Started",
        url: "/docs/introduction/getting-started",
      },
      {
        title: "Quickstart",
        url: "/docs/introduction/quickstart",
      },
      {
        title: "Core Concepts",
        url: "/docs/introduction/core-concepts",
      },
      {
        title: "Home Page & Shortcuts",
        url: "/docs/introduction/home",
      },
      {
        title: "Your Account",
        url: "/docs/introduction/your-account",
      },
    ],
  },
  /*
   * One page per tool that Project Settings > Import from another tool
   * brings a team, monitors or status pages over from
   * (Common/Types/ToolImport/ToolImportCatalog's docsPath).
   */
  {
    title: "Moving to OneUptime",
    section: "Get Started",
    links: [
      {
        title: "Moving from Opsgenie",
        url: "/docs/moving-to-oneuptime/opsgenie",
      },
      {
        title: "Moving from PagerDuty",
        url: "/docs/moving-to-oneuptime/pagerduty",
      },
      {
        title: "Moving from incident.io",
        url: "/docs/moving-to-oneuptime/incident-io",
      },
      {
        title: "Moving from Splunk On-Call",
        url: "/docs/moving-to-oneuptime/splunk-on-call",
      },
      {
        title: "Moving from Grafana OnCall",
        url: "/docs/moving-to-oneuptime/grafana-oncall",
      },
      {
        title: "Moving from UptimeRobot",
        url: "/docs/moving-to-oneuptime/uptimerobot",
      },
      {
        title: "Moving from Atlassian Statuspage",
        url: "/docs/moving-to-oneuptime/atlassian-statuspage",
      },
      {
        title: "Moving from Better Stack",
        url: "/docs/moving-to-oneuptime/better-stack",
      },
      {
        title: "Moving from Pingdom",
        url: "/docs/moving-to-oneuptime/pingdom",
      },
      {
        title: "Moving from StatusCake",
        url: "/docs/moving-to-oneuptime/statuscake",
      },
      {
        title: "Moving from Uptime Kuma",
        url: "/docs/moving-to-oneuptime/uptime-kuma",
      },
    ],
  },
  {
    title: "Monitor",
    section: "Monitoring",
    links: [
      {
        title: "Creating a Monitor",
        url: "/docs/monitor/create-monitor",
      },
      {
        title: "Monitor Templates",
        url: "/docs/monitor/monitor-templates",
      },
      {
        title: "Website Monitor",
        url: "/docs/monitor/website-monitor",
      },
      {
        title: "API Monitor",
        url: "/docs/monitor/api-monitor",
      },
      {
        title: "Ping Monitor",
        url: "/docs/monitor/ping-monitor",
      },
      {
        title: "IP Monitor",
        url: "/docs/monitor/ip-monitor",
      },
      {
        title: "Port Monitor",
        url: "/docs/monitor/port-monitor",
      },
      {
        title: "DNS Monitor",
        url: "/docs/monitor/dns-monitor",
      },
      {
        title: "DNSSEC Monitor",
        url: "/docs/monitor/dnssec-monitor",
      },
      {
        title: "NTP Monitor",
        url: "/docs/monitor/ntp-monitor",
      },
      {
        title: "SSL Certificate Monitor",
        url: "/docs/monitor/ssl-certificate-monitor",
      },
      {
        title: "Domain Monitor",
        url: "/docs/monitor/domain-monitor",
      },
      {
        title: "Custom Code Monitor",
        url: "/docs/monitor/custom-code-monitor",
      },
      {
        title: "SQL Query Monitor",
        url: "/docs/monitor/sql-monitor",
      },
      {
        title: "Database Health Monitor",
        url: "/docs/monitor/database-health-monitor",
      },
      {
        title: "Synthetic Monitor",
        url: "/docs/monitor/synthetic-monitor",
      },
      {
        title: "Incoming Request Monitor",
        url: "/docs/monitor/incoming-request-monitor",
      },
      {
        title: "Incoming Email Monitor",
        url: "/docs/monitor/incoming-email-monitor",
      },
      {
        title: "External Status Page Monitor",
        url: "/docs/monitor/external-status-page-monitor",
      },
      {
        title: "Manual Monitor",
        url: "/docs/monitor/manual-monitor",
      },
      {
        title: "JavaScript Expressions",
        url: "/docs/monitor/javascript-expression",
      },
      {
        title: "Incident & Alert Templating",
        url: "/docs/monitor/incident-alert-templating",
      },
      {
        title: "Monitor Secrets",
        url: "/docs/monitor/monitor-secrets",
      },
      {
        title: "When OneUptime Is Not Receiving Data",
        url: "/docs/monitor/when-oneuptime-is-not-receiving",
      },
    ],
  },
  /*
   * Monitors for the infrastructure an agent or a probe reports on. Each
   * page describes the monitor type - what it watches and its criteria; the
   * agent that feeds it is installed from the Infrastructure Agents pages.
   */
  {
    title: "Infrastructure Monitors",
    section: "Monitoring",
    links: [
      {
        title: "Server / VM Monitor",
        url: "/docs/monitor/server-monitor",
      },
      {
        title: "Network Device Monitor",
        url: "/docs/monitor/network-device-monitor",
      },
      {
        title: "Network Sites (Health Rollup & Uptime)",
        url: "/docs/monitor/network-sites",
      },
      {
        title: "Network Vendor Guides (Sophos, Extreme, Cambium)",
        url: "/docs/monitor/network-vendor-guides",
      },
      {
        title: "Network Traffic (NetFlow, IPFIX, sFlow)",
        url: "/docs/monitor/network-traffic",
      },
      {
        title: "Kubernetes Monitor",
        url: "/docs/monitor/kubernetes-monitor",
      },
      {
        title: "Kubernetes Agent (Helm install)",
        url: "/docs/monitor/kubernetes-agent",
      },
      {
        title: "Docker Monitor",
        url: "/docs/monitor/docker-monitor",
      },
      {
        title: "Host Monitor",
        url: "/docs/monitor/host-monitor",
      },
      {
        title: "Podman Monitor",
        url: "/docs/monitor/podman-monitor",
      },
      {
        title: "Proxmox Monitor",
        url: "/docs/monitor/proxmox-monitor",
      },
      {
        title: "Docker Swarm Monitor",
        url: "/docs/monitor/docker-swarm-monitor",
      },
      {
        title: "Ceph Monitor",
        url: "/docs/monitor/ceph-monitor",
      },
      {
        title: "Storage Array Monitor",
        url: "/docs/monitor/storage-array-monitor",
      },
      {
        title: "IoT Device Monitor",
        url: "/docs/monitor/iot-device-monitor",
      },
      {
        title: "VMware Monitor",
        url: "/docs/monitor/vmware-monitor",
      },
    ],
  },
  // Monitors whose criteria run over the telemetry OneUptime ingests.
  {
    title: "Telemetry Monitors",
    section: "Monitoring",
    links: [
      {
        title: "Logs Monitor",
        url: "/docs/monitor/logs-monitor",
      },
      {
        title: "Metrics Monitor",
        url: "/docs/monitor/metrics-monitor",
      },
      {
        title: "Traces Monitor",
        url: "/docs/monitor/traces-monitor",
      },
      {
        title: "Exceptions Monitor",
        url: "/docs/monitor/exceptions-monitor",
      },
      {
        title: "Profiles Monitor",
        url: "/docs/monitor/profiles-monitor",
      },
    ],
  },
  {
    title: "SLOs",
    section: "Monitoring",
    links: [
      {
        title: "SLOs Overview",
        url: "/docs/slo/introduction",
      },
      {
        title: "Monitors and Monitor Rules",
        url: "/docs/slo/monitor-rules",
      },
      {
        title: "Error Budgets",
        url: "/docs/slo/error-budget",
      },
      {
        title: "Burn Rate Alerts and Incidents",
        url: "/docs/slo/burn-rate-alerts",
      },
      {
        title: "SLO Metrics and Dashboards",
        url: "/docs/slo/metrics",
      },
      {
        title: "SLO Feed and Audit Logs",
        url: "/docs/slo/feed-and-audit-logs",
      },
      {
        title: "Label and Owner Rules",
        url: "/docs/slo/label-and-owner-rules",
      },
    ],
  },
  {
    title: "Probe",
    section: "Monitoring",
    links: [
      {
        title: "Custom Probes",
        url: "/docs/probe/custom-probe",
      },
      {
        title: "Incoming Request Ingress",
        url: "/docs/probe/incoming-request-ingress",
      },
      {
        title: "Packet Capture",
        url: "/docs/probe/packet-capture",
      },
    ],
  },
  {
    title: "Incidents",
    section: "Incident Response",
    links: [
      {
        title: "Incidents Overview",
        url: "/docs/incidents/index",
      },
      {
        title: "Declaring an Incident",
        url: "/docs/incidents/declaring-incidents",
      },
      {
        title: "Incident States & Severities",
        url: "/docs/incidents/states-and-severities",
      },
      {
        title: "Incident Notes, Owners & Feed",
        url: "/docs/incidents/notes-owners-and-feed",
      },
      {
        title: "Linked Alerts",
        url: "/docs/incidents/linked-alerts",
      },
      {
        title: "Incident Settings & Automation",
        url: "/docs/incidents/settings",
      },
    ],
  },
  {
    title: "On Call",
    section: "Incident Response",
    links: [
      {
        title: "Schedule Timeline",
        url: "/docs/on-call/schedule-timeline",
      },
      {
        title: "Escalation Rules",
        url: "/docs/on-call/escalation-rules",
      },
      {
        title: "On-Call Schedules",
        url: "/docs/on-call/schedules",
      },
      {
        title: "Calendar Feeds",
        url: "/docs/on-call/calendar-feeds",
      },
      {
        title: "Incoming Call Policy",
        url: "/docs/on-call/incoming-call-policy",
      },
      {
        title: "Phone Number Whitelist",
        url: "/docs/on-call/phone-number-whitelist",
      },
    ],
  },
  {
    title: "Status Pages",
    section: "Incident Response",
    links: [
      {
        title: "Status Pages Overview",
        url: "/docs/status-pages/index",
      },
      {
        title: "Status Page Resources & Groups",
        url: "/docs/status-pages/resources-and-groups",
      },
      {
        title: "Status Page Branding & Domains",
        url: "/docs/status-pages/branding-and-domains",
      },
      {
        title: "Subscribers & Announcements",
        url: "/docs/status-pages/subscribers",
      },
      {
        title: "One Status Page per Audience",
        url: "/docs/status-pages/one-status-page-per-audience",
      },
      {
        title: "Public API",
        url: "/docs/status-pages/public-api",
      },
    ],
  },
  {
    title: "Workspace Connections",
    section: "Incident Response",
    links: [
      {
        title: "Slack",
        url: "/docs/workspace-connections/slack",
      },
      {
        title: "Microsoft Teams",
        url: "/docs/workspace-connections/microsoft-teams",
      },
      {
        title: "Video Calls",
        url: "/docs/workspace-connections/video-calls",
      },
    ],
  },
  {
    title: "Telemetry",
    section: "Observability",
    links: [
      {
        title: "OpenTelemetry",
        url: "/docs/telemetry/open-telemetry",
      },
      {
        title: "Search Syntax",
        url: "/docs/telemetry/search-syntax",
      },
      {
        title: "Zooming Into a Time Range",
        url: "/docs/telemetry/charts-and-time-ranges",
      },
      {
        title: "Log Pipelines",
        url: "/docs/telemetry/log-pipelines",
      },
      {
        title: "Continuous Profiling",
        url: "/docs/telemetry/profiles",
      },
      {
        title: "Source Maps",
        url: "/docs/telemetry/source-maps",
      },
      {
        title: "Serilog (.NET)",
        url: "/docs/telemetry/serilog",
      },
      {
        title: "FluentBit",
        url: "/docs/telemetry/fluentbit",
      },
      {
        title: "Fluentd",
        url: "/docs/telemetry/fluentd",
      },
      {
        title: "Syslog",
        url: "/docs/telemetry/syslog",
      },
      {
        title: "Log Recording Rules",
        url: "/docs/telemetry/log-recording-rules",
      },
    ],
  },
  /*
   * Installing the agents and collectors that send a platform's telemetry.
   * The pages keep their /docs/telemetry/ URLs.
   */
  {
    title: "Infrastructure Agents",
    section: "Observability",
    links: [
      {
        title: "Host OpenTelemetry Collector",
        url: "/docs/telemetry/host-otel-collector",
      },
      {
        title: "Kubernetes Agent",
        url: "/docs/telemetry/kubernetes-agent",
      },
      {
        title: "Kubernetes Cost Observability",
        url: "/docs/telemetry/kubernetes-cost",
      },
      {
        title: "Docker Agent",
        url: "/docs/telemetry/docker-host",
      },
      {
        title: "IoT Devices",
        url: "/docs/telemetry/iot-devices",
      },
      {
        title: "Podman Agent",
        url: "/docs/telemetry/podman-host",
      },
      {
        title: "Proxmox Agent",
        url: "/docs/telemetry/proxmox",
      },
      {
        title: "Ceph Agent",
        url: "/docs/telemetry/ceph",
      },
      {
        title: "Storage Array Agent",
        url: "/docs/telemetry/storage-arrays",
      },
      {
        title: "Docker Swarm Agent",
        url: "/docs/telemetry/docker-swarm",
      },
      {
        title: "VMware Agent",
        url: "/docs/telemetry/vmware",
      },
      {
        title: "VMware Without an Agent",
        url: "/docs/telemetry/vmware-agentless",
      },
      {
        title: "Databases",
        url: "/docs/telemetry/databases",
      },
      {
        title: "Queues",
        url: "/docs/telemetry/queues",
      },
      {
        title: "Serverless Functions",
        url: "/docs/telemetry/serverless-functions",
      },
    ],
  },
  /*
   * One page per managed platform, right under the hub, so the sidebar
   * mirrors the platform picker on the in-app guide. The order is the hub
   * page's order: the three container platforms with their own pages, then
   * the rest, then the shared troubleshooting page, then the IaaS and PaaS
   * resources discovered from Azure Monitor, CloudWatch and Cloud
   * Monitoring - the Cloud product's other list.
   */
  {
    title: "Cloud",
    section: "Observability",
    links: [
      {
        title: "Cloud Environments",
        url: "/docs/telemetry/cloud-environments",
      },
      {
        title: "AWS ECS / Fargate",
        url: "/docs/telemetry/cloud-aws-ecs",
      },
      {
        title: "Google Cloud Run",
        url: "/docs/telemetry/cloud-gcp-cloud-run",
      },
      {
        title: "Azure Container Apps",
        url: "/docs/telemetry/cloud-azure-container-apps",
      },
      {
        title: "Other Cloud Platforms",
        url: "/docs/telemetry/cloud-other-platforms",
      },
      {
        title: "Cloud Troubleshooting",
        url: "/docs/telemetry/cloud-troubleshooting",
      },
      {
        title: "Cloud Resources (IaaS & PaaS)",
        url: "/docs/telemetry/cloud-resources",
      },
    ],
  },
  {
    title: "AI Observability",
    section: "Observability",
    links: [
      {
        title: "AI / LLM Observability",
        url: "/docs/telemetry/ai-llm-observability",
      },
      {
        title: "AI Coding Assistants",
        url: "/docs/telemetry/ai-coding-assistants",
      },
      {
        title: "Claude Code",
        url: "/docs/telemetry/claude-code",
      },
      {
        title: "Cursor",
        url: "/docs/telemetry/cursor",
      },
      {
        title: "OpenAI Codex",
        url: "/docs/telemetry/openai-codex",
      },
      {
        title: "Gemini CLI & GitHub Copilot",
        url: "/docs/telemetry/gemini-cli-and-copilot",
      },
      {
        title: "AI Gateways (LiteLLM, Portkey)",
        url: "/docs/telemetry/ai-gateways",
      },
      {
        title: "AI Agent Circuit Breakers",
        url: "/docs/telemetry/ai-agent-circuit-breaker",
      },
    ],
  },
  {
    title: "Security",
    section: "Observability",
    links: [
      {
        title: "Security Events (SIEM)",
        url: "/docs/telemetry/security-events",
      },
      {
        title: "Threat Intelligence (STIX/TAXII)",
        url: "/docs/telemetry/threat-intelligence",
      },
    ],
  },
  /*
   * RUM is its own product surface in the dashboard (Resources → Real User
   * Monitoring) with applications, rules, clients and session replay — not
   * just one more "how to send telemetry from X" recipe — so it gets its own
   * group rather than a single entry inside Telemetry. Session Replay keeps
   * its /docs/telemetry/session-replay URL; only its position in the nav
   * moved, so inbound links are unaffected.
   */
  {
    title: "Real User Monitoring",
    section: "Observability",
    links: [
      {
        title: "RUM Overview",
        url: "/docs/rum/index",
      },
      {
        title: "Browser Setup",
        url: "/docs/rum/browser-setup",
      },
      {
        title: "Mobile Setup",
        url: "/docs/rum/mobile-setup",
      },
      {
        title: "Core Web Vitals",
        url: "/docs/rum/web-vitals",
      },
      {
        title: "Managing Applications",
        url: "/docs/rum/applications",
      },
      {
        title: "Session Replay",
        url: "/docs/telemetry/session-replay",
      },
      {
        title: "Session Replay Troubleshooting",
        url: "/docs/rum/session-replay-troubleshooting",
      },
      {
        title: "RUM Troubleshooting",
        url: "/docs/rum/troubleshooting",
      },
    ],
  },
  {
    title: "Dashboards",
    section: "Observability",
    links: [
      {
        title: "Dashboards Overview",
        url: "/docs/dashboards/index",
      },
      {
        title: "Authoring a Dashboard",
        url: "/docs/dashboards/authoring",
      },
      {
        title: "Dashboard Widgets",
        url: "/docs/dashboards/widgets",
      },
      {
        title: "Dashboard Variables & Filters",
        url: "/docs/dashboards/variables",
      },
      {
        title: "Sharing & Public Dashboards",
        url: "/docs/dashboards/sharing",
      },
      {
        title: "Dashboard Configuration & Permissions",
        url: "/docs/dashboards/configuration",
      },
    ],
  },
  {
    title: "Inventory",
    section: "Observability",
    links: [
      {
        title: "Overview",
        url: "/docs/inventory/overview",
      },
      {
        title: "Custom Fields",
        url: "/docs/inventory/custom-fields",
      },
      {
        title: "Exporting to a CMDB",
        url: "/docs/inventory/cmdb-sync",
      },
    ],
  },
  {
    title: "Runbooks",
    section: "Automation & AI",
    links: [
      {
        title: "Runbooks Overview",
        url: "/docs/runbooks/index",
      },
      {
        title: "Authoring a Runbook",
        url: "/docs/runbooks/authoring",
      },
      {
        title: "Runbook Rules",
        url: "/docs/runbooks/rules",
      },
      {
        title: "Running a Runbook",
        url: "/docs/runbooks/running",
      },
      {
        title: "Runbook Agents",
        url: "/docs/runbooks/agents",
      },
      {
        title: "Runbook Credentials",
        url: "/docs/runbooks/credentials",
      },
      {
        title: "Runbook Configuration & Safety",
        url: "/docs/runbooks/configuration",
      },
    ],
  },
  {
    title: "Forms",
    section: "Automation & AI",
    links: [
      {
        title: "Forms Overview",
        url: "/docs/forms/index",
      },
      {
        title: "Building a Form",
        url: "/docs/forms/building",
      },
      {
        title: "What a Submission Creates",
        url: "/docs/forms/on-submit",
      },
      {
        title: "Sharing & Security",
        url: "/docs/forms/sharing-and-security",
      },
    ],
  },
  {
    title: "Workflows",
    section: "Automation & AI",
    links: [
      {
        title: "Workflows Overview",
        url: "/docs/workflows/index",
      },
      {
        title: "Authoring a Workflow",
        url: "/docs/workflows/authoring",
      },
      {
        title: "Workflow Triggers",
        url: "/docs/workflows/triggers",
      },
      {
        title: "Workflow Components",
        url: "/docs/workflows/components",
      },
      {
        title: "Workflow Variables",
        url: "/docs/workflows/variables",
      },
      {
        // The Dashboard menu item is Logs → Runs; the page keeps its URL.
        title: "Workflow Runs",
        url: "/docs/workflows/runs-and-logs",
      },
      {
        title: "Workflow Configuration & Safety",
        url: "/docs/workflows/configuration",
      },
    ],
  },
  {
    title: "AI",
    section: "Automation & AI",
    links: [
      {
        title: "Ask AI",
        url: "/docs/ai/ask-ai",
      },
      {
        title: "AI SRE",
        url: "/docs/ai/ai-sre",
      },
      {
        title: "Infrastructure AI Agents",
        url: "/docs/ai/infrastructure-ai-agents",
      },
      {
        title: "Fix Tasks",
        url: "/docs/ai/ai-agent",
      },
      {
        title: "GitHub App",
        url: "/docs/ai/github-app",
      },
      {
        title: "LLM Providers",
        url: "/docs/ai/llm-provider",
      },
      {
        title: "Microsoft Foundry",
        url: "/docs/ai/microsoft-foundry",
      },
      {
        title: "MCP Server",
        url: "/docs/ai/mcp-server",
      },
    ],
  },
  {
    title: "Integrations",
    section: "Integrations",
    links: [
      {
        title: "Integrations Overview",
        url: "/docs/integrations/index",
      },
      {
        title: "Zabbix",
        url: "/docs/integrations/zabbix",
      },
      {
        title: "Jira",
        url: "/docs/integrations/jira",
      },
      {
        title: "PagerDuty",
        url: "/docs/integrations/pagerduty",
      },
      {
        title: "Opsgenie",
        url: "/docs/integrations/opsgenie",
      },
      {
        title: "ServiceNow",
        url: "/docs/integrations/servicenow",
      },
      {
        title: "Microsoft Dynamics 365",
        url: "/docs/integrations/microsoft-dynamics-365",
      },
      {
        title: "Prometheus Alertmanager",
        url: "/docs/integrations/prometheus-alertmanager",
      },
      {
        title: "Grafana",
        url: "/docs/integrations/grafana",
      },
      {
        title: "Datadog",
        url: "/docs/integrations/datadog",
      },
      {
        title: "Huntress",
        url: "/docs/integrations/huntress",
      },
      {
        title: "Google SecOps",
        url: "/docs/integrations/google-secops",
      },
      {
        title: "Microsoft Sentinel",
        url: "/docs/integrations/microsoft-sentinel",
      },
      {
        title: "Microsoft Defender XDR",
        url: "/docs/integrations/microsoft-defender-xdr",
      },
      {
        title: "CrowdStrike Falcon",
        url: "/docs/integrations/crowdstrike-falcon",
      },
      {
        title: "Splunk Enterprise Security",
        url: "/docs/integrations/splunk",
      },
      {
        title: "Elastic Security",
        url: "/docs/integrations/elastic-security",
      },
      {
        title: "AWS Security Hub",
        url: "/docs/integrations/aws-security-hub",
      },
      {
        title: "Okta System Log",
        url: "/docs/integrations/okta",
      },
      {
        title: "GitHub",
        url: "/docs/integrations/github",
      },
      {
        title: "GitLab",
        url: "/docs/integrations/gitlab",
      },
      {
        title: "Discord",
        url: "/docs/integrations/discord",
      },
      {
        title: "Telegram",
        url: "/docs/integrations/telegram",
      },
      {
        title: "IRC",
        url: "/docs/integrations/irc",
      },
    ],
  },
  {
    title: "API Reference",
    section: "Developers",
    links: [
      {
        title: "OneUptime API Reference",
        url: "/docs/api-reference/api-reference",
      },
    ],
  },
  {
    title: "CLI",
    section: "Developers",
    links: [
      {
        title: "Overview",
        url: "/docs/cli/index",
      },
      {
        title: "Authentication",
        url: "/docs/cli/authentication",
      },
      {
        title: "Resource Operations",
        url: "/docs/cli/resource-operations",
      },
      {
        title: "Output Formats",
        url: "/docs/cli/output-formats",
      },
      {
        title: "Scripting & CI/CD",
        url: "/docs/cli/scripting",
      },
      {
        title: "Command Reference",
        url: "/docs/cli/command-reference",
      },
    ],
  },
  {
    title: "Terraform Provider",
    section: "Developers",
    links: [
      {
        title: "Overview",
        url: "/docs/terraform/index",
      },
      {
        title: "Quick Start",
        url: "/docs/terraform/quick-start",
      },
      {
        title: "Complete Guide",
        url: "/docs/terraform/complete-guide",
      },
      {
        title: "Monitor Steps",
        url: "/docs/terraform/monitor-steps",
      },
      {
        title: "Examples",
        url: "/docs/terraform/examples",
      },
      {
        title: "Importing Resources",
        url: "/docs/terraform/importing-resources",
      },
      {
        title: "Troubleshooting",
        url: "/docs/terraform/troubleshooting",
      },
      {
        title: "Self-Hosted Setup",
        url: "/docs/terraform/self-hosted",
      },
      {
        title: "Registry Usage",
        url: "/docs/terraform/registry",
      },
      {
        title: "OpenTofu",
        url: "/docs/terraform/opentofu",
      },
    ],
  },
  {
    title: "Users & Permissions",
    section: "Administration",
    links: [
      {
        title: "Users, Teams & Permissions",
        url: "/docs/permissions/index",
      },
      {
        title: "Permission Reference",
        url: "/docs/permissions/reference",
      },
    ],
  },
  {
    title: "Identity",
    section: "Administration",
    links: [
      {
        title: "SSO",
        url: "/docs/identity/sso",
      },
      {
        title: "Global SSO",
        url: "/docs/identity/global-sso",
      },
      {
        title: "SCIM",
        url: "/docs/identity/scim",
      },
    ],
  },
  {
    title: "Configuration",
    section: "Administration",
    links: [
      {
        title: "IP Addresses",
        url: "/docs/configuration/ip-addresses",
      },
      {
        title: "Label and Owner Rules",
        url: "/docs/configuration/label-and-owner-rules",
      },
      {
        title: "Import and Export Label Rules",
        url: "/docs/configuration/label-rule-import-export",
      },
      {
        title: "Run Rules on Existing Resources",
        url: "/docs/configuration/run-rules-now",
      },
    ],
  },
  {
    title: "Emails",
    section: "Administration",
    links: [
      {
        title: "SMTP",
        url: "/docs/emails/smtp",
      },
      {
        title: "Notification Rollup",
        url: "/docs/emails/notification-rollup",
      },
    ],
  },
  {
    title: "Mobile & Desktop Apps",
    section: "Administration",
    links: [
      {
        title: "Overview",
        url: "/docs/mobile-desktop-apps/index",
      },
      {
        title: "Android Installation",
        url: "/docs/mobile-desktop-apps/android-installation",
      },
      {
        title: "iOS Installation",
        url: "/docs/mobile-desktop-apps/ios-installation",
      },
      {
        title: "Windows Installation",
        url: "/docs/mobile-desktop-apps/windows-installation",
      },
      {
        title: "macOS Installation",
        url: "/docs/mobile-desktop-apps/macos-installation",
      },
      {
        title: "Linux Installation",
        url: "/docs/mobile-desktop-apps/linux-installation",
      },
      {
        title: "FAQ & Troubleshooting",
        url: "/docs/mobile-desktop-apps/faq-troubleshooting",
      },
    ],
  },
  {
    title: "Installation",
    section: "Self-Hosting",
    links: [
      {
        title: "Local Development",
        url: "/docs/installation/local-development",
      },
      {
        title: "Docker Compose",
        url: "/docs/installation/docker-compose",
      },
      {
        title: "Upgrading",
        url: "/docs/installation/upgrading",
      },
      {
        title: "Kubernetes and Helm",
        url: "https://artifacthub.io/packages/helm/oneuptime/oneuptime",
      },
      {
        title: "Sizing & Capacity Planning",
        url: "/docs/installation/sizing",
      },
    ],
  },
  {
    title: "Self Hosted",
    section: "Self-Hosting",
    links: [
      {
        title: "Slack Integration",
        url: "/docs/self-hosted/slack-integration",
      },
      {
        title: "Microsoft Teams Integration",
        url: "/docs/self-hosted/microsoft-teams-integration",
      },
      {
        title: "Twilio Integration",
        url: "/docs/self-hosted/twilio-integration",
      },
      {
        title: "GitHub Integration",
        url: "/docs/self-hosted/github-integration",
      },
      {
        title: "Push Notifications",
        url: "/docs/self-hosted/push-notifications",
      },
      {
        title: "SendGrid Inbound Email",
        url: "/docs/self-hosted/sendgrid-inbound-email",
      },
      {
        title: "Private Network Access",
        url: "/docs/self-hosted/private-network-access",
      },
      {
        title: "Architecture",
        url: "/docs/self-hosted/architecture",
      },
      {
        title: "Enterprise Edition",
        url: "/docs/self-hosted/enterprise",
      },
    ],
  },
];

export default DocsNav;
