import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getHostBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.HOSTS, ["Project", "Hosts"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW, [
      "Project",
      "Hosts",
      "View Host",
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
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_LOGS, [
      "Project",
      "Hosts",
      "View Host",
      "Logs",
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
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.HOST_DOCUMENTATION, [
      "Project",
      "Hosts",
      "Documentation",
    ]),
  };
  return breadcrumpLinksMap[path];
}
