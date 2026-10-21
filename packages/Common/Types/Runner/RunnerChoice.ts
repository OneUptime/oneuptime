import ObjectID from "../ObjectID";
import { canGlobalRunnersRunStepType } from "./GlobalRunnerWork";

/*
 * WHERE WORK RUNS - the one rule, in its default order.
 *
 * Work that picked a Runner runs on it: a pick of one of the project's own
 * Runners always wins. Work that picked none runs on its project's default
 * Runner when the project has one (Runner.isProjectDefault, set from
 * Runbooks -> Runners as a Twilio config is made the project default), and
 * otherwise on the global Runners - the ones OneUptime runs for every
 * project - when all of these hold:
 *
 *   - global Runners can run it (GlobalRunnerWork: JavaScript steps);
 *   - its project uses global Runners (Project.useGlobalRunners, on by
 *     default);
 *   - the server has a global Runner that runs it.
 *
 * Work can also pick the Global Runner itself (GLOBAL_RUNNER_CHOICE_ID, or
 * the id of one global Runner): then it runs on the global Runners whatever
 * the project's default Runner is, held to the same three facts.
 *
 * Otherwise it does not run, and its error says why in plain words and what
 * to do. A Bash, SSH or kubectl step never runs on a global Runner: a shell
 * cannot be kept apart from other projects' steps on a host every project
 * shares (GlobalRunnerWork).
 *
 * decideRunnerByDefaultOrder is the order itself, for any work that picks a
 * Runner (a runbook step, a rule); decideRunnerChoice is a runbook step's
 * reading of it, with the words a step's error says. Pure, so the server
 * (GlobalRunnerChoice, which reads the facts) and the Dashboard (whose
 * picker shows what the work will run on) answer the same question the
 * same way.
 */

/*
 * What a step (or rule) stores to pick the Global Runner itself, rather
 * than whatever its project's default is: never an id, so never a Runner
 * that can be deleted out from under it. Stored by the Runner picker only
 * while the project has a default Runner - without one the Global Runner IS
 * the default, which a step that picks nothing ("") follows.
 */
export const GLOBAL_RUNNER_CHOICE_ID: string = "global";

export enum RunnerChoiceRefusal {
  // The step names a Runner by something that is not an ID.
  InvalidRunnerId = "invalid_runner_id",
  // The step names a Runner that is not one of its project's any more.
  RunnerNotFound = "runner_not_found",
  /*
   * The step is to run on the global Runners - it picked none, and its
   * project has no default Runner, or it picked the Global Runner - and
   * global Runners never run its type.
   */
  NeedsOwnRunner = "needs_own_runner",
  // ... and its project turned global Runners off.
  ProjectTurnedGlobalRunnersOff = "project_turned_global_runners_off",
  // ... and the server has no global Runner.
  NoGlobalRunner = "no_global_runner",
}

export type RunnerChoiceDecision =
  | {
      kind: "custom";
      runnerId: string;
      /*
       * The step picked no Runner and runs on its project's default
       * Runner. Left out for a Runner the step picked.
       */
      isProjectDefault?: true;
    }
  | { kind: "global" }
  | { kind: "refused"; refusal: RunnerChoiceRefusal; message: string };

// What the Runner a step picked turned out to be, once it is looked up.
export enum ChosenRunnerKind {
  // One of the step's own project's Runners.
  ProjectRunner = "project_runner",
  // A global Runner: picking one is picking the Global Runner.
  GlobalRunner = "global_runner",
  // Not a Runner of the project, nor a global one (deleted, or another project's).
  NotFound = "not_found",
}

// ----------------------------------------------------- the default order

// Where work runs, by the default order, before a step words it.
export enum RunnerSource {
  // The Runner the work picked: one of its project's own.
  Picked = "picked",
  // Its project's default Runner: the work picked none.
  ProjectDefault = "project_default",
  // The global Runners: the work picked none, or picked the Global Runner.
  Global = "global",
  // Nothing may run it: `refusal` says why.
  None = "none",
}

export type RunnerDefaultOrderResult =
  | { source: RunnerSource.Picked; runnerId: string }
  | { source: RunnerSource.ProjectDefault; runnerId: string }
  | { source: RunnerSource.Global }
  | {
      source: RunnerSource.None;
      refusal: RunnerChoiceRefusal;
      // Whether the work picked the Global Runner itself (for the words).
      pickedGlobalRunner: boolean;
    };

export interface RunnerDefaultOrderFacts {
  /*
   * The Runner the work picked, as stored: "" (or nothing) for none,
   * GLOBAL_RUNNER_CHOICE_ID for the Global Runner, or a Runner's id.
   */
  chosenRunnerId?: string | null | undefined;
  /*
   * What the picked id is, once looked up. Asked only when the work picked
   * one with a valid ID; absent reads as one of the project's own.
   */
  chosenRunnerKind?: ChosenRunnerKind | undefined;
  /*
   * The project's default Runner (Runner.isProjectDefault, one that may be
   * it: ProjectDefaultRunner): "" (or nothing) when it has none. Read only
   * for work that picked none.
   */
  projectDefaultRunnerId?: string | null | undefined;
  // Whether global Runners may run this work at all (GlobalRunnerWork).
  canGlobalRunnersRunWork: boolean;
  // Whether the work's project uses global Runners (Project.useGlobalRunners).
  projectUsesGlobalRunners: boolean;
  // Whether the server has a global Runner that runs this work.
  hasGlobalRunner: boolean;
}

