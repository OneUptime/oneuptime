import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  RouteAttributes,
  pageRoutesIn,
  routeMapPath,
  routesAt,
} from "../Helpers/PageRoutes";

/*
 * App Platforms is the product the apps on managed app and container
 * platforms - ECS and Fargate, Cloud Run, App Service and the rest - moved
 * to out of Cloud, which keeps cloud accounts and every resource in them.
 * A product is a dozen files that must agree: its PageMap keys and routes,
 * the route group App.tsx mounts, its pages' trails, its products-menu
 * entry, its Cmd+K area, its menus. Each piece fails silently - a page with
 * no trail, a route no group mounts, a menu that lights nothing - so this
 * reads the sources, as the other wiring suites here do, and holds every
 * piece to the rest.
 *
 * The pages are drawn for real in Common's Tests/App/Dashboard
 * (AppPlatformsSideMenus, AppPlatformsOverview, CloudResourceViewPages,
 * CloudResourceViewForwarding).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSource(relativePath: string): string {
  return fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativePath.split("/")),
    "utf8",
  );
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/*
 * Comments out, whitespace squashed, and without the breaks prettier puts
 * inside brackets, parentheses and JSX braces when a line runs long:
 * RouteMap[ PageMap.X ] is RouteMap[PageMap.X], f( a, ) is f(a), and
 * element={ <Page /> } is element={<Page />}.
 */
function readCode(relativePath: string): string {
  return stripComments(readSource(relativePath))
    .replace(/\s+/g, " ")
    .replace(/([[(]) /g, "$1")
    .replace(/,? ([\])])/g, "$1")
    .replace(/\{ </g, "{<")
    .replace(/> \}/g, ">}");
}

const PAGE_MAP: string = readSource("Utils/PageMap.ts");
/*
 * Whitespace only: RouteMap's mount paths end in `/*` inside strings, which
 * a comment stripper would read as the start of a block comment.
 */
const ROUTE_MAP: string = readSource("Utils/RouteMap.ts").replace(/\s+/g, " ");

const KEYS: Array<string> = Array.from(
  PAGE_MAP.matchAll(/^\s*(APP_PLATFORMS_[A-Z_]+)\s*=\s*"/gm),
).map((match: RegExpMatchArray): string => {
  return match[1] as string;
});

// The routed pages: every key but the mount point, whose path ends in /*.
const ROUTED_KEYS: Array<string> = KEYS.filter((key: string): boolean => {
  const start: number = ROUTE_MAP.indexOf(`[PageMap.${key}]: new Route(`);

  if (start < 0) {
    return false;
  }

  return !ROUTE_MAP.slice(start, ROUTE_MAP.indexOf("),", start)).includes(
    "/*`",
  );
});

// The titles of a page's trail, as its BuildBreadcrumbLinksByTitles spells them.
function trailOf(breadcrumbs: string, key: string): Array<string> | null {
  const match: RegExpMatchArray | null = breadcrumbs.match(
    new RegExp(
      `BuildBreadcrumbLinksByTitles\\(PageMap\\.${key}, \\[([^\\]]*)\\]`,
    ),
  );

  if (!match) {
    return null;
  }

  return Array.from((match[1] as string).matchAll(/"([^"]*)"/g)).map(
    (title: RegExpMatchArray): string => {
      return title[1] as string;
    },
  );
}

