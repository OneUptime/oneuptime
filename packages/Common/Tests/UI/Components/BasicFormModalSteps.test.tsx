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
 * A stepped BasicFormModal's one button moves on until the last step, and
 * now says so. It used to read the dialog's action ("Change State", "Add
 * Subscribers") on every step while it only went to the next one.
 */

function submitButton(): HTMLElement {
  return within(screen.getByTestId("modal")).getByTestId(
    "modal-footer-submit-button",
  );
}

function renderModal(data: {
  onSubmit: MockFunction;
  withSteps: boolean;
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
            required: false,
          },
        ],
      }}
    />,
  );
}

describe("BasicFormModal with steps", () => {
  afterEach(() => {
    cleanup();
  });

  test("reads Next on a step that is not the last, and the action on the last", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderModal({ onSubmit, withSteps: true });

    await waitFor(() => {
      expect(submitButton()).toHaveTextContent("Next");
    });

    fireEvent.change(screen.getByRole("textbox", { name: "State" }), {
      target: { value: "Resolved" },
    });
    fireEvent.click(submitButton());

    await screen.findByRole("textbox", { name: /^Note/ });
    await waitFor(() => {
      expect(submitButton()).toHaveTextContent("Change State");
    });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect((onSubmit.mock.calls[0]?.[0] as JSONObject)["state"]).toBe(
      "Resolved",
    );
  });

  test("reads the action from the start on a form without steps", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderModal({ onSubmit, withSteps: false });

    await screen.findByRole("textbox", { name: "State" });
    expect(submitButton()).toHaveTextContent("Change State");
    expect(
      within(screen.getByTestId("modal")).queryByText("Next"),
    ).not.toBeInTheDocument();
  });
});

/*
 * saveFromAnyStep: a stepped dialog that edits values that are all filled
 * in already (a form's On Submit settings) saves from any step - the action
 * on the main button from the first step, a plain Next beside it, and any
 * step a click away in the step list. The save checks every step, and
 * opens the first one that has a problem.
 */
function renderEditModal(data: {
  onSubmit: MockFunction;
  initialValues: JSONObject;
  noteRequired?: boolean | undefined;
}): void {
  render(
    <BasicFormModal<JSONObject>
      title="Edit Settings"
      submitButtonText="Save Changes"
      saveFromAnyStep={true}
      onClose={getJestMockFunction()}
      onSubmit={data.onSubmit}
      formProps={{
        id: "edit-basic-form-modal",
        disableAutofocus: true,
        initialValues: data.initialValues,
        steps: [
          { title: "Defaults", id: "defaults" },
          { title: "Publishing", id: "publishing" },
        ],
        fields: [
          {
            field: { state: true },
            title: "State",
            stepId: "defaults",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
          {
            field: { note: true },
            title: "Note",
            stepId: "publishing",
            fieldType: FormFieldSchemaType.Text,
            required: Boolean(data.noteRequired),
          },
        ],
      }}
    />,
  );
}

function nextButton(): HTMLElement | null {
  return within(screen.getByTestId("modal")).queryByTestId(
    "modal-footer-next-button",
  );
}

describe("BasicFormModal that saves from any step", () => {
  afterEach(() => {
    cleanup();
  });

  test("reads the action on the first step, with a plain Next beside it", async () => {
    renderEditModal({
      onSubmit: getJestMockFunction(),
      initialValues: { state: "Open", note: "Kept" },
    });

    await screen.findByRole("textbox", { name: "State" });
    expect(submitButton()).toHaveTextContent("Save Changes");
    expect(nextButton()).toHaveTextContent("Next");
  });

  test("saves every step's values from the first step", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderEditModal({
      onSubmit,
      initialValues: { state: "Open", note: "Kept" },
    });

    fireEvent.change(await screen.findByRole("textbox", { name: "State" }), {
      target: { value: "Resolved" },
    });
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    // The step never opened keeps what it had.
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ state: "Resolved", note: "Kept" }),
    );
  });

  test("Next walks on without saving, and is gone on the last step", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderEditModal({
      onSubmit,
      initialValues: { state: "Open", note: "Kept" },
    });

    await screen.findByRole("textbox", { name: "State" });
    fireEvent.click(nextButton()!);

    await screen.findByRole("textbox", { name: /^Note/ });
    await waitFor(() => {
      expect(nextButton()).not.toBeInTheDocument();
    });
    expect(submitButton()).toHaveTextContent("Save Changes");
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  test("a save that a later step refuses opens that step, with its error, and saves nothing", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderEditModal({
      onSubmit,
      initialValues: { state: "Open", note: "" },
      noteRequired: true,
    });

    await screen.findByRole("textbox", { name: "State" });
    fireEvent.click(submitButton());

    await screen.findByRole("textbox", { name: /^Note/ });
    expect(await screen.findByText("Note is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("a dialog without it keeps Next on its one button", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    renderModal({ onSubmit, withSteps: true });

    await waitFor(() => {
      expect(submitButton()).toHaveTextContent("Next");
    });
    expect(nextButton()).not.toBeInTheDocument();
  });
});
