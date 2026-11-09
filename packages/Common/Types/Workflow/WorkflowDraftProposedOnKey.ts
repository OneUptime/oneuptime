/*
 * Where OneUptime writes what an Ask AI change to a workflow was proposed
 * on, in the change's own arguments (issue #6274, WorkflowDraftRebase): the
 * approval is checked against it, and the approval card and the exports
 * leave it out (AIChatTypes). A module of its own, importing nothing, so
 * anything can read the key without loading the workflow code behind it.
 */
export const WORKFLOW_DRAFT_PROPOSED_ON_KEY: string = "proposedOn";
