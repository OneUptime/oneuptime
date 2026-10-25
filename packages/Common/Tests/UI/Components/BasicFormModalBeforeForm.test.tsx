import BasicFormModal from "../../../UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction from "../../MockType";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What a dialog form is about, drawn above its fields (beforeFormElement):
 * a row's Change State names the row it was taken on, a bulk one the rows
 * selected (DeleteItemNames), so the person picking a state sees which
 * records it lands on before the fields ask anything.
 */

function renderModal(beforeFormElement?: ReactElement): void {
  render(
    <BasicFormModal<JSONObject>
      title="Change Incident State"
      description="Pick the state to move the incident to."
      submitButtonText="Change State"
      onClose={getJestMockFunction()}
      onSubmit={getJestMockFunction()}
      beforeFormElement={beforeFormElement}
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

describe("BasicFormModal beforeFormElement", () => {
  afterEach(() => {
    cleanup();
  });

  test("is drawn above the fields, under the description", async () => {
    renderModal(<p data-testid="row-names">Checkout API down</p>);

    const field: HTMLElement = await screen.findByRole("textbox", {
      name: "Note",
    });
    const before: HTMLElement = screen.getByTestId("form-modal-before-form");

    expect(within(before).getByTestId("row-names")).toHaveTextContent(
      "Checkout API down",
    );
    expect(
      before.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByText("Pick the state to move the incident to.")
        .compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("draws nothing of the kind when a dialog has nothing to name", async () => {
    renderModal(undefined);

    await screen.findByRole("textbox", { name: "Note" });

    expect(screen.queryByTestId("form-modal-before-form")).toBeNull();
  });
});
