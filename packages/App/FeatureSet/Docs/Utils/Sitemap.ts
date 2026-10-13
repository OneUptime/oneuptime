import DocsNav, { NavGroup } from "./Nav";
import DocsTranslations from "./Translations";
import { getDocsPageUrl } from "./Seo";
import {
  SitemapUrl,
  buildSitemapXml,
  getPublicOrigin,
} from "Common/Server/Utils/Sitemap";
import OneUptimeDate from "Common/Types/Date";

/*
 * The docs' sitemap, served at /docs/sitemap.xml and, through the ingress, at
 * /sitemap-docs.xml, which the site's sitemap index (Home, /sitemap.xml)
 * lists.
 *
 * It lists the address every page is its own canonical page at: each page in
 * English, and in each language it is translated into (Utils/Translations.ts)
 * - never a page served in English under another language's prefix, whose
 * canonical is the English page, and never an address that redirects. The
 * docs carry no date a page last changed, so no <lastmod> is given rather
 * than one made up (see Common/Server/Utils/Sitemap.ts).
 */

const CACHE_TTL_MS: number = 10 * 60 * 1000;

let cachedXml: { xml: string; generatedAt: number } | null = null;

// "category/page" for every page the docs serve, in the sidebar's order.
export const getDocsPagePaths: (nav?: Array<NavGroup>) => Array<string> = (
  nav: Array<NavGroup> = DocsNav,
): Array<string> => {
  const paths: Array<string> = [];

  for (const group of nav) {
    for (const link of group.links) {
      // The sidebar also links out (the Helm chart on Artifact Hub).
      if (!link.url.startsWith("/docs/")) {
        continue;
      }

      const pagePath: string = link.url.slice("/docs/".length).toLowerCase();

      if (!paths.includes(pagePath)) {
        paths.push(pagePath);
      }
    }
  }

  return paths;
};

// Every address the sitemap lists, page by page, English first.
export const getDocsSitemapUrls: (
  origin: string,
) => Promise<Array<SitemapUrl>> = async (
  origin: string,
): Promise<Array<SitemapUrl>> => {
  const urls: Array<SitemapUrl> = [];

  for (const pagePath of getDocsPagePaths()) {
    const languages: Array<string> =
      await DocsTranslations.getLanguages(pagePath);

    for (const lang of languages) {
      urls.push({ loc: getDocsPageUrl(origin, lang, pagePath) });
    }
  }

  return urls;
};

export default class DocsSitemap {
  public static async getSitemapXml(): Promise<string> {
    const now: number = OneUptimeDate.getCurrentDate().getTime();

    if (cachedXml && now - cachedXml.generatedAt < CACHE_TTL_MS) {
      return cachedXml.xml;
    }

    const xml: string = buildSitemapXml(
      await getDocsSitemapUrls(getPublicOrigin()),
    );

    cachedXml = { xml: xml, generatedAt: now };

    return xml;
  }

  // Forgets the generated sitemap, for tests that read it more than once.
  public static clearCache(): void {
    cachedXml = null;
  }
}
