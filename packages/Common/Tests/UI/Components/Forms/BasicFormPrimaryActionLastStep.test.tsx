import BasicForm, {
  BasicFormHandle,
} from "../../../../UI/Components/Forms/BasicForm";
import Field from "../../../../UI/Components/Forms/Types/Field";
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
import React, { createRef, RefObject } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * "In multi-step form. Please dont have the primary save button on any step
 * except the last. For example, do not show Declare Incident on the first
 * step, it should always be on the last step. Next button should never be
 * primary color as well." - the maintainer, 2026-10-04.
 *
 * A stepped form on a page (Declare Incident, Create Monitor, a status
 * page's Subscribe) draws its own buttons: a plain Next on every step but
 * the last, and the form's action - its one primary button - on the last
 * step only. The action checks every step, and opens the first one with a
 * problem. Enter in a field walks on until the last step. There is still no
 * Back button (b61a6b656d).
 *
 * These drive the real BasicForm with nothing stubbed.
 */

const ACTION: string = "Declare Incident";

const PRIMARY_CLASS: string = "bg-indigo-600";
const PLAIN_CLASS: string = "bg-white";

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

// Asked for on the first step only once Private is switched on, two steps on.
const REASON_FIELD: Field<JSONObject> = {
  field: { reason: true },
  title: "Reason",
  fieldType: FormFieldSchemaType.Text,
  stepId: DETAILS_STEP.id,
  required: (values: FormValues<JSONObject>): boolean => {
    return Boolean(values["isPrivate"]);
  },
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

const NOTE_FIELD: Field<JSONObject> = {
  field: { note: true },
  title: "Note",
  fieldType: FormFieldSchemaType.Text,
  stepId: MORE_STEP.id,
  required: false,
};

const STEPS: Array<FormStep<JSONObject>> = [
  DETAILS_STEP,
  RESOURCES_STEP,
  MORE_STEP,
];

const FIELDS: Fields<JSONObject> = [
  TITLE_FIELD,
  REASON_FIELD,
  SERVICE_FIELD,
  NOTIFY_FIELD,
  PRIVATE_FIELD,
  NOTE_FIELD,
];

interface RenderOptions {
  fields?: Fields<JSONObject>;
  steps?: Array<FormStep<JSONObject>>;
  initialValues?: FormValues<JSONObject>;
  maxPrimaryButtonWidth?: boolean;
  summary?: boolean;
  hideSubmitButton?: boolean;
  onIsLastFormStep?: (isLast: boolean) => void;
  onCancel?: () => void;
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
      onIsLastFormStep={options.onIsLastFormStep}
      onCancel={options.onCancel}
    />,
  );

  /*
   * The fields arrive in an effect, and the first step opens in another:
   * wait for a field, then let the effects settle.
   */
  await screen.findByRole("textbox", { name: "Title" });
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

// Every button the form draws in the primary colour.
function primaryButtons(): Array<HTMLElement> {
  return screen.queryAllByRole("button").filter((button: HTMLElement) => {
    return button.className.split(/\s+/).includes(PRIMARY_CLASS);
  });
}

async function typeInto(name: string | RegExp, value: string): Promise<void> {
  fireEvent.change(await screen.findByRole("textbox", { name }), {
    target: { value },
  });
}

async function walkTo(user: UserEvent, step: FormStep<JSONObject>) {
  await user.click(nextButton()!);
  await waitFor(() => {
    expect(activeStep()).toBe(step.title);
  });
}

function submittedValues(onSubmit: MockFunction): JSONObject {
  return onSubmit.mock.calls[0]?.[0] as JSONObject;
}

function pressEnterIn(name: string | RegExp): void {
  fireEvent.keyDown(screen.getByRole("textbox", { name }), {
    key: "Enter",
    code: "Enter",
  });
}

describe("A stepped form on a page", () => {
  afterEach(() => {
    cleanup();
  });

  test("the first step offers a plain Next and no action - nothing primary", async () => {
    await renderForm();

    expect(activeStep()).toBe(DETAILS_STEP.title);
    expect(actionButton()).not.toBeInTheDocument();
    expect(nextButton()).toBeVisible();
    expect(nextButton()).toHaveTextContent("Next");
    expect(nextButton()!.className).toContain(PLAIN_CLASS);
    expect(nextButton()!.className).not.toContain(PRIMARY_CLASS);
    expect(nextButton()).toHaveAttribute("id", "declare-incident-form-next-button");
    expect(primaryButtons()).toEqual([]);
  });

  test("every step but the last walks with a plain Next; the last offers the action alone, in the primary colour", async () => {
    const { onSubmit, user }: Rendered = await renderForm();

    await typeInto("Title", "Checkout is down");
    await walkTo(user, RESOURCES_STEP);

    expect(actionButton()).not.toBeInTheDocument();
    expect(nextButton()).toBeVisible();
    expect(primaryButtons()).toEqual([]);

    await walkTo(user, MORE_STEP);

    expect(nextButton()).not.toBeInTheDocument();
    expect(actionButton()).toBeVisible();
    expect(actionButton()!.className).toContain(PRIMARY_CLASS);
    expect(actionButton()).toHaveAttribute(
      "id",
      "declare-incident-form-submit-button",
    );
    expect(actionButton()).toHaveAttribute("data-testid", ACTION);
    expect(primaryButtons()).toEqual([actionButton()]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("Next checks the step on screen before it walks on, and never submits", async () => {
    const { onSubmit, user }: Rendered = await renderForm();

    await user.click(nextButton()!);

    expect(await screen.findByText("Title is required.")).toBeVisible();
    expect(activeStep()).toBe(DETAILS_STEP.title);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("the action on the last step submits what every step holds, the untouched answers at their defaults", async () => {
    const { onSubmit, user }: Rendered = await renderForm();

    await typeInto("Title", "Checkout is down");
    await walkTo(user, RESOURCES_STEP);
    await typeInto(/^Service/, "checkout");
    await walkTo(user, MORE_STEP);

    await user.click(actionButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const values: JSONObject = submittedValues(onSubmit);

    expect(values["title"]).toBe("Checkout is down");
    expect(values["service"]).toBe("checkout");
    // A checkbox that starts ticked is sent ticked.
    expect(values["notifySubscribers"]).toBe(true);
    // A switch never touched is sent off.
    expect(values["isPrivate"]).toBe(false);
  });

  test("the action checks every step, and opens an earlier one whose answer is now missing", async () => {
    const { onSubmit, user }: Rendered = await renderForm();

    await typeInto("Title", "Checkout is down");
    await walkTo(user, RESOURCES_STEP);
    await walkTo(user, MORE_STEP);

    // Private makes the first step's Reason required.
    await user.click(screen.getByRole("switch", { name: /Private Incident/ }));
    await user.click(actionButton()!);

    await waitFor(() => {
      expect(activeStep()).toBe(DETAILS_STEP.title);
    });
    expect(await screen.findByText("Reason is required.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();

    // Back on the first step: Next again, not the action.
    expect(actionButton()).not.toBeInTheDocument();
    expect(nextButton()).toBeVisible();

    await typeInto(/^Reason/, "Customer data");
    await walkTo(user, RESOURCES_STEP);
    await walkTo(user, MORE_STEP);
    await user.click(actionButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(submittedValues(onSubmit)["reason"]).toBe("Customer data");
    expect(submittedValues(onSubmit)["isPrivate"]).toBe(true);
  });

  describe("Enter in a field", () => {
    test("walks on from a step that is not the last, and never submits", async () => {
      const { onSubmit }: Rendered = await renderForm();

      await typeInto("Title", "Checkout is down");
      pressEnterIn("Title");

      await waitFor(() => {
        expect(activeStep()).toBe(RESOURCES_STEP.title);
      });

      await typeInto(/^Service/, "checkout");
      pressEnterIn(/^Service/);

      await waitFor(() => {
        expect(activeStep()).toBe(MORE_STEP.title);
      });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    test("checks the step on screen first, as Next does", async () => {
      const { onSubmit }: Rendered = await renderForm();

      pressEnterIn("Title");

      expect(await screen.findByText("Title is required.")).toBeVisible();
      expect(activeStep()).toBe(DETAILS_STEP.title);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    test("submits from the last step, after checking every step", async () => {
      const { onSubmit, user }: Rendered = await renderForm();

      await typeInto("Title", "Checkout is down");
      await walkTo(user, RESOURCES_STEP);
      await walkTo(user, MORE_STEP);

      await user.click(
        screen.getByRole("switch", { name: /Private Incident/ }),
      );
      await typeInto(/^Note/, "Rolled back");
      pressEnterIn(/^Note/);

      // The first step's Reason is now missing: shown, not skipped.
      await waitFor(() => {
        expect(activeStep()).toBe(DETAILS_STEP.title);
      });
      expect(await screen.findByText("Reason is required.")).toBeVisible();
      expect(onSubmit).not.toHaveBeenCalled();

      // Enter there walks on again; it does not submit from the first step.
      await typeInto(/^Reason/, "Customer data");
      pressEnterIn(/^Reason/);
      await waitFor(() => {
        expect(activeStep()).toBe(RESOURCES_STEP.title);
      });
      expect(onSubmit).not.toHaveBeenCalled();

      await walkTo(user, MORE_STEP);
      pressEnterIn(/^Note/);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      expect(submittedValues(onSubmit)["note"]).toBe("Rolled back");
      expect(submittedValues(onSubmit)["reason"]).toBe("Customer data");
    });
  });

  test("a step reopened from the step list shows Next again, not the action", async () => {
    const { user }: Rendered = await renderForm();

    await typeInto("Title", "Checkout is down");
    await walkTo(user, RESOURCES_STEP);
    await walkTo(user, MORE_STEP);
    expect(actionButton()).toBeVisible();

    await user.click(within(progress()).getByText(DETAILS_STEP.title));
    await waitFor(() => {
      expect(activeStep()).toBe(DETAILS_STEP.title);
    });

    expect(actionButton()).not.toBeInTheDocument();
    expect(nextButton()).toBeVisible();
  });

  test("a step not reached yet stays closed in the step list", async () => {
    const { user }: Rendered = await renderForm();

    await user.click(within(progress()).getByText(MORE_STEP.title));

    expect(activeStep()).toBe(DETAILS_STEP.title);
    expect(actionButton()).not.toBeInTheDocument();
  });

  test("adds no Back button, on any step (b61a6b656d)", async () => {
    const { user }: Rendered = await renderForm();

    await typeInto("Title", "Checkout is down");

    for (const step of [RESOURCES_STEP, MORE_STEP]) {
      expect(
        screen.queryByRole("button", { name: "Back" }),
      ).not.toBeInTheDocument();
      await walkTo(user, step);
    }

    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });

  test("an answer that brings a later step into view takes the action away from the step that was last", async () => {
    const isBrowser: (values: FormValues<JSONObject>) => boolean = (
      values: FormValues<JSONObject>,
    ): boolean => {
      return values["kind"] === "browser";
    };

    const { onSubmit, user }: Rendered = await renderForm({
      steps: [
        DETAILS_STEP,
        { id: "browser", title: "Browser Settings", showIf: isBrowser },
      ],
      fields: [
        TITLE_FIELD,
        {
          field: { kind: true },
          title: "Kind",
          fieldType: FormFieldSchemaType.Text,
          stepId: DETAILS_STEP.id,
          required: false,
        },
        {
          field: { origin: true },
          title: "Origin",
          fieldType: FormFieldSchemaType.Text,
          stepId: "browser",
          showIf: isBrowser,
          required: true,
        },
      ],
      initialValues: { title: "Checkout is down" },
    });

    // One step to walk: the action.
    await waitFor(() => {
      expect(actionButton()).toBeVisible();
    });
    expect(nextButton()).not.toBeInTheDocument();

    await typeInto(/^Kind/, "browser");

    await waitFor(() => {
      expect(actionButton()).not.toBeInTheDocument();
    });
    expect(nextButton()).toBeVisible();

    await walkTo(user, { id: "browser", title: "Browser Settings" });
    expect(actionButton()).toBeVisible();

    await typeInto(/^Origin/, "https://example.com");
    await user.click(actionButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(submittedValues(onSubmit)["origin"]).toBe("https://example.com");
  });

  test("a failing field in a folded section on another step opens that step and its section", async () => {
    const advanced: ReturnType<typeof getAdvancedFormSection> =
      getAdvancedFormSection<JSONObject>();

    const { onSubmit, user }: Rendered = await renderForm({
      steps: [DETAILS_STEP, MORE_STEP],
      fields: [
        TITLE_FIELD,
        {
          field: { reference: true },
          title: "Reference",
          fieldType: FormFieldSchemaType.Text,
          stepId: DETAILS_STEP.id,
          required: (values: FormValues<JSONObject>): boolean => {
            return Boolean(values["isPrivate"]);
          },
          collapsibleSection: advanced,
        },
        PRIVATE_FIELD,
      ],
      initialValues: { title: "Checkout is down" },
    });

    await walkTo(user, MORE_STEP);
    await user.click(screen.getByRole("switch", { name: /Private Incident/ }));
    await user.click(actionButton()!);

    await waitFor(() => {
      expect(activeStep()).toBe(DETAILS_STEP.title);
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Advanced/ }),
      ).toHaveAttribute("aria-expanded", "true");
    });
    expect(await screen.findByText("Reference is required.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("with a summary step: Next to the summary, and the action only there", async () => {
    const { onSubmit, user }: Rendered = await renderForm({
      steps: [DETAILS_STEP, RESOURCES_STEP],
      fields: [TITLE_FIELD, SERVICE_FIELD],
      summary: true,
    });

    await typeInto("Title", "Checkout is down");
    await walkTo(user, RESOURCES_STEP);

    expect(actionButton()).not.toBeInTheDocument();
    expect(nextButton()).toBeVisible();

    await walkTo(user, { id: "summary", title: "Summary" });

    expect(nextButton()).not.toBeInTheDocument();
    expect(actionButton()).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(actionButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  test("where the action spans the form (a status page's Subscribe), Next spans it too, until the last step", async () => {
    const { user }: Rendered = await renderForm({
      steps: [DETAILS_STEP, MORE_STEP],
      fields: [TITLE_FIELD, NOTIFY_FIELD],
      maxPrimaryButtonWidth: true,
    });

    expect(actionButton()).not.toBeInTheDocument();
    expect(nextButton()!.style.width).toBe("100%");
    expect(nextButton()!.style.marginLeft).toBe("0px");
    expect(nextButton()!.className).not.toContain(PRIMARY_CLASS);

    await typeInto("Title", "Checkout is down");
    await walkTo(user, MORE_STEP);

    expect(nextButton()).not.toBeInTheDocument();
    expect(actionButton()!.style.width).toBe("100%");
    expect(actionButton()!.className).toContain(PRIMARY_CLASS);
  });

  test("Cancel stays plain on every step", async () => {
    const onCancel: MockFunction = getJestMockFunction();
    const { user }: Rendered = await renderForm({
      steps: [DETAILS_STEP, MORE_STEP],
      fields: [TITLE_FIELD, NOTIFY_FIELD],
      onCancel,
    });

    const cancel: HTMLElement = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.className).toContain(PLAIN_CLASS);
    expect(primaryButtons()).toEqual([]);

    await typeInto("Title", "Checkout is down");
    await walkTo(user, MORE_STEP);

    expect(primaryButtons()).toEqual([actionButton()]);
  });

  test("a form without steps is one page: the action, and no Next", async () => {
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <BasicForm
        id="single-page-form"
        fields={[{ ...TITLE_FIELD, stepId: undefined }]}
        onSubmit={onSubmit}
        submitButtonText={ACTION}
        disableAutofocus={true}
      />,
    );

    await screen.findByRole("textbox", { name: "Title" });
    await act(async () => {});

    expect(actionButton()).toBeVisible();
    expect(nextButton()).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    await typeInto("Title", "Checkout is down");
    pressEnterIn("Title");

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  test("a form whose other steps are hidden is one page too: the action, and no Next", async () => {
    await renderFormWithOneVisibleStep();

    expect(actionButton()).toBeVisible();
    expect(nextButton()).not.toBeInTheDocument();
  });

  describe("a host that draws its own buttons (hideSubmitButton)", () => {
    test("is told the form is not on its last step from its first report on, before the first step has opened", async () => {
      const reported: Array<boolean> = [];

      await renderForm({
        hideSubmitButton: true,
        onIsLastFormStep: (isLast: boolean): void => {
          reported.push(isLast);
        },
      });

      expect(reported.length).toBeGreaterThan(0);
      // Never "last" on the way in: a host's footer starts on Next.
      expect(reported).not.toContain(true);
      expect(actionButton()).not.toBeInTheDocument();
      expect(nextButton()).not.toBeInTheDocument();
    });

    test("is told when the last step opens, and when the form leaves it", async () => {
      const reported: Array<boolean> = [];

      const { formRef }: Rendered = await renderForm({
        hideSubmitButton: true,
        steps: [DETAILS_STEP, MORE_STEP],
        fields: [TITLE_FIELD, NOTIFY_FIELD],
        onIsLastFormStep: (isLast: boolean): void => {
          reported.push(isLast);
        },
      });

      await typeInto("Title", "Checkout is down");
      act(() => {
        formRef.current?.goToNextStep();
      });

      await waitFor(() => {
        expect(activeStep()).toBe(MORE_STEP.title);
      });
      expect(reported[reported.length - 1]).toBe(true);
    });

    test("goToNextStep walks like Next and never submits: on the last step it does nothing", async () => {
      const { formRef, onSubmit }: Rendered = await renderForm({
        hideSubmitButton: true,
        steps: [DETAILS_STEP, MORE_STEP],
        fields: [TITLE_FIELD, NOTIFY_FIELD],
      });

      act(() => {
        formRef.current?.goToNextStep();
      });
      expect(await screen.findByText("Title is required.")).toBeVisible();
      expect(activeStep()).toBe(DETAILS_STEP.title);

      await typeInto("Title", "Checkout is down");
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

      // The action, as the host's footer calls it on the last step.
      act(() => {
        formRef.current?.submitAllSteps();
      });
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
    });

    test("submitForm, as Enter calls it, walks on from a step that is not the last", async () => {
      const { formRef, onSubmit }: Rendered = await renderForm({
        hideSubmitButton: true,
        steps: [DETAILS_STEP, MORE_STEP],
        fields: [TITLE_FIELD, NOTIFY_FIELD],
      });

      await typeInto("Title", "Checkout is down");
      act(() => {
        formRef.current?.submitForm();
      });

      await waitFor(() => {
        expect(activeStep()).toBe(MORE_STEP.title);
      });
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});

async function renderFormWithOneVisibleStep(): Promise<void> {
  render(
    <BasicForm
      id="one-visible-step-form"
      fields={[
        TITLE_FIELD,
        {
          field: { origin: true },
          title: "Origin",
          fieldType: FormFieldSchemaType.Text,
          stepId: "browser",
          showIf: (): boolean => {
            return false;
          },
        },
      ]}
      steps={[
        DETAILS_STEP,
        {
          id: "browser",
          title: "Browser Settings",
          showIf: (): boolean => {
            return false;
          },
        },
      ]}
      onSubmit={getJestMockFunction()}
      submitButtonText={ACTION}
      disableAutofocus={true}
    />,
  );

  await screen.findByRole("textbox", { name: "Title" });
  await act(async () => {});
}
