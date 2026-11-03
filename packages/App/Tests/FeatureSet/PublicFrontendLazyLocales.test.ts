import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as AccountsLocaleLoader from "../../FeatureSet/Accounts/src/Utils/I18nLocaleLoader";
import * as StatusPageLocaleLoader from "../../FeatureSet/StatusPage/src/Utils/I18nLocaleLoader";
import {
  DEFAULT_ACCOUNTS_LANGUAGE,
  SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
} from "Common/Types/Accounts/AccountsLanguage";
import {
  DEFAULT_STATUS_PAGE_LANGUAGE,
  SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
} from "Common/Types/StatusPage/StatusPageLanguage";

/*
 * The sign-in pages and the status pages load the reader's language only
 * (issue #5614). Both frontends bundled all seventeen locale files into what
 * a visitor downloads before the page can draw - about 165 KB gzipped of the
 * sign-in page's first load and 105 KB of a status page's - though a
 * visitor reads one. They now do what the Dashboard does
 * (Tests/Dashboard/I18nLazyLocales.test.ts, which this file follows): English,
 * the fallback, stays in the bundle, and every other language is its own
 * chunk, fetched on demand.
 *
 * The App suite runs in plain Node, so the i18next boot itself cannot run
 * here. For each frontend this file source-pins the split's intent - only
 * en.json is imported statically, the loader goes through a template-literal
 * dynamic import (which is what makes esbuild emit one chunk per locale),
 * the first render waits for i18next, and the language switcher loads a
 * language before switching to it - and exercises the React-free loader:
 * its allowlist keeps the import path safe, and loading every language
 * proves each file is where the template literal points.
 */

interface Frontend {
  name: string;
  source: string;
  defaultLanguage: string;
  supportedLanguages: Array<string>;
  loader: {
    isLazyLoadableLanguageCode: (languageCode: string) => boolean;
    loadLocaleResource: (
      languageCode: string,
    ) => Promise<Record<string, unknown>>;
  };
}

const FEATURE_SETS: string = path.join(__dirname, "..", "..", "FeatureSet");

const FRONTENDS: Array<Frontend> = [
  {
    name: "Accounts",
    source: path.join(FEATURE_SETS, "Accounts", "src"),
    defaultLanguage: DEFAULT_ACCOUNTS_LANGUAGE,
    supportedLanguages: SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
    loader: AccountsLocaleLoader,
  },
  {
    name: "StatusPage",
    source: path.join(FEATURE_SETS, "StatusPage", "src"),
    defaultLanguage: DEFAULT_STATUS_PAGE_LANGUAGE,
    supportedLanguages: SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
    loader: StatusPageLocaleLoader,
  },
];

/*
 * Comments are stripped before matching: the files narrate what the split
 * replaced, and assertions about the code must read the code.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCode(frontend: Frontend, ...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(frontend.source, ...relativeParts), "utf8"),
  );
}

/*
 * Static import specifiers that point into a Locales directory. Dynamic
 * imports use a backtick template literal and deliberately do not match:
 * they are what keeps the locales out of the first load.
 */
function staticLocaleImportSpecifiers(source: string): Array<string> {
  const pattern: RegExp = /import\s[^;]*?["']([^"']*Locales\/[^"']+)["']/g;
  const specifiers: Array<string> = [];
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match !== null) {
    specifiers.push(match[1] as string);
    match = pattern.exec(source);
  }

  return specifiers;
}

function walkSourceFiles(dir: string): Array<string> {
  const collected: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collected.push(...walkSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      collected.push(fullPath);
    }
  }

  return collected;
}

