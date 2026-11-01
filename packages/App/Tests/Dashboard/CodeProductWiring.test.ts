import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Tasks and Code Repositories became one product, Code: the repositories
 * first, each repository's tasks inside it, and a task's page its
 * conversation with AI. The Products menu's Code section holds that one
 * item, and the old addresses forward to the pages that took over.
 *
 * Every piece of that fails quietly rather than loudly:
 *
 *   - a missing category or item key renders a raw key as the menu's text,
 *   - an item still pointing at the old route opens a page that only
 *     forwards, and stops lighting up on Code's own pages,
 *   - a locale left with the old item keys carries dead strings, and one
 *     whose item title differs from the page's own title names Code twice,
 *   - a moved page whose old address is not mounted any more strands every
 *     bookmark, GitHub comment and email that links to it,
 *   - copy that still says "Tasks > Code Repositories" sends people to a
 *     menu item that no longer exists.
 *
 * The App suite runs in plain Node and cannot import dashboard components, so
 * these are source-level invariants. Whitespace is squashed so Prettier can
 * reflow without breaking them. The rendered behaviour is pinned in
 * Common/Tests/App/Dashboard/CodeProduct.test.tsx and the Code*.test.tsx
 * suites beside it.
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

  test("Code is the Code section's one item, and opens Code's first page", () => {
    const code: string = entryAt("codeTitle");

    expect(code).toContain('t("navbar.items.codeTitle", "Code")');
    expect(code).toContain("category: codeCategory");
    expect(dense(code)).toContain(
      "route:RouteUtil.populateRouteParams(RouteMap[PageMap.CODE]asRoute)",
    );
    expect(code).toContain("activeRoute: RouteMap[PageMap.CODE]");
    expect(catalog.split("category: codeCategory")).toHaveLength(2);
  });

  test("every page of Code lives under /code, so the item needs no other route to stay lit", () => {
    const code: string = entryAt("codeTitle");
    const routes: string = readSource("Utils", "RouteMap.ts");

    expect(code).not.toContain("additionalActiveRoutes");
    expect(routes).toContain(
      "[PageMap.CODE_ROOT]: new Route(`/dashboard/${RouteParams.ProjectID}/code/*`),",
    );
    for (const key of [
      "CODE_REPOSITORY_VIEW",
      "CODE_REPOSITORY_VIEW_SETTINGS",
      "CODE_REPOSITORY_VIEW_DELETE",
      "CODE_TASK_VIEW",
      "CODE_TASK_VIEW_LOG",
    ]) {
      expect(dense(routes)).toContain(
        `[PageMap.${key}]:newRoute(\`/dashboard/\${RouteParams.ProjectID}/code/\${CodeRoutePath[PageMap.${key}]}\`,),`,
      );
    }
  });

  test("searching for the old names, or for what Code does, still finds it", () => {
    const code: string = entryAt("codeTitle");

    for (const keyword of [
      "tasks",
      "ai tasks",
      "ask ai",
      "code repositories",
      "repositories",
      "github",
      "source code",
      "pull requests",
    ]) {
      expect(code).toContain(`"${keyword}"`);
    }
  });

  test("Tasks and Code Repositories are no longer items of their own", () => {
    expect(catalog).not.toContain("navbar.items.aiAgentsTitle");
    expect(catalog).not.toContain("navbar.items.aiAgentsDescription");
    expect(catalog).not.toContain("navbar.items.codeRepositoriesTitle");
    expect(catalog).not.toContain("navbar.items.codeRepositoriesDescription");
    expect(catalog).not.toContain("AI_AGENT_TASKS");
    expect(catalog).not.toContain("CODE_REPOSITORY]");
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
      `"navbar.items.codeTitle", "${items["codeTitle"]}"`,
    );
    expect(squash(raw)).toContain(
      `"navbar.items.codeDescription", "${items["codeDescription"]}"`,
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

      expect(items).not.toHaveProperty("aiAgentsTitle");
      expect(items).not.toHaveProperty("aiAgentsDescription");
      expect(items).not.toHaveProperty("codeRepositoriesTitle");
      expect(items).not.toHaveProperty("codeRepositoriesDescription");
    },
  );

  test.each(localeFiles)(
    "%s names Code the same in the Products menu, its section and its page",
    (file: string) => {
      const locale: Locale = locales[file.replace(/\.json$/, "")]!;

      // The page title and the side menu are looked up as the flat key.
      expect(locale["navbar"]["items"]["codeTitle"]).toBe(locale["Code"]);
      expect(locale["navbar"]["categories"]["code"]).toBe(locale["Code"]);
    },
  );

  test("every locale translates Code's description", () => {
    const english: string =
      locales["en"]!["navbar"]["items"]["codeDescription"];

    expect(english).toContain("Connect GitHub here.");

    for (const [code, locale] of Object.entries(locales)) {
      const description: unknown = locale["navbar"]["items"]["codeDescription"];
      expect(typeof description).toBe("string");
      if (code !== "en") {
        expect(description).not.toBe(english);
      }
    }
  });
});

