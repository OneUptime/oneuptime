import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import BlogPostUtil, { BlogPostHeader } from "./BlogPost";
import OneUptimeDate from "Common/Types/Date";
import URL from "Common/Types/API/URL";
import { getProductCompareSlugs } from "./ProductCompare";
import { AIR_GAPPED_SHORT_PATHS } from "./AirGapped";
import { DEMO_SHORT_PATHS } from "./DemoPage";
import { getPublishedGuides } from "./Integrations/OpenTelemetry/OpenTelemetryGuides";
import { getOpenTelemetryGuidePath } from "Common/Types/Telemetry/OpenTelemetryGuides";
import Express, {
  ExpressApplication,
  ExpressResponse,
} from "Common/Server/Utils/Express";

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
  "/product/security-events": { priority: 0.9, changefreq: "weekly" },
  "/product/metrics": { priority: 0.9, changefreq: "weekly" },
  "/product/traces": { priority: 0.9, changefreq: "weekly" },
  "/product/exceptions": { priority: 0.9, changefreq: "weekly" },
  "/product/workflows": { priority: 0.9, changefreq: "weekly" },
  "/product/dashboards": { priority: 0.9, changefreq: "weekly" },
  "/product/ai-agent": { priority: 0.9, changefreq: "weekly" },
  "/product/scheduled-maintenance": { priority: 0.9, changefreq: "weekly" },
  "/product/kubernetes": { priority: 0.9, changefreq: "weekly" },
  "/product/docker": { priority: 0.9, changefreq: "weekly" },
  "/product/podman": { priority: 0.9, changefreq: "weekly" },
  "/product/host": { priority: 0.9, changefreq: "weekly" },
  "/product/proxmox": { priority: 0.9, changefreq: "weekly" },
  "/product/vmware": { priority: 0.9, changefreq: "weekly" },
  "/product/ai-observability": { priority: 0.9, changefreq: "weekly" },
  "/product/ceph": { priority: 0.9, changefreq: "weekly" },
  "/product/docker-swarm": { priority: 0.9, changefreq: "weekly" },
  "/product/iot": { priority: 0.9, changefreq: "weekly" },
  "/product/network-monitoring": { priority: 0.9, changefreq: "weekly" },
  "/product/observability": { priority: 0.9, changefreq: "weekly" },
  "/product/topology": { priority: 0.9, changefreq: "weekly" },
  "/product/serverless": { priority: 0.9, changefreq: "weekly" },
  "/product/rum": { priority: 0.9, changefreq: "weekly" },
  "/product/cloud": { priority: 0.9, changefreq: "weekly" },
  "/product/profiles": { priority: 0.9, changefreq: "weekly" },
  "/product/services": { priority: 0.9, changefreq: "weekly" },
  "/product/databases": { priority: 0.9, changefreq: "weekly" },
  "/product/queues": { priority: 0.9, changefreq: "weekly" },
  "/product/runbooks": { priority: 0.9, changefreq: "weekly" },

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
  "/enterprise/self-hosted": { priority: 0.9, changefreq: "weekly" },
  "/enterprise/air-gapped": { priority: 0.8, changefreq: "weekly" },
  "/enterprise/overview": { priority: 0.8, changefreq: "weekly" },
  "/trust": { priority: 0.8, changefreq: "weekly" },
  "/resellers": { priority: 0.6, changefreq: "monthly" },
  "/about": { priority: 0.7, changefreq: "weekly" },
  "/support": { priority: 0.7, changefreq: "weekly" },

  // The comparisons' hub; each comparison is in the compare sitemap.
  "/compare": { priority: 0.8, changefreq: "weekly" },

  // The integrations' index; each OpenTelemetry guide is in the integrations sitemap.
  "/integrations": { priority: 0.8, changefreq: "weekly" },

  // Books and blog
  "/books": { priority: 0.7, changefreq: "monthly" },
  "/blog": { priority: 0.7, changefreq: "daily" },

  // Community and legal
  "/oss-friends": { priority: 0.3, changefreq: "monthly" },
};

/*
 * Paths that only exist to redirect somewhere else. Route introspection cannot
 * tell a redirect from a page, and listing a 301 in the sitemap sends crawlers
 * (and buyers reading it) to a URL that is not the canonical one.
 */
