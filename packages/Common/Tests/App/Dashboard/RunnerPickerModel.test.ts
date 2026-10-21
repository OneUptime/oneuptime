import { describe, expect, test } from "@jest/globals";
import {
  GLOBAL_RUNNER_CHOICE_LABEL,
  GLOBAL_RUNNER_CHOICE_VALUE,
  GLOBAL_RUNNER_PICK_VALUE,
  GlobalRunnerUnavailableReason,
  PROJECT_DEFAULT_CHOICE_VALUE,
  RunnerPickerFacts,
  RunnerPickerModel,
  RunnerPickerOption,
  RunnerPickerOptionKind,
  RunnerPickerOutcome,
  RunnerPickerRunner,
  RunnerPickerWork,
  REMEDIATION_NO_RUNNER_CHOICE_LABEL,
  RunnerSummary,
  buildRunnerPickerModel,
  canGlobalRunnersRunWork,
  getGlobalRunnersLiveStatus,
  getProjectDefaultRunner,
  getRunnerSummary,
  getWaitingProjectRunner,
  hasPickableOption,
  isGlobalRunnerChoiceWaiting,
  offersGlobalRunner,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  ChosenRunnerKind,
  GLOBAL_RUNNER_CHOICE_ID,
  RunnerChoiceDecision,
  RunnerChoiceRefusal,
  decideRunnerChoice,
} from "../../../Types/Runner/RunnerChoice";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";

/*
 * WHAT THE RUNNER PICKER SHOWS FOR A STEP.
 *
 * The step editor's Runner picker follows the server's one rule, in its
 * default order (Common/Types/Runner/RunnerChoice): a step that picked a
 * Runner of its project's own runs on it; a step that picked none runs on
 * the project's default Runner when the project has one, and otherwise on
 * the global Runners - the ones OneUptime runs for every project - when
 * they run its type, the project uses them and there is one. So the
 * picker's first choice is that default, and it is what a step that picked
 * none shows.
 *
 * The Global Runner is in the list wherever the server has one: a choice of
 * its own beside a project default, and drawn - last, never picked, with
 * why - where it cannot run the step. That answers the maintainer's "Why
 * can't I select a global runner here when I have one?" on a Bash step:
 * global Runners run JavaScript steps only.
 *
 * The last blocks hold the picker to the server: for every step type,
 * project default, project switch, global Runner count and pick, what the
 * picker says the step runs on is what the server decides when it runs.
 */

const BASTION: RunnerPickerRunner = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "prod-bastion",
  liveStatus: RunnerLiveStatus.Connected,
};

const STAGING: RunnerPickerRunner = {
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "staging-runner",
  liveStatus: RunnerLiveStatus.Disconnected,
};

// The project's default Runner, as the loader marks it.
const PROD_DEFAULT: RunnerPickerRunner = {
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "prod-default",
  liveStatus: RunnerLiveStatus.Connected,
  isProjectDefault: true,
};

const GLOBAL_EU_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";

// A Runner of another project, or a deleted one.
const GONE_ID: string = "cccccccc-0000-4000-8000-000000000001";

function facts(overrides: Partial<RunnerPickerFacts> = {}): RunnerPickerFacts {
  return {
    stepType: RunbookStepType.JavaScript,
    currentRunnerId: "",
    projectRunners: [BASTION, STAGING],
    globalRunners: [
      { id: GLOBAL_EU_ID, liveStatus: RunnerLiveStatus.Connected },
    ],
    projectUsesGlobalRunners: true,
    ...overrides,
  };
}

// The same, in a project whose default Runner is PROD_DEFAULT.
function withDefault(
  overrides: Partial<RunnerPickerFacts> = {},
): RunnerPickerFacts {
  return facts({
    projectRunners: [BASTION, PROD_DEFAULT, STAGING],
    ...overrides,
  });
}

function values(model: RunnerPickerModel): Array<string> {
  return model.options.map((option: RunnerPickerOption): string => {
    return option.value;
  });
}

function kinds(model: RunnerPickerModel): Array<RunnerPickerOptionKind> {
  return model.options.map(
    (option: RunnerPickerOption): RunnerPickerOptionKind => {
      return option.kind;
    },
  );
}

const SHELL_STEP_TYPES: Array<string> = [
  RunbookStepType.Bash,
  RunbookStepType.SSH,
  RunbookStepType.Kubernetes,
];

const STEP_TYPES_WITH_A_RUNNER: Array<string> = [
  RunbookStepType.JavaScript,
  ...SHELL_STEP_TYPES,
];