describe.each(FRONTENDS)("$name's locale bundling", (frontend: Frontend) => {
  const lazyLanguages: Array<string> = frontend.supportedLanguages.filter(
    (code: string): boolean => {
      return code !== frontend.defaultLanguage;
    },
  );

  test("i18n.ts statically imports the fallback locale and only the fallback locale", () => {
    expect(
      staticLocaleImportSpecifiers(readCode(frontend, "Utils", "i18n.ts")),
    ).toEqual([`../Locales/${frontend.defaultLanguage}.json`]);
    expect(frontend.defaultLanguage).toBe("en");
  });

  test("no other source file statically imports a locale bundle", () => {
    const files: Array<string> = walkSourceFiles(frontend.source);

    // The walk found the tree (guards against the directory moving).
    expect(files.length).toBeGreaterThan(10);

    for (const file of files) {
      if (path.basename(file) === "i18n.ts") {
        continue;
      }

      const relative: string = path.relative(frontend.source, file);

      expect([
        relative,
        staticLocaleImportSpecifiers(
          stripComments(fs.readFileSync(file, "utf8")),
        ),
      ]).toEqual([relative, []]);
    }
  });

  test("other languages are reached through a template-literal dynamic import, so esbuild emits one chunk per locale", () => {
    expect(readCode(frontend, "Utils", "I18nLocaleLoader.ts")).toMatch(
      /import\(\s*`\.\.\/Locales\/\$\{[^}]+\}\.json`\s*\)/,
    );
  });

  test("i18n.ts wires the loader as a partial-bundle backend, falling back to the bundled English", () => {
    const i18nSource: string = readCode(frontend, "Utils", "i18n.ts");

    expect(i18nSource).toMatch(/from\s+["']\.\/I18nLocaleLoader["']/);
    expect(i18nSource).toMatch(/type:\s*["']backend["']/);
    expect(i18nSource).toMatch(/\.use\(lazyLocaleBackend\)/);
    expect(i18nSource).toMatch(/partialBundledLanguages:\s*true/);
    expect(i18nSource).toMatch(/fallbackLng:\s*DEFAULT_LANGUAGE\b/);
    expect(i18nSource).toMatch(
      /resources:\s*\{\s*en:\s*\{\s*translation:\s*en\s*\}\s*,?\s*\}/,
    );
    expect(i18nSource).toMatch(
      /export const i18nReady:\s*Promise<void>\s*=\s*i18n\b/,
    );
  });

  test("the first render waits for i18next, so a reader in another language never sees raw keys", () => {
    const indexSource: string = readCode(frontend, "Index.tsx");

    expect(indexSource).toMatch(
      /import\s*\{[^}]*\bi18nReady\b[^}]*\}\s*from\s*["']\.\/Utils\/i18n["']/,
    );
    expect(indexSource).toMatch(/i18nReady\s*\.\s*(?:then|catch|finally)\s*\(/);
    // root.render lives inside the chained callback, never at the top level.
    expect(indexSource).toMatch(/root\.render\(/);
    expect(indexSource).not.toMatch(/^root\.render\(/m);
    expect(indexSource.indexOf("root.render(")).toBeGreaterThan(
      indexSource.indexOf("i18nReady"),
    );
  });

  test("the language switcher loads the language before switching to it", () => {
    const switcherSource: string = readCode(
      frontend,
      "Components",
      "LanguageSwitcher",
      "LanguageSwitcher.tsx",
    );

    // Awaited: a load left running would still paint raw keys.
    expect(switcherSource).toMatch(/await\s+i18n\.loadLanguages\(/);
    expect(switcherSource.indexOf("changeLanguage(")).toBeGreaterThan(
      switcherSource.indexOf("loadLanguages("),
    );
  });

  test("the loader accepts exactly the supported languages other than English", () => {
    expect(lazyLanguages.length).toBeGreaterThan(0);

    for (const code of lazyLanguages) {
      expect([code, frontend.loader.isLazyLoadableLanguageCode(code)]).toEqual([
        code,
        true,
      ]);
    }

    // English ships in the bundle; loading it again would fetch it twice.
    expect(
      frontend.loader.isLazyLoadableLanguageCode(frontend.defaultLanguage),
    ).toBe(false);
  });

  test("the loader rejects unknown, legacy and path-shaped codes before they reach the import", () => {
    for (const code of [
      "",
      "xx",
      // Legacy "zh" is rewritten to "zh-CN" before detection reaches here.
      "zh",
      "EN",
      "De",
      "de.json",
      "../Locales/en",
      "..",
      "de/../../secrets",
    ]) {
      expect([code, frontend.loader.isLazyLoadableLanguageCode(code)]).toEqual([
        code,
        false,
      ]);
    }
  });

  test("every language other than English loads from where the template literal points, and translates English's keys", async () => {
    const englishKeys: Array<string> = Object.keys(
      JSON.parse(
        fs.readFileSync(
          path.join(frontend.source, "Locales", "en.json"),
          "utf8",
        ),
      ) as Record<string, unknown>,
    );

    for (const code of lazyLanguages) {
      const keys: Array<string> = Object.keys(
        await frontend.loader.loadLocaleResource(code),
      );
      const shared: number = keys.filter((key: string): boolean => {
        return englishKeys.includes(key);
      }).length;

      expect([code, keys.length > 0, shared > 0]).toEqual([code, true, true]);
    }
  });

  test("the loader refuses English and unknown codes", async () => {
    await expect(
      frontend.loader.loadLocaleResource(frontend.defaultLanguage),
    ).rejects.toThrow(frontend.defaultLanguage);
    await expect(frontend.loader.loadLocaleResource("xx")).rejects.toThrow(
      "xx",
    );
    await expect(
      frontend.loader.loadLocaleResource("../Locales/en"),
    ).rejects.toThrow();
  });
});
