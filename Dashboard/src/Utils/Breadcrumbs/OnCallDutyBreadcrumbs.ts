import PageMap from "../PageMap";
import { BuildBreadcrumbLinksByTitles } from "./Helper";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";

export function getOnCallDutyBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY, [
      "Project",
      "On-Call Duty",
      "Policies",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICIES, [
      "Project",
      "On-Call Duty",
      "Policies",
    ]),
    //slack connection
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK,
      ["Project", "On-Call Duty", "Slack"],
    ),
    // ms teams connection
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      ["Project", "On-Call Duty", "Microsoft Teams"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULES, [
      "Project",
      "On-Call Duty",
      "Schedules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_EXECUTION_LOGS, [
      "Project",
      "On-Call Duty",
      "Execution Logs",
    ]),

    // user overrides
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES,
      ["Project", "On-Call Duty", "User Overrides"],
    ),

    // policy view user override

    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_USER_OVERRIDES,
      ["Project", "On-Call Duty", "View On-Call Policy", "User Overrides"],
    ),

    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICY_VIEW_OWNERS, [
      "Project",
      "On-Call Duty",
      "View On-Call Policy",
      "Owners",
    ]),

    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE,
      ["Project", "On-Call Duty", "Execution Logs", "Timeline"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICY_VIEW, [
      "Project",
      "On-Call Duty",
      "View On-Call Policy",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
      ["Project", "On-Call Duty", "View On-Call Policy", "Escalation Rules"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS,
      ["Project", "On-Call Duty", "View On-Call Policy", "Logs"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW,
      ["Project", "On-Call Duty", "View On-Call Policy", "Timeline"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS,
      ["Project", "On-Call Duty", "View On-Call Policy", "Custom Fields"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE, [
      "Project",
      "On-Call Duty",
      "View On-Call Policy",
      "Delete On-Call Policy",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE, [
      "Project",
      "On-Call Duty",
      "View On-Call Policy",
      "Delete On-Call Policy",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULE_VIEW, [
      "Project",
      "On-Call Duty",
      "View On-Call Schedule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS, [
      "Project",
      "On-Call Duty",
      "View On-Call Schedule",
      "Layers",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_SETTINGS,
      ["Project", "On-Call Duty", "View On-Call Schedule", "Settings"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE, [
      "Project",
      "On-Call Duty",
      "View On-Call Schedule",
      "Delete On-Call Schedule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALLDUTY_USER_TIME_LOGS, [
      "Project",
      "On-Call Duty",
      "User Time Logs",
    ]),

    // On-Call Duty Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SETTINGS_CUSTOM_FIELDS,
      ["Project", "On-Call Duty", "Settings", "Custom Fields"],
    ),

    // Incoming Call Policies
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES,
      ["Project", "On-Call Duty", "Incoming Call Policies"],
    ),
  };
  return breadcrumpLinksMap[path];
}

export function getIncomingCallPolicyBreadcrumbs(
  path: string,
): Array<Link> | undefined {
  const breadcrumpLinksMap: Dictionary<Link[]> = {
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW,
      ["Project", "On-Call Duty", "Incoming Call Policies", "View Policy"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION,
      [
        "Project",
        "On-Call Duty",
        "Incoming Call Policies",
        "View Policy",
        "Escalation Rules",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS,
      [
        "Project",
        "On-Call Duty",
        "Incoming Call Policies",
        "View Policy",
        "Call Logs",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS,
      [
        "Project",
        "On-Call Duty",
        "Incoming Call Policies",
        "View Policy",
        "Settings",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE,
      [
        "Project",
        "On-Call Duty",
        "Incoming Call Policies",
        "View Policy",
        "Delete",
      ],
    ),
  };
  return breadcrumpLinksMap[path];
}
