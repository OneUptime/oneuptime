import {
  CloudSavingsActionKind,
  CloudSavingsTarget,
} from "../../../Types/Cloud/CloudSavingsAction";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
} from "../CloudConnection/CloudConnectorTypes";

/*
 * ONE CHANGE TO A CLOUD FOR A SAVING, MADE IN STEPS (#11010).
 *
 * Most changes are one call: stop an instance, release an address, delete
 * a snapshot. Some wait on the cloud between calls: a disk is deleted only
 * once its final snapshot is complete, and an instance is resized only
 * once it has stopped. So each cloud's actions (Cloud/AwsSavingsActions,
 * AzureSavingsActions, GcpSavingsActions) take as many steps as they can
 * without waiting and say where they stopped (progress), kept on the
 * action's row; the runner (CloudSavingsActionRunner) takes the next step
 * a minute later, until the change is done or fails.
 *
 * Every step reads before it writes and changes only what is not already
 * so: run again after a failure for now, it does no more than once.
 */

// What a step is asked to do: the change, and where its earlier steps left it.
export interface CloudSavingsRun {
  // The action's id: what OneUptime tags the snapshot and the disk it makes with.
  actionId: string;
  kind: CloudSavingsActionKind;
  target: CloudSavingsTarget;
  // What it becomes: a size, a database class, a volume type.
  to?: string | undefined;
  // A disk: whether a final snapshot is taken before it is deleted.
  finalSnapshot?: boolean | undefined;
  progress: CloudSavingsProgress;
}

/*
 * Taking a change back: its own steps (progress, kept apart from the
 * change's), and what the change did, as its steps kept it - the size it
 * was, the final snapshot it took - which is what undo puts back.
 */
export interface CloudSavingsUndoRun extends CloudSavingsRun {
  applied: CloudSavingsProgress;
}

/*
 * Where a change is, kept on the action between steps (as JSON), and what
 * undo needs to put it back.
 */
export interface CloudSavingsProgress {
  // The next step; the first when absent.
  step?: string | undefined;
  // What it was before: a size, a class, a volume type. What undo puts back.
  previous?: string | undefined;
  // An instance that was running before it was stopped to be resized: started again after.
  wasRunning?: boolean | undefined;
  // The final snapshot taken before a disk was deleted.
  snapshotId?: string | undefined;
  // What the deleted disk was, to make it again from its snapshot.
  disk?: JSONObject | undefined;
  // The disk undo made again from the snapshot.
  restoredId?: string | undefined;
  // How many times a step has waited: one that waits too long fails.
  waits?: number | undefined;
}

export interface CloudSavingsStepContext {
  settings: CloudConnectionSettings;
  connectionId: ObjectID;
  transport?: CloudConnectorTransport | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
}

export interface CloudSavingsStepOutcome {
  // "done": made (or already so). "waiting": the cloud is still at it; ask again in a minute.
  state: "done" | "waiting";
  // Whether anything in the cloud changed.
  changed: boolean;
  // What was done, in a sentence the timeline shows.
  summary: string;
  progress: CloudSavingsProgress;
}

/*
 * The most times a change waits on its cloud, a minute apart, before it
 * fails: an hour - a snapshot of a large disk can take that long.
 */
export const CLOUD_SAVINGS_MAX_WAITS: number = 60;

export function waiting(
  progress: CloudSavingsProgress,
  summary: string,
): CloudSavingsStepOutcome {
  return {
    state: "waiting",
    changed: true,
    summary,
    progress: { ...progress, waits: (progress.waits || 0) + 1 },
  };
}

export function done(data: {
  progress: CloudSavingsProgress;
  summary: string;
  changed: boolean;
}): CloudSavingsStepOutcome {
  return {
    state: "done",
    changed: data.changed,
    summary: data.summary,
    progress: { ...data.progress, step: "done" },
  };
}

/*
 * The name OneUptime gives a final snapshot of a disk: what each cloud
 * takes as a name (Google Cloud's is the strictest - lower case letters,
 * digits and hyphens, a letter first, at most 63), and the action's id
 * after it, since a project's snapshot names are one namespace and a disk
 * of the same name can be deleted twice.
 */
export function getFinalSnapshotName(
  diskName: string,
  actionId: string,
): string {
  const disk: string = (diskName || "disk")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 36);
  const suffix: string = (actionId || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 8);

  return `oneuptime-final-${disk}-${suffix}`
    .replace(/-+/g, "-")
    .replace(/-$/, "");
}
