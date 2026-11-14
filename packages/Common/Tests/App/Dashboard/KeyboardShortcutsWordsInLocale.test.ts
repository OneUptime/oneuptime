import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE KEYBOARD SHORTCUTS, HELP'S ROW FOR THEM AND SEARCH'S WORDS ARE EVERY
 * LANGUAGE'S OWN (#7235).
 *
 * Twelve of the Dashboard's eighteen languages (Italian, Portuguese,
 * Russian, Hindi, Korean, Simplified and Traditional Chinese, Dutch,
 * Swedish, Danish, Norwegian - and Persian, until its own pass) held the
 * English for every word under keyboardShortcuts. So a reader in them saw
 * English in three places: Help's row Keyboard shortcuts (reachable at every
 * width since #7037), the Keyboard shortcuts dialog itself (`?`, Help or
 * Search), and Search's Keyboard shortcuts action. Search's own Ask AI
 * action, the dialog's accessible name, its placeholder, its "No results
 * found." and two of its three key hints were English in the same eleven
 * (three of them in French too), and so were the project picker's search
 * box and its name.
 *
 * This reads the Dashboard's locale files themselves: every one of those
 * words is worded in every language, apart from the few a language writes
 * as English does (each with its reason), and the words that name one thing
 * in two places name it alike. A negative control proves the check catches
 * a word put back to English.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleTree = { [key: string]: string | LocaleTree };

function readLocale(language: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as LocaleTree;
}

/*
 * A key's value: a nested key ("keyboardShortcuts.title") by its path, a
 * flat one (the English text, "No results found.") as it is written.
 */
function valueOf(locale: LocaleTree, key: string): string | undefined {
  const flat: string | LocaleTree | undefined = locale[key];

  if (typeof flat === "string") {
    return flat;
  }

  let node: string | LocaleTree | undefined = locale;

  for (const segment of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = node[segment];
  }

  return typeof node === "string" ? node : undefined;
}

// The Keyboard shortcuts dialog (DashboardKeyboardShortcuts), all ten words.
const DIALOG_KEYS: ReadonlyArray<string> = [
  "keyboardShortcuts.title",
  "keyboardShortcuts.description",
  "keyboardShortcuts.commandPalette",
  "keyboardShortcuts.askAi",
  "keyboardShortcuts.searchList",
  "keyboardShortcuts.showShortcuts",
  "keyboardShortcuts.dismiss",
  "keyboardShortcuts.groups.general",
  "keyboardShortcuts.groups.goTo",
  "keyboardShortcuts.then",
];

/*
 * Search (Cmd/Ctrl+K: Common's CommandPalette, with the Dashboard's
 * actions): its name, its placeholder, its empty state, its key hints and
 * its Ask AI action. The Keyboard shortcuts action is the dialog's title.
 */
const SEARCH_KEYS: ReadonlyArray<string> = [
  "Command palette",
  "Search pages, actions…",
  "No results found.",
  "to navigate",
  "to select",
  "to close",
  "commandPalette.actions.askAi",
];

// The project picker's search box (ProjectPickerFilterBox): its placeholder and its name.
const PROJECT_PICKER_KEYS: ReadonlyArray<string> = [
  "Search projects...",
  "Search Projects",
];

// The same words as flat keys, which other places look up (the docs read these).
const FLAT_TWINS: ReadonlyArray<[string, string]> = [
  // Help's row, the dialog's title, Search's action and the playlist player's button.
  ["Keyboard shortcuts", "keyboardShortcuts.title"],
  ["Show keyboard shortcuts", "keyboardShortcuts.showShortcuts"],
  ["Ask AI", "keyboardShortcuts.askAi"],
  ["Ask AI", "commandPalette.actions.askAi"],
  ["General", "keyboardShortcuts.groups.general"],
  ["then", "keyboardShortcuts.then"],
];

const ALL_KEYS: ReadonlyArray<string> = Array.from(
  new Set<string>([
    ...DIALOG_KEYS,
    ...SEARCH_KEYS,
    ...PROJECT_PICKER_KEYS,
    ...FLAT_TWINS.map(([flat]: [string, string]): string => {
      return flat;
    }),
  ]),
);

/*
 * The words a language writes exactly as English does, each with why. A key
 * is worded in every other language.
 */
const SAME_AS_ENGLISH: Record<string, Record<string, string>> = {
  es: {
    "keyboardShortcuts.groups.general":
      "Spanish for General is General (the same word, and the flat General the Dashboard draws elsewhere)",
    General: "Spanish for General is General",
  },
};

// The keys whose value is still English in this locale, apart from the stated ones.
function englishWords(
  locale: LocaleTree,
  english: LocaleTree,
  sameAsEnglish: Record<string, string>,
): Array<string> {
  return ALL_KEYS.filter((key: string): boolean => {
    const value: string | undefined = valueOf(locale, key);

    if (!value || !value.trim()) {
      return true;
    }

    return value === valueOf(english, key) && !sameAsEnglish[key];
  });
}

