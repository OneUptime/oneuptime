import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The wiring of the Numbering pages - the Number Prefix card and the Next
 * Number card of Incidents, Alerts and Scheduled Maintenance - read from
 * source (an App test must not import a React module). Rendering is covered
 * in Common/Tests/App/Dashboard: NumberingSettingsPages (the prefix card),
 * NextNumberCard (the next number card), NumberingPageRedirects (the old
 * addresses) and the three side-menu suites.
 *
 * What only the source shows: the menu entry's icon, that the old addresses
 * are forwarded outside each product's layout, that More Settings and the
 * Number Prefix page are gone for good, that each page draws both cards in
 * order, and that the prefixes and the starts are edited in one place.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const REPO_PACKAGES: string = path.join(__dirname, "..", "..", "..");

function read(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relative), "utf8");
}

// Source without comments or whitespace, for exact matching.
function dense(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, "");
}

function sectionBetween(code: string, start: string, end: string): string {
  const from: number = code.indexOf(start);
  const to: number = code.indexOf(end, from + start.length);

  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);

  return code.slice(from + start.length, to);
}

interface Product {
  name: string;
  sideMenu: string;
  routes: string;
  breadcrumbs: string;
  pageKey: string;
  page: string;
  pageImportName: string;
  productCrumb: string;
  // The page's two cards' copy (NumberPrefixSettings, NextNumberSettings).
  prefixes: string;
  nextNumbers: string;
}

const PRODUCTS: Array<Product> = [
  {
    name: "Incidents",
    sideMenu: "Pages/Incidents/SideMenu.tsx",
    routes: "Routes/IncidentsRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/IncidentBreadcrumbs.ts",
    pageKey: "INCIDENTS_SETTINGS_NUMBERING",
    page: "Pages/Incidents/Settings/IncidentNumbering",
    pageImportName: "IncidentSettingsNumbering",
    productCrumb: "Incidents",
    prefixes: "INCIDENT_NUMBER_PREFIXES",
    nextNumbers: "INCIDENT_NEXT_NUMBERS",
  },
  {
    name: "Alerts",
    sideMenu: "Pages/Alerts/SideMenu.tsx",
    routes: "Routes/AlertRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/AlertBreadcrumbs.ts",
    pageKey: "ALERTS_SETTINGS_NUMBERING",
    page: "Pages/Alerts/Settings/AlertNumbering",
    pageImportName: "AlertSettingsNumbering",
    productCrumb: "Alerts",
    prefixes: "ALERT_NUMBER_PREFIXES",
    nextNumbers: "ALERT_NEXT_NUMBERS",
  },
  {
    name: "Scheduled Maintenance",
    sideMenu: "Pages/ScheduledMaintenanceEvents/SideMenu.tsx",
    routes: "Routes/ScheduleMaintenanceEventsRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/ScheduledMaintenanceBreadcrumbs.ts",
    pageKey: "SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NUMBERING",
    page: "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNumbering",
    pageImportName: "ScheduledMaintenanceSettingsNumbering",
    productCrumb: "Scheduled Maintenance",
    prefixes: "SCHEDULED_MAINTENANCE_NUMBER_PREFIXES",
    nextNumbers: "SCHEDULED_MAINTENANCE_NEXT_NUMBERS",
  },
];

const PREFIX_COLUMNS: Array<string> = [
  "incidentNumberPrefix",
  "incidentEpisodeNumberPrefix",
  "alertNumberPrefix",
  "alertEpisodeNumberPrefix",
  "scheduledMaintenanceNumberPrefix",
];

const STARTS_AT_COLUMNS: Array<string> = [
  "incidentNumbersStartAt",
  "incidentEpisodeNumbersStartAt",
  "alertNumbersStartAt",
  "alertEpisodeNumbersStartAt",
  "scheduledMaintenanceNumbersStartAt",
];

