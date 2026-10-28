import {
  APP_REDIRECT_PATHS,
  DOCS_SITEMAP_PATH,
  REFERENCE_SITEMAP_PATH,
  RETIRED_SITEMAP_STATUS,
  getPostLastmod,
  isRedirectPath,
  REDIRECT_PATHS,
  sendRetiredSitemap,
} from "../Utils/Sitemap";
import { getProductCompareSlugs } from "../Utils/ProductCompare";
import { ExpressResponse } from "Common/Server/Utils/Express";
import fs from "fs";
import path from "path";

/*
 * A redirect path listed in the sitemap sends crawlers (and buyers reading it)
 * to a non-canonical URL, and a miscounted page total drops real pages off the
 * sitemap index entirely. These lock the two pieces of that logic that are pure
 * arithmetic / set membership: redirect classification and the ceil-division
 * that decides how many sitemap files a given post count needs.
 *
 * The page-count functions read their totals from BlogPostUtil, so those tests
 * load the module fresh with BlogPostUtil mocked — the module keeps a private
 * count cache with no exported reset, so a fresh import per scenario is the only
 * way to feed it a new total. The sitemaps themselves are generated the same
 * way, from the routes Routes.ts registers.
 */

describe("Sitemap isRedirectPath", () => {
  test("returns true for every path in REDIRECT_PATHS and APP_REDIRECT_PATHS", () => {
    expect(REDIRECT_PATHS.size).toBeGreaterThan(0);
    expect(APP_REDIRECT_PATHS.size).toBeGreaterThan(0);
    for (const redirectPath of [...REDIRECT_PATHS, ...APP_REDIRECT_PATHS]) {
      expect(isRedirectPath(redirectPath)).toBe(true);
    }
  });

  test("returns false for canonical pages that are not redirects", () => {
    for (const canonicalPath of [
      "/",
      "/pricing",
      "/blog",
      "/compare",
      "/enterprise",
      "/product/monitoring",
      "/product/proxmox",
      "/product/vmware",
      "/product/databases",
      "/product/queues",
      "/product/incident-management",
      "/product/ai-agent",
      "/legal/terms",
      "/legal/privacy",
    ]) {
      expect(isRedirectPath(canonicalPath)).toBe(false);
    }
  });

  test("knows the short product addresses, /legal, /docs and /reference are redirects", () => {
    // Both redirect to their /product/ page, which is listed instead.
    expect(isRedirectPath("/incident-management")).toBe(true);
    expect(isRedirectPath("/ai-agent")).toBe(true);
    // /legal redirects to the Terms of Service, /legal/terms.
    expect(isRedirectPath("/legal")).toBe(true);
    // The app sends both to the first page in the reader's language.
    expect(isRedirectPath("/docs")).toBe(true);
    expect(isRedirectPath("/reference")).toBe(true);
  });

  test("keeps the app's two redirects apart from this service's", () => {
    // REDIRECT_PATHS are routes here that redirect; these two are the app's.
    expect(Array.from(APP_REDIRECT_PATHS).sort()).toEqual([
      "/docs",
      "/reference",
    ]);
    for (const appPath of APP_REDIRECT_PATHS) {
      expect(REDIRECT_PATHS.has(appPath)).toBe(false);
    }
  });

  test("matches exactly — case, trailing slash and leading slash all matter", () => {
    // A known redirect is "/self-hosted".
    expect(isRedirectPath("/self-hosted")).toBe(true);
    // Any variation must miss so we do not silently drop a real page.
    expect(isRedirectPath("/Self-Hosted")).toBe(false);
    expect(isRedirectPath("/self-hosted/")).toBe(false);
    expect(isRedirectPath("self-hosted")).toBe(false);
    expect(isRedirectPath("/self-hosted/extra")).toBe(false);
  });

  test("returns false for the empty string", () => {
    expect(isRedirectPath("")).toBe(false);
  });
});

