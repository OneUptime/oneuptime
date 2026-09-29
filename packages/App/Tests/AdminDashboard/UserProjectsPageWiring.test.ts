import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * The Admin Dashboard's User > Projects page is reached through five
 * independent hand-written wirings: a PageMap key, a RouteMap Route, a
 * PageRoute in App.tsx, a SideMenuItem, and the index the page reads its user
 * id with. Nothing ties them together and each fails silently:
 *
 *  - a missing RouteMap entry makes RouteUtil.populateRouteParams stringify
 *    `undefined`, so the side-menu link and the breadcrumb both point at
 *    "/undefined";
 *  - a missing PageRoute in App.tsx renders a blank page under a working link;
 *  - and the page reads its user with Navigation.getLastParamAsObjectID(1),
 *    which counts path segments BACKWARDS from the end of the URL. That
 *    argument is only correct while the route is shaped ":id/projects".
 *    Add or drop a segment and the page silently loads the literal string
 *    "projects" as a user id - a page of somebody else's data, or none.
 *
 * The locale assertions cover the other silent failure on this page: a
 * `t("pages.userProjects.x")` whose key is not in en.json renders the raw key
 * as the button's label. `npm run i18n:validate` proves the 16 locale files
 * agree with each other; nothing else proves they contain what the page asks
 * for.
 *
 * Same deferred-import + browser-stub shape as
 * App/Tests/Dashboard/SessionReplayRoutes.test.ts.
 */

type RouteMapModule =
  typeof import("../../FeatureSet/AdminDashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../FeatureSet/AdminDashboard/src/Utils/PageMap");
type RouteParamsModule =
  typeof import("../../FeatureSet/AdminDashboard/src/Utils/RouteParams");

let RouteMap: RouteMapModule["default"];
let PageMap: PageMapModule["default"];
let RouteParams: RouteParamsModule["default"];

/*
 * The declared path for a page. Reading it through a helper keeps the
 * "is it even registered?" failure separate from whatever the caller went on
 * to assert about the path.
 */
function routePath(pageKey: string): string {
  const route: { toString: () => string } | undefined = RouteMap[pageKey];

  if (!route) {
    throw new Error(`No route registered for PageMap.${pageKey}`);
  }

  return route.toString();
}

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/AdminDashboard/src",
);

/*
 * Source text, read rather than imported. App.tsx and SideMenu.tsx render
 * React elements and pull in Common/UI, and the registrations they hold are
 * invariants no runtime value exposes - asserting on the text is what makes
 * deleting one of them fail a test rather than a code review.
 *
 * Comments are stripped first so a file that explains a pattern in prose
 * cannot satisfy an assertion about the code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readSource(relativePath: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(ADMIN_DASHBOARD_SRC, relativePath), "utf8"),
  );
}

const appSource: string = readSource("App.tsx");
const sideMenuSource: string = readSource("Pages/Users/View/SideMenu.tsx");
const projectsPageSource: string = readSource("Pages/Users/View/Projects.tsx");

const englishLocale: Record<string, unknown> = JSON.parse(
  fs.readFileSync(
    nodePath.join(ADMIN_DASHBOARD_SRC, "Locales/en.json"),
    "utf8",
  ),
);

function lookUpLocaleKey(key: string): unknown {
  let node: unknown = englishLocale;

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

/* Every `t("...")` the page asks for. */
function translationKeysUsedByPage(): Array<string> {
  const keys: Set<string> = new Set<string>();
  const pattern: RegExp = /\bt\(\s*"([^"]+)"/g;

  let match: RegExpExecArray | null = pattern.exec(projectsPageSource);

  while (match) {
    keys.add(match[1]!);
    match = pattern.exec(projectsPageSource);
  }

  return [...keys];
}

/*
 * Common/UI/Config reads `window` the moment it loads, and ObjectID is pulled
 * in transitively, so the browser stub has to exist before either of them
 * does - hence the deferred imports. A static import would be hoisted above
 * the stub and throw.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  const routeMapModule: RouteMapModule = await import(
    "../../FeatureSet/AdminDashboard/src/Utils/RouteMap"
  );
  const pageMapModule: PageMapModule = await import(
    "../../FeatureSet/AdminDashboard/src/Utils/PageMap"
  );
  const routeParamsModule: RouteParamsModule = await import(
    "../../FeatureSet/AdminDashboard/src/Utils/RouteParams"
  );

  RouteMap = routeMapModule.default;
  PageMap = pageMapModule.default;
  RouteParams = routeParamsModule.default;
});

describe("User > Projects route", () => {
  test("the page has a PageMap key", () => {
    expect(PageMap.USER_PROJECTS).toBe("USER_PROJECTS");
  });

  test("the key resolves to a route", () => {
    expect(RouteMap[PageMap.USER_PROJECTS]).toBeDefined();
  });

  test("the route hangs off the user's own view rather than a sibling of it", () => {
    expect(routePath(PageMap.USER_PROJECTS)).toBe(
      `${routePath(PageMap.USER_VIEW)}/projects`,
    );
  });

  test("the route carries the user id as its model param", () => {
    /*
     * RouteUtil.populateRouteParams substitutes RouteParams.ModelID and
     * nothing else, so a route that spelled the param any other way would come
     * out of every link with a literal ":id" still in it.
     */
    expect(routePath(PageMap.USER_PROJECTS)).toContain(RouteParams.ModelID);
  });

  test("the route takes only the user id, which is all the side menu passes", () => {
    expect(routePath(PageMap.USER_PROJECTS)).not.toContain(
      RouteParams.SubModelID,
    );
  });

  test("the page reads its user from the segment the route actually puts it in", () => {
    /*
     * Navigation.getLastParamAsObjectID(n) counts BACKWARDS from the end of
     * the URL, so the argument the page passes has to equal the number of
     * path segments that follow the model id in the route. Derived from the
     * route rather than hard-coded, so changing the route's shape without
     * changing the page fails here.
     */
    const segments: Array<string> = routePath(PageMap.USER_PROJECTS).split("/");
    const segmentsAfterModelId: number =
      segments.length - 1 - segments.indexOf(RouteParams.ModelID);

    expect(projectsPageSource).toContain(
      `Navigation.getLastParamAsObjectID(${segmentsAfterModelId})`,
    );
  });
});

