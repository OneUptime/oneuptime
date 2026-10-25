import RunnerLiveStatus from "Common/Types/Runner/RunnerLiveStatus";
import { canGlobalRunnersRunStepType } from "Common/Types/Runner/GlobalRunnerWork";
import {
  ChosenRunnerKind,
  GLOBAL_RUNNER_CHOICE_ID,
  RunnerChoiceRefusal,
  RunnerDefaultOrderResult,
  RunnerSource,
  decideRunnerByDefaultOrder,
  getChosenRunnerId,
  isGlobalRunnerChoice,
} from "Common/Types/Runner/RunnerChoice";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Runner picker shows for a step - or for a code repository, whose
 * Runner setting in Code picks the Runner AI works in it on, or an auto
 * remediation rule - worked out from what the page loaded - React-free, so
 * App's tests read the same rules the picker draws.
 *
 * For a runbook step it follows the server's one rule, in its default order
 * (Common/Types/Runner/RunnerChoice, decideRunnerByDefaultOrder): a step
 * that picked a Runner of its project's own runs on it; a step that picked
 * none runs on the project's default Runner when the project has one, and
 * otherwise on the global Runners - the ones OneUptime runs for every
 * project - when they can run it (GlobalRunnerWork), the project uses them
 * and there is one. So the picker's first choice is that default - "the
 * project's default Runner" or "Global Runner" - and it is what a step that
 * picked none shows, rather than an empty box.
 *
 * The Global Runner is always in the list where the server has one: a
 * choice of its own while the project has a default Runner (a step can
 * still pick it), and drawn but never picked where it may not run the step -
 * a Bash, SSH or kubectl step, which global Runners never run, or a project
 * that turned them off - with why, so nobody wonders where it went.
 *
 * An AI rule's picker lists the project's own Runners - its default Runner
 * first, tagged as the default; a new rule's form starts on it - and the
 * Global Runner, which is what a rule that picks none shows wherever the
 * project uses global Runners and the server has one: "If there are no
 * runners, it should use the global runner by default" - the maintainer.
 * It is the rule's choice of no Runner of its own, stored as none: a global
 * Runner never runs a shell - one cannot be kept apart from the other
 * projects on a host every project shares (Common/Types/Runner/
 * GlobalRunnerWork) - so on it OneUptime AI runs no Bash commands for the
 * rule, and the line under the picker says so, with where a Runner of the
 * project's own is picked or added to run them. Commands on the affected
 * cluster or host go through its AI agent whatever the rule picks: that
 * agent is not a Runner, and no choice. Where there is no Global Runner to
 * show - a project that turned them off, or a server with none - a rule
 * that picks none reads "No Runner", as it always did, and can be cleared
 * back to it.
 */

/*
 * What the first choice of a runbook step stores: no Runner of its own, so
 * the project's default - its default Runner, or else the Global Runner.
 * What the Global Runner stores for a code repository and a rule, too.
 */
export const GLOBAL_RUNNER_CHOICE_VALUE: string = "";

// The step's first choice, the project's default, by the same value.
export const PROJECT_DEFAULT_CHOICE_VALUE: string = GLOBAL_RUNNER_CHOICE_VALUE;

/*
 * What a step stores to pick the Global Runner itself while the project
 * has a default Runner (Common/Types/Runner/RunnerChoice).
 */
export const GLOBAL_RUNNER_PICK_VALUE: string = GLOBAL_RUNNER_CHOICE_ID;

/*
 * What a Runner is picked for. The global choice means the same to people
 * either way - a Runner OneUptime runs for every project - but different
 * global Runners stand behind it: a step's JavaScript runs on the global
 * Runners' sandbox; a repository's AI work runs on the global Runner for
 * code (the installation's bundled Runner, OneUptime Cloud's fleet), which
 * runs no command - it does not build or test AI's change
 * (Common/Types/Runner/CodeRepositoryRunner).
 */
export enum RunnerPickerWork {
  RunbookStep = "runbook-step",
  CodeRepository = "code-repository",
  /*
   * An AI rule's Runner (AutoRemediationRule.runnerId): the Runner OneUptime
   * AI runs the rule's Bash commands on. The global Runners never run them
   * (they run JavaScript steps in a sandbox every project shares), so a
   * rule's commands run on one of the project's own Runners only, and a rule
   * may pick none (Common/Types/AutoRemediation/AutoRemediationFix) - shown
   * as the Global Runner where there is one, on which it runs no commands.
   */
  AutoRemediation = "auto-remediation",
}

export const GLOBAL_RUNNER_CHOICE_LABEL: string =
  translationKey("Global Runner");

export const GLOBAL_RUNNER_CHOICE_DESCRIPTION: string = translationKey(
  "Run by OneUptime for every project, in a sandbox that reaches the internet only.",
);

/*
 * The tag the project's default Runner carries wherever it is listed: the
 * picker's first choice ("prod-runner · Project default · Connected"), the
 * Runners list, the Runner's own page.
 */
export const PROJECT_DEFAULT_TAG: string = translationKey("Project default");

/*
 * Why the Global Runner is drawn but cannot be picked, under its name in
 * the menu: the step's type, which global Runners never run - a shell
 * cannot be kept apart from other projects' steps on a host every project
 * shares - or the project, which turned them off.
 */
