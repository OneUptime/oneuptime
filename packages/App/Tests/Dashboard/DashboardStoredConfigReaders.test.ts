import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4571: a dashboard did not open - "Cannot read properties of
 * undefined (reading 'length')" in DashboardCanvas - because its stored
 * config had no `components` at the top, and every reader of the config
 * trusted it to. The config is a JSON column the API, Terraform, workflows
 * and scripts write, in whatever shape they were told (the API reference
 * showed an envelope the server stores as sent).
 *
 * The fix is one reader, Common/Utils/Dashboard/StoredDashboardViewConfig,
 * which every place that takes a config out of storage goes through. Its
 * behaviour is pinned in Common/Tests/Utils/Dashboard/StoredDashboardViewConfig;
 * the board, the public dashboard and the server routes are pinned with it.
 * What no behaviour test can see is the NEXT reader someone adds that reads
 * the column on its own. So this reads the sources:
 *
 * - every file that mentions a dashboard's config is one this guard knows,
 *   with what it does with it - a new one fails here until it is routed
 *   through the reader or listed with its reason;
 * - each reader calls StoredDashboardViewConfig, and none trusts the stored
 *   value's shape itself;
 * - the canvas draws every widget inside its own error boundary, and never
 *   reads the widget list off its config directly.
 *
 * Comments are stripped and whitespace removed before matching: the files
 * explain this bug in prose that quotes the very code matched here, and
 * prettier may wrap a call anywhere.
 */

const PACKAGES_ROOT: string = path.join(__dirname, "..", "..", "..");
const REPO_ROOT: string = path.join(PACKAGES_ROOT, "..");

const SCAN_ROOTS: Array<string> = [
  path.join(PACKAGES_ROOT, "App", "FeatureSet"),
  path.join(PACKAGES_ROOT, "Common", "Server"),
  path.join(PACKAGES_ROOT, "Common", "Utils"),
  path.join(PACKAGES_ROOT, "Common", "UI"),
  path.join(PACKAGES_ROOT, "Common", "Types"),
  path.join(PACKAGES_ROOT, "Common", "Models"),
  // App Test runs without ee/ (CI removes it): scanned when it is there.
  path.join(REPO_ROOT, "ee"),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "public",
];

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const TEST_FILE: RegExp = /\.(test|spec)\.(ts|tsx)$/;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:"'`])\/\/.*$/gm;
const WHITESPACE: RegExp = /\s+/g;
const MENTION: string = "dashboardViewConfig";

type Role =
  // Takes a config out of storage (or off the wire): goes through the reader.
  | "reader"
  // Is handed a config one of the readers already read.
  | "handed-a-read-config"
  // Mentions it without reading a stored value into the board.
  | "other";

interface KnownFile {
  role: Role;
  why: string;
}

const KNOWN_FILES: Record<string, KnownFile> = {
  "App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx": {
    role: "reader",
    why: "loads the dashboard the board draws",
  },
  "App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage.tsx":
    {
      role: "reader",
      why: "loads what /view-config serves to a public dashboard's visitor",
    },
  "App/FeatureSet/Dashboard/src/Components/Metrics/AddToDashboardModal.tsx": {
    role: "reader",
    why: "reads a dashboard to append a chart to it",
  },
  "Common/Server/Services/DashboardService.ts": {
    role: "reader",
    why: "decides on create whether the config sent has any widget",
  },
  "Common/Server/API/DashboardAPI.ts": {
    role: "reader",
    why: "every public dashboard route reads the stored config",
  },
  "Common/Server/Utils/Dashboard/PublicDashboardViewConfig.ts": {
    role: "reader",
    why: "strips Data Source widgets from what anonymous visitors get",
  },
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index.tsx": {
    role: "handed-a-read-config",
    why: "draws the board DashboardView or the public page read",
  },
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsModal.tsx":
    {
      role: "handed-a-read-config",
      why: "the canvas's widget settings",
    },
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent.tsx":
    {
      role: "handed-a-read-config",
      why: "one widget's card on the canvas",
    },
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar.tsx":
    {
      role: "handed-a-read-config",
      why: "the board's toolbar, handed DashboardView's config",
    },
  "Common/Server/Utils/Dashboard/PublicDashboardResourceListPolicy.ts": {
    role: "handed-a-read-config",
    why: "handed DashboardAPI.getStoredViewConfig's located config",
  },
  "Common/Utils/Dashboard/DashboardViewConfig.ts": {
    role: "handed-a-read-config",
    why: "layout utilities over a config already read",
  },
  "Common/Models/DatabaseModels/Dashboard.ts": {
    role: "other",
    why: "the column itself",
  },
  "Common/Server/Infrastructure/Postgres/SchemaMigrations/1729682875503-MigrationName.ts":
    {
      role: "other",
      why: "the migration that created the column",
    },
  "Common/Types/DataSource/DataSourceQueryConfig.ts": {
    role: "other",
    why: "names where its queries are stored",
  },
  "App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Settings.tsx": {
    role: "other",
    why: "Duplicate copies the stored value as it is; the server's create reads it",
  },
  "App/FeatureSet/Workers/DataMigrations/RepairKubernetesDashboardClusterCpuTile.ts":
    {
      role: "other",
      why: "a data migration matching one template tile's exact stored JSON",
    },
  "Common/Utils/Dashboard/KubernetesClusterCpuTileRepair.ts": {
    role: "other",
    why: "that migration's repair, on the template's own stored shape",
  },
};

