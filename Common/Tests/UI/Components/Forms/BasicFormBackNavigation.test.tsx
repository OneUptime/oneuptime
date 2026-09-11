import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { createRef, ReactElement, RefObject } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

function isBrowser(values: FormValues<JSONObject>): boolean {
  return values["kind"] === "browser";
}

const STEPS: Array<FormStep<JSONObject>> = [
  { title: "Details", id: "details" },
  { title: "Browser Settings", id: "browser", showIf: isBrowser },
  { title: "Confirmation", id: "confirmation" },
];

const FIELDS: Fields<JSONObject> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    stepId: "details",
    required: true,
  },
  {
    field: { kind: true },
    title: "Kind",
    fieldType: FormFieldSchemaType.Text,
    stepId: "details",
    defaultValue: "server",
  },
  {
    field: { origin: true },
    title: "Origin",
    fieldType: FormFieldSchemaType.Text,
    stepId: "browser",
    showIf: isBrowser,
    required: true,
  },
  {
    field: { confirmation: true },
    title: "Confirmation Text",
    fieldType: FormFieldSchemaType.Text,
    stepId: "confirmation",
    required: true,
  },
];

interface FormHandle {
  setFieldValue: (name: string, value: JSONValue) => void;
  submitForm: () => void;
}

interface WizardOptions {
  hideSubmitButton?: boolean;
  isLoading?: boolean;
  summary?: boolean;
  onFormStepChange?: (stepId: string) => void;
}

interface RenderWizardResult extends RenderResult {
  user: UserEvent;
  handleSubmit: MockFunction;
  formRef: RefObject<FormHandle>;
  view: (options?: WizardOptions) => ReactElement;
}

function renderWizard(options: WizardOptions = {}): RenderWizardResult {
  const handleSubmit: MockFunction = getJestMockFunction();
  const formRef: RefObject<FormHandle> = createRef<FormHandle>();
  const view: (overrides?: WizardOptions) => ReactElement = (
    overrides: WizardOptions = options,
  ): ReactElement => {
    return (
      <BasicForm
        id="back-navigation-wizard"
        ref={formRef}
        fields={FIELDS}
        steps={STEPS}
        onSubmit={handleSubmit}
        onFormStepChange={overrides.onFormStepChange}
        submitButtonText="Create"
        hideSubmitButton={overrides.hideSubmitButton}
        isLoading={overrides.isLoading}
        summary={{ enabled: overrides.summary || false }}
        disableAutofocus={true}
      />
    );
  };

  return {
    ...render(view()),
    handleSubmit,
    formRef,
    view,
    user: userEvent.setup({ delay: null }),
  };
}

async function enterName(): Promise<void> {
  fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), {
    target: { value: "Production" },
  });
}

async function goNext(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Next" }));
}

async function expectInputValue(name: string, value: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole("textbox", { name })).toHaveValue(value);
  });
}