describe("a JavaScript step that picked no Runner, in a project with no default Runner", () => {
  test("shows the global choice, first and picked, with the project's own Runners after it", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(facts());

    expect(values(model)).toEqual([
      GLOBAL_RUNNER_CHOICE_VALUE,
      BASTION.id,
      STAGING.id,
    ]);
    expect(model.options[0]).toEqual({
      value: "",
      kind: RunnerPickerOptionKind.Global,
      name: GLOBAL_RUNNER_CHOICE_LABEL,
      liveStatus: RunnerLiveStatus.Connected,
    });
    expect(model.selected).toBe(model.options[0]);
    expect(model.outcome).toBe(RunnerPickerOutcome.GlobalRunner);
    expect(model.willRun).toBe(true);
    expect(model.pickedGlobalRunner).toBe(false);
    expect(model.runnerId).toBe("");
    expect(GLOBAL_RUNNER_CHOICE_LABEL).toBe("Global Runner");
  });

  test("on a project with no Runner of its own, the global choice is the only one, and picked", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ projectRunners: [] }),
    );

    expect(values(model)).toEqual([GLOBAL_RUNNER_CHOICE_VALUE]);
    expect(model.selected?.kind).toBe(RunnerPickerOptionKind.Global);
    expect(model.willRun).toBe(true);
  });

  test("a value of only spaces is no pick", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ currentRunnerId: "   " }),
    );

    expect(model.outcome).toBe(RunnerPickerOutcome.GlobalRunner);
  });

  test("on a project that turned global Runners off, the Global Runner is drawn as not open, last, and nothing is picked", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ projectUsesGlobalRunners: false }),
    );

    expect(values(model)).toEqual([
      BASTION.id,
      STAGING.id,
      GLOBAL_RUNNER_PICK_VALUE,
    ]);
    expect(model.options[2]).toEqual({
      value: GLOBAL_RUNNER_PICK_VALUE,
      kind: RunnerPickerOptionKind.GlobalUnavailable,
      name: GLOBAL_RUNNER_CHOICE_LABEL,
      unavailableReason: GlobalRunnerUnavailableReason.ProjectTurnedOff,
    });
    expect(model.selected).toBeUndefined();
    expect(model.outcome).toBe(RunnerPickerOutcome.GlobalRunnersOff);
    expect(model.willRun).toBe(false);
  });

  test("on a server with no global Runner, there is no global choice at all, and nothing picked", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ globalRunners: [] }),
    );

    expect(values(model)).toEqual([BASTION.id, STAGING.id]);
    expect(model.selected).toBeUndefined();
    expect(model.outcome).toBe(RunnerPickerOutcome.NoGlobalRunner);
    expect(model.willRun).toBe(false);
  });

  test("with nothing at all to pick, there are no options", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ globalRunners: [], projectRunners: [] }),
    );

    expect(model.options).toEqual([]);
    expect(model.outcome).toBe(RunnerPickerOutcome.NoGlobalRunner);
    expect(hasPickableOption(model)).toBe(false);
  });
});

describe("a step that picked a Runner", () => {
  test("keeps one of the project's own, with the global choice still offered first", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ currentRunnerId: STAGING.id }),
    );

    expect(values(model)).toEqual([
      GLOBAL_RUNNER_CHOICE_VALUE,
      BASTION.id,
      STAGING.id,
    ]);
    expect(model.selected).toEqual({
      value: STAGING.id,
      kind: RunnerPickerOptionKind.Project,
      name: "staging-runner",
      liveStatus: RunnerLiveStatus.Disconnected,
      runnerId: STAGING.id,
    });
    expect(model.outcome).toBe(RunnerPickerOutcome.ProjectRunner);
    expect(model.willRun).toBe(true);
    expect(model.runnerId).toBe(STAGING.id);
  });

  test("finds its Runner whatever the case of the stored ID", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ currentRunnerId: ` ${BASTION.id.toUpperCase()} ` }),
    );

    expect(model.selected?.value).toBe(BASTION.id);
    expect(model.outcome).toBe(RunnerPickerOutcome.ProjectRunner);
    expect(model.runnerId).toBe(BASTION.id);
  });

  test("a Runner that is not the project's any more is shown as unknown, after the global choice, and will fail", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ currentRunnerId: GONE_ID }),
    );

    expect(values(model)).toEqual([
      GLOBAL_RUNNER_CHOICE_VALUE,
      GONE_ID,
      BASTION.id,
      STAGING.id,
    ]);
    expect(model.selected).toEqual({
      value: GONE_ID,
      kind: RunnerPickerOptionKind.Unknown,
      name: GONE_ID,
    });
    expect(model.outcome).toBe(RunnerPickerOutcome.UnknownRunner);
    expect(model.willRun).toBe(false);
  });

  test("a step that names something that is not a Runner id shows it as unknown too", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ currentRunnerId: "prod-runner" }),
    );

    expect(model.selected?.kind).toBe(RunnerPickerOptionKind.Unknown);
    expect(model.outcome).toBe(RunnerPickerOutcome.UnknownRunner);
  });

  test("a step that names one global Runner is on the global Runners", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ currentRunnerId: GLOBAL_EU_ID }),
    );

    expect(values(model)).toEqual([
      GLOBAL_RUNNER_CHOICE_VALUE,
      BASTION.id,
      STAGING.id,
    ]);
    expect(model.selected?.kind).toBe(RunnerPickerOptionKind.Global);
    expect(model.outcome).toBe(RunnerPickerOutcome.GlobalRunner);
    expect(model.pickedGlobalRunner).toBe(true);
  });

  test("a step that picked the Global Runner itself, in a project with no default, shows the global choice picked", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ currentRunnerId: GLOBAL_RUNNER_CHOICE_ID }),
    );

    expect(model.selected).toBe(model.options[0]);
    expect(model.selected?.kind).toBe(RunnerPickerOptionKind.Global);
    expect(model.outcome).toBe(RunnerPickerOutcome.GlobalRunner);
  });
});

