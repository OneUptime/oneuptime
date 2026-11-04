"use strict";

/**
 * Every offline fixture that draws a page in another language writes its
 * dates in that language too, as the frontend it draws does.
 *
 * Each frontend hands its i18next instance to followLanguageForDates
 * (Common/UI/Utils/DateDisplayLanguage) as it starts, in its
 * src/Utils/i18n.ts, so OneUptimeDate writes month and weekday names,
 * "vor 5 Stunden" and "2 Tage, 3 Stunden" in the reader's language. Until
 * 2026-11-04, 52 of the offline fixtures under packages/E2E that load a
 * German, Persian, Japanese or other locale never did: their pages drew
 * German words beside English dates, which the product never shows, and
 * a spec could pin the English. Cloud Connect's was one (#5367's
 * follow-up).
 *
 * This holds:
 *   - the frontends whose src/Utils/i18n.ts hands its instance to
 *     followLanguageForDates are read from those files (the Public
 *     Dashboard, whose dashboard stays as it is drawn, does not);
 *   - a fixture is a file under packages/E2E that initializes i18next
 *     (`i18next.init(...)`, `i18next.use(...).init(...)`); the locales it
 *     loads are those its own modules import from those frontends'
 *     src/Locales, in a language other than English;
 *   - every fixture that loads one calls followLanguageForDates with the
 *     i18next instance it initializes, imported from
 *     Common/UI/Utils/DateDisplayLanguage - a real call, never one in a
 *     comment or a string;
 *   - every file that imports such a locale belongs to a fixture, so a
 *     locale cannot be loaded where no rule reaches it.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { importsOf, ownModulesOf } = require("./Utils/JsxRouters");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const E2E_DIR = path.join(REPO_ROOT, "packages", "E2E");
const FRONTENDS = [
  "Dashboard",
  "StatusPage",
  "Accounts",
  "AdminDashboard",
  "PublicDashboard",
];
const DATE_LANGUAGE_MODULE = "Common/UI/Utils/DateDisplayLanguage";
const FOLLOW = "followLanguageForDates";
// A frontend's locale file, by the frontend and the language.
const LOCALE_FILE =
  /(?:^|\/)FeatureSet\/([A-Za-z]+)\/src\/Locales\/([A-Za-z-]+)\.json$/;
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

function parse(file, source) {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file),
  );
}

// The name a module's default export is imported under ("i18next", "i18n").
function defaultImportOf(sourceFile, moduleName) {
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleName &&
      statement.importClause &&
      statement.importClause.name
    ) {
      return statement.importClause.name.text;
    }
  }

  return null;
}

// Whether `name` is imported, under its own name, from `moduleName`.
function importsNamed(sourceFile, moduleName, name) {
  return sourceFile.statements.some((statement) => {
    const bindings =
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleName &&
      statement.importClause &&
      statement.importClause.namedBindings;

    return (
      Boolean(bindings) &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => {
        return (
          element.name.text === name &&
          (!element.propertyName || element.propertyName.text === name)
        );
      })
    );
  });
}

// The identifier a chain of calls and property reads starts at.
function rootOf(expression) {
  let current = expression;

  while (
    ts.isCallExpression(current) ||
    ts.isPropertyAccessExpression(current)
  ) {
    current = current.expression;
  }

  return ts.isIdentifier(current) ? current.text : null;
}

/*
 * What a source does with i18next: the name it imports it under, whether
 * it initializes that instance, and whether it hands that same instance to
 * followLanguageForDates, imported from Common/UI/Utils/DateDisplayLanguage.
 */
function readI18next(file, source) {
  const sourceFile = parse(file, source);
  const instance = defaultImportOf(sourceFile, "i18next");
  let initializes = false;
  const followed = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "init" &&
        instance &&
        rootOf(node.expression) === instance
      ) {
        initializes = true;
      }

      if (ts.isIdentifier(node.expression) && node.expression.text === FOLLOW) {
        const argument = node.arguments[0];
        followed.push(
          argument && ts.isIdentifier(argument) ? argument.text : null,
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    instance,
    initializes,
    followsDates:
      Boolean(instance) &&
      followed.includes(instance) &&
      importsNamed(sourceFile, DATE_LANGUAGE_MODULE, FOLLOW),
  };
}

