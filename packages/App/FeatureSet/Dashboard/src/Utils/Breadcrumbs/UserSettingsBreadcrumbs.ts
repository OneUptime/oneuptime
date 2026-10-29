import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getUserSettingsBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_SETTINGS_SETUP, [
      "Project",
      "User Settings",
      "Setup Checklist",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
      ["Project", "User Settings", "Notification Methods"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS,
      ["Project", "User Settings", "Notification Settings"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_SETTINGS_ON_CALL_RULES, [
      "Project",
      "User Settings",
      "On-Call Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_SETTINGS_SLACK_INTEGRATION, [
      "Project",
      "User Settings",
      "Slack",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
      ["Project", "User Settings", "Microsoft Teams"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_SETTINGS_ON_CALL_LOGS, [
      "Project",
      "User Settings",
      "On-Call Logs",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.USER_SETTINGS_INCOMING_CALL_PHONE_NUMBERS,
      ["Project", "User Settings", "Incoming Phone Numbers"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED,
      ["Project", "User Settings", "Calendar Feed"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_SETTINGS_EMAIL_PREFERENCES, [
      "Project",
      "User Settings",
      "Email Preferences",
    ]),
    /*
     * Pages that had no trail. Every page this product routes has one:
     * Common/Tests/App/Dashboard/EveryPageHasATrail fails by name for a
     * page left out.
     */
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_SETTINGS_CUSTOM_FIELDS, [
      "Project",
      "User Settings",
      "Custom Fields",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE,
      ["Project", "User Settings", "On-Call Logs", "Notification Timeline"],
    ),
  };
  return breadcrumpLinksMap[path];
}
