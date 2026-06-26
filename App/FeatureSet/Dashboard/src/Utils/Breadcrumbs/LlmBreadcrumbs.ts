import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getLlmBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM, ["Project", "AI / LLM"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM_OVERVIEW, [
      "Project",
      "AI / LLM",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM_CALLS, [
      "Project",
      "AI / LLM",
      "LLM Calls",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.LLM_DOCUMENTATION, [
      "Project",
      "AI / LLM",
      "Setup Guide",
    ]),
  };
  return breadcrumpLinksMap[path];
}
