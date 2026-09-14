import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * The Admin Dashboard's Project > Support page is the staff-side copy of the
 * "Enable Customer Support Access" card the customer has in their own Project
 * Settings. Both write one column - Project.letCustomerSupportAccessProject -
 * and everything that connects this page to that column is hand-written and
 * fails silently:
 *
 *  - a missing RouteMap entry makes RouteUtil.populateRouteParams stringify
 *    `undefined`, so the side-menu link and the breadcrumb both point at
 *    "/undefined";
 *  - a missing PageRoute in App.tsx renders a blank page under a working link;
 *  - the field name in the form is an untyped-at-the-wire string as far as a
 *    reader is concerned, and a page that toggled a column the model does not
 *    have would render an empty card and 400 on save;
 *  - and a locale missing a key renders the raw key ("pages.projectSupport.
 *    fieldLabel") to staff as the toggle's label.
 *
 * The admin dashboard has no React render harness (App's jest environment is
 * "node" and the package carries no react/testing-library), so this asserts
 * the wiring the way the sibling AdminDashboard suites do: against the runtime
 * route values, the source text and the locale files.
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

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/AdminDashboard/src",
);

const DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const COMMON_SRC: string = nodePath.join(__dirname, "../../../Common");

/*
 * Comments are stripped before any assertion so that a file which explains a
 * pattern in prose cannot satisfy an assertion about the code. Several of the
 * comments in Support.tsx name the very identifiers asserted on below.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readSource(root: string, relativePath: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(root, relativePath), "utf8"),
  );
}

const supportSource: string = readSource(
  ADMIN_DASHBOARD_SRC,
  "Pages/Projects/View/Support.tsx",
);

const appSource: string = readSource(ADMIN_DASHBOARD_SRC, "App.tsx");

const sideMenuSource: string = readSource(
  ADMIN_DASHBOARD_SRC,
  "Pages/Projects/View/SideMenu.tsx",
);

/* The customer-facing card this page mirrors. */
const projectSettingsSource: string = readSource(
  DASHBOARD_SRC,
  "Pages/Settings/ProjectSettings.tsx",
);

/* Not comment-stripped: the assertions below are about decorator metadata. */
const projectModelSource: string = fs.readFileSync(
  nodePath.join(COMMON_SRC, "Models/DatabaseModels/Project.ts"),
  "utf8",
);

const LOCALES_DIR: string = nodePath.join(ADMIN_DASHBOARD_SRC, "Locales");

function localeFileNames(): Array<string> {
  return fs.readdirSync(LOCALES_DIR).filter((file: string) => {
    return file.endsWith(".json");
  });
}

function readLocale(fileName: string): Record<string, any> {
  return JSON.parse(
    fs.readFileSync(nodePath.join(LOCALES_DIR, fileName), "utf8"),
  );
}

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

describe("Project > Support route", () => {
  test("the page has a PageMap key", () => {
    expect(PageMap.PROJECT_SUPPORT).toBe("PROJECT_SUPPORT");
  });

  test("the key resolves to a route", () => {
    expect(RouteMap[PageMap.PROJECT_SUPPORT]).toBeDefined();
  });

  test("the route hangs off the project's own view rather than a sibling of it", () => {
    expect(routePath(PageMap.PROJECT_SUPPORT)).toBe(
      `${routePath(PageMap.PROJECT_VIEW)}/support`,
    );
  });

  test("the route carries the project id as its model param", () => {
    /*
     * RouteUtil.populateRouteParams substitutes RouteParams.ModelID and
     * nothing else, so a route that spelled the param any other way would come
     * out of every link with a literal ":id" still in it.
     */
    expect(routePath(PageMap.PROJECT_SUPPORT)).toContain(RouteParams.ModelID);
  });

  test("the route takes only the project id, which is all the side menu passes", () => {
    expect(routePath(PageMap.PROJECT_SUPPORT)).not.toContain(
      RouteParams.SubModelID,
    );
  });

  test("the route does not collide with another project page", () => {
    /*
     * React Router matches in declaration order, so two project pages sharing
     * a path would silently render whichever App.tsx registers first.
     */
    const projectRoutes: Array<string> = [
      PageMap.PROJECT_VIEW,
      PageMap.PROJECT_SUBSCRIPTION,
      PageMap.PROJECT_SUPPORT,
      PageMap.PROJECT_DELETE,
      PageMap.PROJECT_USERS,
      PageMap.PROJECT_TEAMS,
    ].map(routePath);

    expect(new Set(projectRoutes).size).toBe(projectRoutes.length);
  });

  test("the page reads its project from the segment the route actually puts it in", () => {
    /*
     * Navigation.getLastParamAsString(n) counts BACKWARDS from the end of the
     * URL, so the argument the page passes has to equal the number of path
     * segments that follow the model id in the route. Derived from the route
     * rather than hard-coded, so changing the route's shape without changing
     * the page fails here. Get it wrong and the page loads the literal string
     * "support" as a project id.
     */
    const segments: Array<string> = routePath(PageMap.PROJECT_SUPPORT).split(
      "/",
    );
    const segmentsAfterModelId: number =
      segments.length - 1 - segments.indexOf(RouteParams.ModelID);

    expect(supportSource).toContain(
      `Navigation.getLastParamAsString(${segmentsAfterModelId})`,
    );
  });
});

