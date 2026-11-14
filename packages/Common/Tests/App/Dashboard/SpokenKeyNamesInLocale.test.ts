import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ENGLISH_SPOKEN_KEY_NAMES,
  SpokenKeyNames,
} from "../../../UI/Components/KeyboardShortcut/KeyboardKey";
import {
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
} from "../../Helpers/TranslatedLanguages";

/*
 * THE NAMES OF THE KEYS, IN EVERY LANGUAGE'S LOCALE (#7484), AND THE
 * PRODUCTS MENU'S SEARCH BOX NAMED WITHOUT ITS "…" (#7486).
 *
 * A shortcut is said in words beside its keycaps (for a screen reader) and
 * in a header button's tooltip, from the keyboardKeys entries of the
 * Dashboard's and the Admin Dashboard's locales (useSpokenKeyNames). Each
 * language names a key as its keyboards and its platform's own help name
 * it: a key with its name printed on it reads as that language's keyboards
 * print it ("Strg", "Umschalt", "Entf"; "Maj", "Échap"), and the keys with
 * no word on them - the arrows, the space bar - are named in the language.
 *
 * So a key name may be the English word on purpose: Russian, Japanese or
 * Chinese keyboards print Shift, Tab and Enter, and Apple's help in those
 * languages calls ⌘ Command. Those are listed below, by key, with the
 * reason; any other key name the same as the English is a word left
 * untranslated, and fails. A negative control proves the check catches one.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");

const LOCALES: Record<string, string> = {
  Dashboard: path.join(PACKAGES, "App/FeatureSet/Dashboard/src/Locales"),
  AdminDashboard: path.join(
    PACKAGES,
    "App/FeatureSet/AdminDashboard/src/Locales",
  ),
};

type LocaleTree = { [key: string]: string | LocaleTree };

function readLocale(app: string, language: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES[app]!, `${language}.json`), "utf8"),
  ) as LocaleTree;
}

// The keyboardKeys entry of each SpokenKeyNames field.
const ENTRY_OF: Record<keyof SpokenKeyNames, string> = {
  command: "command",
  control: "control",
  option: "option",
  altKey: "alt",
  shift: "shift",
  enter: "enter",
  escape: "escape",
  backspace: "backspace",
  delete: "delete",
  tab: "tab",
  space: "space",
  arrowUp: "arrowUp",
  arrowDown: "arrowDown",
  arrowLeft: "arrowLeft",
  arrowRight: "arrowRight",
  windows: "windows",
};

const ENTRIES: Array<string> = Object.values(ENTRY_OF).sort();

// Every language but the ones named.
function allBut(...languages: Array<string>): Array<string> {
  return DASHBOARD_LANGUAGES.filter((language: string): boolean => {
    return !languages.includes(language);
  });
}

/*
 * The key names a language writes as the English does, by key, with why.
 * Ctrl and Esc are never here: no keyboard prints Control or Escape, so
 * every language says what it prints (the English says the word).
 */
const PRINTED_AS_ENGLISH: Record<
  string,
  { languages: Array<string>; reason: string }
> = {
  alt: {
    languages: allBut(),
    reason: "every keyboard prints Alt, and every language's help says Alt",
  },
  windows: {
    languages: allBut("de"),
    reason:
      "the Windows logo key is named for its logo, a product name (German's help says Windows-Taste)",
  },
  tab: {
    languages: allBut("sv"),
    reason:
      "keyboards print Tab, and the help says Tab (Swedish's says Tabb, French's Tab)",
  },
  command: {
    languages: [
      "pt",
      "nl",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
      "ar",
    ],
    reason:
      "Apple's help in these languages calls the ⌘ key Command (German's Befehlstaste, French's Commande, the Nordic Kommando)",
  },
  option: {
    languages: [
      "fr",
      "pt",
      "nl",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
      "ar",
    ],
    reason:
      "Apple's help in these languages calls the ⌥ key Option (German's Wahltaste, Spanish's Opción, Swedish's Alternativ)",
  },
  shift: {
    languages: [
      "pt",
      "nl",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
      "ar",
    ],
    reason:
      "these languages' keyboards print Shift (German's print Umschalt, French's Maj, the Nordic Skift)",
  },
  enter: {
    languages: [
      "pt",
      "nl",
      "da",
      "no",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
      "ar",
    ],
    reason:
      "these languages' keyboards print Enter (German's help says Eingabetaste, Spanish keyboards print Intro, Italian Invio)",
  },
  backspace: {
    languages: [
      "it",
      "pt",
      "nl",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
      "ar",
    ],
    reason:
      "these languages' help calls the key Backspace (German's Rücktaste, French's Retour arrière)",
  },
  delete: {
    languages: [
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
      "ar",
    ],
    reason:
      "these languages' keyboards print Delete (German's print Entf, French's Suppr, Spanish Supr, Italian Canc)",
  },
};