describe.each(PRODUCTS)("$name → Settings → Numbering", (product: Product) => {
  test("is the last Settings entry, named Numbering, with the # icon", () => {
    const settings: string = sectionBetween(
      dense(product.sideMenu),
      'title:"Settings",',
      "addDeveloperSideMenuSection(",
    );

    expect(settings).toMatch(
      new RegExp(
        `\\{link:\\{title:"Numbering",to:RouteUtil\\.populateRouteParams\\(RouteMap\\[PageMap\\.${product.pageKey}\\]asRoute,\\),\\},icon:IconProp\\.Hashtag,\\},\\],\\},\\];$`,
      ),
    );
  });

  test("the menu has no More Settings or Number Prefix entry", () => {
    expect(read(product.sideMenu)).not.toContain('"More Settings"');
    expect(read(product.sideMenu)).not.toContain("_SETTINGS_MORE");
    expect(read(product.sideMenu)).not.toContain('"Number Prefix"');
    expect(read(product.sideMenu)).not.toContain("_SETTINGS_NUMBER_PREFIX");
  });

  test("the page draws the Number Prefix card, then the Next Number card under it", () => {
    const code: string = dense(`${product.page}.tsx`);

    expect(code).toContain(
      `<Fragment><NumberPrefixCardpage={${product.prefixes}}/><NextNumberCardpage={${product.nextNumbers}}/></Fragment>`,
    );
  });

  test("the page is mounted with its own pageRoute", () => {
    const code: string = dense(product.routes);

    expect(code).toContain(
      `import${product.pageImportName}from"../${product.page}";`,
    );
    expect(code).toContain(
      `element={<${product.pageImportName}{...props}pageRoute={RouteMap[PageMap.${product.pageKey}]asRoute}/>}`,
    );
  });

  /*
   * Outside the layout: each old address forwards before the product's
   * layout (and its side menu) renders, so nothing flashes on the way.
   */
  test.each(["MORE_SETTINGS_PATH", "NUMBER_PREFIX_PATH"])(
    "the old address %s forwards to it, outside the product's layout",
    (oldPath: string) => {
      const code: string = dense(product.routes);
      const redirect: string = `<PageRoutepath={${oldPath}}element={<MovedNumberPrefixPageRedirectpageMap={PageMap.${product.pageKey}}/>}/>`;

      expect(code).toContain(
        'importMovedNumberPrefixPageRedirectfrom"../Components/NumberPrefix/MovedNumberPrefixPageRedirect";',
      );
      expect(code).toContain(
        'import{MORE_SETTINGS_PATH,NUMBER_PREFIX_PATH,}from"../Components/NumberPrefix/NumberPrefixSettings";',
      );
      expect(code.split(redirect)).toHaveLength(2);

      const routesStart: number = code.indexOf("<Routes>");
      const redirectAt: number = code.indexOf(redirect);
      const layoutAt: number = code.indexOf('<PageRoutepath="/"');

      /*
       * Ahead of the layout route, as its sibling rather than one of its
       * children. NumberingPageRedirects.test.tsx renders the route group
       * and checks the layout never renders at an old address.
       */
      expect(routesStart).toBeGreaterThan(-1);
      expect(redirectAt).toBeGreaterThan(routesStart);
      expect(layoutAt).toBeGreaterThan(redirectAt);
    },
  );

  test("has a trail of Project, the product, Settings and Numbering", () => {
    const crumbs: string = [
      "Project",
      product.productCrumb,
      "Settings",
      "Numbering",
    ]
      .map((title: string): string => {
        return `"${title.replace(/\s+/g, "")}"`;
      })
      .join(",");

    expect(dense(product.breadcrumbs)).toContain(
      `...BuildBreadcrumbLinksByTitles(PageMap.${product.pageKey},[${crumbs}`,
    );
  });
});

describe("More Settings is gone", () => {
  test("its three pages are deleted, and so are the Number Prefix pages that followed", () => {
    for (const page of [
      "Pages/Incidents/Settings/IncidentMoreSettings.tsx",
      "Pages/Alerts/Settings/AlertMoreSettings.tsx",
      "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceMoreSettings.tsx",
      "Pages/Incidents/Settings/IncidentNumberPrefix.tsx",
      "Pages/Alerts/Settings/AlertNumberPrefix.tsx",
      "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNumberPrefix.tsx",
    ]) {
      expect({
        page,
        exists: fs.existsSync(path.join(DASHBOARD_SRC, page)),
      }).toEqual({ page, exists: false });
    }
  });

  test("no PageMap key or route path is left for them", () => {
    expect(read("Utils/PageMap.ts")).not.toMatch(/_SETTINGS_MORE\b/);
    expect(read("Utils/RouteMap.ts")).not.toContain('"settings/more"');
    expect(read("Utils/RouteMap.ts")).not.toMatch(/_SETTINGS_MORE\b/);
    expect(read("Utils/PageMap.ts")).not.toMatch(/_SETTINGS_NUMBER_PREFIX\b/);
    expect(read("Utils/RouteMap.ts")).not.toContain('"settings/number-prefix"');
  });

  test("the forwarding addresses are the ones they had", () => {
    expect(dense("Components/NumberPrefix/NumberPrefixSettings.ts")).toContain(
      'exportconstMORE_SETTINGS_PATH:string="settings/more";',
    );
    expect(dense("Components/NumberPrefix/NumberPrefixSettings.ts")).toContain(
      'exportconstNUMBER_PREFIX_PATH:string="settings/number-prefix";',
    );
  });
});