describe("User > Projects page registration", () => {
  test("App.tsx imports the page", () => {
    expect(appSource).toContain(
      'import UserProjects from "./Pages/Users/View/Projects"',
    );
  });

  test("App.tsx registers a route that renders it", () => {
    expect(appSource).toMatch(
      /RouteMap\[PageMap\.USER_PROJECTS\][\s\S]{0,120}element=\{<UserProjects \/>\}/,
    );
  });

  test("the user's side menu links to it", () => {
    expect(sideMenuSource).toContain("RouteMap[PageMap.USER_PROJECTS]");
  });

  test("the side-menu link carries the user id, so it does not resolve to a literal ':id'", () => {
    expect(sideMenuSource).toMatch(
      /RouteMap\[PageMap\.USER_PROJECTS\][\s\S]{0,160}modelId: props\.modelId/,
    );
  });
});

describe("User > Projects page behaviour", () => {
  test("the projects table pages over projects, not over memberships", () => {
    /*
     * The plain AdminModelAPI would list a user on three teams of one project
     * as three identical project rows. Swapping the API back is the one edit
     * that reintroduces exactly the duplicates this page exists to avoid.
     */
    expect(projectsPageSource).toContain(
      "modelAPI={AdminUserProjectsModelAPI}",
    );
  });

  test("the memberships table is a separate table on the plain API", () => {
    /*
     * A row there is a membership again, which is what makes its delete
     * mean "remove from this one team".
     */
    expect(projectsPageSource).toContain('id="user-team-memberships-table"');
    expect(projectsPageSource).toContain("modelAPI={AdminModelAPI}");
  });

  test("both tables are removable, and say which removal they mean", () => {
    expect(projectsPageSource).toContain(
      'deleteButtonText={t("pages.userProjects.removeFromProject")}',
    );
    expect(projectsPageSource).toContain(
      'deleteButtonText={t("pages.userProjects.removeFromTeam")}',
    );
  });

  test("both tables scope themselves to the user being viewed", () => {
    /*
     * Without the query, the projects table has no user to list projects for
     * and the memberships table lists every membership on the instance.
     */
    expect(
      projectsPageSource.match(/query=\{\{\s*userId: modelId,\s*\}\}/g),
    ).toHaveLength(2);
  });

  test("a write to one table refreshes the other", () => {
    /*
     * They read the same memberships. Removing a user from their last team in
     * a project has to drop the project row too, or the page shows a project
     * the user is no longer in until it is reloaded by hand.
     */
    expect(
      projectsPageSource.match(/refreshToggle=\{refreshToggle\}/g),
    ).toHaveLength(2);
    expect(
      projectsPageSource.match(/onItemDeleted=\{\(\) => \{/g),
    ).toHaveLength(2);
  });

  test("adding a user names both the project and the user, which nothing else supplies", () => {
    /*
     * A master admin sends no tenant header, so projectId is never filled in
     * on the way to the server; and the form knows nothing about whose page it
     * is on.
     */
    expect(projectsPageSource).toContain("item.userId = modelId");
    expect(projectsPageSource).toContain(
      "item.projectId = new ObjectID(projectId)",
    );
  });

  test("the team picker is single-select, because one membership is one team", () => {
    expect(projectsPageSource).toContain("isMultiSelect={false}");
  });
});

describe("User > Projects translations", () => {
  test("the page asks for translations at all", () => {
    /*
     * A guard on the extraction below: a regex that matched nothing would make
     * every assertion in this block vacuously pass.
     */
    expect(translationKeysUsedByPage().length).toBeGreaterThan(20);
  });

  test("every key the page asks for exists in en.json", () => {
    const missing: Array<string> = translationKeysUsedByPage().filter(
      (key: string) => {
        return typeof lookUpLocaleKey(key) !== "string";
      },
    );

    expect(missing).toEqual([]);
  });

  test("the side menu's Projects label exists", () => {
    expect(lookUpLocaleKey("sideMenu.projects")).toEqual(expect.any(String));
  });

  test("the breadcrumb label exists", () => {
    expect(lookUpLocaleKey("breadcrumbs.userProjects")).toEqual(
      expect.any(String),
    );
  });

  test("the pending-invitations phrase keeps its placeholder", () => {
    /*
     * The count is interpolated. A translation that drops {{pending}} renders
     * "Invitations Pending" with no number, which reads as if there were none.
     */
    expect(lookUpLocaleKey("pages.userProjects.pendingInvitations")).toContain(
      "{{pending}}",
    );
  });
});
