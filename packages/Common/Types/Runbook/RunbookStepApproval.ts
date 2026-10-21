import { RunbookStep } from "./RunbookStep";
import { RunbookStepExecutionState } from "./RunbookStepExecution";
import RunbookStepExecutionStatus from "./RunbookStepExecutionStatus";
import RunbookStepType from "./RunbookStepType";

/*
 * A STEP ASKS FOR APPROVAL BEFORE IT RUNS.
 *
 * A runbook step used to say "Require approval before running the next
 * step": the run ran it, stopped, and ran the step after it only once
 * someone approved. The maintainer: "Instead of saying 'require approval
 * before running next step', you can actually say this in the next step,
 * which would say 'require approval before running this step'." So the
 * switch is on the step it guards (requireApprovalBeforeRunning): the run
 * stops before that step, and it runs only once someone approves it - or
 * never, when they skip it instead. A Manual step has no such switch: it
 * stops the run for a person already.
 *
 * THE OLD FLAG STILL MEANS WHAT IT MEANT.
 *
 * requireApproval ("after this step") is still read wherever a runbook's
 * steps are read - a runbook written through the API or Terraform by a
 * client that still sends it, or one the data migration has not reached
 * yet - and moveApprovalsBeforeTheirSteps is the one reading of it:
 *
 *   - an approval after step N is an approval before step N+1, the step it
 *     held back;
 *   - an approval after step N, when step N+1 is a Manual step, is that
 *     Manual step's own stop: the run stops there for a person anyway,
 *     before anything after it runs;
 *   - an approval after the last step - the run waited for someone before it
 *     finished, which the remediation verifier and anything waiting for the
 *     run to end saw - becomes a Manual step at the end, "Approve the
 *     result", which stops the run in the same place;
 *   - the flag on a Manual step meant nothing (the execution loop never
 *     read it), and still means nothing.
 *
 * Every run is started from steps read this way (RunbookStarter), the
 * Steps page shows them this way, OneUptime AI reads them this way, and the
 * data migration (MoveRunbookApprovalsBeforeTheirSteps) wrote every stored
 * runbook this way once. A save is stored as it was sent, so a Terraform
 * configuration that still says requireApproval reads back exactly as it
 * wrote it.
 *
 * A run started before approvals moved holds its own copy of the steps, old
 * flag and all, and the execution loop still stops after such a step
 * (RunRunbook), so it finishes exactly as it started.
 *
 * Nothing here runs on a Runner: the server decides when a step's job is
 * handed to a Runner at all, so a Runner of any age stops where the
 * runbook says.
 */

// The title of the Manual step an approval after the last step became.
export const APPROVAL_AFTER_LAST_STEP_TITLE: string = "Approve the result";

// What that Manual step tells the person the run waits for.
export const APPROVAL_AFTER_LAST_STEP_DESCRIPTION: string =
  "Check what the steps above did, then mark this step complete to finish the run.";

// The id of that Manual step, from the id of the step before it.
export const APPROVAL_AFTER_LAST_STEP_ID_SUFFIX: string = "-approval";

// Its id when the last step has none of its own (a hand-written step).
export const APPROVAL_AFTER_LAST_STEP_FALLBACK_ID: string =
  "approval-after-last-step";

// Whether a step of this type can ask for approval: every type but Manual.
export function canStepTypeRequireApproval(
  type: RunbookStepType | string | undefined,
): boolean {
  return Boolean(type) && type !== RunbookStepType.Manual;
}

/*
 * Whether the run stops before `step` until someone approves it. Only the
 * new flag says so: an old flag on the step before is read into this one by
 * moveApprovalsBeforeTheirSteps first.
 */
export function stepRequiresApprovalBeforeRunning(
  step: Partial<RunbookStep> | undefined | null,
): boolean {
  return (
    Boolean(step) &&
    canStepTypeRequireApproval(step!.type) &&
    step!.requireApprovalBeforeRunning === true
  );
}

/*
 * Whether `step` carries the old flag, live: an approval after it. On a
 * Manual step the flag never did anything.
 */