export enum GlobalRunnerUnavailableReason {
  StepType = "step-type",
  ProjectTurnedOff = "project-turned-off",
}

export const GLOBAL_RUNNER_STEP_TYPE_UNAVAILABLE_TEXT: string = translationKey(
  "Runs JavaScript steps only.",
);

export const GLOBAL_RUNNER_TURNED_OFF_UNAVAILABLE_TEXT: string = translationKey(
  "This project does not use global Runners.",
);

/*
 * Under the picker of a step global Runners never run that picked no
 * Runner, in a project with no default Runner ({{stepType}}: the step's
 * name; {{location}}: a link to Runbooks › Runners): why the Global Runner
 * is not open to it, and the two ways on - in one line.
 */
export const NEEDS_OWN_RUNNER_TEMPLATE: string = translationKey(
  "{{stepType}} steps run on a Runner of your own, inside your network: the Global Runner runs JavaScript steps only. Pick one, or make one the project default under {{location}}.",
);

/*
 * The same, with no Runner of the project's own to pick: where one is
 * added.
 */
export const NEEDS_OWN_RUNNER_ADD_TEMPLATE: string = translationKey(
  "{{stepType}} steps run on a Runner of your own, inside your network: the Global Runner runs JavaScript steps only. Add one under {{location}}, then pick it here.",
);

/*
 * Under the picker of a step global Runners never run that picked the
 * Global Runner itself (an API client, or a step whose type changed).
 */
export const PICKED_GLOBAL_RUNNER_NEEDS_OWN_TEXT: string = translationKey(
  "This step picks the Global Runner, which runs JavaScript steps only. Pick one of your Runners.",
);

/*
 * Under the picker of a step global Runners could run, in a project that
 * turned them off and has no default Runner: why there is no global choice,
 * and what to do.
 */
export const GLOBAL_RUNNERS_OFF_HELPER_TEXT: string = translationKey(
  "This project does not use global Runners: pick one of your Runners for this step.",
);

/*
 * Under the picker of a step global Runners could run that picked no
 * Runner, on a server that runs none, in a project with no default Runner.
 */
export const STEP_NO_GLOBAL_RUNNER_HELPER_TEXT: string = translationKey(
  "This server runs no global Runner: pick one of your Runners for this step.",
);

/*
 * Under the picker of a step on Global Runner while no global Runner is
 * connected: the step is queued for one and fails after its claim timeout
 * if none comes back, so the page says so before the run does.
 */
export const GLOBAL_RUNNER_NOT_CONNECTED_TEXT: string = translationKey(
  "No global Runner is connected right now. The step fails if none picks it up within its claim timeout.",
);

/*
 * Under the picker of a step on one of the project's own Runners - the one
 * it picked, or the project's default - that is not connected
 * ({{runner}}: its name): the same, for that Runner.
 */
export const RUNNER_NOT_CONNECTED_TEMPLATE: string = translationKey(
  "{{runner}} is not connected right now. The step fails if this Runner does not pick it up within its claim timeout.",
);

/*
 * The global choice, under its name, in a code repository's picker - and
 * under "Global Runner" on its settings: it runs no command, so AI's change
 * is not built or tested before its pull request opens (the repository's
 * own CI checks it).
 */
export const CODE_GLOBAL_RUNNER_CHOICE_DESCRIPTION: string = translationKey(
  "Run by OneUptime for every project. It does not build or test AI's change before the pull request opens.",
);

/*
 * Under a code repository's picker on Global Runner: where AI works, and
 * why a team picks one of its own Runners instead.
 */
export const CODE_GLOBAL_RUNNER_HELPER_TEXT: string = translationKey(
  "AI works on a Runner OneUptime runs for every project, which does not build or test its change. Pick one of your Runners to have AI build and test it before the pull request opens.",
);

/*
 * Under a code repository's picker on one of the project's own Runners: AI
 * builds and tests there the way the repository says to (its AGENTS.md).
 */
export const CODE_OWN_RUNNER_HELPER_TEXT: string = translationKey(
  "AI clones the repository on this Runner, builds and tests its change there the way the repository's AGENTS.md says, and opens the pull request.",
);

// Under a code repository's picker in a project that turned global Runners off.
export const CODE_GLOBAL_RUNNERS_OFF_HELPER_TEXT: string = translationKey(
  "This project does not use global Runners: pick one of your Runners for this repository.",
);

// Under a code repository's picker on Global Runner while none is connected.
export const CODE_GLOBAL_RUNNER_NOT_CONNECTED_TEXT: string = translationKey(
  "No global Runner is connected right now, so AI cannot work in this repository until one is.",
);

/*
 * A repository's pick that is not among the Runners the reader was shown.
 * A repository can only pick one of its project's own Runners, and one that
 * is deleted leaves the repository on Global Runner (SET NULL), so such a
 * pick is a Runner the reader may not see - not a broken one: the menu, the
 * line under it and the settings card say so, without an id or a warning.
 */
export const CODE_HIDDEN_RUNNER_LABEL: string = translationKey(
  "A Runner you do not have access to",
);

