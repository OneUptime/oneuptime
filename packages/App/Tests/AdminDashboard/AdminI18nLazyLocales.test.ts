import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  isLazyLoadableLanguageCode,
  loadLocaleResource,
  LocaleResource,
} from "../../FeatureSet/AdminDashboard/src/Utils/I18nLocaleLoader";
import {
  SwitchableI18n,
  switchAdminDashboardLanguage,
} from "../../FeatureSet/AdminDashboard/src/Utils/AdminDashboardLanguageSwitch";
import {
  DEFAULT_ADMIN_DASHBOARD_LANGUAGE,
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES,
} from "Common/Types/AdminDashboard/AdminDashboardLanguage";

/*
 * THE ADMIN DASHBOARD LOADS THE READER'S LANGUAGE, NOT ALL EIGHTEEN (#8146).
 *
 * Utils/i18n.ts imported all eighteen locale files statically and handed
 * them all to i18next, so every page load downloaded every language's
 * words - about 4.2 MB of the entry chunk - whatever language the reader
 * reads. It loads them the way the Dashboard does now
 * (App/Tests/Dashboard/I18nLazyLocales): English, the fallback, in the entry
 * chunk; every other language a chunk of its own, behind a dynamic import
 * that i18next's lazy backend resolves when the language is needed; the
 * first render waits for it; a switch loads the new language first.
 *
 * The App suite runs in a plain Node environment, so this source-pins the
 * shape of the split with tolerant patterns, and exercises the React-free
 * loader and the switch directly. What the build ships and what the page
 * loads are proved by Common/Tests/UI/EsbuildLocales (the Admin Dashboard's
 * own build) and Common/Tests/App/AdminDashboard/AdminLazyLocalesInTheBrowser.
 */

const ADMIN_DASHBOARD_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "AdminDashboard",
);

const ADMIN_SRC: string = path.join(ADMIN_DASHBOARD_DIRECTORY, "src");

// The Enterprise Edition's admin pages, when the checkout has them.
const ENTERPRISE_ADMIN: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "ee",
  "AdminDashboard",
);

