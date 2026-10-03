import {
  NEXT_BUTTON_TEXT,
  SteppedFormFooter,
  canFinishFormFromStep,
  getSteppedFormFooter,
  isCustomElementToShowBeforeFinishing,
} from "../../../../UI/Components/Forms/Utils/FinishFromAnyStep";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * "A wizard step has to earn its place ... once every remaining step is
 * optional the main action button is available." canFinishFormFromStep is
 * the one question every stepped form asks for that - BasicForm on a page,
 * ModelFormModal and BasicFormModal in a dialog - and getSteppedFormFooter
 * turns its answer into the buttons. Both are pinned here on plain values;
 * the forms that use them are tested in BasicFormFinishFromAnyStep,
 * BasicFormModalSteps and SteppedEditFormSave.
 */

interface Incident extends JSONObject {
  title?: string | undefined;
  severity?: string | undefined;
  monitors?: Array<string> | undefined;
  roles?: Array<string> | undefined;
  onCall?: Array<string> | undefined;
  isPrivate?: boolean | undefined;
  kind?: string | undefined;
  origin?: string | undefined;
}

const DETAILS: string = "details";
const RESOURCES: string = "resources";
const ROLES: string = "roles";
const MORE: string = "more";

const STEPS: Array<FormStep<Incident>> = [
  { id: DETAILS, title: "Incident Details" },
  { id: RESOURCES, title: "Resources Affected" },
  { id: ROLES, title: "Incident Roles" },
  { id: MORE, title: "More" },
];

type MakeFieldFunction = (
  name: string,
  stepId: string,
  overrides?: Partial<Field<Incident>>,
) => Field<Incident>;

const makeField: MakeFieldFunction = (
  name: string,
  stepId: string,
  overrides?: Partial<Field<Incident>>,
): Field<Incident> => {
  return {
    name: name,
    title: name,
    field: { [name]: true },
    stepId: stepId,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    ...overrides,
  } as Field<Incident>;
};

// Title and severity first; everything after is optional.
const FIELDS: Array<Field<Incident>> = [
  makeField("title", DETAILS, { required: true }),
  makeField("severity", DETAILS, {
    required: true,
    fieldType: FormFieldSchemaType.Dropdown,
  }),
  makeField("onCall", ROLES, {
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
  }),
  makeField("isPrivate", MORE, { fieldType: FormFieldSchemaType.Checkbox }),
];

type CanFinishFunction = (data?: {
  steps?: Array<FormStep<Incident>>;
  currentStepId?: string | null;
  fields?: Array<Field<Incident>>;
  values?: FormValues<Incident>;
  shownStepIds?: Array<string>;
  onValidate?: ((values: FormValues<Incident>) => JSONObject) | undefined;
}) => boolean;

const canFinish: CanFinishFunction = (
  data: {
    steps?: Array<FormStep<Incident>>;
    currentStepId?: string | null;
    fields?: Array<Field<Incident>>;
    values?: FormValues<Incident>;
    shownStepIds?: Array<string>;
    onValidate?: ((values: FormValues<Incident>) => JSONObject) | undefined;
  } = {},
): boolean => {
  return canFinishFormFromStep<Incident>({
    steps: data.steps || STEPS,
    currentStepId:
      data.currentStepId === undefined ? DETAILS : data.currentStepId,
    fields: data.fields || FIELDS,
    values: data.values || {},
    shownStepIds: data.shownStepIds || [DETAILS],
    onValidate: data.onValidate,
  });
};

// A custom element on the Resources Affected step, as Declare Incident has.
const PICKER: Field<Incident> = makeField("monitors", RESOURCES, {
  fieldType: FormFieldSchemaType.CustomComponent,
});

