import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  lastJsonLine,
  runTranspileOnlyNode,
} from "../../Helpers/TranspileOnlyNode";

/*
 * SERVER CODE, AND THE MODULES NPM USERS GET, TRANSLATE WITH THE PURE
 * TRANSLATOR.
 *
 * Common/Types/Translator is the translator with nothing around it: a
 * frontend hands it i18next's lookup through UI/Utils/TranslateTemplate,
 * which re-exports it beside the global i18next instance, and the server
 * hands it its own locale files (Server/Utils/ServerTranslation). Server
 * code that imported the translator from UI/Utils/TranslateTemplate loaded
 * i18next for nothing, and a module of Types/, Utils/ or Models/ that did
 * was left out of the @oneuptime/common npm package
 * (Scripts/NpmPackage/BuildNpmPackage.js) - the monitor overview's wording
 * and the cron schedule in words were, until fu-platform-next.
 *
 * So no file of the server - Common's Server/, Types/, Utils/ and Models/,
 * the App's server code (everything but its frontends, which have a
 * package.json of their own) and ee/Server - imports UI/Utils/TranslateTemplate.
 * A frontend's file imports it as before.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const COMMON_SCOPES: Array<string> = [
  "packages/Common/Server",
  "packages/Common/Types",
  "packages/Common/Utils",
  "packages/Common/Models",
];

const APP_ROOT: string = path.join(REPOSITORY_ROOT, "packages", "App");

// The App's server code: its entry and the folders no frontend lives in.
function appServerScopes(): Array<string> {
  const featureSets: string = path.join(APP_ROOT, "FeatureSet");
  const servers: Array<string> = fs
    .readdirSync(featureSets)
    .filter((name: string): boolean => {
      const directory: string = path.join(featureSets, name);
      return (
        fs.statSync(directory).isDirectory() &&
        !fs.existsSync(path.join(directory, "package.json"))
      );
    })
    .map((name: string): string => {
      return path.posix.join("packages/App/FeatureSet", name);
    });

  return [
    "packages/App/Index.ts",
    "packages/App/Migrate.ts",
    "packages/App/API",
    "packages/App/Utils",
    "packages/App/Services",
    ...servers,
  ];
}

const SKIPPED_DIRECTORIES: Set<string> = new Set([
  "node_modules",
  "Tests",
  "build",
]);

function sourceFiles(relative: string): Array<string> {
  const absolute: string = path.join(REPOSITORY_ROOT, relative);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  if (fs.statSync(absolute).isFile()) {
    return [absolute];
  }

  const files: Array<string> = [];
  const pending: Array<string> = [absolute];

  while (pending.length > 0) {
    const directory: string = pending.pop() as string;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          pending.push(full);
        }
      } else if (TYPESCRIPT_FILE.test(entry.name)) {
        files.push(full);
      }
    }
  }

  return files.sort();
}

const TRANSLATE_TEMPLATE: string = "UI/Utils/TranslateTemplate";

const TYPESCRIPT_FILE: RegExp = /\.(ts|tsx)$/;

// The lines of a file that import (or re-export, or require) TranslateTemplate.
function translateTemplateImports(source: string): Array<string> {
  return source.split("\n").filter((line: string): boolean => {
    const trimmed: string = line.trim();
    return (
      (trimmed.startsWith("import ") ||
        trimmed.startsWith("} from ") ||
        trimmed.startsWith("export ") ||
        trimmed.includes("require(")) &&
      trimmed.includes(`${TRANSLATE_TEMPLATE}"`)
    );
  });
}

describe("server code imports the pure translator, never the frontends'", () => {
  const scopes: Array<string> = [
    ...COMMON_SCOPES,
    ...appServerScopes(),
    "ee/Server",
  ];

  test("the scopes hold the server's code", () => {
    // A few files each scope is known to hold, so an empty walk cannot pass.
    for (const file of [
      "packages/Common/Server/Utils/ServerTranslation.ts",
      "packages/Common/Utils/CronScheduleText.ts",
      "packages/App/FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers.ts",
      "packages/App/FeatureSet/Notification/Utils/EmailLanguage.ts",
    ]) {
      expect(
        scopes.some((scope: string): boolean => {
          return sourceFiles(scope).includes(path.join(REPOSITORY_ROOT, file));
        }),
      ).toBe(true);
    }
    // A frontend is not one of them.
    expect(scopes).not.toContain("packages/App/FeatureSet/Dashboard");
    expect(scopes).not.toContain("packages/App/FeatureSet/StatusPage");
  });

  test.each(
    [...COMMON_SCOPES, ...appServerScopes(), "ee/Server"].map(
      (scope: string): [string] => {
        return [scope];
      },
    ),
  )("nothing in %s imports UI/Utils/TranslateTemplate", (scope: string) => {
    const found: Array<string> = [];

    for (const file of sourceFiles(scope)) {
      for (const line of translateTemplateImports(
        fs.readFileSync(file, "utf8"),
      )) {
        found.push(`${path.relative(REPOSITORY_ROOT, file)}: ${line.trim()}`);
      }
    }

    expect(found).toEqual([]);
  });

  test("the check finds an import of it, in each form it can take (negative control)", () => {
    for (const line of [
      'import { Translator } from "../../UI/Utils/TranslateTemplate";',
      '} from "Common/UI/Utils/TranslateTemplate";',
      'export { createTranslator } from "../UI/Utils/TranslateTemplate";',
      'const { translateText } = require("../../UI/Utils/TranslateTemplate");',
    ]) {
      expect(translateTemplateImports(line)).toEqual([line]);
    }
    // A comment that names it is not an import.
    expect(
      translateTemplateImports(
        " * the frontends' Common/UI/Utils/TranslateTemplate re-exports it",
      ),
    ).toEqual([]);
  });
});

/*
 * And at run time: the server's translator and the words of a status page's
 * subscriber messages, required as the workers require them, load no
 * i18next (they did, through UI/Utils/TranslateTemplate, for nothing).
 */
describe("the server writes in a reader's language without i18next", () => {
  const COMMON_ROOT: string = path.join(REPOSITORY_ROOT, "packages", "Common");

  test.each([
    ["Server/Utils/ServerTranslation"],
    ["Server/Utils/StatusPage/SubscriberMessageText"],
  ])(
    "%s",
    (id: string) => {
      const loaded: { packages: Array<string> } = lastJsonLine<{
        packages: Array<string>;
      }>(
        runTranspileOnlyNode(
          `
            require(${JSON.stringify(path.join(COMMON_ROOT, id))});
            const marker = ${JSON.stringify(`${path.sep}node_modules${path.sep}`)};
            const packages = new Set();
            for (const file of Object.keys(require.cache)) {
              const at = file.lastIndexOf(marker);
              if (at !== -1) {
                const parts = file.slice(at + marker.length).split(${JSON.stringify(path.sep)});
                packages.add(parts[0].startsWith("@") ? parts[0] + "/" + parts[1] : parts[0]);
              }
            }
            console.log(JSON.stringify({ packages: [...packages].sort() }));
          `,
          { cwd: COMMON_ROOT },
        ),
      );

      expect(loaded.packages.length).toBeGreaterThan(0);
      expect(loaded.packages).not.toContain("i18next");
      expect(loaded.packages).not.toContain("react-i18next");
    },
    120000,
  );
});
