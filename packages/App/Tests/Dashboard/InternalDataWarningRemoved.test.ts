import IncidentCustomFieldsCopy from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldsCopy";
import IncidentCustomFieldTemplateVariablesCopy from "../../FeatureSet/Dashboard/src/Components/StatusPage/IncidentCustomFieldTemplateVariablesCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Please remove this yellow warning. We don't need it."
 *
 * The note template form (Incidents -> Settings -> Note Templates: a new
 * template's Note Details step, and a template's Edit Note Template dialog)
 * showed a yellow "Internal data" box under the placeholders a note can use.
 * The subscriber notification template forms showed its twin - the same
 * title and the same message - above the project's incident custom fields.
 * Both are gone, with their words in every Dashboard locale. This keeps
 * them gone:
 *
 *   1. the copy modules carry neither warning, and keep the text around it;
 *   2. the two panels that carried a warning draw no yellow box at all, and
 *      neither they nor the pages whose forms show them hold the warning's
 *      title, words or test ids - nor does any other Dashboard source;
 *   3. no Dashboard locale file keeps an entry for the removed strings while
 *      nothing in the Dashboard looks them up.
 *
 * The rendered forms are checked in Common/Tests/App/Dashboard/
 * TemplateFormsNoInternalDataWarning, and the docs in
 * Tests/FeatureSet/Docs/InternalDataWarningRemovedDocs.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const REMOVED_TITLE: string = "Internal data";

const REMOVED_NOTE_TEMPLATE_WARNING: string =
  "Custom field values, labels and the affected status pages come from your team's incident records, whether or not a field is marked Include in Subscriber Notifications. A public note is shown on the status pages the incident is on and emailed to their subscribers, so read the filled-in text before you post a public note.";

const REMOVED_SUBSCRIBER_TEMPLATE_WARNING: string =
  "Custom field values and the list of affected status pages come from your team's incident records. The subscribers of a status page are usually outside your team, and the affected status pages name every audience the incident reaches. Place them only in templates whose subscribers may see them.";

// The removed strings, named for the test titles.
const REMOVED_STRINGS: Array<[string, string]> = [
  ["the warnings' title", REMOVED_TITLE],
  ["the note template warning", REMOVED_NOTE_TEMPLATE_WARNING],
  ["the subscriber template warning", REMOVED_SUBSCRIBER_TEMPLATE_WARNING],
];

/*
 * Phrases from each warning's body, to catch it coming back reworded or
 * split across lines.
 */
const REMOVED_PHRASES: Array<string> = [
  "before you post a public note",
  "read the filled-in text",
  "Place them only in templates whose subscribers may see them",
  "name every audience the incident reaches",
];

const REMOVED_TEST_IDS: Array<string> = [
  "incident-note-template-internal-data-warning",
  "incident-template-variables-internal-data-warning",
];

// The two panels that each carried a warning.
const PANELS: Array<string> = [
  "Components/Incident/IncidentNoteTemplatePlaceholders.tsx",
  "Components/StatusPage/IncidentCustomFieldTemplateVariables.tsx",
];

// The pages whose forms show those panels.
const TEMPLATE_PAGES: Array<string> = [
  "Pages/Incidents/Settings/IncidentNoteTemplates.tsx",
  "Pages/Incidents/Settings/IncidentNoteTemplateView.tsx",
  "Pages/StatusPages/Settings/SubscriberNotificationTemplates.tsx",
  "Pages/StatusPages/Settings/SubscriberNotificationTemplateView.tsx",
];

// A copy key that names a warning.
const WARNING_KEY: RegExp = /warning|internaldata/i;

// The shared Alert's warning type, or an amber or yellow surface of its own.
const YELLOW_BOX: RegExp =
  /AlertType\.WARNING|\bbg-(?:amber|yellow)-\d+|\bborder-(?:amber|yellow)-\d+/;

// The text as a string literal, in any of the three quotes.
function literalsOf(text: string): Array<string> {
  return [`"${text}"`, `'${text}'`, `\`${text}\``];
}

