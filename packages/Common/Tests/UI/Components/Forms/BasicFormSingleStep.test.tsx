import BasicForm from "../../../../UI/Components/Forms/BasicForm";
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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A stepped form whose steps come down to one is that one page.
 *
 * The ingestion key form walks Key, then Browser Settings for a Browser key
 * - so a Server key, on a paid plan, has a single step to show. Drawn as a
 * wizard it said "Step 1 of 1" and listed one step beside the fields. Now
 * BasicForm draws the step list (the Progress list beside the form, and
 * "Step X of Y" on a narrow screen) only while there is more than one step
 * to walk, and a step that appears later (Browser picked) brings it back.
 */

function isBrowser(values: FormValues<JSONObject>): boolean {
  return values["kind"] === "browser";
}

const STEPS: Array<FormStep<JSONObject>> = [
  { title: "Key", id: "key" },
  { title: "Browser Settings", id: "browser", showIf: isBrowser },
];

const FIELDS: Fields<JSONObject> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    stepId: "key",
    required: true,
    defaultValue: "Server key",
  },
  {
    field: { kind: true },
    title: "Kind",
    fieldType: FormFieldSchemaType.Text,
    stepId: "key",
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
];

function renderForm(data: {
  steps: Array<FormStep<JSONObject>>;
  fields: Fields<JSONObject>;
}): MockFunction {
  const handleSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="single-step-form"
      fields={data.fields}
      steps={data.steps}
      onSubmit={handleSubmit}
      submitButtonText="Create"
      disableAutofocus={true}
    />,
  );

  return handleSubmit;
}

function progress(): HTMLElement | null {
  return screen.queryByRole("navigation", { name: "Progress" });
}

function stepCount(): HTMLElement | null {
  return screen.queryByText(/Step \d+ of \d+/);
}

// Lets the form open its first step and take its fields' defaults.
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
}

describe("BasicForm with one step to walk", () => {
  afterEach(() => {
    cleanup();
  });

  test("draws the step as a page: no step list, no Step 1 of 1", async () => {
    renderForm({ steps: STEPS, fields: FIELDS });
    await screen.findByRole("textbox", { name: "Name" });
    await settle();

    expect(screen.getByRole("textbox", { name: "Name" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: /^Kind/ })).toBeVisible();
    expect(progress()).not.toBeInTheDocument();
    expect(stepCount()).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Origin" }),
    ).not.toBeInTheDocument();
    // The one step is the last one: its button is the form's action.
    expect(screen.getByRole("button", { name: "Create" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument();
  });

  test("submits from that page", async () => {
    const handleSubmit: MockFunction = renderForm({
      steps: STEPS,
      fields: FIELDS,
    });
    await screen.findByRole("textbox", { name: "Name" });
    await settle();

    await userEvent
      .setup({ delay: null })
      .click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });
    expect(handleSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: "Server key",
      kind: "server",
    });
  });

  test("a step shown later brings the step list back, and takes it away again", async () => {
    renderForm({ steps: STEPS, fields: FIELDS });
    await screen.findByRole("textbox", { name: "Name" });
    await settle();

    fireEvent.change(screen.getByRole("textbox", { name: /^Kind/ }), {
      target: { value: "browser" },
    });

    await waitFor(() => {
      expect(progress()).toBeInTheDocument();
    });
    expect(
      within(progress() as HTMLElement)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Key", "Browser Settings"]);
    expect(stepCount()).toHaveTextContent("Step 1 of 2");
    expect(screen.getByRole("button", { name: "Next" })).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: /^Kind/ }), {
      target: { value: "server" },
    });

    await waitFor(() => {
      expect(progress()).not.toBeInTheDocument();
    });
    expect(stepCount()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeVisible();
  });

  test("a form declared with a single step has no step list either", async () => {
    renderForm({
      steps: [{ title: "Only", id: "only" }],
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          stepId: "only",
          required: true,
        },
      ],
    });
    await screen.findByRole("textbox", { name: "Name" });
    await settle();

    expect(progress()).not.toBeInTheDocument();
    expect(stepCount()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeVisible();
  });

  test("two steps or more keep their step list", async () => {
    renderForm({
      steps: [
        { title: "One", id: "one" },
        { title: "Two", id: "two" },
      ],
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          stepId: "one",
          required: true,
        },
        {
          field: { description: true },
          title: "Description",
          fieldType: FormFieldSchemaType.Text,
          stepId: "two",
        },
      ],
    });
    await screen.findByRole("textbox", { name: "Name" });
    await settle();

    expect(progress()).toBeInTheDocument();
    expect(stepCount()).toHaveTextContent("Step 1 of 2");
  });
});