// The ID a step picked, trimmed: "" when it picked none.
export function getChosenRunnerId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isRunnerId(value: string): boolean {
  return ObjectID.isValidUUID(value);
}

// Whether a stored pick is the Global Runner itself (any letter case).
export function isGlobalRunnerChoice(value: unknown): boolean {
  return getChosenRunnerId(value).toLowerCase() === GLOBAL_RUNNER_CHOICE_ID;
}

/*
 * The global Runners, when they may run the work - or why not. Held to the
 * same three facts whether the work picked none or picked the Global Runner.
 */
function goGlobal(
  facts: RunnerDefaultOrderFacts,
  pickedGlobalRunner: boolean,
): RunnerDefaultOrderResult {
  if (!facts.canGlobalRunnersRunWork) {
    return {
      source: RunnerSource.None,
      refusal: RunnerChoiceRefusal.NeedsOwnRunner,
      pickedGlobalRunner,
    };
  }

  if (!facts.projectUsesGlobalRunners) {
    return {
      source: RunnerSource.None,
      refusal: RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff,
      pickedGlobalRunner,
    };
  }

  if (!facts.hasGlobalRunner) {
    return {
      source: RunnerSource.None,
      refusal: RunnerChoiceRefusal.NoGlobalRunner,
      pickedGlobalRunner,
    };
  }

  return { source: RunnerSource.Global };
}

/*
 * THE DEFAULT ORDER: the work's own Runner, then its project's default
 * Runner, then the Global Runner where the work allows it - otherwise none,
 * with the reason.
 */
export function decideRunnerByDefaultOrder(
  facts: RunnerDefaultOrderFacts,
): RunnerDefaultOrderResult {
  const chosenRunnerId: string = getChosenRunnerId(facts.chosenRunnerId);

  if (isGlobalRunnerChoice(chosenRunnerId)) {
    return goGlobal(facts, true);
  }

  if (chosenRunnerId) {
    if (!isRunnerId(chosenRunnerId)) {
      return {
        source: RunnerSource.None,
        refusal: RunnerChoiceRefusal.InvalidRunnerId,
        pickedGlobalRunner: false,
      };
    }

    if (facts.chosenRunnerKind === ChosenRunnerKind.NotFound) {
      return {
        source: RunnerSource.None,
        refusal: RunnerChoiceRefusal.RunnerNotFound,
        pickedGlobalRunner: false,
      };
    }

    // A pick of one of the project's own Runners always wins.
    if (facts.chosenRunnerKind !== ChosenRunnerKind.GlobalRunner) {
      return { source: RunnerSource.Picked, runnerId: chosenRunnerId };
    }

    /*
     * Work that names one global Runner picked the Global Runner: the
     * global Runners are one choice, whichever of them is free takes it.
     */
    return goGlobal(facts, true);
  }

  const projectDefaultRunnerId: string = getChosenRunnerId(
    facts.projectDefaultRunnerId,
  );

  if (projectDefaultRunnerId && isRunnerId(projectDefaultRunnerId)) {
    return {
      source: RunnerSource.ProjectDefault,
      runnerId: projectDefaultRunnerId,
    };
  }

  return goGlobal(facts, false);
}

// ---------------------------------------------------- a runbook step's words

export interface RunnerChoiceFacts {
  // The step's type, as stored ("JavaScript", "Bash", "SSH", "Kubernetes").
  stepType: string;
  /*
   * The Runner the step picked, as stored: "" (or nothing) when it picked
   * none, GLOBAL_RUNNER_CHOICE_ID for the Global Runner.
   */
  chosenRunnerId?: string | null | undefined;
  /*
   * What the picked Runner is, once looked up. Asked only when the step
   * picked one with a valid ID; absent reads as one of the project's own.
   */
  chosenRunnerKind?: ChosenRunnerKind | undefined;
  /*
   * The step's project's default Runner: "" (or nothing) when it has none.
   * Read only for a step that picked none.
   */
  projectDefaultRunnerId?: string | null | undefined;
  // Whether the step's project uses global Runners (Project.useGlobalRunners).
  projectUsesGlobalRunners: boolean;
  // Whether the server has a global Runner that runs runbook steps.
  hasGlobalRunner: boolean;
}

/*
 * The refusal's words. The step type names the step ("This Bash step"); a
 * value the step stored is quoted, never trusted to be short, so it is cut.
 * A step that picked the Global Runner itself is told so, and not pointed
 * at a project default it does not follow.
 */
