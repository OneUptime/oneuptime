import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Products menu has a Code section holding one item, Tasks. Code
 * Repositories used to be an AI item of its own; it is now a page of Tasks,
 * because every task runs in a connected repository and a repository is only
 * there so tasks have somewhere to open pull requests.
 *
 * Every piece of that fails quietly rather than loudly:
 *
 *   - a missing category key renders a raw key as the section heading,
 *   - a Tasks item without the repository route goes dark on the
 *     repositories page, so the navbar stops saying where the user is,
 *   - a layout that drops the shared side menu strands the other page,
 *   - a locale left with the old item keys carries dead strings, and one
 *     whose item title differs from its side-menu label names Tasks twice,
 *   - copy that still says "AI > Code Repositories" sends users to a menu
 *     item that no longer exists.
 *
 * The App suite runs in plain Node and cannot import dashboard components, so
 * these are source-level invariants. Whitespace is squashed so Prettier can
 * reflow without breaking them. The rendered behaviour is pinned in
 * Common/Tests/App/Dashboard/CodeProduct.test.tsx.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");
const DOCS_EN: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");

type Locale = Record<string, any>;

const readSource: (...segments: Array<string>) => string = (
  ...segments: Array<string>
): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
};

const squash: (source: string) => string = (source: string): string => {
  return source.replace(/\s+/g, " ");
};

const dense: (source: string) => string = (source: string): string => {
  return source.replace(/\s+/g, "");
};

const stripComments: (source: string) => string = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

const localeFiles: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .sort();

const locales: Record<string, Locale> = {};
for (const file of localeFiles) {
  locales[file.replace(/\.json$/, "")] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Locale;
}

describe("the Products menu catalog", () => {
  const raw: string = readSource("Utils", "NavigationItems.tsx");
  const catalog: string = squash(stripComments(raw));

  function entryAt(titleKey: string): string {
    const titleIndex: number = catalog.indexOf(`t("navbar.items.${titleKey}"`);
    expect(titleIndex).toBeGreaterThan(-1);
    const start: number = catalog.lastIndexOf("{", titleIndex);
    return catalog.slice(start, catalog.indexOf("},", titleIndex) + 1);
  }

  test("reads the Code heading from its own key, with an English default", () => {
    expect(dense(raw)).toContain('t("navbar.categories.code","Code")');
  });

  test("Tasks is the Code section's one item and stays lit on repository pages", () => {
    const tasks: string = entryAt("aiAgentsTitle");

    expect(tasks).toContain("category: codeCategory");
    expect(tasks).toContain("activeRoute: RouteMap[PageMap.AI_AGENT_TASKS]");
    expect(tasks).toContain(
      "additionalActiveRoutes: [RouteMap[PageMap.CODE_REPOSITORY] as Route]",
    );
    expect(catalog.split("category: codeCategory")).toHaveLength(2);
  });

  test("searching for repositories still finds the product that holds them", () => {
    const tasks: string = entryAt("aiAgentsTitle");

    for (const keyword of [
      "code repositories",
      "repositories",
      "github",
      "source code",
      "pull requests",
    ]) {
      expect(tasks).toContain(`"${keyword}"`);
    }
  });

  test("Code Repositories is no longer an item of its own", () => {
    expect(catalog).not.toContain("navbar.items.codeRepositoriesTitle");
    expect(catalog).not.toContain("navbar.items.codeRepositoriesDescription");
    // Reachable only through Tasks: no item lands on it or is lit by it alone.
    expect(dense(catalog)).not.toContain(
      "populateRouteParams(RouteMap[PageMap.CODE_REPOSITORY]",
    );
    expect(catalog).not.toContain(
      "activeRoute: RouteMap[PageMap.CODE_REPOSITORY]",
    );
  });

  test("the Code section sits between AI and Resources", () => {
    const lastAi: number = catalog.lastIndexOf("category: aiCategory");
    const code: number = catalog.indexOf("category: codeCategory");
    const firstResources: number = catalog.indexOf(
      "category: resourcesCategory",
    );

    expect(lastAi).toBeGreaterThan(-1);
    expect(code).toBeGreaterThan(lastAi);
    expect(firstResources).toBeGreaterThan(code);
  });

  test("the English fallbacks match en.json", () => {
    const items: Locale = locales["en"]!["navbar"]["items"];

    expect(squash(raw)).toContain(
      `"navbar.items.aiAgentsTitle", "${items["aiAgentsTitle"]}"`,
    );
    expect(squash(raw)).toContain(
      `"navbar.items.aiAgentsDescription", "${items["aiAgentsDescription"]}"`,
    );
  });
});