/*
 * The maintainer, on a Bash step's picker that listed one Runner and no
 * Global Runner: "Why can't I select a global runner here when I have one?"
 * Global Runners run JavaScript steps only - a shell cannot be kept apart
 * from other projects' steps on a host every project shares - so the
 * picker shows it, last and never picked, saying so.
 */
describe("Bash, SSH and kubectl steps", () => {
  for (const stepType of SHELL_STEP_TYPES) {
    test(`a ${stepType} step is shown the Global Runner as not open to it - last, with why - and needs one of the project's own`, () => {
      const model: RunnerPickerModel = buildRunnerPickerModel(
        facts({ stepType }),
      );

      expect(values(model)).toEqual([
        BASTION.id,
        STAGING.id,
        GLOBAL_RUNNER_PICK_VALUE,
      ]);
      expect(model.options[2]).toEqual({
        value: GLOBAL_RUNNER_PICK_VALUE,
        kind: RunnerPickerOptionKind.GlobalUnavailable,
        name: GLOBAL_RUNNER_CHOICE_LABEL,
        unavailableReason: GlobalRunnerUnavailableReason.StepType,
      });
      expect(model.selected).toBeUndefined();
      expect(model.outcome).toBe(RunnerPickerOutcome.NeedsOwnRunner);
      expect(model.willRun).toBe(false);
      expect(model.pickedGlobalRunner).toBe(false);
      expect(
        offersGlobalRunner({
          stepType,
          globalRunners: [{ liveStatus: RunnerLiveStatus.Connected }],
          projectUsesGlobalRunners: true,
        }),
      ).toBe(false);
    });

    test(`a ${stepType} step keeps the Runner it picked`, () => {
      const model: RunnerPickerModel = buildRunnerPickerModel(
        facts({ stepType, currentRunnerId: BASTION.id }),
      );

      expect(model.selected?.value).toBe(BASTION.id);
      expect(model.outcome).toBe(RunnerPickerOutcome.ProjectRunner);
      expect(model.willRun).toBe(true);
    });

    test(`a ${stepType} step that picked the Global Runner shows it picked, not open, and cannot run`, () => {
      const model: RunnerPickerModel = buildRunnerPickerModel(
        facts({ stepType, currentRunnerId: GLOBAL_RUNNER_CHOICE_ID }),
      );

      expect(model.selected?.kind).toBe(
        RunnerPickerOptionKind.GlobalUnavailable,
      );
      expect(model.outcome).toBe(RunnerPickerOutcome.NeedsOwnRunner);
      expect(model.pickedGlobalRunner).toBe(true);
      expect(model.willRun).toBe(false);
    });
  }

  test("with no Runner of the project's own, nothing can be picked: the picker says what to do instead", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ stepType: RunbookStepType.Bash, projectRunners: [] }),
    );

    expect(kinds(model)).toEqual([RunnerPickerOptionKind.GlobalUnavailable]);
    expect(hasPickableOption(model)).toBe(false);
  });

  test("on a server with no global Runner there is nothing to draw as not open", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ stepType: RunbookStepType.Bash, globalRunners: [] }),
    );

    expect(values(model)).toEqual([BASTION.id, STAGING.id]);
  });
});

