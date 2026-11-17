"use strict";

/**
 * The offline fixtures load the Dashboard's locales as the Dashboard ships
 * them (#8366).
 *
 * Each Dashboard locale file is 6 to 10 MB of JSON. A fixture that imported
 * the languages it draws whole (`import DE from ".../Locales/de.json"`)
 * bundled every one of them, and every page load of every test parsed them
 * all, whatever language the page was drawn in. NavigationSearch's bundle
 * was 31 MB, 20 MB of it locales; with the suites' tracing on, a test took
 * three times as long as with it off, and on a loaded machine tests ran past
 * their timeout without failing an assertion (#7338).
 *
 * The Dashboard bundles English, its fallback, and loads the reader's
 * language as a chunk of its own (src/Utils/I18nLocaleLoader.ts), and its
 * build ships each locale without what English shows anyway
 * (createRuntimeLocalesPlugin, App/FeatureSet/Dashboard/esbuild.config.js).
 * A fixture does the same with packages/E2E/SuiteHelpers: its server.js
 * hands createConfig dashboardLocalesPlugin() (FixtureLocalesBuild.js), and
 * its page imports English and loads its own language with an import() of
 * a string literal (FixtureLocales.js).
 *
 * Every fixture does so since #8645 moved the last ones; the lists of those
 * still to move are gone with them.
 *
 * This holds, for every source under packages/E2E (specs aside):
 *   - it imports no Dashboard locale but English statically;
 *   - a Dashboard locale it loads with import() is named by a string
 *     literal - a template literal would make a chunk of every language, and
 *     Tests/Ops/E2EFixtureDateLanguage reads only literals - and inside a
 *     function, a loader called for the page's language, never at the top
 *     of the module, where every page would load it;
 *   - the build script of a fixture whose modules load a Dashboard locale
 *     with import() hands createConfig dashboardLocalesPlugin().
 * And the helpers do their jobs: the plugin's options are the Dashboard's
 * own and ship a locale as the Dashboard does, localeResources hands
 * i18next English and the page's language alone, and changeToLanguage
 * loads a language once.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { ownModulesOf } = require("./Utils/JsxRouters");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const E2E_DIR = path.join(REPO_ROOT, "packages", "E2E");
const DASHBOARD_DIR = path.join(
  REPO_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
);
const LOCALES_DIR = path.join(DASHBOARD_DIR, "src", "Locales");
const HELPER = path.join(E2E_DIR, "SuiteHelpers", "FixtureLocales.js");
const BUILD_HELPER = path.join(
  E2E_DIR,
  "SuiteHelpers",
  "FixtureLocalesBuild.js",
);
const PLUGIN_CALL = "dashboardLocalesPlugin";

// A Dashboard locale file, by its language.
const DASHBOARD_LOCALE =
  /(?:^|\/)FeatureSet\/Dashboard\/src\/Locales\/([A-Za-z-]+)\.json$/;
const SOURCE_FILE = /\.(jsx?|tsx?)$/;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "test-results",
  "playwright-report",
  "build",
  "dist",
]);

function scriptKindOf(file) {
  if (file.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (file.endsWith(".ts")) {
    return ts.ScriptKind.TS;
  }

  return ts.ScriptKind.JSX;
}

function isFunction(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

/*
 * Whether an import() runs only for some pages: inside a function (a
 * loader), or under a condition (`if (language === "ru")`).
 */
function loadedOnlyForSomePages(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      isFunction(parent) ||
      ts.isIfStatement(parent) ||
      ts.isConditionalExpression(parent)
    ) {
      return true;
    }
  }

  return false;
}

/*
 * Every Dashboard locale a source imports: statically, with import() of a
 * literal (and whether that import() is inside a function), or with
 * import() of a template that names the Dashboard's Locales folder.
 */
function localeImportsOf(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file),
  );
  const found = [];

  function lineOf(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }

  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const match = DASHBOARD_LOCALE.exec(node.moduleSpecifier.text);

      if (match) {
        found.push({ kind: "static", language: match[1], line: lineOf(node) });
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1
    ) {
      const first = node.arguments[0];

      if (
        ts.isStringLiteral(first) ||
        ts.isNoSubstitutionTemplateLiteral(first)
      ) {
        const match = DASHBOARD_LOCALE.exec(first.text);

        if (match) {
          found.push({
            kind: loadedOnlyForSomePages(node) ? "dynamic" : "eager",
            language: match[1],
            line: lineOf(node),
          });
        }
      } else if (
        ts.isTemplateExpression(first) &&
        /FeatureSet\/Dashboard\/src\/Locales\/?$/.test(first.head.text)
      ) {
        found.push({ kind: "template", language: null, line: lineOf(node) });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return found;
}

function sourceFilesUnder(directory) {
  const found = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFilesUnder(full));
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !entry.name.endsWith(".spec.ts")
    ) {
      found.push(full);
    }
  }

  return found.sort();
}

