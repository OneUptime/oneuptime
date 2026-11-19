import { describe, expect, test } from "@jest/globals";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  findDetectionRuleLibraryEntryForYaml,
  getDetectionRuleLibraryIdsWithSteps,
  getDetectionRuleLibraryResponseSteps,
  getDetectionRuleLibraryResponseStepsForYaml,
  getDetectionRuleLibraryStepCatalog,
  getDetectionRuleLibraryStepIdsNamed,
} from "../../../Types/SecurityEvent/DetectionRuleLibraryResponseSteps";
import {
  DETECTION_RULE_RESPONSE_STEPS_MAX,
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
  DetectionRuleResponseStepsCheck,
  checkDetectionRuleResponseSteps,
} from "../../../Types/SecurityEvent/DetectionRuleResponseSteps";

/*
 * Every Rule Library rule comes with response steps (#9621): what a
 * responder checks, contains and fixes for that kind of attack. Each set
 * must save as a rule's own would, and every rule must say how to fix what
 * let it happen - a rule's Fix steps take the place of the plan's general
 * ones.
 */

describe("the Rule Library's response steps", () => {
  test("every library rule has steps, and every rule with steps is a library rule", () => {
    const libraryIds: Array<string> = DETECTION_RULE_LIBRARY.map(
      (entry: DetectionRuleLibraryEntry): string => {
        return entry.id;
      },
    );

    for (const entry of DETECTION_RULE_LIBRARY) {
      expect({
        rule: entry.title,
        steps: getDetectionRuleLibraryResponseSteps(entry.id).length,
      }).toEqual({ rule: entry.title, steps: expect.any(Number) });
      expect(
        getDetectionRuleLibraryResponseSteps(entry.id).length,
      ).toBeGreaterThan(0);
    }

    for (const id of getDetectionRuleLibraryIdsWithSteps()) {
      expect(libraryIds).toContain(id);
    }
  });

  test("each rule's steps save as a rule's own: ids of their own, a part of the plan, words within the bound", () => {
    for (const entry of DETECTION_RULE_LIBRARY) {
      const steps: Array<DetectionRuleResponseStep> =
        getDetectionRuleLibraryResponseSteps(entry.id);
      const check: DetectionRuleResponseStepsCheck =
        checkDetectionRuleResponseSteps(steps);

      expect({ rule: entry.title, problem: check.problem }).toEqual({
        rule: entry.title,
        problem: null,
      });
      expect(check.steps).toEqual(steps);
      expect(steps.length).toBeLessThanOrEqual(
        DETECTION_RULE_RESPONSE_STEPS_MAX,
      );
    }
  });

  test("every rule says how to fix what let it happen", () => {
    for (const entry of DETECTION_RULE_LIBRARY) {
      expect({
        rule: entry.title,
        hasFix: getDetectionRuleLibraryResponseSteps(entry.id).some(
          (step: DetectionRuleResponseStep): boolean => {
            return step.phase === DetectionRuleResponsePhase.Fix;
          },
        ),
      }).toEqual({ rule: entry.title, hasFix: true });
    }
  });

  test("every step a rule names is in the catalog, and every step in the catalog is used", () => {
    const catalog: Array<string> = getDetectionRuleLibraryStepCatalog().map(
      (step: DetectionRuleResponseStep): string => {
        return step.id;
      },
    );
    const used: Set<string> = new Set<string>();

    for (const entry of DETECTION_RULE_LIBRARY) {
      for (const id of getDetectionRuleLibraryStepIdsNamed(entry.id)) {
        expect({
          rule: entry.title,
          id,
          inCatalog: catalog.includes(id),
        }).toEqual({ rule: entry.title, id, inCatalog: true });
        used.add(id);
      }
    }

    expect(
      catalog.filter((id: string): boolean => {
        return !used.has(id);
      }),
    ).toEqual([]);
  });

  test("each step is a sentence that tells the responder what to do", () => {
    for (const step of getDetectionRuleLibraryStepCatalog()) {
      expect({ id: step.id, text: step.text }).toEqual({
        id: step.id,
        text: expect.stringMatching(/^[A-Z0-9][^\n]*[.]$/),
      });
    }
  });

  test("a step shared by several rules keeps one id, so a case they are both on ticks it once", () => {
    const keys: Map<string, string> = new Map();

    for (const entry of DETECTION_RULE_LIBRARY) {
      for (const step of getDetectionRuleLibraryResponseSteps(entry.id)) {
        const known: string | undefined = keys.get(step.id);

        if (known) {
          expect(`${step.phase}: ${step.text}`).toBe(known);
        }

        keys.set(step.id, `${step.phase}: ${step.text}`);
      }
    }
  });

  test("each rule's steps are its own copy", () => {
    const entry: DetectionRuleLibraryEntry = DETECTION_RULE_LIBRARY[0]!;
    const first: Array<DetectionRuleResponseStep> =
      getDetectionRuleLibraryResponseSteps(entry.id);

    first[0]!.text = "Changed by one rule.";
    first.push({
      id: "added",
      phase: DetectionRuleResponsePhase.Fix,
      text: "Added.",
    });

    expect(getDetectionRuleLibraryResponseSteps(entry.id)[0]!.text).not.toBe(
      "Changed by one rule.",
    );
    expect(getDetectionRuleLibraryResponseSteps(entry.id)).toHaveLength(
      first.length - 1,
    );
  });

  test("an id the library has no rule for has no steps", () => {
    expect(getDetectionRuleLibraryResponseSteps("not-a-library-id")).toEqual(
      [],
    );
  });
});

describe("a project's rule added from the library", () => {
  test("is found by the Sigma id its YAML carries, however the team renamed it", () => {
    const entry: DetectionRuleLibraryEntry = DETECTION_RULE_LIBRARY.find(
      (candidate: DetectionRuleLibraryEntry): boolean => {
        return candidate.title === "Password spraying";
      },
    )!;

    expect(findDetectionRuleLibraryEntryForYaml(entry.sigmaRuleYaml)).toBe(
      entry,
    );
    expect(
      getDetectionRuleLibraryResponseStepsForYaml(entry.sigmaRuleYaml),
    ).toEqual(getDetectionRuleLibraryResponseSteps(entry.id));
  });

  test("a rule of the project's own has no library steps", () => {
    const yaml: string = `title: Our own rule
id: 0d7a1f2e-0000-4000-8000-000000000001
detection:
  selection:
    className: Authentication
  condition: selection
`;

    expect(findDetectionRuleLibraryEntryForYaml(yaml)).toBeNull();
    expect(getDetectionRuleLibraryResponseStepsForYaml(yaml)).toEqual([]);
    expect(getDetectionRuleLibraryResponseStepsForYaml("")).toEqual([]);
    expect(getDetectionRuleLibraryResponseStepsForYaml(undefined)).toEqual([]);
  });
});
