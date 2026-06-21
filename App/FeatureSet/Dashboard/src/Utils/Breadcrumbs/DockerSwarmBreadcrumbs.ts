import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getDockerSwarmBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTERS, [
      "Project",
      "DockerSwarm",
      "Clusters",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW, [
      "Project",
      "DockerSwarm",
      "View Cluster",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODES, [
      "Project",
      "DockerSwarm",
      "View Cluster",
      "Nodes",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL,
      ["Project", "DockerSwarm", "View Cluster", "Nodes", "Node Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICES,
      ["Project", "Docker Swarm", "View Cluster", "Services"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL,
      ["Project", "Docker Swarm", "View Cluster", "Services", "Service Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASKS, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Tasks",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASK_DETAIL,
      ["Project", "Docker Swarm", "View Cluster", "Tasks", "Task Detail"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_STACKS, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Stacks",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_NETWORKS,
      ["Project", "Docker Swarm", "View Cluster", "Networks"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_SECRETS, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Secrets",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_CONFIGS, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Configs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_VOLUMES, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Volumes",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_INSIGHTS,
      ["Project", "DockerSwarm", "View Cluster", "Insights"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_METRICS, [
      "Project",
      "DockerSwarm",
      "View Cluster",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_LOGS, [
      "Project",
      "DockerSwarm",
      "View Cluster",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_INCIDENTS,
      ["Project", "DockerSwarm", "View Cluster", "Incidents"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_ALERTS, [
      "Project",
      "DockerSwarm",
      "View Cluster",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "DockerSwarm", "View Cluster", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_OWNERS, [
      "Project",
      "DockerSwarm",
      "View Cluster",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_AUDIT_LOGS,
      ["Project", "DockerSwarm", "View Cluster", "Audit Logs"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_SETTINGS,
      ["Project", "DockerSwarm", "View Cluster", "Settings"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_DELETE, [
      "Project",
      "DockerSwarm",
      "View Cluster",
      "Delete Cluster",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_DOCUMENTATION,
      ["Project", "DockerSwarm", "View Cluster", "Documentation"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_DOCUMENTATION, [
      "Project",
      "DockerSwarm",
      "Documentation",
    ]),

    // DockerSwarm Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_SETTINGS_OWNER_RULES, [
      "Project",
      "DockerSwarm",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_SETTINGS_LABEL_RULES, [
      "Project",
      "DockerSwarm",
      "Settings",
      "Label Rules",
    ]),
  };
  return breadcrumpLinksMap[path];
}
