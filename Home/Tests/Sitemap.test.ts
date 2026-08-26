import { isRedirectPath, REDIRECT_PATHS } from "../Utils/Sitemap";

/*
 * A redirect path listed in the sitemap sends crawlers (and buyers reading it)
 * to a non-canonical URL, and a miscounted page total drops real pages off the
 * sitemap index entirely. These lock the two pieces of that logic that are pure
 * arithmetic / set membership: redirect classification and the ceil-division
 * that decides how many sitemap files a given post/tag count needs.
 *
 * The page-count functions read their totals from BlogPostUtil, so those tests
 * load the module fresh with BlogPostUtil mocked — the module keeps a private
 * count cache with no exported reset, so a fresh import per scenario is the only
 * way to feed it a new total.
 */

describe("Sitemap isRedirectPath", () => {
  test("returns true for every path in REDIRECT_PATHS", () => {
    expect(REDIRECT_PATHS.size).toBeGreaterThan(0);
    for (const redirectPath of REDIRECT_PATHS) {
      expect(isRedirectPath(redirectPath)).toBe(true);
    }
  });

  test("returns false for canonical pages that are not redirects", () => {
    for (const canonicalPath of [
      "/",
      "/pricing",
      "/blog",
      "/enterprise",
      "/product/monitoring",
    ]) {
      expect(isRedirectPath(canonicalPath)).toBe(false);
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

interface SitemapModule {
  getBlogSitemapPageCount: () => Promise<number>;
  getTagsSitemapPageCount: () => Promise<number>;
}

type LoadSitemapFunction = (counts: {
  posts: number;
  tags: number;
}) => Promise<SitemapModule>;

/*
 * Re-import Sitemap with BlogPostUtil returning fixed-length lists, so the
 * page-count math runs against a known total. resetModules + doMock gives each
 * call its own module registry (and therefore its own empty count cache).
 */
const loadSitemap: LoadSitemapFunction = async (counts: {
  posts: number;
  tags: number;
}): Promise<SitemapModule> => {
  jest.resetModules();

  jest.doMock("../Utils/BlogPost", () => {
    return {
      __esModule: true,
      default: {
        getBlogPostList: jest
          .fn()
          .mockResolvedValue(new Array(counts.posts).fill({})),
        getTags: jest
          .fn()
          .mockResolvedValue(new Array(counts.tags).fill("tag")),
      },
    };
  });

  return (await import("../Utils/Sitemap")) as unknown as SitemapModule;
};

describe("Sitemap page-count pagination", () => {
  afterEach(() => {
    jest.dontMock("../Utils/BlogPost");
    jest.resetModules();
  });

  test("blog: zero posts needs zero sitemap pages", async () => {
    const mod: SitemapModule = await loadSitemap({ posts: 0, tags: 0 });
    await expect(mod.getBlogSitemapPageCount()).resolves.toBe(0);
  });

  test("blog: a single post still needs one page", async () => {
    const mod: SitemapModule = await loadSitemap({ posts: 1, tags: 0 });
    await expect(mod.getBlogSitemapPageCount()).resolves.toBe(1);
  });

  test("blog: exactly one full page (1000) does not spill to a second", async () => {
    const mod: SitemapModule = await loadSitemap({ posts: 1000, tags: 0 });
    await expect(mod.getBlogSitemapPageCount()).resolves.toBe(1);
  });

  test("blog: one over a full page rolls into a second page", async () => {
    const mod: SitemapModule = await loadSitemap({ posts: 1001, tags: 0 });
    await expect(mod.getBlogSitemapPageCount()).resolves.toBe(2);
  });

  test("blog: 2500 posts spread across three pages", async () => {
    const mod: SitemapModule = await loadSitemap({ posts: 2500, tags: 0 });
    await expect(mod.getBlogSitemapPageCount()).resolves.toBe(3);
  });

  test("tags: zero tags needs zero pages", async () => {
    const mod: SitemapModule = await loadSitemap({ posts: 0, tags: 0 });
    await expect(mod.getTagsSitemapPageCount()).resolves.toBe(0);
  });

  test("tags: exactly one full page (500) stays a single page", async () => {
    const mod: SitemapModule = await loadSitemap({ posts: 0, tags: 500 });
    await expect(mod.getTagsSitemapPageCount()).resolves.toBe(1);
  });

  test("tags: one over a full page rolls into a second page", async () => {
    const mod: SitemapModule = await loadSitemap({ posts: 0, tags: 501 });
    await expect(mod.getTagsSitemapPageCount()).resolves.toBe(2);
  });
});
