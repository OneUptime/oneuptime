import Validation from "../../../../UI/Components/Forms/Validation";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Step scoping is the contract that makes a wizard's "Next" button a gate.
 *
 * BasicForm reuses one validator for every step and hands it the id of the
 * step being submitted; Validation.validate then skips every field that lives
 * somewhere else. That is what lets a field-level error render inline, under
 * its own input, on the step the operator is actually looking at — instead of
 * as one combined banner at the end (issue #3377, the Network Device Discovery
 * Scan wizard).
 *
 * Nothing tested this branch before. ValidationJSON.test.ts is the only other
 * direct test of Validation.validate and it never passes currentFormStepId at
 * all, so the whole step filter — and every consequence of it, including the
 * ones below that are deliberately surprising — was unpinned.
 *
 * Several tests here assert CURRENT behaviour that is not obviously desirable
 * (customValidation skipped for absent keys; customValidation overwriting a
 * built-in message; onValidate output not being step-scoped). They are here
 * precisely because production code depends on those semantics today, so a
 * change to them should be a deliberate, visible decision rather than a
 * silent one.
 */

interface WizardEntity extends JSONObject {
  target?: string | undefined;
  probe?: string | undefined;
  community?: string | undefined;
  interval?: number | undefined;
  repeat?: boolean | undefined;
}

const STEP_ONE: string = "scan-target";
const STEP_TWO: string = "snmp";
const STEP_THREE: string = "schedule";

type MakeFieldFunction = (
  name: string,
  overrides?: Partial<Field<WizardEntity>>,
) => Field<WizardEntity>;

const makeField: MakeFieldFunction = (
  name: string,
  overrides?: Partial<Field<WizardEntity>>,
): Field<WizardEntity> => {
  return {
    name: name,
    title: name,
    field: { [name]: true },
    fieldType: FormFieldSchemaType.Text,
    ...overrides,
  } as Field<WizardEntity>;
};

type RunValidateFunction = (args: {
  formFields: Fields<WizardEntity>;
  values: FormValues<WizardEntity>;
  currentFormStepId?: string | null | undefined;
  onValidate?: ((values: FormValues<WizardEntity>) => JSONObject) | undefined;
}) => Dictionary<string>;

const runValidate: RunValidateFunction = (args: {
  formFields: Fields<WizardEntity>;
  values: FormValues<WizardEntity>;
  currentFormStepId?: string | null | undefined;
  onValidate?: ((values: FormValues<WizardEntity>) => JSONObject) | undefined;
}): Dictionary<string> => {
  return Validation.validate<WizardEntity>({
    formFields: args.formFields,
    values: args.values,
    onValidate: args.onValidate,
    currentFormStepId: args.currentFormStepId,
  });
};

/*
 * A three-step wizard shaped like the Discovery one: a validated text field on
 * step 1, an optional field on step 2, and a numeric field on step 3.
 */
const WIZARD_FIELDS: Fields<WizardEntity> = [
  makeField("target", {
    stepId: STEP_ONE,
    required: true,
    customValidation: (values: FormValues<WizardEntity>): string | null => {
      const value: string = (values.target || "").toString().trim();

      if (!value) {
        return null;
      }

      return value.includes("/") ? null : `"${value}" is not a subnet.`;
    },
  }),
  makeField("probe", { stepId: STEP_ONE, required: true }),
  makeField("community", { stepId: STEP_TWO, required: false }),
  makeField("interval", {
    stepId: STEP_THREE,
    required: true,
    fieldType: FormFieldSchemaType.Number,
    validation: { minValue: 15 },
  }),
];

