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
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_CONTAINERS, [
      "Project",
      "Docker",
      "View Host",
      "Containers",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DOCKER_HOST_VIEW_LOGS, [
      "Project",
      "Docker",
      "View Host",
      "Logs",
    ]),
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
  };
  return breadcrumpLinksMap[path];
}
