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
 * The read beside them: who is told when a monitor goes down, from #6810's
 * resolver - how Ask AI answers "who is told when example.com goes down?"
 * once it is set up.
 */
export const WHO_IS_TOLD_TOOL_NAME: string = "who_is_told";

/*
 * Each setup action, and the word analytics names its part of a plan by
 * (a token: never a name or an address).
 */
export const AI_SETUP_ACTION_PARTS: Readonly<Record<string, string>> = {
  [SET_UP_PAGING_TOOL_NAME]: "paging",
  [SET_UP_WEBSITE_MONITORING_TOOL_NAME]: "website_monitor",
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