/*
 * Comments are stripped before matching: i18n.ts tells what it replaced in
 * prose, and assertions about the code read the code.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readAdminCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(ADMIN_SRC, ...relativeParts), "utf8"),
  );
}

/*
 * Static import specifiers that point into a Locales directory. A dynamic
 * import through a backtick template literal does not match: it is what
 * keeps a locale out of the entry chunk.
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
      if (entry.name !== "node_modules") {
        collected.push(...walkSourceFiles(fullPath));
      }
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      collected.push(fullPath);
    }
  }

  return collected;
}

const ADMIN_SOURCE_FILES: Array<string> = [
  ...walkSourceFiles(ADMIN_SRC),
  ...(fs.existsSync(ENTERPRISE_ADMIN) ? walkSourceFiles(ENTERPRISE_ADMIN) : []),
];

const LAZY_LOCALE_CODES: Array<string> =
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
    return code !== DEFAULT_ADMIN_DASHBOARD_LANGUAGE;
  });

describe("the Admin Dashboard's locale bundling (source-pinned)", () => {
  test("i18n.ts statically imports the fallback locale and only the fallback locale", () => {
    const specifiers: Array<string> = staticLocaleImportSpecifiers(
      readAdminCode("Utils", "i18n.ts"),
    );

    expect(specifiers).toEqual([
      `../Locales/${DEFAULT_ADMIN_DASHBOARD_LANGUAGE}.json`,
    ]);
  });

  test("no other Admin Dashboard source file statically imports a locale", () => {
    // The walk found the tree (it would pass on nothing otherwise).
    expect(ADMIN_SOURCE_FILES.length).toBeGreaterThan(100);

    for (const file of ADMIN_SOURCE_FILES) {
      if (file === path.join(ADMIN_SRC, "Utils", "i18n.ts")) {
        continue; // Held to en.json above.
      }

      const relative: string = path.relative(ADMIN_DASHBOARD_DIRECTORY, file);

      expect([
        relative,
        staticLocaleImportSpecifiers(
          stripComments(fs.readFileSync(file, "utf8")),
        ),
      ]).toEqual([relative, []]);
    }
  });

  test("every other language is reached through a template-literal dynamic import, which makes esbuild emit one chunk per locale", () => {
    expect(readAdminCode("Utils", "I18nLocaleLoader.ts")).toMatch(
      /import\(\s*`[^`]*Locales\/\$\{[^}]+\}\.json`\s*\)/,
    );
  });

  test("i18n.ts wires the loader as a partial-bundle backend, and starts with English alone", () => {
    const i18nSource: string = readAdminCode("Utils", "i18n.ts");

    expect(i18nSource).toMatch(/from\s+["']\.\/I18nLocaleLoader["']/);
    expect(i18nSource).toMatch(/partialBundledLanguages:\s*true/);
    expect(i18nSource).toMatch(/type:\s*["']backend["']/);
    expect(i18nSource).toMatch(/\.use\(\s*lazyLocaleBackend\s*\)/);
    expect(i18nSource).toMatch(
      /resources:\s*\{\s*en:\s*\{\s*translation:\s*en\s*\}\s*,?\s*\}/,
    );
  });

  /*
   * The build ships every locale without the strings English reads the
   * same (Common/UI/esbuild-locales.js). That is safe only while English is
   * the fallback and in the entry chunk, so it is in memory whatever
   * language is loaded.
   */
  test("i18n.ts falls back to the statically bundled English", () => {
    const i18nSource: string = readAdminCode("Utils", "i18n.ts");

    expect(i18nSource).toMatch(/fallbackLng:\s*DEFAULT_LANGUAGE\b/);
    expect(i18nSource).toMatch(
      /DEFAULT_LANGUAGE:\s*string\s*=\s*DEFAULT_ADMIN_DASHBOARD_LANGUAGE\b/,
    );
    expect(DEFAULT_ADMIN_DASHBOARD_LANGUAGE).toBe("en");
  });

  /*
   * The rules that set code apart in an Arabic or Persian sentence came in
   * the entry chunk while every language did. They arrive with an Arabic or
   * Persian chunk now, as on the Dashboard, so a page read from the left
   * never downloads them.
   */
  test("the rules that set code apart arrive with an Arabic or Persian locale, never in the entry chunk", () => {
    const i18nSource: string = readAdminCode("Utils", "i18n.ts");

    expect(i18nSource).toMatch(
      /Promise\.all\(\[\s*loadLocaleResource\(language\),\s*whenCodeCanBeSetApart\(language\)\s*\]\)/,
    );
    expect(i18nSource).not.toContain("setCodeApartWith");
    expect(i18nSource).not.toContain("Common/Types/CodeInSentence");
  });

  test("each language's words are set as it sets a line, against English", () => {
    expect(readAdminCode("Utils", "i18n.ts")).toMatch(
      /withNoBreakSpacesInLocale\(\{\s*locale:\s*resource,\s*language,\s*english:\s*en,?\s*\}\)/,
    );
  });

  test("the build ships src/Locales through the runtime-locales plugin, trimmed, with the same-as-English lists", () => {
    const buildConfig: string = stripComments(
      fs.readFileSync(
        path.join(ADMIN_DASHBOARD_DIRECTORY, "esbuild.config.js"),
        "utf8",
      ),
    ).replace(/\s+/g, " ");

    expect(buildConfig).toContain('require("Common/UI/esbuild-locales")');
    expect(buildConfig).toMatch(
      /additionalPlugins: \[ createRuntimeLocalesPlugin\(\{ localesDirectory: path\.join\(__dirname, "src", "Locales"\), fallbackLanguage: "en", progressDirectory: path\.join\(__dirname, "i18n", "Progress"\), \}\), \]/,
    );
    expect(buildConfig).not.toContain("shipsWholeLocales");
    // The directory the plugin is pointed at is the one the loader imports from.
    expect(fs.existsSync(path.join(ADMIN_SRC, "Locales", "en.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.join(ADMIN_DASHBOARD_DIRECTORY, "i18n", "Progress", "pt.json"),
      ),
    ).toBe(true);
  });

  test("the first render waits for i18next, so a reader's language is there from the first frame", () => {
    const indexSource: string = readAdminCode("Index.tsx");

    expect(indexSource).toMatch(
      /import\s*\{[^}]*\bi18nReady\b[^}]*\}\s*from\s*["']\.\/Utils\/i18n["']/,
    );
    expect(indexSource).toMatch(/i18nReady\s*\.\s*(?:then|catch|finally)\s*\(/);

    /*
     * root.render is no longer a top-level statement: it is inside the
     * chained callback (a top-level call would start a line under
     * prettier), so the tree cannot mount before the words are decided.
     */
    expect(indexSource).toMatch(/root\.render\(/);
    expect(indexSource).not.toMatch(/^root\.render\(/m);
    expect(indexSource.indexOf("root.render(")).toBeGreaterThan(
      indexSource.indexOf("i18nReady"),
    );
    // An initialization that failed still renders, in English.
    expect(indexSource).toMatch(/i18nReady\s*\.catch\(/);
  });

  test("the language menu loads the language before it switches, and nothing else switches", () => {
    const switchSource: string = readAdminCode(
      "Utils",
      "AdminDashboardLanguageSwitch.ts",
    );

    expect(switchSource).toMatch(/await\s+i18n\.loadLanguages\(/);
    expect(switchSource.indexOf("changeLanguage(")).toBeGreaterThan(
      switchSource.indexOf("loadLanguages("),
    );

    expect(
      readAdminCode("Components", "LanguageSwitcher", "LanguageSwitcher.tsx"),
    ).toMatch(/switchAdminDashboardLanguage\(\s*i18n\s*,/);

    expect(
      ADMIN_SOURCE_FILES.filter((file: string): boolean => {
        return stripComments(fs.readFileSync(file, "utf8")).includes(
          "changeLanguage(",
        );
      }).map((file: string): string => {
        return path.relative(ADMIN_SRC, file);
      }),
    ).toEqual([path.join("Utils", "AdminDashboardLanguageSwitch.ts")]);
  });
});

describe("the Admin Dashboard's I18nLocaleLoader", () => {
  test("accepts exactly the Admin Dashboard's languages other than English", () => {
    expect(LAZY_LOCALE_CODES.length).toBe(17);

    for (const code of LAZY_LOCALE_CODES) {
      expect([code, isLazyLoadableLanguageCode(code)]).toEqual([code, true]);
    }

    // English ships with the page; loading it again would fetch it twice.
    expect(isLazyLoadableLanguageCode(DEFAULT_ADMIN_DASHBOARD_LANGUAGE)).toBe(
      false,
    );
  });

  test("refuses unknown, legacy and path-shaped codes before they reach the import", () => {
    for (const code of [
      "",
      "xx",
      // The legacy "zh" is rewritten to "zh-CN" before detection.
      "zh",
      // Codes are case-sensitive, as stored.
      "EN",
      "De",
      "de.json",
      "../Locales/en",
      "..",
      "de/../../secrets",
      "constructor",
      "__proto__",
    ]) {
      expect([code, isLazyLoadableLanguageCode(code)]).toEqual([code, false]);
    }
  });

  test("every language loads from where the template literal points, with the words its file holds", async () => {
    const english: LocaleResource = JSON.parse(
      fs.readFileSync(path.join(ADMIN_SRC, "Locales", "en.json"), "utf8"),
    ) as LocaleResource;

    for (const code of LAZY_LOCALE_CODES) {
      const resource: LocaleResource = await loadLocaleResource(code);
      const file: LocaleResource = JSON.parse(
        fs.readFileSync(
          path.join(ADMIN_SRC, "Locales", `${code}.json`),
          "utf8",
        ),
      ) as LocaleResource;

      // The file itself (here, without the build's trimming).
      expect([code, Object.keys(resource)]).toEqual([code, Object.keys(file)]);
      // Keyed as English is: a locale that shares no key would translate nothing.
      expect([code, Object.keys(resource)]).toEqual([
        code,
        Object.keys(english),
      ]);
      // And worded in its language: German "Feedback" aside, "By Question" is not English.
      expect([code, resource["By Question"] !== "By Question"]).toEqual([
        code,
        true,
      ]);
    }
  });

  test("refuses to load English or an unknown code", async () => {
    await expect(
      loadLocaleResource(DEFAULT_ADMIN_DASHBOARD_LANGUAGE),
    ).rejects.toThrow(DEFAULT_ADMIN_DASHBOARD_LANGUAGE);
    await expect(loadLocaleResource("xx")).rejects.toThrow("xx");
    await expect(loadLocaleResource("../Locales/en")).rejects.toThrow();
  });
});

describe("switchAdminDashboardLanguage", () => {
  interface Call {
    name: string;
    language: string;
  }

  const fakeI18n: (data: { loadFails?: boolean }) => {
    i18n: SwitchableI18n;
    calls: Array<Call>;
  } = (data: {
    loadFails?: boolean;
  }): { i18n: SwitchableI18n; calls: Array<Call> } => {
    const calls: Array<Call> = [];
    const i18n: unknown = {
      loadLanguages: async (language: string): Promise<void> => {
        calls.push({ name: "loadLanguages", language });

        if (data.loadFails) {
          throw new Error("The chunk could not be fetched.");
        }
      },
      changeLanguage: async (language: string): Promise<void> => {
        calls.push({ name: "changeLanguage", language });
      },
    };

    return { i18n: i18n as SwitchableI18n, calls };
  };

  test("loads the language's words, then switches to it", async () => {
    const { i18n, calls } = fakeI18n({});

    await switchAdminDashboardLanguage(i18n, "fa");

    expect(calls).toEqual([
      { name: "loadLanguages", language: "fa" },
      { name: "changeLanguage", language: "fa" },
    ]);
  });

  test("switches even when the words cannot be fetched: English stands in for them", async () => {
    const { i18n, calls } = fakeI18n({ loadFails: true });

    await expect(switchAdminDashboardLanguage(i18n, "de")).resolves.toBe(
      undefined,
    );
    expect(
      calls.map((call: Call): string => {
        return call.name;
      }),
    ).toEqual(["loadLanguages", "changeLanguage"]);
  });
});
