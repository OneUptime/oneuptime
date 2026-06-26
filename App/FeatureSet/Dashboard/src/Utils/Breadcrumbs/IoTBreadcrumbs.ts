import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getIoTBreadcrumbs(path: string): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEETS, [
      "Project",
      "IoT",
      "Fleets",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW, [
      "Project",
      "IoT",
      "View Fleet",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW_DEVICES, [
      "Project",
      "IoT",
      "View Fleet",
      "Devices",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW_DEVICE_DETAIL, [
      "Project",
      "IoT",
      "View Fleet",
      "Devices",
      "Device Detail",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW_METRICS, [
      "Project",
      "IoT",
      "View Fleet",
      "Metrics",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW_LOGS, [
      "Project",
      "IoT",
      "View Fleet",
      "Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW_INCIDENTS, [
      "Project",
      "IoT",
      "View Fleet",
      "Incidents",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW_ALERTS, [
      "Project",
      "IoT",
      "View Fleet",
      "Alerts",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.IOT_FLEET_VIEW_SCHEDULED_MAINTENANCE,
      ["Project", "IoT", "View Fleet", "Scheduled Maintenance"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW_OWNERS, [
      "Project",
      "IoT",
      "View Fleet",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW_AUDIT_LOGS, [
      "Project",
      "IoT",
      "View Fleet",
      "Audit Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW_SETTINGS, [
      "Project",
      "IoT",
      "View Fleet",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW_DELETE, [
      "Project",
      "IoT",
      "View Fleet",
      "Delete Fleet",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_FLEET_VIEW_DOCUMENTATION, [
      "Project",
      "IoT",
      "View Fleet",
      "Documentation",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_DOCUMENTATION, [
      "Project",
      "IoT",
      "Documentation",
    ]),

    // IoT Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_SETTINGS_OWNER_RULES, [
      "Project",
      "IoT",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.IOT_SETTINGS_LABEL_RULES, [
      "Project",
      "IoT",
      "Settings",
      "Label Rules",
    ]),
  };
  return breadcrumpLinksMap[path];
}
