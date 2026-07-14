import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getAIAgentTasksBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASKS, [
      "Project",
      "Sentinel Tasks",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASK_VIEW, [
      "Project",
      "Sentinel Tasks",
      "View Task",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASK_VIEW_LOGS, [
      "Project",
      "Sentinel Tasks",
      "View Task",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASK_VIEW_PULL_REQUESTS, [
      "Project",
      "Sentinel Tasks",
      "View Task",
      "Pull Requests",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASK_VIEW_DELETE, [
      "Project",
      "Sentinel Tasks",
      "View Task",
      "Delete Task",
    ]),
  };
  return breadcrumpLinksMap[path];
}
