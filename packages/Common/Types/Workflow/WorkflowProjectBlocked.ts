/*
 * What a workflow of a blocked project says when a run of it is stopped.
 *
 * A project a master admin blocked (Admin Dashboard > Projects) runs no
 * workflow until it is unblocked: the queue refuses to start a run
 * (QueueWorkflow.addWorkflowToQueue - a manual run, a webhook, a model
 * event, an incoming email and the Run Workflow step all go through it,
 * and a webhook sender is told 403), and the runner stops a run that was
 * already queued, the next firing of a schedule, and a run waking from a
 * Sleep step. Its schedules stay registered, so they fire again once it is
 * unblocked.
 */

// Written into the log of a run that was queued or sleeping when the project was blocked.
export const WORKFLOW_PROJECT_BLOCKED_BEFORE_RUN_MESSAGE: string =
  "Workflow's project was blocked before this run finished, so it was cancelled.";
