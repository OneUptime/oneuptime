import {
  BURN_RATE_RULE_FORM_FIELDS,
  BURN_RATE_RULE_FORM_STEPS,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleForm";
import {
  BURN_RATE_DECLARES_FIELD_KEY,
  BurnRateDeclares,
  getBurnRateDeclares,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateDeclares";
import ServiceLevelObjectiveBurnRateRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What It Declares, as the burn rate rule form draws it.
 *
 * It was two switches - Create Alert and Declare Incident - whose help said
 * "A rule must create an alert, declare an incident, or both", and turning
 * the first off without the second stopped the form on "This rule would do
 * nothing". It is one question now, When it fires, with three answers that
 * each open something; a pick writes the rule's two columns, and the Alert
 * and Incident steps follow it.
 */

type BurnRateValues = FormValues<ServiceLevelObjectiveBurnRateRule>;

const DECLARES_STEPS: Array<FormStep<ServiceLevelObjectiveBurnRateRule>> =
  BURN_RATE_RULE_FORM_STEPS.filter(
    (step: FormStep<ServiceLevelObjectiveBurnRateRule>): boolean => {
      return ["declares", "alert-details", "incident-details"].includes(
        step.id,
      );
    },
  );

/*
 * The declares step's fields, and one field each to give the output steps a
 * body - handed to BasicForm as ModelForm hands them: a field that names its
 * column through overrideField gets it as its field (ModelForm sets
 * `field: { [column]: true }` on every field it draws).
 */
const FIELDS: Fields<ServiceLevelObjectiveBurnRateRule> =
  BURN_RATE_RULE_FORM_FIELDS.filter(
    (field: Field<ServiceLevelObjectiveBurnRateRule>): boolean => {
      return (
        field.stepId === "declares" ||
        ["alertTitleTemplate", "incidentTitleTemplate"].includes(
          Object.keys(field.field || {})[0] || "",
        )
      );
    },
  ).map(
    (
      field: Field<ServiceLevelObjectiveBurnRateRule>,
    ): Field<ServiceLevelObjectiveBurnRateRule> => {
      const overrideField: unknown = (field as { overrideField?: unknown })
        .overrideField;

      return overrideField && !field.field
        ? ({
            ...field,
            field: overrideField,
          } as Field<ServiceLevelObjectiveBurnRateRule>)
        : field;
    },
  );

function renderForm(initialValues?: BurnRateValues): MockFunction {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="burn-rate-declares"
      fields={FIELDS}
      steps={DECLARES_STEPS}
      initialValues={initialValues || {}}
      onSubmit={onSubmit}
      submitButtonText="Create Rule"
      disableAutofocus={true}
    />,
  );

  return onSubmit;
}

async function question(): Promise<HTMLElement> {
  return await screen.findByRole("radiogroup", { name: /^When it fires/ });
}

function stepTitles(): Array<string> {
  return within(screen.getByRole("navigation", { name: "Progress" }))
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

function lineOf(radio: HTMLElement): string {
  const id: string | null = radio.getAttribute("aria-describedby");

  return (document.getElementById(id || "")?.textContent || "").trim();
}

async function submitFromLastStep(onSubmit: MockFunction): Promise<BurnRateValues> {
  // Walk to the last step with Next, then create.
  for (let step: number = 0; step < 4; step++) {
    const next: HTMLElement | null = screen.queryByTestId("form-next-button");

    if (!next) {
      break;
    }

    await act(async () => {
      fireEvent.click(next);
    });
  }

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create Rule" }));
  });

  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  return (onSubmit.mock.calls[0] as Array<unknown>)[0] as BurnRateValues;
}

afterEach(() => {
  cleanup();
});

