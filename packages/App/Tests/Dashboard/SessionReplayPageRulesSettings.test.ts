import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SESSION_REPLAY_NEVER_RECORD_PAGES_TITLE as SERVER_NEVER_RECORD_TITLE,
  SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE as SERVER_READABLE_TITLE,
  SESSION_REPLAY_RECORD_ONLY_PAGES_TITLE as SERVER_RECORD_ONLY_TITLE,
} from "Common/Utils/Rum/SessionReplayPolicyValidation";

/*
 * THE REPLAY POLICY PAGE'S PAGE RULES AND READABLE EVENT PROPERTIES
 * (#7502, #7501).
 *
 * Three privacy settings most applications never touch, so they wait
 * folded under More fields at the end of the Masking step - never a step
 * of their own, and not counted against its five fields. The server refuses
 * a bad entry naming the setting, so the page and the refusal call each one
 * by the same name. Every word is in every Dashboard language.
 */

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const PAGE: string = fs.readFileSync(
  path.join(DASHBOARD, "Pages/Rum/View/SessionReplaySettings.tsx"),
  "utf8",
);

const LOCALES_DIR: string = path.join(DASHBOARD, "Locales");

const COLUMNS: ReadonlyArray<string> = [
  "sessionReplayRecordOnlyPages",
  "sessionReplayNeverRecordPages",
  "sessionReplayReadableEventProperties",
];

// The form field that edits a column: its object literal, as written.
function formFieldOf(column: string): string {
  const binding: string = `field: { ${column}: true },`;
  const start: number = PAGE.indexOf(binding);

  expect({ column, found: start >= 0 }).toEqual({ column, found: true });

  return PAGE.slice(start, PAGE.indexOf("\n            },", start));
}

describe("the Replay Policy form", () => {
  test("names the settings as the server's refusals do", () => {
    for (const [constant, serverTitle] of [
      ["SESSION_REPLAY_RECORD_ONLY_PAGES_TITLE", SERVER_RECORD_ONLY_TITLE],
      ["SESSION_REPLAY_NEVER_RECORD_PAGES_TITLE", SERVER_NEVER_RECORD_TITLE],
      ["SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE", SERVER_READABLE_TITLE],
    ] as Array<[string, string]>) {
      const declaration: RegExp = new RegExp(
        `export const ${constant}: string =\\s*translationKey\\(\\s*"([^"]+)",?\\s*\\);`,
      );
      const match: RegExpMatchArray | null = PAGE.match(declaration);

      expect({ constant, title: match?.[1] }).toEqual({
        constant,
        title: serverTitle,
      });
      expect(PAGE).toContain(`title: ${constant},`);
    }
  });

  test("folds the three under More fields at the end of the Masking step", () => {
    for (const column of COLUMNS) {
      const field: string = formFieldOf(column);

      expect(field).toContain('stepId: "privacy"');
      expect(field).toContain("collapsibleSection: pageAndPropertyRules,");
      expect(field).toContain("fieldType: FormFieldSchemaType.JSON,");
      expect(field).toContain("required: false,");
    }

    expect(PAGE).toContain(
      "const pageAndPropertyRules: FormFieldCollapsibleSection<RumApplication> =\n  getAdvancedFormSection<RumApplication>();",
    );

    // Next to each other, so they fold into one section.
    const positions: Array<number> = COLUMNS.map((column: string): number => {
      return PAGE.indexOf(`field: { ${column}: true },`);
    });

    expect(
      [...positions].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(positions);
    // No other field between the first and the last of them.
    expect(
      PAGE.slice(positions[0], positions[2]).match(/field: \{/g)?.length,
    ).toBe(2);
  });

  test("shows each list on the read view, with what an empty one means", () => {
    for (const column of COLUMNS) {
      expect(PAGE.split(`field: { ${column}: true },`).length - 1).toBe(2);
    }

    for (const empty of [
      '"Every page"',
      '"None: no page is kept out"',
      '"None: under Mask all text, every event property value is masked"',
    ]) {
      expect(PAGE).toContain(empty);
    }
  });

  test("hands the lists to what a recording contains", () => {
    expect(PAGE).toContain(
      "recordOnlyPages: application.sessionReplayRecordOnlyPages,",
    );
    expect(PAGE).toContain(
      "neverRecordPages: application.sessionReplayNeverRecordPages,",
    );
    expect(PAGE).toContain("application.sessionReplayReadableEventProperties,");
  });
});

describe("the words, in every Dashboard language", () => {
  const ENGLISH: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
  ) as Record<string, string>;

  const WORDS: ReadonlyArray<string> = [
    "Record only these pages",
    "Never record these pages",
    "Readable event properties",
    "A JSON array of page paths to record, * for any characters. Empty records every page; any other page is not recorded.",
    "A JSON array of page paths never recorded, even if listed above. Their content and address stay out of every recording.",
    "Event property keys whose short values your code chooses, kept readable under Mask all text. Any other value stays masked.",
    "Every page",
    "None: no page is kept out",
    "None: under Mask all text, every event property value is masked",
    "This application's replay policy does not record this page, so recording paused. It goes on in the same session on the next page the policy records.",
    "If this page should be recorded, check Record only these pages and Never record these pages on the application's Replay Policy page.",
    "only the pages the policy names recorded",
    "{{count}} page paths never recorded",
    "{{count}} event properties readable as short codes",
  ];

  const LANGUAGES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".json") && name !== "en.json";
    })
    .map((name: string): string => {
      return name.replace(/\.json$/, "");
    });

  test("English keys them", () => {
    for (const word of WORDS) {
      expect({ word, keyed: ENGLISH[word] === word }).toEqual({
        word,
        keyed: true,
      });
    }
  });

  test.each(
    LANGUAGES.map((language: string) => {
      return [language];
    }),
  )("%s words each of them", (language: string) => {
    const locale: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;

    for (const word of WORDS) {
      const worded: string | undefined = locale[word];

      expect({
        language,
        word,
        worded: typeof worded === "string" && worded !== word,
        keepsCount:
          !word.includes("{{count}}") || (worded || "").includes("{{count}}"),
      }).toEqual({ language, word, worded: true, keepsCount: true });
    }
  });
});
