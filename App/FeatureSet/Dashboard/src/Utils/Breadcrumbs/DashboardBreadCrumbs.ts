import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getDashboardBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.DASHBOARDS, [
      "Project",
      "Dashboards",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DASHBOARD_VIEW, [
      "Project",
      "Dashboards",
      "View Dashboard",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DASHBOARD_VIEW_DELETE, [
      "Project",
      "Dashboards",
      "View Dashboard",
      "Delete Dashboard",
    ]),

    ...BuildBreadcrumbLinksByTitles(PageMap.DASHBOARD_VIEW_SETTINGS, [
      "Project",
      "Dashboards",
      "View Dashboard",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DASHBOARD_VIEW_OVERVIEW, [
      "Project",
      "Dashboards",
      "View Dashboard",
      "Overview",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DASHBOARD_VIEW_BRANDING, [
      "Project",
      "Dashboards",
      "View Dashboard",
      "Branding",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DASHBOARD_VIEW_OWNERS, [
      "Project",
      "Dashboards",
      "View Dashboard",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DASHBOARDS_SETTINGS_OWNER_RULES, [
      "Project",
      "Dashboards",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.DASHBOARDS_SETTINGS_LABEL_RULES, [
      "Project",
      "Dashboards",
      "Settings",
      "Label Rules",
    ]),
  };
  return breadcrumpLinksMap[path];
}