describe("Validation.validate — a field is judged on its own step", () => {
  test("an invalid value on the current step is reported", () => {
    const errors: Dictionary<string> = runValidate({
      formFields: WIZARD_FIELDS,
      values: { target: "9876543210", probe: "probe-1" },
      currentFormStepId: STEP_ONE,
    });

    expect(errors["target"]).toBe('"9876543210" is not a subnet.');
  });

  test("a valid value on the current step clears the step", () => {
    const errors: Dictionary<string> = runValidate({
      formFields: WIZARD_FIELDS,
      values: { target: "192.168.1.0/24", probe: "probe-1" },
      currentFormStepId: STEP_ONE,
    });

    expect(errors).toEqual({});
  });

  test("a required field left empty on the current step is reported", () => {
    const errors: Dictionary<string> = runValidate({
      formFields: WIZARD_FIELDS,
      values: { target: "192.168.1.0/24" },
      currentFormStepId: STEP_ONE,
    });

    expect(errors["probe"]).toBe("probe is required.");
  });

  test("validation.minValue is applied on its own step", () => {
    const errors: Dictionary<string> = runValidate({
      formFields: WIZARD_FIELDS,
      values: { interval: 5, repeat: true },
      currentFormStepId: STEP_THREE,
    });

    expect(errors["interval"]).toContain("should not be less than 15");
  });
});

describe("Validation.validate — other steps are not judged", () => {
  /*
   * The half of the contract that keeps the button honest in the other
   * direction: an error the operator cannot see must never block the step they
   * are on. There is only one render path for a field error — the field
   * itself — so an error keyed to a field on another step would make Next a
   * dead button with nothing on screen to explain it.
   */
  test("a broken value on a LATER step does not block the current one", () => {
    const errors: Dictionary<string> = runValidate({
      formFields: WIZARD_FIELDS,
      values: { target: "192.168.1.0/24", probe: "probe-1", interval: 1 },
      currentFormStepId: STEP_ONE,
    });

    expect(errors).toEqual({});
  });

  test("a broken value on an EARLIER step does not block the current one", () => {
    const errors: Dictionary<string> = runValidate({
      formFields: WIZARD_FIELDS,
      values: { target: "not-a-subnet", interval: 60, repeat: true },
      currentFormStepId: STEP_THREE,
    });

    expect(errors).toEqual({});
  });

  test("a required field on another step is not demanded early", () => {
    const errors: Dictionary<string> = runValidate({
      formFields: WIZARD_FIELDS,
      values: {},
      currentFormStepId: STEP_TWO,
    });

    // Both step-one fields are required and both are missing.
    expect(errors).toEqual({});
  });

  test("each step reports only its own field", () => {
    const values: FormValues<WizardEntity> = {
      target: "not-a-subnet",
      probe: "probe-1",
      interval: 1,
      repeat: true,
    };

    expect(
      Object.keys(
        runValidate({
          formFields: WIZARD_FIELDS,
          values: values,
          currentFormStepId: STEP_ONE,
        }),
      ),
    ).toEqual(["target"]);

    expect(
      Object.keys(
        runValidate({
          formFields: WIZARD_FIELDS,
          values: values,
          currentFormStepId: STEP_THREE,
        }),
      ),
    ).toEqual(["interval"]);
  });
});

describe("Validation.validate — a form with no steps judges everything", () => {
  test.each([
    ["currentFormStepId omitted", undefined],
    ["currentFormStepId null", null],
    ["currentFormStepId empty string", ""],
  ])(
    "%s validates every field regardless of stepId",
    (_label: string, currentFormStepId: string | null | undefined) => {
      const errors: Dictionary<string> = runValidate({
        formFields: WIZARD_FIELDS,
        values: { target: "not-a-subnet", interval: 1 },
        currentFormStepId: currentFormStepId,
      });

      expect(errors["target"]).toBe('"not-a-subnet" is not a subnet.');
      expect(errors["probe"]).toBe("probe is required.");
      expect(errors["interval"]).toContain("should not be less than 15");
    },
  );
});