describe("a project with a default Runner", () => {
  test("a JavaScript step that picked none is on it: first, by its own name, and picked", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(withDefault());

    expect(model.options[0]).toEqual({
      value: PROJECT_DEFAULT_CHOICE_VALUE,
      kind: RunnerPickerOptionKind.ProjectDefault,
      name: "prod-default",
      liveStatus: RunnerLiveStatus.Connected,
      runnerId: PROD_DEFAULT.id,
    });
    expect(model.selected).toBe(model.options[0]);
    expect(model.outcome).toBe(RunnerPickerOutcome.ProjectDefaultRunner);
    expect(model.willRun).toBe(true);
    expect(model.runnerId).toBe(PROD_DEFAULT.id);
    expect(PROJECT_DEFAULT_CHOICE_VALUE).toBe("");
  });

  test("the Global Runner stays a choice of its own, right after the default, stored as 'global'", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(withDefault());

    expect(values(model)).toEqual([
      PROJECT_DEFAULT_CHOICE_VALUE,
      GLOBAL_RUNNER_PICK_VALUE,
      BASTION.id,
      STAGING.id,
    ]);
    expect(model.options[1]).toEqual({
      value: GLOBAL_RUNNER_CHOICE_ID,
      kind: RunnerPickerOptionKind.Global,
      name: GLOBAL_RUNNER_CHOICE_LABEL,
      liveStatus: RunnerLiveStatus.Connected,
    });
  });

  test("the default is listed once: as the first choice, never again among the Runners", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(withDefault());

    expect(
      model.options.filter((option: RunnerPickerOption): boolean => {
        return (
          option.runnerId === PROD_DEFAULT.id ||
          option.value === PROD_DEFAULT.id
        );
      }),
    ).toHaveLength(1);
  });

  test.each(SHELL_STEP_TYPES)(
    "a %s step that picked none runs on it - and the Global Runner is still drawn, last, as not open",
    (stepType: string) => {
      const model: RunnerPickerModel = buildRunnerPickerModel(
        withDefault({ stepType }),
      );

      expect(values(model)).toEqual([
        PROJECT_DEFAULT_CHOICE_VALUE,
        BASTION.id,
        STAGING.id,
        GLOBAL_RUNNER_PICK_VALUE,
      ]);
      expect(kinds(model)).toEqual([
        RunnerPickerOptionKind.ProjectDefault,
        RunnerPickerOptionKind.Project,
        RunnerPickerOptionKind.Project,
        RunnerPickerOptionKind.GlobalUnavailable,
      ]);
      expect(model.selected?.kind).toBe(RunnerPickerOptionKind.ProjectDefault);
      expect(model.outcome).toBe(RunnerPickerOutcome.ProjectDefaultRunner);
      expect(model.willRun).toBe(true);
    },
  );

  test("a JavaScript step that picked the Global Runner stays on it, the default notwithstanding", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      withDefault({ currentRunnerId: GLOBAL_RUNNER_CHOICE_ID }),
    );

    expect(model.selected).toBe(model.options[1]);
    expect(model.selected?.value).toBe(GLOBAL_RUNNER_CHOICE_ID);
    expect(model.outcome).toBe(RunnerPickerOutcome.GlobalRunner);
    expect(model.pickedGlobalRunner).toBe(true);
    expect(model.runnerId).toBe("");
  });

  test("a step that picked another of the project's Runners keeps it", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      withDefault({
        stepType: RunbookStepType.Bash,
        currentRunnerId: BASTION.id,
      }),
    );

    expect(model.selected?.value).toBe(BASTION.id);
    expect(model.outcome).toBe(RunnerPickerOutcome.ProjectRunner);
    expect(model.runnerId).toBe(BASTION.id);
  });

  test("a step that picked the default by its id shows it as the first choice, its own pick", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      withDefault({ currentRunnerId: PROD_DEFAULT.id.toUpperCase() }),
    );

    expect(model.selected).toBe(model.options[0]);
    expect(model.outcome).toBe(RunnerPickerOutcome.ProjectRunner);
    expect(model.runnerId).toBe(PROD_DEFAULT.id);
  });

  test("in a project that turned global Runners off, the Global Runner is drawn last as not open, for that reason", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      withDefault({ projectUsesGlobalRunners: false }),
    );

    expect(model.options[model.options.length - 1]).toEqual({
      value: GLOBAL_RUNNER_PICK_VALUE,
      kind: RunnerPickerOptionKind.GlobalUnavailable,
      name: GLOBAL_RUNNER_CHOICE_LABEL,
      unavailableReason: GlobalRunnerUnavailableReason.ProjectTurnedOff,
    });
    expect(model.outcome).toBe(RunnerPickerOutcome.ProjectDefaultRunner);
  });

  test("on a server with no global Runner, the default is the first choice and there is no global one", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      withDefault({ globalRunners: [] }),
    );

    expect(values(model)).toEqual([
      PROJECT_DEFAULT_CHOICE_VALUE,
      BASTION.id,
      STAGING.id,
    ]);
    expect(model.outcome).toBe(RunnerPickerOutcome.ProjectDefaultRunner);
  });

  test("a default that is not connected is still the default - shown so, and said to be waiting", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({
        projectRunners: [
          { ...PROD_DEFAULT, liveStatus: RunnerLiveStatus.NeverConnected },
        ],
      }),
    );

    expect(model.selected?.liveStatus).toBe(RunnerLiveStatus.NeverConnected);
    expect(model.outcome).toBe(RunnerPickerOutcome.ProjectDefaultRunner);
    expect(getWaitingProjectRunner(model)?.name).toBe("prod-default");
  });

  /*
   * The project default reaches runbook steps only: a code repository picks
   * its Runner by its own rule, and an auto remediation rule's first choice
   * is the AI agent - neither is told about the default.
   */
  test("a code repository's picker and a rule's picker do not follow it", () => {
    const repository: RunnerPickerModel = buildRunnerPickerModel(
      withDefault({ work: RunnerPickerWork.CodeRepository, stepType: "" }),
    );

    expect(repository.options[0]!.kind).toBe(RunnerPickerOptionKind.Global);
    expect(repository.outcome).toBe(RunnerPickerOutcome.GlobalRunner);
    expect(values(repository)).toContain(PROD_DEFAULT.id);

    const rule: RunnerPickerModel = buildRunnerPickerModel(
      withDefault({ work: RunnerPickerWork.AutoRemediation, stepType: "" }),
    );

    expect(rule.options[0]!.kind).toBe(RunnerPickerOptionKind.NoRunner);
    expect(rule.outcome).toBe(RunnerPickerOutcome.NoRunner);
    expect(
      getProjectDefaultRunner({
        work: RunnerPickerWork.AutoRemediation,
        projectRunners: [PROD_DEFAULT],
      }),
    ).toBeUndefined();
    expect(
      getProjectDefaultRunner({ projectRunners: [PROD_DEFAULT] })?.id,
    ).toBe(PROD_DEFAULT.id);
  });
});

