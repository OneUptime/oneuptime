import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A RUNBOOK'S OVERVIEW OFFERS FIRST.
 *
 * A runbook runs only while it is turned on and has at least one step: Run
 * Now, a runbook rule, the schedule and the webhook are all refused
 * otherwise (Common/Server/Utils/Runbook/RunbookStarter). The Overview used
 * to offer a primary Run Now whatever the runbook was, so a new runbook -
 * created with no steps - opened on a button whose only answer was "Could
 * not start runbook: Runbook has no steps to run", over three cards of
 * zeros.
 *
 * Now the Overview says what is missing and offers the way on:
 *
 *   - no steps: the Activity card shows the first step - "No steps yet"
 *     and Add Steps, to the runbook's Steps page - and Run Now is not
 *     offered (there is nothing to run, and Add Steps is the one next
 *     step);
 *   - turned off: a quiet banner says so, with Turn on runbook, which saves
 *     what Run this runbook on the runbook's Settings saves; Run Now stays,
 *     locked, saying why.
 *
 * Kept free of React so the page and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export interface RunbookOverviewFacts {
  // Its Run this runbook switch is off (isEnabled false).
  isTurnedOff: boolean;
  // It has at least one step.
  hasSteps: boolean;
}

/*
 * Whether a runbook's steps column holds a step, the way the starter reads
 * it: a list with something in it.
 */
export function hasRunbookSteps(steps: unknown): boolean {
  return Array.isArray(steps) && steps.length > 0;
}

/*
 * The facts the Overview acts on, read from the runbook as it was fetched,
 * or null before it is. A runbook whose switch was never written counts as
 * on, as its column starts.
 */
export function getRunbookOverviewFacts(
  runbook: { isEnabled?: boolean | undefined; steps?: unknown } | null,
): RunbookOverviewFacts | null {
  if (!runbook) {
    return null;
  }

  return {
    isTurnedOff: runbook.isEnabled === false,
    hasSteps: hasRunbookSteps(runbook.steps),
  };
}

export const RunbookOverviewCopy: {
  readonly noStepsTitle: string;
  readonly noStepsDescription: string;
  readonly addStepsButton: string;
  readonly turnedOffTitle: string;
  readonly turnOnButton: string;
  readonly runNowTurnedOff: string;
} = {
  noStepsTitle: translationKey("No steps yet"),
  noStepsDescription: translationKey(
    "A runbook runs its steps in order. Add its first step to run it.",
  ),
  addStepsButton: translationKey("Add Steps"),
  turnedOffTitle: translationKey("This runbook is turned off"),
  turnOnButton: translationKey("Turn on runbook"),
  runNowTurnedOff: translationKey("Turn this runbook on to run it."),
};

/*
 * Whether the Overview offers Run Now at all: not while the runbook has no
 * step to run - Add Steps is the way on then. Offered before the runbook
 * has loaded, as it always was: the server decides.
 */
export function isRunNowOffered(facts: RunbookOverviewFacts | null): boolean {
  return !facts || facts.hasSteps;
}

/*
 * Why Run Now is locked, or undefined when it is not: who may not run
 * runbooks is told so first (the permission's own sentence), then a runbook
 * that is turned off says how to run it.
 */
export function getRunNowLockedReason(data: {
  permissionReason?: string | undefined;
  facts: RunbookOverviewFacts | null;
}): string | undefined {
  if (data.permissionReason) {
    return data.permissionReason;
  }

  if (data.facts?.isTurnedOff) {
    return RunbookOverviewCopy.runNowTurnedOff;
  }

  return undefined;
}

export const RUNBOOK_NO_STEPS_TEST_ID: string = "runbook-no-steps";
export const RUNBOOK_ADD_STEPS_BUTTON_TEST_ID: string = "runbook-add-steps";
export const RUNBOOK_TURNED_OFF_BANNER_TEST_ID: string = "runbook-turned-off";
export const RUNBOOK_TURN_ON_BUTTON_TEST_ID: string = "runbook-turn-on";
export const RUNBOOK_TURN_ON_ERROR_TEST_ID: string = "runbook-turn-on-error";