describe("BasicForm backward navigation", () => {
  afterEach(() => {
    cleanup();
  });

  test("shows the mobile step title and visible count without a Back button on the first step", async () => {
    renderWizard();
    await screen.findByRole("textbox", { name: "Name" });

    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 2");
    expect(screen.getByRole("status")).toHaveTextContent("Details");
    expect(screen.getByRole("status")).toHaveClass("lg:hidden");
  });

  test.each(["{Enter}", " "])(
    "returns by keyboard with %s and preserves earlier edits without submitting",
    async (key: string) => {
      const { user, handleSubmit }: RenderWizardResult = renderWizard();
      await enterName();
      await goNext(user);
      await screen.findByRole("textbox", { name: "Confirmation Text" });

      const back: HTMLElement = screen.getByRole("button", { name: "Back" });
      expect(back).toHaveAttribute("type", "button");
      await user.tab({ shift: true });
      expect(
        screen.getByRole("textbox", { name: "Confirmation Text" }),
      ).toHaveFocus();
      await user.tab({ shift: true });
      expect(back).toHaveFocus();
      await user.keyboard(key);

      await expectInputValue("Name", "Production");
      expect(
        screen.queryByRole("button", { name: "Back" }),
      ).not.toBeInTheDocument();
      expect(handleSubmit).not.toHaveBeenCalled();
    },
  );

  test("skips a hidden conditional step in both directions and updates the progress count", async () => {
    const { user }: RenderWizardResult = renderWizard();
    await enterName();
    await goNext(user);

    expect(
      await screen.findByRole("textbox", { name: "Confirmation Text" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 2");
    await user.click(screen.getByRole("button", { name: "Back" }));
    await expectInputValue("Name", "Production");

    fireEvent.change(screen.getByRole("textbox", { name: /^Kind/ }), {
      target: { value: "browser" },
    });
    await goNext(user);
    expect(
      await screen.findByRole("textbox", { name: "Origin" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 3");
    fireEvent.change(screen.getByRole("textbox", { name: "Origin" }), {
      target: { value: "https://example.com" },
    });
    await goNext(user);
    await screen.findByRole("textbox", { name: "Confirmation Text" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    await expectInputValue("Origin", "https://example.com");
  });

  test("lets users leave an invalid current step and still validates it when they return", async () => {
    const { user, handleSubmit }: RenderWizardResult = renderWizard();
    await enterName();
    await goNext(user);
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText("Confirmation Text is required."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Back" }));
    await expectInputValue("Name", "Production");
    await goNext(user);
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText("Confirmation Text is required."),
    ).toBeVisible();
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  test("uses live eligible steps for imperative Next and immediate Back after changing a condition", async () => {
    let recordNavigation: boolean = false;
    let returnedFromConfirmation: boolean = false;
    const visitedSteps: Array<string> = [];
    const { formRef, user, handleSubmit }: RenderWizardResult = renderWizard({
      hideSubmitButton: true,
      onFormStepChange: (stepId: string): void => {
        if (!recordNavigation) {
          return;
        }
        if (visitedSteps[visitedSteps.length - 1] !== stepId) {
          visitedSteps.push(stepId);
        }
        if (stepId === "confirmation" && !returnedFromConfirmation) {
          returnedFromConfirmation = true;
          // Navigate before the passive effect refreshes the stored step list.
          screen.getByRole("button", { name: "Back" }).click();
        }
      },
    });
    await enterName();
    fireEvent.change(screen.getByRole("textbox", { name: /^Kind/ }), {
      target: { value: "browser" },
    });
    act(() => {
      formRef.current?.submitForm();
    });
    await screen.findByRole("textbox", { name: "Origin" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    await expectInputValue("Name", "Production");

    recordNavigation = true;
    act(() => {
      // A modal footer can submit before React commits the filtered step list.
      formRef.current?.setFieldValue("kind", "server");
      formRef.current?.submitForm();
    });

    await waitFor(() => {
      expect(visitedSteps).toEqual(["confirmation", "details"]);
    });
    await expectInputValue("Name", "Production");
    expect(
      screen.queryByRole("textbox", { name: "Origin" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  test("keeps Back available when a modal owns the submit button", async () => {
    const { formRef, user, handleSubmit }: RenderWizardResult = renderWizard({
      hideSubmitButton: true,
    });
    await enterName();
    act(() => {
      formRef.current?.submitForm();
    });
    await screen.findByRole("textbox", { name: "Confirmation Text" });

    expect(
      screen.queryByRole("button", { name: "Create" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    await expectInputValue("Name", "Production");
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  test("disables Back during loading and restores it afterwards", async () => {
    const { user, rerender, view }: RenderWizardResult = renderWizard();
    await enterName();
    await goNext(user);
    await screen.findByRole("textbox", { name: "Confirmation Text" });
    rerender(view({ isLoading: true }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("textbox", { name: "Confirmation Text" }),
    ).toBeVisible();
    rerender(view({ isLoading: false }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    await expectInputValue("Name", "Production");
  });

  test("returns from summary to the last visible step and preserves its value", async () => {
    const { user, handleSubmit }: RenderWizardResult = renderWizard({
      summary: true,
    });
    await enterName();
    await goNext(user);
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Confirmation Text" }),
      {
        target: { value: "Ready" },
      },
    );
    await goNext(user);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Summary");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Step 3 of 3");

    await user.click(screen.getByRole("button", { name: "Back" }));
    await expectInputValue("Confirmation Text", "Ready");
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  test("does not add navigation to a form without steps", async () => {
    render(
      <BasicForm
        id="single-page-form"
        fields={[{ ...FIELDS[0], stepId: undefined }]}
        onSubmit={getJestMockFunction()}
        submitButtonText="Save"
      />,
    );
    await screen.findByRole("textbox", { name: "Name" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
  });
});
