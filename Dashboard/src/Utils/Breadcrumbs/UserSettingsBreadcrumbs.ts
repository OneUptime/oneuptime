import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getUserSettingsBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(
      PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
      ["Project", "User Settings", "Notification Methods"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS,
      ["Project", "User Settings", "Notification Settings"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES,
      ["Project", "User Settings", "Incident On-Call Rules"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_SETTINGS_SLACK_INTEGRATION, [
      "Project",
      "User Settings",
      "Slack Integration",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
      ["Project", "User Settings", "Microsoft Teams Integration"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES, [
      "Project",
      "User Settings",
      "Alert On-Call Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.USER_SETTINGS_EPISODE_ON_CALL_RULES,
      ["Project", "User Settings", "Episode On-Call Rules"],
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
  };
  return breadcrumpLinksMap[path];
}
