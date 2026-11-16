/*
 * WORKFLOWS AND PRIVATE RECORDS (#8914).
 *
 * A workflow's steps act as a Project Admin of its project
 * (Server/Utils/Workflow/WorkflowPrincipal), but are never lent a Project
 * Admin's sight of private incidents, alerts and episodes: whoever builds a
 * workflow decides where what its steps read goes - a webhook, an email, a
 * chat, its own run log - and anyone who may create a workflow (a Project
 * Member) may build one, including someone who may not see a private record,
 * or whose team that owns it may only view it. So:
 *
 *   - a workflow does not start on a private incident, alert or episode,
 *     nor on anything of one - its notes, its state changes, its owners, a
 *     page about it, a runbook run linked to it - whether a record event or
 *     Run Workflow starts it;
 *   - its Find steps do not find one, and its Update, Delete and Create
 *     steps change none and add nothing to one (Server/Utils/PrivacyFilterUtil
 *     .shouldBypassRecordPrivacy);
 *   - Run Workflow does not offer one to run with.
 *
 * Kept free of server and React code, so the server, the dashboard and the
 * tests read the same words.
 */

// What a workflow's run log says when it was started on such a record.
export function getWorkflowPrivateRecordRefusal(singularName: string): string {
  return `This ${singularName.toLowerCase()} was not found, or it is private or part of a private record. ${WORKFLOW_PRIVATE_RECORDS_SENTENCE}`;
}

// Why, in one sentence: the docs and the Builder say it in these words.
export const WORKFLOW_PRIVATE_RECORDS_SENTENCE: string =
  "Workflows don't act on private incidents, alerts or episodes, or on anything that belongs to one.";
