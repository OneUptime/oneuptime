import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";

/*
 * Under a note template's text, wherever one is written: the placeholders it
 * can use. They are shown as code and never go through the translation
 * lookup, which would read their braces as placeholders of its own and blank
 * them; the words around them do.
 *
 * Nothing else: a yellow "Internal data" warning used to sit under the list,
 * and the maintainer asked for it to go ("Please remove this yellow warning.
 * We don't need it.").
 */

const translated: Array<string> = [];

// The removed warning's title, and what it was about.
const WARNING_WORDS: RegExp = /internal data|public note/i;
// A copy key that names a warning.
const WARNING_KEY: RegExp = /warning|internaldata/i;
// The removed warning's title, and its closing advice.
const WARNING_TEXT: RegExp = /internal data|before you post a public note/i;

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          if (value) {
            translated.push(value);
          }
          return value ? `[${value}]` : value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import IncidentNoteTemplatePlaceholders from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentNoteTemplatePlaceholders";
import IncidentCustomFieldsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldsCopy";
import {
  INCIDENT_NOTE_TEMPLATE_VARIABLES,
  IncidentNoteTemplateVariableInfo,
} from "../../../Utils/Incident/IncidentNoteTemplateVariables";

afterEach(() => {
  cleanup();
  translated.length = 0;
});

describe("the note template placeholders hint", () => {
  test("lists every placeholder, in braces, with what it is filled with", () => {
    render(<IncidentNoteTemplatePlaceholders />);

    const hint: HTMLElement = screen.getByTestId(
      "incident-note-template-placeholders",
    );

    for (const variable of INCIDENT_NOTE_TEMPLATE_VARIABLES) {
      const code: HTMLElement = within(hint).getByText(`{{${variable.name}}}`);

      expect(code.tagName).toBe("CODE");
      expect(code.parentElement).toHaveTextContent(`[${variable.description}]`);
    }

    expect(within(hint).getByText("{{incident.title}}")).toBeInTheDocument();
    expect(
      within(hint).getByText("{{customFields.<key>}}"),
    ).toBeInTheDocument();
  });

  test("shows no warning: no alert, no 'Internal data', nothing about public notes", () => {
    render(<IncidentNoteTemplatePlaceholders />);

    const hint: HTMLElement = screen.getByTestId(
      "incident-note-template-placeholders",
    );

    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(
      screen.queryByTestId("incident-note-template-internal-data-warning"),
    ).not.toBeInTheDocument();
    // The warning was the shared Alert's amber (yellow) box.
    expect(hint.querySelector(".alert")).toBeNull();
    expect(hint.querySelector(".bg-amber-50")).toBeNull();
    expect(hint).not.toHaveTextContent(/internal data/i);
    expect(hint).not.toHaveTextContent(/public note/i);
    expect(hint).not.toHaveTextContent(/filled-in text/i);
    expect(hint).not.toHaveTextContent(/Include in Subscriber Notifications/);
    // Nor was the warning's title or text looked up in another language.
    expect(
      translated.some((text: string): boolean => {
        return WARNING_WORDS.test(text);
      }),
    ).toBe(false);
  });

  test("is just the intro and the placeholder list, with nothing after the list", () => {
    render(<IncidentNoteTemplatePlaceholders />);

    const hint: HTMLElement = screen.getByTestId(
      "incident-note-template-placeholders",
    );
    const parts: Array<Element> = Array.from(hint.children);

    expect(
      parts.map((part: Element): string => {
        return part.tagName;
      }),
    ).toEqual(["P", "UL"]);
    expect(parts[0]).toHaveTextContent(
      `[${IncidentCustomFieldsCopy.noteTemplatePlaceholdersIntro}]`,
    );
    expect(
      within(parts[1] as HTMLElement).getAllByRole("listitem"),
    ).toHaveLength(INCIDENT_NOTE_TEMPLATE_VARIABLES.length);
    // The list is the hint's last word: no box, note or line after it.
    expect(hint.lastElementChild).toBe(parts[1]);
  });

  test("the copy keeps the intro and carries no warning text", () => {
    expect(IncidentCustomFieldsCopy.noteTemplatePlaceholdersIntro).toMatch(
      /placeholders/,
    );
    expect(
      Object.keys(IncidentCustomFieldsCopy).some((key: string): boolean => {
        return WARNING_KEY.test(key);
      }),
    ).toBe(false);
    expect(
      Object.values(IncidentCustomFieldsCopy).some((text: string): boolean => {
        return WARNING_TEXT.test(text);
      }),
    ).toBe(false);
  });

  test("translates the words, never the placeholders", () => {
    render(<IncidentNoteTemplatePlaceholders />);

    expect(translated).toContain(
      IncidentCustomFieldsCopy.noteTemplatePlaceholdersIntro,
    );

    for (const variable of INCIDENT_NOTE_TEMPLATE_VARIABLES) {
      expect(translated).toContain(variable.description);
    }

    expect(
      translated.some((text: string) => {
        return text.includes("{{");
      }),
    ).toBe(false);

    expect(
      INCIDENT_NOTE_TEMPLATE_VARIABLES.map(
        (variable: IncidentNoteTemplateVariableInfo) => {
          return variable.name;
        },
      ),
    ).toContain("incident.startedAt");
  });
});
