import { DEFAULT_DOCS_LANGUAGE } from "./I18n";
import { ReferenceNavSection, flattenNavigation } from "./Navigation";
import { SitemapUrl, buildSitemapXml } from "Common/Server/Utils/Sitemap";

/*
 * The API reference's sitemap, served at /reference/sitemap.xml and, through
 * the ingress, at /sitemap-reference.xml, which the site's sitemap index
 * (Home, /sitemap.xml) lists.
 *
 * It lists every page the reference's navigation links to - the guides,
 * every resource and every data type - and nothing else: the navigation is
 * what the reference serves (Utils/Navigation.ts), so a page left out of it,
 * such as the master admin APIs on oneuptime.com, is left out here too. The
 * pages are listed in English, the language their content is written in: a
 * resource's description and fields are its model's own, in every language.
 * No <lastmod> is given: the reference has no date a page last changed, and
 * one made up would be worse than none (see Common/Server/Utils/Sitemap.ts).
 */

// A reference page's full address in English.
export const getReferencePageUrl: (origin: string, slug: string) => string = (
  origin: string,
  slug: string,
): string => {
  return `${origin}/reference/${DEFAULT_DOCS_LANGUAGE}/${slug}`;
};

// Every address the sitemap lists, in the order a reader meets them.
export const getReferenceSitemapUrls: (
  origin: string,
  sections: Array<ReferenceNavSection>,
) => Array<SitemapUrl> = (
  origin: string,
  sections: Array<ReferenceNavSection>,
): Array<SitemapUrl> => {
  // A page the navigation lists twice is one page.
  const slugs: Set<string> = new Set();

  for (const item of flattenNavigation(sections)) {
    slugs.add(item.slug);
  }

  return Array.from(slugs).map((slug: string): SitemapUrl => {
    return { loc: getReferencePageUrl(origin, slug) };
  });
};

export const getReferenceSitemapXml: (
  origin: string,
  sections: Array<ReferenceNavSection>,
) => string = (
  origin: string,
  sections: Array<ReferenceNavSection>,
): string => {
  return buildSitemapXml(getReferenceSitemapUrls(origin, sections));
};
