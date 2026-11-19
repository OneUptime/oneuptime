import { describe, expect, test } from "@jest/globals";
import {
  DETECTION_RULE_RESPONSE_STEPS_MAX,
  DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH,
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
  isDetectionRuleResponseStepId,
} from "Common/Types/SecurityEvent/DetectionRuleResponseSteps";
import { getDetectionRuleLibraryResponseSteps } from "Common/Types/SecurityEvent/DetectionRuleLibraryResponseSteps";
import {
  NEW_RESPONSE_STEP_PHASE,
  addResponseStep,
  canAddResponseStep,
  changeResponseStep,
  getResponseStepsByPart,
  getResponseStepsFoldedCount,
  getResponseStepsShown,
  readEditedResponseSteps,
  removeResponseStep,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/ResponseSteps/DetectionRuleResponseStepsModel";
import {
  RESPONSE_STEPS_FULL,
  RESPONSE_STEP_ADD,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/ResponseSteps/DetectionRuleResponseStepsCopy";

/*
 * A detection rule's response steps as its form edits them (#9621): its
 * own, or - none written - the steps its library rule comes with, which
 * become its own once one is changed. A step keeps its id through every
 * edit, so a step ticked off on a case stays ticked when its words change.
 */

const BRUTE_FORCE_ID: string = "acf2a37e-301a-46de-87c7-d4343f3a8445";
const BRUTE_FORCE_YAML: string = `title: Brute force from one IP address\nid: ${BRUTE_FORCE_ID}\nlogsource:\n  category: authentication\n`;

const PAGE: DetectionRuleResponseStep = {
  id: "page-payments",
  phase: DetectionRuleResponsePhase.Contain,
  text: "Page the payments on-call.",
};
const ROTATE: DetectionRuleResponseStep = {
  id: "rotate-key",
  phase: DetectionRuleResponsePhase.Fix,
  text: "Rotate the key in Vault.",
};

describe("what the field shows", () => {
  test("the rule's own steps, as written", () => {
    expect(
      getResponseStepsShown({
        value: [PAGE, ROTATE],
        sigmaRuleYaml: BRUTE_FORCE_YAML,
      }),
    ).toEqual({ steps: [PAGE, ROTATE], isFromLibrary: false });
  });

  test("an empty list is the author's none: the library's are not shown over it", () => {
    expect(
      getResponseStepsShown({ value: [], sigmaRuleYaml: BRUTE_FORCE_YAML }),
    ).toEqual({ steps: [], isFromLibrary: false });
  });

  test("none written: the steps its library rule comes with", () => {
    for (const value of [null, undefined]) {
      expect(
        getResponseStepsShown({ value, sigmaRuleYaml: BRUTE_FORCE_YAML }),
      ).toEqual({
        steps: getDetectionRuleLibraryResponseSteps(BRUTE_FORCE_ID),
        isFromLibrary: true,
      });
    }
  });

  test("none written on a rule of the project's own: none", () => {
    expect(
      getResponseStepsShown({
        value: null,
        sigmaRuleYaml: "title: Our own rule\nlogsource:\n  category: x\n",
      }),
    ).toEqual({ steps: [], isFromLibrary: false });
    expect(
      getResponseStepsShown({ value: null, sigmaRuleYaml: undefined }),
    ).toEqual({ steps: [], isFromLibrary: false });
  });

  test("a step being written keeps its words as typed, even none; anything not a step is left out", () => {
    expect(
      readEditedResponseSteps([
        { id: "new-one", phase: "Confirm", text: "" },
        { id: "typing", phase: "Fix", text: "Rotate " },
        { id: "Bad Id", phase: "Fix", text: "x" },
        { id: "no-part", phase: "Later", text: "x" },
        { id: "typing", phase: "Fix", text: "twice" },
        "a step",
        null,
      ]),
    ).toEqual([
      { id: "new-one", phase: "Confirm", text: "" },
      { id: "typing", phase: "Fix", text: "Rotate " },
    ]);
    expect(
      readEditedResponseSteps([
        { id: "long", phase: "Fix", text: "x".repeat(400) },
      ])[0]!.text,
    ).toHaveLength(DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH);
    expect(readEditedResponseSteps("steps")).toEqual([]);
  });
});

describe("editing the steps", () => {
  test("Add Step puts one more line in, under Contain it, with an id of its own", () => {
    const steps: Array<DetectionRuleResponseStep> = addResponseStep([PAGE]);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toBe(PAGE);
    expect(steps[1]!.phase).toBe(NEW_RESPONSE_STEP_PHASE);
    expect(steps[1]!.phase).toBe(DetectionRuleResponsePhase.Contain);
    expect(steps[1]!.text).toBe("");
    expect(isDetectionRuleResponseStepId(steps[1]!.id)).toBe(true);
    expect(steps[1]!.id).not.toBe(PAGE.id);
  });

  test("a rule carries at most ten steps: Add Step adds no eleventh", () => {
    let steps: Array<DetectionRuleResponseStep> = [];

    for (let index: number = 0; index < 12; index++) {
      steps = addResponseStep(steps);
    }

    expect(steps).toHaveLength(DETECTION_RULE_RESPONSE_STEPS_MAX);
    expect(canAddResponseStep(steps)).toBe(false);
    expect(
      new Set(
        steps.map((step: DetectionRuleResponseStep): string => {
          return step.id;
        }),
      ).size,
    ).toBe(DETECTION_RULE_RESPONSE_STEPS_MAX);
  });

  test("changing a step's part or words keeps its id, and the other steps as they were", () => {
    const moved: Array<DetectionRuleResponseStep> = changeResponseStep(
      [PAGE, ROTATE],
      0,
      { phase: DetectionRuleResponsePhase.Confirm },
    );

    expect(moved).toEqual([
      { ...PAGE, phase: DetectionRuleResponsePhase.Confirm },
      ROTATE,
    ]);

    const reworded: Array<DetectionRuleResponseStep> = changeResponseStep(
      moved,
      1,
      { text: "Rotate the key in Vault, then redeploy." },
    );

    expect(reworded[1]).toEqual({
      ...ROTATE,
      text: "Rotate the key in Vault, then redeploy.",
    });
    expect(reworded[1]!.id).toBe(ROTATE.id);
  });

  test("a line's bin takes just that step out", () => {
    expect(removeResponseStep([PAGE, ROTATE], 0)).toEqual([ROTATE]);
    expect(removeResponseStep([PAGE], 0)).toEqual([]);
  });
});

describe("reading the steps", () => {
  test("by part of the plan, in the plan's order, leaving out a part with none", () => {
    expect(getResponseStepsByPart([ROTATE, PAGE])).toEqual([
      { phase: DetectionRuleResponsePhase.Contain, steps: [PAGE] },
      { phase: DetectionRuleResponsePhase.Fix, steps: [ROTATE] },
    ]);
  });

  test("More fields, folded, counts the rule's own steps - none written says nothing", () => {
    expect(getResponseStepsFoldedCount([PAGE, ROTATE])).toBe(2);
    expect(getResponseStepsFoldedCount([])).toBe(0);
    expect(getResponseStepsFoldedCount(null)).toBeNull();
    expect(getResponseStepsFoldedCount(undefined)).toBeNull();
  });

  test("the words: a Title Case button, and a plural that counts", () => {
    expect(RESPONSE_STEP_ADD).toBe("Add Step");
    expect(RESPONSE_STEPS_FULL.one).toContain("{{count}}");
    expect(RESPONSE_STEPS_FULL.other).toContain("{{count}}");
  });
});
