import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Inventory product was previously shipped as "Entities": four routes, one
 * table, one detail page, and — critically — a navbar entry that was commented
 * out, so the only way to reach it was to already know the URL. This file pins
 * the wiring that makes it a reachable product, because every piece of it is
 * the sort of thing that breaks silently:
 *
 *   - a missing navbar entry hides the product rather than erroring,
 *   - a route declared in PageMap but never mounted renders a blank page,
 *   - a side-menu link to a route with no breadcrumbs renders a bare header,
 *   - a locale missing the nav key falls back to the raw key string.
 *
 * The App suite runs in a plain Node environment with no React renderer and
 * cannot import the dashboard's route modules (they reach for browser
 * globals), so these are source-level invariants, following the same pattern
 * as EmptyResourceInventoryPages.test.ts. Whitespace is squashed so Prettier
 * can reflow without making the tests brittle.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...segments: Array<string>) => string;

const readSource: ReadSourceFunction = (...segments: Array<string>): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
};

type SquashFunction = (source: string) => string;

const squash: SquashFunction = (source: string): string => {
  return source.replace(/\s+/g, " ");
};

/** All whitespace removed, for assertions Prettier would otherwise reflow. */
const dense: SquashFunction = (source: string): string => {
  return source.replace(/\s+/g, "");
};

/** The PageMap keys the product is built from. */
const INVENTORY_PAGE_KEYS: ReadonlyArray<string> = [
  "INVENTORY_ROOT",
  "INVENTORY",
  "INVENTORY_ITEMS",
  "INVENTORY_DOCUMENTATION",
  "INVENTORY_VIEW_ROOT",
  "INVENTORY_VIEW",
  "INVENTORY_VIEW_RELATIONSHIPS",
  "INVENTORY_VIEW_TELEMETRY",
  "INVENTORY_VIEW_SETTINGS",
  "INVENTORY_VIEW_DELETE",
];

/** Keys that name a real, navigable page (so they need breadcrumbs). */
const NAVIGABLE_PAGE_KEYS: ReadonlyArray<string> = INVENTORY_PAGE_KEYS.filter(
  (key: string): boolean => {
    return key !== "INVENTORY_ROOT" && key !== "INVENTORY_VIEW_ROOT";
  },
);

describe("the old Entities product is gone, not merely hidden", () => {
  test.each([
    ["Pages", "Entities"],
    ["Components", "Entities"],
  ])("the %s/%s directory no longer exists", (...segments: Array<string>) => {
    expect(fs.existsSync(path.join(DASHBOARD_SRC, ...segments))).toBe(false);
  });

  test("EntitiesRoutes.tsx is gone", () => {
    expect(
      fs.existsSync(path.join(DASHBOARD_SRC, "Routes", "EntitiesRoutes.tsx")),
    ).toBe(false);
  });

  test("no ENTITIES_* PageMap key survives", () => {
    /*
     * A leftover key is a route nothing mounts: reachable by URL, renders
     * nothing.
     */
    expect(readSource("Utils", "PageMap.ts")).not.toContain("ENTITIES");
  });

  test("RouteMap no longer serves anything under /entities", () => {
    expect(readSource("Utils", "RouteMap.ts")).not.toContain("/entities");
  });
});

describe("PageMap declares the product", () => {
  const pageMap: string = readSource("Utils", "PageMap.ts");

  test.each(INVENTORY_PAGE_KEYS)("%s is declared", (key: string) => {
    expect(pageMap).toContain(`${key} = "${key}"`);
  });
});

