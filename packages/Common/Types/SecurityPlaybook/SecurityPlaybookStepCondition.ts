import BadDataException from "../Exception/BadDataException";
import { JSONObject, JSONValue } from "../JSON";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
} from "./SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "./SecurityPlaybookRunStatus";

/*
 * BRANCHING: a step that runs only after earlier steps' results.
 *
 * A playbook stays a list read top to bottom; a step may wait on earlier
 * steps of the same playbook (`runIf`) and run only when one of them:
 *
 *  - succeeded, or failed (a step that fails stops the run unless it
 *    carries on, so "failed" can be waited on only for one that does);
 *  - for a step that looks something up (getSecurityPlaybookFinds): found
 *    something, or found nothing - "contain only what threat intel knows
 *    is bad", and its else: "if it found nothing, leave a task to check".
 *
 * A step may wait on one result, or on several - all of them, or any one
 * (SecurityPlaybookStepConditionGroup): "contain only when threat intel
 * knows the user AND the sign-in was confirmed", "page on-call when either
 * lookup found something". One result is stored as it always was, so a
 * playbook saved before groups came reads, and saves, unchanged.
 *
 * Two steps waiting on opposite results of one step are an if and an else.
 * A step whose condition does not hold is skipped, saying which results it
 * waited on, before it asks for an approval or acts on anything. A step
 * the one it waits on never reached (it was skipped, or the run ended
 * first) does not run either: nothing is contained on a result nobody saw.
 *
 * A condition names an earlier step by its id, so moving steps keeps what
 * each waits on; a playbook is refused on save when a step waits on one
 * that is not before it, on a result that step cannot have, or on the
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

// How a step that waits on several results reads them.
export enum SecurityPlaybookConditionMatch {
  // It runs when every one of them happened.
  All = "All",
  // ...or when any one of them did.
  Any = "Any",
}

// A step that waits on more than one earlier result.
export interface SecurityPlaybookStepConditionGroup {
  match: SecurityPlaybookConditionMatch;
  // Two or more, each on a step before it, none twice.
  conditions: Array<SecurityPlaybookStepCondition>;
}

/*
 * What a step waits on: one earlier result, as a step has stored it since
 * branching came, or several.
 */
export type SecurityPlaybookStepRunIf =
  | SecurityPlaybookStepCondition
  | SecurityPlaybookStepConditionGroup;

// The most results one step waits on.
export const SECURITY_PLAYBOOK_MAX_CONDITIONS_PER_STEP: number = 5;

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

export function isSecurityPlaybookConditionMatch(
  value: unknown,
): value is SecurityPlaybookConditionMatch {
  return (
    typeof value === "string" &&
    (Object.values(SecurityPlaybookConditionMatch) as Array<string>).includes(
      value,
    )
  );
}

export function isSecurityPlaybookStepConditionGroup(
  runIf: SecurityPlaybookStepRunIf | undefined | null,
): runIf is SecurityPlaybookStepConditionGroup {
  return Boolean(
    runIf &&
      Array.isArray((runIf as SecurityPlaybookStepConditionGroup).conditions),
  );
}

// The results a step waits on, in the order they were picked: none for a step that always runs.
export function getSecurityPlaybookStepConditions(
  runIf: SecurityPlaybookStepRunIf | undefined | null,
): Array<SecurityPlaybookStepCondition> {
  if (!runIf) {
    return [];
  }

  return isSecurityPlaybookStepConditionGroup(runIf)
    ? runIf.conditions
    : [runIf];
}

// How a step reads the results it waits on: all of them, unless it said any.
export function getSecurityPlaybookConditionMatch(
  runIf: SecurityPlaybookStepRunIf | undefined | null,
): SecurityPlaybookConditionMatch {
  return isSecurityPlaybookStepConditionGroup(runIf)
    ? runIf.match
    : SecurityPlaybookConditionMatch.All;
}

function sameCondition(
  a: SecurityPlaybookStepCondition,
  b: SecurityPlaybookStepCondition,
): boolean {
  return a.stepId === b.stepId && a.outcome === b.outcome;
}

/*
 * What a step waits on, from the results picked: none (it always runs),
 * one - stored as a step always stored it - or a group of two or more, the
 * same result never twice.
 */
export function buildSecurityPlaybookStepRunIf(
  conditions: ReadonlyArray<SecurityPlaybookStepCondition>,
  match: SecurityPlaybookConditionMatch = SecurityPlaybookConditionMatch.All,
): SecurityPlaybookStepRunIf | undefined {
  const unique: Array<SecurityPlaybookStepCondition> = [];

  for (const condition of conditions) {
    if (
      !unique.some((kept: SecurityPlaybookStepCondition): boolean => {
        return sameCondition(kept, condition);
      })
    ) {
      unique.push({ stepId: condition.stepId, outcome: condition.outcome });
    }
  }

  if (unique.length === 0) {
    return undefined;
  }

  if (unique.length === 1) {
    return unique[0]!;
  }

  return { match, conditions: unique };
}

/*
 * The results a later step can wait on for a step of this action: found or
 * found nothing for one that looks something up, succeeded otherwise - and
 * failed for one that carries on when it fails, the only kind a later step
 * ever sees fail. A step that stops the run has none: nothing after it
 * runs.
 */
