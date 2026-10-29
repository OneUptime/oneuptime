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
      "Docker Swarm",
      "Clusters",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW, [
      "Project",
      "Docker Swarm",
      "View Cluster",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_TOPOLOGY,
      ["Project", "Docker Swarm", "View Cluster", "Topology"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODES, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Nodes",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL,
      ["Project", "Docker Swarm", "View Cluster", "Nodes", "Node Detail"],
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
      ["Project", "Docker Swarm", "View Cluster", "Resource Usage"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_RECOMMENDATIONS,
      ["Project", "Docker Swarm", "View Cluster", "Recommendations"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_INSIGHTS,
      ["Project", "Docker Swarm", "View Cluster", "AI", "Insights"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_LOGS, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "AI",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_AGENT,
      ["Project", "Docker Swarm", "View Cluster", "AI", "AI agent"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_METRICS, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_LOGS, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_INCIDENTS,
      ["Project", "Docker Swarm", "View Cluster", "Incidents"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_ALERTS, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "Docker Swarm", "View Cluster", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_OWNERS, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_AUDIT_LOGS,
      ["Project", "Docker Swarm", "View Cluster", "Audit Logs"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_SETTINGS,
      ["Project", "Docker Swarm", "View Cluster", "Settings"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_DELETE, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Delete Cluster",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_DOCUMENTATION,
      ["Project", "Docker Swarm", "View Cluster", "Documentation"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_DOCUMENTATION, [
      "Project",
      "Docker Swarm",
      "Documentation",
    ]),

    // DockerSwarm Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_SETTINGS_OWNER_RULES, [
      "Project",
      "Docker Swarm",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_SETTINGS_OWNER_RULE_VIEW,
      ["Project", "Docker Swarm", "Settings", "Owner Rules", "View Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_SETTINGS_LABEL_RULES, [
      "Project",
      "Docker Swarm",
      "Settings",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_SWARM_SETTINGS_LABEL_RULE_VIEW,
      ["Project", "Docker Swarm", "Settings", "Label Rules", "View Rule"],
    ),
    /*
     * Pages that had no trail. Every page this product routes has one:
     * Common/Tests/App/Dashboard/EveryPageHasATrail fails by name for a
     * page left out.
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_CLUSTER_VIEW_FEED, [
      "Project",
      "Docker Swarm",
      "View Cluster",
      "Feed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SWARM_ARCHIVED, [
      "Project",
      "Docker Swarm",
      "Archived",
    ]),
  };
  return breadcrumpLinksMap[path];
}
