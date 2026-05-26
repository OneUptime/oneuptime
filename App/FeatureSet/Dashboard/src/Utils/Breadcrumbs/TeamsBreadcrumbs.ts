import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getTeamsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.TEAMS, ["Project", "Teams"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TEAM_CUSTOM_FIELDS, [
      "Project",
      "Teams",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TEAM_VIEW, [
      "Project",
      "Teams",
      "View Team",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TEAM_VIEW_MEMBERS, [
      "Project",
      "Teams",
      "View Team",
      "Members",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TEAM_VIEW_PERMISSIONS, [
      "Project",
      "Teams",
      "View Team",
      "Permissions",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TEAM_VIEW_BLOCK_PERMISSIONS, [
      "Project",
      "Teams",
      "View Team",
      "Block Permissions",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TEAM_VIEW_COMPLIANCE, [
      "Project",
      "Teams",
      "View Team",
      "Compliance",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TEAM_VIEW_CUSTOM_FIELDS, [
      "Project",
      "Teams",
      "View Team",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.TEAM_VIEW_DELETE, [
      "Project",
      "Teams",
      "View Team",
      "Delete",
    ]),
  };
  return breadcrumpLinksMap[path];
}
