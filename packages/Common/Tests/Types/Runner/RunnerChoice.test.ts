import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { GLOBAL_RUNNER_STEP_TYPES } from "../../../Types/Runner/GlobalRunnerWork";
import {
  ChosenRunnerKind,
  GLOBAL_RUNNER_CHOICE_ID,
  RunnerChoiceDecision,
  RunnerChoiceFacts,
  RunnerChoiceRefusal,
  RunnerDefaultOrderFacts,
  RunnerDefaultOrderResult,
  RunnerSource,
  decideRunnerByDefaultOrder,
  decideRunnerChoice,
  describeRunnerChoiceRefusal,
  getChosenRunnerId,
  getRunnerChoiceRefusalFromStep,
  isGlobalRunnerChoice,
  isRunnerId,
  toRunnerChoiceDecision,
} from "../../../Types/Runner/RunnerChoice";
import { describe, expect, test } from "@jest/globals";

/*
 * The one rule, in its default order: where a runbook step runs.
 *
 *   - a step that picked one of its project's own Runners runs on it, always
 *     (a pick wins, whatever the project's default, its switch and the
 *     server's global Runners say);
 *   - a step that picked none runs on its project's default Runner when the
 *     project has one - the maintainer: "by default select the global
 *     runner unless I have custom runner set to default runner for the
 *     project";
 *   - otherwise, and for a step that picked the Global Runner itself, on the
 *     global Runners when they can run its type (JavaScript), the project
 *     uses them, and the server has one;
 *   - otherwise it does not run, and its error says why in plain words.
 *
 * A Bash, SSH or kubectl step never runs on a global Runner, whatever it
 * picks: a shell cannot be kept apart from other projects' steps on a host
 * every project shares.
 */

const PROJECT_RUNNER_ID: string = "0a1b2c3d-1111-4222-8333-944455556666";
const GLOBAL_RUNNER_ID: string = "0a1b2c3d-2222-4222-8333-944455556666";
const DEFAULT_RUNNER_ID: string = "0a1b2c3d-3333-4222-8333-944455556666";

const SHELL_STEP_TYPES: Array<RunbookStepType> = [
  RunbookStepType.Bash,
  RunbookStepType.SSH,
  RunbookStepType.Kubernetes,
];

const RUNNER_STEP_TYPES: Array<RunbookStepType> = [
  RunbookStepType.JavaScript,
  ...SHELL_STEP_TYPES,
];

// Every refusal ends on what to do: pick a Runner.
const PICK_SENTENCE_PATTERN: RegExp =
  /(Pick|pick) (one of your Runners|another Runner|its Runner again)/;

function facts(overrides: Partial<RunnerChoiceFacts>): RunnerChoiceFacts {
  return {
    stepType: RunbookStepType.JavaScript,
    chosenRunnerId: "",
    projectUsesGlobalRunners: true,
    hasGlobalRunner: true,
    ...overrides,
  };
}

function refusalOf(decision: RunnerChoiceDecision): RunnerChoiceRefusal {
  if (decision.kind !== "refused") {
    throw new Error(`Expected a refusal, got ${decision.kind}`);
  }

  return decision.refusal;
}

function messageOf(decision: RunnerChoiceDecision): string {
  if (decision.kind !== "refused") {
    throw new Error(`Expected a refusal, got ${decision.kind}`);
  }

  return decision.message;
}

