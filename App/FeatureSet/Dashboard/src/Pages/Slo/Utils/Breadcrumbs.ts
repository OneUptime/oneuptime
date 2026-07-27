import PageMap from "../../../Utils/PageMap";
import { BuildBreadcrumbLinksByTitles } from "../../../Utils/Breadcrumbs/Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getSloBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.SLOS, ["Project", "SLOs"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW, [
      "Project",
      "SLOs",
      "View SLO",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_CHARTS, [
      "Project",
      "SLOs",
      "View SLO",
      "Charts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_BURN_RATE_RULES, [
      "Project",
      "SLOs",
      "View SLO",
      "Burn Rate Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_ALERTS, [
      "Project",
      "SLOs",
      "View SLO",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_AUDIT_LOGS, [
      "Project",
      "SLOs",
      "View SLO",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_OWNERS, [
      "Project",
      "SLOs",
      "View SLO",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SLO_VIEW_DELETE, [
      "Project",
      "SLOs",
      "View SLO",
      "Delete SLO",
    ]),
  };
  return breadcrumpLinksMap[path];
}