export function getSecurityPlaybookStepOutcomes(step: {
  action: SecurityPlaybookActionType | string;
  continueOnFailure: boolean;
}): Array<SecurityPlaybookStepOutcome> {
  if (step.action === SecurityPlaybookActionType.StopRun) {
    return [];
  }

  const outcomes: Array<SecurityPlaybookStepOutcome> = getSecurityPlaybookFinds(
    step.action,
  )
    ? [
        SecurityPlaybookStepOutcome.Found,
        SecurityPlaybookStepOutcome.FoundNothing,
      ]
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
 * One stored condition, read: the earlier step and the result. Refused,
 * naming the step, when it does not read.
 */
function readOneCondition(
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

  if (
    !stepId &&
    (outcome === undefined || outcome === null || outcome === "")
  ) {
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
 * A stored or posted condition, read: one result, or a group of results
 * with how they are read (all of them, or any). None (undefined) for a step
 * that runs always: no condition, null, an empty one, or a group with
 * nothing in it. One that is there but does not read - no step, a result
 * that is not one, a group that cannot say how it reads - is refused,
 * naming the step: dropped instead, the step would run always, and a
 * containment step meant to wait on threat intel would contain on its own.
 * A group of one is that one result.
 */
export function readSecurityPlaybookStepCondition(
  value: JSONValue | undefined,
  label: string,
): SecurityPlaybookStepRunIf | undefined {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as JSONObject)["conditions"] !== undefined
  ) {
    const record: JSONObject = value as JSONObject;
    const items: JSONValue | undefined = record["conditions"];

    if (!Array.isArray(items)) {
      throw new BadDataException(
        `${label}: when it runs is not something a playbook can read. Choose again when it runs.`,
      );
    }

    const match: JSONValue | undefined = record["match"];

    if (
      match !== undefined &&
      match !== null &&
      !isSecurityPlaybookConditionMatch(match)
    ) {
      throw new BadDataException(
        `${label}: choose whether it runs after all of the results it waits on, or any one of them.`,
      );
    }

    const conditions: Array<SecurityPlaybookStepCondition> = [];

    for (const item of items) {
      const condition: SecurityPlaybookStepCondition | undefined =
        readOneCondition(item, label);

      if (condition) {
        conditions.push(condition);
      }
    }

    const runIf: SecurityPlaybookStepRunIf | undefined =
      buildSecurityPlaybookStepRunIf(
        conditions,
        isSecurityPlaybookConditionMatch(match)
          ? match
          : SecurityPlaybookConditionMatch.All,
      );

    if (
      getSecurityPlaybookStepConditions(runIf).length >
      SECURITY_PLAYBOOK_MAX_CONDITIONS_PER_STEP
    ) {
      throw new BadDataException(
        `${label}: a step waits on at most ${SECURITY_PLAYBOOK_MAX_CONDITIONS_PER_STEP} results of earlier steps.`,
      );
    }

    return runIf;
  }

  return readOneCondition(value, label);
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
 * Clauses joined the way a sentence lists them: "a", "a and b", "a, b and
 * c" - or with "or".
 */
function joinClauses(clauses: Array<string>, word: "and" | "or"): string {
  if (clauses.length <= 1) {
    return clauses.join("");
  }

  return `${clauses.slice(0, -1).join(", ")} ${word} ${clauses[clauses.length - 1]}`;
}

/*
 * A step's condition, read against the run so far. `steps` and `results`
 * are the run's, in step order; `index` is the step's own place. Holds when
 * the step waits on nothing; otherwise when the steps it waits on, before
 * it, ended with the results it waits on - every one of them, or any one
 * for a step that said any. `reason` says why it does not, in a sentence a
 * run shows under the skipped step.
 */
export function evaluateSecurityPlaybookStepCondition(data: {
  condition: SecurityPlaybookStepRunIf | undefined;
  index: number;
  steps: ReadonlyArray<{ id: string; action: SecurityPlaybookActionType }>;
  results: ReadonlyArray<{
    status: SecurityPlaybookStepStatus | string | undefined;
    found?: boolean | undefined;
  }>;
}): { holds: boolean; reason?: string | undefined } {
  const conditions: Array<SecurityPlaybookStepCondition> =
    getSecurityPlaybookStepConditions(data.condition);

  if (conditions.length === 0) {
    return { holds: true };
  }

  const match: SecurityPlaybookConditionMatch =
    getSecurityPlaybookConditionMatch(data.condition);
  const clauses: Array<string> = [];
  let held: number = 0;

  for (const condition of conditions) {
    const waitedOn: number = data.steps.findIndex(
      (step: { id: string }): boolean => {
        return step.id === condition.stepId;
      },
    );

    if (waitedOn < 0 || waitedOn >= data.index) {
      return {
        holds: false,
        reason:
          conditions.length === 1
            ? "Skipped: the step it runs after is not before it in this run."
            : "Skipped: a step it runs after is not before it in this run.",
      };
    }

    const waitedOnStep: { id: string; action: SecurityPlaybookActionType } =
      data.steps[waitedOn]!;
    const definition: SecurityPlaybookActionDefinition | undefined =
      getSecurityPlaybookAction(waitedOnStep.action);

    if (
      doesStepResultMeetOutcome(
        data.results[waitedOn] || {
          status: SecurityPlaybookStepStatus.Pending,
        },
        condition.outcome,
      )
    ) {
      held++;
    }

    clauses.push(
      `step ${waitedOn + 1} (${definition?.title || waitedOnStep.action}) ${describeSecurityPlaybookStepOutcome(waitedOnStep.action, condition.outcome)}`,
    );
  }

  const holds: boolean =
    match === SecurityPlaybookConditionMatch.Any
      ? held > 0
      : held === conditions.length;

  if (holds) {
    return { holds: true };
  }

  return {
    holds: false,
    reason: `Skipped: it runs only if ${joinClauses(
      clauses,
      match === SecurityPlaybookConditionMatch.Any ? "or" : "and",
    )}.`,
  };
}
