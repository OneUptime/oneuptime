import { SecurityPlaybookActionType } from "./SecurityPlaybookAction";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "./SecurityPlaybookStep";
import {
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
  readStepResults,
} from "./SecurityPlaybookStepResult";

/*
 * A PERSON'S ONE-STEP RUN FROM A CASE (#10342): Block for 24 Hours on a
 * case's Response Plan, or Block... on one of its addresses, blocks the
 * address through the playbook engine - the same approvals, protected
 * checks, timeline and audit log as any playbook's step - with no playbook
 * written first. It is a run of the engine with no playbook behind it
 * (securityPlaybookId empty), one step long, whose target is the address
 * the person chose (SecurityPlaybookRunService.startOneStepRun), so the
 * run, its approval, its undo and the case's Playbooks page work as they
 * do for any run.
 *
 * A run of a playbook deleted since it ran also has none, and reads as
 * one: it was started on the case too, by a playbook nobody keeps.
 */

// The actions a one-step run takes: containment that needs no connection of its own.
export const ONE_STEP_RUN_ACTIONS: ReadonlyArray<SecurityPlaybookActionType> = [
  SecurityPlaybookActionType.BlockAddress,
];

/*
 * The actions OneUptime AI runs on a case it works, one step a run with no
 * playbook (SecurityPlaybookRunService.startAiStepRun, #10352): the case's
 * own priority and status, an incident, a block and its lift, the fix in
 * code, and the containment of an account or a host - each through the
 * engine's own path for it, with its approvals, protected checks, timeline,
 * audit and undo.
 */
export const AI_STEP_RUN_ACTIONS: ReadonlyArray<SecurityPlaybookActionType> = [
  SecurityPlaybookActionType.SetCasePriority,
  SecurityPlaybookActionType.SetCaseStatus,
  SecurityPlaybookActionType.DeclareIncident,
  SecurityPlaybookActionType.BlockAddress,
  SecurityPlaybookActionType.LiftAddressBlock,
  SecurityPlaybookActionType.FixWithAi,
  SecurityPlaybookActionType.SuspendOktaUser,
  SecurityPlaybookActionType.EndOktaSessions,
  SecurityPlaybookActionType.DisableEntraIdUser,
  SecurityPlaybookActionType.SignOutEntraIdUser,
  SecurityPlaybookActionType.SuspendGoogleWorkspaceUser,
  SecurityPlaybookActionType.SignOutGoogleWorkspaceUser,
  SecurityPlaybookActionType.ContainCrowdStrikeHost,
  SecurityPlaybookActionType.IsolateDefenderDevice,
];

export function isAiStepRunAction(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (AI_STEP_RUN_ACTIONS as ReadonlyArray<string>).includes(value)
  );
}

export function isOneStepRunAction(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (ONE_STEP_RUN_ACTIONS as ReadonlyArray<string>).includes(value)
  );
}

// Whether a run is a one-step run from a case: none of a playbook.
export function isOneStepSecurityPlaybookRun(run: {
  securityPlaybookId?: unknown;
}): boolean {
  return !run.securityPlaybookId;
}

export interface OneStepRunRead {
  action: SecurityPlaybookActionType;
  // The addresses it acts on, as written.
  values: Array<string>;
  step: SecurityPlaybookStep;
  result: SecurityPlaybookStepResult | undefined;
}

/*
 * What a one-step run does, and to what, as stored: null for a run of a
 * playbook, of more than one step, of an action no one-step run takes, or
 * one whose steps cannot be read.
 */
export function readOneStepRun(run: {
  securityPlaybookId?: unknown;
  steps?: unknown;
  stepResults?: unknown;
}): OneStepRunRead | null {
  if (!isOneStepSecurityPlaybookRun(run)) {
    return null;
  }

  let steps: Array<SecurityPlaybookStep>;

  try {
    steps = parseSecurityPlaybookSteps(run.steps);
  } catch {
    return null;
  }

  const step: SecurityPlaybookStep | undefined = steps[0];

  if (steps.length !== 1 || !step || !isOneStepRunAction(step.action)) {
    return null;
  }

  const result: SecurityPlaybookStepResult | undefined = readStepResults(
    run.stepResults,
    steps,
  )[0];

  return {
    action: step.action,
    values: (result?.targets || []).map(
      (target: SecurityPlaybookTarget): string => {
        return target.value;
      },
    ),
    step,
    result,
  };
}
