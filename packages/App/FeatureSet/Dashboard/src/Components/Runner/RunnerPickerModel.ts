import RunnerLiveStatus from "Common/Types/Runner/RunnerLiveStatus";
import { canGlobalRunnersRunStepType } from "Common/Types/Runner/GlobalRunnerWork";
import { getChosenRunnerId } from "Common/Types/Runner/RunnerChoice";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Runner picker shows for a step, worked out from what the page
 * loaded - React-free, so App's tests read the same rules the picker draws.
 *
 * It follows the server's one "global by default" rule
 * (Common/Types/Runner/RunnerChoice): a step that picked a Runner of its
 * project's own runs on it; a step that picked none runs on the global
 * Runners - the ones OneUptime runs for every project - when they can run it
 * (GlobalRunnerWork), the project uses them and there is one. So the picker
 * offers the global choice first, and it is the choice a step that picked
 * none shows, rather than an empty box; it never says "no Runners" while a
 * global Runner can run the step.
 */

// What the global choice stores on a step: no Runner of its own.
export const GLOBAL_RUNNER_CHOICE_VALUE: string = "";

export const GLOBAL_RUNNER_CHOICE_LABEL: string =
  translationKey("Global Runner");

export const GLOBAL_RUNNER_CHOICE_DESCRIPTION: string = translationKey(
  "Run by OneUptime for every project, in a sandbox that reaches the internet only.",
);

export interface RunnerPickerRunner {
  id: string;
  name: string;
  liveStatus: RunnerLiveStatus;
}

export interface RunnerPickerFacts {
  // The step's type ("JavaScript", "Bash", "SSH", "Kubernetes").
  stepType: string;
  // The Runner the step picked, as stored: "" when it picked none.
  currentRunnerId: string;
  // The project's own Runners.
  projectRunners: Array<RunnerPickerRunner>;
  /*
   * The global Runners that run runbook steps, with how each is doing (and
   * their ids: a step that names one is on the global Runners, as the
   * server reads it).
   */
  globalRunners: Array<{ id?: string | undefined; liveStatus: RunnerLiveStatus }>;
  // Whether the project uses global Runners (Project.useGlobalRunners).
  projectUsesGlobalRunners: boolean;
}

export enum RunnerPickerOptionKind {
  Global = "global",
  Project = "project",
  // A Runner the step names that is not one of the project's any more.
  Unknown = "unknown",
}

export interface RunnerPickerOption {
  value: string;
  kind: RunnerPickerOptionKind;
  // The Runner's own name, or the global choice's label (a translation key).
  name: string;
  // How the Runner is doing; for the global choice, the best of them.
  liveStatus?: RunnerLiveStatus | undefined;
}

// What the step runs on as it is now, for the line under the picker.
export enum RunnerPickerOutcome {
  GlobalRunner = "global",
  ProjectRunner = "project",
  UnknownRunner = "unknown",
  // Picked none, and global Runners never run this step type.
  NeedsOwnRunner = "needs-own-runner",
  // Picked none, and the project turned global Runners off.
  GlobalRunnersOff = "global-runners-off",
  // Picked none, and the server has no global Runner.
  NoGlobalRunner = "no-global-runner",
}

export interface RunnerPickerModel {
  // In order: the global choice first when it is offered, then the project's Runners.
  options: Array<RunnerPickerOption>;
  // The option the step has now; undefined when it has none to show.
  selected: RunnerPickerOption | undefined;
  outcome: RunnerPickerOutcome;
  // Whether the step can run as it is: a Runner of its own, or a global one.
  willRun: boolean;
}

/*
 * The best status among the global Runners: Connected when any is, else
 * Disconnected when any ever connected, else Never connected. The step runs
 * on whichever is free, so one connected global Runner is enough.
 */