export const REDIRECT_PATHS: Set<string> = new Set<string>([
  "/self-hosted",
  "/self-hosting",
  "/on-premise",
  // The air-gapped page's short addresses: "/air-gapped", "/airgapped".
  ...AIR_GAPPED_SHORT_PATHS,
  // The demo page's short addresses, oneuptime.com/demo among them.
  ...DEMO_SHORT_PATHS,
  "/security",
  "/security-center",
  "/trust-center",
  "/status-page",
  "/logs-management",
  "/workflows",
  "/runbooks",
  "/on-call",
  "/scheduled-maintenance",
  "/incident-management",
  "/ai-agent",
  // The Terms of Service, which /legal/terms is.
  "/legal",
  // The OpenTelemetry guides' folder, which is the integrations index.
  "/integrations/opentelemetry",
]);

/*
 * Redirects this service has no route for: the ingress hands /docs and
 * /reference to the app (Nginx/default.conf.template), which sends a reader
 * on to the first page in their language. Their pages are listed in the
 * docs' and the reference's own sitemaps (DOCS_SITEMAP_PATH and
 * REFERENCE_SITEMAP_PATH below).
 */
export const APP_REDIRECT_PATHS: Set<string> = new Set<string>([
  "/docs",
  "/reference",
]);

/*
 * The sitemaps of the docs and the API reference. The app serves those pages
 * and builds their sitemaps from them (App/FeatureSet/Docs/Utils/Sitemap.ts,
 * App/FeatureSet/APIReference/Utils/Sitemap.ts); the ingress serves the two
 * at these paths, at the site's root (Nginx/default.conf.template), so the
 * index below can list them beside this service's own.
 */
export const DOCS_SITEMAP_PATH: string = "/sitemap-docs.xml";
export const REFERENCE_SITEMAP_PATH: string = "/sitemap-reference.xml";

export type IsRedirectPathFunction = (path: string) => boolean;

