import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * Admin Dashboard > User > Authentication is the page a master admin uses to
 * set somebody else's password or mail them a reset link. It is stitched
 * together from wirings no compiler checks, and every one of them fails
 * quietly rather than loudly:
 *
 *  - the PageMap key, the RouteMap Route, the PageRoute in App.tsx and the
 *    SideMenuItem are four independent hand edits. Drop the RouteMap entry and
 *    RouteUtil.populateRouteParams stringifies `undefined`, so the side-menu
 *    link and the breadcrumb both point at "/undefined"; drop the PageRoute and
 *    the link lands on a blank page; drop the SideMenuItem and the page is
 *    reachable only by typing the URL.
 *  - the page reads its user with Navigation.getLastParamAsObjectID(1), which
 *    counts path segments BACKWARDS from the end of the URL. That argument is
 *    right only while exactly one segment follows the model id. Nest the route
 *    one level deeper, or move the page to the bare ":id", and the literal
 *    string "authentication" is parsed as an ObjectID - on a page whose three
 *    buttons all write to whoever that id turns out to name.
 *  - and the three actions are plain fetches, not model writes. The page builds
 *    "/user/<id>/<action>" from string literals; UserAPI registers
 *    "<crud path>/:userId/<action>" from its own string literals. The two files
 *    never import each other, so a rename on either side is a 404 that only
 *    shows up when an operator clicks the button.
 *
 * The locale assertions cover the last silent failure: a
 * `t("pages.userAuthentication.x")` whose key is missing renders the raw key
 * as the label, and this page's labels are the only thing telling an operator
 * which of two destructive actions a button performs. `npm run i18n:validate`
 * proves the 16 locale files agree with each other; nothing else proves they
 * contain what this page asks for.
 *
 * Same deferred-import + browser-stub shape as
 * App/Tests/AdminDashboard/UserProjectsPageWiring.test.ts.
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

const REPO_ROOT: string = nodePath.join(__dirname, "../../..");

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  REPO_ROOT,
  "App/FeatureSet/AdminDashboard/src",
);

/*
 * Source text, read rather than imported. App.tsx, SideMenu.tsx and the page
 * itself render React elements and pull in Common/UI; UserAPI.ts builds an
 * express router at construction time. What matters here is which literals
 * they contain, and no runtime value exposes that - asserting on the text is
 * what makes deleting one of them fail a test rather than a code review.
 *
 * Comments are stripped first so a file that explains a route or an action
 * name in prose cannot satisfy an assertion about the code. This file matters
 * more here than in the Projects sibling: both the page and UserAPI.ts carry
 * long comments that name the very endpoints being asserted on.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readSource(absolutePath: string): string {
  return stripComments(fs.readFileSync(absolutePath, "utf8"));
}

function readAdminDashboardSource(relativePath: string): string {
  return readSource(nodePath.join(ADMIN_DASHBOARD_SRC, relativePath));
}

const appSource: string = readAdminDashboardSource("App.tsx");
const sideMenuSource: string = readAdminDashboardSource(
  "Pages/Users/View/SideMenu.tsx",
);
const authenticationPageSource: string = readAdminDashboardSource(
  "Pages/Users/View/Authentication.tsx",
);
const userApiSource: string = readSource(
  nodePath.join(REPO_ROOT, "Common/Server/API/UserAPI.ts"),
);
const userModelSource: string = readSource(
  nodePath.join(REPO_ROOT, "Common/Models/DatabaseModels/User.ts"),
);

const LOCALES_DIR: string = nodePath.join(ADMIN_DASHBOARD_SRC, "Locales");

const localeFileNames: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((fileName: string) => {
    return fileName.endsWith(".json");
  })
  .sort();

function readLocale(fileName: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(nodePath.join(LOCALES_DIR, fileName), "utf8"),
  );
}

const englishLocale: Record<string, unknown> = readLocale("en.json");

function lookUpLocaleKey(
  locale: Record<string, unknown>,
  key: string,
): unknown {
  let node: unknown = locale;

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

function hasTranslation(locale: Record<string, unknown>, key: string): boolean {
  const value: unknown = lookUpLocaleKey(locale, key);

  return typeof value === "string" && value.trim().length > 0;
}

/* Every `t("...")` the page asks for. */
function translationKeysUsedByPage(): Array<string> {
  const keys: Set<string> = new Set<string>();
  const pattern: RegExp = /\bt\(\s*"([^"]+)"/g;

  let match: RegExpExecArray | null = pattern.exec(authenticationPageSource);

  while (match) {
    keys.add(match[1]!);
    match = pattern.exec(authenticationPageSource);
  }

  return [...keys];
}

/*
 * The (verb, action) pairs the page calls the server with. The page routes
 * every one of them through the same `userAuthenticationRoute(modelId, action)`
 * builder, so the action literal plus the API method beside it is the whole of
 * what it asks the server for.
 */
interface PageApiCall {
  verb: string;
  action: string;
}