describe("Sitemap product page priorities", () => {
  /*
   * PAGE_CONFIG is module-private, so read the source: a product page that is
   * missing from it silently falls back to the default priority and drops
   * below the blog in crawl order. The two hypervisor products must be
   * configured identically.
   */
  const sitemapSource: string = fs.readFileSync(
    path.join(__dirname, "..", "Utils", "Sitemap.ts"),
    "utf-8",
  );

  test("the VMware product page is configured like the Proxmox one", () => {
    expect(sitemapSource).toContain(
      '"/product/proxmox": { priority: 0.9, changefreq: "weekly" }',
    );
    expect(sitemapSource).toContain(
      '"/product/vmware": { priority: 0.9, changefreq: "weekly" }',
    );
  });

  test("the VMware product page is configured exactly once", () => {
    expect(sitemapSource.split('"/product/vmware"').length - 1).toBe(1);
  });

  test("the Databases product page is configured like the other product pages, once", () => {
    expect(sitemapSource).toContain(
      '"/product/databases": { priority: 0.9, changefreq: "weekly" }',
    );
    expect(sitemapSource.split('"/product/databases"').length - 1).toBe(1);
  });

  test("the Queues product page is configured like the other product pages, once", () => {
    expect(sitemapSource).toContain(
      '"/product/queues": { priority: 0.9, changefreq: "weekly" }',
    );
    expect(sitemapSource.split('"/product/queues"').length - 1).toBe(1);
  });

  test("the compare hub is configured once, and the docs and reference are not pages here", () => {
    expect(sitemapSource.split('"/compare":').length - 1).toBe(1);
    expect(sitemapSource).not.toContain('"/docs":');
    expect(sitemapSource).not.toContain('"/reference":');
  });
});

interface SitemapModule {
  getBlogSitemapPageCount: () => Promise<number>;
  generateSitemapIndexXml: () => Promise<string>;
  generatePagesSitemapXml: () => Promise<string>;
  generateCompareSitemapXml: () => Promise<string>;
  generateBlogSitemapXml: (page: number) => Promise<string>;
}

interface FakePost {
  postDate: string;
  blogUrl: string;
}

const HOME_URL: string = "https://oneuptime.com";

const routesSource: string = fs.readFileSync(
  path.join(__dirname, "..", "Routes.ts"),
  "utf-8",
);

// Every path Routes.ts registers a GET handler on, as written.
const REGISTERED_GET_PATHS: Array<string> = Array.from(
  routesSource.matchAll(/app\.get\(\s*"([^"]+)"/g),
  (match: RegExpMatchArray): string => {
    return match[1]!;
  },
);

/*
 * The registered paths whose handler only redirects: the handler, up to the
 * next route, calls redirectPreservingQuery or res.redirect.
 */
const REDIRECTING_GET_PATHS: Array<string> = REGISTERED_GET_PATHS.filter(
  (routePath: string): boolean => {
    const start: number = routesSource.indexOf(
      `app.get(\n      "${routePath}"`,
    );
    const inline: number = routesSource.indexOf(`app.get("${routePath}"`);
    const at: number = start >= 0 ? start : inline;

    if (at < 0) {
      return false;
    }

    const next: number = routesSource.indexOf("app.get(", at + 1);
    const body: string = routesSource.slice(
      at,
      next < 0 ? routesSource.length : next,
    );

    return (
      body.includes("redirectPreservingQuery(") ||
      body.includes("res.redirect(")
    );
  },
);

type LoadSitemapFunction = (options: {
  posts: Array<FakePost>;
  routes?: Array<string>;
}) => SitemapModule;

/*
 * Re-import Sitemap with BlogPostUtil returning a fixed list of posts and the
 * Express app holding the given GET routes, so each scenario runs against a
 * known site. resetModules + doMock + a fresh isolateModules require gives
 * each call its own module registry (and therefore its own empty caches).
 */
const loadSitemap: LoadSitemapFunction = (options: {
  posts: Array<FakePost>;
  routes?: Array<string>;
}): SitemapModule => {
  jest.resetModules();

  jest.doMock("../Utils/BlogPost", () => {
    return {
      __esModule: true,
      default: {
        getHomeUrl: jest.fn().mockResolvedValue({
          toString: (): string => {
            return `${HOME_URL}/`;
          },
        }),
        getBlogPostList: jest.fn().mockResolvedValue(options.posts),
        getTags: jest.fn().mockResolvedValue(["Never", "Read"]),
      },
    };
  });

  jest.doMock("Common/Server/Utils/Express", () => {
    return {
      __esModule: true,
      default: {
        getExpressApp: (): unknown => {
          return {
            _router: {
              stack: (options.routes || []).map((routePath: string) => {
                return { route: { path: routePath, methods: { get: true } } };
              }),
            },
          };
        },
      },
    };
  });

  let mod: SitemapModule | undefined;
  jest.isolateModules(() => {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    mod = require("../Utils/Sitemap") as SitemapModule;
  });

  return mod as SitemapModule;
};

