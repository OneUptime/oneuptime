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
      "View Exception",
    ]),
  };
  return breadcrumpLinksMap[path];
}
