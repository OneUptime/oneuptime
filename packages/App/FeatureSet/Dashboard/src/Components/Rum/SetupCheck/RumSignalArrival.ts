import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { RumKindRefusal } from "./RumIngestRefusals";
import { RumPanelSignal } from "./RumSignalWords";

/*
 * THE LAST STEP OF "SET UP LOGS" AND "SET UP EXCEPTIONS": WAITING FOR THE
 * FIRST ONE TO ARRIVE (issue #6379).
 *
 * The dialogs showed the snippet and stopped there, so the reader deployed
 * it and had to go and look for themselves. The step now watches the
 * application: every RUM_SIGNAL_ARRIVAL_POLL_MS it reads when the signal
 * last arrived - the application's logsLastReceivedAt, or its newest
 * exception - and says so once one has. After a few minutes with nothing,
 * it says what to check, the refusal first when what carries the signal is
 * being refused; after RUM_SIGNAL_ARRIVAL_STOP_AFTER_MS it stops asking
 * until the reader asks it to look again. Closing the dialog stops it.
 *
 * Pure, so a node test walks every state: the reads are the watch's
 * (RumSignalArrivalWatch).
 */

// How often the step looks, while the dialog is open.
export const RUM_SIGNAL_ARRIVAL_POLL_MS: number = 10 * 1000;

// How long it waits before saying what to check.
export const RUM_SIGNAL_ARRIVAL_HINT_AFTER_MS: number = 3 * 60 * 1000;

// How long it looks before it stops asking, unless asked again.
export const RUM_SIGNAL_ARRIVAL_STOP_AFTER_MS: number = 15 * 60 * 1000;

/*
 * Ingest stamps an arrival at most once per fence window (five minutes,
 * RumApplicationService.markTelemetrySignalReceived), so a stamp this
 * recent is the signal arriving now, even when the stamp did not move
 * since the step first looked.
 */
export const RUM_SIGNAL_ARRIVING_WINDOW_MS: number = 6 * 60 * 1000;

export type RumSignalArrivalState =
  // No answer yet.
  | "checking"
  // Nothing new yet, within the first few minutes.
  | "waiting"
  // The signal arrives.
  | "arrived"
  // Nothing after a few minutes: what to check.
  | "nothing-yet"
  // What carries the signal is refused: why, and the fix.
  | "refused"
  /*
   * Stopped looking: nothing arrived in RUM_SIGNAL_ARRIVAL_STOP_AFTER_MS.
   * A refusal still speaks, beside Check again.
   */
  | "stopped"
  // The last look failed, before anything arrived.
  | "failed";

export interface RumSignalArrivalFacts {
  // When the step started looking (the dialog opened, or Check again).
  startedAt: Date;
  now: Date;
  // When the signal last arrived, at the step's first answer; undefined before it.
  baseline: Date | null | undefined;
  // When it last arrived, at the latest answer; undefined before the first.
  latest: Date | null | undefined;
  // Whether the latest look failed.
  lastLookFailed: boolean;
  // What carries the signal is refused, if anything speaks for the app.
  refusal: RumKindRefusal | null;
}

function timeOf(date: Date | null | undefined): number | null {
  if (!date) {
    return null;
  }

  const ms: number = date.getTime();

  return Number.isNaN(ms) ? null : ms;
}

// Whether the signal has arrived since the step started looking, or arrives now.
export function hasRumSignalArrived(data: {
  baseline: Date | null | undefined;
  latest: Date | null | undefined;
  now: Date;
}): boolean {
  const latest: number | null = timeOf(data.latest);

  if (latest === null) {
    return false;
  }

  const baseline: number | null = timeOf(data.baseline);

  if (baseline === null || latest > baseline) {
    return true;
  }

  return data.now.getTime() - latest <= RUM_SIGNAL_ARRIVING_WINDOW_MS;
}

export function getRumSignalArrivalState(
  facts: RumSignalArrivalFacts,
): RumSignalArrivalState {
  if (
    hasRumSignalArrived({
      baseline: facts.baseline,
      latest: facts.latest,
      now: facts.now,
    })
  ) {
    return "arrived";
  }

  const waited: number = facts.now.getTime() - facts.startedAt.getTime();

  // Bounded: an open dialog does not look for ever.
  if (waited >= RUM_SIGNAL_ARRIVAL_STOP_AFTER_MS) {
    return "stopped";
  }

  if (facts.refusal?.state === "refused") {
    return "refused";
  }

  if (facts.lastLookFailed) {
    return "failed";
  }

  if (facts.latest === undefined) {
    return "checking";
  }

  return waited >= RUM_SIGNAL_ARRIVAL_HINT_AFTER_MS ? "nothing-yet" : "waiting";
}

// Whether the step keeps looking in this state.
export function isRumSignalArrivalWatching(
  state: RumSignalArrivalState,
): boolean {
  return state !== "arrived" && state !== "stopped";
}

/* ---------------------------------------------------------------- Words */

export const ARRIVAL_STEP_TITLE: Readonly<Record<RumPanelSignal, string>> = {
  logs: translationKey("Wait for the first log"),
  exceptions: translationKey("Wait for the first exception"),
};

export const ARRIVAL_STEP_DESCRIPTION: Readonly<
  Record<RumPanelSignal, string>
> = {
  logs: translationKey(
    "Deploy the change and load a page of your site. This step says when the first log arrives.",
  ),
  exceptions: translationKey(
    "Deploy the change and open a page that throws an error. This step says when the first exception arrives.",
  ),
};

export const ARRIVAL_WAITING: Readonly<Record<RumPanelSignal, string>> = {
  logs: translationKey("Waiting for the first log from {{application}}…"),
  exceptions: translationKey(
    "Waiting for the first exception from {{application}}…",
  ),
};

export const ARRIVAL_ARRIVED: Readonly<Record<RumPanelSignal, string>> = {
  logs: translationKey(
    "Logs are arriving from {{application}}. The latest arrived {{time}}.",
  ),
  exceptions: translationKey(
    "Exceptions are arriving from {{application}}. The latest was seen {{time}}.",
  ),
};

export const ARRIVAL_NOTHING_YET: Readonly<Record<RumPanelSignal, string>> = {
  logs: translationKey(
    "Nothing has arrived yet. Check that the change is deployed and that a page was loaded since, and that the browser's Network tab shows requests to /otlp/v1/logs.",
  ),
  exceptions: translationKey(
    "Nothing has arrived yet. Check that the change is deployed and that a page threw an error since, and that the browser's Network tab shows requests to /otlp/v1/traces.",
  ),
};

export const ARRIVAL_STOPPED: string = translationKey(
  "Nothing has arrived, so this step stopped checking. Check again once the change is deployed.",
);

export const ARRIVAL_FAILED: string = translationKey(
  "Couldn't check just now. Trying again in a few seconds.",
);

export const ARRIVAL_CHECK_AGAIN: string = translationKey("Check again");

// A refusal whose fix is a key, where step 1 of this dialog picks one.
export const ARRIVAL_PICK_ANOTHER_KEY: string = translationKey(
  "Pick another key in step 1, and deploy with it.",
);
