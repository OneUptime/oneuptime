import IncidentStatusPageScopeCopy from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "We don't need this information banner. Can you please remove it?"
 *
 * Under the 'Limit to these status pages' picker - on Declare Incident, an
 * incident's Settings tab, a new incident template and a template's Status
 * Page Scope card - the dashboard used to show an information banner
 * whenever the person had no status page to pick from: "No status pages to
 * pick from. If this project has status pages, you need a role that can read
 * them, such as Status Page Viewer (it can be limited to pages with certain
 * labels). Ask a project admin." Each of those pages asked the API how many
 * status pages the person could read, only to decide whether to show it.
 *
 * The banner, its text in all seventeen locales and the request behind it
 * are gone. The picker still works for someone who cannot read status pages:
 * ModelForm leaves a refused list quietly empty, and the field is optional.
 * The One Status Page per Audience guide is where the explanation lives now.
 * These rules keep the banner from coming back:
 *
 *   1. no source in the dashboards, Common's UI or ee mentions the banner,
 *      its copy key, its test id, its component or the hook that counted
 *      status pages, and the hook's file is gone;
 *   2. the shared status page scope copy has no such string, and no locale
 *      file of any frontend carries its text;
 *   3. none of the four pages counts status pages, and the two template
 *      pickers - whose only footer was the banner - have no footer at all.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");
const REPO_ROOT: string = path.join(PACKAGES, "..");
const FEATURE_SETS: string = path.join(PACKAGES, "App", "FeatureSet");
const DASHBOARD_SRC: string = path.join(FEATURE_SETS, "Dashboard", "src");

const SCAN_ROOTS: Array<string> = [
  DASHBOARD_SRC,
  path.join(FEATURE_SETS, "AdminDashboard", "src"),
  path.join(FEATURE_SETS, "StatusPage", "src"),
  path.join(FEATURE_SETS, "Accounts", "src"),
  path.join(PACKAGES, "Common", "UI"),
  path.join(REPO_ROOT, "ee", "Dashboard"),
  path.join(REPO_ROOT, "ee", "AdminDashboard"),
];

// Every locale directory i18n:validate checks (Scripts/I18n/ValidateLocales.js).
const LOCALE_DIRS: Array<string> = [
  path.join(DASHBOARD_SRC, "Locales"),
  path.join(FEATURE_SETS, "AdminDashboard", "src", "Locales"),
  path.join(FEATURE_SETS, "StatusPage", "src", "Locales"),
  path.join(FEATURE_SETS, "Accounts", "src", "Locales"),
  path.join(FEATURE_SETS, "Docs", "Locales"),
  path.join(FEATURE_SETS, "APIReference", "Locales"),
];

// What the banner and its machinery were called.
const REMOVED_NAMES: Array<string> = [
  "StatusPagePickerAccessHint",
  "useStatusPagePickerAccess",
  "StatusPagePickerAccess",
  "pickerNoAccessHint",
  "status-page-picker-no-access",
];

// The banner's English text, in pieces a light rewording would still keep.
const REMOVED_TEXT: Array<string> = [
  "No status pages to pick from",
  "you need a role that can read them, such as Status Page Viewer",
];

// The four pages with the status page picker.
const PICKER_PAGES: Array<string> = [
  "Pages/Incidents/Create.tsx",
  "Pages/Incidents/View/Settings.tsx",
  "Pages/Incidents/Settings/IncidentTemplates.tsx",
  "Pages/Incidents/Settings/IncidentTemplatesView.tsx",
];

// The two whose picker had the banner as its only footer.
const TEMPLATE_PICKER_PAGES: Array<string> = [
  "Pages/Incidents/Settings/IncidentTemplates.tsx",
  "Pages/Incidents/Settings/IncidentTemplatesView.tsx",
];

// A request counting status pages: what decided whether to show the banner.
const STATUS_PAGE_COUNT: RegExp =
  /ModelAPI\.count\b(?:<StatusPage>)?\(\s*\{\s*modelType:\s*StatusPage\b/;

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Locales",
];

interface SourceFile {
  relativePath: string;
  source: string;
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function listSourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...listSourceFiles(fullPath));
      }
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

const SOURCES: Array<SourceFile> = SCAN_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(root);
  },
).map((fullPath: string): SourceFile => {
  return {
    relativePath: toPosix(path.relative(REPO_ROOT, fullPath)),
    source: fs.readFileSync(fullPath, "utf8"),
  };
});

function readDashboardSource(relativePath: string): string {
  return fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativePath.split("/")),
    "utf8",
  );
}

function filesContaining(text: string): Array<string> {
  return SOURCES.filter((file: SourceFile): boolean => {
    return file.source.includes(text);
  }).map((file: SourceFile): string => {
    return file.relativePath;
  });
}

interface LocaleFile {
  relativePath: string;
  entries: unknown;
}

const LOCALE_FILES: Array<LocaleFile> = LOCALE_DIRS.flatMap(
  (directory: string): Array<LocaleFile> => {
    if (!fs.existsSync(directory)) {
      return [];
    }

    return fs
      .readdirSync(directory)
      .filter((name: string): boolean => {
        return name.endsWith(".json");
      })
      .map((name: string): LocaleFile => {
        const fullPath: string = path.join(directory, name);

        return {
          relativePath: toPosix(path.relative(REPO_ROOT, fullPath)),
          entries: JSON.parse(fs.readFileSync(fullPath, "utf8")) as unknown,
        };
      });
  },
);

