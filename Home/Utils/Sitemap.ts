import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import BlogPostUtil, { BlogPostHeader } from "./BlogPost";
import OneUptimeDate from "Common/Types/Date";
import URL from "Common/Types/API/URL";
import { getProductCompareSlugs } from "./ProductCompare";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";

// Priority and changefreq configuration for different page types
type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

interface SitemapPageConfig {
  priority: number;
  changefreq: ChangeFrequency;
}

const PAGE_CONFIG: Record<string, SitemapPageConfig> = {
  // Homepage - highest priority
  "/": { priority: 1.0, changefreq: "daily" },

  // Core product pages - high priority
  "/product/status-page": { priority: 0.9, changefreq: "weekly" },
  "/product/monitoring": { priority: 0.9, changefreq: "weekly" },
  "/product/incident-management": { priority: 0.9, changefreq: "weekly" },
  "/product/on-call": { priority: 0.9, changefreq: "weekly" },
  "/product/logs-management": { priority: 0.9, changefreq: "weekly" },
  "/product/metrics": { priority: 0.9, changefreq: "weekly" },
  "/product/traces": { priority: 0.9, changefreq: "weekly" },
  "/product/exceptions": { priority: 0.9, changefreq: "weekly" },
  "/product/workflows": { priority: 0.9, changefreq: "weekly" },
  "/product/dashboards": { priority: 0.9, changefreq: "weekly" },
  "/product/ai-agent": { priority: 0.9, changefreq: "weekly" },

  // Teams (Solutions) pages
  "/solutions/devops": { priority: 0.8, changefreq: "weekly" },
  "/solutions/sre": { priority: 0.8, changefreq: "weekly" },
  "/solutions/platform": { priority: 0.8, changefreq: "weekly" },
  "/solutions/developers": { priority: 0.8, changefreq: "weekly" },

  // Industry pages
  "/industries/fintech": { priority: 0.8, changefreq: "weekly" },
  "/industries/saas": { priority: 0.8, changefreq: "weekly" },
  "/industries/healthcare": { priority: 0.8, changefreq: "weekly" },
  "/industries/ecommerce": { priority: 0.8, changefreq: "weekly" },
  "/industries/media": { priority: 0.8, changefreq: "weekly" },
  "/industries/government": { priority: 0.8, changefreq: "weekly" },

  // Important pages
  "/pricing": { priority: 0.9, changefreq: "weekly" },
  "/enterprise/demo": { priority: 0.9, changefreq: "weekly" },
  "/enterprise/overview": { priority: 0.8, changefreq: "weekly" },
  "/about": { priority: 0.7, changefreq: "weekly" },
  "/support": { priority: 0.7, changefreq: "weekly" },

  // Documentation and reference
  "/docs": { priority: 0.7, changefreq: "weekly" },
  "/reference": { priority: 0.7, changefreq: "weekly" },

  // Blog section
  "/blog": { priority: 0.7, changefreq: "daily" },

  // Community and legal
  "/oss-friends": { priority: 0.3, changefreq: "monthly" },
};

// Default config for pages not explicitly listed
const DEFAULT_CONFIG: SitemapPageConfig = {
  priority: 0.5,
  changefreq: "monthly",
};

// Blog post config
const BLOG_POST_CONFIG: SitemapPageConfig = {
  priority: 0.6,
  changefreq: "monthly",
};

// Blog tag config
const BLOG_TAG_CONFIG: SitemapPageConfig = {
  priority: 0.4,
  changefreq: "weekly",
};

// Compare page config
const COMPARE_PAGE_CONFIG: SitemapPageConfig = {
  priority: 0.7,
  changefreq: "monthly",
};

// Number of blog posts per sitemap file
const BLOG_POSTS_PER_SITEMAP: number = 1000;

// Number of tags per sitemap file
const TAGS_PER_SITEMAP: number = 500;

// Cache TTL: 10 minutes
const TTL_MS: number = 10 * 60 * 1000;

interface CachedData<T> {
  data: T;
  generatedAt: number;
}

// Caches for different sitemap types
let indexCache: CachedData<string> | null = null;
let pagesCache: CachedData<string> | null = null;
let compareCache: CachedData<string> | null = null;
const tagsCaches: Map<number, CachedData<string>> = new Map();
const blogCaches: Map<number, CachedData<string>> = new Map();

