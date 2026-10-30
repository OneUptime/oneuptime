import BadDataException from "../Exception/BadDataException";
import { JSONObject, JSONValue } from "../JSON";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
} from "./SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "./SecurityPlaybookRunStatus";

/*
 * BRANCHING: a step that runs only after an earlier step's result.
 *
 * A playbook stays a list read top to bottom; a step may wait on one
 * earlier step of the same playbook (`runIf`) and run only when that step:
 *
 *  - succeeded, or failed (a step that fails stops the run unless it
 *    carries on, so "failed" can be waited on only for one that does);
 *  - for a step that looks something up (getSecurityPlaybookFinds): found
 *    something, or found nothing - "contain only what threat intel knows
 *    is bad", and its else: "if it found nothing, leave a task to check".
 *
 * Two steps waiting on opposite results of one step are an if and an else.
 * A step whose condition does not hold is skipped, saying which result it
 * waited on, before it asks for an approval or acts on anything. A step
 * the one it waits on never reached (it was skipped, or the run ended
 * first) does not run either: nothing is contained on a result nobody saw.
 *
 * The condition names the earlier step by its id, so moving steps keeps
 * what each waits on; a playbook is refused on save when a step waits on
 * one that is not before it, on a result that step cannot have, or on the
 * failure of a step that stops the run (assertSecurityPlaybookStepConditions).
 */
export enum SecurityPlaybookStepOutcome {
  Succeeded = "Succeeded",
  Failed = "Failed",
  // A step that looks something up found it: a known-bad entity, activity.
  Found = "Found",
  // ...or looked, and found nothing.
  FoundNothing = "Found Nothing",
}

export interface SecurityPlaybookStepCondition {
  // The id of an earlier step of the same playbook.
  stepId: string;
  outcome: SecurityPlaybookStepOutcome;
}

/*
 * What a step that looks something up says it found, and that it found
 * nothing, as a later step's condition reads: "found a known-bad entity".
 */
export interface SecurityPlaybookFinds {
  found: string;
  foundNothing: string;
}

const FINDS_BY_ACTION: Partial<
  Record<SecurityPlaybookActionType, SecurityPlaybookFinds>
> = {
  [SecurityPlaybookActionType.CheckThreatIntel]: {
    found: "found a known-bad entity",
    foundNothing: "found nothing known-bad",
  },
  [SecurityPlaybookActionType.LookUpEntityActivity]: {
    found: "found activity",
    foundNothing: "found no activity",
  },
};

// The longest step id a condition keeps: an id, never a sentence.
const MAX_STEP_ID_LENGTH: number = 100;

/*
 * What a step of this action says it found, for an action that looks
 * something up; undefined for one that only does something.
 */
export function getSecurityPlaybookFinds(
  action: SecurityPlaybookActionType | string | undefined | null,
): SecurityPlaybookFinds | undefined {
  if (!action) {
    return undefined;
  }

  return FINDS_BY_ACTION[action as SecurityPlaybookActionType];
}

export function isSecurityPlaybookStepOutcome(
  value: unknown,
): value is SecurityPlaybookStepOutcome {
  return (
    typeof value === "string" &&
    (Object.values(SecurityPlaybookStepOutcome) as Array<string>).includes(
      value,
    )
  );
}

/*
 * The results a later step can wait on for a step of this action: found or
 * found nothing for one that looks something up, succeeded otherwise - and
 * failed for one that carries on when it fails, the only kind a later step
 * ever sees fail.
 */
export function getSecurityPlaybookStepOutcomes(step: {
  action: SecurityPlaybookActionType | string;
  continueOnFailure: boolean;
}): Array<SecurityPlaybookStepOutcome> {
  const outcomes: Array<SecurityPlaybookStepOutcome> = getSecurityPlaybookFinds(
    step.action,
  )
    ? [SecurityPlaybookStepOutcome.Found, SecurityPlaybookStepOutcome.FoundNothing]
    : [SecurityPlaybookStepOutcome.Succeeded];

  if (step.continueOnFailure) {
    outcomes.push(SecurityPlaybookStepOutcome.Failed);
  }

  return outcomes;
}

/*
 * A result in a few words, as a sentence about the step reads it:
 * "succeeded", "failed", "found a known-bad entity".
 */
