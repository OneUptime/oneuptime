import { describe, expect, test } from "@jest/globals";
import {
  DETECTION_RULE_RESPONSE_STEPS_MAX,
  DETECTION_RULE_RESPONSE_STEP_ID_MAX_LENGTH,
  DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH,
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
  DetectionRuleResponseStepsCheck,
  checkDetectionRuleResponseSteps,
  getDetectionRuleResponseStepKey,
  isDetectionRuleResponseStepId,
  makeDetectionRuleResponseStepId,
  readDetectionRuleResponseSteps,
} from "../../../Types/SecurityEvent/DetectionRuleResponseSteps";

/*
 * A detection rule's own response steps (#9621): a short list, each under
 * Confirm, Contain or Fix, each with an id of its own so a step ticked off
 * on a case stays ticked when its words change.
 */

function step(
  overrides: Partial<DetectionRuleResponseStep> = {},
): DetectionRuleResponseStep {
  return {
    id: "page-payments",
    phase: DetectionRuleResponsePhase.Contain,
    text: "Page the payments on-call.",
    ...overrides,
  };
}

describe("reading a rule's steps", () => {
  test("reads each step with a part of the plan, words and an id, in its order", () => {
    expect(
      readDetectionRuleResponseSteps([
        step(),
        step({
          id: "rotate-vault-key",
          phase: DetectionRuleResponsePhase.Fix,
          text: "Rotate the key in Vault.",
        }),
      ]),
    ).toEqual([
      step(),
      {
        id: "rotate-vault-key",
        phase: DetectionRuleResponsePhase.Fix,
        text: "Rotate the key in Vault.",
      },
    ]);
  });

  test("leaves out what does not read, never a reason to drop the rest", () => {
    expect(
      readDetectionRuleResponseSteps([
        "not a step",
        null,
        [],
        step({ phase: "Later" as DetectionRuleResponsePhase }),
        step({ id: "Not An Id" }),
        step({ text: "   " }),
        step({ id: "kept" }),
        step({ id: "kept", text: "The same id again." }),
      ]),
    ).toEqual([step({ id: "kept" })]);
  });

  test("a value that is not a list is no steps", () => {
    expect(readDetectionRuleResponseSteps(null)).toEqual([]);
    expect(readDetectionRuleResponseSteps(undefined)).toEqual([]);
    expect(readDetectionRuleResponseSteps({ steps: [] })).toEqual([]);
  });

  test("keeps a step's words on one line, and at most their bound", () => {
    expect(
      readDetectionRuleResponseSteps([
        step({ text: "  Page\n the   payments\ton-call.  " }),
      ])[0]!.text,
    ).toBe("Page the payments on-call.");

    expect(
      readDetectionRuleResponseSteps([step({ text: "x".repeat(1000) })])[0]!
        .text,
    ).toHaveLength(DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH);
  });

  test("reads at most the bound of steps", () => {
    expect(
      readDetectionRuleResponseSteps(
        Array.from({ length: 15 }, (_: unknown, index: number) => {
          return step({ id: `s${index}` });
        }),
      ),
    ).toHaveLength(DETECTION_RULE_RESPONSE_STEPS_MAX);
  });
});

