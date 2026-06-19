export interface NavLink {
  // Stable English title — also used as a translation key.
  title: string;
  url: string;
}

export interface NavGroup {
  // Stable English title — also used as a translation key.
  title: string;
  links: NavLink[];
}

/*
 * Localized variants used at render time. The shape matches NavGroup/NavLink
 * so EJS templates do not need to change.
 */
export interface LocalizedNavLink {
  title: string;
  url: string;
}

export interface LocalizedNavGroup {
  title: string;
  links: LocalizedNavLink[];
}

/*
 * The canonical navigation tree. Titles here are English and double as
 * translation keys (see Utils/I18n.ts).
 */
const DocsNav: NavGroup[] = [
  {
    title: "Introduction",
    links: [
      {
        title: "Getting Started",
        url: "/docs/introduction/getting-started",
      },
    ],
  },
  {
    title: "Installation",
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
    ],
  },
  {
    title: "Mobile & Desktop Apps",
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
    title: "Configuration",
    links: [
      {
        title: "IP Addresses",
        url: "/docs/configuration/ip-addresses",
      },
    ],
  },
  {
    title: "Emails",
    links: [
      {
        title: "SMTP",
        url: "/docs/emails/smtp",
      },
    ],
  },
  {
    title: "Identity",
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
    title: "Terraform Provider",
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
        title: "Self-Hosted Setup",
        url: "/docs/terraform/self-hosted",
      },
      {
        title: "Examples",
        url: "/docs/terraform/examples",
      },
      {
        title: "Registry Usage",
        url: "/docs/terraform/registry",
      },
    ],
  },
  {
    title: "CLI",
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
    title: "Monitor",
    links: [
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
        title: "Server / VM Monitor",
        url: "/docs/monitor/server-monitor",
      },
      {
        title: "SNMP Monitor",
        url: "/docs/monitor/snmp-monitor",
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
    ],
  },
  {
    title: "On Call",
    links: [
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
    title: "Runbooks",
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
        title: "Runbook Configuration & Safety",
        url: "/docs/runbooks/configuration",
      },
    ],
  },
  {
    title: "Workflows",
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
        title: "Workflow Runs & Logs",
        url: "/docs/workflows/runs-and-logs",
      },
      {
        title: "Workflow Configuration & Safety",
        url: "/docs/workflows/configuration",
      },
    ],
  },
  {
    title: "Dashboards",
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
    title: "Status Pages",
    links: [
      {
        title: "Public API",
        url: "/docs/status-pages/public-api",
      },
    ],
  },
  {
    title: "Workspace Connections",
    links: [
      {
        title: "Slack",
        url: "/docs/workspace-connections/slack",
      },
      {
        title: "Microsoft Teams",
        url: "/docs/workspace-connections/microsoft-teams",
      },
    ],
  },
  {
    title: "Integrations",
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
    ],
  },
  {
    title: "Probe",
    links: [
      { title: "Custom Probes", url: "/docs/probe/custom-probe" },
      {
        title: "Incoming Request Ingress",
        url: "/docs/probe/incoming-request-ingress",
      },
    ],
  },
  {
    title: "Telemetry",
    links: [
      { title: "OpenTelemetry", url: "/docs/telemetry/open-telemetry" },
      {
        title: "Continuous Profiling",
        url: "/docs/telemetry/profiles",
      },
      { title: "Serilog (.NET)", url: "/docs/telemetry/serilog" },
      { title: "FluentBit", url: "/docs/telemetry/fluentbit" },
      { title: "Fluentd", url: "/docs/telemetry/fluentd" },
      { title: "Syslog", url: "/docs/telemetry/syslog" },
      {
        title: "Host OpenTelemetry Collector",
        url: "/docs/telemetry/host-otel-collector",
      },
      {
        title: "Kubernetes Agent",
        url: "/docs/telemetry/kubernetes-agent",
      },
      {
        title: "Docker Agent",
        url: "/docs/telemetry/docker-host",
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
        title: "Docker Swarm Agent",
        url: "/docs/telemetry/docker-swarm",
      },
      {
        title: "Serverless Functions",
        url: "/docs/telemetry/serverless-functions",
      },
      {
        title: "Cloud Environments",
        url: "/docs/telemetry/cloud-environments",
      },
      {
        title: "Real User Monitoring",
        url: "/docs/telemetry/real-user-monitoring",
      },
    ],
  },
  {
    title: "AI",
    links: [
      { title: "AI Agents", url: "/docs/ai/ai-agent" },
      { title: "LLM Providers", url: "/docs/ai/llm-provider" },
      { title: "MCP Server", url: "/docs/ai/mcp-server" },
    ],
  },
  {
    title: "API Reference",
    links: [
      {
        title: "OneUptime API Reference",
        url: "/docs/api-reference/api-reference",
      },
    ],
  },
];

DocsNav.push({
  title: "Self Hosted",
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
      title: "Architecture",
      url: "/docs/self-hosted/architecture",
    },
  ],
});

export default DocsNav;
