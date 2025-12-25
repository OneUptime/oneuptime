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
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASKS_SCHEDULED, [
      "Project",
      "AI Agent Tasks",
      "Scheduled",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASKS_IN_PROGRESS, [
      "Project",
      "AI Agent Tasks",
      "In Progress",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASKS_COMPLETED, [
      "Project",
      "AI Agent Tasks",
      "Completed",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENT_TASK_VIEW, [
      "Project",
      "AI Agent Tasks",
      "View Task",
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