export function describeRunnerChoiceRefusal(data: {
  refusal: RunnerChoiceRefusal;
  stepType: string;
  chosenRunnerId?: string | undefined;
  pickedGlobalRunner?: boolean | undefined;
}): string {
  const step: string = `This ${data.stepType || "runbook"} step`;
  const pickedGlobalRunner: boolean = data.pickedGlobalRunner === true;

  switch (data.refusal) {
    case RunnerChoiceRefusal.InvalidRunnerId: {
      const raw: string = data.chosenRunnerId || "";
      const shown: string = raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;

      return `${step} names its Runner by "${shown}", which is not a Runner ID. Open the step and pick its Runner again.`;
    }
    case RunnerChoiceRefusal.RunnerNotFound:
      return `${step} picked a Runner that is not one of this project's Runners any more. It may have been deleted. Open the step and pick another Runner.`;
    case RunnerChoiceRefusal.NeedsOwnRunner:
      return pickedGlobalRunner
        ? `${step} picks the Global Runner, but global Runners run JavaScript steps only: ${data.stepType} steps run on a Runner of your own, inside your network. Pick one of your Runners for the step.`
        : `${step} has no Runner. ${data.stepType} steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only. Pick one of your Runners for the step, or make one the project's default Runner under Runbooks → Runners.`;
    case RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff:
      return pickedGlobalRunner
        ? `${step} picks the Global Runner, and this project does not use global Runners. Pick one of your Runners for the step, or turn global Runners on under Runbooks → Runners.`
        : `${step} has no Runner of its own, and this project does not use global Runners. Pick one of your Runners for the step, make one the project's default Runner, or turn global Runners on under Runbooks → Runners.`;
    case RunnerChoiceRefusal.NoGlobalRunner:
      return pickedGlobalRunner
        ? `${step} picks the Global Runner, and there is no global Runner to run it. Pick one of your Runners for the step.`
        : `${step} has no Runner of its own, and there is no global Runner to run it. Pick one of your Runners for the step, or make one the project's default Runner under Runbooks → Runners.`;
    default: {
      const unhandled: never = data.refusal;
      return unhandled;
    }
  }
}

// The default order's answer for a step, in a step's words.
export function toRunnerChoiceDecision(data: {
  result: RunnerDefaultOrderResult;
  stepType: string;
  chosenRunnerId?: string | null | undefined;
}): RunnerChoiceDecision {
  switch (data.result.source) {
    case RunnerSource.Picked:
      return { kind: "custom", runnerId: data.result.runnerId };
    case RunnerSource.ProjectDefault:
      return {
        kind: "custom",
        runnerId: data.result.runnerId,
        isProjectDefault: true,
      };
    case RunnerSource.Global:
      return { kind: "global" };
    case RunnerSource.None: {
      const chosenRunnerId: string = getChosenRunnerId(data.chosenRunnerId);

      return {
        kind: "refused",
        refusal: data.result.refusal,
        message: describeRunnerChoiceRefusal({
          refusal: data.result.refusal,
          stepType: data.stepType,
          pickedGlobalRunner: data.result.pickedGlobalRunner,
          ...(data.result.refusal === RunnerChoiceRefusal.InvalidRunnerId
            ? { chosenRunnerId }
            : {}),
        }),
      };
    }
    default: {
      const unhandled: never = data.result;
      return unhandled;
    }
  }
}

/*
 * The refusal a step earns from what it says alone, whatever the server's
 * facts are: a Runner named by something that is not an ID, or the Global
 * Runner picked on a step type global Runners never run. Null when the
 * facts decide - asked with every fact on the step's side (a project
 * default Runner there to run a step that picked none, global Runners on
 * and there), so only those two can refuse here. Pure and read before
 * anything is looked up, so a step that can never run fails without
 * touching the database.
 */
export function getRunnerChoiceRefusalFromStep(data: {
  stepType: string;
  chosenRunnerId?: string | null | undefined;
}): RunnerChoiceDecision | null {
  const decision: RunnerChoiceDecision = decideRunnerChoice({
    stepType: data.stepType,
    chosenRunnerId: data.chosenRunnerId,
    // Any project default: a step that picked none may follow one.
    projectDefaultRunnerId: ObjectID.getZeroObjectID().toString(),
    projectUsesGlobalRunners: true,
    hasGlobalRunner: true,
  });

  return decision.kind === "refused" ? decision : null;
}

// Where a runbook step runs: the default order, in a step's words.
export function decideRunnerChoice(
  facts: RunnerChoiceFacts,
): RunnerChoiceDecision {
  return toRunnerChoiceDecision({
    result: decideRunnerByDefaultOrder({
      chosenRunnerId: facts.chosenRunnerId,
      chosenRunnerKind: facts.chosenRunnerKind,
      projectDefaultRunnerId: facts.projectDefaultRunnerId,
      canGlobalRunnersRunWork: canGlobalRunnersRunStepType(facts.stepType),
      projectUsesGlobalRunners: facts.projectUsesGlobalRunners,
      hasGlobalRunner: facts.hasGlobalRunner,
    }),
    stepType: facts.stepType,
    chosenRunnerId: facts.chosenRunnerId,
  });
}