describe("Validation.validate — a field with no stepId at all", () => {
  /*
   * Current behaviour, pinned because it is a trap rather than a design: once
   * currentFormStepId is set, `field.stepId !== currentFormStepId` is true for
   * an undefined stepId on EVERY step, so the field is validated on none of
   * them. BasicForm's render filter uses the same comparison, so the field is
   * also drawn on no step — the two agree, and the field is simply inert.
   * setAllTouched does NOT agree (it additionally requires a truthy stepId, so
   * the field is marked touched everywhere), which is harmless only because
   * nothing ever produces an error for it.
   *
   * The practical consequence: in a stepped form, a field that forgets its
   * stepId silently stops being validated. That is why
   * App/Tests/Dashboard/NetworkFormStepsInvariants.test.ts exists, and why the
   * shared field helpers stamp every field they return.
   */
  test("is skipped on every step once the form is stepped", () => {
    const orphan: Fields<WizardEntity> = [
      makeField("target", { required: true }),
    ];

    for (const stepId of [STEP_ONE, STEP_TWO, STEP_THREE]) {
      expect(
        runValidate({
          formFields: orphan,
          values: {},
          currentFormStepId: stepId,
        }),
      ).toEqual({});
    }
  });

  test("is validated normally when the form has no steps", () => {
    const orphan: Fields<WizardEntity> = [
      makeField("target", { required: true }),
    ];

    expect(
      runValidate({ formFields: orphan, values: {}, currentFormStepId: null }),
    ).toEqual({ target: "target is required." });
  });
});

describe("Validation.validate — showIf short-circuits before every rule", () => {
  test("a hidden field is not required, even on its own step", () => {
    const fields: Fields<WizardEntity> = [
      makeField("interval", {
        stepId: STEP_THREE,
        required: true,
        showIf: (values: FormValues<WizardEntity>): boolean => {
          return Boolean(values.repeat);
        },
      }),
    ];

    expect(
      runValidate({
        formFields: fields,
        values: { repeat: false },
        currentFormStepId: STEP_THREE,
      }),
    ).toEqual({});
  });

  test("a hidden field's customValidation does not run", () => {
    const fields: Fields<WizardEntity> = [
      makeField("interval", {
        stepId: STEP_THREE,
        showIf: (): boolean => {
          return false;
        },
        customValidation: (): string | null => {
          return "should never be seen";
        },
      }),
    ];

    expect(
      runValidate({
        formFields: fields,
        values: { interval: 1 },
        currentFormStepId: STEP_THREE,
      }),
    ).toEqual({});
  });

  test("the same field is validated once it is revealed", () => {
    const fields: Fields<WizardEntity> = [
      makeField("interval", {
        stepId: STEP_THREE,
        required: true,
        showIf: (values: FormValues<WizardEntity>): boolean => {
          return Boolean(values.repeat);
        },
      }),
    ];

    expect(
      runValidate({
        formFields: fields,
        values: { repeat: true },
        currentFormStepId: STEP_THREE,
      }),
    ).toEqual({ interval: "interval is required." });
  });
});

