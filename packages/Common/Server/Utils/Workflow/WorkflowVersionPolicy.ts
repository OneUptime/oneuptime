import WriteSource from "../../../Types/BaseDatabase/WriteSource";
import {
  WORKFLOW_VERSIONS_KEPT,
  WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS,
  WorkflowVersionType,
} from "../../../Types/Workflow/WorkflowVersion";

/*
 * WHAT A SAVE OF A WORKFLOW'S GRAPH DOES TO ITS VERSION HISTORY, decided
 * from the newest version and the graph saved (Types/Workflow/WorkflowVersion
 * says why). WorkflowVersionService reads what this needs and writes what it
 * decides. Pure: no database, no clock of its own.
 *
 * In this order, so the first that applies wins:
 *
 *   1. The graph is the newest version's: nothing. A save that only selects a
 *      card or saves the graph again is no version.
 *   2. The graph is an earlier version's: a new Restored version naming it,
 *      never folded into the newest - whoever restores a version, or undoes
 *      back to one, sees that they did.
 *   3. The newest version is one person's changes, begun less than the
 *      grouping window ago, and the same person saves again by their own
 *      hand: it takes the save in. A change Ask AI saves for the person is
 *      never taken into their version, and nothing is taken into one of Ask
 *      AI's - not the person's next edit, not Ask AI's next change (issue
 *      #6258): each of its changes is a version of its own, so the version
 *      before it is the workflow just as Ask AI found it.
 *   4. Anything else is a new Changed version.
 */

// What the decision reads of the newest version.
export interface WorkflowVersionSeen {
  versionNumber: number;
  versionType: WorkflowVersionType | string | undefined;
  graphFingerprint: string | undefined;
  // Who saved it, as text (an ObjectID's string), or null for nobody.
  savedByUserId: string | null;
  /*
   * What saved it for that person, when it was not their own hand: Ask AI
   * (WriteSource). Null or absent for their own saves, and the API's.
   */
  savedThrough?: WriteSource | string | null | undefined;
  // When its first save was made.
  createdAt: Date | undefined;
}

export enum WorkflowVersionWriteKind {
  // The graph is the newest version's.
  Nothing = "Nothing",
  // The newest version takes the save in: its graph and changes become the save's.
  TakeIntoNewest = "TakeIntoNewest",
  // A version of its own.
  Add = "Add",
}

export type WorkflowVersionWrite =
  | { kind: WorkflowVersionWriteKind.Nothing }
  | { kind: WorkflowVersionWriteKind.TakeIntoNewest }
  | {
      kind: WorkflowVersionWriteKind.Add;
      versionNumber: number;
      versionType: WorkflowVersionType.Changed | WorkflowVersionType.Restored;
      restoredFromVersionNumber: number | null;
    };

/*
 * Whether the newest version takes in a save by `savedByUserId` at `now`: it
 * holds one person's changes, that person saves again, and it began less
 * than the grouping window ago. A save by nobody - an API key - is always a
 * version of its own: there is no one to say the saves are one burst. So is
 * a save Ask AI makes for the person (`savedThrough`), and the save after a
 * version of Ask AI's: only the person's own saves are one burst.
 */
export const doesNewestVersionTakeInSave: (data: {
  newest: WorkflowVersionSeen;
  savedByUserId: string | null;
  savedThrough?: WriteSource | null | undefined;
  now: Date;
}) => boolean = (data: {
  newest: WorkflowVersionSeen;
  savedByUserId: string | null;
  savedThrough?: WriteSource | null | undefined;
  now: Date;
}): boolean => {
  if (data.newest.versionType !== WorkflowVersionType.Changed) {
    return false;
  }

  // Ask AI's change, or the first save after one: a version of its own.
  if (data.savedThrough || data.newest.savedThrough) {
    return false;
  }

  if (!data.savedByUserId || data.newest.savedByUserId !== data.savedByUserId) {
    return false;
  }

  if (!data.newest.createdAt) {
    return false;
  }

  const age: number = data.now.getTime() - data.newest.createdAt.getTime();

  // A version stamped after now (a clock that moved back) takes nothing in.
  return age >= 0 && age < WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS;
};

export const decideWorkflowVersionWrite: (data: {
  // The newest version, or null when the workflow has none yet.
  newest: WorkflowVersionSeen | null;
  // The fingerprint of the graph saved (WorkflowVersionService).
  graphFingerprint: string;
  /*
   * The newest version older than `newest` whose graph has that
   * fingerprint, or null when there is none.
   */
  earlierWithSameGraph: { versionNumber: number } | null;
  savedByUserId: string | null;
  // What saved it for that person, when it was not their own hand: Ask AI.
  savedThrough?: WriteSource | null | undefined;
  now: Date;
}) => WorkflowVersionWrite = (data: {
  newest: WorkflowVersionSeen | null;
  graphFingerprint: string;
  earlierWithSameGraph: { versionNumber: number } | null;
  savedByUserId: string | null;
  savedThrough?: WriteSource | null | undefined;
  now: Date;
}): WorkflowVersionWrite => {
  if (!data.newest) {
    return {
      kind: WorkflowVersionWriteKind.Add,
      versionNumber: 1,
      versionType: WorkflowVersionType.Changed,
      restoredFromVersionNumber: null,
    };
  }

  if (data.newest.graphFingerprint === data.graphFingerprint) {
    return { kind: WorkflowVersionWriteKind.Nothing };
  }

  const versionNumber: number = data.newest.versionNumber + 1;

  if (
    data.earlierWithSameGraph &&
    data.earlierWithSameGraph.versionNumber < data.newest.versionNumber
  ) {
    return {
      kind: WorkflowVersionWriteKind.Add,
      versionNumber,
      versionType: WorkflowVersionType.Restored,
      restoredFromVersionNumber: data.earlierWithSameGraph.versionNumber,
    };
  }

  if (
    doesNewestVersionTakeInSave({
      newest: data.newest,
      savedByUserId: data.savedByUserId,
      savedThrough: data.savedThrough,
      now: data.now,
    })
  ) {
    return { kind: WorkflowVersionWriteKind.TakeIntoNewest };
  }

  return {
    kind: WorkflowVersionWriteKind.Add,
    versionNumber,
    versionType: WorkflowVersionType.Changed,
    restoredFromVersionNumber: null,
  };
};

/*
 * The oldest version number kept once `newestVersionNumber` is written:
 * every version below it goes. Never below 1.
 */
export const getOldestWorkflowVersionKept: (
  newestVersionNumber: number,
  versionsKept?: number,
) => number = (
  newestVersionNumber: number,
  versionsKept: number = WORKFLOW_VERSIONS_KEPT,
): number => {
  return Math.max(1, newestVersionNumber - Math.max(1, versionsKept) + 1);
};
