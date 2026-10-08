import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Getting Started tells a new user how to find their way around: the
 * products menu lists its groups as the rows of one list, always opens with
 * the first of them, the essentials, open, and folds every other group into
 * a row. The page names the essentials and the folded groups, so it has to
 * name the ones the menu actually shows. These read the names from the
 * Dashboard's own English locale, the words on the screen, and fail when the
 * page and the menu drift apart.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..", "..");

const GETTING_STARTED: string = fs.readFileSync(
  path.join(
    APP_ROOT,
    "FeatureSet",
    "Docs",
    "Content",
    "en",
    "introduction",
    "getting-started.md",
  ),
  "utf8",
);

const ENGLISH: {
  navbar: {
    categories: Record<string, string>;
    items: Record<string, string>;
  };
} = JSON.parse(
  fs.readFileSync(
    path.join(APP_ROOT, "FeatureSet", "Dashboard", "src", "Locales", "en.json"),
    "utf8",
  ),
);

const NAVIGATION_ITEMS: string = fs.readFileSync(
  path.join(
    APP_ROOT,
    "FeatureSet",
    "Dashboard",
    "src",
    "Utils",
    "NavigationItems.tsx",
  ),
  "utf8",
);

// The section of the page about the products menu.
const SECTION: string = ((): string => {
  const start: number = GETTING_STARTED.indexOf("## Finding your way around");
  expect(start).toBeGreaterThan(-1);
  const next: number = GETTING_STARTED.indexOf("\n## ", start + 1);
  return GETTING_STARTED.slice(start, next === -1 ? undefined : next);
})();

// The essentials, in the catalog's own order, by their English titles.
const ESSENTIAL_TITLE_KEYS: Array<string> = [
  "monitorsTitle",
  "incidentsTitle",
  "alertsTitle",
  "onCallDutyTitle",
  "statusPagesTitle",
  "scheduledMaintenanceTitle",
];

describe("Getting Started explains the products menu", () => {
  test("it says the menu opens with the essentials open and names each of them", () => {
    expect(SECTION).toContain("**Products**");
    expect(SECTION).toContain(
      "always opens with the first of them, the essentials, open",
    );

    for (const key of ESSENTIAL_TITLE_KEYS) {
      const title: string | undefined = ENGLISH.navbar.items[key];
      expect([key, typeof title]).toEqual([key, "string"]);
      expect([key, SECTION.includes(title!)]).toEqual([key, true]);
    }
    // SLOs are read through t() with an English default.
    expect(SECTION).toContain("SLOs");
  });

  test("it names every folded group by the name the menu shows", () => {
    const folded: Array<string> = Object.entries(ENGLISH.navbar.categories)
      .filter(([key]: [string, string]): boolean => {
        return key !== "essentials";
      })
      .map(([, name]: [string, string]): string => {
        return name;
      });

    expect(folded.length).toBeGreaterThanOrEqual(7);
    for (const name of folded) {
      expect([name, SECTION.includes(name)]).toEqual([name, true]);
    }
  });

  test("it promises only what the menu does: search, the current page, memory, the phone", () => {
    expect(SECTION).toContain("Search looks inside the folded groups too");
    expect(SECTION).toContain(
      "The group of the page you are on opens by itself",
    );
    expect(SECTION).toContain("remembers, on your browser");
    expect(SECTION).toContain("On a phone");
    // The search examples are real aliases in the catalog.
    expect(NAVIGATION_ITEMS).toContain('"k8s"');
    expect(NAVIGATION_ITEMS).toContain('"rum"');
  });

  test("it describes every group, the essentials too, as rows of one list that name what they hold", () => {
    expect(SECTION).toContain(
      "The menu lists its groups as the rows of one list",
    );
    expect(SECTION).toContain("is folded into a row of the same list");
    expect(SECTION).toContain(
      "Each row names the products the group holds and says how many.",
    );
    expect(SECTION).toContain("Click a row to open it or fold it");
    expect(SECTION).toContain(
      "every other group as one row that opens on a tap",
    );
    // The folded groups are no longer drawn as single lines of text.
    expect(SECTION).not.toMatch(/folded to one line|Click a line/);
    // Nor are the other groups a list below the essentials, apart from them.
    expect(SECTION).not.toContain("the list below them");
  });

  test("the menu does open on Essentials alone", () => {
    expect(NAVIGATION_ITEMS.replace(/\s+/g, "")).toContain(
      "constmoreMenuCategoriesOpenByDefault:Array<string>=[essentialsCategory];",
    );
  });

  test("it says the essentials are open each time, and what the menu remembers is the other groups", () => {
    expect(SECTION).toContain(
      "The essentials are open again each time you open the menu, even if you folded them.",
    );
    expect(SECTION).toContain(
      "remembers, on your browser, which of the other groups you opened or folded",
    );
    expect(SECTION).toContain("the essentials open at the top");
    // The essentials fold now, so the page no longer says they never do.
    expect(SECTION).not.toContain("never folded away");
  });
});
