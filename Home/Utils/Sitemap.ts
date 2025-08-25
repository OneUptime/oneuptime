import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import BlogPostUtil, { BlogPostHeader } from "./BlogPost";
import OneUptimeDate from "Common/Types/Date";
import URL from "Common/Types/API/URL";
import { getProductCompareSlugs } from "./ProductCompare";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";

interface CachedSitemap {
  xml: string;
  generatedAt: number; // epoch ms
}

// 10 minutes TTL
const TTL_MS: number = 10 * 60 * 1000;
let cache: CachedSitemap | null = null;

export const generateSitemapXml: () => Promise<string> =
  async (): Promise<string> => {
    const now: number = OneUptimeDate.getCurrentDate().getTime();
    if (cache && now - cache.generatedAt < TTL_MS) {
      return cache.xml;
    }

    const baseUrl: URL = await BlogPostUtil.getHomeUrl();

    // Discover static (non-parameterized) routes from Express stack
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
      // Ensure docs main landing page present (may be served statically and not discoverable)
      discoveredStaticPaths.add("/docs");
      // add /reference
      discoveredStaticPaths.add("/reference");
    } catch {
      // If introspection fails, fall back to minimal set
      discoveredStaticPaths.add("/");
      discoveredStaticPaths.add("/blog");
    }

    const staticPaths: string[] = Array.from(discoveredStaticPaths);

    // Product compare pages
    const productComparePaths: string[] = getProductCompareSlugs().map(
      (slug: string) => {
        return `/compare/${slug}`;
      },
    );

    // Blog posts
    const blogPosts: Array<BlogPostHeader> =
      await BlogPostUtil.getBlogPostList();
    const blogPostEntries: any[] = blogPosts.map((post: BlogPostHeader) => {
      // post.blogUrl already contains /blog/post/<slug>/view relative or absolute? In BlogPostUtil it's relative (starts with /blog...), so ensure absolute.
      const loc: string = post.blogUrl.startsWith("http")
        ? post.blogUrl
        : `${baseUrl.toString()}${post.blogUrl.replace(/^\//, "")}`;
      return {
        loc,
        lastmod: new Date(post.postDate).toISOString(),
      };
    });

    // Blog tags
    const tags: string[] = await BlogPostUtil.getTags();
    const tagEntries: any[] = tags.map((tag: string) => {
      const tagSlug: string = tag.toLowerCase().replace(/\s+/g, "-").trim();
      return {
        loc: `${baseUrl.toString()}blog/tag/${tagSlug}`,
        lastmod: OneUptimeDate.getCurrentDate().toISOString(),
      };
    });

    const timestamp: string = OneUptimeDate.getCurrentDate().toISOString();

    interface Entry {
      loc: string;
      lastmod: string;
    }
    const entries: Entry[] = [
      ...staticPaths.map((p: string) => {
        return {
          loc: `${baseUrl.toString()}${p.replace(/^\//, "")}`,
          lastmod: timestamp,
        };
      }),
      ...productComparePaths.map((p: string) => {
        return {
          loc: `${baseUrl.toString()}${p.replace(/^\//, "")}`,
          lastmod: timestamp,
        };
      }),
      ...blogPostEntries,
      ...tagEntries,
    ];

    // Remove duplicates (possible if overlap)
    const dedupMap: Map<string, Entry> = new Map();
    entries.forEach((e: Entry) => {
      if (!dedupMap.has(e.loc)) {
        dedupMap.set(e.loc, e);
      }
    });

    const urlset: XMLBuilder = create().ele("urlset");
    urlset.att("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9");

    // Ensure home URL is first
    const baseUrlString: string = baseUrl.toString();
    const orderedEntries: any[] = Array.from(dedupMap.values());
    orderedEntries.sort((a: any, b: any) => {
      if (a.loc === baseUrlString) {
        return -1;
      }
      if (b.loc === baseUrlString) {
        return 1;
      }
      return 0; // preserve relative order otherwise
    });

    for (const entry of orderedEntries) {
      const urlEle: XMLBuilder = urlset.ele("url");
      urlEle.ele("loc").txt(entry.loc);
      urlEle.ele("lastmod").txt(entry.lastmod);
    }

    const xml: string = urlset.end({ prettyPrint: true });

    cache = { xml, generatedAt: now };
    return xml;
  };

export default generateSitemapXml;