// The frontend and language of each locale a source imports.
function localesOf(file, source) {
  const found = [];

  for (const specifier of importsOf(file, source)) {
    const match = LOCALE_FILE.exec(specifier);

    if (match) {
      found.push({ frontend: match[1], language: match[2] });
    }
  }

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

// The frontends whose start-up hands i18next to followLanguageForDates.
function frontendsFollowingDates() {
  return FRONTENDS.filter((frontend) => {
    const file = path.join(
      REPO_ROOT,
      "packages",
      "App",
      "FeatureSet",
      frontend,
      "src",
      "Utils",
      "i18n.ts",
    );

    return (
      fs.existsSync(file) &&
      readI18next(file, fs.readFileSync(file, "utf8")).followsDates
    );
  });
}

const sources = sourceFilesUnder(E2E_DIR).map((file) => {
  const source = fs.readFileSync(file, "utf8");

  return {
    file: relativeToE2E(file),
    full: file,
    i18next: readI18next(file, source),
    locales: localesOf(file, source),
  };
});

const fixtures = sources.filter((entry) => {
  return entry.i18next.initializes;
});

describe("the reader of i18next set-ups", () => {
  function read(source) {
    return readI18next("Sample.js", source);
  }

  const IMPORTS = [
    'import i18next from "i18next";',
    'import { initReactI18next } from "react-i18next";',
    `import { ${FOLLOW} } from "${DATE_LANGUAGE_MODULE}";`,
  ].join("\n");

  test("reads a chained init, and the instance handed on", () => {
    expect(
      read(
        `${IMPORTS}\nawait i18next.use(initReactI18next).init({ lng: "de" });\n${FOLLOW}(i18next);`,
      ),
    ).toEqual({ instance: "i18next", initializes: true, followsDates: true });
    expect(read(`import i18n from "i18next";\ni18n.init({});`)).toEqual({
      instance: "i18n",
      initializes: true,
      followsDates: false,
    });
  });

  test("a call in a comment or a string, another instance, or no import is not one", () => {
    for (const body of [
      `// ${FOLLOW}(i18next);`,
      `/* ${FOLLOW}(i18next); */`,
      `const text = "${FOLLOW}(i18next)";`,
      `${FOLLOW}(otherInstance);`,
      `${FOLLOW}();`,
    ]) {
      expect({
        body,
        followsDates: read(`${IMPORTS}\ni18next.init({});\n${body}`)
          .followsDates,
      }).toEqual({ body, followsDates: false });
    }

    expect(
      read(
        `import i18next from "i18next";\ni18next.init({});\n${FOLLOW}(i18next);`,
      ).followsDates,
    ).toBe(false);
    expect(
      read(
        `import i18next from "i18next";\nimport { ${FOLLOW} } from "./Elsewhere";\ni18next.init({});\n${FOLLOW}(i18next);`,
      ).followsDates,
    ).toBe(false);
  });

  test("reads only a frontend's locale files, by frontend and language", () => {
    expect(
      localesOf(
        "Sample.js",
        [
          'import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";',
          'import zhCN from "../../../App/FeatureSet/AdminDashboard/src/Locales/zh-CN.json";',
          'import en from "../../App/FeatureSet/Dashboard/src/Locales/en.json";',
          'import data from "./Locales/de.json";',
          'import notes from "../../App/FeatureSet/Docs/Content/de/notes.json";',
        ].join("\n"),
      ),
    ).toEqual([
      { frontend: "Dashboard", language: "de" },
      { frontend: "AdminDashboard", language: "zh-CN" },
      { frontend: "Dashboard", language: "en" },
    ]);
  });
});

describe("the offline fixtures' dates", () => {
  const following = frontendsFollowingDates();

  // The locales a fixture's own modules load whose frontend follows dates.
  function datedLocalesOf(fixture) {
    const loaded = [];

    for (const module of ownModulesOf(fixture.full, E2E_DIR)) {
      const entry = sources.find((source) => {
        return source.full === module;
      });

      for (const locale of entry ? entry.locales : []) {
        if (locale.language !== "en" && following.includes(locale.frontend)) {
          loaded.push(`${locale.frontend}/${locale.language}`);
        }
      }
    }

    return [...new Set(loaded)].sort();
  }

  test("the frontends whose pages a fixture loads in another language write their dates in it", () => {
    expect(following).toEqual([
      "Dashboard",
      "StatusPage",
      "Accounts",
      "AdminDashboard",
    ]);
  });

  test("are found where the suites keep them", () => {
    const files = fixtures.map((fixture) => {
      return fixture.file;
    });

    expect(files.length).toBeGreaterThan(80);

    for (const file of [
      "CloudConnect/Fixture.js",
      "CloudSpend/Fixture/Fixture.js",
      "DashboardPlaylists/Fixture/AppFixture.js",
      "CustomFieldFiles/Fixture/Dashboard.js",
      "BulkActions/Fixture/Fixture.js",
    ]) {
      expect(files).toContain(file);
    }

    expect(
      datedLocalesOf(
        fixtures.find((fixture) => {
          return fixture.file === "CloudConnect/Fixture.js";
        }),
      ),
    ).toEqual(["Dashboard/de", "Dashboard/fa", "Dashboard/ja"]);
  });

  test("each fixture that loads another language's words writes its dates in that language", () => {
    const missing = fixtures
      .filter((fixture) => {
        return datedLocalesOf(fixture).length > 0;
      })
      .filter((fixture) => {
        return !ownModulesOf(fixture.full, E2E_DIR).some((module) => {
          const entry = sources.find((source) => {
            return source.full === module;
          });

          return Boolean(entry && entry.i18next.followsDates);
        });
      })
      .map((fixture) => {
        return `${fixture.file} loads ${datedLocalesOf(fixture).join(", ")}: call ${FOLLOW}(i18next) once i18next is set up`;
      });

    expect(missing).toEqual([]);
  });

  test("every file that loads another language's words is a fixture's own", () => {
    const reached = new Set(
      fixtures.flatMap((fixture) => {
        return ownModulesOf(fixture.full, E2E_DIR);
      }),
    );
    const stray = sources
      .filter((entry) => {
        return entry.locales.some((locale) => {
          return locale.language !== "en";
        });
      })
      .filter((entry) => {
        return !reached.has(entry.full);
      })
      .map((entry) => {
        return entry.file;
      });

    expect(stray).toEqual([]);
  });
});