export const isRedirectPath: IsRedirectPathFunction = (
  path: string,
): boolean => {
  return REDIRECT_PATHS.has(path) || APP_REDIRECT_PATHS.has(path);
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

// Compare page config
const COMPARE_PAGE_CONFIG: SitemapPageConfig = {
  priority: 0.7,
  changefreq: "monthly",
};

// An OpenTelemetry guide: a page people search for by framework.
const INTEGRATION_GUIDE_CONFIG: SitemapPageConfig = {
  priority: 0.8,
  changefreq: "monthly",
};

// Number of blog posts per sitemap file
const BLOG_POSTS_PER_SITEMAP: number = 1000;

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
let integrationsCache: CachedData<string> | null = null;
const blogCaches: Map<number, CachedData<string>> = new Map();

// Cache for blog post count to avoid repeated fetches
let blogPostCountCache: CachedData<number> | null = null;

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

/*
 * `lastmod` is given only where a real date is known: a blog post's date, and
 * for a blog sitemap the newest of its posts'. A static page, a comparison,
 * the docs and the reference have none, so theirs is left out rather than
 * set to the moment the sitemap was generated. A date that changes on every
 * fetch tells a crawler every page changed every time it looked, and it
 * learns to ignore every date the site gives - the real ones too.
 */
interface SitemapEntry {
  loc: string;
  lastmod?: string | undefined;
  priority: number;
  changefreq: ChangeFrequency;
}

function buildUrlsetXml(entries: SitemapEntry[]): string {
  const urlset: XMLBuilder = create().ele("urlset");
  urlset.att("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9");

  for (const entry of entries) {
    const urlEle: XMLBuilder = urlset.ele("url");
    urlEle.ele("loc").txt(entry.loc);
    if (entry.lastmod) {
      urlEle.ele("lastmod").txt(entry.lastmod);
    }
    urlEle.ele("changefreq").txt(entry.changefreq);
    urlEle.ele("priority").txt(entry.priority.toFixed(1));
  }

  return urlset.end({ prettyPrint: true });
}

interface SitemapIndexEntry {
  loc: string;
  lastmod?: string | undefined;
}

function buildSitemapIndexXml(entries: SitemapIndexEntry[]): string {
  const sitemapindex: XMLBuilder = create().ele("sitemapindex");
  sitemapindex.att("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9");

  for (const entry of entries) {
    const sitemapEle: XMLBuilder = sitemapindex.ele("sitemap");
    sitemapEle.ele("loc").txt(entry.loc);
    if (entry.lastmod) {
      sitemapEle.ele("lastmod").txt(entry.lastmod);
    }
  }

  return sitemapindex.end({ prettyPrint: true });
}

export type GetPostLastmodFunction = (
  postDate: string | undefined,
) => string | undefined;

// A post's own date, as a sitemap gives it; undefined when it is no date.
export const getPostLastmod: GetPostLastmodFunction = (
  postDate: string | undefined,
): string | undefined => {
  if (!postDate) {
    return undefined;
  }

  const date: Date = new Date(postDate);

  return isNaN(date.getTime()) ? undefined : date.toISOString();
};

/*
 * The lightweight post list (no git-history contributors). The sitemap only
 * needs the posts' addresses and dates, and resolving contributors runs an
 * expensive `git log` over the whole blog repo that previously timed the
 * sitemap index out (504).
 */
async function getBlogPosts(): Promise<Array<BlogPostHeader>> {
  return await BlogPostUtil.getBlogPostList();
}

// The posts one blog sitemap (1-indexed) lists.
function getPostsOfBlogSitemap(
  blogPosts: Array<BlogPostHeader>,
  page: number,
): Array<BlogPostHeader> {
  const startIndex: number = (page - 1) * BLOG_POSTS_PER_SITEMAP;
  return blogPosts.slice(startIndex, startIndex + BLOG_POSTS_PER_SITEMAP);
}

// The newest date of the posts a blog sitemap lists: when it last changed.
function getBlogSitemapLastmod(
  posts: Array<BlogPostHeader>,
): string | undefined {
  let newest: string | undefined = undefined;

  for (const post of posts) {
    const lastmod: string | undefined = getPostLastmod(post.postDate);

    if (lastmod && (!newest || lastmod > newest)) {
      newest = lastmod;
    }
  }

  return newest;
}

// Get total blog post count (cached)
async function getBlogPostCount(): Promise<number> {
  if (isCacheValid(blogPostCountCache)) {
    return blogPostCountCache!.data;
  }

  const count: number = (await getBlogPosts()).length;

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

/*
 * The blog tag sitemaps (/sitemap-tags-<n>.xml) are retired: tag pages are
 * noindex, so a sitemap of them asked crawlers to fetch five thousand pages
 * they are told not to index, and the index stopped listing them. The
 * addresses answer 410 Gone, so crawlers that remember them drop them.
 */
export const RETIRED_SITEMAP_STATUS: number = 410;

export type SendRetiredSitemapFunction = (res: ExpressResponse) => void;

export const sendRetiredSitemap: SendRetiredSitemapFunction = (
  res: ExpressResponse,
): void => {
  res.status(RETIRED_SITEMAP_STATUS);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex");
  res.send("This sitemap has been retired.");
};

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
        /*
         * Exclude machine-readable endpoints (robots.txt, llms.txt, RSS,
         * /data/*.json, .well-known, markdown page variants) — the sitemap is
         * for HTML pages.
         */
        if (
          p.endsWith(".txt") ||
          p.endsWith(".json") ||
          p.endsWith(".md") ||
          p.endsWith(".xml")
        ) {
          continue;
        }
        if (p.startsWith("/data/") || p.startsWith("/.well-known")) {
          continue;
        }
        if (p.startsWith("/api") || p.startsWith("/blog/post")) {
          continue;
        }
        // Redirects are not canonical pages.
        if (isRedirectPath(p)) {
          continue;
        }
        /*
         * Each comparison is in the compare sitemap, under its real slug; the
         * hub, /compare, is a page of its own and stays here.
         */
        if (p.startsWith("/compare/")) {
          continue;
        }
        // Normalize slash
        if (!p.startsWith("/")) {
          p = `/${p}`;
        }
        discoveredStaticPaths.add(p);
      }
    }

    /*
     * Ensure root present. /docs and /reference are not added: both redirect
     * (APP_REDIRECT_PATHS), and the docs' and the reference's own sitemaps
     * list their pages (DOCS_SITEMAP_PATH, REFERENCE_SITEMAP_PATH).
     */
    discoveredStaticPaths.add("/");
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

  /*
   * A sitemap's lastmod is when its pages last changed, and only the blog's
   * have a date: each blog sitemap is as new as its newest post. The others
   * have none, so none is given (see SitemapEntry).
   */
  const sitemaps: SitemapIndexEntry[] = [];

  // Static pages sitemap
  sitemaps.push({
    loc: `${baseUrlString}/sitemap-pages.xml`,
  });

  // Compare pages sitemap
  sitemaps.push({
    loc: `${baseUrlString}/sitemap-compare.xml`,
  });

  // The OpenTelemetry guides, one per framework
  sitemaps.push({
    loc: `${baseUrlString}/sitemap-integrations.xml`,
  });

  /*
   * Note: Blog tag sitemaps removed - tag pages are noindex to improve
   * site quality signals and crawl budget efficiency
   */

  // Blog post sitemaps (paginated)
  const blogPosts: Array<BlogPostHeader> = await getBlogPosts();
  const blogPageCount: number = Math.ceil(
    blogPosts.length / BLOG_POSTS_PER_SITEMAP,
  );
  for (let i: number = 1; i <= blogPageCount; i++) {
    sitemaps.push({
      loc: `${baseUrlString}/sitemap-blog-${i}.xml`,
      lastmod: getBlogSitemapLastmod(getPostsOfBlogSitemap(blogPosts, i)),
    });
  }

  // The docs and the API reference, served by the app (see DOCS_SITEMAP_PATH).
  sitemaps.push({
    loc: `${baseUrlString}${DOCS_SITEMAP_PATH}`,
  });

  sitemaps.push({
    loc: `${baseUrlString}${REFERENCE_SITEMAP_PATH}`,
  });

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

  const staticPaths: string[] = discoverStaticPaths();

  // No lastmod: a static page has no date it last changed (see SitemapEntry).
  const entries: SitemapEntry[] = staticPaths.map((p: string) => {
    const config: SitemapPageConfig = getPageConfig(p);
    const pathWithoutLeadingSlash: string = p.replace(/^\//, "");
    return {
      loc:
        pathWithoutLeadingSlash === ""
          ? baseUrlString
          : `${baseUrlString}/${pathWithoutLeadingSlash}`,
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

  const productCompareSlugs: string[] = getProductCompareSlugs();

  // No lastmod: a comparison has no date it last changed (see SitemapEntry).
  const entries: SitemapEntry[] = productCompareSlugs.map((slug: string) => {
    return {
      loc: `${baseUrlString}/compare/${slug}`,
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

/*
 * The OpenTelemetry guides, /integrations/opentelemetry/<framework>: every
 * guide the site publishes. No lastmod, as for the other pages (see
 * SitemapEntry).
 */
export async function generateIntegrationsSitemapXml(): Promise<string> {
  if (isCacheValid(integrationsCache)) {
    return integrationsCache!.data;
  }

  const baseUrl: URL = await BlogPostUtil.getHomeUrl();
  const baseUrlString: string = baseUrl.toString().replace(/\/$/, "");

  const entries: SitemapEntry[] = getPublishedGuides().map(
    ({ guide }: { guide: { slug: string } }): SitemapEntry => {
      return {
        loc: `${baseUrlString}${getOpenTelemetryGuidePath(guide.slug)}`,
        priority: INTEGRATION_GUIDE_CONFIG.priority,
        changefreq: INTEGRATION_GUIDE_CONFIG.changefreq,
      };
    },
  );

  const xml: string = buildUrlsetXml(entries);

  integrationsCache = {
    data: xml,
    generatedAt: OneUptimeDate.getCurrentDate().getTime(),
  };

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

  // Lightweight list (no contributors) — the sitemap only needs urls + dates.
  const postsForPage: Array<BlogPostHeader> = getPostsOfBlogSitemap(
    await getBlogPosts(),
    page,
  );

  // A post's own date is its lastmod: the one real date in these sitemaps.
  const entries: SitemapEntry[] = postsForPage.map((post: BlogPostHeader) => {
    const loc: string = post.blogUrl.startsWith("http")
      ? post.blogUrl
      : `${baseUrlString}${post.blogUrl.startsWith("/") ? post.blogUrl : `/${post.blogUrl}`}`;

    return {
      loc,
      lastmod: getPostLastmod(post.postDate),
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
