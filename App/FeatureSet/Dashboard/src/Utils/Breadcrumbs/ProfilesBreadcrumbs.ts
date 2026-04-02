import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getProfilesBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES, [
      "Project",
      "Performance Profiles",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES_LIST, [
      "Project",
      "Performance Profiles",
      "All Profiles",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILE_VIEW, [
      "Project",
      "Performance Profiles",
      "Profile Details",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES_DOCUMENTATION, [
      "Project",
      "Performance Profiles",
      "Setup Guide",
    ]),
  };
  return breadcrumpLinksMap[path];
}
