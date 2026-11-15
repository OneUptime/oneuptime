import { describe, expect, test } from "@jest/globals";
import { SetupGuideTranslation } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideTranslation";
import {
  DATABASE_AGENT_SYSTEM_OPTIONS,
  DATABASE_AGENT_SYSTEM_PICKER_WORDS,
  getDatabaseAgentSystemDescription,
  getDatabaseAgentSystems,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";
import { DATABASE_DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationTranslations";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import { getDatabaseSystemDisplayName } from "../../../Types/DatabaseServer/DatabaseSystem";
import { createTranslator, Translator } from "../../../Types/Translator";
import { translateCreateAction } from "../../../UI/Components/ModelTable/BaseModelTable";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE DATABASES SETUP GUIDE'S OWN WORDS, IN EVERY LANGUAGE (#8341).
 *
 * SetupGuideDocumentationInLocale holds the guide's markdown to its English
 * in every language. Two things it cannot see are held here:
 *
 *   - the engine picker's labels and hints are written out as locale keys
 *     (DATABASE_AGENT_SYSTEM_PICKER_WORDS): the hint used to be built at
 *     run time ("Runs the collector's mysql receiver.") and was in no
 *     locale file, so it read English in every language. Written out, each
 *     has to stay what the catalog and the receiver say;
 *   - "Databases → Create Database" names a button no locale key holds
 *     whole: the Databases table draws it from "Create {{itemName}}" and the
 *     locale's word for a Database (translateCreateAction). The guide names
 *     it as the reader sees it.
 */

const CREATE_DATABASE_PATH: string = "**Databases → Create Database**";

const BOLD_RUN: RegExp = /\*\*([^*]+)\*\*/g;
const PATH_ARROW: RegExp = /\s*[→←]\s*/;
// French sets its marks off with a no-break space where it is drawn.
const NO_BREAK_SPACES: RegExp = new RegExp("[\\u00A0\\u202F]", "g");

function translatorFor(language: string): Translator {
  const words: Record<string, string> = readDashboardLocale(language);

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, language);
}

function plainSpaces(text: string): string {
  return text.replace(NO_BREAK_SPACES, " ");
}

// The table's create button, as `language`'s reader sees it.
function createDatabaseButton(language: string): string {
  return plainSpaces(
    translateCreateAction(translatorFor(language), {
      itemName: new DatabaseServer().singularName!,
    }),
  );
}

/*
 * The steps of the bold path a translation names the button by: the one
 * whose English is "Databases → Create Database".
 */
function createDatabaseSteps(
  translation: SetupGuideTranslation,
): Array<Array<string>> {
  return Object.entries(translation)
    .filter(([english]: [string, string]): boolean => {
      return english.includes(CREATE_DATABASE_PATH);
    })
    .map(([, words]: [string, string]): Array<string> => {
      const run: string | undefined = [...words.matchAll(BOLD_RUN)]
        .map((match: RegExpMatchArray): string => {
          return match[1]!;
        })
        .find((bold: string): boolean => {
          return PATH_ARROW.test(bold);
        });

      return (run || "").split(PATH_ARROW).map(plainSpaces);
    });
}

// Whether `steps` name the Databases page and its create button as drawn.
function namesTheButton(steps: Array<string>, language: string): boolean {
  const expected: Array<string> = [
    readDashboardLocale(language)["Databases"]!,
    createDatabaseButton(language),
  ];

  return JSON.stringify([...steps].sort()) === JSON.stringify(expected.sort());
}

const TRANSLATIONS: Record<string, SetupGuideTranslation> = {};

async function translationOf(language: string): Promise<SetupGuideTranslation> {
  if (!TRANSLATIONS[language]) {
    TRANSLATIONS[language] = (
      await DATABASE_DOCUMENTATION_TRANSLATIONS[language]!()
    ).default;
  }

  return TRANSLATIONS[language]!;
}

describe("the engine picker's words", () => {
  test("every engine the agent monitors has its label and hint written out", () => {
    expect(Object.keys(DATABASE_AGENT_SYSTEM_PICKER_WORDS).sort()).toEqual(
      getDatabaseAgentSystems().sort(),
    );
  });

  test.each(getDatabaseAgentSystems())(
    "%s: the label is the catalog's name, the hint the line its receiver gives",
    (system: string) => {
      const words: { label: string; description: string } =
        DATABASE_AGENT_SYSTEM_PICKER_WORDS[system]!;

      expect(words.label).toBe(getDatabaseSystemDisplayName(system));
      expect(words.description).toBe(getDatabaseAgentSystemDescription(system));
    },
  );

  test("the picker draws the written-out words, each a key of the locale files", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const option of DATABASE_AGENT_SYSTEM_OPTIONS) {
      const words: { label: string; description: string } =
        DATABASE_AGENT_SYSTEM_PICKER_WORDS[option.key]!;

      expect(option.label).toBe(words.label);
      expect(option.description).toBe(words.description);
      expect(english[option.label]).toBe(option.label);
      expect(english[option.description!]).toBe(option.description);
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "in %s, every hint is the reader's words, and naming a fork keeps its name",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const option of DATABASE_AGENT_SYSTEM_OPTIONS) {
        const hint: string = locale[option.description!]!;

        expect({ system: option.key, hint }).not.toEqual({
          system: option.key,
          hint: option.description,
        });
        // The receiver and the fork's name are the English's.
        for (const name of option.description!.match(
          /\b(?:postgresql|mysql|sqlserver|oracledb|redis|memcached|mongodb|elasticsearch|MariaDB|Valkey|KeyDB|Dragonfly|OpenSearch)\b/g,
        ) || []) {
          expect({
            system: option.key,
            hint,
            name: hint.includes(name),
          }).toEqual({ system: option.key, hint, name: true });
        }
      }
    },
  );
});

describe("Databases → Create Database, as the Databases table draws its button", () => {
  test("in English, the table draws Create Database", () => {
    expect(createDatabaseButton("en")).toBe("Create Database");
  });

  test.each(DASHBOARD_LANGUAGES)(
    "in %s, the guide names the page and its create button as the reader sees them",
    async (language: string) => {
      const paths: Array<Array<string>> = createDatabaseSteps(
        await translationOf(language),
      );

      expect(paths.length).toBeGreaterThan(0);
      for (const steps of paths) {
        expect({ steps, named: namesTheButton(steps, language) }).toEqual({
          steps,
          named: true,
        });
      }
    },
  );

  test("a button worded as the table does not draw it is caught", () => {
    expect(
      namesTheButton(["Bases de données", "Créer une base de données"], "fr"),
    ).toBe(false);
    expect(namesTheButton(["Datenbanken", "Datenbank erstellen"], "de")).toBe(
      true,
    );
    expect(
      createDatabaseSteps({
        [`Create it under ${CREATE_DATABASE_PATH}.`]:
          "Legen Sie sie unter **Datenbanken → Neue Datenbank** an.",
      }),
    ).toEqual([["Datenbanken", "Neue Datenbank"]]);
  });
});
