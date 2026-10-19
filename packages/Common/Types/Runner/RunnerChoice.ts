import ObjectID from "../ObjectID";
import { canGlobalRunnersRunStepType } from "./GlobalRunnerWork";

/*
 * WHERE A STEP RUNS - the one "global by default" rule.
 *
 * A step that picked a Runner runs on it: a custom pick always wins. A step
 * that picked none runs on the global Runners - the ones OneUptime runs for
 * every project - when all of these hold:
 *
 *   - global Runners can run it (GlobalRunnerWork: JavaScript steps);
 *   - its project uses global Runners (Project.useGlobalRunners, on by
 *     default);
 *   - the server has a global Runner that runs runbook steps.
 *
 * Otherwise it does not run, and the step's error says why in plain words
 * and what to do. Pure, so the server (GlobalRunnerChoice, which reads the
 * facts) and the step editor (which shows what a step will run on) answer
 * the same question the same way.
 */

export enum RunnerChoiceRefusal {
  // The step names a Runner by something that is not an ID.
  InvalidRunnerId = "invalid_runner_id",
  // The step names a Runner that is not one of its project's any more.
  RunnerNotFound = "runner_not_found",
  // The step picked no Runner, and global Runners never run its type.
  NeedsOwnRunner = "needs_own_runner",
  // The step picked no Runner, and its project turned global Runners off.
  ProjectTurnedGlobalRunnersOff = "project_turned_global_runners_off",
  // The step picked no Runner, and the server has no global Runner.
  NoGlobalRunner = "no_global_runner",
}

export type RunnerChoiceDecision =
  | { kind: "custom"; runnerId: string }
  | { kind: "global" }
  | { kind: "refused"; refusal: RunnerChoiceRefusal; message: string };

// What the Runner a step picked turned out to be, once it is looked up.
export enum ChosenRunnerKind {
  // One of the step's own project's Runners.
  ProjectRunner = "project_runner",
  // A global Runner: picking one is picking the global Runners.
  GlobalRunner = "global_runner",
  // Not a Runner of the project, nor a global one (deleted, or another project's).
  NotFound = "not_found",
}

export interface RunnerChoiceFacts {
  // The step's type, as stored ("JavaScript", "Bash", "SSH", "Kubernetes").
  stepType: string;
  // The Runner the step picked, as stored: "" (or nothing) when it picked none.
  chosenRunnerId?: string | null | undefined;
  /*
   * What the picked Runner is, once looked up. Asked only when the step
   * picked one with a valid ID; absent reads as one of the project's own.
   */
  chosenRunnerKind?: ChosenRunnerKind | undefined;
  // Whether the step's project uses global Runners (Project.useGlobalRunners).
  projectUsesGlobalRunners: boolean;
  // Whether the server has a global Runner that runs runbook steps.
  hasGlobalRunner: boolean;
}

// The ID a step picked, trimmed: "" when it picked none.
export function getChosenRunnerId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isRunnerId(value: string): boolean {
  return ObjectID.isValidUUID(value);
}

/*
 * The refusal's words. The step type names the step ("This Bash step"); a
 * value the step stored is quoted, never trusted to be short, so it is cut.
 */
export function describeRunnerChoiceRefusal(data: {
  refusal: RunnerChoiceRefusal;
  stepType: string;
  chosenRunnerId?: string | undefined;
}): string {
  const step: string = `This ${data.stepType || "runbook"} step`;

  switch (data.refusal) {
    case RunnerChoiceRefusal.InvalidRunnerId: {
      const raw: string = data.chosenRunnerId || "";
      const shown: string = raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;

      return `${step} names its Runner by "${shown}", which is not a Runner ID. Open the step and pick its Runner again.`;
    }
    case RunnerChoiceRefusal.RunnerNotFound:
      return `${step} picked a Runner that is not one of this project's Runners any more. It may have been deleted. Open the step and pick another Runner.`;
    case RunnerChoiceRefusal.NeedsOwnRunner:
      return `${step} has no Runner. ${data.stepType} steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only. Pick one of your Runners for the step, or add one under Runbooks → Runners.`;
    case RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff:
      return `${step} has no Runner of its own, and this project does not use global Runners. Pick one of your Runners for the step, or turn global Runners on under Runbooks → Runners.`;
    case RunnerChoiceRefusal.NoGlobalRunner:
      return `${step} has no Runner of its own, and there is no global Runner to run it. Pick one of your Runners for the step, or add one under Runbooks → Runners.`;
    default: {
      const unhandled: never = data.refusal;
      return unhandled;
    }
  }
}

function refuse(
  refusal: RunnerChoiceRefusal,
  facts: RunnerChoiceFacts,
  chosenRunnerId?: string | undefined,
): RunnerChoiceDecision {
  return {
    kind: "refused",
    refusal,
    message: describeRunnerChoiceRefusal({
      refusal,
      stepType: facts.stepType,
      ...(chosenRunnerId !== undefined ? { chosenRunnerId } : {}),
    }),
  };
}

export function decideRunnerChoice(
  facts: RunnerChoiceFacts,
): RunnerChoiceDecision {
  const chosenRunnerId: string = getChosenRunnerId(facts.chosenRunnerId);

  if (chosenRunnerId) {
    if (!isRunnerId(chosenRunnerId)) {
      return refuse(RunnerChoiceRefusal.InvalidRunnerId, facts, chosenRunnerId);
    }

    if (facts.chosenRunnerKind === ChosenRunnerKind.NotFound) {
      return refuse(RunnerChoiceRefusal.RunnerNotFound, facts);
    }

    // A custom pick always wins.
    if (facts.chosenRunnerKind !== ChosenRunnerKind.GlobalRunner) {
      return { kind: "custom", runnerId: chosenRunnerId };
    }

    /*
     * A step that names one global Runner is held to every rule a step that
     * names none is: the global Runners are one choice, whichever of them is
     * free takes it.
     */
  }

  if (!canGlobalRunnersRunStepType(facts.stepType)) {
    return refuse(RunnerChoiceRefusal.NeedsOwnRunner, facts);
  }

  if (!facts.projectUsesGlobalRunners) {
    return refuse(RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff, facts);
  }

  if (!facts.hasGlobalRunner) {
    return refuse(RunnerChoiceRefusal.NoGlobalRunner, facts);
  }

  return { kind: "global" };
}
