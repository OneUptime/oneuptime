import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  classesWithoutDarkTheme,
  isColourClass,
} from "Common/Tests/UI/Styles/DarkThemeCoverage";

/*
 * Every sign-in page in the dark theme, held at the source: each colour
 * class the Accounts app writes - in its pages, its components, and the
 * shared sign-in pieces only these pages draw (Common's SignInOption and
 * SsoProviderOptions, the product logo) - is one the dark theme draws:
 * Common/UI/Styles/Theme.css recolours it under html.dark, or it reads the
 * same on both (a mid-tone fill, white words on it). A colour added without
 * that would be a light patch on a dark sign-in page, and nothing else
 * fails: the page still renders.
 *
 * One page is not the person's: a public form (Pages/Form.tsx) is its
 * owner's page and is drawn light whoever opens it (Utils/AccountsTheme.ts),
 * so its colours are left out here - and its address must stay on the list
 * of pages that are always light, or it would be drawn dark with them.
 *
 * Its rendered half is Common/Tests/App/Accounts/AccountsPagesDarkTheme
 * (every page and state, as React draws them), and the browser half is
 * packages/E2E/AccountsTheme.
 */

const APP: string = path.resolve(__dirname, "..", "..");
const ACCOUNTS: string = path.join(APP, "FeatureSet", "Accounts");
const ACCOUNTS_SOURCE: string = path.join(ACCOUNTS, "src");
const COMMON_UI: string = path.resolve(APP, "..", "Common", "UI");

// The public form: its owner's page, drawn light.
const ALWAYS_LIGHT_PAGES: ReadonlyArray<string> = ["Pages/Form.tsx"];