describe("Code's pages and the old addresses", () => {
  test("Code's first page renders its side menu, and a repository its own", () => {
    const layout: string = squash(readSource("Pages", "Code", "Layout.tsx"));
    const repositoryLayout: string = squash(
      readSource("Pages", "Code", "Repository", "Layout.tsx"),
    );

    expect(layout).toContain(
      'import CodeSideMenu from "../../Components/Code/CodeSideMenu";',
    );
    expect(layout).toContain("sideMenu={<CodeSideMenu />}");
    expect(repositoryLayout).toContain(
      "sideMenu={<SideMenu modelId={modelId} />}",
    );
  });

  test("the pages of Tasks and Code Repositories are gone, not left beside Code", () => {
    for (const gone of [
      ["Pages", "AIAgentTasks"],
      ["Pages", "CodeRepository"],
      ["Components", "AIAgentTask"],
      ["Routes", "AIAgentTasksRoutes.tsx"],
      ["Routes", "CodeRepositoryRoutes.tsx"],
    ]) {
      expect({
        gone: gone.join("/"),
        exists: fs.existsSync(path.join(DASHBOARD_SRC, ...gone)),
      }).toEqual({ gone: gone.join("/"), exists: false });
    }
  });

  test("the old addresses are mounted, and only forward", () => {
    const app: string = dense(readSource("App.tsx"));
    const routes: string = readSource("Utils", "RouteMap.ts");
    const paths: string = readSource("Routes", "MovedPagePaths.ts");

    expect(app).toContain(
      'path={RouteMap[PageMap.MOVED_AI_AGENT_TASKS_ROOT]?.toString()||""}element={<MovedTaskRoutes{...commonPageProps}/>}',
    );
    expect(app).toContain(
      'path={RouteMap[PageMap.MOVED_CODE_REPOSITORY_ROOT]?.toString()||""}element={<MovedRepositoryRoutes{...commonPageProps}/>}',
    );
    expect(dense(routes)).toContain(
      "[PageMap.MOVED_AI_AGENT_TASKS_ROOT]:newRoute(`/dashboard/${RouteParams.ProjectID}/${MOVED_CODE_ROOT_PATHS.tasks}/*`,),",
    );
    expect(dense(routes)).toContain(
      "[PageMap.MOVED_CODE_REPOSITORY_ROOT]:newRoute(`/dashboard/${RouteParams.ProjectID}/${MOVED_CODE_ROOT_PATHS.repositories}/*`,),",
    );
    expect(dense(paths)).toContain('tasks:"ai/agents",');
    expect(dense(paths)).toContain('repositories:"code-repository",');
  });

  test("the old route keys are gone from PageMap, so nothing can link to them", () => {
    const pageMap: string = readSource("Utils", "PageMap.ts");

    expect(pageMap).not.toMatch(/\bAI_AGENT_TASK/);
    expect(pageMap).not.toMatch(/\bCODE_REPOSITORY\b/);
    expect(pageMap).not.toMatch(/\bCODE_REPOSITORY_ROOT\b/);
  });
});

/*
 * Code opens like Claude Code and Codex: its first page (…/code) is the
 * request box with every task under it, and the repositories are a page of
 * their own (…/code/repositories) - something to pick in the box, not the
 * landing view. Old links keep landing on the page that does their job now.
 */
