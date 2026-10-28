/*
 * Page-specific SEO metadata configuration for OneUptime landing pages
 * This provides structured data for search engines and AI agents
 *
 * Every routed template writes its <title> and meta description from here
 * (`seo.title`, `seo.description`), and head-social.ejs writes the same two
 * strings into the Open Graph and Twitter tags, so a page reads the same in
 * search results and in a link preview. Titles stay within 60 characters,
 * about what a search result shows before it cuts the line off, and every
 * page but the homepage puts the brand last; Tests/PageTitles.test.ts holds
 * every page to both.
 */

import ProductCompare, { Product } from "./ProductCompare";
import { getOpenTelemetryGuideSEOEntries } from "./Integrations/OpenTelemetry/OpenTelemetryGuides";

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface PageSEOData {
  title: string;
  description: string;
  canonicalPath: string; // e.g., "/product/monitoring" - will be combined with homeUrl
  /*
   * A PNG or JPG under Static/img, ideally 1200 x 630. Without one the page
   * shares /img/og-image.png (head-social.ejs), the wordmark-and-tagline card.
   * Link previews on LinkedIn, X and Slack do not render SVG, and a path with
   * no file behind it leaves the preview blank.
   */
  ogImage?: string;
  ogType?: string; // defaults to "website"
  twitterCard?: "summary" | "summary_large_image"; // defaults to "summary_large_image" for product pages
  breadcrumbs: BreadcrumbItem[];
  // For SoftwareApplication schema on product pages
  softwareApplication?: {
    name: string;
    applicationCategory: string;
    operatingSystem: string;
    description: string;
    features: string[];
  };
  // Page type for conditional schema rendering
  pageType:
    | "home"
    | "product"
    | "pricing"
    | "legal"
    | "blog"
    | "about"
    | "support"
    | "enterprise"
    | "compare"
    | "solutions"
    | "industry"
    // An OpenTelemetry guide, or the integrations index that lists them.
    | "integration"
    | "other";
}

// Default SEO data factory
export const createDefaultSEO: (
  title: string,
  description: string,
  canonicalPath: string,
  pageType?: PageSEOData["pageType"],
) => PageSEOData = (
  title: string,
  description: string,
  canonicalPath: string,
  pageType: PageSEOData["pageType"] = "other",
): PageSEOData => {
  return {
    title,
    description,
    canonicalPath,
    pageType,
    breadcrumbs: [{ name: "Home", url: "/" }],
  };
};

// A legal or compliance document rendered by legal.ejs.
const legalDocumentSEO: (
  canonicalPath: string,
  name: string,
  title: string,
  description: string,
) => PageSEOData = (
  canonicalPath: string,
  name: string,
  title: string,
  description: string,
): PageSEOData => {
  return {
    title,
    description,
    canonicalPath,
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name, url: canonicalPath },
    ],
  };
};

