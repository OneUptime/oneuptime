import Permission from "../Permission";

/*
 * Who may run a workflow by hand, and who may run one of its steps on its
 * own.
 *
 * Run Workflow (the Builder's button, POST /workflow/manual/run/:id) runs
 * the workflow as its editors built it: from its trigger, through every
 * condition. So it is open to everyone who may change the workflow, and to
 * Workflow Members, whose role is to use workflows rather than build them.
 *
 * Run just this step (POST /workflow/run-step/:id) runs one step on its own,
 * past every condition before it. It is a builder's test, and it can do
 * what the workflow as built never would, so it takes permission to change
 * the workflow: the Workflow model's update list.
 *
 * Both are held by the rule every permission check follows
 * (Types/HeldPermissions): only an allow row grants, a team's block with no
 * labels on any of these refuses, and Edit All Operational Resources counts,
 * as it does for saving the workflow. The workflow itself must then be one
 * the caller can see (a run) or change (a step) - their labels and owned
 * scope count (App/FeatureSet/Workflow/Utils/WorkflowRunAccess).
 *
 * Kept free of server and React code, so the server, the dashboard and the
 * tests read the same lists.
 */

/*
 * Who may change a workflow: the Workflow model's update list, in its order
 * (a test holds the two together).
 */
export const WORKFLOW_EDIT_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditWorkflow,
  Permission.WorkflowAdmin,
];

// The roles that run workflows without changing them.
export const WORKFLOW_RUN_ONLY_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.WorkflowMember,
];

// Who may run a whole workflow by hand.
export const WORKFLOW_RUN_PERMISSIONS: ReadonlyArray<Permission> = [
  ...WORKFLOW_EDIT_PERMISSIONS,
  ...WORKFLOW_RUN_ONLY_PERMISSIONS,
];

/*
 * The *AllOperationalResources wildcard both lists accept: a workflow is an
 * operational resource, and the wildcard that edits one runs it too.
 */
export const WORKFLOW_RUN_WILDCARD: Permission =
  Permission.EditAllOperationalResources;

// What a run that is refused says.
export const WORKFLOW_RUN_REFUSED_MESSAGE: string =
  "You do not have permission to run this workflow.";

// What a run of one step that is refused says, and who may.
export const WORKFLOW_STEP_RUN_REFUSED_MESSAGE: string =
  "Running one step on its own takes permission to edit this workflow.";
