import BasicForm, {
  BasicFormHandle,
} from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
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
 * BasicForm's submitAllSteps - what a stepped edit dialog's Save Changes
 * calls from whichever step is on screen - and allowAnyStepNavigation, which
 * lets that dialog's step list open any step.
 *
 * submitAllSteps validates the fields of every step the user can reach, then
 * submits; a failing field sends the user to the first step it is on. A step
 * hidden by its showIf is not reachable, so its fields are not asked for.
 */

function isBrowser(values: FormValues<JSONObject>): boolean {
  return values["kind"] === "browser";
}

const STEPS: Array<FormStep<JSONObject>> = [
  { title: "Details", id: "details" },
  { title: "Browser Settings", id: "browser", showIf: isBrowser },
  { title: "Limits", id: "limits" },
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
    required: false,
  },
  {
    field: { origin: true },
    title: "Origin",
    fieldType: FormFieldSchemaType.Text,
    stepId: "browser",
    required: true,
  },
  {
    field: { limit: true },
    title: "Limit",
    fieldType: FormFieldSchemaType.Text,
    stepId: "limits",
    required: true,
  },
];

interface Rendered {
  formRef: RefObject<BasicFormHandle>;
  onSubmit: MockFunction;
  user: UserEvent;
}

async function renderForm(data: {
  initialValues: JSONObject;
  allowAnyStepNavigation?: boolean;
  steps?: Array<FormStep<JSONObject>> | undefined;
  fields?: Fields<JSONObject>;
}): Promise<Rendered> {
  const formRef: RefObject<BasicFormHandle> = createRef<BasicFormHandle>();
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="submit-all-steps"
      ref={formRef}
      fields={data.fields || FIELDS}
      steps={data.steps}
      initialValues={data.initialValues}
      onSubmit={onSubmit}
      submitButtonText="Save Changes"
      hideSubmitButton={true}
      allowAnyStepNavigation={data.allowAnyStepNavigation}
      disableAutofocus={true}
    />,
  );

  await screen.findByRole("textbox", { name: "Name" });

  return { formRef, onSubmit, user: userEvent.setup({ delay: null }) };
}

function progress(): HTMLElement {
  return screen.getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

describe("BasicForm submitAllSteps", () => {
  afterEach(() => {
    cleanup();
  });

  test("submits every step's values from the first step when they are all valid", async () => {
    const { formRef, onSubmit }: Rendered = await renderForm({
      steps: STEPS,
      initialValues: { name: "Storefront", kind: "server", limit: "60" },
    });

    expect(activeStep()).toBe("Details");

    act(() => {
      formRef.current?.submitAllSteps();
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const values: JSONObject = onSubmit.mock.calls[0]?.[0] as JSONObject;

    expect(values["name"]).toBe("Storefront");
    expect(values["limit"]).toBe("60");
  });

  test("goes to the first step with a failing field and shows its error, without submitting", async () => {
    const { formRef, onSubmit }: Rendered = await renderForm({
      steps: STEPS,
      initialValues: { name: "Storefront", kind: "server", limit: "" },
    });

    act(() => {
      formRef.current?.submitAllSteps();
    });

    await waitFor(() => {
      expect(activeStep()).toBe("Limits");
    });
    expect(await screen.findByText("Limit is required.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("picks the earliest failing step when several fail", async () => {
    const { formRef, onSubmit }: Rendered = await renderForm({
      steps: STEPS,
      initialValues: { name: "", kind: "browser", origin: "", limit: "" },
      allowAnyStepNavigation: true,
    });

    // Start from the last step, as if it had been opened from the step list.
    await userEvent
      .setup({ delay: null })
      .click(within(progress()).getByText("Limits"));
    await waitFor(() => {
      expect(activeStep()).toBe("Limits");
    });

    act(() => {
      formRef.current?.submitAllSteps();
    });

    await waitFor(() => {
      expect(activeStep()).toBe("Details");
    });
    expect(await screen.findByText("Name is required.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("does not ask for the fields of a step that is hidden", async () => {
    // The Browser Settings step is hidden for a server key; its required origin is not asked for.
    const { formRef, onSubmit }: Rendered = await renderForm({
      steps: STEPS,
      initialValues: { name: "Storefront", kind: "server", limit: "60" },
    });

    act(() => {
      formRef.current?.submitAllSteps();
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  test("asks for the fields of a conditional step once it is shown", async () => {
    const { formRef, onSubmit }: Rendered = await renderForm({
      steps: STEPS,
      initialValues: {
        name: "Storefront",
        kind: "browser",
        origin: "",
        limit: "60",
      },
    });

    act(() => {
      formRef.current?.submitAllSteps();
    });

    await waitFor(() => {
      expect(activeStep()).toBe("Browser Settings");
    });
    expect(await screen.findByText("Origin is required.")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("is plain submitForm on a form without steps", async () => {
    const { formRef, onSubmit }: Rendered = await renderForm({
      steps: undefined,
      fields: FIELDS.map((field: (typeof FIELDS)[number]) => {
        return { ...field, stepId: undefined };
      }).filter((field: (typeof FIELDS)[number]) => {
        return Object.keys(field.field || {})[0] !== "origin";
      }),
      initialValues: { name: "Storefront", kind: "server", limit: "60" },
    });

    act(() => {
      formRef.current?.submitAllSteps();
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });
});

describe("BasicForm allowAnyStepNavigation", () => {
  afterEach(() => {
    cleanup();
  });

  test("opens a step not reached yet from the step list", async () => {
    const { user }: Rendered = await renderForm({
      steps: STEPS,
      initialValues: { name: "Storefront", kind: "server", limit: "60" },
      allowAnyStepNavigation: true,
    });

    await user.click(within(progress()).getByText("Limits"));

    await waitFor(() => {
      expect(activeStep()).toBe("Limits");
    });
    expect(screen.getByRole("textbox", { name: "Limit" })).toHaveValue("60");
    expect(
      screen.queryByRole("textbox", { name: "Name" }),
    ).not.toBeInTheDocument();
  });

  test("leaves a step not reached yet closed without it", async () => {
    const { user }: Rendered = await renderForm({
      steps: STEPS,
      initialValues: { name: "Storefront", kind: "server", limit: "60" },
    });

    await user.click(within(progress()).getByText("Limits"));

    expect(activeStep()).toBe("Details");
    expect(screen.getByRole("textbox", { name: "Name" })).toBeVisible();
  });

  test("does not list a hidden step to open", async () => {
    await renderForm({
      steps: STEPS,
      initialValues: { name: "Storefront", kind: "server", limit: "60" },
      allowAnyStepNavigation: true,
    });

    expect(
      within(progress()).queryByText("Browser Settings"),
    ).not.toBeInTheDocument();
  });
});