describe("RouteMap gives every page a URL", () => {
  const routeMap: string = squash(readSource("Utils", "RouteMap.ts"));

  test.each(INVENTORY_PAGE_KEYS)("%s has a route", (key: string) => {
    expect(routeMap).toContain(`[PageMap.${key}]: new Route(`);
  });

  test("the product is mounted at /inventory", () => {
    expect(routeMap).toContain("/inventory/*");
  });

  test("detail pages sit under /inventory/item", () => {
    /*
     * A detail route directly beneath the product root would let an id
     * shadow a list page — /inventory/overview would be ambiguous with
     * /inventory/:modelId.
     */
    expect(routeMap).toContain("[PageMap.INVENTORY_VIEW]: `item/");
  });

  test("the view root is the view route minus its id segment", () => {
    /*
     * ModelTable appends a row id to viewPageRoute, so a view root that
     * still carried the `:modelId` segment would send every "View" click to
     * a 404.
     */
    const start: number = routeMap.indexOf(
      "[PageMap.INVENTORY_VIEW_ROOT]: new Route(",
    );

    expect(start).toBeGreaterThan(-1);

    const declaration: string = routeMap.slice(start, start + 160);

    expect(declaration).toContain("/inventory/item`");
    expect(declaration).not.toContain("ModelID");
  });
});

