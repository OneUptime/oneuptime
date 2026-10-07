import Permission from "../Permission";

/*
 * Who may run a runbook, and who may move one of its runs along - complete a
 * step it waits on, skip one, or cancel the run.
 *
 * Starting a run runs the project's own scripts on the infrastructure its
 * Runner is installed on, so it is RunbookExecution's create list, not
 * permission to see the runbook: Runbook Viewer reads runbooks and does not
 * run them. Runbook Member runs them and does not create, change or delete
 * them (Runbook's own lists leave it out); Runbook Admin does both.
 *
 * A role that runs runbooks runs the ones its grant reaches: its labels and
 * owned scope, and the blocks on it, decide which
 * (Server/Utils/Runbook/RunbookRunAccess) - as a Workflow Member's
 * grant decides which workflows they run. The granular permissions (Create
 * Runbook Execution, Edit Runbook Execution) are about runs, which carry no
 * labels, so they reach every runbook of the project.
 *
 * Kept free of server and React code, so the server, the dashboard and the
 * tests read the same lists.
 */

// Who may start a run: RunbookExecution's create list, in its order.
export const RUNBOOK_RUN_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateRunbookExecution,
  Permission.ProjectMember,
  Permission.RunbookAdmin,
  Permission.RunbookMember,
];

/*
 * Who may move a run along: whoever may start one, and Edit Runbook
 * Execution - the permission that ticks a run off without starting one.
 */
export const RUNBOOK_ADVANCE_PERMISSIONS: ReadonlyArray<Permission> = [
  ...RUNBOOK_RUN_PERMISSIONS,
  Permission.EditRunbookExecution,
];

/*
 * The run permissions that are roles reaching runbooks by their labels and
 * owned scope: each is on Runbook's read list too, so a read with these rows
 * alone finds exactly the runbooks they reach.
 */
export const RUNBOOK_RUN_ROLE_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.RunbookAdmin,
  Permission.RunbookMember,
];

/*
 * The granular run permissions: about runs, so they reach every runbook.
 * Edit Runbook Execution moves a run along and does not start one.
 */
export const RUNBOOK_RUN_GRANULAR_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.CreateRunbookExecution,
];

export const RUNBOOK_ADVANCE_GRANULAR_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.CreateRunbookExecution,
  Permission.EditRunbookExecution,
];

// What a refused start says.
export const RUNBOOK_RUN_REFUSED_MESSAGE: string =
  "You do not have permission to start runbook executions in this project.";

// What a refused complete, skip or cancel says.
export const RUNBOOK_ADVANCE_REFUSED_MESSAGE: string =
  "You do not have permission to change runbook executions in this project.";