function relativeToE2E(file) {
  return path.relative(E2E_DIR, file).split(path.sep).join("/");
}

/*
 * A build script's entry point: the file its createConfig call names with
 * `entryPoint: path.join(__dirname, "<segment>", ...)`, or null.
 */
function entryPointOf(file, source) {
  const match =
    /entryPoint:\s*path\.join\(\s*__dirname((?:\s*,\s*"[^"]+")+)\s*,?\s*\)/.exec(
      source,
    );

  if (!match) {
    return null;
  }

  const segments = [...match[1].matchAll(/"([^"]+)"/g)].map((segment) => {
    return segment[1];
  });

  return path.join(path.dirname(file), ...segments);
}

// Whether a source calls `name(...)` - in code, not a comment or a string.
function callsFunction(file, source, name) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file),
  );
  let calls = false;

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      calls = true;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return calls;
}

const sources = sourceFilesUnder(E2E_DIR).map((file) => {
  const source = fs.readFileSync(file, "utf8");

  return {
    file: relativeToE2E(file),
    full: file,
    source,
    locales: localeImportsOf(file, source),
  };
});

// The build scripts: every source that calls createConfig, with its entry.
const builds = sources
  .filter((entry) => {
    return callsFunction(entry.full, entry.source, "createConfig");
  })
  .map((entry) => {
    return { ...entry, entryPoint: entryPointOf(entry.full, entry.source) };
  });

function localesLoadedBy(entryPoint) {
  const loaded = [];

  for (const module of ownModulesOf(entryPoint, E2E_DIR)) {
    const entry = sources.find((source) => {
      return source.full === module;
    });

    for (const locale of entry ? entry.locales : []) {
      loaded.push({ ...locale, file: entry.file });
    }
  }

  return loaded;
}

describe("the reader of a fixture's locale imports", () => {
  test("tells a static import, a loader's import(), an eager import() and a template apart, for the Dashboard's locales alone", () => {
    expect(
      localeImportsOf(
        "Sample.js",
        [
          'import EN from "../../App/FeatureSet/Dashboard/src/Locales/en.json";',
          'import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";',
          'import SP from "../../App/FeatureSet/StatusPage/src/Locales/de.json";',
          "const LOADERS = {",
          '  fa: () => import("../../App/FeatureSet/Dashboard/src/Locales/fa.json"),',
          '  ja: function () { return import("../../App/FeatureSet/Dashboard/src/Locales/ja.json"); },',
          "};",
          'const AR = await import("../../App/FeatureSet/Dashboard/src/Locales/ar.json");',
          'if (language === "ru") { RU = await import("../../App/FeatureSet/Dashboard/src/Locales/ru.json"); }',
          'const HI = language === "hi" ? await import("../../App/FeatureSet/Dashboard/src/Locales/hi.json") : {};',
          "const load = (code) => import(`../../App/FeatureSet/Dashboard/src/Locales/${code}.json`);",
          'const other = () => import("./Locales/de.json");',
          '// import KO from "../../App/FeatureSet/Dashboard/src/Locales/ko.json";',
        ].join("\n"),
      ),
    ).toEqual([
      { kind: "static", language: "en", line: 1 },
      { kind: "static", language: "de", line: 2 },
      { kind: "dynamic", language: "fa", line: 5 },
      { kind: "dynamic", language: "ja", line: 6 },
      { kind: "eager", language: "ar", line: 8 },
      { kind: "dynamic", language: "ru", line: 9 },
      { kind: "dynamic", language: "hi", line: 10 },
      { kind: "template", language: null, line: 11 },
    ]);
  });

  test("reads a build script's entry point", () => {
    expect(
      entryPointOf(
        "/repo/packages/E2E/Suite/Fixture/server.js",
        'createConfig({ entryPoint: path.join(__dirname, "Fixture.js"), outdir });',
      ),
    ).toBe("/repo/packages/E2E/Suite/Fixture/Fixture.js");
    expect(
      entryPointOf(
        "/repo/packages/E2E/Suite/server.js",
        'createConfig({\n  entryPoint: path.join(__dirname, "Fixture", "AppFixture.js"),\n});',
      ),
    ).toBe("/repo/packages/E2E/Suite/Fixture/AppFixture.js");
    expect(entryPointOf("/repo/server.js", "createConfig({});")).toBeNull();
  });

  test("reads a call in code, never one in a comment or a string", () => {
    expect(
      callsFunction("s.js", `x({ plugins: [${PLUGIN_CALL}()] });`, PLUGIN_CALL),
    ).toBe(true);
    expect(callsFunction("s.js", `// ${PLUGIN_CALL}()`, PLUGIN_CALL)).toBe(
      false,
    );
    expect(
      callsFunction("s.js", `const a = "${PLUGIN_CALL}()";`, PLUGIN_CALL),
    ).toBe(false);
  });
});

