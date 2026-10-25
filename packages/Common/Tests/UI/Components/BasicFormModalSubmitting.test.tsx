import BasicFormModal from "../../../UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction from "../../MockType";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A dialog whose action runs while it stays open - a row's Acknowledge,
 * Change Severity, Add Owner - says so (isSubmitting): the form stays as it
 * was filled in and its button turns busy, so on a slow connection it is
 * seen to work and is pressed once. Unlike isLoading, which a dialog still
 * reading what it shows sets, and which draws a loader in the fields' place.
 */

function renderModal(state: {
  isSubmitting?: boolean | undefined;
  isLoading?: boolean | undefined;
}): void {
  render(
    <BasicFormModal<JSONObject>
      title="Change Severity"
      description="Pick the new severity for Checkout API down."
      submitButtonText="Change Severity"
      onClose={getJestMockFunction()}
      onSubmit={getJestMockFunction()}
      isSubmitting={state.isSubmitting}
      isLoading={state.isLoading}
      beforeFormElement={<p data-testid="row-name">Checkout API down</p>}
      formProps={{
        disableAutofocus: true,
        fields: [
          {
            field: { note: true },
            title: "Note",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
        ],
      }}
    />,
  );
}

describe("BasicFormModal isSubmitting", () => {
  afterEach(() => {
    cleanup();
  });

  test("keeps the form as filled in and turns its button busy", async () => {
    renderModal({ isSubmitting: true });

    expect(
      await screen.findByRole("textbox", { name: "Note" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("row-name")).toBeInTheDocument();
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    // Cancel stays: the action finishes either way.
    expect(screen.getByTestId("modal-footer-close-button")).not.toBeDisabled();
  });

  test("off, the button is ready", async () => {
    renderModal({ isSubmitting: false });

    await screen.findByRole("textbox", { name: "Note" });

    expect(
      screen.getByTestId("modal-footer-submit-button"),
    ).not.toBeDisabled();
  });

  test("is not isLoading, which waits for what the dialog shows: a loader in the fields' place", () => {
    renderModal({ isLoading: true });

    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
    expect(screen.queryByTestId("row-name")).toBeNull();
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
  });
});