describe("Code opens on the request box; the repositories are a page of their own", () => {
  test("Repositories lives at …/code/repositories, beside each repository's …/code/repositories/:id", () => {
    const routes: string = dense(readSource("Utils", "RouteMap.ts"));
    const pageMap: string = readSource("Utils", "PageMap.ts");

    expect(pageMap).toContain('CODE_REPOSITORIES = "CODE_REPOSITORIES",');
    expect(routes).toContain("[PageMap.CODE_REPOSITORIES]:`repositories`,");
    expect(routes).toContain(
      "[PageMap.CODE_REPOSITORIES]:newRoute(`/dashboard/${RouteParams.ProjectID}/code/${CodeRoutePath[PageMap.CODE_REPOSITORIES]}`,),",
    );
    expect(routes).toContain(
      "[PageMap.CODE_REPOSITORY_VIEW]:`repositories/${RouteParams.ModelID}`,",
    );
  });

  test("Code's route group mounts the request box at its root and Repositories under Code's layout", () => {
    const codeRoutes: string = dense(readSource("Routes", "CodeRoutes.tsx"));

    expect(codeRoutes).toContain(
      'importCodeRepositoriesPagefrom"../Pages/Code/Repositories";',
    );
    expect(codeRoutes).toContain(
      "<PageRouteindexelement={<CodePage{...props}pageRoute={RouteMap[PageMap.CODE]asRoute}/>}/>",
    );
    expect(codeRoutes).toContain(
      '<PageRoutepath={CodeRoutePath[PageMap.CODE_REPOSITORIES]||""}element={<CodeRepositoriesPage{...props}pageRoute={RouteMap[PageMap.CODE_REPOSITORIES]asRoute}/>}/>',
    );
    // Under Code's layout: its side menu and breadcrumbs, before a repository's own.
    expect(codeRoutes.indexOf("CodeRepositoriesPage{...props}")).toBeLessThan(
      codeRoutes.indexOf("<CodeRepositoryLayout"),
    );
  });

  test("Code's side menu: Tasks - the first page - then Repositories", () => {
    const menu: string = dense(
      stripComments(readSource("Components", "Code", "CodeSideMenu.tsx")),
    );

    const tasks: number = menu.indexOf(
      'title:"Tasks",to:RouteUtil.populateRouteParams(RouteMap[PageMap.CODE]asRoute)',
    );
    const repositories: number = menu.indexOf(
      'title:"Repositories",to:RouteUtil.populateRouteParams(RouteMap[PageMap.CODE_REPOSITORIES]asRoute,)',
    );
    expect(tasks).toBeGreaterThan(-1);
    expect(repositories).toBeGreaterThan(tasks);
  });

  test("the breadcrumb of Repositories is Project, Code, Repositories", () => {
    const crumbs: string = dense(
      readSource("Utils", "Breadcrumbs", "CodeBreadcrumbs.ts"),
    );

    expect(crumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORIES,["Project","Code","Repositories",])',
    );
  });

  /*
   * The UI review: Repositories became a page, so a trail of Project >
   * Code > Repository > Settings sent its "Repository" crumb to the list
   * (the first real page past /code) and never named the repository. A
   * repository's pages sit under Repositories in the trail, as in the
   * address.
   */
  test("a repository's pages sit under Repositories in the trail, as in their address", () => {
    const crumbs: string = dense(
      readSource("Utils", "Breadcrumbs", "CodeBreadcrumbs.ts"),
    );

    expect(crumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW,["Project","Code","Repositories","Repository",])',
    );
    expect(crumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW_SETTINGS,["Project","Code","Repositories","Repository","Settings",])',
    );
    expect(crumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW_DELETE,["Project","Code","Repositories","Repository","DeleteRepository",])',
    );
  });

  test("the old Code Repositories list forwards to Repositories; the old Tasks list to Code's first page", () => {
    const repositories: string = dense(
      stripComments(readSource("Routes", "MovedRepositoryRoutes.tsx")),
    );
    const tasks: string = dense(
      stripComments(readSource("Routes", "MovedTaskRoutes.tsx")),
    );

    expect(repositories).toContain(
      "<PageRouteindexelement={<MovedPageRedirectpageMap={PageMap.CODE_REPOSITORIES}/>}/>",
    );
    expect(tasks).toContain(
      "<PageRouteindexelement={<MovedPageRedirectpageMap={PageMap.CODE}/>}/>",
    );
    // A repository's old address still opens that repository.
    expect(repositories).toContain(
      "element={<MovedPageRedirectpageMap={PageMap.CODE_REPOSITORY_VIEW}/>}",
    );
  });

  test("GitHub comes back to Code's first page, which - like Repositories - says what came of connecting it", () => {
    const callback: string = fs.readFileSync(
      path.join(COMMON_ROOT, "Types", "Workspace", "ConnectCallback.ts"),
      "utf8",
    );
    expect(dense(callback)).toContain(
      'caseConnectProvider.GitHub:return"/code";',
    );

    for (const page of [
      ["Pages", "Code", "Code.tsx"],
      ["Pages", "Code", "Repositories.tsx"],
    ]) {
      const source: string = dense(readSource(...page));

      expect({ page: page.join("/"), connects: source }).toEqual({
        page: page.join("/"),
        connects: expect.stringContaining("useGitHubConnect({"),
      });
      expect(source).toContain("{connection.notices}");
    }
  });

  test("the first page has no title of its own - it opens on its question - and Repositories says what it lists", () => {
    const layout: string = squash(readSource("Pages", "Code", "Layout.tsx"));
    const home: string = squash(readSource("Pages", "Code", "Code.tsx"));

    expect(dense(layout)).toContain(
      "if(path===RouteUtil.getRouteString(PageMap.CODE)){return{};}",
    );
    expect(layout).toContain('title: "Repositories",');
    expect(home).toContain('translator.translateText("What should AI do?")');
    expect(home).toContain("<CodeAskBox");
    expect(dense(home)).toContain("scope={{allRepositories:true}}");
  });
});

