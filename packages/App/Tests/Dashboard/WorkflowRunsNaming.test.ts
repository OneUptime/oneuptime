import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Workflow runs are listed under Logs → Runs, in the Workflows menu and in a
 * workflow's own menu. The menus, breadcrumbs and pages are tested with a DOM
 * in Common/Tests/App/Dashboard (WorkflowRunsLogsMenus, WorkflowRunsPages)
 * and the docs in Tests/FeatureSet/Docs/WorkflowRunsDocs. What a renderer
 * cannot see:
 *
 *  - the words reach every other language through the Dashboard locale
 *    files, keyed by the English text, and a key that is missing silently
 *    shows English;
 *  - "Runs & Logs" was a label in code, specs and fixtures, and a copy left
 *    anywhere names a menu entry that no longer exists;
 *  - "Runs" is now a noun with a translation. Topology used the same English
 *    word as a verb ("Runs <its services>"), which would have shown the noun
 *    ("Ausführungen") in German.
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
const PACKAGES: string = path.join(REPO_ROOT, "packages");
const DASHBOARD_SRC: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const LOCALES: Array<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Every string the two Runs pages and the menus put on screen for runs.
const NEW_STRINGS: Array<string> = [
  "Logs",
  "Runs",
  "Workflow Run",
  "Workflow Runs",
  "Every run of every workflow in this project, from the last 30 days.",
  "Every run of this workflow, from the last 30 days.",
];

// Keys nothing reads any more: the old menu label and the old card lines.
const RETIRED_STRINGS: Array<string> = [
  "Runs & Logs",
  "List of logs in the last 30 days for all your workflows",
  "List of logs in the last 30 days for this workflow",
];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const SOURCE_EXTENSIONS: Array<string> = [".ts", ".tsx", ".js", ".ejs"];

const SKIPPED_DIRECTORIES: Set<string> = new Set([
  "node_modules",
  "build",
  "dist",
  ".git",
  "test-results",
  "playwright-report",
  // Locale values are checked key by key above; docs by their own suite.
  "Locales",
  "Content",
]);

type WalkFunction = (directory: string) => Array<string>;

const walk: WalkFunction = (directory: string): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...walk(entryPath));
      }
      continue;
    }

    if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
};

/*
 * Everything that draws or tests the Dashboard: its pages, the shared UI and
 * types, the docs app's code (its nav), and the end-to-end specs and the
 * offline fixtures that stand in for the server.
 */
const SWEPT_ROOTS: Array<string> = [
  path.join(PACKAGES, "App", "FeatureSet"),
  path.join(PACKAGES, "Common", "UI"),
  path.join(PACKAGES, "Common", "Types"),
  path.join(PACKAGES, "Common", "Server"),
  path.join(PACKAGES, "E2E"),
];

interface Offence {
  file: string;
  line: number;
  text: string;
}

type FindOffencesFunction = (
  files: Array<string>,
  pattern: RegExp,
) => Array<Offence>;

const findOffences: FindOffencesFunction = (
  files: Array<string>,
  pattern: RegExp,
): Array<Offence> => {
  const offences: Array<Offence> = [];

  for (const file of files) {
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((text: string, index: number) => {
        if (pattern.test(text)) {
          offences.push({
            file: path.relative(REPO_ROOT, file).split(path.sep).join("/"),
            line: index + 1,
            text: text.trim().slice(0, 160),
          });
        }
      });
  }

  return offences;
};

