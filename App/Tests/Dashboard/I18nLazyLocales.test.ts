import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  isLazyLoadableLanguageCode,
  loadLocaleResource,
  LocaleResource,
} from "../../FeatureSet/Dashboard/src/Utils/I18nLocaleLoader";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "Common/Types/Dashboard/DashboardLanguage";

/*
 * The dashboard used to bundle all sixteen locale JSONs into the eager entry
 * chunk — 11.8MB of the 12.4MB Index.js, 94.9% of it never read by any given
 * user. The fix keeps English (the fallback) static and code-splits every
 * other locale behind a dynamic import that i18next's lazy backend resolves
 * on demand.
 *
 * The App suite runs in a plain Node environment, so the i18next boot itself
 * cannot be exercised here. Instead this file does two things, in the style
 * of NetworkTopologyPanelLayering / AppShellWiring:
 *
 * 1. Source-pins the INTENT of the split with tolerant patterns (never exact
 *    byte strings): only en.json is imported statically anywhere in the
 *    dashboard, the loader goes through a template-literal dynamic import
 *    (which is what makes esbuild emit one chunk per locale), the first
 *    render is gated on i18next readiness, and the language switcher loads
 *    the target locale before switching to it.
 *
 * 2. Exercises the React-free loader module directly: the allowlist is what
 *    keeps the dynamic import path safe, and actually loading every
 *    supported locale proves each file still exists where the template
 *    literal points — a renamed Locales file would otherwise only fail at
 *    runtime in a user's browser.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Comments are stripped before matching: i18n.ts narrates the OLD
 * all-locales-static behaviour in prose, and assertions about the code must
 * read the code rather than the commentary describing what it replaced.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readDashboardCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

/*
 * Static import specifiers that point into a Locales directory. Dynamic
 * imports use a backtick template literal and deliberately do NOT match —
 * they are the mechanism that keeps locales OUT of the entry chunk.
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

const LAZY_LOCALE_CODES: Array<string> =
  SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
    return code !== DEFAULT_DASHBOARD_LANGUAGE;
  });

describe("dashboard locale bundling contract (source-pinned)", () => {
  test("i18n.ts statically imports the fallback locale and ONLY the fallback locale", () => {
    const i18nSource: string = readDashboardCode("Utils", "i18n.ts");
    const specifiers: Array<string> = staticLocaleImportSpecifiers(i18nSource);

    expect(specifiers).toHaveLength(1);
    expect(specifiers[0]).toMatch(
      new RegExp(`\\/${DEFAULT_DASHBOARD_LANGUAGE}\\.json$`),
    );
  });

  test("no other dashboard source file statically imports a locale bundle", () => {
    const files: Array<string> = walkSourceFiles(DASHBOARD_SRC);

    // The walk found the tree (guards against the directory moving).
    expect(files.length).toBeGreaterThan(100);

    for (const file of files) {
      if (path.basename(file) === "i18n.ts") {
        continue; // Covered (and constrained to en.json) above.
      }
      const source: string = stripComments(fs.readFileSync(file, "utf8"));
      const relative: string = path.relative(DASHBOARD_SRC, file);

      expect([relative, staticLocaleImportSpecifiers(source)]).toEqual([
        relative,
        [],
      ]);
    }
  });

  test("non-English locales are reached through a template-literal dynamic import, which is what makes esbuild emit one chunk per locale", () => {
    const loaderSource: string = readDashboardCode(
      "Utils",
      "I18nLocaleLoader.ts",
    );

    expect(loaderSource).toMatch(
      /import\(\s*`[^`]*Locales\/\$\{[^}]+\}\.json`\s*\)/,
    );
  });

  test("i18n.ts wires the lazy loader as a partial-bundle backend", () => {
    const i18nSource: string = readDashboardCode("Utils", "i18n.ts");

    expect(i18nSource).toMatch(/from\s+["']\.\/I18nLocaleLoader["']/);
    expect(i18nSource).toMatch(/partialBundledLanguages:\s*true/);
    expect(i18nSource).toMatch(/type:\s*["']backend["']/);
  });

  test("the first render waits for i18next readiness so a non-English boot never paints raw keys", () => {
    const indexSource: string = readDashboardCode("Index.tsx");

    // Index.tsx consumes the readiness promise the init exposes...
    expect(indexSource).toMatch(
      /import\s*\{[^}]*\bi18nReady\b[^}]*\}\s*from\s*["']\.\/Utils\/i18n["']/,
    );

    // ...chains on it...
    expect(indexSource).toMatch(/i18nReady\s*\.\s*(?:then|catch|finally)\s*\(/);

    /*
     * ...and root.render is no longer a top-level statement: it lives inside
     * the chained callback (any top-level call would sit at column 0 under
     * prettier), so the tree cannot mount before translations are decided.
     */
    expect(indexSource).toMatch(/root\.render\(/);
    expect(indexSource).not.toMatch(/^root\.render\(/m);
    expect(indexSource.indexOf("root.render(")).toBeGreaterThan(
      indexSource.indexOf("i18nReady"),
    );
  });

  test("the language switcher loads the target locale before switching to it", () => {
    const switcherSource: string = readDashboardCode(
      "Components",
      "LanguageSwitcher",
      "LanguageSwitcher.tsx",
    );

    // The load is awaited — a fire-and-forget load would still flash keys.
    expect(switcherSource).toMatch(/await\s+i18n\.loadLanguages\(/);

    const loadIndex: number = switcherSource.indexOf("loadLanguages(");
    const changeIndex: number = switcherSource.indexOf("changeLanguage(");

    expect(loadIndex).toBeGreaterThanOrEqual(0);
    expect(changeIndex).toBeGreaterThan(loadIndex);
  });
});