describe("a step that picked a Runner of its own project", () => {
  test.each(RUNNER_STEP_TYPES)(
    "a %s step runs on the Runner it picked",
    (stepType: string) => {
      expect(
        decideRunnerChoice(
          facts({
            stepType,
            chosenRunnerId: PROJECT_RUNNER_ID,
            chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
          }),
        ),
      ).toEqual({ kind: "custom", runnerId: PROJECT_RUNNER_ID });
    },
  );

  test("the pick wins even when the project turned global Runners off and the server has none", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: PROJECT_RUNNER_ID,
          chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
          projectUsesGlobalRunners: false,
          hasGlobalRunner: false,
        }),
      ),
    ).toEqual({ kind: "custom", runnerId: PROJECT_RUNNER_ID });
  });

  test("the pick wins when global Runners could have run the step", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: PROJECT_RUNNER_ID,
          chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
        }),
      ),
    ).toEqual({ kind: "custom", runnerId: PROJECT_RUNNER_ID });
  });

  test("the pick wins over the project's default Runner, and is not said to be the default", () => {
    expect(
      decideRunnerChoice(
        facts({
          stepType: RunbookStepType.Bash,
          chosenRunnerId: PROJECT_RUNNER_ID,
          chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
          projectDefaultRunnerId: DEFAULT_RUNNER_ID,
        }),
      ),
    ).toEqual({ kind: "custom", runnerId: PROJECT_RUNNER_ID });
  });

  test("a step that picked the project's default Runner by its id runs on it as its own pick", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: DEFAULT_RUNNER_ID,
          chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
          projectDefaultRunnerId: DEFAULT_RUNNER_ID,
        }),
      ),
    ).toEqual({ kind: "custom", runnerId: DEFAULT_RUNNER_ID });
  });

  test("the stored id is read trimmed", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: `  ${PROJECT_RUNNER_ID}  `,
          chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
        }),
      ),
    ).toEqual({ kind: "custom", runnerId: PROJECT_RUNNER_ID });
  });
});

describe("a step that picked no Runner, in a project with a default Runner", () => {
  test.each(RUNNER_STEP_TYPES)(
    "a %s step runs on the project's default Runner, said to be the default",
    (stepType: string) => {
      expect(
        decideRunnerChoice(
          facts({ stepType, projectDefaultRunnerId: DEFAULT_RUNNER_ID }),
        ),
      ).toEqual({
        kind: "custom",
        runnerId: DEFAULT_RUNNER_ID,
        isProjectDefault: true,
      });
    },
  );

  test("the default comes before the Global Runner, which a JavaScript step would otherwise run on", () => {
    expect(decideRunnerChoice(facts({})).kind).toBe("global");
    expect(
      decideRunnerChoice(facts({ projectDefaultRunnerId: DEFAULT_RUNNER_ID })),
    ).toEqual({
      kind: "custom",
      runnerId: DEFAULT_RUNNER_ID,
      isProjectDefault: true,
    });
  });

  test("the default runs the step whatever the project's switch and the server's global Runners", () => {
    for (const projectUsesGlobalRunners of [true, false]) {
      for (const hasGlobalRunner of [true, false]) {
        expect(
          decideRunnerChoice(
            facts({
              stepType: RunbookStepType.SSH,
              projectDefaultRunnerId: DEFAULT_RUNNER_ID,
              projectUsesGlobalRunners,
              hasGlobalRunner,
            }),
          ),
        ).toEqual({
          kind: "custom",
          runnerId: DEFAULT_RUNNER_ID,
          isProjectDefault: true,
        });
      }
    }
  });

  test("a step with no stored Runner field at all, or only spaces, follows the default too", () => {
    for (const chosenRunnerId of [undefined, null, "   "]) {
      expect(
        decideRunnerChoice(
          facts({
            stepType: RunbookStepType.Bash,
            chosenRunnerId,
            projectDefaultRunnerId: DEFAULT_RUNNER_ID,
          }),
        ),
      ).toEqual({
        kind: "custom",
        runnerId: DEFAULT_RUNNER_ID,
        isProjectDefault: true,
      });
    }
  });

  test("a default that is not a Runner id is no default", () => {
    for (const projectDefaultRunnerId of ["", "  ", "prod-runner", null]) {
      expect(
        decideRunnerChoice(facts({ projectDefaultRunnerId })).kind,
      ).toBe("global");
    }
  });
});

