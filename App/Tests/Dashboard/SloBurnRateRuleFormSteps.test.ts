/*
 * Common/UI/Config computes every URL constant at import time from
 * `window?.process?.env`, and a node test environment has no `window` BINDING
 * at all — so the optional chain does not save it, it throws a ReferenceError
 * and the whole suite fails to load. The same stub the sibling
 * SloBurnRateRuleOutputs suite carries, for the same reason: this file imports
 * a page, so its module graph reaches Config.
 */
jest.mock("Common/UI/Config", (): unknown => {
  (globalThis as unknown as { window: unknown }).window = {
    process: { env: {} },
  };

  return jest.requireActual("Common/UI/Config");
});

import { describe, expect, test } from "@jest/globals";
import {
  BURN_RATE_RULE_FORM_FIELDS,
  BURN_RATE_RULE_FORM_STEPS,
  validateBurnRateOutputs,
  willCreateAlert,
  willDeclareIncident,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/View/BurnRateRules";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";

/*
 * The create form is a wizard now, and every way of getting a wizard wrong is
 * silent. A field whose stepId matches no step is on no step, so it never
 * renders — it does not fail to compile and it does not throw. A routing step
 * whose showIf disagrees with the toggle that gates it either hides a step the
 * user needs or shows one for an output that is off. And the validator that
 * forbids an output-less rule can only see the fields of the step being left
 * (Validation.validate skips every field whose stepId is not the current one),
 * so the two toggles have to share a step or the rule cannot be enforced at
 * all.
 *
 * None of that is reachable by rendering under the App project's node
 * environment, so the page exports the two arrays and this suite asserts on
 * the real values rather than on source text.
 */

type FieldOf = ModelField<ServiceLevelObjectiveBurnRateRule>;
type StepOf = FormStep<ServiceLevelObjectiveBurnRateRule>;

function stepIds(): Array<string> {
  return BURN_RATE_RULE_FORM_STEPS.map((step: StepOf): string => {
    return step.id;
  });
}

function stepById(id: string): StepOf {
  const step: StepOf | undefined = BURN_RATE_RULE_FORM_STEPS.find(
    (candidate: StepOf): boolean => {
      return candidate.id === id;
    },
  );

  if (!step) {
    throw new Error(`No form step declared with id "${id}".`);
  }

  return step;
}

/*
 * ModelField's `field` is a one-key select object, which is how the form names
 * the column. Reading the key back is the only way to say "the shouldCreateAlert
 * field" without depending on array positions that a reorder would shuffle.
 */
function columnOf(field: FieldOf): string {
  const keys: Array<string> = Object.keys(
    field.field as unknown as Record<string, unknown>,
  );

  if (keys.length !== 1) {
    throw new Error(
      `Expected exactly one column per form field, got ${JSON.stringify(keys)}.`,
    );
  }

  return keys[0]!;
}

function fieldFor(column: string): FieldOf {
  const field: FieldOf | undefined = BURN_RATE_RULE_FORM_FIELDS.find(
    (candidate: FieldOf): boolean => {
      return columnOf(candidate) === column;
    },
  );

  if (!field) {
    throw new Error(`No form field for column "${column}".`);
  }

  return field;
}

function columnsOnStep(stepId: string): Array<string> {
  return BURN_RATE_RULE_FORM_FIELDS.filter((field: FieldOf): boolean => {
    return field.stepId === stepId;
  }).map(columnOf);
}

describe("the burn rate rule form steps", () => {
  test("walk the four questions a rule answers, in order", () => {
    expect(stepIds()).toEqual([
      "rule",
      "burn-window",
      "declares",
      "alert-routing",
      "incident-routing",
    ]);

    expect(
      BURN_RATE_RULE_FORM_STEPS.map((step: StepOf): string => {
        return step.title;
      }),
    ).toEqual([
      "Rule",
      "Burn Window",
      "What It Declares",
      "Alert Routing",
      "Incident Routing",
    ]);
  });

  test("every step id is unique", () => {
    expect(new Set(stepIds()).size).toBe(stepIds().length);
  });

  test("every field is assigned to a step that exists", () => {
    const declared: Set<string> = new Set(stepIds());

    for (const field of BURN_RATE_RULE_FORM_FIELDS) {
      /*
       * A field with no stepId, or one naming a step that is not declared,
       * renders on no step at all. It is not a compile error and not a runtime
       * error — the field simply vanishes from the form.
       */
      expect(field.stepId).toBeTruthy();
      expect(declared.has(field.stepId!)).toBe(true);
    }
  });

  test("every step has at least one field", () => {
    for (const id of stepIds()) {
      expect(columnsOnStep(id).length).toBeGreaterThan(0);
    }
  });

  test("each step carries the fields that answer its question", () => {
    expect(columnsOnStep("rule")).toEqual(["name", "isEnabled"]);

    expect(columnsOnStep("burn-window")).toEqual([
      "burnRateThreshold",
      "longWindowInMinutes",
      "shortWindowInMinutes",
      "refireSuppressionMinutes",
    ]);

    expect(columnsOnStep("declares")).toEqual([
      "shouldCreateAlert",
      "shouldCreateIncident",
    ]);

    expect(columnsOnStep("alert-routing")).toEqual([
      "alertSeverity",
      "onCallDutyPolicies",
    ]);

    expect(columnsOnStep("incident-routing")).toEqual([
      "incidentSeverity",
      "incidentOnCallDutyPolicies",
    ]);
  });

  /*
   * The load-bearing one. Validation runs per step, so a validator needs every
   * value it compares on the step it is attached to. Split the two toggles
   * across steps and "turn the alert off, then turn the incident on" fails on
   * the way out of the first step — before the user can reach the toggle that
   * would have made the rule legal.
   */
  test("both output toggles live on one step", () => {
    const alertToggle: FieldOf = fieldFor("shouldCreateAlert");
    const incidentToggle: FieldOf = fieldFor("shouldCreateIncident");

    expect(alertToggle.stepId).toBe("declares");
    expect(incidentToggle.stepId).toBe(alertToggle.stepId);
  });

  /*
   * On the ALERT toggle, and only there. A customValidation is handed the whole
   * form's values, so one attachment covers both flags — but Validation.validate
   * only runs a field's validators when that field HAS a value (`name in
   * entries`). shouldCreateAlert always does, because its defaultValue is
   * written into the values on open. shouldCreateIncident has no default, so an
   * untouched incident toggle validates nothing: move the attachment there and
   * "turn the alert off and submit" stops being caught in the browser at all.
   */
  test("the no-output validator hangs off the toggle that always has a value", () => {
    expect(fieldFor("shouldCreateAlert").customValidation).toBe(
      validateBurnRateOutputs,
    );
    expect(fieldFor("shouldCreateIncident").customValidation).toBeUndefined();

    /*
     * And that toggle's default is what guarantees it is in the values at all —
     * the two facts are one mechanism, so they are asserted together.
     */
    expect(fieldFor("shouldCreateAlert").defaultValue).toBe(true);
  });

  test("Create Alert carries the column default so the toggle matches the row", () => {
    expect(fieldFor("shouldCreateAlert").defaultValue).toBe(true);

    /*
     * And Declare Incident does NOT: `defaultValue` is only applied when
     * truthy, so `false` here would be indistinguishable from absent — the
     * column default of false is what has to do the work.
     */
    expect(fieldFor("shouldCreateIncident").defaultValue).toBeUndefined();
  });
});

describe("the two routing steps appear only for the output they configure", () => {
  function isVisible(
    stepId: string,
    values: FormValues<ServiceLevelObjectiveBurnRateRule>,
  ): boolean {
    const step: StepOf = stepById(stepId);

    if (!step.showIf) {
      throw new Error(`Step "${stepId}" has no showIf.`);
    }

    return step.showIf(values);
  }

  test("the first three steps are unconditional", () => {
    for (const id of ["rule", "burn-window", "declares"]) {
      expect(stepById(id).showIf).toBeUndefined();
    }
  });

  test("an untouched form shows alert routing and hides incident routing", () => {
    /*
     * Exactly the model's column defaults. A form the user has not touched
     * submits a rule that alerts and declares nothing, so that is the routing
     * it must offer.
     */
    expect(isVisible("alert-routing", {})).toBe(true);
    expect(isVisible("incident-routing", {})).toBe(false);
  });

  test("turning an output on reveals its routing step", () => {
    expect(isVisible("incident-routing", { shouldCreateIncident: true })).toBe(
      true,
    );
    expect(isVisible("alert-routing", { shouldCreateAlert: true })).toBe(true);
  });

  test("turning an output off hides its routing step", () => {
    expect(isVisible("alert-routing", { shouldCreateAlert: false })).toBe(
      false,
    );
    expect(isVisible("incident-routing", { shouldCreateIncident: false })).toBe(
      false,
    );
  });

  test("an incident-only rule shows incident routing and no alert routing", () => {
    const incidentOnly: FormValues<ServiceLevelObjectiveBurnRateRule> = {
      shouldCreateAlert: false,
      shouldCreateIncident: true,
    };

    expect(isVisible("alert-routing", incidentOnly)).toBe(false);
    expect(isVisible("incident-routing", incidentOnly)).toBe(true);
  });

  test("a rule that does both shows both", () => {
    const both: FormValues<ServiceLevelObjectiveBurnRateRule> = {
      shouldCreateAlert: true,
      shouldCreateIncident: true,
    };

    expect(isVisible("alert-routing", both)).toBe(true);
    expect(isVisible("incident-routing", both)).toBe(true);
  });

  /*
   * The steps and the validator have to read the flags the same way, or a step
   * hides the fields for an output the validator still counts as on. They share
   * one pair of predicates for exactly this reason; this pins that they do.
   */
  test("every step agrees with the predicate that gates it, over all nine combinations", () => {
    const EVERY_VALUE: Array<boolean | undefined> = [undefined, true, false];

    for (const shouldCreateAlert of EVERY_VALUE) {
      for (const shouldCreateIncident of EVERY_VALUE) {
        const values: FormValues<ServiceLevelObjectiveBurnRateRule> = {};

        if (shouldCreateAlert !== undefined) {
          values.shouldCreateAlert = shouldCreateAlert;
        }

        if (shouldCreateIncident !== undefined) {
          values.shouldCreateIncident = shouldCreateIncident;
        }

        expect({
          values,
          alert: isVisible("alert-routing", values),
          incident: isVisible("incident-routing", values),
        }).toEqual({
          values,
          alert: willCreateAlert(values),
          incident: willDeclareIncident(values),
        });

        /*
         * And the one combination that hides BOTH routing steps is exactly the
         * one the validator refuses to let through.
         */
        const hidesBoth: boolean =
          !isVisible("alert-routing", values) &&
          !isVisible("incident-routing", values);

        expect(hidesBoth).toBe(validateBurnRateOutputs(values) !== null);
      }
    }
  });
});

describe("willCreateAlert / willDeclareIncident", () => {
  test("read the model's own defaults when a flag is absent", () => {
    expect(willCreateAlert({})).toBe(true);
    expect(willDeclareIncident({})).toBe(false);
  });

  test("the alert flag is read `!== false`, so only an explicit false turns it off", () => {
    expect(willCreateAlert({ shouldCreateAlert: true })).toBe(true);
    expect(willCreateAlert({ shouldCreateAlert: undefined })).toBe(true);
    expect(willCreateAlert({ shouldCreateAlert: false })).toBe(false);
  });

  test("the incident flag is read `=== true`, so only an explicit true turns it on", () => {
    expect(willDeclareIncident({ shouldCreateIncident: true })).toBe(true);
    expect(willDeclareIncident({ shouldCreateIncident: undefined })).toBe(
      false,
    );
    expect(willDeclareIncident({ shouldCreateIncident: false })).toBe(false);
  });

  test("each reads only its own flag", () => {
    expect(willCreateAlert({ shouldCreateIncident: true })).toBe(true);
    expect(willDeclareIncident({ shouldCreateAlert: true })).toBe(false);
  });
});
