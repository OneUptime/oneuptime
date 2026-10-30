import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SecurityPlaybookActionType,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  SecurityPlaybookStep,
  assertSecurityPlaybookStepConditions,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import { SecurityPlaybookStepStatus } from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStepOutcome,
  describeSecurityPlaybookStepOutcome,
  getSecurityPlaybookStepOutcomes,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStepCondition";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  RUN_ALWAYS,
  RUN_IF_FLAG_TEMPLATES,
  RUN_IF_KEY,
  RUN_IF_OPTION_TEMPLATES,
  RUN_IF_THREAT_INTEL_MATCHED,
  RunIfOption,
  STEP_ACTION_KEY,
  decodeRunIf,
  describeRunIf,
  describeRunIfFormValue,
  encodeRunIf,
  formValuesToStep,
  getNewStepFormValues,
  getRunIfFormValue,
  getRunIfOptions,
  getStepDeleteBlock,
  getStepMoveBlock,
  stepToFormValues,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepForm";
import {
  RunStepRow,
  getRunStepRows,
  getSkippedRunIf,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunStepRows";

/*
 * RUN THIS STEP in the playbook editor: the one picker a step's branch is
 * set with, the line a step's card says it with, and the moves and deletes
 * a branch keeps from breaking - each pinned without a browser, as the
 * server will read what the dialog saves.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

// The words a Dashboard in this language ships, read from its locale file.
function shippedTranslator(language: string): Translator {
  const words: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Dashboard",
        "src",
        "Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  return createTranslator((text: string): string | undefined => {
    const translated: unknown = words[text];

    return typeof translated === "string" ? translated : undefined;
  }, language);
}

function step(
  id: string,
  action: SecurityPlaybookActionType,
  extra: Partial<SecurityPlaybookStep> = {},
): SecurityPlaybookStep {
  return {
    id,
    action,
    config:
      action === SecurityPlaybookActionType.AddCaseNote
        ? { note: "n" }
        : action === SecurityPlaybookActionType.SuspendOktaUser
          ? { connectionId: "11111111-1111-4111-8111-111111111111" }
          : {},
    requiresApproval: false,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
    ...extra,
  };
}

const CHECK: SecurityPlaybookStep = step(
  "check",
  SecurityPlaybookActionType.CheckThreatIntel,
);
const NOTE: SecurityPlaybookStep = step(
  "note",
  SecurityPlaybookActionType.AddCaseNote,
  { continueOnFailure: true },
);
const SUSPEND: SecurityPlaybookStep = step(
  "suspend",
  SecurityPlaybookActionType.SuspendOktaUser,
  {
    runIf: { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
  },
);

function labels(options: Array<RunIfOption>): Array<string> {
  return options.map((option: RunIfOption): string => {
    return option.label;
  });
}

describe("Run This Step's value", () => {
  test("round-trips the step it waits on and the result, an id with a colon too", () => {
    for (const condition of [
      { stepId: "check", outcome: SecurityPlaybookStepOutcome.FoundNothing },
      { stepId: "a:b:c", outcome: SecurityPlaybookStepOutcome.Failed },
      {
        stepId: "0b5e1c7e-7c1a-4c55-9a7b-3b2a1f0c9d11",
        outcome: SecurityPlaybookStepOutcome.Succeeded,
      },
    ]) {
      expect(decodeRunIf(encodeRunIf(condition))).toEqual(condition);
    }
  });

  test("reads nothing from Always, the legacy switch, or what is not a value of its own", () => {
    for (const value of [
      RUN_ALWAYS,
      RUN_IF_THREAT_INTEL_MATCHED,
      "after:",
      "after:Found",
      "after:Matched:check",
      "after::check",
      undefined,
      42,
    ]) {
      expect(decodeRunIf(value)).toBeUndefined();
    }

    // As a dropdown hands back its option.
    expect(decodeRunIf({ value: "after:Found:check", label: "x" })).toEqual({
      stepId: "check",
      outcome: SecurityPlaybookStepOutcome.Found,
    });
  });

  test("a step opens with what it waits on, the legacy switch, or Always", () => {
    expect(getRunIfFormValue(SUSPEND)).toBe("after:Found:check");
    expect(
      getRunIfFormValue(
        step("x", SecurityPlaybookActionType.AddCaseNote, {
          onlyIfThreatIntelMatched: true,
        }),
      ),
    ).toBe(RUN_IF_THREAT_INTEL_MATCHED);
    expect(getRunIfFormValue(CHECK)).toBe(RUN_ALWAYS);
  });
});

describe("Run This Step's choices", () => {
  test("Always first, then each result of each earlier step, in the order the steps run", () => {
    const options: Array<RunIfOption> = getRunIfOptions({
      earlierSteps: [CHECK, NOTE],
      translator: ENGLISH,
    });

    expect(labels(options)).toEqual([
      "Always",
      "Only if step 1 (Check entities against threat intel) found a known-bad entity",
      "Only if step 1 (Check entities against threat intel) found nothing known-bad",
      "Only if step 2 (Add a note) succeeded",
      // The note carries on when it fails, so its failure can be waited on.
      "Only if step 2 (Add a note) failed",
    ]);
    expect(options[1]!.value).toBe("after:Found:check");
    expect(
      options.every((option: RunIfOption): boolean => {
        return option.isInPageDirection;
      }),
    ).toBe(true);
  });

  test("the first step has only Always", () => {
    expect(
      labels(getRunIfOptions({ earlierSteps: [], translator: ENGLISH })),
    ).toEqual(["Always"]);
  });

  test("a step saved with the legacy switch keeps it as a choice, so opening it never changes it", () => {
    const legacy: SecurityPlaybookStep = step(
      "legacy",
      SecurityPlaybookActionType.SuspendOktaUser,
      { onlyIfThreatIntelMatched: true },
    );

    const options: Array<RunIfOption> = getRunIfOptions({
      earlierSteps: [CHECK],
      step: legacy,
      translator: ENGLISH,
    });

    expect(options[options.length - 1]).toEqual({
      value: RUN_IF_THREAT_INTEL_MATCHED,
      label: "Only if an earlier threat intel check found a known-bad entity",
      isInPageDirection: true,
    });
    // A step without it is not offered it.
    expect(
      getRunIfOptions({
        earlierSteps: [CHECK],
        step: CHECK,
        translator: ENGLISH,
      }).some((option: RunIfOption): boolean => {
        return option.value === RUN_IF_THREAT_INTEL_MATCHED;
      }),
    ).toBe(false);
  });

  test("a condition that no longer fits stays its own choice, named as such", () => {
    const stale: SecurityPlaybookStep = step(
      "stale",
      SecurityPlaybookActionType.AddCaseNote,
      {
        runIf: { stepId: "gone", outcome: SecurityPlaybookStepOutcome.Found },
      },
    );

    const options: Array<RunIfOption> = getRunIfOptions({
      earlierSteps: [CHECK],
      step: stale,
      translator: ENGLISH,
    });

    expect(options[options.length - 1]).toEqual({
      value: "after:Found:gone",
      label: "Only after a step that is no longer before it",
      isInPageDirection: true,
    });
  });

  test("reads in the reader's language: German words each result its own way", () => {
    // The words a German Dashboard ships, read from its locale file.
    const german: Record<string, unknown> = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Dashboard",
          "src",
          "Locales",
          "de.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;

    const options: Array<RunIfOption> = getRunIfOptions({
      earlierSteps: [CHECK],
      translator: createTranslator((text: string): string | undefined => {
        const words: unknown = german[text];

        return typeof words === "string" ? words : undefined;
      }, "de"),
    });

    expect(
      options.map((option: RunIfOption): string => {
        return option.label;
      }),
    ).toEqual([
      "Immer",
      "Nur wenn Schritt 1 (Entitäten mit Threat Intel abgleichen) eine bekannt bösartige Entität gefunden hat",
      "Nur wenn Schritt 1 (Entitäten mit Threat Intel abgleichen) nichts bekannt Bösartiges gefunden hat",
    ]);
  });

  test("every result any action can have has its sentence, in the picker and on a card", () => {
    const phrases: Set<string> = new Set<string>();

    for (const action of SECURITY_PLAYBOOK_ACTIONS) {
      for (const outcome of getSecurityPlaybookStepOutcomes({
        action: action.type,
        continueOnFailure: true,
      })) {
        phrases.add(describeSecurityPlaybookStepOutcome(action.type, outcome));
      }
    }

    expect(Object.keys(RUN_IF_OPTION_TEMPLATES).sort()).toEqual(
      [...phrases].sort(),
    );
    expect(Object.keys(RUN_IF_FLAG_TEMPLATES).sort()).toEqual(
      [...phrases].sort(),
    );

    for (const phrase of phrases) {
      expect(RUN_IF_OPTION_TEMPLATES[phrase]).toBe(
        `Only if step {{number}} ({{title}}) ${phrase}`,
      );
      expect(RUN_IF_FLAG_TEMPLATES[phrase]).toBe(
        `Only if step {{number}} ${phrase}`,
      );
    }
  });
});

describe("what a step's card says of when it runs", () => {
  test("names the step it waits on by its number, and the result", () => {
    const steps: Array<SecurityPlaybookStep> = [
      CHECK,
      SUSPEND,
      step("else", SecurityPlaybookActionType.AddCaseNote, {
        runIf: {
          stepId: "check",
          outcome: SecurityPlaybookStepOutcome.FoundNothing,
        },
      }),
    ];

    expect(
      steps.map((item: SecurityPlaybookStep): string => {
        return describeRunIf({ step: item, steps, translator: ENGLISH });
      }),
    ).toEqual([
      "",
      "Only if step 1 found a known-bad entity",
      "Only if step 1 found nothing known-bad",
    ]);
  });

  test("the legacy switch, and a step that is gone, say so", () => {
    expect(
      describeRunIf({
        step: step("x", SecurityPlaybookActionType.AddCaseNote, {
          onlyIfThreatIntelMatched: true,
        }),
        steps: [],
        translator: ENGLISH,
      }),
    ).toBe("Only if threat intel matched");
    expect(
      describeRunIf({
        step: step("x", SecurityPlaybookActionType.AddCaseNote, {
          runIf: {
            stepId: "gone",
            outcome: SecurityPlaybookStepOutcome.Succeeded,
          },
        }),
        steps: [],
        translator: ENGLISH,
      }),
    ).toBe("Only after a step that is no longer before it");
  });
});

describe("moving or deleting a step a branch reads", () => {
  const STEPS: Array<SecurityPlaybookStep> = [
    CHECK,
    SUSPEND,
    step("after", SecurityPlaybookActionType.AddCaseNote),
  ];

  test("a step stays below the step it waits on", () => {
    expect(
      getStepMoveBlock({
        steps: STEPS,
        index: 1,
        direction: -1,
        translator: ENGLISH,
      }),
    ).toBe("This step waits on step 1's result, so it stays below step 1.");
    // Moving it down is fine.
    expect(
      getStepMoveBlock({
        steps: STEPS,
        index: 1,
        direction: 1,
        translator: ENGLISH,
      }),
    ).toBeUndefined();
  });

  test("a step another waits on stays above it", () => {
    expect(
      getStepMoveBlock({
        steps: STEPS,
        index: 0,
        direction: 1,
        translator: ENGLISH,
      }),
    ).toBe(
      "Step 2 waits on this step's result. Change Run This Step on step 2 first.",
    );
    // The last step, and a step nothing waits on, move freely.
    expect(
      getStepMoveBlock({
        steps: STEPS,
        index: 2,
        direction: -1,
        translator: ENGLISH,
      }),
    ).toBeUndefined();
    expect(
      getStepMoveBlock({
        steps: STEPS,
        index: 2,
        direction: 1,
        translator: ENGLISH,
      }),
    ).toBeUndefined();
  });

  test("a step another waits on cannot be deleted, saying which", () => {
    expect(
      getStepDeleteBlock({ steps: STEPS, index: 0, translator: ENGLISH }),
    ).toBe(
      "Step 2 waits on this step's result. Change Run This Step on step 2 first.",
    );
    expect(
      getStepDeleteBlock({ steps: STEPS, index: 1, translator: ENGLISH }),
    ).toBeUndefined();
    expect(
      getStepDeleteBlock({ steps: STEPS, index: 9, translator: ENGLISH }),
    ).toBeUndefined();
  });

  test("a locked item names the step in the way, in the reader's words and digits", () => {
    // German words it as the German Run This Step reads.
    expect(
      getStepDeleteBlock({
        steps: STEPS,
        index: 0,
        translator: shippedTranslator("de"),
      }),
    ).toBe(
      "Schritt 2 wartet auf das Ergebnis dieses Schritts. Ändern Sie zuerst „Diesen Schritt ausführen“ bei Schritt 2.",
    );
    // Persian writes the step's number in its own digits.
    expect(
      getStepMoveBlock({
        steps: STEPS,
        index: 1,
        direction: -1,
        translator: shippedTranslator("fa"),
      }),
    ).toContain("\u06f1");
  });

  test("every move the editor allows keeps the playbook saveable", () => {
    const steps: Array<SecurityPlaybookStep> = [
      CHECK,
      SUSPEND,
      step("else", SecurityPlaybookActionType.AddCaseNote, {
        runIf: {
          stepId: "check",
          outcome: SecurityPlaybookStepOutcome.FoundNothing,
        },
      }),
      NOTE,
    ];

    for (let index: number = 0; index < steps.length; index++) {
      for (const direction of [-1, 1] as Array<-1 | 1>) {
        const target: number = index + direction;

        if (
          target < 0 ||
          target >= steps.length ||
          getStepMoveBlock({ steps, index, direction, translator: ENGLISH })
        ) {
          continue;
        }

        const moved: Array<SecurityPlaybookStep> = [...steps];
        moved[index] = steps[target]!;
        moved[target] = steps[index]!;

        expect(() => {
          assertSecurityPlaybookStepConditions(moved);
        }).not.toThrow();
      }
    }
  });
});

describe("Run This Step on the folded More fields line", () => {
  test("Always is no choice of the reader's: the line names the field alone", () => {
    for (const value of [RUN_ALWAYS, "", undefined, null]) {
      expect(
        describeRunIfFormValue({
          value,
          earlierSteps: [CHECK],
          translator: ENGLISH,
        }),
      ).toBeNull();
    }
  });

  test("a branch reads in the step card's words, never the picker's longer choice", () => {
    expect(
      describeRunIfFormValue({
        value: "after:Found Nothing:check",
        earlierSteps: [CHECK, NOTE],
        translator: ENGLISH,
      }),
    ).toBe("Only if step 1 found nothing known-bad");
    // As the dropdown hands its option back.
    expect(
      describeRunIfFormValue({
        value: { value: "after:Failed:note", label: "x" },
        earlierSteps: [CHECK, NOTE],
        translator: ENGLISH,
      }),
    ).toBe("Only if step 2 failed");
  });

  test("the legacy switch, and a step no longer before it, say so", () => {
    expect(
      describeRunIfFormValue({
        value: RUN_IF_THREAT_INTEL_MATCHED,
        earlierSteps: [CHECK],
        translator: ENGLISH,
      }),
    ).toBe("Only if threat intel matched");
    expect(
      describeRunIfFormValue({
        value: "after:Succeeded:gone",
        earlierSteps: [CHECK],
        translator: ENGLISH,
      }),
    ).toBe("Only after a step that is no longer before it");
  });

  test("German reads the card's own German", () => {
    expect(
      describeRunIfFormValue({
        value: "after:Found:check",
        earlierSteps: [CHECK],
        translator: shippedTranslator("de"),
      }),
    ).toBe("Nur wenn Schritt 1 eine bekannt bösartige Entität gefunden hat");
  });
});

/*
 * A run's card, under a step it skipped because of what an earlier step
 * found: the step card's words in the reader's language, where the run's
 * message is the server's English.
 */
describe("why a run skipped a step", () => {
  const BRANCH: Array<SecurityPlaybookStep> = [
    CHECK,
    SUSPEND,
    step("tasks", SecurityPlaybookActionType.AddCaseNote, {
      runIf: {
        stepId: "check",
        outcome: SecurityPlaybookStepOutcome.FoundNothing,
      },
    }),
    // Waits on the suspension, which never ran when nothing was found.
    step("after-suspend", SecurityPlaybookActionType.AddCaseNote, {
      runIf: {
        stepId: "suspend",
        outcome: SecurityPlaybookStepOutcome.Succeeded,
      },
    }),
  ];

  function rowsOf(
    results: Array<{
      status: SecurityPlaybookStepStatus;
      found?: boolean;
      message?: string;
    }>,
  ): Array<RunStepRow> {
    return getRunStepRows({
      steps: BRANCH as unknown as Array<JSONObject>,
      stepResults: results.map(
        (
          result: {
            status: SecurityPlaybookStepStatus;
            found?: boolean;
            message?: string;
          },
          index: number,
        ): JSONObject => {
          return {
            stepId: BRANCH[index]!.id,
            action: BRANCH[index]!.action,
            ...result,
          } as JSONObject;
        },
      ),
    });
  }

  function reasons(
    rows: Array<RunStepRow>,
    translator: Translator = ENGLISH,
  ): Array<string | undefined> {
    return rows.map((row: RunStepRow): string | undefined => {
      return getSkippedRunIf({ rows, row, translator });
    });
  }

  test("threat intel found nothing: the containment says it runs only on a find, the else ran", () => {
    expect(
      reasons(
        rowsOf([
          { status: SecurityPlaybookStepStatus.Succeeded, found: false },
          {
            status: SecurityPlaybookStepStatus.Skipped,
            message:
              "Skipped: it runs only if step 1 (Check entities against threat intel) found a known-bad entity.",
          },
          { status: SecurityPlaybookStepStatus.Succeeded },
          { status: SecurityPlaybookStepStatus.Skipped },
        ]),
      ),
    ).toEqual([
      undefined,
      "Only if step 1 found a known-bad entity",
      undefined,
      // A step waiting on a step that was skipped is skipped too.
      "Only if step 2 succeeded",
    ]);
  });

  test("threat intel found something: the else says why it did not run", () => {
    expect(
      reasons(
        rowsOf([
          { status: SecurityPlaybookStepStatus.Succeeded, found: true },
          { status: SecurityPlaybookStepStatus.Succeeded },
          { status: SecurityPlaybookStepStatus.Skipped },
          { status: SecurityPlaybookStepStatus.Succeeded },
        ]),
      ),
    ).toEqual([
      undefined,
      undefined,
      "Only if step 1 found nothing known-bad",
      undefined,
    ]);
  });

  test("a step skipped for a reason of its own keeps the run's message", () => {
    /*
     * Threat intel matched, so the suspension's condition held: it was
     * skipped because it had nobody to act on, which its message says.
     */
    expect(
      reasons(
        rowsOf([
          { status: SecurityPlaybookStepStatus.Succeeded, found: true },
          {
            status: SecurityPlaybookStepStatus.Skipped,
            message: "No user to act on.",
          },
          { status: SecurityPlaybookStepStatus.Skipped },
          { status: SecurityPlaybookStepStatus.Skipped },
        ]),
      )[1],
    ).toBeUndefined();

    // A step that waits on nothing has no condition to tell of.
    const plain: Array<RunStepRow> = getRunStepRows({
      steps: [CHECK] as unknown as Array<JSONObject>,
      stepResults: [
        {
          stepId: "check",
          action: SecurityPlaybookActionType.CheckThreatIntel,
          status: SecurityPlaybookStepStatus.Skipped,
        },
      ],
    });

    expect(
      getSkippedRunIf({ rows: plain, row: plain[0]!, translator: ENGLISH }),
    ).toBeUndefined();
  });

  test("reads in the reader's language", () => {
    const rows: Array<RunStepRow> = rowsOf([
      { status: SecurityPlaybookStepStatus.Succeeded, found: false },
      { status: SecurityPlaybookStepStatus.Skipped },
      { status: SecurityPlaybookStepStatus.Succeeded },
      { status: SecurityPlaybookStepStatus.Skipped },
    ]);

    expect(reasons(rows, shippedTranslator("de"))[1]).toBe(
      "Nur wenn Schritt 1 eine bekannt bösartige Entität gefunden hat",
    );
    // Persian writes the step's number in its own digits.
    expect(reasons(rows, shippedTranslator("fa"))[1]).toContain("\u06f1");
  });
});

describe("the dialog's values, with Run This Step", () => {
  test("a new step runs always", () => {
    expect(
      getNewStepFormValues(SecurityPlaybookActionType.AddCaseNote)[RUN_IF_KEY],
    ).toBe(RUN_ALWAYS);
  });

  test("a chosen result becomes the step's condition, and comes back as it was", () => {
    const values: JSONObject = {
      [STEP_ACTION_KEY]: SecurityPlaybookActionType.AddCaseNote,
      note: "Nothing known-bad: check by hand.",
      [RUN_IF_KEY]: "after:Found Nothing:check",
    };
    const saved: SecurityPlaybookStep = formValuesToStep({ values, index: 2 });

    expect(saved.runIf).toEqual({
      stepId: "check",
      outcome: SecurityPlaybookStepOutcome.FoundNothing,
    });
    expect(saved.onlyIfThreatIntelMatched).toBe(false);
    expect(stepToFormValues(saved)[RUN_IF_KEY]).toBe(
      "after:Found Nothing:check",
    );
  });

  test("Always leaves no condition, and clears the legacy switch", () => {
    const saved: SecurityPlaybookStep = formValuesToStep({
      values: {
        [STEP_ACTION_KEY]: SecurityPlaybookActionType.AddCaseNote,
        note: "n",
        [RUN_IF_KEY]: RUN_ALWAYS,
        onlyIfThreatIntelMatched: true,
      },
      index: 0,
    });

    expect(saved.runIf).toBeUndefined();
    expect("runIf" in saved).toBe(false);
    expect(saved.onlyIfThreatIntelMatched).toBe(false);
  });

  test("the legacy choice keeps the legacy switch", () => {
    const saved: SecurityPlaybookStep = formValuesToStep({
      values: {
        [STEP_ACTION_KEY]: SecurityPlaybookActionType.AddCaseNote,
        note: "n",
        [RUN_IF_KEY]: RUN_IF_THREAT_INTEL_MATCHED,
      },
      index: 1,
    });

    expect(saved.onlyIfThreatIntelMatched).toBe(true);
    expect(saved.runIf).toBeUndefined();
  });

  test("the tasks of Add tasks are written one a line, and saved as a list", () => {
    const saved: SecurityPlaybookStep = formValuesToStep({
      values: {
        [STEP_ACTION_KEY]: SecurityPlaybookActionType.AddCaseTasks,
        tasks: "Confirm the sign-in\n\nReset the password\n",
        assigneeUserId: { value: "22222222-2222-4222-8222-222222222222" },
      },
      index: 0,
    });

    expect(saved.config).toEqual({
      tasks: ["Confirm the sign-in", "Reset the password"],
      assigneeUserId: "22222222-2222-4222-8222-222222222222",
    });
    expect(stepToFormValues(saved)["tasks"]).toBe(
      "Confirm the sign-in\nReset the password",
    );
    expect(() => {
      formValuesToStep({
        values: {
          [STEP_ACTION_KEY]: SecurityPlaybookActionType.AddCaseTasks,
          tasks: " ",
        },
        index: 3,
      });
    }).toThrow("Step 4 (Add tasks): write at least one task.");
  });
});
