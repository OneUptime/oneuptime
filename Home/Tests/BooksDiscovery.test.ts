import PageSEOConfig, { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import { generatePagesSitemapXml, isRedirectPath } from "../Utils/Sitemap";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import ejs from "ejs";
import fs from "fs";
import path from "path";

jest.mock("../Utils/BlogPost", () => {
  return {
    __esModule: true,
    default: {
      getHomeUrl: jest.fn().mockResolvedValue({
        toString: (): string => {
          return "https://oneuptime.com/";
        },
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: { getExpressApp: jest.fn() },
  };
});

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";
const routesSource: string = fs.readFileSync(
  path.join(__dirname, "..", "Routes.ts"),
  "utf-8",
);

/*
 * Use the actual registered paths for sitemap introspection without starting
 * the application's background jobs or requiring a database. A missing route
 * therefore fails discovery even when its sitemap priority is configured.
 */
const registeredGetPaths: string[] = Array.from(
  routesSource.matchAll(/app\.get\(\s*"([^"]+)"/g),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
);

describe("Books route and metadata", () => {
  const seo: PageSEOData = getPageSEO("/books");

  test("registers the books page exactly once", () => {
    expect(
      registeredGetPaths.filter((routePath: string): boolean => {
        return routePath === "/books";
      }),
    ).toEqual(["/books"]);
  });

  test("renders the books template with the normal marketing locals", () => {
    const routeStart: number = routesSource.search(/app\.get\(\s*"\/books"/);
    expect(routeStart).toBeGreaterThanOrEqual(0);

    const nextRoute: number = routesSource.indexOf("app.get(", routeStart + 1);
    const routeBody: string = routesSource.slice(routeStart, nextRoute);

    expect(routeBody).toContain("`${ViewsPath}/books.ejs`");
    expect(routeBody).toMatch(/getSEOForPath\(\s*"\/books"/);
    expect(routeBody).toContain('res.locals["homeUrl"]');
    expect(routeBody).toContain(
      "enableGoogleTagManager: GoogleTagManagerEnabled",
    );
    expect(routeBody).toMatch(/seo,\s*\}\)/);
  });

  test("uses explicit book metadata instead of the default page description", () => {
    expect(PageSEOConfig["/books"]).toBeDefined();
    expect(seo).toBe(PageSEOConfig["/books"]);
    expect(seo.title).toBe("Books | Back to Metal | OneUptime");
    expect(seo.description).toContain("Back to Metal by Nawaz Dhandala");
    expect(seo.description).toContain("cloud to bare metal");
  });

  test("canonicalizes the collection on OneUptime and provides its breadcrumbs", () => {
    expect(seo.canonicalPath).toBe("/books");
    expect(seo.breadcrumbs).toEqual([
      { name: "Home", url: "/" },
      { name: "Books", url: "/books" },
    ]);
    expect(isRedirectPath(seo.canonicalPath)).toBe(false);
  });

  test("describes an editorial page rather than a software product", () => {
    expect(seo.pageType).toBe("other");
    expect(seo.softwareApplication).toBeUndefined();
    expect(seo.twitterCard).toBe("summary_large_image");
  });

  test("renders book metadata into social sharing tags", async () => {
    const html: string = await ejs.renderFile(
      path.join(VIEWS_ROOT, "head-social.ejs"),
      {
        homeUrl: HOME_URL,
        seo: { ...seo, fullCanonicalUrl: `${HOME_URL}/books` },
      },
    );

    expect(html).toContain(
      '<meta property="og:title" content="Books | Back to Metal | OneUptime">',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://oneuptime.com/books">',
    );
    expect(html).toContain(
      '<meta name="twitter:title" content="Books | Back to Metal | OneUptime">',
    );
    expect(html).toContain(seo.description);
    expect(html).not.toContain('"@type": "SoftwareApplication"');
  });
});

describe("Books navigation", () => {
  let navHtml: string = "";
  let footerHtml: string = "";

  beforeAll(async () => {
    [navHtml, footerHtml] = await Promise.all([
      ejs.renderFile(path.join(VIEWS_ROOT, "nav.ejs"), {}),
      ejs.renderFile(path.join(VIEWS_ROOT, "footer.ejs"), {}),
    ]);
  });

  test("offers Books in the desktop Resources learning section", () => {
    const desktopResources: string = navHtml.slice(
      navHtml.indexOf('id="resources-menu"'),
      navHtml.indexOf('id="mobile-menu"'),
    );

    expect(desktopResources).toMatch(/href="\/books"[^>]*>[\s\S]*?>Books<\/p>/);
    expect(desktopResources).toContain("Ideas for better infrastructure");
  });

  test("offers Books in the mobile navigation", () => {
    const mobileMenu: string = navHtml.slice(
      navHtml.indexOf('id="mobile-menu"'),
      navHtml.indexOf('id="product-modal"'),
    );

    expect(mobileMenu).toMatch(/href="\/books"[^>]*>Books<\/a>/);
  });

  test("offers Books under Resources in the footer", () => {
    const resources: string = footerHtml.slice(
      footerHtml.indexOf(">Resources</h3>"),
      footerHtml.indexOf(">Industries</h3>"),
    );

    expect(resources).toMatch(/href="\/books"[^>]*>Books<\/a>/);
  });

  test("keeps collection links internal and in the same tab", () => {
    const links: string[] =
      `${navHtml}${footerHtml}`.match(/<a\b[^>]*href="\/books"[^>]*>/g) || [];

    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).not.toContain('target="_blank"');
    }
  });
});

describe("Books sitemap integration", () => {
  let xml: string = "";
  let booksEntries: string[] = [];

  beforeAll(async () => {
    jest.mocked(Express.getExpressApp).mockReturnValue({
      _router: {
        stack: registeredGetPaths.map((routePath: string) => {
          return { route: { path: routePath, methods: { get: true } } };
        }),
      },
    } as unknown as ExpressApplication);

    xml = await generatePagesSitemapXml();
    booksEntries = (xml.match(/<url>[\s\S]*?<\/url>/g) || []).filter(
      (entry: string): boolean => {
        return entry.includes("<loc>https://oneuptime.com/books</loc>");
      },
    );
  });

  test("discovers exactly one canonical books URL from the registered route", () => {
    expect(booksEntries).toHaveLength(1);
    expect(xml).not.toContain("https://oneuptime.com//books");
    expect(xml).not.toContain("https://oneuptime.com/books/");
  });

  test("publishes its configured monthly frequency and 0.7 priority", () => {
    expect(booksEntries[0]).toContain("<changefreq>monthly</changefreq>");
    expect(booksEntries[0]).toContain("<priority>0.7</priority>");
    expect(booksEntries[0]).toMatch(/<lastmod>[^<]+<\/lastmod>/);
  });

  test("keeps sitemap discovery consistent with the SEO canonical URL", () => {
    expect(booksEntries[0]).toContain(
      `<loc>${HOME_URL}${getPageSEO("/books").canonicalPath}</loc>`,
    );
    expect(xml).not.toContain("https://backtometal.oneuptime.com");
  });
});
