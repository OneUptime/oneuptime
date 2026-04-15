import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getProfilesBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES, ["Project", "Profiler"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES_INSIGHTS, [
      "Project",
      "Profiler",
      "Raw profiles",
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
  };
  return breadcrumpLinksMap[path];
}
