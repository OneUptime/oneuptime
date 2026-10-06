import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Dashboard's products menu always opens on Essentials, which never
 * fold, and folds every other section to one line
 * (Common/UI/Components/Navbar/NavBarMenuCatalog.ts). The folding itself is
 * the shared menu's; which sections are always open is the Dashboard's
 * decision, made once in its navigation catalog and passed down. Each link
 * of that chain fails quietly - a menu that is simply not folded, or one
 * whose Essentials fold away - so these pin it:
 *
 *   - the catalog names Essentials, by the same translated name its items
 *     carry, as the one section that is always open;
 *   - the Dashboard navbar hands that to the shared NavBar (desktop dialog
 *     and phone menu alike);
 *   - the offline browser fixture passes it the same way, so the Playwright
 *     suite exercises the menu users see;
 *   - the catalog gives every folded section an icon of its own, by the
 *     same translated name, and the icons reach both menus the same way;
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
const NAVBAR_MODAL: string = dense(
  read(
    PACKAGES_ROOT,
    "Common",
    "UI",
    "Components",
    "Navbar",
    "NavBarMenuModal.tsx",
  ),
);
const NAVBAR_MOBILE_MENU: string = dense(
  read(
    PACKAGES_ROOT,
    "Common",
    "UI",
    "Components",
    "Navbar",
    "NavBarMobileMenu.tsx",
  ),
);
const NAVBAR_CATALOG: string = dense(
  read(
    PACKAGES_ROOT,
    "Common",
    "UI",
    "Components",
    "Navbar",
    "NavBarMenuCatalog.ts",
  ),
);

/*
 * The name the sections had while Essentials could still be folded: "open
 * by default". They are always open now, and the name says so.
 */
const OLD_NAME: RegExp = /[Oo]penByDefault/;

describe("the Dashboard's products menu always opens on Essentials", () => {
  test("the catalog names Essentials, by its translated name, as the one section that is always open", () => {
    expect(NAVIGATION_ITEMS).toContain(
      'constessentialsCategory:string=t("navbar.categories.essentials");',
    );
    expect(NAVIGATION_ITEMS).toContain(
      "constmoreMenuCategoriesAlwaysOpen:Array<string>=[essentialsCategory];",
    );
    expect(NAVIGATION_ITEMS).toContain(
      "moreMenuCategoriesAlwaysOpen:Array<string>;",
    );
    expect(NAVIGATION_ITEMS).toMatch(
      /return\{navItems,moreMenuItems,moreMenuCategoriesAlwaysOpen,moreMenuCategoryIcons,rightElement,?\};/,
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
      "moreMenuCategoriesAlwaysOpen,moreMenuCategoryIcons,rightElement,}:DashboardNavigationItems=useDashboardNavigationItems();",
    );
    expect(DASHBOARD_NAVBAR).toContain(
      "moreMenuCategoriesAlwaysOpen={moreMenuCategoriesAlwaysOpen}",
    );
  });

  test("the shared NavBar passes it to the desktop dialog and the phone menu", () => {
    expect(COMMON_NAVBAR).toContain(
      "categoriesAlwaysOpen={props.moreMenuCategoriesAlwaysOpen}",
    );
    expect(
      COMMON_NAVBAR.split(
        "categoriesAlwaysOpen={props.moreMenuCategoriesAlwaysOpen}",
      ),
    ).toHaveLength(3);
    expect(COMMON_NAVBAR).toContain("<NavBarMobileMenu");
    expect(COMMON_NAVBAR).toContain("<NavBarMenuModal");
  });

  test("the offline browser fixture opens the menu the way the Dashboard does", () => {
    expect(E2E_FIXTURE).toContain(
      "const{moreMenuItems,moreMenuCategoriesAlwaysOpen,moreMenuCategoryIcons}=useDashboardNavigationItems();",
    );
    expect(E2E_FIXTURE).toContain(
      "categoriesAlwaysOpen={moreMenuCategoriesAlwaysOpen}",
    );
  });

  test("both menus give the sections that are always open no fold control", () => {
    /*
     * The desktop dialog folds a section only when the shared rules say it
     * can, and the phone menu draws the fold control only then too; the
     * rules themselves are pinned in NavBarMenuCatalog.test.tsx.
     */
    expect(NAVBAR_MODAL).toContain(
      "constcanFold:boolean=!isSearching&&!group.isRecent&&folds.canFold(group.title);",
    );
    expect(NAVBAR_MOBILE_MENU).toContain(
      "constcanFold:boolean=folds.canFold(category.title);",
    );
    expect(NAVBAR_MOBILE_MENU).toContain("{canFold?(<NavBarCategoryToggle");
    expect(NAVBAR_CATALOG).toContain(
      "if(!canCategoryFold(category,state)){returntrue;}",
    );
    expect(NAVBAR_CATALOG).toContain("if(!canFold(category)){return;}");
  });

  test("the old name, which said the sections were only open by default, is gone", () => {
    const sources: Array<[string, string]> = [
      ["NavigationItems.tsx", NAVIGATION_ITEMS],
      ["Dashboard NavBar.tsx", DASHBOARD_NAVBAR],
      ["Common NavBar.tsx", COMMON_NAVBAR],
      ["NavBarMenuModal.tsx", NAVBAR_MODAL],
      ["NavBarMobileMenu.tsx", NAVBAR_MOBILE_MENU],
      ["NavBarMenuCatalog.ts", NAVBAR_CATALOG],
      ["Fixture.js", E2E_FIXTURE],
    ];

    for (const [file, source] of sources) {
      expect([file, OLD_NAME.test(source)]).toEqual([file, false]);
    }
  });
});

