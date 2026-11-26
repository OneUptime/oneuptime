/*
 * ASK AI AND THE MCP SERVER ACT ON DATA SECURITY (#10378, #10889): the
 * actions, by name.
 *
 * Ask AI could say which stores hold card numbers and what to fix first,
 * then stopped: the person had to leave the conversation to press Scrub
 * It, Accept Risk or Block Public Access. These are the same buttons as
 * actions - each calls the very server code its button calls, as the
 * person who asked, with their permissions - behind an approval card that
 * says what changes, what stops working and what it costs:
 *
 *   scrub_data_security_finding      Scrub It, with its proven rule
 *   judge_data_security_finding      Confirm, or Not Sensitive with a
 *                                    reason, and Apply to Similar
 *   change_data_security_issue       Accept Risk until a date, Not an
 *                                    Issue, Reopen, Assign
 *   set_data_store_owners            a store's owners, added or removed
 *   draft_data_security_rule         a residency, owner or label rule
 *                                    drafted from a sentence, with the
 *                                    stores it matches today (a read)
 *   save_data_security_rule          that rule, saved
 *   respond_on_data_store            Fix it from here: a response action
 *                                    through the store's cloud connection
 *   fix_data_security_issue_with_ai  Fix with AI: a pull request
 *   query_data_security_proposals    what OneUptime AI proposes, the data
 *                                    types it found among them (a read)
 *   decide_data_security_proposal    Approve or Dismiss one of them
 *
 * Some ask in every mode, Auto-run included: responding on a store,
 * marking a finding not sensitive and accepting a risk change who can
 * reach data or stop something counting, and any action that text an
 * attacker can write - a store's name, a finding's evidence - could have
 * talked the model into asks too (Server/Utils/AI/Toolbox/
 * DataSecurityActionTools). React- and server-free.
 */

export const SCRUB_DATA_SECURITY_FINDING_TOOL_NAME: string =
  "scrub_data_security_finding";
export const JUDGE_DATA_SECURITY_FINDING_TOOL_NAME: string =
  "judge_data_security_finding";
export const CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME: string =
  "change_data_security_issue";
export const SET_DATA_STORE_OWNERS_TOOL_NAME: string = "set_data_store_owners";
export const DRAFT_DATA_SECURITY_RULE_TOOL_NAME: string =
  "draft_data_security_rule";
export const SAVE_DATA_SECURITY_RULE_TOOL_NAME: string =
  "save_data_security_rule";
export const RESPOND_ON_DATA_STORE_TOOL_NAME: string = "respond_on_data_store";
export const FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME: string =
  "fix_data_security_issue_with_ai";
export const QUERY_DATA_SECURITY_PROPOSALS_TOOL_NAME: string =
  "query_data_security_proposals";
export const DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME: string =
  "decide_data_security_proposal";

// The actions that change something, in the order the docs list them.
export const DATA_SECURITY_ACTION_TOOL_NAMES: ReadonlyArray<string> = [
  SCRUB_DATA_SECURITY_FINDING_TOOL_NAME,
  JUDGE_DATA_SECURITY_FINDING_TOOL_NAME,
  CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME,
  SET_DATA_STORE_OWNERS_TOOL_NAME,
  SAVE_DATA_SECURITY_RULE_TOOL_NAME,
  RESPOND_ON_DATA_STORE_TOOL_NAME,
  FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME,
  DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
];

// The reads beside them: a rule's draft and OneUptime AI's proposals.
export const DATA_SECURITY_ACTION_READ_TOOL_NAMES: ReadonlyArray<string> = [
  DRAFT_DATA_SECURITY_RULE_TOOL_NAME,
  QUERY_DATA_SECURITY_PROPOSALS_TOOL_NAME,
];

/*
 * EVERY ONE OF THEM RUNS OUTSIDE ASK AI'S CHAT TOO: the MCP server offers
 * each as a tool of its own, one call each, run by the API
 * (DATA_SECURITY_ACTION_RUN_ROUTE, Server/API/DataSecurityActionAPI)
 * through the same tools as Ask AI - the same prepare, the same checks, the
 * same writes as the person. An action that asks in every mode is refused
 * there: an MCP client shows no card OneUptime can wait on.
 */
export const DATA_SECURITY_ACTIONS_RUN_OUTSIDE_CHAT: ReadonlyArray<string> = [
  ...DATA_SECURITY_ACTION_READ_TOOL_NAMES,
  ...DATA_SECURITY_ACTION_TOOL_NAMES,
];

export function isDataSecurityActionRunOutsideChat(
  toolName: string | undefined,
): boolean {
  return (
    Boolean(toolName) &&
    DATA_SECURITY_ACTIONS_RUN_OUTSIDE_CHAT.includes(toolName!)
  );
}

export function isDataSecurityAction(toolName: string | undefined): boolean {
  return (
    Boolean(toolName) && DATA_SECURITY_ACTION_TOOL_NAMES.includes(toolName!)
  );
}

/*
 * The route that runs one of them, under the API's base (/api): POST with
 * { action, arguments }, as the caller. Answered with what was done
 * (DataSecurityActionRunResult), or refused with why, as an error of its
 * own status (403 for a permission or an action that asks in every mode,
 * 402 for the plan, 409 for what changed since, 400 for what is missing).
 */
export const DATA_SECURITY_ACTION_RUN_ROUTE: string =
  "/data-security-actions/run";

/*
 * What a run of one of them answers with: the action, what it did - as the
 * approval card titles it, and the card's effects (what changed, what
 * stopped working, what it cost), in English - and the tool's own words for
 * the agent. `record` is the record it changed or read, by the kind of
 * page it opens and that page's ids.
 */
export interface DataSecurityActionRunResult {
  action: string;
  title?: string | undefined;
  details: Array<string>;
  changes: Array<string>;
  stopsWorking: Array<string>;
  costs: Array<string>;
  message: string;
  record?:
    | {
        type: string;
        params: Record<string, string>;
      }
    | undefined;
}

/*
 * How the refusal of an action that asks in every mode begins, outside the
 * chat (DataSecurityActionRunner): the MCP server reads it to tell its agent
 * not to retry, but to send the person to the page the refusal names.
 */
export const ASKS_IN_EVERY_MODE_REFUSAL_PREFIX: string =
  "Not done: OneUptime asks a person before this, in every mode.";

// What the agent is told to do next, after that refusal.
export const ASKS_IN_EVERY_MODE_SUGGESTION: string =
  "Do not retry this tool, and do not make the same change another way. Tell the person it needs their approval in OneUptime, and give them the page the error names: its own button, or Ask AI there, shows them the change first.";

/*
 * What a project API key is told when it asks one of them to change
 * something: each acts as the person signed in, with their permissions -
 * the rule is theirs, the decision is on the record in their name - and a
 * key is no person. The MCP server says it before any request, and the
 * route says it again, in the same words. The two reads answer a key.
 */
export function getDataSecurityActionApiKeyRefusal(action: string): string {
  return `${action} acts as the person signed in to OneUptime, as Data Security's buttons do: what it changes is changed with their permissions, and its record says they did it. A project API key is not a person, so it cannot change Data Security. Connect this MCP client by signing in to OneUptime (OAuth) to use it.`;
}
