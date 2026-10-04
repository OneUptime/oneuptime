import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Getting Started tells a new user how to find their way around: the
 * products menu always opens on the essentials, which never fold, and folds
 * every other group to one line. The page names the essentials and the
 * folded groups, so it has to name the ones the menu actually shows. These
 * read the names from the Dashboard's own English locale, the words on the
 * screen, and fail when the page and the menu drift apart.
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
  test("it says the menu opens on the essentials and names each of them", () => {
    expect(SECTION).toContain("**Products**");
    expect(SECTION).toContain("opens on the essentials");

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

  test("the menu does open on Essentials alone", () => {
    expect(NAVIGATION_ITEMS.replace(/\s+/g, "")).toContain(
      "constmoreMenuCategoriesAlwaysOpen:Array<string>=[essentialsCategory];",
    );
  });

  test("it says the essentials are always there, and what the menu remembers is the other groups", () => {
    expect(SECTION).toContain("always opens on the essentials");
    expect(SECTION).toContain("The essentials are never folded away.");
    expect(SECTION).toContain(
      "remembers, on your browser, which of the other groups you opened or folded",
    );
    // Nothing on the page tells people to fold the essentials.
    expect(SECTION).not.toMatch(/fold(?:ing)? the essentials/i);
  });
});