function toKey(absolutePath: string): string {
  return path.relative(PACKAGES_ROOT, absolutePath).split(path.sep).join("/");
}

function walk(directory: string, found: Array<string>): void {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        walk(path.join(directory, entry.name), found);
      }
      continue;
    }

    if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      found.push(path.join(directory, entry.name));
    }
  }
}

function filesMentioningTheConfig(): Array<string> {
  const files: Array<string> = [];

  for (const root of SCAN_ROOTS) {
    walk(root, files);
  }

  return files
    .filter((file: string): boolean => {
      return fs.readFileSync(file, "utf8").includes(MENTION);
    })
    .map(toKey)
    .sort();
}

// The code of a file with no comments and no whitespace at all.
function codeOf(key: string): string {
  return fs
    .readFileSync(path.join(PACKAGES_ROOT, key), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, "");
}

function filesWithRole(role: Role): Array<string> {
  return Object.keys(KNOWN_FILES).filter((key: string): boolean => {
    return KNOWN_FILES[key]!.role === role;
  });
}

const DASHBOARD_VIEW: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx";
const PUBLIC_DASHBOARD_PAGE: string =
  "App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage.tsx";
const ADD_TO_DASHBOARD: string =
  "App/FeatureSet/Dashboard/src/Components/Metrics/AddToDashboardModal.tsx";
const DASHBOARD_SERVICE: string = "Common/Server/Services/DashboardService.ts";
const DASHBOARD_API: string = "Common/Server/API/DashboardAPI.ts";
const PUBLIC_SANITIZER: string =
  "Common/Server/Utils/Dashboard/PublicDashboardViewConfig.ts";
const CANVAS: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index.tsx";
const WIDGET_CARD: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent.tsx";
const SETTINGS_DIALOG: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsModal.tsx";

