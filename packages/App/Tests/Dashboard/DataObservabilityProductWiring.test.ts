import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { pageRoutesIn, routeMapPath, routesAt } from "../Helpers/PageRoutes";

/*
 * The Data Observability product is a lazy-loaded route group: a product
 * layout (Overview, Tables, Schema Changes, Databases, Documentation,
 * Dropped Tables), a per-database layout (Overview, Tables,
 * Recommendations) and a per-table layout (Overview, Columns, Metrics,
 * Timeline, Services, Settings, Delete). Every piece of that wiring fails silently:
 * a missing navbar entry hides the product, a route in PageMap that is never
 * mounted renders a blank page, a page with no trail renders without
 * breadcrumbs. The App suite cannot import the dashboard's route modules, so
 * these are source-level invariants, as in StorageArrayProductWiring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSource(...segments: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
}

function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

const PAGE_KEYS: ReadonlyArray<string> = [
  "DATA_OBSERVABILITY_ROOT",
  "DATA_OBSERVABILITY",
  "DATA_OBSERVABILITY_OVERVIEW",
  "DATA_OBSERVABILITY_TABLES",
  "DATA_OBSERVABILITY_TABLES_DROPPED",
  "DATA_OBSERVABILITY_TABLES_UNUSED",
  "DATA_OBSERVABILITY_TABLE_VIEW",
  "DATA_OBSERVABILITY_TABLE_VIEW_COLUMNS",
  "DATA_OBSERVABILITY_TABLE_VIEW_METRICS",
  "DATA_OBSERVABILITY_TABLE_VIEW_TIMELINE",
  "DATA_OBSERVABILITY_TABLE_VIEW_SERVICES",
  "DATA_OBSERVABILITY_TABLE_VIEW_CHECKS",
  "DATA_OBSERVABILITY_CHECKS",
  "DATA_OBSERVABILITY_TABLE_VIEW_LINEAGE",
  "DATA_OBSERVABILITY_PIPELINES",
  "DATA_OBSERVABILITY_PIPELINE_VIEW",
  "DATA_OBSERVABILITY_PIPELINE_VIEW_RECOMMENDATIONS",
  "DATA_OBSERVABILITY_TABLE_VIEW_SETTINGS",
  "DATA_OBSERVABILITY_TABLE_VIEW_DELETE",
  "DATA_OBSERVABILITY_STORES",
  "DATA_OBSERVABILITY_STORE_VIEW",
  "DATA_OBSERVABILITY_STORE_VIEW_TABLES",
  "DATA_OBSERVABILITY_STORE_VIEW_RECOMMENDATIONS",
  "DATA_OBSERVABILITY_SCHEMA_CHANGES",
  "DATA_OBSERVABILITY_DOCUMENTATION",
];

// Every key but the lazy mount (/data-observability/*) names a page someone can open.
const NAVIGABLE_PAGE_KEYS: ReadonlyArray<string> = PAGE_KEYS.filter(
  (key: string): boolean => {
    return key !== "DATA_OBSERVABILITY_ROOT";
  },
);

describe("Data Observability product wiring", () => {
  test("every page key is declared in PageMap and routed in RouteMap", () => {
    const pageMap: string = readSource("Utils", "PageMap.ts");
    const routeMap: string = readSource("Utils", "RouteMap.ts");

    for (const key of PAGE_KEYS) {
      expect(pageMap).toContain(`${key} = "${key}",`);
      expect(routeMap).toContain(`[PageMap.${key}]: new Route(`);
    }
  });

  test("the product is mounted under its own lazy route", () => {
    const app: string = squash(readSource("App.tsx"));

    expect(app).toContain('return import("./Routes/DataObservabilityRoutes");');

    // One route mounts the product's root, and it draws the product's routes.
    const rootPath: string = routeMapPath("DATA_OBSERVABILITY_ROOT");

    expect(
      routesAt(pageRoutesIn(path.join(DASHBOARD_SRC, "App.tsx")), rootPath),
    ).toEqual([
      {
        path: rootPath,
        element: "<DataObservabilityRoutes {...commonPageProps} />",
      },
    ]);
    expect(readSource("Routes", "AllRoutes.tsx")).toContain(
      'export { default as DataObservabilityRoutes } from "./DataObservabilityRoutes";',
    );
  });

  test("every navigable page is mounted by the product's routes", () => {
    const routes: string = squash(
      readSource("Routes", "DataObservabilityRoutes.tsx"),
    );

    for (const key of NAVIGABLE_PAGE_KEYS) {
      if (key === "DATA_OBSERVABILITY") {
        // The product's own address opens the Overview, as the index route.
        expect(routes).toContain(
          "RouteMap[PageMap.DATA_OBSERVABILITY] as Route",
        );
        continue;
      }

      expect(routes).toContain(`PageMap.${key}`);
    }
  });

  test("every navigable page has a breadcrumb trail", () => {
    const breadcrumbs: string = readSource(
      "Utils",
      "Breadcrumbs",
      "DataObservabilityBreadcrumbs.ts",
    );

    for (const key of NAVIGABLE_PAGE_KEYS) {
      expect(breadcrumbs).toContain(`PageMap.${key},`);
    }
  });

  test("the product menu and the command palette offer it", () => {
    const navigation: string = squash(
      readSource("Utils", "NavigationItems.tsx"),
    );

    expect(navigation).toContain(
      't("navbar.items.dataObservabilityTitle", "Data Observability")',
    );
    expect(navigation).toContain(
      "RouteMap[PageMap.DATA_OBSERVABILITY_OVERVIEW] as Route",
    );
    expect(navigation).toContain(
      "activeRoute: RouteMap[PageMap.DATA_OBSERVABILITY]",
    );

    const palette: string = squash(
      readSource("Components", "CommandPalette", "PageSearchIndex.ts"),
    );

    expect(palette).toContain('id: "data-observability"');
    expect(palette).toContain(
      "productPage: PageMap.DATA_OBSERVABILITY_OVERVIEW",
    );
  });

  test("the menu's strings are in the locale files", () => {
    const english: string = readSource("Locales", "en.json");

    expect(english).toContain('"dataObservabilityTitle": "Data Observability"');
    expect(english).toContain('"Connect a Database": "Connect a Database"');
  });
});
