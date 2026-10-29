import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as HuntsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityHunt from "../../../Models/DatabaseModels/SecurityHunt";
import SecurityCaseEvidence from "../../../Models/DatabaseModels/SecurityCaseEvidence";
import { SECURITY_CASE_EVENTS_ADD_REASONS } from "../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SECURITY_HUNT_MESSAGES,
  SECURITY_HUNT_RUN_ERRORS,
} from "../../../Types/SecurityEvent/SecurityHunt";
import { PluralTemplate } from "../../../UI/Utils/TranslateTemplate";

/*
 * EVERY WORD OF HUNTS IS EVERY LANGUAGE'S OWN: the list, a hunt's page and
 * its header, the forms, the Events toolbar's Hunts list and Save as Hunt,
 * Add to Case and an event kept on a case, the setting that tells people
 * what a scheduled hunt found, the hunt's model, and every problem and run
 * error the shared rules answer with - read from the Dashboard's locale
 * files themselves, so a key that lost its translation, kept the English
 * or dropped a placeholder is caught. Each language names a hunt one way
 * throughout: the word it gives "Hunt" is in Delete Hunt, Edit Hunt, Save
 * Hunt and Save as Hunt.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);
const PROGRESS_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/i18n/Progress",
);

const LANGUAGES: Array<string> = [
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

// Japanese, Korean and Chinese read no "one" form: theirs may say the same.
const WITHOUT_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

/*
 * The languages that keep security's loanword for a hunt (recorded as the
 * same as English in their progress files), and the words they keep it in.
 */
const HUNT_KEPT_AS_WRITTEN: Array<string> = ["nl", "da", "no", "sv"];

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function readLocale(locale: string): Record<string, string> {
  return readJson(path.join(LOCALES_DIR, `${locale}.json`)) as Record<
    string,
    string
  >;
}

function sameAsEnglish(locale: string): Array<string> {
  return (
    (readJson(path.join(PROGRESS_DIR, `${locale}.json`))["sameAsEnglish"] as
      | Array<string>
      | undefined) || []
  );
}

const ENGLISH: Record<string, string> = readLocale("en");

function isPlural(value: unknown): value is PluralTemplate {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as PluralTemplate).one === "string" &&
    typeof (value as PluralTemplate).other === "string"
  );
}

// An example search written the way the search bar reads it: never translated.
const NOT_WORDS: Array<string> = [HuntsCopy.SEARCH_FIELD_PLACEHOLDER];

const COPY_SENTENCES: Array<string> = [];
const PLURALS: Array<PluralTemplate> = [];

for (const [name, value] of Object.entries(
  HuntsCopy as unknown as Record<string, unknown>,
)) {
  if (name.endsWith("TEST_IDS")) {
    continue;
  }

  if (typeof value === "string") {
    if (!NOT_WORDS.includes(value)) {
      COPY_SENTENCES.push(value);
    }
  } else if (isPlural(value)) {
    PLURALS.push(value);
  } else if (value && typeof value === "object") {
    // The schedule's words, by schedule.
    for (const entry of Object.values(value as Record<string, unknown>)) {
      if (typeof entry === "string") {
        COPY_SENTENCES.push(entry);
      }
    }
  }
}

// Every model's own columns: not this model's words.
const BASE_COLUMNS: ReadonlyArray<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

function modelTexts(model: BaseModel, columns?: Array<string>): Array<string> {
  const texts: Array<string> = [];

  if (!columns) {
    for (const text of [
      model.singularName,
      model.pluralName,
      model.tableDescription,
    ]) {
      if (text) {
        texts.push(text);
      }
    }
  }

  for (const column of columns || model.getTableColumns().columns) {
    if (BASE_COLUMNS.includes(column)) {
      continue;
    }

    const title: string | undefined =
      model.getTableColumnMetadata(column)?.title;

    if (title) {
      texts.push(title);
    }
  }

  return texts;
}