describe("canFinishFormFromStep", () => {
  test("remaining steps valid: the form can be finished from the first step", () => {
    expect(canFinish()).toBe(true);
  });

  test("does not judge the step on screen: its own empty required fields are checked when the action is pressed", () => {
    // Title and severity are both empty, and both on the step on screen.
    expect(canFinish({ values: {} })).toBe(true);
  });

  test("a required later field shows Next only, until it has a value", () => {
    const fields: Array<Field<Incident>> = [
      ...FIELDS,
      makeField("roles", ROLES, { required: true }),
    ];

    expect(canFinish({ fields })).toBe(false);
    expect(canFinish({ fields, values: { roles: ["commander"] } })).toBe(true);
  });

  test("a later field that fails its own check stops it", () => {
    const fields: Array<Field<Incident>> = [
      ...FIELDS,
      makeField("origin", MORE, {
        customValidation: (values: FormValues<Incident>): string | null => {
          return values.origin === "nowhere" ? "Not an origin." : null;
        },
      }),
    ];

    expect(canFinish({ fields, values: { origin: "nowhere" } })).toBe(false);
    expect(canFinish({ fields, values: { origin: "example.com" } })).toBe(true);
  });

  test("a later field with a value of the wrong shape stops it", () => {
    const fields: Array<Field<Incident>> = [
      ...FIELDS,
      makeField("origin", MORE, { fieldType: FormFieldSchemaType.Email }),
    ];

    expect(canFinish({ fields, values: { origin: "not an email" } })).toBe(
      false,
    );
    expect(canFinish({ fields, values: { origin: "a@example.com" } })).toBe(
      true,
    );
  });

  test("a required field on a step its showIf leaves out is not asked for", () => {
    const isBrowser: (values: FormValues<Incident>) => boolean = (
      values: FormValues<Incident>,
    ): boolean => {
      return values.kind === "browser";
    };

    const steps: Array<FormStep<Incident>> = [
      ...STEPS.slice(0, 2),
      { id: "browser", title: "Browser Settings", showIf: isBrowser },
      ...STEPS.slice(2),
    ];

    const fields: Array<Field<Incident>> = [
      ...FIELDS,
      makeField("origin", "browser", { required: true }),
    ];

    // The caller hands in the steps the user walks: this one is left out.
    expect(
      canFinish({
        steps: steps.filter((step: FormStep<Incident>): boolean => {
          return !step.showIf || step.showIf({ kind: "server" });
        }),
        fields,
        values: { kind: "server" },
      }),
    ).toBe(true);

    expect(
      canFinish({
        steps: steps.filter((step: FormStep<Incident>): boolean => {
          return !step.showIf || step.showIf({ kind: "browser" });
        }),
        fields,
        values: { kind: "browser" },
      }),
    ).toBe(false);
  });

  test("a required later field its own showIf hides is not asked for", () => {
    const fields: Array<Field<Incident>> = [
      ...FIELDS,
      makeField("origin", MORE, {
        required: true,
        showIf: (values: FormValues<Incident>): boolean => {
          return values.kind === "browser";
        },
      }),
    ];

    expect(canFinish({ fields, values: { kind: "server" } })).toBe(true);
    expect(canFinish({ fields, values: { kind: "browser" } })).toBe(false);
  });

  test("a required field whose requirement depends on the answers is asked the same way", () => {
    const fields: Array<Field<Incident>> = [
      ...FIELDS,
      makeField("origin", MORE, {
        required: (values: FormValues<Incident>): boolean => {
          return values.kind === "browser";
        },
      }),
    ];

    expect(canFinish({ fields, values: { kind: "server" } })).toBe(true);
    expect(canFinish({ fields, values: { kind: "browser" } })).toBe(false);
  });

  describe("a custom element", () => {
    test("on a step not shown yet: the form walks to it first, since it may fill in a value of its own", () => {
      expect(canFinish({ fields: [...FIELDS, PICKER] })).toBe(false);
    });

    test("once its step has been shown, it no longer holds the form up", () => {
      expect(
        canFinish({
          fields: [...FIELDS, PICKER],
          shownStepIds: [DETAILS, RESOURCES],
        }),
      ).toBe(true);
    });

    test("that says it can be skipped never holds the form up", () => {
      expect(
        canFinish({
          fields: [...FIELDS, { ...PICKER, customElementCanBeSkipped: true }],
        }),
      ).toBe(true);
    });

    test("hidden by its showIf does not hold the form up", () => {
      expect(
        canFinish({
          fields: [
            ...FIELDS,
            {
              ...PICKER,
              showIf: (): boolean => {
                return false;
              },
            },
          ],
        }),
      ).toBe(true);
    });

    test("that can be skipped still has to pass validation", () => {
      expect(
        canFinish({
          fields: [
            ...FIELDS,
            { ...PICKER, customElementCanBeSkipped: true, required: true },
          ],
        }),
      ).toBe(false);

      expect(
        canFinish({
          fields: [
            ...FIELDS,
            { ...PICKER, customElementCanBeSkipped: true, required: true },
          ],
          values: { monitors: ["checkout"] },
        }),
      ).toBe(true);
    });

    test("on the step on screen is not judged", () => {
      expect(
        canFinish({
          fields: [...FIELDS, PICKER],
          currentStepId: RESOURCES,
          // Drawn now: the step on screen joins the shown ones a render later.
          shownStepIds: [DETAILS],
          values: { title: "Checkout is down", severity: "sev1" },
        }),
      ).toBe(true);
    });

    test("on an earlier step that was never shown holds the form up too", () => {
      // A step that came into view behind the user, after they walked past.
      expect(
        canFinish({
          fields: [...FIELDS, PICKER],
          currentStepId: ROLES,
          shownStepIds: [DETAILS, ROLES],
        }),
      ).toBe(false);
    });

    test("isCustomElementToShowBeforeFinishing names exactly those", () => {
      const values: FormValues<Incident> = {};

      expect(isCustomElementToShowBeforeFinishing(PICKER, values)).toBe(true);
      expect(
        isCustomElementToShowBeforeFinishing(
          { ...PICKER, customElementCanBeSkipped: true },
          values,
        ),
      ).toBe(false);
      expect(
        isCustomElementToShowBeforeFinishing(
          makeField("title", DETAILS),
          values,
        ),
      ).toBe(false);
    });
  });

  describe("the form's own check (onValidate)", () => {
    test("an error it pins on a field of another step stops it", () => {
      expect(
        canFinish({
          onValidate: (): JSONObject => {
            return { onCall: "Pick a policy." };
          },
        }),
      ).toBe(false);
    });

    test("an error it pins on a field of the step on screen does not", () => {
      expect(
        canFinish({
          onValidate: (): JSONObject => {
            return { title: "Say what is happening." };
          },
        }),
      ).toBe(true);
    });

    test("an error it pins on no field at all stops it", () => {
      expect(
        canFinish({
          onValidate: (): JSONObject => {
            return { somethingElse: "No." };
          },
        }),
      ).toBe(false);
    });

    test("no error lets it through", () => {
      expect(
        canFinish({
          onValidate: (): JSONObject => {
            return {};
          },
        }),
      ).toBe(true);
    });
  });

  describe("forms it says nothing about", () => {
    test("no steps", () => {
      expect(canFinish({ steps: [] })).toBe(false);
    });

    test("no step on screen yet (the first render)", () => {
      expect(canFinish({ currentStepId: null })).toBe(false);
    });

    test("a step on screen that is not one the user walks", () => {
      expect(canFinish({ currentStepId: "gone" })).toBe(false);
    });
  });

  test("a field with no name is validated under its key", () => {
    const unnamed: Field<Incident> = {
      field: { onCall: true },
      title: "On-Call Policy",
      stepId: ROLES,
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      required: true,
    };

    expect(canFinish({ fields: [...FIELDS, unnamed] })).toBe(false);
    expect(
      canFinish({ fields: [...FIELDS, unnamed], values: { onCall: ["p1"] } }),
    ).toBe(true);
  });

  test("a field with no step is never shown, so it is not asked for", () => {
    expect(
      canFinish({
        fields: [
          ...FIELDS,
          {
            ...makeField("origin", MORE, { required: true }),
            stepId: undefined,
          },
        ],
      }),
    ).toBe(true);
  });

  test("the summary step a form adds has nothing to ask", () => {
    expect(
      canFinish({
        steps: [
          ...STEPS,
          { id: "summary", title: "Summary", isSummaryStep: true },
        ],
      }),
    ).toBe(true);
  });

  test("from a step in the middle, earlier and later steps are both judged", () => {
    const fields: Array<Field<Incident>> = [
      ...FIELDS,
      makeField("roles", ROLES, { required: true }),
    ];

    // On Resources Affected: the required role is on a later step.
    expect(
      canFinish({
        fields,
        currentStepId: RESOURCES,
        shownStepIds: [DETAILS, RESOURCES],
        values: { title: "Checkout is down", severity: "sev1" },
      }),
    ).toBe(false);

    // A required title on an earlier step that was emptied since.
    expect(
      canFinish({
        currentStepId: RESOURCES,
        shownStepIds: [DETAILS, RESOURCES],
        values: { severity: "sev1" },
      }),
    ).toBe(false);

    expect(
      canFinish({
        currentStepId: RESOURCES,
        shownStepIds: [DETAILS, RESOURCES],
        values: { title: "Checkout is down", severity: "sev1" },
      }),
    ).toBe(true);
  });
});

