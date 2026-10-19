import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

/*
 * Code's trails. A task's page replaces its own with Code > the
 * repository > Task #42 once it has read the task (usePageBreadcrumbLinks).
 */
export function getCodeBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE, ["Project", "Code"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW, [
      "Project",
      "Code",
      "Repository",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW_SETTINGS, [
      "Project",
      "Code",
      "Repository",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW_DELETE, [
      "Project",
      "Code",
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