// Cache for blog post count to avoid repeated fetches
let blogPostCountCache: CachedData<number> | null = null;

// Cache for tags count
let tagsCountCache: CachedData<number> | null = null;

function isCacheValid<T>(cache: CachedData<T> | null | undefined): boolean {
  if (!cache) {
    return false;
  }
  const now: number = OneUptimeDate.getCurrentDate().getTime();
  return now - cache.generatedAt < TTL_MS;
}

function getPageConfig(path: string): SitemapPageConfig {
  // Check for exact match first
  if (PAGE_CONFIG[path]) {
    return PAGE_CONFIG[path];
  }

  // Check for prefix matches
  if (path.startsWith("/legal")) {
    return { priority: 0.3, changefreq: "monthly" };
  }

  return DEFAULT_CONFIG;
}

interface SitemapEntry {
  loc: string;
  lastmod: string;
  priority: number;
  changefreq: ChangeFrequency;
}

function buildUrlsetXml(entries: SitemapEntry[]): string {
  const urlset: XMLBuilder = create().ele("urlset");
  urlset.att("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9");

  for (const entry of entries) {
    const urlEle: XMLBuilder = urlset.ele("url");
    urlEle.ele("loc").txt(entry.loc);
    urlEle.ele("lastmod").txt(entry.lastmod);
    urlEle.ele("changefreq").txt(entry.changefreq);
    urlEle.ele("priority").txt(entry.priority.toFixed(1));
  }

  return urlset.end({ prettyPrint: true });
}

interface SitemapIndexEntry {
  loc: string;
  lastmod: string;
}

function buildSitemapIndexXml(entries: SitemapIndexEntry[]): string {
  const sitemapindex: XMLBuilder = create().ele("sitemapindex");
  sitemapindex.att("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9");

  for (const entry of entries) {
    const sitemapEle: XMLBuilder = sitemapindex.ele("sitemap");
    sitemapEle.ele("loc").txt(entry.loc);
    sitemapEle.ele("lastmod").txt(entry.lastmod);
  }

  return sitemapindex.end({ prettyPrint: true });
}

// Get total blog post count (cached)
async function getBlogPostCount(): Promise<number> {
  if (isCacheValid(blogPostCountCache)) {
    return blogPostCountCache!.data;
  }

  const blogPosts: Array<BlogPostHeader> = await BlogPostUtil.getBlogPostList();
  const count: number = blogPosts.length;

  blogPostCountCache = {
    data: count,
    generatedAt: OneUptimeDate.getCurrentDate().getTime(),
  };

  return count;
}

// Calculate number of blog sitemap pages needed
export async function getBlogSitemapPageCount(): Promise<number> {
  const totalPosts: number = await getBlogPostCount();
  return Math.ceil(totalPosts / BLOG_POSTS_PER_SITEMAP);
}

// Get total tags count (cached)
async function getTagsCount(): Promise<number> {
  if (isCacheValid(tagsCountCache)) {
    return tagsCountCache!.data;
  }

  const tags: string[] = await BlogPostUtil.getTags();
  const count: number = tags.length;

  tagsCountCache = {
    data: count,
    generatedAt: OneUptimeDate.getCurrentDate().getTime(),
  };

  return count;
}

// Calculate number of tags sitemap pages needed
export async function getTagsSitemapPageCount(): Promise<number> {
  const totalTags: number = await getTagsCount();
  return Math.ceil(totalTags / TAGS_PER_SITEMAP);
}