// Whitespace runs, line breaks included, made one space.
function flatten(source: string): string {
  return source.replace(/\s+/g, " ");
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "Locales" || entry.name === "node_modules") {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

// Every Dashboard source file, by its path under src, read once.
const SOURCES: Map<string, string> = new Map(
  listSourceFiles(DASHBOARD_SRC).map((file: string): [string, string] => {
    return [path.relative(DASHBOARD_SRC, file), fs.readFileSync(file, "utf8")];
  }),
);

function sourceOf(relativePath: string): string {
  const source: string | undefined = SOURCES.get(
    relativePath.split("/").join(path.sep),
  );

  if (source === undefined) {
    throw new Error(`No Dashboard source at ${relativePath}`);
  }

  return source;
}

// Whether any Dashboard source still holds the text as a string literal.
function isLookedUpAnywhere(text: string): boolean {
  return Array.from(SOURCES.values()).some((source: string): boolean => {
    return literalsOf(text).some((literal: string): boolean => {
      return source.includes(literal);
    });
  });
}

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .sort();

describe("the 'Internal data' warning stays removed", () => {
  describe("the copy", () => {
    test("the note template copy carries no warning, and keeps the variables' intro", () => {
      const keys: Array<string> = Object.keys(IncidentCustomFieldsCopy);
      const values: Array<string> = Object.values(IncidentCustomFieldsCopy);

      expect(keys).not.toContain("noteTemplateInternalDataWarningTitle");
      expect(keys).not.toContain("noteTemplateInternalDataWarning");
      expect(
        keys.filter((key: string): boolean => {
          return WARNING_KEY.test(key);
        }),
      ).toEqual([]);

      for (const [, removed] of REMOVED_STRINGS) {
        expect(values).not.toContain(removed);
      }

      /*
       * The intro is the first line of the note's Template variables list
       * now, and says "variables", as the list does.
       */
      expect(IncidentCustomFieldsCopy.noteTemplateVariablesIntro).toBe(
        "When this template is used in an incident's notes, these variables are filled in with the incident's values. A variable with no value stays as written.",
      );
    });

    test("the subscriber template copy carries no warning, and keeps who may place fields", () => {
      const keys: Array<string> = Object.keys(
        IncidentCustomFieldTemplateVariablesCopy,
      );
      const values: Array<string> = Object.values(
        IncidentCustomFieldTemplateVariablesCopy,
      );

      expect(keys).not.toContain("internalDataWarningTitle");
      expect(keys).not.toContain("internalDataWarning");
      expect(
        keys.filter((key: string): boolean => {
          return WARNING_KEY.test(key);
        }),
      ).toEqual([]);

      for (const [, removed] of REMOVED_STRINGS) {
        expect(values).not.toContain(removed);
      }

      // The save still refuses these placements, so the line saying so stays.
      expect(
        IncidentCustomFieldTemplateVariablesCopy.placementPermission,
      ).toContain("can save a template that places a custom field");
    });
  });

  describe("the panels and the template forms", () => {
    test.each(PANELS)("%s draws no yellow box at all", (file: string) => {
      expect(sourceOf(file)).not.toMatch(YELLOW_BOX);
    });

    test.each([...PANELS, ...TEMPLATE_PAGES])(
      "%s holds none of the warning's title, words or test ids",
      (file: string) => {
        const source: string = sourceOf(file);
        const flat: string = flatten(source);

        for (const literal of literalsOf(REMOVED_TITLE)) {
          expect(source).not.toContain(literal);
        }

        expect(source).not.toMatch(/noteTemplate\w*Warning/);
        expect(source).not.toMatch(/internalDataWarning/);

        for (const phrase of REMOVED_PHRASES) {
          expect(flat).not.toContain(phrase);
        }

        for (const testId of REMOVED_TEST_IDS) {
          expect(source).not.toContain(testId);
        }
      },
    );

    test("no Dashboard source holds the warnings' words or test ids", () => {
      expect(SOURCES.size).toBeGreaterThan(100);

      const offenders: Array<string> = Array.from(SOURCES.entries())
        .filter(([, source]: [string, string]): boolean => {
          const flat: string = flatten(source);

          return [...REMOVED_PHRASES, ...REMOVED_TEST_IDS].some(
            (needle: string): boolean => {
              return flat.includes(needle);
            },
          );
        })
        .map(([file]: [string, string]): string => {
          return file;
        });

      expect(offenders).toEqual([]);
    });

    test.each(REMOVED_STRINGS.slice(1))(
      "nothing in the Dashboard looks up %s any more",
      (_name: string, text: string) => {
        expect(isLookedUpAnywhere(text)).toBe(false);
      },
    );
  });

  describe("the Dashboard locales", () => {
    test("there are locale files to check", () => {
      expect(LOCALE_FILES).toContain("en.json");
      expect(LOCALE_FILES.length).toBeGreaterThanOrEqual(17);
    });

    /*
     * An entry belongs in a locale only while something looks it up. The
     * two warnings' texts never are again (above); the title is short
     * enough that another feature might one day want it.
     */
    const unused: Array<string> = REMOVED_STRINGS.map(
      ([, text]: [string, string]): string => {
        return text;
      },
    ).filter((text: string): boolean => {
      return !isLookedUpAnywhere(text);
    });

    test("today nothing looks up any of the removed strings", () => {
      expect(unused).toEqual([
        REMOVED_TITLE,
        REMOVED_NOTE_TEMPLATE_WARNING,
        REMOVED_SUBSCRIBER_TEMPLATE_WARNING,
      ]);
    });

    describe.each(LOCALE_FILES)("%s", (file: string) => {
      const translations: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      ) as Record<string, unknown>;

      test("keeps no entry for a removed string nothing looks up", () => {
        const keys: Array<string> = Object.keys(translations);

        for (const text of unused) {
          expect(keys).not.toContain(text);
        }
      });

      test("still translates the variables' intro and who may place fields", () => {
        for (const kept of [
          IncidentCustomFieldsCopy.noteTemplateVariablesIntro,
          IncidentCustomFieldTemplateVariablesCopy.placementPermission,
        ]) {
          expect(typeof translations[kept]).toBe("string");
          expect((translations[kept] as string).trim().length).toBeGreaterThan(
            0,
          );
        }
      });
    });
  });
});
