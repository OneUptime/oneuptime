import SetupHealthService from "../../../Services/SetupHealthService";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import {
  DismissedSetupHealthFinding,
  SetupHealthAnswer,
  SetupHealthFinding,
  SetupHealthFix,
} from "../../../../Types/SetupHealth/SetupHealth";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * "IS MY SETUP OK?" (#6812): the project's Setup health - what would stop
 * the right people from being told when something breaks, worst first,
 * each finding with the page that fixes it - read as the person may see
 * it (SetupHealthService.getForCaller), so Ask AI is never told of a
 * record its asker may not read.
 */

export const GET_SETUP_HEALTH_TOOL_NAME: string = "get_setup_health";

// The Setup health page, as the Dashboard's page catalog writes its address.
export const SETUP_HEALTH_DASHBOARD_PATH: string =
  "/dashboard/:projectId/home/setup-health";

// The most findings one answer hands the model; the counts say how many there are.
export const MAX_SETUP_HEALTH_FINDINGS_FOR_LLM: number = 60;

// Everyone in the project may ask: each is told only what they may read.
const SETUP_HEALTH_TOOL_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
];

// Where each fix is, by the name the menus give its page.
export const SETUP_HEALTH_FIX_PAGES: Readonly<Record<SetupHealthFix, string>> =
  {
    [SetupHealthFix.MonitorCriteria]: "the monitor's Criteria page",
    [SetupHealthFix.MonitorProbes]: "the monitor's Probes page",
    [SetupHealthFix.MonitorOverview]: "the monitor's page",
    [SetupHealthFix.CreateMonitor]: "Monitors > Create Monitor",
    [SetupHealthFix.IncidentOnCallRules]: "Incidents > Rules > On-Call Rules",
    [SetupHealthFix.AlertOnCallRules]: "Alerts > Rules > On-Call Rules",
    [SetupHealthFix.OnCallPolicy]: "the on-call policy's Escalation Rules page",
    [SetupHealthFix.OnCallSchedule]: "the on-call schedule's page",
    [SetupHealthFix.OnCallReadiness]: "On-Call > Readiness",
    [SetupHealthFix.ProjectNotificationSettings]:
      "Project Settings > Notifications > Notification Channels",
    [SetupHealthFix.ProjectBilling]:
      "Project Settings > Billing and Invoices > Billing",
    [SetupHealthFix.ServerSettings]:
      "the server's Admin Dashboard (Server setup), which only its admins can open",
    [SetupHealthFix.StatusPageResources]: "the status page's Resources page",
    [SetupHealthFix.StatusPageDomains]: "the status page's Custom Domains page",
    [SetupHealthFix.ProjectOwners]: "Teams (the Owners team)",
    [SetupHealthFix.WorkspaceNotificationRules]:
      "Incidents > the chat workspace's page (its notification rules)",
  };

function findingForLlm(finding: SetupHealthFinding): JSONObject {
  return {
    level: finding.level,
    check: finding.check,
    finding: finding.sentence,
    fixedOn: SETUP_HEALTH_FIX_PAGES[finding.fix],
  };
}

export const GetSetupHealthTool: ObservabilityTool = {
  name: GET_SETUP_HEALTH_TOOL_NAME,
  description:
    'This project\'s Setup health: what in its setup would stop the right people from being told when something breaks - a monitor that pages nobody, alerts while only incidents have on-call rules, an on-call policy nothing runs or that reaches nobody, a responder who cannot be paged, SMS or calls switched off, an empty balance, a server that cannot send email, a schedule with nobody on call, a status page that shows no monitor - worst first, each with the page that fixes it. Answers "is my setup OK?" and "why was nobody paged?". Levels: pages_will_not_arrive, worth_fixing, suggestion. Findings the team dismissed on purpose are left out unless includeDismissed is true. The citation of this result opens the Setup Health page: cite it when you answer from it.',
  inputSchema: {
    type: "object",
    properties: {
      includeDismissed: {
        type: "boolean",
        description:
          "Also list the findings the team dismissed on purpose, with their reasons.",
      },
    },
  },
  requiredPermissions: SETUP_HEALTH_TOOL_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
      projectId: ctx.projectId,
      props: ctx.props,
    });

    const includeDismissed: boolean = Boolean(
      ToolArgs.getBoolean(args, "includeDismissed"),
    );

    const findings: Array<SetupHealthFinding> = answer.findings.slice(
      0,
      MAX_SETUP_HEALTH_FINDINGS_FOR_LLM,
    );

    const data: JSONObject = {
      counts: {
        pagesWillNotArrive: answer.counts.pagesWillNotArrive,
        worthFixing: answer.counts.worthFixing,
        suggestion: answer.counts.suggestion,
        dismissed: answer.dismissed.length,
      },
      monitorsChecked: answer.monitorCount,
      checkedAt: answer.checkedAt,
      findings: findings.map(findingForLlm),
      ...(answer.findings.length === 0
        ? { summary: "Nothing to fix: no finding of any level." }
        : {}),
      ...(includeDismissed
        ? {
            dismissed: answer.dismissed.map(
              (item: DismissedSetupHealthFinding): JSONObject => {
                return {
                  ...findingForLlm(item.finding),
                  dismissedBecause:
                    item.dismissal.reason || "(no reason given)",
                };
              },
            ),
          }
        : {}),
    };

    return {
      dataForLlm: JSON.stringify(data, null, 1),
      rowCount: answer.findings.length,
      citationLabel: "Setup Health",
      citationTarget: {
        type: AIChatCitationTargetType.DashboardPage,
        params: { path: SETUP_HEALTH_DASHBOARD_PATH, title: "Setup Health" },
      },
      redactionCount: 0,
      isTruncated: answer.findings.length > findings.length,
    };
  },
};
