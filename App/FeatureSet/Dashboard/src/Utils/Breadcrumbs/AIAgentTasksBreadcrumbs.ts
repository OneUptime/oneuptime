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
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENTS_MCP_SERVER, [
      "Project",
      "AI Agents",
      "MCP Server",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENTS_AGENTS, [
      "Project",
      "AI Agents",
      "Agents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENTS_AGENT_VIEW, [
      "Project",
      "AI Agents",
      "Agents",
      "View Agent",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENTS_LLM_PROVIDERS, [
      "Project",
      "AI Agents",
      "LLM Providers",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENTS_LLM_PROVIDER_VIEW, [
      "Project",
      "AI Agents",
      "LLM Providers",
      "View Provider",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENTS_AI_CREDITS, [
      "Project",
      "AI Agents",
      "AI Credits",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.AI_AGENTS_AI_LOGS, [
      "Project",
      "AI Agents",
      "AI Logs",
    ]),
  };
  return breadcrumpLinksMap[path];
}