describe("I18nLocaleLoader", () => {
  test("accepts exactly the supported non-English language codes", () => {
    // The supported list still has lazily-loaded members at all.
    expect(LAZY_LOCALE_CODES.length).toBeGreaterThan(0);

    for (const code of LAZY_LOCALE_CODES) {
      expect([code, isLazyLoadableLanguageCode(code)]).toEqual([code, true]);
    }

    // English ships statically; lazy-loading it would double-fetch it.
    expect(isLazyLoadableLanguageCode(DEFAULT_DASHBOARD_LANGUAGE)).toBe(false);
  });

  test("rejects unknown, legacy, and path-shaped codes before they reach the import", () => {
    const rejected: Array<string> = [
      "",
      "xx",
      // Legacy "zh" is remapped to "zh-CN" by detection BEFORE the loader.
      "zh",
      // Codes are case-sensitive, exactly as stored/served.
      "EN",
      "De",
      // Nothing file- or path-shaped may ever reach the template literal.
      "de.json",
      "../Locales/en",
      "..",
      "de/../../secrets",
    ];

    for (const code of rejected) {
      expect([code, isLazyLoadableLanguageCode(code)]).toEqual([code, false]);
    }
  });

  test("every supported non-English locale actually loads from where the template literal points", async () => {
    const enResource: LocaleResource = JSON.parse(
      fs.readFileSync(path.join(DASHBOARD_SRC, "Locales", "en.json"), "utf8"),
    ) as LocaleResource;
    const enKeys: Array<string> = Object.keys(enResource);

    for (const code of LAZY_LOCALE_CODES) {
      const resource: LocaleResource = await loadLocaleResource(code);
      const keys: Array<string> = Object.keys(resource);

      // A non-empty bundle...
      expect([code, keys.length > 0]).toEqual([code, true]);

      /*
       * ...with the same top-level shape family as English: a locale whose
       * sections share nothing with the fallback would translate nothing.
       */
      const sharedWithEnglish: Array<string> = keys.filter(
        (key: string): boolean => {
          return enKeys.includes(key);
        },
      );
      expect([code, sharedWithEnglish.length > 0]).toEqual([code, true]);
    }
  });

  test("refuses to load English or unknown codes", async () => {
    await expect(
      loadLocaleResource(DEFAULT_DASHBOARD_LANGUAGE),
    ).rejects.toThrow(DEFAULT_DASHBOARD_LANGUAGE);
    await expect(loadLocaleResource("xx")).rejects.toThrow("xx");
    await expect(loadLocaleResource("../Locales/en")).rejects.toThrow();
  });
});
