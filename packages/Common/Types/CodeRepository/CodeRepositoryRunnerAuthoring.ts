/*
 * WHO DECIDES WHAT A PROJECT'S RUNNER RUNS FOR A CODE REPOSITORY.
 *
 * A code repository's setup, build and test commands (setupCommand,
 * buildCommand, testCommand) run on a Runner of the project's own, at the
 * root of the cloned repository, after OneUptime AI changes it
 * (Runner/Utils/BuildVerification). They run there as the Runner does: with
 * its network, its files and its user. Its Runner setting (runnerId and
 * runner, with isGlobalRunnerPicked - one choice,
 * Types/Runner/CodeRepositoryRunner) decides which of the project's Runners
 * that is, and which Runner OneUptime AI's own commands for the repository
 * run on.
 *
 * Whoever writes a command that runs on a project's Runner is trusted with
 * that Runner: a command runs as the Runner's own user, so it can read what
 * the Runner can read - the Runner's key among it, which claims every job
 * the Runner is sent and the secrets that come with them. That trust is
 * already given to one set of people: those who write a runbook's steps that
 * run (Types/Runbook/RunbookStepAuthoring) - Runbook.steps' update list:
 * Project Owner, Project Admin, Runbook Admin and Edit Runbook. A Bash step
 * and a repository's build command run on the same Runner, as the same
 * user, so the same people write both, and the same people pick where a
 * repository's work runs, as a step's author picks the Runner a step runs on.
 *
 * The repository's own lists used to be the table's: Project Member,
 * Settings Admin, Settings Member and Edit Code Repository among them. Any
 * of those could set a command through the API, pick any of the project's
 * Runners, and ask AI to work in the repository - and the Runner ran the
 * command with its own environment, its key included.
 *
 * So these columns are written on an update only by those people (the
 * columns' update lists), and a create that sets a command or picks a
 * Runner is refused unless its caller is one of them
 * (CodeRepositoryService.assertMayWriteWhatRunnersRun). A create that sets
 * none - no value, null or an empty command - passes for whoever may create
 * a repository, as every page that connects one creates it.
 *
 * A workflow that runs with the default permissions acts as a Project
 * Admin, and a Project Member may build one: its steps write none of these
 * columns (writesRunnerWork), as they change none of the project's secrets
 * (Server/Utils/Workflow/WorkflowPrincipal). One a person gave Project
 * Owner or a custom role meets the checks a person meets.
 *
 * Kept free of server and React code, so the server and the tests read the
 * same rule and the same words.
 */

// The columns whose value a Runner of the project's own runs.
export const CODE_REPOSITORY_COMMAND_COLUMNS: ReadonlyArray<
  "setupCommand" | "buildCommand" | "testCommand"
> = ["setupCommand", "buildCommand", "testCommand"];

/*
 * The columns that pick where a repository's work runs: its Runner (written
 * as runnerId or as the runner relation) and whether it picked the Global
 * Runner itself.
 */
export const CODE_REPOSITORY_RUNNER_COLUMNS: ReadonlyArray<
  "runnerId" | "runner" | "isGlobalRunnerPicked"
> = ["runnerId", "runner", "isGlobalRunnerPicked"];

/*
 * Whether a value written to a command column is a command: a string with
 * anything but white space in it. Nothing written (undefined or null) and an
 * empty or blank string are none - a Runner runs no command for them
 * (BuildVerification.commandsForRepository trims and skips them). Anything
 * that is not a string is read as a command: a value whose command cannot be
 * read is not let through on what it might hold.
 */
export function isCommandSet(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== "string") {
    return true;
  }

  return value.trim().length > 0;
}

// Whether a write sets any of a repository's commands (isCommandSet).
export function setsCommand(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }

  const written: Record<string, unknown> = data as Record<string, unknown>;

  return CODE_REPOSITORY_COMMAND_COLUMNS.some((column: string): boolean => {
    return isCommandSet(written[column]);
  });
}

