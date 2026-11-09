import {
  ERROR_BUDGET_POLICY_TIER_FORM_FIELDS,
  POLICY_TIER_OUTPUTS_SUMMARY,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/ErrorBudgetPolicyTierForm";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import {
  DEFAULT_SLO_POLICY_TIER_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
} from "../../../../Utils/Slo/SloBurnRateTemplate";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The tier form, drawn by the real BasicForm: what a person meets when they
 * add a tier of an SLO's error budget policy. Its three fields first and
 * nothing else in sight; the alerts and incidents folded away, switched
 * off, saying so; switching one on shows that output's fields, prefilled
 * with the tier's own defaults.
 *
 * The pickers that list a project's severities, labels, people and on-call
 * policies are left out - each reads them from the API - so the form here is
 * every field that is typed or switched.
 */

type TierValues = FormValues<ServiceLevelObjectiveErrorBudgetPolicyTier>;

const PICKER_TYPES: Array<FormFieldSchemaType> = [
  FormFieldSchemaType.Dropdown,
  FormFieldSchemaType.MultiSelectDropdown,
  FormFieldSchemaType.PeoplePicker,
];

const FIELDS: Fields<ServiceLevelObjectiveErrorBudgetPolicyTier> =
  ERROR_BUDGET_POLICY_TIER_FORM_FIELDS.filter(
    (field: Field<ServiceLevelObjectiveErrorBudgetPolicyTier>): boolean => {
      return (
        !PICKER_TYPES.includes(field.fieldType as FormFieldSchemaType) &&
        // On the Edit form only (ModelForm leaves it out of Create).
        !field.doNotShowWhenCreating
      );
    },
  );

function renderForm(initialValues: TierValues = {}): {
  onSubmit: MockFunction;
  user: UserEvent;
} {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="policy-tier-form"
      fields={FIELDS}
      initialValues={initialValues}
      onSubmit={onSubmit}
      submitButtonText="Create SLO Error Budget Policy Tier"
      disableAutofocus={true}
    />,
  );

  return { onSubmit, user: userEvent.setup({ delay: null }) };
}

function fold(): HTMLElement {
  return screen.getByRole("button", { name: "Alerts and incidents" });
}