// Page-specific SEO configurations
export const PageSEOConfig: Record<string, PageSEOData> = {
  // Homepage
  "/": {
    title: "OneUptime | Open-Source Observability & Incident Management",
    description:
      "Detect outages in seconds, page the right engineer, update your status page, and ship the fix — open-source observability and incident management.",
    canonicalPath: "/",
    ogType: "website",
    twitterCard: "summary_large_image",
    pageType: "home",
    breadcrumbs: [{ name: "Home", url: "/" }],
  },

  // Compare index
  "/compare": {
    title: "Compare Monitoring, On-Call & Status Page Tools | OneUptime",
    description:
      "Compare OneUptime with PagerDuty, Datadog, Grafana, Opsgenie, Statuspage and 25+ other tools. See features, pricing, and why teams consolidate monitoring, on-call, incidents, and status pages onto one open-source platform.",
    canonicalPath: "/compare",
    twitterCard: "summary_large_image",
    pageType: "compare",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Compare", url: "/compare" },
    ],
  },

  // Product Pages
  "/product/status-page": {
    title: "Status Page | Free Public & Private Status Pages | OneUptime",
    description:
      "Create unlimited public and private status pages. Keep customers informed about incidents and scheduled maintenance. Custom branding, unlimited subscribers, SSL included. Open source.",
    canonicalPath: "/product/status-page",
    ogImage: "/img/status-pages.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Status Page", url: "/product/status-page" },
    ],
    softwareApplication: {
      name: "OneUptime Status Page",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Create public and private status pages to communicate service health to customers and stakeholders.",
      features: [
        "Unlimited public and private status pages",
        "Custom branding and domain",
        "Unlimited subscribers",
        "Email, SMS, and webhook notifications",
        "Scheduled maintenance announcements",
        "Incident timeline and postmortems",
        "SSL certificates included",
        "API access",
      ],
    },
  },

  "/product/monitoring": {
    title: "Uptime Monitoring for Websites, APIs & Servers | OneUptime",
    description:
      "Monitor websites, APIs, servers, and any resource in real-time. Get instant alerts when things go wrong. Supports HTTP, TCP, UDP, DNS, SSL, ping monitoring. Open source.",
    canonicalPath: "/product/monitoring",
    ogImage: "/img/monitor.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Monitoring", url: "/product/monitoring" },
    ],
    softwareApplication: {
      name: "OneUptime Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Real-time uptime monitoring for websites, APIs, servers, and infrastructure.",
      features: [
        "Website and API monitoring",
        "Server and infrastructure monitoring",
        "Synthetic monitoring with Playwright",
        "Custom monitoring criteria",
        "Multi-location checks",
        "1-second monitoring intervals",
        "SSL certificate monitoring",
        "Response time tracking",
      ],
    },
  },

  "/product/incident-management": {
    title: "Incident Management Software | Resolve Faster | OneUptime",
    description:
      "Streamline incident response with OneUptime. Track incidents, collaborate in real-time, conduct postmortems, and improve MTTR. Integrates with Slack, PagerDuty, and more. Open source.",
    canonicalPath: "/product/incident-management",
    ogImage: "/img/incident-report.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Incident Management", url: "/product/incident-management" },
    ],
    softwareApplication: {
      name: "OneUptime Incident Management",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Complete incident management platform to detect, respond, and resolve incidents faster.",
      features: [
        "Incident tracking and timeline",
        "Real-time collaboration",
        "Postmortem reports",
        "Custom incident states and severity",
        "Slack and Teams integration",
        "Automated incident workflows",
        "MTTR and incident metrics",
        "Root cause analysis",
      ],
    },
  },

  "/product/on-call": {
    title: "On-Call Management | Schedules & Escalations | OneUptime",
    description:
      "On-call scheduling, alerting, and escalation policies. Alert the right people at the right time via SMS, phone, email, Slack. Rotation schedules and override support. Open source.",
    canonicalPath: "/product/on-call",
    ogImage: "/img/on-call-policies.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "On-Call & Alerts", url: "/product/on-call" },
    ],
    softwareApplication: {
      name: "OneUptime On-Call Management",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud, iOS, Android",
      description:
        "On-call scheduling, alerting, and escalation management for DevOps and SRE teams.",
      features: [
        "On-call schedules and rotations",
        "Escalation policies",
        "SMS, phone, and email alerts",
        "Slack and Teams notifications",
        "Override and swap shifts",
        "Mobile app notifications",
        "Alert deduplication",
        "On-call reports",
      ],
    },
  },

  "/product/logs-management": {
    title: "Log Management | Fast Log Search & Analysis | OneUptime",
    description:
      "Centralized log management with blazing fast search. Ingest logs from any source via OpenTelemetry, Fluentd, or API. Set up alerts on log patterns. Open source.",
    canonicalPath: "/product/logs-management",
    ogImage: "/img/logs.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Logs Management", url: "/product/logs-management" },
    ],
    softwareApplication: {
      name: "OneUptime Logs Management",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Centralized log management and analysis with fast search and alerting.",
      features: [
        "OpenTelemetry log ingestion",
        "Fluentd and Fluent Bit support",
        "Full-text log search",
        "Log pattern detection",
        "Log-based alerting",
        "Application and container logs",
        "Custom retention policies",
        "1000+ source integrations",
      ],
    },
  },

  "/product/workflows": {
    title: "Workflow Automation | No-Code Integrations | OneUptime",
    description:
      "Build automated workflows without code. Connect 5000+ services, automate incident response, and create custom integrations. Trigger on any event. Open source.",
    canonicalPath: "/product/workflows",
    ogImage: "/img/workflow-builder.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Workflows", url: "/product/workflows" },
    ],
    softwareApplication: {
      name: "OneUptime Workflows",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "No-code workflow automation for incident response and integrations.",
      features: [
        "Visual workflow builder",
        "5000+ integrations",
        "Event-driven triggers",
        "Conditional logic",
        "Custom code blocks",
        "Webhook triggers",
        "Scheduled workflows",
        "Error handling and retries",
      ],
    },
  },

  "/product/runbooks": {
    title: "Runbook Automation for Incident Response | OneUptime",
    description:
      "Runbooks that combine manual checklists with sandboxed JavaScript, HTTP, bash, and AI steps. Auto-trigger on incidents, alerts, and scheduled maintenance. Open source incident response automation.",
    canonicalPath: "/product/runbooks",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Runbooks", url: "/product/runbooks" },
    ],
    softwareApplication: {
      name: "OneUptime Runbooks",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Automated incident response runbooks that mix manual checklists with sandboxed JavaScript, HTTP, bash, and AI steps, auto-triggered on incidents, alerts, and scheduled maintenance.",
      features: [
        "Manual checklist steps",
        "Sandboxed JavaScript steps",
        "HTTP request steps",
        "Bash script steps",
        "AI analysis steps",
        "Auto-trigger on incidents and alerts",
        "Trigger on scheduled maintenance",
        "Reusable response procedures",
        "Open source",
      ],
    },
  },

  "/product/ai-agent": {
    title: "AI SRE | Code Fixes as Pull Requests | OneUptime",
    description:
      "OneUptime AI turns production exceptions, incident investigations, and slow traces into pull requests with code fixes. Supports OpenAI, Anthropic, Ollama, and self-hosted LLMs. Privacy-first: no code stored or trained on.",
    canonicalPath: "/product/ai-agent",
    ogImage: "/img/ai-agent.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "AI", url: "/product/ai-agent" },
    ],
    softwareApplication: {
      name: "OneUptime AI",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "AI SRE that investigates production issues and opens human-reviewed pull requests with code fixes.",
      features: [
        "Fix PRs from unresolved exceptions",
        "Fix PRs from trace performance findings",
        "Fix PRs from incident investigations",
        "Regression test generation",
        "Instrumentation PRs for missing telemetry",
        "GitHub App integration",
        "Human-reviewed: the agent never merges",
        "Multiple LLM provider support",
        "Self-hosted LLM option",
        "Privacy-first: no code storage",
      ],
    },
  },

  "/tool/mcp-server": {
    title: "MCP Server | Model Context Protocol for AI | OneUptime",
    description:
      "Connect AI agents and LLMs to your OneUptime observability data via Model Context Protocol (MCP). Query incidents, monitors, logs, metrics, and traces directly from your AI tools.",
    canonicalPath: "/tool/mcp-server",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "MCP Server", url: "/tool/mcp-server" },
    ],
    softwareApplication: {
      name: "OneUptime MCP Server",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Model Context Protocol server that connects AI agents and LLMs to OneUptime observability data for querying incidents, monitors, logs, metrics, and traces.",
      features: [
        "Incident querying and management",
        "Monitor status and health checks",
        "Log search and filtering",
        "Metrics time series retrieval",
        "Distributed trace analysis",
        "Compatible with Claude, Cursor, Windsurf",
        "API key authentication",
        "Fine-grained permissions",
        "Real-time data access",
        "Open protocol standard",
      ],
    },
  },

  /*
   * What the CLI does (packages/CLI), as the page says it (Views/cli.ejs,
   * Utils/CliPage.ts). These lines also go out in llms.txt, llms-full.txt,
   * /tool/cli.md, products.json and the page's structured data, so they say
   * only what the CLI really does: Tests/CliPage.test.ts holds them to it.
   */
  "/tool/cli": {
    title: "CLI | Command Line Interface for Observability | OneUptime",
    description:
      "The OneUptime CLI manages monitors, incidents, status pages and more from your terminal. Install it from npm, script it with JSON and run it in CI/CD.",
    canonicalPath: "/tool/cli",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "CLI", url: "/tool/cli" },
    ],
    softwareApplication: {
      name: "OneUptime CLI",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Linux, Windows",
      description:
        "Command line interface for listing, creating, updating and deleting OneUptime monitors, incidents, alerts, status pages and other records from your terminal or a script.",
      features: [
        "Create, list, update and delete monitors",
        "Create, acknowledge and resolve incidents, and add notes",
        "Status pages and status page announcements",
        "List and count logs, spans, metrics and exceptions",
        "Filter, sort and page with JSON queries",
        "Tables in a terminal, JSON when piped",
        "API key from environment variables in CI/CD",
        "Exit codes for scripts",
        "A saved context for each environment",
        "Install from npm: @oneuptime/cli",
      ],
    },
  },

  "/product/metrics": {
    title: "Metrics | Application & Infrastructure Metrics | OneUptime",
    description:
      "Collect and visualize metrics from applications and infrastructure. OpenTelemetry native. Custom dashboards, alerting, and anomaly detection. Open source.",
    canonicalPath: "/product/metrics",
    ogImage: "/img/metrics.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Metrics", url: "/product/metrics" },
    ],
    softwareApplication: {
      name: "OneUptime Metrics",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Collect, store, and visualize metrics from any source with powerful querying and alerting.",
      features: [
        "OpenTelemetry metrics ingestion",
        "Custom metric collection",
        "Real-time dashboards",
        "Metric-based alerting",
        "Anomaly detection",
        "Long-term retention",
        "PromQL compatible",
        "Infrastructure metrics",
      ],
    },
  },

  "/product/kubernetes": {
    title: "Kubernetes Monitoring | Clusters, Pods & Nodes | OneUptime",
    description:
      "Complete Kubernetes observability with real-time cluster monitoring, pod health tracking, node metrics, and automated alerting. OpenTelemetry native. Open source.",
    canonicalPath: "/product/kubernetes",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Kubernetes", url: "/product/kubernetes" },
    ],
    softwareApplication: {
      name: "OneUptime Kubernetes Observability",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor Kubernetes clusters, nodes, pods, and containers with real-time metrics, intelligent alerting, and pre-built dashboards.",
      features: [
        "Multi-cluster monitoring",
        "Node health and metrics",
        "Pod and container monitoring",
        "CrashLoopBackOff detection",
        "OOMKill alerting",
        "Resource utilization tracking",
        "Namespace-level breakdowns",
        "OpenTelemetry native",
        "DaemonSet deployment",
        "Kubelet stats receiver",
        "Logs and traces correlation",
      ],
    },
  },

  "/product/docker": {
    title: "Docker Monitoring | Hosts, Containers & Images | OneUptime",
    description:
      "Complete Docker observability with real-time host monitoring, container health tracking, image insights, and automated alerting. OpenTelemetry native. Open source.",
    canonicalPath: "/product/docker",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Docker", url: "/product/docker" },
    ],
    softwareApplication: {
      name: "OneUptime Docker Observability",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor Docker hosts, containers, and images with real-time metrics, intelligent alerting, and pre-built dashboards.",
      features: [
        "Multi-host fleet monitoring",
        "Container health and metrics",
        "Image and volume insights",
        "OOM kill detection",
        "Restart loop alerting",
        "CPU and memory tracking",
        "Network and block I/O metrics",
        "OpenTelemetry native",
        "Docker Compose deployment",
        "docker_stats receiver",
        "Container logs correlation",
      ],
    },
  },

  "/product/podman": {
    title: "Podman Monitoring | Hosts, Containers & Images | OneUptime",
    description:
      "Complete Podman observability with real-time host monitoring, container health tracking, image insights, and automated alerting. Daemonless and rootless-capable. OpenTelemetry native. Open source.",
    canonicalPath: "/product/podman",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Podman", url: "/product/podman" },
    ],
    softwareApplication: {
      name: "OneUptime Podman Observability",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor Podman hosts, containers, and images with real-time metrics, intelligent alerting, and pre-built dashboards. Daemonless and rootless-capable via Podman's Docker-compatible API socket.",
      features: [
        "Multi-host fleet monitoring",
        "Container health and metrics",
        "Image and volume insights",
        "OOM kill detection",
        "Restart loop alerting",
        "CPU and memory tracking",
        "Network and block I/O metrics",
        "OpenTelemetry native",
        "Podman Compose deployment",
        "docker_stats receiver",
        "Container logs correlation",
      ],
    },
  },

  "/product/host": {
    title: "Host & Server Monitoring | Metrics & Processes | OneUptime",
    description:
      "Auto-discover hosts from any OpenTelemetry collector. Live CPU, memory, disk, filesystem, network, and per-process telemetry — plus logs and traces correlated to the same host. Open source.",
    canonicalPath: "/product/host",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Hosts", url: "/product/host" },
    ],
    softwareApplication: {
      name: "OneUptime Host Observability",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Auto-discover and monitor every host that emits OpenTelemetry telemetry. Real-time CPU, memory, disk, filesystem, and network metrics with per-process detail and correlated logs.",
      features: [
        "OTel-native auto-discovery",
        "system.* metric visualization",
        "Per-process CPU and memory",
        "Filesystem and disk I/O",
        "Network throughput and errors",
        "Linked Docker host view",
        "Linked Kubernetes node view",
        "Correlated host logs",
        "Last-seen + connection status",
        "OS, architecture, host.id capture",
        "Open source",
      ],
    },
  },

  "/product/proxmox": {
    title: "Proxmox Monitoring | VMs, Storage & Backups | OneUptime",
    description:
      "Monitor Proxmox VE clusters end to end: node and guest health, storage usage, backup coverage, and replication alerting. One agent per cluster, usage-based pricing, 10-minute setup. Open source.",
    canonicalPath: "/product/proxmox",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Proxmox", url: "/product/proxmox" },
    ],
    softwareApplication: {
      name: "OneUptime Proxmox Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor Proxmox VE clusters with one agent: node, VM, and container health, storage capacity, backup coverage, replication alerting, and on-call escalation in a single product.",
      features: [
        "Whole-cluster monitoring from one agent",
        "Node, VM, and LXC inventory with status pills",
        "Backup coverage: guests without a backup job",
        "Storage replication failure alerting",
        "Quorum-risk and HA resource state alerts",
        "Storage usage and growth tracking",
        "Guest-to-host agent cross-linking",
        "Copy-paste onboarding with token validator",
        "Usage-based pricing, not per-host",
        "OpenTelemetry native",
        "Open source",
      ],
    },
  },

  "/product/vmware": {
    title: "VMware Monitoring | vCenter, ESXi Hosts & VMs | OneUptime",
    description:
      "Monitor VMware vSphere end to end: ESXi host and virtual machine health, datastore capacity, CPU ready, memory ballooning, cluster and vSAN alerting. One read-only agent per vCenter, usage-based pricing, 10-minute setup. Open source.",
    canonicalPath: "/product/vmware",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "VMware", url: "/product/vmware" },
    ],
    softwareApplication: {
      name: "OneUptime VMware Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor VMware vSphere with one agent per vCenter: ESXi host, virtual machine, datastore, cluster, resource pool and vSAN metrics, ready-made alert templates for CPU ready, ballooning, swapping and datastore capacity, and on-call escalation in a single product.",
      features: [
        "Whole-vCenter monitoring from one read-only agent",
        "ESXi host, VM, datastore, cluster and resource pool inventory",
        "VM power state and template tracking",
        "CPU ready, memory ballooning and swapping alerts",
        "Datastore capacity warning and critical thresholds",
        "Cluster host effectiveness and datacenter health alerts",
        "vSAN latency and congestion alerting",
        "In-guest host agent cross-linking",
        "Copy-paste onboarding with a troubleshooting script",
        "Usage-based pricing, not per-socket or per-VM",
        "OpenTelemetry native (vcenter receiver)",
        "Open source",
      ],
    },
  },

  "/product/ai-observability": {
    title: "AI & LLM Observability | Tokens, Cost & Traces | OneUptime",
    description:
      "Observe LLM and AI-agent apps with OpenTelemetry: per-call traces, token usage, cost, latency, errors, and full prompts and completions. Works with OpenLLMetry, OpenInference and native OTel. Open source.",
    canonicalPath: "/product/ai-observability",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "AI / LLM Observability", url: "/product/ai-observability" },
    ],
    softwareApplication: {
      name: "OneUptime AI / LLM Observability",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Observe LLM and AI-agent applications over OpenTelemetry: per-call traces, token usage, cost, latency, errors, prompts and completions, plus dashboards and alerts on GenAI metrics.",
      features: [
        "OpenTelemetry GenAI native — no proprietary SDK",
        "Works with OpenLLMetry, OpenInference and native OTel",
        "Per-call traces for LLM, embedding, agent and tool spans",
        "Token usage (input / output / total) and cost rollups",
        "Prompt and completion content rendering",
        "Latency and error-rate tracking per model",
        "Filter calls by provider, model and operation",
        "Token / cost / latency dashboards and alerts",
        "Scrub rules for sensitive prompt data",
        "Usage-based telemetry pricing, billed per GB ingested",
        "Open source",
      ],
    },
  },

  "/product/ceph": {
    title: "Ceph Monitoring | Cluster Health, OSDs & Pools | OneUptime",
    description:
      "Monitor Ceph clusters without bolting Grafana onto the dashboard: health drill-downs, OSD and PG state, pool capacity with growth forecasts, and alerting with on-call built in. Open source.",
    canonicalPath: "/product/ceph",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Ceph", url: "/product/ceph" },
    ],
    softwareApplication: {
      name: "OneUptime Ceph Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor Ceph clusters from the mgr Prometheus module: health status with reason drill-downs, OSD up/in state, PG breakdown, pool capacity and forecasts, and alert templates with on-call escalation built in.",
      features: [
        "Cluster health pill with reason drill-down",
        "Capacity gauge with nearfull/full thresholds",
        "Capacity growth forecasting",
        "OSD up/in matrix and honeycomb view",
        "Placement group state breakdown",
        "Pool usage, IOPS, and throughput",
        "Monitor quorum tracking",
        "Fleet view across every cluster",
        "Alert templates with on-call built in",
        "No Grafana or Alertmanager required",
        "Open source",
      ],
    },
  },

  "/product/docker-swarm": {
    title: "Docker Swarm Monitoring | Nodes & Services | OneUptime",
    description:
      "Monitor Docker Swarm clusters end to end: manager and worker node health, services and their task replicas, stacks, overlay networks, secrets, configs, and volumes. One agent on a manager node, usage-based pricing, 10-minute setup. Open source.",
    canonicalPath: "/product/docker-swarm",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Docker Swarm", url: "/product/docker-swarm" },
    ],
    softwareApplication: {
      name: "OneUptime Docker Swarm Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor an entire Docker Swarm cluster from one OpenTelemetry collector and inventory poller on a manager node: node, service, task, stack, overlay network, secret, config, and volume inventory, running-vs-desired replica convergence alerting, per-container CPU and memory, and logs.",
      features: [
        "Whole-cluster visibility from one manager-node agent",
        "Manager & worker node health and roles",
        "Service inventory with running vs desired replicas",
        "Task-level (container instance) tracking",
        "Stack, overlay network, secret & config inventory",
        "Volume usage and growth",
        "Raft manager quorum & service convergence alerting",
        "Per-container CPU and memory metrics",
        "Container and service logs",
        "Usage-based pricing",
        "OpenTelemetry native",
        "Open source",
      ],
    },
  },

  "/product/iot": {
    title: "IoT Device Monitoring | Fleets, Battery & Signal | OneUptime",
    description:
      "Monitor your entire IoT fleet from one dashboard: per-device health, battery, signal strength, temperature, and connectivity alerting. Standard OpenTelemetry, no proprietary agent, usage-based pricing. Open source.",
    canonicalPath: "/product/iot",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "IoT Devices", url: "/product/iot" },
    ],
    softwareApplication: {
      name: "OneUptime IoT Device Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor IoT device fleets over standard OpenTelemetry: per-device health, battery, signal strength, temperature, CPU, and memory, with auto-discovery, per-device drill-down, alert templates, and on-call escalation in a single product.",
      features: [
        "Fleet view across every device",
        "Auto-discovery from first reading",
        "Per-device battery, signal, temperature, CPU & memory",
        "Device-offline detection from missed check-ins",
        "Low-battery and weak-signal alert templates",
        "High-temperature and high-CPU alerting",
        "One incident per device.id, auto-resolving",
        "Gateway-friendly via OpenTelemetry Collector",
        "Usage-based pricing, not per-device",
        "OpenTelemetry native",
        "Open source",
      ],
    },
  },

  "/product/network-monitoring": {
    title: "Network Monitoring | SNMP Switches & Routers | OneUptime",
    description:
      "Agentless SNMP monitoring for switches, routers, and firewalls: device and interface health, LLDP topology maps, probe latency matrix, subnet discovery, and vendor alert packs — wired to on-call. Open source.",
    canonicalPath: "/product/network-monitoring",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Network Devices", url: "/product/network-monitoring" },
    ],
    softwareApplication: {
      name: "OneUptime Network Device Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor network devices over SNMP from OneUptime probes: reachability, system health, per-interface status, traffic and errors, LLDP topology maps, probe-to-device latency, subnet discovery, vendor health templates, and recommended alert packs with on-call escalation built in.",
      features: [
        "Agentless SNMP polling from probes",
        "Per-interface status, traffic & error metrics",
        "LLDP network topology map",
        "Probe latency matrix",
        "Subnet discovery from probes",
        "Vendor health templates & recommended alert packs",
        "Device ownership & label rules",
        "On-call, incidents & status pages built in",
        "Open source",
      ],
    },
  },

  "/product/observability": {
    title: "Observability Platform | Logs, Metrics & Traces | OneUptime",
    description:
      "OpenTelemetry-native observability: logs, metrics, traces, exceptions, profiles, RUM, and dashboards in one open-source platform. Correlate every signal, alert on any query, and pay only for the telemetry you ingest.",
    canonicalPath: "/product/observability",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Observability", url: "/product/observability" },
    ],
    softwareApplication: {
      name: "OneUptime Observability Platform",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Full-stack observability in one open-source platform: logs, metrics, traces, exceptions, profiles, and real user monitoring over standard OpenTelemetry, with service maps, dashboards, telemetry alerting, and on-call escalation included.",
      features: [
        "OpenTelemetry-native OTLP ingestion (HTTP & gRPC)",
        "Logs, metrics & traces in one place",
        "Exceptions, profiles & real user monitoring",
        "Correlate signals across your whole stack",
        "Service map & dependency views",
        "Custom dashboards",
        "Alert on any telemetry query",
        "On-call, incidents & status pages built in",
        "Usage-based pricing per GB ingested",
        "Open source",
      ],
    },
  },

  "/product/topology": {
    title: "Service Map & Topology | Infrastructure Maps | OneUptime",
    description:
      "Automatic topology maps built from your telemetry: a service map drawn from traces with live traffic and latency, a nested infrastructure map, and a live network map. Active incidents overlay on every node. Open source.",
    canonicalPath: "/product/topology",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Topology", url: "/product/topology" },
    ],
    softwareApplication: {
      name: "OneUptime Topology",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Auto-discovered topology maps for your whole stack: a layer-7 service map built from OpenTelemetry traces with per-edge traffic, error rate, and latency; a nested infrastructure map spanning Kubernetes, Proxmox, VMware, Ceph, Docker Swarm, and hosts; and a live LLDP network map of switches, routers, and firewalls. Active incidents and alerts overlay on the services that own them.",
      features: [
        "Service map auto-generated from traces",
        "Per-edge call rate, error rate & latency",
        "Health colors by error rate",
        "Nested infrastructure containment map",
        "Kubernetes, Proxmox, VMware, Ceph, Docker Swarm & hosts",
        "Fleets grouped by workload",
        "Live LLDP network topology map",
        "Active incident & alert overlay on nodes",
        "Node & edge detail drawers with deep links",
        "Included with your telemetry",
        "Open source",
      ],
    },
  },

  "/product/security-events": {
    title: "Security Events | SIEM, OCSF & Sigma Rules | OneUptime",
    description:
      "SIEM and SOAR beside your logs, metrics and traces. Security events from any source are normalized to OCSF, matched by Sigma rules, correlations and threat intel, grouped into cases that OneUptime AI triages, answered by playbooks that notify, page on-call or contain, and sent on to the SIEM you already run. Open source.",
    canonicalPath: "/product/security-events",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Security Events", url: "/product/security-events" },
    ],
    softwareApplication: {
      name: "OneUptime Security Events",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "SIEM and SOAR as part of the same platform as your observability data. Security events arrive through one authenticated ingest endpoint (OCSF, Google SecOps UDM, SecOps detection alerts, and generic security JSON), eight managed connectors, or the logs you already send; every event is normalized to OCSF and stored in the same data lake as your logs, metrics, and traces. Sigma detection rules and Sigma correlations, a library of ready-made rules, threat intel from free blocklists, STIX/TAXII feeds and Google SecOps, and Security Events monitors find threats. Security Cases group detections by the user, host, or IP address they are about and are closed with a verdict; OneUptime AI triages each new case read-only, citing its evidence and suggesting a priority and a playbook, and playbooks enrich, notify, page on-call, declare incidents, or contain through Okta, CrowdStrike Falcon, and Microsoft Defender, with approval before each containment step by default. What OneUptime finds can be sent on to Google SecOps, Splunk, Microsoft Sentinel, or Elastic Security.",
      features: [
        "Single ingest endpoint for security events",
        "OCSF normalization across four source dialects, detected per event",
        "Full source payload kept as flattened attributes",
        "Managed connectors for Google SecOps, Microsoft Sentinel, Microsoft Defender XDR, CrowdStrike Falcon, Splunk, Elastic Security, AWS Security Hub and Okta",
        "Security events found in your logs: SSH, sudo, Kubernetes audit, AWS CloudTrail and web attacks",
        "Sigma detection rules evaluated on a schedule",
        "Rule Library of 60 ready-made Sigma rules, 25 of them recommended",
        "Sigma correlations: event counts, distinct values, events together, sequences and first seen",
        "Group By, Distinct Count and Match Count Threshold per rule",
        "MITRE ATT&CK coverage of your enabled rules",
        "Threat intel from free blocklists in one click, STIX/TAXII feeds and Google SecOps indicator matches, with IOC enrichment",
        "Security Cases that group detections by user, host or IP address",
        "Case verdicts, and mean time to acknowledge, contain and close",
        "Playbooks with 25 actions, run as a case opens, as detections join it, when AI triage reads it as Likely Malicious, or by hand",
        "Containment through Okta, CrowdStrike Falcon and Microsoft Defender, with per-step approval",
        "Deduplicated alerts and optional incidents, or an incident declared from a case",
        "Detection findings written back as searchable events",
        "Security Events monitors over a sliding window",
        "Entities ranking and observable correlation graph",
        "Google SecOps SOAR webhook, UDM forwarding, alerts closed with their case, and export of what OneUptime finds",
        "Security events sent to Splunk, Microsoft Sentinel and Elastic Security",
        "OneUptime AI triage of every new case, with cited evidence and a suggested priority and playbook",
        "Detection rules drafted by AI from a sentence",
        "AI security event search and summary",
        "Metered with telemetry at $0.10 per GB ingested",
        "Open source",
      ],
    },
  },

  "/product/services": {
    title: "Service Catalog | Own & Monitor Every Service | OneUptime",
    description:
      "A single catalog of every service you run. Assign owners, group by labels, and connect each service to its logs, traces, metrics, and incidents. Open source.",
    canonicalPath: "/product/services",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Services", url: "/product/services" },
    ],
    softwareApplication: {
      name: "OneUptime Service Catalog",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "A single catalog of every service you run. Map ownership, group with labels, and link each service to its logs, traces, metrics, and incidents.",
      features: [
        "Centralized service catalog",
        "Owner teams and users",
        "Label-based grouping",
        "Linked logs, traces, and metrics",
        "Linked incidents and alerts",
        "Bulk owner and label updates",
        "Searchable across the project",
        "Color-coded for fast scanning",
        "API and dashboard creatable",
        "Open source",
      ],
    },
  },

  "/product/databases": {
    title: "Database Monitoring | PostgreSQL, MySQL & Redis | OneUptime",
    description:
      "Every database your applications query, discovered from traces, Kubernetes and Docker: query latency and errors, the services calling it, engine metrics from a config-only OpenTelemetry agent, and ready-made alerts. Open source.",
    canonicalPath: "/product/databases",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Databases", url: "/product/databases" },
    ],
    softwareApplication: {
      name: "OneUptime Database Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor every database your applications depend on: databases discovered from application traces, Kubernetes, Docker and Podman; query rate, errors and p95 latency with the services calling each one; engine metrics, query samples and logs from a config-only OpenTelemetry Collector agent; and recommended monitors for each engine, with on-call escalation in the same product.",
      features: [
        "Auto-discovery from traces, Kubernetes, Docker and Podman",
        "Query rate, errors and p95 latency per database",
        "The services calling each database",
        "Engine metrics from a config-only OpenTelemetry Collector agent",
        "PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, Redis, MongoDB and Elasticsearch",
        "Optional query samples, top queries and engine logs",
        "Recommended monitors for each engine",
        "Create a monitor from any engine metric chart",
        "Probe-based Database Health monitor, no agent required",
        "Owners, labels, retention and archiving per database",
        "OpenTelemetry native",
        "Open source",
      ],
    },
  },

  "/product/queues": {
    title: "Message Queue Monitoring | Kafka, RabbitMQ, SQS | OneUptime",
    description:
      "Every queue, topic and subscription your applications use, discovered from OpenTelemetry traces and broker metrics: producers and consumers, backlog, consumer lag and dead letters, with alerts wired to on-call. Open source.",
    canonicalPath: "/product/queues",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Queues", url: "/product/queues" },
    ],
    softwareApplication: {
      name: "OneUptime Queue Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor every message queue, topic and subscription your applications use: queues discovered from OpenTelemetry messaging spans and broker metrics; messages published and consumed, errors and p95 processing time with the services on each side; broker health from an OpenTelemetry Collector or the cloud provider's monitoring API, including backlog, consumer lag, dead letters and oldest message age; and metric monitors with starting thresholds, with on-call escalation in the same product.",
      features: [
        "Auto-discovery from OpenTelemetry messaging spans and broker metrics",
        "Producers and consumers of every queue, with their own counts",
        "Messages published and consumed, errors and p95 processing time",
        "Broker health: backlog, consumer lag, dead letters and oldest message age",
        "Apache Kafka, RabbitMQ, Amazon SQS and SNS, Google Cloud Pub/Sub and Azure Service Bus",
        "Apache ActiveMQ and JMS, Azure Event Hubs, Apache Pulsar, Apache RocketMQ, NATS and BullMQ",
        "Broker metrics from OpenTelemetry Collector receivers and cloud monitoring APIs",
        "Create a monitor from any broker health gauge, with a starting threshold",
        "Destination names normalised across instrumentations and semantic convention versions",
        "Owners, labels, label and owner rules, and archiving per queue",
        "OpenTelemetry native",
        "Open source",
      ],
    },
  },

  "/product/profiles": {
    title: "Continuous Profiling | CPU & Memory Profiling | OneUptime",
    description:
      "Continuous profiling for production applications. CPU, memory, and allocation profiling with flamegraphs, function-level analysis, and diff comparison. OpenTelemetry native. Open source.",
    canonicalPath: "/product/profiles",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Profiles", url: "/product/profiles" },
    ],
    softwareApplication: {
      name: "OneUptime Continuous Profiling",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Continuous profiling for production applications with flamegraphs, function-level analysis, and diff comparison.",
      features: [
        "CPU profiling",
        "Memory profiling",
        "Allocation profiling",
        "Interactive flamegraphs",
        "Function-level analysis",
        "Diff comparison",
        "Trace and span correlation",
        "Multi-language support",
        "OpenTelemetry native",
        "Timeline view",
        "Profile monitoring",
      ],
    },
  },

  "/product/scheduled-maintenance": {
    title: "Scheduled Maintenance | Communicate Downtime | OneUptime",
    description:
      "Plan, schedule, and communicate maintenance windows to your users. Notify subscribers automatically, update status pages in real-time. Open source maintenance management.",
    canonicalPath: "/product/scheduled-maintenance",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      {
        name: "Scheduled Maintenance",
        url: "/product/scheduled-maintenance",
      },
    ],
    softwareApplication: {
      name: "OneUptime Scheduled Maintenance",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Schedule maintenance windows, notify subscribers via email, SMS, and webhooks, and keep your status page updated in real-time.",
      features: [
        "Maintenance scheduling",
        "Subscriber notifications",
        "Status page integration",
        "Custom maintenance states",
        "Email and SMS alerts",
        "Webhook integrations",
        "Slack and Teams notifications",
        "Maintenance timeline",
        "Affected monitors tracking",
        "Automatic state transitions",
      ],
    },
  },

  "/product/traces": {
    title: "Distributed Tracing | End-to-End Request Tracing | OneUptime",
    description:
      "Trace requests across microservices and distributed systems. OpenTelemetry native. Visualize latency, find bottlenecks, and debug performance issues. Open source.",
    canonicalPath: "/product/traces",
    ogImage: "/img/traces.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Traces", url: "/product/traces" },
    ],
    softwareApplication: {
      name: "OneUptime Traces",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Distributed tracing for microservices and complex architectures.",
      features: [
        "OpenTelemetry trace ingestion",
        "End-to-end request tracing",
        "Service dependency maps",
        "Latency analysis",
        "Span waterfall views",
        "Trace-based alerting",
        "Root cause analysis",
        "Performance bottleneck detection",
      ],
    },
  },

  "/product/exceptions": {
    title: "Error Tracking | Exception Monitoring & Alerts | OneUptime",
    description:
      "Track and monitor exceptions across your applications. Get instant alerts, stack traces, and context to fix bugs faster. OpenTelemetry native. Open source.",
    canonicalPath: "/product/exceptions",
    ogImage: "/img/exceptions.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Exceptions", url: "/product/exceptions" },
    ],
    softwareApplication: {
      name: "OneUptime Exceptions",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description: "Exception tracking and error monitoring for applications.",
      features: [
        "Real-time error tracking",
        "Stack trace capture",
        "Error grouping and deduplication",
        "Exception alerting",
        "Release tracking",
        "User impact analysis",
        "Integration with issue trackers",
        "OpenTelemetry native",
      ],
    },
  },

  "/product/dashboards": {
    title: "Dashboards | Custom Observability Dashboards | OneUptime",
    description:
      "Build custom dashboards to visualize all your observability data. Combine metrics, logs, traces, and status in one view. Share with your team. Open source.",
    canonicalPath: "/product/dashboards",
    ogImage: "/img/dashboards.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Dashboards", url: "/product/dashboards" },
    ],
    softwareApplication: {
      name: "OneUptime Dashboards",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Custom dashboards to visualize and monitor all your observability data.",
      features: [
        "Drag-and-drop dashboard builder",
        "Multiple visualization types",
        "Combine metrics, logs, and traces",
        "Real-time data updates",
        "Dashboard sharing and embedding",
        "Custom time ranges",
        "Dashboard templates",
        "Role-based access control",
      ],
    },
  },

  "/product/serverless": {
    title: "Serverless Monitoring | AWS Lambda & Functions | OneUptime",
    description:
      "Monitor AWS Lambda, Google Cloud Functions, Azure Functions, and Cloudflare Workers with OpenTelemetry. Invocations, cold starts, duration, errors, and per-invocation traces. Open source.",
    canonicalPath: "/product/serverless",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Serverless", url: "/product/serverless" },
    ],
    softwareApplication: {
      name: "OneUptime Serverless Observability",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Monitor serverless functions across AWS Lambda, Google Cloud Functions, Azure Functions, and Cloudflare Workers with OpenTelemetry — invocations, cold starts, duration, errors, and distributed traces.",
      features: [
        "Auto-discovered functions",
        "Keyed on the faas.name attribute",
        "Invocation and error-rate tracking",
        "Cold-start detection",
        "Duration percentiles (p50/p95/p99)",
        "Concurrency and throttle insight",
        "Per-invocation distributed traces",
        "Multi-cloud: AWS, GCP, Azure, Cloudflare",
        "Cloud region and account metadata",
        "Correlated logs and exceptions",
        "OpenTelemetry native",
        "Open source",
      ],
    },
  },

  "/product/cloud": {
    title: "Cloud Monitoring | AWS, Google Cloud & Azure | OneUptime",
    description:
      "Monitor AWS, Google Cloud, and Azure with OpenTelemetry. Auto-discovered cloud environments, real-time resource metrics, logs, traces, and alerting across every region and account. Open source.",
    canonicalPath: "/product/cloud",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "Cloud", url: "/product/cloud" },
    ],
    softwareApplication: {
      name: "OneUptime Cloud Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "Unified multi-cloud monitoring for AWS, Google Cloud, and Azure with OpenTelemetry — auto-discovered environments, real-time resource metrics, logs, traces, and alerting across regions and accounts.",
      features: [
        "Multi-cloud unified dashboard",
        "AWS, Google Cloud, and Azure",
        "Auto-discovered cloud environments",
        "EC2, GCP, and Azure resource detectors",
        "cloud.platform / account / region metadata",
        "Real-time CPU and memory utilization",
        "Multi-account and multi-region rollups",
        "Correlated logs, metrics, and traces",
        "Linked hosts, Docker, and Kubernetes",
        "Resource saturation alerting",
        "OpenTelemetry native",
        "Open source",
      ],
    },
  },

  "/product/rum": {
    title: "Real User Monitoring (RUM) | Core Web Vitals | OneUptime",
    description:
      "Real User Monitoring for browser and mobile apps with the OpenTelemetry Web SDK. Core Web Vitals, page views, JavaScript errors, and real user sessions correlated with backend traces. Open source.",
    canonicalPath: "/product/rum",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "RUM", url: "/product/rum" },
    ],
    softwareApplication: {
      name: "OneUptime Real User Monitoring",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud, iOS, Android",
      description:
        "Real User Monitoring for browser and mobile applications with the OpenTelemetry Web SDK — Core Web Vitals, page performance, JavaScript errors, and sessions correlated with backend traces.",
      features: [
        "Core Web Vitals (LCP, INP, CLS, FCP, TTFB)",
        "Real page view and load timing",
        "JavaScript error tracking",
        "Browser, OS, and device breakdown",
        "Geographic performance comparison",
        "Per-session troubleshooting",
        "Front-end to back-end trace correlation",
        "OpenTelemetry Web SDK",
        "Browser and mobile app support",
        "Web Vitals regression alerting",
        "OpenTelemetry native",
        "Open source",
      ],
    },
  },

  /*
   * Pricing. The prices quoted here are the Growth plan's monthly price in
   * Utils/Pricing.ts and the telemetry rate the page publishes;
   * Tests/PageTitles.test.ts fails when they drift apart.
   */
  "/pricing": {
    title: "Pricing: Free Plan, Paid Plans From $22/User | OneUptime",
    description:
      "OneUptime pricing: start free with no credit card, paid plans from $22 per user per month, and telemetry at $0.10 per GB ingested. Compare every plan.",
    canonicalPath: "/pricing",
    twitterCard: "summary_large_image",
    pageType: "pricing",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Pricing", url: "/pricing" },
    ],
  },

  // Enterprise
  "/enterprise/overview": {
    title: "Enterprise Observability | Self-Hosted & Cloud | OneUptime",
    description:
      "Enterprise-grade monitoring, incident management, and observability platform. SOC 2 Type II attested, HIPAA compliant, with a 99.95% uptime target on Enterprise plans and dedicated support.",
    canonicalPath: "/enterprise/overview",
    twitterCard: "summary_large_image",
    pageType: "enterprise",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Enterprise", url: "/enterprise/overview" },
    ],
  },

  "/enterprise/self-hosted": {
    title: "Self-Hosted Deployment, Architecture & Support | OneUptime",
    description:
      "Run the full OneUptime platform on your own infrastructure. Deployment models, reference architecture, Kubernetes requirements, high availability and disaster recovery, upgrade responsibility, air-gapped operation, the Enterprise Edition, data residency, and support boundaries.",
    canonicalPath: "/enterprise/self-hosted",
    twitterCard: "summary_large_image",
    pageType: "enterprise",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Enterprise", url: "/enterprise/overview" },
      { name: "Self-Hosted", url: "/enterprise/self-hosted" },
    ],
    softwareApplication: {
      name: "OneUptime Self-Hosted",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Kubernetes, Linux, Docker",
      description:
        "The complete OneUptime observability and incident management platform, deployed on infrastructure you own and operate.",
      features: [
        "Kubernetes deployment with an official Helm chart",
        "Docker Compose deployment for single-host installs",
        "Private cloud and managed single-tenant options",
        "High availability with CloudNativePG and Altinity ClickHouse operators",
        "Pod Disruption Budgets, HPA, and KEDA autoscaling",
        "Air-gapped operation with mirrored images and no outbound calls",
        "SAML and OpenID Connect single sign-on in both editions",
        "Enterprise Edition images with SCIM, audit logs, and team compliance",
        "Customer-controlled data residency and encryption keys",
        "Documented upgrade responsibility and support boundaries",
      ],
    },
  },

  /*
   * Running OneUptime on a network with no route to the internet
   * (Utils/AirGapped.ts). An "enterprise" page, so llms.txt lists it with
   * the self-hosted page; /enterprise/air-gapped.md is written from the same
   * content as the page (AIDiscovery.generateAirGappedMarkdown).
   */
  "/enterprise/air-gapped": {
    title: "Air-Gapped Monitoring & Observability | OneUptime",
    description:
      "Run OneUptime on a network with no internet: mirror the images, bring in the signed Helm chart, license offline, and use AI on a model you run.",
    canonicalPath: "/enterprise/air-gapped",
    twitterCard: "summary_large_image",
    pageType: "enterprise",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Enterprise", url: "/enterprise/overview" },
      { name: "Self-Hosted", url: "/enterprise/self-hosted" },
      { name: "Air-Gapped", url: "/enterprise/air-gapped" },
    ],
  },

  "/enterprise/demo": {
    title: "Request a Demo | See the Platform in Action | OneUptime",
    description:
      "Schedule a personalized demo of OneUptime. See how our observability platform can help your team monitor, respond, and resolve issues faster.",
    canonicalPath: "/enterprise/demo",
    twitterCard: "summary",
    pageType: "enterprise",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Enterprise", url: "/enterprise/overview" },
      { name: "Request Demo", url: "/enterprise/demo" },
    ],
  },

  /*
   * The companies that sell OneUptime, the cloud marketplaces it is sold on,
   * and the form for becoming a reseller (Utils/Resellers.ts,
   * Utils/CloudMarketplaces.ts). An "enterprise" page, so llms.txt lists it
   * with the other ways to buy; /resellers.md lists the resellers and the
   * listings themselves. The description names neither, so it stays true as
   * they change, and gives the two ways to buy before the way to sell.
   */
  "/resellers": {
    title: "Resellers | Buy Through a Local Partner | OneUptime",
    description:
      "Buy OneUptime through a reseller in your country, or on your cloud marketplace and pay on your cloud bill. Or apply to become a reseller.",
    canonicalPath: "/resellers",
    twitterCard: "summary",
    pageType: "enterprise",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Resellers", url: "/resellers" },
    ],
  },

  // About & Support
  "/about": {
    title: "About Us | Open Source Observability | OneUptime",
    description:
      "Learn about OneUptime, the open-source observability platform. Built by engineers, for engineers. Meet our contributors and learn our mission.",
    canonicalPath: "/about",
    twitterCard: "summary",
    pageType: "about",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "About", url: "/about" },
    ],
  },

  "/trust": {
    title: "Trust Center | Security, Compliance & Privacy | OneUptime",
    description:
      "OneUptime's canonical trust center. Certifications and attestations with the evidence behind each one, security architecture, privacy practices, and a governed claims matrix covering service levels, support, compliance, encryption, deployment, migration, scale, discounts, and contract terms.",
    canonicalPath: "/trust",
    twitterCard: "summary_large_image",
    pageType: "other",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Trust Center", url: "/trust" },
    ],
  },

  "/support": {
    title: "Support | Help & Documentation | OneUptime",
    description:
      "Get help with OneUptime. Access documentation, community support, and contact our team. Enterprise customers get priority support.",
    canonicalPath: "/support",
    twitterCard: "summary",
    pageType: "support",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Support", url: "/support" },
    ],
  },

  "/books": {
    title: "Books | Back to Metal | OneUptime",
    description:
      "Explore books from OneUptime. Read Back to Metal by Nawaz Dhandala, a practical guide to moving from the cloud to bare metal and owning your infrastructure.",
    canonicalPath: "/books",
    ogImage: "/img/books/books-social.jpg",
    twitterCard: "summary_large_image",
    pageType: "other",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Books", url: "/books" },
    ],
  },

  "/oss-friends": {
    title: "OSS Friends | Open Source Partners | OneUptime",
    description:
      "Meet our open-source friends and partners. OneUptime is proud to be part of the open-source community.",
    canonicalPath: "/oss-friends",
    twitterCard: "summary",
    pageType: "other",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "OSS Friends", url: "/oss-friends" },
    ],
  },

  /*
   * Legal and compliance documents, all rendered by legal.ejs. Each one has
   * its own title and description: they used to share "OneUptime | Legal
   * Center" and one generic description, so search results showed thirty
   * identical lines to buyers looking for "oneuptime soc 2" or "oneuptime
   * dpa". The descriptions say what the claims matrix (Utils/Claims.ts) says
   * and no more. /legal redirects to /legal/terms (Routes.ts), so each trail
   * is Home > document.
   */

  // Core policies
  "/legal/terms": legalDocumentSEO(
    "/legal/terms",
    "Terms of Service",
    "Terms of Service | OneUptime",
    "The terms for using OneUptime's website and hosted product: your data and account, notice of changes, our liability, and how disputes are resolved.",
  ),
  "/legal/privacy": legalDocumentSEO(
    "/legal/privacy",
    "Privacy Policy",
    "Privacy Policy | OneUptime",
    "How OneUptime collects, uses, stores and protects personal data, how long we keep it, and your rights over it under the GDPR and UK GDPR.",
  ),
  "/legal/code-of-conduct": legalDocumentSEO(
    "/legal/code-of-conduct",
    "Code of Conduct",
    "Code of Conduct | OneUptime",
    "The values and standards every employee, contractor and representative acting on OneUptime's behalf is expected to uphold.",
  ),
  "/legal/sla": legalDocumentSEO(
    "/legal/sla",
    "Service Level Agreement",
    "Service Level Agreement (SLA) | OneUptime",
    "OneUptime's SLA: a 99.9% monthly uptime target on paid plans, 99.95% on Enterprise plans with a signed order form, and service credits if we miss it.",
  ),
  "/legal/security": legalDocumentSEO(
    "/legal/security",
    "Security",
    "Security Practices & Safeguards | OneUptime",
    "The administrative, technical and physical safeguards OneUptime uses to protect your data, and how to report a security vulnerability to us.",
  ),
  "/legal/deprecation-policy": legalDocumentSEO(
    "/legal/deprecation-policy",
    "Deprecation Policy",
    "Deprecation Policy | OneUptime",
    "How OneUptime changes and retires APIs, features and integrations: at least 12 months' notice for breaking API changes and 6 months for feature removals.",
  ),

  // Privacy and data
  "/legal/gdpr": legalDocumentSEO(
    "/legal/gdpr",
    "GDPR",
    "GDPR Compliance | OneUptime",
    "OneUptime is GDPR compliant as a processor, with a Data Processing Agreement, Standard Contractual Clauses and EU data residency available.",
  ),
  "/legal/ccpa": legalDocumentSEO(
    "/legal/ccpa",
    "CCPA",
    "CCPA & CPRA Compliance | OneUptime",
    "How OneUptime complies with the California Consumer Privacy Act and CPRA, and honours consumer privacy rights for all of its customers.",
  ),
  "/legal/hipaa": legalDocumentSEO(
    "/legal/hipaa",
    "HIPAA",
    "HIPAA Compliance & BAA | OneUptime",
    "OneUptime is HIPAA compliant as a business associate. Covered entities sign a Business Associate Agreement with us before any PHI is processed.",
  ),
  "/legal/data-residency": legalDocumentSEO(
    "/legal/data-residency",
    "Data Residency",
    "Data Residency | OneUptime",
    "OneUptime Enterprise customers choose the region their data is stored in, on AWS, Azure, GCP or on-premises, to meet data residency requirements.",
  ),
  "/legal/subprocessors": legalDocumentSEO(
    "/legal/subprocessors",
    "Subprocessors",
    "Subprocessors | OneUptime",
    "The third-party subprocessors OneUptime engages to deliver its services, with the identity, location and role of each one.",
  ),
  "/legal/dpa": legalDocumentSEO(
    "/legal/dpa",
    "Data Processing Agreement",
    "Data Processing Agreement (DPA) | OneUptime",
    "OneUptime's Data Processing Agreement: how HackerBay, Inc. processes personal data on your behalf as a processor under data protection laws.",
  ),
  "/legal/cookies": legalDocumentSEO(
    "/legal/cookies",
    "Cookie Policy",
    "Cookie Policy | OneUptime",
    "Which cookies and similar technologies OneUptime uses on its website and products, why we use them, and how you can control them.",
  ),

  // Security and compliance certifications
  "/legal/iso-27001": legalDocumentSEO(
    "/legal/iso-27001",
    "ISO/IEC 27001",
    "ISO/IEC 27001 Certification | OneUptime",
    "OneUptime Cloud is run under an ISO/IEC 27001 certified information security management system. The certificate and its scope are available on request.",
  ),
  "/legal/iso-27017": legalDocumentSEO(
    "/legal/iso-27017",
    "ISO/IEC 27017",
    "ISO/IEC 27017 Cloud Security Controls | OneUptime",
    "OneUptime's ISO/IEC 27017 cloud-services security controls, audited alongside its ISO/IEC 27001 certification. Certificate available on request.",
  ),
  "/legal/iso-27018": legalDocumentSEO(
    "/legal/iso-27018",
    "ISO/IEC 27018",
    "ISO/IEC 27018 Cloud PII Protection | OneUptime",
    "OneUptime's ISO/IEC 27018 controls for protecting personally identifiable information in public clouds, audited alongside ISO/IEC 27001.",
  ),
  "/legal/soc-2": legalDocumentSEO(
    "/legal/soc-2",
    "SOC 2",
    "SOC 2 Type II Report | OneUptime",
    "OneUptime's SOC 2 Type II report covers security, availability and confidentiality and is renewed annually. Request the full report under NDA.",
  ),
  "/legal/soc-3": legalDocumentSEO(
    "/legal/soc-3",
    "SOC 3",
    "SOC 3 Report | OneUptime",
    "OneUptime's SOC 3 report, the general-use summary of its SOC 2 examination, which can be shared without an NDA. Request a copy from our team.",
  ),
  "/legal/pci": legalDocumentSEO(
    "/legal/pci",
    "PCI DSS",
    "PCI DSS Compliance | OneUptime",
    "OneUptime's PCI DSS compliance is validated by a Qualified Security Assessor, with a signed Attestation of Compliance available on request.",
  ),
  "/legal/21-cfr-part-11": legalDocumentSEO(
    "/legal/21-cfr-part-11",
    "21 CFR Part 11",
    "21 CFR Part 11 Electronic Records | OneUptime",
    "OneUptime's controls that support FDA 21 CFR Part 11 electronic records and signatures, with documentation for validating your own system.",
  ),
  "/legal/gamp-5": legalDocumentSEO(
    "/legal/gamp-5",
    "GAMP 5",
    "GAMP 5 Category 4 Software | OneUptime",
    "OneUptime is a GAMP 5 Category 4 configurable product, aligned with GAMP 5, with validation documentation to support your risk-based validation.",
  ),
  "/legal/annex-11": legalDocumentSEO(
    "/legal/annex-11",
    "EU GMP Annex 11",
    "EU GMP Annex 11 Computerised Systems | OneUptime",
    "How OneUptime aligns with EU GMP Annex 11 for computerised systems, and the documentation we supply so you can qualify it for GMP-regulated use.",
  ),
  "/legal/iso-9001": legalDocumentSEO(
    "/legal/iso-9001",
    "ISO 9001",
    "ISO 9001 Quality Management | OneUptime",
    "OneUptime is ISO 9001 certified for its quality management system, covering how we build and operate the service. Certificate available on request.",
  ),
  "/legal/gxp-cloud": legalDocumentSEO(
    "/legal/gxp-cloud",
    "GxP Cloud Compliance",
    "GxP Cloud Qualification | OneUptime",
    "OneUptime's GxP Cloud Qualification Package helps regulated life sciences customers qualify our cloud-hosted platform for GxP environments.",
  ),
  "/legal/csa-star": legalDocumentSEO(
    "/legal/csa-star",
    "CSA STAR",
    "CSA STAR Level 2 Certification | OneUptime",
    "OneUptime is CSA STAR Level 2 certified against the Cloud Controls Matrix, with its CAIQ published to the STAR registry for security reviews.",
  ),
  "/legal/fedramp": legalDocumentSEO(
    "/legal/fedramp",
    "FedRAMP",
    "FedRAMP Authorization Status | OneUptime",
    "FedRAMP Moderate authorization for OneUptime Cloud is in progress and not yet granted. Self-hosted deployments fall under your own ATO instead.",
  ),
  "/legal/vpat": legalDocumentSEO(
    "/legal/vpat",
    "VPAT (Accessibility)",
    "VPAT & Accessibility Conformance Report | OneUptime",
    "OneUptime's VPAT: an Accessibility Conformance Report for the OneUptime web application against WCAG 2.2 Level AA and EN 301 549.",
  ),

  // Other
  "/legal/dmca": legalDocumentSEO(
    "/legal/dmca",
    "DMCA",
    "DMCA Copyright Policy | OneUptime",
    "How to send OneUptime's copyright agent a DMCA notice about material on a OneUptime service that you believe infringes your copyright.",
  ),
  "/legal/contact": legalDocumentSEO(
    "/legal/contact",
    "Contact",
    "Legal & Privacy Contact | OneUptime",
    "Contact HackerBay, Inc., the company behind OneUptime, about legal, privacy and data protection matters, with our registered address and email contacts.",
  ),

  // Teams (Solutions)
  "/solutions/devops": {
    title: "DevOps Monitoring & Observability | OneUptime",
    description:
      "Observability platform built for DevOps teams. Monitor infrastructure, track deployments, automate incident response, and improve MTTR. Open source.",
    canonicalPath: "/solutions/devops",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      { name: "DevOps", url: "/solutions/devops" },
    ],
  },

  "/solutions/sre": {
    title: "SRE Platform | Site Reliability Engineering | OneUptime",
    description:
      "Complete SRE platform with SLOs, error budgets, incident management, and on-call scheduling. Track reliability metrics and reduce toil. Open source.",
    canonicalPath: "/solutions/sre",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      { name: "SRE", url: "/solutions/sre" },
    ],
  },

  "/solutions/platform": {
    title: "Platform Engineering Observability | OneUptime",
    description:
      "Observability for platform engineering teams. Provide self-service monitoring, standardized dashboards, and unified alerting for internal developer platforms. Open source.",
    canonicalPath: "/solutions/platform",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      { name: "Platform", url: "/solutions/platform" },
    ],
  },

  "/solutions/developers": {
    title: "Developer Observability Tools | OneUptime",
    description:
      "Debugging and observability tools for developers. Trace requests, search logs, track errors, and understand application performance. Open source.",
    canonicalPath: "/solutions/developers",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      { name: "Developers", url: "/solutions/developers" },
    ],
  },

  /*
   * These four pages were routed with no entry here, so they fell back to the
   * site-wide "OneUptime | Complete Observability Platform" in their social
   * cards and structured data. Their copy is the copy their templates carried.
   */
  "/solutions/incident-response": {
    title: "Incident Response | Detect & Resolve Faster | OneUptime",
    description:
      "Streamline your incident response with automated detection, intelligent routing, and collaborative tools. Reduce MTTR and keep your services running.",
    canonicalPath: "/solutions/incident-response",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      { name: "Incident Response", url: "/solutions/incident-response" },
    ],
  },

  "/solutions/uptime-monitoring": {
    title: "Uptime Monitoring & Real-Time Downtime Alerts | OneUptime",
    description:
      "Monitor your websites, APIs, and services from probes you place where your users are. Get instant alerts when downtime occurs. 99.95% uptime target on Enterprise plans.",
    canonicalPath: "/solutions/uptime-monitoring",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      { name: "Uptime Monitoring", url: "/solutions/uptime-monitoring" },
    ],
  },

  "/solutions/observability": {
    title: "Full-Stack Observability in One Platform | OneUptime",
    description:
      "Complete observability platform combining logs, metrics, and traces. Get full visibility into your systems with correlated data and AI-powered insights.",
    canonicalPath: "/solutions/observability",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      { name: "Observability", url: "/solutions/observability" },
    ],
  },

  "/solutions/status-communication": {
    title: "Incident Communication | Keep Customers Informed | OneUptime",
    description:
      "Beautiful, customizable status pages that keep your customers informed. Public and private status pages with automatic updates and subscriber notifications.",
    canonicalPath: "/solutions/status-communication",
    twitterCard: "summary_large_image",
    pageType: "solutions",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Solutions", url: "/#solutions" },
      {
        name: "Status Communication",
        url: "/solutions/status-communication",
      },
    ],
  },

  // Industries
  "/industries/fintech": {
    title: "FinTech Monitoring & Compliance | OneUptime",
    description:
      "Observability platform for FinTech companies. SOC 2 compliant, PCI-DSS ready. Monitor payment systems, track transactions, and ensure uptime for financial services.",
    canonicalPath: "/industries/fintech",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "FinTech", url: "/industries/fintech" },
    ],
  },

  "/industries/saas": {
    title: "SaaS Monitoring & Status Pages | OneUptime",
    description:
      "Complete observability for SaaS companies. Monitor your application, communicate status to customers, manage incidents, and improve reliability. Open source.",
    canonicalPath: "/industries/saas",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "SaaS", url: "/industries/saas" },
    ],
  },

  "/industries/healthcare": {
    title: "Healthcare IT Monitoring | HIPAA Compliant | OneUptime",
    description:
      "HIPAA-compliant observability platform for healthcare organizations. Monitor EHR systems, ensure uptime for critical health services, and maintain compliance.",
    canonicalPath: "/industries/healthcare",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "Healthcare", url: "/industries/healthcare" },
    ],
  },

  "/industries/ecommerce": {
    title: "E-Commerce Monitoring & Uptime | OneUptime",
    description:
      "Observability platform for e-commerce. Monitor checkout flows, track page performance, ensure uptime during peak traffic, and reduce cart abandonment.",
    canonicalPath: "/industries/ecommerce",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "E-Commerce", url: "/industries/ecommerce" },
    ],
  },

  "/industries/media": {
    title: "Media & Streaming Monitoring | OneUptime",
    description:
      "Observability for media and streaming platforms. Monitor video delivery, track playback quality, ensure global availability, and optimize viewer experience.",
    canonicalPath: "/industries/media",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "Media", url: "/industries/media" },
    ],
  },

  "/industries/government": {
    title: "Government IT Monitoring | Self-Hosted & Secure | OneUptime",
    description:
      "Secure observability platform for government agencies. Self-hosted deployment, data residency controls, and compliance-ready. Monitor critical public services.",
    canonicalPath: "/industries/government",
    twitterCard: "summary_large_image",
    pageType: "industry",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Industries", url: "/#industries" },
      { name: "Government", url: "/industries/government" },
    ],
  },

  /*
   * The integrations index and one OpenTelemetry guide per framework: each
   * guide's title and description are its own data
   * (Utils/Integrations/OpenTelemetry/Guides).
   */
  ...getOpenTelemetryGuideSEOEntries(),
};

