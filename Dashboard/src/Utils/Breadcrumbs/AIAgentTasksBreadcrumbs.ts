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
      "AI Agent Tasks",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASK_VIEW, [
      "Project",
      "AI Agent Tasks",
      "View Task",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASK_VIEW_LOGS, [
      "Project",
      "AI Agent Tasks",
      "View Task",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASK_VIEW_PULL_REQUESTS, [
      "Project",
      "AI Agent Tasks",
      "View Task",
      "Pull Requests",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASK_VIEW_DELETE, [
      "Project",
      "AI Agent Tasks",
      "View Task",
      "Delete Task",
    ]),
  };
  return breadcrumpLinksMap[path];
}
