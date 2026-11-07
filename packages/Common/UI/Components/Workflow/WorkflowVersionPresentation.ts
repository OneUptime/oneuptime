import { PluralTemplate, translationKey } from "../../Utils/TranslateTemplate";
import { WorkflowVersionType } from "../../../Types/Workflow/WorkflowVersion";

/*
 * WHAT THE VERSION HISTORY SAYS OF EACH VERSION: its title, what made it, who
 * saved it, and which of them may be restored (issue #6188). The change lines
 * are the server's (WorkflowVersionService), in English, as the audit log
 * shows them: a step's title and its settings' names are the step's own.
 * React-free, for the panel to draw and a test to read.
 */

export const WorkflowVersionCopy: {
  readonly openButton: string;
  readonly panelTitle: string;
  readonly panelDescription: string;
  readonly versionTitle: string;
  readonly current: string;
  readonly created: string;
  readonly restored: string;
  readonly earlier: string;
  readonly changedWithoutLines: string;
  readonly savedWithoutPerson: string;
  readonly moreChanges: PluralTemplate;
  readonly preview: string;
  readonly showMore: string;
  readonly noVersions: string;
  readonly previewChangesTitle: string;
  readonly sameAsNow: string;
  readonly restoreButton: string;
  readonly restoreNote: string;
  readonly previewReadOnly: string;
  readonly previewRunRefused: string;
} = {
  openButton: translationKey("Version history"),
  panelTitle: translationKey("Version history"),
  panelDescription: translationKey(
    "Every saved version of this workflow, newest first. Changes you save within 10 minutes of each other are one version, and the newest 100 versions are kept.",
  ),
  versionTitle: translationKey("Version {{number}}"),
  current: translationKey("Current"),
  created: translationKey("Created the workflow"),
  restored: translationKey("Restored version {{number}}"),
  earlier: translationKey("The workflow before version history began"),
  changedWithoutLines: translationKey("Changed the workflow"),
  savedWithoutPerson: translationKey("Saved through the API"),
  moreChanges: {
    one: translationKey("And {{count}} more change"),
    other: translationKey("And {{count}} more changes"),
  },
  preview: translationKey("Preview"),
  showMore: translationKey("Show more"),
  noVersions: translationKey(
    "No versions yet. Every change you make from now on is kept here.",
  ),
  previewChangesTitle: translationKey(
    "Restoring this version makes these changes:",
  ),
  sameAsNow: translationKey(
    "This version is the same as the workflow on the canvas.",
  ),
  restoreButton: translationKey("Restore this version"),
  restoreNote: translationKey(
    "Restoring saves it as a new version, so you can undo it, and the workflow as it is now stays in the history.",
  ),
  previewReadOnly: translationKey(
    "This is an earlier version of the workflow. Restore it to make changes to it.",
  ),
  previewRunRefused: translationKey(
    "An earlier version does not run. Restore it to run it.",
  ),
};

// How many of a version's change lines its row shows; the rest are counted.
export const WORKFLOW_VERSION_LINES_SHOWN: number = 5;

// How many versions the panel lists at a time.
export const WORKFLOW_VERSIONS_PER_PAGE: number = 20;

// What the version history reads of a version.
export interface WorkflowVersionRow {
  versionNumber: number;
  versionType: WorkflowVersionType | string | undefined;
  changes: Array<string>;
  changeCount: number;
  restoredFromVersionNumber: number | null;
  // Who saved it, by name or email, or "" for nobody known.
  savedBy: string;
}

// A sentence, and the version number it names, if it names one.
export interface WorkflowVersionText {
  template: string;
  versionNumber?: number | undefined;
}

/*
 * The line that says what made a version, above its changes, or null for a
 * version whose changes say it all.
 */
export const getWorkflowVersionHeadline: (
  row: WorkflowVersionRow,
) => WorkflowVersionText | null = (
  row: WorkflowVersionRow,
): WorkflowVersionText | null => {
  if (row.versionType === WorkflowVersionType.Created) {
    return { template: WorkflowVersionCopy.created };
  }

  if (row.versionType === WorkflowVersionType.Earlier) {
    return { template: WorkflowVersionCopy.earlier };
  }

  if (
    row.versionType === WorkflowVersionType.Restored &&
    typeof row.restoredFromVersionNumber === "number"
  ) {
    return {
      template: WorkflowVersionCopy.restored,
      versionNumber: row.restoredFromVersionNumber,
    };
  }

  if (row.changes.length === 0) {
    return { template: WorkflowVersionCopy.changedWithoutLines };
  }

  return null;
};

// The change lines a row shows, and how many more it only counts.
export const getWorkflowVersionLines: (row: WorkflowVersionRow) => {
  lines: Array<string>;
  moreCount: number;
} = (
  row: WorkflowVersionRow,
): {
  lines: Array<string>;
  moreCount: number;
} => {
  /*
   * The server cuts a long list to 25 lines, the last saying how many more
   * ("and 40 more changes"); a row shows fewer, and counts the rest itself.
   */
  const lines: Array<string> = row.changes.slice(
    0,
    WORKFLOW_VERSION_LINES_SHOWN,
  );
  const total: number = Math.max(row.changeCount, row.changes.length);

  return {
    lines,
    moreCount: Math.max(0, total - lines.length),
  };
};

export type WorkflowVersionSavedBy =
  | { person: string }
  | { sentence: string }
  | null;

/*
 * Who saved a version: a person, by name; nobody to name for the workflow as
 * it was before version history began; and otherwise the API (an API key
 * saves as nobody).
 */
export const getWorkflowVersionSavedBy: (
  row: WorkflowVersionRow,
) => WorkflowVersionSavedBy = (
  row: WorkflowVersionRow,
): WorkflowVersionSavedBy => {
  if (row.savedBy) {
    return { person: row.savedBy };
  }

  if (row.versionType === WorkflowVersionType.Earlier) {
    return null;
  }

  return { sentence: WorkflowVersionCopy.savedWithoutPerson };
};

/*
 * Whether a version's row offers to preview (and from there restore) it:
 * every version but the newest, which is the workflow as it is.
 */
export const canPreviewWorkflowVersion: (data: {
  versionNumber: number;
  newestVersionNumber: number | null;
}) => boolean = (data: {
  versionNumber: number;
  newestVersionNumber: number | null;
}): boolean => {
  return (
    data.newestVersionNumber === null ||
    data.versionNumber !== data.newestVersionNumber
  );
};