export const CODE_HIDDEN_RUNNER_HELPER_TEXT: string = translationKey(
  "This repository picks a Runner you do not have access to. Pick another Runner to change it.",
);

// Under a code repository's picker that picked none, on a server with no global Runner.
export const CODE_NO_GLOBAL_RUNNER_HELPER_TEXT: string = translationKey(
  "This server runs no global Runner: pick one of your Runners for this repository.",
);

/*
 * What a rule that picked no Runner shows in its picker where there is no
 * Global Runner to show - a project that turned global Runners off, or a
 * server that runs none: nothing picked, said in two words. Never "AI agent
 * on the cluster or host": that agent is not a Runner, and the field's own
 * line says it is used whatever the rule picks.
 */
export const REMEDIATION_NO_RUNNER_PLACEHOLDER: string =
  translationKey("No Runner");

/*
 * Under a rule's picker that picked none and reads "No Runner", in a project
 * with no Runner of its own to pick ({{location}}: a link to Runbooks ›
 * Runners). With Runners to pick from, nothing is said under it: the
 * placeholder and the field's own line say it.
 */
export const REMEDIATION_ADD_RUNNER_TEMPLATE: string = translationKey(
  "Add a Runner under {{location}} for OneUptime AI to run commands on, then pick it here.",
);

/*
 * The Global Runner under its name in a rule's menu: what it is, and what
 * OneUptime AI does not do on it.
 */
export const REMEDIATION_GLOBAL_RUNNER_CHOICE_DESCRIPTION: string =
  translationKey(
    "Run by OneUptime for every project. OneUptime AI runs no Bash commands on it.",
  );

/*
 * Under a rule's picker on the Global Runner - a rule that picked none - in
 * a project with Runners of its own: that OneUptime AI's Bash commands do
 * not run there, why in a few words, and the way to have them run.
 */
export const REMEDIATION_GLOBAL_RUNNER_PICK_TEXT: string = translationKey(
  "OneUptime AI runs no Bash commands on the Global Runner, which every project shares. Pick one of your Runners to run them.",
);

/*
 * The same, in a project with no Runner of its own ({{location}}: a link to
 * Runbooks › Runners, where one is added).
 */
export const REMEDIATION_GLOBAL_RUNNER_ADD_TEMPLATE: string = translationKey(
  "OneUptime AI runs no Bash commands on the Global Runner, which every project shares. Add a Runner under {{location}} to run them.",
);

/*
 * The same, for a reader who may not read the project's Runners: nothing is
 * said of picking or adding one the project may already have.
 */
export const REMEDIATION_GLOBAL_RUNNER_TEXT: string = translationKey(
  "OneUptime AI runs no Bash commands on the Global Runner, which every project shares.",
);

/*
 * A rule's pick that is not among the Runners the reader was shown. A rule
 * can only pick one of its project's own Runners, and one that is deleted
 * leaves the rule with none (SET NULL), so it is one the reader may not see.
 */
export const REMEDIATION_HIDDEN_RUNNER_HELPER_TEXT: string = translationKey(
  "This rule picks a Runner you do not have access to. Pick another Runner to change it.",
);

export interface RunnerPickerRunner {
  id: string;
  name: string;
  liveStatus: RunnerLiveStatus;
  /*
   * The project's default Runner (Runner.isProjectDefault), set by the
   * loader only on one that may be it (Common/Types/Runner/
   * ProjectDefaultRunner). Read for a runbook step and an auto remediation
   * rule.
   */
  isProjectDefault?: boolean | undefined;
}

export interface RunnerPickerFacts {
  // What the Runner is picked for; a runbook step when left out.
  work?: RunnerPickerWork | undefined;
  /*
   * The step's type ("JavaScript", "Bash", "SSH", "Kubernetes"); not read
   * for a code repository.
   */
  stepType: string;
  /*
   * The Runner the step picked, as stored: "" when it picked none,
   * GLOBAL_RUNNER_PICK_VALUE for the Global Runner itself.
   */
  currentRunnerId: string;
  // The project's own Runners.
  projectRunners: Array<RunnerPickerRunner>;
  /*
   * The global Runners that run this work, with how each is doing (and
   * their ids: a step that names one picked the Global Runner, as the
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
  /*
   * The Global Runner where it may not run the step: drawn, with why
   * (`unavailableReason`), and never picked.
   */
  GlobalUnavailable = "global-unavailable",
  Project = "project",
  /*
   * The project's default Runner. A runbook step's first choice while the
   * project has one: no Runner of the step's own, so that Runner. An auto
   * remediation rule's first choice too, by its own id: a rule stores the
   * Runner it picks.
   */
  ProjectDefault = "project-default",
  /*
   * A Runner the step names that is not one of the project's any more - or,
   * for a repository, one the reader may not see (CODE_HIDDEN_RUNNER_LABEL).
   */
  Unknown = "unknown",
}