const MESSAGES: Array<string> = [
  ...Object.values(SECURITY_HUNT_MESSAGES),
  ...Object.values(SECURITY_HUNT_RUN_ERRORS),
  ...Object.values(SECURITY_CASE_EVENTS_ADD_REASONS),
].map((entry: { message: string }): string => {
  return entry.message;
});

// What User Settings > Notification Settings says about the hunt's event.
const SETTINGS_WORDS: Array<string> = [
  "Hunt found security events",
  "A scheduled hunt that names you, or a team you are on, finds security events.",
  "Notify me when a scheduled hunt that names me, or a team I am on, finds security events.",
];

const SENTENCES: Array<string> = Array.from(
  new Set([
    ...COPY_SENTENCES,
    ...MESSAGES,
    ...SETTINGS_WORDS,
    ...modelTexts(new SecurityHunt()),
    // The kept event's own columns on a case's evidence.
    ...modelTexts(new SecurityCaseEvidence(), [
      "eventUid",
      "eventTime",
      "eventSnapshot",
    ]),
    new SecurityCaseEvidence().tableDescription || "",
  ]),
).filter((text: string): boolean => {
  return Boolean(text);
});

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(/\{\{[a-zA-Z]+\}\}/g) || [])).sort();
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

describe("the words there are", () => {
  test("are many, and each is an English key of its own", () => {
    expect(SENTENCES.length).toBeGreaterThan(90);
    expect(PLURALS.length).toBeGreaterThan(5);

    const missing: Array<string> = SENTENCES.filter((text: string) => {
      return ENGLISH[text] !== text;
    });

    expect(missing).toEqual([]);

    for (const plural of PLURALS) {
      expect([plural.other, ENGLISH[plural.other]]).toEqual([
        plural.other,
        plural.other,
      ]);
      expect([plural.other, ENGLISH[`${plural.other}_one`]]).toEqual([
        plural.other,
        plural.one,
      ]);
    }
  });
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  const locale: Record<string, string> = LOCALES[language]!;
  const kept: Array<string> = sameAsEnglish(language);

  test("every sentence is translated, keeping its placeholders", () => {
    const wrong: Array<string> = [];

    for (const text of SENTENCES) {
      const translated: string | undefined = locale[text];

      if (!translated || !translated.trim()) {
        wrong.push(`${text} -> (none)`);
      } else if (translated === text && !kept.includes(text)) {
        wrong.push(`${text} -> still English`);
      } else if (
        JSON.stringify(placeholders(translated)) !==
        JSON.stringify(placeholders(text))
      ) {
        wrong.push(`${text} -> ${translated} (placeholders)`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test("every plural is translated, its one form too", () => {
    const wrong: Array<string> = [];

    for (const plural of PLURALS) {
      for (const [key, english] of [
        [plural.other, plural.other],
        [`${plural.other}_one`, plural.one],
      ] as Array<[string, string]>) {
        const translated: string | undefined = locale[key];

        if (!translated) {
          wrong.push(`${key} -> (none)`);
        } else if (
          translated === english &&
          !kept.includes(english) &&
          !(WITHOUT_ONE_FORM.includes(language) && key.endsWith("_one"))
        ) {
          wrong.push(`${key} -> still English`);
        } else if (
          JSON.stringify(placeholders(translated)) !==
          JSON.stringify(placeholders(english))
        ) {
          wrong.push(`${key} -> ${translated} (placeholders)`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("names a hunt one way throughout", () => {
    const hunt: string = (locale["Hunt"] || "").toLowerCase();

    expect(hunt.length).toBeGreaterThan(0);

    for (const text of [
      "Delete Hunt",
      "Edit Hunt",
      "Save Hunt",
      "Save as Hunt",
    ]) {
      expect([text, (locale[text] || "").toLowerCase().includes(hunt)]).toEqual(
        [text, true],
      );
    }

    if (HUNT_KEPT_AS_WRITTEN.includes(language)) {
      expect(kept).toEqual(expect.arrayContaining(["Hunt", "Hunts"]));
    } else {
      expect(locale["Hunt"]).not.toBe("Hunt");
      expect(locale["Hunts"]).not.toBe("Hunts");
    }
  });
});