describe("the locale files", () => {
  test.each(localeFiles)(
    "%s names the Code section right after AI",
    (file: string) => {
      const categories: Locale =
        locales[file.replace(/\.json$/, "")]!["navbar"]["categories"];
      const keys: Array<string> = Object.keys(categories);

      expect(typeof categories["code"]).toBe("string");
      expect((categories["code"] as string).trim().length).toBeGreaterThan(0);
      expect(keys.indexOf("code")).toBe(keys.indexOf("ai") + 1);
    },
  );

  test.each(localeFiles)(
    "%s drops the merged-away item keys",
    (file: string) => {
      const items: Locale =
        locales[file.replace(/\.json$/, "")]!["navbar"]["items"];

      expect(items).not.toHaveProperty("codeRepositoriesTitle");
      expect(items).not.toHaveProperty("codeRepositoriesDescription");
    },
  );

  test.each(localeFiles)(
    "%s names Tasks the same in the Products menu and the side menu",
    (file: string) => {
      const locale: Locale = locales[file.replace(/\.json$/, "")]!;

      // The side menu label is looked up as the flat English-text key.
      expect(locale["navbar"]["items"]["aiAgentsTitle"]).toBe(locale["Tasks"]);
    },
  );

  test("every locale translates the rewritten Tasks description", () => {
    const english: string =
      locales["en"]!["navbar"]["items"]["aiAgentsDescription"];

    for (const [code, locale] of Object.entries(locales)) {
      const description: unknown =
        locale["navbar"]["items"]["aiAgentsDescription"];
      expect(typeof description).toBe("string");
      if (code !== "en") {
        expect(description).not.toBe(english);
      }
    }
  });
});

describe("both list pages render the one Code side menu", () => {
  test.each([
    ["Tasks", ["Pages", "AIAgentTasks", "Layout.tsx"]],
    ["Code Repositories", ["Pages", "CodeRepository", "Layout.tsx"]],
  ])("%s", (_name: string, file: Array<string>) => {
    const layout: string = squash(readSource(...file));

    expect(layout).toContain(
      'import CodeSideMenu from "../../Components/Code/CodeSideMenu";',
    );
    expect(layout).toContain("sideMenu={<CodeSideMenu />}");
  });

  test("the old one-item repository menu is gone", () => {
    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Pages", "CodeRepository", "SideMenu.tsx"),
      ),
    ).toBe(false);
  });

  test("the menu links to both pages", () => {
    const menu: string = squash(
      readSource("Components", "Code", "CodeSideMenu.tsx"),
    );

    expect(menu).toContain("RouteMap[PageMap.AI_AGENT_TASKS] as Route");
    expect(menu).toContain("RouteMap[PageMap.CODE_REPOSITORY] as Route");
  });
});

describe("copy that tells users where repositories are connected", () => {
  test.each([
    "TelemetryImprovementTaskTrigger.ts",
    "FixPerformanceTaskTrigger.ts",
    "FixFromIncidentTaskTrigger.ts",
  ])("%s points at Tasks > Code Repositories", (file: string) => {
    const source: string = fs.readFileSync(
      path.join(COMMON_ROOT, "Server", "Utils", "AI", "SRE", file),
      "utf8",
    );

    expect(source).toContain("Connect one under Tasks > Code Repositories.");
    expect(source).not.toContain("AI > Code Repositories");
  });

  test("the self-hosted GitHub guide walks through Tasks", () => {
    const guide: string = fs.readFileSync(
      path.join(DOCS_EN, "self-hosted", "github-integration.md"),
      "utf8",
    );

    expect(guide).toContain(
      "Navigate to **Products** > **Tasks** > **Code Repositories**",
    );
  });

  test("the GitHub App guide no longer sends users to Project Settings", () => {
    const guide: string = fs.readFileSync(
      path.join(DOCS_EN, "ai", "github-app.md"),
      "utf8",
    );

    expect(guide).not.toContain("Project Settings → Code Repositories");
    expect(guide.split("**Tasks → Code Repositories**")).toHaveLength(3);
  });
});