describe("a step that picked no Runner, in a project with no default Runner", () => {
  test("a JavaScript step runs on the global Runners", () => {
    expect(decideRunnerChoice(facts({}))).toEqual({ kind: "global" });
  });

  test("a JavaScript step with no stored Runner field at all runs on the global Runners", () => {
    expect(decideRunnerChoice(facts({ chosenRunnerId: undefined }))).toEqual({
      kind: "global",
    });
    expect(decideRunnerChoice(facts({ chosenRunnerId: null }))).toEqual({
      kind: "global",
    });
    expect(decideRunnerChoice(facts({ chosenRunnerId: "   " }))).toEqual({
      kind: "global",
    });
  });

  test.each(SHELL_STEP_TYPES)(
    "a %s step never runs on a global Runner, even when there is one, and is pointed at the project default",
    (stepType: string) => {
      const decision: RunnerChoiceDecision = decideRunnerChoice(
        facts({ stepType }),
      );

      expect(refusalOf(decision)).toBe(RunnerChoiceRefusal.NeedsOwnRunner);
      expect(messageOf(decision)).toBe(
        `This ${stepType} step has no Runner. ${stepType} steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only. Pick one of your Runners for the step, or make one the project's default Runner under Runbooks → Runners.`,
      );
    },
  );

  test("a JavaScript step of a project that turned global Runners off does not run", () => {
    const decision: RunnerChoiceDecision = decideRunnerChoice(
      facts({ projectUsesGlobalRunners: false }),
    );

    expect(refusalOf(decision)).toBe(
      RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff,
    );
    expect(messageOf(decision)).toBe(
      "This JavaScript step has no Runner of its own, and this project does not use global Runners. Pick one of your Runners for the step, make one the project's default Runner, or turn global Runners on under Runbooks → Runners.",
    );
  });

  test("a JavaScript step on a server with no global Runner does not run (the existing refusal, worded plainly)", () => {
    const decision: RunnerChoiceDecision = decideRunnerChoice(
      facts({ hasGlobalRunner: false }),
    );

    expect(refusalOf(decision)).toBe(RunnerChoiceRefusal.NoGlobalRunner);
    expect(messageOf(decision)).toBe(
      "This JavaScript step has no Runner of its own, and there is no global Runner to run it. Pick one of your Runners for the step, or make one the project's default Runner under Runbooks → Runners.",
    );
  });

  test("the project's switch is asked before whether the server has a global Runner", () => {
    expect(
      refusalOf(
        decideRunnerChoice(
          facts({ projectUsesGlobalRunners: false, hasGlobalRunner: false }),
        ),
      ),
    ).toBe(RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff);
  });

  test("whether global Runners can run the step is asked before the project's switch", () => {
    expect(
      refusalOf(
        decideRunnerChoice(
          facts({
            stepType: RunbookStepType.Bash,
            projectUsesGlobalRunners: false,
            hasGlobalRunner: false,
          }),
        ),
      ),
    ).toBe(RunnerChoiceRefusal.NeedsOwnRunner);
  });
});

