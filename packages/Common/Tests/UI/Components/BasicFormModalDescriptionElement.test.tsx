import BasicFormModal from "../../../UI/Components/FormModal/BasicFormModal";
import NamedSentence from "../../../UI/Components/DeleteConfirmation/NamedSentence";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction from "../../MockType";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A dialog form's description may be an element: a sentence with the record
 * it is about in bold (NamedSentence), as a delete confirmation names what
 * it deletes. A security case task's Assign Task says "Pick a person to do
 * <the task>.", and with the task's own words run into the sentence - "Pick
 * a person to do Block 203.0.113.47 at the edge." - the task read as part
 * of it. A description in words is drawn as before.
 */

function renderModal(description: string | ReactElement): void {
  render(
    <BasicFormModal<JSONObject>
      title="Assign Task"
      description={description}
      submitButtonText="Assign"
      onClose={getJestMockFunction()}
      onSubmit={getJestMockFunction()}
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

describe("BasicFormModal description", () => {
  afterEach(() => {
    cleanup();
  });

  test("an element is drawn as it is, its name in bold", async () => {
    renderModal(
      <NamedSentence
        template="Pick a person to do {{title}}. They are notified."
        slot="title"
        name="Block 203.0.113.47 at the edge"
        dataTestId="dialog-record-name"
      />,
    );

    await screen.findByRole("textbox", { name: "Note" });

    const description: HTMLElement = screen.getByTestId("modal-description");
    expect(description).toHaveTextContent(
      "Pick a person to do Block 203.0.113.47 at the edge. They are notified.",
    );
    const name: HTMLElement =
      within(description).getByTestId("dialog-record-name");
    expect(name.tagName).toBe("STRONG");
    expect(name).toHaveTextContent("Block 203.0.113.47 at the edge");
  });

  test("words are drawn as words", async () => {
    renderModal("Pick who does it.");

    await screen.findByRole("textbox", { name: "Note" });

    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Pick who does it.",
    );
  });
});
