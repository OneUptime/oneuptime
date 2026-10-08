import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsLink,
  DocsPageLink,
  NAV_PAGES,
  anchorsOf,
  listPages,
  parseDocsLink,
  scanPage,
} from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Links into the docs land where they point, so a page rewritten or a
 * heading renamed by the docs overhaul cannot quietly break one:
 *
 *   - every link in an English page to a docs page names a page the nav
 *     lists, and every #anchor it names - on another page or its own - is a
 *     heading of the English page it lands on;
 *   - every /docs/<category>/<page>[#anchor] written into the product - the
 *     dashboards, the status page, emails and notifications, the website -
 *     names a page the nav lists and, with an anchor, a heading of it.
 *
 * Translated pages are held to the same rule by the content-wide tests once
 * they are translated again from the rewritten English pages.
 */

const REPOSITORY: string = path.resolve(__dirname, "../../../../..");

const englishPages: Array<string> = listPages("en");

describe("English docs pages", () => {
  it("link only to pages the nav lists", () => {
    const broken: Array<string> = [];

    for (const page of englishPages) {
      for (const link of scanPage("en", page).links) {
        const target: DocsPageLink | null = parseDocsLink(
          (link as DocsLink).target,
        );
        if (target && !NAV_PAGES.includes(target.page)) {
          broken.push(`${page}:${link.line} -> ${link.target}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it("link to anchors the English page they land on has", () => {
    const broken: Array<string> = [];

    for (const page of englishPages) {
      for (const link of scanPage("en", page).links) {
        const target: DocsPageLink | null = link.target.startsWith("#")
          ? {
              page: page,
              anchor: decodeURIComponent(link.target.slice(1)),
            }
          : parseDocsLink(link.target);

        if (
          !target ||
          target.anchor === null ||
          target.anchor === "" ||
          !NAV_PAGES.includes(target.page)
        ) {
          continue;
        }

        if (!anchorsOf("en", target.page).has(target.anchor)) {
          broken.push(`${page}:${link.line} -> ${link.target}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });
});

/*
 * Literal links in the product's own sources. A link built at run time from
 * parts (DOCS_URL plus a path constant) is not seen here; the page tests of
 * those screens pin theirs.
 */
const PRODUCT_SOURCE_ROOTS: Array<string> = [
  "packages/App/FeatureSet",
  "packages/Common/UI",
  "packages/Common/Types",
  "packages/Common/Server",
  "packages/Common/Utils",
  "packages/Common/Models",
  "packages/Home",
];
const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  ".git",
  // The docs themselves: their links are checked above.
  path.join("packages", "App", "FeatureSet", "Docs"),
];
const SOURCE_FILE: RegExp = /\.(?:tsx?|ejs|json)$/;
const SKIPPED_FILES: Array<string> = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];
// A docs address a reader can open: after a quote, a bracket, "=", a space or the site's host.
const PRODUCT_DOCS_LINK: RegExp =
  /(?:["'`(=\s]|oneuptime\.com)\/docs\/([A-Za-z0-9-]+)\/([a-z0-9][a-z0-9-]*)(?:\/([a-z0-9][a-z0-9-]*))?(?:#([^\s"'`)<>\]]+))?/g;
const NOT_PAGES: Array<string> = ["static", "as-markdown", "search-index"];
const TRAILING_PUNCTUATION: RegExp = /[.,;:!?]+$/;

const productFiles: () => Array<string> = (): Array<string> => {
  const files: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);
      const relative: string = path.relative(REPOSITORY, full);
      if (entry.isDirectory()) {
        if (
          !SKIPPED_DIRECTORIES.includes(entry.name) &&
          !SKIPPED_DIRECTORIES.includes(relative)
        ) {
          walk(full);
        }
      } else if (
        SOURCE_FILE.test(entry.name) &&
        !SKIPPED_FILES.includes(entry.name)
      ) {
        files.push(full);
      }
    }
  };
  for (const root of PRODUCT_SOURCE_ROOTS) {
    const full: string = path.join(REPOSITORY, root);
    if (fs.existsSync(full)) {
      walk(full);
    }
  }
  return files;
};

interface ProductDocsLink {
  file: string;
  link: string;
  page: string;
  anchor: string | null;
}

const productLinks: Array<ProductDocsLink> = productFiles().flatMap(
  (file: string): Array<ProductDocsLink> => {
    const text: string = fs.readFileSync(file, "utf8");
    if (!text.includes("/docs/")) {
      return [];
    }
    const links: Array<ProductDocsLink> = [];
    for (const match of text.matchAll(PRODUCT_DOCS_LINK)) {
      let category: string = match[1]!;
      let page: string = match[2]!;
      // A link with a language: /docs/<lang>/<category>/<page>.
      if (SUPPORTED_DOCS_LANGUAGE_CODES.includes(category)) {
        if (!match[3]) {
          continue;
        }
        category = match[2]!;
        page = match[3];
      } else if (match[3]) {
        // Deeper than a page: not a docs page address.
        continue;
      }
      if (NOT_PAGES.includes(category)) {
        continue;
      }
      const anchor: string | null = match[4]
        ? match[4].replace(TRAILING_PUNCTUATION, "")
        : null;
      links.push({
        file: path.relative(REPOSITORY, file),
        link: match[0].trim(),
        page: `${category}/${page}`,
        anchor: anchor || null,
      });
    }
    return links;
  },
);

describe("docs links in the product", () => {
  it("are found, so the checks below check something", () => {
    // The dashboard links to its docs from setup guides, empty states and help.
    expect(productLinks.length).toBeGreaterThan(50);
  });

  it("name pages the nav lists", () => {
    const broken: Array<string> = productLinks
      .filter((link: ProductDocsLink): boolean => {
        return !NAV_PAGES.includes(link.page);
      })
      .map((link: ProductDocsLink): string => {
        return `${link.file}: ${link.link}`;
      });

    expect(broken).toEqual([]);
  });

  it("name headings those pages have", () => {
    const broken: Array<string> = productLinks
      .filter((link: ProductDocsLink): boolean => {
        return (
          link.anchor !== null &&
          NAV_PAGES.includes(link.page) &&
          !anchorsOf("en", link.page).has(decodeURIComponent(link.anchor))
        );
      })
      .map((link: ProductDocsLink): string => {
        return `${link.file}: ${link.link}`;
      });

    expect(broken).toEqual([]);
  });
});
