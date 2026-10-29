import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getPodmanBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOSTS, [
      "Project",
      "Podman",
      "Hosts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW, [
      "Project",
      "Podman",
      "View Host",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_TOPOLOGY, [
      "Project",
      "Podman",
      "View Host",
      "Topology",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_CONTAINERS, [
      "Project",
      "Podman",
      "View Host",
      "Containers",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_RECOMMENDATIONS, [
      "Project",
      "Podman",
      "View Host",
      "Recommendations",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_AI_INSIGHTS, [
      "Project",
      "Podman",
      "View Host",
      "AI",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_AI_LOGS, [
      "Project",
      "Podman",
      "View Host",
      "AI",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_AI_AGENT, [
      "Project",
      "Podman",
      "View Host",
      "AI",
      "AI agent",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_LOGS, [
      "Project",
      "Podman",
      "View Host",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_INCIDENTS, [
      "Project",
      "Podman",
      "View Host",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_ALERTS, [
      "Project",
      "Podman",
      "View Host",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.PODMAN_HOST_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "Podman", "View Host", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_SETTINGS, [
      "Project",
      "Podman",
      "View Host",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_DELETE, [
      "Project",
      "Podman",
      "View Host",
      "Delete Host",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_DOCUMENTATION, [
      "Project",
      "Podman",
      "View Host",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_DOCUMENTATION, [
      "Project",
      "Podman",
      "Documentation",
    ]),
    /*
     * Pages that had no trail. Every page this product routes has one:
     * Common/Tests/App/Dashboard/EveryPageHasATrail fails by name for a
     * page left out.
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL, [
      "Project",
      "Podman",
      "View Host",
      "Containers",
      "Container Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_METRICS, [
      "Project",
      "Podman",
      "View Host",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_TRACES, [
      "Project",
      "Podman",
      "View Host",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_PROFILES, [
      "Project",
      "Podman",
      "View Host",
      "Performance Profiles",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_OWNERS, [
      "Project",
      "Podman",
      "View Host",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_FEED, [
      "Project",
      "Podman",
      "View Host",
      "Feed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_AUDIT_LOGS, [
      "Project",
      "Podman",
      "View Host",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_SETTINGS_OWNER_RULES, [
      "Project",
      "Podman",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_SETTINGS_OWNER_RULE_VIEW, [
      "Project",
      "Podman",
      "Settings",
      "Owner Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_SETTINGS_LABEL_RULES, [
      "Project",
      "Podman",
      "Settings",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_SETTINGS_LABEL_RULE_VIEW, [
      "Project",
      "Podman",
      "Settings",
      "Label Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_ARCHIVED, [
      "Project",
      "Podman",
      "Archived",
    ]),
  };
  return breadcrumpLinksMap[path];
}