describe("every reader of a dashboard's stored config goes through StoredDashboardViewConfig (issue #4571)", () => {
  test("every file that mentions a dashboard's config is one this guard knows", () => {
    const found: Array<string> = filesMentioningTheConfig();

    // The walk reached the files at all, so this is not vacuous.
    expect(found).toEqual(expect.arrayContaining([DASHBOARD_VIEW, CANVAS]));

    const unknown: Array<string> = found.filter((key: string): boolean => {
      return !KNOWN_FILES[key];
    });

    /*
     * A file here reads `dashboardViewConfig` and this guard does not know
     * what it does with it. If it takes the config out of storage or off the
     * wire, read it with StoredDashboardViewConfig.read (or .unwrap on the
     * server) - then add it to KNOWN_FILES with its role and why.
     */
    expect(unknown).toEqual([]);
  });

  test("every file this guard knows still mentions the config: the list has nothing stale", () => {
    const found: Set<string> = new Set(filesMentioningTheConfig());

    for (const key of Object.keys(KNOWN_FILES)) {
      expect({ key, mentioned: found.has(key) }).toEqual({
        key,
        mentioned: true,
      });
      expect(KNOWN_FILES[key]!.why.length).toBeGreaterThan(0);
    }
  });

  test("each reader calls the reader", () => {
    const expected: Record<string, Array<string>> = {
      [DASHBOARD_VIEW]: [
        "StoredDashboardViewConfig.read(dashboard.dashboardViewConfig",
      ],
      [PUBLIC_DASHBOARD_PAGE]: [
        'StoredDashboardViewConfig.read(response.data["dashboardViewConfig"]',
      ],
      [ADD_TO_DASHBOARD]: [
        "StoredDashboardViewConfig.read(fullDashboard.dashboardViewConfig",
      ],
      [DASHBOARD_SERVICE]: [
        "StoredDashboardViewConfig.read(createBy.data.dashboardViewConfig)",
      ],
      [DASHBOARD_API]: [
        "StoredDashboardViewConfig.unwrap(dashboard.dashboardViewConfig)",
        "StoredDashboardViewConfig.withComponentIds(",
      ],
      [PUBLIC_SANITIZER]: [
        "StoredDashboardViewConfig.unwrap(dashboardViewConfig)",
        "StoredDashboardViewConfig.getComponentEntries(storedConfig)",
      ],
    };

    expect(Object.keys(expected).sort()).toEqual(filesWithRole("reader").sort());

    for (const [key, calls] of Object.entries(expected)) {
      const code: string = codeOf(key);

      for (const call of calls) {
        expect({ key, call, found: code.includes(call) }).toEqual({
          key,
          call,
          found: true,
        });
      }
    }
  });

  test("no reader trusts the stored value's shape itself", () => {
    const TRUSTING: Array<string> = [
      // Deserializing the stored value and handing it to the board as is.
      "JSONFunctions.deserializeValue(dashboard.dashboardViewConfig",
      'JSONFunctions.deserializeValue(response.data["dashboardViewConfig"]',
      // Reading the widget list straight off a stored value.
      "dashboard.dashboardViewConfig.components",
      "fullDashboard.dashboardViewConfig.components",
      "createBy.data.dashboardViewConfig.components",
      'response.data["dashboardViewConfig"].components',
    ];

    for (const key of filesWithRole("reader")) {
      const code: string = codeOf(key);

      for (const pattern of TRUSTING) {
        expect({ key, pattern, found: code.includes(pattern) }).toEqual({
          key,
          pattern,
          found: false,
        });
      }
    }
  });

  test("the public routes read the stored config only through getStoredViewConfig or the sanitizer", () => {
    const code: string = codeOf(DASHBOARD_API)
      .split("PublicDashboardViewConfig.sanitize(dashboard.dashboardViewConfig)")
      .join("")
      .split("StoredDashboardViewConfig.unwrap(dashboard.dashboardViewConfig)")
      .join("");

    expect(code.includes("dashboard.dashboardViewConfig")).toBe(false);

    // And they do use it: one place reads the stored config for all of them.
    expect(
      codeOf(DASHBOARD_API).split("DashboardAPI.getStoredViewConfig(dashboard)")
        .length - 1,
    ).toBeGreaterThanOrEqual(8);
  });
});

describe("the canvas never takes the dashboard down with one widget (issue #4571)", () => {
  test("it reads its widget list only through getCanvasComponents", () => {
    const code: string = codeOf(CANVAS);

    expect(code).toContain("getCanvasComponents(props.dashboardViewConfig");
    expect(code).not.toContain("props.dashboardViewConfig.components");
  });

  test("every widget is drawn inside its own error boundary, and an unknown type is never looked up", () => {
    const code: string = codeOf(WIDGET_CARD);

    const boundary: number = code.indexOf("<ContainedErrorBoundary");
    const widget: number = code.indexOf("<Widget");
    const boundaryEnd: number = code.indexOf("</ContainedErrorBoundary>");

    expect(boundary).toBeGreaterThan(-1);
    expect(widget).toBeGreaterThan(boundary);
    expect(boundaryEnd).toBeGreaterThan(widget);

    // A widget that throws, and one of a type this version does not draw.
    expect(code).toContain("problem={DashboardWidgetProblem.Crashed}");
    expect(code).toContain("problem={DashboardWidgetProblem.UnknownType}");

    // A stored type is any string: "constructor" must not find Object's.
    expect(code).toContain(
      "isDashboardComponentType(component.componentType,)?WIDGET_BY_TYPE[component.componentType]:undefined",
    );
  });

  test("the widget's boundary starts over on an edit, a refresh and a new time range", () => {
    expect(codeOf(WIDGET_CARD)).toContain(
      "resetKeys={[component,props.refreshTick,props.dashboardStartAndEndDate,]}",
    );
  });

  test("the settings dialog keeps its settings form in a boundary of its own, and needs a widget to open", () => {
    const code: string = codeOf(SETTINGS_DIALOG);

    const boundary: number = code.indexOf("<ContainedErrorBoundary");
    const form: number = code.indexOf("<ArgumentsForm");

    expect(boundary).toBeGreaterThan(-1);
    expect(form).toBeGreaterThan(boundary);
    expect(code).toContain("if(!component){return<></>;}");
  });
});
