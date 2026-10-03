import BasicForm, {
  BasicFormHandle,
} from "../../../../UI/Components/Forms/BasicForm";
import Field, {
  CustomElementProps,
} from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import { getAdvancedFormSection } from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { JSONObject } from "../../../../Types/JSON";
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
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { createRef, ReactElement, RefObject, useEffect } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A stepped form on a page (Declare Incident, Create Monitor, a status page's
 * Subscribe) draws its own buttons. Once every step after the one on screen
 * is optional, its main button is the form's action and a plain Next sits
 * beside it; until then the main button reads Next and walks on, as before.
 *
 * The action checks every step (submitAllSteps), so a field on the step on
 * screen that is still empty is asked for right there. Steps not reached yet
 * stay closed in the step list, and there is still no Back button
 * (b61a6b656d).
 *
 * These drive the real BasicForm with nothing stubbed.
 */

const ACTION: string = "Declare Incident";

const DETAILS_STEP: FormStep<JSONObject> = {
  id: "details",
  title: "Incident Details",
};
const RESOURCES_STEP: FormStep<JSONObject> = {
  id: "resources",
  title: "Resources Affected",
};
const MORE_STEP: FormStep<JSONObject> = { id: "more", title: "More" };

const TITLE_FIELD: Field<JSONObject> = {
  field: { title: true },
  title: "Title",
  fieldType: FormFieldSchemaType.Text,
  stepId: DETAILS_STEP.id,
  required: true,
};

const KIND_FIELD: Field<JSONObject> = {
  field: { kind: true },
  title: "Kind",
  fieldType: FormFieldSchemaType.Text,
  stepId: DETAILS_STEP.id,
  required: false,
};

const SERVICE_FIELD: Field<JSONObject> = {
  field: { service: true },
  title: "Service",
  fieldType: FormFieldSchemaType.Text,
  stepId: RESOURCES_STEP.id,
  required: false,
};

const NOTIFY_FIELD: Field<JSONObject> = {
  field: { notifySubscribers: true },
  title: "Notify Status Page Subscribers",
  fieldType: FormFieldSchemaType.Checkbox,
  stepId: MORE_STEP.id,
  required: false,
  defaultValue: true,
};

const PRIVATE_FIELD: Field<JSONObject> = {
  field: { isPrivate: true },
  title: "Private Incident",
  fieldType: FormFieldSchemaType.Toggle,
  stepId: MORE_STEP.id,
  required: false,
};

const STEPS: Array<FormStep<JSONObject>> = [
  DETAILS_STEP,
  RESOURCES_STEP,
  MORE_STEP,
];

// Title on the first step; everything after it optional.
const FIELDS: Fields<JSONObject> = [
  TITLE_FIELD,
  KIND_FIELD,
  SERVICE_FIELD,
  NOTIFY_FIELD,
  PRIVATE_FIELD,
];

/*
 * A custom element that fills in a value of its own the moment it is drawn,
 * the way the monitor criteria editor seeds a monitor type's criteria and a
 * rule's conditions builder writes its starting conditions.
 */
function SelfFillingCriteria(props: CustomElementProps): ReactElement {
  useEffect(() => {
    props.onChange?.("seeded criteria");
  }, []);

  return <p>Criteria editor</p>;
}

const CRITERIA_FIELD: Field<JSONObject> = {
  field: { criteria: true },
  title: "Criteria",
  fieldType: FormFieldSchemaType.CustomComponent,
  stepId: RESOURCES_STEP.id,
  required: false,
  getCustomElement: (
    _values: FormValues<JSONObject>,
    props: CustomElementProps,
  ): ReactElement => {
    return <SelfFillingCriteria {...props} />;
  },
};

interface RenderOptions {
  fields?: Fields<JSONObject>;
  steps?: Array<FormStep<JSONObject>>;
  initialValues?: FormValues<JSONObject>;
  maxPrimaryButtonWidth?: boolean;
  summary?: boolean;
  hideSubmitButton?: boolean;
  onCanFinishFromCurrentStep?: (canFinish: boolean) => void;
}

