import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import FieldLabelElement from "../../../../UI/Components/Forms/Fields/FieldLabel";
import { DEFINED_TERM_TEST_ID } from "../../../../UI/Components/Glossary/DefinedTerm";
import { clearGlossaryReads } from "../../../../UI/Utils/Glossary";

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

const originalFetch: unknown = (globalThis as Record<string, unknown>)["fetch"];

afterEach(() => {
  cleanup();
  clearGlossaryReads();
  (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
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

/*
 * ONLY A PRESS ON THE WORD OPENS ITS DEFINITION.
 *
 * A <label> with no `for` takes the first labelable element inside it for
 * the control it labels, and the word is a button. The browser hands a
 * click on the label's own words or space on to that control: a click on
 * "(Optional)", or on the empty end of the title's row (it spans the
 * field's width), pressed the word, and the definition opened (#7543). A
 * dropdown's or a picker's title is therefore not a <label> when its word
 * is a defined term (FieldLabel). jsdom hands a label's click on as a
 * browser does, so it is held here as well as in a browser
 * (packages/E2E: CreateMonitor.spec.ts, OwnersOnCreate.spec.ts).
 */

// A press starts the read of the glossary; this one never answers.
const holdGlossaryReads: () => void = (): void => {
  (globalThis as Record<string, unknown>)["fetch"] = (): Promise<unknown> => {
    return new Promise<unknown>(() => {});
  };
};

/*
 * The definition, open or put away: jsdom never ends a transition, so one
 * that was opened stays in the page.
 */
const definition: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByRole("dialog", { hidden: true });
};

// Lets Tippy and React finish what a click started.
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 100);
    });
  });
};

const optionalMark: () => HTMLElement = (): HTMLElement => {
  return screen.getByText("(Optional)");
};

// The title's row itself: a click on it is a click past its words.
const titleRow: () => HTMLElement = (): HTMLElement => {
  return document.getElementById(LABEL_ID) as HTMLElement;
};

describe("a click on a dropdown's title, off its word", () => {
  test("the word is the control of no label", () => {
    renderField({
      title: "Initial State",
      term: GlossaryTerm.State,
      required: false,
    });

    const word: HTMLButtonElement = screen.getByTestId(
      DEFINED_TERM_TEST_ID,
    ) as HTMLButtonElement;

    expect(word.labels).toHaveLength(0);
    expect(word.closest("label")).toBeNull();
  });

  test.each<[string, string, GlossaryTerm, boolean, () => HTMLElement]>([
    ["(Optional)", "Initial State", GlossaryTerm.State, false, optionalMark],
    [
      "the empty end of the row, optional",
      "Initial State",
      GlossaryTerm.State,
      false,
      titleRow,
    ],
    [
      "the empty end of the row, required",
      "Probes",
      GlossaryTerm.Probe,
      true,
      titleRow,
    ],
  ])(
    "on %s, leaves the definition closed",
    async (
      _where: string,
      title: string,
      term: GlossaryTerm,
      required: boolean,
      target: () => HTMLElement,
    ) => {
      holdGlossaryReads();
      renderField({ title: title, term: term, required: required });

      fireEvent.click(target());
      await settle();

      expect(definition()).toBeNull();
    },
  );

  test("a press on the word opens it, named after the word", async () => {
    holdGlossaryReads();
    renderField({
      title: "Initial State",
      term: GlossaryTerm.State,
      required: false,
    });

    fireEvent.click(screen.getByTestId(DEFINED_TERM_TEST_ID));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Initial State" }),
      ).toHaveAttribute("data-state", "visible");
    });
  });

  test("a field with a control of its own: a click on its (Optional) goes to the control, not to the word", async () => {
    holdGlossaryReads();

    const clicks: Array<string> = [];

    render(
      <div>
        <FieldLabelElement
          title="Criteria"
          htmlFor="criteria-input"
          glossaryTerm={GlossaryTerm.Criteria}
          required={false}
        />
        <input
          id="criteria-input"
          onClick={() => {
            clicks.push("input");
          }}
        />
      </div>,
    );

    fireEvent.click(optionalMark());
    await settle();

    expect(clicks).toEqual(["input"]);
    expect(definition()).toBeNull();
  });
});
