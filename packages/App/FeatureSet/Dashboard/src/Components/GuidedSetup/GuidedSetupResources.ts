import Route from "Common/Types/API/Route";
import {
  GuidedSetupResourceProgress,
  GuidedSetupResourceStatus,
} from "Common/Types/GuidedSetup/GuidedSetupRun";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A GUIDED SETUP MAKES, AS IT MAKES IT (#10276).
 *
 * "When a monitor is created, I should see the resource being created ...
 * the same with the on-call policy as well. Show me on the side the
 * resources created and the status." A setup's steps each save records - a
 * monitor, an on-call policy with its escalation rule and the rules that
 * run it, a test page - and the setup's panel (GuidedSetupResourcePanel)
 * lists each one under the step that makes it: waiting for its step, being
 * made, made (with a link to it), there already, skipped, or failed and why,
 * with Try again. The person always knows what exists and what to do next.
 *
 * A setup says what each record is from what its page knows now and what
 * its run kept (GuidedSetupRunStore's resources, kept on the server, #7253):
 * getGuidedSetupResourceStatus. So a reload, or another device, draws the
 * same panel, and a record made, then deleted elsewhere, is never said to
 * be there.
 *
 * React-free, so the tests read it without a page.
 */

export interface GuidedSetupResourceRow {
  // A word the code chooses: "monitor", "on_call_policy".
  key: string;
  // The step that makes it: the panel lists it under that step.
  stepKey: string;
  // What kind of record it is, in English, looked up by the panel: "Monitor".
  kind: string;
  // What it is called, as its project named it: drawn as written.
  name?: string | undefined;
  // One line on what it does or how it is doing, in the reader's words.
  detail?: string | undefined;
  status: GuidedSetupResourceStatus;
  /*
   * A word that says more than the status's own, in English, looked up by
   * the panel: a test page "Sent", then "Acknowledged".
   */
  statusText?: string | undefined;
  // Why it failed, as API.getFriendlyMessage said it.
  error?: string | undefined;
  // Where it is, once it exists: the panel's Open.
  route?: Route | undefined;
  // Tries the step's request again, on a failure.
  onRetry?: (() => void) | undefined;
}

// The words each status is said in, in English (looked up where drawn).
export const GUIDED_SETUP_RESOURCE_STATUS_WORDS: Readonly<
  Record<GuidedSetupResourceStatus, string>
> = {
  [GuidedSetupResourceStatus.Waiting]: translationKey("Waiting"),
  [GuidedSetupResourceStatus.Creating]: translationKey("Creating…"),
  [GuidedSetupResourceStatus.Created]: translationKey("Created"),
  [GuidedSetupResourceStatus.Existing]: translationKey("In use"),
  [GuidedSetupResourceStatus.Failed]: translationKey("Failed"),
  [GuidedSetupResourceStatus.Skipped]: translationKey("Skipped"),
};

/*
 * Each status's chip (Docs/ux/README.md#one-control-for-one-job): made or
 * in use works, being made is worth knowing, failed broke, and skipped is
 * the person's own choice - grey, never red.
 */
export const GUIDED_SETUP_RESOURCE_STATUS_TONES: Readonly<
  Record<GuidedSetupResourceStatus, PillTone>
> = {
  [GuidedSetupResourceStatus.Waiting]: PillTone.Neutral,
  [GuidedSetupResourceStatus.Creating]: PillTone.Info,
  [GuidedSetupResourceStatus.Created]: PillTone.Success,
  [GuidedSetupResourceStatus.Existing]: PillTone.Success,
  [GuidedSetupResourceStatus.Failed]: PillTone.Danger,
  [GuidedSetupResourceStatus.Skipped]: PillTone.Paused,
};

/*
 * A request a run kept as out, with nothing out on this page: one another
 * device is making right now while it is this new, and one that stopped
 * when its page closed once it is older.
 */
export const GUIDED_SETUP_RESOURCE_INTERRUPTED_AFTER_MS: number = 2 * 60 * 1000;

// What a record that stopped being made says, with Try again beside it.
export const GUIDED_SETUP_RESOURCE_INTERRUPTED: string = translationKey(
  "This was being made when its page closed. Try again: nothing is made twice.",
);

export interface GuidedSetupResourceState {
  status: GuidedSetupResourceStatus;
  // Why it failed, in the reader's words or the server's.
  error?: string | undefined;
  /*
   * The failure is GUIDED_SETUP_RESOURCE_INTERRUPTED, in English: the panel
   * looks it up.
   */
  isInterrupted?: boolean | undefined;
}

/*
 * What the panel says of one record, first what the page knows now, then
 * what the run kept:
 *
 *   - a request for it is out on this page: being made;
 *   - it exists: there already when the run went on with one it found
 *     (`isExisting`), made by this run otherwise;
 *   - the person skipped its step: skipped;
 *   - the run kept a failure: failed, with why;
 *   - the run kept a request as out with none out here: being made on
 *     another device while it is new, stopped when its page closed after;
 *   - anything else: waiting for its step.
 *
 * A record the run kept as made that no longer exists is waiting again:
 * its step is to do again.
 */
export const getGuidedSetupResourceStatus: (data: {
  isWorking?: boolean | undefined;
  exists: boolean;
  isExisting?: boolean | undefined;
  isSkipped?: boolean | undefined;
  progress?: GuidedSetupResourceProgress | undefined;
  now?: Date | undefined;
}) => GuidedSetupResourceState = (data: {
  isWorking?: boolean | undefined;
  exists: boolean;
  isExisting?: boolean | undefined;
  isSkipped?: boolean | undefined;
  progress?: GuidedSetupResourceProgress | undefined;
  now?: Date | undefined;
}): GuidedSetupResourceState => {
  if (data.isWorking) {
    return { status: GuidedSetupResourceStatus.Creating };
  }

  if (data.exists) {
    return {
      status: data.isExisting
        ? GuidedSetupResourceStatus.Existing
        : GuidedSetupResourceStatus.Created,
    };
  }

  if (data.isSkipped) {
    return { status: GuidedSetupResourceStatus.Skipped };
  }

  const progress: GuidedSetupResourceProgress | undefined = data.progress;

  if (progress?.status === GuidedSetupResourceStatus.Failed) {
    return {
      status: GuidedSetupResourceStatus.Failed,
      error: progress.error,
    };
  }

  if (progress?.status === GuidedSetupResourceStatus.Creating) {
    const at: number = Date.parse(progress.at);
    const now: number = (data.now || new Date()).getTime();

    if (
      Number.isFinite(at) &&
      now - at < GUIDED_SETUP_RESOURCE_INTERRUPTED_AFTER_MS
    ) {
      return { status: GuidedSetupResourceStatus.Creating };
    }

    return {
      status: GuidedSetupResourceStatus.Failed,
      error: GUIDED_SETUP_RESOURCE_INTERRUPTED,
      isInterrupted: true,
    };
  }

  return { status: GuidedSetupResourceStatus.Waiting };
};

/*
 * How many records are made or in use, of those the setup lists: the
 * panel's "2 of 5 ready". A skipped one is not to do, so it counts as
 * neither.
 */
export const countReadyResources: (
  rows: ReadonlyArray<GuidedSetupResourceRow>,
) => { ready: number; total: number } = (
  rows: ReadonlyArray<GuidedSetupResourceRow>,
): { ready: number; total: number } => {
  const counted: Array<GuidedSetupResourceRow> = rows.filter(
    (row: GuidedSetupResourceRow): boolean => {
      return row.status !== GuidedSetupResourceStatus.Skipped;
    },
  );

  return {
    ready: counted.filter((row: GuidedSetupResourceRow): boolean => {
      return (
        row.status === GuidedSetupResourceStatus.Created ||
        row.status === GuidedSetupResourceStatus.Existing
      );
    }).length,
    total: counted.length,
  };
};