// Discover static paths from Express routes
function discoverStaticPaths(): string[] {
  const discoveredStaticPaths: Set<string> = new Set();

  try {
    const app: ExpressApplication = Express.getExpressApp();
    const stack: any[] = (app as any)?._router?.stack || [];

    for (const layer of stack) {
      if (!layer) {
        continue;
      }
      const route: any = layer.route || layer?.handle?.route;
      if (!route) {
        continue;
      }
      // Only include GET handlers
      const methods: any = route.methods || {};
      if (!methods.get) {
        continue;
      }
      const path: string | string[] | undefined =
        route.path || route?.route?.path;
      const rawPaths: Array<string | undefined> = Array.isArray(path)
        ? path
        : [path];
      const paths: string[] = rawPaths.filter(
        (p: string | undefined): p is string => {
          return Boolean(p);
        },
      );

      for (let p of paths) {
        if (!p || typeof p !== "string") {
          continue;
        }
        // Filters: skip parameterized, wildcard, api or file-serving or sitemap itself
        if (p.includes(":") || p.includes("*") || p.includes("sitemap")) {
          continue;
        }
        // Exclude script or installer endpoints
        if (p.endsWith(".sh")) {
          continue;
        }
        if (p.startsWith("/api") || p.startsWith("/blog/post")) {
          continue;
        }
        // We'll add compare pages separately with real slugs; skip base compare param route
        if (p.startsWith("/compare")) {
          continue;
        }
        // Normalize slash
        if (!p.startsWith("/")) {
          p = `/${p}`;
        }
        discoveredStaticPaths.add(p);
      }
    }

    // Ensure root present
    discoveredStaticPaths.add("/");
    // Ensure docs main landing page present
    discoveredStaticPaths.add("/docs");
    // add /reference
    discoveredStaticPaths.add("/reference");
  } catch {
    // If introspection fails, fall back to minimal set
    discoveredStaticPaths.add("/");
    discoveredStaticPaths.add("/blog");
  }

  return Array.from(discoveredStaticPaths);
}

// Generate the main sitemap index
export async function generateSitemapIndexXml(): Promise<string> {
  if (isCacheValid(indexCache)) {
    return indexCache!.data;
  }

  const baseUrl: URL = await BlogPostUtil.getHomeUrl();
  const baseUrlString: string = baseUrl.toString().replace(/\/$/, "");
  const timestamp: string = OneUptimeDate.getCurrentDate().toISOString();

  const sitemaps: SitemapIndexEntry[] = [];

  // Static pages sitemap
  sitemaps.push({
    loc: `${baseUrlString}/sitemap-pages.xml`,
    lastmod: timestamp,
  });

  // Compare pages sitemap
  sitemaps.push({
    loc: `${baseUrlString}/sitemap-compare.xml`,
    lastmod: timestamp,
  });

  /*
   * Note: Blog tag sitemaps removed - tag pages are noindex to improve
   * site quality signals and crawl budget efficiency
   */

  // Blog post sitemaps (paginated)
  const blogPageCount: number = await getBlogSitemapPageCount();
  for (let i: number = 1; i <= blogPageCount; i++) {
    sitemaps.push({
      loc: `${baseUrlString}/sitemap-blog-${i}.xml`,
      lastmod: timestamp,
    });
  }

  const xml: string = buildSitemapIndexXml(sitemaps);

  indexCache = {
    data: xml,
    generatedAt: OneUptimeDate.getCurrentDate().getTime(),
  };

  return xml;
}

