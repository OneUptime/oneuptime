import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getLlmBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM, [
      "Project",
      "AI / LLM",
      "Conversations",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM_CONVERSATIONS, [
      "Project",
      "AI / LLM",
      "Conversations",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM_CONVERSATION_VIEW, [
      "Project",
      "AI / LLM",
      "Conversations",
      "Conversation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM_ALERTS, [
      "Project",
      "AI / LLM",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM_USAGE, [
      "Project",
      "AI / LLM",
      "Usage",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM_CALLS, [
      "Project",
      "AI / LLM",
      "Calls",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM_BUDGETS, [
      "Project",
      "AI / LLM",
      "Budgets",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM_PRICING, [
      "Project",
      "AI / LLM",
      "Pricing",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM_DOCUMENTATION, [
      "Project",
      "AI / LLM",
      "Setup Guide",
    ]),
  };
  return breadcrumpLinksMap[path];
}