describe("the product's pages", () => {
  test("are a product of their own, under …/app-platforms", () => {
    expect(KEYS).toContain("APP_PLATFORMS_ROOT");
    expect(KEYS).toContain("APP_PLATFORMS_OVERVIEW");
    expect(ROUTED_KEYS.length).toBeGreaterThan(15);
    expect(ROUTED_KEYS).not.toContain("APP_PLATFORMS_ROOT");

    expect(ROUTE_MAP).toContain(
      "[PageMap.APP_PLATFORMS_ROOT]: new Route( `/dashboard/${RouteParams.ProjectID}/app-platforms/*`, )",
    );

    for (const key of ROUTED_KEYS) {
      const start: number = ROUTE_MAP.indexOf(`[PageMap.${key}]: new Route(`);
      const declaration: string = ROUTE_MAP.slice(
        start,
        ROUTE_MAP.indexOf("),", start),
      );

      expect({
        key,
        underProduct: declaration.includes("/app-platforms"),
      }).toEqual({
        key,
        underProduct: true,
      });
    }
  });

  test("App.tsx mounts the route group, lazily, before Cloud's", () => {
    const app: string = readCode("App.tsx");

    expect(app).toContain(
      'const AppPlatformsRoutes: LazyRoutes = lazy(() => { return import("./Routes/AppPlatformsRoutes"); });',
    );

    const routes: Array<RouteAttributes> = pageRoutesIn(
      path.join(DASHBOARD_SRC, "App.tsx"),
    );
    const mountPath: string = routeMapPath("APP_PLATFORMS_ROOT");
    const cloudPath: string = routeMapPath("CLOUD_ROOT");

    expect(routesAt(routes, mountPath)).toEqual([
      {
        path: mountPath,
        element: "<AppPlatformsRoutes {...commonPageProps} />",
      },
    ]);
    expect(routesAt(routes, cloudPath)).toEqual([
      {
        path: cloudPath,
        element: "<CloudResourceRoutes {...commonPageProps} />",
      },
    ]);

    // Each the only route at its path, so where it sits is where it mounts.
    const paths: Array<string | undefined> = routes.map(
      (route: RouteAttributes): string | undefined => {
        return route["path"];
      },
    );

    expect(paths.indexOf(cloudPath)).toBeGreaterThan(paths.indexOf(mountPath));
    expect(readCode("Routes/AllRoutes.tsx")).toContain(
      'export { default as AppPlatformsRoutes } from "./AppPlatformsRoutes";',
    );
  });

  test("every routed page is mounted by the route group", () => {
    const routes: Array<RouteAttributes> = pageRoutesIn(
      path.join(DASHBOARD_SRC, "Routes", "AppPlatformsRoutes.tsx"),
    );

    /*
     * The Overview is the group's index; every other page is mounted at its
     * key - an environment's app page by its last two segments
     * (apps/:subModelId).
     */
    const unmounted: Array<string> = ROUTED_KEYS.filter(
      (key: string): boolean => {
        return (
          key !== "APP_PLATFORMS_OVERVIEW" &&
          [
            `AppPlatformsRoutePath[PageMap.${key}] || ""`,
            `RouteUtil.getLastPathForKey(PageMap.${key})`,
            `RouteUtil.getLastPathForKey(PageMap.${key}, 2)`,
          ].every((routePath: string): boolean => {
            return routesAt(routes, routePath).length === 0;
          })
        );
      },
    );

    expect(unmounted).toEqual([]);
    expect(routes).toContainEqual({
      index: "true",
      element:
        "<AppPlatformsOverview {...props} pageRoute={RouteMap[PageMap.APP_PLATFORMS_OVERVIEW] as Route} />",
    });
  });

  test("an address the product does not have is Page Not Found, not a blank page", () => {
    // One under an environment's own menu, one for the product.
    expect(
      routesAt(
        pageRoutesIn(
          path.join(DASHBOARD_SRC, "Routes", "AppPlatformsRoutes.tsx"),
        ),
        '"*"',
      ),
    ).toEqual([
      { path: '"*"', element: expect.stringMatching(/^<PageNotFound /) },
      { path: '"*"', element: expect.stringMatching(/^<PageNotFound /) },
    ]);
  });
});