describe("every folded section is drawn with an icon of its own", () => {
  // The sections of the catalog, by the variable their translated name is in.
  const SECTION_VARIABLES: Array<string> = Array.from(
    new Set(
      Array.from(
        NAVIGATION_ITEMS.matchAll(/category:(\w+Category),/g),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ),
  );

  // The body of the catalog's map of icons.
  const ICONS: string = ((): string => {
    const match: RegExpMatchArray | null = NAVIGATION_ITEMS.match(
      /constmoreMenuCategoryIcons:Dictionary<IconProp>=\{([^}]*)\};/,
    );
    expect(match).not.toBeNull();
    return match![1]!;
  })();

  test("the scan finds the catalog's sections, so the checks below are not vacuous", () => {
    expect(SECTION_VARIABLES).toEqual([
      "essentialsCategory",
      "observabilityCategory",
      "aiCategory",
      "codeCategory",
      "resourcesCategory",
      "infrastructureCategory",
      "analyticsAutomationCategory",
      "settingsCategory",
    ]);
  });

  test("the catalog gives one to every section that folds, keyed by the name its items carry", () => {
    for (const section of SECTION_VARIABLES) {
      const hasIcon: boolean = ICONS.includes(`[${section}]:IconProp.`);
      // Essentials never fold, so they have no row to draw an icon on.
      expect([section, hasIcon]).toEqual([
        section,
        section !== "essentialsCategory",
      ]);
    }
  });

  test("it hands them over with the rest of the catalog", () => {
    expect(NAVIGATION_ITEMS).toContain(
      "moreMenuCategoryIcons:Dictionary<IconProp>;",
    );
  });

  test("the Dashboard navbar hands them to the shared NavBar", () => {
    expect(DASHBOARD_NAVBAR).toContain(
      "moreMenuCategoryIcons={moreMenuCategoryIcons}",
    );
  });

  test("the shared NavBar passes them to the desktop dialog and the phone menu", () => {
    expect(
      COMMON_NAVBAR.split("categoryIcons={props.moreMenuCategoryIcons}"),
    ).toHaveLength(3);
  });

  test("both menus look the icon up by the section's name and give it to the section's row", () => {
    expect(NAVBAR_MODAL).toContain("icon={props.categoryIcons?.[group.title]}");
    expect(NAVBAR_MOBILE_MENU).toContain(
      "icon={props.categoryIcons?.[category.title]}",
    );
  });

  test("the offline browser fixture draws them the way the Dashboard does", () => {
    expect(E2E_FIXTURE).toContain("categoryIcons={moreMenuCategoryIcons}");
  });
});

describe("menus that keep every section open", () => {
  test("the Admin Dashboard names no sections to keep open", () => {
    expect(ADMIN_NAVBAR).toContain("<NavBar");
    expect(ADMIN_NAVBAR).not.toContain("CategoriesAlwaysOpen");
    // Nothing folds there, so no row needs an icon.
    expect(ADMIN_NAVBAR).not.toContain("CategoryIcons");
    expect(OLD_NAME.test(ADMIN_NAVBAR)).toBe(false);
  });

  test("the command palette searches the catalog without folding it", () => {
    expect(COMMAND_PALETTE).toContain("useDashboardNavigationItems()");
    expect(COMMAND_PALETTE).not.toContain("moreMenuCategoriesAlwaysOpen");
    expect(COMMAND_PALETTE).not.toContain("moreMenuCategoryIcons");
    expect(OLD_NAME.test(COMMAND_PALETTE)).toBe(false);
  });
});