describe("copy that tells people where repositories are connected", () => {
  test.each([
    "TelemetryImprovementTaskTrigger.ts",
    "FixPerformanceTaskTrigger.ts",
    "FixFromIncidentTaskTrigger.ts",
  ])("%s points at Code", (file: string) => {
    const source: string = fs.readFileSync(
      path.join(COMMON_ROOT, "Server", "Utils", "AI", "SRE", file),
      "utf8",
    );

    expect(source).toContain("Connect one in Code.");
    expect(source).toContain("Track its progress in Code.");
    expect(source).not.toContain("Code Repositories");
    expect(source).not.toContain("AI > Tasks");
  });

  /*
   * The switch is under More settings on the repository's Settings page
   * ("GitHub commands and runner should be inside of more settings as
   * well"), so the reply on GitHub names the fold too.
   */
  test("a switched-off GitHub command says where to switch it back on", () => {
    const source: string = fs.readFileSync(
      path.join(
        COMMON_ROOT,
        "Server",
        "Utils",
        "CodeRepository",
        "GitHub",
        "GitHubCommandAuthorizer.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      "turn them back on in OneUptime under Code → this repository → Settings → More settings.",
    );
    expect(source).not.toContain("this repository → Settings.");
    expect(source).not.toContain("Code Repositories →");
  });

  test("the self-hosted GitHub guide walks through Code", () => {
    const guide: string = fs.readFileSync(
      path.join(DOCS_EN, "self-hosted", "github-integration.md"),
      "utf8",
    );

    expect(guide).toContain("Navigate to **Products** > **Code**");
    expect(guide).not.toContain("**Tasks**");
  });

  test("the GitHub App guide sends people to Code, not to pages that are gone", () => {
    const guide: string = fs.readFileSync(
      path.join(DOCS_EN, "ai", "github-app.md"),
      "utf8",
    );

    expect(guide).not.toContain("Project Settings → Code Repositories");
    expect(guide).not.toContain("Tasks → Code Repositories");
    expect(guide).toContain("**Products → Code**");
  });
});

/*
 * A repository's pull requests, reviewed against production, have a page of
 * their own under the repository - its menu between Tasks and Settings, its
 * trail under the repository - and the Workers review the pull requests
 * that are due every minute, on the server.
 */
describe("a repository's Production Reviews", () => {
  test("lives at …/code/repositories/:id/production-reviews, under Code's one route", () => {
    const routes: string = dense(readSource("Utils", "RouteMap.ts"));
    const pageMap: string = readSource("Utils", "PageMap.ts");

    expect(pageMap).toContain(
      'CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS = "CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS",',
    );
    expect(routes).toContain(
      "[PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS]:`repositories/${RouteParams.ModelID}/production-reviews`,",
    );
    expect(routes).toContain(
      "[PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS]:newRoute(`/dashboard/${RouteParams.ProjectID}/code/${CodeRoutePath[PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS]}`,),",
    );
  });

  test("Code's route group mounts the page inside a repository's layout", () => {
    const codeRoutes: string = dense(readSource("Routes", "CodeRoutes.tsx"));

    expect(codeRoutes).toContain(
      'importCodeRepositoryProductionReviewsfrom"../Pages/Code/Repository/ProductionReviews";',
    );
    expect(codeRoutes).toContain(
      "<PageRoutepath={RouteUtil.getLastPathForKey(PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS,)}element={<CodeRepositoryProductionReviews{...props}pageRoute={RouteMap[PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS]asRoute}/>}/>",
    );
    // Inside the repository's layout: its name, menu and trail.
    expect(codeRoutes.indexOf("<CodeRepositoryLayout")).toBeLessThan(
      codeRoutes.indexOf("<CodeRepositoryProductionReviews"),
    );
  });

  test("the repository's menu lists it between Tasks and Settings", () => {
    const menu: string = dense(
      readSource("Pages", "Code", "Repository", "SideMenu.tsx"),
    );
    const tasks: number = menu.indexOf('title:"Tasks"');
    const reviews: number = menu.indexOf('title:"ProductionReviews"');
    const settings: number = menu.indexOf('title:"Settings"');

    expect(tasks).toBeGreaterThan(-1);
    expect(reviews).toBeGreaterThan(tasks);
    expect(settings).toBeGreaterThan(reviews);
    expect(menu).toContain(
      "RouteMap[PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS]asRoute",
    );
  });

  test("its trail is Project, Code, Repositories, the repository, Production Reviews", () => {
    const crumbs: string = dense(
      readSource("Utils", "Breadcrumbs", "CodeBreadcrumbs.ts"),
    );

    expect(crumbs).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS,["Project","Code","Repositories","Repository","ProductionReviews"],)',
    );
  });

  test("the Workers review the pull requests that are due, every minute", () => {
    const workers: string = fs.readFileSync(
      path.join(APP_ROOT, "FeatureSet", "Workers", "Index.ts"),
      "utf8",
    );
    const job: string = dense(
      fs.readFileSync(
        path.join(
          APP_ROOT,
          "FeatureSet",
          "Workers",
          "Jobs",
          "AIAgent",
          "ReviewPullRequestsInProduction.ts",
        ),
        "utf8",
      ),
    );

    expect(workers).toContain(
      'import "./Jobs/AIAgent/ReviewPullRequestsInProduction";',
    );
    expect(job).toContain('"AIAgent:ReviewPullRequestsInProduction"');
    expect(job).toContain("schedule:EVERY_MINUTE");
    expect(job).toContain("ProductionReviewRunner.runDueReviews()");
  });

  /*
   * GitLab, Forgejo and Gitea send OneUptime no webhooks: every minute the
   * Workers read each of their repositories with Production Review on for
   * the pull requests that changed, and ask for the reviews - which the job
   * above runs. A tick never holds the next one back.
   */
  test("the Workers find GitLab's, Forgejo's and Gitea's pull requests to review, every minute", () => {
    const workers: string = fs.readFileSync(
      path.join(APP_ROOT, "FeatureSet", "Workers", "Index.ts"),
      "utf8",
    );
    const job: string = dense(
      fs.readFileSync(
        path.join(
          APP_ROOT,
          "FeatureSet",
          "Workers",
          "Jobs",
          "AIAgent",
          "FindPullRequestsToReviewInProduction.ts",
        ),
        "utf8",
      ),
    );

    expect(workers).toContain(
      'import "./Jobs/AIAgent/FindPullRequestsToReviewInProduction";',
    );
    expect(job).toContain('"AIAgent:FindPullRequestsToReviewInProduction"');
    expect(job).toContain("schedule:EVERY_MINUTE");
    expect(job).toContain("runOnStartup:false");
    expect(job).toContain("timeoutInMS:POLL_TICK_BUDGET_MS+2*60*1000");
    expect(job).toContain("ProductionReviewPoller.pollAll()");
  });
});
