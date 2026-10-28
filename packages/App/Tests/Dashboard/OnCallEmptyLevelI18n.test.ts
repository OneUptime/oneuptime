import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A LEVEL WITH NOBODY TO PAGE, IN EVERY LANGUAGE THE DASHBOARD SPEAKS.
 *
 * A run passes a level that pages nobody at once (Common's
 * OnCallEmptyLevel), and three on-call surfaces say so: the run's Execution
 * Timeline ("This level has no responders" / "Nobody at this level could be
 * paged", "Moved on at once"), the policy's Escalation Rules page (the
 * empty level's notice, the step after it, and the summary's "Skipped at
 * once") and "Policy at a glance" (its warning about such levels). Every
 * word is looked up by its English text, so a string no locale carries
 * stays English for everyone. This pins the strings in all seventeen
 * locales, translated, the placeholders kept, and that the two sentences
 * they replace - "will notify no one when reached" - left the source and
 * the locales together.
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

const ON_CALL_COMPONENTS: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "OnCallPolicy",
);

// Each new string, and the file that draws it.
const NEW_STRINGS: Array<{ key: string; drawnIn: string }> = [
  {
    key: "This level has no responders",
    drawnIn: "ExecutionLogs/ExecutionLogsTimelineTable.tsx",
  },
  {
    key: "Nobody at this level could be paged",
    drawnIn: "ExecutionLogs/ExecutionLogsTimelineTable.tsx",
  },
  {
    key: "Moved on at once",
    drawnIn: "ExecutionLogs/ExecutionLogsTimelineTable.tsx",
  },
  {
    key: "No responders assigned. This level is skipped without waiting — edit this rule to add responders.",
    drawnIn: "EscalationRule/EscalationRules.tsx",
  },
  {
    key: "Nobody to page here, so the next level is paged at once",
    drawnIn: "EscalationRule/EscalationRules.tsx",
  },
  {
    key: "Skipped at once",
    drawnIn: "EscalationRule/EscalationSummary.tsx",
  },
  {
    key: "{{levels}} along the way have no responders, so they are skipped without waiting.",
    drawnIn: "OnCallPolicySummary.tsx",
  },
];

const PLURAL_ONE: { key: string; english: string } = {
  key: "{{levels}} along the way have no responders, so they are skipped without waiting._one",
  english:
    "{{levels}} along the way has no responders, so it is skipped without waiting.",
};

// The sentences the new ones replace: a level reached is passed at once now.
const RETIRED_STRINGS: Array<string> = [
  "No responders assigned. No one will be notified at this level — edit this rule to add responders.",
  "{{levels}} along the way have no responders and will notify no one when reached.",
  "{{levels}} along the way have no responders and will notify no one when reached._one",
];

// Languages with no "one" form: their _one sentence is never shown.
const NO_ONE_FORM: Array<string> = [
  "ja.json",
  "ko.json",
  "zh-CN.json",
  "zh-TW.json",
];

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

// The joiner that keeps a Persian word's parts in one word.
const ZERO_WIDTH_NON_JOINER: string = String.fromCharCode(0x200c);

const readLocale: (file: string) => Record<string, unknown> = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
};

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .sort();

const placeholdersOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return (text.match(PLACEHOLDER) || []).sort();
};

describe("the empty-level strings in the Dashboard's locales", () => {
  test("there are seventeen locales", () => {
    expect(LOCALE_FILES).toHaveLength(17);
  });

  test.each(NEW_STRINGS)(
    "'$key' is drawn where it says",
    (entry: { key: string; drawnIn: string }) => {
      const source: string = fs.readFileSync(
        path.join(ON_CALL_COMPONENTS, entry.drawnIn),
        "utf8",
      );

      expect(source).toContain(JSON.stringify(entry.key));
    },
  );

  test.each(LOCALE_FILES)(
    "%s carries every new string, in its own words, with the same placeholders",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      for (const entry of NEW_STRINGS) {
        const value: unknown = locale[entry.key];

        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
        expect(placeholdersOf(value as string)).toEqual(
          placeholdersOf(entry.key),
        );

        if (file === "en.json") {
          expect(value).toBe(entry.key);
        } else {
          expect(value).not.toBe(entry.key);
        }
      }

      const one: unknown = locale[PLURAL_ONE.key];

      expect(typeof one).toBe("string");
      expect(placeholdersOf(one as string)).toEqual(["{{levels}}"]);

      if (file === "en.json" || NO_ONE_FORM.includes(file)) {
        expect(one).toBe(PLURAL_ONE.english);
      } else {
        expect(one).not.toBe(PLURAL_ONE.english);
      }
    },
  );

  test.each(LOCALE_FILES)(
    "%s no longer carries the sentences they replace",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      for (const key of RETIRED_STRINGS) {
        expect(locale).not.toHaveProperty([key]);
      }
    },
  );

  test("no Dashboard source draws the replaced sentences any more", () => {
    const sources: Array<string> = [
      "EscalationRule/EscalationRules.tsx",
      "OnCallPolicySummary.tsx",
    ].map((file: string): string => {
      return fs.readFileSync(path.join(ON_CALL_COMPONENTS, file), "utf8");
    });

    for (const source of sources) {
      expect(source).not.toContain("will notify no one when reached");
      expect(source).not.toContain("No one will be notified at this level");
    }
  });

  test("Persian keeps 'responder' one word, as its other on-call strings write it", () => {
    const persian: Record<string, unknown> = readLocale("fa.json");
    const responder: string = `پاسخ${ZERO_WIDTH_NON_JOINER}دهنده`;

    expect(persian["No responders"]).toContain(responder);

    for (const key of [
      "This level has no responders",
      "No responders assigned. This level is skipped without waiting — edit this rule to add responders.",
      "{{levels}} along the way have no responders, so they are skipped without waiting.",
    ]) {
      expect(persian[key]).toContain(responder);
    }
  });

  test("each locale words 'Skipped at once' with its own word for 'Skipped'", () => {
    for (const file of LOCALE_FILES) {
      if (file === "en.json") {
        continue;
      }

      const locale: Record<string, unknown> = readLocale(file);

      expect(locale["Skipped at once"]).not.toBe(locale["Skipped"]);
    }
  });
});
