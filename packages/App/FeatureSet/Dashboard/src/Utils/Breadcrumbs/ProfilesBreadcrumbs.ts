import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getProfilesBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES, [
      "Project",
      "Profiler",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES_INSIGHTS, [
      "Project",
      "Profiler",
      "All profiles",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILE_VIEW, [
      "Project",
      "Profiler",
      "Profile",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES_DOCUMENTATION, [
      "Project",
      "Profiler",
      "Setup guide",
    ]),
    /*
     * The AI section's pages name the side-menu section they live in, as
     * the Incidents' AI pages do.
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES_AI_INSIGHTS, [
      "Project",
      "Profiler",
      "AI",
      "Insights",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES_AI_INSIGHT_VIEW, [
      "Project",
      "Profiler",
      "AI",
      "Insights",
      "Insight",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES_AI_LOGS, [
      "Project",
      "Profiler",
      "AI",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES_AI_SETTINGS, [
      "Project",
      "Profiler",
      "AI",
      "Settings",
    ]),
  };
  return breadcrumpLinksMap[path];
}
