import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getHostBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.HOSTS, ["Project", "Hosts"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_COLLECTOR_CONFIGS, [
      "Project",
      "Hosts",
      "Collector Configs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_COLLECTOR_CONFIG_VIEW, [
      "Project",
      "Hosts",
      "Collector Configs",
      "View Config",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW, [
      "Project",
      "Hosts",
      "View Host",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_TOPOLOGY, [
      "Project",
      "Hosts",
      "View Host",
      "Topology",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_RECOMMENDATIONS, [
      "Project",
      "Hosts",
      "View Host",
      "Recommendations",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_AI_INSIGHTS, [
      "Project",
      "Hosts",
      "View Host",
      "AI",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_AI_LOGS, [
      "Project",
      "Hosts",
      "View Host",
      "AI",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_AI_AGENT, [
      "Project",
      "Hosts",
      "View Host",
      "AI",
      "AI agent",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_METRICS, [
      "Project",
      "Hosts",
      "View Host",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_PROCESSES, [
      "Project",
      "Hosts",
      "View Host",
      "Processes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_PROCESS_VIEW, [
      "Project",
      "Hosts",
      "View Host",
      "Processes",
      "View Process",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_SERVICES, [
      "Project",
      "Hosts",
      "View Host",
      "Services",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_SERVICE_VIEW, [
      "Project",
      "Hosts",
      "View Host",
      "Services",
      "View Service",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_SYSTEMD_UNITS, [
      "Project",
      "Hosts",
      "View Host",
      "Systemd Units",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_SYSTEMD_UNIT_VIEW, [
      "Project",
      "Hosts",
      "View Host",
      "Systemd Units",
      "View Unit",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_LOGS, [
      "Project",
      "Hosts",
      "View Host",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_INCIDENTS, [
      "Project",
      "Hosts",
      "View Host",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_ALERTS, [
      "Project",
      "Hosts",
      "View Host",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_SCHEDULED_MAINTENANCE, [
      "Project",
      "Hosts",
      "View Host",
      "Scheduled Maintenance",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_OWNERS, [
      "Project",
      "Hosts",
      "View Host",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_SETTINGS, [
      "Project",
      "Hosts",
      "View Host",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_DELETE, [
      "Project",
      "Hosts",
      "View Host",
      "Delete Host",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_DOCUMENTATION, [
      "Project",
      "Hosts",
      "View Host",
      "Collector",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_DOCUMENTATION, [
      "Project",
      "Hosts",
      "Documentation",
    ]),
    /*
     * Pages that had no trail. Every page this product routes has one:
     * Common/Tests/App/Dashboard/EveryPageHasATrail fails by name for a
     * page left out.
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_TRACES, [
      "Project",
      "Hosts",
      "View Host",
      "Traces",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_PROFILES, [
      "Project",
      "Hosts",
      "View Host",
      "Performance Profiles",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_FEED, [
      "Project",
      "Hosts",
      "View Host",
      "Feed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_AUDIT_LOGS, [
      "Project",
      "Hosts",
      "View Host",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_SETTINGS_OWNER_RULES, [
      "Project",
      "Hosts",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_SETTINGS_OWNER_RULE_VIEW, [
      "Project",
      "Hosts",
      "Settings",
      "Owner Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_SETTINGS_LABEL_RULES, [
      "Project",
      "Hosts",
      "Settings",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_SETTINGS_LABEL_RULE_VIEW, [
      "Project",
      "Hosts",
      "Settings",
      "Label Rules",
      "View Rule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_ARCHIVED, [
      "Project",
      "Hosts",
      "Archived",
    ]),
  };
  return breadcrumpLinksMap[path];
}
