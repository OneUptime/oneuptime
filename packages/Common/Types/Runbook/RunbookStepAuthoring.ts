import RunbookStepType from "./RunbookStepType";

/*
 * WHO WRITES WHAT A RUNBOOK RUNS (GHSA-rfrx-38rq-44w6).
 *
 * A runbook's steps are what it does in the project. A JavaScript, Bash,
 * SSH or kubectl step runs on one of the project's Runners, with that
 * host's access; an HTTP request step is sent by OneUptime itself; an AI
 * step asks the project's LLM provider. A step that runs is handed the
 * runbook variables it names - secrets too - and an HTTP request step every
 * secret of the project it names, sent wherever its URL, headers and body
 * say (Server/Utils/Runbook/RunbookVariableResolver). Whoever writes one
 * decides what runs on the project's Runners and where its secrets go.
 *
 * So writing a step that runs takes what changing a runbook's steps takes -
 * Runbook.steps' update list: Project Owner, Project Admin, Runbook Admin
 * or Edit Runbook - on a create as on an update. The create list let more
 * in: Project Member, which runs runbooks and may not read a runbook
 * variable, and Create Runbook alone. Neither can save a step on a
 * runbook's Steps page, which saves with an update, but through the API
 * either could create a runbook with steps that run and, as Project Member,
 * run it: commands on the project's Runners, and every secret runbook
 * variable sent to an address of its choosing. RunbookService now refuses
 * such a create (assertMayWriteStepsThatRun).
 *
 * A manual step runs nothing: a person ticks it off. Whoever may create a
 * runbook may give it manual steps - the runbook templates a member adds are
 * checklists of them (Types/OpenStack/OpenStackRunbookTemplates).
 *
 * Kept free of server and React code, so the server and the tests read the
 * same rule and the same words.
 */

// The step types whoever may create a runbook writes: they run nothing.
export const RUNBOOK_STEP_TYPES_THAT_RUN_NOTHING: ReadonlyArray<RunbookStepType> =
  [RunbookStepType.Manual];

// Whether one entry of Runbook.steps is a step that runs nothing.
export function isStepThatRunsNothing(step: unknown): boolean {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    return false;
  }

  const type: unknown = (step as Record<string, unknown>)["type"];

  return (
    typeof type === "string" &&
    (RUNBOOK_STEP_TYPES_THAT_RUN_NOTHING as ReadonlyArray<string>).includes(
      type,
    )
  );
}

/*
 * Whether a value written to Runbook.steps holds a step that runs: an entry
 * that is not a manual step - one of another type, of a type this build does
 * not know, or something that is no step at all. Nothing written (undefined
 * or null) and an empty list hold none. A value that is not a list is read
 * as holding one: steps are a list, and a value whose steps cannot be read
 * is not let through on what it might hold.
 */
export function holdsStepThatRuns(steps: unknown): boolean {
  if (steps === undefined || steps === null) {
    return false;
  }

  if (!Array.isArray(steps)) {
    return true;
  }

  return steps.some((step: unknown): boolean => {
    return !isStepThatRunsNothing(step);
  });
}

/*
 * What a create that gives a runbook a step that runs is refused with, for
 * a caller who may not change runbook steps: what they may not write and
 * why, who may (`permissionTitles`, the titles of Runbook.steps' update
 * list), and what to do instead.
 */
export function getStepsThatRunRefusal(
  permissionTitles: ReadonlyArray<string>,
): string {
  return `You may not write this runbook's JavaScript, HTTP request, Bash, SSH, kubectl or AI steps: they act for the project, on its Runners or from OneUptime, with the runbook secrets they name, so writing them takes permission to change runbooks. You need one of these permissions: ${permissionTitles.join(
    ", ",
  )}. Create the runbook with manual steps only, or ask someone who holds one of these permissions to add the others.`;
}