describe("When it fires", () => {
  test("is one question with three answers, each with its line, and no switches", async () => {
    renderForm();
    const group: HTMLElement = await question();
    const radios: Array<HTMLElement> = within(group).getAllByRole("radio");

    expect(
      radios.map((radio: HTMLElement): string => {
        return (
          group.querySelector(`label[for="${radio.id}"]`)?.textContent || ""
        ).trim();
      }),
    ).toEqual(["Create an alert", "Declare an incident", "Both"]);

    expect(lineOf(radios[0]!)).toBe("Opens an alert for the team to look at.");
    expect(lineOf(radios[1]!)).toBe(
      "Opens an incident. Burn rate incidents never reach status pages.",
    );
    expect(lineOf(radios[2]!)).toBe(
      "Opens an alert and an incident, each set up on the next steps.",
    );

    // The two output switches are gone from the screen; SLO owners stays.
    expect(screen.queryByRole("switch", { name: "Create Alert" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Declare Incident" })).toBeNull();
    expect(
      screen.getByRole("switch", { name: "Add SLO Owners as Owners" }),
    ).toBeInTheDocument();
  });

  test("a new rule starts on Create an alert, with the Alert step only", async () => {
    renderForm();
    const group: HTMLElement = await question();

    await waitFor(() => {
      expect(
        within(group).getByRole("radio", { name: "Create an alert" }),
      ).toBeChecked();
    });
    expect(stepTitles()).toEqual(["What It Declares", "Alert"]);
  });

  test("Declare an incident swaps the Alert step for the Incident step, and writes both columns", async () => {
    const onSubmit: MockFunction = renderForm();
    const group: HTMLElement = await question();

    fireEvent.click(
      within(group).getByRole("radio", { name: "Declare an incident" }),
    );

    await waitFor(() => {
      expect(stepTitles()).toEqual(["What It Declares", "Incident"]);
    });

    const values: BurnRateValues = await submitFromLastStep(onSubmit);

    expect(values.shouldCreateAlert).toBe(false);
    expect(values.shouldCreateIncident).toBe(true);
  });

  test("Both opens both steps, and writes both columns on", async () => {
    const onSubmit: MockFunction = renderForm();
    const group: HTMLElement = await question();

    fireEvent.click(within(group).getByRole("radio", { name: "Both" }));

    await waitFor(() => {
      expect(stepTitles()).toEqual(["What It Declares", "Alert", "Incident"]);
    });

    const values: BurnRateValues = await submitFromLastStep(onSubmit);

    expect(values.shouldCreateAlert).toBe(true);
    expect(values.shouldCreateIncident).toBe(true);
  });

  test("Create an alert, left as it starts, writes an alert and no incident", async () => {
    const onSubmit: MockFunction = renderForm();
    await question();

    const values: BurnRateValues = await submitFromLastStep(onSubmit);

    expect(values.shouldCreateAlert).toBe(true);
    expect(values.shouldCreateIncident).not.toBe(true);
  });

  test.each([
    [{ shouldCreateAlert: true, shouldCreateIncident: false }, "Create an alert"],
    [
      { shouldCreateAlert: false, shouldCreateIncident: true },
      "Declare an incident",
    ],
    [{ shouldCreateAlert: true, shouldCreateIncident: true }, "Both"],
  ])(
    "an edited rule with %j opens on %s",
    async (stored: BurnRateValues, answer: string) => {
      renderForm(stored);
      const group: HTMLElement = await question();

      await waitFor(() => {
        expect(within(group).getByRole("radio", { name: answer })).toBeChecked();
      });
    },
  );

  test("a rule written by hand to open nothing asks for an answer before it saves", async () => {
    const onSubmit: MockFunction = renderForm({
      shouldCreateAlert: false,
      shouldCreateIncident: false,
    });
    const group: HTMLElement = await question();

    for (const radio of within(group).getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create Rule" }));
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("getBurnRateDeclares", () => {
  test("reads the two columns with the worker's defaults", () => {
    expect(getBurnRateDeclares({})).toBe(BurnRateDeclares.Alert);
    expect(getBurnRateDeclares({ shouldCreateIncident: true })).toBe(
      BurnRateDeclares.Both,
    );
    expect(
      getBurnRateDeclares({
        shouldCreateAlert: false,
        shouldCreateIncident: true,
      }),
    ).toBe(BurnRateDeclares.Incident);
    expect(
      getBurnRateDeclares({
        shouldCreateAlert: false,
        shouldCreateIncident: false,
      }),
    ).toBeNull();
    expect(getBurnRateDeclares(null)).toBe(BurnRateDeclares.Alert);
  });

  test("the choice is form-only, kept under its own key", () => {
    const choice: Field<ServiceLevelObjectiveBurnRateRule> | undefined =
      FIELDS.find((field: Field<ServiceLevelObjectiveBurnRateRule>) => {
        return field.overrideFieldKey === BURN_RATE_DECLARES_FIELD_KEY;
      });

    expect(choice?.formOnly).toBe(true);
  });
});