describe("the product's trails", () => {
  const breadcrumbs: string = readCode(
    "Utils/Breadcrumbs/AppPlatformsBreadcrumbs.ts",
  );

  test("every routed page has one", () => {
    const missing: Array<string> = ROUTED_KEYS.filter(
      (key: string): boolean => {
        return trailOf(breadcrumbs, key) === null;
      },
    );

    expect(missing).toEqual([]);
  });

  test("every trail starts at the project and the product", () => {
    for (const key of ROUTED_KEYS) {
      expect({ key, start: trailOf(breadcrumbs, key)!.slice(0, 2) }).toEqual({
        key,
        start: ["Project", "App Platforms"],
      });
    }
  });

  test.each([
    ["APP_PLATFORMS_OVERVIEW", ["Project", "App Platforms"]],
    [
      "APP_PLATFORMS_ENVIRONMENTS",
      ["Project", "App Platforms", "Environments"],
    ],
    [
      "APP_PLATFORMS_ENVIRONMENT_VIEW",
      ["Project", "App Platforms", "View Environment"],
    ],
    [
      "APP_PLATFORMS_ENVIRONMENT_VIEW_INSTANCES",
      ["Project", "App Platforms", "View Environment", "Instances"],
    ],
    [
      "APP_PLATFORMS_ENVIRONMENT_VIEW_DELETE",
      ["Project", "App Platforms", "View Environment", "Delete Environment"],
    ],
    ["APP_PLATFORMS_ARCHIVED", ["Project", "App Platforms", "Archived"]],
    [
      "APP_PLATFORMS_SETTINGS_OWNER_RULE_VIEW",
      ["Project", "App Platforms", "Owner Rules", "View Rule"],
    ],
  ])("%s reads %j", (key: string, titles: Array<string>) => {
    expect(trailOf(breadcrumbs, key)).toEqual(titles);
  });

  test("an environment's page is one segment under the product, as the trail's links are", () => {
    /*
     * Each crumb links to the address one segment up, so the environment
     * view is …/app-platforms/:id, not under …/environments/.
     */
    expect(ROUTE_MAP).toMatch(
      /\[PageMap\.APP_PLATFORMS_ENVIRONMENT_VIEW\]: new Route\( `\/dashboard\/\$\{RouteParams\.ProjectID\}\/app-platforms\/\$\{ ?AppPlatformsRoutePath\[PageMap\.APP_PLATFORMS_ENVIRONMENT_VIEW\] ?\}`/,
    );
  });
});

describe("finding the product", () => {
  const navigation: string = readCode("Utils/NavigationItems.tsx");

  test("the products menu opens it on its Overview, and lights it on every page under it", () => {
    const entry: string = navigation.slice(
      navigation.indexOf(
        'title: t("navbar.items.appPlatformsTitle", "App Platforms")',
      ),
      navigation.indexOf('title: t("navbar.items.serverlessTitle")'),
    );

    expect(entry).toContain(
      "route: RouteUtil.populateRouteParams(RouteMap[PageMap.APP_PLATFORMS_OVERVIEW] as Route)",
    );
    expect(entry).toContain(
      "activeRoute: RouteMap[PageMap.APP_PLATFORMS_ROOT]",
    );
    expect(entry).toContain("icon: IconProp.RocketLaunch");
    /*
     * In the Products menu's Cloud section, with Cloud before it and
     * Serverless after it: what a cloud runs for you.
     */
    expect(entry).toContain("category: cloudCategory");
    expect(navigation).toContain(
      'const cloudCategory: string = t("navbar.categories.cloud", "Cloud");',
    );
    expect(
      navigation.indexOf('title: t("navbar.items.cloudTitle")'),
    ).toBeLessThan(
      navigation.indexOf(
        'title: t("navbar.items.appPlatformsTitle", "App Platforms")',
      ),
    );

    // The platforms' names find it; "paas" is no longer Cloud's.
    for (const keyword of ["paas", "fargate", "cloud run", "app service"]) {
      expect(entry).toContain(`"${keyword}"`);
    }
  });

  test("Cloud opens on its Overview, and is found by a cloud's words and its spend's, not a platform's", () => {
    const cloud: string = navigation.slice(
      navigation.indexOf('title: t("navbar.items.cloudTitle")'),
      navigation.indexOf(
        'title: t("navbar.items.appPlatformsTitle", "App Platforms")',
      ),
    );

    expect(cloud).toContain(
      "route: RouteUtil.populateRouteParams(RouteMap[PageMap.CLOUD_OVERVIEW] as Route)",
    );
    expect(cloud).toContain("activeRoute: RouteMap[PageMap.CLOUD_ROOT]");
    // What it costs finds it too.
    for (const keyword of ["cloud costs", "cloud budgets", "rightsizing"]) {
      expect(cloud).toContain(`"${keyword}"`);
    }
    expect(cloud).toContain("category: cloudCategory");
    expect(cloud).not.toContain('"paas"');
  });

  test("Cmd+K offers its Overview and its environments", () => {
    const index: string = readCode(
      "Components/CommandPalette/PageSearchIndex.ts",
    );
    const area: string = index.slice(
      index.indexOf('id: "app-platforms"'),
      index.indexOf('id: "cloud"'),
    );

    expect(area).toContain("productPage: PageMap.APP_PLATFORMS_OVERVIEW");
    expect(area).toContain("page: PageMap.APP_PLATFORMS_OVERVIEW");
    expect(area).toContain(
      'allListPage(PageMap.APP_PLATFORMS_ENVIRONMENTS, "All Environments")',
    );
    expect(area).toContain(
      "ownerRules: PageMap.APP_PLATFORMS_SETTINGS_OWNER_RULES",
    );
  });
});

describe("old Cloud addresses still arrive", () => {
  const cloudRoutes: Array<RouteAttributes> = pageRoutesIn(
    path.join(DASHBOARD_SRC, "Routes", "CloudResourceRoutes.tsx"),
  );

  /*
   * Cloud's own address was the environments list, then its accounts
   * (#5488); since cloud-10x it is Cloud's Overview, over every account -
   * still a Cloud page, never an App Platforms one.
   */
  test("Cloud's own address, which was the environments list, opens Cloud's Overview", () => {
    expect(cloudRoutes).toContainEqual({
      index: "true",
      element:
        "<CloudOverview {...props} pageRoute={RouteMap[PageMap.CLOUD_OVERVIEW] as Route} />",
    });
    expect(
      cloudRoutes.filter((route: RouteAttributes): boolean => {
        return (
          route["index"] === "true" &&
          (route["element"] || "").startsWith("<MovedPageRedirect ")
        );
      }),
    ).toEqual([]);
  });

  test("the environments list's Developer pages forward to All Resources' own", () => {
    expect(
      routesAt(cloudRoutes, "getDeveloperDocsRelativePath(page.type)"),
    ).toEqual([
      {
        key: "`moved-${page.type}`",
        path: "getDeveloperDocsRelativePath(page.type)",
        element:
          "<MovedPageRedirect pageMap={getDeveloperDocsPageKey(PageMap.CLOUD_MONITORED_RESOURCES, page.type)} />",
      },
    ]);
  });

  test("each product's view forwards a row of the other's kind to the same tab there", () => {
    for (const layout of [
      "Pages/Cloud/View/Layout.tsx",
      "Pages/AppPlatforms/View/Layout.tsx",
    ]) {
      const code: string = readCode(layout);

      // Cloud's page reads a little more, for the tabs it draws.
      expect(code).toMatch(/select: \{ cloudResourceKind: true, /);
      expect(code).toContain(
        "<Navigate replace={true} to={getCloudResourceForwardRoute({",
      );
    }

    // Cloud keeps a resource's pages; App Platforms an environment's.
    expect(readCode("Pages/Cloud/View/Layout.tsx")).toContain(
      "if (cloudResourceKind === CloudResourceKind.Environment) { return (<Navigate replace={true} to={getCloudResourceForwardRoute({ cloudResourceKind: CloudResourceKind.Environment,",
    );
    expect(readCode("Pages/AppPlatforms/View/Layout.tsx")).toContain(
      "if (cloudResourceKind === CloudResourceKind.Resource) { return (<Navigate replace={true} to={getCloudResourceForwardRoute({ cloudResourceKind: CloudResourceKind.Resource,",
    );
  });

  test("the server links each row to its own product", () => {
    const kind: string = stripComments(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Common",
          "Types",
          "Cloud",
          "CloudResourceKind.ts",
        ),
        "utf8",
      ),
    ).replace(/\s+/g, " ");

    expect(kind).toContain("export function getCloudResourceDashboardPath(");
    expect(kind).toContain("`app-platforms/${");
    expect(kind).toContain("`cloud/${");
  });
});