// Fake posts, newest first as the blog lists them, a day apart.
const postsFrom: (count: number, newest: string) => Array<FakePost> = (
  count: number,
  newest: string,
): Array<FakePost> => {
  const start: number = new Date(newest).getTime();
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    const postDate: string = new Date(start - index * 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      postDate: postDate,
      blogUrl: `/blog/post/${postDate}-post-${index}/view`,
    };
  });
};

// Each <tag> element of a sitemap or an index, as written.
const elementsOf: (xml: string, tag: string) => Array<string> = (
  xml: string,
  tag: string,
): Array<string> => {
  return xml.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g")) || [];
};

const locOf: (element: string) => string = (element: string): string => {
  return (element.match(/<loc>([^<]*)<\/loc>/) || [])[1] || "";
};

const lastmodOf: (element: string) => string | null = (
  element: string,
): string | null => {
  return (element.match(/<lastmod>([^<]*)<\/lastmod>/) || [])[1] || null;
};

afterEach(() => {
  jest.dontMock("../Utils/BlogPost");
  jest.dontMock("Common/Server/Utils/Express");
  jest.resetModules();
});

describe("Sitemap page-count pagination", () => {
  test("blog: zero posts needs zero sitemap pages", async () => {
    const mod: SitemapModule = loadSitemap({ posts: [] });
    await expect(mod.getBlogSitemapPageCount()).resolves.toBe(0);
  });

  test("blog: a single post still needs one page", async () => {
    const mod: SitemapModule = loadSitemap({
      posts: postsFrom(1, "2026-10-01"),
    });
    await expect(mod.getBlogSitemapPageCount()).resolves.toBe(1);
  });

  test("blog: exactly one full page (1000) does not spill to a second", async () => {
    const mod: SitemapModule = loadSitemap({
      posts: postsFrom(1000, "2026-10-01"),
    });
    await expect(mod.getBlogSitemapPageCount()).resolves.toBe(1);
  });

  test("blog: one over a full page rolls into a second page", async () => {
    const mod: SitemapModule = loadSitemap({
      posts: postsFrom(1001, "2026-10-01"),
    });
    await expect(mod.getBlogSitemapPageCount()).resolves.toBe(2);
  });

  test("blog: 2500 posts spread across three pages", async () => {
    const mod: SitemapModule = loadSitemap({
      posts: postsFrom(2500, "2026-10-01"),
    });
    await expect(mod.getBlogSitemapPageCount()).resolves.toBe(3);
  });
});

describe("the sitemap index", () => {
  test("lists the pages, comparisons, integrations, blog, docs and API reference sitemaps, and no tag sitemap", async () => {
    const mod: SitemapModule = loadSitemap({
      posts: postsFrom(1500, "2026-10-01"),
    });
    const xml: string = await mod.generateSitemapIndexXml();

    expect(elementsOf(xml, "sitemap").map(locOf)).toEqual([
      `${HOME_URL}/sitemap-pages.xml`,
      `${HOME_URL}/sitemap-compare.xml`,
      `${HOME_URL}/sitemap-integrations.xml`,
      `${HOME_URL}/sitemap-blog-1.xml`,
      `${HOME_URL}/sitemap-blog-2.xml`,
      `${HOME_URL}${DOCS_SITEMAP_PATH}`,
      `${HOME_URL}${REFERENCE_SITEMAP_PATH}`,
    ]);
    expect(xml).not.toContain("sitemap-tags");
    expect(DOCS_SITEMAP_PATH).toBe("/sitemap-docs.xml");
    expect(REFERENCE_SITEMAP_PATH).toBe("/sitemap-reference.xml");
  });

  test("dates a blog sitemap by its newest post, and gives the others no date", async () => {
    const mod: SitemapModule = loadSitemap({
      posts: postsFrom(1500, "2026-10-01"),
    });
    const entries: Array<string> = elementsOf(
      await mod.generateSitemapIndexXml(),
      "sitemap",
    );
    const lastmods: Record<string, string | null> = {};

    for (const entry of entries) {
      lastmods[locOf(entry)] = lastmodOf(entry);
    }

    expect(lastmods).toEqual({
      [`${HOME_URL}/sitemap-pages.xml`]: null,
      [`${HOME_URL}/sitemap-compare.xml`]: null,
      [`${HOME_URL}/sitemap-integrations.xml`]: null,
      // Posts 1-1000 start on 1 October; posts 1001-1500 a thousand days before.
      [`${HOME_URL}/sitemap-blog-1.xml`]: "2026-10-01T00:00:00.000Z",
      [`${HOME_URL}/sitemap-blog-2.xml`]: new Date(
        new Date("2026-10-01").getTime() - 1000 * 86400000,
      ).toISOString(),
      [`${HOME_URL}${DOCS_SITEMAP_PATH}`]: null,
      [`${HOME_URL}${REFERENCE_SITEMAP_PATH}`]: null,
    });
  });

  test("does not date the index by when it was generated", async () => {
    const mod: SitemapModule = loadSitemap({ posts: [] });
    const xml: string = await mod.generateSitemapIndexXml();

    expect(xml).not.toContain("<lastmod>");
    expect(xml).not.toContain(new Date().toISOString().slice(0, 10));
  });

  test("dates a blog sitemap by its newest post even when the list is out of order", async () => {
    const posts: Array<FakePost> = [
      { postDate: "2026-01-05", blogUrl: "/blog/post/a/view" },
      { postDate: "2026-09-30", blogUrl: "/blog/post/b/view" },
      { postDate: "not-a-date", blogUrl: "/blog/post/c/view" },
    ];
    const mod: SitemapModule = loadSitemap({ posts: posts });
    const blog: string | undefined = elementsOf(
      await mod.generateSitemapIndexXml(),
      "sitemap",
    ).find((entry: string): boolean => {
      return locOf(entry).endsWith("/sitemap-blog-1.xml");
    });

    expect(lastmodOf(blog || "")).toBe("2026-09-30T00:00:00.000Z");
  });
});