describe("getSteppedFormFooter", () => {
  type FooterFunction = (data: {
    hasSteps?: boolean;
    isOnLastStep?: boolean;
    canFinishFromCurrentStep?: boolean;
    savesFromAnyStep?: boolean;
  }) => SteppedFormFooter;

  const footer: FooterFunction = (data: {
    hasSteps?: boolean;
    isOnLastStep?: boolean;
    canFinishFromCurrentStep?: boolean;
    savesFromAnyStep?: boolean;
  }): SteppedFormFooter => {
    return getSteppedFormFooter({
      hasSteps: data.hasSteps ?? true,
      isOnLastStep: data.isOnLastStep ?? false,
      canFinishFromCurrentStep: data.canFinishFromCurrentStep ?? false,
      savesFromAnyStep: data.savesFromAnyStep,
      actionText: "Declare Incident",
    });
  };

  test("a form without steps: the action, no Next", () => {
    expect(footer({ hasSteps: false })).toEqual({
      primaryButtonText: "Declare Incident",
      primaryButtonSubmitsAllSteps: false,
      showNextButton: false,
    });
  });

  test("a step that walks on: Next is the main button, and there is no second one", () => {
    expect(footer({})).toEqual({
      primaryButtonText: NEXT_BUTTON_TEXT,
      primaryButtonSubmitsAllSteps: false,
      showNextButton: false,
    });
  });

  test("a step the form can be finished from: the action, through every step, with Next beside it", () => {
    expect(footer({ canFinishFromCurrentStep: true })).toEqual({
      primaryButtonText: "Declare Incident",
      primaryButtonSubmitsAllSteps: true,
      showNextButton: true,
    });
  });

  test("the last step: the action, as before", () => {
    expect(footer({ isOnLastStep: true })).toEqual({
      primaryButtonText: "Declare Incident",
      primaryButtonSubmitsAllSteps: false,
      showNextButton: false,
    });

    expect(
      footer({ isOnLastStep: true, canFinishFromCurrentStep: true }),
    ).toEqual({
      primaryButtonText: "Declare Incident",
      primaryButtonSubmitsAllSteps: false,
      showNextButton: false,
    });
  });

  test("an edit form saves from any step, whatever the steps hold", () => {
    expect(footer({ savesFromAnyStep: true })).toEqual({
      primaryButtonText: "Declare Incident",
      primaryButtonSubmitsAllSteps: true,
      showNextButton: true,
    });

    expect(footer({ savesFromAnyStep: true, isOnLastStep: true })).toEqual({
      primaryButtonText: "Declare Incident",
      primaryButtonSubmitsAllSteps: true,
      showNextButton: false,
    });
  });

  test("never offers a Back button: there is none to offer (b61a6b656d)", () => {
    for (const hasSteps of [true, false]) {
      for (const isOnLastStep of [true, false]) {
        for (const canFinishFromCurrentStep of [true, false]) {
          for (const savesFromAnyStep of [true, false]) {
            const result: SteppedFormFooter = footer({
              hasSteps,
              isOnLastStep,
              canFinishFromCurrentStep,
              savesFromAnyStep,
            });

            expect(Object.keys(result).sort()).toEqual([
              "primaryButtonSubmitsAllSteps",
              "primaryButtonText",
              "showNextButton",
            ]);

            // The action is the main button whenever a Next sits beside it.
            if (result.showNextButton) {
              expect(result.primaryButtonText).toBe("Declare Incident");
            }
          }
        }
      }
    }
  });
});