// Shared pieces only the sign-in pages draw.
const SIGN_IN_PIECES: ReadonlyArray<string> = [
  "Components/SignInOption/SignInOptionLabel.tsx",
  "Components/SignInOption/SignInOptionLink.tsx",
  "Components/SignInOption/SignInOptionStyle.ts",
  "Components/SignInOption/SsoProviderOptions.tsx",
  "Components/ProductLogo/ProductLogo.tsx",
];

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/.*$/gm;
// Every quoted string, those inside a template's substitutions included.
const QUOTED_STRING: RegExp = /"([^"\n]*)"|'([^'\n]*)'/g;
const TEMPLATE_LITERAL: RegExp = /`([^`]*)`/g;
const TEMPLATE_SUBSTITUTION: RegExp = /\$\{[^}]*\}/g;
const WHITESPACE: RegExp = /\s+/;
const SOURCE_FILE: RegExp = /\.tsx?$/;

const walk: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "Locales") {
        files.push(...walk(full));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

/*
 * Every whitespace-separated word of every string in a module: class lists
 * are strings here (className="...", the style constants, a template's
 * fixed text and the quoted branches of its substitutions:
 * `mt-3 ${isDone ? "text-emerald-800" : "text-indigo-950"}`), and prose
 * never looks like a utility.
 */
const colourClassesInSource: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  const code: string = fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1 ");
  const texts: Array<string> = [];

  for (const match of code.matchAll(QUOTED_STRING)) {
    texts.push(match[1] ?? match[2] ?? "");
  }

  for (const match of code.matchAll(TEMPLATE_LITERAL)) {
    texts.push((match[1] ?? "").replace(TEMPLATE_SUBSTITUTION, " "));
  }

  const tokens: Set<string> = new Set<string>();

  for (const text of texts) {
    for (const token of text.split(WHITESPACE)) {
      if (token && isColourClass(token)) {
        tokens.add(token);
      }
    }
  }

  return Array.from(tokens).sort();
};

const ACCOUNTS_FILES: Array<string> = walk(ACCOUNTS_SOURCE).filter(
  (file: string): boolean => {
    return !ALWAYS_LIGHT_PAGES.includes(
      path.relative(ACCOUNTS_SOURCE, file).split(path.sep).join("/"),
    );
  },
);

describe("the sign-in pages' colours", () => {
  test("cover every page and component the app has, the public form aside", () => {
    const pages: Array<string> = ACCOUNTS_FILES.map((file: string): string => {
      return path.relative(ACCOUNTS_SOURCE, file).split(path.sep).join("/");
    }).filter((file: string): boolean => {
      return file.startsWith("Pages/");
    });

    expect(pages).toEqual(
      expect.arrayContaining([
        "Pages/Login.tsx",
        "Pages/LoginWithSSO.tsx",
        "Pages/Register.tsx",
        "Pages/ForgotPassword.tsx",
        "Pages/ResetPassword.tsx",
        "Pages/VerifyEmail.tsx",
        "Pages/MobilePasskey.tsx",
        "Pages/McpAuthorize.tsx",
        "Pages/MarketplacePurchase.tsx",
        "Pages/NotFound.tsx",
        "Pages/Forbidden.tsx",
      ]),
    );
    expect(pages).not.toContain("Pages/Form.tsx");
  });

  test.each(
    ACCOUNTS_FILES.map((file: string): [string, string] => {
      return [path.relative(ACCOUNTS, file), file];
    }),
  )("%s draws every colour in the dark theme too", (_name: string, file: string) => {
    expect(classesWithoutDarkTheme(colourClassesInSource(file))).toEqual([]);
  });

  test.each(
    SIGN_IN_PIECES.map((relative: string): [string, string] => {
      return [relative, path.join(COMMON_UI, relative)];
    }),
  )(
    "Common's %s draws every colour in the dark theme too",
    (_name: string, file: string) => {
      expect(fs.existsSync(file)).toBe(true);
      expect(classesWithoutDarkTheme(colourClassesInSource(file))).toEqual([]);
    },
  );

  test("finds colours to check: the guard reads the pages it means to", () => {
    const all: Set<string> = new Set<string>();

    for (const file of ACCOUNTS_FILES) {
      for (const token of colourClassesInSource(file)) {
        all.add(token);
      }
    }

    expect(all.size).toBeGreaterThan(30);
    expect(all.has("text-gray-900")).toBe(true);
    expect(all.has("bg-white")).toBe(true);
    // A branch of a template's substitution: the password guidance's colour.
    expect(all.has("text-indigo-950")).toBe(true);
  });
});

describe("the page the sign-in pages are drawn in", () => {
  const template: string = fs.readFileSync(
    path.join(ACCOUNTS, "views", "index.ejs"),
    "utf8",
  );

  test("draws the person's theme before anything paints, with the public form's addresses kept light", () => {
    const theme: number = template.indexOf(
      "Common/Server/Views/Partials/Theme'",
    );

    expect(theme).toBeGreaterThan(-1);
    expect(theme).toBeLessThan(template.indexOf("/accounts/env.js"));
    expect(theme).toBeLessThan(template.indexOf("tailwind-3.4.5.js"));
    expect(template.slice(theme, template.indexOf("-%>", theme))).toContain(
      "alwaysLightPathPrefixes: ['/accounts/form/', '/accounts/incident-form/']",
    );
  });

  test("has no theme-color tag of its own: the partial writes the one the theme script sets", () => {
    expect(template).not.toContain('name="theme-color"');
  });

  test("tells Tailwind the dark theme is the dark class", () => {
    expect(template).toContain("darkMode: 'class',");
  });

  test("keeps the page's ground the class the dark theme repaints", () => {
    expect(template).toContain('<body class="h-full bg-gray-50">');
  });

  test("lists the public form's address among the ones always drawn light", () => {
    const accountsTheme: string = fs.readFileSync(
      path.join(ACCOUNTS_SOURCE, "Utils", "AccountsTheme.ts"),
      "utf8",
    );

    expect(accountsTheme).toContain('"/accounts/form/",');
    expect(accountsTheme).toContain('"/accounts/incident-form/",');
  });
});
