import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getTracesBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES, ["Project", "Traces"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES_INSIGHTS, [
      "Project",
      "Traces",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACE_VIEW, [
      "Project",
      "Traces",
      "Trace Details",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TRACES_DOCUMENTATION, [
      "Project",
      "Traces",
      "Setup Guide",
    ]),
  };
  return breadcrumpLinksMap[path];
}