export interface RunnerPickerOption {
  value: string;
  kind: RunnerPickerOptionKind;
  // The Runner's own name, or the global choice's label (a translation key).
  name: string;
  // How the Runner is doing; for the global choice, the best of them.
  liveStatus?: RunnerLiveStatus | undefined;
  /*
   * The id of the project Runner it stands for: a Runner of the project's
   * own, or - for the first choice - the project's default Runner.
   */
  runnerId?: string | undefined;
  // Why the Global Runner cannot be picked (GlobalUnavailable only).
  unavailableReason?: GlobalRunnerUnavailableReason | undefined;
}

// What the step runs on as it is now, for the line under the picker.
export enum RunnerPickerOutcome {
  GlobalRunner = "global",
  ProjectRunner = "project",
  // Picked none, and runs on the project's default Runner (steps only).
  ProjectDefaultRunner = "project-default",
  UnknownRunner = "unknown",
  /*
   * An AI rule that picked no Runner: OneUptime AI runs no commands of its
   * own for it, and fixes the rest of the way it does. Its picker shows the
   * Global Runner where there is one (`selected`), and "No Runner"
   * otherwise: either way, no Bash command runs anywhere for it.
   */
  NoRunner = "no-runner",
  /*
   * Picked none, with no project default Runner - or picked the Global
   * Runner - and global Runners never run this step type (steps only).
   */
  NeedsOwnRunner = "needs-own-runner",
  // ... and the project turned global Runners off.
  GlobalRunnersOff = "global-runners-off",
  // ... and the server has no global Runner.
  NoGlobalRunner = "no-global-runner",
}