describe("Project > Support page registration", () => {
  test("App.tsx imports the page", () => {
    expect(appSource).toContain(
      'import ProjectSupport from "./Pages/Projects/View/Support"',
    );
  });

  test("App.tsx registers a route that renders it", () => {
    expect(appSource).toMatch(
      /RouteMap\[PageMap\.PROJECT_SUPPORT\][\s\S]{0,120}element=\{<ProjectSupport \/>\}/,
    );
  });

  test("the project's side menu links to it", () => {
    expect(sideMenuSource).toContain("RouteMap[PageMap.PROJECT_SUPPORT]");
  });

  test("the side-menu link carries the project id, so it does not resolve to a literal ':id'", () => {
    expect(sideMenuSource).toMatch(
      /RouteMap\[PageMap\.PROJECT_SUPPORT\][\s\S]{0,160}modelId: props\.modelId/,
    );
  });
});

describe("Project > Support page behaviour", () => {
  test("the card toggles the column the Project model actually declares", () => {
    /*
     * The one assertion that ties the page to the database. A page naming a
     * column the model does not have renders an empty card and 400s on save,
     * and nothing about that spelling is checked by a compile: the field
     * descriptors take a plain object literal.
     */
    expect(projectModelSource).toContain(
      "public letCustomerSupportAccessProject?: boolean",
    );
    expect(supportSource).toContain("letCustomerSupportAccessProject: true");
  });

  test("it is the same column the customer's own Project Settings writes", () => {
    /*
     * Two pages, one switch. If they ever drift apart, staff would be flipping
     * something the customer cannot see - so pin that they name one column.
     */
    expect(projectSettingsSource).toContain(
      "letCustomerSupportAccessProject: true",
    );
  });

  test("the toggle is editable, or the page is just a read-only echo of Project Settings", () => {
    expect(supportSource).toContain("isEditable={true}");
    expect(supportSource).toContain("FormFieldSchemaType.Toggle");
  });

  test("the detail row renders the column as a boolean rather than raw text", () => {
    expect(supportSource).toContain("FieldType.Boolean");
  });

  test("the page reads and writes through the admin API", () => {
    /*
     * AdminModelAPI is the one that sends no project headers. The tenant-
     * scoped default would scope the request to whatever project the staff
     * user is themselves a member of - not the project being viewed.
     */
    expect(supportSource).toContain("modelAPI={AdminModelAPI}");
    expect(supportSource).toMatch(
      /import AdminModelAPI from "\.\.\/\.\.\/\.\.\/Utils\/ModelAPI"/,
    );
  });

  test("the project id is memoized, so the card does not refetch on every render", () => {
    /*
     * ModelDetail's effect depends on props.modelId BY IDENTITY. A fresh
     * ObjectID built during render would refetch forever once anything on the
     * page sets state - which the edit modal does on every open and close.
     */
    expect(supportSource).toMatch(
      /const modelId: ObjectID = useMemo\(\(\) => \{[\s\S]{0,120}\}, \[modelIdString\]\)/,
    );
  });

  test("staff are told the customer owns this switch before they flip it", () => {
    expect(supportSource).toContain("AlertType.WARNING");
    expect(supportSource).toContain("pages.projectSupport.consentWarning");
  });

  test("the breadcrumb trail leads back to the project, not just to the projects list", () => {
    for (const key of [
      "breadcrumbs.adminDashboard",
      "breadcrumbs.projects",
      "breadcrumbs.project",
      "breadcrumbs.projectSupport",
    ]) {
      expect(supportSource).toContain(key);
    }
  });
});

