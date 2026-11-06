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
  SecurityPlaybookConditionMatch,
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
  RUN_IF_CLAUSE_TEMPLATES,
  RUN_IF_FLAG_TEMPLATES,
  RUN_IF_KEY,
  RUN_IF_MATCH_KEY,
  RUN_IF_OPTION_TEMPLATES,
  RUN_IF_SEVERAL_TEMPLATES,
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
  getRunIfMatchFormValue,
  getRunIfOptions,
  getStepDeleteBlock,
  getStepMoveBlock,
  readRunIfFormValues,
  stepToFormValues,
  waitsOnSeveralResults,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepForm";
import {
  RunStepRow,
  RunStepsSummary,
  getRunStepRows,
  getRunStoppedBefore,
  getSkippedRunIf,
  summarizeRunSteps,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookRunStepRows";
import {
  StepNameLookup,
  emptyStepNameLookup,
  summarizeSecurityPlaybookStep,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepSummary";

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

  test("a step opens with what it waits on, the legacy switch, or nothing picked: Always", () => {
    expect(getRunIfFormValue(SUSPEND)).toEqual(["after:Found:check"]);
    expect(
      getRunIfFormValue(
        step("x", SecurityPlaybookActionType.AddCaseNote, {
          onlyIfThreatIntelMatched: true,
        }),
      ),
    ).toEqual([RUN_IF_THREAT_INTEL_MATCHED]);
    expect(getRunIfFormValue(CHECK)).toEqual([]);
  });

  test("a step that waits on several results opens with each, in order, and how it reads them", () => {
    const several: SecurityPlaybookStep = step(
      "several",
      SecurityPlaybookActionType.AddCaseNote,
      {
        runIf: {
          match: SecurityPlaybookConditionMatch.Any,
          conditions: [
            { stepId: "note", outcome: SecurityPlaybookStepOutcome.Failed },
            { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
          ],
        },
      },
    );

    expect(getRunIfFormValue(several)).toEqual([
      "after:Failed:note",
      "after:Found:check",
    ]);
    expect(getRunIfMatchFormValue(several)).toBe(
      SecurityPlaybookConditionMatch.Any,
    );
    // One result, or none, reads as all of them.
    expect(getRunIfMatchFormValue(SUSPEND)).toBe(
      SecurityPlaybookConditionMatch.All,
    );
    expect(getRunIfMatchFormValue(CHECK)).toBe(
      SecurityPlaybookConditionMatch.All,
    );
  });

  test("reads the picks however the form hands them back: a list, one value, an option, or Always", () => {
    expect(
      readRunIfFormValues([
        "after:Found:check",
        { value: "after:Failed:note", label: "x" },
        "after:Found:check",
        "",
        RUN_ALWAYS,
      ]),
    ).toEqual(["after:Found:check", "after:Failed:note"]);
    expect(readRunIfFormValues("after:Found:check")).toEqual([
      "after:Found:check",
    ]);
    for (const value of [RUN_ALWAYS, "", undefined, null, []]) {
      expect(readRunIfFormValues(value)).toEqual([]);
    }
  });

  test("Run When is asked only once two results or more are picked", () => {
    expect(waitsOnSeveralResults({ [RUN_IF_KEY]: [] })).toBe(false);
    expect(waitsOnSeveralResults({ [RUN_IF_KEY]: ["after:Found:check"] })).toBe(
      false,
    );
    expect(
      waitsOnSeveralResults({
        [RUN_IF_KEY]: ["after:Found:check", "after:Failed:note"],
      }),
    ).toBe(true);
    // The same pick twice is one result; the legacy choice is no result of a step.
    expect(
      waitsOnSeveralResults({
        [RUN_IF_KEY]: ["after:Found:check", "after:Found:check"],
      }),
    ).toBe(false);
    expect(
      waitsOnSeveralResults({
        [RUN_IF_KEY]: ["after:Found:check", RUN_IF_THREAT_INTEL_MATCHED],
      }),
    ).toBe(false);
  });
});

describe("Run This Step's choices", () => {
  test("each result of each earlier step, in the order the steps run: picking none is Always", () => {
    const options: Array<RunIfOption> = getRunIfOptions({
      earlierSteps: [CHECK, NOTE],
      translator: ENGLISH,
    });

    expect(labels(options)).toEqual([
      "Only if step 1 (Check entities against threat intel) found a known-bad entity",
      "Only if step 1 (Check entities against threat intel) found nothing known-bad",
      "Only if step 2 (Add a note) succeeded",
      // The note carries on when it fails, so its failure can be waited on.
      "Only if step 2 (Add a note) failed",
    ]);
    expect(options[0]!.value).toBe("after:Found:check");
    expect(
      options.every((option: RunIfOption): boolean => {
        return option.isInPageDirection;
      }),
    ).toBe(true);
  });

  test("the first step has nothing to wait on", () => {
    expect(
      labels(getRunIfOptions({ earlierSteps: [], translator: ENGLISH })),
    ).toEqual([]);
  });

  test("a Stop step before it is no result to wait on: when it runs, nothing after it does", () => {
    expect(
      labels(
        getRunIfOptions({
          earlierSteps: [
            CHECK,
            step("stop", SecurityPlaybookActionType.StopRun, {
              runIf: {
                stepId: "check",
                outcome: SecurityPlaybookStepOutcome.FoundNothing,
              },
            }),
          ],
          translator: ENGLISH,
        }),
      ),
    ).toEqual([
      "Only if step 1 (Check entities against threat intel) found a known-bad entity",
      "Only if step 1 (Check entities against threat intel) found nothing known-bad",
    ]);
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

    expect(Object.keys(RUN_IF_CLAUSE_TEMPLATES).sort()).toEqual(
      [...phrases].sort(),
    );

    for (const phrase of phrases) {
      expect(RUN_IF_OPTION_TEMPLATES[phrase]).toBe(
        `Only if step {{number}} ({{title}}) ${phrase}`,
      );
      expect(RUN_IF_FLAG_TEMPLATES[phrase]).toBe(
        `Only if step {{number}} ${phrase}`,
      );
      // ...and as one clause of a step that waits on several.
      expect(RUN_IF_CLAUSE_TEMPLATES[phrase]).toBe(`step {{number}} ${phrase}`);
    }
  });

  test("every language ships each clause, and each sentence of several, keeping its placeholders", () => {
    const sentences: Array<string> = [
      ...Object.values(RUN_IF_CLAUSE_TEMPLATES),
      ...Object.values(RUN_IF_SEVERAL_TEMPLATES).flatMap(
        (byCount: Readonly<Record<2 | 3, string>>): Array<string> => {
          return [byCount[2], byCount[3]];
        },
      ),
    ];

    for (const language of [
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "nl",
      "da",
      "no",
      "sv",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
    ]) {
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

      for (const sentence of sentences) {
        const translated: unknown = words[sentence];
        const placeholders: (text: string) => Array<string> = (
          text: string,
        ): Array<string> => {
          return (text.match(/\{\{[a-z]+\}\}/g) || []).sort();
        };

        expect([language, sentence, typeof translated]).toEqual([
          language,
          sentence,
          "string",
        ]);
        expect([language, translated === sentence]).toEqual([language, false]);
        expect(placeholders(translated as string)).toEqual(
          placeholders(sentence),
        );
      }
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

  test("a step that waits on several results names each, with and for all of them and or for any one", () => {
    const steps: Array<SecurityPlaybookStep> = [
      CHECK,
      NOTE,
      step("lookup", SecurityPlaybookActionType.LookUpEntityActivity),
    ];
    const waiting: (
      match: SecurityPlaybookConditionMatch,
      count: number,
    ) => SecurityPlaybookStep = (
      match: SecurityPlaybookConditionMatch,
      count: number,
    ): SecurityPlaybookStep => {
      return step("waiting", SecurityPlaybookActionType.AddCaseNote, {
        runIf: {
          match,
          conditions: [
            { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
            { stepId: "note", outcome: SecurityPlaybookStepOutcome.Failed },
            {
              stepId: "lookup",
              outcome: SecurityPlaybookStepOutcome.FoundNothing,
            },
          ].slice(0, count),
        },
      });
    };

    expect(
      describeRunIf({
        step: waiting(SecurityPlaybookConditionMatch.All, 2),
        steps,
        translator: ENGLISH,
      }),
    ).toBe("Only if step 1 found a known-bad entity and step 2 failed");
    expect(
      describeRunIf({
        step: waiting(SecurityPlaybookConditionMatch.Any, 2),
        steps,
        translator: ENGLISH,
      }),
    ).toBe("Only if step 1 found a known-bad entity or step 2 failed");
    expect(
      describeRunIf({
        step: waiting(SecurityPlaybookConditionMatch.All, 3),
        steps,
        translator: ENGLISH,
      }),
    ).toBe(
      "Only if step 1 found a known-bad entity, step 2 failed and step 3 found no activity",
    );
    expect(
      describeRunIf({
        step: waiting(SecurityPlaybookConditionMatch.Any, 3),
        steps,
        translator: ENGLISH,
      }),
    ).toBe(
      "Only if step 1 found a known-bad entity, step 2 failed or step 3 found no activity",
    );
  });

  test("four or five results read as three, the first ones together", () => {
    const steps: Array<SecurityPlaybookStep> = [
      CHECK,
      NOTE,
      step("a", SecurityPlaybookActionType.AddCaseNote),
      step("b", SecurityPlaybookActionType.AddCaseNote),
      step("c", SecurityPlaybookActionType.AddCaseNote),
    ];

    expect(
      describeRunIf({
        step: step("waiting", SecurityPlaybookActionType.AddCaseNote, {
          runIf: {
            match: SecurityPlaybookConditionMatch.All,
            conditions: ["check", "note", "a", "b", "c"].map(
              (stepId: string) => {
                return {
                  stepId,
                  outcome:
                    stepId === "check"
                      ? SecurityPlaybookStepOutcome.FoundNothing
                      : SecurityPlaybookStepOutcome.Succeeded,
                };
              },
            ),
          },
        }),
        steps,
        translator: ENGLISH,
      }),
    ).toBe(
      "Only if step 1 found nothing known-bad, step 2 succeeded, step 3 succeeded, step 4 succeeded and step 5 succeeded",
    );
  });

  test("several results read in the reader's language, the clauses joined as that language joins them", () => {
    const steps: Array<SecurityPlaybookStep> = [CHECK, NOTE];
    const both: SecurityPlaybookStep = step(
      "waiting",
      SecurityPlaybookActionType.AddCaseNote,
      {
        runIf: {
          match: SecurityPlaybookConditionMatch.All,
          conditions: [
            { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
            { stepId: "note", outcome: SecurityPlaybookStepOutcome.Succeeded },
          ],
        },
      },
    );

    expect(
      describeRunIf({
        step: both,
        steps,
        translator: shippedTranslator("de"),
      }),
    ).toBe(
      "Nur wenn Schritt 1 eine bekannt bösartige Entität gefunden hat und Schritt 2 erfolgreich war",
    );
    expect(
      describeRunIf({
        step: both,
        steps,
        translator: shippedTranslator("zh-CN"),
      }),
    ).toBe("仅当步骤 1 发现已知恶意实体且步骤 2 成功时");
    // Persian writes the numbers in its own digits.
    expect(
      describeRunIf({
        step: both,
        steps,
        translator: shippedTranslator("fa"),
      }),
    ).toContain("\u06f2");
  });

  test("a step that waits on several, one of them gone, says so", () => {
    expect(
      describeRunIf({
        step: step("x", SecurityPlaybookActionType.AddCaseNote, {
          runIf: {
            match: SecurityPlaybookConditionMatch.Any,
            conditions: [
              { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
              {
                stepId: "gone",
                outcome: SecurityPlaybookStepOutcome.Succeeded,
              },
            ],
          },
        }),
        steps: [CHECK],
        translator: ENGLISH,
      }),
    ).toBe("Only after a step that is no longer before it");
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

  test("a step that waits on several stays below each of them, and each stays above it", () => {
    const steps: Array<SecurityPlaybookStep> = [
      CHECK,
      NOTE,
      step("both", SecurityPlaybookActionType.AddCaseNote, {
        runIf: {
          match: SecurityPlaybookConditionMatch.Any,
          conditions: [
            { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
            { stepId: "note", outcome: SecurityPlaybookStepOutcome.Failed },
          ],
        },
      }),
    ];

    expect(
      getStepMoveBlock({ steps, index: 2, direction: -1, translator: ENGLISH }),
    ).toBe("This step waits on step 2's result, so it stays below step 2.");
    expect(
      getStepMoveBlock({ steps, index: 1, direction: 1, translator: ENGLISH }),
    ).toBe(
      "Step 3 waits on this step's result. Change Run This Step on step 3 first.",
    );
    expect(getStepDeleteBlock({ steps, index: 0, translator: ENGLISH })).toBe(
      "Step 3 waits on this step's result. Change Run This Step on step 3 first.",
    );
    // The check and the note do not wait on each other.
    expect(
      getStepMoveBlock({ steps, index: 0, direction: 1, translator: ENGLISH }),
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
    for (const value of [RUN_ALWAYS, "", undefined, null, []]) {
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

  test("several picks read as the card says them, with how Run When reads them", () => {
    const picks: Array<string> = ["after:Found:check", "after:Failed:note"];

    expect(
      describeRunIfFormValue({
        value: picks,
        match: SecurityPlaybookConditionMatch.All,
        earlierSteps: [CHECK, NOTE],
        translator: ENGLISH,
      }),
    ).toBe("Only if step 1 found a known-bad entity and step 2 failed");
    expect(
      describeRunIfFormValue({
        value: picks,
        match: SecurityPlaybookConditionMatch.Any,
        earlierSteps: [CHECK, NOTE],
        translator: ENGLISH,
      }),
    ).toBe("Only if step 1 found a known-bad entity or step 2 failed");
    // Run When that is not one of its two choices reads as all of them.
    expect(
      describeRunIfFormValue({
        value: picks,
        match: "Either",
        earlierSteps: [CHECK, NOTE],
        translator: ENGLISH,
      }),
    ).toBe("Only if step 1 found a known-bad entity and step 2 failed");
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

/*
 * STOP THE RUN on a run's card: the Stop step that ended it, the steps it
 * skipped saying where, and the folded line saying the run ended there.
 */
describe("a run a Stop step ended", () => {
  const STOPPING: Array<SecurityPlaybookStep> = [
    CHECK,
    step("stop", SecurityPlaybookActionType.StopRun, {
      config: { reason: "Nothing to contain" },
      runIf: {
        stepId: "check",
        outcome: SecurityPlaybookStepOutcome.FoundNothing,
      },
    }),
    SUSPEND,
    step("after", SecurityPlaybookActionType.AddCaseNote, {
      runIf: {
        stepId: "check",
        outcome: SecurityPlaybookStepOutcome.FoundNothing,
      },
    }),
  ];

  function rowsOf(
    results: Array<{ status: SecurityPlaybookStepStatus; found?: boolean }>,
  ): Array<RunStepRow> {
    return getRunStepRows({
      steps: STOPPING as unknown as Array<JSONObject>,
      stepResults: results.map(
        (
          result: { status: SecurityPlaybookStepStatus; found?: boolean },
          index: number,
        ): JSONObject => {
          return {
            stepId: STOPPING[index]!.id,
            action: STOPPING[index]!.action,
            ...result,
          } as JSONObject;
        },
      ),
    });
  }

  const STOPPED: Array<{
    status: SecurityPlaybookStepStatus;
    found?: boolean;
  }> = [
    { status: SecurityPlaybookStepStatus.Succeeded, found: false },
    { status: SecurityPlaybookStepStatus.Succeeded },
    { status: SecurityPlaybookStepStatus.Skipped },
    { status: SecurityPlaybookStepStatus.Skipped },
  ];

  test("each step after it says where the run stopped, never its own condition", () => {
    const rows: Array<RunStepRow> = rowsOf(STOPPED);

    expect(
      rows.map((row: RunStepRow): number | undefined => {
        return getRunStoppedBefore({ rows, row })?.index;
      }),
    ).toEqual([undefined, undefined, 1, 1]);
    // The suspension waits on a find that never came, and the note's condition held: neither says so.
    expect(
      rows.map((row: RunStepRow): string | undefined => {
        return getSkippedRunIf({ rows, row, translator: ENGLISH });
      }),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });

  test("a Stop step that was skipped stops nothing: the steps after it say their own", () => {
    const rows: Array<RunStepRow> = rowsOf([
      { status: SecurityPlaybookStepStatus.Succeeded, found: true },
      { status: SecurityPlaybookStepStatus.Skipped },
      { status: SecurityPlaybookStepStatus.Succeeded },
      { status: SecurityPlaybookStepStatus.Skipped },
    ]);

    expect(
      rows.map((row: RunStepRow): number | undefined => {
        return getRunStoppedBefore({ rows, row })?.index;
      }),
    ).toEqual([undefined, undefined, undefined, undefined]);
    expect(getSkippedRunIf({ rows, row: rows[1]!, translator: ENGLISH })).toBe(
      "Only if step 1 found nothing known-bad",
    );
    expect(getSkippedRunIf({ rows, row: rows[3]!, translator: ENGLISH })).toBe(
      "Only if step 1 found nothing known-bad",
    );
  });

  test("the folded line says the run ended at the Stop step, done, and no step stopped it", () => {
    const summary: RunStepsSummary = summarizeRunSteps(rowsOf(STOPPED));

    expect(summary.endedAt?.index).toBe(1);
    expect(summary.stoppedAt).toBeUndefined();
    expect(summary.done).toBe(4);
    expect(summary.total).toBe(4);

    // A run no Stop step ended has none.
    expect(
      summarizeRunSteps(
        rowsOf([
          { status: SecurityPlaybookStepStatus.Succeeded, found: true },
          { status: SecurityPlaybookStepStatus.Skipped },
          { status: SecurityPlaybookStepStatus.Succeeded },
          { status: SecurityPlaybookStepStatus.Skipped },
        ]),
      ).endedAt,
    ).toBeUndefined();
  });
});

describe("a Stop step's card", () => {
  const LOOKUP: StepNameLookup = emptyStepNameLookup();

  test("says why it stops, in the playbook's words, or what stopping does", () => {
    expect(
      summarizeSecurityPlaybookStep(
        step("stop", SecurityPlaybookActionType.StopRun, {
          config: { reason: "Nothing known-bad:\n nothing to contain" },
        }),
        LOOKUP,
        ENGLISH,
      ),
    ).toBe("Nothing known-bad: nothing to contain");
    expect(
      summarizeSecurityPlaybookStep(
        step("stop", SecurityPlaybookActionType.StopRun, {
          config: { reason: "r".repeat(120) },
        }),
        LOOKUP,
        ENGLISH,
      ),
    ).toBe(`${"r".repeat(80)}…`);
    expect(
      summarizeSecurityPlaybookStep(
        step("stop", SecurityPlaybookActionType.StopRun),
        LOOKUP,
        ENGLISH,
      ),
    ).toBe("The steps after it do not run");
    expect(
      summarizeSecurityPlaybookStep(
        step("stop", SecurityPlaybookActionType.StopRun),
        LOOKUP,
        shippedTranslator("de"),
      ),
    ).toBe("Die Schritte danach laufen nicht");
  });
});

describe("the dialog's values, with Run This Step", () => {
  test("a new step runs always: nothing picked, and all of them if several come to be", () => {
    const values: JSONObject = getNewStepFormValues(
      SecurityPlaybookActionType.AddCaseNote,
    );

    expect(values[RUN_IF_KEY]).toEqual([]);
    expect(values[RUN_IF_MATCH_KEY]).toBe(SecurityPlaybookConditionMatch.All);
  });

  test("a chosen result becomes the step's condition, stored as one, and comes back as it was", () => {
    for (const picked of [
      ["after:Found Nothing:check"],
      // One value, as an older form holds it.
      "after:Found Nothing:check",
    ]) {
      const values: JSONObject = {
        [STEP_ACTION_KEY]: SecurityPlaybookActionType.AddCaseNote,
        note: "Nothing known-bad: check by hand.",
        [RUN_IF_KEY]: picked,
        [RUN_IF_MATCH_KEY]: SecurityPlaybookConditionMatch.Any,
      };
      const saved: SecurityPlaybookStep = formValuesToStep({
        values,
        index: 2,
      });

      expect(saved.runIf).toEqual({
        stepId: "check",
        outcome: SecurityPlaybookStepOutcome.FoundNothing,
      });
      expect(saved.onlyIfThreatIntelMatched).toBe(false);
      expect(stepToFormValues(saved)[RUN_IF_KEY]).toEqual([
        "after:Found Nothing:check",
      ]);
    }
  });

  test("several chosen results become a group read as Run When says, and come back as they were", () => {
    for (const match of [
      SecurityPlaybookConditionMatch.All,
      SecurityPlaybookConditionMatch.Any,
    ]) {
      const saved: SecurityPlaybookStep = formValuesToStep({
        values: {
          [STEP_ACTION_KEY]: SecurityPlaybookActionType.AddCaseNote,
          note: "n",
          [RUN_IF_KEY]: [
            "after:Found:check",
            { value: "after:Failed:note", label: "x" },
            "after:Found:check",
          ],
          [RUN_IF_MATCH_KEY]: match,
        },
        index: 2,
      });

      expect(saved.runIf).toEqual({
        match,
        conditions: [
          { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
          { stepId: "note", outcome: SecurityPlaybookStepOutcome.Failed },
        ],
      });
      expect(() => {
        assertSecurityPlaybookStepConditions([CHECK, NOTE, saved]);
      }).not.toThrow();

      const reopened: JSONObject = stepToFormValues(saved);

      expect(reopened[RUN_IF_KEY]).toEqual([
        "after:Found:check",
        "after:Failed:note",
      ]);
      expect(reopened[RUN_IF_MATCH_KEY]).toBe(match);
    }
  });

  test("results picked beside the legacy choice take its place", () => {
    const saved: SecurityPlaybookStep = formValuesToStep({
      values: {
        [STEP_ACTION_KEY]: SecurityPlaybookActionType.AddCaseNote,
        note: "n",
        [RUN_IF_KEY]: [RUN_IF_THREAT_INTEL_MATCHED, "after:Found:check"],
      },
      index: 1,
    });

    expect(saved.onlyIfThreatIntelMatched).toBe(false);
    expect(saved.runIf).toEqual({
      stepId: "check",
      outcome: SecurityPlaybookStepOutcome.Found,
    });
  });

  test("a Stop step keeps its reason and never asks for approval or carries on, whatever the form held", () => {
    const saved: SecurityPlaybookStep = formValuesToStep({
      values: {
        [STEP_ACTION_KEY]: SecurityPlaybookActionType.StopRun,
        reason: "  Nothing known-bad: nothing to contain  ",
        requiresApproval: true,
        continueOnFailure: true,
        [RUN_IF_KEY]: ["after:Found Nothing:check"],
      },
      index: 1,
    });

    expect(saved.config).toEqual({
      reason: "Nothing known-bad: nothing to contain",
    });
    expect(saved.requiresApproval).toBe(false);
    expect(saved.continueOnFailure).toBe(false);
    expect(stepToFormValues(saved)["reason"]).toBe(
      "Nothing known-bad: nothing to contain",
    );
    expect(() => {
      formValuesToStep({
        values: {
          [STEP_ACTION_KEY]: SecurityPlaybookActionType.StopRun,
          reason: "r".repeat(501),
        },
        index: 1,
      });
    }).toThrow(
      "Step 2 (Stop the run): say why it stops in at most 500 characters.",
    );
  });

  test("Always leaves no condition, and clears the legacy switch", () => {
    for (const always of [RUN_ALWAYS, []]) {
      const saved: SecurityPlaybookStep = formValuesToStep({
        values: {
          [STEP_ACTION_KEY]: SecurityPlaybookActionType.AddCaseNote,
          note: "n",
          [RUN_IF_KEY]: always,
          onlyIfThreatIntelMatched: true,
        },
        index: 0,
      });

      expect(saved.runIf).toBeUndefined();
      expect("runIf" in saved).toBe(false);
      expect(saved.onlyIfThreatIntelMatched).toBe(false);
    }
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
