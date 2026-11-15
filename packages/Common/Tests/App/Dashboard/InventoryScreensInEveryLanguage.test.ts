import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * EVERY INVENTORY SCREEN, IN EVERY LANGUAGE (#8684).
 *
 * Inventory's Help > Documentation page and its side menu read in every
 * language since #8693, but 87 other strings its screens draw were English
 * in eleven languages (48 in French, 11 in German and Spanish). They were on
 * an item's tabs, its identity and settings cards and its connections, on
 * the empty states, the Overview's tiles and breakdown, the list's facets
 * and search, and the plural names of the kinds.
 *
 * This reads every source file under Pages/Inventory and
 * Components/Inventory. Every string literal there that is a key of the
 * locale files must be worded in every language, with its placeholders. A
 * value equal to the English counts only when a same-as-English list keeps
 * it so, as `npm run i18n:check` counts it. So a string added to an
 * Inventory screen fails here until every language words it.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const INVENTORY_FOLDERS: ReadonlyArray<string> = [
  "Pages/Inventory",
  "Components/Inventory",
];

const LITERAL: RegExp = /"((?:[^"\\\n]|\\.)*)"/g;

// Words, not a code: two Latin letters in a row.
const TWO_LETTERS: RegExp = /[A-Za-z]{2}/;

const SOURCE_FILE: RegExp = /\.tsx?$/;

// A sentence: two lower-case words between spaces.
const SENTENCE: RegExp = / [a-z]{3,} [a-z]{3,} /;

function sourceFilesIn(folder: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full: string = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFilesIn(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found.sort();
}

// The keys of the locale files a source text names as string literals.
function keysIn(source: string): Array<string> {
  const english: Record<string, string> = readDashboardLocale("en");
  const keys: Set<string> = new Set<string>();

  for (const match of source.matchAll(LITERAL)) {
    let text: string;

    try {
      text = JSON.parse(`"${match[1]}"`) as string;
    } catch {
      continue;
    }

    // A plural's English "other" form names its "_one" form too.
    for (const key of [text, `${text}_one`]) {
      if (typeof english[key] === "string" && TWO_LETTERS.test(english[key]!)) {
        keys.add(key);
      }
    }
  }

  return [...keys].sort();
}

function inventoryKeys(): Array<string> {
  const keys: Set<string> = new Set<string>();

  for (const folder of INVENTORY_FOLDERS) {
    for (const file of sourceFilesIn(path.join(DASHBOARD_SOURCE, folder))) {
      for (const key of keysIn(fs.readFileSync(file, "utf8"))) {
        keys.add(key);
      }
    }
  }

  return [...keys].sort();
}

describe("every Inventory screen's words", () => {
  test("are read from every source file of Pages/Inventory and Components/Inventory", () => {
    const keys: Array<string> = inventoryKeys();

    expect(keys.length).toBeGreaterThan(300);
    expect(keys).toEqual(
      expect.arrayContaining([
        "Delete Item",
        "Copy identity key",
        "No {{signal}} for this item",
        "Search inventory types...",
        "Total Items",
        "OpenStack Hypervisors",
        "Understand how your services, infrastructure, and network connect.",
      ]),
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every one of them",
    (language: string) => {
      const notWorded: Array<string> = inventoryKeys().filter(
        (key: string): boolean => {
          return !isWordedInDashboardLocale(key, language);
        },
      );

      expect({ language, notWorded }).toEqual({ language, notWorded: [] });
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps every placeholder",
    (language: string) => {
      const english: Record<string, string> = readDashboardLocale("en");
      const words: Record<string, string> = readDashboardLocale(language);

      const changed: Array<string> = inventoryKeys().filter(
        (key: string): boolean => {
          return (
            placeholdersOf(words[key] || "").join() !==
            placeholdersOf(english[key]!).join()
          );
        },
      );

      expect({ language, changed }).toEqual({ language, changed: [] });
    },
  );
});

describe("the scan (control)", () => {
  test("finds a key in a literal, its plural's one form, and leaves code and unknown text alone", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(keysIn('title="Delete Item"')).toEqual(["Delete Item"]);
    expect(english["{{count}} minutes_one"]).toBeDefined();
    expect(keysIn('other: "{{count}} minutes"')).toEqual([
      "{{count}} minutes",
      "{{count}} minutes_one",
    ]);
    expect(keysIn('const id: string = "k8s.pod";')).toEqual([]);
    expect(keysIn('"Not a sentence any locale holds, 8684."')).toEqual([]);
  });

  test("a language that leaves a key in English is found", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const stillEnglish: string | undefined = Object.keys(english).find(
      (key: string): boolean => {
        return SENTENCE.test(key) && !isWordedInDashboardLocale(key, "it");
      },
    );

    // Some sentence is still English in Italian while #8341's follow-ups are open.
    expect(stillEnglish).toBeDefined();
    expect(isWordedInDashboardLocale(stillEnglish!, "it")).toBe(false);
  });
});
