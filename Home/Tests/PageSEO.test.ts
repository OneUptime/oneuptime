import PageSEOConfig, {
  BreadcrumbItem,
  PageSEOData,
  createDefaultSEO,
} from "../Utils/PageSEO";

/*
 * PageSEO is the source of every marketing page's <title>, meta description,
 * canonical URL and breadcrumb structured data. getSEOForPath (Routes.ts)
 * looks entries up by request path, so the config key must equal the entry's
 * canonicalPath or a page silently serves another page's canonical tag — an
 * SEO defect that de-indexes the page. These tests pin that contract and the
 * breadcrumb shape rather than any specific copy.
 */

const VALID_PAGE_TYPES: Set<string> = new Set<string>([
  "home",
  "product",
  "pricing",
  "legal",
  "blog",
  "about",
  "support",
  "enterprise",
  "compare",
  "solutions",
  "industry",
  "other",
]);

const entries: Array<[string, PageSEOData]> = Object.entries(PageSEOConfig);

describe("createDefaultSEO", () => {
  test("carries through its arguments and applies safe defaults", () => {
    const seo: PageSEOData = createDefaultSEO(
      "Title",
      "Description",
      "/some-path",
    );
    expect(seo.title).toBe("Title");
    expect(seo.description).toBe("Description");
    expect(seo.canonicalPath).toBe("/some-path");
    // Default page type and a Home breadcrumb so every page has a trail.
    expect(seo.pageType).toBe("other");
    expect(seo.breadcrumbs).toEqual([{ name: "Home", url: "/" }]);
  });

  test("respects an explicit page type", () => {
    const seo: PageSEOData = createDefaultSEO("T", "D", "/p", "product");
    expect(seo.pageType).toBe("product");
  });
});

describe("PageSEOConfig", () => {
  test("has entries", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  test("every config key equals its canonicalPath", () => {
    /*
     * getSEOForPath resolves by request path; a key that disagrees with its own
     * canonicalPath serves the wrong canonical URL for that page.
     */
    for (const [key, data] of entries) {
      expect(data.canonicalPath).toBe(key);
    }
  });

  test.each(entries)(
    "%s has a non-empty title and description",
    (_key: string, data: PageSEOData) => {
      expect(data.title.trim().length).toBeGreaterThan(0);
      expect(data.description.trim().length).toBeGreaterThan(0);
    },
  );

  test.each(entries)(
    "%s has a rooted canonical path",
    (key: string, data: PageSEOData) => {
      expect(data.canonicalPath.startsWith("/")).toBe(true);
      /*
       * No trailing slash except the homepage, so canonical URLs do not split
       * crawl equity between /x and /x/.
       */
      if (key !== "/") {
        expect(data.canonicalPath.endsWith("/")).toBe(false);
      }
    },
  );

  test.each(entries)(
    "%s has a valid page type",
    (_key: string, data: PageSEOData) => {
      expect(VALID_PAGE_TYPES.has(data.pageType)).toBe(true);
    },
  );

  test.each(entries)(
    "%s has a well-formed breadcrumb trail",
    (_key: string, data: PageSEOData) => {
      expect(Array.isArray(data.breadcrumbs)).toBe(true);
      expect(data.breadcrumbs.length).toBeGreaterThan(0);

      // The trail always starts at Home.
      const first: BreadcrumbItem = data.breadcrumbs[0]!;
      expect(first.name).toBe("Home");
      expect(first.url).toBe("/");

      for (const crumb of data.breadcrumbs) {
        expect(crumb.name.trim().length).toBeGreaterThan(0);
        expect(crumb.url.startsWith("/")).toBe(true);
      }

      /*
       * The final crumb is the page itself, so breadcrumb structured data and the
       * canonical URL agree.
       */
      const last: BreadcrumbItem =
        data.breadcrumbs[data.breadcrumbs.length - 1]!;
      expect(last.url).toBe(data.canonicalPath);
    },
  );

  test.each(entries)(
    "%s optional OG fields are non-empty when present",
    (_key: string, data: PageSEOData) => {
      if (data.ogImage !== undefined) {
        expect(data.ogImage.trim().length).toBeGreaterThan(0);
      }
      if (data.ogType !== undefined) {
        expect(data.ogType.trim().length).toBeGreaterThan(0);
      }
    },
  );

  test("no two pages share a canonical path", () => {
    const canonicals: Array<string> = entries.map(
      ([, data]: [string, PageSEOData]): string => {
        return data.canonicalPath;
      },
    );
    expect(new Set(canonicals).size).toBe(canonicals.length);
  });
});