export function hasApprovalAfterStep(
  step: Partial<RunbookStep> | undefined | null,
): boolean {
  return (
    Boolean(step) &&
    canStepTypeRequireApproval(step!.type) &&
    step!.requireApproval === true
  );
}

// Whether any step of `steps` still asks for an approval after itself.
export function hasApprovalsAfterSteps(steps: unknown): boolean {
  return (Array.isArray(steps) ? steps : []).some((step: unknown): boolean => {
    return isStepObject(step) && hasApprovalAfterStep(step as RunbookStep);
  });
}

// Whether any step of `steps` carries the old flag at all, true or false.
export function hasOldApprovalFlags(steps: unknown): boolean {
  return (Array.isArray(steps) ? steps : []).some((step: unknown): boolean => {
    return (
      isStepObject(step) &&
      Object.prototype.hasOwnProperty.call(step, "requireApproval")
    );
  });
}

export interface StepsWithApprovalsBeforeTheirSteps {
  // In the order they were given, then the Manual step added at the end, if any.
  steps: Array<RunbookStep>;
  /*
   * Whether an approval after a step was moved: what the data migration
   * writes back. An old flag that asked for nothing (false, or on a Manual
   * step) is dropped from `steps` without counting as a move.
   */
  isMoved: boolean;
}

/*
 * `steps` with every approval before the step it holds back (see the top of
 * this file). The steps keep their order in the array, their ids and
 * everything else they hold; only requireApproval goes, and
 * requireApprovalBeforeRunning is turned on where an old approval lands.
 * The order the run takes is by `order`, as everything that runs or shows
 * the steps reads it. Reading steps that were read already changes nothing.
 */
export function getStepsWithApprovalsBeforeTheirSteps(
  steps: unknown,
): StepsWithApprovalsBeforeTheirSteps {
  const list: Array<RunbookStep> = (Array.isArray(steps) ? steps : []).filter(
    isStepObject,
  ) as Array<RunbookStep>;

  // The positions of `list`, in the order the run takes them.
  const runOrder: Array<number> = list
    .map((_step: RunbookStep, index: number): number => {
      return index;
    })
    .sort((a: number, b: number): number => {
      return orderOf(list[a]!) - orderOf(list[b]!) || a - b;
    });

  // The steps an old approval lands on, by position in `list`.
  const approvedBefore: Set<number> = new Set<number>();
  let isApprovedAfterLastStep: boolean = false;
  let isMoved: boolean = false;

  runOrder.forEach((index: number, position: number): void => {
    if (!hasApprovalAfterStep(list[index])) {
      return;
    }

    isMoved = true;

    const nextIndex: number | undefined = runOrder[position + 1];

    if (nextIndex === undefined) {
      isApprovedAfterLastStep = true;
      return;
    }

    // A Manual step stops the run there anyway: it is the approval.
    if (canStepTypeRequireApproval(list[nextIndex]!.type)) {
      approvedBefore.add(nextIndex);
    }
  });

  const read: Array<RunbookStep> = list.map(
    (step: RunbookStep, index: number): RunbookStep => {
      const isLanding: boolean = approvedBefore.has(index);

      if (
        !Object.prototype.hasOwnProperty.call(step, "requireApproval") &&
        !isLanding
      ) {
        return step;
      }

      const copy: RunbookStep = { ...step };
      delete copy.requireApproval;

      if (isLanding) {
        copy.requireApprovalBeforeRunning = true;
      }

      return copy;
    },
  );

  if (isApprovedAfterLastStep) {
    const lastStep: RunbookStep = list[runOrder[runOrder.length - 1]!]!;

    read.push({
      id: getApprovalAfterLastStepId({
        lastStepId: lastStep.id,
        takenIds: list.map((step: RunbookStep): string => {
          return typeof step.id === "string" ? step.id : "";
        }),
      }),
      order: nextOrder(list),
      type: RunbookStepType.Manual,
      title: APPROVAL_AFTER_LAST_STEP_TITLE,
      description: APPROVAL_AFTER_LAST_STEP_DESCRIPTION,
      config: {},
    });
  }

  return { steps: read, isMoved };
}

