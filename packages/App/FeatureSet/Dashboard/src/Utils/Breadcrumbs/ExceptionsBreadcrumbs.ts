import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getExceptionsBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS, [
      "Project",
      "Exceptions",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_OVERVIEW, [
      "Project",
      "Exceptions",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_UNRESOLVED, [
      "Project",
      "Exceptions",
      "Unresolved",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_RESOLVED, [
      "Project",
      "Exceptions",
      "Resolved",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_ARCHIVED, [
      "Project",
      "Exceptions",
      "Archived",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_VIEW, [
      "Project",
      "Exceptions",
      "Exception",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_VIEW_STACK_TRACE, [
      "Project",
      "Exceptions",
      "Exception",
      "Stack Trace",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_VIEW_OCCURRENCES, [
      "Project",
      "Exceptions",
      "Exception",
      "Occurrences",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_VIEW_CONTEXT, [
      "Project",
      "Exceptions",
      "Exception",
      "Context",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_VIEW_LOGS, [
      "Project",
      "Exceptions",
      "Exception",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_VIEW_AI_ASSISTANCE, [
      "Project",
      "Exceptions",
      "Exception",
      "AI Assistance",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_VIEW_SETTINGS, [
      "Project",
      "Exceptions",
      "Exception",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_DOCUMENTATION, [
      "Project",
      "Exceptions",
      "Setup Guide",
    ]),
    // The AI section's pages name the tab and the menu section they live in.
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_AI_INSIGHTS, [
      "Project",
      "Exceptions",
      "AI",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_AI_INSIGHT_VIEW, [
      "Project",
      "Exceptions",
      "AI",
      "Insights",
      "Insight",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_AI_LOGS, [
      "Project",
      "Exceptions",
      "AI",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_AI_SETTINGS, [
      "Project",
      "Exceptions",
      "AI",
      "Settings",
    ]),
    /*
     * Pages that had no trail. Every page this product routes has one:
     * Common/Tests/App/Dashboard/EveryPageHasATrail fails by name for a
     * page left out.
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_VIEW_ROOT, [
      "Project",
      "Exceptions",
    ]),
  };
  return breadcrumpLinksMap[path];
}