describe("the Global Runner that cannot be picked", () => {
  test("is never the choice the menu opens on: every choice that can be picked comes before it", () => {
    for (const overrides of [
      { stepType: RunbookStepType.Bash },
      { projectUsesGlobalRunners: false },
      { stepType: RunbookStepType.SSH, currentRunnerId: GONE_ID },
    ] as Array<Partial<RunnerPickerFacts>>) {
      for (const build of [facts, withDefault]) {
        const model: RunnerPickerModel = buildRunnerPickerModel(
          build(overrides),
        );
        const at: number = kinds(model).indexOf(
          RunnerPickerOptionKind.GlobalUnavailable,
        );

        expect({ overrides, at }).toEqual({
          overrides,
          at: model.options.length - 1,
        });
        expect(hasPickableOption(model)).toBe(true);
      }
    }
  });
});

describe("how the global choice is doing", () => {
  test("is the best of the global Runners: one connected is enough", () => {
    expect(
      getGlobalRunnersLiveStatus([
        { liveStatus: RunnerLiveStatus.NeverConnected },
        { liveStatus: RunnerLiveStatus.Disconnected },
        { liveStatus: RunnerLiveStatus.Connected },
      ]),
    ).toBe(RunnerLiveStatus.Connected);
    expect(
      getGlobalRunnersLiveStatus([
        { liveStatus: RunnerLiveStatus.NeverConnected },
        { liveStatus: RunnerLiveStatus.Disconnected },
      ]),
    ).toBe(RunnerLiveStatus.Disconnected);
    expect(
      getGlobalRunnersLiveStatus([
        { liveStatus: RunnerLiveStatus.NeverConnected },
      ]),
    ).toBe(RunnerLiveStatus.NeverConnected);
    expect(getGlobalRunnersLiveStatus([])).toBe(
      RunnerLiveStatus.NeverConnected,
    );
  });
});

/*
 * The line under a folded step's title, and the step's folded More fields,
 * say what the step runs on - "on Global Runner", "on prod-bastion" - or
 * that it still needs a Runner.
 */
