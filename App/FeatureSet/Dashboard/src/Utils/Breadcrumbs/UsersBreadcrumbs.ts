import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getUsersBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.USERS, ["Project", "Users"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_CUSTOM_FIELDS, [
      "Project",
      "Users",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_VIEW, [
      "Project",
      "Users",
      "View User",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_VIEW_TEAMS, [
      "Project",
      "Users",
      "View User",
      "Teams",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_VIEW_CUSTOM_FIELDS, [
      "Project",
      "Users",
      "View User",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_VIEW_DELETE, [
      "Project",
      "Users",
      "View User",
      "Remove",
    ]),
  };
  return breadcrumpLinksMap[path];
}