// The steps with every approval before the step it holds back.
export function moveApprovalsBeforeTheirSteps(
  steps: unknown,
): Array<RunbookStep> {
  return getStepsWithApprovalsBeforeTheirSteps(steps).steps;
}

/*
 * The id of the Manual step an approval after the last step becomes: the
 * last step's id and "-approval", so reading the same steps twice gives
 * the same step - one id that is taken already gets a number too.
 */
export function getApprovalAfterLastStepId(data: {
  lastStepId: unknown;
  takenIds: Array<string>;
}): string {
  const base: string =
    typeof data.lastStepId === "string" && data.lastStepId.trim()
      ? `${data.lastStepId}${APPROVAL_AFTER_LAST_STEP_ID_SUFFIX}`
      : APPROVAL_AFTER_LAST_STEP_FALLBACK_ID;

  let id: string = base;
  let number: number = 2;

  while (data.takenIds.includes(id)) {
    id = `${base}-${number}`;
    number++;
  }

  return id;
}

// ------------------------------------------------------------ in a run

/*
 * Why the run waits on a step that is WaitingForUser: what the execution
 * page offers and the step routes do depend on it.
 */
export enum RunbookStepWait {
  // A Manual step: someone does it and ticks it off.
  Manual = "Manual",
  // A step that has not run yet: approving it runs it.
  ApprovalToRun = "ApprovalToRun",
  /*
   * A step that has run, in a run started before approvals moved (the old
   * flag in its copy of the steps): approving it lets the run go on.
   */
  ApprovalToContinue = "ApprovalToContinue",
}

// Why the run waits on `stepExecution`; undefined for a step it does not wait on.
export function getRunbookStepWait(
  stepExecution: RunbookStepExecutionState | undefined,
): RunbookStepWait | undefined {
  if (
    !stepExecution ||
    stepExecution.status !== RunbookStepExecutionStatus.WaitingForUser
  ) {
    return undefined;
  }

  if (!canStepTypeRequireApproval(stepExecution.step?.type)) {
    return RunbookStepWait.Manual;
  }

  if (
    stepRequiresApprovalBeforeRunning(stepExecution.step) &&
    !stepExecution.approvedAt
  ) {
    return RunbookStepWait.ApprovalToRun;
  }

  return RunbookStepWait.ApprovalToContinue;
}

/*
 * Whether the execution loop stops before running `stepExecution`: its step
 * asks for approval and nobody has given it yet.
 */
export function isApprovalNeededBeforeRunning(
  stepExecution: RunbookStepExecutionState,
): boolean {
  return (
    stepRequiresApprovalBeforeRunning(stepExecution.step) &&
    !stepExecution.approvedAt
  );
}

/*
 * Whether a step stops the run for a person, so it can never be skipped
 * before the run reaches it: a Manual step, a step that asks for approval
 * before it runs, and a step of an older run that asks for approval after.
 */
export function isStepAStopForAPerson(
  step: Partial<RunbookStep> | undefined | null,
): boolean {
  return (
    Boolean(step) &&
    (!canStepTypeRequireApproval(step!.type) ||
      stepRequiresApprovalBeforeRunning(step) ||
      hasApprovalAfterStep(step))
  );
}

// ------------------------------------------------------------ helpers

function isStepObject(step: unknown): boolean {
  return Boolean(step) && typeof step === "object" && !Array.isArray(step);
}

// A step's place in the run: its `order`, or 0 for one written without.
function orderOf(step: RunbookStep): number {
  const order: number = Number(step.order);

  return Number.isFinite(order) ? order : 0;
}

// The order a step added after every other one takes.
function nextOrder(steps: Array<RunbookStep>): number {
  let highest: number = -1;

  for (const step of steps) {
    highest = Math.max(highest, orderOf(step));
  }

  return Math.max(highest + 1, steps.length);
}