describe("a step that picked the Global Runner itself", () => {
  test("the stored pick is 'global', never an id a Runner could lose", () => {
    expect(GLOBAL_RUNNER_CHOICE_ID).toBe("global");
    expect(isRunnerId(GLOBAL_RUNNER_CHOICE_ID)).toBe(false);
  });

  test("a JavaScript step runs on the global Runners", () => {
    expect(
      decideRunnerChoice(facts({ chosenRunnerId: GLOBAL_RUNNER_CHOICE_ID })),
    ).toEqual({ kind: "global" });
  });

  test("it does not follow the project's default Runner: the Global Runner is what it picked", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: GLOBAL_RUNNER_CHOICE_ID,
          projectDefaultRunnerId: DEFAULT_RUNNER_ID,
        }),
      ),
    ).toEqual({ kind: "global" });
  });

  test("the pick is read whatever its case and spaces", () => {
    for (const chosenRunnerId of ["Global", " GLOBAL ", "global\n"]) {
      expect(isGlobalRunnerChoice(chosenRunnerId)).toBe(true);
      expect(decideRunnerChoice(facts({ chosenRunnerId })).kind).toBe(
        "global",
      );
    }

    expect(isGlobalRunnerChoice("globals")).toBe(false);
    expect(isGlobalRunnerChoice("")).toBe(false);
    expect(isGlobalRunnerChoice(undefined)).toBe(false);
  });

  test.each(SHELL_STEP_TYPES)(
    "a %s step that picked it is refused, told why, and not pointed at a default it does not follow",
    (stepType: string) => {
      const decision: RunnerChoiceDecision = decideRunnerChoice(
        facts({
          stepType,
          chosenRunnerId: GLOBAL_RUNNER_CHOICE_ID,
          projectDefaultRunnerId: DEFAULT_RUNNER_ID,
        }),
      );

      expect(refusalOf(decision)).toBe(RunnerChoiceRefusal.NeedsOwnRunner);
      expect(messageOf(decision)).toBe(
        `This ${stepType} step picks the Global Runner, but global Runners run JavaScript steps only: ${stepType} steps run on a Runner of your own, inside your network. Pick one of your Runners for the step.`,
      );
    },
  );

  test("a project that turned global Runners off cannot reach one by picking it", () => {
    const decision: RunnerChoiceDecision = decideRunnerChoice(
      facts({
        chosenRunnerId: GLOBAL_RUNNER_CHOICE_ID,
        projectUsesGlobalRunners: false,
      }),
    );

    expect(refusalOf(decision)).toBe(
      RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff,
    );
    expect(messageOf(decision)).toBe(
      "This JavaScript step picks the Global Runner, and this project does not use global Runners. Pick one of your Runners for the step, or turn global Runners on under Runbooks → Runners.",
    );
  });

  test("on a server with no global Runner it is refused, saying so", () => {
    expect(
      messageOf(
        decideRunnerChoice(
          facts({
            chosenRunnerId: GLOBAL_RUNNER_CHOICE_ID,
            hasGlobalRunner: false,
          }),
        ),
      ),
    ).toBe(
      "This JavaScript step picks the Global Runner, and there is no global Runner to run it. Pick one of your Runners for the step.",
    );
  });
});

describe("a step that picked one global Runner by its id", () => {
  test("picked the Global Runner: it runs on the global Runners, whichever is free", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: GLOBAL_RUNNER_ID,
          chosenRunnerKind: ChosenRunnerKind.GlobalRunner,
        }),
      ),
    ).toEqual({ kind: "global" });
  });

  test("it does not follow the project's default Runner either", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: GLOBAL_RUNNER_ID,
          chosenRunnerKind: ChosenRunnerKind.GlobalRunner,
          projectDefaultRunnerId: DEFAULT_RUNNER_ID,
        }),
      ),
    ).toEqual({ kind: "global" });
  });

  test("a Bash step that names a global Runner is refused like one that picked the Global Runner", () => {
    const decision: RunnerChoiceDecision = decideRunnerChoice(
      facts({
        stepType: RunbookStepType.Bash,
        chosenRunnerId: GLOBAL_RUNNER_ID,
        chosenRunnerKind: ChosenRunnerKind.GlobalRunner,
      }),
    );

    expect(refusalOf(decision)).toBe(RunnerChoiceRefusal.NeedsOwnRunner);
    expect(messageOf(decision)).toContain("picks the Global Runner");
  });

  test("a project that turned global Runners off cannot reach one by naming it", () => {
    expect(
      refusalOf(
        decideRunnerChoice(
          facts({
            chosenRunnerId: GLOBAL_RUNNER_ID,
            chosenRunnerKind: ChosenRunnerKind.GlobalRunner,
            projectUsesGlobalRunners: false,
          }),
        ),
      ),
    ).toBe(RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff);
  });
});

