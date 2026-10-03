import IncidentCustomFieldsCopy from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldsCopy";
import { CUSTOM_FIELD_NO_VALUE_PLACEHOLDER } from "Common/UI/Components/CustomFields/CustomFieldFormFields";
import {
  INCIDENT_NOTE_TEMPLATE_VARIABLES,
  IncidentNoteTemplateVariableInfo,
} from "Common/Utils/Incident/IncidentNoteTemplateVariables";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The text around incident custom field values outside the Custom Fields
 * card - the Details step of declaring an incident, an incident template's
 * values, and the placeholders a note template can use - reaches the screen
 * by looking its English text up in the Dashboard locale files. A string
 * with no entry silently stays English, so this pins:
 *
 *   - en.json maps every string to itself, and all sixteen other locales
 *     carry a translation with the same {{placeholders}};
 *   - no string holds a "{{", which the lookup would take for a placeholder
 *     of its own (the note template placeholders are shown as code, outside
 *     the lookup);
 *   - the pages render through the shared constants.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

/*
 * Entries other pages had before this one, some of them spelled the same in
 * some languages ("Details" in German).
 */
const SHARED_WITH_OTHER_FEATURES: Array<string> = [
  "Details",
  "Custom Fields",
  "No data entered",
  "Title",
  "Incident Number",
  "Incident Severity",
  "Current State",
  "Declared At",
  "Labels",
];

const STRINGS: Array<string> = Array.from(
  new Set([
    ...Object.values(IncidentCustomFieldsCopy),
    ...INCIDENT_NOTE_TEMPLATE_VARIABLES.map(
      (variable: IncidentNoteTemplateVariableInfo) => {
        return variable.description;
      },
    ),
    CUSTOM_FIELD_NO_VALUE_PLACEHOLDER,
  ]),
);

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function readSource(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8")
    .replace(/\s+/g, " ");
}

describe("incident custom field strings in every Dashboard locale", () => {
  test("there are strings to check", () => {
    expect(STRINGS.length).toBeGreaterThan(10);
  });

  test.each(STRINGS)("%j holds no placeholder braces", (text: string) => {
    expect(text).not.toContain("{{");
  });

  test.each(STRINGS)("en.json maps %j to itself", (text: string) => {
    expect(readLocale("en")[text]).toBe(text);
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(STRINGS)("translates %j", (text: string) => {
      const value: unknown = translations[text];

      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect(placeholders(value as string)).toEqual(placeholders(text));

      if (!SHARED_WITH_OTHER_FEATURES.includes(text)) {
        expect(value).not.toBe(text);
      }
    });
  });
});

describe("the pages render the shared strings and wiring", () => {
  test("the Create page's Details step takes its title from the shared constant", () => {
    const source: string = readSource("Pages", "Incidents", "Create.tsx");

    expect(source).toContain("title: INCIDENT_DETAILS_STEP_TITLE");
    expect(IncidentCustomFieldsCopy.detailsStepTitle).toBe("Details");
  });

  test("the Create page reads the Details step's answers from the submitted values", () => {
    const source: string = readSource("Pages", "Incidents", "Create.tsx");

    expect(source).toContain("formValues: JSONObject,");
    expect(source).toContain("formValues: formValues,");
    expect(source).toContain("removeCustomFieldFormKeys(miscDataProps)");
  });

  test("the template pages take their text from the shared copy", () => {
    const view: string = readSource(
      "Pages",
      "Incidents",
      "Settings",
      "IncidentTemplatesView.tsx",
    );

    expect(view).toContain(
      "IncidentCustomFieldsCopy.templateCustomFieldsCardTitle",
    );
    expect(view).toContain(
      "IncidentCustomFieldsCopy.templateCustomFieldsCardDescription",
    );

    const list: string = readSource(
      "Pages",
      "Incidents",
      "Settings",
      "IncidentTemplates.tsx",
    );

    expect(list).toContain("INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_TITLE");
    expect(IncidentCustomFieldsCopy.templateCustomFieldsStepTitle).toBe(
      "Custom Fields",
    );
  });

  /*
   * The note's variables are the Markdown editor's - collapsed under it,
   * behind Insert variable and "{{" - not a list printed above it.
   */
  test.each([["IncidentNoteTemplates.tsx"], ["IncidentNoteTemplateView.tsx"]])(
    "the note template form in %s hands the editor the variables it can use",
    (file: string) => {
      const source: string = readSource("Pages", "Incidents", "Settings", file);

      expect(source).toContain("useIncidentNoteTemplateVariables()");
      expect(source).toContain(
        "templateVariables: noteTemplateVariables.groups",
      );
      expect(source).toContain(
        "templateVariablesDescription: noteTemplateVariables.description",
      );
      expect(source).not.toContain("<IncidentNoteTemplatePlaceholders />");
    },
  );

  test.each([
    ["getIncidentPublicNoteKind", "getIncidentPrivateNoteKind"],
    ["getIncidentPrivateNoteKind", "export function"],
  ])(
    "the incident's %s fills a picked template's placeholders",
    (kindFunction: string, next: string) => {
      /*
       * The incident's note kinds, read by its Notes pages and by the
       * Incident Feed's "Add ... Note" dialogs alike.
       */
      const source: string = readSource(
        "Components",
        "EventNotes",
        "NoteKinds",
        "IncidentNoteKinds.tsx",
      );
      const start: number = source.indexOf(`export function ${kindFunction}(`);
      const end: number = source.indexOf(next, start + 1);
      const kind: string = source.slice(start, end < 0 ? undefined : end);

      expect(start).toBeGreaterThan(-1);
      expect(kind).toContain(
        "templateVariables: () => { return fetchIncidentNoteTemplateVariables(incidentId); },",
      );
    },
  );

  test.each([["PublicNote.tsx"], ["InternalNote.tsx"]])(
    "the incident's %s page reads its note kind",
    (file: string) => {
      const source: string = readSource("Pages", "Incidents", "View", file);

      expect(source).toMatch(
        /\{\.\.\.getIncident(Public|Private)NoteKind\(\{ incidentId: modelId[ ,]/,
      );
    },
  );
});
