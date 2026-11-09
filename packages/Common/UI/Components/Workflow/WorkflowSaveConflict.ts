import { WorkflowSaveConflict } from "./WorkflowAutosave";
import { WORKFLOW_VERSION_LINES_SHOWN } from "./WorkflowVersionPresentation";
import { translationKey } from "../../Utils/TranslateTemplate";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import {
  WorkflowComponentLookup,
  WorkflowGraphChanges,
  getWorkflowGraphChanges,
} from "../../../Utils/Workflow/WorkflowGraphChanges";

/*
 * WHEN SOMEONE ELSE SAVED THE WORKFLOW FIRST (issue #6257): the builder's
 * save was made to an older graph, and the server refused it rather than let
 * it replace their change unseen (WorkflowService, 409 Conflict). The
 * builder says so in plain words, lists what they changed, and lets the
 * person choose - their changes on the canvas, which Undo takes back, or
 * their own saved over them, which leaves theirs in the version history.
 * Nothing is lost either way. React-free, for the dialog to draw and a test
 * to read.
 */

export const WorkflowSaveConflictCopy: {
  readonly title: string;
  readonly description: string;
  readonly theirChangesTitle: string;
  readonly note: string;
  readonly showTheirChanges: string;
  readonly keepMine: string;
} = {
  title: translationKey("Someone else changed this workflow"),
  description: translationKey(
    "It was saved after you opened it, so your latest change is not saved yet.",
  ),
  theirChangesTitle: translationKey("What they changed:"),
  note: translationKey(
    "Nothing is lost either way. Show their changes puts their version on the canvas, and Undo brings yours back. Keep mine saves your version, and theirs stays in Version history.",
  ),
  showTheirChanges: translationKey("Show their changes"),
  keepMine: translationKey("Keep mine"),
};

/*
 * Whether a save was refused because the workflow was saved by someone else
 * since the graph it was made to: the server's 409 Conflict.
 */
export const isWorkflowSaveConflict: (error: unknown) => boolean = (
  error: unknown,
): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { statusCode?: unknown }).statusCode ===
      ExceptionCode.ConflictException
  );
};

/*
 * What they changed, as the version history says it: the lines from the
 * graph the change on the canvas was made to, to theirs - moves included -
 * the first few of them, and how many more.
 */
export const getWorkflowSaveConflictLines: (data: {
  conflict: WorkflowSaveConflict;
  lookup: WorkflowComponentLookup;
}) => { lines: Array<string>; moreCount: number } = (data: {
  conflict: WorkflowSaveConflict;
  lookup: WorkflowComponentLookup;
}): { lines: Array<string>; moreCount: number } => {
  const changes: WorkflowGraphChanges = getWorkflowGraphChanges({
    before: data.conflict.base,
    after: data.conflict.theirs,
    lookup: data.lookup,
    includeMoves: true,
  });

  const lines: Array<string> = changes.lines.slice(
    0,
    WORKFLOW_VERSION_LINES_SHOWN,
  );
  const total: number = Math.max(changes.totalChanges, changes.lines.length);

  return {
    lines,
    moreCount: Math.max(0, total - lines.length),
  };
};