describe("a step that names a Runner that is not one", () => {
  test("an id that is not a Runner id is refused, quoted", () => {
    const decision: RunnerChoiceDecision = decideRunnerChoice(
      facts({ chosenRunnerId: "prod-runner" }),
    );

    expect(refusalOf(decision)).toBe(RunnerChoiceRefusal.InvalidRunnerId);
    expect(messageOf(decision)).toBe(
      'This JavaScript step names its Runner by "prod-runner", which is not a Runner ID. Open the step and pick its Runner again.',
    );
  });

  test("a long stored value is cut in the message, never echoed whole", () => {
    const long: string = "x".repeat(5000);
    const message: string = messageOf(
      decideRunnerChoice(facts({ chosenRunnerId: long })),
    );

    expect(message).toContain(`"${"x".repeat(80)}…"`);
    expect(message.length).toBeLessThan(250);
  });

  test("an invalid id is refused before anything else is asked, whatever the step type", () => {
    expect(
      refusalOf(
        decideRunnerChoice(
          facts({
            stepType: RunbookStepType.Bash,
            chosenRunnerId: "not-an-id",
            projectUsesGlobalRunners: false,
            hasGlobalRunner: false,
          }),
        ),
      ),
    ).toBe(RunnerChoiceRefusal.InvalidRunnerId);
  });

  test("a Runner that is not the project's (deleted, or another project's) is refused, not waited on", () => {
    const decision: RunnerChoiceDecision = decideRunnerChoice(
      facts({
        chosenRunnerId: PROJECT_RUNNER_ID,
        chosenRunnerKind: ChosenRunnerKind.NotFound,
      }),
    );

    expect(refusalOf(decision)).toBe(RunnerChoiceRefusal.RunnerNotFound);
    expect(messageOf(decision)).toBe(
      "This JavaScript step picked a Runner that is not one of this project's Runners any more. It may have been deleted. Open the step and pick another Runner.",
    );
  });

  test("a deleted Runner falls back neither to the global Runners nor to the project's default", () => {
    for (const projectDefaultRunnerId of ["", DEFAULT_RUNNER_ID]) {
      expect(
        refusalOf(
          decideRunnerChoice(
            facts({
              chosenRunnerId: PROJECT_RUNNER_ID,
              chosenRunnerKind: ChosenRunnerKind.NotFound,
              projectDefaultRunnerId,
            }),
          ),
        ),
      ).toBe(RunnerChoiceRefusal.RunnerNotFound);
    }
  });

  test("an invalid id does not fall back to the project's default either", () => {
    expect(
      refusalOf(
        decideRunnerChoice(
          facts({
            chosenRunnerId: "prod-runner",
            projectDefaultRunnerId: DEFAULT_RUNNER_ID,
          }),
        ),
      ),
    ).toBe(RunnerChoiceRefusal.InvalidRunnerId);
  });
});

describe("every refusal", () => {
  test.each(Object.values(RunnerChoiceRefusal))(
    "%s names the step and says what to do, whether the step picked none or the Global Runner",
    (refusal: RunnerChoiceRefusal) => {
      for (const pickedGlobalRunner of [false, true]) {
        const message: string = describeRunnerChoiceRefusal({
          refusal,
          stepType: RunbookStepType.Bash,
          chosenRunnerId: "abc",
          pickedGlobalRunner,
        });

        expect(message.startsWith("This Bash step")).toBe(true);
        expect(message).toMatch(PICK_SENTENCE_PATTERN);
        // Never the old "is missing a Runner" wording.
        expect(message).not.toContain("is missing a Runner");
      }
    },
  );

  test("a refusal of a step that picked none sends people to the Runners page, named the way the Dashboard does", () => {
    for (const refusal of [
      RunnerChoiceRefusal.NeedsOwnRunner,
      RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff,
      RunnerChoiceRefusal.NoGlobalRunner,
    ]) {
      expect(
        describeRunnerChoiceRefusal({
          refusal,
          stepType: RunbookStepType.JavaScript,
        }),
      ).toContain("Runbooks → Runners");
    }
  });

  test("a refusal of a step that picked none offers the project's default Runner as a way on", () => {
    for (const refusal of [
      RunnerChoiceRefusal.NeedsOwnRunner,
      RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff,
      RunnerChoiceRefusal.NoGlobalRunner,
    ]) {
      expect(
        describeRunnerChoiceRefusal({
          refusal,
          stepType: RunbookStepType.JavaScript,
        }),
      ).toContain("make one the project's default Runner");
      // A step that picked the Global Runner follows no default: never offered one.
      expect(
        describeRunnerChoiceRefusal({
          refusal,
          stepType: RunbookStepType.JavaScript,
          pickedGlobalRunner: true,
        }),
      ).not.toContain("default");
    }
  });
});