export function describeSecurityPlaybookStepOutcome(
  action: SecurityPlaybookActionType | string,
  outcome: SecurityPlaybookStepOutcome,
): string {
  const finds: SecurityPlaybookFinds | undefined =
    getSecurityPlaybookFinds(action);

  switch (outcome) {
    case SecurityPlaybookStepOutcome.Found:
      return finds?.found || "found something";
    case SecurityPlaybookStepOutcome.FoundNothing:
      return finds?.foundNothing || "found nothing";
    case SecurityPlaybookStepOutcome.Failed:
      return "failed";
    default:
      return "succeeded";
  }
}

/*
 * A stored or posted condition, read. None (undefined) for a step that runs
 * always: no condition, null, or an empty one. One that is there but does
 * not read - no step, or a result that is not one - is refused, naming the
 * step: dropped instead, the step would run always, and a containment step
 * meant to wait on threat intel would contain on its own.
 */
export function readSecurityPlaybookStepCondition(
  value: JSONValue | undefined,
  label: string,
): SecurityPlaybookStepCondition | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadDataException(
      `${label}: when it runs is not something a playbook can read. Choose again when it runs.`,
    );
  }

  const record: JSONObject = value as JSONObject;
  const stepId: string =
    typeof record["stepId"] === "string" ? record["stepId"].trim() : "";
  const outcome: JSONValue | undefined = record["outcome"];

  if (!stepId && (outcome === undefined || outcome === null || outcome === "")) {
    return undefined;
  }

  if (!stepId || stepId.length > MAX_STEP_ID_LENGTH) {
    throw new BadDataException(
      `${label}: choose the earlier step it runs after.`,
    );
  }

  if (!isSecurityPlaybookStepOutcome(outcome)) {
    throw new BadDataException(
      `${label}: choose which result of the earlier step it runs after.`,
    );
  }

  return { stepId, outcome };
}

/*
 * Whether an earlier step's result is the one a condition waits on. A step
 * that never ran to an end - skipped, rejected, still pending - has no
 * result to wait on: nothing that waits on it runs.
 */
export function doesStepResultMeetOutcome(
  result: {
    status: SecurityPlaybookStepStatus | string | undefined;
    found?: boolean | undefined;
  },
  outcome: SecurityPlaybookStepOutcome,
): boolean {
  switch (outcome) {
    case SecurityPlaybookStepOutcome.Failed:
      return result.status === SecurityPlaybookStepStatus.Failed;
    case SecurityPlaybookStepOutcome.Found:
      return (
        result.status === SecurityPlaybookStepStatus.Succeeded &&
        result.found === true
      );
    case SecurityPlaybookStepOutcome.FoundNothing:
      return (
        result.status === SecurityPlaybookStepStatus.Succeeded &&
        result.found === false
      );
    default:
      return result.status === SecurityPlaybookStepStatus.Succeeded;
  }
}

/*
 * A step's condition, read against the run so far. `steps` and `results`
 * are the run's, in step order; `index` is the step's own place. Holds when
 * the step waits on nothing; otherwise when the step it waits on, before
 * it, ended with the result it waits on. `reason` says why it does not, in
 * a sentence a run shows under the skipped step.
 */
export function evaluateSecurityPlaybookStepCondition(data: {
  condition: SecurityPlaybookStepCondition | undefined;
  index: number;
  steps: ReadonlyArray<{ id: string; action: SecurityPlaybookActionType }>;
  results: ReadonlyArray<{
    status: SecurityPlaybookStepStatus | string | undefined;
    found?: boolean | undefined;
  }>;
}): { holds: boolean; reason?: string | undefined } {
  const condition: SecurityPlaybookStepCondition | undefined = data.condition;

  if (!condition) {
    return { holds: true };
  }

  const waitedOn: number = data.steps.findIndex(
    (step: { id: string }): boolean => {
      return step.id === condition.stepId;
    },
  );

  if (waitedOn < 0 || waitedOn >= data.index) {
    return {
      holds: false,
      reason:
        "Skipped: the step it runs after is not before it in this run.",
    };
  }

  const waitedOnStep: { id: string; action: SecurityPlaybookActionType } =
    data.steps[waitedOn]!;
  const definition: SecurityPlaybookActionDefinition | undefined =
    getSecurityPlaybookAction(waitedOnStep.action);

  if (
    doesStepResultMeetOutcome(
      data.results[waitedOn] || { status: SecurityPlaybookStepStatus.Pending },
      condition.outcome,
    )
  ) {
    return { holds: true };
  }

  return {
    holds: false,
    reason: `Skipped: it runs only if step ${waitedOn + 1} (${definition?.title || waitedOnStep.action}) ${describeSecurityPlaybookStepOutcome(waitedOnStep.action, condition.outcome)}.`,
  };
}