describe("the error budget policy tier form", () => {
  afterEach(() => {
    cleanup();
  });

  test("asks Name, Budget Left Threshold (%) and What We Do first, with the alerts and incidents folded away", async () => {
    renderForm();

    const name: HTMLElement = await screen.findByRole("textbox", {
      name: /^Name/,
    });
    const threshold: HTMLElement = screen.getByRole("spinbutton", {
      name: /^Budget Left Threshold \(%\)/,
    });
    const whatWeDo: HTMLElement = await screen.findByRole("textbox", {
      name: /^What We Do/,
    });

    // In that order, and before the fold.
    expect(
      name.compareDocumentPosition(threshold) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      threshold.compareDocumentPosition(whatWeDo) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      whatWeDo.compareDocumentPosition(fold()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(fold()).toHaveAttribute("aria-expanded", "false");
    // Folded, it says what a new tier raises: nothing.
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      POLICY_TIER_OUTPUTS_SUMMARY.nothing,
    );
    expect(
      screen.queryByRole("textbox", { name: /^Alert Title/ }),
    ).not.toBeInTheDocument();
  });

  test("asks Freeze Deployments right under What We Do, off and outside the fold, and saves it switched on", async () => {
    const { user, onSubmit } = renderForm({
      whatWeDo: "Freeze non-critical releases.",
    });

    const whatWeDo: HTMLElement = await screen.findByRole("textbox", {
      name: /^What We Do/,
    });
    const freeze: HTMLElement = screen.getByRole("switch", {
      name: /^Freeze Deployments/,
    });

    expect(freeze).not.toBeChecked();
    expect(
      whatWeDo.compareDocumentPosition(freeze) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      freeze.compareDocumentPosition(fold()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Not one of the outputs: the fold stays folded.
    expect(fold()).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByText(
        "While the SLO is in this tier, CI/CD pipelines that check it hold back releases.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Budget exhausted" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /^Budget Left Threshold \(%\)/ }),
      { target: { value: "0" } },
    );

    await user.click(freeze);

    expect(freeze).toBeChecked();
    expect(fold()).toHaveAttribute("aria-expanded", "false");

    await user.click(
      screen.getByRole("button", {
        name: "Create SLO Error Budget Policy Tier",
      }),
    );

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const saved: TierValues = onSubmit.mock.calls[0]![0] as TierValues;

    expect(saved.freezesDeployments).toBe(true);
    // Freezing deployments raises nothing.
    expect(saved.shouldCreateAlert).not.toBe(true);
    expect(saved.shouldCreateIncident).not.toBe(true);
  });

  test("opened, it offers both switches, off, and nothing else until one is on", async () => {
    const { user } = renderForm();

    await user.click(fold());

    expect(fold()).toHaveAttribute("aria-expanded", "true");

    const alert: HTMLElement = await screen.findByRole("switch", {
      name: /^Create Alert/,
    });
    const incident: HTMLElement = screen.getByRole("switch", {
      name: /^Declare Incident/,
    });

    expect(alert).not.toBeChecked();
    expect(incident).not.toBeChecked();
    expect(
      screen.queryByRole("textbox", { name: /^Alert Title/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /^Add SLO Owners as Owners/ }),
    ).not.toBeInTheDocument();
  });

  test("switching the alert on shows its fields, prefilled with the tier's defaults, and saves them", async () => {
    const { user, onSubmit } = renderForm({
      whatWeDo: "Only reliability fixes ship.",
    });

    fireEvent.change(await screen.findByRole("textbox", { name: /^Name/ }), {
      target: { value: "Reliability first" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /^Budget Left Threshold \(%\)/ }),
      { target: { value: "25" } },
    );

    await user.click(fold());
    await user.click(
      await screen.findByRole("switch", { name: /^Create Alert/ }),
    );

    expect(
      await screen.findByRole("textbox", { name: /^Alert Title/ }),
    ).toHaveValue(DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE);
    // The Markdown editor draws it as it reads: the template's first sentence, then what we do.
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /^Alert Description/ }),
      ).toHaveTextContent(
        'SLO "{{sloName}}" is in the "{{policyTier}}" tier of its error budget policy',
      );
    });
    expect(
      screen.getByRole("textbox", { name: /^Alert Description/ }),
    ).toHaveTextContent("What we do: {{policyTierWhatWeDo}}");
    expect(
      screen.getByRole("switch", { name: /^Add SLO Owners as Owners/ }),
    ).toBeInTheDocument();
    // The incident's stay hidden behind its own switch.
    expect(
      screen.queryByRole("textbox", { name: /^Incident Title/ }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Create SLO Error Budget Policy Tier",
      }),
    );

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const saved: TierValues = onSubmit.mock.calls[0]![0] as TierValues;

    expect(saved).toEqual(
      expect.objectContaining({
        name: "Reliability first",
        whatWeDo: "Only reliability fixes ship.",
        shouldCreateAlert: true,
        alertTitleTemplate: DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
        alertDescriptionTemplate: DEFAULT_SLO_POLICY_TIER_DESCRIPTION_TEMPLATE,
        autoResolveAlert: true,
      }),
    );
    expect(Number(saved.thresholdPercentage)).toBe(25);
    expect(saved.shouldCreateIncident).not.toBe(true);
  });

  test("a tier that raises something opens its fold when edited", async () => {
    renderForm({
      name: "Budget exhausted",
      thresholdPercentage: 0,
      whatWeDo: "Freeze releases.",
      shouldCreateIncident: true,
      incidentTitleTemplate: "Freeze: {{sloName}}",
    });

    await waitFor(() => {
      expect(fold()).toHaveAttribute("aria-expanded", "true");
    });
    expect(
      await screen.findByRole("textbox", { name: /^Incident Title/ }),
    ).toHaveValue("Freeze: {{sloName}}");
    expect(
      screen.queryByRole("textbox", { name: /^Alert Title/ }),
    ).not.toBeInTheDocument();
  });
});