describe("the refusal a step earns from what it says alone", () => {
  /*
   * Read before anything is looked up (StepExecutors): only what can never
   * run, whatever the server says, is refused here.
   */
  test("a Runner named by something that is not an ID", () => {
    const decision: RunnerChoiceDecision | null =
      getRunnerChoiceRefusalFromStep({
        stepType: RunbookStepType.JavaScript,
        chosenRunnerId: "prod-runner",
      });

    expect(decision).toEqual({
      kind: "refused",
      refusal: RunnerChoiceRefusal.InvalidRunnerId,
      message:
        'This JavaScript step names its Runner by "prod-runner", which is not a Runner ID. Open the step and pick its Runner again.',
    });
  });

  test.each(SHELL_STEP_TYPES)(
    "the Global Runner picked on a %s step, which global Runners never run",
    (stepType: RunbookStepType) => {
      const decision: RunnerChoiceDecision | null =
        getRunnerChoiceRefusalFromStep({
          stepType,
          chosenRunnerId: GLOBAL_RUNNER_CHOICE_ID,
        });

      expect(decision?.kind).toBe("refused");
      expect(decision?.kind === "refused" ? decision.refusal : undefined).toBe(
        RunnerChoiceRefusal.NeedsOwnRunner,
      );
    },
  );

  /*
   * The regression this task fixed on the server: a Bash step that picks no
   * Runner used to be refused here, before anything was read. It may follow
   * the project's default Runner now, which only the server can say.
   */
  test.each(SHELL_STEP_TYPES)(
    "nothing for a %s step with no Runner: the project's default Runner may run it",
    (stepType: RunbookStepType) => {
      expect(
        getRunnerChoiceRefusalFromStep({ stepType, chosenRunnerId: "  " }),
      ).toBeNull();
    },
  );

  test("nothing for a JavaScript step with no Runner, or one that picked the Global Runner: the server's facts decide it", () => {
    for (const chosenRunnerId of ["", GLOBAL_RUNNER_CHOICE_ID]) {
      expect(
        getRunnerChoiceRefusalFromStep({
          stepType: RunbookStepType.JavaScript,
          chosenRunnerId,
        }),
      ).toBeNull();
    }
  });

  test("nothing for a step that picked a Runner by its ID, of any type: whether it still exists is the server's to say", () => {
    for (const stepType of RUNNER_STEP_TYPES) {
      expect(
        getRunnerChoiceRefusalFromStep({
          stepType,
          chosenRunnerId: PROJECT_RUNNER_ID,
        }),
      ).toBeNull();
    }
  });

  test("agrees with the whole rule whenever the facts are on the step's side", () => {
    for (const stepType of Object.values(RunbookStepType)) {
      for (const chosenRunnerId of [
        "",
        "not-an-id",
        PROJECT_RUNNER_ID,
        GLOBAL_RUNNER_CHOICE_ID,
      ]) {
        const fromStep: RunnerChoiceDecision | null =
          getRunnerChoiceRefusalFromStep({ stepType, chosenRunnerId });
        const whole: RunnerChoiceDecision = decideRunnerChoice(
          facts({
            stepType,
            chosenRunnerId,
            projectDefaultRunnerId: DEFAULT_RUNNER_ID,
          }),
        );

        expect(fromStep).toEqual(whole.kind === "refused" ? whole : null);
      }
    }
  });
});

