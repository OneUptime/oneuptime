import {
  BURN_RATE_RULE_FORM_FIELDS,
  BURN_RATE_RULE_FORM_STEPS,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleForm";
import ServiceLevelObjectiveBurnRateRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Email from "../../../../Types/Email";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import {
  DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
} from "../../../../Utils/Slo/SloBurnRateTemplate";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

type BurnRateValues = FormValues<ServiceLevelObjectiveBurnRateRule>;

const TEMPLATE_FIELDS: Fields<ServiceLevelObjectiveBurnRateRule> =
  BURN_RATE_RULE_FORM_FIELDS.filter(
    (field: Field<ServiceLevelObjectiveBurnRateRule>): boolean => {
      return [
        "alertTitleTemplate",
        "alertDescriptionTemplate",
        "incidentTitleTemplate",
        "incidentDescriptionTemplate",
      ].includes(Object.keys(field.field || {})[0] || "");
    },
  );

const OUTPUT_STEPS: Array<FormStep<ServiceLevelObjectiveBurnRateRule>> =
  BURN_RATE_RULE_FORM_STEPS.filter(
    (step: FormStep<ServiceLevelObjectiveBurnRateRule>): boolean => {
      return step.id === "alert-details" || step.id === "incident-details";
    },
  );

const DEFAULT_TEMPLATES: BurnRateValues = {
  alertTitleTemplate: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
  alertDescriptionTemplate: DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
  incidentTitleTemplate: DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
  incidentDescriptionTemplate: DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
};

interface FormOptions {
  initialValues?: BurnRateValues;
  fields?: Fields<ServiceLevelObjectiveBurnRateRule>;
}

interface FormResult extends RenderResult {
  onSubmit: MockFunction;
  user: UserEvent;
  view: (options?: FormOptions) => ReactElement;
}

function renderForm(options: FormOptions = {}): FormResult {
  const onSubmit: MockFunction = getJestMockFunction();
  const view: (overrides?: FormOptions) => ReactElement = (
    overrides: FormOptions = options,
  ): ReactElement => {
    return (
      <BasicForm
        id="burn-rate-template-defaults"
        fields={overrides.fields || TEMPLATE_FIELDS}
        steps={OUTPUT_STEPS}
        initialValues={{
          shouldCreateAlert: true,
          shouldCreateIncident: true,
          ...overrides.initialValues,
        }}
        onSubmit={onSubmit}
        submitButtonText="Save Rule"
        disableAutofocus={true}
      />
    );
  };

  return {
    ...render(view()),
    onSubmit,
    view,
    user: userEvent.setup({ delay: null }),
  };
}

async function next(
  user: UserEvent,
  expectedTitle: string = DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => {
    expect(
      screen.getByRole("textbox", { name: /^Incident Title/ }),
    ).toHaveValue(expectedTitle);
  });
}

async function returnToAlert(user: UserEvent): Promise<void> {
  await user.click(
    within(screen.getByRole("navigation", { name: "Progress" })).getByText(
      "Alert",
    ),
  );
  await screen.findByRole("textbox", { name: /^Alert Title/ });
}

async function descriptionSource(user: UserEvent): Promise<HTMLElement> {
  await user.click(
    screen.getByRole("button", { name: "Markdown", exact: true }),
  );
  return screen.getByRole("textbox", { name: /Description/ });
}

