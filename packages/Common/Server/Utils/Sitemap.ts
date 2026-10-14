import { Host, HttpProtocol } from "../EnvironmentConfig";
import Protocol from "../../Types/API/Protocol";

/*
 * Sitemaps (https://www.sitemaps.org/protocol.html): the addresses of the
 * pages a site wants found, in the XML search engines read.
 *
 * A sitemap lists final addresses only - never one that redirects - and says
 * when a page last changed only when there is a real date to give. A date
 * made up when the sitemap is generated tells a crawler that every page
 * changed every time it looks, and it learns to ignore the dates the site
 * gives: so `lastmod` is left out rather than invented.
 */

export const SITEMAP_XML_NAMESPACE: string =
  "http://www.sitemaps.org/schemas/sitemap/0.9";

// The protocol's limit: a sitemap holds at most this many addresses.
export const MAX_SITEMAP_URLS: number = 50000;

// Served as application/xml, which the ingress compresses (gzip_types).
export const SITEMAP_CONTENT_TYPE: string = "application/xml; charset=utf-8";

export interface SitemapUrl {
  // The page's full address.
  loc: string;
  // When the page last changed (W3C datetime), only when that is known.
  lastmod?: string | undefined;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const XML_SPECIAL_CHARACTER: RegExp = /[&<>"']/g;

// Text as an XML element holds it: the protocol entity-escapes all five.
export const escapeSitemapText: (text: string) => string = (
  text: string,
): string => {
  return text.replace(XML_SPECIAL_CHARACTER, (character: string): string => {
    return XML_ESCAPES[character] || character;
  });
};

/*
 * The origin this instance serves its public pages from, as HOST and
 * HTTP_PROTOCOL name it ("https://oneuptime.com"): what a sitemap and a
 * canonical link write in front of a path, since both need the whole address.
 */
export const getPublicOrigin: () => string = (): string => {
  const protocol: string = HttpProtocol || Protocol.HTTP;
  const host: string = (Host || "localhost").trim().replace(/\/+$/, "");

  return `${protocol}${host}`;
};

// A <urlset> sitemap of these pages, in the order given.
export const buildSitemapXml: (urls: ReadonlyArray<SitemapUrl>) => string = (
  urls: ReadonlyArray<SitemapUrl>,
): string => {
  const lines: Array<string> = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="${SITEMAP_XML_NAMESPACE}">`,
  ];

  for (const url of urls) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeSitemapText(url.loc)}</loc>`);

    if (url.lastmod) {
      lines.push(`    <lastmod>${escapeSitemapText(url.lastmod)}</lastmod>`);
    }

    lines.push("  </url>");
  }

  lines.push("</urlset>");

  return `${lines.join("\n")}\n`;
};
