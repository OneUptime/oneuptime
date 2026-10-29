import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * Every frontend's page says what is wrong when its app cannot start - its
 * entry bundle (dist/Index.js, or a file it imports) does not load - instead
 * of a blank page and, on a reload with the server down, the browser's own
 * error page (Common/Server/Views/Partials/EntryLoadFailure.ejs, whose
 * behaviour Common/Tests/Server/Views/EntryLoadFailure.test.ts runs).
 *
 * Each index.ejs includes the partial right after the app's root and before
 * the entry script - so it is listening before the entry can fail, and it
 * draws into the root the app would have drawn into - telling it where the
 * frontend keeps the reader's language. These render each page as the
 * server does and read where the partial lands and what it was told.
 */

const FEATURE_SET_DIR: string = path.join(__dirname, "..", "..", "FeatureSet");

interface Frontend {
  name: string;
  entry: string;
  options: {
    storageKey: string;
    choiceKey: string;
    usesPageLanguage: boolean;
  };
  why: string;
}

const FRONTENDS: Array<Frontend> = [
  {
    name: "Dashboard",
    entry: "/dashboard/dist/Index.js",
    options: {
      storageKey: "oneuptimeLang",
      choiceKey: "",
      usesPageLanguage: false,
    },
    why: "the language picked in the user menu (Utils/i18n's LANGUAGE_STORAGE_KEY), then the browser's",
  },
  {
    name: "AdminDashboard",
    entry: "/admin/dist/Index.js",
    options: {
      storageKey: "oneuptimeLang",
      choiceKey: "",
      usesPageLanguage: false,
    },
    why: "the language picked in the Dashboard, which the Admin Dashboard shares",
  },
  {
    name: "Accounts",
    entry: "/accounts/dist/Index.js",
    options: {
      storageKey: "oneuptimeLang",
      choiceKey: "",
      usesPageLanguage: false,
    },
    why: "the language picked on the sign-in pages, which the Dashboard shares",
  },
  {
    name: "StatusPage",
    entry: "/status-page/dist/Index.js",
    options: {
      storageKey: "statusPageLang",
      choiceKey: "statusPageLangUserChoice",
      usesPageLanguage: true,
    },
    why: "the visitor's own pick, else the status page's own language (<html lang>), as applyStatusPageLanguageSettings does",
  },
  {
    name: "PublicDashboard",
    entry: "/public-dashboard/dist/Index.js",
    options: { storageKey: "", choiceKey: "", usesPageLanguage: false },
    why: "the browser's languages: a public dashboard keeps no language (Common/UI/Utils/VisitorLanguage)",
  },
];

const ROOT: string = '<div id="root"></div>';

const PARTIAL_MARKER: string = 'var ENTRY_PATH_END = "/dist/Index.js";';

const renderPage: (frontend: Frontend) => string = (
  frontend: Frontend,
): string => {
  const file: string = path.join(
    FEATURE_SET_DIR,
    frontend.name,
    "views",
    "index.ejs",
  );

  return ejs.render(fs.readFileSync(file, "utf8"), {}, { filename: file });
};

const countOf: (text: string, part: string) => number = (
  text: string,
  part: string,
): number => {
  let count: number = 0;
  let index: number = text.indexOf(part);

  while (index !== -1) {
    count++;
    index = text.indexOf(part, index + part.length);
  }

  return count;
};

describe.each(FRONTENDS)("the $name's page", (frontend: Frontend) => {
  const page: string = renderPage(frontend);
  const entryScript: string = `<script type="module" src="${frontend.entry}"></script>`;

  test("includes the partial once, between its root and its entry", () => {
    expect(countOf(page, PARTIAL_MARKER)).toBe(1);
    expect(countOf(page, ROOT)).toBe(1);
    expect(countOf(page, entryScript)).toBe(1);

    const root: number = page.indexOf(ROOT);
    const partial: number = page.indexOf(PARTIAL_MARKER);
    const entry: number = page.indexOf(entryScript);

    expect(root).toBeLessThan(partial);
    expect(partial).toBeLessThan(entry);
  });

  test("its entry is the one module script, at the address the partial listens for", () => {
    expect(countOf(page, '<script type="module"')).toBe(1);
    expect(frontend.entry.endsWith("/dist/Index.js")).toBe(true);
  });

  test(`tells it where the reader's language is: ${frontend.why}`, () => {
    expect(page).toContain(`(window, ${JSON.stringify(frontend.options)});`);
  });

  test("the language it keeps is the one the frontend's own app keeps", () => {
    if (!frontend.options.storageKey) {
      expect(
        fs.existsSync(
          path.join(FEATURE_SET_DIR, frontend.name, "src", "Utils", "i18n.ts"),
        ),
      ).toBe(true);
      return;
    }

    const i18n: string = fs.readFileSync(
      path.join(FEATURE_SET_DIR, frontend.name, "src", "Utils", "i18n.ts"),
      "utf8",
    );

    expect(i18n).toContain(`"${frontend.options.storageKey}"`);

    if (frontend.options.choiceKey) {
      expect(i18n).toContain(`"${frontend.options.choiceKey}"`);
    }
  });
});

test("a page without the partial would be caught: the marker is the partial's own", () => {
  const partial: string = fs.readFileSync(
    path.join(
      FEATURE_SET_DIR,
      "..",
      "..",
      "Common",
      "Server",
      "Views",
      "Partials",
      "EntryLoadFailure.ejs",
    ),
    "utf8",
  );

  expect(countOf(partial, PARTIAL_MARKER)).toBe(1);
});
