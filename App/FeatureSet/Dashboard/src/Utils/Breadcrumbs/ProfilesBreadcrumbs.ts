import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getProfilesBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES, ["Project", "Profiles"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILE_VIEW, [
      "Project",
      "Profiles",
      "Profile Explorer",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.PROFILES_DOCUMENTATION, [
      "Project",
      "Profiles",
      "Documentation",
    ]),
  };
  return breadcrumpLinksMap[path];
}
