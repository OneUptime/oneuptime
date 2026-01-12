import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getScheduleMaintenanceBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.SCHEDULED_MAINTENANCE_EVENTS, [
      "Project",
      "Scheduled Maintenance Events",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
      [
        "Project",
        "Scheduled Maintenance Events",
        "Ongoing Scheduled Maintenance",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK,
      ["Project", "Scheduled Maintenance Events", "Slack Workspace Connection"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE,
      [
        "Project",
        "Scheduled Maintenance Events",
        "New Scheduled Maintenance Event",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SCHEDULED_MAINTENANCE_VIEW, [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS, [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE,
      [
        "Project",
        "Scheduled Maintenance Events",
        "View Scheduled Maintenance Event",
        "Status Timeline",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE,
      [
        "Project",
        "Scheduled Maintenance Events",
        "View Scheduled Maintenance Event",
        "Private Notes",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE, [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
      "Public Notes",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS,
      [
        "Project",
        "Scheduled Maintenance Events",
        "View Scheduled Maintenance Event",
        "Custom Fields",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_VIEW_SETTINGS,
      [
        "Project",
        "Scheduled Maintenance Events",
        "View Scheduled Maintenance Event",
        "Settings",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE, [
      "Project",
      "Scheduled Maintenance Events",
      "View Scheduled Maintenance Event",
      "Delete",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_VIEW_DESCRIPTION,
      [
        "Project",
        "Scheduled Maintenance Events",
        "View Scheduled Maintenance Event",
        "Description",
      ],
    ),

    // Scheduled Maintenance Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_STATE,
      ["Project", "Scheduled Maintenance", "Settings", "State"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES,
      ["Project", "Scheduled Maintenance", "Settings", "Templates"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES_VIEW,
      [
        "Project",
        "Scheduled Maintenance",
        "Settings",
        "Templates",
        "View Template",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES,
      ["Project", "Scheduled Maintenance", "Settings", "Note Templates"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES_VIEW,
      [
        "Project",
        "Scheduled Maintenance",
        "Settings",
        "Note Templates",
        "View Template",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS,
      ["Project", "Scheduled Maintenance", "Settings", "Custom Fields"],
    ),
  };
  return breadcrumpLinksMap[path];
}
