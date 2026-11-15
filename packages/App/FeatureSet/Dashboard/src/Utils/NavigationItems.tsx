import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";
import RouteParams from "./RouteParams";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ProductKey from "Common/Types/Product/ProductKey";
import { NavItem, MoreMenuItem } from "Common/UI/Components/Navbar/NavBar";
import { useTranslation } from "react-i18next";
import { BILLING_ENABLED } from "Common/UI/Config";

export interface DashboardNavigationItems {
  navItems: NavItem[];
  moreMenuItems: MoreMenuItem[];
  /*
   * The categories the products menu opens on: Essentials, open every time
   * it opens. Every other category starts folded to one row until it is
   * opened, so the menu opens on the core products rather than on every
   * product at once.
   */
  moreMenuCategoriesOpenByDefault: Array<string>;
  /*
   * The categories whose order never changes (#6814): Essentials, in the
   * order a problem flows through them, and Settings. In every other
   * category the products a project uses come first.
   */
  moreMenuCategoriesInFixedOrder: Array<string>;
  rightElement: NavItem;
}

/*
 * The single source of truth for the dashboard's page catalog: the NavBar
 * renders it and the command palette searches it, so an item added here shows
 * up in both. It is a hook (not a constant) on purpose — titles come from
 * useTranslation and routes are populated with the CURRENT project id via
 * RouteUtil.populateRouteParams, so the arrays must be rebuilt on every render
 * for language and project switches to propagate.
 */
