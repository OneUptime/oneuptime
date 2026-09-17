import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { NavItem, MoreMenuItem } from "Common/UI/Components/Navbar/NavBar";
import { useTranslation } from "react-i18next";

export interface DashboardNavigationItems {
  navItems: NavItem[];
  moreMenuItems: MoreMenuItem[];
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

  const essentialsCategory: string = t("navbar.categories.essentials");
  const observabilityCategory: string = t("navbar.categories.observability");
  const aiCategory: string = t("navbar.categories.ai", "AI");
  const resourcesCategory: string = t("navbar.categories.resources");
  const analyticsAutomationCategory: string = t(
    "navbar.categories.analyticsAutomation",
  );
  const settingsCategory: string = t("navbar.categories.settings");

  // Build the main navigation items - only Home now
  const navItems: NavItem[] = [
    {
      id: "home-nav-bar-item",
      title: t("navbar.home"),
      icon: IconProp.Home,
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
      activeRoute: RouteMap[PageMap.HOME],
    },
  ];

  // Build the products menu items - all products organized by category
  const moreMenuItems: MoreMenuItem[] = [
    // Essentials
    {
      title: t("navbar.items.monitorsTitle"),
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
      icon: IconProp.AltGlobe,
      iconColor: "blue",
      category: essentialsCategory,
    },
    {
      title: t("navbar.items.slosTitle", "SLOs"),
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
    {
      title: t("navbar.items.statusPagesTitle"),
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
      title: t("navbar.items.incidentsTitle"),
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
      title: t("navbar.items.alertsTitle"),
      keywords: ["notifications", "alarms", "thresholds", "warnings"],
      description: t("navbar.items.alertsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.ALERTS] as Route),
      activeRoute: RouteMap[PageMap.ALERTS],
      icon: IconProp.ExclaimationCircle,
      iconColor: "amber",
      category: essentialsCategory,
    },
    {
      title: t("navbar.items.onCallDutyTitle"),
      keywords: [
        "oncall",
        "on call",
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
      activeRoute: RouteMap[PageMap.ON_CALL_DUTY],
      icon: IconProp.Call,
      iconColor: "stone",
      category: essentialsCategory,
    },
    {
      title: t("navbar.items.scheduledMaintenanceTitle"),
      keywords: [
        "maintenance window",
        "planned downtime",
        "scheduled downtime",
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
    // Observability
    {
      title: t("navbar.items.logsTitle"),
      keywords: ["logging", "log search", "log explorer", "syslog"],
      description: t("navbar.items.logsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route),
      activeRoute: RouteMap[PageMap.LOGS],
      icon: IconProp.Logs,
      iconColor: "amber",
      category: observabilityCategory,
    },
    {
      title: t("navbar.items.metricsTitle"),
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
      title: t("navbar.items.tracesTitle"),
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
      title: t("navbar.items.performanceProfilesTitle"),
      keywords: [
        "profiling",
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
      title: t("navbar.items.exceptionsTitle"),
      keywords: ["errors", "error tracking", "bugs", "crashes", "stack traces"],
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
      title: t("navbar.items.llmObservabilityTitle", "AI / LLM"),
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
      activeRoute: RouteMap[PageMap.LLM],
      icon: IconProp.Sparkles,
      iconColor: "violet",
      category: observabilityCategory,
    },
    {
      title: t("navbar.items.securityEventsTitle", "Security Events"),
      keywords: [
        "siem",
        "security information and event management",
        "threats",
        "detections",
        "vulnerabilities",
      ],
      description: t(
        "navbar.items.securityEventsDescription",
        "SIEM signals correlated with your observability data.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_EVENTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.SECURITY_EVENTS],
      icon: IconProp.ShieldExclamation,
      iconColor: "rose",
      category: observabilityCategory,
    },
    // AI
    {
      title: t("navbar.items.aiChatTitle", "Chat"),
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
      title: t("navbar.items.aiAgentsTitle", "Tasks"),
      keywords: [
        "ai agents",
        "agent tasks",
        "automated fixes",
        "fix pull requests",
      ],
      description: t(
        "navbar.items.aiAgentsDescription",
        "Automated AI tasks — fix pull requests and their status.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.AI_AGENT_TASKS] as Route,
      ),
      activeRoute: RouteMap[PageMap.AI_AGENT_TASKS],
      icon: IconProp.CPUChip,
      iconColor: "violet",
      category: aiCategory,
    },
    {
      title: t("navbar.items.sentinelInsightsTitle", "Insights"),
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
    {
      title: t("navbar.items.codeRepositoriesTitle"),
      keywords: ["git", "github", "source code", "repos", "pull requests"],
      description: t(
        "navbar.items.codeRepositoriesDescription",
        "Connect GitHub so AI can open fix PRs.",
      ),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.CODE_REPOSITORY] as Route,
      ),
      activeRoute: RouteMap[PageMap.CODE_REPOSITORY],
      icon: IconProp.Code,
      iconColor: "violet",
      category: aiCategory,
    },
    {
      title: t("navbar.items.topologyTitle"),
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
    {
      title: t("navbar.items.inventoryTitle", "Inventory"),
      keywords: ["assets", "entities", "resource catalog", "cmdb"],
      description: t(
        "navbar.items.inventoryDescription",
        "Everything OneUptime knows about your estate, in one list.",
      ),
      // Lands on the Overview; the item list and detail pages keep it lit.
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.INVENTORY] as Route,
      ),
      activeRoute: RouteMap[PageMap.INVENTORY],
      additionalActiveRoutes: [
        RouteMap[PageMap.INVENTORY_ITEMS] as Route,
        RouteMap[PageMap.INVENTORY_VIEW] as Route,
      ],
      icon: IconProp.Cube,
      iconColor: "indigo",
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.servicesTitle"),
      keywords: [
        "apm",
        "application performance monitoring",
        "applications",
        "microservices",
        "otel",
        "opentelemetry",
      ],
      description: t("navbar.items.servicesDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SERVICES] as Route),
      activeRoute: RouteMap[PageMap.SERVICES],
      icon: IconProp.SquareStack,
      iconColor: "indigo",
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.kubernetesTitle"),
      keywords: ["k8s", "kube", "kubectl", "pods", "containers", "clusters"],
      description: t("navbar.items.kubernetesDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.KUBERNETES_CLUSTERS] as Route,
      ),
      activeRoute: RouteMap[PageMap.KUBERNETES_CLUSTERS],
      icon: IconProp.Kubernetes,
      iconColor: "blue",
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.dockerTitle"),
      keywords: ["containers", "container monitoring", "docker hosts"],
      description: t("navbar.items.dockerDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.DOCKER_HOSTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.DOCKER_HOSTS],
      icon: IconProp.Docker,
      iconColor: "blue",
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.networkTitle", "Network"),
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
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.podmanTitle"),
      keywords: ["containers", "container monitoring", "rootless containers"],
      description: t("navbar.items.podmanDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.PODMAN_HOSTS] as Route,
      ),
      activeRoute: RouteMap[PageMap.PODMAN_HOSTS],
      icon: IconProp.Podman,
      iconColor: "blue",
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.proxmoxTitle", "Proxmox"),
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
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.vmwareTitle", "VMware"),
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
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.iotTitle", "IoT"),
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
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.cephTitle", "Ceph"),
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
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.dockerSwarmTitle", "Docker Swarm"),
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
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.hostsTitle"),
      keywords: ["servers", "machines", "infrastructure", "linux", "windows"],
      description: t("navbar.items.hostsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.HOSTS] as Route),
      activeRoute: RouteMap[PageMap.HOSTS],
      icon: IconProp.Server,
      iconColor: "slate",
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.serverlessTitle"),
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
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.cloudTitle"),
      keywords: [
        "aws",
        "amazon web services",
        "azure",
        "gcp",
        "google cloud",
        "cloud resources",
      ],
      description: t("navbar.items.cloudDescription"),
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.CLOUD_RESOURCES] as Route,
      ),
      activeRoute: RouteMap[PageMap.CLOUD_RESOURCES],
      icon: IconProp.Cloud,
      iconColor: "blue",
      category: resourcesCategory,
    },
    {
      title: t("navbar.items.rumTitle"),
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
    // Automation & Analytics
    {
      title: t("navbar.items.dashboardsTitle"),
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
      title: t("navbar.items.workflowsTitle"),
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
      title: t("navbar.items.runbooksTitle"),
      keywords: ["playbooks", "procedures", "remediation", "response guides"],
      description: t("navbar.items.runbooksDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.RUNBOOKS] as Route),
      activeRoute: RouteMap[PageMap.RUNBOOKS],
      icon: IconProp.BookOpen,
      iconColor: "teal",
      category: analyticsAutomationCategory,
    },
    // Settings
    {
      title: t("navbar.items.usersTitle"),
      keywords: ["members", "people", "teammates", "invite"],
      description: t("navbar.items.usersDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
      activeRoute: RouteMap[PageMap.USERS],
      icon: IconProp.User,
      iconColor: "blue",
      category: settingsCategory,
    },
    {
      title: t("navbar.items.teamsTitle"),
      keywords: ["groups", "departments", "team members"],
      description: t("navbar.items.teamsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.TEAMS] as Route),
      activeRoute: RouteMap[PageMap.TEAMS],
      icon: IconProp.Team,
      iconColor: "emerald",
      category: settingsCategory,
    },
    {
      title: t("navbar.items.projectSettingsTitle"),
      keywords: [
        "configuration",
        "config",
        "api keys",
        "billing",
        "permissions",
        "sso",
      ],
      description: t("navbar.items.projectSettingsDescription"),
      route: RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route),
      activeRoute: RouteMap[PageMap.SETTINGS],
      icon: IconProp.Settings,
      iconColor: "slate",
      category: settingsCategory,
    },
  ];

  // Define the right element (User Settings)
  const rightElement: NavItem = {
    id: "user-settings-nav-bar-item",
    title: t("navbar.userSettings"),
    icon: IconProp.User,
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS] as Route,
    ),
    activeRoute: RouteMap[PageMap.USER_SETTINGS],
  };

  return { navItems, moreMenuItems, rightElement };
}

export default useDashboardNavigationItems;
