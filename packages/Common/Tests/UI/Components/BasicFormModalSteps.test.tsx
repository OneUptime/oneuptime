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
