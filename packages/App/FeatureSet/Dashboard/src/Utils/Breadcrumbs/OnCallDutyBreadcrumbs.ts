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
      "On-Call",
      "Policies",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICIES, [
      "Project",
      "On-Call",
      "Policies",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICIES_ARCHIVED, [
      "Project",
      "On-Call",
      "Policies",
      "Archived",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_READINESS, [
      "Project",
      "On-Call",
      "Readiness",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_GUIDED_SETUP, [
      "Project",
      "On-Call",
      "Guided setup",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_CALENDAR_FEEDS, [
      "Project",
      "On-Call",
      "Calendar Feeds",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE, [
      "Project",
      "On-Call",
      "Schedule Timeline",
    ]),
    //slack connection
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK,
      ["Project", "On-Call", "Slack"],
    ),
    // ms teams connection
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      ["Project", "On-Call", "Microsoft Teams"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTION_MATTERMOST,
      ["Project", "On-Call", "Mattermost"],
    ),
    // which chat workspaces are connected, and how to connect one
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_WORKSPACE_CONNECTIONS,
      ["Project", "On-Call", "Workspace"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULES, [
      "Project",
      "On-Call",
      "Schedules",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_EXECUTION_LOGS, [
      "Project",
      "On-Call",
      "Execution Logs",
    ]),

    // user overrides
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES,
      ["Project", "On-Call", "User Overrides"],
    ),

    // policy view user override

    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_USER_OVERRIDES,
      [
        "Project",
        "On-Call",
        "Policies",
        "View On-Call Policy",
        "User Overrides",
      ],
    ),

    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICY_VIEW_OWNERS, [
      "Project",
      "On-Call",
      "Policies",
      "View On-Call Policy",
      "Owners",
    ]),

    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE,
      ["Project", "On-Call", "Execution Logs", "Timeline"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICY_VIEW, [
      "Project",
      "On-Call",
      "Policies",
      "View On-Call Policy",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
      [
        "Project",
        "On-Call",
        "Policies",
        "View On-Call Policy",
        "Escalation Rules",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS,
      ["Project", "On-Call", "Policies", "View On-Call Policy", "Logs"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW,
      [
        "Project",
        "On-Call",
        "Policies",
        "View On-Call Policy",
        "Logs",
        "Timeline",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS,
      [
        "Project",
        "On-Call",
        "Policies",
        "View On-Call Policy",
        "Custom Fields",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE, [
      "Project",
      "On-Call",
      "Policies",
      "View On-Call Policy",
      "Delete On-Call Policy",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_POLICY_VIEW_SETTINGS, [
      "Project",
      "On-Call",
      "Policies",
      "View On-Call Policy",
      "Settings",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_NOTIFICATION_LOGS,
      [
        "Project",
        "On-Call",
        "Policies",
        "View On-Call Policy",
        "Notification Logs",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_POLICY_VIEW_AUDIT_LOGS,
      ["Project", "On-Call", "Policies", "View On-Call Policy", "Audit Logs"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULE_VIEW, [
      "Project",
      "On-Call",
      "Schedules",
      "View On-Call Schedule",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS, [
      "Project",
      "On-Call",
      "Schedules",
      "View On-Call Schedule",
      "Layers",
    ]),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_OWNERS, [
      "Project",
      "On-Call",
      "Schedules",
      "View On-Call Schedule",
      "Owners",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_SETTINGS,
      ["Project", "On-Call", "Schedules", "View On-Call Schedule", "Settings"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE, [
      "Project",
      "On-Call",
      "Schedules",
      "View On-Call Schedule",
      "Delete On-Call Schedule",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_NOTIFICATION_LOGS,
      [
        "Project",
        "On-Call",
        "Schedules",
        "View On-Call Schedule",
        "Notification Logs",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_AUDIT_LOGS,
      [
        "Project",
        "On-Call",
        "Schedules",
        "View On-Call Schedule",
        "Audit Logs",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALLDUTY_USER_TIME_LOGS, [
      "Project",
      "On-Call",
      "User Time Logs",
    ]),

    // On-Call Settings (Product-level)
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SETTINGS_CUSTOM_FIELDS,
      ["Project", "On-Call", "Settings", "Custom Fields"],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SETTINGS_LABEL_RULES, [
      "Project",
      "On-Call",
      "Settings",
      "Label Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SETTINGS_LABEL_RULE_VIEW,
      ["Project", "On-Call", "Settings", "Label Rules", "View Policy Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SETTINGS_SCHEDULE_LABEL_RULE_VIEW,
      ["Project", "On-Call", "Settings", "Label Rules", "View Schedule Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SETTINGS_INCOMING_CALL_POLICY_LABEL_RULE_VIEW,
      [
        "Project",
        "On-Call",
        "Settings",
        "Label Rules",
        "View Incoming Call Policy Rule",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(PageMap.ON_CALL_DUTY_SETTINGS_OWNER_RULES, [
      "Project",
      "On-Call",
      "Settings",
      "Owner Rules",
    ]),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SETTINGS_OWNER_RULE_VIEW,
      ["Project", "On-Call", "Settings", "Owner Rules", "View Policy Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SETTINGS_SCHEDULE_OWNER_RULE_VIEW,
      ["Project", "On-Call", "Settings", "Owner Rules", "View Schedule Rule"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_SETTINGS_INCOMING_CALL_POLICY_OWNER_RULE_VIEW,
      [
        "Project",
        "On-Call",
        "Settings",
        "Owner Rules",
        "View Incoming Call Policy Rule",
      ],
    ),

    // Incoming Call Policies
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICIES,
      ["Project", "On-Call", "Incoming Call Policies"],
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
      ["Project", "On-Call", "Incoming Call Policies", "View Policy"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION,
      [
        "Project",
        "On-Call",
        "Incoming Call Policies",
        "View Policy",
        "Escalation Rules",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_OWNERS,
      ["Project", "On-Call", "Incoming Call Policies", "View Policy", "Owners"],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS,
      [
        "Project",
        "On-Call",
        "Incoming Call Policies",
        "View Policy",
        "Call Logs",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOG_VIEW,
      [
        "Project",
        "On-Call",
        "Incoming Call Policies",
        "View Policy",
        "Call Logs",
        "View Timeline",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS,
      [
        "Project",
        "On-Call",
        "Incoming Call Policies",
        "View Policy",
        "Settings",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_AUDIT_LOGS,
      [
        "Project",
        "On-Call",
        "Incoming Call Policies",
        "View Policy",
        "Audit Logs",
      ],
    ),
    ...BuildBreadcrumbLinksByTitles(
      PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE,
      ["Project", "On-Call", "Incoming Call Policies", "View Policy", "Delete"],
    ),
  };
  return breadcrumpLinksMap[path];
}