/*
 * Whether a write picks a Runner for a repository: a value in runnerId or in
 * the runner relation. Nothing written (undefined or null) and an empty id
 * pick none - the repository then follows the project's default Runner, as
 * a new repository does. Anything else is read as a pick, whatever it names
 * (the project's own Runner, an id of nothing): the check of the id comes
 * later, and only for someone who may pick one.
 */
export function picksRunner(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }

  const written: Record<string, unknown> = data as Record<string, unknown>;

  return ["runnerId", "runner"].some((column: string): boolean => {
    const value: unknown = written[column];

    if (value === undefined || value === null) {
      return false;
    }

    if (typeof value === "string") {
      return value.trim().length > 0;
    }

    if (typeof value === "object") {
      const record: Record<string, unknown> = value as Record<string, unknown>;

      // A relation written as { _id } (or { id }) with no id picks none.
      if ("_id" in record || "id" in record) {
        const id: unknown = record["_id"] ?? record["id"];

        return !(
          id === undefined ||
          id === null ||
          (typeof id === "string" && id.trim().length === 0)
        );
      }

      // An ObjectID, or anything else: read as a pick.
      return true;
    }

    return true;
  });
}

/*
 * What a create that sets a repository's commands, or picks its Runner, is
 * refused with, for a caller who may not decide what a project's Runner
 * runs: what they may not write and why, who may (`permissionTitles`, the
 * titles of the columns' update list), and what to do instead.
 */
export function getRunnerWorkRefusal(data: {
  setsCommand: boolean;
  picksRunner: boolean;
  permissionTitles: ReadonlyArray<string>;
}): string {
  const who: string = `You need one of these permissions: ${data.permissionTitles.join(
    ", ",
  )}.`;

  if (data.setsCommand && data.picksRunner) {
    return `You may not set this repository's setup, build or test commands, or pick the Runner AI works in it on: they decide what runs on the project's Runners, with each Runner's own access, so writing them takes what writing a runbook step that runs takes. ${who} Create the repository without commands and without a Runner of its own, or ask someone who holds one of these permissions to set them.`;
  }

  if (data.setsCommand) {
    return `You may not set this repository's setup, build or test commands: a Runner of the project's own runs them, with its own access, so writing them takes what writing a runbook step that runs takes. ${who} Create the repository without commands, or ask someone who holds one of these permissions to set them.`;
  }

  return `You may not pick the Runner AI works in this repository on: it decides which of the project's Runners runs the repository's commands and OneUptime AI's, so picking it takes what writing a runbook step that runs takes. ${who} Create the repository without a Runner of its own - it then works on the project's default Runner - or ask someone who holds one of these permissions to pick one.`;
}

/*
 * Whether a write gives any of the columns that decide what a Runner runs
 * for a repository a value, nothing included: a command, cleared or set,
 * and the Runner setting, picked, cleared or moved to the Global Runner.
 * What a workflow that runs with the default permissions may not change.
 */
export function writesRunnerWork(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }

  const written: Record<string, unknown> = data as Record<string, unknown>;

  return [
    ...CODE_REPOSITORY_COMMAND_COLUMNS,
    ...CODE_REPOSITORY_RUNNER_COLUMNS,
  ].some((column: string): boolean => {
    return written[column] !== undefined;
  });
}

/*
 * What a step of a workflow that runs with the default permissions is
 * refused with when it would write what a Runner runs for a repository. Such
 * a workflow acts as a Project Admin, and a Project Member may build one, so
 * a step lent that would let its builder write what they may not as a
 * person. What would let the workflow, as a workflow's refusal of the
 * project's secrets says it (Server/Utils/Workflow/WorkflowPrincipal): what
 * it runs as.
 */
export function getDefaultWorkflowRunnerWorkRefusal(data: {
  isCreate: boolean;
}): string {
  return `Workflows that run with the default permissions don't change what the project's Runners run, so this step can't ${
    data.isCreate ? "create" : "change"
  } a code repository's setup, build or test commands or its Runner. To let this workflow do it, choose what it runs as in its Settings: Project Owner, or a custom role that has Edit Runbook or Runbook Admin as well as the repository's own permissions.`;
}