describe("the offline fixtures' Dashboard locales", () => {
  test("are found where the suites keep them", () => {
    expect(sources.length).toBeGreaterThan(200);
    expect(builds.length).toBeGreaterThan(80);

    const navigationSearch = builds.find((build) => {
      return build.file === "NavigationSearch/server.js";
    });

    expect(navigationSearch.entryPoint).toBe(
      path.join(E2E_DIR, "NavigationSearch", "Fixture.js"),
    );
    expect(
      localesLoadedBy(navigationSearch.entryPoint).map((locale) => {
        return `${locale.kind} ${locale.language}`;
      }),
    ).toEqual(["static en", "dynamic de", "dynamic ar", "dynamic fa"]);
  });

  test("no fixture imports a language but English whole", () => {
    const whole = sources.flatMap((entry) => {
      return entry.locales
        .filter((locale) => {
          return locale.kind === "static" && locale.language !== "en";
        })
        .map((locale) => {
          return `${entry.file}:${locale.line} imports ${locale.language}.json whole: load it with an import() in a loader, as SuiteHelpers/FixtureLocales.js says`;
        });
    });

    expect(whole).toEqual([]);
  });

  test("a language is loaded by a loader named with a literal, for the page drawn in it alone", () => {
    const wrong = sources.flatMap((entry) => {
      return entry.locales
        .filter((locale) => {
          return locale.kind === "eager" || locale.kind === "template";
        })
        .map((locale) => {
          return locale.kind === "eager"
            ? `${entry.file}:${locale.line} loads ${locale.language}.json on every page: call import() inside a loader`
            : `${entry.file}:${locale.line} names the locale with a template: write each language's file as a literal`;
        });
    });

    expect(wrong).toEqual([]);
  });

  test("a fixture that loads a language with import() is built with the Dashboard's locales plugin", () => {
    const missing = builds
      .filter((build) => {
        return (
          build.entryPoint !== null &&
          fs.existsSync(build.entryPoint) &&
          localesLoadedBy(build.entryPoint).some((locale) => {
            return locale.kind === "dynamic";
          }) &&
          !callsFunction(build.full, build.source, PLUGIN_CALL)
        );
      })
      .map((build) => {
        return `${build.file}: pass ${PLUGIN_CALL}() (SuiteHelpers/FixtureLocalesBuild.js) to createConfig's additionalPlugins`;
      });

    expect(missing).toEqual([]);
  });
});