describe("the pages sitemap", () => {
  let xml: string = "";
  let locs: Array<string> = [];

  beforeAll(async () => {
    const mod: SitemapModule = loadSitemap({
      posts: [],
      routes: REGISTERED_GET_PATHS,
    });
    xml = await mod.generatePagesSitemapXml();
    locs = elementsOf(xml, "url").map(locOf);
  });

  test("lists the compare hub, and the pages the short addresses redirect to", () => {
    expect(locs).toContain(`${HOME_URL}/compare`);
    expect(locs).toContain(`${HOME_URL}/product/incident-management`);
    expect(locs).toContain(`${HOME_URL}/product/ai-agent`);
    expect(locs).toContain(`${HOME_URL}/legal/terms`);
  });

  test("lists no address that redirects", () => {
    for (const redirecting of [
      "/docs",
      "/reference",
      "/incident-management",
      "/ai-agent",
      "/legal",
    ]) {
      expect(locs).not.toContain(`${HOME_URL}${redirecting}`);
    }
  });

  test("lists neither /docs nor /reference, even were this service to route them", async () => {
    const mod: SitemapModule = loadSitemap({
      posts: [],
      routes: [...REGISTERED_GET_PATHS, "/docs", "/reference"],
    });
    const withAppPaths: Array<string> = elementsOf(
      await mod.generatePagesSitemapXml(),
      "url",
    ).map(locOf);

    expect(withAppPaths).not.toContain(`${HOME_URL}/docs`);
    expect(withAppPaths).not.toContain(`${HOME_URL}/reference`);
    // Nothing else changes: every other page is listed as before.
    expect(withAppPaths).toEqual(locs);
  });

  test("lists no route of Routes.ts that only redirects", () => {
    expect(REDIRECTING_GET_PATHS).toEqual(
      expect.arrayContaining([
        "/incident-management",
        "/ai-agent",
        "/legal",
        "/self-hosted",
        "/status-page",
      ]),
    );

    for (const routePath of REDIRECTING_GET_PATHS) {
      expect({
        routePath,
        listed: locs.includes(`${HOME_URL}${routePath}`),
      }).toEqual({ routePath, listed: false });
    }
  });

  test("lists each comparison in the compare sitemap, not here", () => {
    for (const loc of locs) {
      expect(loc).not.toMatch(/\/compare\/.+/);
    }
  });

  test("gives no page a date it does not have", () => {
    expect(locs.length).toBeGreaterThan(50);
    expect(xml).not.toContain("<lastmod>");
  });

  test("still lists the homepage first", () => {
    expect(locs[0]).toBe(HOME_URL);
  });
});

describe("the compare sitemap", () => {
  test("lists every comparison, with no date it does not have", async () => {
    const mod: SitemapModule = loadSitemap({ posts: [] });
    const xml: string = await mod.generateCompareSitemapXml();

    expect(elementsOf(xml, "url").map(locOf)).toEqual(
      getProductCompareSlugs().map((slug: string): string => {
        return `${HOME_URL}/compare/${slug}`;
      }),
    );
    expect(xml).not.toContain("<lastmod>");
  });
});

