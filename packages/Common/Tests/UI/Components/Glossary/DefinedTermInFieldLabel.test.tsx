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
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FieldLabelElement, {
  FIELD_LABEL_TOOLTIP_TEST_ID,
} from "../../../../UI/Components/Forms/Fields/FieldLabel";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  DEFINED_TERM_DEFINITION_TEST_ID,
  DEFINED_TERM_READ_MORE_TEST_ID,
  DEFINED_TERM_TEST_ID,
} from "../../../../UI/Components/Glossary/DefinedTerm";
import { clearGlossaryReads } from "../../../../UI/Utils/Glossary";
import { PRODUCT_TEXT_CLASS_NAME } from "../../../../UI/Utils/ProductText";

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

/*
 * WITH ITS DEFINITION OPEN, A FIELD IS STILL NAMED BY ITS TITLE ALONE (#7561).
 *
 * A dropdown's or a picker's title names it through the title's id
 * (aria-labelledby), and a native input's title as its <label for>: either
 * way the field is named by every word inside the title. The definition was
 * drawn inside the title, beside its word, so while it showed (the word
 * hovered, focused or pressed) the field's name took in the definition and
 * its Read more too: "Probes Probe A machine that runs checks. Read more".
 * It is drawn right after the title now (FieldLabel), and Tab still goes
 * from the word to Read more before anything else. The browser holds the
 * same (packages/E2E: CreateMonitor.spec.ts, OwnersOnCreate.spec.ts).
 */

const GLOSSARY: unknown = {
  lang: "en",
  entries: [
    { id: "probe", term: "Probe", definition: "A machine that runs checks." },
    {
      id: "state",
      term: "State",
      definition: "Where an incident or an alert is in your response.",
    },
    {
      id: "severity",
      term: "Severity",
      definition: "How serious an incident or an alert is.",
    },
    {
      id: "criteria",
      term: "Criteria",
      definition: "A monitor's rules: what each check result means.",
    },
  ],
};

// The glossary's answer to a read: every word here has its definition.
const answerGlossaryReads: () => void = (): void => {
  (globalThis as Record<string, unknown>)["fetch"] = (): Promise<unknown> => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: (): Promise<unknown> => {
        return Promise.resolve(GLOSSARY);
      },
    });
  };
};

// Presses a title's word, and waits for its definition to show.
const openDefinition: (word: string) => Promise<HTMLElement> = async (
  word: string,
): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole("button", { name: word }));

  return waitFor((): HTMLElement => {
    const open: HTMLElement = screen.getByRole("dialog", { name: word });

    expect(open).toHaveAttribute("data-state", "visible");
    expect(
      within(open).getByTestId(DEFINED_TERM_DEFINITION_TEST_ID),
    ).toBeInTheDocument();

    return open;
  });
};

// A form of one field, as a form draws it (FormField).
function renderForm(props: {
  title: string;
  term: GlossaryTerm;
  fieldType: FormFieldSchemaType;
  required: boolean;
}): void {
  render(
    <BasicForm
      id="definition-form"
      name="Definition form"
      initialValues={{ value: "" }}
      fields={[
        {
          field: { value: true },
          title: props.title,
          glossaryTerm: props.term,
          fieldType: props.fieldType,
          dropdownOptions: [{ label: "One", value: "one" }],
          required: props.required,
        },
      ]}
      onSubmit={() => {
        return undefined;
      }}
    />,
  );
}

// What names a field: what its aria-labelledby points at, else its <label>.
const namedBy: (field: HTMLElement) => Array<HTMLElement> = (
  field: HTMLElement,
): Array<HTMLElement> => {
  const ids: Array<string> = (field.getAttribute("aria-labelledby") || "")
    .split(" ")
    .filter((id: string): boolean => {
      return id !== "";
    });

  if (ids.length > 0) {
    return ids.map((id: string): HTMLElement => {
      return document.getElementById(id) as HTMLElement;
    });
  }

  return Array.from((field as HTMLInputElement).labels || []);
};

/*
 * A field's name as a browser reads it: every word inside what the field
 * is named by (accname 1.2, steps 2B and 2F), an open definition's
 * included. jsdom's names (dom-accessibility-api, which getByRole reads)
 * never had the definition in them: inside the title they follow the
 * definition's own aria-labelledby to its word, already read, and so read
 * nothing of it.
 */
const nameAsRead: (field: HTMLElement) => string = (
  field: HTMLElement,
): string => {
  return namedBy(field)
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
};

