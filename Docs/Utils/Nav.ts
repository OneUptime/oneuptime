import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";

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
        url: "/docs/terraform/README",
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
        title: "Custom Code Monitor",
        url: "/docs/monitor/custom-code-monitor",
      },
      {
        title: "Synthetic Monitor",
        url: "/docs/monitor/synthetic-monitor",
      },
      {
        title: "JavaScript Expressions",
        url: "/docs/monitor/javascript-expression",
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
    ],
  },
  {
    title: "Copilot",
    links: [
      { title: "Installation", url: "/docs/copilot/introduction" },
      { title: "Deploy LLM Server", url: "/docs/copilot/deploy-llm-server" },
    ],
  },
  {
    title: "MCP Server",
    links: [
      { title: "Overview", url: "/docs/mcp/index" },
      { title: "Installation", url: "/docs/mcp/installation" },
      { title: "Quick Start", url: "/docs/mcp/quick-start" },
      { title: "Configuration", url: "/docs/mcp/configuration" },
      { title: "Usage Examples", url: "/docs/mcp/examples" },
      { title: "Available Resources", url: "/docs/mcp/resources" },
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

// Is self hosted install, then...
if (!IsBillingEnabled) {
  DocsNav.push({
    title: "Self Hosted",
    links: [
      {
        title: "Slack Integration",
        url: "/docs/self-hosted/slack-integration",
      },
    ],
  });
}

// Export the array of navigation groups
export default DocsNav;
