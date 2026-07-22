/*
 * SNAPSHOT FIXTURE — generated from the Dashboard app's RouteMap and breadcrumb
 * definitions (every getUserSettings/getMonitor/... breadcrumb trail). Used by
 * BreadcrumbTrailResolver.test.ts to verify the resolver against the real-world
 * route table. Regenerate if the route table changes meaningfully; the
 * resolver's own unit tests do not depend on this snapshot.
 */

export interface BreadcrumbTrailFixture {
  getter: string;
  pagePattern: string;
  titles: Array<string>;
}

const realBreadcrumbTrails: Array<BreadcrumbTrailFixture> = [
  {
    getter: "getAIAgentTasksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ai/agents",
    titles: ["Project", "AI Tasks"],
  },
  {
    getter: "getAIAgentTasksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ai/agents/:id",
    titles: ["Project", "AI Tasks", "View Task"],
  },
  {
    getter: "getAIAgentTasksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ai/agents/:id/delete",
    titles: ["Project", "AI Tasks", "View Task", "Delete Task"],
  },
  {
    getter: "getAIAgentTasksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ai/agents/:id/logs",
    titles: ["Project", "AI Tasks", "View Task", "Logs"],
  },
  {
    getter: "getAIAgentTasksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ai/agents/:id/pull-requests",
    titles: ["Project", "AI Tasks", "View Task", "Pull Requests"],
  },
  {
    getter: "getAIInsightsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ai/insights",
    titles: ["Project", "Insights"],
  },
  {
    getter: "getAIInsightsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ai/insights/:id",
    titles: ["Project", "Insights", "View Insight"],
  },
  {
    getter: "getAIInsightsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ai/insights/settings",
    titles: ["Project", "Insights", "Settings"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts",
    titles: ["Project", "Alerts"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/:id",
    titles: ["Project", "Alerts", "View Alert"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/:id/custom-fields",
    titles: ["Project", "Alerts", "View Alert", "Custom Fields"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/:id/delete",
    titles: ["Project", "Alerts", "View Alert", "Delete Alert"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/:id/description",
    titles: ["Project", "Alerts", "Description"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/:id/internal-notes",
    titles: ["Project", "Alerts", "View Alert", "Private Notes"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/alerts/:id/on-call-policy-execution-logs",
    titles: ["Project", "Alerts", "View Alert", "On Call Executions"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/:id/owners",
    titles: ["Project", "Alerts", "View Alert", "Owners"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/:id/remediation",
    titles: ["Project", "Alerts", "View Alert", "Remediation"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/:id/root-cause",
    titles: ["Project", "Alerts", "View Alert", "Root Cause"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/:id/state-timeline",
    titles: ["Project", "Alerts", "View Alert", "State Timeline"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/episodes",
    titles: ["Project", "Alerts", "Episodes"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/episodes/:id",
    titles: ["Project", "Alerts", "Episodes", "View Episode"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/episodes/:id/alerts",
    titles: ["Project", "Alerts", "Episodes", "View Episode", "Alerts"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/episodes/:id/delete",
    titles: ["Project", "Alerts", "Episodes", "View Episode", "Delete Episode"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/episodes/:id/description",
    titles: ["Project", "Alerts", "Episodes", "View Episode", "Description"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/episodes/:id/internal-notes",
    titles: ["Project", "Alerts", "Episodes", "View Episode", "Private Notes"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/episodes/:id/owners",
    titles: ["Project", "Alerts", "Episodes", "View Episode", "Owners"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/episodes/:id/root-cause",
    titles: ["Project", "Alerts", "Episodes", "View Episode", "Root Cause"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/episodes/:id/state-timeline",
    titles: ["Project", "Alerts", "Episodes", "View Episode", "State Timeline"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/episodes/documentation",
    titles: ["Project", "Alerts", "Episodes", "Documentation"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/episodes/unresolved",
    titles: ["Project", "Alerts", "Active Episodes"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/settings/custom-fields",
    titles: ["Project", "Alerts", "Settings", "Custom Fields"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/settings/grouping-rules",
    titles: ["Project", "Alerts", "Settings", "Grouping Rules"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/settings/note-templates",
    titles: ["Project", "Alerts", "Settings", "Note Templates"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/settings/note-templates/:id",
    titles: [
      "Project",
      "Alerts",
      "Settings",
      "Note Templates",
      "View Template",
    ],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/settings/severity",
    titles: ["Project", "Alerts", "Settings", "Alert Severity"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/settings/state",
    titles: ["Project", "Alerts", "Settings", "Alert State"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/unresolved",
    titles: ["Project", "Alerts", "Active Alerts"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/alerts/workspace-connection-microsoft-teams",
    titles: ["Project", "Alerts", "Microsoft Teams Connection"],
  },
  {
    getter: "getAlertsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/alerts/workspace-connection-slack",
    titles: ["Project", "Alerts", "Slack Connection"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph",
    titles: ["Project", "Ceph", "Clusters"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id",
    titles: ["Project", "Ceph", "View Cluster"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/alerts",
    titles: ["Project", "Ceph", "View Cluster", "Alerts"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/audit-logs",
    titles: ["Project", "Ceph", "View Cluster", "Audit Logs"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/cluster-log",
    titles: ["Project", "Ceph", "View Cluster", "Cluster Log"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/daemons",
    titles: ["Project", "Ceph", "View Cluster", "Daemons"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/delete",
    titles: ["Project", "Ceph", "View Cluster", "Delete Cluster"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/documentation",
    titles: ["Project", "Ceph", "View Cluster", "Documentation"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/incidents",
    titles: ["Project", "Ceph", "View Cluster", "Incidents"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/insights",
    titles: ["Project", "Ceph", "View Cluster", "Insights"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/logs",
    titles: ["Project", "Ceph", "View Cluster", "Logs"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/metrics",
    titles: ["Project", "Ceph", "View Cluster", "Metrics"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/osds",
    titles: ["Project", "Ceph", "View Cluster", "OSDs"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/osds/:subModelId",
    titles: ["Project", "Ceph", "View Cluster", "OSDs", "OSD Detail"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/owners",
    titles: ["Project", "Ceph", "View Cluster", "Owners"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/pools",
    titles: ["Project", "Ceph", "View Cluster", "Pools"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/pools/:subModelId",
    titles: ["Project", "Ceph", "View Cluster", "Pools", "Pool Detail"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/scheduled-maintenance",
    titles: ["Project", "Ceph", "View Cluster", "Scheduled Maintenance"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/:id/settings",
    titles: ["Project", "Ceph", "View Cluster", "Settings"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/documentation",
    titles: ["Project", "Ceph", "Documentation"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/settings/label-rules",
    titles: ["Project", "Ceph", "Settings", "Label Rules"],
  },
  {
    getter: "getCephBreadcrumbs",
    pagePattern: "/dashboard/:projectId/ceph/settings/owner-rules",
    titles: ["Project", "Ceph", "Settings", "Owner Rules"],
  },
  {
    getter: "getCloudBreadcrumbs",
    pagePattern: "/dashboard/:projectId/cloud",
    titles: ["Project", "Cloud"],
  },
  {
    getter: "getCloudBreadcrumbs",
    pagePattern: "/dashboard/:projectId/cloud/:id",
    titles: ["Project", "Cloud", "View Resource"],
  },
  {
    getter: "getCloudBreadcrumbs",
    pagePattern: "/dashboard/:projectId/cloud/:id/delete",
    titles: ["Project", "Cloud", "View Resource", "Delete Resource"],
  },
  {
    getter: "getCloudBreadcrumbs",
    pagePattern: "/dashboard/:projectId/cloud/:id/documentation",
    titles: ["Project", "Cloud", "View Resource", "Documentation"],
  },
  {
    getter: "getCloudBreadcrumbs",
    pagePattern: "/dashboard/:projectId/cloud/:id/logs",
    titles: ["Project", "Cloud", "View Resource", "Logs"],
  },
  {
    getter: "getCloudBreadcrumbs",
    pagePattern: "/dashboard/:projectId/cloud/:id/metrics",
    titles: ["Project", "Cloud", "View Resource", "Metrics"],
  },
  {
    getter: "getCloudBreadcrumbs",
    pagePattern: "/dashboard/:projectId/cloud/:id/traces",
    titles: ["Project", "Cloud", "View Resource", "Traces"],
  },
  {
    getter: "getCodeRepositoryBreadcrumbs",
    pagePattern: "/dashboard/:projectId/code-repository",
    titles: ["Project", "Code Repositories"],
  },
  {
    getter: "getCodeRepositoryBreadcrumbs",
    pagePattern: "/dashboard/:projectId/code-repository/:id",
    titles: ["Project", "Code Repositories", "View Repository"],
  },
  {
    getter: "getCodeRepositoryBreadcrumbs",
    pagePattern: "/dashboard/:projectId/code-repository/:id/delete",
    titles: [
      "Project",
      "Code Repositories",
      "View Repository",
      "Delete Repository",
    ],
  },
  {
    getter: "getCodeRepositoryBreadcrumbs",
    pagePattern: "/dashboard/:projectId/code-repository/:id/settings",
    titles: ["Project", "Code Repositories", "View Repository", "Settings"],
  },
  {
    getter: "getDashboardBreadcrumbs",
    pagePattern: "/dashboard/:projectId/dashboards",
    titles: ["Project", "Dashboards"],
  },
  {
    getter: "getDashboardBreadcrumbs",
    pagePattern: "/dashboard/:projectId/dashboards/:id",
    titles: ["Project", "Dashboards", "View Dashboard"],
  },
  {
    getter: "getDashboardBreadcrumbs",
    pagePattern: "/dashboard/:projectId/dashboards/:id/branding",
    titles: ["Project", "Dashboards", "View Dashboard", "Branding"],
  },
  {
    getter: "getDashboardBreadcrumbs",
    pagePattern: "/dashboard/:projectId/dashboards/:id/delete",
    titles: ["Project", "Dashboards", "View Dashboard", "Delete Dashboard"],
  },
  {
    getter: "getDashboardBreadcrumbs",
    pagePattern: "/dashboard/:projectId/dashboards/:id/overview",
    titles: ["Project", "Dashboards", "View Dashboard", "Overview"],
  },
  {
    getter: "getDashboardBreadcrumbs",
    pagePattern: "/dashboard/:projectId/dashboards/:id/owners",
    titles: ["Project", "Dashboards", "View Dashboard", "Owners"],
  },
  {
    getter: "getDashboardBreadcrumbs",
    pagePattern: "/dashboard/:projectId/dashboards/:id/settings",
    titles: ["Project", "Dashboards", "View Dashboard", "Settings"],
  },
  {
    getter: "getDashboardBreadcrumbs",
    pagePattern: "/dashboard/:projectId/dashboards/settings/label-rules",
    titles: ["Project", "Dashboards", "Settings", "Label Rules"],
  },
  {
    getter: "getDashboardBreadcrumbs",
    pagePattern: "/dashboard/:projectId/dashboards/settings/owner-rules",
    titles: ["Project", "Dashboards", "Settings", "Owner Rules"],
  },
  {
    getter: "getDockerBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker",
    titles: ["Project", "Docker", "Hosts"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm",
    titles: ["Project", "DockerSwarm", "Clusters"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id",
    titles: ["Project", "DockerSwarm", "View Cluster"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/alerts",
    titles: ["Project", "DockerSwarm", "View Cluster", "Alerts"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/audit-logs",
    titles: ["Project", "DockerSwarm", "View Cluster", "Audit Logs"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/configs",
    titles: ["Project", "Docker Swarm", "View Cluster", "Configs"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/delete",
    titles: ["Project", "DockerSwarm", "View Cluster", "Delete Cluster"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/documentation",
    titles: ["Project", "DockerSwarm", "View Cluster", "Documentation"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/incidents",
    titles: ["Project", "DockerSwarm", "View Cluster", "Incidents"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/insights",
    titles: ["Project", "DockerSwarm", "View Cluster", "Insights"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/logs",
    titles: ["Project", "DockerSwarm", "View Cluster", "Logs"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/metrics",
    titles: ["Project", "DockerSwarm", "View Cluster", "Metrics"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/networks",
    titles: ["Project", "Docker Swarm", "View Cluster", "Networks"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/nodes",
    titles: ["Project", "DockerSwarm", "View Cluster", "Nodes"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/nodes/:subModelId",
    titles: ["Project", "DockerSwarm", "View Cluster", "Nodes", "Node Detail"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/owners",
    titles: ["Project", "DockerSwarm", "View Cluster", "Owners"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/scheduled-maintenance",
    titles: ["Project", "DockerSwarm", "View Cluster", "Scheduled Maintenance"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/secrets",
    titles: ["Project", "Docker Swarm", "View Cluster", "Secrets"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/services",
    titles: ["Project", "Docker Swarm", "View Cluster", "Services"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/services/:subModelId",
    titles: [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Services",
      "Service Detail",
    ],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/settings",
    titles: ["Project", "DockerSwarm", "View Cluster", "Settings"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/stacks",
    titles: ["Project", "Docker Swarm", "View Cluster", "Stacks"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/tasks",
    titles: ["Project", "Docker Swarm", "View Cluster", "Tasks"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/tasks/:subModelId",
    titles: ["Project", "Docker Swarm", "View Cluster", "Tasks", "Task Detail"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/:id/volumes",
    titles: ["Project", "Docker Swarm", "View Cluster", "Volumes"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/documentation",
    titles: ["Project", "DockerSwarm", "Documentation"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/settings/label-rules",
    titles: ["Project", "DockerSwarm", "Settings", "Label Rules"],
  },
  {
    getter: "getDockerSwarmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker-swarm/settings/owner-rules",
    titles: ["Project", "DockerSwarm", "Settings", "Owner Rules"],
  },
  {
    getter: "getDockerBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker/:id",
    titles: ["Project", "Docker", "View Host"],
  },
  {
    getter: "getDockerBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker/:id/alerts",
    titles: ["Project", "Docker", "View Host", "Alerts"],
  },
  {
    getter: "getDockerBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker/:id/containers",
    titles: ["Project", "Docker", "View Host", "Containers"],
  },
  {
    getter: "getDockerBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker/:id/delete",
    titles: ["Project", "Docker", "View Host", "Delete Host"],
  },
  {
    getter: "getDockerBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker/:id/documentation",
    titles: ["Project", "Docker", "View Host", "Documentation"],
  },
  {
    getter: "getDockerBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker/:id/incidents",
    titles: ["Project", "Docker", "View Host", "Incidents"],
  },
  {
    getter: "getDockerBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker/:id/logs",
    titles: ["Project", "Docker", "View Host", "Logs"],
  },
  {
    getter: "getDockerBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker/:id/settings",
    titles: ["Project", "Docker", "View Host", "Settings"],
  },
  {
    getter: "getDockerBreadcrumbs",
    pagePattern: "/dashboard/:projectId/docker/documentation",
    titles: ["Project", "Docker", "Documentation"],
  },
  {
    getter: "getExceptionsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/exceptions/:id",
    titles: ["Project", "Exceptions", "Exception Details"],
  },
  {
    getter: "getExceptionsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/exceptions/archived",
    titles: ["Project", "Exceptions", "Archived"],
  },
  {
    getter: "getExceptionsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/exceptions/documentation",
    titles: ["Project", "Exceptions", "Setup Guide"],
  },
  {
    getter: "getExceptionsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/exceptions/overview",
    titles: ["Project", "Exceptions", "Overview"],
  },
  {
    getter: "getExceptionsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/exceptions/resolved",
    titles: ["Project", "Exceptions", "Resolved"],
  },
  {
    getter: "getExceptionsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/exceptions/unresolved",
    titles: ["Project", "Exceptions", "Unresolved"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host",
    titles: ["Project", "Hosts"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id",
    titles: ["Project", "Hosts", "View Host"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/alerts",
    titles: ["Project", "Hosts", "View Host", "Alerts"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/delete",
    titles: ["Project", "Hosts", "View Host", "Delete Host"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/documentation",
    titles: ["Project", "Hosts", "View Host", "Documentation"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/incidents",
    titles: ["Project", "Hosts", "View Host", "Incidents"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/logs",
    titles: ["Project", "Hosts", "View Host", "Logs"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/metrics",
    titles: ["Project", "Hosts", "View Host", "Metrics"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/owners",
    titles: ["Project", "Hosts", "View Host", "Owners"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/processes",
    titles: ["Project", "Hosts", "View Host", "Processes"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/processes/:subModelId",
    titles: ["Project", "Hosts", "View Host", "Processes", "View Process"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/services",
    titles: ["Project", "Hosts", "View Host", "Services"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/services/:subModelId",
    titles: ["Project", "Hosts", "View Host", "Services", "View Service"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/:id/settings",
    titles: ["Project", "Hosts", "View Host", "Settings"],
  },
  {
    getter: "getHostBreadcrumbs",
    pagePattern: "/dashboard/:projectId/host/documentation",
    titles: ["Project", "Hosts", "Documentation"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents",
    titles: ["Project", "Incidents"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id",
    titles: ["Project", "Incidents", "View Incident"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id/custom-fields",
    titles: ["Project", "Incidents", "View Incident", "Custom Fields"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id/delete",
    titles: ["Project", "Incidents", "View Incident", "Delete Incident"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id/description",
    titles: ["Project", "Incidents", "View Incident", "Description"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id/internal-notes",
    titles: ["Project", "Incidents", "View Incident", "Private Notes"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/incidents/:id/on-call-policy-execution-logs",
    titles: ["Project", "Incidents", "View Incident", "On Call Executions"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id/owners",
    titles: ["Project", "Incidents", "View Incident", "Owners"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id/postmortem",
    titles: ["Project", "Incidents", "View Incident", "Postmortem"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id/public-notes",
    titles: ["Project", "Incidents", "View Incident", "Public Notes"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id/remediation",
    titles: ["Project", "Incidents", "View Incident", "Remediation"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id/root-cause",
    titles: ["Project", "Incidents", "View Incident", "Root Cause"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id/settings",
    titles: ["Project", "Incidents", "View Incident", "Settings"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/:id/state-timeline",
    titles: ["Project", "Incidents", "View Incident", "State Timeline"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/create",
    titles: ["Project", "Incidents", "Declare New Incident"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/settings/custom-fields",
    titles: ["Project", "Incidents", "Settings", "Custom Fields"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/settings/note-templates",
    titles: ["Project", "Incidents", "Settings", "Note Templates"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/settings/note-templates/:id",
    titles: [
      "Project",
      "Incidents",
      "Settings",
      "Note Templates",
      "View Template",
    ],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/incidents/settings/postmortem-templates",
    titles: ["Project", "Incidents", "Settings", "Postmortem Templates"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/incidents/settings/postmortem-templates/:id",
    titles: [
      "Project",
      "Incidents",
      "Settings",
      "Postmortem Templates",
      "View Template",
    ],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/settings/severity",
    titles: ["Project", "Incidents", "Settings", "Incident Severity"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/settings/state",
    titles: ["Project", "Incidents", "Settings", "Incident State"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/settings/templates",
    titles: ["Project", "Incidents", "Settings", "Incident Templates"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/settings/templates/:id",
    titles: [
      "Project",
      "Incidents",
      "Settings",
      "Incident Templates",
      "View Template",
    ],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/unresolved",
    titles: ["Project", "Incidents", "Active Incidents"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/incidents/workspace-connection-microsoft-teams",
    titles: ["Project", "Incidents", "Workspace Microsoft Teams Connection"],
  },
  {
    getter: "getIncidentsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/incidents/workspace-connection-slack",
    titles: ["Project", "Incidents", "Workspace Slack Connection"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot",
    titles: ["Project", "IoT", "Fleets"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id",
    titles: ["Project", "IoT", "View Fleet"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/alerts",
    titles: ["Project", "IoT", "View Fleet", "Alerts"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/audit-logs",
    titles: ["Project", "IoT", "View Fleet", "Audit Logs"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/delete",
    titles: ["Project", "IoT", "View Fleet", "Delete Fleet"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/device-registry",
    titles: ["Project", "IoT", "View Fleet", "Device Registry"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/devices",
    titles: ["Project", "IoT", "View Fleet", "Devices"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/devices/:subModelId",
    titles: ["Project", "IoT", "View Fleet", "Devices", "Device Detail"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/documentation",
    titles: ["Project", "IoT", "View Fleet", "Documentation"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/incidents",
    titles: ["Project", "IoT", "View Fleet", "Incidents"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/logs",
    titles: ["Project", "IoT", "View Fleet", "Logs"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/metrics",
    titles: ["Project", "IoT", "View Fleet", "Metrics"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/owners",
    titles: ["Project", "IoT", "View Fleet", "Owners"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/scheduled-maintenance",
    titles: ["Project", "IoT", "View Fleet", "Scheduled Maintenance"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/:id/settings",
    titles: ["Project", "IoT", "View Fleet", "Settings"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/documentation",
    titles: ["Project", "IoT", "Documentation"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/settings/label-rules",
    titles: ["Project", "IoT", "Settings", "Label Rules"],
  },
  {
    getter: "getIoTBreadcrumbs",
    pagePattern: "/dashboard/:projectId/iot/settings/owner-rules",
    titles: ["Project", "IoT", "Settings", "Owner Rules"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes",
    titles: ["Project", "Kubernetes", "Clusters"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id",
    titles: ["Project", "Kubernetes", "View Cluster"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/alerts",
    titles: ["Project", "Kubernetes", "View Cluster", "Alerts"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/containers",
    titles: ["Project", "Kubernetes", "View Cluster", "Containers"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/containers/:subModelId",
    titles: [
      "Project",
      "Kubernetes",
      "View Cluster",
      "Containers",
      "Container Detail",
    ],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/control-plane",
    titles: ["Project", "Kubernetes", "View Cluster", "Control Plane"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/cronjobs",
    titles: ["Project", "Kubernetes", "View Cluster", "CronJobs"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/cronjobs/:subModelId",
    titles: [
      "Project",
      "Kubernetes",
      "View Cluster",
      "CronJobs",
      "CronJob Detail",
    ],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/daemonsets",
    titles: ["Project", "Kubernetes", "View Cluster", "DaemonSets"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/daemonsets/:subModelId",
    titles: [
      "Project",
      "Kubernetes",
      "View Cluster",
      "DaemonSets",
      "DaemonSet Detail",
    ],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/delete",
    titles: ["Project", "Kubernetes", "View Cluster", "Delete Cluster"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/deployments",
    titles: ["Project", "Kubernetes", "View Cluster", "Deployments"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/deployments/:subModelId",
    titles: [
      "Project",
      "Kubernetes",
      "View Cluster",
      "Deployments",
      "Deployment Detail",
    ],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/documentation",
    titles: ["Project", "Kubernetes", "View Cluster", "Documentation"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/events",
    titles: ["Project", "Kubernetes", "View Cluster", "Events"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/hpas",
    titles: ["Project", "Kubernetes", "View Cluster", "HPAs"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/hpas/:subModelId",
    titles: ["Project", "Kubernetes", "View Cluster", "HPAs", "HPA Detail"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/incidents",
    titles: ["Project", "Kubernetes", "View Cluster", "Incidents"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/jobs",
    titles: ["Project", "Kubernetes", "View Cluster", "Jobs"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/jobs/:subModelId",
    titles: ["Project", "Kubernetes", "View Cluster", "Jobs", "Job Detail"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/namespaces",
    titles: ["Project", "Kubernetes", "View Cluster", "Namespaces"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/namespaces/:subModelId",
    titles: [
      "Project",
      "Kubernetes",
      "View Cluster",
      "Namespaces",
      "Namespace Detail",
    ],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/nodes",
    titles: ["Project", "Kubernetes", "View Cluster", "Nodes"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/nodes/:subModelId",
    titles: ["Project", "Kubernetes", "View Cluster", "Nodes", "Node Detail"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/pods",
    titles: ["Project", "Kubernetes", "View Cluster", "Pods"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/pods/:subModelId",
    titles: ["Project", "Kubernetes", "View Cluster", "Pods", "Pod Detail"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/service-mesh",
    titles: ["Project", "Kubernetes", "View Cluster", "Service Mesh"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/settings",
    titles: ["Project", "Kubernetes", "View Cluster", "Settings"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/statefulsets",
    titles: ["Project", "Kubernetes", "View Cluster", "StatefulSets"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/kubernetes/:id/statefulsets/:subModelId",
    titles: [
      "Project",
      "Kubernetes",
      "View Cluster",
      "StatefulSets",
      "StatefulSet Detail",
    ],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/vpas",
    titles: ["Project", "Kubernetes", "View Cluster", "VPAs"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/:id/vpas/:subModelId",
    titles: ["Project", "Kubernetes", "View Cluster", "VPAs", "VPA Detail"],
  },
  {
    getter: "getKubernetesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/kubernetes/documentation",
    titles: ["Project", "Kubernetes", "Documentation"],
  },
  {
    getter: "getLlmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/llm/calls",
    titles: ["Project", "AI / LLM", "LLM Calls"],
  },
  {
    getter: "getLlmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/llm/documentation",
    titles: ["Project", "AI / LLM", "Setup Guide"],
  },
  {
    getter: "getLlmBreadcrumbs",
    pagePattern: "/dashboard/:projectId/llm/overview",
    titles: ["Project", "AI / LLM", "Overview"],
  },
  {
    getter: "getLogsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/logs",
    titles: ["Project", "Logs"],
  },
  {
    getter: "getLogsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/logs/documentation",
    titles: ["Project", "Logs", "Setup Guide"],
  },
  {
    getter: "getLogsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/logs/insights",
    titles: ["Project", "Logs", "Insights"],
  },
  {
    getter: "getLogsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/logs/settings/drop-filters",
    titles: ["Project", "Logs", "Settings", "Drop Filters"],
  },
  {
    getter: "getLogsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/logs/settings/drop-filters/:id",
    titles: ["Project", "Logs", "Settings", "Drop Filters", "View"],
  },
  {
    getter: "getLogsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/logs/settings/pipelines",
    titles: ["Project", "Logs", "Settings", "Pipelines"],
  },
  {
    getter: "getLogsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/logs/settings/pipelines/:id",
    titles: ["Project", "Logs", "Settings", "Pipelines", "View"],
  },
  {
    getter: "getLogsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/logs/settings/scrub-rules",
    titles: ["Project", "Logs", "Settings", "Scrub Rules"],
  },
  {
    getter: "getMetricsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/metrics",
    titles: ["Project", "Metrics"],
  },
  {
    getter: "getMetricsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/metrics/documentation",
    titles: ["Project", "Metrics", "Setup Guide"],
  },
  {
    getter: "getMetricsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/metrics/insights",
    titles: ["Project", "Metrics", "Insights"],
  },
  {
    getter: "getMetricsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/metrics/settings/pipeline-rules",
    titles: ["Project", "Metrics", "Settings", "Pipeline Rules"],
  },
  {
    getter: "getMetricsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/metrics/settings/recording-rules",
    titles: ["Project", "Metrics", "Settings", "Recording Rules"],
  },
  {
    getter: "getMetricsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/metrics/view",
    titles: ["Project", "Metrics", "Metric Explorer"],
  },
  {
    getter: "getMonitorGroupBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitor-groups/:id",
    titles: ["Project", "Monitor Groups", "View Monitor Group"],
  },
  {
    getter: "getMonitorGroupBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitor-groups/:id/delete",
    titles: [
      "Project",
      "Monitor Groups",
      "View Monitor Group",
      "Delete Monitor Group",
    ],
  },
  {
    getter: "getMonitorGroupBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitor-groups/:id/incidents",
    titles: ["Project", "Monitor Groups", "View Monitor Group", "Incidents"],
  },
  {
    getter: "getMonitorGroupBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitor-groups/:id/monitors",
    titles: ["Project", "Monitor Groups", "View Monitor Group", "Monitors"],
  },
  {
    getter: "getMonitorGroupBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitor-groups/:id/owners",
    titles: ["Project", "Monitor Groups", "View Monitor Group", "Owners"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors",
    titles: ["Project", "Monitors"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id",
    titles: ["Project", "Monitors", "View Monitor"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/criteria",
    titles: ["Project", "Monitors", "View Monitor", "Criteria"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/custom-fields",
    titles: ["Project", "Monitors", "View Monitor", "Custom Fields"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/delete",
    titles: ["Project", "Monitors", "View Monitor", "Delete Monitor"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/incidents",
    titles: ["Project", "Monitors", "View Monitor", "Incidents"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/interval",
    titles: ["Project", "Monitors", "View Monitor", "Interval"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/logs",
    titles: ["Project", "Monitors", "View Monitor", "Monitoring Logs"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/metrics",
    titles: ["Project", "Monitors", "View Monitor", "Metrics"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/notification-logs",
    titles: ["Project", "Monitors", "View Monitor", "Notification Logs"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/owners",
    titles: ["Project", "Monitors", "View Monitor", "Owners"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/probes",
    titles: ["Project", "Monitors", "View Monitor", "Probes"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/settings",
    titles: ["Project", "Monitors", "View Monitor", "Settings"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/:id/status-timeline",
    titles: ["Project", "Monitors", "View Monitor", "Status Timeline"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/create",
    titles: ["Project", "Monitors", "Create New Monitor"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/disabled",
    titles: ["Project", "Monitors", "Disabled"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/inoperational",
    titles: ["Project", "Monitors", "Inoperational"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/settings/custom-fields",
    titles: ["Project", "Monitors", "Settings", "Custom Fields"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/settings/probes",
    titles: ["Project", "Monitors", "Settings", "Probes"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/settings/probes/:id",
    titles: ["Project", "Monitors", "Settings", "Probes", "View Probe"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/settings/secrets",
    titles: ["Project", "Monitors", "Settings", "Secrets"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/settings/status",
    titles: ["Project", "Monitors", "Settings", "Monitor Status"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/monitors/workspace-connection-microsoft-teams",
    titles: ["Project", "Monitors", "Microsoft Teams"],
  },
  {
    getter: "getMonitorBreadcrumbs",
    pagePattern: "/dashboard/:projectId/monitors/workspace-connection-slack",
    titles: ["Project", "Monitors", "Slack"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/execution-logs",
    titles: ["Project", "On-Call Duty", "Execution Logs"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/execution-logs/:id",
    titles: ["Project", "On-Call Duty", "Execution Logs", "Timeline"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/incoming-call-policies",
    titles: ["Project", "On-Call Duty", "Incoming Call Policies"],
  },
  {
    getter: "getIncomingCallPolicyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id",
    titles: [
      "Project",
      "On-Call Duty",
      "Incoming Call Policies",
      "View Policy",
    ],
  },
  {
    getter: "getIncomingCallPolicyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id/delete",
    titles: [
      "Project",
      "On-Call Duty",
      "Incoming Call Policies",
      "View Policy",
      "Delete",
    ],
  },
  {
    getter: "getIncomingCallPolicyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id/docs",
    titles: [
      "Project",
      "On-Call Duty",
      "Incoming Call Policies",
      "View Policy",
      "Documentation",
    ],
  },
  {
    getter: "getIncomingCallPolicyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id/escalation",
    titles: [
      "Project",
      "On-Call Duty",
      "Incoming Call Policies",
      "View Policy",
      "Escalation Rules",
    ],
  },
  {
    getter: "getIncomingCallPolicyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id/logs",
    titles: [
      "Project",
      "On-Call Duty",
      "Incoming Call Policies",
      "View Policy",
      "Call Logs",
    ],
  },
  {
    getter: "getIncomingCallPolicyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id/logs/:subModelId",
    titles: [
      "Project",
      "On-Call Duty",
      "Incoming Call Policies",
      "View Policy",
      "Call Logs",
      "View Timeline",
    ],
  },
  {
    getter: "getIncomingCallPolicyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id/owners",
    titles: [
      "Project",
      "On-Call Duty",
      "Incoming Call Policies",
      "View Policy",
      "Owners",
    ],
  },
  {
    getter: "getIncomingCallPolicyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/incoming-call-policies/:id/settings",
    titles: [
      "Project",
      "On-Call Duty",
      "Incoming Call Policies",
      "View Policy",
      "Settings",
    ],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/policies",
    titles: ["Project", "On-Call Duty", "Policies"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/policies/:id",
    titles: ["Project", "On-Call Duty", "View On-Call Policy"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/policies/:id/custom-fields",
    titles: ["Project", "On-Call Duty", "View On-Call Policy", "Custom Fields"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/policies/:id/delete",
    titles: [
      "Project",
      "On-Call Duty",
      "View On-Call Policy",
      "Delete On-Call Policy",
    ],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/policies/:id/escalation",
    titles: [
      "Project",
      "On-Call Duty",
      "View On-Call Policy",
      "Escalation Rules",
    ],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/policies/:id/execution-logs",
    titles: ["Project", "On-Call Duty", "View On-Call Policy", "Logs"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/policies/:id/execution-logs/:subModelId",
    titles: ["Project", "On-Call Duty", "View On-Call Policy", "Timeline"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/policies/:id/owners",
    titles: ["Project", "On-Call Duty", "View On-Call Policy", "Owners"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/policies/:id/user-overrides",
    titles: [
      "Project",
      "On-Call Duty",
      "View On-Call Policy",
      "User Overrides",
    ],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/schedules",
    titles: ["Project", "On-Call Duty", "Schedules"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/schedules/:id",
    titles: ["Project", "On-Call Duty", "View On-Call Schedule"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/schedules/:id/delete",
    titles: [
      "Project",
      "On-Call Duty",
      "View On-Call Schedule",
      "Delete On-Call Schedule",
    ],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/schedules/:id/layers",
    titles: ["Project", "On-Call Duty", "View On-Call Schedule", "Layers"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/schedules/:id/owners",
    titles: ["Project", "On-Call Duty", "View On-Call Schedule", "Owners"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/schedules/:id/settings",
    titles: ["Project", "On-Call Duty", "View On-Call Schedule", "Settings"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/settings/custom-fields",
    titles: ["Project", "On-Call Duty", "Settings", "Custom Fields"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/settings/label-rules",
    titles: ["Project", "On-Call Duty", "Settings", "Label Rules"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/settings/owner-rules",
    titles: ["Project", "On-Call Duty", "Settings", "Owner Rules"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/user-overrides",
    titles: ["Project", "On-Call Duty", "User Overrides"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern: "/dashboard/:projectId/on-call-duty/user-time-logs",
    titles: ["Project", "On-Call Duty", "User Time Logs"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/workspace-connection-microsoft-teams",
    titles: ["Project", "On-Call Duty", "Microsoft Teams"],
  },
  {
    getter: "getOnCallDutyBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/on-call-duty/workspace-connection-slack",
    titles: ["Project", "On-Call Duty", "Slack"],
  },
  {
    getter: "getPodmanBreadcrumbs",
    pagePattern: "/dashboard/:projectId/podman",
    titles: ["Project", "Podman", "Hosts"],
  },
  {
    getter: "getPodmanBreadcrumbs",
    pagePattern: "/dashboard/:projectId/podman/:id",
    titles: ["Project", "Podman", "View Host"],
  },
  {
    getter: "getPodmanBreadcrumbs",
    pagePattern: "/dashboard/:projectId/podman/:id/alerts",
    titles: ["Project", "Podman", "View Host", "Alerts"],
  },
  {
    getter: "getPodmanBreadcrumbs",
    pagePattern: "/dashboard/:projectId/podman/:id/containers",
    titles: ["Project", "Podman", "View Host", "Containers"],
  },
  {
    getter: "getPodmanBreadcrumbs",
    pagePattern: "/dashboard/:projectId/podman/:id/delete",
    titles: ["Project", "Podman", "View Host", "Delete Host"],
  },
  {
    getter: "getPodmanBreadcrumbs",
    pagePattern: "/dashboard/:projectId/podman/:id/documentation",
    titles: ["Project", "Podman", "View Host", "Documentation"],
  },
  {
    getter: "getPodmanBreadcrumbs",
    pagePattern: "/dashboard/:projectId/podman/:id/incidents",
    titles: ["Project", "Podman", "View Host", "Incidents"],
  },
  {
    getter: "getPodmanBreadcrumbs",
    pagePattern: "/dashboard/:projectId/podman/:id/logs",
    titles: ["Project", "Podman", "View Host", "Logs"],
  },
  {
    getter: "getPodmanBreadcrumbs",
    pagePattern: "/dashboard/:projectId/podman/:id/settings",
    titles: ["Project", "Podman", "View Host", "Settings"],
  },
  {
    getter: "getPodmanBreadcrumbs",
    pagePattern: "/dashboard/:projectId/podman/documentation",
    titles: ["Project", "Podman", "Documentation"],
  },
  {
    getter: "getProfilesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/profiles",
    titles: ["Project", "Profiler", "Overview"],
  },
  {
    getter: "getProfilesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/profiles/documentation",
    titles: ["Project", "Profiler", "Setup guide"],
  },
  {
    getter: "getProfilesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/profiles/insights",
    titles: ["Project", "Profiler", "All profiles"],
  },
  {
    getter: "getProfilesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/profiles/view/:id",
    titles: ["Project", "Profiler", "Profile"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox",
    titles: ["Project", "Proxmox", "Clusters"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id",
    titles: ["Project", "Proxmox", "View Cluster"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/alerts",
    titles: ["Project", "Proxmox", "View Cluster", "Alerts"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/audit-logs",
    titles: ["Project", "Proxmox", "View Cluster", "Audit Logs"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/delete",
    titles: ["Project", "Proxmox", "View Cluster", "Delete Cluster"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/documentation",
    titles: ["Project", "Proxmox", "View Cluster", "Documentation"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/guests",
    titles: ["Project", "Proxmox", "View Cluster", "Guests"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/guests/:subModelId",
    titles: ["Project", "Proxmox", "View Cluster", "Guests", "Guest Detail"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/incidents",
    titles: ["Project", "Proxmox", "View Cluster", "Incidents"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/insights",
    titles: ["Project", "Proxmox", "View Cluster", "Insights"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/logs",
    titles: ["Project", "Proxmox", "View Cluster", "Logs"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/metrics",
    titles: ["Project", "Proxmox", "View Cluster", "Metrics"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/nodes",
    titles: ["Project", "Proxmox", "View Cluster", "Nodes"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/nodes/:subModelId",
    titles: ["Project", "Proxmox", "View Cluster", "Nodes", "Node Detail"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/owners",
    titles: ["Project", "Proxmox", "View Cluster", "Owners"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/scheduled-maintenance",
    titles: ["Project", "Proxmox", "View Cluster", "Scheduled Maintenance"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/settings",
    titles: ["Project", "Proxmox", "View Cluster", "Settings"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/storage",
    titles: ["Project", "Proxmox", "View Cluster", "Storage"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/:id/storage/:subModelId",
    titles: ["Project", "Proxmox", "View Cluster", "Storage", "Storage Detail"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/documentation",
    titles: ["Project", "Proxmox", "Documentation"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/settings/label-rules",
    titles: ["Project", "Proxmox", "Settings", "Label Rules"],
  },
  {
    getter: "getProxmoxBreadcrumbs",
    pagePattern: "/dashboard/:projectId/proxmox/settings/owner-rules",
    titles: ["Project", "Proxmox", "Settings", "Owner Rules"],
  },
  {
    getter: "getRumBreadcrumbs",
    pagePattern: "/dashboard/:projectId/rum",
    titles: ["Project", "Real User Monitoring"],
  },
  {
    getter: "getRumBreadcrumbs",
    pagePattern: "/dashboard/:projectId/rum/:id",
    titles: ["Project", "Real User Monitoring", "View Application"],
  },
  {
    getter: "getRumBreadcrumbs",
    pagePattern: "/dashboard/:projectId/rum/:id/delete",
    titles: [
      "Project",
      "Real User Monitoring",
      "View Application",
      "Delete Application",
    ],
  },
  {
    getter: "getRumBreadcrumbs",
    pagePattern: "/dashboard/:projectId/rum/:id/documentation",
    titles: [
      "Project",
      "Real User Monitoring",
      "View Application",
      "Documentation",
    ],
  },
  {
    getter: "getRumBreadcrumbs",
    pagePattern: "/dashboard/:projectId/rum/:id/logs",
    titles: ["Project", "Real User Monitoring", "View Application", "Logs"],
  },
  {
    getter: "getRumBreadcrumbs",
    pagePattern: "/dashboard/:projectId/rum/:id/metrics",
    titles: ["Project", "Real User Monitoring", "View Application", "Metrics"],
  },
  {
    getter: "getRumBreadcrumbs",
    pagePattern: "/dashboard/:projectId/rum/:id/traces",
    titles: ["Project", "Real User Monitoring", "View Application", "Traces"],
  },
  {
    getter: "getRunbooksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/runbooks",
    titles: ["Project", "Runbooks"],
  },
  {
    getter: "getRunbooksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/runbooks/:id",
    titles: ["Project", "Runbooks", "View Runbook"],
  },
  {
    getter: "getRunbooksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/runbooks/:id/delete",
    titles: ["Project", "Runbooks", "View Runbook", "Delete Runbook"],
  },
  {
    getter: "getRunbooksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/runbooks/:id/executions",
    titles: ["Project", "Runbooks", "View Runbook", "Executions"],
  },
  {
    getter: "getRunbooksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/runbooks/:id/executions/:subModelId",
    titles: ["Project", "Runbooks", "View Runbook", "Executions", "Execution"],
  },
  {
    getter: "getRunbooksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/runbooks/:id/settings",
    titles: ["Project", "Runbooks", "View Runbook", "Settings"],
  },
  {
    getter: "getRunbooksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/runbooks/:id/steps",
    titles: ["Project", "Runbooks", "View Runbook", "Steps"],
  },
  {
    getter: "getRunbooksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/runbooks/executions",
    titles: ["Project", "Runbooks", "Executions"],
  },
  {
    getter: "getRunbooksBreadcrumbs",
    pagePattern: "/dashboard/:projectId/runbooks/settings/secrets",
    titles: ["Project", "Runbooks", "Secrets"],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/scheduled-maintenance-events",
    titles: ["Project", "Scheduled Maintenance Events"],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/scheduled-maintenance-events/:id",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/:id/custom-fields",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
      "Custom Fields",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/:id/delete",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
      "Delete",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/:id/description",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
      "Description",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/:id/internal-notes",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
      "Private Notes",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/:id/owners",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
      "Owners",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/:id/public-notes",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
      "Public Notes",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/:id/settings",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
      "Settings",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/:id/state-timeline",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
      "Status Timeline",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/scheduled-maintenance-events/create",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "New Scheduled Maintenance Event",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/scheduled-maintenance-events/ongoing",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "Ongoing Scheduled Maintenance",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/settings/custom-fields",
    titles: ["Project", "Scheduled Maintenance", "Settings", "Custom Fields"],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/settings/note-templates",
    titles: ["Project", "Scheduled Maintenance", "Settings", "Note Templates"],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/settings/note-templates/:id",
    titles: [
      "Project",
      "Scheduled Maintenance",
      "Settings",
      "Note Templates",
      "View Template",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/settings/state",
    titles: ["Project", "Scheduled Maintenance", "Settings", "State"],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/settings/templates",
    titles: ["Project", "Scheduled Maintenance", "Settings", "Templates"],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/settings/templates/:id",
    titles: [
      "Project",
      "Scheduled Maintenance",
      "Settings",
      "Templates",
      "View Template",
    ],
  },
  {
    getter: "getScheduleMaintenanceBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/scheduled-maintenance-events/workspace-connection-slack",
    titles: [
      "Project",
      "Scheduled Maintenance Events",
      "Slack Workspace Connection",
    ],
  },
  {
    getter: "getServerlessBreadcrumbs",
    pagePattern: "/dashboard/:projectId/serverless",
    titles: ["Project", "Serverless Functions"],
  },
  {
    getter: "getServerlessBreadcrumbs",
    pagePattern: "/dashboard/:projectId/serverless/:id",
    titles: ["Project", "Serverless Functions", "View Function"],
  },
  {
    getter: "getServerlessBreadcrumbs",
    pagePattern: "/dashboard/:projectId/serverless/:id/delete",
    titles: [
      "Project",
      "Serverless Functions",
      "View Function",
      "Delete Function",
    ],
  },
  {
    getter: "getServerlessBreadcrumbs",
    pagePattern: "/dashboard/:projectId/serverless/:id/documentation",
    titles: [
      "Project",
      "Serverless Functions",
      "View Function",
      "Documentation",
    ],
  },
  {
    getter: "getServerlessBreadcrumbs",
    pagePattern: "/dashboard/:projectId/serverless/:id/logs",
    titles: ["Project", "Serverless Functions", "View Function", "Logs"],
  },
  {
    getter: "getServerlessBreadcrumbs",
    pagePattern: "/dashboard/:projectId/serverless/:id/metrics",
    titles: ["Project", "Serverless Functions", "View Function", "Metrics"],
  },
  {
    getter: "getServerlessBreadcrumbs",
    pagePattern: "/dashboard/:projectId/serverless/:id/traces",
    titles: ["Project", "Serverless Functions", "View Function", "Traces"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service",
    titles: ["Project", "Services"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/:id",
    titles: ["Project", "Services", "View Service"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/:id/alerts",
    titles: ["Project", "Services", "View Service", "Alerts"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/:id/delete",
    titles: ["Project", "Services", "View Service", "Delete Service"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/:id/incidents",
    titles: ["Project", "Services", "View Service", "Incidents"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/:id/logs",
    titles: ["Project", "Services", "View Service", "Logs"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/:id/metrics",
    titles: ["Project", "Services", "View Service", "Metrics"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/:id/owners",
    titles: ["Project", "Services", "View Service", "Owners"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/:id/scheduled-maintenance",
    titles: ["Project", "Services", "View Service", "Scheduled Maintenance"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/:id/settings",
    titles: ["Project", "Services", "View Service", "Settings"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/:id/traces",
    titles: ["Project", "Services", "View Service", "Traces"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/settings/label-rules",
    titles: ["Project", "Services", "Settings", "Label Rules"],
  },
  {
    getter: "getServiceBreadcrumbs",
    pagePattern: "/dashboard/:projectId/service/settings/owner-rules",
    titles: ["Project", "Services", "Settings", "Owner Rules"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/",
    titles: ["Project", "Project Settings"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/ai-agents",
    titles: ["Project", "Settings", "AI Agents"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/ai-agents/:id",
    titles: ["Project", "Settings", "AI Agents", "View Agent"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/ai-credits",
    titles: ["Project", "Settings", "AI Credits"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/ai-logs",
    titles: ["Project", "Settings", "AI Logs"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/api-keys",
    titles: ["Project", "Settings", "API Keys"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/api-keys/:id",
    titles: ["Project", "Settings", "API Keys", "View API Key"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/audit-logs",
    titles: ["Project", "Settings", "Audit Logs"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/audit-logs/settings",
    titles: ["Project", "Settings", "Audit Logs", "Settings"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/billing",
    titles: ["Project", "Settings", "Billing"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/danger-zone",
    titles: ["Project", "Settings", "Danger Zone"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/domains",
    titles: ["Project", "Settings", "Domains"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/feature-flags",
    titles: ["Project", "Settings", "Feature Flags"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/invoices",
    titles: ["Project", "Settings", "Invoices"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/labels",
    titles: ["Project", "Settings", "Labels"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/llm-providers",
    titles: ["Project", "Settings", "LLM Providers"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/llm-providers/:id",
    titles: ["Project", "Settings", "LLM Providers", "View Provider"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/mcp-server",
    titles: ["Project", "Settings", "MCP Server"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/microsoft-teams-integration",
    titles: ["Project", "Settings", "Microsoft Teams Integration"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/notification-logs",
    titles: ["Project", "Settings", "Notification Logs"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/notification-settings",
    titles: ["Project", "Settings", "Notification Settings"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/oidc",
    titles: ["Project", "Settings", "OIDC"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/slack-integration",
    titles: ["Project", "Settings", "Slack Integration"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/sso",
    titles: ["Project", "Settings", "SSO"],
  },
  {
    getter: "getSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/settings/usage-history",
    titles: ["Project", "Settings", "Usage History"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages",
    titles: ["Project", "Status Pages"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id",
    titles: ["Project", "Status Pages", "View Status Page"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/announcements",
    titles: ["Project", "Status Pages", "View Status Page", "Announcements"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/status-pages/:id/authentication-settings",
    titles: [
      "Project",
      "Status Pages",
      "View Status Page",
      "Authentication Settings",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/branding",
    titles: [
      "Project",
      "Status Pages",
      "View Status Page",
      "Essential Branding",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/custom-code",
    titles: [
      "Project",
      "Status Pages",
      "View Status Page",
      "Custom HTML, CSS & JavaScript",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/custom-fields",
    titles: ["Project", "Status Pages", "View Status Page", "Custom Fields"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/delete",
    titles: [
      "Project",
      "Status Pages",
      "View Status Page",
      "Delete Status Page",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/domains",
    titles: ["Project", "Status Pages", "View Status Page", "Domains"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/email-subscribers",
    titles: [
      "Project",
      "Status Pages",
      "View Status Page",
      "Email Subscribers",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/footer-style",
    titles: ["Project", "Status Pages", "View Status Page", "Footer"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/groups",
    titles: ["Project", "Status Pages", "View Status Page", "Resource Groups"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/header-style",
    titles: ["Project", "Status Pages", "View Status Page", "Header"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/languages",
    titles: ["Project", "Status Pages", "View Status Page", "Languages"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/mcp",
    titles: ["Project", "Status Pages", "View Status Page", "MCP"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/navbar-style",
    titles: ["Project", "Status Pages", "View Status Page", "Navbar"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/notification-logs",
    titles: [
      "Project",
      "Status Pages",
      "View Status Page",
      "Notification Logs",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/oidc",
    titles: ["Project", "Status Pages", "View Status Page", "OIDC"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/status-pages/:id/overview-page-branding",
    titles: [
      "Project",
      "Status Pages",
      "View Status Page",
      "Overview Page Branding",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/owners",
    titles: ["Project", "Status Pages", "View Status Page", "Owners"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/private-users",
    titles: ["Project", "Status Pages", "View Status Page", "Private Users"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/resources",
    titles: ["Project", "Status Pages", "View Status Page", "Resources"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/settings",
    titles: ["Project", "Status Pages", "View Status Page", "Settings"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/sms-subscribers",
    titles: ["Project", "Status Pages", "View Status Page", "SMS Subscribers"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/sso",
    titles: ["Project", "Status Pages", "View Status Page", "SSO"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/subscriber-settings",
    titles: [
      "Project",
      "Status Pages",
      "View Status Page",
      "Subscriber Settings",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/:id/webhook-subscribers",
    titles: [
      "Project",
      "Status Pages",
      "View Status Page",
      "Webhook Subscribers",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/announcements",
    titles: ["Project", "Status Pages", "All Announcements"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/announcements/:id",
    titles: [
      "Project",
      "Status Pages",
      "All Announcements",
      "View Announcement",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/announcements/:id/delete",
    titles: [
      "Project",
      "Status Pages",
      "All Announcements",
      "View Announcement",
      "Delete Announcement",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/status-pages/announcements/:id/notification-logs",
    titles: [
      "Project",
      "Status Pages",
      "All Announcements",
      "View Announcement",
      "Notification Logs",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/status-pages/settings/announcement-templates",
    titles: ["Project", "Status Pages", "Settings", "Announcement Templates"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/status-pages/settings/announcement-templates/:id",
    titles: [
      "Project",
      "Status Pages",
      "Settings",
      "Announcement Templates",
      "View Template",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/status-pages/settings/custom-fields",
    titles: ["Project", "Status Pages", "Settings", "Custom Fields"],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/status-pages/settings/subscriber-notification-templates",
    titles: [
      "Project",
      "Status Pages",
      "Settings",
      "Subscriber Notification Templates",
    ],
  },
  {
    getter: "getStatusPagesBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/status-pages/settings/subscriber-notification-templates/:id",
    titles: [
      "Project",
      "Status Pages",
      "Settings",
      "Subscriber Notification Templates",
      "View Template",
    ],
  },
  {
    getter: "getTeamsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/teams",
    titles: ["Project", "Teams"],
  },
  {
    getter: "getTeamsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/teams/:id",
    titles: ["Project", "Teams", "View Team"],
  },
  {
    getter: "getTeamsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/teams/:id/block-permissions",
    titles: ["Project", "Teams", "View Team", "Block Permissions"],
  },
  {
    getter: "getTeamsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/teams/:id/compliance",
    titles: ["Project", "Teams", "View Team", "Compliance"],
  },
  {
    getter: "getTeamsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/teams/:id/custom-fields",
    titles: ["Project", "Teams", "View Team", "Custom Fields"],
  },
  {
    getter: "getTeamsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/teams/:id/delete",
    titles: ["Project", "Teams", "View Team", "Delete"],
  },
  {
    getter: "getTeamsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/teams/:id/members",
    titles: ["Project", "Teams", "View Team", "Members"],
  },
  {
    getter: "getTeamsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/teams/:id/permissions",
    titles: ["Project", "Teams", "View Team", "Permissions"],
  },
  {
    getter: "getTeamsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/teams/custom-fields",
    titles: ["Project", "Teams", "Custom Fields"],
  },
  {
    getter: "getTracesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/traces",
    titles: ["Project", "Traces"],
  },
  {
    getter: "getTracesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/traces/documentation",
    titles: ["Project", "Traces", "Setup Guide"],
  },
  {
    getter: "getTracesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/traces/insights",
    titles: ["Project", "Traces", "Insights"],
  },
  {
    getter: "getTracesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/traces/settings/drop-filters",
    titles: ["Project", "Traces", "Settings", "Drop Filters"],
  },
  {
    getter: "getTracesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/traces/settings/drop-filters/:id",
    titles: ["Project", "Traces", "Settings", "Drop Filters", "View"],
  },
  {
    getter: "getTracesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/traces/settings/pipelines",
    titles: ["Project", "Traces", "Settings", "Pipelines"],
  },
  {
    getter: "getTracesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/traces/settings/pipelines/:id",
    titles: ["Project", "Traces", "Settings", "Pipelines", "View"],
  },
  {
    getter: "getTracesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/traces/settings/recording-rules",
    titles: ["Project", "Traces", "Settings", "Recording Rules"],
  },
  {
    getter: "getTracesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/traces/settings/scrub-rules",
    titles: ["Project", "Traces", "Settings", "Scrub Rules"],
  },
  {
    getter: "getTracesBreadcrumbs",
    pagePattern: "/dashboard/:projectId/traces/view/:id",
    titles: ["Project", "Traces", "Trace Details"],
  },
  {
    getter: "getUserSettingsBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/user-settings/alert-episode-on-call-rules",
    titles: ["Project", "User Settings", "Alert Episode On-Call Rules"],
  },
  {
    getter: "getUserSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/user-settings/alert-on-call-rules",
    titles: ["Project", "User Settings", "Alert On-Call Rules"],
  },
  {
    getter: "getUserSettingsBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/user-settings/incident-episode-on-call-rules",
    titles: ["Project", "User Settings", "Incident Episode On-Call Rules"],
  },
  {
    getter: "getUserSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/user-settings/incident-on-call-rules",
    titles: ["Project", "User Settings", "Incident On-Call Rules"],
  },
  {
    getter: "getUserSettingsBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/user-settings/incoming-call-phone-numbers",
    titles: ["Project", "User Settings", "Incoming Phone Numbers"],
  },
  {
    getter: "getUserSettingsBreadcrumbs",
    pagePattern:
      "/dashboard/:projectId/user-settings/microsoft-teams-integration",
    titles: ["Project", "User Settings", "Microsoft Teams Integration"],
  },
  {
    getter: "getUserSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/user-settings/notification-methods",
    titles: ["Project", "User Settings", "Notification Methods"],
  },
  {
    getter: "getUserSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/user-settings/notification-settings",
    titles: ["Project", "User Settings", "Notification Settings"],
  },
  {
    getter: "getUserSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/user-settings/on-call-logs",
    titles: ["Project", "User Settings", "On-Call Logs"],
  },
  {
    getter: "getUserSettingsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/user-settings/slack-integration",
    titles: ["Project", "User Settings", "Slack Integration"],
  },
  {
    getter: "getUsersBreadcrumbs",
    pagePattern: "/dashboard/:projectId/users",
    titles: ["Project", "Users"],
  },
  {
    getter: "getUsersBreadcrumbs",
    pagePattern: "/dashboard/:projectId/users/:id",
    titles: ["Project", "Users", "View User"],
  },
  {
    getter: "getUsersBreadcrumbs",
    pagePattern: "/dashboard/:projectId/users/:id/custom-fields",
    titles: ["Project", "Users", "View User", "Custom Fields"],
  },
  {
    getter: "getUsersBreadcrumbs",
    pagePattern: "/dashboard/:projectId/users/:id/delete",
    titles: ["Project", "Users", "View User", "Remove"],
  },
  {
    getter: "getUsersBreadcrumbs",
    pagePattern: "/dashboard/:projectId/users/:id/teams",
    titles: ["Project", "Users", "View User", "Teams"],
  },
  {
    getter: "getUsersBreadcrumbs",
    pagePattern: "/dashboard/:projectId/users/custom-fields",
    titles: ["Project", "Users", "Custom Fields"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows",
    titles: ["Project", "Workflows"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows/:id",
    titles: ["Project", "Workflows", "View Workflow"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows/:id/builder",
    titles: ["Project", "Workflows", "View Workflow", "Builder"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows/:id/delete",
    titles: ["Project", "Workflows", "View Workflow", "Delete Workflow"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows/:id/logs",
    titles: ["Project", "Workflows", "View Workflow", "Logs"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows/:id/owners",
    titles: ["Project", "Workflows", "View Workflow", "Owners"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows/:id/settings",
    titles: ["Project", "Workflows", "View Workflow", "Settings"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows/:id/variables",
    titles: ["Project", "Workflows", "View Workflow", "Variables"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows/logs",
    titles: ["Project", "Workflows", "Logs"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows/settings/label-rules",
    titles: ["Project", "Workflows", "Settings", "Label Rules"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows/settings/owner-rules",
    titles: ["Project", "Workflows", "Settings", "Owner Rules"],
  },
  {
    getter: "getWorkflowsBreadcrumbs",
    pagePattern: "/dashboard/:projectId/workflows/variables",
    titles: ["Project", "Workflows", "Variables"],
  },
];

export default realBreadcrumbTrails;
