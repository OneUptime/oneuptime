import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every product's side menu used to list Archived in its main section, beside
 * the list it comes from. The maintainer asked for it to move into an
 * Advanced section, collapsed by default, everywhere, so the menus now say
 * Workflows → Advanced → Archived, Status Pages → Advanced → Archived, and so
 * on. Markdown is not compiled, so nothing else notices a doc that still
 * sends readers to where the entry used to be.
 *
 * Every page in every language: a bold menu path that ends at an Archived
 * page goes through Advanced. And the pages that tell readers where their
 * archived things are say so, in English and in Persian (whose pages name the
 * UI in English, as here).
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

function markdownFilesUnder(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...markdownFilesUnder(entryPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

/*
 * A bold menu path that ends at an Archived page, such as
 * **Workflows → Archived** or **Inventory → Advanced → Archived**.
 */
const ARCHIVED_MENU_PATH: RegExp = /\*\*([^*\n]*→\s*Archived[^*\n]*)\*\*/g;

const THROUGH_ADVANCED: RegExp = /(^|→\s*)Advanced\s*→\s*Archived/;

interface MenuPathMention {
  page: string;
  menuPath: string;
}

function archivedMenuPaths(): Array<MenuPathMention> {
  return markdownFilesUnder(CONTENT_DIR).flatMap(
    (file: string): Array<MenuPathMention> => {
      const page: string = path.relative(CONTENT_DIR, file);

      return Array.from(
        fs.readFileSync(file, "utf8").matchAll(ARCHIVED_MENU_PATH),
      ).map((match: RegExpMatchArray): MenuPathMention => {
        return { page, menuPath: match[1]!.trim() };
      });
    },
  );
}

/*
 * The pages that say where a product's archived things are, and the menu path
 * each must give.
 */
const PAGES_NAMING_THE_PATH: ReadonlyArray<[string, string]> = [
  ["en/workflows/configuration.md", "**Workflows → Advanced → Archived**"],
  ["en/workflows/index.md", "**Advanced → Archived**"],
  ["en/status-pages/index.md", "**Status Pages → Advanced → Archived**"],
  ["en/dashboards/index.md", "**Advanced → Archived**"],
  ["en/dashboards/configuration.md", "**Dashboards → Advanced → Archived**"],
  ["en/rum/applications.md", "**RUM → Advanced → Archived**"],
  ["en/inventory/overview.md", "**Inventory → Advanced → Archived**"],
  ["fa/rum/applications.md", "**RUM → Advanced → Archived**"],
  ["fa/inventory/overview.md", "**Inventory → Advanced → Archived**"],
];

describe("docs send readers to Archived through Advanced", () => {
  it("finds the menu paths to check", () => {
    // Workflows (2), Status Pages (2), Dashboards, RUM (2), Inventory (3).
    expect(archivedMenuPaths().length).toBeGreaterThanOrEqual(10);
  });

  it("every bold menu path to an Archived page goes through Advanced", () => {
    for (const mention of archivedMenuPaths()) {
      expect({ ...mention, throughAdvanced: true }).toEqual({
        ...mention,
        throughAdvanced: THROUGH_ADVANCED.test(mention.menuPath),
      });
    }
  });

  it.each(PAGES_NAMING_THE_PATH)(
    "%s names the path %s",
    (page: string, menuPath: string) => {
      expect(readPage(page)).toContain(menuPath);
    },
  );

  it("the Workflows overview lists Advanced → Archived after Logs → Runs, in the Workflows menu's order", () => {
    const page: string = readPage("en/workflows/index.md");
    const logs: number = page.indexOf("- **Logs → Runs**");
    const archived: number = page.indexOf("- **Advanced → Archived**");

    expect(logs).toBeGreaterThan(-1);
    expect(archived).toBeGreaterThan(logs);
    expect(page).not.toMatch(/^- \*\*Archived\*\*/m);
  });

  it("the Status Pages overview no longer lists Archived beside All Status Pages", () => {
    const page: string = readPage("en/status-pages/index.md");

    expect(page).not.toContain("lists **All Status Pages** and **Archived**");
    expect(page).toContain(
      "A collapsed **Advanced** section holds **Archived**",
    );
  });

  it("the Dashboards page table names Advanced → Archived, not a bare Archived", () => {
    const page: string = readPage("en/dashboards/index.md");

    expect(page).toMatch(/^\| \*\*Advanced → Archived\*\* +\|/m);
    expect(page).not.toMatch(/^\| \*\*Archived\*\* +\|/m);
  });

  it("the SLO page says the Archived page is under Advanced, in English and Persian", () => {
    expect(readPage("en/slo/introduction.md")).toContain(
      "on the **Archived** page, under **Advanced** in the SLO list's side menu",
    );
    expect(readPage("fa/slo/introduction.md")).toContain(
      "در صفحه **Archived**، در بخش **Advanced** منوی کناری فهرست SLOها",
    );
  });

  it("the Inventory page's note about kept custom field values points at Advanced → Archived", () => {
    expect(readPage("en/inventory/overview.md")).toContain(
      "You will find it under **Advanced → Archived** with everything you typed intact.",
    );
  });
});