/*
 * Titles of the comparison pages, /compare/<slug>, by slug. Each leads with
 * the phrase buyers search ("PagerDuty alternative") and ends with the brand.
 * The template used to append "Alternative - OneUptime | Open Source | 2026
 * Comparison" to the competitor's full name, 84 characters for Better Stack,
 * and search results cut it off before the part that sells the page.
 */
export const ComparePageTitles: Record<string, string> = {
  pagerduty: "PagerDuty Alternative: Open-Source On-Call | OneUptime",
  "statuspage.io":
    "Statuspage Alternative: Open-Source Status Pages | OneUptime",
  pingdom: "Pingdom Alternative: Open-Source Monitoring | OneUptime",
  datadog: "Datadog Alternative: Open-Source Observability | OneUptime",
  newrelic: "New Relic Alternative: Open-Source Observability | OneUptime",
  "better-uptime": "Better Uptime Alternative (Better Stack) | OneUptime",
  "uptime-robot": "UptimeRobot Alternative: Open-Source Monitoring | OneUptime",
  checkly: "Checkly Alternative: Synthetic & API Monitoring | OneUptime",
  "incident.io": "incident.io Alternative with Built-In Monitoring | OneUptime",
  signoz: "SigNoz Alternative with On-Call & Status Pages | OneUptime",
  opsgenie: "Opsgenie Alternative: Open-Source On-Call | OneUptime",
  squadcast: "Squadcast Alternative: Open-Source On-Call | OneUptime",
  firehydrant: "FireHydrant Alternative with Built-In Monitoring | OneUptime",
  rootly: "Rootly Alternative with Built-In Monitoring | OneUptime",
  xmatters: "xMatters Alternative: Open-Source On-Call | OneUptime",
  grafana: "Grafana Alternative: All-in-One Observability | OneUptime",
  dynatrace: "Dynatrace Alternative: Open-Source Observability | OneUptime",
  splunk: "Splunk Alternative: Open-Source Observability | OneUptime",
  sentry: "Sentry Alternative: Open-Source Error Tracking | OneUptime",
  appdynamics: "AppDynamics Alternative: Open-Source APM | OneUptime",
  elastic: "Elastic Observability Alternative: Open Source | OneUptime",
  site24x7: "Site24x7 Alternative: Open-Source Monitoring | OneUptime",
  cronitor: "Cronitor Alternative: Cron & Uptime Monitoring | OneUptime",
  "healthchecks-io":
    "Healthchecks.io Alternative: Cron Job Monitoring | OneUptime",
  instatus: "Instatus Alternative: Open-Source Status Pages | OneUptime",
  freshping: "Freshping Alternative: Open-Source Monitoring | OneUptime",
  prometheus: "Prometheus Alternative: Metrics, Logs & Traces | OneUptime",
  zabbix: "Zabbix Alternative: Modern Monitoring & On-Call | OneUptime",
  nagios: "Nagios Alternative: Modern Monitoring & On-Call | OneUptime",
};

