import BasicFormModal from "../../../UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../MockType";
import "@testing-library/jest-dom";
import {
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
 * A stepped BasicFormModal walks with a plain Next and offers the dialog's
 * action ("Change State", "Add Subscribers") on its last step only, as the
 * dialog's one primary button (Forms/Utils/SteppedFormFooter.ts). The
 * action checks every step and opens the first one with a problem.
 *
 * "Please dont have the primary save button on any step except the last.
 * ... Next button should never be primary color as well." - the
 * maintainer, 2026-10-04. Before that the action was on offer from the
 * first step whenever the steps after it were optional.
 */

const PRIMARY_CLASS: string = "bg-indigo-600";
const PLAIN_CLASS: string = "bg-white";

function modal(): HTMLElement {
  return screen.getByTestId("modal");
}

function submitButton(): HTMLElement | null {
  return within(modal()).queryByTestId("modal-footer-submit-button");
}

function nextButton(): HTMLElement | null {
  return within(modal()).queryByTestId("modal-footer-next-button");
}

function primaryFooterButtons(): Array<HTMLElement> {
  return within(screen.getByTestId("modal-footer"))
    .queryAllByRole("button")
    .filter((button: HTMLElement) => {
      return button.className.split(/\s+/).includes(PRIMARY_CLASS);
    });
}

function renderModal(data: {
  onSubmit: MockFunction;
  withSteps: boolean;
  noteRequired?: boolean | undefined;
  initialValues?: JSONObject | undefined;
  allowAnyStepNavigation?: boolean | undefined;
}): void {
  render(
    <BasicFormModal<JSONObject>
      title="Change State"
      submitButtonText="Change State"
      onClose={getJestMockFunction()}
      onSubmit={data.onSubmit}
      formProps={{
        id: "stepped-basic-form-modal",
        disableAutofocus: true,
        initialValues: data.initialValues,
        allowAnyStepNavigation: data.allowAnyStepNavigation,
        steps: data.withSteps
          ? [
              { title: "State", id: "state" },
              { title: "Note", id: "note" },
            ]
          : undefined,
        fields: [
          {
            field: { state: true },
            title: "State",
            stepId: "state",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
          {
            field: { note: true },
            title: "Note",
            stepId: "note",
            fieldType: FormFieldSchemaType.Text,
            required: Boolean(data.noteRequired),
          },
        ],
      }}
    />,
  );
}

function progress(): HTMLElement {
  return within(modal()).getByRole("navigation", { name: "Progress" });
}

describe("BasicFormModal with steps", () => {
  afterEach(() => {
    cleanup();
  });

  test("the first step offers a plain Next and no action, even when the step after it is optional", async () => {
    renderModal({ onSubmit: getJestMockFunction(), withSteps: true });

    await screen.findByRole("textbox", { name: "State" });

    await waitFor(() => {
      expect(nextButton()).toBeInTheDocument();
    });
    expect(nextButton()).toHaveTextContent("Next");
    expect(nextButton()!.className).toContain(PLAIN_CLASS);
    expect(submitButton()).not.toBeInTheDocument();
    expect(primaryFooterButtons()).toEqual([]);
    expect(
      within(modal()).queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });

  test("Next checks the step, walks on, and the last step offers the action alone", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderModal({ onSubmit, withSteps: true });

    await screen.findByRole("textbox", { name: "State" });
    fireEvent.click(nextButton()!);

    expect(await screen.findByText("State is required.")).toBeInTheDocument();
    expect(submitButton()).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "State" }), {
      target: { value: "Resolved" },
    });
    fireEvent.click(nextButton()!);

    await screen.findByRole("textbox", { name: /^Note/ });
    await waitFor(() => {
      expect(nextButton()).not.toBeInTheDocument();
    });
    expect(submitButton()).toHaveTextContent("Change State");
    expect(submitButton()!.className).toContain(PRIMARY_CLASS);
    expect(primaryFooterButtons()).toEqual([submitButton()]);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(submitButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ state: "Resolved" }),
    );
  });

  test("Enter in a field on the first step walks on instead of changing the state", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderModal({ onSubmit, withSteps: true });

    const state: HTMLElement = await screen.findByRole("textbox", {
      name: "State",
    });
    fireEvent.change(state, { target: { value: "Resolved" } });
    fireEvent.keyDown(state, { key: "Enter", code: "Enter" });

    await screen.findByRole("textbox", { name: /^Note/ });
    expect(onSubmit).not.toHaveBeenCalled();

    // On the last step Enter does what the action does.
    fireEvent.keyDown(screen.getByRole("textbox", { name: /^Note/ }), {
      key: "Enter",
      code: "Enter",
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  test("the last step asks for its own required field before the action does anything", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderModal({ onSubmit, withSteps: true, noteRequired: true });

    fireEvent.change(await screen.findByRole("textbox", { name: "State" }), {
      target: { value: "Resolved" },
    });
    fireEvent.click(nextButton()!);

    await screen.findByRole("textbox", { name: /^Note/ });
    await waitFor(() => {
      expect(submitButton()).toBeInTheDocument();
    });

    fireEvent.click(submitButton()!);

    expect(await screen.findByText("Note is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: /^Note/ }), {
      target: { value: "Fixed by the rollback" },
    });
    fireEvent.click(submitButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  test("a form without steps is one page: the action from the start, and no Next", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderModal({ onSubmit, withSteps: false });

    await screen.findByRole("textbox", { name: "State" });
    expect(submitButton()).toHaveTextContent("Change State");
    expect(nextButton()).not.toBeInTheDocument();
    expect(within(modal()).queryByText("Next")).not.toBeInTheDocument();
  });
});

/*
 * A stepped dialog whose values are all filled in already (a form's On
 * Submit settings) lets its step list open any step - so Save Changes, on
 * the last step, is one click away - but still offers it on the last step
 * only. The save checks the steps that were skipped and opens one with a
 * problem.
 */
describe("BasicFormModal with steps that can all be opened", () => {
  afterEach(() => {
    cleanup();
  });

  test("still offers Next, not the save, on the first step", async () => {
    renderModal({
      onSubmit: getJestMockFunction(),
      withSteps: true,
      initialValues: { state: "Open", note: "Kept" },
      allowAnyStepNavigation: true,
    });

    await screen.findByRole("textbox", { name: "State" });
    await waitFor(() => {
      expect(nextButton()).toBeInTheDocument();
    });
    expect(submitButton()).not.toBeInTheDocument();
  });

  test("the step list opens the last step, where the save keeps what every step holds", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderModal({
      onSubmit,
      withSteps: true,
      initialValues: { state: "Open", note: "Kept" },
      allowAnyStepNavigation: true,
    });

    fireEvent.change(await screen.findByRole("textbox", { name: "State" }), {
      target: { value: "Resolved" },
    });
    fireEvent.click(within(progress()).getByText("Note"));

    await screen.findByRole("textbox", { name: /^Note/ });
    await waitFor(() => {
      expect(submitButton()).toBeInTheDocument();
    });
    expect(nextButton()).not.toBeInTheDocument();

    fireEvent.click(submitButton()!);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ state: "Resolved", note: "Kept" }),
    );
  });

  test("a save that a skipped step refuses opens that step, with its error, and saves nothing", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderModal({
      onSubmit,
      withSteps: true,
      initialValues: { state: "Open", note: "" },
      allowAnyStepNavigation: true,
    });

    fireEvent.change(await screen.findByRole("textbox", { name: "State" }), {
      target: { value: "" },
    });
    fireEvent.click(within(progress()).getByText("Note"));

    await screen.findByRole("textbox", { name: /^Note/ });
    await waitFor(() => {
      expect(submitButton()).toBeInTheDocument();
    });
    fireEvent.click(submitButton()!);

    await screen.findByRole("textbox", { name: "State" });
    expect(await screen.findByText("State is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    // Back on the first step: Next, not the save.
    expect(submitButton()).not.toBeInTheDocument();
    expect(nextButton()).toBeInTheDocument();
  });
});