function apiCallsMadeByPage(): Array<PageApiCall> {
  const calls: Array<PageApiCall> = [];
  const pattern: RegExp =
    /API\.(get|post)<[^>]*>\(\s*\{\s*url:\s*userAuthenticationRoute\(\s*modelId,\s*"([^"]+)"/g;

  let match: RegExpExecArray | null = pattern.exec(authenticationPageSource);

  while (match) {
    calls.push({ verb: match[1]!, action: match[2]! });
    match = pattern.exec(authenticationPageSource);
  }

  return calls;
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

describe("User > Authentication route", () => {
  test("the page has a PageMap key", () => {
    expect(PageMap.USER_AUTHENTICATION).toBe("USER_AUTHENTICATION");
  });

  test("the key resolves to a route", () => {
    expect(RouteMap[PageMap.USER_AUTHENTICATION]).toBeDefined();
  });

  test("the route is the user's own authentication page", () => {
    expect(routePath(PageMap.USER_AUTHENTICATION)).toBe(
      `/admin/users/${RouteParams.ModelID}/authentication`,
    );
  });

  test("the route hangs off the user's own view rather than a sibling of it", () => {
    /*
     * Stated against USER_VIEW as well as the literal above, because the whole
     * side menu is rendered inside the user's ModelPage: a page that sat
     * outside that prefix would keep working while showing a side menu that
     * navigates away from itself.
     */
    expect(routePath(PageMap.USER_AUTHENTICATION)).toBe(
      `${routePath(PageMap.USER_VIEW)}/authentication`,
    );
  });

  test("the route carries the user id as its model param", () => {
    /*
     * RouteUtil.populateRouteParams substitutes RouteParams.ModelID and
     * nothing else, so a route that spelled the param any other way would come
     * out of every link with a literal ":id" still in it.
     */
    expect(routePath(PageMap.USER_AUTHENTICATION)).toContain(
      RouteParams.ModelID,
    );
  });

  test("the route takes only the user id, which is all the side menu passes", () => {
    expect(routePath(PageMap.USER_AUTHENTICATION)).not.toContain(
      RouteParams.SubModelID,
    );
  });

  test("exactly one segment follows the user id in the route", () => {
    /*
     * The precondition for the assertion below. Pinned on its own so that a
     * route reshaped to, say, ":id/authentication/password" reports what
     * actually changed instead of only reporting that the page's index no
     * longer matches.
     */
    const segments: Array<string> = routePath(
      PageMap.USER_AUTHENTICATION,
    ).split("/");

    expect(segments.length - 1 - segments.indexOf(RouteParams.ModelID)).toBe(1);
  });

  test("the page reads its user from the segment the route actually puts it in", () => {
    /*
     * Navigation.getLastParamAsObjectID(n) counts BACKWARDS from the end of
     * the URL, so the argument the page passes has to equal the number of path
     * segments that follow the model id. Derived from the route rather than
     * hard-coded, so changing the route's shape without changing the page
     * fails here.
     *
     * With the wrong index the page does not throw: it constructs an ObjectID
     * around the literal "authentication" (or around "users") and hands it to
     * the status fetch and to both write buttons. Nothing on screen says the
     * page is pointed at the wrong account.
     */
    const segments: Array<string> = routePath(
      PageMap.USER_AUTHENTICATION,
    ).split("/");
    const segmentsAfterModelId: number =
      segments.length - 1 - segments.indexOf(RouteParams.ModelID);

    expect(authenticationPageSource).toContain(
      `Navigation.getLastParamAsObjectID(${segmentsAfterModelId})`,
    );
  });
});

describe("User > Authentication page registration", () => {
  test("App.tsx imports the page", () => {
    expect(appSource).toContain(
      'import UserAuthentication from "./Pages/Users/View/Authentication"',
    );
  });

  test("App.tsx registers a route that renders it", () => {
    expect(appSource).toMatch(
      /RouteMap\[PageMap\.USER_AUTHENTICATION\][\s\S]{0,120}element=\{<UserAuthentication \/>\}/,
    );
  });

  test("the user's side menu links to it", () => {
    /*
     * Without this the page is reachable only by hand-typing a URL that
     * contains a user's ObjectID, which is to say not reachable at all.
     */
    expect(sideMenuSource).toContain("RouteMap[PageMap.USER_AUTHENTICATION]");
  });

  test("the side-menu link carries the user id, so it does not resolve to a literal ':id'", () => {
    expect(sideMenuSource).toMatch(
      /RouteMap\[PageMap\.USER_AUTHENTICATION\][\s\S]{0,160}modelId: props\.modelId/,
    );
  });
});

describe("User > Authentication server contract", () => {
  /*
   * The one thing in this file that spans two processes. The page hard-codes
   * "/user/<id>/<action>"; UserAPI.ts registers "<crud path>/:userId/<action>".
   * TypeScript sees two unrelated string literals, so a rename on either side
   * compiles, ships, and fails as a 404 the first time an operator presses the
   * button.
   */

  test("the page's API calls were found at all", () => {
    /*
     * A guard on the extraction: a regex that matched nothing would make every
     * assertion below vacuously pass.
     */
    expect(
      apiCallsMadeByPage().map((call: PageApiCall) => {
        return call.action;
      }),
    ).toEqual(
      expect.arrayContaining([
        "authentication-status",
        "set-password",
        "send-password-reset-link",
        "set-two-factor-auth-required",
        "reset-two-factor-auth",
      ]),
    );
  });

  test("every action the page calls is a route UserAPI registers", () => {
    const unregistered: Array<string> = apiCallsMadeByPage()
      .filter((call: PageApiCall) => {
        return !new RegExp(`/:userId/${call.action}\``).test(userApiSource);
      })
      .map((call: PageApiCall) => {
        return call.action;
      });

    expect(unregistered).toEqual([]);
  });

  test("each action is registered on the method the page calls it with", () => {
    /*
     * A route registered on the wrong verb is the same 404 as a route that is
     * not registered at all - and express reports it identically, so the only
     * clue is the network tab. `set-password` in particular carries its
     * payload in the body, which a GET would silently drop.
     */
    const mismatched: Array<string> = apiCallsMadeByPage()
      .filter((call: PageApiCall) => {
        return !new RegExp(
          `this\\.router\\.${call.verb}\\(\\s*\`[^\`]*?/:userId/${call.action}\``,
        ).test(userApiSource);
      })
      .map((call: PageApiCall) => {
        return `${call.verb} ${call.action}`;
      });

    expect(mismatched).toEqual([]);
  });

  test("the status read is a GET and every credential change is a POST", () => {
    /*
     * Pinned from the page's side too, so that "the two files agree" cannot be
     * satisfied by both of them moving to a GET. Every action other than the
     * status read revokes sessions and changes how somebody signs in --
     * setting a password, mailing a reset link, requiring two factor auth or
     * wiping what they have set up. None of those may be reachable by
     * following a link or replaying a prefetch.
     *
     * Asserted as an exact map rather than a subset, so a new action added to
     * this page has to be written down here and, one hopes, thought about.
     */
    const verbsByAction: Record<string, string> = {};

    for (const call of apiCallsMadeByPage()) {
      verbsByAction[call.action] = call.verb;
    }

    expect(verbsByAction).toEqual({
      "authentication-status": "get",
      "set-password": "post",
      "send-password-reset-link": "post",
      "set-two-factor-auth-required": "post",
      "reset-two-factor-auth": "post",
    });
  });

  test("the prefix the page hard-codes is the User model's CRUD path", () => {
    /*
     * UserAPI builds these routes from getCrudApiPath(); the page writes
     * "/user/" out by hand. The decorator below is what makes those the same
     * string, and it is editable without either file noticing.
     */
    expect(authenticationPageSource).toContain(
      "`/user/${modelId.toString()}/${action}`",
    );
    expect(userModelSource).toContain('@CrudApiEndpoint(new Route("/user"))');
    expect(userApiSource).toContain(
      "`${new this.entityType().getCrudApiPath()?.toString()}/:userId/set-password`",
    );
  });
});

describe("User > Authentication translations", () => {
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
        return !hasTranslation(englishLocale, key);
      },
    );

    expect(missing).toEqual([]);
  });

  test("all sixteen locale files were found", () => {
    /*
     * A guard on the directory read: an empty or half-read listing would make
     * the cross-locale assertion below pass without checking anything.
     */
    expect(localeFileNames.length).toBeGreaterThanOrEqual(16);
    expect(localeFileNames).toContain("en.json");
  });

  test("every key the page asks for exists in every locale", () => {
    /*
     * i18next falls back to rendering the key itself, so a locale that is
     * missing `pages.userAuthentication.setPasswordButton` shows a button
     * captioned with that dotted path - on a form that overwrites somebody's
     * password.
     */
    const keys: Array<string> = translationKeysUsedByPage();
    const missing: Array<string> = [];

    for (const fileName of localeFileNames) {
      const locale: Record<string, unknown> = readLocale(fileName);

      for (const key of keys) {
        if (!hasTranslation(locale, key)) {
          missing.push(`${fileName}: ${key}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("the side menu's Authentication label exists in every locale", () => {
    /*
     * Asserted separately because it lives in SideMenu.tsx rather than on the
     * page, so the extraction above never sees it.
     */
    const missing: Array<string> = localeFileNames.filter(
      (fileName: string) => {
        return !hasTranslation(readLocale(fileName), "sideMenu.authentication");
      },
    );

    expect(missing).toEqual([]);
    expect(sideMenuSource).toContain('t("sideMenu.authentication")');
  });

  test("the reset-link confirmation keeps its placeholder", () => {
    /*
     * The page passes { email } to this key so the operator can see which
     * address the link went to - the one fact that tells them whether they
     * acted on the user they meant to. A translation that dropped {{email}}
     * renders a success message naming nobody. The i18n validator already
     * enforces placeholder parity across the other fifteen files, so the
     * English source is the only place this has to be pinned.
     */
    expect(
      lookUpLocaleKey(
        englishLocale,
        "pages.userAuthentication.resetLinkSentTo",
      ),
    ).toContain("{{email}}");
  });
});