describe("what a folded step says it runs on", () => {
  test("a step on the global choice names it by its label, to be translated", () => {
    const summary: RunnerSummary | undefined = getRunnerSummary(
      buildRunnerPickerModel(facts()),
    );

    expect(summary).toEqual({
      name: GLOBAL_RUNNER_CHOICE_LABEL,
      isGlobal: true,
      isProjectDefault: false,
      liveStatus: RunnerLiveStatus.Connected,
    });
  });

  test("a step on one of the project's own names it, as it is called, with how it is doing", () => {
    for (const stepType of STEP_TYPES_WITH_A_RUNNER) {
      expect(
        getRunnerSummary(
          buildRunnerPickerModel(
            facts({ stepType, currentRunnerId: STAGING.id }),
          ),
        ),
      ).toEqual({
        name: "staging-runner",
        isGlobal: false,
        isProjectDefault: false,
        liveStatus: RunnerLiveStatus.Disconnected,
      });
    }
  });

  test("a step on the project's default names the default, and says it is the default", () => {
    for (const stepType of STEP_TYPES_WITH_A_RUNNER) {
      expect(
        getRunnerSummary(buildRunnerPickerModel(withDefault({ stepType }))),
      ).toEqual({
        name: "prod-default",
        isGlobal: false,
        isProjectDefault: true,
        liveStatus: RunnerLiveStatus.Connected,
      });
    }
  });

  test("a step that cannot run as it is names nothing, so the line says it needs a Runner", () => {
    const cannotRun: Array<Partial<RunnerPickerFacts>> = [
      // Bash picks no Runner: global Runners never run it.
      { stepType: RunbookStepType.Bash },
      // Bash picks the Global Runner itself.
      {
        stepType: RunbookStepType.Bash,
        currentRunnerId: GLOBAL_RUNNER_CHOICE_ID,
      },
      // A Runner that is gone.
      { currentRunnerId: GONE_ID },
      // The project turned global Runners off.
      { projectUsesGlobalRunners: false },
      // The server has none.
      { globalRunners: [] },
    ];

    for (const overrides of cannotRun) {
      const model: RunnerPickerModel = buildRunnerPickerModel(facts(overrides));

      expect({ overrides, willRun: model.willRun }).toEqual({
        overrides,
        willRun: false,
      });
      expect(getRunnerSummary(model)).toBeUndefined();
    }
  });
});

describe("a step on the global choice while no global Runner is connected", () => {
  test("is waiting: it would sit in the queue and fail after its claim timeout", () => {
    for (const liveStatus of [
      RunnerLiveStatus.Disconnected,
      RunnerLiveStatus.NeverConnected,
    ]) {
      expect(
        isGlobalRunnerChoiceWaiting(
          buildRunnerPickerModel(
            facts({ globalRunners: [{ id: GLOBAL_EU_ID, liveStatus }] }),
          ),
        ),
      ).toBe(true);
    }
  });

  test("is not, with one global Runner connected", () => {
    expect(isGlobalRunnerChoiceWaiting(buildRunnerPickerModel(facts()))).toBe(
      false,
    );
  });

  test("negative control: a step on one of the project's own, or one that cannot run, never is", () => {
    const disconnected: Partial<RunnerPickerFacts> = {
      globalRunners: [
        { id: GLOBAL_EU_ID, liveStatus: RunnerLiveStatus.Disconnected },
      ],
    };

    expect(
      isGlobalRunnerChoiceWaiting(
        buildRunnerPickerModel(
          facts({ ...disconnected, currentRunnerId: STAGING.id }),
        ),
      ),
    ).toBe(false);
    expect(
      isGlobalRunnerChoiceWaiting(
        buildRunnerPickerModel(
          facts({ ...disconnected, stepType: RunbookStepType.Bash }),
        ),
      ),
    ).toBe(false);
  });
});

describe("a step on one of the project's own Runners that is not connected", () => {
  test("its pick, Disconnected or Never connected, is waiting", () => {
    expect(
      getWaitingProjectRunner(
        buildRunnerPickerModel(facts({ currentRunnerId: STAGING.id })),
      )?.name,
    ).toBe("staging-runner");

    expect(
      getWaitingProjectRunner(
        buildRunnerPickerModel(
          facts({
            stepType: RunbookStepType.Bash,
            projectRunners: [
              {
                id: BASTION.id,
                name: "custom",
                liveStatus: RunnerLiveStatus.NeverConnected,
              },
            ],
            currentRunnerId: BASTION.id,
          }),
        ),
      )?.name,
    ).toBe("custom");
  });

  test("negative control: a connected Runner, the global choice, and a step that cannot run never are", () => {
    for (const model of [
      buildRunnerPickerModel(facts({ currentRunnerId: BASTION.id })),
      buildRunnerPickerModel(withDefault()),
      buildRunnerPickerModel(
        facts({
          globalRunners: [
            { id: GLOBAL_EU_ID, liveStatus: RunnerLiveStatus.Disconnected },
          ],
        }),
      ),
      buildRunnerPickerModel(facts({ stepType: RunbookStepType.Bash })),
    ]) {
      expect(getWaitingProjectRunner(model)).toBeUndefined();
    }
  });
});

