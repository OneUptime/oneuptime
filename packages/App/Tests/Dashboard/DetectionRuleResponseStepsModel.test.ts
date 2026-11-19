import { describe, expect, test } from "@jest/globals";
import {
  DETECTION_RULE_RESPONSE_STEPS_MAX,
  DETECTION_RULE_RESPONSE_STEP_TEXT_MAX_LENGTH,
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
  getDetectionRuleResponseStepKey,
  isDetectionRuleResponseStepId,
} from "Common/Types/SecurityEvent/DetectionRuleResponseSteps";
import {
  getDetectionRuleLibraryIdsWithSteps,
  getDetectionRuleLibraryResponseSteps,
} from "Common/Types/SecurityEvent/DetectionRuleLibraryResponseSteps";
import {
  NEW_RESPONSE_STEP_PHASE,
  ResponseStepMove,
  addResponseStep,
  canAddResponseStep,
  canMoveResponseStep,
  changeResponseStep,
  getResponseStepsByPart,
  getResponseStepsFoldedCount,
  getResponseStepsInPlanOrder,
  getResponseStepsShown,
  moveResponseStep,
  moveResponseStepInPart,
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

/*
 * Putting a rule's steps in order (#9796): a step moves among its part's
 * steps - the order a case's plan shows them in - and keeps its id, so the
 * plan's key for it, `rule:<id>`, and a case's tick stay with it.
 */
describe("putting the steps in order", () => {
  const CHECK: DetectionRuleResponseStep = {
    id: "check-audit-log",
    phase: DetectionRuleResponsePhase.Confirm,
    text: "Check the admin audit log.",
  };
  const LOCK: DetectionRuleResponseStep = {
    id: "lock-account",
    phase: DetectionRuleResponsePhase.Contain,
    text: "Lock the account.",
  };
  const NOTIFY: DetectionRuleResponseStep = {
    id: "notify-owner",
    phase: DetectionRuleResponsePhase.Contain,
    text: "Tell the service's owner.",
  };

  // Written out of the plan's order: a Contain step first, a Fix one mid-way.
  const WRITTEN: Array<DetectionRuleResponseStep> = [
    PAGE,
    CHECK,
    ROTATE,
    LOCK,
    NOTIFY,
  ];
  // As the plan reads them: Confirm, then Contain in the order written, then Fix.
  const PLAN: Array<DetectionRuleResponseStep> = [
    CHECK,
    PAGE,
    LOCK,
    NOTIFY,
    ROTATE,
  ];

  function idsOf(steps: Array<DetectionRuleResponseStep>): Array<string> {
    return steps.map((step: DetectionRuleResponseStep): string => {
      return step.id;
    });
  }

  test("the steps as the plan reads them: by part, each part's in the order written", () => {
    expect(getResponseStepsInPlanOrder(WRITTEN)).toEqual(PLAN);
    // Already so: as it was.
    expect(getResponseStepsInPlanOrder(PLAN)).toEqual(PLAN);
    expect(getResponseStepsInPlanOrder([])).toEqual([]);
  });

  test("a step moves only among its part's steps: never past a step of another part", () => {
    // Page the payments on-call: first of Contain it.
    expect(canMoveResponseStep(PLAN, 1, ResponseStepMove.Up)).toBe(false);
    expect(canMoveResponseStep(PLAN, 1, ResponseStepMove.Down)).toBe(true);
    // Tell the service's owner: last of Contain it.
    expect(canMoveResponseStep(PLAN, 3, ResponseStepMove.Up)).toBe(true);
    expect(canMoveResponseStep(PLAN, 3, ResponseStepMove.Down)).toBe(false);
    // The only step of its part, and places that are no step.
    for (const index of [0, 4]) {
      expect(canMoveResponseStep(PLAN, index, ResponseStepMove.Up)).toBe(false);
      expect(canMoveResponseStep(PLAN, index, ResponseStepMove.Down)).toBe(
        false,
      );
    }
    expect(canMoveResponseStep(PLAN, -1, ResponseStepMove.Down)).toBe(false);
    expect(canMoveResponseStep(PLAN, 9, ResponseStepMove.Up)).toBe(false);
  });

  test("Move Up and Move Down swap a step with its neighbour, the rest as they were", () => {
    expect(moveResponseStep(PLAN, 1, ResponseStepMove.Down)).toEqual([
      CHECK,
      LOCK,
      PAGE,
      NOTIFY,
      ROTATE,
    ]);
    expect(moveResponseStep(PLAN, 3, ResponseStepMove.Up)).toEqual([
      CHECK,
      PAGE,
      NOTIFY,
      LOCK,
      ROTATE,
    ]);
  });

  test("a move it cannot make leaves the steps in the plan's order, as they were", () => {
    expect(moveResponseStep(PLAN, 1, ResponseStepMove.Up)).toEqual(PLAN);
    expect(moveResponseStep(PLAN, 0, ResponseStepMove.Down)).toEqual(PLAN);
    expect(moveResponseStep(WRITTEN, 4, ResponseStepMove.Down)).toEqual(PLAN);
  });

  test("a step's place is read in the plan's order, however the steps were written", () => {
    // In the plan's order, the second step is Page the payments on-call.
    expect(moveResponseStep(WRITTEN, 1, ResponseStepMove.Down)).toEqual([
      CHECK,
      LOCK,
      PAGE,
      NOTIFY,
      ROTATE,
    ]);
  });

  test("dragged, a step lands where it was dropped among its part's steps, the others stepping aside", () => {
    const contain: DetectionRuleResponsePhase =
      DetectionRuleResponsePhase.Contain;

    expect(moveResponseStepInPart(PLAN, contain, 2, 0)).toEqual([
      CHECK,
      NOTIFY,
      PAGE,
      LOCK,
      ROTATE,
    ]);
    expect(moveResponseStepInPart(PLAN, contain, 0, 2)).toEqual([
      CHECK,
      LOCK,
      NOTIFY,
      PAGE,
      ROTATE,
    ]);
    // Dropped where it was picked up: as it was.
    expect(moveResponseStepInPart(PLAN, contain, 1, 1)).toEqual(PLAN);
  });

  test("a drag outside its part, or of a part with no steps, leaves the steps as they were", () => {
    expect(
      moveResponseStepInPart(PLAN, DetectionRuleResponsePhase.Contain, 0, 3),
    ).toEqual(PLAN);
    expect(
      moveResponseStepInPart(PLAN, DetectionRuleResponsePhase.Contain, -1, 0),
    ).toEqual(PLAN);
    expect(
      moveResponseStepInPart(
        [PAGE, ROTATE],
        DetectionRuleResponsePhase.Confirm,
        0,
        0,
      ),
    ).toEqual([PAGE, ROTATE]);
  });

  test("every move keeps every step whole - its id, its part, its words - so a case keeps its ticks", () => {
    let steps: Array<DetectionRuleResponseStep> = PLAN;

    steps = moveResponseStep(steps, 1, ResponseStepMove.Down);
    steps = moveResponseStep(steps, 2, ResponseStepMove.Down);
    steps = moveResponseStepInPart(
      steps,
      DetectionRuleResponsePhase.Contain,
      2,
      0,
    );

    expect(idsOf(steps)).toEqual(idsOf([CHECK, PAGE, LOCK, NOTIFY, ROTATE]));
    expect([...steps].sort(byId)).toEqual([...PLAN].sort(byId));
    expect(
      steps.map((step: DetectionRuleResponseStep): string => {
        return getDetectionRuleResponseStepKey(step.id);
      }),
    ).toEqual([
      "rule:check-audit-log",
      "rule:page-payments",
      "rule:lock-account",
      "rule:notify-owner",
      "rule:rotate-key",
    ]);
  });

  test("a step put under another part lands at the end of it nearest where it was", () => {
    // Page the payments on-call, first of Contain it, put under Confirm it is real: its last.
    expect(
      getResponseStepsInPlanOrder(
        changeResponseStep(PLAN, 1, {
          phase: DetectionRuleResponsePhase.Confirm,
        }),
      ),
    ).toEqual([
      CHECK,
      { ...PAGE, phase: DetectionRuleResponsePhase.Confirm },
      LOCK,
      NOTIFY,
      ROTATE,
    ]);
    // Lock the account, put under Fix what let it happen: its first.
    expect(
      getResponseStepsInPlanOrder(
        changeResponseStep(PLAN, 2, { phase: DetectionRuleResponsePhase.Fix }),
      ),
    ).toEqual([
      CHECK,
      PAGE,
      NOTIFY,
      { ...LOCK, phase: DetectionRuleResponsePhase.Fix },
      ROTATE,
    ]);
  });

  test("a library rule's steps read in the library's order within each part, for every rule the library has", () => {
    for (const libraryRuleId of getDetectionRuleLibraryIdsWithSteps()) {
      const library: Array<DetectionRuleResponseStep> =
        getDetectionRuleLibraryResponseSteps(libraryRuleId);
      const shown: Array<DetectionRuleResponseStep> =
        getResponseStepsInPlanOrder(library);

      expect(shown).toHaveLength(library.length);

      for (const phase of [
        DetectionRuleResponsePhase.Confirm,
        DetectionRuleResponsePhase.Contain,
        DetectionRuleResponsePhase.Fix,
      ]) {
        const inPart: (step: DetectionRuleResponseStep) => boolean = (
          step: DetectionRuleResponseStep,
        ): boolean => {
          return step.phase === phase;
        };

        // The order the case's plan shows them in: the library's own.
        expect(idsOf(shown.filter(inPart))).toEqual(
          idsOf(library.filter(inPart)),
        );
      }
    }
  });

  test("a library rule's steps, moved, keep the library's fixed ids", () => {
    const libraryRuleId: string = getDetectionRuleLibraryIdsWithSteps().find(
      (id: string): boolean => {
        const steps: Array<DetectionRuleResponseStep> =
          getResponseStepsInPlanOrder(getDetectionRuleLibraryResponseSteps(id));

        return steps.some(
          (_step: DetectionRuleResponseStep, place: number): boolean => {
            return canMoveResponseStep(steps, place, ResponseStepMove.Down);
          },
        );
      },
    )!;
    const shown: Array<DetectionRuleResponseStep> = getResponseStepsShown({
      value: null,
      sigmaRuleYaml: `title: From the library\nid: ${libraryRuleId}\n`,
    }).steps;
    const ordered: Array<DetectionRuleResponseStep> =
      getResponseStepsInPlanOrder(shown);
    const index: number = ordered.findIndex(
      (_step: DetectionRuleResponseStep, place: number): boolean => {
        return canMoveResponseStep(ordered, place, ResponseStepMove.Down);
      },
    );
    const moved: Array<DetectionRuleResponseStep> = moveResponseStep(
      shown,
      index,
      ResponseStepMove.Down,
    );

    expect(idsOf(moved)).not.toEqual(idsOf(ordered));
    expect(idsOf(moved).sort()).toEqual(idsOf(ordered).sort());
    expect(readEditedResponseSteps(moved)).toEqual(moved);
  });
});

function byId(
  a: DetectionRuleResponseStep,
  b: DetectionRuleResponseStep,
): number {
  return a.id.localeCompare(b.id);
}
