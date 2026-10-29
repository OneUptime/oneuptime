import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getDockerBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOSTS, [
      "Project",
      "Docker",
      "Hosts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW, [
      "Project",
      "Docker",
      "View Host",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_TOPOLOGY, [
      "Project",
      "Docker",
      "View Host",
      "Topology",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_CONTAINERS, [
      "Project",
      "Docker",
      "View Host",
      "Containers",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_RECOMMENDATIONS, [
      "Project",
      "Docker",
      "View Host",
      "Recommendations",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_AI_INSIGHTS, [
      "Project",
      "Docker",
      "View Host",
      "AI",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_AI_LOGS, [
      "Project",
      "Docker",
      "View Host",
      "AI",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_AI_AGENT, [
      "Project",
      "Docker",
      "View Host",
      "AI",
      "AI agent",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_LOGS, [
      "Project",
      "Docker",
      "View Host",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_INCIDENTS, [
      "Project",
      "Docker",
      "View Host",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_ALERTS, [
      "Project",
      "Docker",
      "View Host",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.DOCKER_HOST_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "Docker", "View Host", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_SETTINGS, [
      "Project",
      "Docker",
      "View Host",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_DELETE, [
      "Project",
      "Docker",
      "View Host",
      "Delete Host",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_DOCUMENTATION, [
      "Project",
      "Docker",
      "View Host",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_DOCUMENTATION, [
      "Project",
      "Docker",
      "Documentation",
    ]),
    /*
     * Pages that had no trail. Every page this product routes has one:
     * Common/Tests/App/Dashboard/EveryPageHasATrail fails by name for a
     * page left out.
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL, [
      "Project",
      "Docker",
      "View Host",
      "Containers",
      "Container Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_METRICS, [
      "Project",
      "Docker",
      "View Host",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_TRACES, [
      "Project",
      "Docker",
      "View Host",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_PROFILES, [
      "Project",
      "Docker",
      "View Host",
      "Performance Profiles",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_OWNERS, [
      "Project",
      "Docker",
      "View Host",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_FEED, [
      "Project",
      "Docker",
      "View Host",
      "Feed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_AUDIT_LOGS, [
      "Project",
      "Docker",
      "View Host",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SETTINGS_OWNER_RULES, [
      "Project",
      "Docker",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SETTINGS_OWNER_RULE_VIEW, [
      "Project",
      "Docker",
      "Settings",
      "Owner Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SETTINGS_LABEL_RULES, [
      "Project",
      "Docker",
      "Settings",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_SETTINGS_LABEL_RULE_VIEW, [
      "Project",
      "Docker",
      "Settings",
      "Label Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_ARCHIVED, [
      "Project",
      "Docker",
      "Archived",
    ]),
  };
  return breadcrumpLinksMap[path];
}
