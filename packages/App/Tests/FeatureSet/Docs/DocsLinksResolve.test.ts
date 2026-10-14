import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsLink,
  DocsPageLink,
  NAV_PAGES,
  NOT_PAGE_CATEGORIES,
  anchorsOf,
  decodeAnchor,
  listPages,
  parseDocsLink,
  scanPage,
} from "./DocsContentSupport";
import {
  DocsAddress,
  DocsAddressTarget,
  docsAddressesIn,
  targetOfDocsAddress,
} from "Common/Tests/Helpers/DocsAddresses";
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
 *     names a page the nav lists and, with an anchor, a heading of it;
 *   - and none is a category's own address (/docs/terraform): that opens
 *     the category's first page, so a link names the page it means.
 *     (/docs/compliance, /docs/rbac and /docs/api, which are not even
 *     categories, were linked from the website as such addresses and
 *     answered 404 while every check here looked only at pages.)
 *
 * WebsiteDocsLinks follows the website's links through the docs' real
 * routes as well.
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
              anchor: decodeAnchor(link.target.slice(1)),
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
 * Literal links in the product's own sources, read by Common's
 * Tests/Helpers/DocsAddresses. A link built at run time from parts
 * (DOCS_URL plus a path constant) is not seen here; the page tests of those
 * screens pin theirs.
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
  line: number;
  link: string;
  target: DocsAddressTarget;
  // The heading it names, decoded, or null.
  anchor: string | null;
}

const productLinks: Array<ProductDocsLink> = productFiles().flatMap(
  (file: string): Array<ProductDocsLink> => {
    const text: string = fs.readFileSync(file, "utf8");
    if (!text.includes("/docs")) {
      return [];
    }
    return docsAddressesIn(text).map(
      (address: DocsAddress): ProductDocsLink => {
        return {
          file: path.relative(REPOSITORY, file),
          line: address.line,
          link: address.address,
          target: targetOfDocsAddress(address, SUPPORTED_DOCS_LANGUAGE_CODES),
          anchor: address.anchor,
        };
      },
    );
  },
);

const whereOf: (link: ProductDocsLink) => string = (
  link: ProductDocsLink,
): string => {
  return `${link.file}:${link.line}: ${link.link}`;
};

// A link to a page, and the page as "category/page", in lower case as served.
interface ProductPageLink {
  link: ProductDocsLink;
  page: string;
}

const pageLinks: Array<ProductPageLink> = productLinks
  .filter((link: ProductDocsLink): boolean => {
    return (
      link.target.kind === "page" &&
      // The docs' static files and endpoints are not pages.
      !NOT_PAGE_CATEGORIES.includes(link.target.name!.split("/")[0]!)
    );
  })
  .map((link: ProductDocsLink): ProductPageLink => {
    return { link: link, page: link.target.name!.toLowerCase() };
  });

describe("docs links in the product", () => {
  it("are found, so the checks below check something", () => {
    // The dashboard links to its docs from setup guides, empty states and help.
    expect(pageLinks.length).toBeGreaterThan(50);
    // The website writes some after its origin: `${baseUrl}/docs/ai/mcp-server`.
    expect(
      pageLinks.some((link: ProductPageLink): boolean => {
        return (
          link.link.file ===
            path.join("packages", "Home", "Utils", "AIDiscovery.ts") &&
          link.page === "ai/mcp-server"
        );
      }),
    ).toBe(true);
  });

  it("name pages the nav lists", () => {
    const broken: Array<string> = pageLinks
      .filter((link: ProductPageLink): boolean => {
        return !NAV_PAGES.includes(link.page);
      })
      .map((link: ProductPageLink): string => {
        return whereOf(link.link);
      });

    expect(broken).toEqual([]);
  });

  it("name a page, not a category's own address", () => {
    const categories: Array<string> = productLinks
      .filter((link: ProductDocsLink): boolean => {
        return (
          link.target.kind === "category" &&
          // "/docs/as-markdown" and the like name the docs' endpoints.
          !NOT_PAGE_CATEGORIES.includes(link.target.name!.toLowerCase())
        );
      })
      .map(whereOf);

    expect(categories).toEqual([]);
  });

  it("name headings those pages have", () => {
    const broken: Array<string> = pageLinks
      .filter((link: ProductPageLink): boolean => {
        return (
          link.link.anchor !== null &&
          NAV_PAGES.includes(link.page) &&
          !anchorsOf("en", link.page).has(link.link.anchor)
        );
      })
      .map((link: ProductPageLink): string => {
        return whereOf(link.link);
      });

    expect(broken).toEqual([]);
  });
});