export function useDashboardNavigationItems(): DashboardNavigationItems {
  const { t } = useTranslation();

  /*
   * Every title below is the Dashboard's own keyed text, in the reader's
   * words already, and says so (isTitleTranslated): the bar, its
   * breadcrumb, a pin and the phone's menu draw it as given. Looked up
   * again, a translation that is itself an English word was translated
   * twice - Spanish says "Red" for Network, and "Red" is "Rojo" (#7790).
   */
  const essentialsCategory: string = t("navbar.categories.essentials");
  const observabilityCategory: string = t("navbar.categories.observability");
  /*
   * Finding threats and protecting sensitive data: Security Events (SIEM and
   * SOAR) and Data Security (DSPM). Observability keeps what you watch your
   * systems with.
   */
  const securityCategory: string = t("navbar.categories.security", "Security");
  const aiCategory: string = t("navbar.categories.ai", "AI");
  const codeCategory: string = t("navbar.categories.code", "Code");
  const resourcesCategory: string = t("navbar.categories.resources");
  const infrastructureCategory: string = t(
    "navbar.categories.infrastructure",
    "Infrastructure",
  );
  /*
   * What a cloud runs for you: the accounts you connect and every resource
   * in them, the apps on its managed app and container platforms, and its
   * functions. Infrastructure keeps what you run yourself.
   */
  const cloudCategory: string = t("navbar.categories.cloud", "Cloud");
  const analyticsAutomationCategory: string = t(
    "navbar.categories.analyticsAutomation",
  );
  const settingsCategory: string = t("navbar.categories.settings");

  // Build the main navigation items - only Home now
  const navItems: NavItem[] = [
    {
      id: "home-nav-bar-item",
      title: t("navbar.home"),
      isTitleTranslated: true,
      icon: IconProp.Home,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
      activeRoute: RouteMap[PageMap.HOME],
    },
  ];

  // Build the products menu items - all products organized by category
  const moreMenuItems: MoreMenuItem[] = [
    /*
     * Essentials — in the order a problem flows through them: a monitor
     * notices it, it becomes an incident or alert, on-call is paged and the
     * status page tells customers. Home's "How OneUptime works" strip tells
     * the same story, so keep the two in step.
     */
    {
      key: ProductKey.Monitors,
      title: t("navbar.items.monitorsTitle"),
      isTitleTranslated: true,
      keywords: [
        "uptime",
        "checks",
        "health checks",
        "synthetic monitoring",
        "ping",
        "http",
        "ssl",
        "heartbeat",
      ],
      description: t("navbar.items.monitorsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.MONITORS] as Route),
      activeRoute: RouteMap[PageMap.MONITORS],
      // Monitor Groups share the Monitors side menu, so they are Monitors too.
      additionalActiveRoutes: [RouteMap[PageMap.MONITOR_GROUPS_ROOT] as Route],
      icon: IconProp.AltGlobe,
      iconColor: "blue",
      category: essentialsCategory,
    },
    {
      key: ProductKey.Incidents,
      title: t("navbar.items.incidentsTitle"),
      isTitleTranslated: true,
      keywords: ["outage", "downtime", "incident response", "postmortem"],
      description: t("navbar.items.incidentsDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.INCIDENTS],
      icon: IconProp.Alert,
      iconColor: "rose",
      category: essentialsCategory,
    },
    {
      key: ProductKey.Alerts,
      title: t("navbar.items.alertsTitle"),
      isTitleTranslated: true,
      keywords: ["notifications", "alarms", "thresholds", "warnings"],
      description: t("navbar.items.alertsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.ALERTS] as Route),
      activeRoute: RouteMap[PageMap.ALERTS],
      icon: IconProp.ExclaimationCircle,
      iconColor: "amber",
      category: essentialsCategory,
    },
    {
      key: ProductKey.OnCall,
      title: t("navbar.items.onCallDutyTitle"),
      isTitleTranslated: true,
      /*
       * The product was "On-Call Duty" until #6817 named it On-Call: its
       * old name is a keyword, so people who learned it still find it.
       */
      keywords: [
        "oncall",
        "on call",
        "on-call duty",
        "pager",
        "paging",
        "escalation",
        "rotation",
        "schedule",
      ],
      description: t("navbar.items.onCallDutyDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY] as Route,
      ),
      // The product includes schedules and other siblings of the policies page.
      activeRoute: new Route(
        `/dashboard/${RouteParams.ProjectID}/on-call-duty`,
      ),
      icon: IconProp.Call,
      iconColor: "stone",
      category: essentialsCategory,
    },
    {
      key: ProductKey.StatusPages,
      title: t("navbar.items.statusPagesTitle"),
      isTitleTranslated: true,
      keywords: [
        "statuspage",
        "service status",
        "public status",
        "uptime page",
      ],
      description: t("navbar.items.statusPagesDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGES] as Route,
      ),
      activeRoute: RouteMap[PageMap.STATUS_PAGES],
      icon: IconProp.CheckCircle,
      iconColor: "emerald",
      category: essentialsCategory,
    },
    {
      key: ProductKey.ScheduledMaintenance,
      title: t("navbar.items.scheduledMaintenanceTitle"),
      isTitleTranslated: true,
      keywords: [
        "maintenance window",
        "planned downtime",
        "scheduled downtime",
        // What one of its records was called before it became a maintenance event (#6817).
        "scheduled maintenance events",
        "scheduled events",
      ],
      description: t("navbar.items.scheduledMaintenanceDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS],
      icon: IconProp.Clock,
      iconColor: "cyan",
      category: essentialsCategory,
    },
    {
      key: ProductKey.Slos,
      title: t("navbar.items.slosTitle", "SLOs"),
      isTitleTranslated: true,
      keywords: [
        "service level objectives",
        "service level indicators",
        "sli",
        "error budgets",
        "burn rate",
        "reliability",
      ],
      description: t(
        "navbar.items.slosDescription",
        "Service level objectives and error budgets.",
      ),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SLOS] as Route),
      activeRoute: RouteMap[PageMap.SLOS],
      icon: IconProp.Gauge,
      iconColor: "violet",
      category: essentialsCategory,
    },
    // Observability
    {
      key: ProductKey.Logs,
      title: t("navbar.items.logsTitle"),
      isTitleTranslated: true,
      keywords: ["logging", "log search", "log explorer", "syslog"],
      description: t("navbar.items.logsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route),
      activeRoute: RouteMap[PageMap.LOGS],
      icon: IconProp.Logs,
      iconColor: "amber",
      category: observabilityCategory,
    },
    {
      key: ProductKey.Metrics,
      title: t("navbar.items.metricsTitle"),
      isTitleTranslated: true,
      keywords: [
        "timeseries",
        "time series",
        "prometheus",
        "measurements",
        "counters",
        "gauges",
      ],
      description: t("navbar.items.metricsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.METRICS] as Route),
      activeRoute: RouteMap[PageMap.METRICS],
      icon: IconProp.Heartbeat,
      iconColor: "purple",
      category: observabilityCategory,
    },
    {
      key: ProductKey.Traces,
      title: t("navbar.items.tracesTitle"),
      isTitleTranslated: true,
      keywords: [
        "distributed tracing",
        "spans",
        "requests",
        "otel",
        "opentelemetry",
      ],
      description: t("navbar.items.tracesDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.TRACES] as Route),
      activeRoute: RouteMap[PageMap.TRACES],
      icon: IconProp.Waterfall,
      iconColor: "yellow",
      category: observabilityCategory,
    },
    {
      key: ProductKey.Profiles,
      title: t("navbar.items.performanceProfilesTitle"),
      isTitleTranslated: true,
      keywords: [
        "profiling",
        // Its names before they became Profiles (#6817).
        "performance profiles",
        "profiler",
        "continuous profiling",
        "flamegraph",
        "flame graph",
        "cpu",
        "memory",
      ],
      description: t("navbar.items.performanceProfilesDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.PROFILES] as Route),
      activeRoute: RouteMap[PageMap.PROFILES],
      icon: IconProp.Fire,
      iconColor: "red",
      category: observabilityCategory,
    },
    {
      key: ProductKey.Exceptions,
      title: t("navbar.items.exceptionsTitle"),
      isTitleTranslated: true,
      keywords: [
        "errors",
        "error tracking",
        // Its name in the docs before it became Exceptions (#6817).
        "exception tracking",
        "bugs",
        "crashes",
        "stack traces",
      ],
      description: t("navbar.items.exceptionsDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS] as Route,
      ),
      activeRoute: RouteMap[PageMap.EXCEPTIONS_VIEW_ROOT],
      icon: IconProp.Bug,
      iconColor: "orange",
      category: observabilityCategory,
    },
    {
      key: ProductKey.Llm,
      title: t("navbar.items.llmObservabilityTitle", "AI / LLM"),
      isTitleTranslated: true,
      keywords: [
        "large language models",
        "generative ai",
        "genai",
        "tokens",
        "prompts",
        "completions",
        "llm cost",
      ],
      description: t(
        "navbar.items.llmObservabilityDescription",
        "Observe LLM and AI-agent calls — tokens, cost, latency, prompts and completions.",
      ),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.LLM] as Route),
      // Every AI / LLM tab, not only the one the product opens on.
      activeRoute: new Route(`/dashboard/${RouteParams.ProjectID}/llm`),
      icon: IconProp.Sparkles,
      iconColor: "violet",
      category: observabilityCategory,
    },
    {
      key: ProductKey.DataObservability,
      title: t("navbar.items.dataObservabilityTitle", "Data Observability"),
      isTitleTranslated: true,
      keywords: [
        "data quality",
        "data freshness",
        "stale tables",
        "row count",
        "schema changes",
        "table health",
        "data pipelines",
        "data catalog",
      ],
      description: t(
        "navbar.items.dataObservabilityDescription",
        "Know when a table goes stale, shrinks or changes shape - and which tables in your databases are late.",
      ),
      // The overview opens the product; every Data Observability page keeps it lit.
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_OBSERVABILITY_OVERVIEW] as Route,
      ),
      activeRoute: RouteMap[PageMap.DATA_OBSERVABILITY],
      icon: IconProp.TableCells,
      iconColor: "cyan",
      category: observabilityCategory,
    },
    {
      key: ProductKey.Topology,
      title: t("navbar.items.topologyTitle"),
      isTitleTranslated: true,
      keywords: [
        "service map",
        "dependency map",
        "dependencies",
        "architecture",
      ],
      description: t("navbar.items.topologyDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.TOPOLOGY] as Route),
      activeRoute: RouteMap[PageMap.TOPOLOGY],
      icon: IconProp.FlowDiagram,
      iconColor: "indigo",
      category: observabilityCategory,
    },
    /*
     * Security - right after Observability, where both products sat before
     * they had a category of their own, so they are found where they were.
     */
    {
      key: ProductKey.SecurityEvents,
      title: t("navbar.items.securityEventsTitle", "Security Events"),
      isTitleTranslated: true,
      keywords: [
        "siem",
        "soar",
        "security information and event management",
        "security operations",
        "threats",
        "detections",
        "security cases",
        "response automation",
        "mitre att&ck",
        "vulnerabilities",
      ],
      description: t(
        "navbar.items.securityEventsDescription",
        "Detect threats in your security events, work them as cases, and respond with playbooks.",
      ),
      // The overview opens the product; every Security Events page keeps it lit.
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS_OVERVIEW] as Route,
      ),
      activeRoute: RouteMap[PageMap.SECURITY_EVENTS],
      icon: IconProp.ShieldExclamation,
      iconColor: "rose",
      category: securityCategory,
    },
    {
      key: ProductKey.DataSecurity,
      title: t("navbar.items.dataSecurityTitle", "Data Security"),
      isTitleTranslated: true,
      keywords: [
        "dspm",
        "data security posture management",
        "pii",
        "personal data",
        "sensitive data",
        "data classification",
        "data discovery",
        "gdpr",
        "pci",
        "hipaa",
      ],
      description: t(
        "navbar.items.dataSecurityDescription",
        "Find sensitive data in your clouds, databases and telemetry, see who can reach it, and fix what matters first.",
      ),
      // The overview opens the product; every Data Security page keeps it lit.
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_SECURITY_OVERVIEW] as Route,
      ),
      activeRoute: RouteMap[PageMap.DATA_SECURITY],
      icon: IconProp.ShieldCheck,
      iconColor: "violet",
      category: securityCategory,
    },
    // AI
    {
      key: ProductKey.AIChat,
      title: t("navbar.items.aiChatTitle", "Chat"),
      isTitleTranslated: true,
      keywords: ["ai chat", "copilot", "assistant", "ask ai"],
      description: t(
        "navbar.items.aiChatDescription",
        "Chat with AI — it answers from your logs, traces, metrics, incidents, alerts and monitors, and cites every query.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.AI_COPILOT] as Route,
      ),
      activeRoute: RouteMap[PageMap.AI_COPILOT],
      icon: IconProp.ChatBubbleLeftRight,
      iconColor: "violet",
      category: aiCategory,
    },
    {
      key: ProductKey.AIInsights,
      title: t("navbar.items.sentinelInsightsTitle", "Insights"),
      isTitleTranslated: true,
      keywords: [
        "sentinel",
        "anomalies",
        "root cause analysis",
        "rca",
        "ai investigations",
      ],
      description: t(
        "navbar.items.sentinelInsightsDescription",
        "Proactive findings from OneUptime AI's telemetry watch — new exceptions, spikes, latency regressions and metric drift.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.AI_INSIGHTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.AI_INSIGHTS],
      icon: IconProp.LightBulb,
      iconColor: "violet",
      category: aiCategory,
    },
    /*
     * Code — your repositories, and AI you ask to work in them. One item:
     * it opens on the repositories, each repository's page holds its tasks
     * and the box to ask AI, and a task's page is its conversation. Every
     * page of it lives under /code, so the item stays lit on all of them.
     * (It replaced Tasks and Code Repositories; the old words stay as
     * keywords, so people who learned them still find it.)
     */
    {
      key: ProductKey.Code,
      title: t("navbar.items.codeTitle", "Code"),
      isTitleTranslated: true,
      keywords: [
        "tasks",
        "ai tasks",
        "ai agents",
        "agent tasks",
        "ask ai",
        "coding agent",
        "automated fixes",
        "fix pull requests",
        "pull requests",
        "code repositories",
        "repositories",
        "repos",
        "git",
        "github",
        "source code",
      ],
      description: t(
        "navbar.items.codeDescription",
        "Ask AI to change your code and open pull requests. Connect GitHub here.",
      ),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.CODE] as Route),
      activeRoute: RouteMap[PageMap.CODE],
      icon: IconProp.Code,
      iconColor: "violet",
      category: codeCategory,
    },
    // Resources — the catalogs that span every kind of infrastructure
    {
      key: ProductKey.Inventory,
      title: t("navbar.items.inventoryTitle", "Inventory"),
      isTitleTranslated: true,
      keywords: ["assets", "entities", "resource catalog", "cmdb"],
      description: t(
        "navbar.items.inventoryDescription",
        "Everything OneUptime knows about your estate, in one list.",
      ),
      /*
       * Lands on the Overview; every page under /inventory (the item list,
       * an item, Archived, Documentation, Settings) keeps it lit.
       */
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.INVENTORY] as Route,
      ),
      activeRoute: RouteMap[PageMap.INVENTORY_ROOT],
      icon: IconProp.Cube,
      iconColor: "indigo",
      category: resourcesCategory,
    },
    {
      key: ProductKey.Services,
      title: t("navbar.items.servicesTitle"),
      isTitleTranslated: true,
      keywords: [
        "apm",
        "application performance monitoring",
        "applications",
        "microservices",
        "otel",
        "opentelemetry",
        // Its names before it became Services (#6817).
        "service catalog",
        "telemetry services",
      ],
      description: t("navbar.items.servicesDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SERVICES] as Route),
      activeRoute: RouteMap[PageMap.SERVICES],
      icon: IconProp.SquareStack,
      iconColor: "indigo",
      category: resourcesCategory,
    },
    /*
     * Databases span every platform (traces, Kubernetes, Docker, Podman, the
     * Database Agent), so they sit with the cross-platform catalogs rather
     * than in Infrastructure. Keep the copy and keywords clear of the short
     * aliases of Real User Monitoring and Kubernetes: searching either alias
     * must still narrow the catalog to exactly one product.
     */
    {
      key: ProductKey.Databases,
      title: t("navbar.items.databasesTitle", "Databases"),
      isTitleTranslated: true,
      keywords: [
        "database",
        "db",
        "postgres",
        "postgresql",
        "mysql",
        "mariadb",
        "redis",
        "valkey",
        "mongodb",
        "sql server",
        "database monitoring",
      ],
      description: t(
        "navbar.items.databasesDescription",
        "Every database your applications query, with engine metrics.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATABASE_SERVERS] as Route,
      ),
      activeRoute: RouteMap[PageMap.DATABASE_SERVERS],
      icon: IconProp.Database,
      iconColor: "indigo",
      category: resourcesCategory,
    },
    /*
     * Queues span every broker and platform (Kafka, RabbitMQ, SQS, Pub/Sub,
     * Service Bus, ...), so they sit with the cross-platform catalogs, next
     * to Databases. Keep the copy and keywords clear of the short aliases of
     * Real User Monitoring and Kubernetes ("instrumented" hides one): each
     * alias must still narrow the catalog to exactly one product.
     */
    {
      key: ProductKey.Queues,
      title: t("navbar.items.queuesTitle", "Queues"),
      isTitleTranslated: true,
      keywords: [
        "queue",
        "message queue",
        "messaging",
        "broker",
        "kafka",
        "rabbitmq",
        "activemq",
        "jms",
        "sqs",
        "sns",
        "pub/sub",
        "pubsub",
        "service bus",
        "event hubs",
        "pulsar",
        "rocketmq",
        "nats",
        "bullmq",
        "topics",
        "consumer lag",
        "dead letter",
      ],
      description: t(
        "navbar.items.queuesDescription",
        "Message queues and topics from your traces and brokers.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.MESSAGE_QUEUES] as Route,
      ),
      activeRoute: RouteMap[PageMap.MESSAGE_QUEUES],
      icon: IconProp.QueueList,
      iconColor: "indigo",
      category: resourcesCategory,
    },
    {
      key: ProductKey.Rum,
      title: t("navbar.items.rumTitle"),
      isTitleTranslated: true,
      keywords: [
        "rum",
        "browser",
        "frontend",
        "front end",
        "web vitals",
        "session replay",
        "user experience",
      ],
      description: t("navbar.items.rumDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUM_APPLICATIONS] as Route,
      ),
      activeRoute: RouteMap[PageMap.RUM_APPLICATIONS],
      icon: IconProp.Globe,
      iconColor: "blue",
      category: resourcesCategory,
    },
    // Infrastructure — one product per platform, most common first
    {
      key: ProductKey.Hosts,
      title: t("navbar.items.hostsTitle"),
      isTitleTranslated: true,
      keywords: ["servers", "machines", "infrastructure", "linux", "windows"],
      description: t("navbar.items.hostsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.HOSTS] as Route),
      activeRoute: RouteMap[PageMap.HOSTS],
      icon: IconProp.Server,
      iconColor: "slate",
      category: infrastructureCategory,
    },
    {
      key: ProductKey.Kubernetes,
      title: t("navbar.items.kubernetesTitle"),
      isTitleTranslated: true,
      keywords: ["k8s", "kube", "kubectl", "pods", "containers", "clusters"],
      description: t("navbar.items.kubernetesDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.KUBERNETES_CLUSTERS] as Route,
      ),
      activeRoute: RouteMap[PageMap.KUBERNETES_CLUSTERS],
      icon: IconProp.Kubernetes,
      iconColor: "blue",
      category: infrastructureCategory,
    },
    {
      key: ProductKey.Docker,
      title: t("navbar.items.dockerTitle"),
      isTitleTranslated: true,
      keywords: ["containers", "container monitoring", "docker hosts"],
      description: t("navbar.items.dockerDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DOCKER_HOSTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.DOCKER_HOSTS],
      icon: IconProp.Docker,
      iconColor: "blue",
      category: infrastructureCategory,
    },
    {
      key: ProductKey.DockerSwarm,
      title: t("navbar.items.dockerSwarmTitle", "Docker Swarm"),
      isTitleTranslated: true,
      keywords: ["swarm", "container orchestration", "swarm clusters"],
      description: t(
        "navbar.items.dockerSwarmDescription",
        "Monitor Docker Swarm clusters, nodes, services and tasks.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DOCKER_SWARM_CLUSTERS] as Route,
      ),
      activeRoute: RouteMap[PageMap.DOCKER_SWARM_CLUSTERS],
      icon: IconProp.DockerSwarm,
      iconColor: "blue",
      category: infrastructureCategory,
    },
    {
      key: ProductKey.Podman,
      title: t("navbar.items.podmanTitle"),
      isTitleTranslated: true,
      keywords: ["containers", "container monitoring", "rootless containers"],
      description: t("navbar.items.podmanDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PODMAN_HOSTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.PODMAN_HOSTS],
      icon: IconProp.Podman,
      iconColor: "blue",
      category: infrastructureCategory,
    },
    {
      key: ProductKey.Proxmox,
      title: t("navbar.items.proxmoxTitle", "Proxmox"),
      isTitleTranslated: true,
      keywords: [
        "pve",
        "virtualization",
        "virtual machines",
        "lxc",
        "hypervisor",
      ],
      description: t(
        "navbar.items.proxmoxDescription",
        "Monitor Proxmox clusters, nodes and guests.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROXMOX_CLUSTERS] as Route,
      ),
      activeRoute: RouteMap[PageMap.PROXMOX_CLUSTERS],
      icon: IconProp.Proxmox,
      iconColor: "blue",
      category: infrastructureCategory,
    },
    {
      key: ProductKey.OpenStack,
      title: t("navbar.items.openstackTitle", "OpenStack"),
      isTitleTranslated: true,
      keywords: [
        "private cloud",
        "nova",
        "neutron",
        "cinder",
        "keystone",
        "glance",
        "hypervisors",
        "instances",
      ],
      description: t(
        "navbar.items.openstackDescription",
        "Monitor OpenStack clouds, services, hypervisors and instances.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.OPENSTACK_CLOUDS] as Route,
      ),
      activeRoute: RouteMap[PageMap.OPENSTACK_CLOUDS],
      icon: IconProp.Cloud,
      iconColor: "blue",
      category: infrastructureCategory,
    },
    {
      key: ProductKey.VMware,
      title: t("navbar.items.vmwareTitle", "VMware"),
      isTitleTranslated: true,
      keywords: [
        "vcenter",
        "esxi",
        "vsphere",
        "virtual machines",
        "hypervisor",
        "datastores",
      ],
      description: t(
        "navbar.items.vmwareDescription",
        "Monitor vCenter, ESXi hosts, virtual machines and datastores.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.VMWARE_VCENTERS] as Route,
      ),
      activeRoute: RouteMap[PageMap.VMWARE_VCENTERS],
      icon: IconProp.VMware,
      iconColor: "blue",
      category: infrastructureCategory,
    },
    {
      key: ProductKey.Ceph,
      title: t("navbar.items.cephTitle", "Ceph"),
      isTitleTranslated: true,
      keywords: ["storage", "osd", "rados", "storage pools"],
      description: t(
        "navbar.items.cephDescription",
        "Monitor Ceph clusters, OSDs and pools.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.CEPH_CLUSTERS] as Route,
      ),
      activeRoute: RouteMap[PageMap.CEPH_CLUSTERS],
      icon: IconProp.Ceph,
      iconColor: "blue",
      category: infrastructureCategory,
    },
    {
      key: ProductKey.StorageArrays,
      title: t("navbar.items.storageArraysTitle", "Storage Arrays"),
      isTitleTranslated: true,
      keywords: [
        "storage",
        "san",
        "nas",
        "pure storage",
        "everpure",
        "flasharray",
        "flashblade",
        "volumes",
      ],
      description: t(
        "navbar.items.storageArraysDescription",
        "Monitor storage arrays such as Pure Storage FlashArray and FlashBlade.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.STORAGE_ARRAYS] as Route,
      ),
      activeRoute: RouteMap[PageMap.STORAGE_ARRAYS],
      icon: IconProp.StorageArray,
      iconColor: "blue",
      category: infrastructureCategory,
    },
    {
      key: ProductKey.Network,
      title: t("navbar.items.networkTitle", "Network"),
      isTitleTranslated: true,
      keywords: [
        "snmp",
        "network devices",
        "network sites",
        "routers",
        "switches",
        "firewalls",
      ],
      description: t(
        "navbar.items.networkDescription",
        "Monitor network devices via SNMP and group them into sites.",
      ),
      // Land on the fleet Overview; devices and sites both keep this highlighted.
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.NETWORK_OVERVIEW] as Route,
      ),
      activeRoute: RouteMap[PageMap.NETWORK_DEVICES],
      additionalActiveRoutes: [RouteMap[PageMap.NETWORK_SITES] as Route],
      icon: IconProp.Signal,
      iconColor: "indigo",
      category: infrastructureCategory,
    },
    {
      key: ProductKey.IoT,
      title: t("navbar.items.iotTitle", "IoT"),
      isTitleTranslated: true,
      keywords: ["internet of things", "devices", "sensors", "fleets"],
      description: t(
        "navbar.items.iotDescription",
        "Monitor IoT device fleets — battery, connectivity, temperature and availability.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.IOT_FLEETS] as Route,
      ),
      activeRoute: RouteMap[PageMap.IOT_FLEETS],
      icon: IconProp.IoT,
      iconColor: "blue",
      category: infrastructureCategory,
    },
    // Cloud: the accounts, the apps on the clouds' platforms, their functions.
    /*
     * The cloud accounts connected to OneUptime and every resource in them,
     * what they cost and how to spend less. It lands on Cloud's Overview;
     * every page under /cloud keeps it lit.
     */
    {
      key: ProductKey.Cloud,
      title: t("navbar.items.cloudTitle"),
      isTitleTranslated: true,
      keywords: [
        "aws",
        "amazon web services",
        "azure",
        "gcp",
        "google cloud",
        "cloud resources",
        "cloud accounts",
        "azure subscriptions",
        "iaas",
        "cloudwatch",
        "azure monitor",
        "cloud monitoring",
        "ec2",
        "rds",
        "s3",
        "virtual machines",
        "load balancers",
        "cloud costs",
        "cloud spend",
        "cloud budgets",
        "rightsizing",
        "cost explorer",
        "finops",
      ],
      description: t(
        "navbar.items.cloudDescription",
        "Connect your AWS, Azure and Google Cloud accounts and monitor every resource in them.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.CLOUD_OVERVIEW] as Route,
      ),
      activeRoute: RouteMap[PageMap.CLOUD_ROOT],
      icon: IconProp.Cloud,
      iconColor: "blue",
      category: cloudCategory,
    },
    /*
     * The apps a managed app or container platform runs for you, found in
     * their own OpenTelemetry. It was Cloud's "All Environments" until the
     * two became products of their own: the platforms' names are its
     * keywords, so a search for the one you deploy to finds it. Not "app
     * runner": "runner" must find only Runbooks, where Runners are set up
     * (RunnerProductSearch).
     */
    {
      key: ProductKey.AppPlatforms,
      title: t("navbar.items.appPlatformsTitle", "App Platforms"),
      isTitleTranslated: true,
      keywords: [
        "paas",
        "platform as a service",
        "app platform",
        "ecs",
        "aws ecs",
        "fargate",
        "elastic beanstalk",
        "beanstalk",
        "cloud run",
        "app engine",
        "container apps",
        "container instances",
        "app service",
        "web apps",
        "managed containers",
      ],
      description: t(
        "navbar.items.appPlatformsDescription",
        "Monitor the apps you run on ECS and Fargate, Cloud Run, App Service and other managed platforms.",
      ),
      /*
       * Lands on the Overview; every page under /app-platforms (the
       * environments, one environment, Archived, Settings) keeps it lit.
       */
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.APP_PLATFORMS_OVERVIEW] as Route,
      ),
      activeRoute: RouteMap[PageMap.APP_PLATFORMS_ROOT],
      icon: IconProp.RocketLaunch,
      iconColor: "blue",
      category: cloudCategory,
    },
    {
      key: ProductKey.Serverless,
      title: t("navbar.items.serverlessTitle"),
      isTitleTranslated: true,
      keywords: [
        "lambda",
        "aws lambda",
        "cloud functions",
        "azure functions",
        "faas",
      ],
      description: t("navbar.items.serverlessDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SERVERLESS_FUNCTIONS] as Route,
      ),
      activeRoute: RouteMap[PageMap.SERVERLESS_FUNCTIONS],
      icon: IconProp.Bolt,
      iconColor: "blue",
      category: cloudCategory,
    },
    // Dashboards & Automation
    {
      key: ProductKey.Dashboards,
      title: t("navbar.items.dashboardsTitle"),
      isTitleTranslated: true,
      keywords: ["charts", "graphs", "widgets", "visualizations"],
      description: t("navbar.items.dashboardsDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DASHBOARDS] as Route,
      ),
      activeRoute: RouteMap[PageMap.DASHBOARDS],
      icon: IconProp.ChartPie,
      iconColor: "indigo",
      category: analyticsAutomationCategory,
    },
    {
      key: ProductKey.Workflows,
      title: t("navbar.items.workflowsTitle"),
      isTitleTranslated: true,
      keywords: ["automation", "automations", "integrations", "triggers"],
      description: t("navbar.items.workflowsDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.WORKFLOWS] as Route,
      ),
      activeRoute: RouteMap[PageMap.WORKFLOWS],
      icon: IconProp.FlowDiagram,
      iconColor: "sky",
      category: analyticsAutomationCategory,
    },
    {
      key: ProductKey.Runbooks,
      title: t("navbar.items.runbooksTitle"),
      isTitleTranslated: true,
      /*
       * "runners": Runners are set up inside Runbooks, and someone who only
       * uses one for AI code fixes has no other reason to look here.
       */
      keywords: [
        "playbooks",
        "procedures",
        "remediation",
        "response guides",
        "runners",
      ],
      description: t("navbar.items.runbooksDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.RUNBOOKS] as Route),
      activeRoute: RouteMap[PageMap.RUNBOOKS],
      icon: IconProp.BookOpen,
      iconColor: "teal",
      category: analyticsAutomationCategory,
    },
    /*
     * Forms sit with the automation products: a form turns what someone
     * outside the team fills in into an incident or a maintenance event,
     * the way a workflow turns an event into actions.
     */
    {
      key: ProductKey.Forms,
      title: t("navbar.items.formsTitle", "Forms"),
      isTitleTranslated: true,
      keywords: [
        "form",
        "form builder",
        "public form",
        "intake form",
        "request form",
        "report form",
        "incident form",
        "maintenance request",
        "change request",
        "questionnaire",
        "submissions",
      ],
      description: t(
        "navbar.items.formsDescription",
        "Forms anyone can fill in that create incidents or maintenance events.",
      ),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.FORMS] as Route),
      activeRoute: RouteMap[PageMap.FORMS],
      icon: IconProp.ClipboardDocumentList,
      iconColor: "teal",
      category: analyticsAutomationCategory,
    },
    // Settings
    {
      key: ProductKey.Users,
      title: t("navbar.items.usersTitle"),
      isTitleTranslated: true,
      keywords: ["members", "people", "teammates", "invite"],
      description: t("navbar.items.usersDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
      activeRoute: RouteMap[PageMap.USERS],
      icon: IconProp.User,
      iconColor: "blue",
      category: settingsCategory,
    },
    {
      key: ProductKey.Teams,
      title: t("navbar.items.teamsTitle"),
      isTitleTranslated: true,
      keywords: ["groups", "departments", "team members"],
      description: t("navbar.items.teamsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.TEAMS] as Route),
      activeRoute: RouteMap[PageMap.TEAMS],
      icon: IconProp.Team,
      iconColor: "emerald",
      category: settingsCategory,
    },
    {
      key: ProductKey.ProjectSettings,
      title: t("navbar.items.projectSettingsTitle"),
      isTitleTranslated: true,
      keywords: [
        "configuration",
        "config",
        "api keys",
        "billing",
        "permissions",
        "sso",
      ],
      /*
       * What Project Settings holds, by the names of its pages (#6817: the
       * channel switches are Notification Channels). A server without
       * billing has no Billing page, so it is not offered (#7474).
       */
      description: BILLING_ENABLED
        ? t("navbar.items.projectSettingsDescription")
        : t(
            "navbar.items.projectSettingsDescriptionWithoutBilling",
            "API keys, SSO, labels and notification channels.",
          ),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route),
      activeRoute: RouteMap[PageMap.SETTINGS],
      icon: IconProp.Settings,
      iconColor: "slate",
      category: settingsCategory,
    },
  ];

  /*
   * The products menu always opens with Essentials expanded, the products a
   * problem flows through (see the top of the list): the maintainer asked
   * to "always have Essentials expanded by default", in the same list as
   * the other categories. Folding them lasts until the menu closes. The
   * rest - observability, security, AI, code, resources, every
   * infrastructure platform, cloud, dashboards and automation, settings -
   * are each folded to one
   * row that names what is inside, one click or a search away. The category
   * of the page the user is on opens by itself, and what someone opens or
   * folds among those is remembered on their browser.
   */
  const moreMenuCategoriesOpenByDefault: Array<string> = [essentialsCategory];

  const moreMenuCategoriesInFixedOrder: Array<string> = [
    essentialsCategory,
    settingsCategory,
  ];

  // Define the right element (User Settings)
  const rightElement: NavItem = {
    id: "user-settings-nav-bar-item",
    title: t("navbar.userSettings"),
    isTitleTranslated: true,
    icon: IconProp.User,
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS] as Route,
    ),
    /*
     * Opens on Notification Methods, and stays lit on every page of User
     * Settings, not only that first one.
     */
    activeRoute: RouteMap[PageMap.USER_SETTINGS_ROOT],
  };

  return {
    navItems,
    moreMenuItems,
    moreMenuCategoriesOpenByDefault,
    moreMenuCategoriesInFixedOrder,
    rightElement,
  };
}

export default useDashboardNavigationItems;