/*
 * The picker and the server answer the same question the same way: what
 * the editor shows a step runs on is what it runs on - for every step type,
 * pick, project default, project switch and global Runner count.
 */
describe("the picker agrees with the server", () => {
  const OUTCOME_FOR_REFUSAL: Record<string, RunnerPickerOutcome> = {
    [RunnerChoiceRefusal.NeedsOwnRunner]: RunnerPickerOutcome.NeedsOwnRunner,
    [RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff]:
      RunnerPickerOutcome.GlobalRunnersOff,
    [RunnerChoiceRefusal.NoGlobalRunner]: RunnerPickerOutcome.NoGlobalRunner,
    [RunnerChoiceRefusal.RunnerNotFound]: RunnerPickerOutcome.UnknownRunner,
    [RunnerChoiceRefusal.InvalidRunnerId]: RunnerPickerOutcome.UnknownRunner,
  };

  function expectedOutcome(
    decision: RunnerChoiceDecision,
  ): RunnerPickerOutcome {
    if (decision.kind === "global") {
      return RunnerPickerOutcome.GlobalRunner;
    }

    if (decision.kind === "custom") {
      return decision.isProjectDefault
        ? RunnerPickerOutcome.ProjectDefaultRunner
        : RunnerPickerOutcome.ProjectRunner;
    }

    return OUTCOME_FOR_REFUSAL[decision.refusal]!;
  }

  const picks: Array<{ label: string; id: string }> = [
    { label: "no Runner", id: "" },
    { label: "the Global Runner", id: GLOBAL_RUNNER_CHOICE_ID },
    { label: "one of the project's Runners", id: BASTION.id },
    { label: "the project's default Runner", id: PROD_DEFAULT.id },
    { label: "a global Runner", id: GLOBAL_EU_ID },
    { label: "a Runner that is gone", id: GONE_ID },
    { label: "a name", id: "prod-runner" },
  ];

  for (const stepType of STEP_TYPES_WITH_A_RUNNER) {
    for (const hasDefault of [false, true]) {
      for (const projectUsesGlobalRunners of [true, false]) {
        for (const globalRunnerCount of [0, 1]) {
          for (const pick of picks) {
            test(`${stepType}, ${pick.label}, ${hasDefault ? "a" : "no"} project default, project ${projectUsesGlobalRunners ? "uses" : "does not use"} global Runners, ${globalRunnerCount} global Runner(s)`, () => {
              const globalRunners: Array<{
                id: string;
                liveStatus: RunnerLiveStatus;
              }> =
                globalRunnerCount > 0
                  ? [
                      {
                        id: GLOBAL_EU_ID,
                        liveStatus: RunnerLiveStatus.Connected,
                      },
                    ]
                  : [];

              // The project's own Runners; PROD_DEFAULT is the default only in a project that has one.
              const projectRunners: Array<RunnerPickerRunner> = [
                BASTION,
                { ...PROD_DEFAULT, isProjectDefault: hasDefault },
              ];

              const chosenRunnerKind: ChosenRunnerKind | undefined =
                !pick.id || pick.id === GLOBAL_RUNNER_CHOICE_ID
                  ? undefined
                  : pick.id === BASTION.id || pick.id === PROD_DEFAULT.id
                    ? ChosenRunnerKind.ProjectRunner
                    : pick.id === GLOBAL_EU_ID && globalRunnerCount > 0
                      ? ChosenRunnerKind.GlobalRunner
                      : ChosenRunnerKind.NotFound;

              const decision: RunnerChoiceDecision = decideRunnerChoice({
                stepType,
                chosenRunnerId: pick.id,
                chosenRunnerKind,
                projectDefaultRunnerId: hasDefault ? PROD_DEFAULT.id : "",
                projectUsesGlobalRunners,
                hasGlobalRunner: globalRunnerCount > 0,
              });

              const model: RunnerPickerModel = buildRunnerPickerModel({
                stepType,
                currentRunnerId: pick.id,
                projectRunners,
                globalRunners,
                projectUsesGlobalRunners,
              });

              expect(model.outcome).toBe(expectedOutcome(decision));
              expect(model.willRun).toBe(decision.kind !== "refused");

              // The Runner the step runs on, where it is the project's own.
              expect(model.runnerId).toBe(
                decision.kind === "custom" ? decision.runnerId : "",
              );

              // A step that can run shows what it runs on.
              if (decision.kind !== "refused") {
                expect(model.selected).toBeDefined();
              }

              // Nothing that cannot be picked is ever offered to be picked.
              for (const option of model.options) {
                if (option.kind === RunnerPickerOptionKind.Global) {
                  expect(
                    offersGlobalRunner({
                      stepType,
                      globalRunners,
                      projectUsesGlobalRunners,
                    }),
                  ).toBe(true);
                }
              }
            });
          }
        }
      }
    }
  }
});

