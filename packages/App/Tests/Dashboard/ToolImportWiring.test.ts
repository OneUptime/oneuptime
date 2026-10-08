/*
 * The page's API module reads the browser's config and API clients when it
 * loads. Nothing here calls anything, so they are empty stand-ins.
 */
jest.mock("Common/UI/Config", () => {
  return { __esModule: true, APP_API_URL: "", DOCS_URL: "" };
});
jest.mock("Common/UI/Utils/API/API", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return { __esModule: true, default: {} };
});

import { TOOL_IMPORT_ROUTES } from "../../FeatureSet/Dashboard/src/Components/ToolImport/ToolImportApi";
import { getToolImportSourceDefinition } from "Common/Types/ToolImport/ToolImportCatalog";
import { AllToolImportSources } from "Common/Types/ToolImport/ToolImportSource";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Project Settings > Import from another tool is one page reached four ways
 * - the Settings side menu, its URL, the breadcrumb and Cmd+K - and it talks
 * to one API that a worker finishes the work of. The App suite runs in a
 * plain Node environment with no renderer, so nothing else notices a route
 * never registered, a menu entry that 404s, a search that cannot find the
 * page by a tool's name, or a call the page makes to a path the server does
 * not serve. These read the sources, the way the other *Wiring tests do.
 */

const APP_DIR: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_DIR,
  "FeatureSet",
  "Dashboard",
  "src",
);
const COMMON_DIR: string = path.join(APP_DIR, "..", "Common");

const PAGE_ID: string = "SETTINGS_IMPORT_FROM_TOOL";
const PAGE_TITLE: string = "Import from another tool";

const WHITESPACE: RegExp = /\s+/g;
const QUOTED_KEYWORD: RegExp = /"([^"]+)"/g;
const RUN_ID: string = "run-id";

/*
 * Whitespace squashed, so a check does not depend on how a line wraps.
 * Comments are kept: route strings such as `/incidents/*` would read as one.
 */
function readCode(absolutePath: string): string {
  return fs.readFileSync(absolutePath, "utf8").replace(WHITESPACE, " ");
}

function readDashboard(relativePath: string): string {
  return readCode(path.join(DASHBOARD_SRC, ...relativePath.split("/")));
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

describe("the page is reachable", () => {
  test("it has a page id, and its path sits under Project Settings", () => {
    const routeMap: string = readDashboard("Utils/RouteMap.ts");

    expect(readDashboard("Utils/PageMap.ts")).toContain(
      `${PAGE_ID} = "${PAGE_ID}"`,
    );
    expect(
      between(routeMap, "export const SettingsRoutePath", "export const "),
    ).toContain(`[PageMap.${PAGE_ID}]: "import"`);
    expect(
      between(routeMap, `[PageMap.${PAGE_ID}]: new Route(`, "),"),
    ).toContain(
      `\`/dashboard/\${RouteParams.ProjectID}/settings/\${ SettingsRoutePath[PageMap.${PAGE_ID}] }\``,
    );
  });

  test("the settings router loads the page lazily and registers it under its route", () => {
    const routes: string = readDashboard("Routes/SettingsRoutes.tsx");

    expect(routes).toContain('import("../Pages/Settings/ImportFromTool")');
    expect(routes).toContain(
      `path={RouteUtil.getLastPathForKey(PageMap.${PAGE_ID})}`,
    );
    expect(routes).toContain(
      `pageRoute={RouteMap[PageMap.${PAGE_ID}] as Route}`,
    );
  });

  test("it has a breadcrumb", () => {
    expect(
      between(
        readDashboard("Utils/Breadcrumbs/SettingsBreadcrumbs.ts"),
        `BuildBreadcrumbLinksByTitles(PageMap.${PAGE_ID}, [`,
        "])",
      ),
    ).toContain(`"Project", "Settings", "${PAGE_TITLE}",`);
  });

  /*
   * Moving a team over is a first thing a new project does, so the page
   * sits in Basic - the section that never folds - not under Advanced.
   */
  test("the Settings side menu lists it under Basic", () => {
    const basic: string = between(
      readDashboard("Pages/Settings/SideMenu.tsx"),
      'title: "Basic"',
      'title: "Workspace"',
    );

    expect(basic).toContain(`title: "${PAGE_TITLE}"`);
    expect(basic).toContain(`RouteMap[PageMap.${PAGE_ID}] as Route`);
  });

  test("Cmd+K finds it under Project Settings > Basic, by every tool's name", () => {
    const entry: string = between(
      between(
        readDashboard("Components/CommandPalette/PageSearchIndex.ts"),
        'id: "project-settings"',
        'title: "Workspace"',
      ),
      `page: PageMap.${PAGE_ID},`,
      "},",
    );
    const keywords: Array<string> = Array.from(
      between(entry, "keywords: [", "]").matchAll(QUOTED_KEYWORD),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(entry).toContain(`title: "${PAGE_TITLE}"`);
    expect(keywords).toEqual(
      expect.arrayContaining(["import", "migrate", "move to oneuptime"]),
    );

    for (const source of AllToolImportSources) {
      expect(keywords).toContain(
        getToolImportSourceDefinition(source).title.toLowerCase(),
      );
    }
  });
});

describe("the page and the server agree", () => {
  const api: string = readCode(
    path.join(COMMON_DIR, "Server", "API", "ToolImportAPI.ts"),
  );

  function serves(method: "get" | "post", route: string): boolean {
    return api.includes(`router.${method}( "${route}",`);
  }

  test("every call the page makes is a route the import API serves, by the same method", () => {
    const toServerRoute: (route: string) => string = (
      route: string,
    ): string => {
      return route.replace(RUN_ID, ":runId");
    };

    expect(serves("get", TOOL_IMPORT_ROUTES.runs)).toBe(true);
    expect(serves("post", TOOL_IMPORT_ROUTES.read)).toBe(true);
    expect(serves("get", toServerRoute(TOOL_IMPORT_ROUTES.run(RUN_ID)))).toBe(
      true,
    );
    expect(
      serves("post", toServerRoute(TOOL_IMPORT_ROUTES.start(RUN_ID))),
    ).toBe(true);
    expect(
      serves("post", toServerRoute(TOOL_IMPORT_ROUTES.cancel(RUN_ID))),
    ).toBe(true);
    // The check itself tells a served route from one that is not.
    expect(serves("post", TOOL_IMPORT_ROUTES.runs)).toBe(false);
  });

  test("a run id is escaped into the path, never pasted", () => {
    expect(TOOL_IMPORT_ROUTES.run("a/../b")).toBe(
      "/tool-import/run/a%2F..%2Fb",
    );
  });

  test("the API is mounted, and the worker runs the import and sweeps stale ones", () => {
    const baseApi: string = readCode(
      path.join(APP_DIR, "FeatureSet", "BaseAPI", "Index.ts"),
    );
    const workers: string = readCode(
      path.join(APP_DIR, "FeatureSet", "Workers", "Index.ts"),
    );

    expect(baseApi).toContain(
      'import ToolImportAPI from "Common/Server/API/ToolImportAPI";',
    );
    expect(baseApi).toContain(
      "app.use(`/${APP_NAME.toLocaleLowerCase()}`, ToolImportAPI);",
    );
    expect(workers).toContain('import "./Jobs/ToolImport/RunToolImport";');
    expect(workers).toContain(
      'import "./Jobs/ToolImport/SweepStaleToolImports";',
    );
  });
});