function keyboardKeysOf(locale: LocaleTree): LocaleTree {
  const keys: string | LocaleTree | undefined = locale["keyboardKeys"];

  return typeof keys === "object" ? keys : {};
}

// The key names still English in a locale, apart from the listed ones.
function englishKeyNames(
  locale: LocaleTree,
  english: LocaleTree,
  language: string,
  printedAsEnglish: Record<string, { languages: Array<string> }>,
): Array<string> {
  const words: LocaleTree = keyboardKeysOf(locale);
  const englishWords: LocaleTree = keyboardKeysOf(english);

  return ENTRIES.filter((entry: string): boolean => {
    const word: string | LocaleTree | undefined = words[entry];

    if (typeof word !== "string" || !word.trim()) {
      return true;
    }

    return (
      word === englishWords[entry] &&
      !printedAsEnglish[entry]?.languages.includes(language)
    );
  });
}

// Direction marks, which Locales/ARABIC.md leaves out of every string.
const DIRECTION_MARKS: RegExp = /[‎‏؜]/;

// The glyphs a keycap draws: a name is a word, never the keycap again.
const KEYCAP_GLYPHS: RegExp = /[⌘⌥⌃⇧↵⌫⌦⇥↑↓←→]/;

const DASHBOARD_ENGLISH: LocaleTree = readLocale("Dashboard", "en");

describe("the key names in English", () => {
  test.each(Object.keys(LOCALES))(
    "%s's English names are the ones the helpers default to",
    (app: string) => {
      const words: LocaleTree = keyboardKeysOf(readLocale(app, "en"));

      expect(Object.keys(words).sort()).toEqual(ENTRIES);

      for (const [field, entry] of Object.entries(ENTRY_OF)) {
        expect({ entry: entry, word: words[entry] }).toEqual({
          entry: entry,
          word: ENGLISH_SPOKEN_KEY_NAMES[field as keyof SpokenKeyNames],
        });
      }
    },
  );

  test("every listed key is a key, every language a Dashboard language, and every reason says why", () => {
    for (const [entry, listed] of Object.entries(PRINTED_AS_ENGLISH)) {
      expect(ENTRIES).toContain(entry);
      expect(listed.reason.length).toBeGreaterThan(20);

      for (const language of listed.languages) {
        expect(DASHBOARD_LANGUAGES).toContain(language);
      }
    }

    // Ctrl and Esc: no keyboard prints the English word.
    expect(PRINTED_AS_ENGLISH["control"]).toBeUndefined();
    expect(PRINTED_AS_ENGLISH["escape"]).toBeUndefined();
  });
});

describe("the check itself (negative control)", () => {
  test("it finds a name put back to English, an empty name and a missing one", () => {
    const russian: LocaleTree = JSON.parse(
      JSON.stringify(readLocale("Dashboard", "ru")),
    ) as LocaleTree;

    expect(
      englishKeyNames(russian, DASHBOARD_ENGLISH, "ru", PRINTED_AS_ENGLISH),
    ).toEqual([]);

    const words: LocaleTree = russian["keyboardKeys"] as LocaleTree;
    words["arrowUp"] = "Up arrow";
    words["control"] = "Control";
    words["space"] = " ";
    delete words["escape"];

    expect(
      englishKeyNames(russian, DASHBOARD_ENGLISH, "ru", PRINTED_AS_ENGLISH),
    ).toEqual(["arrowUp", "control", "escape", "space"]);
  });

  test("a listed name is let through, and only for the languages listed with it", () => {
    const german: LocaleTree = JSON.parse(
      JSON.stringify(readLocale("Dashboard", "de")),
    ) as LocaleTree;
    const russian: LocaleTree = readLocale("Dashboard", "ru");

    expect(
      englishKeyNames(russian, DASHBOARD_ENGLISH, "ru", {}).sort(),
    ).toEqual(
      [
        "alt",
        "backspace",
        "command",
        "delete",
        "enter",
        "option",
        "shift",
        "tab",
        "windows",
      ].sort(),
    );

    // German's keyboards print Umschalt: Shift there is a word left in English.
    (german["keyboardKeys"] as LocaleTree)["shift"] = "Shift";

    expect(
      englishKeyNames(german, DASHBOARD_ENGLISH, "de", PRINTED_AS_ENGLISH),
    ).toEqual(["shift"]);
  });
});

