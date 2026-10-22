import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * Code's trails. A repository's pages sit under Repositories, where it is
 * listed: Project > Code > Repositories > the repository (> Settings, >
 * Production Reviews) - so
 * each crumb is the page above, and the repository's crumb, named by the
 * repository, opens its page. A task's page replaces its own with Code >
 * the repository > Task #42 once it has read the task
 * (usePageBreadcrumbLinks).
 */
export function getCodeBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE, ["Project", "Code"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORIES, [
      "Project",
      "Code",
      "Repositories",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW, [
      "Project",
      "Code",
      "Repositories",
      "Repository",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW_SETTINGS, [
      "Project",
      "Code",
      "Repositories",
      "Repository",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS,
      ["Project", "Code", "Repositories", "Repository", "Production Reviews"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW_DELETE, [
      "Project",
      "Code",
      "Repositories",
      "Repository",
      "Delete Repository",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_TASK_VIEW, [
      "Project",
      "Code",
      "Task",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_TASK_VIEW_LOG, [
      "Project",
      "Code",
      "Task",
      "Log",
    ]),
  };
  return breadcrumpLinksMap[path];
}