describe("a blog sitemap", () => {
  test("dates each post by its own date", async () => {
    const posts: Array<FakePost> = postsFrom(3, "2026-10-01");
    const mod: SitemapModule = loadSitemap({ posts: posts });
    const entries: Array<string> = elementsOf(
      await mod.generateBlogSitemapXml(1),
      "url",
    );

    expect(
      entries.map((entry: string): [string, string | null] => {
        return [locOf(entry), lastmodOf(entry)];
      }),
    ).toEqual(
      posts.map((post: FakePost): [string, string | null] => {
        return [`${HOME_URL}${post.blogUrl}`, `${post.postDate}T00:00:00.000Z`];
      }),
    );
  });

  test("gives a post with no readable date no date, rather than failing", async () => {
    const mod: SitemapModule = loadSitemap({
      posts: [{ postDate: "2026-13-45", blogUrl: "/blog/post/x/view" }],
    });
    const entries: Array<string> = elementsOf(
      await mod.generateBlogSitemapXml(1),
      "url",
    );

    expect(entries.map(locOf)).toEqual([`${HOME_URL}/blog/post/x/view`]);
    expect(lastmodOf(entries[0]!)).toBeNull();
  });
});

describe("the Resellers page in the sitemap", () => {
  test("is configured once, as a monthly page", () => {
    const sitemapSource: string = fs.readFileSync(
      path.join(__dirname, "..", "Utils", "Sitemap.ts"),
      "utf-8",
    );

    expect(sitemapSource).toContain(
      '"/resellers": { priority: 0.6, changefreq: "monthly" }',
    );
    expect(sitemapSource.split('"/resellers"').length - 1).toBe(1);
  });

  test("is listed in the pages sitemap, with its priority", async () => {
    const mod: SitemapModule = loadSitemap({
      posts: [],
      routes: REGISTERED_GET_PATHS,
    });
    const xml: string = await mod.generatePagesSitemapXml();
    const entry: string | undefined = elementsOf(xml, "url").find(
      (element: string): boolean => {
        return locOf(element) === `${HOME_URL}/resellers`;
      },
    );

    expect(REGISTERED_GET_PATHS).toContain("/resellers");
    expect(entry).toBeDefined();
    expect(entry).toContain("<priority>0.6</priority>");
    expect(entry).toContain("<changefreq>monthly</changefreq>");
    expect(isRedirectPath("/resellers")).toBe(false);
  });
});

describe("getPostLastmod", () => {
  test("is a post's own date, as a sitemap writes it", () => {
    expect(getPostLastmod("2026-10-01")).toBe("2026-10-01T00:00:00.000Z");
  });

  test("is nothing for a post with no date, or one that is no date", () => {
    expect(getPostLastmod(undefined)).toBeUndefined();
    expect(getPostLastmod("")).toBeUndefined();
    expect(getPostLastmod("2026-13-45")).toBeUndefined();
    expect(getPostLastmod("soon")).toBeUndefined();
  });
});

describe("the retired tag sitemaps", () => {
  test("answer 410 Gone, so crawlers drop them, and are never indexed", () => {
    const sent: {
      status: number | null;
      headers: Record<string, string>;
      body: string | null;
    } = { status: null, headers: {}, body: null };

    const res: ExpressResponse = {
      status: (code: number): ExpressResponse => {
        sent.status = code;
        return res;
      },
      setHeader: (name: string, value: string): ExpressResponse => {
        sent.headers[name] = value;
        return res;
      },
      send: (body: string): ExpressResponse => {
        sent.body = body;
        return res;
      },
    } as unknown as ExpressResponse;

    sendRetiredSitemap(res);

    expect(RETIRED_SITEMAP_STATUS).toBe(410);
    expect(sent.status).toBe(410);
    expect(sent.headers["X-Robots-Tag"]).toBe("noindex");
    expect(sent.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(sent.body).not.toContain("<urlset");
  });

  test("are no longer generated at all", () => {
    const sitemapSource: string = fs.readFileSync(
      path.join(__dirname, "..", "Utils", "Sitemap.ts"),
      "utf-8",
    );

    expect(sitemapSource).not.toContain("generateTagsSitemapXml");
    expect(sitemapSource).not.toContain("getTagsSitemapPageCount");
    expect(sitemapSource).not.toContain("/blog/tag/");
  });
});