/*
 * One place to change them. A copy of a prefix field anywhere else would be
 * a second, unnoticed way to renumber a product - which is how they ended up
 * on a page called More Settings in the first place.
 */
describe("the prefixes are edited in one place", () => {
  function sourcesNaming(root: string): Array<string> {
    const found: Array<string> = [];

    function walk(directory: string): void {
      if (!fs.existsSync(directory)) {
        return;
      }

      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (
            !["node_modules", "Locales", "build", "dist"].includes(entry.name)
          ) {
            walk(entryPath);
          }
          continue;
        }

        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) {
          continue;
        }

        const source: string = fs.readFileSync(entryPath, "utf8");

        if (
          PREFIX_COLUMNS.some((column: string): boolean => {
            return new RegExp(`\\b${column}\\b`).test(source);
          })
        ) {
          found.push(path.relative(REPO_PACKAGES, entryPath));
        }
      }
    }

    walk(root);

    return found;
  }

  test("only the Number Prefix settings name a prefix column in the dashboards", () => {
    const found: Array<string> = [
      ...sourcesNaming(DASHBOARD_SRC),
      ...sourcesNaming(
        path.join(REPO_PACKAGES, "App", "FeatureSet", "AdminDashboard", "src"),
      ),
      ...sourcesNaming(path.join(REPO_PACKAGES, "..", "ee", "Dashboard")),
    ];

    expect(found).toEqual([
      path.join(
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "NumberPrefix",
        "NumberPrefixSettings.ts",
      ),
    ]);
  });

  test("and they name all five", () => {
    const settings: string = read(
      "Components/NumberPrefix/NumberPrefixSettings.ts",
    );

    for (const column of PREFIX_COLUMNS) {
      expect(settings).toContain(`column: "${column}"`);
    }
  });
});

/*
 * Where numbers start is written by one card, the Next Number card, which
 * reaches each kind's column through Common/Utils/Project/NextNumber rather
 * than naming it: no dashboard source spells a start column out, so a
 * second way to move a project's numbers on cannot creep in unnoticed.
 */
describe("the starts are edited in one place", () => {
  test("no dashboard source names a start column", () => {
    const found: Array<string> = [];

    function walk(directory: string): void {
      if (!fs.existsSync(directory)) {
        return;
      }

      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (
            !["node_modules", "Locales", "build", "dist"].includes(entry.name)
          ) {
            walk(entryPath);
          }
          continue;
        }

        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) {
          continue;
        }

        const source: string = fs.readFileSync(entryPath, "utf8");

        if (
          STARTS_AT_COLUMNS.some((column: string): boolean => {
            return source.includes(column);
          })
        ) {
          found.push(path.relative(REPO_PACKAGES, entryPath));
        }
      }
    }

    walk(DASHBOARD_SRC);
    walk(
      path.join(REPO_PACKAGES, "App", "FeatureSet", "AdminDashboard", "src"),
    );
    walk(path.join(REPO_PACKAGES, "..", "ee", "Dashboard"));

    expect(found).toEqual([]);
  });

  test("the Next Number card writes them through the kinds' own columns", () => {
    const settings: string = dense(
      "Components/NextNumber/NextNumberSettings.ts",
    );
    const card: string = dense("Components/NextNumber/NextNumberCard.tsx");

    expect(settings).toContain(
      "returnNextNumberUtil.getKindInfo(kind).startsAtColumn;",
    );
    expect(card).toContain(
      "awaitModelAPI.updateById<Project>({modelType:Project,",
    );
    expect(card).toContain("data:changes,");
  });
});
