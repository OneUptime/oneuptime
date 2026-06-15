/*
 * Page-specific SEO metadata configuration for OneUptime landing pages
 * This provides structured data for search engines and AI agents
 */

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface PageSEOData {
  title: string;
  description: string;
  canonicalPath: string; // e.g., "/product/monitoring" - will be combined with homeUrl
  ogImage?: string; // defaults to /img/og-image.png if not specified
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

// Page-specific SEO configurations
export const PageSEOConfig: Record<string, PageSEOData> = {
  // Homepage
  "/": {
    title: "OneUptime | Complete Monitoring & Observability Platform",
    description:
      "OneUptime is an open-source complete observability platform. Monitor websites, APIs, and servers. Get alerts, manage incidents, and keep customers informed with status pages. Free tier available.",
    canonicalPath: "/",
    ogType: "website",
    twitterCard: "summary_large_image",
    pageType: "home",
    breadcrumbs: [{ name: "Home", url: "/" }],
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
    title: "Uptime Monitoring | Website, API, Server Monitoring | OneUptime",
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
    title:
      "Incident Management Software | Resolve Incidents Faster | OneUptime",
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
    title:
      "On-Call Management & Alerting | Schedules & Escalations | OneUptime",
    description:
      "On-call scheduling, alerting, and escalation policies. Alert the right people at the right time via SMS, phone, email, Slack. Rotation schedules and override support. Open source.",
    canonicalPath: "/product/on-call",
    ogImage: "/img/on-call.png",
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
    ogImage: "/img/workflows.png",
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

  "/product/ai-agent": {
    title: "AI Agent | Automatic Code Fixes & PRs | OneUptime",
    description:
      "AI Agent automatically fixes errors, performance issues, and database queries in your codebase. Creates ready-to-merge pull requests. Supports OpenAI, Anthropic, Ollama, and self-hosted LLMs. Privacy-first: no code stored or trained on.",
    canonicalPath: "/product/ai-agent",
    ogImage: "/img/ai-agent.png",
    twitterCard: "summary_large_image",
    pageType: "product",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Products", url: "/#products" },
      { name: "AI Agent", url: "/product/ai-agent" },
    ],
    softwareApplication: {
      name: "OneUptime AI Agent",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web, Cloud",
      description:
        "AI-powered agent that automatically detects and fixes code issues, creating ready-to-merge pull requests.",
      features: [
        "Automatic error fixes",
        "Performance issue resolution",
        "Database query optimization",
        "Frontend issue fixes",
        "GitHub and GitLab integration",
        "CI/CD pipeline integration",
        "Terraform support",
        "Issue tracker integration",
        "Multiple LLM provider support",
        "Self-hosted LLM option",
        "Privacy-first: no code storage",
      ],
    },
  },

  "/tool/mcp-server": {
    title: "MCP Server | Model Context Protocol for AI Agents | OneUptime",
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

  "/tool/cli": {
    title: "CLI | Command Line Interface for Observability | OneUptime",
    description:
      "OneUptime CLI lets you manage monitors, incidents, status pages, and observability data from your terminal. Deploy, configure, and automate your monitoring infrastructure with simple commands.",
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
        "Command line interface for managing OneUptime monitors, incidents, status pages, and observability data from your terminal.",
      features: [
        "Monitor creation and management",
        "Incident response from terminal",
        "Status page management",
        "Real-time log tailing",
        "CI/CD pipeline integration",
        "Scriptable JSON output",
        "YAML configuration support",
        "Bulk operations",
        "npm, Homebrew, and Docker install",
        "API key and browser authentication",
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
    title:
      "Kubernetes Observability | Monitor Clusters, Pods & Nodes | OneUptime",
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
    title:
      "Docker Observability | Monitor Hosts, Containers & Images | OneUptime",
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
    title:
      "Podman Observability | Monitor Hosts, Containers & Images | OneUptime",
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
    title: "Host Observability | Server Metrics, Processes & Logs | OneUptime",
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
    title: "Proxmox Monitoring | Nodes, VMs, Storage & Backups | OneUptime",
    description:
      "Monitor Proxmox VE clusters end to end: node and guest health, storage usage, backup coverage, and replication alerting. One agent per cluster, flat project pricing, 10-minute setup. Open source.",
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
        "Flat project pricing, not per-host",
        "OpenTelemetry native",
        "Open source",
      ],
    },
  },

  "/product/ceph": {
    title:
      "Ceph Monitoring | Cluster Health, OSDs, Pools & Capacity | OneUptime",
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
    title:
      "Docker Swarm Monitoring | Nodes, Services, Tasks & Stacks | OneUptime",
    description:
      "Monitor Docker Swarm clusters end to end: manager and worker node health, services and their task replicas, stacks, overlay networks, secrets, configs, and volumes. One agent on a manager node, flat project pricing, 10-minute setup. Open source.",
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
        "Flat project pricing",
        "OpenTelemetry native",
        "Open source",
      ],
    },
  },

  "/product/services": {
    title: "Service Catalog | Map, Own & Monitor Every Service | OneUptime",
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

  "/product/profiles": {
    title:
      "Continuous Profiling | CPU, Memory & Allocation Profiling | OneUptime",
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
    title: "Scheduled Maintenance | Plan & Communicate Downtime | OneUptime",
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
    title: "Serverless Observability | AWS Lambda & Functions | OneUptime",
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
    title: "Real User Monitoring (RUM) | Web Vitals & Sessions | OneUptime",
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

  // Pricing
  "/pricing": {
    title: "Pricing | Free Tier & Paid Plans | OneUptime",
    description:
      "OneUptime pricing starts free. Get status pages, monitoring, incident management, and more. Transparent pricing with no hidden fees. Enterprise plans available.",
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
    title: "Enterprise | Self-Hosted & Cloud | OneUptime",
    description:
      "OneUptime for enterprise. Self-hosted deployment, SSO/SAML, advanced security, SLA guarantees, dedicated support. SOC 2, HIPAA, GDPR compliant.",
    canonicalPath: "/enterprise/overview",
    twitterCard: "summary_large_image",
    pageType: "enterprise",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Enterprise", url: "/enterprise/overview" },
    ],
  },

  "/enterprise/demo": {
    title: "Request Demo | See OneUptime in Action | OneUptime",
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

  // Legal pages
  "/legal": {
    title: "Legal Center | Terms, Privacy, Compliance | OneUptime",
    description:
      "OneUptime legal documents including terms of service, privacy policy, GDPR, SOC 2, HIPAA compliance information.",
    canonicalPath: "/legal",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
    ],
  },

  "/legal/terms": {
    title: "Terms of Service | OneUptime",
    description: "OneUptime terms of service and conditions of use.",
    canonicalPath: "/legal/terms",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
      { name: "Terms of Service", url: "/legal/terms" },
    ],
  },

  "/legal/privacy": {
    title: "Privacy Policy | OneUptime",
    description:
      "OneUptime privacy policy. Learn how we collect, use, and protect your data.",
    canonicalPath: "/legal/privacy",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
      { name: "Privacy Policy", url: "/legal/privacy" },
    ],
  },

  "/legal/cookies": {
    title: "Cookie Policy | OneUptime",
    description:
      "OneUptime cookie policy. Learn what cookies we use, why we use them, and how to control them.",
    canonicalPath: "/legal/cookies",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
      { name: "Cookie Policy", url: "/legal/cookies" },
    ],
  },

  "/legal/gdpr": {
    title: "GDPR Compliance | OneUptime",
    description:
      "OneUptime GDPR compliance information. We are committed to protecting EU citizen data rights.",
    canonicalPath: "/legal/gdpr",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
      { name: "GDPR", url: "/legal/gdpr" },
    ],
  },

  "/legal/soc-2": {
    title: "SOC 2 Compliance | OneUptime",
    description:
      "OneUptime SOC 2 Type II compliance. Our security controls are audited annually.",
    canonicalPath: "/legal/soc-2",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
      { name: "SOC 2", url: "/legal/soc-2" },
    ],
  },

  "/legal/hipaa": {
    title: "HIPAA Compliance | OneUptime",
    description:
      "OneUptime HIPAA compliance for healthcare organizations. We sign BAAs for enterprise customers.",
    canonicalPath: "/legal/hipaa",
    twitterCard: "summary",
    pageType: "legal",
    breadcrumbs: [
      { name: "Home", url: "/" },
      { name: "Legal", url: "/legal" },
      { name: "HIPAA", url: "/legal/hipaa" },
    ],
  },

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
    title: "SRE Tools & Platform | Site Reliability Engineering | OneUptime",
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
    title: "Government IT Monitoring | FedRAMP Ready | OneUptime",
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
};

// Helper to get SEO data for a path, with fallback
export const getPageSEO: (path: string) => PageSEOData = (
  path: string,
): PageSEOData => {
  // Exact match first
  if (PageSEOConfig[path]) {
    return PageSEOConfig[path];
  }

  // For compare pages, create dynamic SEO
  if (path.startsWith("/compare/")) {
    const product: string = path.replace("/compare/", "");
    const productName: string = product
      .split("-")
      .map((word: string) => {
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");
    return {
      title: `OneUptime vs ${productName} | Comparison | OneUptime`,
      description: `Compare OneUptime with ${productName}. See features, pricing, and why teams choose OneUptime as their observability platform.`,
      canonicalPath: path,
      twitterCard: "summary_large_image",
      pageType: "compare",
      breadcrumbs: [
        { name: "Home", url: "/" },
        { name: "Compare", url: "/#compare" },
        { name: `vs ${productName}`, url: path },
      ],
    };
  }

  // For legal subpages not explicitly defined
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
        { name: "Legal", url: "/legal" },
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