interface Rendered {
  onSubmit: MockFunction;
  user: UserEvent;
  formRef: RefObject<BasicFormHandle>;
}

async function renderForm(options: RenderOptions = {}): Promise<Rendered> {
  const onSubmit: MockFunction = getJestMockFunction();
  const formRef: RefObject<BasicFormHandle> = createRef<BasicFormHandle>();

  render(
    <BasicForm
      id="declare-incident-form"
      ref={formRef}
      fields={options.fields || FIELDS}
      steps={options.steps || STEPS}
      initialValues={options.initialValues}
      onSubmit={onSubmit}
      submitButtonText={ACTION}
      disableAutofocus={true}
      maxPrimaryButtonWidth={options.maxPrimaryButtonWidth}
      summary={options.summary ? { enabled: true } : undefined}
      hideSubmitButton={options.hideSubmitButton}
      onCanFinishFromCurrentStep={options.onCanFinishFromCurrentStep}
    />,
  );

  // The first render draws every field; the first step opens in an effect.
  await screen.findByRole("navigation", { name: "Progress" });
  await act(async () => {});

  return { onSubmit, user: userEvent.setup({ delay: null }), formRef };
}

function progress(): HTMLElement {
  return screen.getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

function actionButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: ACTION });
}

function nextButton(): HTMLElement | null {
  return screen.queryByTestId("form-next-button");
}

// The one button that reads Next: the main one, or the plain one beside it.
function anyNextButton(): HTMLElement {
  return screen.getByRole("button", { name: "Next" });
}

async function typeTitle(value: string): Promise<void> {
  fireEvent.change(await screen.findByRole("textbox", { name: "Title" }), {
    target: { value },
  });
}

function submittedValues(onSubmit: MockFunction): JSONObject {
  return onSubmit.mock.calls[0]?.[0] as JSONObject;
}

