import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY LOCALE FILE LISTS ITS KEYS IN en.json'S ORDER, NESTED KEYS INCLUDED.
 *
 * Accounts' locale files had exactly en.json's keys, but in sixteen of them
 * the sign-in page's nested `login.passkey` block came before `login.title`
 * (#7285). Nothing reads the order at run time, so no test saw it, but it
 * made every later diff of those files noisy and tripped the scripts that
 * walk the locale files side by side (copying shared words between the
 * apps, merging two branches' files key by key).
 *
 * Held here for every frontend that has locale files of its own, so a
 * frontend added later is held the day it gets them:
 *
 *   - each locale file has en.json's keys, at every depth, in en.json's
 *     order;
 *   - each file is written the canonical way (two-space JSON and a final
 *     newline), the form the i18n scripts write, so a rewrite in order never
 *     shows as a whole-file diff.
 *
 * The Dashboard's own guard (Dashboard/DashboardLocalesGuard) checks its
 * flat keys the same way; this one covers the other apps, and the nested
 * keys of all of them.
 */

const FEATURE_SET: string = path.join(__dirname, "..", "..", "FeatureSet");

// The frontends known to have locale files; the listing below must find them.
const KNOWN_FRONTENDS: ReadonlyArray<string> = [
  "Accounts",
  "AdminDashboard",
  "Dashboard",
  "PublicDashboard",
  "StatusPage",
];

type LocaleTree = { [key: string]: LocaleTree | string };

const localesDirectoryOf: (frontend: string) => string = (
  frontend: string,
): string => {
  return path.join(FEATURE_SET, frontend, "src", "Locales");
};

const frontendsWithLocales: () => Array<string> = (): Array<string> => {
  return fs
    .readdirSync(FEATURE_SET)
    .filter((name: string): boolean => {
      return fs.existsSync(path.join(localesDirectoryOf(name), "en.json"));
    })
    .sort();
};

const localeCodesOf: (frontend: string) => Array<string> = (
  frontend: string,
): Array<string> => {
  return fs
    .readdirSync(localesDirectoryOf(frontend))
    .filter((name: string): boolean => {
      return name.endsWith(".json") && name !== "en.json";
    })
    .map((name: string): string => {
      return name.slice(0, -".json".length);
    })
    .sort();
};

const readText: (frontend: string, code: string) => string = (
  frontend: string,
  code: string,
): string => {
  return fs.readFileSync(
    path.join(localesDirectoryOf(frontend), `${code}.json`),
    "utf8",
  );
};

/*
 * Every key path of a tree, depth first, in the order the file writes them:
 * "login", "login.title", "login.passkey", "login.passkey.button", ...
 * A key can hold a dot (an English sentence is a key), so the path is
 * joined with a character no key holds.
 */
const PATH_SEPARATOR: string = "\u{0000}";

const keyPathsInOrder: (tree: LocaleTree) => Array<string> = (
  tree: LocaleTree,
): Array<string> => {
  const paths: Array<string> = [];
  const walk: (node: LocaleTree, prefix: string) => void = (
    node: LocaleTree,
    prefix: string,
  ): void => {
    for (const key of Object.keys(node)) {
      const keyPath: string = prefix ? `${prefix}${PATH_SEPARATOR}${key}` : key;
      paths.push(keyPath);
      const value: LocaleTree | string = node[key] as LocaleTree | string;
      if (typeof value === "object" && value !== null) {
        walk(value, keyPath);
      }
    }
  };
  walk(tree, "");
  return paths;
};

/*
 * The first place two trees list their keys differently, written as a
 * readable path ("login > passkey" where "login > title" was expected), or
 * null when they list the same keys in the same order.
 */
const firstOrderDifference: (
  locale: LocaleTree,
  english: LocaleTree,
) => string | null = (
  locale: LocaleTree,
  english: LocaleTree,
): string | null => {
  const ours: Array<string> = keyPathsInOrder(locale);
  const theirs: Array<string> = keyPathsInOrder(english);
  const readable: (keyPath: string | undefined) => string = (
    keyPath: string | undefined,
  ): string => {
    return keyPath === undefined
      ? "(nothing)"
      : keyPath.split(PATH_SEPARATOR).join(" > ");
  };

  for (
    let index: number = 0;
    index < Math.max(ours.length, theirs.length);
    index++
  ) {
    if (ours[index] !== theirs[index]) {
      return `${readable(ours[index])} where en.json has ${readable(theirs[index])}`;
    }
  }

  return null;
};

describe("the frontends with locale files", () => {
  test("are found by the listing, so none is skipped", () => {
    expect(frontendsWithLocales()).toEqual([...KNOWN_FRONTENDS].sort());
  });

  test.each(KNOWN_FRONTENDS)("%s has its translations", (frontend: string) => {
    // Every frontend is translated into the same seventeen languages.
    expect(localeCodesOf(frontend).length).toBe(17);
  });
});

describe("the order check itself", () => {
  const english: LocaleTree = {
    "Sign in": "Sign in",
    login: { title: "Welcome back", passkey: { button: "Use a passkey" } },
    register: { title: "Create your account" },
  };

  test("passes a file in en.json's order", () => {
    expect(
      firstOrderDifference(
        {
          "Sign in": "Anmelden",
          login: {
            title: "Willkommen zurück",
            passkey: { button: "Passkey verwenden" },
          },
          register: { title: "Konto erstellen" },
        },
        english,
      ),
    ).toBeNull();
  });

  test("names a nested key that moved, the way Accounts' files had it", () => {
    expect(
      firstOrderDifference(
        {
          "Sign in": "Anmelden",
          login: {
            passkey: { button: "Passkey verwenden" },
            title: "Willkommen zurück",
          },
          register: { title: "Konto erstellen" },
        },
        english,
      ),
    ).toBe("login > passkey where en.json has login > title");
  });

  test("names a top-level key that moved", () => {
    expect(
      firstOrderDifference(
        {
          login: {
            title: "Willkommen zurück",
            passkey: { button: "Passkey verwenden" },
          },
          "Sign in": "Anmelden",
          register: { title: "Konto erstellen" },
        },
        english,
      ),
    ).toBe("login where en.json has Sign in");
  });

  test("names a key a file lacks, and one en.json lacks", () => {
    expect(
      firstOrderDifference(
        {
          "Sign in": "Anmelden",
          login: { title: "Willkommen zurück", passkey: {} },
          register: { title: "Konto erstellen" },
        },
        english,
      ),
    ).toBe("register where en.json has login > passkey > button");
    expect(
      firstOrderDifference(
        {
          "Sign in": "Anmelden",
          login: {
            title: "Willkommen zurück",
            passkey: { button: "Passkey verwenden" },
          },
          register: { title: "Konto erstellen" },
          extra: "Extra",
        },
        english,
      ),
    ).toBe("extra where en.json has (nothing)");
  });

  test("tells a key with a dot in it from a nested key", () => {
    expect(
      firstOrderDifference(
        { "a.b": "x", a: { b: "y" } },
        { a: { b: "y" }, "a.b": "x" },
      ),
    ).toBe("a.b where en.json has a");
  });
});

describe.each(KNOWN_FRONTENDS)("%s's locale files", (frontend: string) => {
  const englishText: string = readText(frontend, "en");
  const english: LocaleTree = JSON.parse(englishText) as LocaleTree;

  test("en.json is written the canonical way", () => {
    expect(JSON.stringify(english, null, 2) + "\n").toBe(englishText);
  });

  test.each(localeCodesOf(frontend))(
    "%s lists en.json's keys in en.json's order, nested keys included",
    (code: string) => {
      const locale: LocaleTree = JSON.parse(
        readText(frontend, code),
      ) as LocaleTree;

      expect(firstOrderDifference(locale, english)).toBeNull();
    },
  );

  test.each(localeCodesOf(frontend))(
    "%s is written the canonical way",
    (code: string) => {
      const text: string = readText(frontend, code);

      expect(JSON.stringify(JSON.parse(text), null, 2) + "\n").toBe(text);
    },
  );
});
