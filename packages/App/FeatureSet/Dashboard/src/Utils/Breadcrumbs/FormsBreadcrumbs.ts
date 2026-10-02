import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getFormsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.FORMS, ["Project", "Forms"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.FORMS_SUBMISSIONS, [
      "Project",
      "Forms",
      "Submissions",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.FORM_VIEW, [
      "Project",
      "Forms",
      "View Form",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.FORM_VIEW_ON_SUBMIT, [
      "Project",
      "Forms",
      "View Form",
      "On Submit",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.FORM_VIEW_SHARE, [
      "Project",
      "Forms",
      "View Form",
      "Share",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.FORM_VIEW_SUBMISSIONS, [
      "Project",
      "Forms",
      "View Form",
      "Submissions",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.FORM_VIEW_DELETE, [
      "Project",
      "Forms",
      "View Form",
      "Delete Form",
    ]),
  };
  return breadcrumpLinksMap[path];
}
