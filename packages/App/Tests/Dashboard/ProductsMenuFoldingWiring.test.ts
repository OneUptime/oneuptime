import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Dashboard's products menu opens on Essentials and folds every other
 * section to one line (Common/UI/Components/Navbar/NavBarMenuCatalog.ts).
 * The folding itself is the shared menu's; which sections the menu opens on
 * is the Dashboard's decision, made once in its navigation catalog and passed
 * down. Each link of that chain fails quietly - a menu that is simply not
 * folded - so these pin it:
 *
 *   - the catalog names Essentials, by the same translated name its items
 *     carry, as the one section to open on;
 *   - the Dashboard navbar hands that to the shared NavBar (desktop dialog
 *     and phone menu alike);
 *   - the offline browser fixture passes it the same way, so the Playwright
 *     suite exercises the menu users see;
 *   - the Admin Dashboard, five entries in four sections, folds nothing;
 *   - the command palette, which searches the same catalog, stays a flat
 *     search (folding is the menu's business, not the catalog's).
 *
 * The App suite runs in plain Node and cannot import dashboard components, so
 * these are source-level invariants with whitespace squashed. The rendered
 * behaviour is pinned in Common/Tests/UI/Components/NavBarMenuFolding.test.tsx,
 * Common/Tests/App/Dashboard/ProductOrientation.test.tsx and
 * DashboardPhoneProductsMenu.test.tsx.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const PACKAGES_ROOT: string = path.join(APP_ROOT, "..");

const read: (...segments: Array<string>) => string = (
  ...segments: Array<string>
): string => {
  return fs.readFileSync(path.join(...segments), "utf8");
};

const dense: (source: string) => string = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, "");
};

const NAVIGATION_ITEMS: string = dense(
  read(
    APP_ROOT,
    "FeatureSet",
    "Dashboard",
    "src",
    "Utils",
    "NavigationItems.tsx",
  ),
);
const DASHBOARD_NAVBAR: string = dense(
  read(
    APP_ROOT,
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "NavBar",
    "NavBar.tsx",
  ),
);
const ADMIN_NAVBAR: string = dense(
  read(
    APP_ROOT,
    "FeatureSet",
    "AdminDashboard",
    "src",
    "Components",
    "NavBar",
    "NavBar.tsx",
  ),
);
const COMMAND_PALETTE: string = dense(
  read(
    APP_ROOT,
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "CommandPalette",
    "DashboardCommandPalette.tsx",
  ),
);
const E2E_FIXTURE: string = dense(
  read(PACKAGES_ROOT, "E2E", "NavigationSearch", "Fixture.js"),
);
const COMMON_NAVBAR: string = dense(
  read(PACKAGES_ROOT, "Common", "UI", "Components", "Navbar", "NavBar.tsx"),
);

describe("the Dashboard's products menu opens on Essentials", () => {
  test("the catalog names Essentials, by its translated name, as the one section to open on", () => {
    expect(NAVIGATION_ITEMS).toContain(
      'constessentialsCategory:string=t("navbar.categories.essentials");',
    );
    expect(NAVIGATION_ITEMS).toContain(
      "constmoreMenuCategoriesOpenByDefault:Array<string>=[essentialsCategory];",
    );
    expect(NAVIGATION_ITEMS).toContain(
      "moreMenuCategoriesOpenByDefault:Array<string>;",
    );
    expect(NAVIGATION_ITEMS).toMatch(
      /return\{navItems,moreMenuItems,moreMenuCategoriesOpenByDefault,rightElement,?\};/,
    );
  });

  test("Essentials is the section of the first products in the catalog", () => {
    const firstCategory: RegExpMatchArray | null = NAVIGATION_ITEMS.match(
      /constmoreMenuItems:MoreMenuItem\[\]=\[[\s\S]*?category:(\w+),/,
    );

    expect(firstCategory?.[1]).toBe("essentialsCategory");
  });

  test("the Dashboard navbar hands it to the shared NavBar", () => {
    expect(DASHBOARD_NAVBAR).toContain(
      "moreMenuCategoriesOpenByDefault,rightElement,}:DashboardNavigationItems=useDashboardNavigationItems();",
    );
    expect(DASHBOARD_NAVBAR).toContain(
      "moreMenuCategoriesOpenByDefault={moreMenuCategoriesOpenByDefault}",
    );
  });

  test("the shared NavBar passes it to the desktop dialog and the phone menu", () => {
    expect(COMMON_NAVBAR).toContain(
      "categoriesOpenByDefault={props.moreMenuCategoriesOpenByDefault}",
    );
    expect(
      COMMON_NAVBAR.split(
        "categoriesOpenByDefault={props.moreMenuCategoriesOpenByDefault}",
      ),
    ).toHaveLength(3);
    expect(COMMON_NAVBAR).toContain("<NavBarMobileMenu");
    expect(COMMON_NAVBAR).toContain("<NavBarMenuModal");
  });

  test("the offline browser fixture opens the menu the way the Dashboard does", () => {
    expect(E2E_FIXTURE).toContain(
      "const{moreMenuItems,moreMenuCategoriesOpenByDefault}=useDashboardNavigationItems();",
    );
    expect(E2E_FIXTURE).toContain(
      "categoriesOpenByDefault={moreMenuCategoriesOpenByDefault}",
    );
  });
});

describe("menus that keep every section open", () => {
  test("the Admin Dashboard names no sections to open on", () => {
    expect(ADMIN_NAVBAR).toContain("<NavBar");
    expect(ADMIN_NAVBAR).not.toContain("CategoriesOpenByDefault");
  });

  test("the command palette searches the catalog without folding it", () => {
    expect(COMMAND_PALETTE).toContain("useDashboardNavigationItems()");
    expect(COMMAND_PALETTE).not.toContain("moreMenuCategoriesOpenByDefault");
  });
});