// Every string a locale file holds, keys and values, however deeply nested.
function allStrings(node: unknown): Array<string> {
  if (typeof node === "string") {
    return [node];
  }

  if (node && typeof node === "object" && !Array.isArray(node)) {
    return Object.entries(node as Record<string, unknown>).flatMap(
      ([key, value]: [string, unknown]): Array<string> => {
        return [key, ...allStrings(value)];
      },
    );
  }

  return [];
}

/*
 * The object literal of the form field whose `field` is
 * `{ statusPages: true }`: from the brace that opens it to the one that
 * closes it. Braces inside strings and JSX are balanced in these pages.
 */
function statusPagePickerField(source: string): string {
  const marker: RegExp = /field:\s*\{\s*statusPages:\s*true,?\s*\}/;
  const match: RegExpExecArray | null = marker.exec(source);

  expect(match).not.toBeNull();

  const start: number = source.lastIndexOf("{", match!.index);
  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error("The status page picker's field never closes.");
}

describe("the status page picker's access banner stays removed", () => {
  test("the scan covers the dashboards, and the four pages with the picker", () => {
    const paths: Array<string> = SOURCES.map((file: SourceFile): string => {
      return file.relativePath;
    });

    expect(paths.length).toBeGreaterThan(500);

    for (const page of [
      ...PICKER_PAGES,
      "Components/Incident/IncidentStatusPageScopeNotices.tsx",
      "Components/Incident/IncidentStatusPageScopeCopy.ts",
    ]) {
      expect(paths).toContain(`packages/App/FeatureSet/Dashboard/src/${page}`);
    }

    expect(
      paths.some((relativePath: string): boolean => {
        return relativePath.startsWith("packages/Common/UI/");
      }),
    ).toBe(true);
  });

  test.each(REMOVED_NAMES)("no source mentions %s", (name: string) => {
    expect(filesContaining(name)).toEqual([]);
  });

  test.each(REMOVED_TEXT)("no source shows %j", (text: string) => {
    expect(filesContaining(text)).toEqual([]);
  });

  test("the hook that counted status pages for it is gone", () => {
    expect(
      fs.existsSync(
        path.join(
          DASHBOARD_SRC,
          "Components",
          "Incident",
          "useStatusPagePickerAccess.ts",
        ),
      ),
    ).toBe(false);
  });

  test("the shared copy has no access hint", () => {
    expect(Object.keys(IncidentStatusPageScopeCopy)).not.toContain(
      "pickerNoAccessHint",
    );

    for (const text of Object.values(IncidentStatusPageScopeCopy)) {
      for (const removed of REMOVED_TEXT) {
        expect(text).not.toContain(removed);
      }

      expect(text).not.toContain("Ask a project admin");
    }
  });

  test("the locale files of every frontend are read", () => {
    const paths: Array<string> = LOCALE_FILES.map(
      (file: LocaleFile): string => {
        return file.relativePath;
      },
    );

    expect(
      paths.filter((relativePath: string): boolean => {
        return relativePath.startsWith(
          "packages/App/FeatureSet/Dashboard/src/Locales/",
        );
      }),
    ).toHaveLength(17);
    expect(paths.length).toBeGreaterThan(17);
  });

  test("no locale file carries the banner's text", () => {
    const offenders: Array<string> = LOCALE_FILES.filter(
      (file: LocaleFile): boolean => {
        return allStrings(file.entries).some((value: string): boolean => {
          return REMOVED_TEXT.some((removed: string): boolean => {
            return value.includes(removed);
          });
        });
      },
    ).map((file: LocaleFile): string => {
      return file.relativePath;
    });

    expect(offenders).toEqual([]);
  });
});

describe("the pages with the picker", () => {
  test.each(PICKER_PAGES)(
    "%s still offers the picker, and never counts status pages",
    (page: string) => {
      const source: string = readDashboardSource(page);

      expect(source).toContain(
        "title: IncidentStatusPageScopeCopy.pickerTitle,",
      );
      expect(source).not.toMatch(STATUS_PAGE_COUNT);
    },
  );

  test.each(TEMPLATE_PICKER_PAGES)(
    "%s: the picker has no footer at all",
    (page: string) => {
      const field: string = statusPagePickerField(readDashboardSource(page));

      // The whole field was found: it ends with its placeholder.
      expect(field).toContain(
        "placeholder: IncidentStatusPageScopeCopy.pickerPlaceholder,",
      );
      expect(field).not.toContain("footerElement");
      expect(field).not.toContain("getFooterElement");
    },
  );

  test.each([
    "Pages/Incidents/Create.tsx",
    "Pages/Incidents/View/Settings.tsx",
  ])("%s: the picker's footer is its warnings", (page: string) => {
    const field: string = statusPagePickerField(readDashboardSource(page));

    expect(field).toContain("getFooterElement:");
    expect(field).toContain("<StatusPagesNotListingMonitorsWarning");
    expect(field).not.toContain("footerElement:");
  });
});