/*
 * An auto remediation rule's Runner (AutoRemediationRule.runnerId): the
 * Runner OneUptime AI runs the rule's commands of its own on. A global
 * Runner never runs them, so the first choice is no Runner of the
 * project's own - the AI agent on the affected cluster or host - whatever
 * the server's global Runners and the project's switch are.
 */
describe("an auto remediation rule's Runner", () => {
  function ruleFacts(
    overrides: Partial<RunnerPickerFacts> = {},
  ): RunnerPickerFacts {
    return facts({
      work: RunnerPickerWork.AutoRemediation,
      stepType: "",
      ...overrides,
    });
  }

  test("global Runners never run it", () => {
    expect(
      canGlobalRunnersRunWork({
        work: RunnerPickerWork.AutoRemediation,
        stepType: RunbookStepType.JavaScript,
      }),
    ).toBe(false);
    expect(offersGlobalRunner(ruleFacts())).toBe(false);
  });

  test("a rule that picked none is on the AI agent, first and picked, with the project's own Runners after it", () => {
    for (const overrides of [
      {},
      { projectUsesGlobalRunners: false },
      { globalRunners: [] },
      { projectRunners: [] },
    ] as Array<Partial<RunnerPickerFacts>>) {
      const model: RunnerPickerModel = buildRunnerPickerModel(
        ruleFacts(overrides),
      );

      expect(model.options[0]).toEqual({
        value: GLOBAL_RUNNER_CHOICE_VALUE,
        kind: RunnerPickerOptionKind.NoRunner,
        name: REMEDIATION_NO_RUNNER_CHOICE_LABEL,
      });
      expect(model.selected).toBe(model.options[0]);
      expect(model.outcome).toBe(RunnerPickerOutcome.NoRunner);
      expect(model.willRun).toBe(true);
      expect(
        model.options.some((option: RunnerPickerOption): boolean => {
          return (
            option.kind === RunnerPickerOptionKind.Global ||
            option.kind === RunnerPickerOptionKind.GlobalUnavailable
          );
        }),
      ).toBe(false);
      expect(values(model).slice(1)).toEqual(
        (overrides.projectRunners || [BASTION, STAGING]).map(
          (runner: RunnerPickerRunner): string => {
            return runner.id;
          },
        ),
      );
    }

    expect(REMEDIATION_NO_RUNNER_CHOICE_LABEL).toBe(
      "AI agent on the cluster or host",
    );
  });

  test("a rule that picked one of the project's Runners keeps it, with the AI agent still first", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      ruleFacts({ currentRunnerId: STAGING.id.toUpperCase() }),
    );

    expect(model.selected?.value).toBe(STAGING.id);
    expect(model.outcome).toBe(RunnerPickerOutcome.ProjectRunner);
    expect(model.options[0]!.kind).toBe(RunnerPickerOptionKind.NoRunner);
  });

  test("a Runner the reader is not shown stays the rule's pick, as unknown", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      ruleFacts({ currentRunnerId: GONE_ID }),
    );

    expect(model.selected?.value).toBe(GONE_ID);
    expect(model.outcome).toBe(RunnerPickerOutcome.UnknownRunner);
    expect(model.options[0]!.kind).toBe(RunnerPickerOptionKind.NoRunner);
  });

  test("negative control: a runbook step and a code repository still offer Global Runner", () => {
    expect(buildRunnerPickerModel(facts()).options[0]!.kind).toBe(
      RunnerPickerOptionKind.Global,
    );
    expect(
      buildRunnerPickerModel(
        facts({ work: RunnerPickerWork.CodeRepository, stepType: "" }),
      ).options[0]!.kind,
    ).toBe(RunnerPickerOptionKind.Global);
  });
});
