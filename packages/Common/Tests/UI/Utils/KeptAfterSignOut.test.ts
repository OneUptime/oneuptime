import { COOKIE_CONSENT_STORAGE_KEY } from "../../../Types/Analytics/CookieConsent";
import { DASHBOARD_LANGUAGE_STORAGE_KEY } from "../../../Types/Dashboard/DashboardLanguage";
import { DASHBOARD_VISITOR_THEME_STORAGE_KEY } from "../../../Types/Dashboard/DashboardTheme";
import {
  STATUS_PAGE_LANGUAGE_STORAGE_KEY,
  STATUS_PAGE_LANGUAGE_USER_CHOICE_KEY,
} from "../../../Types/StatusPage/StatusPageLanguage";
import { STATUS_PAGE_VISITOR_THEME_STORAGE_KEY } from "../../../Types/StatusPage/StatusPageTheme";
import { THEME_STORAGE_KEY } from "../../../Types/Theme/ThemePreference";
import {
  API_REFERENCE_THEME_STORAGE_KEY,
  DOCS_THEME_STORAGE_KEY,
  KEYS_KEPT_AFTER_SIGN_OUT,
} from "../../../UI/Utils/KeptAfterSignOut";
import { DASHBOARD_VIEWER_PICK_KEY_PREFIX } from "../../../UI/Utils/DashboardViewerPicks";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The list of what signing out leaves in the browser (UI/Utils/
 * KeptAfterSignOut.ts), held to the pages that read it.
 *
 * A pick is lost as surely by a page reading another key as by a sign-out
 * removing it, and the docs, the API reference and the head scripts spell
 * their keys out in templates, where no constant reaches. A key on this list
 * that holds a person's data would outlive their session on a shared browser,
 * so what the list may hold is checked as well as what it does.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..", "..");

const read: (...parts: Array<string>) => string = (
  ...parts: Array<string>
): string => {
  return fs.readFileSync(path.join(PACKAGES, ...parts), "utf8");
};

const featureSet: (...parts: Array<string>) => string = (
  ...parts: Array<string>
): string => {
  return read("App", "FeatureSet", ...parts);
};

describe("every key on the list is the key its page reads", () => {
  test("the person's theme: the head script of every page of theirs", () => {
    expect(
      read("Common", "Server", "Views", "Partials", "Theme.ejs"),
    ).toContain(`var storageKey = "${THEME_STORAGE_KEY}";`);
    expect(featureSet("Dashboard", "public", "offline.html")).toContain(
      `window.localStorage.getItem("${THEME_STORAGE_KEY}")`,
    );
  });

  test.each(["Accounts", "Dashboard", "AdminDashboard"])(
    "the language: %s reads and writes the one key they share",
    (frontend: string) => {
      const i18n: string = featureSet(frontend, "src", "Utils", "i18n.ts");

      expect(i18n).toContain(
        "export const LANGUAGE_STORAGE_KEY: string = DASHBOARD_LANGUAGE_STORAGE_KEY;",
      );
      expect(i18n).toContain("lookupLocalStorage: LANGUAGE_STORAGE_KEY");
      expect(i18n).toContain('caches: ["localStorage"]');
      expect(i18n).toContain('order: ["localStorage", "navigator", "htmlTag"]');
      expect(featureSet(frontend, "views", "index.ejs")).toContain(
        `languageStorageKey: '${DASHBOARD_LANGUAGE_STORAGE_KEY}'`,
      );
    },
  );

  test("a status page's visitor: the language and whether they picked it", () => {
    const i18n: string = featureSet("StatusPage", "src", "Utils", "i18n.ts");

    expect(i18n).toContain(
      "export const LANGUAGE_STORAGE_KEY: string = STATUS_PAGE_LANGUAGE_STORAGE_KEY;",
    );
    expect(i18n).toContain("STATUS_PAGE_LANGUAGE_USER_CHOICE_KEY;");
    expect(i18n).toContain("lookupLocalStorage: LANGUAGE_STORAGE_KEY");
  });

  test("the docs' own theme switch", () => {
    expect(featureSet("Docs", "Views", "Partials", "Head.ejs")).toContain(
      `window.localStorage.getItem('${DOCS_THEME_STORAGE_KEY}')`,
    );
    expect(featureSet("Docs", "Views", "Partials", "Scripts.ejs")).toContain(
      `window.localStorage.setItem('${DOCS_THEME_STORAGE_KEY}'`,
    );
  });

  test("the API reference's own theme switch", () => {
    expect(
      featureSet("APIReference", "views", "partials", "head.ejs"),
    ).toContain(`var STORAGE_KEY = '${API_REFERENCE_THEME_STORAGE_KEY}';`);
  });

  test("the answer on the cookie banner, where it is given and where it is read", () => {
    expect(
      read("Common", "Server", "Views", "Partials", "AnalyticsConsent.ejs"),
    ).toContain(`var STORAGE_KEY = '${COOKIE_CONSENT_STORAGE_KEY}';`);
    expect(read("Home", "Views", "cookie-banner.ejs")).toContain(
      `localStorage.setItem('${COOKIE_CONSENT_STORAGE_KEY}'`,
    );
  });
});