describe("A stepped form on a page, finished from any step", () => {
  afterEach(() => {
    cleanup();
  });

  test("remaining steps valid shows the action on the first step, with a plain Next beside it", async () => {
    await renderForm();

    expect(activeStep()).toBe(DETAILS_STEP.title);
    expect(actionButton()).toBeVisible();
    expect(nextButton()).toBeVisible();
    expect(nextButton()).toHaveTextContent("Next");
    // Plain, like Cancel: the action stays the form's one primary button.
    expect(nextButton()!.className).toContain("bg-white");
    expect(actionButton()!.className).toContain("bg-indigo-600");
    // Next sits on the action's left, as in a dialog's footer.
    expect(
      nextButton()!.compareDocumentPosition(actionButton()!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the action submits every step's values from the first step, the untouched later ones at their defaults", async () => {
    const { onSubmit, user }: Rendered = await renderForm();

    await typeTitle("Checkout is down");
    await user.click(actionButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const values: JSONObject = submittedValues(onSubmit);

    expect(values["title"]).toBe("Checkout is down");
    // A later step's checkbox starts ticked and is sent ticked.
    expect(values["notifySubscribers"]).toBe(true);
    // A later step's switch, never touched, is sent off - as on the last step.
    expect(values["isPrivate"]).toBe(false);
    // Nothing walked: the form never left the first step.
    expect(activeStep()).toBe(DETAILS_STEP.title);
  });

  test("the action asks for an empty field on the step on screen, there, and submits nothing", async () => {
    const { onSubmit, user }: Rendered = await renderForm();

    await user.click(actionButton()!);

    expect(await screen.findByText("Title is required.")).toBeVisible();
    expect(activeStep()).toBe(DETAILS_STEP.title);
    expect(onSubmit).not.toHaveBeenCalled();

    // Answered, the same button finishes.
    await typeTitle("Checkout is down");
    await user.click(actionButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  test("Next walks on without submitting, and the action stays beside it to the last step, where Next goes", async () => {
    const { onSubmit, user }: Rendered = await renderForm();

    await typeTitle("Checkout is down");
    await user.click(nextButton()!);

    await waitFor(() => {
      expect(activeStep()).toBe(RESOURCES_STEP.title);
    });
    expect(actionButton()).toBeVisible();
    expect(nextButton()).toBeVisible();

    await user.click(nextButton()!);

    await waitFor(() => {
      expect(activeStep()).toBe(MORE_STEP.title);
    });
    expect(nextButton()).not.toBeInTheDocument();
    expect(actionButton()).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(actionButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  test("Next still checks the step on screen before it walks on", async () => {
    const { onSubmit, user }: Rendered = await renderForm();

    await user.click(nextButton()!);

    expect(await screen.findByText("Title is required.")).toBeVisible();
    expect(activeStep()).toBe(DETAILS_STEP.title);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("a required later field shows Next only, until its step is reached and answered", async () => {
    const { onSubmit, user }: Rendered = await renderForm({
      fields: [TITLE_FIELD, { ...SERVICE_FIELD, required: true }, NOTIFY_FIELD],
    });

    expect(actionButton()).not.toBeInTheDocument();
    expect(nextButton()).not.toBeInTheDocument();
    expect(anyNextButton()).toBeVisible();

    await typeTitle("Checkout is down");
    // Answering this step does not make the later required field optional.
    expect(actionButton()).not.toBeInTheDocument();

    await user.click(anyNextButton());

    await waitFor(() => {
      expect(activeStep()).toBe(RESOURCES_STEP.title);
    });

    // On the step that asks for it, the step left (More) is optional.
    expect(actionButton()).toBeVisible();
    expect(nextButton()).toBeVisible();

    await user.click(actionButton()!);

    expect(await screen.findByText("Service is required.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "Service" }), {
      target: { value: "checkout" },
    });
    await user.click(actionButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(submittedValues(onSubmit)["service"]).toBe("checkout");
  });

  test("an answer that brings a step with a required field into view takes the action away, and undoing it gives it back", async () => {
    const isBrowser: (values: FormValues<JSONObject>) => boolean = (
      values: FormValues<JSONObject>,
    ): boolean => {
      return values["kind"] === "browser";
    };

    await renderForm({
      steps: [
        DETAILS_STEP,
        { id: "browser", title: "Browser Settings", showIf: isBrowser },
        MORE_STEP,
      ],
      fields: [
        TITLE_FIELD,
        KIND_FIELD,
        {
          field: { origin: true },
          title: "Origin",
          fieldType: FormFieldSchemaType.Text,
          stepId: "browser",
          showIf: isBrowser,
          required: true,
        },
        NOTIFY_FIELD,
      ],
    });

    expect(actionButton()).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: /^Kind/ }), {
      target: { value: "browser" },
    });

    await waitFor(() => {
      expect(actionButton()).not.toBeInTheDocument();
    });
    expect(anyNextButton()).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: /^Kind/ }), {
      target: { value: "server" },
    });

    await waitFor(() => {
      expect(actionButton()).toBeVisible();
    });
  });

  test("a step not reached yet stays closed in the step list, even with the action on offer", async () => {
    const { user }: Rendered = await renderForm();

    expect(actionButton()).toBeVisible();

    await user.click(within(progress()).getByText(MORE_STEP.title));

    expect(activeStep()).toBe(DETAILS_STEP.title);
    expect(
      screen.queryByRole("checkbox", { name: /Notify Status Page/ }),
    ).not.toBeInTheDocument();
  });

  test("adds no Back button, on any step (b61a6b656d)", async () => {
    const { user }: Rendered = await renderForm();

    await typeTitle("Checkout is down");

    for (const step of [RESOURCES_STEP, MORE_STEP]) {
      expect(
        screen.queryByRole("button", { name: "Back" }),
      ).not.toBeInTheDocument();
      await user.click(nextButton()!);
      await waitFor(() => {
        expect(activeStep()).toBe(step.title);
      });
    }

    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });

  test("a completed step reopened from the step list offers the action too", async () => {
    const { onSubmit, user }: Rendered = await renderForm();

    await typeTitle("Checkout is down");
    await user.click(nextButton()!);
    await waitFor(() => {
      expect(activeStep()).toBe(RESOURCES_STEP.title);
    });
    fireEvent.change(screen.getByRole("textbox", { name: /^Service/ }), {
      target: { value: "checkout" },
    });

    await user.click(within(progress()).getByText(DETAILS_STEP.title));
    await waitFor(() => {
      expect(activeStep()).toBe(DETAILS_STEP.title);
    });

    expect(actionButton()).toBeVisible();
    await user.click(actionButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(submittedValues(onSubmit)["service"]).toBe("checkout");
  });

  describe("a custom element that fills in a value of its own", () => {
    test("counts as unfinished until its step has been shown: Next only on the steps before it", async () => {
      await renderForm({
        fields: [TITLE_FIELD, CRITERIA_FIELD, NOTIFY_FIELD],
      });

      await typeTitle("Checkout is down");

      expect(actionButton()).not.toBeInTheDocument();
      expect(nextButton()).not.toBeInTheDocument();
      expect(anyNextButton()).toBeVisible();
    });

    test("offers the action from its own step on, and the value it filled in is submitted", async () => {
      const { onSubmit, user }: Rendered = await renderForm({
        fields: [TITLE_FIELD, CRITERIA_FIELD, NOTIFY_FIELD],
      });

      await typeTitle("Checkout is down");
      await user.click(anyNextButton());

      expect(await screen.findByText("Criteria editor")).toBeVisible();
      await waitFor(() => {
        expect(actionButton()).toBeVisible();
      });
      expect(nextButton()).toBeVisible();

      // Shown once, it no longer holds the first step up either.
      await user.click(within(progress()).getByText(DETAILS_STEP.title));
      await waitFor(() => {
        expect(activeStep()).toBe(DETAILS_STEP.title);
      });
      expect(actionButton()).toBeVisible();

      await user.click(actionButton()!);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      expect(submittedValues(onSubmit)["criteria"]).toBe("seeded criteria");
    });

    test("one marked customElementCanBeSkipped is skipped: it never draws, so it fills nothing in", async () => {
      const { onSubmit, user }: Rendered = await renderForm({
        fields: [
          TITLE_FIELD,
          { ...CRITERIA_FIELD, customElementCanBeSkipped: true },
          NOTIFY_FIELD,
        ],
      });

      await typeTitle("Checkout is down");
      expect(actionButton()).toBeVisible();

      await user.click(actionButton()!);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      expect(submittedValues(onSubmit)["criteria"]).toBeUndefined();
      expect(screen.queryByText("Criteria editor")).not.toBeInTheDocument();
    });
  });

  test("the action opens a folded Advanced section on the step on screen when a field in it fails", async () => {
    const advanced: ReturnType<typeof getAdvancedFormSection> =
      getAdvancedFormSection<JSONObject>();

    const { onSubmit, user }: Rendered = await renderForm({
      fields: [
        TITLE_FIELD,
        {
          field: { reference: true },
          title: "Reference",
          fieldType: FormFieldSchemaType.Text,
          stepId: DETAILS_STEP.id,
          required: false,
          validation: { minLength: 5 },
          collapsibleSection: advanced,
        },
        NOTIFY_FIELD,
      ],
      initialValues: { title: "Checkout is down", reference: "ab" },
    });

    const header: HTMLElement = await screen.findByRole("button", {
      name: /Advanced/,
    });
    expect(header).toHaveAttribute("aria-expanded", "false");

    await user.click(actionButton()!);

    await waitFor(() => {
      expect(header).toHaveAttribute("aria-expanded", "true");
    });
    expect(
      await screen.findByText("Reference cannot be less than 5 characters."),
    ).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("with a summary step: the last real step offers the action, and Next goes on to the summary", async () => {
    const { onSubmit, user }: Rendered = await renderForm({
      steps: [DETAILS_STEP, RESOURCES_STEP],
      fields: [TITLE_FIELD, { ...SERVICE_FIELD, required: true }],
      summary: true,
    });

    await typeTitle("Checkout is down");
    await user.click(anyNextButton());
    await waitFor(() => {
      expect(activeStep()).toBe(RESOURCES_STEP.title);
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Service" }), {
      target: { value: "checkout" },
    });

    expect(actionButton()).toBeVisible();
    await user.click(nextButton()!);

    await waitFor(() => {
      expect(activeStep()).toBe("Summary");
    });
    expect(nextButton()).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(actionButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  test("on a form whose action spans it (a status page's Subscribe), Next sits under the action, as wide", async () => {
    await renderForm({ maxPrimaryButtonWidth: true });

    const action: HTMLElement = actionButton()!;
    const next: HTMLElement = nextButton()!;

    expect(
      action.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(action.style.width).toBe("100%");
    expect(next.style.width).toBe("100%");
    expect(next.style.marginLeft).toBe("0px");
    expect(next.parentElement?.parentElement).toHaveClass("flex-col");
  });

  test("a form without steps is unchanged: the action, and no Next", async () => {
    render(
      <BasicForm
        id="single-page-form"
        fields={[{ ...TITLE_FIELD, stepId: undefined }]}
        onSubmit={getJestMockFunction()}
        submitButtonText={ACTION}
        disableAutofocus={true}
      />,
    );

    await screen.findByRole("textbox", { name: "Title" });
    await act(async () => {});

    expect(actionButton()).toBeVisible();
    expect(nextButton()).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  describe("a host that draws its own buttons (hideSubmitButton)", () => {
    test("is told whether the form can be finished from the step on screen", async () => {
      const reported: Array<boolean> = [];

      const { formRef, onSubmit }: Rendered = await renderForm({
        hideSubmitButton: true,
        fields: [TITLE_FIELD, CRITERIA_FIELD, NOTIFY_FIELD],
        onCanFinishFromCurrentStep: (canFinish: boolean): void => {
          reported.push(canFinish);
        },
      });

      expect(actionButton()).not.toBeInTheDocument();
      expect(nextButton()).not.toBeInTheDocument();
      expect(reported[reported.length - 1]).toBe(false);

      await typeTitle("Checkout is down");
      act(() => {
        formRef.current?.submitForm();
      });

      expect(await screen.findByText("Criteria editor")).toBeVisible();
      await waitFor(() => {
        expect(reported[reported.length - 1]).toBe(true);
      });

      act(() => {
        formRef.current?.submitAllSteps();
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
    });

    test("goToNextStep walks like Next and never submits: on the last step it does nothing", async () => {
      const { formRef, onSubmit }: Rendered = await renderForm({
        hideSubmitButton: true,
        steps: [DETAILS_STEP, MORE_STEP],
        fields: [TITLE_FIELD, NOTIFY_FIELD],
      });

      // It checks the step on screen first, as Next does.
      act(() => {
        formRef.current?.goToNextStep();
      });
      expect(await screen.findByText("Title is required.")).toBeVisible();
      expect(activeStep()).toBe(DETAILS_STEP.title);

      await typeTitle("Checkout is down");
      act(() => {
        formRef.current?.goToNextStep();
      });
      await waitFor(() => {
        expect(activeStep()).toBe(MORE_STEP.title);
      });

      // A second press landing on the last step: still nothing submitted.
      act(() => {
        formRef.current?.goToNextStep();
      });
      await act(async () => {});
      expect(onSubmit).not.toHaveBeenCalled();
      expect(activeStep()).toBe(MORE_STEP.title);

      // submitForm, the main button's walk, submits there.
      act(() => {
        formRef.current?.submitForm();
      });
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
    });

    test("is told false on the last step, where the action is the only button anyway", async () => {
      const reported: Array<boolean> = [];

      const { formRef }: Rendered = await renderForm({
        hideSubmitButton: true,
        steps: [DETAILS_STEP, MORE_STEP],
        fields: [TITLE_FIELD, NOTIFY_FIELD],
        onCanFinishFromCurrentStep: (canFinish: boolean): void => {
          reported.push(canFinish);
        },
      });

      await waitFor(() => {
        expect(reported[reported.length - 1]).toBe(true);
      });

      await typeTitle("Checkout is down");
      act(() => {
        formRef.current?.submitForm();
      });

      await waitFor(() => {
        expect(activeStep()).toBe(MORE_STEP.title);
      });
      await waitFor(() => {
        expect(reported[reported.length - 1]).toBe(false);
      });
    });
  });
});
