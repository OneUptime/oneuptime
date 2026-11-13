import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";

/*
 * The wiring of the Data Retention pages (issue #6903) - Incidents ->
 * Settings -> Data Retention and Alerts -> Settings -> Data Retention -
 * read from source (an App test must not import a React module). The cards
 * themselves are rendered in Common/Tests/App/Dashboard/
 * ResolvedRecordRetentionCard; where the menu entry sits is
 * NumberingPagesWiring's.
 *
 * What only the source shows: each page has its key, its address
 * (settings/data-retention, under the product's own), its route, its menu
 * entry, its breadcrumbs and its place in the search - so someone looking
 * for how long incidents are kept, or why the database grows, finds it by
 * name.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

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

interface Product {
  name: string;
  pageKey: string;
  routePath: string;
  productSegment: string;
  routes: string;
  page: string;
  pageImportName: string;
  sideMenu: string;
  breadcrumbs: string;
  productCrumb: string;
  copy: string;
  cardTitle: string;
  searchKeyword: string;
}

const PRODUCTS: Array<Product> = [
  {
    name: "Incidents",
    pageKey: "INCIDENTS_SETTINGS_RETENTION",
    routePath: "IncidentsRoutePath",
    productSegment: "incidents",
    routes: "Routes/IncidentsRoutes.tsx",
    page: "Pages/Incidents/Settings/IncidentRetentionSettings.tsx",
    pageImportName: "IncidentSettingsRetention",
    sideMenu: "Pages/Incidents/SideMenu.tsx",
    breadcrumbs: "Utils/Breadcrumbs/IncidentBreadcrumbs.ts",
    productCrumb: "Incidents",
    copy: "INCIDENT_RETENTION_COPY",
    cardTitle: "Resolved Incidents",
    searchKeyword: "delete old incidents",
  },
  {
    name: "Alerts",
    pageKey: "ALERTS_SETTINGS_RETENTION",
    routePath: "AlertsRoutePath",
    productSegment: "alerts",
    routes: "Routes/AlertRoutes.tsx",
    page: "Pages/Alerts/Settings/AlertRetentionSettings.tsx",
    pageImportName: "AlertSettingsRetention",
    sideMenu: "Pages/Alerts/SideMenu.tsx",
    breadcrumbs: "Utils/Breadcrumbs/AlertBreadcrumbs.ts",
    productCrumb: "Alerts",
    copy: "ALERT_RETENTION_COPY",
    cardTitle: "Resolved Alerts",
    searchKeyword: "delete old alerts",
  },
];

describe.each(PRODUCTS)(
  "$name -> Settings -> Data Retention",
  (product: Product) => {
    test("has a page key of its own", () => {
      expect(dense("Utils/PageMap.ts")).toContain(
        `${product.pageKey}="${product.pageKey}",`,
      );
    });

    test("lives at settings/data-retention, under the product's own address", () => {
      const routeMap: string = dense("Utils/RouteMap.ts");

      expect(routeMap).toContain(
        `[PageMap.${product.pageKey}]:"settings/data-retention",`,
      );
      expect(routeMap).toContain(
        `[PageMap.${product.pageKey}]:newRoute(\`/dashboard/\${RouteParams.ProjectID}/${product.productSegment}/\${${product.routePath}[PageMap.${product.pageKey}]}\`,),`,
      );
    });

    test("its route draws its page, with its own address", () => {
      const routes: string = dense(product.routes);

      expect(routes).toContain(
        `import${product.pageImportName}from"../${product.page.replace(/\.tsx$/, "")}";`,
      );
      expect(routes).toMatch(
        new RegExp(
          escapeRegExp(
            `<PageRoutepath={${product.routePath}[PageMap.${product.pageKey}]||""}element={<${product.pageImportName}{...props}pageRoute={RouteMap[PageMap.${product.pageKey}]asRoute}/>}/>`,
          ),
        ),
      );
    });

    test("the page draws the product's card, for the current project", () => {
      const page: string = dense(product.page);

      expect(page).toContain("ProjectUtil.getCurrentProjectId()");
      expect(page).toContain(
        `<ResolvedRecordRetentionCardcopy={${product.copy}}projectId={projectId}/>`,
      );
    });

    test("the side menu links to it, named Data Retention, with the archive icon", () => {
      expect(dense(product.sideMenu)).toContain(
        `{link:{title:"DataRetention",to:RouteUtil.populateRouteParams(RouteMap[PageMap.${product.pageKey}]asRoute,),},icon:IconProp.Archive,},`,
      );
    });

    test("its breadcrumbs lead back through the product's settings", () => {
      expect(dense(product.breadcrumbs)).toContain(
        `...BuildBreadcrumbLinksByTitles(PageMap.${product.pageKey},["Project","${product.productCrumb}","Settings","DataRetention",]),`,
      );
    });

    test("the search finds it by what people call it, and by its card", () => {
      const search: string = read(
        "Components/CommandPalette/PageSearchIndex.ts",
      );
      const at: number = search.indexOf(`page: PageMap.${product.pageKey},`);

      expect(at).toBeGreaterThan(-1);

      const entry: string = search.slice(
        at,
        search.indexOf("},", search.indexOf("settings:", at)),
      );

      expect(entry).toContain(`title: "Data Retention"`);
      expect(entry).toContain("icon: IconProp.Archive");
      expect(entry).toContain(`"${product.searchKeyword}"`);
      expect(entry).toContain(`"database size"`);
      expect(entry).toContain(`settings: ["${product.cardTitle}"]`);
    });
  },
);
