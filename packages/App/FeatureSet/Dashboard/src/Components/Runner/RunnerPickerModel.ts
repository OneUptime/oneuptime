import RunnerLiveStatus from "Common/Types/Runner/RunnerLiveStatus";
import { canGlobalRunnersRunStepType } from "Common/Types/Runner/GlobalRunnerWork";
import { getChosenRunnerId } from "Common/Types/Runner/RunnerChoice";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Runner picker shows for a step - or for a code repository, whose
 * Runner setting in Code picks the Runner AI works in it on - worked out
 * from what the page loaded - React-free, so App's tests read the same
 * rules the picker draws.
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

/*
 * What a Runner is picked for. The global choice means the same to people
 * either way - a Runner OneUptime runs for every project - but different
 * global Runners stand behind it: a step's JavaScript runs on the global
 * Runners' sandbox; a repository's AI work runs on the global Runner for
 * code (the installation's bundled Runner, OneUptime Cloud's fleet), which
 * never runs a repository's own commands
 * (Common/Types/Runner/CodeRepositoryRunner).
 */
export enum RunnerPickerWork {
  RunbookStep = "runbook-step",
  CodeRepository = "code-repository",
}

export const GLOBAL_RUNNER_CHOICE_LABEL: string =
  translationKey("Global Runner");

export const GLOBAL_RUNNER_CHOICE_DESCRIPTION: string = translationKey(
  "Run by OneUptime for every project, in a sandbox that reaches the internet only.",
);

/*
 * Under the picker of a step that global Runners could run, in a project
 * that turned them off: why there is no global choice, and what to do.
 */
export const GLOBAL_RUNNERS_OFF_HELPER_TEXT: string = translationKey(
  "This project does not use global Runners: pick one of your Runners for this step.",
);

/*
 * Under the picker of a step on Global Runner while no global Runner is
 * connected: the step is queued for one and fails after its claim timeout
 * if none comes back, so the page says so before the run does.
 */
export const GLOBAL_RUNNER_NOT_CONNECTED_TEXT: string = translationKey(
  "No global Runner is connected right now. The step fails if none picks it up within its claim timeout.",
);

// The global choice, under its name, in a code repository's picker.
export const CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION: string = translationKey(
  "Run by OneUptime for every project. It skips your setup, build and test commands.",
);

/*
 * Under a code repository's picker on Global Runner: where AI works, and
 * why a team picks one of its own Runners instead.
 */
export const CODE_GLOBAL_RUNNER_HELPER_TEXT: string = translationKey(
  "AI works on a Runner OneUptime runs for every project, which skips your setup, build and test commands. Pick one of your Runners to have them run.",
);

// Under a code repository's picker on one of the project's own Runners.
export const CODE_OWN_RUNNER_HELPER_TEXT: string = translationKey(
  "AI clones the repository on this Runner, runs your setup, build and test commands there, and opens the pull request.",
);

// Under a code repository's picker in a project that turned global Runners off.
export const CODE_GLOBAL_RUNNERS_OFF_HELPER_TEXT: string = translationKey(
  "This project does not use global Runners: pick one of your Runners for this repository.",
);

// Under a code repository's picker on Global Runner while none is connected.
export const CODE_GLOBAL_RUNNER_NOT_CONNECTED_TEXT: string = translationKey(
  "No global Runner is connected right now, so AI cannot work in this repository until one is.",
);

// Under a code repository's picker that names a Runner the project no longer has.
export const CODE_UNKNOWN_RUNNER_HELPER_TEXT: string = translationKey(
  "This repository picked a Runner that is not one of this project's Runners any more, so AI cannot work in it. Pick another Runner.",
);

export interface RunnerPickerRunner {
  id: string;
  name: string;
  liveStatus: RunnerLiveStatus;
}

export interface RunnerPickerFacts {
  // What the Runner is picked for; a runbook step when left out.
  work?: RunnerPickerWork | undefined;
  /*
   * The step's type ("JavaScript", "Bash", "SSH", "Kubernetes"); not read
   * for a code repository.
   */
  stepType: string;
  // The Runner the step picked, as stored: "" when it picked none.
  currentRunnerId: string;
  // The project's own Runners.
  projectRunners: Array<RunnerPickerRunner>;
  /*
   * The global Runners that run this work, with how each is doing (and
   * their ids: a step that names one is on the global Runners, as the
   * server reads it): the ones that run runbook steps, or - for a code
   * repository - the global Runners for code.
   */
  globalRunners: Array<{
    id?: string | undefined;
    liveStatus: RunnerLiveStatus;
  }>;
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
  // Picked none, and global Runners never run this step type (steps only).
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

// Whether global Runners run this work at all: every repository, a step by its type.
export function canGlobalRunnersRunWork(
  facts: Pick<RunnerPickerFacts, "work" | "stepType">,
): boolean {
  return (
    facts.work === RunnerPickerWork.CodeRepository ||
    canGlobalRunnersRunStepType(facts.stepType)
  );
}

// Whether the picker offers the global choice for this step or repository.
export function offersGlobalRunner(
  facts: Pick<
    RunnerPickerFacts,
    "work" | "stepType" | "globalRunners" | "projectUsesGlobalRunners"
  >,
): boolean {
  return (
    canGlobalRunnersRunWork(facts) &&
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
    facts.globalRunners.some((runner: { id?: string | undefined }): boolean => {
      return (runner.id || "").toLowerCase() === currentRunnerId.toLowerCase();
    });

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
    outcome: !canGlobalRunnersRunWork(facts)
      ? RunnerPickerOutcome.NeedsOwnRunner
      : !facts.projectUsesGlobalRunners
        ? RunnerPickerOutcome.GlobalRunnersOff
        : RunnerPickerOutcome.NoGlobalRunner,
    willRun: false,
  };
}

/*
 * What the step runs on, for the line under a folded step's title
 * ("JavaScript on Global Runner", "Bash script on prod-eu-west-1"): the
 * global choice - whose name is a translation key, so `isGlobal` says to
 * translate it - or the project Runner's own name. Undefined while the
 * step cannot run as it is: no Runner picked, or one that is gone.
 */
export interface RunnerSummary {
  name: string;
  isGlobal: boolean;
}

export function getRunnerSummary(
  model: RunnerPickerModel,
): RunnerSummary | undefined {
  if (!model.willRun || !model.selected) {
    return undefined;
  }

  return {
    name: model.selected.name,
    isGlobal: model.selected.kind === RunnerPickerOptionKind.Global,
  };
}

/*
 * The step is on Global Runner and no global Runner is connected now: it
 * would wait in the queue and fail after its claim timeout.
 */
export function isGlobalRunnerChoiceWaiting(model: RunnerPickerModel): boolean {
  return (
    model.outcome === RunnerPickerOutcome.GlobalRunner &&
    model.selected?.liveStatus !== RunnerLiveStatus.Connected
  );
}
