import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  COMMON_ROOT,
  isCandidateModule,
  moduleIdOf,
} from "../../Scripts/NpmPackage/BuildNpmPackage";
import {
  lastJsonLine,
  runTranspileOnlyNode,
} from "../Helpers/TranspileOnlyNode";
import * as Translator from "../../Types/Translator";
import * as TranslateTemplate from "../../UI/Utils/TranslateTemplate";

/*
 * THE TRANSLATOR, AND THE STATUS PAGE'S STATE NAMES AND MESSAGES, IN THE NPM
 * PACKAGE.
 *
 * The server writes a status page subscriber's messages in the subscriber's
 * language with Types/Translator, the half of UI/Utils/TranslateTemplate that
 * needs no i18next, and Types/StatusPage words OneUptime's default state
 * names and a state change note's messages with it. npm's @oneuptime/common
 * publishes a module of Types/, Utils/ or Models/ only while its JavaScript
 * loads no UI/ or Server/ code and no package Common does not depend on
 * (Scripts/NpmPackage/BuildNpmPackage.js). When the two status page modules
 * imported their translator from UI/, the package left them out, and the
 * release's npm package job failed on it (14.0.100).
 *
 * Each module is required in a Node.js of its own, as the workers load it
 * (runTranspileOnlyNode), and every file it loaded is read back.
 */

interface Loaded {
  // Common's modules it loaded, by id: their path from Common's root.
  modules: Array<string>;
  // The packages those modules require, by name (not what the packages need).
  packages: Array<string>;
  // Files it loaded from outside Common.
  elsewhere: Array<string>;
}

interface LoadedFile {
  file: string;
  // The files it required.
  requires: Array<string>;
}

const NODE_MODULES: string = `${path.sep}node_modules${path.sep}`;

const COMMON_DEPENDENCIES: Record<string, string> = (
  JSON.parse(
    fs.readFileSync(path.join(COMMON_ROOT, "package.json"), "utf8"),
  ) as { dependencies: Record<string, string> }
).dependencies;

// The package a file under node_modules belongs to: "i18next", "@scope/name".
function packageOf(file: string): string {
  const parts: Array<string> = file
    .slice(file.lastIndexOf(NODE_MODULES) + NODE_MODULES.length)
    .split(path.sep);

  return (
    parts[0]?.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)
  ).join("/");
}

const loadedById: Map<string, Loaded> = new Map();

// What requiring a module of Common loads, besides what was loaded already.
function loadedBy(id: string): Loaded {
  const known: Loaded | undefined = loadedById.get(id);

  if (known) {
    return known;
  }

  const files: Array<LoadedFile> = lastJsonLine<{ files: Array<LoadedFile> }>(
    runTranspileOnlyNode(
      `
        const loadedBefore = new Set(Object.keys(require.cache));
        require(${JSON.stringify(path.join(COMMON_ROOT, id))});
        console.log(
          JSON.stringify({
            files: Object.keys(require.cache)
              .filter((file) => {
                return !loadedBefore.has(file);
              })
              .map((file) => {
                return {
                  file,
                  requires: require.cache[file].children.map((child) => {
                    return child.filename;
                  }),
                };
              }),
          }),
        );
      `,
      { cwd: COMMON_ROOT },
    ),
  ).files;
  const loaded: Loaded = { modules: [], packages: [], elsewhere: [] };

  for (const { file, requires } of files) {
    if (file.includes(NODE_MODULES)) {
      continue;
    }

    if (!file.startsWith(`${COMMON_ROOT}${path.sep}`)) {
      loaded.elsewhere.push(file);
      continue;
    }

    loaded.modules.push(moduleIdOf(path.relative(COMMON_ROOT, file)));

    for (const required of requires) {
      const name: string | null = required.includes(NODE_MODULES)
        ? packageOf(required)
        : null;

      if (name !== null && !loaded.packages.includes(name)) {
        loaded.packages.push(name);
      }
    }
  }

  loaded.modules.sort();
  loaded.packages.sort();
  loadedById.set(id, loaded);

  return loaded;
}

