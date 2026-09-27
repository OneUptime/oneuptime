import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";

/*
 * Under a note template's text, wherever one is written: the placeholders it
 * can use. They are shown as code and never go through the translation
 * lookup, which would read their braces as placeholders of its own and blank
 * them; the words around them do.
 */

const translated: Array<string> = [];

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