// Generate sitemap for static pages
export async function generatePagesSitemapXml(): Promise<string> {
  if (isCacheValid(pagesCache)) {
    return pagesCache!.data;
  }

  const baseUrl: URL = await BlogPostUtil.getHomeUrl();
  const baseUrlString: string = baseUrl.toString().replace(/\/$/, "");
  const timestamp: string = OneUptimeDate.getCurrentDate().toISOString();

  const staticPaths: string[] = discoverStaticPaths();

  const entries: SitemapEntry[] = staticPaths.map((p: string) => {
    const config: SitemapPageConfig = getPageConfig(p);
    const pathWithoutLeadingSlash: string = p.replace(/^\//, "");
    return {
      loc:
        pathWithoutLeadingSlash === ""
          ? baseUrlString
          : `${baseUrlString}/${pathWithoutLeadingSlash}`,
      lastmod: timestamp,
      priority: config.priority,
      changefreq: config.changefreq,
    };
  });

  // Sort with homepage first
  entries.sort((a: SitemapEntry, b: SitemapEntry) => {
    if (a.loc === baseUrlString || a.loc === `${baseUrlString}/`) {
      return -1;
    }
    if (b.loc === baseUrlString || b.loc === `${baseUrlString}/`) {
      return 1;
    }
    return 0;
  });

  const xml: string = buildUrlsetXml(entries);

  pagesCache = {
    data: xml,
    generatedAt: OneUptimeDate.getCurrentDate().getTime(),
  };

  return xml;
}

// Generate sitemap for product compare pages
export async function generateCompareSitemapXml(): Promise<string> {
  if (isCacheValid(compareCache)) {
    return compareCache!.data;
  }

  const baseUrl: URL = await BlogPostUtil.getHomeUrl();
  const baseUrlString: string = baseUrl.toString().replace(/\/$/, "");
  const timestamp: string = OneUptimeDate.getCurrentDate().toISOString();

  const productCompareSlugs: string[] = getProductCompareSlugs();

  const entries: SitemapEntry[] = productCompareSlugs.map((slug: string) => {
    return {
      loc: `${baseUrlString}/compare/${slug}`,
      lastmod: timestamp,
      priority: COMPARE_PAGE_CONFIG.priority,
      changefreq: COMPARE_PAGE_CONFIG.changefreq,
    };
  });

  const xml: string = buildUrlsetXml(entries);

  compareCache = {
    data: xml,
    generatedAt: OneUptimeDate.getCurrentDate().getTime(),
  };

  return xml;
}

// Generate sitemap for blog tags (paginated)
export async function generateTagsSitemapXml(page: number): Promise<string> {
  const cachedTags: CachedData<string> | undefined = tagsCaches.get(page);
  if (isCacheValid(cachedTags)) {
    return cachedTags!.data;
  }

  const baseUrl: URL = await BlogPostUtil.getHomeUrl();
  const baseUrlString: string = baseUrl.toString().replace(/\/$/, "");
  const timestamp: string = OneUptimeDate.getCurrentDate().toISOString();

  const allTags: string[] = await BlogPostUtil.getTags();

  // Calculate slice for this page (1-indexed)
  const startIndex: number = (page - 1) * TAGS_PER_SITEMAP;
  const endIndex: number = startIndex + TAGS_PER_SITEMAP;
  const tagsForPage: string[] = allTags.slice(startIndex, endIndex);

  const entries: SitemapEntry[] = tagsForPage.map((tag: string) => {
    const tagSlug: string = encodeURIComponent(
      tag.toLowerCase().replace(/\s+/g, "-").trim(),
    );
    return {
      loc: `${baseUrlString}/blog/tag/${tagSlug}`,
      lastmod: timestamp,
      priority: BLOG_TAG_CONFIG.priority,
      changefreq: BLOG_TAG_CONFIG.changefreq,
    };
  });

  const xml: string = buildUrlsetXml(entries);

  tagsCaches.set(page, {
    data: xml,
    generatedAt: OneUptimeDate.getCurrentDate().getTime(),
  });

  return xml;
}

// Generate sitemap for blog posts (paginated)
export async function generateBlogSitemapXml(page: number): Promise<string> {
  const cachedBlog: CachedData<string> | undefined = blogCaches.get(page);
  if (isCacheValid(cachedBlog)) {
    return cachedBlog!.data;
  }

  const baseUrl: URL = await BlogPostUtil.getHomeUrl();
  const baseUrlString: string = baseUrl.toString().replace(/\/$/, "");

  const blogPosts: Array<BlogPostHeader> = await BlogPostUtil.getBlogPostList();

  // Calculate slice for this page (1-indexed)
  const startIndex: number = (page - 1) * BLOG_POSTS_PER_SITEMAP;
  const endIndex: number = startIndex + BLOG_POSTS_PER_SITEMAP;
  const postsForPage: Array<BlogPostHeader> = blogPosts.slice(
    startIndex,
    endIndex,
  );

  const entries: SitemapEntry[] = postsForPage.map((post: BlogPostHeader) => {
    const loc: string = post.blogUrl.startsWith("http")
      ? post.blogUrl
      : `${baseUrlString}${post.blogUrl.startsWith("/") ? post.blogUrl : `/${post.blogUrl}`}`;

    return {
      loc,
      lastmod: new Date(post.postDate).toISOString(),
      priority: BLOG_POST_CONFIG.priority,
      changefreq: BLOG_POST_CONFIG.changefreq,
    };
  });

  const xml: string = buildUrlsetXml(entries);

  blogCaches.set(page, {
    data: xml,
    generatedAt: OneUptimeDate.getCurrentDate().getTime(),
  });

  return xml;
}

/*
 * Legacy function for backwards compatibility (generates single sitemap)
 * This is kept in case any other code references it
 */
export const generateSitemapXml: () => Promise<string> =
  async (): Promise<string> => {
    // Redirect to sitemap index for backwards compatibility
    return generateSitemapIndexXml();
  };

export default generateSitemapXml;