describe("what the server words a status page's messages with is in the npm package", () => {
  const PUBLISHED: Array<string> = [
    "Types/Translator",
    "Types/StatusPage/DefaultStatusNames",
    "Types/StatusPage/StateChangeNoteMessage",
  ];

  test.each(PUBLISHED)(
    "%s loads nothing from UI/ or Server/ when it runs, and only packages Common depends on",
    (id: string) => {
      const loaded: Loaded = loadedBy(id);

      // It was loaded, and with it the translator.
      expect(loaded.modules).toContain(id);
      expect(loaded.modules).toContain("Types/Translator");

      // What the package leaves a module out for: UI/ or Server/ code...
      expect({
        id,
        outsideTypesUtilsAndModels: loaded.modules.filter(
          (module: string): boolean => {
            return !isCandidateModule(module);
          },
        ),
        elsewhere: loaded.elsewhere,
      }).toEqual({ id, outsideTypesUtilsAndModels: [], elsewhere: [] });

      // ...or a package Common does not depend on.
      expect({
        id,
        notCommonsDependencies: loaded.packages.filter(
          (name: string): boolean => {
            return !Object.prototype.hasOwnProperty.call(
              COMMON_DEPENDENCIES,
              name,
            );
          },
        ),
      }).toEqual({ id, notCommonsDependencies: [] });
    },
  );

  test("the translator loads no i18next and nothing but Types/: a front end hands it its lookup (UI/Utils/TranslateTemplate)", () => {
    const loaded: Loaded = loadedBy("Types/Translator");

    expect(loaded.packages).not.toContain("i18next");
    expect(loaded.packages).not.toContain("react-i18next");
    /*
     * Besides Types/, only modules that load nothing but each other:
     * - the bounded cache every module evicts its oldest entry through
     *   (OldestKeyEvictionGuard): Types/DateLanguage keeps its English texts
     *   in one since #5586;
     * - the one escape for text a pattern matches as written
     *   (Utils/RegExpEscape): the Translator builds its pattern of the
     *   abbreviations a language writes before a value with it since #7772.
     * Anything else outside Types/ still fails here.
     */
    const LEAVES: Array<string> = [
      "Utils/OldestKeyCursor",
      "Utils/OldestKeyMap",
      "Utils/RegExpEscape",
    ];

    expect(
      loaded.modules.filter((module: string): boolean => {
        return !module.startsWith("Types/");
      }),
    ).toEqual(LEAVES);

    // Each of them loads nothing outside that list, and no package.
    for (const leaf of LEAVES) {
      const loadedByLeaf: Loaded = loadedBy(leaf);

      expect({
        leaf,
        modules: loadedByLeaf.modules.filter((module: string): boolean => {
          return !LEAVES.includes(module);
        }),
        packages: loadedByLeaf.packages,
      }).toEqual({ leaf, modules: [], packages: [] });
    }
  });
});

/*
 * The monitor overview's and the cron schedule's wording imported their
 * translator from UI/ too, and the API reference's schemas logged through the
 * server's logger: npm left all ten out (PINNED_LEFT_OUT) until
 * fu-platform-next pointed them at Types/Translator and dropped the log line.
 */
describe("the monitor and schedule wording, and the schemas, are in the npm package", () => {
  const PUBLISHED_SINCE: Array<string> = [
    "Utils/CronScheduleText",
    "Utils/Monitor/MonitorCheckScheduleUtil",
    "Utils/Monitor/MonitorOverviewFamily",
    "Utils/Monitor/MonitorOverviewPresentationUtil",
    "Utils/Monitor/MonitorOverviewProbeUtil",
    "Utils/Monitor/MonitorStatusHistoryUtil",
    "Utils/Monitor/MonitorUptimeSummaryUtil",
    "Utils/Schema/AnalyticsModelSchema",
    "Utils/Schema/BaseSchema",
    "Utils/Schema/ModelSchema",
  ];

  test.each(PUBLISHED_SINCE)(
    "%s loads nothing from UI/ or Server/ when it runs, no i18next, and only packages Common depends on",
    (id: string) => {
      const loaded: Loaded = loadedBy(id);

      expect(loaded.modules).toContain(id);
      expect({
        id,
        outsideTypesUtilsAndModels: loaded.modules.filter(
          (module: string): boolean => {
            return !isCandidateModule(module);
          },
        ),
        elsewhere: loaded.elsewhere,
      }).toEqual({ id, outsideTypesUtilsAndModels: [], elsewhere: [] });
      expect({ id, i18next: loaded.packages.includes("i18next") }).toEqual({
        id,
        i18next: false,
      });
      expect({
        id,
        notCommonsDependencies: loaded.packages.filter(
          (name: string): boolean => {
            return !Object.prototype.hasOwnProperty.call(
              COMMON_DEPENDENCIES,
              name,
            );
          },
        ),
      }).toEqual({ id, notCommonsDependencies: [] });
    },
    60000,
  );
});

describe("UI/Utils/TranslateTemplate", () => {
  test("hands out every one of Types/Translator's functions, the very same ones", () => {
    const names: Array<string> = Object.keys(Translator);

    expect(names).toEqual(
      expect.arrayContaining([
        "createTranslator",
        "fillTemplate",
        "getSentenceParts",
        "getTemplateAround",
        "translationKey",
      ]),
    );

    for (const name of names) {
      expect({
        name,
        same:
          (TranslateTemplate as Record<string, unknown>)[name] ===
          (Translator as Record<string, unknown>)[name],
      }).toEqual({ name, same: true });
    }
  });

  test("adds only the global i18next instance's translator and what uses it: anything else belongs in Types/Translator", () => {
    expect(
      Object.keys(TranslateTemplate)
        .filter((name: string): boolean => {
          return !(name in Translator);
        })
        .sort(),
    ).toEqual([
      "getGlobalTranslator",
      "translatePlural",
      "translateTemplate",
      "translateTemplateAround",
      "translateTerm",
      "translateText",
    ]);
  });
});
