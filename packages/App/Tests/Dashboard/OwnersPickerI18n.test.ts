import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Owners are picked with one people picker - people and teams in one list -
 * everywhere the Dashboard used to offer an "Owner - Teams" and an
 * "Owner - Users" dropdown, and the settings pages show them on one Owners
 * card. Every word those draw is looked up in the Dashboard locale files by
 * its English text, so a string no locale carries stays English for
 * everyone. This pins the strings the change added - in all seventeen
 * locales, translated - and that the ones it retired left the locales and
 * the source together.
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
  // The people picker and its search list (Common).
  "People",
  "Deleted team",
  "Unknown user",
  "No matches found.",
  "Searching...",
  "No people or teams available.",
  "Remove {{name}}",
  // The owner rules' one Owners field.
  "When this rule matches, these people and teams are added as owners. Owners already assigned are not added twice.",
  // Bulk Add Owner / Remove Owner.
  "Pick the people and teams to add as owners of the selected items. Their existing owners are kept.",
  "Pick the people and teams to remove as owners of the selected items. Items that have none of them are skipped.",
  "These people and teams are added as owners of each selected item.",
  "These people and teams are removed as owners of each selected item.",
  // A monitor's criteria: what it asks for, and what it shows.
  "No owners assigned",
  "People and teams who will own this alert when it is created.",
  "People and teams who will own this incident when it is created.",
  "People and teams who will own this alert and be notified about it",
  "People and teams who will own this incident and be notified about it",
  "People and teams who own these monitors.",
  // An SLO's burn rate rules.
  "Alert Owners",
  "Incident Owners",
  "People and teams added as owners of the alert. Owners are notified when the alert is created.",
  "People and teams added as owners of the incident. Owners are notified when the incident is declared.",
  // Templates, episodes and events created by hand.
  "Who owns incidents declared from this template. They are notified when the incident is created or updated.",
  "Who owns events scheduled from this template. They are notified when the event's status changes.",
  "Who owns this episode. They are notified when it is created or updated.",
  "Who owns this event. They are notified when its status changes.",
  // The Owners card, and what the settings pages say on it.
  "No owners yet",
  "People and teams who own this probe. They are alerted when its status changes.",
  "Add a teammate or a team so they are alerted when this probe's status changes.",
  "People and teams who own this runner. They are alerted when its status changes.",
  "Add a teammate or a team so they are alerted when this runner's status changes.",
  "People and teams who own every incident declared from this template. They are added as the incident's owners and notified.",
  "Add a teammate or a team to own every incident declared from this template.",
  "People and teams who own every event scheduled from this template. They are added as the event's owners and notified.",
  "Add a teammate or a team to own every event scheduled from this template.",
];

/*
 * Keys only the two dropdowns, the two owner tables and the old bulk dialog
 * used. None is drawn any more, so none is kept in the locales.
 */
const RETIRED_STRINGS: Array<string> = [
  "Owner - Teams",
  "Owner - Users",
  "Owners (Teams)",
  "Owners (Users)",
  "Owners to Assign",
  "Owner since",
  "Select Users",
  "Teams that will own this alert when it is created.",
  "Users that will own this alert when it is created.",
  "Teams that will own this incident when it is created.",
  "Users that will own this incident when it is created.",
  "Teams that will own and be notified about this alert",
  "Users that will own and be notified about this alert",
  "Teams that will own and be notified about this incident",
  "Users that will own and be notified about this incident",
  "Select which teams own this incident. They will be notified when the incident is created or updated.",
  "Select which users own this incident. They will be notified when the incident is created or updated.",
  "Select which teams own this episode. They will be notified when the episode is created or updated.",
  "Select which users own this episode. They will be notified when the episode is created or updated.",
  "Select which teams own this event. They will be notified when event status changes.",
  "Select which users own this event. They will be notified when event status changes.",
  "These are the list of teams that will be added to the incident by default when its created.",
  "These are the list of users that will be added to the incident by default when its created.",
  "These are the list of teams that will be added to the Scheduled Maintenance by default when its created.",
  "These are the list of users that will be added to the Scheduled Maintenance by default when its created.",
  "Here is list of teams that own this probe. They will be alerted when this probe status changes.",
  "Here is list of users that own this probe. They will be alerted when this probe status changes.",
  "Here is the list of teams that own this Runner. They will be alerted when this Runner's status changes.",
  "Here is the list of users that own this Runner. They will be alerted when this Runner's status changes.",
  "No teams associated with this probe so far.",
  "No users associated with this probe so far.",
  "No teams associated with this Runner so far.",
  "No users associated with this Runner so far.",
  "No teams associated with this incident template so far.",
  "No users associated with this incident template so far.",
  "No teams associated with this Scheduled Maintenance template so far.",
  "No users associated with this Scheduled Maintenance template so far.",
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

describe("the owners picker's strings", () => {
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

          /*
           * A sentence stays a sentence and a label stays a label: a full
           * stop on one but not the other is a translation of something
           * else, or a key pasted into the wrong slot.
           */
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