describe("the default order, for any work that picks a Runner", () => {
  function order(
    overrides: Partial<RunnerDefaultOrderFacts>,
  ): RunnerDefaultOrderResult {
    return decideRunnerByDefaultOrder({
      chosenRunnerId: "",
      projectDefaultRunnerId: "",
      canGlobalRunnersRunWork: true,
      projectUsesGlobalRunners: true,
      hasGlobalRunner: true,
      ...overrides,
    });
  }

  test("its own Runner, then the project's default Runner, then the Global Runner", () => {
    expect(
      order({
        chosenRunnerId: PROJECT_RUNNER_ID,
        chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
        projectDefaultRunnerId: DEFAULT_RUNNER_ID,
      }),
    ).toEqual({ source: RunnerSource.Picked, runnerId: PROJECT_RUNNER_ID });

    expect(order({ projectDefaultRunnerId: DEFAULT_RUNNER_ID })).toEqual({
      source: RunnerSource.ProjectDefault,
      runnerId: DEFAULT_RUNNER_ID,
    });

    expect(order({})).toEqual({ source: RunnerSource.Global });
  });

  /*
   * Work global Runners never run - an auto remediation rule's commands,
   * say: its own Runner, then the project's default, then none, with why.
   */
  test("work global Runners never run goes its own Runner, then the project's default, then nowhere", () => {
    expect(
      order({
        canGlobalRunnersRunWork: false,
        chosenRunnerId: PROJECT_RUNNER_ID,
        chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
      }),
    ).toEqual({ source: RunnerSource.Picked, runnerId: PROJECT_RUNNER_ID });

    expect(
      order({
        canGlobalRunnersRunWork: false,
        projectDefaultRunnerId: DEFAULT_RUNNER_ID,
      }),
    ).toEqual({
      source: RunnerSource.ProjectDefault,
      runnerId: DEFAULT_RUNNER_ID,
    });

    expect(order({ canGlobalRunnersRunWork: false })).toEqual({
      source: RunnerSource.None,
      refusal: RunnerChoiceRefusal.NeedsOwnRunner,
      pickedGlobalRunner: false,
    });
  });

  test("none says whether the work picked the Global Runner itself", () => {
    expect(
      order({
        chosenRunnerId: GLOBAL_RUNNER_CHOICE_ID,
        projectUsesGlobalRunners: false,
      }),
    ).toEqual({
      source: RunnerSource.None,
      refusal: RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff,
      pickedGlobalRunner: true,
    });

    expect(order({ hasGlobalRunner: false })).toEqual({
      source: RunnerSource.None,
      refusal: RunnerChoiceRefusal.NoGlobalRunner,
      pickedGlobalRunner: false,
    });
  });

  test("a step's decision is the order's answer in a step's words", () => {
    expect(
      toRunnerChoiceDecision({
        result: { source: RunnerSource.Picked, runnerId: PROJECT_RUNNER_ID },
        stepType: RunbookStepType.Bash,
      }),
    ).toEqual({ kind: "custom", runnerId: PROJECT_RUNNER_ID });

    expect(
      toRunnerChoiceDecision({
        result: {
          source: RunnerSource.ProjectDefault,
          runnerId: DEFAULT_RUNNER_ID,
        },
        stepType: RunbookStepType.Bash,
      }),
    ).toEqual({
      kind: "custom",
      runnerId: DEFAULT_RUNNER_ID,
      isProjectDefault: true,
    });

    expect(
      toRunnerChoiceDecision({
        result: { source: RunnerSource.Global },
        stepType: RunbookStepType.JavaScript,
      }),
    ).toEqual({ kind: "global" });

    expect(
      toRunnerChoiceDecision({
        result: {
          source: RunnerSource.None,
          refusal: RunnerChoiceRefusal.InvalidRunnerId,
          pickedGlobalRunner: false,
        },
        stepType: RunbookStepType.Bash,
        chosenRunnerId: " prod ",
      }),
    ).toEqual({
      kind: "refused",
      refusal: RunnerChoiceRefusal.InvalidRunnerId,
      message:
        'This Bash step names its Runner by "prod", which is not a Runner ID. Open the step and pick its Runner again.',
    });
  });
});

/*
 * Every combination a step can be in - its type, what it picked, whether
 * its project has a default Runner, the project's switch, the server's
 * global Runners - held to the rule's promises at once.
 */
