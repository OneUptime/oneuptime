/*
 * A WORKFLOW'S VERSION HISTORY (issue #6188).
 *
 * The builder saves a workflow a second after every change, so a mistake is
 * saved before anyone can take it back. Every save of a workflow's graph -
 * from the builder, Ask AI or the API - is therefore kept as a version: the
 * graph as it was saved, who saved it, when, and what it changed in the
 * lines the audit log uses (Utils/Workflow/WorkflowGraphChanges). The
 * builder's Version history lists them, shows any of them, and restores one.
 *
 * Autosave writes many times a minute, and a version for every save would
 * bury the ones worth going back to. So the saves one person makes in a
 * short while are one version: a version takes in the next save while it
 * is the newest, was started by the same person less than
 * WORKFLOW_VERSION_GROUPING_MINUTES ago, and changed the workflow (rather
 * than created, restored, or recorded it as it was). Anything else starts a
 * new version.
 *
 * A save that puts back the graph of an earlier version - Restore in the
 * Version history, or Undo back past a version - is a version of its own
 * that says which one it put back (Restored). Restoring is a change like any
 * other: it can be undone, and the version it replaced can be restored again.
 *
 * Only the newest WORKFLOW_VERSIONS_KEPT versions of a workflow are kept; the
 * oldest goes when a version is added. Deleting a workflow deletes its
 * versions with it.
 */

export enum WorkflowVersionType {
  // The workflow as it was created: from scratch, a template, an import or a copy.
  Created = "Created",
  // Changes saved in the builder, by Ask AI or through the API.
  Changed = "Changed",
  // An earlier version put back (restoredFromVersionNumber says which).
  Restored = "Restored",
  /*
   * The workflow as it was when version history began: saved before OneUptime
   * kept versions, so who saved it and what it changed are not known.
   */
  Earlier = "Earlier",
}

export const WORKFLOW_VERSION_TYPES: ReadonlyArray<WorkflowVersionType> = [
  WorkflowVersionType.Created,
  WorkflowVersionType.Changed,
  WorkflowVersionType.Restored,
  WorkflowVersionType.Earlier,
];

// How many of a workflow's versions are kept: the newest.
export const WORKFLOW_VERSIONS_KEPT: number = 100;

// How long the saves one person makes stay one version, from its first save.
export const WORKFLOW_VERSION_GROUPING_MINUTES: number = 10;

export const WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS: number =
  WORKFLOW_VERSION_GROUPING_MINUTES * 60 * 1000;

export const isWorkflowVersionType: (
  value: unknown,
) => value is WorkflowVersionType = (
  value: unknown,
): value is WorkflowVersionType => {
  return (
    typeof value === "string" &&
    (WORKFLOW_VERSION_TYPES as ReadonlyArray<string>).includes(value)
  );
};
