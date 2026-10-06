import BasicFormModal from "../../../UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction from "../../MockType";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A dialog form's error - a refusal the server sent back, say a name a
 * Duplicate copy cannot take - is drawn once: the red alert at the top of
 * the dialog's body, with the form still below it so the answer can be
 * changed and sent again.
 *
 * BasicFormModal hands every prop to the Modal, error included, and the
 * Modal draws the alert. It also drew the same message itself, a second
 * time, as grey text under the alert.
 */

const REASON: string = "Workflow with the same name already exists.";

function renderModal(error?: string | undefined): void {
  render(
    <BasicFormModal<JSONObject>
      title="Duplicate Workflow"
      submitButtonText="Duplicate Workflow"
      onClose={getJestMockFunction()}
      onSubmit={getJestMockFunction()}
      error={error}
      formProps={{
        disableAutofocus: true,
        initialValues: { name: "Nightly Sync 2" },
        fields: [
          {
            field: { name: true },
            title: "New Workflow Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
        ],
      }}
    />,
  );
}

describe("BasicFormModal error", () => {
  afterEach(() => {
    cleanup();
  });

  test("is drawn once, as the dialog's alert", async () => {
    renderModal(REASON);

    await screen.findByRole("textbox", { name: "New Workflow Name" });

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(within(modal).getAllByText(REASON)).toHaveLength(1);
    expect(within(modal).getByRole("alert")).toHaveTextContent(REASON);
  });

  test("leaves the form below it, with what it holds", async () => {
    renderModal(REASON);

    const input: HTMLElement = await screen.findByRole("textbox", {
      name: "New Workflow Name",
    });

    expect(input).toHaveValue("Nightly Sync 2");
    expect(
      screen
        .getByRole("alert")
        .compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("draws no alert without an error", async () => {
    renderModal(undefined);

    await screen.findByRole("textbox", { name: "New Workflow Name" });

    expect(
      within(screen.getByTestId("modal")).queryByRole("alert"),
    ).not.toBeInTheDocument();
  });
});
