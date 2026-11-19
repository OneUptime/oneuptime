/*
 * ASK AI SETS THINGS UP (issue #6829): the setup actions, by name.
 *
 * "Monitor example.com and text me if it is down" is one plan: a website
 * monitor, and an on-call policy that pages the person. Ask AI proposes
 * every part of a plan in one answer, so the person approves it on one card
 * (Dashboard ToolApprovalCard), part by part - and since these actions make
 * something that pages people or that customers see, they wait for that
 * approval in every permission mode, Auto-run included
 * (Server/Utils/AI/Toolbox/SetupTools, ChatAgentRunner).
 *
 * The server registers the tools under these names; the Dashboard reads
 * them to draw a plan's card ("Nothing else changes.") and to count what
 * people do with it (ask_ai/setup_proposed, ask_ai/setup_approved). React-
 * and server-free.
 */

export const SET_UP_WEBSITE_MONITORING_TOOL_NAME: string =
  "set_up_website_monitoring";
export const SET_UP_PAGING_TOOL_NAME: string = "set_up_paging";
export const PUBLISH_STATUS_PAGE_TOOL_NAME: string = "publish_status_page";
export const ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME: string =
  "add_monitors_to_status_page";
/*
 * People invited to the project from a sentence, as Users invites them
 * (#7242): before paging, so the same plan can page them.
 */
export const INVITE_PEOPLE_TOOL_NAME: string = "invite_people";
/*
 * People added to an on-call policy the project has - to a level of it, or
 * as a new level after a wait - as the guided on-call setup adds them
 * (#7244).
 */
export const ADD_TO_ON_CALL_POLICY_TOOL_NAME: string = "add_to_on_call_policy";
/*
 * How pages reach the person asking - "text me, then call me after five
 * minutes" - saved as their How to Reach Me ladder (#7454).
 */
export const SET_HOW_TO_REACH_ME_TOOL_NAME: string = "set_how_to_reach_me";
/*
 * One of the monitors the telemetry guided setup recommends for a service
 * (#7243): one call for each, so each is a line the person can skip.
 */
export const SET_UP_SERVICE_MONITOR_TOOL_NAME: string =
  "set_up_service_monitor";

/*
 * The read beside them: who is told when a monitor goes down, from #6810's
 * resolver - how Ask AI answers "who is told when example.com goes down?"
 * once it is set up.
 */
export const WHO_IS_TOLD_TOOL_NAME: string = "who_is_told";

/*
 * Each setup action, and the word analytics names its part of a plan by
 * (a token: never a name or an address), in the order a plan runs them
 * (Server SetupTools' SETUP_PLAN_ORDER; a test holds the two together).
 */
export const AI_SETUP_ACTION_PARTS: Readonly<Record<string, string>> = {
  [INVITE_PEOPLE_TOOL_NAME]: "invitation",
  [SET_UP_PAGING_TOOL_NAME]: "paging",
  [ADD_TO_ON_CALL_POLICY_TOOL_NAME]: "on_call_policy_people",
  [SET_HOW_TO_REACH_ME_TOOL_NAME]: "how_to_reach_me",
  [SET_UP_WEBSITE_MONITORING_TOOL_NAME]: "website_monitor",
  [SET_UP_SERVICE_MONITOR_TOOL_NAME]: "service_monitor",
  [PUBLISH_STATUS_PAGE_TOOL_NAME]: "status_page",
  [ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME]: "status_page_monitors",
};

export const AI_SETUP_ACTION_TOOL_NAMES: ReadonlyArray<string> = Object.keys(
  AI_SETUP_ACTION_PARTS,
);

export function isAISetupAction(toolName: string | undefined): boolean {
  return Boolean(toolName) && AI_SETUP_ACTION_TOOL_NAMES.includes(toolName!);
}

/*
 * The parts of a plan as analytics carries them: each part's word once, in
 * the order the plan runs them, joined by "." ("paging.website_monitor").
 */
export function getAISetupPlanParts(
  toolNames: ReadonlyArray<string>,
): Array<string> {
  return AI_SETUP_ACTION_TOOL_NAMES.filter((toolName: string): boolean => {
    return toolNames.includes(toolName);
  }).map((toolName: string): string => {
    return AI_SETUP_ACTION_PARTS[toolName]!;
  });
}