describe("every combination", () => {
  interface Pick {
    label: string;
    chosenRunnerId: string;
    chosenRunnerKind?: ChosenRunnerKind | undefined;
  }

  const PICKS: Array<Pick> = [
    { label: "none", chosenRunnerId: "" },
    { label: "the Global Runner", chosenRunnerId: GLOBAL_RUNNER_CHOICE_ID },
    {
      label: "one global Runner",
      chosenRunnerId: GLOBAL_RUNNER_ID,
      chosenRunnerKind: ChosenRunnerKind.GlobalRunner,
    },
    {
      label: "a Runner of its own",
      chosenRunnerId: PROJECT_RUNNER_ID,
      chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
    },
    {
      label: "a deleted Runner",
      chosenRunnerId: PROJECT_RUNNER_ID,
      chosenRunnerKind: ChosenRunnerKind.NotFound,
    },
    { label: "a name", chosenRunnerId: "prod-runner" },
  ];

  test("holds every promise", () => {
    let checked: number = 0;

    for (const stepType of Object.values(RunbookStepType)) {
      for (const pick of PICKS) {
        for (const projectDefaultRunnerId of ["", DEFAULT_RUNNER_ID]) {
          for (const projectUsesGlobalRunners of [true, false]) {
            for (const hasGlobalRunner of [true, false]) {
              const decision: RunnerChoiceDecision = decideRunnerChoice({
                stepType,
                chosenRunnerId: pick.chosenRunnerId,
                ...(pick.chosenRunnerKind
                  ? { chosenRunnerKind: pick.chosenRunnerKind }
                  : {}),
                projectDefaultRunnerId,
                projectUsesGlobalRunners,
                hasGlobalRunner,
              });

              const label: string = `${stepType}, picked ${pick.label}, default ${projectDefaultRunnerId ? "yes" : "no"}, uses ${projectUsesGlobalRunners}, has ${hasGlobalRunner}`;

              const picksGlobal: boolean =
                pick.label === "the Global Runner" ||
                pick.label === "one global Runner";

              // Only a JavaScript step, in a project that uses them, on a server with one.
              if (decision.kind === "global") {
                expect({
                  label,
                  ok:
                    GLOBAL_RUNNER_STEP_TYPES.includes(stepType) &&
                    projectUsesGlobalRunners &&
                    hasGlobalRunner &&
                    (picksGlobal ||
                      (pick.label === "none" && !projectDefaultRunnerId)),
                }).toEqual({ label, ok: true });
              }

              // A Runner of its own always wins.
              if (pick.label === "a Runner of its own") {
                expect({ label, decision }).toEqual({
                  label,
                  decision: { kind: "custom", runnerId: PROJECT_RUNNER_ID },
                });
              }

              // A step that picked none follows the project's default when there is one.
              if (pick.label === "none" && projectDefaultRunnerId) {
                expect({ label, decision }).toEqual({
                  label,
                  decision: {
                    kind: "custom",
                    runnerId: DEFAULT_RUNNER_ID,
                    isProjectDefault: true,
                  },
                });
              }

              // The default is followed by a step that picked none, and only by it.
              if (decision.kind === "custom" && decision.isProjectDefault) {
                expect({ label, pick: pick.label }).toEqual({
                  label,
                  pick: "none",
                });
              }

              // A deleted Runner or a name never runs anywhere.
              if (
                pick.label === "a deleted Runner" ||
                pick.label === "a name"
              ) {
                expect({ label, kind: decision.kind }).toEqual({
                  label,
                  kind: "refused",
                });
              }

              checked++;
            }
          }
        }
      }
    }

    expect(checked).toBe(
      Object.values(RunbookStepType).length * PICKS.length * 2 * 2 * 2,
    );
  });
});

describe("reading a stored Runner id", () => {
  test("getChosenRunnerId trims a string and reads anything else as none", () => {
    expect(getChosenRunnerId(` ${PROJECT_RUNNER_ID} `)).toBe(PROJECT_RUNNER_ID);
    expect(getChosenRunnerId(undefined)).toBe("");
    expect(getChosenRunnerId(null)).toBe("");
    expect(getChosenRunnerId(42)).toBe("");
    expect(getChosenRunnerId({ id: PROJECT_RUNNER_ID })).toBe("");
  });

  test("isRunnerId accepts a uuid only", () => {
    expect(isRunnerId(PROJECT_RUNNER_ID)).toBe(true);
    expect(isRunnerId("prod-runner")).toBe(false);
    expect(isRunnerId("")).toBe(false);
  });
});
