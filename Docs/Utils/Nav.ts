export interface NavLink {
  title: string;
  url: string;
}

// Define an interface for a navigation group
export interface NavGroup {
  title: string;
  links: NavLink[];
}

// Define an array of navigation groups
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
        title: "Custom Code Monitor",
        url: "/docs/monitor/custom-code-monitor",
      },
      {
        title: "Synthetic Monitor",
        url: "/docs/monitor/synthetic-monitor",
      },
      {
        title: "Incoming Email Monitor",
        url: "/docs/monitor/incoming-email-monitor",
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
    title: "Probe",
    links: [{ title: "Custom Probes", url: "/docs/probe/custom-probe" }],
  },
  {
    title: "Telemetry",
    links: [
      { title: "OpenTelemetry", url: "/docs/telemetry/open-telemetry" },
      { title: "FluentBit", url: "/docs/telemetry/fluentbit" },
      { title: "Fluentd", url: "/docs/telemetry/fluentd" },
      { title: "Syslog", url: "/docs/telemetry/syslog" },
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
      title: "SendGrid Inbound Email",
      url: "/docs/self-hosted/sendgrid-inbound-email",
    },
    {
      title: "Architecture",
      url: "/docs/self-hosted/architecture",
    },
  ],
});

// Export the array of navigation groups
export default DocsNav;