describe.each([...DASHBOARD_LANGUAGES])(
  "the key names in %s",
  (language: string) => {
    const dashboard: LocaleTree = readLocale("Dashboard", language);

    test("every key is named in the language, or as its keyboards print it", () => {
      expect(Object.keys(keyboardKeysOf(dashboard)).sort()).toEqual(ENTRIES);
      expect(
        englishKeyNames(
          dashboard,
          DASHBOARD_ENGLISH,
          language,
          PRINTED_AS_ENGLISH,
        ),
      ).toEqual([]);
    });

    test("every listed name is still the English one: the list hides nothing stale", () => {
      const words: LocaleTree = keyboardKeysOf(dashboard);
      const english: LocaleTree = keyboardKeysOf(DASHBOARD_ENGLISH);

      for (const [entry, listed] of Object.entries(PRINTED_AS_ENGLISH)) {
        if (listed.languages.includes(language)) {
          expect({ entry: entry, word: words[entry] }).toEqual({
            entry: entry,
            word: english[entry],
          });
        }
      }
    });

    test("a name is one line of words: no direction mark, no keycap glyph, no shortcut joiner", () => {
      for (const [entry, word] of Object.entries(keyboardKeysOf(dashboard))) {
        expect({
          entry: entry,
          mark: DIRECTION_MARKS.test(word as string),
          glyph: KEYCAP_GLYPHS.test(word as string),
          lines: (word as string).split("\n").length,
          joiner: (word as string).includes(" + "),
        }).toEqual({
          entry: entry,
          mark: false,
          glyph: false,
          lines: 1,
          joiner: false,
        });
      }
    });

    test("the four arrows have four different names, and the two Apple modifiers two", () => {
      const words: LocaleTree = keyboardKeysOf(dashboard);
      const arrows: Set<string | LocaleTree | undefined> = new Set([
        words["arrowUp"],
        words["arrowDown"],
        words["arrowLeft"],
        words["arrowRight"],
      ]);

      expect(arrows.size).toBe(4);
      expect(words["command"]).not.toBe(words["option"]);
      expect(words["control"]).not.toBe(words["command"]);
    });
  },
);

describe.each([...ADMIN_DASHBOARD_LANGUAGES])(
  "the Admin Dashboard's key names in %s",
  (language: string) => {
    test("are the Dashboard's: one reader, one name for each key", () => {
      expect(keyboardKeysOf(readLocale("AdminDashboard", language))).toEqual(
        keyboardKeysOf(readLocale("Dashboard", language)),
      );
    });
  },
);

/*
 * The products menu's search box is named by what it is, without the
 * placeholder's "…" (a prompt to type, which a screen reader reads out as
 * "dot dot dot" or not at all): "Search products" in the Dashboard,
 * "Search admin" in the Admin Dashboard.
 */
describe("the products menu's search box, named", () => {
  const ELLIPSIS: RegExp = /…|\.\.\./;

  test("in English, as the placeholder's words", () => {
    expect(DASHBOARD_ENGLISH["Search products"]).toBe("Search products");
    expect(readLocale("AdminDashboard", "en")["Search admin"]).toBe(
      "Search admin",
    );
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "in %s, in the language, without an ellipsis, alike in both apps",
    (language: string) => {
      const dashboard: LocaleTree = readLocale("Dashboard", language);
      const admin: LocaleTree = readLocale("AdminDashboard", language);
      const label: string = dashboard["Search products"] as string;

      expect(label).not.toBe("Search products");
      expect(label.trim()).toBe(label);
      expect(label).not.toMatch(ELLIPSIS);
      expect(admin["Search products"]).toBe(label);

      // The Admin Dashboard's box: its placeholder's words, without the "…".
      const placeholder: string = admin["Search admin…"] as string;
      expect(admin["Search admin"]).toBe(placeholder.replace(/\s*…$/, ""));
      expect(admin["Search admin"]).not.toBe("Search admin");
    },
  );
});
