import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getAlertsBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERTS, ["Project", "Alerts"]),
    ...BuildBreadcrumbLinksByTitles(PageMap.UNRESOLVED_ALERTS, [
      "Project",
      "Alerts",
      "Active Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW, [
      "Project",
      "Alerts",
      "View Alert",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_STATE_TIMELINE, [
      "Project",
      "Alerts",
      "View Alert",
      "State Timeline",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_OWNERS, [
      "Project",
      "Alerts",
      "View Alert",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_INTERNAL_NOTE, [
      "Project",
      "Alerts",
      "View Alert",
      "Private Notes",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_CUSTOM_FIELDS, [
      "Project",
      "Alerts",
      "View Alert",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ALERT_VIEW_DELETE, [
      "Project",
      "Alerts",
      "View Alert",
      "Delete Alert",
    ]),
  };
  return breadcrumpLinksMap[path];
}
