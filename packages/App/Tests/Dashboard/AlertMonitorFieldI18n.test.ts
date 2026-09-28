import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The alert page's Affected Resources card gained a Monitor dropdown, and
 * its resource picker a title and a reworded description. FormField and
 * FieldLabel look each field's title, description and placeholder up in the
 * Dashboard locale files by its English text, so a string with no entry
 * silently stays English. This pins both halves:
 *
 *   - the card still renders exactly these strings (a reworded string would
 *     leave its translations orphaned and the new wording untranslated);
 *   - en.json maps each to itself, and all sixteen other locales carry a
 *     real, non-empty translation in the same place in the file.
 *
 * Where the Create page already says the same thing, the card reuses its
 * wording, which every locale translates: "Select Monitor" rather than a
 * new lower-case "Select monitor" that no locale has.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "Common");

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const ALERT_PAGE: string = "Pages/Alerts/View/Index.tsx";
const CREATE_PAGE: string = "Pages/Alerts/Create.tsx";

// The Monitor field's description while the monitor can be changed.
const UNLOCKED_DESCRIPTION: string =
  "Select the monitor affected by this alert.";

/*
 * Its description on an alert raised automatically, where it is locked. An
 * automatic alert with no monitor is not offered the field at all, so there
 * is no third wording to translate.
 */
const LOCKED_DESCRIPTION: string =
  "This alert was raised by this monitor, which resolves it automatically when the monitor recovers, so it can't be moved to another monitor or removed.";

// The picker's description, which now names databases too.
const PICKER_DESCRIPTION: string =
  "Search and attach hosts, clusters, container hosts, databases, or services affected by this alert.";

/*
 * Strings the two fields share with the Create page, already in every
 * locale. Pinned so a cleanup of "unused" keys cannot take one of them away
 * from this card.
 */
const REUSED_KEYS: Array<string> = [
  "Monitor",
  "Select Monitor",
  UNLOCKED_DESCRIPTION,
  "Other Affected Resources",
];

/*
 * Strings the card added. The Locales files are updated separately from
 * this change, so their check below is marked `failing` until they are.
 */
const NEW_KEYS: Array<string> = [LOCKED_DESCRIPTION, PICKER_DESCRIPTION];

// What a sentence may end with, per script.
const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

function readRaw(relativePath: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
}

// Comments removed (they may quote copy), whitespace squashed.
function readCode(relativePath: string): string {
  return readRaw(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

function readCommon(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(COMMON_ROOT, ...relativePath), "utf8")
    .replace(/\s+/g, " ");
}

function readLocale(file: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
}

/*
 * The source from `start` to `end` (or to the end of the source). Throws
 * rather than returning empty: a marker that moved would otherwise let the
 * checks below pass vacuously.
 */
function sectionFrom(source: string, start: string, end?: string): string {
  const startsAt: number = source.indexOf(start);

  if (startsAt < 0) {
    throw new Error(`Expected to find ${start}`);
  }

  if (!end) {
    return source.slice(startsAt);
  }

  const endsAt: number = source.indexOf(end, startsAt + start.length);

  if (endsAt < 0) {
    throw new Error(`Expected to find ${end} after ${start}`);
  }

  return source.slice(startsAt, endsAt);
}

/*
 * The Affected Resources card's two form fields: the Monitor dropdown and
 * the picker, up to the picker's element. The card is looked up by name
 * first, because the Alert Details card also has a monitor field.
 */
function affectedResourcesFields(): string {
  const card: string = sectionFrom(
    readCode(ALERT_PAGE),
    'name="Affected Resources"',
    "getCustomElement:",
  );

  return sectionFrom(card, "field: { monitor: true }");
}

/*
 * Literal values of the props FormField and FieldLabel look up (title,
 * description, placeholder), including both branches of a
 * `flag ? "…" : "…"` description.
 */
function translatedPropLiterals(code: string): Array<string> {
  const literals: Array<string> = [];
  const pattern: RegExp =
    /\b(?:title|description|placeholder)\s*:\s*(?:[A-Za-z_$][\w$]*\s*\?\s*)?"((?:[^"\\]|\\.)*)"(?:\s*:\s*"((?:[^"\\]|\\.)*)")?/g;
  let match: RegExpExecArray | null = pattern.exec(code);

  while (match !== null) {
    for (const literal of [match[1], match[2]]) {
      if (literal !== undefined) {
        literals.push(JSON.parse(`"${literal}"`) as string);
      }
    }

    match = pattern.exec(code);
  }

  return literals;
}

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set<string>(values)).sort();
}

const localeFiles: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .sort();

const nonEnglishLocaleFiles: Array<string> = localeFiles.filter(
  (file: string): boolean => {
    return file !== "en.json";
  },
);

const english: Record<string, unknown> = readLocale("en.json");
const englishKeys: Array<string> = Object.keys(english);

