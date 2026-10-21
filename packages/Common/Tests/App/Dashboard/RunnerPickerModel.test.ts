import { describe, expect, test } from "@jest/globals";
import {
  GLOBAL_RUNNER_CHOICE_LABEL,
  GLOBAL_RUNNER_CHOICE_VALUE,
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
  getRunnerSummary,
  isGlobalRunnerChoiceWaiting,
  offersGlobalRunner,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  ChosenRunnerKind,
  RunnerChoiceDecision,
  RunnerChoiceRefusal,
  decideRunnerChoice,
} from "../../../Types/Runner/RunnerChoice";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";

/*
 * WHAT THE RUNNER PICKER SHOWS FOR A STEP.
 *
 * The step editor's Runner picker follows the server's one "global by
 * default" rule (Common/Types/Runner/RunnerChoice): a step that picked a
 * Runner of its project's own runs on it; a step that picked none runs on
 * the global Runners - the ones OneUptime runs for every project - when they
 * run its type, the project uses them and there is one. So the global choice
 * comes first and is what a step that picked none shows, and the picker
 * never shows an empty box while a global Runner can run the step.
 *
 * The last block holds the picker to the server: for every step type,
 * project switch, global Runner count and pick, what the picker says the
 * step runs on is what the server decides when it runs.
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

function values(model: RunnerPickerModel): Array<string> {
  return model.options.map((option: RunnerPickerOption): string => {
    return option.value;
  });
}

const STEP_TYPES_WITH_A_RUNNER: Array<string> = [
  RunbookStepType.JavaScript,
  RunbookStepType.Bash,
  RunbookStepType.SSH,
  RunbookStepType.Kubernetes,
];

describe("a JavaScript step that picked no Runner", () => {
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

  test("on a project that turned global Runners off, there is no global choice and nothing picked", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ projectUsesGlobalRunners: false }),
    );

    expect(values(model)).toEqual([BASTION.id, STAGING.id]);
    expect(model.selected).toBeUndefined();
    expect(model.outcome).toBe(RunnerPickerOutcome.GlobalRunnersOff);
    expect(model.willRun).toBe(false);
  });

  test("on a server with no global Runner, there is no global choice and nothing picked", () => {
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
    });
    expect(model.outcome).toBe(RunnerPickerOutcome.ProjectRunner);
    expect(model.willRun).toBe(true);
  });

  test("finds its Runner whatever the case of the stored ID", () => {
    const model: RunnerPickerModel = buildRunnerPickerModel(
      facts({ currentRunnerId: ` ${BASTION.id.toUpperCase()} ` }),
    );

    expect(model.selected?.value).toBe(BASTION.id);
    expect(model.outcome).toBe(RunnerPickerOutcome.ProjectRunner);
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
  });
});

describe("Bash, SSH and Kubernetes steps", () => {
  for (const stepType of [
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
  ]) {
    test(`a ${stepType} step is never offered the global Runners: it needs one of the project's own`, () => {
      const model: RunnerPickerModel = buildRunnerPickerModel(
        facts({ stepType }),
      );

      expect(values(model)).toEqual([BASTION.id, STAGING.id]);
      expect(model.selected).toBeUndefined();
      expect(model.outcome).toBe(RunnerPickerOutcome.NeedsOwnRunner);
      expect(model.willRun).toBe(false);
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
  }
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
 * The line under a folded step's title says what the step runs on - "on
 * Global Runner", "on prod-bastion" - or that it still needs a Runner.
 */
describe("what a folded step says it runs on", () => {
  test("a step on the global choice names it by its label, to be translated", () => {
    const summary: RunnerSummary | undefined = getRunnerSummary(
      buildRunnerPickerModel(facts()),
    );

    expect(summary).toEqual({
      name: GLOBAL_RUNNER_CHOICE_LABEL,
      isGlobal: true,
    });
  });

  test("a step on one of the project's own names it, as it is called", () => {
    for (const stepType of STEP_TYPES_WITH_A_RUNNER) {
      expect(
        getRunnerSummary(
          buildRunnerPickerModel(
            facts({ stepType, currentRunnerId: STAGING.id }),
          ),
        ),
      ).toEqual({ name: "staging-runner", isGlobal: false });
    }
  });

  test("a step that cannot run as it is names nothing, so the line says it needs a Runner", () => {
    const cannotRun: Array<Partial<RunnerPickerFacts>> = [
      // Bash picks no Runner: global Runners never run it.
      { stepType: RunbookStepType.Bash },
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

/*
 * The picker and the server answer the same question the same way: what
 * the editor shows a step runs on is what it runs on.
 */
describe("the picker agrees with the server", () => {
  const OUTCOME_FOR_REFUSAL: Record<string, RunnerPickerOutcome> = {
    [RunnerChoiceRefusal.NeedsOwnRunner]: RunnerPickerOutcome.NeedsOwnRunner,
    [RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff]:
      RunnerPickerOutcome.GlobalRunnersOff,
    [RunnerChoiceRefusal.NoGlobalRunner]: RunnerPickerOutcome.NoGlobalRunner,
    [RunnerChoiceRefusal.RunnerNotFound]: RunnerPickerOutcome.UnknownRunner,
  };

  function expectedOutcome(
    decision: RunnerChoiceDecision,
  ): RunnerPickerOutcome {
    if (decision.kind === "global") {
      return RunnerPickerOutcome.GlobalRunner;
    }

    if (decision.kind === "custom") {
      return RunnerPickerOutcome.ProjectRunner;
    }

    return OUTCOME_FOR_REFUSAL[decision.refusal]!;
  }

  const picks: Array<{ label: string; id: string }> = [
    { label: "no Runner", id: "" },
    { label: "one of the project's Runners", id: BASTION.id },
    { label: "a global Runner", id: GLOBAL_EU_ID },
    { label: "a Runner that is gone", id: GONE_ID },
  ];

  for (const stepType of STEP_TYPES_WITH_A_RUNNER) {
    for (const projectUsesGlobalRunners of [true, false]) {
      for (const globalRunnerCount of [0, 1]) {
        for (const pick of picks) {
          test(`${stepType}, ${pick.label}, project ${projectUsesGlobalRunners ? "uses" : "does not use"} global Runners, ${globalRunnerCount} global Runner(s)`, () => {
            const globalRunners: Array<{
              id: string;
              liveStatus: RunnerLiveStatus;
            }> =
              globalRunnerCount > 0
                ? [{ id: GLOBAL_EU_ID, liveStatus: RunnerLiveStatus.Connected }]
                : [];

            const chosenRunnerKind: ChosenRunnerKind | undefined = !pick.id
              ? undefined
              : pick.id === BASTION.id
                ? ChosenRunnerKind.ProjectRunner
                : pick.id === GLOBAL_EU_ID && globalRunnerCount > 0
                  ? ChosenRunnerKind.GlobalRunner
                  : ChosenRunnerKind.NotFound;

            const decision: RunnerChoiceDecision = decideRunnerChoice({
              stepType,
              chosenRunnerId: pick.id,
              chosenRunnerKind,
              projectUsesGlobalRunners,
              hasGlobalRunner: globalRunnerCount > 0,
            });

            const model: RunnerPickerModel = buildRunnerPickerModel({
              stepType,
              currentRunnerId: pick.id,
              projectRunners: [BASTION],
              globalRunners,
              projectUsesGlobalRunners,
            });

            expect(model.outcome).toBe(expectedOutcome(decision));
            expect(model.willRun).toBe(decision.kind !== "refused");
          });
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
          return option.kind === RunnerPickerOptionKind.Global;
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