export function getGlobalRunnersLiveStatus(
  globalRunners: Array<{ liveStatus: RunnerLiveStatus }>,
): RunnerLiveStatus {
  const statuses: Array<RunnerLiveStatus> = globalRunners.map(
    (runner: { liveStatus: RunnerLiveStatus }): RunnerLiveStatus => {
      return runner.liveStatus;
    },
  );

  if (statuses.includes(RunnerLiveStatus.Connected)) {
    return RunnerLiveStatus.Connected;
  }

  if (statuses.includes(RunnerLiveStatus.Disconnected)) {
    return RunnerLiveStatus.Disconnected;
  }

  return RunnerLiveStatus.NeverConnected;
}

// Whether the picker offers the global choice for this step.
export function offersGlobalRunner(
  facts: Pick<
    RunnerPickerFacts,
    "stepType" | "globalRunners" | "projectUsesGlobalRunners"
  >,
): boolean {
  return (
    canGlobalRunnersRunStepType(facts.stepType) &&
    facts.projectUsesGlobalRunners &&
    facts.globalRunners.length > 0
  );
}

export function buildRunnerPickerModel(
  facts: RunnerPickerFacts,
): RunnerPickerModel {
  const currentRunnerId: string = getChosenRunnerId(facts.currentRunnerId);
  const isGlobalOffered: boolean = offersGlobalRunner(facts);

  const globalOption: RunnerPickerOption | undefined = isGlobalOffered
    ? {
        value: GLOBAL_RUNNER_CHOICE_VALUE,
        kind: RunnerPickerOptionKind.Global,
        name: GLOBAL_RUNNER_CHOICE_LABEL,
        liveStatus: getGlobalRunnersLiveStatus(facts.globalRunners),
      }
    : undefined;

  const projectOptions: Array<RunnerPickerOption> = facts.projectRunners.map(
    (runner: RunnerPickerRunner): RunnerPickerOption => {
      return {
        value: runner.id,
        kind: RunnerPickerOptionKind.Project,
        name: runner.name,
        liveStatus: runner.liveStatus,
      };
    },
  );

  const currentProjectOption: RunnerPickerOption | undefined = currentRunnerId
    ? projectOptions.find((option: RunnerPickerOption): boolean => {
        return option.value.toLowerCase() === currentRunnerId.toLowerCase();
      })
    : undefined;

  // A step that names one global Runner is on the global Runners.
  const namesGlobalRunner: boolean =
    Boolean(currentRunnerId) &&
    facts.globalRunners.some(
      (runner: { id?: string | undefined }): boolean => {
        return (
          (runner.id || "").toLowerCase() === currentRunnerId.toLowerCase()
        );
      },
    );

  const unknownOption: RunnerPickerOption | undefined =
    currentRunnerId && !currentProjectOption && !namesGlobalRunner
      ? {
          value: currentRunnerId,
          kind: RunnerPickerOptionKind.Unknown,
          name: currentRunnerId,
        }
      : undefined;

  const options: Array<RunnerPickerOption> = [
    ...(globalOption ? [globalOption] : []),
    ...(unknownOption ? [unknownOption] : []),
    ...projectOptions,
  ];

  if (currentProjectOption) {
    return {
      options,
      selected: currentProjectOption,
      outcome: RunnerPickerOutcome.ProjectRunner,
      willRun: true,
    };
  }

  if (unknownOption) {
    return {
      options,
      selected: unknownOption,
      outcome: RunnerPickerOutcome.UnknownRunner,
      willRun: false,
    };
  }

  if (globalOption) {
    return {
      options,
      selected: globalOption,
      outcome: RunnerPickerOutcome.GlobalRunner,
      willRun: true,
    };
  }

  return {
    options,
    selected: undefined,
    outcome: !canGlobalRunnersRunStepType(facts.stepType)
      ? RunnerPickerOutcome.NeedsOwnRunner
      : !facts.projectUsesGlobalRunners
        ? RunnerPickerOutcome.GlobalRunnersOff
        : RunnerPickerOutcome.NoGlobalRunner,
    willRun: false,
  };
}
