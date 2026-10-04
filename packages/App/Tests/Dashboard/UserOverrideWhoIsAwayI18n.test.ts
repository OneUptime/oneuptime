import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Adding an on-call override asks who is away and who covers, in plain
 * words: "Who is away?" (you, to start with), "Who covers?", "Starts" (now)
 * and "Ends", and the overrides list reads Away, Covered by, Starts, Ends.
 * Every word the dialog, its pickers and the list draw is looked up in the
 * Dashboard locale files by its English text, so a string no locale carries
 * stays English for everyone. This pins the strings the change added - in
 * all seventeen locales, translated - the existing ones the page now leans
 * on, and that the ones only the old two-step form drew are drawn no more.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_UI: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

// Every key this change added that the Dashboard's code draws.
const NEW_STRINGS: Array<string> = [
  // The two questions about people, their pickers and their checks.
  "Who is away?",
  "Alerts that would page them go to the person who covers.",
  "Choose who is away",
  "Choose who is away.",
  "Who covers?",
  "They get those alerts until the override ends.",
  "Choose who covers",
  "Choose who covers.",
  "There is no one else in this project.",
  "Choose someone other than the person who is away.",
  // When the override runs.
  "It starts now unless you pick another time.",
  "From then on, alerts page the person who is away again.",
  "The override has to end after it starts.",
  // The overrides list and its cards, on a policy and for every policy.
  "Away",
  "Covered by",
  "While someone is away, an override sends their pages from this policy to the person who covers. To cover someone on every policy at once, add the override under On-Call Duty > User Overrides.",
  "While someone is away, an override sends their pages from every on-call policy to the person who covers. To cover someone on one policy only, add the override on that policy's User Overrides page.",
];

/*
 * The model's own description, which the extractor reads from the model
 * rather than from the Dashboard's code.
 */
const MODEL_DESCRIPTION: string =
  "While someone is away, a user override sends the alerts that would page them to the person who covers, for a set time. An override on an on-call policy applies to that policy only; one without a policy applies to every on-call policy.";

/*
 * Words the page draws that were there before, translated wherever they
 * were not yet: the field titles, the schedule card's caption for the
 * person covering, and the cards' titles and empty lists.
 */
const REUSED_STRINGS: Array<string> = [
  "Starts",
  "Ends",
  "Covering",
  "Global User Overrides",
  "On-Call Policy User Overrides",
  "No user overrides have been set for this policy.",
  "No global user overrides have been set.",
];

// Strings only the old two-step form, its list and the old card captions drew.
const RETIRED_STRINGS: Array<string> = [
  "Override User",
  "Select the user who will override the on-call duty.",
  "Select Override User",
  "Route Alerts To User",
  "Select the user to whom alerts will be routed.",
  "Select User to Route Alerts",
  "Select the start date and time for the override.",
  "Select the end date and time for the override.",
  "Select Start Date and Time",
  "Select End Date and Time",
  "Overrides are usually useful when the user is on vacation or sick leave and you want to temporarily assign the on-call duty to another user.",
  "Global overrides are useful for assigning on-call duties across all policies when a user is unavailable.",
  "Overridden",
  "Alerts go here",
];

const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

type ReadLocaleFunction = (file: string) => Record<string, unknown>;

const readLocale: ReadLocaleFunction = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
};

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string) => {
    return file.endsWith(".json");
  })
  .sort();

const NON_ENGLISH_FILES: Array<string> = LOCALE_FILES.filter((file: string) => {
  return file !== "en.json";
});

type StripCommentsFunction = (source: string) => string;

const stripComments: StripCommentsFunction = (source: string): string => {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
};

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

type ListSourcesFunction = (directory: string) => Array<string>;

const listSources: ListSourcesFunction = (directory: string): Array<string> => {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return ["node_modules", "Locales", "build", "dist"].includes(entry.name)
          ? []
          : listSources(full);
      }

      return TYPESCRIPT_FILE.test(entry.name) ? [full] : [];
    });
};

// The code the strings are drawn from, without the prose about it.
const CODE: string = [...listSources(DASHBOARD_SRC), ...listSources(COMMON_UI)]
  .map((file: string): string => {
    return stripComments(fs.readFileSync(file, "utf8"));
  })
  .join("\n");

/*
 * What is wrong with a translation: missing, still English, its
 * placeholders changed, or a sentence turned into a label or back.
 */
type ProblemsFunction = (
  text: string,
  value: unknown,
  isSentence: boolean,
) => Array<string>;

const findProblems: ProblemsFunction = (
  text: string,
  value: unknown,
  isSentence: boolean,
): Array<string> => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [`missing: ${text}`];
  }

  if (value === text) {
    return [`left in English: ${text}`];
  }

  const placeholders: string = (text.match(PLACEHOLDER) || []).sort().join(",");

  if ((value.match(PLACEHOLDER) || []).sort().join(",") !== placeholders) {
    return [`placeholders changed: ${text}`];
  }

  // A sentence stays a sentence and a label stays a label.
  const endsLikeSentence: boolean = SENTENCE_ENDINGS.some(
    (ending: string): boolean => {
      return value.trim().endsWith(ending);
    },
  );

  if (isSentence !== endsLikeSentence) {
    return [`punctuation differs: ${text}`];
  }

  return [];
};

describe("the user override form's strings", () => {
  test("seventeen locales are checked", () => {
    expect(LOCALE_FILES).toHaveLength(17);
    expect(LOCALE_FILES).toContain("en.json");
  });

  test("each new string is drawn by the code, as one whole string", () => {
    const unused: Array<string> = NEW_STRINGS.filter(
      (text: string): boolean => {
        return !CODE.includes(`"${text}"`);
      },
    );

    expect(unused).toEqual([]);
  });

  test("none of the retired strings is drawn any more", () => {
    const drawn: Array<string> = RETIRED_STRINGS.filter(
      (text: string): boolean => {
        return CODE.includes(`"${text}"`);
      },
    );

    expect(drawn).toEqual([]);
  });

  test("English carries every new string as itself", () => {
    const english: Record<string, unknown> = readLocale("en.json");

    const wrong: Array<string> = [...NEW_STRINGS, MODEL_DESCRIPTION].filter(
      (text: string): boolean => {
        return english[text] !== text;
      },
    );

    expect(wrong).toEqual([]);
  });

  test.each(NON_ENGLISH_FILES)(
    "%s translates every new string",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      const problems: Array<string> = [
        ...NEW_STRINGS,
        MODEL_DESCRIPTION,
      ].flatMap((text: string): Array<string> => {
        return findProblems(text, locale[text], text.endsWith("."));
      });

      expect(problems).toEqual([]);
    },
  );

  test.each(NON_ENGLISH_FILES)(
    "%s translates the words the page already drew",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      const problems: Array<string> = REUSED_STRINGS.flatMap(
        (text: string): Array<string> => {
          return findProblems(text, locale[text], text.endsWith("."));
        },
      );

      expect(problems).toEqual([]);
    },
  );

  /*
   * "Add User Override" is the action's template ("Add {{itemName}}") with
   * the model's name in it, so the name is translated as a whole term - not
   * two glued words ("Utente Sostituzione").
   */
  test.each(NON_ENGLISH_FILES)(
    "%s names a user override as one term",
    (file: string) => {
      const value: unknown = readLocale(file)["User Override"];

      expect(findProblems("User Override", value, false)).toEqual([]);

      // Two capitalised words glued with a space read as a word-by-word translation.
      expect(String(value)).not.toMatch(/^\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+$/u);
    },
  );
});
