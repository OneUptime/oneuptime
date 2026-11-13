import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The word as DefinedTerm draws it, its file there: FieldLabel draws it
 * through LazyDefinedTerm, and LazyDefinedTerm.test.tsx holds the word as it
 * is drawn until the file arrives.
 */
jest.mock("../../../../UI/Components/Glossary/LazyDefinedTerm", () => {
  return jest.requireActual("../../../../UI/Components/Glossary/DefinedTerm");
});

import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import FieldLabelElement from "../../../../UI/Components/Forms/Fields/FieldLabel";
import { DEFINED_TERM_TEST_ID } from "../../../../UI/Components/Glossary/DefinedTerm";

/*
 * A FIELD'S TITLE THAT IS A DEFINED TERM KEEPS ITS NAME, AND SO DOES THE WORD.
 *
 * A form draws a dropdown's or a picker's title in a <label> with no `for`,
 * and names the control by that label (aria-labelledby). With a glossary
 * term the title is a button (Glossary/DefinedTerm), and a <label> with no
 * `for` takes the first button inside it for the control it labels: the
 * word was then named by the label - nothing on a required field,
 * "(Optional)" on another - and in a browser the Create Monitor form's
 * Probes and Declare Incident's Incident Severity lost their names
 * (packages/E2E: NetworkDeviceLink.spec.ts, OwnersOnCreate.spec.ts).
 */

const LABEL_ID: string = "field-label";

function renderField(props: {
  title: string;
  term: GlossaryTerm;
  required: boolean;
}): void {
  const field: ReactElement = (
    <div>
      <FieldLabelElement
        title={props.title}
        id={LABEL_ID}
        glossaryTerm={props.term}
        required={props.required}
      />
      <input role="combobox" aria-labelledby={LABEL_ID} />
    </div>
  );

  render(field);
}

afterEach(() => {
  cleanup();
});

describe("a dropdown whose title is a defined term", () => {
  test("required: the word is named by itself, and the field by its title", () => {
    renderField({ title: "Probes", term: GlossaryTerm.Probe, required: true });

    expect(screen.getByRole("button", { name: "Probes" })).toBe(
      screen.getByTestId(DEFINED_TERM_TEST_ID),
    );
    expect(screen.getByRole("combobox", { name: "Probes" })).toBeVisible();
  });

  test("optional: the word is never named (Optional), and the field reads its title first", () => {
    renderField({
      title: "Initial State",
      term: GlossaryTerm.State,
      required: false,
    });

    expect(screen.getByRole("button", { name: "Initial State" })).toBe(
      screen.getByTestId(DEFINED_TERM_TEST_ID),
    );
    expect(
      screen.getByRole("combobox", { name: "Initial State (Optional)" }),
    ).toBeVisible();
  });
});
