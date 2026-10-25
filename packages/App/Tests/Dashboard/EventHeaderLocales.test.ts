import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The header of an incident, an alert, an episode and a scheduled
 * maintenance event reads in the reader's language, every word of it: its
 * labels, how long, the AI band, the maintenance band and the placeholders.
 * A German or Persian header used to show "View full report", "Ongoing for",
 * "Status pages" and the whole overdue sentence in English.
 *
 * These hold every word the header draws to a translation in each of the
 * Dashboard's sixteen languages (a word that is the same in a language is
 * listed with why).
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
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

// Every word the header draws, as the code looks it up.
const HEADER_WORDS: Array<string> = [
  // The actions group, the pills and the number.
  "Event actions",
  "Current state",
  "Severity",
  "Number",
  "Private",
  "Visible only to owners, owner teams, and project admins.",
  "More actions",
  "Change state to",
  "Move episode to",
  "Acknowledge",
  "Resolve",
  "Mark as {{state}}",
  "Join call",
  "Join huddle",
  "Declare Incident",
  "Open channel",
  // The state track.
  "State progress",
  // How long.
  "Ongoing for",
  "Lasted",
  "Starts in",
  "Start overdue by",
  "In progress for",
  "Overrunning by",
  "Completed in",
  // The facts.
  "Owners",
  "Incident Commander",
  "Monitor",
  "Monitors",
  "Episode",
  "Grouping",
  "Manual episode",
  "Last incident added",
  "Last alert added",
  "Status pages",
  "Created by",
  "Not assigned",
  "None",
  "Assign",
  "Assign {{role}}",
  "Add",
  "Add owners",
  "+{{count}} more",
  "Unnamed monitor",
  "Untitled episode",
  // The AI band.
  "AI root cause analysis",
  "AI root cause analysis ready.",
  "View full report",
  "Show more",
  "Show less",
  "Confirmed by a responder",
  "Rejected by a responder",
  "AI is investigating",
  "AI investigation queued",
  "Reviewing telemetry and tracing the likely root cause.",
  "Waiting for an AI worker. Telemetry review will begin automatically.",
  "View live progress",
  "View live AI investigation progress",
  // The maintenance band and the episode's.
  "Start overdue",
  "Overrunning",
  "Planned to start at {{time}}, but it has not been marked as {{state}} yet.",
  "Planned to end at {{time}}, but it has not been marked as {{state}} yet.",
  "Couldn't refresh this episode: {{message}}",
  // The placeholders.
  "Loading incident status",
  "Loading alert status",
  "Loading episode",
  "Loading scheduled maintenance status",
];

const I18N_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "i18n",
);

/*
 * Words that read the same in a language: the Dashboard's own lists (every
 * language's, and each language's), and these, with why.
 */
const SAME_AS_ENGLISH: Record<string, Array<string>> = {
  // "Episode" is Dutch, Danish and Norwegian too.
  nl: ["Episode"],
  da: ["Episode"],
  no: ["Episode"],
};

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

function sameAsEnglishIn(code: string): Array<string> {
  const everyLanguage: Array<string> = JSON.parse(
    fs.readFileSync(path.join(I18N_DIR, "SameAsEnglish.json"), "utf8"),
  ) as Array<string>;
  const progressPath: string = path.join(I18N_DIR, "Progress", `${code}.json`);
  const own: Array<string> = fs.existsSync(progressPath)
    ? (
        JSON.parse(fs.readFileSync(progressPath, "utf8")) as {
          sameAsEnglish?: Array<string>;
        }
      ).sameAsEnglish || []
    : [];

  return [...everyLanguage, ...own, ...(SAME_AS_ENGLISH[code] || [])];
}

function placeholdersOf(text: string): Array<string> {
  return Array.from(text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g))
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .sort();
}

const english: Record<string, string> = readLocale("en");

describe("the event header's words", () => {
  test("are every one a key the Dashboard's English has", () => {
    const missing: Array<string> = HEADER_WORDS.filter(
      (word: string): boolean => {
        return english[word] !== word;
      },
    );

    expect(missing).toEqual([]);
  });

  test.each(LANGUAGES)("are all translated in %s", (code: string) => {
    const locale: Record<string, string> = readLocale(code);
    const same: Array<string> = sameAsEnglishIn(code);
    const untranslated: Array<string> = HEADER_WORDS.filter(
      (word: string): boolean => {
        return locale[word] === word && !same.includes(word);
      },
    );

    expect(untranslated).toEqual([]);
  });

  test.each(LANGUAGES)(
    "keep their placeholders in %s, wherever the language puts them",
    (code: string) => {
      const locale: Record<string, string> = readLocale(code);

      for (const word of HEADER_WORDS) {
        expect({
          word,
          placeholders: placeholdersOf(locale[word] || ""),
        }).toEqual({ word, placeholders: placeholdersOf(word) });
      }
    },
  );

  test("say how long as a label over the duration, never glued to it", () => {
    for (const code of LANGUAGES) {
      const locale: Record<string, string> = readLocale(code);

      for (const word of [
        "Ongoing for",
        "Lasted",
        "Starts in",
        "Start overdue by",
        "In progress for",
        "Overrunning by",
        "Completed in",
      ]) {
        // A label, not a sentence with the duration in it.
        expect({ code, word, value: locale[word] }).not.toEqual(
          expect.objectContaining({ value: expect.stringContaining("{{") }),
        );
      }
    }
  });
});