describe("BasicForm burn-rate template defaults", () => {
  afterEach(() => {
    cleanup();
  });

  test("prefills and submits all four actual template fields while opening their descriptions", async () => {
    const { user, onSubmit }: FormResult = renderForm();

    expect(
      await screen.findByRole("textbox", { name: /^Alert Title/ }),
    ).toHaveValue(DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE);
    expect(screen.getByRole("button", { name: "Description" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("textbox", { name: /^Alert Description/ }),
    ).toHaveTextContent(DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE);

    await next(user);

    expect(
      screen.getByRole("textbox", { name: /^Incident Title/ }),
    ).toHaveValue(DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE);
    expect(screen.getByRole("button", { name: "Description" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("textbox", { name: /^Incident Description/ }),
    ).toHaveTextContent(DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE);
    await user.click(screen.getByRole("button", { name: "Save Rule" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining(DEFAULT_TEMPLATES),
      expect.any(Function),
    );
  });

  test("preserves distinct existing title and Markdown templates on both steps", async () => {
    const initialValues: BurnRateValues = {
      alertTitleTemplate: "Alert: {{sloName}}",
      alertDescriptionTemplate: "## Alert response\n\nInspect {{ruleName}}.",
      incidentTitleTemplate: "Incident: {{ruleName}}",
      incidentDescriptionTemplate:
        "## Incident response\n\nEscalate {{sloName}}.",
    };
    const { user, onSubmit }: FormResult = renderForm({ initialValues });

    expect(
      await screen.findByRole("textbox", { name: /^Alert Title/ }),
    ).toHaveValue(initialValues.alertTitleTemplate);
    expect(await descriptionSource(user)).toHaveValue(
      initialValues.alertDescriptionTemplate,
    );
    await next(user, initialValues.incidentTitleTemplate);
    expect(
      screen.getByRole("textbox", { name: /^Incident Title/ }),
    ).toHaveValue(initialValues.incidentTitleTemplate);
    expect(await descriptionSource(user)).toHaveValue(
      initialValues.incidentDescriptionTemplate,
    );
    await user.click(screen.getByRole("button", { name: "Save Rule" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining(initialValues),
      expect.any(Function),
    );
  });

  test.each(["", null])(
    "preserves explicitly empty %p templates when editing",
    async (empty: string | null) => {
      const initialValues: BurnRateValues = {
        alertTitleTemplate: empty,
        alertDescriptionTemplate: empty,
        incidentTitleTemplate: empty,
        incidentDescriptionTemplate: empty,
      } as unknown as BurnRateValues;
      const { user, onSubmit }: FormResult = renderForm({ initialValues });

      expect(
        await screen.findByRole("textbox", { name: /^Alert Title/ }),
      ).toHaveValue("");
      expect(
        screen.getByRole("button", { name: "Description" }),
      ).toHaveAttribute("aria-expanded", "false");
      await user.click(screen.getByRole("button", { name: "Description" }));
      expect(
        screen.getByRole("textbox", { name: /^Alert Description/ }),
      ).toBeEmptyDOMElement();
      await next(user, "");
      expect(
        screen.getByRole("textbox", { name: /^Incident Title/ }),
      ).toHaveValue("");
      expect(
        screen.getByRole("button", { name: "Description" }),
      ).toHaveAttribute("aria-expanded", "false");
      await user.click(screen.getByRole("button", { name: "Save Rule" }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining(initialValues),
        expect.any(Function),
      );
    },
  );

  test("keeps cleared defaults empty through collapse, later initial values, and step navigation", async () => {
    const { user, onSubmit, rerender, view }: FormResult = renderForm();
    await screen.findByRole("textbox", { name: /^Alert Title/ });
    fireEvent.change(screen.getByRole("textbox", { name: /^Alert Title/ }), {
      target: { value: "" },
    });
    const source: HTMLElement = await descriptionSource(user);
    fireEvent.change(source, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Description" }));

    rerender(
      view({ initialValues: DEFAULT_TEMPLATES, fields: [...TEMPLATE_FIELDS] }),
    );

    expect(source).not.toBeVisible();
    expect(source).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Description" }));
    expect(screen.getByRole("textbox", { name: /^Alert Description/ })).toBe(
      source,
    );
    expect(source).toHaveValue("");
    await next(user);
    expect(
      screen.getByRole("textbox", { name: /^Incident Title/ }),
    ).toHaveValue(DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE);
    expect(
      screen.getByRole("textbox", { name: /^Incident Description/ }),
    ).toHaveTextContent(DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE);
    await returnToAlert(user);

    expect(screen.getByRole("textbox", { name: /^Alert Title/ })).toHaveValue(
      "",
    );
    expect(screen.getByRole("button", { name: "Description" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "Description" }));
    expect(
      screen.getByRole("textbox", { name: /^Alert Description/ }),
    ).toBeEmptyDOMElement();
    await next(user);
    await user.click(screen.getByRole("button", { name: "Save Rule" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        ...DEFAULT_TEMPLATES,
        alertTitleTemplate: "",
        alertDescriptionTemplate: "",
      }),
      expect.any(Function),
    );
  }, 120000);

  test("uses asynchronously supplied edit data before field initialization and defaults only missing values", async () => {
    const { user, onSubmit, rerender, view }: FormResult = renderForm({
      fields: [],
    });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const initialValues: BurnRateValues = {
      alertTitleTemplate: "Loaded alert title",
      alertDescriptionTemplate: "",
      incidentTitleTemplate: "Loaded incident title",
    };

    rerender(view({ initialValues, fields: [] }));
    rerender(view({ initialValues, fields: TEMPLATE_FIELDS }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /^Alert Title/ })).toHaveValue(
        "Loaded alert title",
      );
    });
    expect(screen.getByRole("button", { name: "Description" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await next(user, "Loaded incident title");
    expect(
      screen.getByRole("textbox", { name: /^Incident Title/ }),
    ).toHaveValue("Loaded incident title");
    expect(
      screen.getByRole("textbox", { name: /^Incident Description/ }),
    ).toHaveTextContent(DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE);
    await user.click(screen.getByRole("button", { name: "Save Rule" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        ...initialValues,
        incidentDescriptionTemplate: DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
      }),
      expect.any(Function),
    );
  });

  test("preserves a stored numeric zero instead of displaying the field default", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    const user: UserEvent = userEvent.setup({ delay: null });
    render(
      <BasicForm
        fields={[
          {
            field: { threshold: true },
            title: "Threshold",
            fieldType: FormFieldSchemaType.Number,
            defaultValue: 9,
          },
        ]}
        initialValues={{ threshold: 0 }}
        onSubmit={onSubmit}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("spinbutton", { name: /^Threshold/ }),
      ).toHaveValue(0);
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith(
      { threshold: 0 },
      expect.any(Function),
    );
  });

  test("keeps model Email wrappers visible through the same generic input branch", async () => {
    const email: Email = new Email("saved.owner@example.com");
    const onSubmit: MockFunction = getJestMockFunction();
    const user: UserEvent = userEvent.setup({ delay: null });
    render(
      <BasicForm
        fields={[
          {
            field: { email: true },
            title: "Email",
            fieldType: FormFieldSchemaType.Email,
          },
        ]}
        initialValues={{ email }}
        onSubmit={onSubmit}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /^Email/ })).toHaveValue(
        email.toString(),
      );
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith(
      { email: email.toString() },
      expect.any(Function),
    );
  });
});