describe("SaaS gating", () => {
  test("the page bails out when billing is disabled", () => {
    /*
     * There is no OneUptime customer support team to grant access to on a
     * self-hosted install. The early return is what keeps the card hosted-
     * only, so it has to stay above the card.
     */
    const earlyReturnIndex: number = supportSource.indexOf(
      "if (!BILLING_ENABLED)",
    );
    const cardIndex: number = supportSource.indexOf(
      '"Customer Support Access"',
    );

    expect(earlyReturnIndex).toBeGreaterThan(-1);
    expect(cardIndex).toBeGreaterThan(-1);
    expect(earlyReturnIndex).toBeLessThan(cardIndex);
  });

  test("the disabled-billing branch still explains itself rather than rendering nothing", () => {
    expect(supportSource).toContain("pages.projectSupport.billingDisabled");
  });

  test("the side menu only links to this page on the hosted edition", () => {
    /*
     * Scoped to the run-up to the support section rather than the whole file:
     * the file also gates the subscription section on BILLING_ENABLED, so a
     * file-wide `toContain` would stay green with this gate deleted outright.
     * A hundred characters is comfortably more than the gate plus the section
     * opener, and comfortably less than the distance back to the previous
     * gate.
     */
    const beforeSupportSection: string =
      sideMenuSource.split(
        'SideMenuSection title={t("sideMenu.support")}',
      )[0] || "";

    expect(beforeSupportSection).not.toBe("");
    expect(beforeSupportSection.slice(-100)).toContain("BILLING_ENABLED ?");
  });

  test("the customer's own Project Settings card is gated the same way", () => {
    expect(projectSettingsSource).toMatch(
      /BILLING_ENABLED &&[\s\S]{0,800}letCustomerSupportAccessProject/,
    );
  });
});

describe("translations", () => {
  const usedKeys: Array<string> = Array.from(
    new Set(
      [
        ...supportSource.matchAll(
          /t\(\s*["']pages\.projectSupport\.([A-Za-z0-9_]+)["']/g,
        ),
      ].map((match: RegExpMatchArray) => {
        return match[1]!;
      }),
    ),
  );

  test("the page actually asks for the keys this block checks", () => {
    // Guards the guard: a typo'd regex above would otherwise assert nothing.
    expect(usedKeys).toContain("title");
    expect(usedKeys).toContain("cardTitle");
    expect(usedKeys).toContain("fieldLabel");
    expect(usedKeys).toContain("consentWarning");
    expect(usedKeys).toContain("billingDisabled");
  });

  test.each(localeFileNames())(
    "%s defines every pages.projectSupport key the page asks for",
    (fileName: string) => {
      /*
       * i18next falls back to rendering the key itself, so a missing key shows
       * staff "pages.projectSupport.fieldLabel" as the toggle's label rather
       * than failing anywhere a compile or a render test would see.
       */
      const block: Record<string, string> =
        readLocale(fileName)["pages"]?.["projectSupport"] || {};

      const missing: Array<string> = usedKeys.filter((key: string) => {
        return typeof block[key] !== "string" || block[key]!.trim() === "";
      });

      expect(missing).toEqual([]);
    },
  );

  test.each(localeFileNames())(
    "%s defines the side-menu and breadcrumb labels for the page",
    (fileName: string) => {
      const locale: Record<string, any> = readLocale(fileName);

      expect(typeof locale["sideMenu"]?.["support"]).toBe("string");
      expect(locale["sideMenu"]["support"].trim()).not.toBe("");

      expect(typeof locale["sideMenu"]?.["customerSupportAccess"]).toBe(
        "string",
      );
      expect(locale["sideMenu"]["customerSupportAccess"].trim()).not.toBe("");

      expect(typeof locale["breadcrumbs"]?.["projectSupport"]).toBe("string");
      expect(locale["breadcrumbs"]["projectSupport"].trim()).not.toBe("");
    },
  );

  test("the side menu and the page use the locale keys the locales define", () => {
    /*
     * The pair above proves the locales carry the keys; this proves the two
     * components ask for those keys and not for some near-miss spelling.
     */
    expect(sideMenuSource).toContain('t("sideMenu.support")');
    expect(sideMenuSource).toContain('t("sideMenu.customerSupportAccess")');
  });

  test("every locale carries the same pages.projectSupport keys as English, in the same order", () => {
    /*
     * Order is not functionally required, but keeping it identical is what
     * makes a missing key obvious in review rather than buried at the end.
     */
    const englishKeys: Array<string> = Object.keys(
      readLocale("en.json")["pages"]["projectSupport"],
    );

    expect(englishKeys.length).toBeGreaterThan(0);

    const mismatched: Array<string> = [];

    for (const fileName of localeFileNames()) {
      const keys: Array<string> = Object.keys(
        readLocale(fileName)["pages"]?.["projectSupport"] || {},
      );

      if (JSON.stringify(keys) !== JSON.stringify(englishKeys)) {
        mismatched.push(fileName);
      }
    }

    expect(mismatched).toEqual([]);
  });

  test("no pages.projectSupport value smuggles in an interpolation the page never fills", () => {
    /*
     * The page passes no interpolation values to any of these keys, so a
     * "{{something}}" surviving in a translation renders the literal braces to
     * staff.
     */
    const offenders: Array<string> = [];
    const interpolation: RegExp = new RegExp("\\{\\{[^}]+\\}\\}");

    for (const fileName of localeFileNames()) {
      const block: Record<string, string> =
        readLocale(fileName)["pages"]?.["projectSupport"] || {};

      for (const [key, value] of Object.entries(block)) {
        if (interpolation.test(value)) {
          offenders.push(`${fileName}: ${key}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