export interface RunnerPickerModel {
  /*
   * In order: the first choice (the project's default, or the global
   * choice), the Global Runner as a choice of its own or drawn as not open
   * to the step, a pick that is gone, then the project's own Runners.
   */
  options: Array<RunnerPickerOption>;
  // The option the step has now; undefined when it has none to show.
  selected: RunnerPickerOption | undefined;
  outcome: RunnerPickerOutcome;
  // Whether the step can run as it is: a Runner of its own, or a global one.
  willRun: boolean;
  // Whether the step picked the Global Runner itself (for the line's words).
  pickedGlobalRunner: boolean;
  /*
   * The project Runner the step runs on - the one it picked, or the
   * project's default - or "" when it runs on none of the project's own.
   * Whether a secret the step names lets that Runner use it is asked of
   * this Runner.
   */
  runnerId: string;
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

/*
 * Whether global Runners run this work at all: every repository, a step by
 * its type, and never an AI rule's commands - a shell never runs on a host
 * every project shares.
 */
export function canGlobalRunnersRunWork(
  facts: Pick<RunnerPickerFacts, "work" | "stepType">,
): boolean {
  if (facts.work === RunnerPickerWork.AutoRemediation) {
    return false;
  }

  return (
    facts.work === RunnerPickerWork.CodeRepository ||
    canGlobalRunnersRunStepType(facts.stepType)
  );
}

/*
 * Whether the picker offers the global choice: for a step or a repository,
 * where global Runners run the work; for an AI rule, as its choice of no
 * Runner of its own - on which none of its commands run - wherever the
 * project uses global Runners and the server has one.
 */
export function offersGlobalRunner(
  facts: Pick<
    RunnerPickerFacts,
    "work" | "stepType" | "globalRunners" | "projectUsesGlobalRunners"
  >,
): boolean {
  if (!facts.projectUsesGlobalRunners || facts.globalRunners.length === 0) {
    return false;
  }

  return (
    facts.work === RunnerPickerWork.AutoRemediation ||
    canGlobalRunnersRunWork(facts)
  );
}

/*
 * The project's default Runner, for a runbook step and an auto remediation
 * rule: the project Runner the loader marked as the default. A step that
 * picks none runs on it; a new rule starts on it, and keeps it as its own
 * pick. Never for a code repository, which picks by its own rule.
 */
export function getProjectDefaultRunner(
  facts: Pick<RunnerPickerFacts, "work" | "projectRunners">,
): RunnerPickerRunner | undefined {
  if (facts.work === RunnerPickerWork.CodeRepository) {
    return undefined;
  }

  return facts.projectRunners.find((runner: RunnerPickerRunner): boolean => {
    return runner.isProjectDefault === true;
  });
}

function sameId(a: string | undefined, b: string): boolean {
  return Boolean(a) && (a || "").toLowerCase() === b.toLowerCase();
}

function toProjectOption(runner: RunnerPickerRunner): RunnerPickerOption {
  return {
    value: runner.id,
    kind: RunnerPickerOptionKind.Project,
    name: runner.name,
    liveStatus: runner.liveStatus,
    runnerId: runner.id,
  };
}

/*
 * An AI rule's picker: the project's own Runners - its default Runner
 * first, tagged, by its own id - the Global Runner, and a pick the reader
 * was not shown, in the order a step's picker lists them.
 *
 * A rule that picked none runs no commands of its own (NoRunner), and that
 * is a rule that works: OneUptime AI fixes through the AI agents, runbooks,
 * MCP servers and pull requests. It shows the Global Runner - the project's
 * default where it has no Runner of its own to start a new rule on - when
 * the project uses global Runners and the server has one, stored as none:
 * a rule never names a global Runner (the server holds a rule to its own
 * project's Runners), and none of its commands runs on one. Without a
 * Global Runner to show, it reads "No Runner".
 *
 * Unlike a step, a rule never follows the project's default Runner: a new
 * rule starts on it, as its own pick (getNewRuleRunnerId), and picking a
 * Runner is what lets OneUptime AI's commands run there - making a Runner
 * the default for runbook steps is not that consent.
 */
function buildRuleModel(facts: RunnerPickerFacts): RunnerPickerModel {
  const currentRunnerId: string = getChosenRunnerId(facts.currentRunnerId);
  const defaultRunner: RunnerPickerRunner | undefined =
    getProjectDefaultRunner(facts);

  const defaultOption: RunnerPickerOption | undefined = defaultRunner
    ? {
        value: defaultRunner.id,
        kind: RunnerPickerOptionKind.ProjectDefault,
        name: defaultRunner.name,
        liveStatus: defaultRunner.liveStatus,
        runnerId: defaultRunner.id,
      }
    : undefined;

  /*
   * The Global Runner: picking it picks no Runner of the project's own
   * (GLOBAL_RUNNER_CHOICE_VALUE, which the rule's form saves as none).
   */
  const globalOption: RunnerPickerOption | undefined = offersGlobalRunner(
    facts,
  )
    ? {
        value: GLOBAL_RUNNER_CHOICE_VALUE,
        kind: RunnerPickerOptionKind.Global,
        name: GLOBAL_RUNNER_CHOICE_LABEL,
        liveStatus: getGlobalRunnersLiveStatus(facts.globalRunners),
      }
    : undefined;

  const projectOptions: Array<RunnerPickerOption> = facts.projectRunners
    .filter((runner: RunnerPickerRunner): boolean => {
      return runner !== defaultRunner;
    })
    .map(toProjectOption);

  const ownOptions: Array<RunnerPickerOption> = [
    ...(defaultOption ? [defaultOption] : []),
    ...projectOptions,
  ];

  const currentOption: RunnerPickerOption | undefined = currentRunnerId
    ? ownOptions.find((option: RunnerPickerOption): boolean => {
        return sameId(option.value, currentRunnerId);
      })
    : undefined;

  const unknownOption: RunnerPickerOption | undefined =
    currentRunnerId && !currentOption
      ? {
          value: currentRunnerId,
          kind: RunnerPickerOptionKind.Unknown,
          name: currentRunnerId,
        }
      : undefined;

  /*
   * The default first, then the Global Runner, then a pick that is not
   * shown, then the rest: a step's picker's order, so the two read alike.
   */
  const options: Array<RunnerPickerOption> = [
    ...(defaultOption ? [defaultOption] : []),
    ...(globalOption ? [globalOption] : []),
    ...(unknownOption ? [unknownOption] : []),
    ...projectOptions,
  ];

  if (currentOption) {
    return {
      options,
      selected: currentOption,
      outcome: RunnerPickerOutcome.ProjectRunner,
      willRun: true,
      pickedGlobalRunner: false,
      runnerId: currentOption.value,
    };
  }

  if (unknownOption) {
    return {
      options,
      selected: unknownOption,
      outcome: RunnerPickerOutcome.UnknownRunner,
      willRun: false,
      pickedGlobalRunner: false,
      runnerId: "",
    };
  }

  return {
    options,
    selected: globalOption,
    outcome: RunnerPickerOutcome.NoRunner,
    willRun: true,
    pickedGlobalRunner: false,
    runnerId: "",
  };
}

// The picker of a code repository.
function buildRepositoryModel(facts: RunnerPickerFacts): RunnerPickerModel {
  const currentRunnerId: string = getChosenRunnerId(facts.currentRunnerId);
  const isGlobalOffered: boolean = offersGlobalRunner(facts);

  // The first choice: the global Runners where they run the work.
  const globalOption: RunnerPickerOption | undefined = isGlobalOffered
    ? {
        value: GLOBAL_RUNNER_CHOICE_VALUE,
        kind: RunnerPickerOptionKind.Global,
        name: GLOBAL_RUNNER_CHOICE_LABEL,
        liveStatus: getGlobalRunnersLiveStatus(facts.globalRunners),
      }
    : undefined;

  const projectOptions: Array<RunnerPickerOption> =
    facts.projectRunners.map(toProjectOption);

  const currentProjectOption: RunnerPickerOption | undefined = currentRunnerId
    ? projectOptions.find((option: RunnerPickerOption): boolean => {
        return sameId(option.value, currentRunnerId);
      })
    : undefined;

  // A pick that names one global Runner is on the global Runners.
  const namesGlobalRunner: boolean =
    Boolean(currentRunnerId) &&
    facts.globalRunners.some((runner: { id?: string | undefined }): boolean => {
      return sameId(runner.id, currentRunnerId);
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
      pickedGlobalRunner: false,
      runnerId: currentProjectOption.value,
    };
  }

  if (unknownOption) {
    return {
      options,
      selected: unknownOption,
      outcome: RunnerPickerOutcome.UnknownRunner,
      willRun: false,
      pickedGlobalRunner: false,
      runnerId: "",
    };
  }

  if (globalOption) {
    return {
      options,
      selected: globalOption,
      outcome: RunnerPickerOutcome.GlobalRunner,
      willRun: true,
      pickedGlobalRunner: false,
      runnerId: "",
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
    pickedGlobalRunner: false,
    runnerId: "",
  };
}

// The outcome a step's refusal reads as on the picker.
function getRefusedOutcome(refusal: RunnerChoiceRefusal): RunnerPickerOutcome {
  switch (refusal) {
    case RunnerChoiceRefusal.InvalidRunnerId:
    case RunnerChoiceRefusal.RunnerNotFound:
      return RunnerPickerOutcome.UnknownRunner;
    case RunnerChoiceRefusal.NeedsOwnRunner:
      return RunnerPickerOutcome.NeedsOwnRunner;
    case RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff:
      return RunnerPickerOutcome.GlobalRunnersOff;
    case RunnerChoiceRefusal.NoGlobalRunner:
      return RunnerPickerOutcome.NoGlobalRunner;
    default: {
      const unhandled: never = refusal;
      return unhandled;
    }
  }
}

/*
 * A runbook step's picker: its choices, and what it runs on now, by the
 * server's default order (decideRunnerByDefaultOrder) over the facts the
 * page loaded - so what the picker says is what the server decides.
 */
function buildStepModel(facts: RunnerPickerFacts): RunnerPickerModel {
  const currentRunnerId: string = getChosenRunnerId(facts.currentRunnerId);
  const picksGlobalRunner: boolean = isGlobalRunnerChoice(currentRunnerId);
  const defaultRunner: RunnerPickerRunner | undefined =
    getProjectDefaultRunner(facts);
  const hasGlobalRunner: boolean = facts.globalRunners.length > 0;
  const mayRunOnGlobal: boolean = canGlobalRunnersRunWork(facts);
  const isGlobalOffered: boolean = offersGlobalRunner(facts);
  const globalLiveStatus: RunnerLiveStatus = getGlobalRunnersLiveStatus(
    facts.globalRunners,
  );

  // What the step's stored id is, as the server would look it up.
  const currentProjectRunner: RunnerPickerRunner | undefined =
    currentRunnerId && !picksGlobalRunner
      ? facts.projectRunners.find((runner: RunnerPickerRunner): boolean => {
          return sameId(runner.id, currentRunnerId);
        })
      : undefined;

  const namesGlobalRunner: boolean =
    Boolean(currentRunnerId) &&
    !picksGlobalRunner &&
    !currentProjectRunner &&
    facts.globalRunners.some((runner: { id?: string | undefined }): boolean => {
      return sameId(runner.id, currentRunnerId);
    });

  const chosenRunnerKind: ChosenRunnerKind | undefined =
    !currentRunnerId || picksGlobalRunner
      ? undefined
      : currentProjectRunner
        ? ChosenRunnerKind.ProjectRunner
        : namesGlobalRunner
          ? ChosenRunnerKind.GlobalRunner
          : ChosenRunnerKind.NotFound;

  const result: RunnerDefaultOrderResult = decideRunnerByDefaultOrder({
    chosenRunnerId: currentRunnerId,
    ...(chosenRunnerKind ? { chosenRunnerKind } : {}),
    projectDefaultRunnerId: defaultRunner?.id || "",
    canGlobalRunnersRunWork: mayRunOnGlobal,
    projectUsesGlobalRunners: facts.projectUsesGlobalRunners,
    hasGlobalRunner,
  });

  /*
   * The first choice: what a step that picks no Runner runs on - the
   * project's default Runner, or the Global Runner where it runs the step.
   */
  const defaultOption: RunnerPickerOption | undefined = defaultRunner
    ? {
        value: PROJECT_DEFAULT_CHOICE_VALUE,
        kind: RunnerPickerOptionKind.ProjectDefault,
        name: defaultRunner.name,
        liveStatus: defaultRunner.liveStatus,
        runnerId: defaultRunner.id,
      }
    : isGlobalOffered
      ? {
          value: PROJECT_DEFAULT_CHOICE_VALUE,
          kind: RunnerPickerOptionKind.Global,
          name: GLOBAL_RUNNER_CHOICE_LABEL,
          liveStatus: globalLiveStatus,
        }
      : undefined;

  /*
   * The Global Runner, when it is not the first choice: a choice of its own
   * beside the project's default Runner, or drawn as not open to the step,
   * with why.
   */
  const isGlobalTheFirstChoice: boolean =
    defaultOption?.kind === RunnerPickerOptionKind.Global;

  const globalOption: RunnerPickerOption | undefined =
    !hasGlobalRunner || isGlobalTheFirstChoice
      ? undefined
      : isGlobalOffered
        ? {
            value: GLOBAL_RUNNER_PICK_VALUE,
            kind: RunnerPickerOptionKind.Global,
            name: GLOBAL_RUNNER_CHOICE_LABEL,
            liveStatus: globalLiveStatus,
          }
        : {
            value: GLOBAL_RUNNER_PICK_VALUE,
            kind: RunnerPickerOptionKind.GlobalUnavailable,
            name: GLOBAL_RUNNER_CHOICE_LABEL,
            unavailableReason: !mayRunOnGlobal
              ? GlobalRunnerUnavailableReason.StepType
              : GlobalRunnerUnavailableReason.ProjectTurnedOff,
          };

  const unknownOption: RunnerPickerOption | undefined =
    currentRunnerId &&
    !picksGlobalRunner &&
    !currentProjectRunner &&
    !namesGlobalRunner
      ? {
          value: currentRunnerId,
          kind: RunnerPickerOptionKind.Unknown,
          name: currentRunnerId,
        }
      : undefined;

  // The project's own Runners; the default is the first choice already.
  const projectOptions: Array<RunnerPickerOption> = facts.projectRunners
    .filter((runner: RunnerPickerRunner): boolean => {
      return runner !== defaultRunner;
    })
    .map(toProjectOption);

  /*
   * The Global Runner that can be picked sits right after the first choice;
   * the one drawn as not open to the step comes last, under every choice
   * that can be picked - the menu opens on its first choice, and a choice
   * that cannot be picked is never the one it opens on.
   */
  const isGlobalOptionOpen: boolean =
    globalOption?.kind === RunnerPickerOptionKind.Global;

  const options: Array<RunnerPickerOption> = [
    ...(defaultOption ? [defaultOption] : []),
    ...(globalOption && isGlobalOptionOpen ? [globalOption] : []),
    ...(unknownOption ? [unknownOption] : []),
    ...projectOptions,
    ...(globalOption && !isGlobalOptionOpen ? [globalOption] : []),
  ];

  // The option that stands for the Global Runner, whichever it is.
  const globalChoice: RunnerPickerOption | undefined = isGlobalTheFirstChoice
    ? defaultOption
    : globalOption;

  switch (result.source) {
    case RunnerSource.Picked: {
      /*
       * A pick of the project's default Runner reads as the first choice,
       * which is that Runner.
       */
      const selected: RunnerPickerOption | undefined =
        defaultOption && sameId(defaultOption.runnerId, result.runnerId)
          ? defaultOption
          : projectOptions.find((option: RunnerPickerOption): boolean => {
              return sameId(option.value, result.runnerId);
            });

      return {
        options,
        selected,
        outcome: RunnerPickerOutcome.ProjectRunner,
        willRun: true,
        pickedGlobalRunner: false,
        runnerId: currentProjectRunner?.id || result.runnerId,
      };
    }
    case RunnerSource.ProjectDefault:
      return {
        options,
        selected: defaultOption,
        outcome: RunnerPickerOutcome.ProjectDefaultRunner,
        willRun: true,
        pickedGlobalRunner: false,
        runnerId: defaultRunner?.id || result.runnerId,
      };
    case RunnerSource.Global:
      return {
        options,
        selected: globalChoice,
        outcome: RunnerPickerOutcome.GlobalRunner,
        willRun: true,
        pickedGlobalRunner: Boolean(currentRunnerId),
        runnerId: "",
      };
    case RunnerSource.None: {
      const outcome: RunnerPickerOutcome = getRefusedOutcome(result.refusal);

      /*
       * A pick that is gone shows as itself; the Global Runner picked where
       * it may not run shows as picked, drawn as not open; a step that
       * picked none shows nothing picked.
       */
      const selected: RunnerPickerOption | undefined =
        outcome === RunnerPickerOutcome.UnknownRunner
          ? unknownOption
          : result.pickedGlobalRunner
            ? globalChoice
            : undefined;

      return {
        options,
        selected,
        outcome,
        willRun: false,
        pickedGlobalRunner: result.pickedGlobalRunner,
        runnerId: "",
      };
    }
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}

export function buildRunnerPickerModel(
  facts: RunnerPickerFacts,
): RunnerPickerModel {
  if (facts.work === RunnerPickerWork.AutoRemediation) {
    return buildRuleModel(facts);
  }

  if (facts.work === RunnerPickerWork.CodeRepository) {
    return buildRepositoryModel(facts);
  }

  return buildStepModel(facts);
}

/*
 * The Runner a new AI rule starts on: the project's default Runner, when it
 * has one the rule may pick. Its form picks it, so the rule saves it as its
 * own pick (AutoRemediationRule.runnerId) - changing the project's default
 * later does not move the rule. Without one, a new rule starts on none: the
 * Global Runner, where there is one.
 */
export function getNewRuleRunnerId(
  projectRunners: Array<RunnerPickerRunner>,
): string | undefined {
  return getProjectDefaultRunner({
    work: RunnerPickerWork.AutoRemediation,
    projectRunners,
  })?.id;
}

/*
 * What a rule's folded More fields line says after "Runner": the Runner the
 * rule picks - the project's default a new rule starts on included - by
 * name, with how it is doing when it is not connected, so where its Bash
 * commands run is read without opening the fold, as a runbook step's is
 * ("More fields · Runbooks, Runner: prod-eu-runner, ..."). Undefined while
 * it picks none - the Global Runner, or "No Runner": the field's default,
 * on which no command runs - or while the Runners are not read yet. A pick
 * the reader was not shown is hidden: the line names it as one they do not
 * have access to.
 */
export interface RuleRunnerFoldedValue {
  isHidden: boolean;
  // The Runner's own name, drawn as named; empty for a hidden one.
  name: string;
  // Set only when it is not connected now.
  notConnectedStatus?: RunnerLiveStatus | undefined;
}

export function getRuleRunnerFoldedValue(data: {
  // The rule's pick, as the form holds it (getRuleRunnerId).
  runnerId: string;
  // The project's own Runners, or null while they are read.
  projectRunners: Array<RunnerPickerRunner> | null;
}): RuleRunnerFoldedValue | undefined {
  if (!data.runnerId || !data.projectRunners) {
    return undefined;
  }

  // A rule's picker reads its own Runners only: no step, no global Runner.
  const model: RunnerPickerModel = buildRunnerPickerModel({
    work: RunnerPickerWork.AutoRemediation,
    stepType: "",
    currentRunnerId: data.runnerId,
    projectRunners: data.projectRunners,
    globalRunners: [],
    projectUsesGlobalRunners: false,
  });

  if (model.outcome === RunnerPickerOutcome.UnknownRunner) {
    return { isHidden: true, name: "" };
  }

  if (!model.selected) {
    return undefined;
  }

  const liveStatus: RunnerLiveStatus | undefined = model.selected.liveStatus;

  return {
    isHidden: false,
    name: model.selected.name,
    ...(liveStatus && liveStatus !== RunnerLiveStatus.Connected
      ? { notConnectedStatus: liveStatus }
      : {}),
  };
}

/*
 * The line under an AI rule's picker, as the picker words it - or None,
 * where the box and the field's own line say it all:
 *
 *   - on the Global Runner (a rule that picked none, where there is one):
 *     that OneUptime AI runs no Bash commands there, and the way to have
 *     them run - pick one of the project's Runners, or add one where the
 *     project has none; a reader who may not read the Runners is told the
 *     first half only;
 *   - "No Runner" with no Runner of the project's own to pick: where one is
 *     added - never to a reader who may not read the Runners, for a project
 *     that may have some;
 *   - a pick the reader was not shown: that they may not see it.
 */
export enum RuleRunnerLine {
  None = "none",
  GlobalRunnerPickOwn = "global-runner-pick-own",
  GlobalRunnerAddOwn = "global-runner-add-own",
  GlobalRunner = "global-runner",
  AddRunner = "add-runner",
  HiddenRunner = "hidden-runner",
}

export function getRuleRunnerLine(data: {
  model: RunnerPickerModel;
  projectRunnerCount: number;
  // The project's Runners could not be read: the count says nothing.
  areProjectRunnersUnread?: boolean | undefined;
}): RuleRunnerLine {
  if (data.model.outcome === RunnerPickerOutcome.UnknownRunner) {
    return RuleRunnerLine.HiddenRunner;
  }

  if (data.model.outcome !== RunnerPickerOutcome.NoRunner) {
    return RuleRunnerLine.None;
  }

  const hasOwnRunners: boolean = data.projectRunnerCount > 0;

  if (data.model.selected?.kind === RunnerPickerOptionKind.Global) {
    if (data.areProjectRunnersUnread) {
      return RuleRunnerLine.GlobalRunner;
    }

    return hasOwnRunners
      ? RuleRunnerLine.GlobalRunnerPickOwn
      : RuleRunnerLine.GlobalRunnerAddOwn;
  }

  return hasOwnRunners || data.areProjectRunnersUnread
    ? RuleRunnerLine.None
    : RuleRunnerLine.AddRunner;
}

// Whether the picker has a choice that can be picked: else it says what to do.
export function hasPickableOption(model: RunnerPickerModel): boolean {
  return model.options.some((option: RunnerPickerOption): boolean => {
    return option.kind !== RunnerPickerOptionKind.GlobalUnavailable;
  });
}

/*
 * What the step runs on, for the line under a folded step's title
 * ("JavaScript on Global Runner", "Bash script on prod-eu-west-1") and its
 * folded More fields: the global choice - whose name is a translation key,
 * so `isGlobal` says to translate it - or the project Runner's own name,
 * and whether that is the project's default Runner. Undefined while the
 * step cannot run as it is: no Runner picked, or one that is gone.
 */
export interface RunnerSummary {
  name: string;
  isGlobal: boolean;
  // The step picked no Runner and runs on the project's default Runner.
  isProjectDefault?: boolean | undefined;
  // How it is doing (for the global choice, the best of them).
  liveStatus?: RunnerLiveStatus | undefined;
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
    isProjectDefault:
      model.outcome === RunnerPickerOutcome.ProjectDefaultRunner,
    liveStatus: model.selected.liveStatus,
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

/*
 * The project Runner the step is on - its pick, or the project's default -
 * when it is not connected now: the step would wait in the queue and fail
 * after its claim timeout unless it connects. Undefined otherwise.
 */
export function getWaitingProjectRunner(
  model: RunnerPickerModel,
): RunnerPickerOption | undefined {
  if (
    model.outcome !== RunnerPickerOutcome.ProjectRunner &&
    model.outcome !== RunnerPickerOutcome.ProjectDefaultRunner
  ) {
    return undefined;
  }

  if (
    !model.selected ||
    !model.selected.liveStatus ||
    model.selected.liveStatus === RunnerLiveStatus.Connected
  ) {
    return undefined;
  }

  return model.selected;
}