// The keys on either side of `key` in a locale file, in file order.
function neighboursOf(
  keys: Array<string>,
  key: string,
): { before: string | undefined; after: string | undefined } {
  const index: number = keys.indexOf(key);

  return {
    before: index > 0 ? keys[index - 1] : undefined,
    after: index >= 0 ? keys[index + 1] : undefined,
  };
}

describe("Alert page, Affected Resources card: Monitor field translations", () => {
  test("the lists are well formed", () => {
    expect(new Set<string>([...REUSED_KEYS, ...NEW_KEYS]).size).toBe(
      REUSED_KEYS.length + NEW_KEYS.length,
    );

    // Exactly 17 Dashboard locales: English and the sixteen translations.
    expect(localeFiles.length).toBe(17);
  });

  test("the Monitor and picker fields render exactly these strings", () => {
    const fields: string = affectedResourcesFields();

    expect(fields).toContain('title: "Monitor"');
    expect(fields).toContain(
      `description: isCreatedAutomatically ? "${LOCKED_DESCRIPTION}" : "${UNLOCKED_DESCRIPTION}"`,
    );
    expect(fields).toContain('placeholder: "Select Monitor"');
    expect(fields).toContain('title: "Other Affected Resources"');
    expect(fields).toContain(`description: "${PICKER_DESCRIPTION}"`);
  });

  /*
   * Every string the two fields hand to a translating prop is listed above,
   * so a string added to them later has to be listed (and translated) too.
   */
  test("the lists cover every string the two fields hand to a translating prop", () => {
    expect(unique(translatedPropLiterals(affectedResourcesFields()))).toEqual(
      unique([...REUSED_KEYS, ...NEW_KEYS]),
    );
  });

  /*
   * The regression this file was written for: "Select monitor" is no key in
   * any locale, so it stayed English everywhere. The Create page's
   * "Select Monitor" is translated by all of them.
   */
  test("the placeholder is the Create page's translated spelling", () => {
    const fields: string = affectedResourcesFields();

    expect(fields).not.toContain('"Select monitor"');
    expect(readCode(CREATE_PAGE)).toContain('placeholder: "Select Monitor"');

    for (const file of localeFiles) {
      expect(readLocale(file)).not.toHaveProperty(["Select monitor"]);
    }
  });

  test("en.json maps every reused string to itself", () => {
    const missing: Array<string> = REUSED_KEYS.filter(
      (key: string): boolean => {
        return english[key] !== key;
      },
    );

    expect(missing).toEqual([]);
  });

  test.each(nonEnglishLocaleFiles)(
    "%s translates every reused string",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);
      const problems: Array<string> = [];

      for (const key of REUSED_KEYS) {
        const value: unknown = locale[key];

        if (typeof value !== "string" || value.trim().length === 0) {
          problems.push(`missing: ${key}`);
        }
      }

      expect(problems).toEqual([]);
    },
  );

  /*
   * The strings this card introduced, in en.json and the sixteen other
   * Dashboard locales, each at the same place in every file.
   */
  test("every locale translates the new strings, between the same neighbours as en.json", () => {
    const problems: Array<string> = [];

    for (const key of NEW_KEYS) {
      if (english[key] !== key) {
        problems.push(`en.json: missing: ${key}`);
      }
    }

    for (const file of nonEnglishLocaleFiles) {
      const locale: Record<string, unknown> = readLocale(file);
      const keys: Array<string> = Object.keys(locale);

      for (const key of NEW_KEYS) {
        const value: unknown = locale[key];

        if (typeof value !== "string" || value.trim().length === 0) {
          problems.push(`${file}: missing: ${key}`);
          continue;
        }

        /*
         * Neither string is a brand or loanword, so a value identical to
         * English is a copy someone forgot to translate.
         */
        if (value === key) {
          problems.push(`${file}: left in English: ${key}`);
        }

        // Both are sentences, and stay sentences.
        const endsLikeSentence: boolean = SENTENCE_ENDINGS.some(
          (ending: string): boolean => {
            return value.trim().endsWith(ending);
          },
        );

        if (!endsLikeSentence) {
          problems.push(`${file}: not a sentence: ${key}`);
        }

        if (
          JSON.stringify(neighboursOf(keys, key)) !==
          JSON.stringify(neighboursOf(englishKeys, key))
        ) {
          problems.push(`${file}: misplaced: ${key}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("the components that show these strings look them up by their English text", () => {
    const formField: string = readCommon(
      "UI",
      "Components",
      "Forms",
      "Fields",
      "FormField.tsx",
    );
    const fieldLabel: string = readCommon(
      "UI",
      "Components",
      "Forms",
      "Fields",
      "FieldLabel.tsx",
    );

    // FormField translates the placeholder and hands the label to FieldLabel.
    expect(formField).toContain("translateString( props.field.placeholder, )");
    expect(formField).toContain("<FieldLabelElement");

    // FieldLabel translates the title and the description.
    expect(fieldLabel).toContain("translateString(props.title)");
    expect(fieldLabel).toContain("translateValue(props.description)");
  });
});
