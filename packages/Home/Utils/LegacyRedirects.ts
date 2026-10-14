import { redirectPreservingQuery } from "./Redirect";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";

/*
 * Addresses that earlier versions of oneuptime.com published, and that search
 * engines, old links and bookmarks still send people to. They answered 404:
 * a visitor met a dead end, and search engines dropped whatever the address
 * had earned instead of passing it on. Each now moves permanently (301) to
 * the page that replaced it, keeping the query string a paid click carries
 * (see Redirect.ts).
 *
 * Most were listed in the site's old static sitemap (Home/Static/sitemap.xml,
 * removed in January 2026); the rest were found answering 404 by the October
 * 2026 SEO audit.
 *
 * Routes.ts registers redirectLegacyUrl after every route and after the
 * static files, so only a request nothing else answered reaches it. An entry
 * here can never shadow a page the site serves, and a page that comes back at
 * one of these addresses takes over from its entry by itself.
 */

export interface LegacyRedirect {
  // The retired address, as it was published.
  from: string;
  // The page that replaced it.
  to: string;
}

export const LegacyRedirects: ReadonlyArray<LegacyRedirect> = [
  // Product pages that were renamed, or folded into a broader product.
  { from: "/product/api-monitoring", to: "/product/monitoring" },
  { from: "/product/uptime-monitoring", to: "/product/monitoring" },
  { from: "/product/server-monitoring", to: "/product/host" },
  { from: "/product/oncall-management", to: "/product/on-call" },
  { from: "/product/public-StatusPage", to: "/product/status-page" },
  { from: "/product/private-StatusPage", to: "/product/status-page" },
  { from: "/product/app-security", to: "/product/security-events" },
  {
    from: "/product/docker-container-security",
    to: "/product/security-events",
  },

  // Comparison tables, which grew into full comparison pages.
  { from: "/table/pagerduty", to: "/compare/pagerduty" },
  { from: "/table/pingdom", to: "/compare/pingdom" },
  { from: "/table/statuspage.io", to: "/compare/statuspage.io" },

  /*
   * Compliance documents that were PDFs and are now pages of the legal center.
   * They reach Home only through nginx's `location ^~ /files/`
   * (Nginx/default.conf.template): the app's /file location would take them.
   */
  { from: "/files/soc-3.pdf", to: "/legal/soc-3" },
  { from: "/files/pci.pdf", to: "/legal/pci" },
  { from: "/files/iso-27001.pdf", to: "/legal/iso-27001" },
  { from: "/files/iso-27017.pdf", to: "/legal/iso-27017" },
  { from: "/files/iso-27018.pdf", to: "/legal/iso-27018" },

  { from: "/enterprise/resources", to: "/enterprise/overview" },
  { from: "/pricing-1", to: "/pricing" },
  { from: "/pricing-14", to: "/pricing" },
  { from: "/rss", to: "/blog/rss.xml" },
  { from: "/customers", to: "/" },
];

/*
 * Retired sections: the address itself and everything under it. The
 * resources pages offered each document at its own address here.
 */
export const LegacyRedirectSections: ReadonlyArray<LegacyRedirect> = [
  { from: "/enterprise/download-resource", to: "/enterprise/overview" },
];

type NormalizePathFunction = (path: string) => string;

/*
 * Compare paths the way Express compares them with an app.get route, which
 * is how every other address on the site is matched: letter case does not
 * matter, and one trailing slash is allowed.
 */
const normalizePath: NormalizePathFunction = (path: string): string => {
  const lowerCased: string = path.toLowerCase();

  if (lowerCased.length > 1 && lowerCased.endsWith("/")) {
    return lowerCased.slice(0, -1);
  }

  return lowerCased;
};

const targetsByPath: Map<string, string> = new Map<string, string>(
  LegacyRedirects.map((redirect: LegacyRedirect): [string, string] => {
    return [normalizePath(redirect.from), redirect.to];
  }),
);

export type GetLegacyRedirectTargetFunction = (path: string) => string | null;

// Where a retired address now lives, or null for any other address.
export const getLegacyRedirectTarget: GetLegacyRedirectTargetFunction = (
  path: string,
): string | null => {
  const normalizedPath: string = normalizePath(path);
  const target: string | undefined = targetsByPath.get(normalizedPath);

  if (target !== undefined) {
    return target;
  }

  for (const section of LegacyRedirectSections) {
    const sectionPath: string = normalizePath(section.from);

    if (
      normalizedPath === sectionPath ||
      normalizedPath.startsWith(`${sectionPath}/`)
    ) {
      return section.to;
    }
  }

  return null;
};

export type RedirectLegacyUrlFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void;

/*
 * Answers GET and HEAD, as an app.get route would, and hands every other
 * request on untouched.
 */
export const redirectLegacyUrl: RedirectLegacyUrlFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }

  const target: string | null = getLegacyRedirectTarget(req.path);

  if (target === null) {
    next();
    return;
  }

  redirectPreservingQuery(req, res, target, 301);
};
