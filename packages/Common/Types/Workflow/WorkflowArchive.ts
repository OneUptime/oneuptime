/*
 * What an archived workflow says when something tries to run it.
 *
 * An archived workflow never runs, from any trigger: the queue refuses to
 * start a run (QueueWorkflow.addWorkflowToQueue - a manual run, "Run this
 * step", a webhook, a model event, an incoming email and the Run Workflow
 * step all go through it), its schedule is unregistered, and a run that was
 * already queued or sleeping is stopped by the runner. Kept in one place so
 * the API error, the run log and the tests all say the same thing.
 */

// The error a manual run, a webhook call or a Run Workflow step gets back.
export const WORKFLOW_ARCHIVED_RUN_REFUSED_MESSAGE: string =
  "This workflow is archived, so it does not run. Unarchive it to run it again.";

// Written into the log of a run that was queued before the workflow was archived.
export const WORKFLOW_ARCHIVED_BEFORE_RUN_MESSAGE: string =
  "Workflow was archived before this run started, so it did not run.";

// Written into the log of a run that was sleeping when the workflow was archived.
export const WORKFLOW_ARCHIVED_WHILE_WAITING_MESSAGE: string =
  "Workflow was archived while it was waiting. Cancelling the run.";