// "healthchecks-io" -> "Healthchecks Io", for a slug no comparison exists for.
const nameFromSlug: (slug: string) => string = (slug: string): string => {
  return slug
    .split("-")
    .map((word: string) => {
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
};

// Helper to get SEO data for a path, with fallback
export const getPageSEO: (path: string) => PageSEOData = (
  path: string,
): PageSEOData => {
  // Exact match first
  if (PageSEOConfig[path]) {
    return PageSEOConfig[path];
  }

  // Comparison pages: the competitor's real name comes from ProductCompare.
  if (path.startsWith("/compare/")) {
    const slug: string = path.replace("/compare/", "");
    const product: Product | undefined = ProductCompare(slug);
    const productName: string = product
      ? product.productName
      : nameFromSlug(slug);
    const title: string = Object.prototype.hasOwnProperty.call(
      ComparePageTitles,
      slug,
    )
      ? ComparePageTitles[slug]!
      : `${productName} Alternative | OneUptime`;

    return {
      title,
      description: `${productName} vs OneUptime: compare features, pricing and migration. Monitoring, status pages, incidents and on-call in one open-source platform.`,
      canonicalPath: path,
      twitterCard: "summary_large_image",
      pageType: "compare",
      breadcrumbs: [
        { name: "Home", url: "/" },
        { name: "Compare", url: "/compare" },
        { name: `vs ${productName}`, url: path },
      ],
    };
  }

  /*
   * A legal path with no entry above. Every routed legal document has its own
   * entry; this only names the rest, which render the not-found page.
   */
  if (path.startsWith("/legal/")) {
    const section: string = path.replace("/legal/", "");
    const sectionName: string = section
      .split("-")
      .map((word: string) => {
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");
    return {
      title: `${sectionName} | Legal | OneUptime`,
      description: `OneUptime ${sectionName.toLowerCase()} legal information and compliance documentation.`,
      canonicalPath: path,
      twitterCard: "summary",
      pageType: "legal",
      breadcrumbs: [
        { name: "Home", url: "/" },
        { name: sectionName, url: path },
      ],
    };
  }

  // Default fallback
  return createDefaultSEO(
    "OneUptime | Complete Observability Platform",
    "OneUptime monitors websites, APIs, and servers and alerts your team if something goes wrong. It also keeps your customers updated about any downtime.",
    path,
    "other",
  );
};

export default PageSEOConfig;
