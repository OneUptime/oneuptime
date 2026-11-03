import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every product's side menus share one Developer section (the Dashboard's
 * Components/DeveloperDocs: DEVELOPER_DOCS_PAGES), so a docs line that lists
 * that section's pages lists all of them, in the menu's order. #5581 put
 * CLI between API and AI Assistants, and the eleven lines that listed
 * "Terraform, API and AI Assistants" went on saying so in every language.
 *
 * A line lists the section when it names the section's first two pages and
 * its last one in bold, as the Dashboard draws them in that language
 * (Locales/<language>.json) or in English.
 */

const APP: string = path.resolve(__dirname, "../../..");
const CONTENT: string = path.join(APP, "FeatureSet/Docs/Content");
const LOCALES: string = path.join(APP, "FeatureSet/Dashboard/src/Locales");
const PAGES_SOURCE: string = fs.readFileSync(
  path.join(
    APP,
    "FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages.ts",
  ),
  "utf8",
);

const BOLD: RegExp = /\*\*([^*]+)\*\*/g;

// The Developer pages' titles, in the menu's order.
function developerPageTitles(): Array<string> {
  const start: number = PAGES_SOURCE.indexOf(
    "export const DEVELOPER_DOCS_PAGES",
  );
  const end: number = PAGES_SOURCE.indexOf("];", start);

  return Array.from(
    PAGES_SOURCE.slice(start, end).matchAll(/title: "([^"]+)"/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
}

function languages(): Array<string> {
  return fs
    .readdirSync(CONTENT, { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => {
      return entry.isDirectory();
    })
    .map((entry: fs.Dirent): string => {
      return entry.name;
    })
    .sort();
}

function pagesOf(language: string): Array<string> {
  const pages: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        pages.push(
          path
            .relative(path.join(CONTENT, language), full)
            .split(path.sep)
            .join("/"),
        );
      }
    }
  };

  walk(path.join(CONTENT, language));

  return pages.sort();
}

// Each page title as this language's Dashboard draws it, and in English.
function drawnTitles(
  language: string,
  titles: Array<string>,
): Array<Array<string>> {
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  );

  return titles.map((title: string): Array<string> => {
    return Array.from(new Set([locale[title] || title, title]));
  });
}

interface DeveloperListing {
  where: string;
  line: string;
  // Where each Developer page is among the line's bold names (-1: not named).
  places: Array<number>;
}

// The lines of a language's docs that list the Developer section's pages.
function developerListings(language: string): Array<DeveloperListing> {
  const titles: Array<Array<string>> = drawnTitles(
    language,
    developerPageTitles(),
  );
  const listings: Array<DeveloperListing> = [];

  for (const page of pagesOf(language)) {
    const lines: Array<string> = fs
      .readFileSync(path.join(CONTENT, language, ...page.split("/")), "utf8")
      .split("\n");

    lines.forEach((line: string, index: number): void => {
      const bold: Array<string> = Array.from(line.matchAll(BOLD)).map(
        (match: RegExpMatchArray): string => {
          return (match[1] as string).trim();
        },
      );
      const places: Array<number> = titles.map(
        (names: Array<string>): number => {
          return bold.findIndex((name: string): boolean => {
            return names.includes(name);
          });
        },
      );

      if (
        (places[0] as number) < 0 ||
        (places[1] as number) < 0 ||
        (places[places.length - 1] as number) < 0
      ) {
        return;
      }

      listings.push({
        where: `${language}/${page}:${index + 1}`,
        line: line.trim(),
        places: places,
      });
    });
  }

  return listings;
}

const LANGUAGES: Array<string> = languages();
const ENGLISH_LISTINGS: Array<DeveloperListing> = developerListings("en");

describe("docs that list the Developer section name every page of it", () => {
  test("the section's pages are read from the Dashboard, CLI among them", () => {
    const titles: Array<string> = developerPageTitles();

    expect(titles).toContain("CLI");
    expect(titles[0]).toBe("Terraform");
    expect(titles[1]).toBe("API");
    expect(titles[titles.length - 1]).toBe("AI Assistants");
    // The CLI after the API it is a command line for.
    expect(titles.indexOf("CLI")).toBe(titles.indexOf("API") + 1);
  });

  test("every docs language has a Dashboard locale to name the pages with", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(17);

    for (const language of LANGUAGES) {
      expect({
        language: language,
        locale: fs.existsSync(path.join(LOCALES, `${language}.json`)),
      }).toEqual({ language: language, locale: true });
    }
  });

  test("the English docs list the section on the pages of each product that has it", () => {
    const pages: Array<string> = ENGLISH_LISTINGS.map(
      (listing: DeveloperListing): string => {
        return listing.where.replace(/:\d+$/, "");
      },
    );

    for (const page of [
      "en/alerts/index.md",
      "en/alerts/episodes.md",
      "en/incidents/index.md",
      "en/on-call/index.md",
      "en/on-call/policies.md",
      "en/rum/index.md",
      "en/runbooks/index.md",
      "en/scheduled-maintenance/index.md",
      "en/status-pages/index.md",
      "en/telemetry/services.md",
    ]) {
      expect(pages).toContain(page);
    }
  });

  test.each(LANGUAGES)(
    "%s: a line that lists the section names all its pages, in the menu's order",
    (language: string) => {
      const listings: Array<DeveloperListing> = developerListings(language);
      const incomplete: Array<string> = listings
        .filter((listing: DeveloperListing): boolean => {
          const sorted: Array<number> = [...listing.places].sort(
            (a: number, b: number): number => {
              return a - b;
            },
          );

          return (
            listing.places.includes(-1) ||
            listing.places.join() !== sorted.join()
          );
        })
        .map((listing: DeveloperListing): string => {
          return `${listing.where}: ${listing.line}`;
        });

      expect(incomplete).toEqual([]);
      // The translated pages line up with the English ones, line for line.
      expect(
        listings.map((listing: DeveloperListing): string => {
          return listing.where.replace(`${language}/`, "");
        }),
      ).toEqual(
        ENGLISH_LISTINGS.map((listing: DeveloperListing): string => {
          return listing.where.replace("en/", "");
        }),
      );
    },
  );
});