const ENGLISH: LocaleTree = readLocale("en");

// Direction marks, which Locales/ARABIC.md leaves out of every string.
const DIRECTION_MARKS: ReadonlyArray<string> = [
  String.fromCharCode(0x200e),
  String.fromCharCode(0x200f),
  String.fromCharCode(0x061c),
];

describe("the keyboard shortcuts' and Search's words in English", () => {
  test("every key is in en.json, as the components write their English", () => {
    for (const key of ALL_KEYS) {
      expect({ key: key, value: valueOf(ENGLISH, key) }).toEqual({
        key: key,
        value: expect.any(String),
      });
    }

    expect(valueOf(ENGLISH, "keyboardShortcuts.title")).toBe(
      "Keyboard shortcuts",
    );
    expect(valueOf(ENGLISH, "commandPalette.actions.askAi")).toBe("Ask AI");
  });

  test("every stated same-as-English word is one of the checked keys, in a Dashboard language", () => {
    for (const [language, words] of Object.entries(SAME_AS_ENGLISH)) {
      expect(DASHBOARD_LANGUAGES).toContain(language);

      for (const [key, reason] of Object.entries(words)) {
        expect(ALL_KEYS).toContain(key);
        expect(reason.length).toBeGreaterThan(10);
        // Still the same as English: a stale entry would hide nothing.
        expect(valueOf(readLocale(language), key)).toBe(valueOf(ENGLISH, key));
      }
    }
  });
});

describe("the check itself (negative control)", () => {
  test("it finds a word put back to English, an empty word and a missing one", () => {
    const russian: LocaleTree = JSON.parse(
      JSON.stringify(readLocale("ru")),
    ) as LocaleTree;

    expect(englishWords(russian, ENGLISH, {})).toEqual([]);

    (russian["keyboardShortcuts"] as LocaleTree)["title"] =
      "Keyboard shortcuts";
    russian["to navigate"] = "to navigate";
    russian["Search projects..."] = " ";
    delete ((russian["commandPalette"] as LocaleTree)["actions"] as LocaleTree)[
      "askAi"
    ];

    expect(englishWords(russian, ENGLISH, {})).toEqual([
      "keyboardShortcuts.title",
      "to navigate",
      "commandPalette.actions.askAi",
      "Search projects...",
    ]);
  });

  test("a stated same-as-English word is let through, and only for its language", () => {
    const spanish: LocaleTree = readLocale("es");
    const german: LocaleTree = JSON.parse(
      JSON.stringify(readLocale("de")),
    ) as LocaleTree;

    expect(englishWords(spanish, ENGLISH, {})).toEqual([
      "keyboardShortcuts.groups.general",
      "General",
    ]);
    expect(englishWords(spanish, ENGLISH, SAME_AS_ENGLISH["es"]!)).toEqual([]);

    ((german["keyboardShortcuts"] as LocaleTree)["groups"] as LocaleTree)[
      "general"
    ] = "General";

    expect(englishWords(german, ENGLISH, SAME_AS_ENGLISH["de"] || {})).toEqual([
      "keyboardShortcuts.groups.general",
    ]);
  });
});

describe.each([...DASHBOARD_LANGUAGES])(
  "the keyboard shortcuts' and Search's words in %s",
  (language: string) => {
    const locale: LocaleTree = readLocale(language);

    test("every word is the language's own, not the English", () => {
      expect(
        englishWords(locale, ENGLISH, SAME_AS_ENGLISH[language] || {}),
      ).toEqual([]);
    });

    test("Help's row, the dialog, Search and the docs name each thing alike", () => {
      for (const [flat, nested] of FLAT_TWINS) {
        expect({
          flat: flat,
          nested: nested,
          value: valueOf(locale, flat),
        }).toEqual({
          flat: flat,
          nested: nested,
          value: valueOf(locale, nested),
        });
      }
    });

    test("no word carries a direction mark (Locales/ARABIC.md), and every one is a single line", () => {
      for (const key of ALL_KEYS) {
        const value: string = valueOf(locale, key) || "";

        for (const mark of DIRECTION_MARKS) {
          expect({ key: key, hasMark: value.includes(mark) }).toEqual({
            key: key,
            hasMark: false,
          });
        }

        expect({ key: key, lines: value.split("\n").length }).toEqual({
          key: key,
          lines: 1,
        });
      }
    });

    test("the placeholders end as the English ones do, so the box reads as a box to type in", () => {
      expect(valueOf(locale, "Search pages, actions…")!.endsWith("…")).toBe(
        true,
      );
      expect(valueOf(locale, "Search projects...")!.endsWith("...")).toBe(true);
    });
  },
);