describe("the Dashboard's words for workflow runs, in every language", () => {
  test("the sweep reads all seventeen locale files", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      })
      .map((file: string): string => {
        return file.replace(/\.json$/, "");
      })
      .sort();

    expect(files).toEqual([...LOCALES].sort());
  });

  test("English maps each string to itself", () => {
    const english: Record<string, string> = readLocale("en");

    NEW_STRINGS.forEach((value: string) => {
      expect({ key: value, value: english[value] }).toEqual({
        key: value,
        value,
      });
    });
  });

  test.each(
    LOCALES.filter((locale: string): boolean => {
      return locale !== "en";
    }),
  )("%s translates each of them", (locale: string) => {
    const strings: Record<string, string> = readLocale(locale);

    NEW_STRINGS.forEach((value: string) => {
      const translated: string | undefined = strings[value];

      expect({ key: value, present: typeof translated === "string" }).toEqual({
        key: value,
        present: true,
      });
      expect(translated!.trim().length).toBeGreaterThan(0);
      // Nothing here is a loanword in any of these languages.
      expect({ key: value, translated }).not.toEqual({
        key: value,
        translated: value,
      });
    });
  });

  /*
   * The section and the one entry in it must read as two things. (Singular
   * and plural may be one word: Hindi says वर्कफ़्लो रन for both.)
   */
  test.each(LOCALES)(
    "%s tells the Logs section and its Runs entry apart",
    (locale: string) => {
      const strings: Record<string, string> = readLocale(locale);

      expect(strings["Runs"]).not.toBe(strings["Logs"]);
    },
  );

  test.each(LOCALES)(
    "%s no longer carries the retired strings",
    (locale: string) => {
      const strings: Record<string, string> = readLocale(locale);

      RETIRED_STRINGS.forEach((retired: string) => {
        expect({ key: retired, present: retired in strings }).toEqual({
          key: retired,
          present: false,
        });
      });
    },
  );
});

describe("nothing names the old menu entry", () => {
  const files: Array<string> = SWEPT_ROOTS.flatMap(
    (root: string): Array<string> => {
      return walk(root);
    },
  );

  test("the sweep covers the menus, the docs nav and the end-to-end specs", () => {
    const relative: Array<string> = files.map((file: string): string => {
      return path.relative(PACKAGES, file).split(path.sep).join("/");
    });

    expect(relative).toEqual(
      expect.arrayContaining([
        "App/FeatureSet/Dashboard/src/Pages/Workflow/SideMenu.tsx",
        "App/FeatureSet/Dashboard/src/Pages/Workflow/View/SideMenu.tsx",
        "App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/WorkflowsBreadcrumbs.ts",
        "App/FeatureSet/Docs/Utils/Nav.ts",
        "Common/UI/Components/SideMenu/SideMenu.tsx",
      ]),
    );
    expect(
      relative.some((file: string): boolean => {
        return file.startsWith("E2E/Tests/");
      }),
    ).toBe(true);
  });

  test('no source, spec or fixture says "Runs & Logs"', () => {
    expect(findOffences(files, /Runs\s*(?:&|&amp;|and)\s*Logs/)).toEqual([]);
  });

  test("the run pages no longer title themselves Workflow Logs", () => {
    const runPages: Array<string> = [
      path.join(DASHBOARD_SRC, "Pages", "Workflow", "Logs.tsx"),
      path.join(DASHBOARD_SRC, "Pages", "Workflow", "View", "Logs.tsx"),
    ];

    expect(
      findOffences(runPages, /title:\s*"Workflow Logs"|List of logs/),
    ).toEqual([]);
  });
});

/*
 * Translations are keyed by the English text, so one English word gets one
 * translation everywhere it is shown. "Runs" is the noun of the Workflows
 * menu and the run pages' cards (Ausführungen, 実行履歴). A screen that wants
 * the verb - "this host runs these services" - must say it with other words,
 * or it is shown the noun in sixteen languages.
 */
describe('"Runs" is only ever the noun', () => {
  const dashboardFiles: Array<string> = [
    ...walk(DASHBOARD_SRC),
    ...walk(path.join(PACKAGES, "Common", "UI")),
  ];

  test("no screen looks the bare word up itself", () => {
    expect(
      findOffences(
        dashboardFiles,
        /\b(?:t|tx|translateString|translate)\(\s*["'`]Runs["'`]\s*\)/,
      ),
    ).toEqual([]);
  });

  test("Topology labels a resource's services as Services", () => {
    const explorer: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "Topology",
        "InfrastructureExplorer.tsx",
      ),
      "utf8",
    );

    expect(explorer).toMatch(/\{t\("Services"\)\}\s*\{renderServiceChips\(/);
  });
});
