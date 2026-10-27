import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A playbook run's card - the run's words, Approve, Reject and Cancel Run,
 * "Started on its own", and the dialogs they open - in every Dashboard
 * language, and the docs naming its buttons as each language draws them.
 *
 * The UI review of #5246 found them English in most locales (German had
 * Ablehnen beside Approve), and every docs language quoting **Approve** and
 * **Reject**: translated, the docs had to follow. The translation backlog
 * (#5287) worded them all and moved the docs with them; this holds both, so
 * a new word on the card, or a docs line, cannot fall back to English.
 */

const DASHBOARD: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES_DIR: string = path.join(DASHBOARD, "Locales");
const DOCS: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

const CARD: string = fs.readFileSync(
  path.join(
    DASHBOARD,
    "Components",
    "SecurityPlaybook",
    "SecurityPlaybookRunCard.tsx",
  ),
  "utf8",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.replace(/\.json$/, "");
  })
  .sort();

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

/*
 * Every word the card draws, as the card writes it: its buttons and their
 * dialogs, the run's lines, and the approval's fields.
 */
const CARD_WORDS: Array<string> = [
  // The buttons on a run, and the dialogs' own buttons.
  "Approve",
  "Reject",
  "Cancel Run",
  "Keep Running",
  // The dialogs.
  "Approve Step",
  "Reject Step",
  "The run carries on from this step. Your decision is kept on the step, on the case's timeline and in the audit log.",
  "The run stops here and nothing after this step runs. Your decision is kept on the step, on the case's timeline and in the audit log.",
  "The run carries on and never acts on protected entities: {{values}}. Your decision is kept on the step, the case's timeline and the audit log.",
  "The run stops before its next step. Steps that already ran are not undone.",
  "Act On",
  "Every one is ticked. Untick any the step should leave alone.",
  "Comment",
  "Why you decided this way.",
  // The run's lines.
  "Run by {{name}}",
  "Started on its own: {{trigger}}",
  "Stopped at step {{number}}: {{title}}",
  "{{done}} of {{count}} steps done",
  "Hide steps",
  "Show steps",
  "This run is waiting for someone to approve its next step before it does anything.",
  "You started this run, so someone else must approve its steps.",
  "Undo once the run has stopped running.",
];

describe("a playbook run's card", () => {
  test("still draws each of these words", () => {
    for (const word of CARD_WORDS) {
      expect({ word, drawn: CARD.includes(`"${word}"`) }).toEqual({
        word,
        drawn: true,
      });
    }
  });

  /*
   * A field marked optional says so beside its title: its placeholder
   * never opens with "Optional." of its own.
   */
  test("the approval's comment says what it is for, not that it is optional", () => {
    expect(CARD).not.toContain('"Optional.');
    expect(CARD).toContain('placeholder: "Why you decided this way."');
  });

  test.each(LANGUAGES)("%s words every one of them", (language: string) => {
    const values: Record<string, string> = locale(language);

    for (const word of CARD_WORDS) {
      const worded: string | undefined = values[word];

      expect({ word, isWorded: Boolean(worded) && worded !== word }).toEqual({
        word,
        isWorded: true,
      });
    }
  });

  test.each(LANGUAGES)(
    "%s keeps each sentence's placeholders",
    (language: string) => {
      const values: Record<string, string> = locale(language);
      const placeholder: RegExp = /\{\{\w+\}\}/g;

      for (const word of CARD_WORDS) {
        const english: Array<string> = (word.match(placeholder) || []).sort();
        const worded: Array<string> = (
          (values[word] || "").match(placeholder) || []
        ).sort();

        expect({ word, worded }).toEqual({ word, worded: english });
      }
    },
  );
});

/*
 * The docs page of cases and playbooks names a held step's buttons in bold,
 * as each language's Dashboard draws them.
 */
describe("the docs name a held step's buttons as they are drawn", () => {
  const page: (language: string) => string = (language: string): string => {
    return fs.readFileSync(
      path.join(DOCS, language, "telemetry", "security-cases.md"),
      "utf8",
    );
  };

  test("in English", () => {
    expect(page("en")).toContain(
      "A step waiting for approval shows **Approve** and **Reject** on the run",
    );
  });

  test.each(LANGUAGES)("in %s", (language: string) => {
    const values: Record<string, string> = locale(language);
    const text: string = page(language);

    for (const button of ["Approve", "Reject"]) {
      expect({
        button,
        quoted: text.includes(`**${values[button]}**`),
      }).toEqual({ button, quoted: true });
      // Never the English word where the language has its own.
      expect({ button, english: text.includes(`**${button}**`) }).toEqual({
        button,
        english: false,
      });
    }
  });
});