describe("the fixtures' locale helpers", () => {
  const { localeResources, changeToLanguage } = require(HELPER);
  const { DASHBOARD_LOCALES_OPTIONS, dashboardLocalesPlugin } = require(
    BUILD_HELPER,
  );
  const { RUNTIME_LOCALES_PLUGIN_NAME } = require(
    path.join(REPO_ROOT, "packages", "Common", "UI", "esbuild-locales.js"),
  );

  function countingLoaders(locales) {
    const calls = [];
    const loaders = {};

    for (const [language, locale] of Object.entries(locales)) {
      loaders[language] = async () => {
        calls.push(language);
        return { default: locale };
      };
    }

    return { calls, loaders };
  }

  test("an English page gets English alone, and calls no loader", async () => {
    const { calls, loaders } = countingLoaders({ de: { Save: "Speichern" } });

    expect(
      await localeResources({
        language: "en",
        english: { "common.save": "Save" },
        loaders,
      }),
    ).toEqual({ en: { translation: { "common.save": "Save" } } });
    expect(calls).toEqual([]);
  });

  test("a German page gets English and German, from German's loader alone, once", async () => {
    const { calls, loaders } = countingLoaders({
      de: { Save: "Speichern" },
      fa: { Save: "ذخیره" },
    });

    expect(
      await localeResources({ language: "de", english: {}, loaders }),
    ).toEqual({
      en: { translation: {} },
      de: { translation: { Save: "Speichern" } },
    });
    expect(calls).toEqual(["de"]);
  });

  test("a language the fixture does not draw, or none, reads English and loads nothing", async () => {
    const { calls, loaders } = countingLoaders({ de: {} });

    for (const language of ["fr", undefined, null, "toString", "__proto__"]) {
      expect(await localeResources({ language, loaders })).toEqual({
        en: { translation: {} },
      });
    }

    expect(calls).toEqual([]);
  });

  test("a loader that gives the locale itself, not a module, is read as well", async () => {
    expect(
      await localeResources({
        language: "ja",
        loaders: {
          ja: async () => {
            return { Save: "保存" };
          },
        },
      }),
    ).toEqual({
      en: { translation: {} },
      ja: { translation: { Save: "保存" } },
    });
  });

  test("changeToLanguage loads a language once, then switches to it", async () => {
    const { calls, loaders } = countingLoaders({ de: { Save: "Speichern" } });
    const bundles = {};
    const switched = [];
    const i18n = {
      hasResourceBundle: (language) => {
        return Boolean(bundles[language]);
      },
      addResourceBundle: (language, namespace, words) => {
        bundles[language] = { [namespace]: words };
      },
      changeLanguage: async (language) => {
        switched.push(language);
      },
    };

    await changeToLanguage(i18n, "de", loaders);
    await changeToLanguage(i18n, "en", loaders);
    await changeToLanguage(i18n, "de", loaders);

    expect(calls).toEqual(["de"]);
    expect(bundles).toEqual({ de: { translation: { Save: "Speichern" } } });
    expect(switched).toEqual(["de", "en", "de"]);
  });

  test("the plugin is built with the options the Dashboard's own build passes", () => {
    const dashboardConfig = fs.readFileSync(
      path.join(DASHBOARD_DIR, "esbuild.config.js"),
      "utf8",
    );

    expect(dashboardConfig).toContain(
      'localesDirectory: path.join(__dirname, "src", "Locales")',
    );
    expect(dashboardConfig).toContain('fallbackLanguage: "en"');
    expect(dashboardConfig).toContain(
      'sameAsEnglishFile: path.join(__dirname, "i18n", "SameAsEnglish.json")',
    );
    expect(dashboardConfig).toContain(
      'progressDirectory: path.join(__dirname, "i18n", "Progress")',
    );
    expect(dashboardConfig).not.toContain("shipsWholeLocales");

    expect(DASHBOARD_LOCALES_OPTIONS).toEqual({
      localesDirectory: LOCALES_DIR,
      fallbackLanguage: "en",
      sameAsEnglishFile: path.join(DASHBOARD_DIR, "i18n", "SameAsEnglish.json"),
      progressDirectory: path.join(DASHBOARD_DIR, "i18n", "Progress"),
    });

    for (const file of [
      DASHBOARD_LOCALES_OPTIONS.localesDirectory,
      DASHBOARD_LOCALES_OPTIONS.sameAsEnglishFile,
      DASHBOARD_LOCALES_OPTIONS.progressDirectory,
    ]) {
      expect(fs.existsSync(file)).toBe(true);
    }

    expect(dashboardLocalesPlugin().name).toBe(RUNTIME_LOCALES_PLUGIN_NAME);
  });

  test("the plugin ships English without the keys that are their own English, and German without what English shows anyway", () => {
    let onLoad = null;

    dashboardLocalesPlugin().setup({
      onLoad: (options, callback) => {
        expect(options).toEqual({ filter: /\.json$/, namespace: "file" });
        onLoad = callback;
      },
    });

    const englishFile = path.join(LOCALES_DIR, "en.json");
    const germanFile = path.join(LOCALES_DIR, "de.json");
    const english = JSON.parse(fs.readFileSync(englishFile, "utf8"));
    const german = JSON.parse(fs.readFileSync(germanFile, "utf8"));
    /*
     * A locale ships as one default export, its JSON handed to JSON.parse
     * (#8650): the module's default, run as JavaScript.
     */
    const shippedLocale = (file) => {
      const result = onLoad({ path: file });

      expect(result.loader).toBe("js");
      expect(result.contents.startsWith("export default JSON.parse(")).toBe(
        true,
      );

      // eslint-disable-next-line no-new-func
      return new Function(
        `return ${result.contents.slice("export default ".length)}`,
      )();
    };
    const shippedEnglish = shippedLocale(englishFile);
    const shippedGerman = shippedLocale(germanFile);

    // English ships a sliver of itself: no key that is its own English.
    expect(Object.keys(shippedEnglish).length).toBeLessThan(
      Object.keys(english).length / 100,
    );
    expect(
      Object.entries(shippedEnglish).filter(([key, value]) => {
        return key === value;
      }),
    ).toEqual([]);

    // German keeps its translations, not what reads as English.
    expect(shippedGerman["More monitor types"]).toBe(
      german["More monitor types"],
    );
    expect(Object.keys(shippedGerman).length).toBeLessThan(
      Object.keys(german).length,
    );

    // A JSON file outside the Locales folder is left to esbuild.
    expect(
      onLoad({ path: path.join(DASHBOARD_DIR, "i18n", "SameAsEnglish.json") }),
    ).toBeUndefined();
  });
});
