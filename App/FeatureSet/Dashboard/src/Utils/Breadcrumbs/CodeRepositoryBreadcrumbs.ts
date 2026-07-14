import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getCodeRepositoryBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY, [
      "Project",
      "Code Repositories",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW, [
      "Project",
      "Code Repositories",
      "View Repository",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW_DELETE, [
      "Project",
      "Code Repositories",
      "View Repository",
      "Delete Repository",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW_SETTINGS, [
      "Project",
      "Code Repositories",
      "View Repository",
      "Settings",
    ]),
  };
  return breadcrumpLinksMap[path];
}