describe("what the list may hold", () => {
  test("these keys and no others: a new one is a decision, with its reason in KeptAfterSignOut.ts", () => {
    expect([...KEYS_KEPT_AFTER_SIGN_OUT].sort()).toEqual(
      [
        THEME_STORAGE_KEY,
        DASHBOARD_LANGUAGE_STORAGE_KEY,
        STATUS_PAGE_VISITOR_THEME_STORAGE_KEY,
        STATUS_PAGE_LANGUAGE_STORAGE_KEY,
        STATUS_PAGE_LANGUAGE_USER_CHOICE_KEY,
        DASHBOARD_VISITOR_THEME_STORAGE_KEY,
        DOCS_THEME_STORAGE_KEY,
        API_REFERENCE_THEME_STORAGE_KEY,
        COOKIE_CONSENT_STORAGE_KEY,
      ].sort(),
    );
  });

  test("no key is on it twice", () => {
    expect(new Set(KEYS_KEPT_AFTER_SIGN_OUT).size).toBe(
      KEYS_KEPT_AFTER_SIGN_OUT.length,
    );
  });

  test.each([...KEYS_KEPT_AFTER_SIGN_OUT])(
    "%s names nobody and nothing of theirs",
    (key: string) => {
      // A person's, a project's or a session's name for something is theirs.
      expect(key).not.toMatch(
        /user[-_.]|token|email|session|project|password/i,
      );
      // An id in a key ties it to someone or to a record; ":" and "." join one on.
      expect(key).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
      expect(key).not.toMatch(/[:.]/);
    },
  );

  test("a dashboard's viewer picks stay off it: the docs call them theirs alone", () => {
    const theme: string = `${DASHBOARD_VIEWER_PICK_KEY_PREFIX}-theme`;

    expect(theme).toBe(THEME_STORAGE_KEY);

    for (const key of KEYS_KEPT_AFTER_SIGN_OUT) {
      if (key !== theme) {
        expect(key.startsWith(`${DASHBOARD_VIEWER_PICK_KEY_PREFIX}-`)).toBe(
          false,
        );
      }
    }

    expect(read("Common", "UI", "Utils", "KeptAfterSignOut.ts")).toContain(
      "DashboardViewerPicks.ts",
    );
  });
});

describe("nothing else empties the browser's storage", () => {
  const SOURCE_ROOTS: Array<Array<string>> = [
    ["Common", "UI"],
    ["App", "FeatureSet", "Accounts", "src"],
    ["App", "FeatureSet", "AdminDashboard", "src"],
    ["App", "FeatureSet", "Dashboard", "src"],
    ["App", "FeatureSet", "PublicDashboard", "src"],
    ["App", "FeatureSet", "StatusPage", "src"],
  ];

  const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;

  const CLEARS_LOCAL_STORAGE: RegExp = /\blocalStorage\s*\.\s*clear\s*\(/i;

  const sourceFilesUnder: (directory: string) => Array<string> = (
    directory: string,
  ): Array<string> => {
    const found: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!["node_modules", "dist", "build"].includes(entry.name)) {
          found.push(...sourceFilesUnder(entryPath));
        }
      } else if (SOURCE_FILE.test(entry.name)) {
        found.push(entryPath);
      }
    }

    return found;
  };

  test("local storage is only ever cleared by name: a clear would take every pick", () => {
    const files: Array<string> = SOURCE_ROOTS.flatMap(
      (root: Array<string>): Array<string> => {
        return sourceFilesUnder(path.join(PACKAGES, ...root));
      },
    );

    expect(files.length).toBeGreaterThan(1000);

    const clearing: Array<string> = files.filter((file: string): boolean => {
      return CLEARS_LOCAL_STORAGE.test(fs.readFileSync(file, "utf8"));
    });

    expect(clearing).toEqual([]);
  });
});
