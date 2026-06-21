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
    ...BuildBreadcrumbLinksByTitles(PageMap.PODMAN_HOST_VIEW_CONTAINERS, [
      "Project",
      "Podman",
      "View Host",
      "Containers",
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
  };
  return breadcrumpLinksMap[path];
}
