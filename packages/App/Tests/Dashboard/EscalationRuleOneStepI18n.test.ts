import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Adding an escalation rule is one short step: who to notify (one picker of
 * on-call schedules, teams and people) and how long to wait, with the name
 * and the description folded under Advanced. Every word the dialog and its
 * picker draw is looked up in the Dashboard locale files by its English
 * text, so a string no locale carries stays English for everyone. This pins
 * the strings the change added - in all seventeen locales, translated - and
 * that the ones only the old three-step form used left the source and the
 * locales together.
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

// Every key this change added, by where it is drawn.
const NEW_STRINGS: Array<string> = [
  // The dialog.
  "Who gets paged at this level, and how long to wait for an acknowledgement before escalating.",
  // Its Notify field and picker.
  "On-call schedules page whoever is on call. Teams page every member.",
  "Add responder",
  "Search schedules, teams or people...",
  "No on-call schedules, teams or people to pick from.",
  "Add at least one on-call schedule, team or person to notify.",
  // The wait.
  "If nobody acknowledges within this time, the next level is paged.",
  // The name, under Advanced.
  "Leave it empty to name this rule after its level.",
  // The people picker's on-call schedule kind (Common).
  "On-call schedules",
  "Unknown schedule",
];

// Keys only the old three-step form used. None is drawn any more.
const RETIRED_STRINGS: Array<string> = [
  "A short name to identify this escalation rule.",
  "First Responders",
  "An optional description for this escalation rule.",
  "On-call schedules to notify. The person currently on-call will be contacted.",
  "Every member of the selected teams will be notified.",
  "Select on-call schedules",
  "Select teams",
  "Select users",
  "Specific users to notify directly.",
  "How long to wait for an acknowledgement before escalating to the next rule.",
  "Escalation rules determine who to contact, and when, once an incident is triggered.",
  "Update the rule's details and change who it notifies.",
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

describe("the one-step escalation rule dialog's strings", () => {
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

    const wrong: Array<string> = NEW_STRINGS.filter((text: string): boolean => {
      return english[text] !== text;
    });

    expect(wrong).toEqual([]);
  });

  test.each(LOCALE_FILES)(
    "%s keeps none of the retired keys",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      const kept: Array<string> = RETIRED_STRINGS.filter(
        (text: string): boolean => {
          return text in locale;
        },
      );

      expect(kept).toEqual([]);
    },
  );

  test.each(NON_ENGLISH_FILES)(
    "%s translates every new string",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      const problems: Array<string> = NEW_STRINGS.flatMap(
        (text: string): Array<string> => {
          const value: unknown = locale[text];

          if (typeof value !== "string" || value.trim().length === 0) {
            return [`missing: ${text}`];
          }

          if (value === text) {
            return [`left in English: ${text}`];
          }

          const placeholders: string = (text.match(PLACEHOLDER) || [])
            .sort()
            .join(",");

          if (
            (value.match(PLACEHOLDER) || []).sort().join(",") !== placeholders
          ) {
            return [`placeholders changed: ${text}`];
          }

          // A sentence stays a sentence and a label stays a label.
          const isSentence: boolean = text.endsWith(".");
          const endsLikeSentence: boolean = SENTENCE_ENDINGS.some(
            (ending: string): boolean => {
              return value.trim().endsWith(ending);
            },
          );

          if (isSentence !== endsLikeSentence) {
            return [`punctuation differs: ${text}`];
          }

          return [];
        },
      );

      expect(problems).toEqual([]);
    },
  );
});