describe("checking the steps a form or the API saves", () => {
  test("none is no steps, and nothing wrong", () => {
    expect(checkDetectionRuleResponseSteps(null)).toEqual({
      steps: [],
      problem: null,
    });
    expect(checkDetectionRuleResponseSteps(undefined)).toEqual({
      steps: [],
      problem: null,
    });
    expect(checkDetectionRuleResponseSteps([])).toEqual({
      steps: [],
      problem: null,
    });
  });

  test("saves the steps with their words trimmed, leaving out one left empty", () => {
    const check: DetectionRuleResponseStepsCheck =
      checkDetectionRuleResponseSteps([
        step({ text: "  Page the payments on-call.  " }),
        step({ id: "empty", text: "  " }),
      ]);

    expect(check.problem).toBeNull();
    expect(check.steps).toEqual([step()]);
  });

  /*
   * A rule's steps are put in order on its form (#9796): the list is saved
   * in the order sent, every step's id as it was, and read back so, so the
   * plan shows them in that order and a case's ticks stay with them.
   */
  test("saves and reads the steps in the order they are sent, each with its id", () => {
    const reordered: Array<DetectionRuleResponseStep> = [
      step({ id: "rotate-key", text: "Rotate the key in Vault." }),
      step({ id: "lock-account", text: "Lock the account." }),
      step({ id: "page-payments" }),
    ];

    const check: DetectionRuleResponseStepsCheck =
      checkDetectionRuleResponseSteps(reordered);

    expect(check.problem).toBeNull();
    expect(check.steps).toEqual(reordered);
    expect(readDetectionRuleResponseSteps(check.steps)).toEqual(reordered);
    expect(
      check.steps.map((saved: DetectionRuleResponseStep): string => {
        return getDetectionRuleResponseStepKey(saved.id);
      }),
    ).toEqual(["rule:rotate-key", "rule:lock-account", "rule:page-payments"]);
  });

  test("says why it cannot save what is not a list of steps", () => {
    expect(checkDetectionRuleResponseSteps("Page them").problem).toMatch(
      /list of steps/,
    );
    expect(checkDetectionRuleResponseSteps(["Page them"]).problem).toMatch(
      /part of the plan/,
    );
  });

  test("says why it cannot save a step that is too long, has no part of the plan, or no id of its own", () => {
    expect(
      checkDetectionRuleResponseSteps([
        step({
          text: "x".repeat(DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH + 1),
        }),
      ]).problem,
    ).toMatch(/at most 300 characters/);
    expect(
      checkDetectionRuleResponseSteps([
        step({ phase: "Close" as DetectionRuleResponsePhase }),
      ]).problem,
    ).toMatch(/Confirm, Contain or Fix/);
    expect(checkDetectionRuleResponseSteps([step({ id: "" })]).problem).toMatch(
      /id of its own/,
    );
    expect(checkDetectionRuleResponseSteps([step(), step()]).problem).toMatch(
      /id of its own/,
    );
  });

  test("says why it cannot save more steps than a rule carries", () => {
    expect(
      checkDetectionRuleResponseSteps(
        Array.from(
          { length: DETECTION_RULE_RESPONSE_STEPS_MAX + 1 },
          (_: unknown, index: number) => {
            return step({ id: `s${index}` });
          },
        ),
      ).problem,
    ).toMatch(/at most 10 response steps/);
  });

  test("every problem is a sentence that says what to do", () => {
    const problems: Array<string | null> = [
      checkDetectionRuleResponseSteps("x").problem,
      checkDetectionRuleResponseSteps(["x"]).problem,
      checkDetectionRuleResponseSteps([step({ text: "x".repeat(400) })])
        .problem,
      checkDetectionRuleResponseSteps([
        step({ phase: "x" as DetectionRuleResponsePhase }),
      ]).problem,
      checkDetectionRuleResponseSteps([step({ id: "X" })]).problem,
    ];

    for (const problem of problems) {
      expect(problem).toMatch(/^[A-Z].*\.$/);
    }
  });
});

describe("a step's id and key", () => {
  test("a new step's id is one of its own, and an id", () => {
    const used: Array<string> = [];

    for (let index: number = 0; index < 50; index++) {
      const id: string = makeDetectionRuleResponseStepId(used);

      expect(isDetectionRuleResponseStepId(id)).toBe(true);
      expect(used).not.toContain(id);
      used.push(id);
    }
  });

  test("an id is lower-case letters, digits and dashes, short", () => {
    expect(isDetectionRuleResponseStepId("rotate-vault-key")).toBe(true);
    expect(isDetectionRuleResponseStepId("s1a2b3c4d")).toBe(true);
    expect(isDetectionRuleResponseStepId("-leading-dash")).toBe(false);
    expect(isDetectionRuleResponseStepId("Upper")).toBe(false);
    expect(isDetectionRuleResponseStepId("with space")).toBe(false);
    expect(
      isDetectionRuleResponseStepId(
        "a".repeat(DETECTION_RULE_RESPONSE_STEP_ID_MAX_LENGTH + 1),
      ),
    ).toBe(false);
    expect(isDetectionRuleResponseStepId(7)).toBe(false);
  });

  test("a step's key fits what a task keeps, and is the same whatever its words", () => {
    const key: string = getDetectionRuleResponseStepKey(
      "a".repeat(DETECTION_RULE_RESPONSE_STEP_ID_MAX_LENGTH),
    );

    expect(key.length).toBeLessThanOrEqual(100);
    expect(getDetectionRuleResponseStepKey("page-payments")).toBe(
      "rule:page-payments",
    );
  });
});