describe("every route is actually mounted", () => {
  const routes: string = squash(readSource("Routes", "InventoryRoutes.tsx"));

  test.each(NAVIGABLE_PAGE_KEYS)(
    "%s is rendered by a PageRoute",
    (key: string) => {
      expect(routes).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("the product root renders the Overview by default", () => {
    // Otherwise a link to /inventory lands on a blank layout.
    expect(routes).toContain("<PageRoute index element={ <InventoryOverview");
  });

  test("the detail routes are nested under the item view layout", () => {
    expect(routes).toContain("element={<InventoryItemViewLayout");
  });

  test("AllRoutes exports the product and no longer exports the old one", () => {
    const allRoutes: string = readSource("Routes", "AllRoutes.tsx");

    expect(allRoutes).toContain(
      'export { default as InventoryRoutes } from "./InventoryRoutes";',
    );
    expect(allRoutes).not.toContain("EntitiesRoutes");
  });

  test("App.tsx mounts the product router at the product root", () => {
    const app: string = squash(readSource("App.tsx"));

    expect(app).toContain("RouteMap[PageMap.INVENTORY_ROOT]");
    expect(app).toContain("<InventoryRoutes {...commonPageProps} />");
    expect(app).not.toContain("EntitiesRoutes");
  });
});

describe("every navigable page has breadcrumbs", () => {
  const breadcrumbs: string = squash(
    readSource("Utils", "Breadcrumbs", "InventoryBreadcrumbs.ts"),
  );

  test.each(NAVIGABLE_PAGE_KEYS)("%s has a breadcrumb trail", (key: string) => {
    expect(breadcrumbs).toContain(`PageMap.${key}`);
  });

  test("every trail starts at the project and names the product", () => {
    const trails: Array<string> =
      breadcrumbs.match(/\[ "Project",[^\]]*\]/g) || [];

    expect(trails.length).toBe(NAVIGABLE_PAGE_KEYS.length);

    for (const trail of trails) {
      expect(trail).toContain('"Inventory"');
    }
  });

  test("the breadcrumb module is exported from the barrel", () => {
    /*
     * The layouts import `getInventoryBreadcrumbs` from the barrel; an
     * unexported module compiles fine everywhere except the import site.
     */
    expect(readSource("Utils", "Breadcrumbs", "index.ts")).toContain(
      './InventoryBreadcrumbs"',
    );
  });
});

describe("the side menu reaches the whole product", () => {
  const sideMenu: string = squash(
    readSource("Pages", "Inventory", "SideMenu.tsx"),
  );

  test.each(["INVENTORY", "INVENTORY_ITEMS", "INVENTORY_DOCUMENTATION"])(
    "links to %s",
    (key: string) => {
      expect(sideMenu).toContain(`RouteMap[PageMap.${key}]`);
    },
  );

  test("offers the stale drill-down as a first-class destination", () => {
    expect(sideMenu).toContain("staleOnly: true");
  });

  test("builds its scoped links through the shared scope builder", () => {
    // A hand-written query string here is how the params drift apart.
    expect(sideMenu).toContain("buildInventoryScopeQueryString");
  });

  test("the item side menu links to every detail tab", () => {
    const itemSideMenu: string = squash(
      readSource("Pages", "Inventory", "View", "SideMenu.tsx"),
    );

    for (const key of [
      "INVENTORY_VIEW",
      "INVENTORY_VIEW_RELATIONSHIPS",
      "INVENTORY_VIEW_TELEMETRY",
      "INVENTORY_VIEW_SETTINGS",
      "INVENTORY_VIEW_DELETE",
    ]) {
      expect(itemSideMenu).toContain(`RouteMap[PageMap.${key}]`);
    }
  });

  test("Settings and Delete are gated on the item being editable", () => {
    /*
     * Editing a discovered row is overwritten on its next reconcile and
     * deleting it only clears it until it reappears. Offering both anyway
     * teaches people that the product's buttons do not work.
     */
    const itemSideMenu: string = squash(
      readSource("Pages", "Inventory", "View", "SideMenu.tsx"),
    );

    expect(itemSideMenu).toContain("if (props.canEdit) {");

    const gated: string = itemSideMenu.slice(
      itemSideMenu.indexOf("if (props.canEdit) {"),
    );

    expect(gated).toContain("INVENTORY_VIEW_SETTINGS");
    expect(gated).toContain("INVENTORY_VIEW_DELETE");
  });

  test("the layout derives canEdit from the source, not from the type", () => {
    expect(
      squash(readSource("Pages", "Inventory", "View", "Layout.tsx")),
    ).toContain("isDeletePermanentForSource");
  });
});

describe("the navbar link exists and is not commented out", () => {
  const navBarRaw: string = readSource("Components", "NavBar", "NavBar.tsx");
  const navBar: string = squash(navBarRaw);

  test("there is a live Inventory entry", () => {
    expect(dense(navBarRaw)).toContain('t("navbar.items.inventoryTitle"');
    expect(dense(navBarRaw)).toContain('t("navbar.items.inventoryDescription"');
  });

  test("the entry routes to the product", () => {
    expect(navBar).toContain("RouteMap[PageMap.INVENTORY] as Route");
  });

  test("the item list and detail pages keep the entry highlighted", () => {
    expect(navBar).toContain("RouteMap[PageMap.INVENTORY_ITEMS] as Route");
    expect(navBar).toContain("RouteMap[PageMap.INVENTORY_VIEW] as Route");
  });

  test("no commented-out Entities entry is left behind", () => {
    expect(navBarRaw).not.toContain("entitiesTitle");
    expect(navBarRaw).not.toContain("PageMap.ENTITIES");
  });

  test("the entry is not inside a block comment", () => {
    /*
     * The bug this replaces: the entry existed, fully written, wrapped in
     * `/* ... *\/`. Stripping comments before searching is the only way to
     * tell the two states apart.
     */
    const withoutComments: string = squash(
      navBarRaw
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1"),
    );

    expect(withoutComments).toContain('t("navbar.items.inventoryTitle"');
  });
});

describe("the navbar entry is translated everywhere", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

  const localeFiles: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  test("there are locale files to check", () => {
    expect(localeFiles.length).toBeGreaterThan(1);
  });

  test.each(localeFiles)(
    "%s carries the inventory nav keys",
    (file: string) => {
      const contents: Record<string, any> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      );

      const items: Record<string, string> = contents["navbar"]?.["items"] || {};

      expect(typeof items["inventoryTitle"]).toBe("string");
      expect(items["inventoryTitle"]!.length).toBeGreaterThan(0);
      expect(typeof items["inventoryDescription"]).toBe("string");
      expect(items["inventoryDescription"]!.length).toBeGreaterThan(0);
    },
  );

  test.each(localeFiles)(
    "%s no longer carries the old entities keys",
    (file: string) => {
      const contents: Record<string, any> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      );

      const items: Record<string, string> = contents["navbar"]?.["items"] || {};

      expect(items["entitiesTitle"]).toBeUndefined();
      expect(items["entitiesDescription"]).toBeUndefined();
    },
  );
});

describe("cross-links from other products point at the new routes", () => {
  test("the topology panel opens the inventory detail page", () => {
    const panel: string = squash(
      readSource("Components", "Topology", "EntityDetailPanel.tsx"),
    );

    expect(panel).toContain("RouteMap[PageMap.INVENTORY_VIEW]");
    expect(panel).not.toContain("PageMap.ENTITIES_VIEW");
  });
});