describe("with its definition open, a field is still named by its title alone", () => {
  test.each<[string, string, GlossaryTerm, boolean, string]>([
    ["required", "Probes", GlossaryTerm.Probe, true, "Probes"],
    [
      "optional",
      "Initial State",
      GlossaryTerm.State,
      false,
      "Initial State (Optional)",
    ],
  ])(
    "a form's dropdown (%s)",
    async (
      _kind: string,
      title: string,
      term: GlossaryTerm,
      required: boolean,
      name: string,
    ) => {
      answerGlossaryReads();
      renderForm({
        title: title,
        term: term,
        fieldType: FormFieldSchemaType.Dropdown,
        required: required,
      });

      const dropdown: HTMLElement = screen.getByRole("combobox", {
        name: name,
      });

      expect(nameAsRead(dropdown)).toBe(name);

      await openDefinition(title);

      expect(nameAsRead(dropdown)).toBe(name);
      expect(screen.getByRole("combobox", { name: name })).toBe(dropdown);
    },
  );

  test("a form's picker", async () => {
    answerGlossaryReads();
    renderForm({
      title: "Severity",
      term: GlossaryTerm.Severity,
      fieldType: FormFieldSchemaType.Color,
      required: false,
    });

    const picker: HTMLElement = screen.getByRole("radiogroup", {
      name: "Severity (Optional)",
    });

    await openDefinition("Severity");

    expect(nameAsRead(picker)).toBe("Severity (Optional)");
    expect(
      screen.getByRole("radiogroup", { name: "Severity (Optional)" }),
    ).toBe(picker);
  });

  test("a form's text field, named by its <label for>, and a click on the definition is in no label", async () => {
    answerGlossaryReads();
    renderForm({
      title: "Criteria",
      term: GlossaryTerm.Criteria,
      fieldType: FormFieldSchemaType.Text,
      required: true,
    });

    const input: HTMLElement = screen.getByRole("textbox", {
      name: "Criteria",
    });

    const open: HTMLElement = await openDefinition("Criteria");

    expect(nameAsRead(input)).toBe("Criteria");
    expect(screen.getByRole("textbox", { name: "Criteria" })).toBe(input);
    expect(open.closest("label")).toBeNull();
  });

  test("the definition is drawn right after the title, outside it", async () => {
    answerGlossaryReads();
    renderField({
      title: "Initial State",
      term: GlossaryTerm.State,
      required: false,
    });

    const open: HTMLElement = await openDefinition("Initial State");

    expect(titleRow()).not.toContainElement(open);
    expect(
      titleRow().compareDocumentPosition(open) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      nameAsRead(
        screen.getByRole("combobox", { name: "Initial State (Optional)" }),
      ),
    ).toBe("Initial State (Optional)");
  });
});

// Every element Tab stops at, in the page's order, as far as jsdom can tell.
const tabStops: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea, [tabindex]",
    ),
  ).filter((element: HTMLElement): boolean => {
    return (
      element.tabIndex >= 0 &&
      !element.hasAttribute("disabled") &&
      !(element instanceof HTMLInputElement && element.type === "hidden")
    );
  });
};

// Where Tab goes from the title's word: the next stops, in order.
const stopsAfterWord: (count: number) => Array<HTMLElement | undefined> = (
  count: number,
): Array<HTMLElement | undefined> => {
  const stops: Array<HTMLElement> = tabStops();
  const at: number = stops.indexOf(screen.getByTestId(DEFINED_TERM_TEST_ID));

  expect(at).toBeGreaterThanOrEqual(0);

  return stops.slice(at + 1, at + 1 + count);
};

describe("with its definition open, Tab goes from the word to Read more", () => {
  test.each<[string, FormFieldSchemaType, string]>([
    ["a dropdown", FormFieldSchemaType.Dropdown, "combobox"],
    ["a text field", FormFieldSchemaType.Text, "textbox"],
  ])(
    "then on to the field: %s",
    async (_kind: string, fieldType: FormFieldSchemaType, role: string) => {
      answerGlossaryReads();
      renderForm({
        title: "Probes",
        term: GlossaryTerm.Probe,
        fieldType: fieldType,
        required: true,
      });

      const open: HTMLElement = await openDefinition("Probes");
      const [first, second] = stopsAfterWord(2);

      expect(first).toBe(
        within(open).getByTestId(DEFINED_TERM_READ_MORE_TEST_ID),
      );
      // The form's one field, whatever it is named.
      expect(second).toBe(screen.getByRole(role));
    },
  );

  test("then on to the (i) beside the title", async () => {
    answerGlossaryReads();
    render(
      <div>
        <FieldLabelElement
          title="Probes"
          id={LABEL_ID}
          glossaryTerm={GlossaryTerm.Probe}
          tooltip="Each probe checks the monitor on its own."
          required={true}
        />
        <input role="combobox" aria-labelledby={LABEL_ID} />
      </div>,
    );

    const open: HTMLElement = await openDefinition("Probes");
    const [first, second, third] = stopsAfterWord(3);

    expect(first).toBe(
      within(open).getByTestId(DEFINED_TERM_READ_MORE_TEST_ID),
    );
    expect(second).toBe(screen.getByTestId(FIELD_LABEL_TOOLTIP_TEST_ID));
    expect(third).toBe(screen.getByRole("combobox"));
  });
});

/*
 * A recording of the first-run pages records the product's own words as
 * written (Utils/ProductText), Create Monitor's among them. A field's title
 * is marked, and its definition was recorded with it while drawn inside the
 * title. Drawn after the title (#7561), outside its marked words, it still
 * is: the popover carries the mark itself (DefinedTerm.test.tsx).
 */
describe("in a recording of the page", () => {
  test("the definition, drawn after the title, is recorded as written, as the title is", async () => {
    answerGlossaryReads();
    renderForm({
      title: "Probes",
      term: GlossaryTerm.Probe,
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
    });

    const open: HTMLElement = await openDefinition("Probes");
    const marked: string = `.${PRODUCT_TEXT_CLASS_NAME}`;

    expect(
      screen.getByRole("button", { name: "Probes" }).closest(marked),
    ).not.toBeNull();
    expect(
      within(open).getByTestId(DEFINED_TERM_DEFINITION_TEST_ID).closest(marked),
    ).not.toBeNull();
    expect(
      within(open).getByTestId(DEFINED_TERM_READ_MORE_TEST_ID).closest(marked),
    ).not.toBeNull();
  });
});