describe("Validation.validate — customValidation semantics a wizard depends on", () => {
  /*
   * Pinned because App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo.tsx
   * relies on it (and works around it with getDefaultValue), and because it is
   * the reason the Discovery validators short-circuit on empty instead of
   * returning the parser's own "is required" text.
   */
  test("does not run for a field whose key is absent from the values", () => {
    const fields: Fields<WizardEntity> = [
      makeField("target", {
        stepId: STEP_ONE,
        required: true,
        customValidation: (): string | null => {
          return "custom message";
        },
      }),
    ];

    expect(
      runValidate({
        formFields: fields,
        values: {},
        currentFormStepId: STEP_ONE,
      }),
    ).toEqual({ target: "target is required." });
  });

  test("does run once the key exists, even when the value is empty", () => {
    const fields: Fields<WizardEntity> = [
      makeField("target", {
        stepId: STEP_ONE,
        required: true,
        customValidation: (): string | null => {
          return "custom message";
        },
      }),
    ];

    expect(
      runValidate({
        formFields: fields,
        values: { target: "" },
        currentFormStepId: STEP_ONE,
      }),
    ).toEqual({ target: "custom message" });
  });

  test("runs last, so it overwrites a built-in message for the same field", () => {
    /*
     * Which is why a validator that speaks up for empty input replaces the
     * short "X is required." with its own, longer sentence. Returning null for
     * empty is not politeness — it is how the required message survives.
     */
    const fields: Fields<WizardEntity> = [
      makeField("target", {
        stepId: STEP_ONE,
        required: true,
        validation: { minLength: 20 },
        customValidation: (): string | null => {
          return "custom wins";
        },
      }),
    ];

    expect(
      runValidate({
        formFields: fields,
        values: { target: "short" },
        currentFormStepId: STEP_ONE,
      }),
    ).toEqual({ target: "custom wins" });
  });

  test("returning null leaves the built-in message in place", () => {
    const fields: Fields<WizardEntity> = [
      makeField("target", {
        stepId: STEP_ONE,
        required: true,
        validation: { minLength: 20 },
        customValidation: (): string | null => {
          return null;
        },
      }),
    ];

    expect(
      runValidate({
        formFields: fields,
        values: { target: "short" },
        currentFormStepId: STEP_ONE,
      })["target"],
    ).toContain("cannot be less than 20 characters");
  });

  test("is handed the whole form's values, not just its own field", () => {
    let seen: FormValues<WizardEntity> | null = null;

    const fields: Fields<WizardEntity> = [
      makeField("interval", {
        stepId: STEP_THREE,
        customValidation: (values: FormValues<WizardEntity>): string | null => {
          seen = values;
          return null;
        },
      }),
    ];

    runValidate({
      formFields: fields,
      values: { interval: 60, repeat: true, target: "192.168.1.0/24" },
      currentFormStepId: STEP_THREE,
    });

    /*
     * Cross-step values are readable, which is how a toggle on another step
     * can switch a validator off.
     */
    expect(seen).toEqual({
      interval: 60,
      repeat: true,
      target: "192.168.1.0/24",
    });
  });

  test("a customValidation on another step's field never runs", () => {
    let calls: number = 0;

    const fields: Fields<WizardEntity> = [
      makeField("target", {
        stepId: STEP_ONE,
        customValidation: (): string | null => {
          calls++;
          return "nope";
        },
      }),
    ];

    runValidate({
      formFields: fields,
      values: { target: "anything" },
      currentFormStepId: STEP_TWO,
    });

    expect(calls).toBe(0);
  });
});

describe("Validation.validate — onValidate output is NOT step-scoped", () => {
  /*
   * Current behaviour, pinned deliberately. The per-field loop is filtered by
   * step; the form-level onValidate result is spread over the top of it
   * unfiltered. A key naming a field on another step therefore blocks the
   * button with nothing on screen to explain it.
   *
   * Unreachable today — ModelTable/CardModelDetail expose formSteps but no
   * onValidate, and the single production onValidate in the repo is on a
   * stepless form — so this is a latent trap rather than a live bug. Anyone
   * adding an onValidate to a wizard should see this test fail their
   * assumptions before their users do.
   */
  test("its keys survive the step filter", () => {
    const errors: Dictionary<string> = runValidate({
      formFields: WIZARD_FIELDS,
      values: { target: "192.168.1.0/24", probe: "probe-1" },
      currentFormStepId: STEP_ONE,
      onValidate: (): JSONObject => {
        return { interval: "an error about a field three steps away" };
      },
    });

    expect(errors["interval"]).toBe("an error about a field three steps away");
  });

  test("its keys win over a per-field message for the same field", () => {
    const errors: Dictionary<string> = runValidate({
      formFields: WIZARD_FIELDS,
      values: { target: "9876543210", probe: "probe-1" },
      currentFormStepId: STEP_ONE,
      onValidate: (): JSONObject => {
        return { target: "form-level message" };
      },
    });

    expect(errors["target"]).toBe("form-level message");
  });

  test("an empty result adds nothing", () => {
    const errors: Dictionary<string> = runValidate({
      formFields: WIZARD_FIELDS,
      values: { target: "192.168.1.0/24", probe: "probe-1" },
      currentFormStepId: STEP_ONE,
      onValidate: (): JSONObject => {
        return {};
      },
    });

    expect(errors).toEqual({});
  });
});
